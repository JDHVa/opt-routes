# DESIGN.md: guía visual y de UX de RouteOpt NL

Obligatoria para todo el código de `apps/web`. Una entrega de frontend que la ignore se rechaza en la revisión.

**Idea rectora:** RouteOpt es una **herramienta**, no una landing de startup. El protagonista es el mapa con las rutas, y los datos van después. La UI debe sentirse como Linear, Vercel, Felt o Mapbox Studio: sobria, densa sin agobiar, precisa y rápida. Si algo "se ve como hecho por IA", está mal.

---

## 1. Principios
1. **Datos > decoración.** Cada píxel muestra algo real del problema o de la solución. No hay KPIs inventados, ilustraciones de relleno ni números de ejemplo fuera de los escenarios demo.
2. **Un solo acento.** La UI es casi neutra; el color vive en las rutas del mapa y en el acento de las acciones primarias.
3. **Jerarquía con tipografía y espacio, no con cajas.** Primero se usa peso, tamaño, color secundario y espacio; recuadros y sombras son el último recurso.
4. **Progresivo.** Lo básico está visible y lo avanzado se despliega bajo demanda.
5. **Honesto.** El progreso refleja el solver real (iteración, mejor fitness, tiempo). Los errores dicen la causa y ofrecen reintentar.
6. **Rápido.** Interacciones de menos de 100 ms, animaciones cortas y nada que bloquee el mapa.

## 2. Anti-patrones prohibidos ("AI slop")
- Gradientes morado-azul, violeta o índigo, blobs "aurora", fondos con ruido y glows de neón.
- Glassmorphism decorativo (`backdrop-blur` sobre todo). Solo se permite blur sutil en paneles flotantes **sobre el mapa**, con un máximo de 8 px y fondo sólido al 92 % o más.
- Emojis como iconos. Solo se usa Lucide, con stroke 1.5–1.75 y tamaños de 16 o 20 px.
- Hero centrado con "Supercharge your…", "Unlock the power of…" o "Revolutionize…".
- Grillas de tarjetas idénticas con icono, título y dos líneas, y sombras grandes (`shadow-xl`, `shadow-2xl`).
- `rounded-2xl` o `rounded-3xl` por todas partes y botones en forma de píldora para todo.
- Badges "Live" pulsando sin motivo, contadores animados con números inventados y spinners eternos sin información. (Animar **valores reales** sí está permitido; ver §12.)
- Texto gris claro sobre fondo gris (contraste < 4.5:1) y dark mode de negro puro `#000` con texto blanco puro.
- Magic UI, Aceternity y similares para componentes decorativos, y librerías de "efectos".
- Copys vagos ("Seamless", "Effortless", "AI-powered" sin decir qué hace). Cada texto describe la acción concreta.
- Mezclar varias familias de iconos, más de dos familias tipográficas o más de un color de acento.

## 3. Stack de UI
| Uso | Elección |
|---|---|
| Componentes | **shadcn/ui** sobre **Base UI** (default actual de `npx shadcn init`), copiados al repo en `src/components/ui/` |
| Estilos | Tailwind v4 con tokens CSS en `globals.css` (OKLCH) |
| Iconos | `lucide-react` |
| Toasts | `sonner` |
| Paleta de comandos | `cmdk` (⌘K: cargar escenario, optimizar, cambiar algoritmo, idioma y tema) |
| Animación | `motion` (`motion/react`), solo donde aporta |
| Mapa | `maplibre-gl` + `react-map-gl/maplibre`, estilos de OpenFreeMap |
| Charts | `recharts` (convergencia, comparador, Pareto) |
| Tipografía | paquete npm `geist` (Geist Sans + Geist Mono) |
| Estado | `zustand` |
| Tema | `next-themes` (light, dark y system) |

No se agregan librerías visuales fuera de esta tabla sin aprobación.

## 4. Tokens
Todos los colores se definen en `src/app/globals.css` como variables OKLCH y se mapean a Tailwind v4 con `@theme inline`. Los componentes **nunca** usan hex ni colores de la paleta de Tailwind (`bg-blue-500`, etc.), solo tokens (`bg-surface`, `text-muted`, `border-border`, `bg-accent`…).

