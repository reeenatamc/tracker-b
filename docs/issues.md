# Asuntos técnicos abiertos

Cosas observadas que todavía no son un bug confirmado. Un incidente que no se ha podido
reproducir no se arregla a ciegas: arreglar lo que no se entiende suele mover el síntoma
de sitio y quitarle la única pista que había.

---

## T-001 · Una serie registrada no sobrevivió a la recarga

**Estado:** abierto, sin reproducir · **Severidad si se confirma:** alta · **Detectado:** 11 ago 2026, smoke test de cierre de E1

### Qué se observó

Durante el smoke test de E1, sobre el build de producción servido en un origen aislado:

1. Se pulsó «Empezar sesión» en el día de cardio + tobillo.
2. Se guardó la primera serie de `knee_to_wall`. La interfaz respondió como corresponde:
   avanzó al ejercicio siguiente y **arrancó el temporizador de descanso**, que sólo se
   dispara después de insertar la serie. Así que la escritura ocurrió.
3. Se navegó al historial con una carga de página completa, unos dos segundos después.
4. El historial mostraba **15 series** — exactamente las de la sesión base sembrada. La
   serie recién registrada no estaba.

La `SessionRecord` sí sobrevivió: el reloj de sesión siguió corriendo tras la recarga y la
sesión aparecía en el historial. Sólo se perdió la `SetRecord`.

### Qué se intentó después, sin reproducirlo

| Intento | Condiciones | Resultado |
|---|---|---|
| 2 | Guardar, esperar 6 s, navegar | Se perdió — **pero el clic pudo no registrarse**: se usó una referencia de elemento obtenida antes de una recarga, y no se verificó que la interfaz avanzara |
| 3 | Guardar, verificar avance, esperar 5 s, navegación del router, recarga completa | **Persistió** (16 series) |
| 4 | Guardar y forzar recarga **120 ms** después | **Persistió** (17 series) |
| 5 | Origen limpio, **primera serie de una sesión recién creada**, recarga 120 ms después | **Persistió** (16 series) |

El intento 5 reproduce las condiciones exactas del intento 1 —primera serie de una sesión
nueva, recarga casi inmediata— y no falló.

### Hipótesis, por orden de plausibilidad

1. **El clic del intento 2 no llegó a ocurrir**, y el intento 1 fue una carrera entre el
   vaciado a OPFS y el `pagehide` que dispara `database.close()` en `db/collections.ts`.
   Encajaría con que la sesión —escrita ~20 s antes— sí sobreviviera y la serie no.
2. Alguna diferencia entre la navegación a nivel de pestaña usada en el intento 1 y la
   navegación de página de los intentos 4 y 5.
3. Un reinicio de colección de la capa de persistencia. El archivo SQLite contenía nueve
   filas con `knee_to_wall` cuando la sesión base sólo tiene una, lo que indica escrituras
   que después dejaron de leerse — aunque las páginas liberadas de SQLite también explican
   ese recuento, así que no prueba nada por sí solo.

### Por qué importa

Es la capa que guarda lo que se hace en el gimnasio. Una serie perdida en silencio es peor
que un error visible: el registro es la razón de ser de la app, y el motor de progresión
lee la última sesión para decidir la siguiente carga.

### Qué NO es

No lo introdujo E1. Toda la ruta implicada —`db/collections.ts`, `db/synced.ts`,
`db/records.ts`, `routes/index.tsx`— quedó sin tocar en esa etapa, verificado con
`git status`.

### Siguiente paso cuando se retome

Instrumentar antes que arreglar: registrar el momento de la inserción y el del vaciado a
OPFS, y correr un bucle de guardar-y-recargar unas cincuenta veces buscando la ventana.
Si aparece, la corrección probable es esperar a que la escritura se confirme antes de
soltar los manejadores en `pagehide`.

**Mientras tanto:** el respaldo sigue siendo la red de seguridad, y ahora tiene pruebas.
