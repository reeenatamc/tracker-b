# De tracker a sistema longitudinal

Propuesta de arquitectura. Estado: **cimientos aprobados, pendiente elegir por dónde
empezar a construir**.

La base que ya existe resuelve más de lo que la petición asume. Tiene un defecto
estructural: el plan está escrito en el código como «en la fase N son N series», sin
distinguir lo que el programa dijo al empezar de lo que decidimos después mirando los
datos. Todo lo demás se construye encima de arreglar eso.

> **Nota de privacidad.** Este documento vive en el repo público, así que los ejemplos
> usan semanas relativas y cargas inventadas. Las fechas y valores reales del programa
> están en `content/`, que está gitignored.

---

## 0. El veredicto, antes del detalle

No hay que reescribir la app. `src/domain/` ya tiene lógica pura, probada y correcta para
lo más difícil: doble progresión, identidad canónica de ejercicios, señales de alarma que
mandan sobre la progresión, y una separación real entre el plan (contenido) y el registro
(base de datos). Eso es el 70 % del trabajo conceptual, ya hecho. 172 pruebas en verde.

Lo que falta es una capa, no una app: **el plan tiene que dejar de ser una constante de
compilación y convertirse en un historial de decisiones.**

Hoy `content/program.yaml` se empaqueta dentro del JavaScript y cada ejercicio lleva
escrito:

```yaml
setsByPhase:
  "1": 2
  "2": 2
  "3": [2, 3]
  "4": 2
```

Eso es literalmente «la fase 3 son 2–3 series, siempre, porque sí». No hay fecha, no hay
motivo, y no hay forma de saber si esas 3 series venían en el plan original o se
decidieron más tarde viendo que isquios estaba en 4 series por semana.

Hay además un efecto secundario que rompe el requisito de inmutabilidad: el historial se
re-resuelve con los overrides actuales (`findExercise()` en `routes/history.tsx`), así que
editar el plan hoy cambia cómo se lee una sesión de hace tres semanas.

> **La corrección de fondo.** Una prescripción no es un número: es un número *con
> procedencia*. Cada valor efectivo del plan tiene que poder responder «desde cuándo»,
> «por qué» y «quién lo decidió» — el programa, una revisión con datos, el motor, tú en el
> momento, o una señal de seguridad.

Con eso resuelto, el versionado, la auditoría de volumen, el motor de adaptación y las
preguntas del apartado 34 dejan de ser funcionalidades sueltas y pasan a ser consultas
sobre una misma estructura.

---

## 1. Qué ya existe

Recorrido de los 35 apartados contra el código real.

| Estado | Significado |
|---|---|
| **Sirve** | existe y aguanta el rediseño |
| **Cambia** | existe pero hay que rehacerlo |
| **Falta** | no hay nada |

### Lo que ya está bien resuelto

| § | Módulo | Estado | Dónde está hoy, y qué le pasa |
|---|---|---|---|
| 6 | Identidad canónica | **Sirve** | `domain/exercise-ids.ts` — registro de ids, alias con y sin acentos, y mapa de ids antiguos. Justo lo pedido, ya escrito. Sólo se muda a la biblioteca. |
| 10 | Doble progresión | **Sirve** | `domain/progression.ts` — no sube por llegar a 12: exige todas las series al tope, RIR suficiente y las series de la fase. Distingue peso de trabajo de peso tocado. |
| 32 | Seguridad | **Sirve** | `domain/safety.ts` — dolor ≥ 3, hinchazón o episodio de inestabilidad bloquean la subida de carga por encima de todo lo demás. Sólo hay que ampliarlo más allá del tobillo. |
| 9 | Temporizador por ejercicio | **Sirve** | `restSeconds` por ejercicio + `RestTimer.tsx`. Ya no es global. Falta registrar el descanso real. |
| 28 | Offline / PWA | **Sirve** | SQLite real en el navegador sobre OPFS, service worker propio, sincronización con marca de tiempo y tumbas. Verificado sin red. |
| 29 | Backup | **Sirve** | `lib/backup.ts` exporta registros *y* fotos en un solo archivo. Falta CSV/Excel. |
| 27 | Modo móvil | **Sirve** | Toda la UI es de una mano por diseño. |

### Existe, pero el rediseño lo toca

