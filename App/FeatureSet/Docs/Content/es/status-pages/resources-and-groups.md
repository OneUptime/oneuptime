# Recursos y grupos

Un recurso es una fila de tu página de estado: un monitor (o un grupo de monitores) con un nombre que los visitantes entienden, un estado actual y, si quieres, un porcentaje de tiempo de actividad y un gráfico de historial. Un grupo es una sección que contiene recursos, de modo que una página con cuarenta monitores se lea como "API", "Aplicación web" y "Canalización de datos" en vez de como una lista interminable.

Ambas cosas se montan en una sola pantalla. Abre una página de estado y elige **Recursos** en el menú lateral (el elemento pone **Monitores** en los proyectos que no tienen habilitados los grupos de monitores). Antes los grupos tenían página propia; ya no, y la antigua URL `/groups` redirige aquí sin más.

Acierta con esta parte y el resto de la página de estado es decoración. Los visitantes deciden "¿es cosa mía o suya?" a partir de estas filas, así que ponles el nombre con el que tus clientes hablan de tu producto: **Checkout API**, no `prod-checkout-lb-healthcheck-us-east-1`.

## La pantalla de recursos

La pantalla está partida en dos. A la izquierda hay un navegador que lista todos los grupos de la página; a la derecha, el contenido del grupo que hayas seleccionado.

- **El navegador de grupos (izquierda)** — un árbol de grupos, con un buscador (**Search groups...**) encima y un recuento debajo, del estilo de `3 groups · 12 resources`. Cuando una página tiene más grupos de los que caben, un botón **Show N more of M** revela el resto.
- **Top of page** — la primera fila del navegador. Contiene los recursos que no están en ningún grupo, y su información sobre herramientas dice exactamente lo que eso significa: los visitantes los ven primero, por encima de todos los grupos. Si la página no tiene grupos, el panel derecho se titula **All resources**.
- **El panel de recursos (derecha)** — se titula con el grupo que hayas seleccionado. Su cabecera lleva **Edit Group**, el botón principal **Añadir monitor** y un menú desbordado **More actions**.

En la cabecera de la propia tarjeta hay dos botones: **New Group** y un menú de tres puntos con **Import groups from CSV** y **Actualizar**.

La descripción de la tarjeta cambia según la forma de tu página. Con grupos, dice que esto es todo lo que ven los visitantes y que elijas un grupo a la izquierda para editar su contenido. Si aún no hay grupos, te empuja a crear uno para partir una página larga en secciones.

**Los estados vacíos te dicen qué hacer.** Un grupo vacío muestra **No monitors here yet** con **Añadir monitor**, **Add Multiple** y —solo cuando la página de estado no tiene ningún grupo— **Create a Group**. Una búsqueda sin resultados muestra **No resources match your search**. Un navegador vacío explica que los grupos parten una página de estado larga en secciones y que se pueden anidar.

## Añadir un monitor

Selecciona el grupo en el que quieres que aterrice el recurso (o **Top of page** para una fila sin grupo) y pulsa **Añadir monitor**. El modal se titula **Add a monitor to {group}** y tiene dos pasos: **Detalles del monitor** y **Avanzado**.

En **Detalles del monitor**:

- **Monitor** — el desplegable con los monitores de tu proyecto, marcador de posición **Seleccionar monitor**. Obligatorio.
- **Nombre para mostrar** — obligatorio. Es el texto que leen los visitantes, y se guarda aparte del nombre propio del monitor, así que puedes renombrarlo aquí sin tocar la monitorización.
- **Descripción** — markdown opcional que se muestra bajo la fila. Va bien para una frase que explique qué hace realmente el servicio.

Si tu proyecto tiene habilitados los grupos de monitores, un enlace bajo el desplegable pone **Add a Monitor Group instead.** — púlsalo y el desplegable **Monitor** se cambia por uno de **Monitor Grupo** (**Seleccionar grupo de monitores**). El enlace pasa entonces a **Add a Monitor instead.** para que puedas volver. Usa un grupo de monitores cuando quieras que una fila de la página represente varias comprobaciones agregadas.

### Añadir varios de golpe

**Add Multiple** (también **Add multiple monitors** en el menú **More actions**) abre **Add Multiple Monitors**. Tiene los mismos dos pasos, pero el primero es un selector múltiple **Monitores** en lugar de un desplegable único, y las opciones de visualización que elijas en **Avanzado** se aplican a todos los monitores que hayas marcado. Es la forma más rápida de sembrar una página nueva.

## Opciones de visualización de un recurso

El paso **Avanzado** es idéntico en el formulario de alta individual y en el modal masivo. Todo lo de aquí es por recurso: dos filas del mismo grupo pueden estar configuradas de forma distinta.

