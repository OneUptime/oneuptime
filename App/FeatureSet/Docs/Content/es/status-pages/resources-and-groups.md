# Recursos y grupos

Un recurso es una fila de tu página de estado: un monitor (o un grupo de monitores) con un nombre que los visitantes puedan entender, un estado actual y, opcionalmente, un número de tiempo de actividad y un gráfico de historial. Un grupo es una sección que contiene recursos, de modo que una página con cuarenta monitores se lea como «API», «Aplicación web» y «Canalización de datos» en lugar de como una lista interminable.

Construyes ambos en una única pantalla. Abre una página de estado y elige **Recursos** en el menú lateral (el elemento dice **Monitores** en los proyectos que no tienen los grupos de monitores habilitados). Los grupos solían vivir en su propia página; ya no, y la antigua URL `/groups` simplemente redirige aquí.

Acierta con esta parte y el resto de la página de estado es decoración. Los visitantes juzgan «¿soy yo o son ellos?» a partir de estas filas, así que ponles el nombre con el que los clientes hablan de tu producto: **Checkout API**, no `prod-checkout-lb-healthcheck-us-east-1`.

## La pantalla de Recursos

La pantalla está dividida en dos. A la izquierda hay un navegador que lista todos los grupos de la página; a la derecha está el contenido del grupo que hayas seleccionado.

- **El navegador de grupos (izquierda)** — un árbol de grupos, con un cuadro de búsqueda (**Search groups...**) encima y un recuento en curso debajo, como `3 groups · 12 resources`. Cuando una página tiene más grupos de los que caben, un botón **Show N more of M** revela el resto.
- **Top of page** — la primera fila del navegador. Contiene los recursos que no están en ningún grupo, y su información sobre herramientas dice exactamente qué significa eso: los visitantes ven estos primero, por encima de todos los grupos. Si la página no tiene ningún grupo, el panel derecho se titula **Todos los recursos** en su lugar.
- **El panel de recursos (derecha)** — titulado con el grupo que seleccionaste. Su cabecera lleva **Edit Group**, el botón principal **Añadir monitor** y un desbordamiento **More actions**.

Dos botones viven en la propia cabecera de la tarjeta: **New Group**, y un desbordamiento de tres puntos que contiene **Import groups from CSV** y **Actualizar**.

La descripción de la tarjeta cambia con la forma de tu página. Con grupos, dice que esto es todo lo que ven los visitantes y que elijas un grupo a la izquierda para editar qué contiene. Sin grupos todavía, te anima a crear uno para dividir una página más larga en secciones.

**Los estados vacíos te dicen qué hacer.** Un grupo vacío muestra **No monitors here yet** con **Añadir monitor**, **Add Multiple** y —solo cuando la página de estado no tiene ningún grupo— **Create a Group**. Una búsqueda que no coincide con nada muestra **No resources match your search**. Un navegador vacío dice que los grupos dividen una página de estado más larga en secciones y que se pueden anidar.

## Añadir un monitor

Selecciona el grupo en el que quieres que aterrice el recurso (o **Top of page** para una fila sin grupo) y luego haz clic en **Añadir monitor**. El modal se titula **Add a monitor to {group}** y tiene dos pasos: **Detalles del monitor** y **Avanzado**.

En **Detalles del monitor**:

- **Monitor** — el desplegable de monitores de tu proyecto, marcador de posición **Seleccionar monitor**. Obligatorio.
- **Nombre para mostrar** — obligatorio. Este es el texto que leen los visitantes, y se guarda por separado del propio nombre del monitor, así que puedes renombrarlo aquí sin tocar la monitorización.
- **Descripción** — markdown opcional que se muestra bajo la fila. Bueno para una frase que explique qué hace realmente el servicio.

Si tu proyecto tiene los grupos de monitores habilitados, un enlace bajo el desplegable dice **Add a Monitor Group instead.**: haz clic en él y el desplegable **Monitor** se cambia por un desplegable **Monitor Grupo** (**Seleccionar grupo de monitores**). El enlace pasa entonces a **Add a Monitor instead.** para que puedas volver. Usa un grupo de monitores cuando quieras que una fila de la página represente varias comprobaciones agregadas.

### Añadir varios a la vez

**Add Multiple** (también **Add multiple monitors** en el menú **More actions**) abre **Add Multiple Monitors**. Tiene los mismos dos pasos, pero el primero es una selección múltiple de **Monitores** en lugar de un desplegable único, y las opciones de visualización que elijas en **Avanzado** se aplican a todos los monitores que hayas seleccionado. Esta es la forma más rápida de sembrar una página nueva.

## Opciones de visualización de un recurso

El paso **Avanzado** es el mismo en el formulario de adición individual y en el modal masivo. Todo lo de aquí es por recurso: dos filas del mismo grupo pueden configurarse de forma distinta.