| § | Módulo | Estado | Qué le pasa |
|---|---|---|---|
| 4 | Programa y fases | **Cambia** | `PhaseId` es la unión cerrada `1\|2\|3\|4` en 38 sitios. **La fase 5 (España) no cabe sin tocar código.** Pasa a `string` ordenado por fecha. |
| 5 | Versionado | **Cambia** | `ExerciseOverride` es lo más parecido: una fila por ejercicio, *sobrescrita en sitio*, sin fecha de efecto ni motivo. Y el historial se re-resuelve con los overrides de hoy. |
| 7 | Biblioteca de ejercicios | **Cambia** | No hay biblioteca: cada ejercicio se define *dentro* de cada sesión, duplicado en Full Body A/B/C. Técnica y sustitución se repiten y pueden divergir. `muscle` es texto libre («Cuádriceps + glúteos»), inservible para contar volumen. |
| 8 | Ejecutor | **Cambia** | `routes/index.tsx` ya muestra «la vez pasada» y precarga objetivo. Le falta: dolor por zona, marcar sustitución, y guardar la instantánea del plan al empezar. |
| 13 | Rehabilitación | **Cambia** | Bien separada del Full Body (`cardio-day.ts`) y con chequeo comparativo sano/lesionado. Pero se registra como sets normales; necesita entidad propia con estabilidad, tiempo de balance y episodios. |
| 14 | Cardio | **Cambia** | Se registra como un set más, en minutos. No hay modalidad, distancia, FC, RPE ni objetivo semanal comprobable. |
| 17 · 18 | Medidas y fotos | **Cambia** | `ProgressCheck` mezcla medidas corporales con cumplimiento semanal — dos cosas con cadencia distinta. Falta peso medio semanal y comparador antes/después. **Las fotos no viajan en la sincronización** (sí en el backup): viven sólo en el dispositivo donde se subieron. |
| 20 · 21 | Revisiones | **Cambia** | Hay puntuación de consistencia semanal con la fórmula del Excel. No hay checkpoint de 4 semanas ni registro de la decisión tomada. |
| 30 | Evidencia | **Cambia** | `content/sources.yaml` tiene ACSM, WHO, la guía de esguince lateral y el metaanálisis de balance. No tienen id, así que ninguna decisión puede apuntar a una fuente. |
| 24 | Historial por ejercicio | **Cambia** | Hay historial por sesión y editable. Falta la vista por ejercicio con serie temporal y mejor marca. |

### No existe

| § | Módulo | Por qué importa |
|---|---|---|
| 3 | Perfil y objetivos | Los objetivos son cadenas de sólo lectura dentro del YAML. Sin prioridad, sin fecha, sin métrica asociada, sin estado. |
| 11 · 31 | Motor de adaptación | La progresión decide por ejercicio y sesión. No hay detección de estancamiento, ni lectura de tendencia, ni sugerencias con motivo. |
| 12 | Auditoría de volumen | Bloqueada por la falta de taxonomía muscular. Es el módulo que más depende de la biblioteca. |
| 19 | Readiness | Sin esto, una mala sesión y un mal día son indistinguibles en los datos. |
| 16 | Nutrición | Sólo existe `nutritionAdherence: number` en el resumen semanal. Sin proteína, agua, comidas ni banco de comidas. |
| 23 | Calendario | El día se deriva del día de la semana. Mover el miércoles al jueves no se puede expresar. |
| 25 · 26 | Sustituciones y máquinas | `substitution` es texto libre («Hack/prensa distinta»), no un ejercicio al que cambiar. No hay entidad de equipamiento, así que 20 kg en dos máquinas distintas son el mismo dato. |

---

## 2. Las tres capas

Esto es el núcleo de toda la propuesta. El plan deja de ser un valor y pasa a ser tres
capas que se resuelven en una fecha.

| Capa | Qué es |
|---|---|
| **L1 · base** | Lo que el programa dijo al empezar. Se siembra una vez desde `content/program.yaml` y no se reescribe nunca. |
| **L2 · ajustes** | Cada decisión posterior, en un registro que sólo crece. Con fecha de efecto, alcance, motivo, procedencia y evidencia. Nada se edita: se añade. |
| **L3 · instantánea** | Lo que la sesión tenía prescrito al empezarla. Se congela al pulsar «empezar» y no se vuelve a resolver jamás. |