| Campo                                                                     | Para qué sirve                                                                                                       |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Información sobre herramientas** (`displayTooltip`)                     | Texto extra que se muestra junto al recurso en tu página de estado. Úsalo para acotar el alcance: "Clientes de EE. UU. y UE". |
| **Mostrar estado actual del recurso** (`showCurrentStatus`)               | Activado de forma predeterminada. Muestra el estado en vivo —operativo, degradado, caído— junto a la fila.            |
| **Mostrar % de tiempo de actividad** (`showUptimePercent`)                | Desactivado de forma predeterminada. Muestra un porcentaje de tiempo de actividad junto al recurso.                   |
| **Seleccionar precisión de tiempo de actividad** (`uptimePercentPrecision`) | Solo aparece cuando **Mostrar % de tiempo de actividad** está activado. Obligatorio, con un decimal de forma predeterminada. |
| **Mostrar gráfico de historial de estado** (`showStatusHistoryChart`)     | Activado de forma predeterminada. Muestra el gráfico de barras del historial diario de tiempo de actividad del recurso. |

**Nombre para mostrar** (`displayName`) y **Descripción** (`displayDescription`), del primer paso, son también de visualización: nunca cambian el monitor en sí.

## Porcentajes de tiempo de actividad y gráficos de historial

Tanto **Mostrar % de tiempo de actividad** como **Mostrar gráfico de historial de estado** dependen de un ajuste que vive en otro sitio. La ventana que cubren es **Mostrar historial de tiempo de actividad (en días)**, en **Páginas de Estado → tu página → Avanzado → Ajustes Avanzados**, dentro de la tarjeta **Ajustes del historial de tiempo de actividad**. Acepta de 1 a 90 días y su valor predeterminado es 90.

Así que la secuencia es: activas los interruptores recurso a recurso y luego fijas la ventana una vez para toda la página.

**La precisión es cuestión de criterio.** El desplegable **Seleccionar precisión de tiempo de actividad** ofrece `99% (No Decimal)`, `99.9% (One Decimal)`, `99.99% (Two Decimal)` y `99.999% (Three Decimal)`. Más decimales dan sensación de precisión e invitan a discutir por el tercero; si publicas un SLA de tres nueves, iguálalo y no vayas más allá.

Los grupos tienen sus propias copias de estos interruptores —lo vemos abajo—, de modo que un grupo puede mostrar un porcentaje agregado mientras los monitores de dentro se mantienen callados, o al revés.

Los colores de las barras del gráfico de historial, y qué estados de monitor cuentan como "caído", se fijan en la pantalla de marca **Página de Vista General**, que se explica en [Marca y dominios de la página de estado](/docs/status-pages/branding-and-domains).

## Grupos

Pulsa **New Group** para abrir **Create New Status Page Group**. El formulario tiene tres pasos: **Detalles del grupo**, **Diseño** y **Avanzado**.

**Detalles del grupo**:

- **Nombre del grupo** (`name`) — obligatorio. Es el encabezado de sección que ven los visitantes.
- **Descripción del grupo** (`description`) — markdown opcional, mostrado bajo el encabezado.
- **Parent Group** (`parentStatusPageGroupId`) — opcional. Déjalo en **No parent group (top level)** para mantener el grupo en el nivel superior.
- **Expandir en la Página de estado de forma predeterminada** (`isExpandedByDefault`) — si la sección arranca abierta o plegada para los visitantes.

**Avanzado** replica a nivel de grupo los interruptores del recurso:

- **Mostrar estado actual del grupo** (`showCurrentStatus`) — activado de forma predeterminada. Muestra un estado junto al encabezado del grupo.
- **Mostrar % de tiempo de actividad** (`showUptimePercent`) — desactivado de forma predeterminada, con **Seleccionar precisión de tiempo de actividad** apareciendo en cuanto lo activas.

La edición funciona igual: **Edit Group** en la cabecera del panel, o **Edit group** en el menú de la fila del navegador, abre **Edit Status Page Group** con un botón **Guardar Cambios**.

La cabecera del panel muestra etiquetas con los ajustes que están activos —**Grid**, **Collapsed by default**, **Uptime %**— para que veas cómo está configurado un grupo sin abrir el formulario.

### Gestionar un grupo

El menú por fila del navegador contiene **Edit group**, **Move up**, **Move down**, **Mostrar ID** y **Delete group**. El menú desbordado **More actions** del panel tiene los equivalentes en versión larga: **Edit this group**, **Add a sub group**, **Move group up**, **Move group down**, **Show group ID**, **Actualizar** y **Delete this group**. Un grupo guardado sin nombre se muestra como **Untitled group**, que es una buena señal de que querías escribir algo.

## Anidar grupos

Los grupos se anidan: fija **Parent Group** en el hijo, o usa la acción **Add a sub group inside this group** del navegador. El propio texto de ayuda del formulario describe la forma para la que está pensado —algo como Unidades corporativas › Región › Mercado— y señala que cada nivel muestra el estado y el tiempo de actividad agregados de todo lo que tiene debajo.

Cuando un grupo tiene hijos, el panel de recursos muestra una fila de etiquetas **Sub groups** que enlaza directamente con cada hijo, así puedes recorrer la jerarquía sin volver al navegador.

El anidamiento se gana el sueldo en páginas grandes: un proveedor de alojamiento con regiones dentro de productos, o un minorista con mercados dentro de unidades de negocio. En una página con doce monitores, un solo nivel plano es más amable.

