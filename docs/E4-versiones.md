# E4 · Versiones del plan y diferencias entre ellas

**Estado: especificación. Nada implementado.**

E3 dejó el plan hecho de tres capas —base, ajustes, instantáneas— y cada número con
procedencia. Lo que no dejó es la posibilidad de decir **«el plan de octubre»** y que eso
signifique lo mismo mañana, en el otro dispositivo, y dentro de seis meses.

E4 entrega exactamente tres cosas:

| | qué |
|---|---|
| `ProgramKnowledgeCut` | qué ids conocía este dispositivo cuando se capturó la versión |
| `ProgramVersion` | una captura inmutable con nombre, fecha y frontera de conocimiento |
| `diffVersions` | qué cambió entre dos versiones, y qué decisión lo causó |

Fuera de E4, a propósito y sin excepciones: readiness, tendencias, motor adaptativo,
sugerencias automáticas, cambios automáticos y auditoría avanzada de volumen.

---

## 1. Por qué hace falta una frontera y no una fecha

En E3 una consulta al plan lleva dos coordenadas, y ésa es la parte que E4 hereda entera:

```
asOf = { effectiveOn, knows }
        └ qué día      └ qué ids se conocían
```

La tentación es guardar sólo el día y resolver «con todo lo que haya». Eso hace que una
versión cambie sola. El caso concreto, que ya ocurre hoy con dos dispositivos:

> Creas **v3** el 4 de octubre. El 5 de octubre el móvil sincroniza y trae un ajuste que
> escribiste el 20 de septiembre y que este portátil no tenía. Con «resolver con todo lo
> que haya», v3 pasa a decir otra cosa el 5 de octubre que el 4 — sin que nadie haya
> tocado v3.

Una versión que cambia sola no es una versión. Por eso la frontera se guarda como un
**conjunto explícito de ids**, no como un instante: exactamente la misma decisión que E3
tomó para `PrescriptionKnowledgeCut` y E2 para el log de fases. Un reloj no es verdad
distribuida; un conjunto de ids sí.

### 1.1 Lo que E3 dejó a medias

`resolvePrescription` acota los ajustes pero **no la fase**:

```ts
// E3, hoy
phaseAt: (date: IsoDate) => PhaseId   // sin corte
```

y su propio comentario lo dice: *«acotar la fase es la mitad de la reproducibilidad, y
media garantía escrita en una firma se lee como una entera. E4 la amplía»*.

Ésa es la primera tarea de E4: `phaseForDate` pasa a aceptar un corte de eventos, y sin él
se comporta exactamente como ahora. Sin eso, una corrección retroactiva de fases movería
la prescripción de una versión ya nombrada, porque `onlyInPhase` depende de qué fase estaba
en vigor.

---

## 2. `ProgramKnowledgeCut`

```ts
export const ProgramKnowledgeCut = z.object({
  adjustmentIds: z.array(z.string()),
  phaseEventIds: z.array(z.string()),
});
```

Dos conjuntos, no uno, porque son dos logs distintos y una versión puede necesitar acotar
uno sin el otro. `PrescriptionKnowledgeCut` de E3 queda como el caso degenerado —sólo
ajustes— y se deriva de éste.

### 2.1 Qué se captura: ids **conocidos**

El corte guarda **los ids que este dispositivo tenía presentes** en ese momento. No «los
vivos», no «los vigentes», no «los que aplicaban»: los que estaban ahí.

```
adjustmentIds  = todo PlanAdjustment presente al capturar
phaseEventIds  = todo PhaseEvent presente al capturar
```

Y **presente incluye las tres clases de fila**, sin excepción:

| clase | ejemplo | por qué entra |
|---|---|---|
| original | `A1` sube la prensa a 3 series | es lo que prescribe |
| corrección | `E4` corrige la fecha de `E3` | sin ella, la versión vería la fecha vieja |
| revocación | `R1` anula `A1` | sin ella, la versión aplicaría `A1` |

Una revocación no prescribe nada, pero es exactamente lo que hace que otra cosa no se
aplique. Dejarla fuera haría que la versión resolviera **de más**, y de la peor manera
posible: en silencio y con aspecto correcto.

La regla, en una frase: **la frontera es memoria, no efecto.** Qué ids conocía, no qué
hacían.

### 2.2 El orden al resolver: acotar primero, decidir después

Éste es el punto en el que una implementación descuidada rompe la reproducibilidad sin que
se note, así que va escrito como procedimiento y no como intención:

```
1. universo  = log ∩ corte              ← sólo los ids del conjunto
2. vigencia  = liveEvents / inForce      ← calculadas DENTRO del universo
3. resolver
```

**Nunca al revés.** Si se calcula primero la vigencia sobre el log entero y después se
filtra, una corrección o una revocación que la versión **no conocía** ya habría matado a un
evento que la versión **sí** conocía, y el resultado sería un plan que nadie vio nunca:

```
corte de v3   = { E1, E2, E3 }
log de hoy    = { E1, E2, E3, E4 }      E4 corrige a E3

mal:  liveEvents({E1..E4}) → E3 anulado por E4 → filtrar → {E1, E2}
      v3 resuelve sin la transición que sí conocía             ❌

bien: {E1..E4} ∩ {E1,E2,E3} = {E1,E2,E3} → liveEvents → E3 vive
      v3 resuelve con lo que conocía                           ✅
```

Lo mismo para los ajustes: una revocación fuera del corte no puede anular nada dentro de
él. `inForce` ya lleva el corte como primera condición en E3; E4 extiende esa disciplina a
`liveEvents` y a las cadenas de corrección de fase.

### 2.3 Qué no entra en el corte

El corte contiene **sólo ids de logs**. Eso deja fuera tres cosas, y una de ellas necesita
otra garantía en su lugar:

- **Las instantáneas**: son hechos de sesiones, no del plan. Una versión no las toca.
- **El contenido** (`content/`): es la fuente de la base, y la base ya está sembrada.
- **`prescriptionBaseline`**: no lleva ids en el corte —no es un log, es un estado— pero
  **una versión sí tiene que poder demostrar que se está resolviendo sobre la misma base
  con la que nació**. Esa demostración es `baselineFingerprint`, y se especifica en §3.5.

  Decir «se siembra una vez y no se reescribe» no basta como garantía: describe la
  intención, no la comprueba, y no dice nada sobre el dispositivo de al lado, que puede
  tener la base a medias o sembrada desde otro contenido.

### 2.4 Por qué el conjunto no puede cambiar de significado

