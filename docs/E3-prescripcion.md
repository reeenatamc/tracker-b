# E3 · Prescripción versionada e inmutable

Especificación para revisión. **Nada de esto está implementado.**

Contexto en [`arquitectura.md`](./arquitectura.md) §2. Etapas anteriores: `e1`, `e2`, `t001`.

> **Versión pública.** Ids y fechas de los ejemplos son genéricos. Los reales viven en
> `content/`, que es privado.

---

## Lo que E3 resuelve, y lo que deliberadamente no

E3 construye las tres capas del documento de arquitectura: **base**, **ajustes**,
**instantánea**. Con eso, la prescripción deja de ser un valor escrito en el YAML y pasa a
ser algo que se resuelve para una fecha — y que, una vez ejecutado, queda congelado.

**E3 no trae el motor de adaptación.** Nada aquí propone un cambio, detecta un
estancamiento ni sugiere subir carga. Primero la infraestructura que hace que un cambio de
plan sea registrable, atribuible y reversible; el motor que propone esos cambios es E6, y
llega cuando exista dónde escribirlos.

Concretamente, E3 **no** introduce: tendencias, detección de estancamiento, sugerencias,
`Rationale`, `CoachSuggestion`, ni ninguna regla que mire el historial para opinar. Un
ajuste de E3 lo escribes tú.

---

## Las dos garantías

### G3 · Una sesión empezada no cambia nunca de prescripción

> **Modificar el plan mañana no puede alterar ni una sola prescripción histórica de una
> sesión que ya comenzó.**

El mecanismo es el mismo que sostiene G1 en E2, y esa consistencia es deliberada: **el
hecho se guarda, no se recalcula.** Al pulsar «empezar sesión» se congela una
`SessionPlanSnapshot` con la prescripción resuelta, entera y autocontenida. A partir de
ahí, esa sesión lee su instantánea y **nunca** vuelve a consultar la base ni el registro de
ajustes.

Autocontenida es la palabra que hace el trabajo: la instantánea guarda valores resueltos,
no referencias. Si mañana revocas el ajuste que puso tres series, la sesión del martes
sigue diciendo tres series, porque nunca supo de ese ajuste — sólo del número.

### G4 · Sin motor

Comprobable por diff: no aparecen `Rationale`, `Suggestion`, `analyseTrend` ni nada que
lea el historial para proponer. `progression.ts` conserva su comportamiento y las pruebas
de caracterización de E0 siguen pasando con sus quince decisiones intactas.

---

## 1. `PrescriptionEntry` — la identidad longitudinal del hueco

Un ejercicio de una sesión no es un ejercicio: es un **hueco** que hoy lo ocupa un
ejercicio. El tercer hueco del Full Body A puede pasar de prensa a hack, y el historial de
«qué hubo en ese hueco» tiene que sobrevivir a ese cambio — que es exactamente el mismo
argumento por el que los ejercicios dejaron de identificarse por su nombre en E1.

Por eso la identidad **no** es `${templateId}:${exerciseId}`. El ejercicio es un campo del
hueco, no su nombre.

```ts
/** Opaco y estable. Nunca se deriva de lo que hay dentro. */
export type PrescriptionEntryId = string

export type PrescriptionEntry = {
  id: PrescriptionEntryId
  templateId: string
  /** Quién ocupa el hueco. Cambiable con un ajuste; no es identidad. */
  exerciseId: CanonicalId
  order: number

  sets: SetCount
  target: Target
  load: Load
  rir: Range | null
  restSeconds: Range | null
  trainingRole: TrainingRole
  goal: string
  progression: string
  cues: string[]
  allowedSubstitutions: SubstitutionRef[]
}

/** El estado de partida de cada hueco. Se siembra una vez y no se reescribe. */
export type PrescriptionBaseline = PrescriptionEntry & {
  seededFrom: string
  seededAt: number
}
```

Los ids se asignan una vez en la migración con la forma `slot_<plantilla>_<nn>` y se
congelan en `__fixtures__/prescription-entry-ids.ts`, con la misma prueba de sólo-crecer que
protege los ids de fase. El número es una posición inicial, no un orden vigente: reordenar
cambia `order`, nunca el id.

### Por qué la variación por fase no está en la base

Porque no es la base: es lo primero que el plan decidió cambiar. Se expresa como un ajuste
con `origin: "program"`, que es lo que impide que la app «crea» que una fase son N series
— sabe que **el plan de partida dijo** que lo fueran, y desde cuándo.

## 2. `PlanAdjustment`

Una unión discriminada, no un `field` con `value: unknown`. Cada forma de cambiar el plan
es una forma distinta, y cada campo lleva su tipo.

