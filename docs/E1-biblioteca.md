# E0 · Red de seguridad — E1 · Biblioteca de ejercicios

Especificación para revisión. **Nada de esto está implementado todavía.**

Contexto en [`arquitectura.md`](./arquitectura.md). E1 no toca `setsByPhase`, ni fases, ni
la base de datos: eso es E2 y E3.

> **Revisión 3 — final** — anatomía separada de función (`FunctionalTarget`), estímulo
> intrínseco separado del rol prescrito (`stimulusType` / `trainingRole`, que dejan
> `volumeAuditMode` e `isRehabExercise` sin razón de existir), `jointLoads` tipado en los
> 26 ejercicios, y `chest_press` reclasificada como señal de prescripción.
>
> Revisión 2 — patrones anatómicos, `MuscleId` separado de la agrupación de presentación,
> sustituciones y señales de técnica en dos niveles, `jointLoads` / `isRehabExercise`.

---

## Lo que encontré al medir

Tres sesiones definen **26 instancias de ejercicio** que son en realidad **14 movimientos**.
Once de los catorce están duplicados, y **todos los duplicados han divergido**:

| Ejercicio | Aparece en | Diverge en |
|---|---|---|
| `bike_warmup` | A, B, C | técnica, sustitución, objetivo, target (8–10 min ≠ 8–8 min) |
| `leg_press` | A, B, C | técnica (3 versiones), objetivo, RIR (2–3 ≠ 2–2) |
| `leg_curl` | A, C | nombre, técnica, objetivo, RIR |
| `seated_row` | A, C | técnica, objetivo, RIR |
| `chest_press` | A, C | técnica, objetivo, RIR |
| `lateral_raise` | A, C | nombre, técnica, sustitución, objetivo |
| `biceps_curl` | A, C | nombre, técnica, sustitución, objetivo |
| `cable_crunch` | A, C | técnica, objetivo |
| `lat_pulldown` | B, C | músculo, técnica, **sustitución (dos distintas de verdad)**, objetivo |
| `triceps_extension` | B, C | nombre, técnica, sustitución, objetivo |

No todas las divergencias son ruido. Hay tres tipos, y sólo el primero se unifica:

- **Ruido del Excel** — nombres escritos de dos formas, o el mismo movimiento clasificado
  como «Dorsal» en una sesión y «Dorsal + bíceps» en otra. → **biblioteca**.
- **Prescripción por sesión** — `goal` dice cosas distintas a propósito, `rir` es 2–3 en A
  y 2–2 en C, el calentamiento es 8–10 min en A y 8 fijos en C. → **plantilla, intacto**.
- **Técnica y sustituciones** — mezcla de las dos anteriores, y por eso van clasificadas
  una a una. Ver apartados 2.5 y 2.6.

### La buena noticia: los ids ya están limpios

| Fuente | Ids |
|---|---|
| `EXERCISE_REGISTRY` | 26 |
| Sesiones de fuerza | 14 |
| Rehabilitación (`program.yaml`) | 10 |
| Rehabilitación (`ankle-protocol.yaml`) | 10 — **idénticos** a los anteriores |
| Sesión base sembrada | 9 |
| `LEGACY_IDS` → destinos | 24 → todos dentro del registro |

**Ids usados en contenido pero ausentes del registro: ninguno.**
En el registro pero sin usar: `cardio_machine` (lo usa `cardio-day.ts`) y `dead_bug`
(resto del Excel v2).

La biblioteca se teclea con los ids que ya existen. No es un renombrado.

---

## 1. Archivos exactos

### E0 · red de seguridad — sólo añade

| Archivo | Qué |
|---|---|
| `src/domain/__fixtures__/log.ts` | **nuevo** · Registro sintético congelado: 6 semanas, las 3 sesiones, casos frontera. No son datos reales. |
| `src/domain/characterisation.test.ts` | **nuevo** · Congela lo que el motor decide **hoy**, decisión a decisión. |
| `src/lib/backup.test.ts` | **nuevo** · Ida y vuelta del backup. Hoy `backup.ts` no tiene ninguna prueba, y es lo único que se interpone entre tú y perder el historial. |

Cero modificaciones. E0 no puede romper nada porque no toca nada.

### E1 · biblioteca

| Archivo | Qué |
|---|---|
| `content/library.yaml` | **nuevo** · Las 26 definiciones. Gitignored. |
| `content.example/library.yaml` | **nuevo** · Contrapartida pública genérica. |
| `src/domain/muscles.ts` | **nuevo** · `MuscleId`, `MuscleGroup`, y la agrupación como función pura. |
| `src/domain/library.ts` | **nuevo** · Búsqueda por id, índice de alias, composición biblioteca + plantilla → `Exercise`. |
| `src/domain/library.test.ts` | **nuevo** · Ver apartado 4. |
| `src/domain/muscles.test.ts` | **nuevo** · Ver apartado 4. |
| `src/domain/schema.ts` | **modificar** · Añadir `ExerciseDef`, `ExerciseAlias`, `SubstitutionRef`, `Equipment`, `WorkoutTemplateExercise`, `ExerciseLibrary`. **No se toca nada de lo existente.** |
| `src/domain/exercise-ids.ts` | **modificar** · Registro derivado de la biblioteca. **API pública idéntica.** |
| `src/lib/content.ts` | **modificar** · Cargar y validar `library.yaml`. |
| `scripts/import-excel.ts` | **modificar** · Emitir `library.yaml` y plantillas delgadas. |
| `scripts/verify-import.ts` | **modificar** · Verificar cobertura. |
| `scripts/make-example.ts` | **modificar** · Generar el ejemplo público. |