`planAdjustments` y `phaseEvents` son **append-only** desde E3 y E2: `appendOnly()` niega
`update` y `delete`. Un id, una vez emitido, apunta para siempre a la misma fila con el
mismo contenido. Eso es lo que hace que un conjunto de ids sea una frontera estable y no
una promesa.

Si alguna vez se relajara esa regla, las versiones dejarían de ser reproducibles el mismo
día. Es una dependencia y queda escrita como tal.

### 2.5 El coste, dicho en voz alta

Una versión guarda cientos de ids. A los dos años de uso, del orden de 400–800 uuids ≈
15–30 KB por versión. Es aceptable y es la representación honesta. **E4 no comprime, no
usa rangos y no usa marcas de agua**: cualquiera de las tres convertiría el conjunto en
una propiedad inferida, que es lo que se está evitando.

---

## 3. `ProgramVersion`

```ts
export const ProgramVersion = z.object({
  id: z.string().min(1),
  /** Lo que tú la llamas. Presentación; nunca identidad. */
  name: z.string().min(1),
  /** El día al que resuelve. Tiempo válido. Nunca futuro — ver §3.4. */
  cutAt: IsoDate,
  /** Qué ids conocía el dispositivo al capturarla. */
  knows: ProgramKnowledgeCut,
  /** Cuándo se pulsó el botón. Auditoría; nunca decide nada. */
  createdAt: z.number(),
  /** Por qué existe. No opcional: una versión sin motivo es un nombre suelto. */
  reason: z.string().min(1),
  /** Sobre qué base se resolvió, y cuántas filas tenía. Ver §3.5. */
  baselineFingerprint: z.string().min(1),
  baselineSize: z.number().int().nonnegative(),
});
```

### 3.1 `cutAt` frente a `createdAt`

Son los dos ejes de E3, otra vez, y confundirlos es el error que E4 tiene que no cometer.

| | qué es | quién lo usa |
|---|---|---|
| `cutAt` | el día al que la versión resuelve | el resolver, como `effectiveOn` |
| `createdAt` | cuándo se creó la fila | ordenar en pantalla, auditar |

Resolver una versión es exactamente:

```ts
resolveWholePlan(baseline, adjustments, { effectiveOn: version.cutAt, knows: version.knows }, phaseAt)
```

`cutAt` es normalmente hoy, y **puede ser pasado**: «captúrame el plan tal y como estaba el
1 de septiembre, con lo que sé ahora» es una pregunta legítima y distinta de «el plan que
tenía el 1 de septiembre». La primera lleva `cutAt: 2026-09-01` y la frontera de hoy; la
segunda necesitaría la frontera de entonces, que sólo existe si aquel día se creó una
versión. E4 permite la primera y **no finge** poder responder la segunda.

### 3.2 Identidad y nombre

- **`id`**: uuid opaco. Se crea en el móvil sin red, quizá en el mismo minuto que en el
  portátil, así que no puede depender de una lista compilada ni de un contador.
- **`name`**: libre, tuyo, y **no único**. Dos dispositivos pueden llamar «v3» a cosas
  distintas y las dos filas conviven. La pantalla desambigua por `cutAt` y `createdAt`; el
  sistema nunca.

Nada deriva un nombre de un número de secuencia. «v3» es una etiqueta que tú pones, no una
posición que el sistema calcula: en cuanto fuera calculada, dos dispositivos generarían dos
«v3» distintas y habría que arbitrar.

### 3.3 Inmutable, del todo

`planVersions` es **append-only y sus filas no se modifican nunca**: sin `update`, sin
`delete`, sin renombrar, sin retirar.

Una versión es la afirmación «esto es lo que había, y esto es lo que yo sabía». Cualquier
escritura posterior sobre esa fila convierte un hecho en otra cosa con el mismo id, y
cualquier diff calculado antes deja de reproducirse.

**Renombrar y retirar quedan fuera de E4 a propósito**, y no por falta de tiempo. Ser
append-only elimina los conflictos de *escritura*: dos dispositivos que escriben no se
pisan. No elimina los conflictos **semánticos**: dos renombrados concurrentes de la misma
versión son dos afirmaciones incompatibles sobre cómo se llama algo, y elegir entre ellas
por reloj o por id es arbitrar por sorteo. E4 no necesita resolver eso para cumplir lo que
promete, así que no lo aborda. Si más adelante hace falta, será su propia decisión, con su
propia regla de arbitraje escrita.

Consecuencia práctica: el nombre que le pongas a una versión es el que tendrá siempre.
Vale la pena decirlo en el propio formulario.

### 3.4 `cutAt` nunca es futuro

Al crear una versión, **`cutAt <= hoy`**. Se valida y se rechaza en caso contrario.

E4 captura lo que el plan **es o fue**, no lo que se proyecta que sea. Una versión con
`cutAt` en el futuro parecería congelar una prescripción que todavía puede cambiar por
cualquier ajuste que escribas mañana, y al resolverla dentro de un mes daría algo distinto
de lo que mostró el día que la creaste — que es exactamente el fallo que E4 existe para
impedir, entrando por la otra puerta.

Proyectar el plan hacia adelante sigue siendo posible en `/plan`, que resuelve a cualquier
fecha. Lo que no se puede es **nombrarlo y guardarlo** como si fuera un hecho.

### 3.5 `baselineFingerprint`

El corte acota los logs. La base no es un log —es el estado inicial de cada hueco— así que
no se acota: **se demuestra**.

```
baselineFingerprint = sha256( serialización canónica de prescriptionBaseline )
```

La serialización es canónica y explícita, para que dos dispositivos con la misma base
produzcan el mismo string sin depender del orden de inserción ni del orden de claves:

- filas ordenadas por `id` ascendente;
- dentro de cada fila, los campos de prescripción en un orden fijo y escrito: `id`,
  `templateId`, `exerciseId`, `order`, `sets`, `target`, `load`, `rir`, `restSeconds`,
  `trainingRole`, `goal`, `progression`, `cues`, `allowedSubstitutions`;
- **`seededFrom` y `seededAt` quedan fuera**: son procedencia de la siembra, no
  prescripción, y difieren legítimamente entre dispositivos que migraron en momentos
  distintos desde el mismo contenido;
- números y `null` tal cual; sin espacios opcionales; sin claves ausentes.

**Por qué también se guarda el tamaño.** Un hash solo no distingue «me falta base» de
«tengo otra base»: las dos dan un string distinto. Y esa distinción es justo la que separa
`incomplete` —espera al sync— de `invalid` —esto no se arregla solo—, así que hace falta un
segundo dato, y el barato y honesto es cuántas filas había.

**Al resolver una versión, antes de nada:**

