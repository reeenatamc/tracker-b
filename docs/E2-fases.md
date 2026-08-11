# E2 · Fases abiertas y dinámicas

Especificación para revisión. **Nada de esto está implementado.**

Contexto en [`arquitectura.md`](./arquitectura.md) §2.1. Etapa anterior cerrada en
[`E1-biblioteca.md`](./E1-biblioteca.md), etiqueta `e1`.

> **Versión pública.** Los ids y fechas de fase de los ejemplos son genéricos
> (`fase_a`, `semana 6`). Los reales viven en `content/`, que es privado.

---

## Lo que E2 resuelve, y lo que deliberadamente no

E2 hace dos cosas y sólo dos:

1. **Abre el tipo de la fase.** Hoy `PhaseId` es la unión cerrada `1|2|3|4` en 38 sitios,
   así que una quinta fase no cabe sin recompilar.
2. **Separa la fase planificada de la fase real.** Hoy la fase de una fecha se deduce de un
   rango de fechas escrito en el YAML. Si te retrasas dos semanas en salir de una fase, el
   calendario dice que ya saliste. Pasa a decidirse por un registro de transiciones que
   sólo crece.

**E2 no toca prescripción.** Ni series, ni RIR, ni volumen, ni ejercicios, ni cardio. Una
fase sigue *llevando* esos campos exactamente como hoy y se siguen leyendo exactamente
igual. Lo que cambia es **cómo se decide en qué fase estás**, no qué implica estarlo. La
prescripción versionada es E3.

---

## Las dos garantías

### G1 · Ninguna sesión histórica cambia de fase

> **Ninguna transición modifica nunca el `phase` almacenado de una sesión existente.**
> Una corrección puede producir discrepancia entre el valor almacenado y el derivado;
> reestampar requiere una acción explícita e independiente.

No se consigue con cuidado sino con estructura, por dos mecanismos independientes:

**Primero: la fase de una sesión ya está guardada en la sesión.** `SessionRecord.phase` se
estampa al crearla y nunca se ha vuelto a calcular. E2 la reetiqueta (`2` →
`"fase_b"`) y nada más. Una sesión completada **nunca** consulta el registro de
transiciones: su fase es un hecho registrado, no un cálculo.

**Segundo: aunque se calculara, daría lo mismo.** La migración siembra transiciones a
partir de las fechas planificadas actuales, así que `phaseForDate` devuelve la misma fase
que hoy para toda fecha. Y eso se comprueba de forma exhaustiva: una prueba recorre día a
día desde el inicio del programa hasta dos años después y exige que la fase nueva coincida
con la que devolvía la implementación vieja. No una muestra: todos los días.

Redactada así, la garantía no admite excepciones: **no hay ningún camino por el que una
transición escriba en una sesión.** Lo que sí puede pasar es que, tras corregir una
transición, el valor almacenado y el derivado dejen de coincidir. Eso no es una violación:
es una discrepancia observable, consultable (§10) y que sólo se resuelve si tú decides
reestamparla, sesión a sesión.

### G2 · E2 no introduce lógica de prescripción

Comprobable por diff: `progression.ts`, `library.ts`, `muscles.ts`, `safety.ts` y
`personalise.ts` no cambian de comportamiento, los valores de `setsByPhase` no cambian ni
un byte, y las pruebas de caracterización de E0 siguen pasando **sin tocarlas**.

Los criterios de entrada y salida de fase (§1) se guardan como **texto descriptivo**, no
como reglas evaluables. E2 los registra; evaluarlos es E6.

---

## 1. `Phase`

```ts
export type Phase = {
  /** Abierto. Una fase nueva es una fila más, no una recompilación. */
  id: string
  name: string
  /** Orden previsto. NO determina en qué fase estás: eso lo dicen las transiciones. */
  order: number

  /** Previsión, no verdad. Puede quedar en el pasado sin que pase nada. */
  plannedStart: IsoDate | null
  plannedEnd: IsoDate | null

  /**
   * Qué hacer con `plannedStart` cuando la fase anterior se alarga.
   *
   * `rolling`  — se desplaza. Es lo normal: una fase de progresión empieza
   *              cuando termina la anterior, no en una fecha del calendario.
   * `anchored` — no se mueve, porque responde a algo externo y fijo: un viaje,
   *              una fecha de entrega. Si te retrasas, lo que se comprime es lo
   *              que hay antes, no esta fase.
   */
  schedulePolicy: SchedulePolicy

  /** Qué debería cumplirse para entrar y salir. Texto, no reglas: E6 las evalúa. */
  entryCriteria: Criterion[]
  exitCriteria: Criterion[]

  /**
   * El id numérico que esta fase tenía antes de E2. Sólo lo usa la migración,
   * una vez. `null` en cualquier fase creada después.
   */
  legacyId: 1 | 2 | 3 | 4 | null

  /**
   * De dónde hereda lo que no diga por sí misma: columna de `setsByPhase`,
   * prescripción de cardio. Es lo que permite crear una fase nueva sin tocar
   * código, y desaparece en E3 cuando la prescripción deja de ir por fase.
   */
  inheritsFrom: string | null

  /**
   * Ya no se programa, pero sigue existiendo. Borrarla dejaría huérfanas las
   * sesiones que la llevan estampada; retirarla las deja legibles para siempre.
   */
  retired: boolean

  // ── sin cambios respecto a hoy ──────────────────────────────────────────
  goal: string
  workingSets: SetCount
  targetRir: Range
  weeklyCardioMinutes: Range
  coreWeeklySets: string
  ankleStage: string
  progresses: string
  avoid: string
}

export type SchedulePolicy = "rolling" | "anchored"

export type Criterion = {
  id: string
  text: string
  /** La medición con la que se juzgaría, cuando exista. E6. */
  metric: string | null
  evidenceId: string | null
}
```