```ts
/** Cambiar un campo. La relación campo↔tipo la conserva el discriminante. */
export type FieldChange =
  | { field: "sets";                 value: SetCount }
  | { field: "target";               value: Target }
  | { field: "load";                 value: Load }
  | { field: "rir";                  value: Range | null }
  | { field: "restSeconds";          value: Range | null }
  | { field: "trainingRole";         value: TrainingRole }
  | { field: "cues";                 value: string[] }
  | { field: "allowedSubstitutions"; value: SubstitutionRef[] }
  | { field: "goal";                 value: string }
  | { field: "progression";          value: string }
  | { field: "order";                value: number }

export type AdjustmentOrigin =
  | "program" | "review" | "coach" | "manual" | "safety"

/** Lo común a todo ajuste. La temporalidad vive aquí. */
type AdjustmentBase = {
  id: string

  /**
   * Desde qué fecha aplica. Obligatoria en todos, sin excepción — un ajuste es un
   * estado que dura, y un estado sin fecha de inicio no se puede resolver.
   */
  effectiveOn: IsoDate
  /** Restricción adicional: sólo mientras estés en esa fase. Ver §3.2. */
  onlyInPhase: string | null

  origin: AdjustmentOrigin
  /** No vacío. Un ajuste sin motivo es un número sin dueño. */
  reason: string
  evidenceIds: string[]

  /** Cuándo se registró. Es el eje de tiempo de transacción. Ver §3. */
  createdAt: number
}

export type PlanAdjustment = AdjustmentBase &
  (
    | { kind: "set_field"; entryId: PrescriptionEntryId; change: FieldChange }
    /**
     * El hueco pasa a ocuparlo otro ejercicio, con su prescripción entera. Lo
     * único que sobrevive es el `entryId`. Ver §2.2.
     */
    | {
        kind: "replace_exercise"
        entryId: PrescriptionEntryId
        entry: Omit<PrescriptionEntry, "id" | "templateId">
        /** Obligatorio si hay un `safety` vivo sobre el hueco. Ver §2.3. */
        safetyResolution: SafetyResolution | null
      }
    /** Un hueco nuevo, con su estado inicial completo. */
    | { kind: "add_entry"; entry: PrescriptionEntry }
    /** El hueco deja de programarse. No se borra: deja de resolver. */
    | { kind: "remove_entry"; entryId: PrescriptionEntryId }
    /**
     * Aquel ajuste deja de aplicar **a partir de `effectiveOn`**. No lo borra de
     * las fechas en las que sí estuvo vigente. Ver §3.
     *
     * No puede apuntar a otra revocación. Ver §2.4.
     */
    | { kind: "revoke"; revokesId: string }
  )

/** De dónde salió el ajuste, y qué de él es una suposición. */
export type Provenance =
  | { kind: "authored" }
  | {
      kind: "migrated"
      from: "setsByPhase" | "exerciseOverride"
      /** La fecha de efecto no vino del dato: la puso la migración. */
      assumedEffectiveOn: boolean
    }
```

Todo ajuste lleva además `provenance`, para distinguir lo que decidiste de lo que dedujo
una migración — y, dentro de lo migrado, qué fecha es real y cuál es una suposición.

### 2.1 `goal`, `progression` y `order` sí son ajustables

Los tres entran en `FieldChange` ahora y no después. `goal` y `progression` son el texto que
lees en la barra, y cambian cuando cambia el papel del ejercicio en la semana; `order` es
reordenar la sesión, que es algo que se quiere hacer. Ninguno tiene una razón para ser
inmutable, y añadirlos más tarde obligaría a migrar ajustes ya escritos.

### 2.2 Reemplazar un ejercicio no hereda nada

`replace_exercise` lleva **la prescripción completa** del ocupante nuevo. Conservar carga,
señales o sustituciones del anterior sería peor que un error visible: veinte kilos de remo
sentado no son veinte kilos de otra máquina, y una señal técnica del movimiento viejo es
una instrucción equivocada con pinta de deliberada.

Lo único longitudinal es el `entryId`. Es justo la distinción de §1: el hueco persiste, su
contenido no.

### 2.3 Reemplazar con una alarma viva es un conflicto, no un trámite

Si sobre ese hueco hay un ajuste `origin: "safety"` en vigor, el reemplazo **no puede
completarse en silencio**. Trasladar una alarma al ejercicio nuevo afirmaría algo que nadie
ha comprobado; descartarla afirmaría lo contrario. Las dos son decisiones, así que se piden:

```ts
export type SafetyResolution = {
  /** Los ajustes safety vivos sobre el hueco en el momento del reemplazo. */
  safetyAdjustmentIds: string[]
  decision:
    /** Sigue aplicando tal cual al ejercicio nuevo. */
    | { kind: "keep" }
    /** Se sustituye por una alarma reformulada para el movimiento nuevo. */
    | { kind: "reformulate"; replacementAdjustmentId: string }
    /** Deja de aplicar. Requiere su propia revocación, que se referencia aquí. */
    | { kind: "revoke"; revocationAdjustmentId: string }
  reason: string
}
```

La validación rechaza un `replace_exercise` con `safetyResolution: null` cuando hay una
alarma viva. Es la misma regla que ya gobierna `safety.ts` — el dolor manda sobre la
progresión — llevada al sitio donde el plan podría saltársela por descuido.

### 2.4 Una revocación no revoca otra revocación

`revokesId` debe apuntar a un ajuste que no sea `revoke`. Lo comprueba el esquema y una
prueba.

Si una revocación fue un error, la salida no es anularla —eso encadena negaciones y hace
que «¿qué regía el 25 de octubre?» dependa de contar cuántas hay— sino **volver a expresar
el estado que quieres** con un ajuste nuevo y su propia fecha de efecto. Más filas, y
legible de un vistazo.

