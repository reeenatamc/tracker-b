# Asuntos técnicos abiertos

Cosas observadas que todavía no son un bug confirmado. Un incidente que no se ha podido
reproducir no se arregla a ciegas: arreglar lo que no se entiende suele mover el síntoma
de sitio y quitarle la única pista que había.

---

## T-004 · Restaurar un respaldo viejo lo hacía parecer nuevo

**Estado: RESUELTO** · **Severidad era: alta** · encontrado migrando E3 en 4511

> Un defecto de E3, no de `main`. Sólo aparece con datos reales, porque hace
> falta un respaldo escrito antes de que los campos existieran.

### Lo que pasó

Migración E3 sobre una copia del respaldo real, en un origen aislado:

```
baselineSeeded        26
phaseAdjustments       0
overrideAdjustments    0
sessionsMarkedLegacy   0     ← eran 2
```

y la recuperación denunciaba las dos sesiones reales:

```
21551819  2026-08-10  snapshot-unresolvable
61bf95ef  2026-08-11  snapshot-unresolvable
```

«Esta sesión apuntaba a una instantánea y ha desaparecido», sobre sesiones que
nunca tuvieron ninguna.

### Causa raíz · ausente no es lo mismo que `null`

Las filas de un respaldo anterior a E3 **no traen las claves**: no vienen a
`null`, vienen sin existir, porque el campo no existía cuando se escribió el
archivo.

```
"prescriptionContract" in sesión → false
"snapshotId" in sesión           → false
```

Y E3 comparaba con `=== null` / `!== null`, que es falso para `undefined`:

| sitio | qué hacía |
|---|---|
| `markLegacy` | `prescriptionContract === null` → salta justo las filas que la migración existe para marcar |
| `planRecovery` | `snapshotId !== null` → `undefined !== null` es **true** → «instantánea desaparecida» |
| `inForce` | `onlyInPhase !== null` → una compuerta que nadie puso excluiría todas las fases |
| `validateAdjustments` | `safetyResolution === null` → una resolución ausente parecería puesta |

Los dos últimos eran latentes: los ajustes son nativos de E3 y Zod los rellena.
Se corrigen igual, porque la regla es la misma.

### Y debajo · restaurar no es escribir

`importBackup` escribía por la colección normal, así que `syncable` sellaba cada
fila con `schemaVersion: 3`. Eso destruye la única prueba que distingue «fila
vieja, el campo no existía» de «fila escrita bajo E3 que perdió su campo» — y la
segunda es una corrupción que hay que denunciar.

Con las comparaciones arregladas pero el sello puesto, una sesión de agosto
restaurada hoy seguiría clasificándose como fila de E3 rota. El arreglo de la
comparación sin el del sello no habría bastado.

Ahora la restauración pasa por `raw`, tal cual el archivo la trae: sin
`schemaVersion` en el archivo, sin `schemaVersion` en la base. Las migraciones de
arranque corren antes de que nada lea o sincronice —T-002 puso ese orden— así
que una fila vieja puede conservar su metadata ausente sin riesgo hasta que la
migración la nombre.

**RESTORE ≠ CREATE.** Rellenar el hueco con la versión de hoy, porque hoy es
cuando pulsaste el botón, es el mismo defecto con otro sombrero.

### Y una corrección que salió de la misma corrida

La sesión de tobillo se reconstruía con **cero entradas** y decía `complete`. No
era un número mal calculado: era un silencio seguro de sí mismo. El ejecutor
sabía que un día de tobillo saca su prescripción del protocolo indexado por
semana; la recuperación no, y le pasaba la base de fuerza, que para
`cardio_ankle` no tiene ninguna fila.

`domain/session-plan.ts` deja esa decisión en un sitio —`sessionBaseline`— y la
consumen los dos: el ejecutor al congelar y la recuperación al reconstruir. Y
cuando de verdad no se puede construir un plan, devuelve el motivo en palabras,
que el llamante convierte en `partial` con el hueco nombrado.