`startDate` → `plannedStart` y `endDate` → `plannedEnd` es un renombrado deliberado: con el
nombre viejo es demasiado fácil volver a tratar la previsión como un hecho, que es
precisamente el defecto que E2 corrige.

Las cuatro fases actuales son `rolling`: su sitio en el calendario depende de cómo vaya el
entrenamiento. Una fase futura atada a una fecha externa sería `anchored`. Una fase
`anchored` **debe** tener `plannedStart` — sin él la política no significa nada, y eso es
invariante, no convención.

### 1.1 El id de una fase es canónico e inmutable

La misma regla que ya gobierna los ejercicios, por la misma razón. En cuanto un id de fase
aparece en una sesión o en un evento, pasa a ser una clave del historial:

- **no se renombra** — el historial dejaría de resolver;
- **no se reutiliza** — dos periodos distintos quedarían fundidos en uno, que es peor que
  perderlos, porque nada delata la fusión;
- **no se elimina en silencio** — una fase que ya no se programa se marca
  `retired: true` y se queda; borrarla dejaría sesiones apuntando al vacío.

El **nombre visible sí puede cambiar** cuando quieras. Es presentación, no identidad —
exactamente como `ExerciseDef.name` frente a `ExerciseDef.id`.

Se sostiene con dos pruebas, calcadas de las que ya protegen los ids de ejercicio:

1. **Todo id de fase presente en datos guardados existe en el programa.** Atrapa el borrado
   y el renombrado.
2. **Un fixture congelado, `KNOWN_PHASE_IDS`, que sólo crece.** El programa debe seguir
   conteniendo todos los ids que han existido alguna vez. Es lo que atrapa un renombrado
   hecho *antes* de que existan datos que lo delaten.

Y una de forma: los ids cumplen `^[a-z][a-z0-9_]*$`, para que no se cuele un id derivado de
un nombre visible — que es exactamente como los ejercicios acabaron con ids frágiles.

## 2. El registro de transiciones

Un evento, tres formas. Unión discriminada y no un objeto con campos opcionales, porque
así **una revocación no puede llevar destino** — es imposible escribir «anulo la
transición X y de paso muevo a la fase C», que es una frase sin sentido que un tipo
permisivo dejaría pasar.

```ts
export type PhaseEvent =
  /** Cambiaste de fase. */
  | {
      kind: "transition"
      id: string
      /** `null` sólo en la primera: el arranque del programa. */
      fromPhaseId: string | null
      toPhaseId: string
      /** El día desde el que la fase nueva está vigente. Inclusive. */
      occurredOn: IsoDate
      /** Qué decía el plan. `null` si no había fecha prevista. */
      plannedFor: IsoDate | null
      trigger: PhaseTrigger
      reason: string
      reviewId: string | null
      createdAt: number
    }
  /** Aquella transición fue mal registrada; esta la sustituye entera. */
  | {
      kind: "correction"
      id: string
      supersedesId: string
      fromPhaseId: string | null
      toPhaseId: string
      occurredOn: IsoDate
      plannedFor: IsoDate | null
      trigger: PhaseTrigger
      reason: string
      reviewId: string | null
      createdAt: number
    }
  /** Aquel evento no ocurrió. No pone nada en su lugar. */
  | {
      kind: "revocation"
      id: string
      revokesId: string
      reason: string
      createdAt: number
    }

export type PhaseTrigger =
  | "planned" | "criteria-met" | "review" | "manual" | "safety"
```

Vive en la base de datos, no en el YAML: es un registro de lo que pasó, no de lo que se
planeó. Colección nueva `phaseEvents`.

**Append-only de verdad, no por convención.** `syncable()` da a toda colección `updatedAt`
y `deletedAt`, y con eso bastaría para editar o tombstonear un evento sin que nada
protestara. Así que la colección se envuelve además en `appendOnly()`, que deja pasar
`insert` y **lanza en `update` y en `delete`**, con un mensaje que dice qué hacer en su
lugar:

```ts
export function appendOnly<C extends object>(collection: C): C
// insert  → se estampa y se escribe, como siempre
// update  → throw "Los eventos de fase no se editan: añade una corrección"
// delete  → throw "Los eventos de fase no se borran: añade una revocación"
```

Las únicas formas de alterar el efecto de un evento son un `correction` o un `revocation`
nuevos. Y como en el resto de la app, el cliente de sincronización escribe por `raw`, que
no pasa por la envoltura: los eventos que llegan de otro dispositivo se aplican verbatim,
que es lo correcto — ya nacieron allí.

`updatedAt` y `deletedAt` siguen existiendo porque la sincronización los necesita para
ordenar y para no resucitar filas, pero **ningún camino de la app los mueve**.

Un evento apunta como mucho a otro: `correction` a uno, `revocation` a uno, `transition` a
ninguno. Eso hace del grafo de anulaciones una función parcial, y es lo que permite definir
las cadenas de §2.2 sin ambigüedad.

### 2.1 Diferencia con `PlanAdjustment`

Un ajuste de plan es un **estado que dura**, así que revocarlo tiene su propia fecha de
efecto: «desde el 1 de noviembre, este ajuste deja de aplicar».

Un evento de fase es un **punto**. No tiene sentido decir «desde el 1 de noviembre deja de
ser cierto que cambié de fase el 5 de octubre» — o cambiaste ese día, o cambiaste otro, o
no cambiaste. Por eso aquí anular es **total**: el evento referenciado desaparece de la
resolución por completo, no a partir de una fecha.

Esa diferencia es la que hace que corregir un evento pueda mover la fase de fechas pasadas
— y por eso G1 se apoya en la fase *guardada* de cada sesión y no en la calculada.

### 2.2 Cadenas de corrección y revocación