Corregir es revocar y volver a poner: un `revoke` con la fecha desde la que el anterior
deja de valer, y un ajuste nuevo. Dos filas en vez de un `supersedesId`, porque **la
corrección también tiene fecha de efecto** y meterla en el mismo evento invitaba a
olvidarla.

Append-only, con la misma envoltura que `phaseEvents` y las mismas escrituras contadas por
el tracker de T-001.

## 3. Temporalidad: dos ejes

Aquí estaba el error de la primera versión. Reutilizar la semántica de `liveEvents` de las
transiciones de fase habría hecho que revocar hoy un ajuste lo borrara de octubre, cuando
en octubre **sí estuvo vigente**. Un evento de fase es un punto y anularlo puede ser total;
un ajuste es un estado que dura, y anularlo sólo puede mirar hacia delante.

Así que hay dos ejes, y una consulta cita los dos:

| Eje | Cómo se expresa | Pregunta que responde |
|---|---|---|
| **Tiempo de validez** | `effectiveOn` | ¿Qué prescripción regía **el día X**? |
| **Frontera de conocimiento** | un conjunto de ids | ¿Qué sabíamos **cuando lo miramos**? |

### 3.0 La frontera no es un reloj

La primera versión decía `createdAt <= knownAt`, y eso no aguanta en esta app. Dos
dispositivos que registran sin red tienen relojes que no coinciden: un ajuste escrito en el
móvil el martes puede llevar un `createdAt` posterior al de otro escrito en el portátil el
miércoles, y una frontera temporal metería o dejaría fuera al que no toca.

Así que la frontera es **un conjunto explícito**, no un instante:

```ts
export type KnowledgeCut = {
  adjustmentIds: string[]
  phaseEventIds: string[]
}
```

`createdAt` se queda —hace falta para ordenar y para auditar— pero **no decide por sí solo
qué conocía una consulta**. Es la misma lección que los ids de ejercicio y los de fase: un
conjunto que se declara gana a una propiedad que se infiere.

Una consulta en vivo no lleva corte y usa todo lo presente. Una versión lleva el suyo,
congelado al marcarla, y resuelve **sólo con esos ids**.

### 3.1 Definición

> Un ajuste `A` está **en vigor** en `(effectiveOn = d, conocimiento = K)` si y sólo si:
>
> 1. `K` es nulo (consulta en vivo) o `K.adjustmentIds` contiene `A.id` — estaba dentro
>    de lo que se conocía;
> 2. `A.effectiveOn <= d` — ya había entrado en vigor ese día;
> 3. si `A.onlyInPhase` no es nulo, la fase resuelta para `d` es esa;
> 4. **no** existe una revocación `R` con `R.revokesId === A.id`, que esté dentro de `K`,
>    **y** con `R.effectiveOn <= d`.

La condición 4 es la que arregla el error: una revocación tiene su propia fecha de efecto,
así que retira el ajuste **desde ahí hacia delante** y lo deja intacto antes.

### 3.2 `onlyInPhase` y la fecha son dos compuertas

Las dos condiciones se cumplen a la vez: hay que estar en la fase **y** haber pasado la
fecha de efecto. De ahí salen dos comportamientos distintos según de dónde venga el ajuste,
y los dos son los que se quieren.

**Un ajuste que escribes tú a mitad de fase no es retroactivo.** Su `effectiveOn` es el día
real, así que «a partir del jueves, tres series mientras siga en recomposición» no reescribe
el lunes.

**Un ajuste del programa sigue la entrada real a la fase, tarde o pronto.** Los que la
migración crea desde `setsByPhase` llevan `effectiveOn` = **inicio del programa**, no el
`plannedStart` de su fase. Estaban en el plan desde el primer día; lo que decide cuándo
surten efecto es `onlyInPhase`, y sólo eso.

La diferencia importa en los dos sentidos:

| Situación | Con `effectiveOn` = `plannedStart` | Con `effectiveOn` = inicio del programa |
|---|---|---|
| Entras en la fase **tarde** | Funciona por casualidad | Funciona |
| Entras en la fase **pronto** | **Falla**: la fecha aún no llegó y la prescripción de la fase no se aplica | Funciona |

Usar `plannedStart` habría vuelto a atar el plan al calendario, que es exactamente lo que
E2 fue a quitar. La compuerta es la fase; la fecha sólo existe para que un ajuste tuyo no
mire hacia atrás.

### 3.3 Un ejemplo completo

Una entrada, campo `sets`, base 2.

| # | Evento | `effectiveOn` | `createdAt` |
|---|---|---|---|
| A1 | `set_field sets = 3` | 5 oct | 5 oct |
| R1 | `revoke A1` | 1 nov | 1 nov |
| A2 | `set_field sets = 2` | 1 nov | 1 nov |
| R2 | `revoke A1` | **20 oct** | **1 dic** |

Resolución en varias consultas:

| `effectiveOn` | Conocimiento | Series | Por qué |
|---|---|---|---|
| 1 oct | en vivo | **2** | A1 aún no había entrado en vigor |
| 10 oct | en vivo | **3** | A1 vigente; ninguna revocación alcanza esa fecha |
| 10 oct | corte `{A1}` | **3** | El corte sólo contenía A1 |
| **25 oct** | **corte `{A1, R1, A2}`** | **3** | R2 no estaba en el corte |
| **25 oct** | **en vivo** | **2** | R2 existe y su efecto empieza el 20 oct |
| 15 nov | en vivo | **2** | A2 vigente |

Las dos filas resaltadas son el punto: **la misma fecha da respuestas distintas según qué
conocimiento cites**, y las dos son correctas. Una corrección retroactiva escrita en
diciembre cambia lo que hoy creemos del 25 de octubre, y **no** cambia lo que decía una
versión marcada en noviembre — porque esa versión lleva escrito, id por id, lo que conocía.

## 4. Resolución

```ts
export type AsOf = {
  /** La fecha cuya prescripción se consulta. */
  effectiveOn: IsoDate
  /** Qué se conocía. `null` = todo lo presente, que es la consulta en vivo. */
  knows: KnowledgeCut | null
}

export function resolvePrescription(
  baseline: readonly PrescriptionBaseline[],
  adjustments: readonly PlanAdjustment[],
  phaseAt: (date: IsoDate, knows: KnowledgeCut | null) => Phase,
  templateId: string,
  asOf: AsOf,
): PrescriptionEntry[]
```

1. Partir de los huecos base de esa plantilla.
2. Filtrar los ajustes en vigor por §3.1.
3. Ordenar por precedencia (§5).
4. Plegar: `add_entry` añade, `remove_entry` retira, `replace_exercise` cambia el ocupante,
   `set_field` escribe su campo.

`phaseAt` se recibe como función, no se importa: **la fase también es bitemporal**. Una
corrección de `PhaseEvent` escrita en diciembre tampoco puede mover lo que una versión de
octubre resolvía, así que `phaseForDate` acepta un conjunto de ids además de la lista
completa, y resuelve sólo con ellos. Es el único cambio que E3 hace en el código de E2 — y
no filtra por reloj, por la razón de §3.0.

Pura, sin E/S. Como todo lo que decide algo aquí.

## 5. Precedencia

Cuando dos ajustes en vigor tocan el mismo campo del mismo hueco, gana el último por:

| # | Criterio |
|---|---|
| 1 | `origin`: `program` < `review` = `coach` = `manual` < `safety` |
| 2 | `effectiveOn`, ascendente |
| 3 | `createdAt`, luego `id` — determinista entre dispositivos |

**`safety` arriba, y no se cae solo.** No deja de aplicar porque escribas después un ajuste
manual: para quitarla hay que revocarla. La regla de `safety.ts` dice que el dolor manda
sobre la progresión, y sería raro que el plan pudiera saltársela por orden de llegada.

## 6. `SessionPlanSnapshot`

```ts
export type SessionPlanSnapshot = {
  id: string
  sessionId: string
  takenAt: number
  phaseId: string
  /** Valores resueltos, no referencias. Aquí está G3. */
  entries: PrescriptionEntry[]

  /**
   * `committed`     — se congeló al empezar la sesión. Hecho observado.
   * `reconstructed` — se dedujo después para una sesión anterior a E3. Derivado.
   *
   * «Provisional» no se guarda: es una observación, no un estado. Ver §6.3.
   */
  status: "committed" | "reconstructed"
  /**
   * Sólo en las reconstruidas.
   * `complete` — todo lo que la afectaba tenía fecha fiable y se pudo situar.
   * `partial`  — algo no se pudo fechar y quedó fuera.
   */
  reconstructionConfidence: "complete" | "partial" | null
  /** Qué no se pudo situar, para que «parcial» diga en qué. */
  reconstructionGaps: string[]

  /** Qué ajustes regían. Sólo para explicar; no hace falta para renderizar. */
  adjustmentIds: string[]
}
```

### 6.1 Reconstruir sin inventar

Las sesiones anteriores a E3 no congelaron nada. Se les deduce una instantánea resolviendo
el plan a su fecha — pero **sólo con lo que se puede demostrar que existía entonces**.

El caso que obliga a la regla es `ExerciseOverride`. Sus filas llevan `updatedAt` desde que
existe la sincronización; **las escritas antes no llevan ninguno**.

| Situación del override | Qué se hace | Confianza |
|---|---|---|
| `updatedAt` fiable, anterior a la sesión | Se incorpora | sigue `complete` |
| `updatedAt` fiable, posterior a la sesión | Se deja fuera: no existía | sigue `complete` |
| **Sin `updatedAt`** | **Se deja fuera**, anotado en `reconstructionGaps` | pasa a `partial` |

No se incorpora nada que no se pueda fechar. Meterlo «porque probablemente ya estaba» sería
justo lo que E3 existe para impedir: una prescripción histórica inventada con la misma
pinta que una real. Una instantánea `partial` dice qué había y admite qué no pudo situar;
una que se inventa el override es peor que no tenerla.

### 6.2 Varias por sesión

Puede haber más de una. Si a mitad adoptas un cambio de plan se toma otra y la primera se
queda: la sesión usa la más reciente, y «qué tenías prescrito al empezar» sigue siendo
respondible.

### 6.3 Tres estados, y la regla que los ordena

