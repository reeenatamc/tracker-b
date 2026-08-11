# T-001 · auditoría de los sitios de escritura

34 llamadas a `insert` / `update` / `delete` en 8 archivos. **Ninguna espera nada hoy.**

## Cómo están clasificados

No todo necesita esperar, y decir que sí lo necesita todo sería tan poco útil como no
esperar en ninguno. Tres clases:

| Clase | Qué significa | Qué se hace |
|---|---|---|
| **Crítica** | Dato que sólo existe porque la persona lo tecleó. Perderlo es perder entrenamiento. | Se espera `isPersisted` y la UI no dice «guardado» hasta que resuelva. |
| **Preferencia** | Ajustes que se pueden rehacer en diez segundos. Molesto, no grave. | Se registra en el tracker; no se bloquea la interfaz. |
| **Reconstruible** | Siembra y migraciones. Son idempotentes y vuelven a correr en cada arranque. | Se registra; una pérdida se cura sola en el siguiente arranque. |

## Registro de entrenamiento — crítico

| Archivo · línea | Colección | Op | Hoy espera | Debe esperar | Si falla la persistencia |
|---|---|---|---|---|---|
| `routes/index.tsx:200` `saveSet` | `sets` | insert | nada | **`isPersisted`** | La serie no se da por guardada; se avisa y se puede reintentar. **El sitio que motiva todo esto.** |
| `routes/index.tsx:179` `saveCardio` | `sets` | insert | nada | **`isPersisted`** | Igual: el bloque de cardio es un registro. |
| `routes/index.tsx:272` finisher | `sets` | insert | nada | **`isPersisted`** | Igual. |
| `routes/index.tsx:608` editar serie | `sets` | update | nada | **`isPersisted`** | Una corrección perdida deja el dato mal, que es peor que no tenerlo. |
| `routes/index.tsx:614` borrar serie | `sets` | delete | nada | **`isPersisted`** | Una serie borrada que reaparece confunde más que un fallo visible. |
| `routes/history.tsx:157` | `sets` | update | nada | **`isPersisted`** | Igual que la edición: alimenta la progresión. |
| `routes/history.tsx:163` | `sets` | delete | nada | **`isPersisted`** | Igual que el borrado. |
| `routes/index.tsx:132` `ensureSession` | `sessions` | insert | nada | **`isPersisted`** | Sin sesión, las series quedan huérfanas. Se espera antes de escribir la primera serie. |
| `routes/index.tsx:171` `finishSession` | `sessions` | update | nada | **`isPersisted`** | Se pierde la duración de la sesión. |
| `routes/ankle.tsx:94` | `ankleChecks` | insert | nada | **`isPersisted`** | Es la medición que gobierna las reglas de seguridad. |
| `routes/ankle.tsx:90` | `ankleChecks` | update | nada | **`isPersisted`** | Igual. |
| `routes/progress.tsx:195` | `progressChecks` | insert | nada | **`isPersisted`** | Peso y medidas: se toman una vez por semana y no se repiten. |
| `routes/progress.tsx:197` | `progressChecks` | update | nada | **`isPersisted`** | Igual. |
| `routes/progress.tsx:206` | `progressChecks` | delete | nada | **`isPersisted`** | Igual. |
| `routes/inspo.tsx:126` | `inspo` | insert | nada | **`isPersisted`** | La foto ya está en OPFS; si la fila se pierde, queda huérfana y ocupando. |
| `routes/inspo.tsx:44` | `inspo` | delete | nada | **`isPersisted`** | Un borrado perdido resucita una foto que se quiso quitar. |

## Preferencias — se rehacen

| Archivo · línea | Colección | Op | Hoy espera | Debe esperar | Si falla la persistencia |
|---|---|---|---|---|---|
| `routes/index.tsx:222` | `overrides` | update | nada | registro en el tracker | Se vuelve a ajustar. No bloquea la interfaz. |
| `routes/index.tsx:226` | `overrides` | insert | nada | registro | Igual. |
| `routes/index.tsx:639` | `overrides` | delete | nada | registro | Igual. |
| `routes/index.tsx:253` | `customExercises` | insert | nada | registro | El ejercicio se vuelve a añadir. |
| `routes/index.tsx:264` | `customExercises` | insert | nada | registro | Igual. |
| `routes/index.tsx:151` · `:236` · `:245` · `:255` · `:267` · `:671` | `sessions` | update | nada | registro | Saltar, reponer o anotar un ejercicio. Se rehace en un toque. |

## Reconstruibles — se curan solas

| Archivo · línea | Colección | Op | Hoy espera | Debe esperar | Si falla la persistencia |
|---|---|---|---|---|---|
| `lib/seed.ts:101` · `:102` | `sets` | delete · insert | nada | registro | `syncSeed` reconcilia en cada arranque: la siembra vuelve. |
| `lib/seed.ts:105` | `sessions` | insert | nada | registro | Igual. |
| `lib/migrate-exercise-ids.ts:43` · `:55` | `sets` · `overrides` | update | nada | registro | Idempotente y corre en cada arranque. |
| `lib/migrate-phase-ids.ts:72` | `sessions` | update | nada | registro | Igual. |
| `lib/migrate-phase-ids.ts:116` | `phaseEvents` | insert | nada | registro | Los ids son deterministas: sembrar de nuevo reconcilia. |

## Fontanería — no son sitios de llamada

`db/synced.ts` y `lib/backup.ts` contienen `insert`/`update` dentro de envoltorios y del
restaurador. No son decisiones de la app: son el mecanismo por el que pasan las de arriba,
y es exactamente ahí donde se engancha el tracker para no depender de que cada llamador se
acuerde.

`lib/sync-client.ts` escribe por `raw`, que no pasa por el envoltorio — correcto: lo que
llega de otro dispositivo ya nació persistido allí.

## Lo que la tabla deja claro

De 34 sitios, **16 son críticos** y todos menos dos viven en tres pantallas. El arreglo no
es esparcir `await` por todas partes: es que la infraestructura registre siempre, y que
esas dieciséis esperen.