```
L1 · BASE          ┌────────────────────────────────────────────────────────┐
   inmutable       ╎ leg_press · 2 series · 10–12 reps · RIR 2   program.yaml╎
                   └────────────────────────────────────────────────────────┘

L2 · AJUSTES       ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
   sólo añade      │ORIGEN:PROGRAMA│   │ORIGEN:REVISIÓN│   │ORIGEN:SEGURIDAD│
                   │ 2 series      │   │ 3 series      │   │ 2 series      │
                   │ lo dijo fase 2│   │ isquios 4/sem │   │ dolor 4/10    │
                   └───────┬───────┘   └───────┬───────┘   └───────┬───────┘
                           │                   │                   │
                           v                   v                   v
                                         ┌───────────┐
RESUELTO           ────────────────────┘ │ 3 series  │ └───────────────────
   calculado          2 series           └───────────┘        2 series
                           ╎                   ╎                   ╎
                           v                   v                   v
L3 · SESIÓN          ┌───────────┐       ┌───────────┐       ┌───────────┐
   congelada         │ semana 4  │       │ semana 9  │       │ semana 11 │
                     │2×12 · 20kg│       │3×11·22.5kg│       │2×12·22.5kg│
                     └───────────┘       └───────────┘       └───────────┘
                   ─────┼───────────────────┼───────────────────┼─────────>
                    inicio fase 2       revisión sem 8      señal de dolor
                                                            fecha de efecto

Añadir un ajuste con efecto en la semana 11 no toca la sesión de la semana 9:
esa ya está congelada.
```

Los tres ajustes cambian las series de `leg_press`, y cada uno lleva de dónde vino. El de
la revisión no dice «la fase 3 son 3 series» — dice «subimos a 3 porque isquios estaba en
4 series semanales», que es una frase que se puede discutir, revertir y auditar. Las tres
cajas de abajo son lo que realmente se hizo: se leen de su propia instantánea, no se
recalculan.

### Por qué «origen» es el campo que importa

El programa original sí decía dos series, y eso también es información válida —
simplemente no es del mismo tipo que una decisión tomada más tarde con datos delante. La
distinción no es «las fases no prescriben»; es que **toda prescripción declara de dónde
viene**:

```ts
type AdjustmentOrigin =
  | "program"   // venía escrito en el plan de partida
  | "review"    // se decidió en un checkpoint viendo los datos
  | "coach"     // lo sugirió el motor y se aceptó
  | "manual"    // se cambió en el momento, en el gimnasio
  | "safety"    // forzado por dolor, hinchazón o inestabilidad
```

Con ese campo la pantalla puede decir siempre «3 series desde la semana 9, decidido en la
revisión de la semana 8» en lugar de «3 series porque estás en fase 3». Y el motor puede
tratarlos distinto: un ajuste `safety` no se revierte automáticamente, y uno `program` es
sólo una intención de partida que los datos pueden contradecir.

### 2.1 Las fases no las decide el calendario

Una fase no existe por sus fechas. Tiene fecha **planificada**, pero la transición real
puede ocurrir antes o después, por criterios o por decisión en una revisión — y eso hay
que registrarlo, no deducirlo.

```ts
type Phase = {
  id: string                      // "adaptacion", "espana" — abierto
  name: string
  order: number
  plannedStart: IsoDate | null    // previsión, no verdad
  plannedEnd:   IsoDate | null
  entryCriteria: Criterion[]      // qué debería cumplirse para entrar
  exitCriteria:  Criterion[]
  targetRir: Range
  goal: string
}

// Append-only. La transición real es un hecho, no un cálculo.
type PhaseTransition = {
  id: string
  fromPhaseId: string | null
  toPhaseId: string
  occurredOn: IsoDate             // cuándo cambió de verdad
  plannedFor: IsoDate | null      // qué decía el plan
  trigger: "planned" | "criteria-met" | "review" | "manual" | "safety"
  reason: string
  reviewId?: string
  createdAt: number
}
```

`phaseForDate(date)` deja de leer fechas de fase y pasa a leer el registro de
transiciones. Las fechas planificadas quedan para dos cosas: decir qué viene después, y
señalar la desviación — «llevas dos semanas más en fase 2 de lo previsto».

**La fase 5 de España se crea desde datos:** una fila `Phase` y una fila `PhaseTransition`.
Ninguna línea de código.

### 2.2 Append-only de verdad

Un registro que sólo crece no puede permitirse que revocar sea un `UPDATE`. Por eso no hay
`revokedAt`: revocar y sustituir son **eventos nuevos que referencian al anterior**.

```ts
type PlanAdjustment = {
  id: string
  effectiveFrom: IsoDate          // desde cuándo aplica
  scope: AdjustmentScope
  field: string
  value: unknown
  origin: AdjustmentOrigin
  reason: string
  evidenceIds: string[]
  supersedesId: string | null     // sustituye el efecto de otro ajuste
  revokesId:    string | null     // lo anula sin poner nada en su lugar
  createdAt: number
}
```