### Lo que NO se toca

**Ningún archivo de `src/components/` ni de `src/routes/`.** Criterio de aceptación, no
aspiración. E1 cambia de dónde salen los datos, no qué forma tienen: el tipo `Exercise`
que consumen los componentes queda idéntico.

Tampoco: `collections.ts`, `records.ts`, `synced.ts`, `sync.ts`, `api/`, `progression.ts`,
`safety.ts`, `phases.ts`, `personalise.ts`, `history.ts`, `achievements.ts`,
`migrate-exercise-ids.ts`, `seed.ts`.

---

## 2. Los modelos

### 2.1 `MuscleId` — anatómico, granular

Es lo único que declara un ejercicio y lo único sobre lo que se calcula la auditoría.
Ninguna agregación vive aquí.

```ts
export type MuscleId =
  // tren inferior
  | "quads" | "hamstrings"
  | "glute_max" | "glute_med"
  | "adductors" | "calves"
  // tobillo — músculos reales, no funciones
  | "tibialis" | "peroneals"
  // torso
  | "chest" | "lats" | "mid_back" | "lower_back"
  // hombro — los tres cabos, siempre distinguibles
  | "front_delts" | "side_delts" | "rear_delts"
  // brazo
  | "biceps" | "triceps" | "forearms"
  // core
  | "abs" | "obliques"
```

Veinte músculos. `glute_max` y `glute_med` separados; `adductors` no vive dentro de
glúteos; `forearms` no vive dentro de bíceps; los tres deltoides son tres.

**`ankle_stabilisers` sale de aquí.** No es un músculo: es una función que reparten los
peroneos, el tibial posterior, los intrínsecos del pie y el control neuromuscular. Dejarlo
como `MuscleId` haría que `single_leg_balance` acabara contando «3 series directas de
estabilizadores», que es exactamente la conclusión falsa que hay que evitar.

Lo que sí es anatómico se queda con su nombre real: `band_eversion` entrena los
**peroneos**, y eso es un músculo, así que `peroneals` entra en la lista.

### 2.1b `FunctionalTarget` — el objetivo que no es un músculo

```ts
export type FunctionalTarget =
  /** Resistir que el tobillo se vaya: estático y reactivo. */
  | "ankle_stability"
  /** Control del movimiento dentro del rango: dinámico y direccional. */
  | "ankle_control"
  /** Equilibrio global, no específico del tobillo. */
  | "balance"
```

Tres, con definiciones distintas para que no sean sinónimos disfrazados. Un ejercicio
puede declarar músculos, objetivos funcionales, o ambos: `step_down` entrena cuádriceps
**y** control de tobillo, y las dos cosas son ciertas a la vez.

Los objetivos funcionales **no entran nunca en la auditoría de series por músculo**. Se
cuentan aparte, y cómo se ponderan lo decide E5.

### 2.2 `MuscleGroup` — presentación, y sólo presentación

```ts
export type MuscleGroup =
  | "quads" | "hamstrings" | "glutes" | "adductors" | "calves"
  | "chest" | "back" | "shoulders"
  | "biceps" | "triceps" | "forearms"
  | "core" | "ankle"

/** Pura, total y sin solapes. La única forma de agregar. */
export function groupOf(muscle: MuscleId): MuscleGroup
```

| Grupo | Músculos |
|---|---|
| `quads` | quads |
| `hamstrings` | hamstrings |
| `glutes` | glute_max, glute_med |
| `adductors` | adductors |
| `calves` | calves |
| `chest` | chest |
| `back` | lats, mid_back, lower_back |
| `shoulders` | front_delts, side_delts, rear_delts |
| `biceps` | biceps |
| `triceps` | triceps |
| `forearms` | forearms |
| `core` | abs, obliques |
| `ankle` | tibialis, peroneals |

**El invariante que hace que esto funcione:**

> La auditoría de volumen se calcula y se devuelve **siempre indexada por `MuscleId`**.
> `groupOf()` se aplica en el momento de pintar, nunca antes. Agregar es una vista, no un
> paso del cálculo.

De ahí sale lo que pedías: `side_delts` se audita suelto porque el dato *nace* suelto, y
que la UI también sepa sumarlo a `shoulders` no lo destruye. Esto además disuelve la
pregunta que te había hecho en la revisión anterior — ya no hay que decidir si el deltoide
lateral «va separado o no», porque va las dos cosas.

Un `ExerciseDef` **no puede declarar un `MuscleGroup`**. Sólo `MuscleId`. Con prueba.

### 2.3 `MovementPattern` — anatómico, no nombres de ejercicio

```ts
export type MovementPattern =
  // cadera y rodilla
  | "squat" | "hinge" | "lunge"
  | "knee_flexion" | "hip_extension" | "hip_abduction"
  // torso
  | "horizontal_push" | "horizontal_pull"
  | "vertical_push"   | "vertical_pull"
  | "shoulder_abduction"
  // brazo
  | "elbow_flexion" | "elbow_extension"
  // core
  | "anti_extension" | "anti_rotation" | "trunk_flexion"
  // tobillo
  | "ankle_plantarflexion" | "ankle_dorsiflexion" | "ankle_eversion"
  // no clasificables por articulación
  | "balance" | "mobility" | "cardio"
```

Aplicadas tus cuatro correcciones: `knee_flexion` para el curl femoral, `hip_extension`
para el kickback, `ankle_eversion` y `ankle_dorsiflexion` para las de banda.
`knee_to_wall` se queda en `mobility`.

