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
    /** El hueco pasa a ocuparlo otro ejercicio. El hueco sigue siendo el mismo. */
    | {
        kind: "replace_exercise"
        entryId: PrescriptionEntryId
        exerciseId: CanonicalId
      }
    /** Un hueco nuevo, con su estado inicial completo. */
    | { kind: "add_entry"; entry: PrescriptionEntry }
    /** El hueco deja de programarse. No se borra: deja de resolver. */
    | { kind: "remove_entry"; entryId: PrescriptionEntryId }
    /**
     * Aquel ajuste deja de aplicar **a partir de `effectiveOn`**. No lo borra de
     * las fechas en las que sí estuvo vigente. Ver §3.
     */
    | { kind: "revoke"; revokesId: string }
  )
```

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

| Eje | Campo | Pregunta que responde |
|---|---|---|
| **Tiempo de validez** | `effectiveOn` | ¿Qué prescripción regía **el día X**? |
| **Tiempo de transacción** | `createdAt` | ¿Qué sabíamos **cuando lo miramos**? |

### 3.1 Definición

> Un ajuste `A` está **en vigor** en `(effectiveOn = d, knownAt = k)` si y sólo si:
>
> 1. `A.createdAt <= k` — ya existía cuando miramos;
> 2. `A.effectiveOn <= d` — ya había entrado en vigor ese día;
> 3. si `A.onlyInPhase` no es nulo, la fase resuelta para `d` es esa;
> 4. **no** existe una revocación `R` con `R.revokesId === A.id`,
>    `R.createdAt <= k` **y** `R.effectiveOn <= d`.

La condición 4 es la que arregla el error: una revocación tiene su propia fecha de efecto,
así que retira el ajuste **desde ahí hacia delante** y lo deja intacto antes.

### 3.2 `onlyInPhase` no es retroactivo

Un ajuste con alcance de fase creado a mitad de esa fase aplica desde su `effectiveOn`, no
desde que la fase empezó. Las dos condiciones se cumplen a la vez: hay que estar en la fase
**y** haber pasado la fecha de efecto.

Es lo que permite decir «a partir del jueves, tres series mientras siga en recomposición»
sin reescribir el lunes.

### 3.3 Un ejemplo completo

Una entrada, campo `sets`, base 2.

| # | Evento | `effectiveOn` | `createdAt` |
|---|---|---|---|
| A1 | `set_field sets = 3` | 5 oct | 5 oct |
| R1 | `revoke A1` | 1 nov | 1 nov |
| A2 | `set_field sets = 2` | 1 nov | 1 nov |
| R2 | `revoke A1` | **20 oct** | **1 dic** |

Resolución en varias consultas:

| `effectiveOn` | `knownAt` | Series | Por qué |
|---|---|---|---|
| 1 oct | hoy | **2** | A1 aún no había entrado en vigor |
| 10 oct | hoy | **3** | A1 vigente; R1 no ha llegado; R2 no ha llegado |
| 10 oct | 15 oct | **3** | Sólo existía A1 |
| **25 oct** | **30 nov** | **3** | R2 aún no se había escrito |
| **25 oct** | **hoy** | **2** | R2 existe y su efecto empieza el 20 oct |
| 15 nov | hoy | **2** | A2 vigente |

Las dos filas resaltadas son el punto: **la misma fecha da respuestas distintas según
cuándo preguntes**, y las dos son correctas. Una corrección retroactiva escrita en
diciembre cambia lo que hoy creemos del 25 de octubre, y **no** cambia lo que creíamos en
noviembre — que es lo que hace reproducible una versión marcada entonces.

## 4. Resolución

```ts
export type AsOf = {
  /** La fecha cuya prescripción se consulta. */
  effectiveOn: IsoDate
  /** Qué se sabía en ese instante. Por defecto, ahora. */
  knownAt?: number
}

export function resolvePrescription(
  baseline: readonly PrescriptionBaseline[],
  adjustments: readonly PlanAdjustment[],
  phaseAt: (date: IsoDate, knownAt?: number) => Phase,
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
octubre resolvía, así que `phaseForDate` gana un `knownAt` opcional que filtra los eventos
por `createdAt`. Es el único cambio que E3 hace en el código de E2.

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
   * Falso: se congeló al empezar la sesión. Hecho observado, inmutable, y el
   * rollback no lo toca.
   *
   * Cierto: se dedujo después para una sesión anterior a E3. Artefacto derivado —
   * se puede regenerar, y el rollback puede borrarlo sin perder nada ocurrido.
   */
  reconstructed: boolean
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

### 7.2 Recuperación, idempotente y al arrancar

| Situación | Qué se hace |
|---|---|
| Instantánea sin sesión | Huérfana del paso 3. Se descarta. |
| Sesión con `snapshotId` que no resuelve | No debería ocurrir. Se reporta y se marca para reconstrucción. |
| Sesión sin `snapshotId`, con series | Anterior a E3. Se reconstruye (§6.1). |
| Sesión sin `snapshotId`, sin series | Nunca llegó a empezar. Se descarta. |

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
  /** Qué se sabía al marcarla. Congelado aquí para que sea reproducible. */
  knownAt: number
  reason: string
  createdAt: number
}