La versión anterior se contradecía: decía «append-only», «el rollback borra las
reconstruidas» y «las huérfanas se descartan». Tres reglas que no pueden ser ciertas a la
vez sobre una misma colección.

Se arregla con **una sola regla, sobre una propiedad que no es un campo**:

| Estado | Cómo se sabe | Se puede borrar |
|---|---|---|
| **committed y referenciada** | `status: "committed"` y alguna sesión la apunta | **Nunca.** Es un hecho. |
| **reconstruida** | `status: "reconstructed"` | Sí. Es un derivado y se regenera. |
| **provisional** | `committed` y **ninguna sesión la apunta** | Sí, con condiciones (§6.4). |

> **Actualizar: nunca. Borrar: sólo si es reconstruida, o si nadie la referencia.**

«Provisional» no se guarda como estado porque no lo es: es lo que se observa mientras el
paso 3 de §7.1 aún no ha ocurrido. Guardarlo obligaría a una transición
provisional → committed, que es un `update` sobre algo que no debe admitirlos.

### 6.4 Una huérfana no se borra enseguida

Una instantánea sin sesión puede no ser basura: puede que la sesión exista **en el otro
dispositivo** y todavía no haya llegado. Borrarla al arrancar sería destruir el plan de una
sesión real por ir demasiado rápido.

Se recoge sólo cuando se cumplen las dos:

1. han pasado **al menos 24 horas** desde `takenAt`, y
2. ha habido **al menos una sincronización correcta** después de ese `takenAt`.

Sin sincronización configurada, basta la primera. Es lento a propósito: el coste de guardar
una instantánea de más durante un día es cero, y el de borrar una de menos es un plan
perdido.

## 7. Empezar una sesión sin agujeros

G3 depende de que **ninguna sesión exista sin instantánea**. No hay transacción entre
colecciones, así que el orden y la recuperación son la garantía.

### 7.1 El orden

```
1. generar sessionId
2. resolver y persistir la instantánea      ← se espera al disco
3. persistir la sesión, con snapshotId      ← se espera al disco
4. sólo entonces la sesión acepta series
```

La instantánea va **primero** a propósito. Si el paso 3 falla queda una instantánea
huérfana —basura recuperable— en vez de una sesión sin plan, que sería una violación de G3
irreparable: nadie sabría qué se prescribió aquel día.

Ambos pasos esperan al disco con `persisted()` de T-001. Una sesión no está empezada hasta
que su instantánea está en OPFS.

### 7.2 Recuperación: pre-E3 y corrupción no son lo mismo

«Sesión sin instantánea y con series ⇒ es histórica» es una inferencia que no se sostiene.
Es exactamente lo que también parecería una sesión creada **después** de E3 que perdió su
instantánea — es decir, una violación de G3. Reconstruirla en silencio taparía el fallo con
una deducción plausible.

Así que la migración deja escrito **qué existía**, con un conjunto de ids y no con una
fecha, por la misma razón que la frontera de conocimiento (§3.0):

```ts
export type MigrationRecord = {
  id: "e3"
  migratedAt: number
  /** Las sesiones que había al migrar. Sólo éstas son reconstruibles. */
  preExistingSessionIds: string[]
  /** Los overrides que había, con si su fecha era real o asumida. */
  migratedOverrideIds: string[]
}
```

Con eso, la recuperación al arrancar —idempotente— distingue:

| Situación | Qué se hace |
|---|---|
| Instantánea sin sesión | Provisional. Se recoge sólo bajo §6.4. |
| Sesión **en** `preExistingSessionIds`, sin instantánea | Anterior a E3. Se reconstruye (§6.1). |
| Sesión **fuera** del corte, sin instantánea, con series | **Violación de G3.** Se reporta, se marca, y **no** se reconstruye. |
| Sesión fuera del corte, sin instantánea, sin series | Nunca llegó a empezar. Se descarta. |
| Sesión con `snapshotId` que no resuelve | Se reporta. Nunca se rellena adivinando. |

Una violación se enseña —`SaveStatus` ya tiene el sitio y el tono— porque significa que
algo del arranque de sesión falló, y eso hay que arreglarlo, no maquillarlo.

### 7.3 Adoptar un plan nuevo a mitad

Mismo orden: **persistir la instantánea nueva y esperar**, y sólo entonces apuntar la sesión
a ella. Si falla, la sesión sigue con la anterior — que es lo correcto, porque la anterior
es lo que estabas siguiendo.

## 8. Desviarse no es cambiar el plan

Registrar 22,5 kg donde el plan decía 20 escribe **un `PerformedSet` y nada más**.

No es una precaución, es una distinción de fondo: lo que hiciste y lo que está prescrito son
dos cosas, y confundirlas convertiría cada sesión improvisada en una reescritura silenciosa
del programa. Acabarías con un plan que nadie decidió, hecho de acumular desviaciones.

Un ajuste sólo nace de una acción explícita —«aplicar al plan»— que pide su motivo, porque
`reason` no puede ir vacío.

## 9. Versionado bitemporal

Una versión es una etiqueta sobre **dos** coordenadas, no una:

```ts
export type ProgramVersion = {
  id: string
  label: string      // "v3"
  /** La fecha cuya prescripción nombra. */
  cutAt: IsoDate
  /**
   * Qué conocía esta versión, id por id. Congelado al marcarla.
   *
   * No un instante: dos dispositivos sin red tienen relojes que no coinciden, y
   * una frontera temporal metería o dejaría fuera al ajuste que no toca (§3.0).
   */
  knows: KnowledgeCut
  reason: string
  createdAt: number
}

export function diffVersions(a: ProgramVersion, b: ProgramVersion) {
  const before = resolveWholePlan({ effectiveOn: a.cutAt, knows: a.knows })
  const after  = resolveWholePlan({ effectiveOn: b.cutAt, knows: b.knows })
  return {
    added:    entriesIn(after).filter(notIn(before)),
    removed:  entriesIn(before).filter(notIn(after)),
    replaced: entriesWhoseExerciseChanged(before, after),
    changed:  fieldsThatDiffer(before, after),
    volume:   { before: weeklySets(before), after: weeklySets(after) },
    why:      adjustmentsBetween(a, b),
  }
}
```

**El corte es lo que hace reproducible una versión.** Sin él, una corrección retroactiva
escrita en diciembre cambiaría en silencio lo que v3 —marcada en octubre— dice del plan de
octubre. Con él, v3 sigue significando lo que significaba, y la corrección aparece donde
debe: en la diferencia con v4.

El corte incluye `phaseEventIds`, así que alcanza también a las fases: `resolveWholePlan`
se lo pasa a `phaseForDate`, que resuelve **sólo con esos eventos**. Una corrección de fase
escrita en diciembre tampoco mueve una versión de octubre. Ése es el único cambio que E3
hace al código de E2: `phaseForDate` acepta un conjunto de ids además de la lista completa.

`added` / `removed` / `replaced` son representables porque los ajustes son una unión con
`add_entry`, `remove_entry` y `replace_exercise` — no un `field`/`value` que sólo sabe
tocar campos de lo que ya existe.

El diff **se calcula, no se guarda**: un derivado almacenado es un derivado que un día
contradice a los datos.

## 10. Migración

Seis pasos.

1. **Asignar ids de hueco.** Uno por par plantilla-ejercicio del contenido de E1, con la
   forma `slot_<plantilla>_<nn>`, congelados en el fixture.
2. **Sembrar la base.** Un `PrescriptionBaseline` por hueco. Ids deterministas: re-sembrar
   reconcilia.
3. **Convertir `setsByPhase` en ajustes `origin: "program"`.** Para cada hueco y cada fase
   cuyas series difieran de la fase de menor orden: un `set_field` con
   `onlyInPhase: <fase>`, `effectiveOn` = el `plannedStart` de esa fase, y
   `reason: "Variación de series que el programa traía escrita para esta fase."`
4. **Migrar `ExerciseOverride`.** Cada fila pasa a un ajuste `origin: "manual"`.

   - **Con `updatedAt` fiable:** `effectiveOn` = esa fecha, `provenance.assumedEffectiveOn`
     falso. Es historia conocida.
   - **Sin `updatedAt`:** `effectiveOn` = **la fecha de la migración**, `createdAt` = el
     instante de la migración, `provenance.assumedEffectiveOn` **cierto**.

   Lo segundo es el punto delicado. Ponerle el inicio del programa afirmaría que existía
   entonces, y no lo sabemos: fabricaría historia con la misma pinta que la real. Fecharlo
   en la migración conserva su efecto de hoy en adelante —que es lo que el override hace
   ahora mismo— sin inventar lo de atrás.

   Consecuencia deliberada: las reconstrucciones de sesiones anteriores **no lo incorporan**
   y siguen siendo `partial`, con el hueco anotado. Es la respuesta honesta: aquel día
   quizá estaba y quizá no, y la instantánea lo dice en vez de elegir.
5. **Retirar `slotOf()`.** El puente de E2 muere aquí, que era su fecha de caducidad.
6. **Reconstruir instantáneas** para las sesiones existentes, por §6.1.

Tras el paso 3, resolver en cualquier fecha pasada devuelve exactamente lo que devolvía
`slotOf` + `setsByPhase`. **Se comprueba día a día**, como en E2.

## 11. Rollback

| Capa | Cómo se revierte |
|---|---|
| Código | `git checkout t001`, el último estado bueno anterior a E3. |
| Base, ajustes y versiones | `scripts/rollback-prescription.ts` los vacía. `setsByPhase` sigue intacto en el contenido, así que `slotOf` vuelve a funcionar. |
| Instantáneas `reconstructed` | Se borran. Derivados: regenerables, no ocurrieron. |
| Instantáneas `committed` **referenciadas** | **No se tocan.** Hechos observados; sobreviven al rollback. |
| Instantáneas `committed` **sin referencia** | Se dejan. Puede que su sesión venga por sync (§6.4). |
| `MigrationRecord` | **Se conserva.** Sin él se pierde qué sesiones eran anteriores a E3, y una segunda pasada no sabría cuáles puede reconstruir. |
| Respaldo | El archivo previo a migrar. Lo único que cubre lo imprevisto. |