### Neutros y acento
| Token | Light | Dark | Uso |
|---|---|---|---|
| `--bg` | `oklch(0.985 0.002 250)` | `oklch(0.165 0.005 250)` | fondo de la app |
| `--surface` | `oklch(1 0 0)` | `oklch(0.205 0.006 250)` | paneles, popovers |
| `--surface-2` | `oklch(0.965 0.003 250)` | `oklch(0.245 0.007 250)` | hover, inputs, filas alternas |
| `--border` | `oklch(0.915 0.004 250)` | `oklch(0.30 0.008 250)` | bordes de 1 px |
| `--border-strong` | `oklch(0.85 0.006 250)` | `oklch(0.38 0.01 250)` | separadores con énfasis, foco de input |
| `--text` | `oklch(0.21 0.01 250)` | `oklch(0.95 0.004 250)` | texto principal |
| `--text-muted` | `oklch(0.50 0.012 250)` | `oklch(0.70 0.01 250)` | secundario, labels (contraste ≥ 4.5:1 verificado) |
| `--text-faint` | `oklch(0.54 0.01 250)` | `oklch(0.63 0.01 250)` | solo placeholders y metadatos no esenciales |
| `--accent` | `oklch(0.55 0.20 258)` | `oklch(0.72 0.17 258)` | acción primaria, selección, foco (azul eléctrico, más vivo) |
| `--accent-fg` | `oklch(0.99 0 0)` | `oklch(0.16 0.01 255)` | texto sobre el acento |
| `--accent-soft` | `oklch(0.95 0.04 258)` | `oklch(0.30 0.07 258)` | fondo de items seleccionados |
| `--signal` | `oklch(0.75 0.17 65)` | `oklch(0.80 0.16 70)` | acento secundario "feromona" (ámbar): hormigas, mejoras encontradas, highlights puntuales. Nunca para texto largo |
| `--success` | `oklch(0.54 0.13 155)` | `oklch(0.72 0.14 155)` | factible, completado |
| `--warning` | `oklch(0.56 0.13 75)` | `oklch(0.80 0.13 80)` | retraso, overtime |
| `--danger` | `oklch(0.56 0.19 27)` | `oklch(0.70 0.17 25)` | infactible, error |

- Dark mode: superficies escalonadas (bg → surface → surface-2), sin negro puro ni blanco puro.
- Los estados semánticos siempre van acompañados de un icono o un texto, nunca solo del color.

### Paleta categórica de rutas
Se basa en Okabe-Ito y Paul Tol (apta para daltonismo), reordenada para que las rutas contiguas contrasten. El amarillo puro se excluye porque no se lee sobre el mapa claro.
```
--route-1  #0072B2   --route-7  #882255
--route-2  #D55E00   --route-8  #44AA99
--route-3  #009E73   --route-9  #997700
--route-4  #CC79A7   --route-10 #332288
--route-5  #56B4E9   --route-11 #EE6677
--route-6  #E69F00   --route-12 #117733
```
- Los mismos valores sirven en light y dark; el casing (sección 7) da el contraste.
- Más de 12 rutas: se repite la paleta y desde la 13 la línea es punteada (`line-dasharray: [2, 1]`). El número del repartidor siempre aparece en el marcador y en la leyenda.
- El color de una ruta se asigna por **índice del repartidor** y es estable entre iteraciones, re-optimizaciones y pantallas (mapa, leyenda, tablas y charts).

## 5. Tipografía
- **Geist Sans** para toda la UI y **Geist Mono** para números, tiempos, distancias, costos, IDs y coordenadas.
- **`tabular-nums` es obligatorio** en todo valor numérico (tablas, métricas, ejes, timeline), para que las cifras se alineen y no "bailen" al actualizarse en vivo.

| Rol | Tamaño / interlínea | Peso | Uso |
|---|---|---|---|
| display | 36/40 | 600, tracking -0.02em | solo landing |
| h1 | 24/32 | 600, tracking -0.01em | título de página |
| h2 | 18/28 | 600 | secciones de panel |
| h3 | 14/20 | 600 | grupos de campos |
| body | 14/20 | 400 | texto general |
| small | 13/18 | 400 | labels, ayuda |
| micro | 12/16 | 500, mayúsculas solo en headers de tabla con tracking 0.04em | metadatos |
| metric | 20/28 Geist Mono | 500 | cifras principales de resultados |

La base de la app es 14 px. No hay texto de más de 24 px fuera de la landing.

## 6. Espacio, forma y elevación
- **Escala de 4 px:** 4, 8, 12, 16, 20, 24, 32, 40, 48, 64. No hay valores arbitrarios (`mt-[13px]` está prohibido).
- **Padding:**
  - paneles: 16;
  - grupos de campos: 12 de separación interna y 24 entre grupos;
  - filas de tabla: 8 vertical y 12 horizontal.