Debajo, una red: `reconstruct` no puede declarar `complete` una reconstrucción
sin entradas. Decir «lo tengo todo» sobre nada es peor que admitir que no se
sabe, así que si nadie nombró el hueco, lo nombra ella.

### Lo que lo protege

`src/lib/restore-legacy.test.ts` cubre los seis casos con fixtures que **omiten**
la propiedad en vez de ponerla a `null` — una prueba que escriba
`{ prescriptionContract: null }` pasa con el código roto. Respaldo anterior a E3,
respaldo de schema 2, respaldo de E3 en regla, fila de schema 3 corrupta,
restauración que no cambia metadatos, e importar dos veces. Con el código
anterior fallan seis.

`src/domain/session-plan.test.ts` cubre la otra mitad: que un día de tobillo
histórico se reconstruya con sus huecos `rehab_*`, en orden, con los ejercicios
de esa semana y no de otra; que un ajuste vigente entonces entre y uno posterior
no; que congelar y reconstruir pidan la base al mismo sitio; y que `complete`
nunca pueda describir una prescripción vacía.

---

## T-003 · Offline sólo abría la ruta en la que ya estabas

**Estado: RESUELTO** · **Severidad era: media** · encontrado en el smoke test de 4510

> Dos defectos en el mismo service worker, que se combinaban para producir un
> síntoma que no se parecía a ninguno de los dos.

### El síntoma

Build de producción, origen limpio, worker activo, los 17 assets precacheados.
Matas el servidor y recargas: la app abre entera. Navegas a otra ruta:

```
Failed to fetch dynamically imported module: /assets/history-BWkQwDV0.js
```

Lo que hacía el diagnóstico confuso: ese chunk **está** en la caché, y un `fetch()`
del mismo URL desde la página devolvía **200 con 6945 bytes**. Un `fetch()` que
responde 200 no demuestra que el módulo sea importable, y aquí es donde estaba la
pista.

### Causa raíz · `Vary` convierte el precache en un fallo

`caches.match(request)` respeta la cabecera `Vary` de la respuesta guardada. Los
assets se sirven con **`Vary: Origin`** —`vite preview` lo pone, y no es una
rareza suya—. El precache los guarda con `cache.add(url)`, que construye una
petición `mode: "no-cors"`, `credentials: "omit"` y **sin cabecera `Origin`**.

Un **módulo** se pide en modo CORS, así que **sí** lleva `Origin`. La comparación
de `Vary` falla y la entrada precacheada no se encuentra.

Medido sobre el mismo URL, con el mismo worker, en el mismo instante, sin servidor:

| petición | `destination` | `Origin` | rama del worker | resultado |
|---|---|---|---|---|
| `import()` | `script` | `http://localhost:4520` | `asset:failed` | **falla** |
| `fetch()` | `""` | `null` | `asset:precache-hit` | 200 · 15 427 bytes |

y en la que falla, `caches.match(request, { ignoreVary: true })` **sí** acierta.

Con red, el fallo es invisible: el miss cae a la rama de red y la red responde.
Sin red, el módulo no llega nunca. Y sólo muerde a los **chunks de ruta cargados
en diferido**, porque son los únicos assets que se piden como módulo después de
que el shell ya esté cargado — de ahí que la ruta de entrada funcionara y ninguna
otra.

`Content-Encoding: gzip` en las respuestas guardadas era una pista falsa: con
`ignoreVary` el mismo módulo con la misma cabecera importa sin problema.

### Segundo defecto · cada navegación se llevaba el shell

La rama de navegación guardaba **toda** respuesta de navegación correcta bajo la
clave `/`. Y `/` y `/history` no devuelven el mismo HTML: cada ruta trae sus
propios `modulepreload`.

```
sólo en / :        routes-*.js, achievements-*.js, TickScale-*.js, safety-*.js
sólo en /history:  history-*.js, photos-*.js
```

Así que visitar `/history` con red dejaba el shell de `/history` como shell
offline de toda la app. Al abrir `/` sin red se cargaba un HTML que no menciona
`routes-*.js`, la ruta lo pedía en diferido, y ahí se encontraba con el primer
defecto. Los dos juntos son lo que hacía que el síntoma cambiara según por dónde
hubieras pasado antes.