La resolución pliega los eventos en orden de `effectiveFrom`, y un evento con `revokesId`
retira el efecto del referenciado **a partir de su propia fecha de efecto** — así
«revoqué el ajuste X a partir del 1 de noviembre» es expresable y las sesiones de octubre
siguen leyéndose como se leían. Ninguna fila se modifica nunca.

Efecto secundario que vale la pena: un registro sin `UPDATE` no tiene conflictos de
escritura, así que encaja exactamente con la sincronización de último-en-escribir-gana que
ya existe. Dos dispositivos no pueden desincronizar un log que sólo añade.

---

## 3. El ciclo, y qué escribe cada paso

La separación entre planificación, ejecución, registro, análisis y ajuste es real cuando
cada paso escribe en una tabla distinta y el círculo se cierra por el registro de ajustes.

```
   congela          registra          compara           decide
Planificación ──> Ejecución ──> Registro ──> Análisis ──> Ajuste
 Baseline +      PlanSnapshot   PerformedSet  derivado,   PlanAdjustment
 Adjustments                                  no se guarda      │
      ^                                                         │
      └─────────────────────────────────────────────────────────┘
        se añade al registro de ajustes, con fecha de efecto y motivo

El retorno nunca vuelve a Ejecución ni a Registro: lo ya hecho no se reescribe.
```

Ajustar el plan escribe una fila nueva en `PlanAdjustment` y afecta a partir de su fecha
de efecto. Las dos cajas del centro — lo que hiciste — no tienen ninguna flecha entrante
desde la derecha, y ese es exactamente el requisito de inmutabilidad.

---

## 4. Modelo de datos

Las 33 entidades del apartado 33, mapeadas a lo que ya existe. Agrupadas por lo que hace
cada grupo, porque la regla de oro es que ningún grupo escriba en otro: **intención**
describe, **catálogo** define, **ejecución** es inmutable, **medición** observa,
**análisis** no se guarda.

### Intención — quién eres y qué persigues

| Entidad | Estado | Nota |
|---|---|---|
| `Profile` | Nueva | Edad, altura, experiencia, disponibilidad, horarios, equipamiento, preferencias, ejercicios vetados, lesiones. Una fila, versionada por fecha para que «pesaba X en agosto» siga siendo cierto. |
| `Goal` | Nueva | Varios a la vez, con prioridad, fecha, estado y — lo importante — `metricBinding`: qué medición concreta lo mide. «Cintura más marcada» se ata a `waistCm`, no a una opinión. |
| `EvidenceSource` | Cambia | Ya está el contenido; se le añade `id` para que ajustes y sugerencias puedan enlazarlo. |

### Catálogo — qué movimientos existen

| Entidad | Estado | Nota |
|---|---|---|
| `ExerciseDef` | Nueva | La biblioteca. Id canónico, alias, músculo primario y secundarios *tipados*, patrón, equipo, instrucciones, errores comunes, rango típico, descanso, contraindicaciones, notas propias. Se extrae de las definiciones duplicadas dentro de las sesiones. |
| `ExerciseSubstitution` | Nueva | Sustituciones como referencias a otro `exerciseId`, no como texto. Con el motivo por el que son equivalentes. |
| `Equipment` | Nueva | «Titanus A», «prensa inclinada». Con incremento mínimo real de la máquina, que es el dato que hoy falta para sugerir bien. |

### Plan — las tres capas

| Entidad | Estado | Nota |
|---|---|---|
| `Program` · `Phase` | Cambia | Fases con id abierto. Fechas **planificadas**, no vinculantes. Ver §2.1. |
| `PhaseTransition` | Nueva | El cambio de fase real, como evento. Ver §2.1. |
| `WorkoutTemplate` | Cambia | Pasa a ser una lista de referencias a la biblioteca, no de definiciones. |
| `PrescriptionBaseline` | Nueva | **Sustituye a `setsByPhase`.** Series, rango de reps, RIR, descanso y equipo por ejercicio y plantilla. |
| `PlanAdjustment` | Nueva | El corazón. `effectiveFrom`, alcance (ejercicio / plantilla / fase / programa), campo, valor, `origin`, motivo, evidencia, y `supersedesId` / `revokesId`. **Estrictamente append-only:** ver §2.2. |
| `ProgramVersion` | Nueva | Una etiqueta sobre una fecha de corte. Ver §5. |

### Ejecución — inmutable