| Campo                                                          | Propósito                                                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Información sobre herramientas** (`displayTooltip`)          | Texto extra mostrado junto al recurso en tu página de estado. Úsalo para el alcance: «clientes de EE. UU. y UE». |
| **Mostrar estado actual del recurso** (`showCurrentStatus`)    | Activado de forma predeterminada. Muestra el estado en vivo —operativo, degradado, sin conexión— junto a la fila. |
| **Mostrar % de tiempo de actividad** (`showUptimePercent`)     | Desactivado de forma predeterminada. Muestra un porcentaje de tiempo de actividad junto al recurso.          |
| **Seleccionar precisión de tiempo de actividad** (`uptimePercentPrecision`) | Solo aparece cuando **Mostrar % de tiempo de actividad** está activado. Obligatorio, un decimal por defecto. |
| **Mostrar gráfico de historial de estado** (`showStatusHistoryChart`) | Activado de forma predeterminada. Muestra el gráfico de barras de historial de tiempo de actividad día a día del recurso. |

**Nombre para mostrar** (`displayName`) y **Descripción** (`displayDescription`) del primer paso son también solo de visualización: nunca cambian el propio monitor.

## Porcentajes de tiempo de actividad y gráficos de historial

Tanto **Mostrar % de tiempo de actividad** como **Mostrar gráfico de historial de estado** dependen de un ajuste que vive en otro sitio. La ventana que cubren es **Mostrar historial de tiempo de actividad (en días)** en **Páginas de Estado → tu página → Avanzado → Ajustes Avanzados**, en la tarjeta **Ajustes del historial de tiempo de actividad**. Acepta de 1 a 90 días y el valor predeterminado es 90.

Así que la secuencia es: activa los interruptores por recurso, y luego establece la ventana una vez para toda la página.

**La precisión es cuestión de criterio.** El desplegable **Seleccionar precisión de tiempo de actividad** ofrece `99% (No Decimal)`, `99.9% (One Decimal)`, `99.99% (Two Decimal)` y `99.999% (Three Decimal)`. Más decimales parecen precisos e invitan a discusiones sobre el tercero; si publicas un SLA con tres nueves, iguálalo y nada más.

Los grupos tienen sus propias copias de estos interruptores —consulta más abajo— así que un grupo puede mostrar un porcentaje agregado mientras los monitores individuales que contiene permanecen en silencio, o al revés.

Los colores de las barras del gráfico de historial, y qué estados de monitor cuentan como «caído», se establecen en la pantalla de marca **Página de Vista General**, cubierta en [Marca y dominios de la página de estado](/docs/status-pages/branding-and-domains).

## Grupos

Haz clic en **New Group** para abrir **Create New Status Page Group**. El formulario tiene tres pasos: **Detalles del grupo**, **Diseño** y **Avanzado**.

**Detalles del grupo**:

- **Nombre del grupo** (`name`) — obligatorio. Este es el encabezado de sección que ven los visitantes.
- **Descripción del grupo** (`description`) — markdown opcional, mostrado bajo el encabezado.
- **Parent Group** (`parentStatusPageGroupId`) — opcional. Déjalo en **No parent group (top level)** para mantener el grupo en el nivel superior.
- **Expandir en la Página de estado de forma predeterminada** (`isExpandedByDefault`) — si la sección empieza abierta o contraída para los visitantes.

**Avanzado** replica los interruptores del recurso a nivel de grupo:

- **Mostrar estado actual del grupo** (`showCurrentStatus`) — activado de forma predeterminada. Muestra un estado junto al encabezado del grupo.
- **Mostrar % de tiempo de actividad** (`showUptimePercent`) — desactivado de forma predeterminada, con **Seleccionar precisión de tiempo de actividad** apareciendo una vez que se activa.

La edición funciona igual: **Edit Group** en la cabecera del panel, o **Edit group** en el menú de fila del navegador, abre **Edit Status Page Group** con un botón **Guardar Cambios**.

La cabecera del panel muestra fichas para los ajustes que están activados actualmente —**Grid**, **Collapsed by default**, **Uptime %**— para que puedas ver cómo está configurado un grupo sin abrir el formulario.

### Gestionar un grupo

El menú por fila del navegador contiene **Edit group**, **Move up**, **Move down**, **Mostrar ID** y **Eliminar Grupo**. El desbordamiento **More actions** del panel tiene los equivalentes en forma larga: **Edit this group**, **Add a sub group**, **Move group up**, **Move group down**, **Show group ID**, **Actualizar** y **Delete this group**. Un grupo guardado sin nombre se muestra como **Untitled group**, lo cual es buena señal de que querías escribir algo.

## Anidar grupos

Los grupos son anidables: establece **Parent Group** en el hijo, o usa la acción **Add a sub group inside this group** del navegador. El propio texto de ayuda del formulario describe la forma para la que está construido —algo como Unidades corporativas › Región › Mercado— y señala que cada nivel muestra el estado y el tiempo de actividad agregados de todo lo que hay debajo.

Cuando un grupo tiene hijos, el panel de recursos muestra una fila de fichas **Sub groups** que enlaza directamente a cada hijo, de modo que puedes recorrer la jerarquía sin volver al navegador.

El anidamiento vale la pena en páginas grandes: un proveedor de alojamiento con regiones dentro de productos, o un minorista con mercados dentro de unidades de negocio. En una página con doce monitores, un solo nivel plano resulta más amable.