**Y dos más que propongo por el mismo criterio, para que las apruebes o las rechaces:**

| Antes | Ahora | Por qué |
|---|---|---|
| `lateral_raise` | `shoulder_abduction` | «Elevación lateral» es el nombre del ejercicio, no del movimiento — el mismo error que corregiste en `band_eversion` |
| `calf_raise` | `ankle_plantarflexion` | Igual; y deja los tres patrones de tobillo con la misma forma |

`hinge` queda sin usar en los 26 actuales. Lo mantengo en la taxonomía porque es un patrón
real que hará falta en cuanto entre un peso muerto rumano, no porque haga falta hoy.

### 2.4 `ExerciseDef` — la identidad del movimiento

```ts
export type ExerciseDef = {
  /** Id canónico. NUNCA cambia. Es la clave de todo el historial. */
  id: CanonicalId

  /** Nombre preferido. Puede cambiar sin consecuencias: no es identidad. */
  name: string
  aliases: ExerciseAlias[]

  /** Sólo MuscleId. Nunca un grupo. Puede estar vacío. */
  primaryMuscles: MuscleId[]
  secondaryMuscles: MuscleId[]
  /** Lo que el ejercicio persigue y no es un músculo. Ver 2.1b. */
  functionalTargets: FunctionalTarget[]
  pattern: MovementPattern

  /** Qué tipo de estímulo da. Intrínseco. Ver 2.4b. */
  stimulusType: StimulusType

  /** Clase de equipo. La máquina concreta es `Equipment`. */
  equipmentKind: EquipmentKind

  /** Técnica GENERAL del movimiento: cierta en cualquier sesión. */
  cues: string[]
  commonErrors: string[]

  /** Rango típico del movimiento. NO es la prescripción. */
  typicalReps: Range | null
  defaultRestSeconds: Range | null

  /** CATÁLOGO de alternativas conocidas. No implica que se ofrezcan. */
  substitutions: SubstitutionRef[]

  cautions: string[]

  /** Qué articulaciones carga. Entrada futura de las reglas de seguridad. */
  jointLoads: JointId[]

  media: { kind: "image" | "video"; url: string }[]
}

export type JointId =
  | "ankle" | "knee" | "hip" | "lumbar"
  | "thoracic" | "shoulder" | "elbow" | "wrist" | "cervical"

export type EquipmentKind =
  | "machine" | "cable" | "dumbbell" | "barbell"
  | "band" | "bodyweight" | "cardio_machine" | "none"
```

**`notes` (notas personales) sigue aplazado a E3**, con el motivo de siempre: es dato tuyo,
y en el YAML se perdería al reimportar el Excel.

### 2.4b Estímulo contra rol — y por qué `volumeAuditMode` desaparece

«Rehab» no es una propiedad del movimiento. `calf_raise` lo demuestra: hoy está en el
protocolo, y mañana puede aparecer como trabajo de fuerza sin cambiar de `exerciseId`. Lo
intrínseco es **qué tipo de estímulo da**; lo prescrito es **para qué se usa**.

```ts
/** Intrínseco al movimiento. Vive en ExerciseDef. */
export type StimulusType = "resistance" | "balance" | "mobility" | "cardio"

/** De la prescripción. Vive en WorkoutTemplateExercise. */
export type TrainingRole = "strength" | "rehab" | "warmup" | "cardio"
```

`isRehabExercise` sale de `ExerciseDef`. No era una propiedad del ejercicio.

**Y `volumeAuditMode` se borra**, porque con estos dos campos queda enteramente derivado y
guardar los dos sería guardar lo mismo dos veces:

```ts
// ¿aporta series musculares?   →  intrínseco
const countsAsMuscularVolume = def.stimulusType === "resistance"

// ¿a qué cubo van?             →  prescrito
const bucket = templateEntry.trainingRole
```

Comprobado contra los tres casos que antes necesitaban el campo: `knee_to_wall` no aporta
porque es `mobility`; `single_leg_balance` no aporta porque es `balance`; `bike_warmup` no
aporta porque es `cardio`. Ninguno necesita que se lo digan por separado.

Lo que gana la auditoría de E5 es justo lo que pedías — dos dimensiones que nunca se suman
en silencio:

```
quads
  strength.direct = 6      ← leg_press en Full Body A/B/C
  rehab.direct    = 2      ← step_down, misma contribución muscular real,
                             etiquetada por su procedencia
```

`step_down` deja de ser un caso dudoso: es `resistance` + `rehab`, así que **sí** aporta
series de cuádriceps, y se ven como series de rehabilitación. La pregunta que había dejado
abierta se disuelve en lugar de decidirse.

### 2.5 Sustituciones en dos niveles

```ts
export type SubstitutionRef =
  | {
      kind: "exercise"
      exerciseId: CanonicalId
      equivalence: "same_pattern" | "same_muscle" | "regression" | "progression"
      reason: string
    }
  /** Texto del Excel que todavía no es un ejercicio de la biblioteca. */
  | { kind: "note"; text: string }
```

| Dónde | Qué significa |
|---|---|
| `ExerciseDef.substitutions` | **Catálogo.** Todo lo que se sabe que puede sustituir a este movimiento, venga de donde venga. |
| `WorkoutTemplateExercise.allowedSubstitutions` | **Permiso.** Lo que esta prescripción concreta admite. |

El caso que lo motiva: `lat_pulldown` ofrece «Jalón agarre neutro» en B y «Pullover
máquina/polea» en C. Las dos entran al catálogo; **cada plantilla conserva exactamente la
suya**. Que el pullover exista como alternativa no lo convierte en opción de todas las
exposiciones de jalón.