Esta es la parte que no puede quedar como consecuencia accidental del algoritmo.

**Regla:** un evento está **vivo** si ningún evento **vivo** lo referencia.

Es una definición recursiva, y su punto fijo se calcula recorriendo cada cadena desde su
extremo más nuevo: el último de la cadena está vivo, el que él anula está muerto, el que
*ese* anulaba vuelve a estar vivo, y así alternando.

El caso que preguntabas, resuelto:

| Evento | Referencia | ¿Vivo? | Por qué |
|---|---|---|---|
| A `transition` | — | **sí** | B, que la anulaba, está muerto |
| B `correction` supersedes A | A | no | C, viva, la revoca |
| C `revocation` revokes B | B | **sí** | nadie la referencia |

**A vuelve a estar activa.** Revocar la corrección más reciente restaura el estado previo,
que es la semántica que pediste, y ahora es la definición, no un efecto lateral.

Con la cadena más larga funciona igual, como una pila de deshacer:

| Cadena | Vivos | Transición efectiva |
|---|---|---|
| A | A | A |
| A ← B | B | B |
| A ← B ← C *(revoca B)* | A, C | A |
| A ← B ← C ← D *(revoca C)* | B, D | B |

Las revocaciones nunca aportan transición propia: el tipo no les da destino.

**Dos casos degenerados, definidos y no dejados al azar:**

- **Ciclo** (A anula a B y B anula a A): imposible de resolver. La validación lo reporta y
  la resolución trata **todo el ciclo como muerto**. Determinista y seguro: perder una
  transición corrupta es mejor que colgar la app o elegir una arbitrariamente.
- **Dos eventos vivos anulando al mismo objetivo**: la validación lo reporta como error de
  integridad. La resolución conserva el más nuevo según el orden determinista de §5 y
  descarta el otro, para que dos dispositivos lleguen a la misma respuesta.

---

## 3. Cómo se sustituye `PhaseId = 1|2|3|4`

`PhaseId` pasa a ser `string`. El problema no es el tipo sino un sitio concreto:

```ts
setsByPhase: { 1: SetCount, 2: SetCount, 3: SetCount, 4: SetCount }
```

La prescripción está indexada por el id numérico. Reescribirla a claves de texto tocaría
contenido, fixtures, componentes y pruebas — y sobre todo tocaría **prescripción**, que es
justo lo que G2 prohíbe en esta etapa.

**Propuesta: `setsByPhase` no se toca.** Se lee a través de una ranura resuelta desde los
datos de la fase:

```ts
/** Qué columna de `setsByPhase` le corresponde a una fase. */
export function slotOf(program: Program, phase: Phase): 1 | 2 | 3 | 4 {
  if (phase.legacyId !== null) return phase.legacyId
  if (phase.inheritsFrom) return slotOf(program, phaseById(program, phase.inheritsFrom))
  throw new Error(`La fase ${phase.id} no dice de dónde saca su prescripción`)
}
```

Las cuatro fases actuales tienen `legacyId`, así que devuelven lo mismo que hoy. Una fase
nueva declara `inheritsFrom` y hereda. Ninguna línea de `setsByPhase` cambia.

Es explícitamente **provisional**: E3 sustituye `setsByPhase` por `PrescriptionBaseline` +
ajustes, y `slotOf` desaparece con ella. Queda anotado en el código como tal.

**Coste:** las firmas que hoy reciben `phase: PhaseId` pasan a recibir `phase: Phase`,
porque necesitan la ranura. Eso alcanza a dos componentes. A diferencia de E1, **E2 sí
toca `routes/` y `components/`**, y conviene decirlo desde el principio.

**Alternativa descartada:** reescribir `setsByPhase` a claves de texto. Más limpio de leer
y más cerca de E3, pero mueve prescripción en una etapa que ha prometido no moverla, y
convierte una migración de tipos en una migración de contenido. Si la prefieres, se puede
— pero entonces G2 hay que reescribirla.

---

## 4. Migración de los registros ya guardados

Sólo un campo almacenado cambia: `SessionRecord.phase`, de número a texto.

```ts
// src/lib/migrate-phase-ids.ts — mismo patrón que migrate-exercise-ids.ts
export function migratePhaseIds(collections, program): PhaseMigrationReport
```

Reglas, calcadas de la migración de ids de ejercicio porque ya demostró funcionar:

- **Dirigida por datos, no por constantes.** El número guardado se traduce buscando la
  fase cuyo `legacyId` coincide. Sin tabla de slugs escrita a mano.
- **Idempotente.** Un valor que ya es texto se salta. Puede correr en cada arranque.
- **Escribe a través de `raw`.** Sin re-estampar `updatedAt`: es una corrección, no una
  edición tuya, y re-estamparla haría que la otra máquina la viera como cambio nuevo.
- **Lo no mapeable se reporta, nunca se adivina.** Un `phase` que no case con ningún
  `legacyId` se deja intacto y sale en el informe. Adivinar movería una sesión de fase en
  silencio, que es exactamente lo que G1 prohíbe.

Además, **siembra las transiciones** que corresponden al plan actual, con ids
deterministas para que re-sembrar reconcilie en vez de duplicar:

```
seed-transition-<phaseId>   fromPhaseId: la anterior por `order`
                            toPhaseId:   la fase
                            occurredOn:  su plannedStart
                            plannedFor:  su plannedStart   (drift = 0)
                            trigger:     "planned"
                            reason:      "Sembrada desde el plan original en la migración a E2"
```

Con eso, la fase calculada de cualquier fecha pasada coincide exactamente con la que
devolvía el código viejo.

---

### 4.1 Migración y sincronización: nunca una base mixta