- **Radios:** 6 px en controles (inputs, botones), 8 px en paneles y popovers, 4 px en badges y `full` solo en avatares y marcadores del mapa.
- **Bordes:** 1 px `--border`. La separación se hace con bordes o espacio, no con sombras.
- **Sombras:**
  - `shadow-sm` sutil solo en elementos flotantes (popovers, paneles sobre el mapa, toasts);
  - en dark mode, las sombras se sustituyen por `--border-strong`.
- **Densidad:** controles de 32 px de alto (36 px en táctil o `md` hacia abajo).

## 7. Mapa
- **Estilos de OpenFreeMap:** `https://tiles.openfreemap.org/styles/positron` en light y `https://tiles.openfreemap.org/styles/dark` en dark. Al cambiar de tema se cambia el estilo y se reinyectan las capas.
- **Atribución visible** en la esquina inferior derecha: "© OpenMapTiles · © OpenStreetMap contributors".
- **Vista inicial:** área metropolitana de Monterrey (centro aproximado 25.6866, -100.3161, zoom 11). Al cargar un escenario se hace `fitBounds` con padding que considere los paneles abiertos.
- **Capas de rutas**, en este orden de abajo hacia arriba, todas con `line-join: round` y `line-cap: round`:
  1. `route-casing`: `line-width` 7, color `--bg` (blanco en light, fondo en dark), opacidad 0.9.
  2. `route-line`: `line-width` 4, color de la ruta.
  3. `route-arrows`: símbolos de chevron cada ~80 px a lo largo de la línea (`symbol-placement: line`), del mismo color y con halo.
  - Ruta seleccionada: ancho 6 (casing 9) y opacidad 1. Las demás quedan en opacidad 0.25.
  - Hover en una ruta: se resalta la ruta y su fila en la tabla, y viceversa.
- **Marcadores:**
  - Parada: círculo de 18 px con el número de visita en Geist Mono 11 px, relleno del color de la ruta, texto blanco y borde de 2 px en `--bg`. Sin asignar: círculo `--surface` con borde `--text-muted`.
  - Depósito: cuadrado de 22 px con radio 4, relleno `--text` e icono `warehouse` de Lucide.
  - Inicio de repartidor (multi-origen): marcador con la inicial o el número del repartidor y el borde del color de su ruta.
  - Prioridad alta: anillo exterior `--danger` de 2 px. Con ventana de tiempo: pequeño tick de reloj en el tooltip, nunca más ruido en el marcador.
- **Clustering** de paradas no asignadas cuando hay más de 150 visibles a zoom < 12.
- **Paneles sobre el mapa:**
  - flotan con 12 px de margen, fondo `--surface` al 96 %, borde 1 px, `shadow-sm` y radio 8;
  - nunca tapan más del 35 % del ancho en desktop;
  - el mapa ocupa siempre todo el viewport detrás.
- **Tooltips:** al hacer hover en una parada se muestran id, dirección, ventana, ETA, retraso y carga. Las cifras van en mono.

## 8. Layout por pantalla
- **Shell:**
  - topbar de 48 px con logo/wordmark, navegación (Planner · Comparar · Pareto · Simulación), ⌘K, idioma y tema;
  - no hay sidebar global, porque el espacio es para el mapa.
- **Landing:**
  - alineada a la izquierda, sin hero centrado;
  - titular concreto ("Optimiza rutas de reparto con algoritmos genéticos y colonias de hormigas") y debajo un **mapa real en vivo** con una solución demo animándose;
  - después, tres bloques con un **diagrama real** de cada técnica (Split, feromona, frente de Pareto), en lugar de tarjetas genéricas;
  - CTA primario "Abrir demo Monterrey" y secundario "Ver código".
- **Planner:**
  - el mapa ocupa todo el fondo;
  - panel izquierdo de 360 px con pestañas Paradas · Flota · Restricciones · Algoritmo, y botón primario fijo abajo "Optimizar";
  - panel derecho de 320 px que aparece al tener una solución: métricas, leyenda de rutas y tabla de itinerario.
- **Ejecución en vivo:**
  - barra inferior sobre el mapa con iteración, tiempo, mejor fitness y un sparkline de convergencia;
  - botón "Detener" que devuelve la mejor solución hasta el momento;
  - las rutas se redibujan cada `progress_every` iteraciones;
  - el estado muestra la etapa real: "Clustering K-means", "Generación 120/500", "Búsqueda local".