Comportamiento en el gimnasio: el botón CAMBIAR EJERCICIO ofrece
`allowedSubstitutions`. El catálogo completo queda detrás de un «ver todas», explícito y
nunca por defecto.

**Sigue sin haber ningún campo para compartir historial de cargas, y no lo habrá.** Un id
distinto es un historial distinto. El caso de «mismo movimiento, otro nombre» lo resuelven
los alias, que comparten id.

### 2.6 Señales de técnica en dos niveles

| Dónde | Qué significa |
|---|---|
| `ExerciseDef.cues` | Técnica **general**: cierta en cualquier sesión, cualquier fase, cualquier persona que haga ese movimiento. |
| `WorkoutTemplateExercise.cues` | Instrucción **de esta prescripción**: una acomodación, un recordatorio cruzado, algo atado a esta exposición concreta. |

Clasificación completa de las 16 señales del Excel. **Ésta es la tabla que más quiero que
revises**, porque es donde puedo equivocarme de criterio:

| Ejercicio | Señal | Origen | Clasificación |
|---|---|---|---|
| `bike_warmup` | «No convertirlo en cardio duro» | A | **general** — el ejercicio canónico *es* un calentamiento, así que la señal es del movimiento |
| `leg_press` | «Pies algo más altos por tobillo» | A | **prescripción** — acomodación por tu tobillo, no propiedad de la prensa |
| `leg_press` | «Misma postura sin dolor» | B | **prescripción** — se refiere a mantener la postura de A |
| `leg_curl` | «Bajada controlada» | A | **general** |
| `seated_row` | «Sin balancear torso» | A | **general** |
| `chest_press` | «No llegar al fallo sola» | A | **prescripción** — habla de entrenar sin quien te ayude, que es contexto tuyo, no técnica del press |
| `lateral_raise` | «Sin encoger hombros» | A | **general** |
| `biceps_curl` | «Codos estables» | A | **general** |
| `cable_crunch` | «Flexionar tronco, no tirar con brazos» | A | **general** |
| `glute_kickback` | «No arquear lumbar» | B | **general** |
| `lat_pulldown` | «Agarre cómodo; no detrás de cabeza» | B | **general** |
| `shoulder_press` | «Sin hiperextender espalda» | B | **general** |
| `triceps_extension` | «Codos pegados» | B | **general** |
| `hip_abduction` | «Control, sin rebotes» | B | **general** |
| `pallof_press` | «No rotar» | B | **general** |
| `soft_surface_balance` | «No ojos cerrados al principio» | rehab | **prescripción** — es una instrucción de etapa, no de técnica |

**Doce generales, cuatro de prescripción.** Las tres que señalaste como ejemplo de lo que
no debe universalizarse son tres de las cuatro; la cuarta es la instrucción de etapa del
balance en superficie blanda.

`chest_press` es el caso interesante: parece técnica pero no lo es. «No llegar al fallo
sola» no describe cómo se hace un press de pecho — describe una precaución que depende de
que entrenes sin nadie que te descargue la máquina. E3 podrá convertirla en una regla de
seguridad personal, que es su sitio natural.

### 2.7 `jointLoads` y la compatibilidad de `isAnkle`

Tenías razón y los datos lo confirman. Hoy `isAnkle` vale:

| | `isAnkle` |
|---|---|
| `leg_press` | **`true`** — carga el tobillo y **no** es rehabilitación |
| los otros 13 de fuerza | `false` |
| los 10 de rehabilitación | `true` |

O sea que el campo ya está conflacionando las dos cosas, y `leg_press` es la prueba
viviente. La sustituyen `jointLoads` (intrínseco) y `trainingRole` (prescrito).

Para no romper nada en E1, el `Exercise.isAnkle` que consumen `progression.ts` y los
componentes se **deriva**, y resulta más simple de lo que parecía:

```ts
isAnkle = jointLoads.includes("ankle")
```

- `leg_press` → `[knee, hip, ankle]` → `true` ✓
- `bike_warmup` → `[knee, hip]` → `false` ✓
- los otros 12 de fuerza → sin tobillo → `false` ✓
- los 10 de rehabilitación → **no pasan por aquí**: `cardio-day.ts::rehabAsExercise()` ya
  fija `isAnkle: true` a mano, y ese archivo no se toca ✓

Reproduce los 26 valores actuales exactamente, con una prueba contra fixture congelado.

Nota sobre `bike_warmup`: le asigno `[knee, hip]` sin tobillo, y no por conveniencia. El
criterio es «un dolor ahí sería motivo de modificar el ejercicio», y una bici suave de 8–10
minutos es precisamente lo que **se conserva** con el tobillo molesto — es la opción de
descarga, no la que se retira. `cardio_machine` sí lleva tobillo porque su contenido
incluye caminata.

### 2.8 `WorkoutTemplateExercise` — la prescripción

```ts
export type WorkoutTemplateExercise = {
  exerciseId: CanonicalId
  order: number

  /** Cuando esta sesión lo llama distinto. Presentación, no identidad. */
  displayName?: string

  /** Intactos en E1. E3 los sustituye por PrescriptionBaseline. */
  setsByPhase: { 1: SetCount; 2: SetCount; 3: SetCount; 4: SetCount }
  target: Target
  load: Load
  rir: Range | null
  /** Override del defaultRestSeconds de la biblioteca. */
  restSeconds: Range | null

  goal: string
  progression: string

  /** Para qué se usa aquí. Ver 2.4b. */
  trainingRole: TrainingRole

  /** Específicas de esta prescripción. Ver 2.6. */
  cues: string[]
  /** Lo que ESTA prescripción admite. Ver 2.5. */
  allowedSubstitutions: SubstitutionRef[]
}
```

