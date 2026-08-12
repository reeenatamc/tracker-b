# Asuntos técnicos abiertos

Cosas observadas que todavía no son un bug confirmado. Un incidente que no se ha podido
reproducir no se arregla a ciegas: arreglar lo que no se entiende suele mover el síntoma
de sitio y quitarle la única pista que había.

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
