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

## 1. `PrescriptionBaseline`

Lo que el programa dijo al empezar. Se siembra una vez desde el contenido y **no se
reescribe nunca** — ni al reimportar el Excel, que escribe el contenido y no la base.

```ts
export type PrescriptionBaseline = {
  id: string                        // `${templateId}:${exerciseId}`, determinista
  templateId: string
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

  /** De qué versión del contenido salió. Para saber qué se sembró y cuándo. */
  seededFrom: string
  seededAt: number
}
```

Una fila por par plantilla-ejercicio: **26**, no 104. Lo que hoy varía por fase
—`setsByPhase`— no vive aquí.

### Por qué la variación por fase no está en la base

Porque no es la base: es lo primero que el plan decidió cambiar. Se expresa como un ajuste
con `origin: "program"`, que es exactamente lo que dice tu observación original — la app no
debe creer que «la fase 3 son 3 series», debe saber que **el plan de partida dijo** que en
fase 3 fueran 3 series, y quién lo dijo.

Efecto secundario que sólo es posible gracias a E2: un ajuste con alcance de fase entra
cuando entras en la fase **de verdad**, no cuando el calendario decía que ibas a entrar. Si
te retrasas dos semanas, su prescripción se retrasa contigo.

## 2. `PlanAdjustment`

```ts
export type AdjustmentOrigin =
  | "program"   // venía escrito en el plan de partida
  | "review"    // lo decidiste en un checkpoint viendo tus datos
  | "coach"     // lo sugirió el motor y lo aceptaste          ← sin emisor hasta E6
  | "manual"    // lo cambiaste en el momento, en el gimnasio
  | "safety"    // forzado por dolor, hinchazón o inestabilidad

export type AdjustmentScope =
  /** Desde una fecha, para siempre. */
  | { kind: "from_date"; effectiveFrom: IsoDate }
  /** Mientras estés en esa fase, entres cuando entres. */
  | { kind: "in_phase"; phaseId: string }

export type AdjustmentTarget =
  | { kind: "exercise"; templateId: string; exerciseId: CanonicalId }
  | { kind: "template"; templateId: string }
  | { kind: "program" }

export type PlanAdjustment = {
  id: string
  scope: AdjustmentScope
  target: AdjustmentTarget

  /** Qué campo de la prescripción cambia, y a qué. */
  field: "sets" | "target" | "load" | "rir" | "restSeconds" | "cues"
       | "allowedSubstitutions" | "trainingRole"
  value: unknown

  origin: AdjustmentOrigin
  /** Por qué. Obligatorio y no vacío: un ajuste sin motivo es un número sin dueño. */
  reason: string
  evidenceIds: string[]

  /** Sustituye a otro por completo. */
  supersedesId: string | null
  /** Lo anula sin poner nada en su lugar. */
  revokesId: string | null

  createdAt: number
}
```

Append-only, con la misma envoltura que `phaseEvents`: la colección rechaza `update` y
`delete`. Corregir es un ajuste nuevo con `supersedesId`; deshacer, uno con `revokesId`.

### 2.1 `effectiveFrom` y la diferencia con las transiciones de fase

Un evento de fase es un **punto** —cambiaste ese día o no—, y por eso anularlo era total.
Un ajuste es un **estado que dura**, así que aquí `effectiveFrom` sí significa algo por sí
solo: «desde el 5 de octubre, tres series». Anularlo también:

- `supersedesId` — el ajuste sustituido desaparece de la resolución por completo.
- `revokesId` — igual, pero sin sustituto.

La cadena se resuelve **con la misma regla de E2**, que ya está escrita y probada: un
evento está vivo si ningún evento vivo lo referencia. Revocar la corrección más reciente
restaura la anterior. Se reutiliza `liveEvents` en vez de escribirla otra vez.

### 2.2 Precedencia

Dos ajustes que tocan el mismo campo de la misma prescripción se ordenan así, y gana el
último:

| # | Criterio | Por qué |
|---|---|---|
| 1 | `origin`: `program` < `review` = `coach` = `manual` < `safety` | Lo que el plan traía escrito cede ante lo que decidiste mirando datos; y todo cede ante una señal de alarma. |
| 2 | Alcance: `program` < `template` < `exercise` | Lo específico gana a lo general. |
| 3 | Fecha de efecto, ascendente | Lo más reciente manda. |
| 4 | `createdAt`, luego `id` | Determinista entre dispositivos, igual que en E2. |