### El arreglo

Los assets se buscan con **`ignoreVary: true`**. Sus nombres llevan el hash del
contenido, así que el URL es toda su identidad: nada en la petición puede elegir
legítimamente otro cuerpo, y respetar `Vary` sólo puede hacer fallar una búsqueda
que tenía que acertar.

El shell sólo se refresca desde una navegación **a `/`**. Las demás siguen yendo
a la red primero y cayendo al shell guardado cuando no hay, pero ya no se
convierten en él.

### Lo que lo protege

`plugins/service-worker.test.ts` ejecuta el worker generado de verdad contra una
`CacheStorage` falsa que implementa la semántica de `Vary`, y conduce peticiones
reales por su manejador de `fetch`. Con el código anterior falla; con el nuevo,
pasa. Cubre las tres cosas: que un módulo con `Origin` acierte en el precache,
que una petición con destino `script` nunca reciba el shell, y que una navegación
a otra ruta no reemplace el shell guardado.

### Cómo se comprobó a mano

Origen nuevo, build limpia, y los tres escenarios que pediste: producción con
servidor vivo y worker; con servidor muerto y worker; y con servidor muerto sin
worker, que falla como control.

---

## T-002 · Las reconciliaciones de arranque corrían sobre una base vacía

**Estado: RESUELTO** · **Severidad era: alta** · encontrado validando el restore pre-E3

> Dos defectos, y el primero llevaba tres etapas tapando al segundo.

### Cómo apareció

Restaurando un respaldo real en un origen aislado (`localhost:4510`, `main`, OPFS vacío)
para tener un control anterior a E3. El restore trajo todo —3 sesiones, 43 series, 3
chequeos de tobillo, 1 ejercicio propio, 2 inspo, 1 foto, sin huérfanos ni duplicados— y
aun así el historial mostraba «1» donde debía decir «Adaptación», y `curl-femoral` donde
debía decir «Curl femoral».

### A · La barrera que no existía

`getCollections()` resuelve cuando las colecciones están **construidas**; las filas llegan
de OPFS después. Las tres reconciliaciones corrían en ese hueco. Medido dentro de
`provider.tsx`, sobre una base que en ese mismo instante tenía 3 sesiones y 43 series:

```
sesionesAlEmpezar: 0    setsAlEmpezar: 0
migratePhaseIds → { sessionsMigrated: 0, eventsSeeded: 4, unmapped: [] }
```

`unmapped: []` es lo que lo hacía invisible: no es que no supiera mapear las fases, es que
no vio ninguna fila. Un reconciliador que recorre cero filas no se queja de nada.

Consecuencia sobre el respaldo restaurado: las 3 sesiones se quedaron con `phase: 1` para
siempre, y 8 de 20 ids de ejercicio distintos se quedaron en su forma anterior a E1.

### B · Lo que había debajo

Con la barrera puesta, el arranque dejó de terminar: se quedaba en «Abriendo tu registro…»
indefinidamente. Con un `try/catch` alrededor apareció la causa:

```
CollectionOperationError: Cannot insert document with ID "seed-2026-08-08-0"
because it already exists in the collection
```

`syncSeed` borraba sus series y las reinsertaba cuando no coincidían. Pero `delete` en esta
app es una lápida —`syncable` marca `deletedAt` y deja la fila—, así que el id seguía
ocupado y el `insert` siguiente chocaba. Y chocaba **después** de los borrados: 15 series
con lápida y ninguna reescrita.

Peor aún, el `throw` ocurría dentro del callback de un `.then(alHacerlo, alFallar)`. El
segundo argumento sólo atrapa fallos de la promesa original, nunca los del primero, así que
quedaba como rechazo sin gestionar: ni pantalla de error ni salida.

**A tapaba a B.** Tal como estaba `main`, nada reventaba y nada se perdía: el restore
simplemente se quedaba a medias. En cuanto se arreglaba A sin arreglar B, el arranque se
rompía y se tumbaban 15 series.