| Entidad | Estado | Nota |
|---|---|---|
| `WorkoutSession` | Cambia | Ya existe y está bien. Se le añade `planSnapshotId`, `readinessId` y estado (planificada · completada · parcial · saltada · reprogramada). |
| `SessionPlanSnapshot` | Nueva | La fotografía. La prescripción resuelta en el instante de empezar. |
| `PerformedSet` | Sirve | Ya es correcto. Añadir `equipmentId`, `substitutedFor`, `painSite`, `restTakenSeconds` y percepción de técnica. |
| `CardioSession` | Nueva | Modalidad, minutos, distancia, FC, RPE, calorías, notas. |
| `RehabSession` | Nueva | Series de rehab + estabilidad, tiempo de balance por lado, episodios y hinchazón. Separada de la fuerza. |
| `ReadinessCheck` | Nueva | Sueño, energía, estrés, agujetas, dolor articular, motivación, horas. |

### Medición — el cuerpo y la adherencia

| Entidad | Estado | Nota |
|---|---|---|
| `Measurement` | Cambia | Se separa de `ProgressCheck`: sólo cuerpo (peso, cintura, cadera, muslo, brazo). Peso medio semanal derivado. |
| `ProgressPhoto` | Cambia | Sale de `InspoItem` a entidad propia, con pose (frontal / lateral / espalda), peso, cintura y fase del día. |
| `AnkleCheck` | Sirve | Ya compara sano contra lesionado. Se mantiene. |
| `NutritionLog` · `MealTemplate` | Nueva | Proteína, agua, fruta/verdura, comidas, antojos, hambre, adherencia. Banco de comidas frecuentes de un toque. |

### Decisiones — el rastro

| Entidad | Estado | Nota |
|---|---|---|
| `WeeklyReview` | Cambia | Lo que hoy es `ProgressCheck`: cumplimiento y notas. |
| `Checkpoint` | Nueva | La revisión de 4 semanas, con la decisión tomada y su motivo. |
| `CoachSuggestion` | Nueva | Se guarda también cuando se rechaza. Un motor cuyas sugerencias ignoradas desaparecen no se puede evaluar. |
| `VolumeAudit` | Derivada | No se guarda: se calcula. Guardar un derivado es garantizarse que un día contradiga a los datos. |

---

## 5. Versionado — **aprobado**

> **Decisión tomada:** una versión es una etiqueta sobre una fecha, no una copia del plan.
> El registro de ajustes es la verdad; la versión sólo le pone nombre a un punto.

La alternativa descartada era que cada versión guardase un documento completo del plan.
Obliga a redactar un plan entero por cada cambio pequeño, y dos documentos que deberían
diferir en un campo acaban divergiendo en diez.

```ts
type ProgramVersion = {
  id: string
  label: string        // "v3"
  cutAt: IsoDate       // la fecha que esta etiqueta nombra
  reason: string       // por qué se marcó aquí
}

// El diff no se guarda: se calcula, así que no puede mentir.
function diffVersions(a: ProgramVersion, b: ProgramVersion) {
  const before = resolveWholePlan(a.cutAt)
  const after  = resolveWholePlan(b.cutAt)
  return {
    added:    exercisesIn(after).filter(notIn(before)),
    removed:  exercisesIn(before).filter(notIn(after)),
    changed:  fieldsThatDiffer(before, after),
    volume:   { before: weeklySets(before), after: weeklySets(after) },
    // y el motivo de cada cambio viene ya escrito en su ajuste
    why:      adjustmentsBetween(a.cutAt, b.cutAt),
  }
}
```

- **«¿Qué cambió entre v3 y v4?»** — se resuelve el plan en las dos fechas y se comparan
  campo a campo.
- **«¿Por qué cambió?»** — los ajustes entre ambas fechas ya llevan motivo, origen y
  evidencia. No hay que reconstruir nada.
- **«El lunes fue v2 y el miércoles v3»** — sale solo: cada sesión lee su instantánea, y
  la instantánea del lunes se congeló antes de que existiera el ajuste del martes.

---

## 6. Motor de progresión y motor de adaptación

Son dos cosas distintas y hoy sólo existe la primera. Tres niveles, porque cada uno mira
una ventana temporal distinta.

**Nivel 1 · decisión de carga — una sesión.** Es `decideProgression()`, que ya existe y
está bien. Cambia en una cosa: hoy devuelve `{kind, reason}` con `reason` como código
suelto; pasa a devolver un `Rationale[]` con lo observado dentro, para que la frase se
construya en la UI y no en el motor.

**Nivel 2 · tendencia — 3 a 6 sesiones.** Nuevo. Por ejercicio: `progresando` ·
`estancada` · `retrocediendo` · `datos insuficientes`. Es lo que hace posible responder
«¿desde cuándo estoy estancada?» con una fecha en vez de una impresión.