### 2.9 `ExerciseAlias` y `Equipment`

```ts
export type ExerciseAlias = {
  name: string
  source?: "spreadsheet-v2" | "spreadsheet-v3" | "gym" | "manual"
}

export type Equipment = {
  id: string              // "titanus_leg_press_incline"
  name: string
  gym: string
  kind: EquipmentKind
  /** El salto mínimo REAL. Hoy no existe, y por eso las subidas usan 2.5 kg inventado. */
  incrementKg: number | null
  minLoadKg: number | null
  maxLoadKg: number | null
  loadsPerSide: boolean
  stackUnit: "kg" | "plate" | "level"
  notes: string
}
```

`Equipment` en E1 es sólo el tipo y su validación; el cableado a `PerformedSet` es E3,
porque toca registros guardados. Regla de indexado para entonces: **carga y sugerencias por
`(exerciseId, equipmentId)`; volumen por `exerciseId` solo.**

---

## 3. Migración sin tocar un solo id

**Garantía central: E1 no cambia ningún `exerciseId`.** Sin renombrados, sin
reasignaciones, sin `UPDATE` sobre la base de datos. No es que la migración vaya con
cuidado: **no hay migración de datos que hacer.**

### Cómo se construye `library.yaml`

| Campo | Regla | Riesgo |
|---|---|---|
| `id` | Literal | — |
| `name` | Primer alias del `EXERCISE_REGISTRY` | — |
| `aliases` | Unión de los nombres del registro y de los inline de sesión | — |
| `cues` | Sólo las **clasificadas como generales** en 2.6 | Clasificación revisable |
| `substitutions` | Unión de todas → **catálogo** | Ninguno: unir no descarta |
| `defaultRestSeconds` | El `restSeconds`, idéntico en todos los duplicados (comprobado) | — |
| `typicalReps` | Del `target` cuando es de reps y coincide; `null` si difiere | — |
| `primaryMuscles` / `secondaryMuscles` | Traducidos a mano. Tabla abajo | **Juicio humano** |
| `functionalTargets` | Asignados a mano | **Juicio humano** |
| `stimulusType` | Asignado a mano | **Juicio humano** |
| `pattern` | Asignado a mano | Revisable |
| `equipmentKind` | Asignado a mano | Revisable |
| `jointLoads` | **Los 26 tipados por completo.** Tabla abajo | Con prueba de exhaustividad |
| `commonErrors`, `cautions`, `media` | Vacíos; el Excel no los tiene | — |

### Qué se queda en la plantilla

`order` · `setsByPhase` · `target` · `load` · `rir` · `restSeconds` · `goal` ·
`progression` · `displayName` · **`trainingRole`** · **`cues` de prescripción** ·
**`allowedSubstitutions`**.

Todo lo que diverge a propósito sigue exactamente igual.

### Traducción muscular y de patrón

| Ejercicio | Primarios | Secundarios | Patrón |
|---|---|---|---|---|
| `bike_warmup` | — | — | `cardio` |
| `cardio_machine` | — | — | `cardio` |
| `leg_press` | `quads` | `glute_max`, `adductors` | `squat` |
| `leg_curl` | `hamstrings` | — | `knee_flexion` |
| `hip_abduction` | `glute_med` | `glute_max` | `hip_abduction` |
| `glute_kickback` | `glute_max` | `hamstrings` | `hip_extension` |
| `seated_row` | `mid_back`, `lats` | `biceps`, `rear_delts` | `horizontal_pull` |
| `lat_pulldown` | `lats` | `biceps`, `mid_back` | `vertical_pull` |
| `chest_press` | `chest` | `triceps`, `front_delts` | `horizontal_push` |
| `shoulder_press` | `front_delts` | `side_delts`, `triceps` | `vertical_push` |
| `lateral_raise` | `side_delts` | — | `shoulder_abduction` |
| `biceps_curl` | `biceps` | `forearms` | `elbow_flexion` |
| `triceps_extension` | `triceps` | — | `elbow_extension` |
| `cable_crunch` | `abs` | `obliques` | `trunk_flexion` |
| `pallof_press` | `obliques` | `abs` | `anti_rotation` |
| `dead_bug` | `abs` | `obliques` | `anti_extension` |
| `knee_to_wall` | — | — | `mobility` |
| `band_eversion` | `peroneals` | — | `ankle_eversion` |
| `band_dorsiflexion` | `tibialis` | — | `ankle_dorsiflexion` |
| `calf_raise` | `calves` | — | `ankle_plantarflexion` |
| `calf_raise_unilateral` | `calves` | — | `ankle_plantarflexion` |
| `single_leg_balance` | — | — | `balance` |
| `directional_reach` | — | `glute_med`, `quads` | `balance` |
| `star_reach` | — | `glute_med`, `quads` | `balance` |
| `step_down` | `quads` | `glute_med` | `lunge` |
| `soft_surface_balance` | — | — | `balance` |

Los cinco ejercicios de balance dejan de fingir que entrenan un músculo directo. Lo que
persiguen se declara en `functionalTargets`, abajo.

### Clasificación funcional, dosis y articulaciones