| situación | resultado |
|---|---|
| filas locales **<** `baselineSize` | `incomplete`, con `baselineMissing: true` |
| mismas o más filas, y el fingerprint **no coincide** | `invalid`, `baseline-mismatch` |
| coincide | se resuelve |

El orden importa: «me falta» se comprueba antes que «no cuadra». Una base a medias produce
un fingerprint distinto, y reportarla como `baseline-mismatch` mandaría a buscar una
corrupción donde sólo hay un sync sin terminar.

Tener **más** filas de las que la versión conoció no es «de más» como en los logs: la base
es un estado, no un conjunto acotable, así que una base que ha crecido es otra base y el
fingerprint lo dice. Es la respuesta correcta —`invalid`— y no una limitación: significa
que el plan sobre el que se resolvería no es el que la versión nombró.

**Qué compra esto.** Sin el fingerprint, dos dispositivos con los mismos logs y bases
distintas —uno migrado desde un contenido más viejo, o con la siembra a medias— devolverían
los dos `kind: "resolved"` con planes distintos para la misma versión. Serían dos respuestas
seguras de sí mismas y contradictorias, que es el fallo que E4 existe para impedir. Con el
fingerprint, uno resuelve y el otro dice exactamente qué pasa.

`baselineFingerprint` no es un corte: no permite resolver contra una base que no está. Es
una **prueba de identidad**. Si no coincide, no se adivina.

---

## 4. Crear una versión

### 4.1 `captureProgramKnowledgeCut()`

La captura es el único momento delicado de E4: si el conjunto sale incompleto o
inconsistente, la versión nace rota y no hay forma de arreglarla después, porque es
inmutable.

```ts
export type CaptureRefusal =
  | { kind: "not-ready" }
  | { kind: "sync-in-flight" }
  | { kind: "writes-pending"; count: number }
  | { kind: "dangling"; adjustmentIds: string[]; phaseEventIds: string[] }
  | { kind: "future-cut"; cutAt: IsoDate; today: IsoDate };

export function captureProgramKnowledgeCut(input: {
  collections: Collections;
  cutAt: IsoDate;
  today: IsoDate;
  syncIdle: boolean;
  pendingWrites: number;
  bootstrapReady: boolean;
}):
  | { knows: ProgramKnowledgeCut; baselineFingerprint: string; baselineSize: number }
  | CaptureRefusal;
```

**Precondiciones. Las tres se comprueban antes de leer nada.**

| condición | por qué |
|---|---|
| bootstrap **READY** | T-002: antes de la barrera de hidratación las colecciones están vacías. Capturar ahí produciría un corte de cero ids con aspecto perfectamente válido |
| sync **idle** | un pull a mitad de la lectura mete filas entre los dos `toArray` y el corte queda con la mitad de un estado |
| durabilidad **sin pendientes** | T-001: un ajuste escrito hace un instante puede no estar en disco. El corte nombraría un id que todavía se puede perder |

**La lectura es una sección síncrona, sin `await`.** Los dos `toArray` se toman en el mismo
turno del bucle de eventos, sin nada asíncrono entre medias. `syncIdle` reduce la
probabilidad de que llegue algo; ser síncrono la elimina, porque un pull sólo puede
escribir en otro turno.

```
// una sola sección, sin await dentro
const adjustmentIds = collections.raw.planAdjustments.toArray.map(r => r.id)
const phaseEventIds = collections.raw.phaseEvents.toArray.map(r => r.id)
const baseline      = collections.raw.prescriptionBaseline.toArray
```

La base se lee en la misma sección: el fingerprint tiene que describir la base **de ese
instante**, no la de dos turnos después.

Se lee por `raw` a propósito: el corte necesita **todo lo presente**, incluidas las filas
que las pantallas filtran.

**Después de leer, y antes de persistir:**

1. **deduplicar** — un id no puede aparecer dos veces;
2. **ordenar canónicamente** — orden lexicográfico ascendente, para que dos capturas del
   mismo estado den conjuntos byte a byte iguales y sean comparables y diffeables;
2b. **calcular `baselineFingerprint` y `baselineSize`** sobre la base leída, con la
   serialización canónica de §3.5;
3. **validar el cierre referencial** — regla general, no una lista de casos que se
   quedará corta:

   > **Toda referencia semántica de una fila incluida apunta a otra fila incluida.**

   Hoy eso son exactamente tres referencias, y las tres se comprueban:

   | fila | campo | apunta a |
   |---|---|---|
   | `PlanAdjustment` `kind: "revoke"` | `revokesId` | otro ajuste del conjunto |
   | `PhaseEvent` `kind: "correction"` | `supersedesId` | otro evento del conjunto |
   | `PhaseEvent` `kind: "revocation"` | `revokesId` | otro evento del conjunto |

   más la comprobación de base: todo id del conjunto resuelve a una fila presente.

   La regla se escribe así, y no como enumeración, porque una cuarta referencia que se
   añada en el futuro tiene que quedar cubierta por construcción. Cuando eso pase, la
   comprobación se amplía o se cae la prueba que lo exige.

Si el cierre falla, se devuelve `{ kind: "dangling", … }` nombrando qué falta y **no se
crea la versión**. Un corte que menciona una revocación cuyo objetivo no conoce no es una
frontera: es una contradicción, y resolvería distinto según cómo se leyera.

### 4.2 Una versión local nunca nace `incomplete` ni `invalid`

De lo anterior sale la asimetría que gobierna §5:

| origen | `incomplete` | `invalid` |
|---|---|---|
| creada **aquí** | **nunca** | **nunca** |
| llegada por **sync** | **sí, temporalmente** | sí, si vino mal escrita |

Lo garantizan las precondiciones (§4.1): el cierre referencial impide `dangling-reference`,
y capturar el `baselineFingerprint` de la base que se está usando impide `baseline-mismatch`
contra uno mismo. Una versión propia en cualquiera de los dos estados sería un fallo del
que informar, no una situación normal.

### 4.3 El orden de escritura

```
1. comprobar precondiciones                    ← si fallan, no se crea
2. capturar en sección síncrona
3. deduplicar, ordenar, validar cierre
4. escribir la fila ProgramVersion             ← se espera al disco (T-001)
```

Un solo `insert`, así que no hay ventana entre colecciones como la que obligó al orden de
§7.1 en E3.

### 4.4 Desde dónde

Desde `/plan`, que es donde ya se ve la prescripción resuelta y su procedencia. Un botón
«Guardar esta versión» que pide nombre y motivo, los dos obligatorios, y que avisa de que
el nombre no se podrá cambiar. Si alguna precondición falla, el botón explica cuál en vez
de deshabilitarse en silencio.