**`safety` arriba del todo, y no se cae solo.** Una señal de alarma no deja de aplicar
porque después escribas un ajuste manual con fecha posterior: para quitarla hay que
revocarla explícitamente. Eso es deliberado — la regla que ya vive en `safety.ts` dice que
el dolor manda sobre la progresión, y sería raro que el plan pudiera saltársela por orden
de llegada.

## 3. `SessionPlanSnapshot`

```ts
export type ResolvedPrescription = {
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

export type SessionPlanSnapshot = {
  id: string
  sessionId: string
  takenAt: number
  /** La fase con la que se selló la sesión. */
  phaseId: string
  /** Valores resueltos, no referencias. Aquí está G3. */
  exercises: ResolvedPrescription[]
  /**
   * Qué ajustes estaban vigentes. Sólo para poder explicar «¿por qué tres series
   * aquel día?» — la instantánea se renderiza sin consultarlos.
   */
  adjustmentIds: string[]
}
```

Append-only. Puede haber **más de una por sesión**: si a mitad decides adoptar un cambio de
plan, se toma otra y la primera se queda. La sesión usa la más reciente; «qué tenías
prescrito al empezar» sigue siendo respondible, que es lo que importa.

## 4. Resolución del plan para una fecha

```ts
export function resolvePrescription(
  baseline: readonly PrescriptionBaseline[],
  adjustments: readonly PlanAdjustment[],
  phase: Phase,
  date: IsoDate,
  templateId: string,
): ResolvedPrescription[]
```

1. Partir de la base de esa plantilla.
2. Descartar los ajustes muertos (§2.1).
3. Quedarse con los aplicables: `from_date` con `effectiveFrom <= date`, o `in_phase` cuya
   fase coincida con la resuelta para esa fecha.
4. Ordenar por precedencia (§2.2).
5. Plegar: cada ajuste escribe su campo.

Pura, sin E/S, sin React. Como todo lo que decide algo en este proyecto.

## 5. Sesión empezada, sesión futura

| Situación | Qué se lee |
|---|---|
| **Sesión con instantánea** (empezada o terminada) | Su instantánea. Nunca se re-resuelve. |
| **Sesión de hoy sin empezar** | Resolución en vivo. Todavía no es un hecho. |
| **Sesión futura** | Resolución en vivo con la fase **proyectada** de E2. Es una previsión. |

**Si el plan cambia con una sesión ya empezada:** no pasa nada. La sesión sigue con su
instantánea. La app puede decir «el plan cambió desde que empezaste» y ofrecer tomar una
nueva — acción explícita, nunca automática. Es la misma forma que el reestampado de fase en
E2, y por la misma razón.

Igual que en E2, hay una consulta para verlo:

```ts
export function sessionsWithOutdatedPlan(...): Array<{
  sessionId: string
  differences: Array<{ exerciseId: string; field: string }>
}>
```

## 6. Versionado y diff

Como se aprobó: **una versión es una etiqueta sobre una fecha, no una copia del plan.**

```ts
export type ProgramVersion = {
  id: string
  label: string      // "v3"
  cutAt: IsoDate
  reason: string
  createdAt: number
}

export function diffVersions(a: ProgramVersion, b: ProgramVersion) {
  const before = resolveWholePlan(a.cutAt)
  const after  = resolveWholePlan(b.cutAt)
  return {
    added:   exercisesIn(after).filter(notIn(before)),
    removed: exercisesIn(before).filter(notIn(after)),
    changed: fieldsThatDiffer(before, after),
    volume:  { before: weeklySets(before), after: weeklySets(after) },
    why:     adjustmentsBetween(a.cutAt, b.cutAt),   // ya llevan motivo y origen
  }
}
```

El diff **se calcula, no se guarda**: un derivado almacenado es un derivado que un día
contradice a los datos.

## 7. Migración del plan actual

Cuatro pasos, y el tercero es el que lleva la carga conceptual.

1. **Sembrar la base.** Una fila por par plantilla-ejercicio desde el contenido compuesto
   de E1. Ids deterministas, así que re-sembrar reconcilia.
2. **Convertir `setsByPhase` en ajustes `origin: "program"`.** Para cada ejercicio y cada
   fase cuyo número de series difiera del de la fase de menor orden, un ajuste
   `{ kind: "in_phase", phaseId }` con `field: "sets"` y
   `reason: "Variación de series que el programa traía escrita para esta fase."`