El caso incómodo: este dispositivo ya migró; el sync se trae del servidor una
`SessionRecord` antigua con `phase: 2`. Sin defensa, la base queda mitad texto mitad
número, y todo lo que lea fases empieza a dar respuestas según de qué dispositivo vino cada
fila.

**Tres capas, y las tres se prueban.**

**1 · Normalización en la entrada.** `lib/sync-client.ts` pasa cada lote recibido por
`normalizeIncoming()` **antes** de escribirlo. Traduce cualquier `phase` numérica con el
mismo mapa dirigido por datos que la migración. Es la defensa principal: lo mixto no llega
a existir.

```ts
export function normalizeIncoming(
  program: Program,
  rows: readonly unknown[],
): { rows: unknown[]; normalized: number; unmapped: string[] }
```

**2 · Comprobación después del pull.** Terminada la sincronización se verifica que ninguna
sesión almacenada tenga `phase` numérica. Si aparece alguna —porque la normalización tuviera
un hueco— se migra y se reporta. Barato, y convierte un fallo silencioso en una línea de
registro.

**3 · La migración es idempotente y corre en cada arranque.** Ya lo es. Es la red por
debajo de las otras dos.

**El sentido contrario no se resuelve con optimismo.** Un dispositivo migrado empujando
`phase: "fase_b"` a uno que todavía no migró es exactamente el caso en el que no conviene
suponer que «probablemente aguante». Que los registros guardados no pasen por Zod hoy es un
detalle de implementación, no una promesa, y apoyarse en él sería escribir en una base de
datos datos que esa versión no sabe leer.

**Versión de esquema en el protocolo.** El intercambio pasa a llevar la versión de los
datos, y un cliente que no la entienda **no sincroniza** — ni sube ni baja:

```ts
export const SYNC_SCHEMA_VERSION = 2   // 1 = pre-E2, fases numéricas

export type VersionVerdict =
  | { ok: true }
  /** El servidor tiene datos más nuevos de los que este cliente sabe leer. */
  | { ok: false; reason: "client-outdated"; required: number }
  /** El cliente trae datos más nuevos: el servidor sube su versión. */
  | { ok: false; reason: "server-outdated"; clientVersion: number }

export function checkSchemaVersion(client: number, server: number): VersionVerdict
```

Es una función pura en `domain/sync.ts`, igual que `composeReminder` en `api/`: la usan el
endpoint y el cliente, y se prueba sin base de datos ni red.

| Situación | Qué pasa |
|---|---|
| Cliente 1, servidor 1 | Sincroniza. Nada ha migrado todavía |
| Cliente 2, servidor 1 | Sincroniza y **sube** el servidor a 2 |
| **Cliente 1, servidor 2** | **Rechazado.** El endpoint responde 409 y no escribe nada |
| Cliente 2, servidor 2 | Sincroniza |

Un cliente sin versión cuenta como 1, que es lo que hace un cliente de E1. Y del lado de la
app, el rechazo no es un error genérico: `SyncStatus` dice **«Actualiza este dispositivo
para sincronizar»**, porque eso es lo que hay que hacer.

Vale la pena decir en voz alta lo que se está eligiendo: **un dispositivo que se queda sin
sincronizar unos días es un inconveniente; una base con registros que esa versión no
entiende es un historial dañado.** El registro local sigue funcionando entero mientras
tanto — la app nunca ha necesitado la red para entrenar.

## 5. La fase efectiva de una fecha

```ts
export function phaseForDate(
  program: Program,
  events: readonly PhaseEvent[],
  date: IsoDate,
): Phase
```

1. **Calcular los vivos** por la regla de §2.2, con guardia de ciclos.
2. **Quedarse con los de tipo `transition` y `correction`.** Las revocaciones no aportan
   destino.
3. **Descartar los que apunten a una fase inexistente.** `validateEvents()` los reporta como
   `unknown-phase`; la resolución simplemente sigue con el último evento válido anterior.
4. **Ordenar** por el orden determinista de abajo.
5. **Tomar el último** con `occurredOn <= date`. Su `toPhaseId` es la fase efectiva.
6. **Si no queda ninguno**, la fase de menor `order`. Es el mismo pinzamiento de hoy, que
   existe porque la sesión base es anterior al inicio del programa.

### 5.2 Por qué «no lanza nunca» es verdad

No basta con decirlo: cada camino que podría lanzar tiene su salida definida.

| Daño en el log | Qué hace la resolución |
|---|---|
| Evento vivo hacia una fase inexistente | Lo salta; sigue con el último válido |
| Todos los eventos rotos | Cae en la fase de menor `order` |
| Ciclo de anulaciones | Todo el ciclo muerto; sigue con el resto |
| Dos anulaciones vivas del mismo objetivo | Gana la más nueva por orden determinista |
| Sin eventos | Fase de menor `order` |
| Ciclo de `inheritsFrom` | Sólo afecta a `slotOf`, que sí falla ruidosamente — pero eso es prescripción, no fase |

El último escalón depende de que exista al menos una fase. **Eso es invariante**, y ya lo
impone el esquema: `Program.phases` es `.min(1)`. Con eso, `phaseForDate` es total de
verdad, no total de palabra — porque al gimnasio no se va a depurar un log.

### 5.1 Orden determinista

```
occurredOn  →  createdAt  →  id
```

Las tres claves, en ese orden, y la tercera no es decoración. Dos dispositivos pueden
estampar el mismo milisegundo, y sus relojes ni siquiera coinciden: sin un desempate que
no dependa del tiempo, la misma base de datos podría resolver a fases distintas en el
móvil y en el portátil. El `id` es arbitrario, pero es **el mismo en los dos sitios**, que
es justo lo que hace falta.

Hay prueba de ello: barajar el mismo conjunto de eventos y exigir idéntico resultado.

## 6. Sesiones ya completadas

**Su fase es la que llevan guardada. Punto.**