## Diseño de lista frente a diseño de cuadrícula

El paso **Diseño** fija el **Modo de visualización** (`viewMode`) del grupo, y cambia cómo se muestra el grupo de cara al público.

| Si quieres…                                                                | Elige                    |
| -------------------------------------------------------------------------- | ------------------------ |
| Mostrar una lista vertical simple de servicios, uno por fila               | **List** (el predeterminado) |
| Mostrar el mismo servicio en varias regiones o inquilinos, como una matriz | **Grid**                 |

Elige **Grid** y aparecen cuatro campos más:

- **Etiqueta del eje de filas** — el nombre de la dimensión de filas, marcador de posición `Service`.
- **Valores del eje de filas** — las filas en sí, añadidas de una en una con **Add Row** (marcador de posición `e.g. Auth`).
- **Etiqueta del eje de columnas** — la dimensión de columnas, marcador de posición `Region`.
- **Valores del eje de columnas** — se añaden con **Add Column** (marcador de posición `e.g. US-East`).

Cada monitor de un grupo en cuadrícula se coloca entonces en una celda, así que el modal masivo pide la fila y la columna junto a los monitores, usando tus propias etiquetas de eje.

**Configura los ejes antes de añadir monitores.** Un grupo en cuadrícula sin filas ni columnas muestra un aviso ámbar que dice que no hay dónde poner un monitor hasta que existan los ejes, con un botón **Set up the grid**; y el botón **Añadir monitor** desaparece hasta que lo hagas.

## Ordenar lo que ven los visitantes

El orden es explícito, no alfabético, y se fija en tres sitios:

- **Recursos dentro de un grupo** — arrastra una fila. El panel lo dice: **Drag a row to change the order visitors see**.
- **Grupos entre sí** — **Move up** / **Move down** en el menú de fila del navegador, o **Move group up** / **Move group down** en el menú desbordado del panel.
- **Recursos sin grupo** — viven en **Top of page** y siempre se muestran por encima de todos los grupos, así que pon ahí eso que todo el mundo mira primero.

**Dos casos en los que arrastrar está desactivado.** Filtrar el panel con la caja **Search in {group}...** deshabilita la reordenación —el panel te avisa con `N of M shown · drag to reorder is off while filtering`—, así que limpia la búsqueda primero. Y los grupos en cuadrícula nunca admiten ordenar arrastrando, porque la posición sale de los ejes de filas y columnas.

Pon arriba el servicio por el que más te preguntan. Quien llega a la página durante una caída suele dejar de leer después de la primera pantalla.

## Importar grupos desde CSV

Construir una jerarquía profunda a mano es tedioso. El menú de tres puntos de la cabecera de la tarjeta tiene **Import groups from CSV**, que abre el modal **Import Groups from CSV**.

El flujo es: **Download CSV Template** para obtener `status-page-groups-template.csv`, lo rellenas, **Choose CSV File** y luego **Preview Import** para comprobar qué se va a crear antes de escribir nada. Después, una tabla **Import results** enumera cada fila como **Created**, **Failed** o **Skipped** junto con el motivo, de modo que una fila defectuosa no se desvanece en silencio.

Solo `name` es obligatorio. Las columnas aceptadas son:

| Columna                  | Qué fija                                                       |
| ------------------------ | ---------------------------------------------------------------- |
| `name`                   | El nombre del grupo. Obligatorio.                                |
| `parentName`             | El nombre del grupo dentro del que se anida este.                |
| `description`            | La descripción del grupo.                                        |
| `isExpandedByDefault`    | Si la sección arranca abierta para los visitantes.                |
| `showCurrentStatus`      | Si se muestra un estado junto al encabezado del grupo.            |
| `showUptimePercent`      | Si se muestra un porcentaje de tiempo de actividad junto al grupo. |
| `uptimePercentPrecision` | Cuántos decimales usa ese porcentaje.                            |
| `viewMode`               | `List` o `Grid`.                                                 |
| `rowAxisLabel`           | Nombre de la dimensión de filas de un grupo en cuadrícula.        |
| `rowAxisValues`          | Los valores de fila de un grupo en cuadrícula.                    |
| `columnAxisLabel`        | Nombre de la dimensión de columnas de un grupo en cuadrícula.     |
| `columnAxisValues`       | Los valores de columna de un grupo en cuadrícula.                 |

La importación crea grupos, no recursos: añade los monitores después con **Añadir monitor** o **Add Multiple**.

## Qué leer a continuación

- [Visión general de las páginas de estado](/docs/status-pages/index) — qué es una página de estado y cómo encajan sus piezas.
- [Marca y dominios de la página de estado](/docs/status-pages/branding-and-domains) — logotipo, favicon, colores del gráfico y poner la página en tu propio dominio.
- [Suscriptores y anuncios](/docs/status-pages/subscribers) — a quién se avisa cuando estos recursos cambian.
- [API pública](/docs/status-pages/public-api) — leer los datos de la página de estado mediante programación.
- [Estados y severidades de incidentes](/docs/incidents/states-and-severities) — qué hace que un incidente aparezca en la página y qué lo hace desaparecer.