- **Comparador:**
  - tabla como elemento principal (algoritmo, costo, tiempo total, vehículos, gap %, runtime), con la mejor celda de cada columna en semibold y `--success`;
  - debajo, las curvas de convergencia superpuestas;
  - minimapas sincronizados opcionales.
- **Pareto:**
  - scatter (tiempo vs costo; el tamaño o la forma del punto codifica el # de vehículos) a la izquierda y mapa a la derecha;
  - al hacer click en un punto se muestran sus rutas;
  - los puntos dominados se muestran tenues y los no dominados unidos por una línea escalonada.
- **Simulación:**
  - mapa con repartidores animados;
  - timeline abajo con reloj en mono, controles play/pausa/velocidad y marcas de pedidos nuevos y re-optimizaciones;
  - log lateral de eventos.
- **Responsive:**
  - en `< md` los paneles pasan a bottom sheet;
  - el mapa sigue siendo la base;
  - en móvil la app es usable para ver resultados; en desktop, para configurar.

## 9. Charts (Recharts)
- Sin gridlines verticales; las horizontales van en `--border` con 1 px de grosor.
- Ejes en `--text-muted`, 12 px, mono y tabular-nums, **siempre con unidades** ("min", "MXN", "km").
- No se usan: leyendas dentro del área de datos, 3D, sombras, gradientes de relleno ni animación de entrada de más de 300 ms.
- Las series usan los mismos colores que las rutas o algoritmos, de forma estable:
  - GA `--route-1`
  - ACO `--route-2`
  - ACO+GA `--route-3`
  - NSGA-II `--route-4`
  - PyVRP `--text-muted` con trazo punteado
  - OR-Tools `--text-faint` con trazo punteado
- Los tooltips usan el mismo estilo que los popovers y muestran todos los valores con unidades.
- En convergencia, el eje Y es el mejor fitness; si el rango es grande se ofrece escala log como opción.

## 10. Formularios y parámetros
- Label arriba del campo (13 px, `--text-muted`), ayuda debajo (12 px) solo si hace falta y unidades como sufijo dentro del input ("kg", "min").
- **Progressive disclosure:** cada algoritmo muestra 3–4 parámetros clave. El resto va en "Avanzado" (colapsable), generado desde `params_schema` del endpoint `/algorithms`.
- Hay presets de objetivo ("Más rápido", "Más barato", "Menos repartidores", "Balanceado") como segmented control. Los pesos finos van en "Avanzado".
- Validación en vivo con zod. El error aparece bajo el campo, en `--danger`, con el mensaje traducido.
- El botón primario cambia a estado de carga sin cambiar de tamaño.

## 11. Estados
- **Vacío:** una frase y una acción, por ejemplo "Aún no hay paradas" con [Cargar demo Monterrey] [Importar CSV] [Generar aleatorias]. Sin ilustraciones genéricas.
- **Cargando:** skeletons con la forma real del contenido. Spinners solo en botones.
- **Error:** causa, más el detalle técnico colapsable, más [Reintentar]. Si el solver está dormido (cold start), se muestra "Despertando el servidor…" con el tiempo transcurrido.
- **Infactible:** banner `--warning` o `--danger` con la restricción violada y su magnitud ("3 paradas sin asignar: capacidad insuficiente"). Las paradas afectadas se resaltan en el mapa.

## 12. Motion
La UI debe sentirse **viva**: el usuario ve cómo trabaja el algoritmo. Cada animación comunica algo real (progreso, cambio, causa y efecto); nada es decoración en loop.

- **Base:**
  - hover y foco en 120 ms;
  - paneles, popovers, tabs y diálogos en 180–240 ms con `cubic-bezier(0.2, 0, 0, 1)`;
  - entradas con spring suave de `motion` (stiffness ~260, damping ~30).
- **Entrada de pantallas y paneles:** fade + desplazamiento de 8–12 px, con *stagger* de 30–50 ms entre elementos de una lista o grilla (métricas, filas de comparación, tarjetas de presets).
- **Rutas:**
  - al llegar una solución nueva, cada ruta se **dibuja** del depósito al final en 500–700 ms, escalonada 60 ms por ruta (line-progress con `line-gradient` o `line-dasharray` animado);
  - las actualizaciones en vivo hacen crossfade de 150 ms;
  - partículas ("hormigas") opcionales que recorren las rutas mientras el solver corre, con el color `--signal`, poca densidad y 0 cuando termina.
- **Números:** las métricas animan su valor real al cambiar (count-up de 400–600 ms, `tabular-nums` para que no bailen); un delta verde o rojo aparece 1.5 s junto a la métrica que mejoró.
- **Mejoras:** cuando el best mejora, un pulso breve (≤ 600 ms, una vez) en el sparkline o la barra en vivo con `--signal`. En el híbrido se indica si la mejora vino del GA o del ACO.
- **Charts:** las curvas se dibujan progresivamente al llegar puntos y los puntos del Pareto entran con escala de 0.6 a 1 escalonada.
- **Botón Optimizar:** estado de carga con una barra de progreso real (tiempo transcurrido / time limit) dentro del botón.
- Se animan principalmente `opacity` y `transform`. Las animaciones de capas del mapa usan las propiedades de MapLibre, nunca re-render de React por frame.
- **`prefers-reduced-motion: reduce`:**
  - sin desplazamientos, escalas, dibujo de rutas, partículas ni count-up; solo fades de ≤ 100 ms;
  - la cámara usa `jumpTo`;
  - la simulación no interpola.

## 13. Accesibilidad (WCAG 2.2 AA)
- Contraste de texto ≥ 4.5:1 y de elementos UI ≥ 3:1, verificado en ambos temas con `npm run contrast` (48 pares).
- Foco visible: anillo de 2 px `--accent` con offset de 2 px, nunca `outline: none` sin reemplazo. El foco no queda oculto bajo la topbar o los paneles (2.4.11).
- Todo es operable con teclado: ⌘K, tabs con flechas, Escape cierra paneles. El mapa tiene una alternativa en tabla con el itinerario completo.
- Áreas táctiles ≥ 24×24 px (2.5.8).
- Toda información codificada por color también va en texto, número o forma.
- `lang` correcto por locale. Los números y fechas se formatean con `Intl` según el locale (`es-MX` / `en-US`).

## 14. Copy e i18n
- Tono directo y técnico, en segunda persona e imperativo para las acciones ("Optimizar", "Importar CSV").
- Todo texto va en `messages/es.json` y `messages/en.json`, con claves por pantalla (`planner.fleet.addDriver`).
- Las unidades y la moneda se formatean con `Intl.NumberFormat` (MXN, km, min).
- Los nombres de algoritmos son iguales en ambos idiomas: GA, ACO, ACO+GA, NSGA-II.

## 15. Checklist de revisión de UI (Opus)
- [ ] Sin anti-patrones de la sección 2.
- [ ] Solo tokens, sin hex ni colores de Tailwind en componentes.
- [ ] Geist y `tabular-nums` en todos los números.
- [ ] Espaciado en escala de 4 y radios de 6/8 px.
- [ ] Rutas con casing, color estable por repartidor, selección que atenúa el resto y leyenda sincronizada.
- [ ] Estados vacío, cargando, error e infactible implementados.
- [ ] Light y dark correctos (incluido el estilo del mapa).
- [ ] Teclado, foco visible, contraste y `prefers-reduced-motion`.
- [ ] Todo texto pasa por `next-intl`.
- [ ] Atribuciones de OSM y datasets visibles.
- [ ] Cero comentarios en el código.

## 16. Ayuda contextual y onboarding
- **`InfoTip`:** un icono ⓘ (Lucide `Info`, 14 px, `--text-muted`) junto a **cada** parámetro, métrica, objetivo, restricción, algoritmo y eje de gráfica. El tooltip (o popover en touch) tiene:
  - título;
  - 1–3 frases en lenguaje llano ("qué es" + "qué pasa si lo subes o bajas");
  - opcionalmente, un mini-ejemplo con unidades.
- Los textos viven en `messages/*.json` bajo `help.*`; nunca se hardcodean.
- **Glosario** accesible desde ⌘K ("¿Qué es el Split?", "¿Qué es la feromona?", "¿Qué es un frente de Pareto?").
- **Presets de inicio** (landing y estado vacío del planner): tarjetas que en 1 click cargan escenario + algoritmo + objetivo y **arrancan la optimización** automáticamente al abrir el planner. Ejemplos: "Entrega rápida en el centro (GA)", "Flota mixta en todo Monterrey (ACO+GA)", "Repartidores desde casa (multi-origen)", "Pedidos urgentes con ventanas", "Costo vs rapidez (Pareto)", "Día con pedidos en vivo (Simulación)". Cada tarjeta muestra un minimapa o sparkline real del escenario, no una ilustración.
- **Primer uso:** un recorrido breve opcional de 3–4 pasos (coachmarks) en el planner, descartable y recordado en `localStorage`.