```ts
/** La fase de una sesión. No consulta transiciones, y no debe hacerlo. */
export function phaseOfSession(program: Program, session: SessionRecord): Phase | null
```

Devuelve `null` en vez de lanzar cuando el id guardado ya no existe en el programa — una
fase renombrada no debe dejar el historial sin abrir. La pantalla enseña el id crudo, que
es feo y honesto.

Hay además una prueba estructural, del mismo tipo que la que ya obliga a los componentes a
leer por `useRecords`: **ninguna pantalla puede llamar a `phaseForDate` pasándole la fecha
de una sesión guardada.** Es el error que rompería G1, y una prueba de unidad no lo
atraparía porque el fallo está en quién llama, no en qué calcula.

## 7. Sesiones futuras

No tienen fase guardada todavía, así que se proyecta:

```ts
export function projectedPhaseForDate(program, events, date, today): Phase
```

- Hasta hoy: eventos reales (§5).
- Más allá: se encadenan las fases que faltan por `order`, **respetando la política de cada
  una**.

El algoritmo lleva un cursor con la fecha en que empezaría la fase siguiente, arrancando
en la última transición real:

| Política | Inicio proyectado | Efecto de ir tarde |
|---|---|---|
| `rolling` | el cursor; dura lo que decía el plan | se desplaza entera |
| `anchored` | su `plannedStart`, sin moverse | se comprime lo que hay **antes** |

Es decir: si vas dos semanas tarde, las fases `rolling` que vengan detrás se corren dos
semanas, pero una fase atada a una fecha externa no se mueve — lo que se acorta es la
anterior.

**Una fase `anchored` nunca se desplaza.** Cuando el cursor rebasa su `plannedStart`, la
proyección mantiene el ancla y reporta lo que se comprime, para que la pantalla pueda decir
«a este ritmo, la fase C se queda sin semanas» en vez de enseñar un calendario imposible
con cara de normalidad. `projectedDays` se limita por abajo a **0**: nunca existe un
intervalo negativo.

```ts
export type Projection = {
  phases: Array<{ phaseId: string; start: IsoDate; end: IsoDate | null }>
  /** Fases que el anclaje deja sin espacio. `projectedDays >= 0` siempre. */
  compressed: Array<{ phaseId: string; plannedDays: number; projectedDays: number }>
  /** Anclas que ya pasaron sin que ningún evento entrara en su fase. */
  missedAnchors: Array<{
    phaseId: string
    plannedStart: IsoDate
    overdueDays: number
  }>
}
```

### 7.1 Una previsión no puede inventar el pasado

Aquí hay una línea que no se cruza. Si el `plannedStart` de una fase `anchored` ya quedó
por detrás de hoy y **no existe ningún evento real que haya entrado en esa fase**, la
proyección **no puede fingir retroactivamente que empezó**. Lo que dice es que el ancla se
pasó, y cuánto:

```
missedAnchors: [{ phaseId: "fase_viaje", plannedStart: "2027-01-05", overdueDays: 12 }]
```

La diferencia es la de todo E2: **la realidad histórica sale exclusivamente del registro de
eventos.** Una fecha planificada que venció no es un hecho, es una fecha que venció. Si la
proyección la tratara como un comienzo, tendríamos otra vez el defecto que E2 vino a
arreglar, sólo que escondido en la pantalla del calendario en lugar de en el YAML.

La proyección **nunca se guarda**. Es una respuesta a «¿qué viene?», no un hecho.

## 8. Transición retrasada o adelantada

Los dos campos de la misma fila:

```ts
export function driftDays(event: PhaseEvent): number | null {
  if (!transition.plannedFor) return null
  return daysBetween(transition.plannedFor, transition.occurredOn)
}
```

Positivo, tarde; negativo, pronto; `null`, no había previsión. La app puede decir «entraste
en la fase B ocho días más tarde de lo previsto» sin que eso implique nada más — no
dispara ningún ajuste, porque ajustar es E3.

## 9. Añadir una fase nueva sin tocar código

Dos cosas, ninguna es código:

**Una fila en el YAML** — junto a las otras fases:

```yaml
  - id: fase_viaje
    name: Preparación viaje
    order: 5
    plannedStart: 2027-01-05
    plannedEnd: null
    schedulePolicy: anchored   # su fecha viene de fuera, no del entrenamiento
    retired: false
    legacyId: null
    inheritsFrom: fase_d      # hereda ranura de prescripción y cardio
    entryCriteria: []
    exitCriteria: []
    goal: Mantener lo ganado
    targetRir: { min: 2, max: 2 }
    weeklyCardioMinutes: { min: 150, max: 180 }
    workingSets: 2
    coreWeeklySets: ""
    ankleStage: Mantenimiento
    progresses: ""
    avoid: ""
```

**Una fila en la base de datos** — la transición, creada desde la app el día que entres, o
por adelantado con su `plannedFor`.

Y ya. `slotOf` resuelve la prescripción por herencia, `phaseForDate` la encuentra como a
cualquier otra, y `setsByPhase` no se entera. Al ser `anchored`, su fecha aguanta aunque
las fases anteriores se alarguen — que es justo lo que se quiere de una fase atada a algo
de fuera. Hay una prueba dedicada que hace exactamente
esto sobre un programa de fixture y comprueba que la fase nueva resuelve y prescribe.

## 10. Revocar o corregir una transición

Nunca se edita una fila. Se añade otra que la referencia:

| Caso | Evento nuevo | Efecto |
|---|---|---|
| «Cambié de fase el 12, no el 5» | `supersedesId: X`, `occurredOn: 12` | X desaparece de la resolución; manda la nueva |
| «Esa transición no ocurrió» | `revokesId: X` | X desaparece; no hay sustituta |