## Diseño de lista frente a diseño de cuadrícula

El paso **Diseño** establece el **Modo de visualización** (`viewMode`) del grupo, y cambia cómo se muestra el grupo públicamente.

| Si quieres…                                                              | Elige                         |
| ------------------------------------------------------------------------ | ----------------------------- |
| Mostrar una lista vertical simple de servicios, uno por fila             | **List** (el predeterminado)  |
| Mostrar el mismo servicio en varias regiones o inquilinos como una matriz| **Grid**                      |

Elige **Grid** y aparecen cuatro campos más:

- **Etiqueta del eje de filas** — el nombre de la dimensión de filas, marcador de posición `Service`.
- **Valores del eje de filas** — las propias filas, añadidas de una en una con **Add Row** (marcador de posición `e.g. Auth`).
- **Etiqueta del eje de columnas** — la dimensión de columnas, marcador de posición `Region`.
- **Valores del eje de columnas** — añadidos con **Add Column** (marcador de posición `e.g. US-East`).

Cada monitor de un grupo de cuadrícula se coloca entonces en una celda, así que el modal masivo pide la fila y la columna junto a los monitores, usando tus propias etiquetas de eje.

**Configura los ejes antes de añadir monitores.** Un grupo de cuadrícula sin filas ni columnas muestra un aviso ámbar que dice que no hay dónde poner un monitor hasta que existan los ejes, con un botón **Set up the grid**, y el botón **Añadir monitor** se retira hasta que lo hagas.

## Ordenar lo que ven los visitantes

El orden es explícito, no alfabético, y se establece en tres sitios:

- **Recursos dentro de un grupo** — arrastra una fila. El panel lo dice: **Drag a row to change the order visitors see**.
- **Grupos entre sí** — **Move up** / **Move down** en el menú de fila del navegador, o **Move group up** / **Move group down** en el desbordamiento del panel.
- **Recursos sin grupo** — viven en **Top of page** y siempre se muestran por encima de todos los grupos, así que pon ahí lo único que todo el mundo comprueba primero.

**Dos casos en los que arrastrar está desactivado.** Filtrar el panel con el cuadro **Search in {group}...** deshabilita la reordenación —el panel te dice `N of M shown · drag to reorder is off while filtering`— así que limpia la búsqueda primero. Y los grupos de cuadrícula nunca admiten la ordenación por arrastre, porque la posición viene de los ejes de fila y columna.

Pon tu servicio más preguntado arriba. Los visitantes que llegaron a la página durante una interrupción normalmente dejan de leer después de la primera pantalla.

## Importar grupos desde CSV

Construir una jerarquía profunda a mano es tedioso. El desbordamiento de tres puntos de la cabecera de la tarjeta tiene **Import groups from CSV**, que abre el modal **Import Groups from CSV**.

El flujo es: **Download CSV Template** para obtener `status-page-groups-template.csv`, rellenarlo, **Choose CSV File** y luego **Preview Import** para comprobar qué se creará antes de escribir nada. El resultado se divide en **Groups Imported** y **Some Groups Could Not Be Imported**, así que una fila defectuosa no desaparece en silencio.

Solo `name` es obligatorio. Las columnas aceptadas son:

| Columna                  | Qué establece                                                        |
| ------------------------ | -------------------------------------------------------------------- |
| `name`                   | El nombre del grupo. Obligatorio.                                    |
| `parentName`             | El nombre del grupo dentro del cual se anida este.                   |
| `description`            | La descripción del grupo.                                            |
| `isExpandedByDefault`    | Si la sección empieza abierta para los visitantes.                   |
| `showCurrentStatus`      | Si se muestra un estado junto al encabezado del grupo.               |
| `showUptimePercent`      | Si se muestra un porcentaje de tiempo de actividad junto al grupo.   |
| `uptimePercentPrecision` | Cuántos decimales usa ese porcentaje.                                |
| `viewMode`               | `List` o `Grid`.                                                     |
| `rowAxisLabel`           | Nombre de la dimensión de filas para un grupo de cuadrícula.         |
| `rowAxisValues`          | Los valores de fila para un grupo de cuadrícula.                     |
| `columnAxisLabel`        | Nombre de la dimensión de columnas para un grupo de cuadrícula.      |
| `columnAxisValues`       | Los valores de columna para un grupo de cuadrícula.                  |

La importación crea grupos, no recursos: añade monitores después con **Añadir monitor** o **Add Multiple**.

## Qué leer a continuación

- [Visión general de las páginas de estado](/docs/status-pages/index) — qué es una página de estado y cómo encajan las piezas.
- [Marca y dominios de la página de estado](/docs/status-pages/branding-and-domains) — logotipo, favicon, colores del gráfico y poner la página en tu propio dominio.
- [Suscriptores y anuncios](/docs/status-pages/subscribers) — a quién se avisa cuando estos recursos cambian.
- [API pública](/docs/status-pages/public-api) — leer los datos de la página de estado mediante programación.
- [Estados y severidades de incidentes](/docs/incidents/states-and-severities) — qué hace que un incidente aparezca en la página y desaparezca de ella.
