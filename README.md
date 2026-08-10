# tracker-b

Un tracker de entrenamiento que funciona sin internet, porque se usa de pie, con una mano,
entre series.

Nació de un Excel de 8 hojas: un programa de 19 semanas con fuerza full-body, rehabilitación
de tobillo, cardio y nutrición. El Excel era un buen plan y un mal registrador — 15 columnas
no se llenan en el gimnasio. Esto separa las dos cosas: el plan es contenido, el registro es
una base de datos, y todo lo demás se calcula.

## Lo que hace que valga la pena

Las reglas de progresión del programa son deterministas:

> Mantén el peso hasta completar el tope de reps en todas las series con técnica limpia y RIR
> cercano al objetivo de la fase; luego sube el incremento mínimo.

Eso es una función pura. La columna «próximo objetivo» que antes se llenaba a mano ahora se
calcula, y al abrir un ejercicio la carga y las reps llegan precargadas con lo que dice el
programa y lo que hiciste la vez pasada.

Una regla manda sobre todas: si hay dolor relevante (≥ 3/10), hinchazón o un episodio de
inestabilidad, la app **no sugiere subir carga**. La lógica no empuja peso sobre una señal de
alarma.

## Stack

| Pieza | Para qué |
|---|---|
| TanStack Start (SPA) | Routing por archivos. Sin SSR: no hay nada que un servidor pueda renderizar |
| TanStack DB + wa-sqlite | SQLite real en el navegador sobre OPFS. Las escrituras no tocan la red |
| Zod | Valida el contenido al arrancar; los tipos se infieren de ahí |
| Tailwind 4 · Biome · Vitest | Estilos, formato y lint, pruebas |

El service worker es propio (`plugins/service-worker.ts`): precachea el build entero y sirve
cache-first. `vite-plugin-pwa` no llega a emitir un worker bajo el build de dos entornos de
TanStack Start.

## Privacidad

Este repo es público y guarda **solo código**.

```
content/           🔒 gitignored — tu programa, tu menú, tu planificación
data/              🔒 gitignored
*.xlsx             🔒 gitignored
content.example/   ✅ público — muestra genérica para que el repo corra
```

Tus registros viven en el navegador del dispositivo, en OPFS. No hay servidor que los vea.

El alias `@content` apunta a `content/` cuando existe y a `content.example/` cuando no, así
que un clon limpio compila y arranca sin tener nada tuyo.

## Empezar

```bash
npm install
npm run import:excel   # xlsx -> content/*.yaml  (necesita tu propio archivo)
npm run dev            # http://localhost:4310
```

Sin `content/` arranca igual, con el programa de ejemplo.

## Comandos

| | |
|---|---|
| `npm run dev` | Servidor de desarrollo, expuesto también en la red local |
| `npm test` | Pruebas del dominio |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run check` | Biome: formato y lint |
| `npm run build` | Build de producción a `dist/client` |
| `npm run deploy` | Construye y publica en Vercel (ver `deploy/README.md`) |
| `npm run import:excel` | Regenera `content/` desde el Excel |
| `npm run icons` | Regenera los iconos del PWA |

## Estructura

```
content/            🔒 el plan: programa, protocolo de tobillo, fuentes
content.example/    ✅ la misma forma, contenido genérico
plugins/            service worker
scripts/            importador del Excel, generador de iconos
src/
  domain/           ← lógica pura, sin React, cubierta por pruebas
    progression.ts    doble progresión -> siguiente objetivo
    phases.ts         fecha -> fase -> series y RIR
    schedule.ts       día -> sesión
    safety.ts         señales de alarma bloquean la progresión
    history.ts        qué hiciste la vez pasada
  db/               colecciones de TanStack DB y su persistencia
  components/       controles del registro
  routes/           / · /ankle · /history
```

`domain/` no importa React ni toca I/O. Ahí vive lo único que puede estar mal, y por eso es lo
único con pruebas.

## Estado

En uso. El offline está verificado: con el servidor apagado la app abre, lee su base de datos
y muestra el historial.

Desplegado en Vercel con Deployment Protection, porque el bundle lleva dentro el programa de
`content/`, que es personal. La URL pide iniciar sesión antes de servir nada. El build se hace
en local (`npm run deploy`) para que el YAML nunca llegue a Vercel — solo el compilado.

Pendiente:

- Sync entre celular y laptop con ElectricSQL sobre Postgres. Se cambia
  `persistedCollectionOptions` por `electricCollectionOptions` en `src/db/collections.ts`;
  los componentes no se tocan.
- Nutrición, progreso semanal y gráficas de tendencia.
- Export de vuelta a xlsx.

## Nota

Este tracker sigue progreso; no reemplaza un diagnóstico clínico.