**Nivel 3 · adaptación — semanas.** Nuevo. Lee tendencias + auditoría de volumen +
readiness + adherencia + seguridad + fase + objetivos, y emite sugerencias. Nunca aplica
nada solo.

### La regla contra la caja negra

Toda recomendación tiene que traer su razón. La forma de garantizarlo no es acordarse de
escribirla: es **hacer que el motor no pueda emitir una sugerencia sin datos observados
dentro**. Por eso la razón es una estructura, no una cadena de texto.

```ts
type Rationale = {
  code: "reps-top-not-reached" | "rir-below-target"
      | "no-load-change-3-sessions" | "volume-below-range"
      | "readiness-declining" | "pain-reported" | …
  observed: unknown    // los números exactos que la disparan
  evidenceId?: string  // enlaza a content/sources.yaml
}

type Suggestion = {
  kind: "increase-load" | "hold" | "add-set" | "reduce-volume"
      | "swap-exercise" | "increase-cardio" | "deload" | …
  scope: AdjustmentScope
  because: Rationale[]        // nunca vacío: si lo está, no hay sugerencia
  confidence: "clear" | "tentative"
  status: "pending" | "accepted" | "rejected"
}
```

Aceptar una sugerencia escribe un `PlanAdjustment` con `origin: "coach"` y la sugerencia
enganchada. Así el plan de diciembre puede explicar cada uno de sus números remontándose
hasta la sesión concreta que lo motivó.

> **El motor es determinista, no un modelo de lenguaje.** Reglas puras sobre datos
> estructurados, con pruebas. Si más adelante interesa que un modelo redacte mejor las
> frases, que redacte — pero que no decida. Un motor que decide y no se puede probar es
> exactamente la caja negra que hay que evitar.

### Los dos niveles de decisión del motor

El motor no puede opinar sobre el cuerpo con datos de gimnasio. Son dos niveles con
entradas distintas, y el segundo está **cerrado por precondición**, no por buena voluntad.

| Nivel | Entradas | Puede sugerir | Estado |
|---|---|---|---|
| **Entrenamiento** | carga, reps, RIR, seguridad, readiness, volumen | subir/mantener carga, añadir/quitar serie, cambiar ejercicio, deload, revisar recuperación | disponible en E6 |
| **Composición corporal** | + nutrición, peso medio semanal, cintura, energía/hambre, adherencia | cambios de cardio orientados a pérdida de grasa, decisiones de recomposición | **bloqueado hasta E7** |

```ts
type EngineTier = "training" | "body-composition"

/**
 * El nivel corporal no se activa hasta que sus entradas existen y tienen
 * recorrido suficiente. Devuelve qué falta, para que la app lo diga en vez
 * de callarse o, peor, de opinar igualmente.
 */
function bodyCompositionInputsReady(state: EngineState): {
  ready: boolean
  missing: Array<"nutrition" | "weight-trend" | "waist" | "energy" | "adherence">
  weeksOfData: number
}
```

Mientras `ready` sea falso, el motor **no emite ninguna sugerencia de ese nivel**. La
pantalla muestra qué falta para poder decir algo. Es la diferencia entre «todavía no puedo
responder a esto» y una conclusión corporal sacada de tres semanas de cargas.

### Auditoría de volumen: planificado contra realizado

Son dos preguntas distintas y no se pueden mezclar sin convertir la adherencia en
programación.

```ts
type VolumeAudit = {
  weekOf: IsoDate
  byMuscle: Record<MuscleId, {
    planned:   { direct: number; indirect: number }
    performed: { direct: number; indirect: number }
  }>
}
```

- **`planned`** sale del plan resuelto para esa semana — de la instantánea donde la sesión
  ya empezó, y del plan resuelto para los días que aún no han llegado.
- **`performed`** sale de las series de trabajo efectivamente completadas.
- **Directo e indirecto nunca se suman.** Cuatro cifras por músculo, siempre separadas.

Así la frase que la pantalla puede decir es «el plan prescribía 6 series de isquios y
completaste 4», que son dos hechos, en vez de un «4 series» que no dice si el problema fue
el plan o la semana.

---

## 7. Qué va en el servidor

Casi nada, y a propósito. Una sesión empezada tiene que seguir registrándose sin internet:
toda lógica que viva en el servidor es lógica que no funciona en el sótano del gimnasio.
La arquitectura actual ya acertó aquí y no la tocaría.

**Servidor — `api/`**