| Ejercicio | `stimulusType` | `functionalTargets` | `trainingRole` | `jointLoads` |
|---|---|---|---|---|
| `bike_warmup` | `cardio` | — | `warmup` | knee, hip |
| `cardio_machine` | `cardio` | — | `cardio` | knee, hip, ankle |
| `leg_press` | `resistance` | — | `strength` | knee, hip, ankle |
| `leg_curl` | `resistance` | — | `strength` | knee |
| `hip_abduction` | `resistance` | — | `strength` | hip |
| `glute_kickback` | `resistance` | — | `strength` | hip, lumbar |
| `seated_row` | `resistance` | — | `strength` | shoulder, elbow |
| `lat_pulldown` | `resistance` | — | `strength` | shoulder, elbow |
| `chest_press` | `resistance` | — | `strength` | shoulder, elbow |
| `shoulder_press` | `resistance` | — | `strength` | shoulder, elbow |
| `lateral_raise` | `resistance` | — | `strength` | shoulder |
| `biceps_curl` | `resistance` | — | `strength` | elbow |
| `triceps_extension` | `resistance` | — | `strength` | elbow |
| `cable_crunch` | `resistance` | — | `strength` | lumbar, thoracic |
| `pallof_press` | `resistance` | — | `strength` | lumbar, thoracic, shoulder |
| `dead_bug` | `resistance` | — | `strength` | lumbar, hip, shoulder |
| `knee_to_wall` | `mobility` | — | `rehab` | ankle, knee |
| `band_eversion` | `resistance` | `ankle_stability` | `rehab` | ankle |
| `band_dorsiflexion` | `resistance` | — | `rehab` | ankle |
| `calf_raise` | `resistance` | — | `rehab` | ankle |
| `calf_raise_unilateral` | `resistance` | `ankle_stability` | `rehab` | ankle |
| `single_leg_balance` | `balance` | `balance`, `ankle_stability` | `rehab` | ankle, knee, hip |
| `directional_reach` | `balance` | `ankle_control`, `balance` | `rehab` | ankle, knee, hip |
| `star_reach` | `balance` | `ankle_control`, `balance` | `rehab` | ankle, knee, hip |
| `step_down` | `resistance` | `ankle_control` | `rehab` | knee, ankle, hip |
| `soft_surface_balance` | `balance` | `balance`, `ankle_stability` | `rehab` | ankle, knee |

**`jointLoads` está completo para los 26, no sólo para el tobillo.** El criterio es el que
E6 necesitará: *articulaciones que el movimiento carga o desafía lo bastante como para que
un dolor ahí sea motivo de modificar*. Por eso `leg_curl` lleva `knee` y no `hip` — con la
cadera dolorida el curl femoral no es el problema — y por eso `glute_kickback` lleva
`lumbar`, que es justo lo que avisa su propia señal de técnica («No arquear lumbar»).

`wrist` y `cervical` quedan sin usar en los 26 actuales. Se mantienen en `JointId` por la
misma razón que `hinge` en los patrones: son reales y harán falta.

**Los dos ejercicios que quiero que mires dos veces:**

- **`step_down`** — lo puse en `rehab` porque su dosis la marca la etapa del protocolo
  («Sem 3–4»), pero entrena cuádriceps de verdad. Con el criterio contrario sería `normal`.
- **`band_dorsiflexion`** — sin objetivo funcional porque es trabajo directo de tibial
  anterior, más muscular que propioceptivo. Su hermano `band_eversion` sí lo lleva.

### Cambios visibles

**Mucho menores que en la revisión anterior**, precisamente por las correcciones de
sustituciones y cues.

Sólo las señales **generales** aparecen donde antes faltaban:

Catorce, verificadas una a una por el propio script de migración, que recompone su salida
y la compara con el original campo a campo.

**Señales generales que ahora aparecen donde faltaban (9):**

| Ejercicio | Sesión | Señal |
|---|---|---|
| `bike_warmup` | B, C | «No convertirlo en cardio duro» |
| `leg_curl` | C | «Bajada controlada» |
| `seated_row` | C | «Sin balancear torso» |
| `lateral_raise` | C | «Sin encoger hombros» |
| `biceps_curl` | C | «Codos estables» |
| `cable_crunch` | C | «Flexionar tronco, no tirar con brazos» |
| `lat_pulldown` | C | «Agarre cómodo; no detrás de cabeza» |
| `triceps_extension` | C | «Codos pegados» |

**Nombres que pasan al canónico (4).** Los antiguos quedan como alias, así que nada deja de
resolver:

| Sesión | Antes | Ahora |
|---|---|---|
| A | Curl femoral acostado/sentado | Curl femoral |
| A | Elevación lateral máquina/polea | Elevación lateral |
| A | Curl bíceps polea/máquina | Curl bíceps |
| B | Extensión tríceps polea | Extensión tríceps |

**Una línea de músculo (1).** `lat_pulldown` en C pasa de «Dorsal» a «Dorsal + bíceps»: se
conserva la redacción más completa de las dos que usaba la hoja, porque la corta perdía
información.

Los nombres visibles pasan al canónico («Curl femoral acostado/sentado» → «Curl femoral»,
etc.), con los antiguos como alias.

**Lo que ya NO cambia, gracias a tus correcciones:**

- **`leg_press` no cambia en ninguna sesión.** Sus dos señales son de prescripción, así que
  A sigue diciendo «Pies algo más altos por tobillo», B «Misma postura sin dolor» y C nada.
- **`chest_press` en C tampoco cambia**, tras reclasificar «No llegar al fallo sola».
- **Ninguna sustitución se mueve de sitio.** Cada plantilla conserva la suya; el pullover
  no aparece en B ni el agarre neutro en C.
- **Ningún RIR, target, serie ni carga cambia.**

---

## 4. Pruebas nuevas

### E0