---

## 5. Reproducibilidad entre dispositivos

Dos dispositivos con la misma fila `ProgramVersion` y los mismos logs resuelven idéntico,
porque la versión nombra los ids exactos. Eso deja tres situaciones y **las tres tienen que
distinguirse**:

| situación | qué se hace |
|---|---|
| tengo todos los ids de `knows` | se resuelve. Es la versión |
| tengo **de más** (llegaron después) | se ignoran. No están en `knows` |
| me **faltan** ids de `knows` | **no se resuelve**: se dice qué falta |

La tercera es la que no se puede tratar como la segunda. Faltar un id y excluirlo dan
resultados distintos, y resolver de todas formas produciría un plan plausible que no es el
que la versión nombra. Como con las instantáneas parciales de E3: se dice qué no se pudo,
nunca se rellena.

```ts
export type VersionResolution =
  | { kind: "resolved"; plan: Map<string, PrescriptionEntry[]> }
  /** Nombra cosas que este dispositivo todavía no tiene. Se arregla solo. */
  | {
      kind: "incomplete";
      missingAdjustmentIds: string[];
      missingPhaseEventIds: string[];
      /** La base sembrada no está entera aquí todavía. */
      baselineMissing: boolean;
    }
  /** Tengo los datos, y la frontera en sí no se sostiene. No se arregla solo. */
  | { kind: "invalid"; code: InvalidCut; detail: string };

export type InvalidCut =
  /** Una referencia del conjunto apunta fuera de él. */
  | "dangling-reference"
  /** La base sembrada de aquí no es la que la versión conoció. */
  | "baseline-mismatch";
```

**`incomplete` e `invalid` no son lo mismo y no se muestran igual.**

| | qué significa | qué se hace |
|---|---|---|
| `incomplete` | *me falta algo* | esperar al sync. Estado temporal y honesto |
| `invalid` | *lo tengo todo y no cuadra* | reportarlo. No se arregla solo |

En pantalla, la primera dice «Esta versión menciona 3 decisiones que este dispositivo
todavía no tiene. Sincroniza para verla completa.» La segunda dice qué invariante rompe, en
el sitio donde se enseñan las violaciones de G3, porque significa que algo escribió una
versión que no debería existir.

Y las dos son estados de **lectura**: una versión creada aquí no puede nacer en ninguno de
los dos (§4.2).

---

## 6. Los dos ejemplos temporales

### 6.1 Un ajuste viejo que llega tarde

```
4 oct   portátil: creas v3
        knows.adjustmentIds = { A1, A2, R1 }        ← lo que el portátil conocía
        v3 resuelve: prensa 3 series

5 oct   sync: llega A0, escrito en el móvil el 20 sep,
        con effectiveOn 2026-09-20 y que el portátil no conocía

        planAdjustments ahora = { A0, A1, A2, R1 }

        v3.knows.adjustmentIds sigue siendo { A1, A2, R1 }
        → paso 1: universo = log ∩ corte = { A1, A2, R1 }   (A0 fuera)
        → paso 2: vigencia dentro de ese universo
        → v3 sigue resolviendo: prensa 3 series          ✅ v3 NO cambia

        Y el plan de hoy, que no lleva corte, sí incorpora A0.
        Las dos cosas son ciertas y no se contradicen.
```

Si quieres una versión que sí conozca A0, se crea **otra**: v4, con la frontera de hoy. Una
versión no se actualiza; se emite una nueva. Eso es lo que hace que «el plan de octubre»
signifique algo dentro de seis meses.

### 6.2 Una corrección retroactiva de fase

```
4 oct   v3 se crea estando en fase B
        knows.phaseEventIds = { E1, E2, E3 }
        E3 = transición A→B, occurredOn 2026-09-15

        v3 resuelve el 4 oct → universo {E1,E2,E3} → liveEvents → fase B
        y los ajustes con onlyInPhase: B se aplican

20 oct  te das cuenta de que entraste en B el 22 de septiembre, no el 15.
        E2 dice que eso no se edita: se añade una corrección.
        E4 = corrección de E3, occurredOn 2026-09-22, nuevo id

        phaseEvents ahora = { E1, E2, E3, E4 }

        v3.knows.phaseEventIds sigue siendo { E1, E2, E3 }
        → paso 1: universo = { E1, E2, E3 }        (E4 fuera)
        → paso 2: dentro de ese universo, E3 no está corregido por nadie
        → v3 sigue resolviendo con fase B desde el 15 sep     ✅ v3 no se mueve

        El historial de hoy sí usa la fecha corregida.
```

Aquí se ve por qué el orden de §2.2 no es un detalle: filtrando después de calcular la
vigencia, `E4` habría anulado a `E3` antes de que nadie mirara el corte, y v3 habría
resuelto sin la transición que sí conocía.

### 6.3 El caso que no se puede responder

```
1 sep   no existía ninguna versión

4 oct   preguntas: «¿qué plan tenía el 1 de septiembre?»
```

E4 puede responder **«el plan del 1 de septiembre según lo que sé hoy»**: `cutAt:
2026-09-01` con la frontera de hoy. No puede responder «lo que sabía el 1 de septiembre»,
porque nadie lo escribió. La pantalla lo dice con esas palabras en vez de dar el primero
haciéndolo pasar por el segundo.

---

## 7. `diffVersions`

```ts
export function diffVersions(
  a: ProgramVersion,
  b: ProgramVersion,
  input: { baseline; adjustments; phaseEvents; program },
): VersionDiff | { kind: "incomplete"; /* … */ };
```

Resuelve las dos con su propio corte y compara. Si alguna no se puede resolver (§5), el
diff no se calcula: comparar contra una versión a medias produciría diferencias que son
huecos de sincronización disfrazados de decisiones.

### 7.1 Las cuatro formas de cambiar

Se comparan **por `entryId`**, que es la identidad longitudinal del hueco que E3 estableció
— no por ejercicio, que es lo que ocupa el hueco y puede cambiar.

| | condición | de qué ajuste sale normalmente |
|---|---|---|
| `added` | el id está en B y no en A | `add_entry` |
| `removed` | el id está en A y no en B | `remove_entry` |
| `replaced` | está en las dos y cambia `exerciseId` | `replace_exercise` |
| `changed` | está en las dos, mismo ejercicio, y difiere algún campo | `set_field` |