Consecuencia que hay que mirar de frente: **corregir una transición cambia la fase
calculada de fechas pasadas.** Eso es correcto — si de verdad cambiaste el 12, el 8 estabas
en la fase anterior.

Lo que **no** cambia es la fase guardada de las sesiones de esos días. Y ahí es donde vive
la cláusula de G1:

```ts
/** Sesiones cuya fase guardada ya no coincide con la calculada. */
export function sessionsDisagreeingWithPhase(
  program, transitions, sessions,
): Array<{ session: SessionRecord; stored: string; derived: string }>
```

La app puede enseñar esa lista y ofrecer reestampar sesión por sesión, con una acción
explícita. **E2 sólo aporta la consulta**; la pantalla que la use puede esperar. Lo que E2
garantiza es que nada reestampa nada solo.

### 10.1 Validación de integridad del log

Separada de la resolución a propósito: `phaseForDate` no lanza nunca, porque un log
corrupto no puede dejarte sin app en mitad de una serie. Lo que hace es responder lo mejor
que puede; **decir que algo está mal es trabajo de otra función**.

```ts
export function validateEvents(
  program: Program,
  events: readonly PhaseEvent[],
): PhaseLogProblem[]
```

Devuelve problemas, no excepciones. Se ejecuta en pruebas y puede mostrarse en pantalla,
pero nunca bloquea el registro.

**Continuidad de la cadena.** Recorriendo los eventos vivos en orden determinista, el
`fromPhaseId` de cada uno debe coincidir con la fase efectiva inmediatamente anterior:

```
evento[n].fromPhaseId === evento[n-1].toPhaseId
```

con una única excepción: el primero, que debe tener `fromPhaseId: null`. Un salto en la
cadena significa que falta un evento o que alguno quedó mal corregido, y es exactamente el
tipo de daño que de otro modo se descubre meses después mirando una gráfica rara.

**Lo demás que comprueba:**

| Problema | Regla |
|---|---|
| `multiple-initial` | Hay más de un evento vivo con `fromPhaseId: null` |
| `no-initial` | No hay ninguno, habiendo eventos |
| `broken-chain` | El `fromPhaseId` no casa con la fase anterior |
| `unknown-phase` | Un evento apunta a una fase que no existe |
| `self-transition` | `fromPhaseId === toPhaseId` |
| `duplicate-order` | Dos fases comparten `order` |
| `unknown-inherits` | `inheritsFrom` apunta a una fase inexistente |
| `inherits-cycle` | `inheritsFrom` forma un ciclo |
| `anchored-without-date` | Una fase `anchored` sin `plannedStart` |
| `annulment-cycle` | Ciclo de correcciones/revocaciones |
| `double-annulment` | Dos eventos vivos anulan el mismo objetivo |

Los ciclos de `inheritsFrom` importan más de lo que parece: `slotOf` es recursiva, y sin
esta comprobación un ciclo se manifestaría como un desbordamiento de pila al abrir la app.

## 11. Rollback

Tres capas, de más barata a menos:

1. **Código:** `git revert` de los commits de E2, o `git checkout e1`. La etiqueta `e1`
   marca el último estado bueno conocido, con los cinco comandos en verde.
2. **Datos:** `scripts/rollback-phase-ids.ts`, la migración al revés. Traduce cada `phase`
   de texto al `legacyId` de su fase. Es biyectiva para las cuatro fases actuales.
3. **Respaldo:** el archivo que exportes antes de migrar. Es lo único que cubre un fallo
   que no hayamos previsto.

**El caso que el rollback no puede resolver limpio:** una sesión registrada después de E2
en una fase sin `legacyId` — una fase creada nueva — no tiene equivalente numérico. El
script las lista y **se niega a continuar** salvo que le digas explícitamente a qué número
mandarlas. Perder la fase de una sesión en silencio para poder revertir sería el mismo
pecado que la migración evita.

## 12. Pruebas

### Migración

1. **Equivalencia exhaustiva de fechas.** Para cada día entre el inicio del programa y dos
   años después, la fase nueva coincide con la que devolvía la vieja. Respalda G1 y no se
   comprueba por muestreo.
2. **Idempotencia.** Migrar dos veces deja lo mismo que migrar una.
3. **Ida y vuelta.** Migrar y revertir devuelve exactamente los valores originales.
4. **Cobertura.** Toda sesión guardada mapea a exactamente una fase; lo no mapeable se
   reporta y se deja intacto.
5. **Siembra reconciliada.** Sembrar los eventos dos veces no los duplica.
6. **La sesión base sobrevive.** Es anterior al inicio del programa, ejercita el
   pinzamiento, y su fase no cambia.

### Sincronización y multi-dispositivo

7. **Entrada numérica normalizada.** Un pull que trae `phase: 2` a una base ya migrada
   acaba con el texto correcto, y exactamente una vez.
8. **Sin bases mixtas.** Después de cualquier secuencia de pulls, ninguna sesión almacenada
   conserva `phase` numérica.
9. **Dos dispositivos, uno migrado y otro no.** Fusionar en ambos sentidos converge al
   mismo estado, sin duplicar sesiones ni perder ninguna.
10. **Orden determinista.** El mismo conjunto de eventos, barajado, resuelve idéntico.
    Incluye eventos que comparten `occurredOn` y `createdAt`, donde sólo desempata el `id`.
10b. **Versión de protocolo.** Los cuatro casos de la tabla de §4.1, sobre la función pura.
10c. **Cliente incompatible, multi-dispositivo.** Un cliente en versión 1 contra un
    servidor en 2 es rechazado, **no escribe nada** en ninguno de los dos lados, y la app
    muestra que hay que actualizar. El dispositivo actualizado sincroniza con normalidad
    en la misma prueba, para verificar que el bloqueo es del cliente viejo y no del canal.