**`characterisation.test.ts`** — para el registro sintético congelado, `decideProgression()`
devuelve exactamente lo que devuelve hoy. Incluye: RIR ausente → `hold`/`rirUnknown`;
series incompletas → `hold`/`setsIncomplete`; 12/10 → `hold`/`repsBelowTop`; 12/12 con
RIR 2 → `increase` con el incremento correcto; dolor 4/10 → `blocked` y **no** `increase`;
20 kg × 12 seguido de 25 kg × 8 → peso de trabajo 20; peso corporal con rango completado →
`advanceDifficulty`.

**`backup.test.ts`** — exportar, reimportar, comparar: mismos ids, sets y fotos. Y que un
archivo de formato desconocido se rechace en vez de vaciar la base.

### E1 · `library.test.ts`

1. **Cobertura total de ids** — la biblioteca contiene todos los ids de: sesiones,
   rehabilitación de los dos archivos, sesión sembrada, `EXERCISE_REGISTRY`, y todos los
   destinos de `LEGACY_IDS`. Respalda la garantía del apartado 3.
2. **Alias sin regresión** — cada alias del registro actual (congelado como fixture)
   resuelve al mismo id que antes.
3. **`migrateLegacyId` sin regresión** — las 24 entradas siguen resolviendo igual.
4. **Punteros de sustitución válidos** — toda `kind:"exercise"`, en el catálogo y en toda
   `allowedSubstitutions`, apunta a un id existente.
5. **Nada se perdió al fusionar** — cada `technique` y cada `substitution` no vacía del
   YAML original aparece **o** en la biblioteca **o** en su plantilla. Ninguna se evapora.
6. **`allowedSubstitutions` no se globalizó** — para cada plantilla, coincide exactamente
   con lo que decía su YAML. En concreto: `lat_pulldown` en B no ofrece el pullover, y en C
   no ofrece el agarre neutro.
7. **Los cues de prescripción no se universalizaron** — ninguna señal clasificada como de
   prescripción aparece en `ExerciseDef.cues`, y ninguna aparece en una plantilla distinta
   de la suya. En concreto: `leg_press` en C sigue sin señal.
8. **`isAnkle` equivalente** — `jointLoads.includes("ankle")` reproduce los valores
   actuales de las 16 instancias de plantilla, contra fixture congelado; las 10 de
   rehabilitación siguen viniendo de `cardio-day.ts`, intacto.
8b. **`jointLoads` exhaustivo** — los 26 declaran al menos una articulación, salvo los de
   patrón `cardio`, que pueden declararla igualmente pero no están obligados. Sin esto, E6
   tendría falsos negativos de seguridad: un ejercicio sin articulaciones tipadas nunca
   saltaría ante un dolor.
9. **Composición válida** — `resolveExercise(plantilla, biblioteca)` pasa el esquema
   `Exercise` de Zod para las 26 instancias. Es lo que garantiza que los componentes no se
   enteren.
10. **Sin huérfanos** — toda entrada se usa en alguna plantilla o en rehabilitación, salvo
    las declaradas sin uso (`cardio_machine`, `dead_bug`).

### E1 · `muscles.test.ts`

11. **Semántica de volumen, en lugar de la regla anterior.** Ya no se exige un primario a
    todo lo que no sea cardio o movilidad — eso obligaba a inventar músculos para el
    balance. En su lugar:
    - `stimulusType: "resistance"` ⟹ al menos un músculo primario. Lo que aporta series
      tiene que decir de qué músculo.
    - `stimulusType: "balance"` o `"mobility"` ⟹ al menos un objetivo funcional **o** un
      músculo secundario. Nada queda sin tipar, y el balance no finge un primario.
    - `stimulusType: "cardio"` ⟹ sin músculos primarios.
12. **Los objetivos funcionales no entran en la auditoría muscular** — la función que
    calcula series por músculo ignora `functionalTargets` por completo. Es la prueba que
    impide que `single_leg_balance` acabe siendo «3 series de estabilizadores».
12b. **`trainingRole` no altera la contribución muscular** — `step_down` aporta las mismas
    series de cuádriceps sea cual sea su rol; el rol sólo decide en qué cubo se muestran.
13. Ningún músculo es primario y secundario del mismo ejercicio.
14. **`groupOf` es total y sin solapes** — todo `MuscleId` pertenece a exactamente un
    `MuscleGroup`, y todo `MuscleGroup` tiene al menos un miembro.
15. **Granularidad preservada** — ningún `ExerciseDef` declara un `MuscleGroup`; el tipo lo
    impide y la prueba lo confirma sobre el YAML cargado.
16. **Agrupaciones concretas** — `groupOf("glute_max") === groupOf("glute_med") === "glutes"`;
    los tres deltoides caen en `shoulders`; `forearms` **no** cae en `biceps`; `adductors`
    **no** cae en `glutes`.
17. **`FunctionalTarget` y `MuscleId` son conjuntos disjuntos** — ningún valor aparece en
    los dos tipos. Es lo que impide que `ankle_stability` vuelva a colarse como músculo.

**Y las 172 pruebas actuales siguen pasando sin tocarlas.** Si alguna hay que modificar,
E1 se salió de su sitio y paro a preguntar.

---

## 5. Criterio de aceptación de E1