```ts
export type EntryChange =
  | { kind: "added"; entryId; entry: PrescriptionEntry; causes: ChangeCause[] }
  | { kind: "removed"; entryId; entry: PrescriptionEntry; causes: ChangeCause[] }
  | { kind: "replaced"; entryId; from: PrescriptionEntry; to: PrescriptionEntry; causes: ChangeCause[] }
  | { kind: "changed"; entryId; fields: FieldDiff[]; causes: ChangeCause[] };

export type FieldDiff = { field: keyof PrescriptionEntry; from: unknown; to: unknown };
```

**`sets: null` no es `removed`.** Un hueco que la fase no programa sigue existiendo; pasar
de `null` a `2` es `changed`, no `added`. Confundirlos haría que avanzar de fase pareciera
un rediseño del plan.

Los campos comparados son los diez que E3 ya trata como prescripción: `exerciseId`,
`order`, `sets`, `target`, `load`, `rir`, `restSeconds`, `trainingRole`, `cues`,
`allowedSubstitutions`.

### 7.2 Diff de volumen

Deliberadamente mínimo. Series de trabajo planificadas, por plantilla y por grupo muscular
primario, y su delta:

```ts
export type VolumeDiff = {
  byTemplate: Array<{ templateId: string; from: number; to: number; delta: number }>;
  total: { from: number; to: number; delta: number };
};
```

Series de trabajo **planificadas**, por plantilla y en total. Nada más.

Reglas, escritas para que nadie las amplíe por accidente:

- **planificado, nunca realizado.** Esto compara dos planes; lo que hiciste no entra.
- un rango `[2, 3]` cuenta por su **tope**, y se dice en pantalla. Contar por el mínimo
  escondería un aumento.
- `sets: null` cuenta **cero**.
- se cuenta **por hueco**, sin mirar qué ejercicio lo ocupa.

### 7.2.1 Por qué no hay `byMuscle`

Es la corrección que más recorta el alcance, y tiene un motivo estructural, no de tiempo.

Un desglose por músculo dependería de `groupOf()` y de la clasificación de la biblioteca de
E1 — metadatos que son **corregibles**. Si dentro de seis meses reclasificas un ejercicio
porque estaba mal etiquetado, el diff entre dos versiones de octubre **cambiaría**, aunque
ninguna de las dos versiones haya cambiado y aunque el plan de octubre fuera exactamente el
que fue.

Eso es la misma familia de fallo que E4 existe para impedir, entrando por una tercera
puerta: un resultado histórico que se mueve porque se corrigió algo que no era él. Y no
tiene arreglo dentro del alcance de E4: acotar la biblioteca pediría un cuarto conjunto de
ids en el corte, y la biblioteca **no es un log append-only**, así que ni siquiera podría
acotarse igual.

`byTemplate` y `total` no tienen ese problema: cuentan huecos y series, que están en la
prescripción resuelta y ya quedan acotados por el corte.

**La auditoría muscular es E5**, donde le corresponde y donde puede resolverse el problema
de fondo — qué significa acotar una clasificación que se corrige.

### 7.3 Por qué cambió

La diferencia simétrica de ajustes vigentes **no basta**. Dice qué dejó de aplicarse, no
quién lo decidió, y en los dos casos que más importan la respuesta útil es otra fila del
log.

```ts
export type ChangeCause =
  /** Un ajuste que aplica en B y no en A. */
  | { kind: "adjustment"; adjustmentId; reason; origin; effectiveOn; provenance }
  /** Un ajuste dejó de aplicar porque algo lo revocó: se nombra el revoke. */
  | { kind: "revocation"; revokeId; revokesId; reason; effectiveOn }
  /** Las dos versiones resuelven en fases distintas. */
  | { kind: "phase"; from: PhaseId; to: PhaseId; via: PhaseCause }
  /** No se pudo atribuir. Es un fallo, y se reporta como tal. */
  | { kind: "unexplained" };

export type PhaseCause =
  /** Difieren los `cutAt`, y esa fecha cae en otra fase. El log no cambió. */
  | { kind: "date" }
  /** Un evento de transición que B conoce y A no. */
  | { kind: "transition"; eventId; occurredOn }
  /** Una corrección de fase que B conoce y A no. */
  | { kind: "correction"; eventId; correctsId; occurredOn };
```

**Cómo se atribuye.** Para cada `EntryChange`, con `enA` y `enB` los ajustes en vigor sobre
ese hueco bajo cada corte:

1. cada ajuste de `enB \ enA` → una causa `adjustment`, con su `reason` y su procedencia;
2. cada ajuste de `enA \ enB` → **no** se reporta como «desapareció». Se busca en el corte
   de B la revocación que lo apunta (`revokesId === id`) y se emite una causa `revocation`
   con **el motivo del revoke**, que es la decisión real. Si no hay revocación que lo
   explique, el ajuste dejó de aplicar por la fecha o por la fase, y cae en el punto 3;
3. si las dos versiones resuelven en fases distintas, una causa `phase`, y su `via` se
   determina en este orden:
   - ¿hay en el corte de B algún evento de fase que A no conoce y que cambia la fase de
     `cutAt`? → `transition` o `correction` según su tipo, con el id del evento;
   - ¿no lo hay, y los `cutAt` difieren? → `date`: la fecha se movió, el log no;
4. si después de todo eso no hay ninguna causa → `unexplained`, y eso es un **fallo
   reportado**, no una fila muda. Ver invariante 7.

**La clasificación se deriva, no se guarda.** `ChangeCause` se calcula al hacer el diff a
partir de los dos cortes y de los logs; no se persiste nada. Guardarla la congelaría contra
un log que sigue creciendo, y volvería a introducir el problema que E4 existe para evitar.

En pantalla:

```
Prensa · series 2 → 3
  causa:  «el tobillo aguanta bien, subo una serie»
          tuyo · desde 2026-10-01

Curl femoral · series 3 → 2
  causa:  deshecho — «ya no me hace falta»
          tuyo · desde 2026-10-20

Abducción · series 2 → 3
  causa:  v3 resuelve en «adaptación» y v4 en «progresión»
          por la corrección de la transición del 22 sep
```

---

## 8. Sync y conflictos

`planVersions` viaja como todo lo demás, con `updatedAt` y `deletedAt`, y sube
`SYNC_SCHEMA_VERSION` a **4**.

Es append-only e inmutable, así que **no hay conflicto que arbitrar**: dos dispositivos que
crean versiones distintas producen dos filas distintas, y last-write-wins nunca tiene que
elegir. Ése es el motivo real de que sea append-only, más allá de la limpieza — y el motivo
por el que renombrar queda fuera (§3.3): renombrar reintroduciría un conflicto que
append-only no resuelve.

Los dos casos que sí hay que tratar:

| caso | qué se hace |
|---|---|
| dos versiones con el mismo `name` | conviven. La lista desambigua por `cutAt` y fecha |
| llega una versión cuyos ids no tengo | se lista, y al abrirla dice qué falta (§5) |

**El corte no se recalcula nunca al sincronizar.** Una versión que llega del móvil trae su
frontera; el portátil la respeta aunque conozca más cosas. Recalcularla sería exactamente
el fallo de §1.

### 8.1 El salto de esquema 3 → 4

La compuerta de versión de esquema ya existe desde E2 y se endureció en E3 con un
`SELECT … FOR UPDATE` dentro de la transacción, que cierra la carrera entre comprobar y
actuar. E4 no la rediseña: **la ejercita para el salto nuevo**, porque una compuerta que
sólo se ha probado para el salto anterior es una compuerta que no se ha probado.

Lo que tiene que quedar demostrado:

1. **cliente 3 contra servidor 4 → rechazado antes de leer o escribir.** No «rechazado
   después de aplicar»: el cliente viejo no llega a ver una fila de esquema 4 ni a meter
   una de esquema 3;
2. **el upgrade 3 → 4 conserva la atomicidad ya existente.** Dos clientes 4 concurrentes
   contra un servidor 3 no pueden ambos creer que subieron la versión;
3. **después del upgrade, ninguna escritura de esquema 3 entra**, llegue en el orden que
   llegue: ni la que ya estaba en vuelo, ni la que llega un segundo después;
4. **un cliente rechazado no mueve la versión del servidor.**

Son las mismas cuatro propiedades que E3 verificó para 2 → 3, instanciadas para 3 → 4. Se
añaden a `src/domain/sync.test.ts`, junto a las que ya están, y no sustituyen a ninguna.

---

## 9. Rollback

En local, E4 sólo añade, y volver atrás es barato:

- `planVersions` se puede borrar entera: no es evidencia de nada que ocurriera, son
  capturas de algo que sigue estando en los logs;
- `phaseForDate` vuelve a su firma sin corte, que es su comportamiento actual;
- nada de E3 depende de E4, así que no se tocan base, ajustes ni instantáneas.

Un `scripts/rollback-versions.ts` con la misma forma que el de E3: plan primero, aplicar
después, y el original intacto.

**Pero el remoto no vuelve solo, y hay que decirlo con precisión.**

### 9.1 Bajar la constante local no baja el estado remoto

`SYNC_SCHEMA_VERSION` es una constante del cliente. `sync_meta.schema_version` es una fila
en Postgres. El servidor la sube cuando un cliente más nuevo se presenta —dentro de la
transacción, con `SELECT … FOR UPDATE`, que es lo que E3 dejó cerrado— y **no existe ningún
camino por el que bajarla desde el cliente**.

Así que «`SYNC_SCHEMA_VERSION` vuelve a 3» describe la mitad del mundo. La otra mitad es
que, si algún cliente E4 ya sincronizó, el servidor está en 4 para siempre hasta que alguien
lo cambie a mano.

### 9.2 Los dos escenarios, separados

**A · Rollback antes de que ningún cliente E4 haya sincronizado.**

`sync_meta.schema_version` sigue en 3. Volver atrás es sólo código: bajar la constante,
borrar `planVersions`, y el sync sigue funcionando como antes. Es el caso normal si el
rollback ocurre el mismo día.

Cómo saber que estás en él, antes de decidir:

```sql
select schema_version from sync_meta where id = 1;   -- 3 → estás en A
```

**B · Rollback después de que un cliente E4 haya subido el remoto a 4.**

El servidor está en 4. Un cliente que vuelve a E3 se presenta como 3, y la compuerta hace
exactamente lo que debe: **`409 client-outdated`**. El cliente no lee ni escribe. Eso no es
un fallo del rollback — es la compuerta impidiendo que un cliente viejo pise datos que no
sabe leer.

**E4 no soporta downgrade remoto.** No hay ruta automática, y no se inventa una: bajar
`sync_meta` a 3 con filas de esquema 4 ya escritas dejaría a los clientes 3 leyendo
`ProgramVersion` que no entienden, que es peor que el 409.

El rollback seguro en el escenario B es un **procedimiento**, no un cambio de código:

1. exportar respaldo de cada dispositivo, **antes** de tocar nada;
2. decidir qué se conserva: las versiones se pierden, todo lo demás no;
3. restaurar en cada dispositivo un respaldo anterior a E4 —o el actual, que las filas de
   `planVersions` sencillamente no se importan en un cliente E3—;
4. bajar `sync_meta.schema_version` a 3 **a mano**, y sólo cuando ningún cliente E4 quede
   vivo;
5. purgar las filas de `planVersions` del remoto, para que no vuelvan a subir la versión.

Los pasos 4 y 5 son manuales y coordinados a propósito: son la clase de operación que no
debe poder ocurrir por accidente, y con un solo usuario y dos dispositivos el coste de
coordinarlos a mano es de minutos.

### 9.3 Lo que esto obliga a hacer al implementar

- El upgrade a 4 se hace **cuando la funcionalidad ya está probada**, no al empezar la
  rama: mientras `SYNC_SCHEMA_VERSION` siga en 3, todo rollback es del escenario A.
- La pantalla de sync tiene que distinguir `409 client-outdated` de un error de red, y
  decir en palabras que este dispositivo va por detrás. Hoy lo trata como error genérico.

---

## 10. Invariantes

1. Una versión resuelta dos veces con los mismos logs y la misma base da lo mismo, **byte a
   byte**.
2. Añadir ajustes o eventos posteriores **no cambia** ninguna versión existente.
3. Una corrección retroactiva de fase no cambia ninguna versión que no la conozca.
4. Al resolver se **acota primero y se decide después**: ninguna anulación, corrección o
   revocación fuera del corte afecta a nada dentro de él.
5. El corte guarda **ids conocidos**: originales, correcciones y revocaciones.
6. **Cierre referencial**: toda referencia semántica de una fila del corte apunta a otra
   fila del corte. Hoy son `PlanAdjustment.revoke.revokesId`,
   `PhaseEvent.correction.supersedesId` y `PhaseEvent.revocation.revokesId`; la regla vale
   para cualquiera que se añada.
7. Una versión creada localmente **nunca** nace `incomplete` ni `invalid`.
8. `incomplete` significa *me falta*; `invalid` significa *lo tengo y no cuadra*. No se
   confunden ni se muestran igual.
9. Una versión a la que le faltan ids o base **no resuelve**; nunca resuelve de menos.
10. Dos dispositivos con bases distintas **no pueden** devolver los dos `kind: "resolved"`
    para la misma versión. Como mucho uno resuelve; el otro dice `baseline-mismatch`.