- **Sincronización** — intercambio de registros, último en escribir gana. Sólo hay que
  añadir las colecciones nuevas a la lista permitida.
- **Recordatorios push** — lo único que no puede correr en un navegador cerrado.
- **Fotos: no.** Decidido — se quedan sólo en el dispositivo. Entran en el backup, que es
  lo que las protege de un borrado del navegador. La sincronización entre dispositivos se
  podrá activar más adelante como opción explícita, nunca por defecto.

Ningún cálculo. El servidor no sabe qué es una serie.

**Navegador — `src/domain/`**

- Resolución del plan — plegar ajustes sobre la base.
- Progresión, tendencia, motor — funciones puras, probadas.
- Auditoría de volumen, revisiones, diffs de versión.
- Todo lo que decide algo.

Sin React y sin E/S, como ya es hoy. Es la parte que puede estar mal, y por eso es la
única con pruebas.

El reparto real no es servidor contra navegador: es **`domain/` contra todo lo demás**.
Una regla que decida algo y viva en un componente de React es una regla que nadie va a
probar.

---

## 8. Pantallas

Cinco pestañas hoy. Siguen siendo cinco: añadir una sexta por cada módulo nuevo es cómo
una app se vuelve un panel de control. Lo nuevo entra por dentro.

**Hoy** *(existe)* — Antes de empezar: check-in de readiness, seis deslizadores, diez
segundos. Dentro: el ejecutor actual + cambiar ejercicio por sustitución real, marcar
molestia con zona, y elegir máquina la primera vez. Al terminar: resumen y qué toca el
próximo día.

**Plan** *(sustituye a Inspo como pestaña)* — Calendario semanal y mensual con estados y
reprogramación, fase actual y siguiente, historial de versiones con sus diffs, y las
sugerencias pendientes del motor con su porqué. Es la pestaña donde se decide, separada de
donde se entrena.

**Progreso** *(existe, se amplía)* — Peso medio semanal en vez de la fluctuación diaria,
cintura y cadera, auditoría de volumen por grupo muscular, fotos con comparador
antes/después, y el checkpoint de 4 semanas. Inspo entra aquí dentro.

**Tobillo** *(existe)* — El chequeo comparativo que ya está, más la sesión de rehab como
registro propio y la progresión de etapas. Y el aviso de evaluación profesional cuando se
repiten señales — que ya está escrito en `sources.yaml` y hoy no se muestra.

**Historial** *(existe, se amplía)* — Lo que hay, más la vista por ejercicio: serie
temporal de carga, reps y volumen, mejor marca, y — importante — separada por máquina,
porque 20 kg en dos prensas no son el mismo dato.

Nutrición no es pestaña: es una tarjeta de un toque en Hoy con el banco de comidas
frecuentes. Un módulo de nutrición con su propia sección es un módulo que se deja de
rellenar en dos semanas.

---

## 9. Plan de migración

Siete etapas. Cada una se puede desplegar y usar sin que la siguiente exista, y ninguna
pierde un dato. El orden no es negociable en un punto: la biblioteca va antes que todo,
porque el volumen, las sustituciones y el motor dependen de ella.

### E0 · Red de seguridad

Backup completo antes de tocar nada. Y pruebas de referencia que capturen lo que el motor
sugiere *hoy* para los datos actuales, para que cualquier etapa que cambie una sugerencia
sin querer falle en vez de pasar desapercibida.

*Toca:* nada de producción · *Riesgo:* ninguno

### E1 · Biblioteca de ejercicios

Extraer las definiciones duplicadas de dentro de las sesiones a un `library.yaml`,
absorber el registro de `exercise-ids.ts` y añadir músculos tipados, patrón, equipo y
sustituciones como referencias. Las sesiones pasan a referenciar ids.

*Desbloquea:* §7 · §12 · §25 · §26 · *Riesgo:* bajo — sólo contenido

### E2 · Fases abiertas y dinámicas

`PhaseId` de `1|2|3|4` a `string`. 38 referencias, mecánico pero real. Migración de los
`SessionRecord.phase` ya guardados: `1 → "adaptacion"`, etcétera. Y el registro de
`PhaseTransition`, con `phaseForDate()` leyendo transiciones en vez de fechas (§2.1). Las
transiciones ya ocurridas se siembran desde las fechas planificadas actuales con
`trigger: "planned"`, que deja el comportamiento idéntico al de hoy.

*Desbloquea:* la fase 5 de España desde datos · *Riesgo:* medio — toca datos guardados

### E3 · Las tres capas

