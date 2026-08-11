# Asuntos técnicos abiertos

Cosas observadas que todavía no son un bug confirmado. Un incidente que no se ha podido
reproducir no se arregla a ciegas: arreglar lo que no se entiende suele mover el síntoma
de sitio y quitarle la única pista que había.

---

## T-001 · Una serie registrada no sobrevive a la recarga

**Estado:** **reproducido y diagnosticado** · **Severidad: alta** · Corrección pendiente de aprobación

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

### Corrección propuesta, sin aplicar

Toca durabilidad de datos y merece su propia revisión. Tres piezas:

1. **Esperar el volcado donde importa.** `await collections.sets.insert(...).isPersisted.promise`
   antes de dar la serie por guardada. Convierte los sitios de escritura en asíncronos.
2. **No cerrar la base con escrituras pendientes.** O se esperan antes de cerrar, o no se
   cierra en `pagehide` — el cierre existe para soltar los bloqueos de OPFS, y hay que
   medir si sigue haciendo falta.
3. **Que `syncable()` lleve la cuenta** de las transacciones en vuelo y exponga un
   `whenAllPersisted()`, para que el punto 2 tenga a qué esperar.

`src/db/durability.test.ts` deja las dos primeras como pruebas `it.fails`: afirman el
contrato que la app debería cumplir y hoy fallan a propósito. Cuando la corrección aterrice
empezarán a pasar, y eso hará fallar el `it.fails` — que es la señal para convertirlas en
aserciones normales.

### Cómo volver a correrlo

```bash
npx vite --config vite.harness.config.ts    # http://localhost:4500
```

Se conduce solo. La pestaña puede estar en segundo plano: usa un reloj de `MessageChannel`
porque Chrome estrangula `setTimeout` a uno por minuto en pestañas ocultas — lo que al
principio hacía que una iteración tardara 100 s en vez de 0,8.