3. **Retirar `slotOf()`.** El puente de E2 muere aquí, que era su fecha de caducidad.
   `setsByPhase` deja de leerse; la prescripción sale de base + ajustes.
4. **Sembrar instantáneas retroactivas.** Las sesiones ya registradas no tienen ninguna. Se
   les crea una con la prescripción **resuelta a su propia fecha**, marcada
   `takenAt: 0` y `reconstructed: true` — porque no es lo que se congeló aquel día, es la
   mejor reconstrucción posible, y decirlo importa más que aparentar exactitud.

Después del paso 2, `resolvePrescription` en cualquier fecha pasada devuelve exactamente lo
que devolvía `slotOf` + `setsByPhase`. **Se comprueba día a día**, igual que en E2.

## 8. Rollback

| Capa | Cómo se revierte |
|---|---|
| Código | `git checkout t001` — el último estado bueno anterior a E3. |
| Base y ajustes | `scripts/rollback-prescription.ts`: vacía base, ajustes y versiones. `setsByPhase` sigue en el contenido intacto, así que `slotOf` vuelve a funcionar. |
| Instantáneas | **No se borran.** Son hechos, no derivados. Sobreviven al rollback y vuelven a servir si E3 se reintenta. |
| Respaldo | El archivo previo a migrar. Lo único que cubre lo imprevisto. |

**Lo que el rollback se niega a hacer:** si existe algún ajuste con `origin` distinto de
`program` —es decir, una decisión tuya y no una conversión mecánica— el script para y los
lista. Revertir borraría decisiones que nadie más tiene escritas.

## 9. Pruebas

**Migración**
1. Equivalencia exhaustiva día a día contra `slotOf` + `setsByPhase`, del inicio del
   programa a dos años. Sin muestreo.
2. Idempotencia: sembrar dos veces no duplica.
3. Ida y vuelta: migrar y revertir devuelve los valores originales.
4. Instantáneas reconstruidas: cada sesión histórica obtiene una, marcada como tal.

**G3 — la garantía**
5. Congelar, cambiar el plan, releer: la sesión no se mueve.
6. Revocar el ajuste que estaba vigente al congelar: la sesión **sigue igual**.
7. Borrar el ajuste del registro entero: la instantánea sigue renderizando (autocontenida).
8. Una sesión empezada y otra futura, mismo cambio de plan: la primera no cambia, la
   segunda sí.
9. Varias instantáneas en una sesión: la más reciente manda, la primera sigue consultable.

**Resolución y precedencia**
10. Los cuatro criterios de §2.2, uno a uno.
11. `safety` gana a un `manual` posterior.
12. Quitar un `safety` requiere revocarlo explícitamente.
13. Alcance: `exercise` gana a `template`, `template` a `program`.
14. Cadenas supersede/revoke, reutilizando los casos ya probados en E2.
15. Orden determinista: el mismo conjunto barajado resuelve idéntico.
16. `in_phase` sigue a la fase real, no a la planificada — entrar tarde retrasa su efecto.

**Versionado**
17. Diff entre dos fechas: añadidos, quitados, cambiados, volumen.
18. El diff no se guarda: recalcular da lo mismo.

**No-motor**
19. `progression.ts` sin cambios de comportamiento; caracterización de E0 intacta.
20. Búsqueda estructural: no existen `Rationale`, `Suggestion` ni `analyseTrend`.

**Durabilidad** — porque E3 añade tres colecciones
21. Las tres nuevas están en el respaldo y en la lista de sincronización.
22. La guarda de escrituras críticas cubre las nuevas colecciones.

## 10. Invariantes

1. Una sesión con instantánea nunca re-resuelve su prescripción.
2. La instantánea es autocontenida: se renderiza sin base ni ajustes.
3. Ajustes e instantáneas sólo crecen: la colección rechaza `update` y `delete`.
4. La base no se reescribe: reimportar el Excel no la toca.
5. Todo ajuste tiene `reason` no vacío.
6. Un ajuste está vivo si ningún ajuste vivo lo referencia.
7. La precedencia es total y determinista: mismo conjunto, mismo resultado.
8. `safety` sólo se retira revocándolo.
9. Un `in_phase` apunta a una fase que existe.
10. Toda fecha resuelve a exactamente una prescripción por ejercicio.
11. Ninguna prescripción histórica cambia sin un evento explícito posterior.
12. El diff se calcula, nunca se almacena.
13. E3 no emite sugerencias.