**El script se niega** si existe algún ajuste con `origin` distinto de `program` que no
provenga de la migración de `ExerciseOverride` — es decir, una decisión tuya. Revertir
borraría algo que nadie más tiene escrito. Los lista y para.

## 12. Pruebas

**Temporalidad — el corazón de E3**
0. **Relojes desalineados:** dos ajustes cuyo `createdAt` contradice el orden real de
   creación resuelven bien, porque la frontera es un conjunto de ids y no un instante.
1. El ejemplo completo de §3.3, sus seis consultas, una a una.
2. Revocar hoy no cambia una fecha anterior a la fecha de efecto de la revocación.
3. Una revocación retroactiva sí cambia esa fecha — y no cambia lo que se veía antes de
   escribirla.
4. `onlyInPhase` creado a mitad de fase no aplica al principio de esa fase.
5. Un ajuste `origin: "program"` aplica al entrar en su fase **tarde**.
5b. Y al entrar **pronto** — el caso que `plannedStart` habría roto.
6. Orden determinista: el mismo conjunto barajado resuelve idéntico.

**Bitemporalidad de versiones**
7. Una corrección escrita después de marcar v3 no cambia lo que v3 resuelve.
8. Lo mismo para una corrección de `PhaseEvent`.
9. El diff entre v3 y v4 sí la muestra.

**Cambios estructurales**
10. `add_entry`, `remove_entry`, `replace_exercise` y `set_field`, cada uno resuelto.
10b. `replace_exercise` **no hereda** carga, señales ni sustituciones del ocupante anterior.
10c. Reemplazar con un `safety` vivo y `safetyResolution: null` se **rechaza**.
10d. Las tres resoluciones —mantener, reformular, revocar— hacen lo que dicen, y ninguna
    traslada la alarma en silencio.
10e. `goal`, `progression` y `order` se pueden cambiar por `set_field`.
10f. Un `revoke` que apunta a otro `revoke` se **rechaza** por esquema.
11. Un hueco que cambia de ejercicio conserva su id y su historial.
12. El diff reporta `added` / `removed` / `replaced` / `changed` por separado.

**G3**
13. Congelar, cambiar el plan, releer: la sesión no se mueve.
14. Revocar el ajuste vigente al congelar: la sesión sigue igual.
15. Vaciar el registro de ajustes: la instantánea sigue renderizando.
16. Sesión empezada y sesión futura, mismo cambio: la primera no cambia, la segunda sí.

**Instantáneas y arranque**
17. Reconstrucción sin `updatedAt` → `partial`, y el override **no** se incorpora.
18. Reconstrucción con `updatedAt` anterior → `complete`, override incorporado.
18b. Un override sin fecha se migra con `effectiveOn` = fecha de migración y
    `assumedEffectiveOn: true` — nunca con el inicio del programa.
19. Instantánea huérfana **no** se borra antes de las 24 h ni sin una sincronización
    posterior; sí después.
19b. Una `committed` referenciada no se puede borrar ni actualizar, nunca.
19c. Una sesión **fuera** del corte de migración y sin instantánea se **reporta** como
    violación de G3, y no se reconstruye.
19d. Una sesión **dentro** del corte sí se reconstruye.
20. Fallo al persistir la sesión tras la instantánea → no queda sesión sin plan.
21. Adoptar a mitad: si falla la persistencia, sigue mandando la anterior.
22. Recuperación idempotente: correrla dos veces no cambia nada.

**Desviación**
23. Estructural: ningún camino desde el registro de series llega a los ajustes.
24. De comportamiento: registrar una serie desviada deja los ajustes intactos.

**Migración**
25. Equivalencia exhaustiva día a día contra `slotOf` + `setsByPhase`.
26. Idempotencia e ida y vuelta.
27. `ExerciseOverride` sin `updatedAt` se migra con la suposición anotada.

**Sin motor**
28. `progression.ts` sin cambios; caracterización de E0 intacta.
29. Estructural: no existen `Rationale`, `Suggestion` ni `analyseTrend`.

**Durabilidad**
30. Las colecciones nuevas están en respaldo, sync y la guarda de escrituras críticas.

## 13. Invariantes

**Temporales**
1. Todo ajuste tiene `effectiveOn`.
2. Una revocación sólo mira hacia delante desde su `effectiveOn`.
3. Toda consulta cita `(effectiveOn, conocimiento)`; sin corte, usa todo lo presente.
4. Una versión resuelve **sólo** con los ids de su corte; ningún reloj interviene.
5. `onlyInPhase` nunca es retroactivo.

**De identidad**
6. El id de un hueco no se deriva de su ocupante y no cambia nunca.
7. Cambiar el ejercicio de un hueco conserva su id.
8. Los ids de hueco sólo crecen.

**De inmutabilidad**
9. Una sesión con instantánea no re-resuelve.
10. La instantánea es autocontenida.
11. Una `committed` referenciada por una sesión nunca se actualiza ni se borra.
12. Una reconstruida siempre va marcada, con su confianza y sus huecos.
12b. Una instantánea sin sesión sólo se recoge tras 24 h y una sincronización posterior.
12c. Una sesión fuera del corte de migración nunca se reconstruye.
13. Ajustes, instantáneas y versiones sólo crecen.
14. La base no se reescribe.