### Respaldo — el caso de recuperación real

11. **Respaldo de E1 → E2, completo.** Es la prueba que más importa, y va paso a paso:
    respaldo hecho en E1 (con `phase` numérica) → importar en E2 → migrar → sembrar eventos
    → verificar que **cada sesión conserva su fase**, que el historial está entero y que la
    fase derivada de cada fecha coincide → exportar de nuevo y comprobar que el archivo
    resultante vuelve a importarse sin pérdidas.

### Semántica del log

12. **Cadenas de anulación.** Los cuatro casos de la tabla de §2.2, uno a uno: A; A←B;
    A←B←C revoca B *(A revive)*; A←B←C←D revoca C *(queda B)*.
13. **Ciclo de anulación** → todo el ciclo muerto, sin colgarse.
13b. **Append-only forzado:** `update` y `delete` sobre `phaseEvents` lanzan; `insert`
    funciona; la escritura por `raw` que usa la sincronización sigue pasando.
13c. **Degradación de `phaseForDate`:** los seis daños de la tabla de §5.2, uno a uno.
    Ninguno lanza.
14. **Doble anulación** → gana el más nuevo por orden determinista, y se reporta.
15. **Continuidad de la cadena** → un `fromPhaseId` que no casa se detecta.
16. **Una única transición inicial** → dos `fromPhaseId: null` se detectan.
17. **`order` único · `inheritsFrom` existente · sin ciclos de `inheritsFrom` ·
    `anchored` sin `plannedStart`** → cada uno con su prueba.

### Identidad de fase

18. **Todo id de fase en datos guardados existe en el programa.**
19. **`KNOWN_PHASE_IDS` sólo crece:** el programa contiene todos los ids que han existido.
20. **Formato del id:** `^[a-z][a-z0-9_]*$`.

### Comportamiento

21. **Una fase nueva funciona** sin tocar código (§9), sobre fixture.
22. **Proyección `rolling`** se desplaza al retrasarse la anterior.
23. **Proyección `anchored`** no se mueve, y reporta las fases comprimidas con
    `projectedDays >= 0`.
23b. **`missedAnchors`:** un ancla vencida sin evento real que entrara en su fase se
    reporta con sus días de retraso, y la proyección **no** la da por empezada.
24. **Corregir un evento** mueve la fase derivada y **no** mueve ninguna guardada.
25. **Las pruebas de caracterización de E0 siguen pasando sin tocarlas.**

## 13. Invariantes

**Sobre las sesiones**

1. La fase de una sesión completada es su valor guardado. Nada la deriva.
2. Ninguna transición escribe jamás en una `SessionRecord`. Reestampar es una acción
   explícita e independiente.

**Sobre el log**

3. El registro sólo crece: la colección rechaza `update` y `delete`, no sólo se abstiene
   de usarlos.
4. Un evento está vivo si ningún evento vivo lo referencia (§2.2).
5. Los eventos muertos no influyen en la resolución.
6. Una revocación nunca aporta destino: el tipo no se lo permite.
7. Cada evento referencia como mucho a otro.
8. Como mucho un evento vivo referencia a un objetivo dado.
9. El orden de resolución es `occurredOn → createdAt → id`, y no depende del reloj.
10. Los eventos vivos forman una cadena continua: `fromPhaseId` casa con la fase anterior.
11. Exactamente un evento vivo inicial, con `fromPhaseId: null`.
12. `fromPhaseId !== toPhaseId`.
13. Toda fecha tiene exactamente una fase efectiva; `phaseForDate` no lanza nunca, y cada
    forma de daño tiene salida definida (§5.2).
13b. Un evento vivo hacia una fase inexistente se ignora en la resolución y se reporta en
    la validación.

**Sobre las fases**

14. Un id de fase es canónico e inmutable: ni se renombra, ni se reutiliza, ni se borra.
    El nombre visible sí cambia.
15. `order` es único.
16. Una fase o tiene `legacyId`, o tiene `inheritsFrom`, o `slotOf` falla ruidosamente.
17. `inheritsFrom` apunta a una fase existente y no forma ciclos.
18. `legacyId` es único entre las fases que lo tienen.
19. Una fase `anchored` tiene `plannedStart`, y nunca se desplaza.
20. El programa tiene al menos una fase. Lo impone el esquema (`phases` es `.min(1)`), y de
    ello depende que `phaseForDate` sea total.
21. Una proyección nunca da por empezada una fase sin un evento real: un ancla vencida se
    reporta en `missedAnchors`, no se convierte en historia.

**Sobre los datos**

22. Ninguna base mixta: después de E2, ninguna `phase` almacenada es numérica.
23. Un cliente con versión de esquema anterior no sincroniza, en ninguna dirección.
24. Ningún valor de prescripción cambia: `setsByPhase`, `targetRir`, cardio, intactos.

## 14. Archivos

**Dominio**

| Archivo | Qué |
|---|---|
| `src/domain/schema.ts` | `PhaseId` a `string`; `Phase` con `schedulePolicy`, `legacyId`, `inheritsFrom`, `retired`; `PhaseEvent`; `Criterion` |
| `src/domain/phase-events.ts` | **nuevo** · vivos/muertos, orden determinista, pliegue, drift, desacuerdos |
| `src/domain/phase-events-validate.ts` | **nuevo** · `validateEvents()`, los once problemas de §10.1 |
| `src/domain/phases.ts` | `phaseForDate` desde transiciones, `phaseOfSession`, `slotOf`, `projectedPhaseForDate` |
| `src/domain/personalise.ts` | `resolveSets` recibe `Phase` en vez de `PhaseId` |
| `src/domain/cardio-day.ts` | busca la prescripción de cardio por id, con herencia |
| `src/domain/achievements.ts` | `Progress.phaseId` pasa a texto |
| `src/domain/phase-events.test.ts`, `phase-events-validate.test.ts`, `phases.test.ts`, `migrate-phase-ids.test.ts`, `src/lib/sync-phase.test.ts`, `src/lib/backup-e1.test.ts` | pruebas |