| # | Criterio | Cómo se comprueba |
|---|---|---|
| 1 | Las 172 pruebas actuales pasan **sin modificar ninguna** | `npm test` + `git diff` vacío en los `*.test.ts` existentes |
| 2 | Las pruebas de caracterización de E0 pasan sin cambios | `npm test` |
| 3 | Las 18 pruebas nuevas pasan | `npm test` |
| 4 | **Ningún `exerciseId` cambia** | Prueba 1 |
| 5 | **Ningún archivo de `components/` ni `routes/` modificado** | `git diff --name-only` |
| 6 | **Ningún archivo de base de datos modificado** | Igual, para `db/`, `api/`, `seed.ts`, `migrate-exercise-ids.ts` |
| 7 | **`isAnkle` idéntico para los 26** | Prueba 8 |
| 8 | **`jointLoads` tipado en los 26** | Prueba 8b |
| 9 | **Ninguna sustitución ni cue de prescripción se globaliza** | Pruebas 6 y 7 |
| 10 | **Ningún ejercicio de balance cuenta como serie muscular directa** | Pruebas 11 y 12 |
| 11 | Tipos limpios | `npm run typecheck` |
| 12 | Formato y lint limpios | `npm run check` |
| 13 | El importador regenera el contenido, biblioteca incluida | `npm run import:excel` + `npm run verify:import` |
| 14 | Un clon limpio sin `content/` arranca con el ejemplo | `npm run dev` sin `content/` |
| 15 | La app arranca y una sesión se registra igual que antes | Comprobación manual |
| 16 | Los cambios visibles son exactamente **14 cambios atómicos: 9 apariciones de cues generales + 4 nombres canónicos + 1 línea muscular** — ni uno más | Lista de permitidos en `__fixtures__/expected-changes.ts`; el extractor aborta ante un decimoquinto |

El criterio 5 sigue siendo el que de verdad vigila: si E1 obliga a tocar un componente, es
que el tipo `Exercise` cambió y E1 dejó de ser una reorganización de contenido. En ese caso
paro.

---

## Lo que queda por aprobar

Dos detalles menores, señalados en el apartado 3:

1. **`step_down`** — `rehab` o `normal`. Lo puse en `rehab` porque su dosis la marca la
   etapa del protocolo, pero entrena cuádriceps de verdad.
2. **`band_dorsiflexion`** — lo dejé sin objetivo funcional por ser trabajo directo de
   tibial anterior, mientras que `band_eversion` sí lleva `ankle_stability`.

Todo lo demás queda cerrado. Con esto, implemento E0 y E1. **No sigo a E2.**

---

## Desviaciones respecto a esta especificación

Cuatro, todas conscientes. Ninguna toca la garantía central: cero ids cambiados, cero
archivos de componentes, rutas o base de datos.

### 1. `exercise-ids.ts` NO se modificó

**Especificado:** «Registro derivado de la biblioteca».
**Hecho:** el registro sigue escrito a mano en `exercise-ids.ts`, y hay pruebas que exigen
que la biblioteca lo cubra entero y que cada alias resuelva a lo mismo que antes.

**Por qué:** derivarlo obligaba a que `domain/` importara contenido, y `domain/` no hace
E/S — es lo que le permite ejecutarse en un clon limpio sin `content/`. La consistencia se
consigue igual con una prueba, sin romper esa propiedad. Efecto secundario bueno: un
archivo modificado menos.

### 2. `import-excel.ts` NO se modificó

**Especificado:** «Emitir `library.yaml` y plantillas delgadas».
**Hecho:** el importador sigue emitiendo la forma gorda de siempre, y un script nuevo,
`scripts/extract-library.ts`, normaliza después. `npm run import:excel` encadena los dos.

**Por qué:** enseñarle anatomía al importador habría duplicado la tabla de músculos y la
lógica de fusión en dos sitios. Así el reparto vive en un único lugar, es idempotente y se
puede ejecutar suelto con `npm run extract:library`. El importador conserva su único
trabajo: xlsx → programa.

### 3. `vitest.config.ts` sí se modificó

**Especificado:** E0 no toca nada.
**Hecho:** se le añadió la resolución del alias `@/`.

**Por qué:** `backup.ts` importa `@/lib/photos`, y sin el alias la prueba del backup no
podía ni cargar el módulo. Era eso o no probar el único archivo que separa un navegador
borrado de un historial perdido. Es configuración de pruebas: no entra en el build.

### 4. `verify-import.ts` cambió más de lo previsto

**Especificado:** «Verificar cobertura».
**Hecho:** además compone biblioteca + plantilla y verifica **el resultado compuesto**
contra el Excel, con tres campos comprobados por contención en vez de por igualdad
(nombre vía alias, técnica como superconjunto, músculo como superconjunto).

**Por qué:** verificar sólo el archivo de disco habría dejado de comprobar lo que la app
enseña. Comprobar el compuesto exige admitir los 14 cambios deliberados, pero sigue
exigiendo que **nada se pierda**, que es la propiedad que importa. 370/370.

---

## Resultado

| | |
|---|---|
| Pruebas | **336 pasan** (172 previas + 33 de E0 + 131 de E1), ninguna existente modificada |
| Typecheck | limpio |
| `verify:import` | 370/370 contra el Excel |
| Build | correcto, incluido el prerender que valida el contenido en tiempo de ejecución |
| Ids de ejercicio cambiados | **0** |
| Archivos de `components/`, `routes/`, `db/`, `api/` | **0** |
| Cambios visibles | 14, todos listados y verificados por el script |

`npm run check` sigue en rojo, y ya lo estaba antes de empezar: `biome.json` declara el
esquema 2.2.4 mientras el binario instalado es 2.4.5, y esa diferencia cambia el orden de
imports que biome espera en 17 archivos de `components/`, `routes/`, `db/` y
`vite.config.ts`. Ninguno es mío y arreglarlos habría violado el criterio 5. Se arregla
aparte, actualizando el `$schema`.