**De resolución**
15. La precedencia es total y determinista.
16. `safety` sólo se retira revocándolo, y reemplazar el ejercicio de un hueco con una
    alarma viva exige resolverla explícitamente.
16b. `replace_exercise` no hereda nada del ocupante anterior salvo el `entryId`.
16c. Un `revoke` nunca apunta a otro `revoke`.
16d. Todo ajuste lleva `provenance`, y lo migrado dice si su fecha es asumida.
17. Toda fecha resuelve a exactamente una prescripción por hueco.
18. El diff se calcula, nunca se almacena.

**De alcance**
19. Registrar una serie no crea nunca un ajuste.
20. Ninguna sesión existe sin instantánea.
21. E3 no emite sugerencias.

## 14. Archivos

**Dominio**

| Archivo | Qué |
|---|---|
| `src/domain/prescription.ts` | **nuevo** · `resolvePrescription`, pliegue, precedencia |
| `src/domain/adjustments.ts` | **nuevo** · vigencia bitemporal, orden |
| `src/domain/versions.ts` | **nuevo** · `diffVersions`, `resolveWholePlan` |
| `src/domain/snapshot.ts` | **nuevo** · congelar, leer, reconstruir |
| `src/domain/schema.ts` | las cuatro entidades, con `FieldChange` como unión discriminada |
| `src/domain/phase-events.ts` | `phaseForDate` acepta un `KnowledgeCut` — único cambio a E2 |
| `src/domain/phases.ts` | **retirar `slotOf`** |
| `src/domain/personalise.ts` | leer la prescripción resuelta |
| `__fixtures__/prescription-entry-ids.ts` | **nuevo** · ids congelados |
| pruebas | `prescription`, `adjustments`, `versions`, `snapshot` |

**Persistencia**

| Archivo | Qué |
|---|---|
| `src/db/collections.ts` | cuatro colecciones nuevas, append-only y `durable` |
| `src/db/records.ts` | exponerlas |
| `src/lib/migrate-prescription.ts` | **nuevo** · los seis pasos de §10 |
| `src/lib/recover-snapshots.ts` | **nuevo** · §7.2 |
| `src/lib/backup.ts` · `api/sync.ts` | añadirlas |
| `scripts/rollback-prescription.ts` | **nuevo** |

**Interfaz**

`routes/index.tsx` (congelar al empezar con el orden de §7.1, leer de la instantánea),
`history.tsx` (leer de la instantánea), pantalla mínima de plan para ajustes y versiones.
`ExerciseSettings` escribe `PlanAdjustment` en vez de `ExerciseOverride`.

## 15. Criterios de aceptación

| # | Criterio | Cómo se comprueba |
|---|---|---|
| 1 | **G3**: una sesión con instantánea no cambia | Pruebas 13–16 |
| 2 | **G3**: ninguna sesión existe sin instantánea | Pruebas 19–22 |
| 3 | **G4**: sin motor | Pruebas 28–29 |
| 4 | Revocar no reescribe el pasado | Pruebas 2–3 |
| 5 | Una versión marcada es reproducible | Pruebas 7–8 |
| 6 | El id de un hueco sobrevive al cambio de ejercicio | Prueba 11 |
| 7 | Los cuatro cambios estructurales se representan | Pruebas 10, 12 |
| 8 | Ninguna reconstrucción inventa un override | Pruebas 17–18 |
| 9 | Registrar una serie no toca el plan | Pruebas 23–24 |
| 10 | Equivalencia exhaustiva con `slotOf` | Prueba 25 |
| 11 | Rollback conserva las instantáneas reales | Prueba dedicada |
| 12 | `slotOf` eliminado | `git grep slotOf` vacío |
| 13 | Caracterización de E0 intacta | `git diff` |
| 14 | Los cinco comandos en verde | — |
| 15 | Smoke test en origen aislado | Sesión completa |
| 16 | Respaldo real previo | Tuyo |

---

## Riesgos

1. **La bitemporalidad es fácil de implementar mal.** Dos ejes, cinco orígenes y tres
   criterios de precedencia dan muchas combinaciones; de ahí que §12 empiece por las seis
   consultas del ejemplo antes que por nada más.
2. **Es la etapa que más superficie toca.** Cuatro colecciones, la retirada de `slotOf`, y
   el ejecutor leyendo de otra fuente. Más que E1 y E2 juntas.
3. **Las reconstrucciones son deducciones.** Van marcadas y con sus huecos anotados, pero
   para las sesiones anteriores a E3 «lo que tenías prescrito» es lo mejor deducible, no
   lo que se congeló.
4. **`ExerciseOverride` se retira con datos dentro**, y parte de esos datos no tiene fecha.

## Lo que queda por revisar

1. **§6.4** — que una instantánea huérfana espere 24 h y una sincronización antes de
   recogerse. Es el único número arbitrario del documento; si prefieres otro, se cambia.
2. **§7.2** — que una sesión posterior a E3 sin instantánea se reporte como violación en
   vez de reconstruirse. Significa ver un aviso en lugar de un plan deducido.
3. **§2.3** — que reemplazar un ejercicio con una alarma viva obligue a decidir qué pasa
   con ella, aunque sean dos toques más en el gimnasio.