**Persistencia**

| Archivo | Qué |
|---|---|
| `src/db/collections.ts` | colección `phaseEvents` |
| `src/db/records.ts` | exponerla filtrando tumbas |
| `src/db/synced.ts` | `appendOnly()`, que lanza en `update` y `delete` |
| `src/domain/sync.ts` | `checkSchemaVersion()` y `SYNC_SCHEMA_VERSION` |
| `src/components/SyncStatus.tsx` | «Actualiza este dispositivo para sincronizar» |
| `src/lib/migrate-phase-ids.ts` | **nuevo** · migración y siembra |
| `src/lib/sync-client.ts` | `normalizeIncoming()` antes de escribir, y comprobación tras el pull |
| `src/domain/__fixtures__/phase-ids.ts` | **nuevo** · `KNOWN_PHASE_IDS`, congelado y sólo creciente |
| `src/domain/__fixtures__/backup-e1.ts` | **nuevo** · respaldo sintético con `phase` numérica |
| `src/lib/backup.ts` | añadirla a `COLLECTION_KEYS` — si no, el respaldo se deja el historial de fases |
| `api/sync.ts` | añadirla a la lista permitida |
| `scripts/rollback-phase-ids.ts` | **nuevo** |

**Contenido**

`content/program.yaml` y `content.example/program.yaml`: ids de texto, `plannedStart` /
`plannedEnd`, `legacyId`, `inheritsFrom`. `scripts/import-excel.ts` y
`scripts/extract-library.ts` para emitir la forma nueva.

**Interfaz** — lo que E1 no tocó y E2 sí

`src/routes/index.tsx`, `history.tsx`, `progress.tsx`, `src/components/Dashboard.tsx`,
`ExerciseLogger.tsx`, `ExerciseSettings.tsx`, `src/lib/format.ts`, `src/lib/seed.ts`.
Cambios de firma, no de comportamiento: pasar la fase en vez de su id.

## 15. Criterios de aceptación

| # | Criterio | Cómo se comprueba |
|---|---|---|
| 1 | Las **decisiones y expectativas del motor** en las pruebas de caracterización de E0 quedan intactas. Lo único que puede cambiar es la representación de `PhaseId` que E2 exige — un valor renombrado, no una decisión movida | Las quince expectativas de `decideProgression` sin tocar; sólo `phaseId: 2` → `"progresion"` |
| 2 | **G1**: equivalencia exhaustiva día a día contra la implementación vieja | Prueba 1 de §12 |
| 3 | **G1**: ninguna sesión guardada cambia de fase | Ida y vuelta sobre un volcado real |
| 4 | **G2**: sin cambios en `progression.ts`, `library.ts`, `muscles.ts`, `safety.ts` | `git diff --name-only` |
| 5 | **G2**: los valores de `setsByPhase` no cambian ni un byte | Diff del contenido |
| 6 | Migración idempotente y reversible | Pruebas 2 y 3 de §12 |
| 7 | Una fase nueva se crea sin tocar código | Prueba 7 de §12 |
| 8 | La colección nueva viaja en respaldo y en sync | Prueba 11 |
| 9 | **Respaldo de E1 restaurable en E2**, con las fases intactas | Prueba 11 |
| 10 | Ninguna base mixta tras cualquier secuencia de sync | Pruebas 7–9 |
| 11 | La resolución es idéntica en dos dispositivos | Prueba 10 |
| 12 | La semántica de cadenas es la de §2.2, no un efecto del algoritmo | Pruebas 12–14 |
| 12b | `phaseEvents` rechaza `update` y `delete` | Prueba 13b |
| 12c | `phaseForDate` no lanza ante ninguna forma de daño | Prueba 13c |
| 12d | Un cliente incompatible no escribe nada, y lo dice | Pruebas 10b–10c |
| 12e | Un ancla vencida no se convierte en historia | Prueba 23b |
| 13 | Los cinco comandos en verde | `test` · `typecheck` · `check` · `build` · `verify:import` |
| 14 | Smoke test en origen aislado | Sesión completa, como en E1 |
| 15 | Respaldo real hecho antes de migrar | Tuyo |

---

## Riesgos, ordenados

1. **Es la primera etapa que reescribe un campo ya guardado.** E1 no movió ni un id; esta
   toca todas las sesiones. De ahí la ida y vuelta, la idempotencia y el respaldo previo.
2. **Alcanza a la interfaz.** E1 pudo prometer cero componentes; E2 no puede. Los cambios
   son de firma, pero son más archivos y más superficie donde equivocarse.
3. **`slotOf` es deuda deliberada.** Un puente hasta E3. Si E3 se retrasa, se queda más
   tiempo del debido; quedará anotado en el código con su fecha de caducidad.
4. **T-001 sigue abierto** ([`issues.md`](./issues.md)). No lo bloquea, pero E2 escribe en
   la base de datos más que ninguna etapa anterior. Conviene mirarlo antes de E3.

## Estado

Especificación cerrada. Aprobados: el puente `slotOf()`, no tocar `setsByPhase`, las fases
de sesiones históricas almacenadas, correcciones sin reestampado automático, rollback que
falla ante fases sin `legacyId`, la política `rolling`/`anchored` con `missedAnchors`,
append-only forzado, degradación explícita de `phaseForDate`, versión de esquema en la
sincronización.

Se mantienen G1 y G2, el respaldo real previo a migrar, las pruebas de caracterización de
E0 intactas y los cinco comandos en verde.

Al terminar E2 **no se avanza a E3**.