### El arreglo

`src/db/bootstrap.ts` centraliza la barrera y el orden. La barrera está una vez, no en cada
migrador: uno que tenga que acordarse de esperar es uno que se olvidará, y el fallo es
silencioso.

```
hidratar (preload de todas)
  → migrateExerciseIds
  → migratePhaseIds
  → syncSeed          ← compara contra filas que las dos anteriores ya arreglaron
  → READY
  → sync remoto
```

`syncSeed` reconcilia **por id**: actualiza si existe, revive si tiene lápida, inserta si no
está. Nunca borra para recrear el mismo id. Lo único que retira —filas de una siembra
anterior más larga— va al final, cuando ya nada puede lanzar. La garantía es que un fallo a
mitad puede dejar filas que reconciliar en el siguiente arranque, y nunca menos de las que
había.

El provider envuelve toda la cadena en un `try/catch` y la espera: hay dos finales,
`listo` o `error visible`, y no hay un tercero.

### Un tercer agujero que la barrera cierra de paso

`applyRemote` decide entre `update` e `insert` con `has(id)`. Sobre una colección sin
hidratar, `has` devolvía `false` para una fila que sí estaba en disco, así que el primer
`syncOnce()` podía intentar insertarla y chocar. `SyncProvider` es hijo de
`CollectionsProvider` y sólo se monta en el estado listo — y ahora «listo» significa además
«hidratada».

### Lo que lo protege

`src/db/bootstrap.test.ts` modela colecciones que devuelven vacío hasta que su `preload()`
resuelve, que es como se comportan las de verdad, y comprueba que ningún reconciliador ve
cero filas mientras aún llegan datos. Con el orden viejo estas pruebas fallan.
`src/lib/seed.test.ts` cubre id repetido, lápida, sobrantes, fallo a mitad e idempotencia.
`src/db/provider.test.ts` fija la forma de la cadena y que el sync no arranca antes de READY.

### Lo que queda anotado, no arreglado

La capa de persistencia llama a `markReady()` también cuando la hidratación **falla**, así
que una colección que no pudo cargar llega a la barrera vacía y con aspecto de resuelta. Es
un fallo peor que este y necesita su propia respuesta.

---

## T-001 · Una serie registrada no sobrevive a la recarga

**Estado: RESUELTO** · commit `e30a16d` · etiqueta `t001` · **Severidad era: alta**

> **Antes:** 120 pérdidas / 250 iteraciones.
> **Después:** 0 / 250, y 0 / 400 en la corrida extendida — 2 795 escrituras en total.
> El harness se conserva en `harness/` como prueba de regresión: cualquier cambio futuro
> en persistencia se mide contra estos mismos diez escenarios.

### Reproducido: 120 pérdidas en 250 iteraciones

`harness/` escribe a través de la capa de persistencia real de la app, interrumpe la página
a distancias variables de la escritura, reabre la base y cuenta. Cada intento distingue
cuatro cosas, porque tienen causas distintas y tres de ellas no son pérdida de datos.

| Escenario | ok | vista vieja | **perdidas** |
|---|---:|---:|---:|
| sin interrupción (250 ms) | 24 | 1 | **0** |
| guardar → recargar 50 ms | 24 | 1 | **0** |
| guardar → recargar 5 ms | 23 | — | **2** |
| guardar → recargar 0 ms | 19 | — | **6** |
| guardar → navegar 5 ms | 23 | — | **2** |
| guardar → navegar 0 ms | 15 | — | **10** |
| doble click | — | — | **25 / 25** |
| ráfaga de 10 | — | — | **25 / 25** |
| ráfaga bajo carga | — | — | **25 / 25** |
| `pagehide` durante la escritura | — | — | **25 / 25** |

**Cero** «click no recibido». **Cero** «escritura iniciada pero no terminada»: `insert()`
devolvió siempre. Aun así la fila no estaba en el disco.

La curva dosis-respuesta es la firma de una carrera: cuanto menos tiempo entre la escritura
y la interrupción, más se pierde. A 250 ms no se pierde nada; en el mismo tick se pierde
todo.