11. `baselineFingerprint` se calcula sobre una serialización canónica, y excluye
    `seededFrom` y `seededAt`. `baselineSize` acompaña al hash porque un hash solo no
    separa «me falta base» de «tengo otra base».
12. `cutAt <= hoy` en el momento de crearla.
13. `cutAt` nunca se deriva de `createdAt` ni al revés.
14. Ninguna fila de `planVersions` se actualiza ni se borra, jamás.
15. `diffVersions(a, a)` es vacío en las cuatro categorías y cero en volumen.
16. `diffVersions(a, b)` y `diffVersions(b, a)` son inversos exactos: `added` ↔ `removed`,
    `changed` con `from`/`to` intercambiados, deltas de volumen con signo opuesto.
17. Toda diferencia tiene al menos una causa atribuida. Un `EntryChange` con
    `causes: [{ kind: "unexplained" }]` es un fallo que se reporta, no se muestra como
    cambio normal.
18. Un ajuste que deja de aplicar por una revocación se atribuye **al revoke y a su
    motivo**, no a la ausencia del ajuste.
19. Un cambio de fase se atribuye al evento que lo causa cuando existe, y a la fecha cuando
    la diferencia es sólo de `cutAt`.
20. `ChangeCause` se deriva en cada diff y no se persiste nunca.
21. El corte no se recalcula al sincronizar.
22. El volumen no depende de la clasificación de la biblioteca: sólo de huecos y series.
23. Bajar `SYNC_SCHEMA_VERSION` en el cliente **no** baja `sync_meta` en el servidor, y la
    documentación no promete lo contrario.

## 11. Pruebas

**Frontera, captura y reproducibilidad**

1. una versión resuelta dos veces da lo mismo;
2. un ajuste que llega después no la cambia — el ejemplo de §6.1, literal;
3. un ajuste presente pero fuera del conjunto se ignora;
4. un id del conjunto que falta → `incomplete`, y dice cuál;
5. el conjunto incluye revocaciones, y sin ellas la versión resolvería de más;
6. el conjunto incluye correcciones de fase;
7. **acotar precede a decidir**: una revocación fuera del corte no anula un ajuste de
   dentro (y la versión ingenua, que filtra después, falla esta prueba);
8. lo mismo para una corrección de fase fuera del corte;
9. lo mismo para una **revocación de fase** fuera del corte;
10. `cutAt` en el pasado con la frontera de hoy resuelve, y se distingue en pantalla de lo
    que no se puede responder;
11. dos capturas del mismo estado producen conjuntos **idénticos**: deduplicados y en el
    mismo orden canónico.

**Precondiciones de captura**

12. bootstrap no listo → `not-ready`, y no se crea nada;
13. sync en vuelo → `sync-in-flight`;
14. escrituras pendientes → `writes-pending`, con el número;
15. `cutAt` mañana → `future-cut`, y no se crea;
16. `cutAt` hoy y `cutAt` ayer sí se aceptan;
17. una versión creada localmente nunca resuelve `incomplete` ni `invalid`;
18. una versión llegada por sync sí puede estar `incomplete`, y deja de estarlo cuando
    llegan las filas.

**Cierre referencial**

19. un `PlanAdjustment` `revoke` cuyo `revokesId` no está en el conjunto → `dangling`, y
    **no** se crea la versión;
20. un `PhaseEvent` `correction` cuyo `supersedesId` no está en el conjunto → `dangling`;
21. un `PhaseEvent` **`revocation`** cuyo `revokesId` no está en el conjunto → `dangling`;
22. una versión que llega por sync con una referencia colgando y todos los datos presentes
    → `invalid`, `dangling-reference` — no `incomplete`;
23. la comprobación recorre **todas** las referencias declaradas, no una lista fija: si se
    añade una cuarta clase de referencia sin cubrirla, esta prueba falla.

**Base y fingerprint**

24. misma base → mismo fingerprint, en cualquier orden de inserción;
25. `seededFrom` y `seededAt` distintos → **mismo** fingerprint;
26. una fila de base con distinta prescripción → fingerprint distinto;
27. base local con **menos** filas que `baselineSize` → `incomplete` con
    `baselineMissing`, **no** `baseline-mismatch`;
28. base con las mismas filas y distinto contenido → `invalid`, `baseline-mismatch`;
28b. base con **más** filas de las que la versión conoció → `invalid`, no `resolved`;
29. **dos dispositivos, mismos logs, bases distintas**: como mucho uno devuelve
    `kind: "resolved"`. Nunca los dos, y nunca dos planes distintos bajo `resolved`;
30. lo mismo con una base a medias en uno de los dos.

**Inmutabilidad**

31. `planVersions` niega `update` y `delete` (guarda estructural, como `phaseEvents`);
32. no existe ninguna ruta de código que renombre o retire una versión (`git grep` vacío).

**Fases acotadas**

33. una corrección retroactiva no mueve una versión anterior — el ejemplo de §6.2, literal;
34. `phaseForDate` sin corte se comporta exactamente como hoy (caracterización de E2
    intacta);
35. un evento de fase que llega por sync después no mueve una versión.

**Diff**

36. las cuatro categorías, una prueba cada una;
37. `sets: null → 2` es `changed`, no `added`;
38. `replaced` conserva el `entryId` y cambia el ejercicio;
39. `diffVersions(a, a)` vacío;
40. simetría exacta al invertir los argumentos;
41. diff contra una versión `incomplete` o `invalid` no se calcula.

**Volumen**

42. un rango cuenta por su tope;
43. `null` cuenta cero;
44. el total es la suma de las plantillas;
45. `VolumeDiff` **no** expone desglose por músculo, y el cálculo no importa `groupOf` ni
    la biblioteca (guarda estructural).

**Atribución**

46. un `changed` causado por un ajuste nombra ese ajuste con su motivo;
47. un ajuste que deja de aplicar por una revocación se atribuye **al revoke**, con el
    motivo del revoke y no el del ajuste original;
48. un cambio de fase causado por una transición nombra el evento;
49. un cambio de fase causado por una corrección nombra la corrección y a quién corrige;
50. un cambio de fase que sólo viene de `cutAt` distintos se atribuye a la fecha, sin
    inventar un evento;
51. un `changed` sin causa sale `unexplained` y se reporta como fallo;
52. ninguna causa se persiste: el diff se recalcula y da lo mismo.

**Sync y esquema**