export function diffVersions(a: ProgramVersion, b: ProgramVersion) {
  const before = resolveWholePlan({ effectiveOn: a.cutAt, knownAt: a.knownAt })
  const after  = resolveWholePlan({ effectiveOn: b.cutAt, knownAt: b.knownAt })
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

**`knownAt` es lo que hace reproducible una versión.** Sin él, una corrección retroactiva
escrita en diciembre cambiaría en silencio lo que v3 —marcada en octubre— dice del plan de
octubre. Con él, v3 sigue significando lo que significaba cuando la marcaste, y la
corrección aparece donde debe: en la diferencia con v4.

El `knownAt` alcanza también a las fases: `resolveWholePlan` se lo pasa a `phaseForDate`,
que filtra los `PhaseEvent` por `createdAt`. Una corrección de fase escrita en diciembre
tampoco mueve una versión de octubre.

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
4. **Migrar `ExerciseOverride`.** Cada fila pasa a un ajuste `origin: "manual"`. El
   `effectiveOn` sale de su `updatedAt` cuando lo tiene; cuando no, del inicio del programa
   — **y eso se anota**, porque es una suposición y las suposiciones se marcan.
5. **Retirar `slotOf()`.** El puente de E2 muere aquí, que era su fecha de caducidad.
6. **Reconstruir instantáneas** para las sesiones existentes, por §6.1.

Tras el paso 3, resolver en cualquier fecha pasada devuelve exactamente lo que devolvía
`slotOf` + `setsByPhase`. **Se comprueba día a día**, como en E2.

## 11. Rollback

| Capa | Cómo se revierte |
|---|---|
| Código | `git checkout t001`, el último estado bueno anterior a E3. |
| Base, ajustes y versiones | `scripts/rollback-prescription.ts` los vacía. `setsByPhase` sigue intacto en el contenido, así que `slotOf` vuelve a funcionar. |
| Instantáneas **reconstruidas** | Se borran. Son derivados: regenerables, no ocurrieron. |
| Instantáneas **reales** | **No se tocan.** Son hechos observados y sobreviven al rollback. |
| Respaldo | El archivo previo a migrar. Lo único que cubre lo imprevisto. |

**El script se niega** si existe algún ajuste con `origin` distinto de `program` que no
provenga de la migración de `ExerciseOverride` — es decir, una decisión tuya. Revertir
borraría algo que nadie más tiene escrito. Los lista y para.

## 12. Pruebas

**Temporalidad — el corazón de E3**
1. El ejemplo completo de §3.3, sus seis consultas, una a una.
2. Revocar hoy no cambia una fecha anterior a la fecha de efecto de la revocación.
3. Una revocación retroactiva sí cambia esa fecha — y no cambia lo que se veía antes de
   escribirla.
4. `onlyInPhase` creado a mitad de fase no aplica al principio de esa fase.
5. `onlyInPhase` sigue la fase **real** de E2: entrar tarde retrasa su efecto.
6. Orden determinista: el mismo conjunto barajado resuelve idéntico.

**Bitemporalidad de versiones**
7. Una corrección escrita después de marcar v3 no cambia lo que v3 resuelve.
8. Lo mismo para una corrección de `PhaseEvent`.
9. El diff entre v3 y v4 sí la muestra.

**Cambios estructurales**
10. `add_entry`, `remove_entry`, `replace_exercise` y `set_field`, cada uno resuelto.
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
19. Instantánea huérfana → se descarta al arrancar.
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
3. Toda consulta cita `(effectiveOn, knownAt)`; `knownAt` por defecto es ahora.
4. Un ajuste creado después de `knownAt` no influye en esa consulta.
5. `onlyInPhase` nunca es retroactivo.

**De identidad**
6. El id de un hueco no se deriva de su ocupante y no cambia nunca.
7. Cambiar el ejercicio de un hueco conserva su id.
8. Los ids de hueco sólo crecen.

**De inmutabilidad**
9. Una sesión con instantánea no re-resuelve.
10. La instantánea es autocontenida.
11. Una instantánea real nunca se borra ni se regenera.
12. Una reconstruida siempre va marcada, con su confianza.
13. Ajustes, instantáneas y versiones sólo crecen.
14. La base no se reescribe.

**De resolución**
15. La precedencia es total y determinista.
16. `safety` sólo se retira revocándolo.
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
| `src/domain/phase-events.ts` | `phaseForDate` acepta `knownAt` — único cambio a E2 |
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

1. **§3.3** — el ejemplo de las seis consultas. Si esa tabla es lo que esperas, la
   semántica temporal está bien; si no, es aquí donde hay que discutirlo.
2. **§6.1** — dejar fuera un override sin fecha y marcar `partial`, en vez de incorporarlo.
3. **§7.1** — instantánea antes que sesión, y por qué ese orden y no el contrario.
4. **§10 paso 4** — `ExerciseOverride` sin `updatedAt` se migra con `effectiveOn` = inicio
   del programa y la suposición anotada.