La etapa grande. `PrescriptionBaseline` + `PlanAdjustment` + `SessionPlanSnapshot`, y la
función de resolución con sus pruebas. Los `ExerciseOverride` existentes se convierten en
ajustes con `effectiveFrom` = inicio del programa y `origin: "manual"`, que es lo
conservador: el plan resuelto queda idéntico al de hoy, así que nada visible cambia.

*Desbloquea:* §2 · §5 · §11 · *Riesgo:* alto — es donde hay que ir despacio

### E4 · Versionado y diff

Etiquetas de versión, comparación entre dos fechas, y la pantalla de «qué cambió y por
qué». Casi todo es lectura sobre lo que E3 dejó montado.

*Desbloquea:* §5 · §21 · *Riesgo:* bajo

### E5 · Volumen y readiness

Auditoría de series efectivas por grupo y semana, y el check-in previo. Los dos son
entradas del motor, así que van antes que él.

*Desbloquea:* §12 · §19 · *Riesgo:* bajo

### E6 · Motor de adaptación

Tendencias, detección de estancamiento, sugerencias con razón estructurada, y el enganche
aceptar → ajuste. Con sus pruebas, que aquí no son opcionales.

*Desbloquea:* §11 · §31 · *Riesgo:* medio — reglas, no datos

### E7 · Los módulos que faltan

Cardio, rehab y nutrición como registros propios; medidas y fotos separadas con
comparador; calendario con reprogramación; historial por ejercicio; perfil y objetivos;
evidencia enlazada a las decisiones. Independientes entre sí — el orden se elige según qué
haga más falta en diciembre.

*Desbloquea:* §3 · §13–18 · §23 · §24 · §30 · *Riesgo:* bajo

### Los tres puntos donde se puede perder algo

1. **E2 cambia un campo ya guardado** — migración idempotente y backup previo obligatorio.
2. **E3 reinterpreta los overrides** — se eligen los valores que dejan el plan resuelto
   exactamente igual que hoy, para que la migración sea invisible.
3. **Las fotos** — hoy sobreviven al backup pero no se sincronizan, así que un cambio de
   dispositivo sin exportar las deja atrás. Eso se arregla en E0, no en E7.

---

## 10. Lo que no se va a construir

- **Nada social, ni rankings, ni rachas premiadas.** Además de no pedirse, contamina los
  datos: una racha que proteger es un motivo para registrar una sesión que no se hizo.
- **Ningún juicio automático sobre el cuerpo en las fotos.** Se guardan, se comparan lado
  a lado, y nada más.
- **Ningún diagnóstico.** El tobillo se mide y se compara; cuando aparecen dolor
  persistente, hinchazón, episodios repetidos o bloqueo, la app dice que eso lo mira un
  profesional, y deja de sugerir progresión. Esa regla ya existe en `safety.ts` y sólo se
  amplía.
- **Ningún ajuste automático del plan.** El motor sugiere; la persona acepta. Un plan que
  se modifica solo es un plan del que no puedes fiarte cuando más importa.
- **Ninguna estimación disfrazada de medición.** Si no hay datos suficientes para decir
  algo cierto, la respuesta es «todavía no», no un número tranquilizador. Ese principio ya
  está escrito en `achievements.ts` y es de lo mejor que tiene el proyecto.

---

## Estado de las decisiones

| Decisión | Estado |
|---|---|
| Versiones = etiqueta sobre el registro de ajustes | **Aprobado** |
| YAML siembra la v1, la base de datos manda después | **Aprobado** |
| Fases dinámicas: transición como evento, fechas sólo planificadas (§2.1) | **Aprobado** |
| Append-only estricto: revocar es un evento nuevo, nunca un `UPDATE` (§2.2) | **Aprobado** |
| Volumen planificado y realizado separados, directo e indirecto sin sumar | **Aprobado** |
| Motor por niveles: lo corporal bloqueado hasta tener sus entradas | **Aprobado** |
| Fotos local-only por defecto; backup sí, sync después y explícito | **Aprobado** |
| Orden: E0 → E1 → E2 → E3 → E4, con revisión entre cada etapa | **Aprobado** |

Sobre la segunda: `content/program.yaml` sigue siendo la semilla y no se toca. A partir de
ahí el plan vive en la base de datos como base + ajustes. Mantiene la privacidad actual —
el YAML sigue gitignored y fuera de Vercel — y permite editar el plan desde el móvil.

Ninguna etapa avanza a la siguiente sin revisión. La especificación de E0 y E1 está en
[`E1-biblioteca.md`](./E1-biblioteca.md).