### Causa raíz

`collection.insert()` **no escribe en disco**. Devuelve una `Transaction` cuyo
`isPersisted.promise` se resuelve cuando el volcado ocurre de verdad — así lo dice el
contrato de TanStack DB, literalmente: *«Await `isPersisted.promise`»*.

**La app lo descarta en los diecinueve sitios donde escribe.** Cero apariciones de
`isPersisted` en todo `src/`. La serie existe en memoria, la pantalla se actualiza, el
temporizador de descanso arranca — y que llegue a OPFS depende de que la página siga viva
lo suficiente.

Y hay un segundo mecanismo que convierte la carrera en certeza:

```ts
// src/db/collections.ts
window.addEventListener("pagehide", () => {
    void database.close?.();      // ← con escrituras aún pendientes
}, { once: true });
```

Se cierra la base justo cuando los volcados siguen en vuelo. Por eso el escenario que
dispara `pagehide` a mano pierde 25 de 25.

### Por qué se vio una vez y no las cuatro siguientes

Porque el intento original navegó ~2 s después de guardar, y los intentos de reproducción
esperaron o navegaron por rutas del router en vez de recargar. La ventana es de
milisegundos. Lo que la abre de par en par no es esperar poco: es **escribir dos veces
seguidas**, que es lo que hace un doble toque o el registro rápido de dos series.

### Qué NO es

No lo introdujeron E1 ni E2. Es anterior a las dos, y vive entero en
`db/collections.ts` y en cómo la app llama a `insert()`.

### Corrección aplicada

| Escenario | antes | después |
|---|---:|---:|
| sin interrupción · recargar 50 ms | 0 | 0 |
| recargar 5 ms | 2 | **0** |
| recargar 0 ms | 6 | **0** |
| navegar 5 ms | 2 | **0** |
| navegar 0 ms | 10 | **0** |
| doble click | 25/25 | **0** |
| ráfaga de 10 | 25/25 | **0** |
| ráfaga bajo carga | 25/25 | **0** |
| `pagehide` durante la escritura | 25/25 | **0** |
| **total** | **120 / 250** | **0 / 250** |

Las tres piezas:

Toca durabilidad de datos y merece su propia revisión. Tres piezas:

1. **Esperar el volcado donde importa.** `await collections.sets.insert(...).isPersisted.promise`
   antes de dar la serie por guardada. Convierte los sitios de escritura en asíncronos.
2. **No cerrar la base con escrituras pendientes.** O se esperan antes de cerrar, o no se
   cierra en `pagehide` — el cierre existe para soltar los bloqueos de OPFS, y hay que
   medir si sigue haciendo falta.
3. **Que `syncable()` lleve la cuenta** de las transacciones en vuelo y exponga un
   `whenAllPersisted()`, para que el punto 2 tenga a qué esperar.

Y una cuarta que no estaba en la propuesta: un fallo real de persistencia ahora llega a la
pantalla. `SaveStatus` se sienta encima de la barra de pestañas, por delante del estado de
sincronización, y no se va solo — un aviso sobre una serie posiblemente perdida que se
desvanece en tres segundos es un aviso para quien estuviera mirando la pantalla, y el
sentido de todo esto es que estabas mirando la barra.

`src/db/durability.test.ts` protege el resultado en tres frentes: las dos afirmaciones que
la app incumplía son ahora aserciones normales; una guarda estructural exige que toda
escritura a una colección crítica desde una pantalla espere al disco, con una lista
explícita de excepciones que obliga a justificar cada una; y `persisted()` se comprueba
contra un rechazo real.

### Cómo volver a correrlo

```bash
npx vite --config vite.harness.config.ts    # http://localhost:4500
```

Se conduce solo. La pestaña puede estar en segundo plano: usa un reloj de `MessageChannel`
porque Chrome estrangula `setTimeout` a uno por minuto en pestañas ocultas — lo que al
principio hacía que una iteración tardara 100 s en vez de 0,8.