53. dos versiones con el mismo nombre conviven;
54. una versión que llega por sync conserva su frontera y no se recalcula;
55. cliente 3 contra servidor 4 → rechazado **antes** de leer o escribir;
56. upgrade 3 → 4 atómico: dos clientes 4 concurrentes contra servidor 3, sólo uno sube;
57. tras el upgrade, ninguna escritura de esquema 3 entra, en cualquier orden de llegada;
58. un cliente rechazado no mueve la versión del servidor;
59. bajar la constante del cliente no baja `sync_meta`: el servidor sigue en 4 y el cliente
    3 recibe 409 (§9.2, escenario B).

## 12. Archivos

**Dominio**

| archivo | qué |
|---|---|
| `src/domain/versions.ts` | **nuevo** · `captureProgramKnowledgeCut`, resolver, `VersionResolution` |
| `src/domain/diff.ts` | **nuevo** · `diffVersions`, `EntryChange`, `ChangeCause`, `FieldDiff` |
| `src/domain/volume.ts` | **nuevo** · `VolumeDiff`, mínimo y acotado |
| `src/domain/schema.ts` | `ProgramKnowledgeCut`, `ProgramVersion` |
| `src/domain/phase-events.ts` | `phaseForDate` y `liveEvents` aceptan corte opcional |
| `src/domain/prescription.ts` | `AsOf` pasa a llevar el corte ancho |

**Persistencia**

| archivo | qué |
|---|---|
| `src/db/collections.ts` | `planVersions`, append-only |
| `src/db/records.ts` | exponerla |
| `src/domain/sync.ts` | `SYNC_SCHEMA_VERSION` 3 → 4 |
| `src/domain/sync.test.ts` | las cuatro propiedades de la compuerta, para 3 → 4 |
| `src/lib/backup.ts` · `api/sync.ts` | añadirla |
| `scripts/rollback-versions.ts` | **nuevo** · sólo el escenario A de §9.2; el B es un procedimiento, no un script |

**Interfaz**

`routes/plan.tsx`: guardar una versión (nombre y motivo obligatorios, aviso de que el
nombre es definitivo, `cutAt <= hoy`), listarlas, y comparar dos. Pantalla de diff con las
cuatro categorías, el volumen y la causa de cada cambio.

---

## 13. Criterios de aceptación

| # | criterio | cómo se comprueba |
|---|---|---|
| 1 | Una versión no cambia nunca sola | pruebas 2, 33, 35 |
| 2 | El corte es un conjunto de ids, jamás un reloj | `git grep` sin comparaciones de fecha en el corte |
| 3 | Se acota antes de decidir | pruebas 7–9 |
| 4 | El corte guarda ids conocidos, no vigentes | pruebas 5, 6 |
| 5 | Cierre referencial completo, incluida la revocación de fase | pruebas 19–23 |
| 6 | Una versión local nunca nace `incomplete` ni `invalid` | pruebas 12–18 |
| 7 | `incomplete` e `invalid` no se confunden | pruebas 22, 27, 28 |
| 8 | Faltar un id no es lo mismo que excluirlo | pruebas 3, 4 |
| 9 | Dos bases distintas no dan dos planes `resolved` | pruebas 29, 30 |
| 10 | El fingerprint es canónico y no mira la procedencia de la siembra | pruebas 24–26 |
| 11 | `cutAt` nunca futuro | pruebas 15, 16 |
| 12 | Las versiones son inmutables | pruebas 31, 32 |
| 13 | Las fases quedan acotadas | pruebas 33–35 |
| 14 | E2 intacta sin corte | prueba 34 + `git diff` de la caracterización |
| 15 | Las cuatro categorías se representan | pruebas 36–38 |
| 16 | El diff es simétrico | prueba 40 |
| 17 | Toda diferencia tiene causa, y la correcta | pruebas 46–51 |
| 18 | La atribución se deriva, no se guarda | prueba 52 |
| 19 | El volumen no depende de la biblioteca | pruebas 42–45 |
| 20 | La compuerta 3 → 4 aguanta | pruebas 55–58 |
| 21 | El rollback remoto está descrito, no prometido | prueba 59 + §9.2 |
| 22 | **Sin motor**: nada propone ni cambia solo | guarda estructural, como G4 en E3 |
| 23 | Los **seis** comandos en verde | exit code 0 en `test`, `typecheck`, `check`, `build`, `verify:import`, `verify` |
| 24 | E3 intacta | 728 pruebas siguen pasando |

## Riesgos

1. **El tamaño del corte crece sin límite.** Aceptado en E4; comprimirlo es exactamente lo
   que convertiría la frontera en algo inferido. Si llega a molestar, se resuelve con menos
   versiones, no con menos honestidad.
2. **Acotar la fase toca E2**, que ya está cerrada y probada. El corte va opcional y la
   ausencia se comporta como hoy, y eso se prueba antes de tocar nada más.
3. **La atribución es la parte con más combinaciones**: ajuste, revocación, transición,
   corrección y fecha, y varias pueden concurrir sobre el mismo hueco. El invariante 17
   obliga a reportar lo no atribuible en vez de enseñar una fila muda, que es la forma de
   que se descubra en vez de acumularse.
4. **Las precondiciones de captura pueden rechazar más de lo que molestaría.** Es
   deliberado: una versión rota es permanente, porque es inmutable, y volver a pulsar el
   botón dentro de dos segundos no lo es.
5. **El upgrade remoto a 4 es una puerta de un solo sentido.** Mitigado subiendo
   `SYNC_SCHEMA_VERSION` sólo cuando E4 esté probada (§9.3), y documentado en §9.2 en vez
   de prometer un downgrade que no existe.
6. **El fingerprint puede rechazar dos bases que son «la misma pero regeneradas».** Si
   volver a sembrar produce filas equivalentes con distinto contenido en algún campo
   comparado, las versiones anteriores pasarían a `baseline-mismatch`. La siembra es
   determinista hoy y por eso no ocurre; si dejara de serlo, es este invariante el que lo
   descubre — que es preferible a resolver contra una base distinta sin decirlo.

---

## Estado

Especificación. **Nada implementado.** Alcance cerrado a `ProgramKnowledgeCut`,
`ProgramVersion` y `diffVersions`.

Fuera de E4, a propósito: renombrar y retirar versiones (§3.3), el desglose de volumen por
músculo (§7.2.1, es E5), readiness, tendencias, motor adaptativo (E6), sugerencias
automáticas y cambios automáticos. El diseño bitemporal que E3 dejó escrito es la infraestructura que E4 usa; E4 no
lo redescubre ni lo amplía más allá de acotar las fases, que E3 ya había dejado anotado
como tarea suya.