## 11. Archivos

**Dominio**

| Archivo | Qué |
|---|---|
| `src/domain/prescription.ts` | **nuevo** · `resolvePrescription`, precedencia, pliegue |
| `src/domain/adjustments.ts` | **nuevo** · vivos/muertos y orden, reutilizando `liveEvents` |
| `src/domain/versions.ts` | **nuevo** · `diffVersions`, `resolveWholePlan` |
| `src/domain/snapshot.ts` | **nuevo** · congelar y leer |
| `src/domain/schema.ts` | `PrescriptionBaseline`, `PlanAdjustment`, `SessionPlanSnapshot`, `ProgramVersion` |
| `src/domain/phases.ts` | **retirar `slotOf`** |
| `src/domain/personalise.ts` | `resolveSessionExercises` pasa a leer la prescripción resuelta |
| pruebas | `prescription.test.ts`, `adjustments.test.ts`, `versions.test.ts`, `snapshot.test.ts` |

**Persistencia**

| Archivo | Qué |
|---|---|
| `src/db/collections.ts` | tres colecciones nuevas, dos append-only, todas `durable` |
| `src/db/records.ts` | exponerlas |
| `src/lib/migrate-prescription.ts` | **nuevo** · los cuatro pasos de §7 |
| `src/lib/backup.ts` · `api/sync.ts` | añadirlas |
| `scripts/rollback-prescription.ts` | **nuevo** |

**Interfaz**

`routes/index.tsx` (congelar al empezar, leer de la instantánea), `history.tsx` (leer de la
instantánea), y una pantalla de plan mínima para ver ajustes y versiones. `ExerciseSettings`
pasa a escribir `PlanAdjustment` en vez de `ExerciseOverride`.

**Retirada**

`ExerciseOverride` queda subsumido por `PlanAdjustment`. Se migran sus filas a ajustes
`origin: "manual"` con `effectiveFrom` = inicio del programa —igual que en E1— y la
colección se deja de escribir.

## 12. Criterios de aceptación

| # | Criterio | Cómo se comprueba |
|---|---|---|
| 1 | **G3**: ninguna sesión con instantánea cambia de prescripción | Pruebas 5–9 |
| 2 | **G3**: la instantánea se renderiza sin base ni ajustes | Prueba 7 |
| 3 | **G4**: sin motor | Pruebas 19–20 |
| 4 | Equivalencia exhaustiva con `slotOf` día a día | Prueba 1 |
| 5 | Migración idempotente y reversible | Pruebas 2–3 |
| 6 | Rollback se niega ante decisiones no mecánicas | Prueba dedicada |
| 7 | Las tres colecciones viajan en respaldo y sync | Prueba 21 |
| 8 | La guarda de durabilidad las cubre | Prueba 22 |
| 9 | `slotOf` eliminado | `git grep slotOf` vacío |
| 10 | Caracterización de E0 intacta | `git diff` |
| 11 | Los cinco comandos en verde | — |
| 12 | Smoke test en origen aislado | Sesión completa |
| 13 | Respaldo real previo | Tuyo |

---

## Riesgos

1. **Es la etapa que más superficie toca.** Tres colecciones, la retirada de `slotOf`, y el
   ejecutor leyendo de otra fuente. Más que E1 y E2 juntas.
2. **Las instantáneas retroactivas son una reconstrucción, no un recuerdo.** Van marcadas,
   pero conviene tenerlo presente: para las sesiones anteriores a E3, «lo que tenías
   prescrito» es lo mejor que se puede deducir, no lo que se congeló.
3. **La precedencia es donde se esconden las sorpresas.** Cuatro criterios y cinco orígenes
   dan muchas combinaciones; de ahí que §2.2 tenga una prueba por criterio.
4. **`ExerciseOverride` se retira con datos dentro.** Misma clase de migración que E2, con
   la misma exigencia de ida y vuelta.

## Lo que quiero que revises

1. **§1** — que la variación por fase sea un ajuste `origin: "program"` y no parte de la
   base. Es lo que hace que la app nunca «crea» que una fase son N series, pero añade una
   indirección.
2. **§2.2** — la precedencia, y en particular que `safety` sólo se quite revocándolo.
3. **§7 paso 4** — instantáneas retroactivas marcadas como reconstruidas, en vez de no
   tenerlas.
4. **§5** — que un cambio de plan con la sesión empezada no haga nada salvo ofrecerte
   tomar una instantánea nueva.
