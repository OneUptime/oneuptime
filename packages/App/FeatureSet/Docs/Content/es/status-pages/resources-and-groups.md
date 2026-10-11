# Recursos y grupos de la página de estado

Un recurso es una fila de tu página de estado: un monitor o un grupo de monitores, con un nombre que tus clientes entienden, su estado actual y, si quieres, su tiempo de actividad y su historial. Los grupos son secciones que contienen recursos, de modo que una página con cuarenta monitores se lee como «API», «Aplicación web» y «Canalización de datos» en lugar de como una lista interminable. Construyes ambos en una sola pantalla: abre una página de estado y elige **Recursos** en su menú lateral.

:::cards
- [Añadir un monitor](#añadir-un-monitor): Pon un monitor en la página, con el nombre que leen los visitantes.
- [Grupos](#grupos): Divide la página en secciones y anídalas.
- [Reglas de monitores](#añadir-monitores-automáticamente-con-reglas-de-monitores): Deja que una regla añada por ti cada monitor que coincida.
- [Importar grupos desde CSV](#importar-grupos-desde-csv): Construye una jerarquía profunda de una vez.
:::

Los visitantes juzgan «¿es cosa mía o de ellos?» a partir de estas filas, así que nómbralas como tus clientes hablan de tu producto: **Checkout API**, no `prod-checkout-lb-healthcheck-us-east-1`.

## Cómo sube un estado por la página

Cada fila muestra el estado actual de su monitor. Cada nivel por encima muestra el peor estado de todo lo que hay debajo, siendo el peor estado el de mayor prioridad entre los estados de monitor de tu proyecto.

```mermaid title="Cómo llega el estado de un monitor a lo alto de la página"
flowchart TB
    subgraph Rows["Filas de recursos"]
        direction LR
        M["Monitor:<br/>su propio estado"]
        MG["Grupo de monitores:<br/>el peor de sus monitores"]
    end
    Rows --> G["Encabezado del grupo:<br/>peor estado por debajo"]
    G --> P["Grupo padre:<br/>peor estado por debajo"]
    Rows --> O["Banner del estado general:<br/>peor estado de la página"]
```

Un recurso decide más que el color de su fila:

- **Los monitores archivados no se muestran.** Un monitor archivado ya no se comprueba, así que su último estado queda congelado; la página omite su fila (y lo deja fuera del estado de un grupo de monitores) en lugar de mostrar ese estado congelado como si fuera actual. La fila se conserva, así que desarchivar el monitor la recupera al instante.
- **Los recursos deciden qué incidentes muestra la página.** Un incidente aparece aquí, y los suscriptores de la página se enteran, cuando uno de los monitores del incidente es un recurso de la página, directamente o a través de un grupo de monitores. Pon el mismo monitor en varias páginas y sus incidentes llegan a todas, salvo que un incidente se limite a algunas de ellas. Consulta [Una página de estado por audiencia](/docs/status-pages/one-status-page-per-audience).
- **La fila de un grupo de monitores representa a cada monitor que contiene, también para los suscriptores.** En una página que permite a los suscriptores elegir recursos, quien se suscribe a un grupo de monitores se entera de los incidentes, los mantenimientos programados y los anuncios de cualquier monitor del grupo, como si hubiera elegido ese monitor. Consulta [Suscriptores y anuncios](/docs/status-pages/subscribers#dejar-que-los-suscriptores-elijan-recursos-y-tipos-de-eventos).

## La pantalla Recursos

La entrada se llama **Recursos** en los proyectos con los grupos de monitores activados, y **Monitores** en los demás; es la misma pantalla. Antes los grupos tenían su propia página, y la antigua dirección `/groups` abre ahora esta pantalla.

La pantalla está dividida en dos:

| Parte | Qué contiene |
| ---- | ------------- |
| **Navegador de grupos** (izquierda) | Todos los grupos de la página, en árbol, con un cuadro **Buscar grupos...** encima y un recuento debajo, como `3 groups · 12 resources`. Una lista larga termina con un botón **Mostrar N más de M**. |
| **Parte superior de la página** | La primera fila del navegador: los recursos sin grupo, que los visitantes ven primero, por encima de todos los grupos. En una página sin grupos, el panel derecho se titula en su lugar **Todos los recursos**. |
| **Panel de recursos** (derecha) | Los recursos del grupo seleccionado. Su cabecera contiene **Editar grupo**, el botón principal **Añadir monitor** y un menú **Más acciones**. |
| Cabecera de la tarjeta | **Nuevo grupo** y un menú de tres puntos con **Importar grupos desde CSV** y **Actualizar**. |

**Los estados vacíos te dicen qué hacer.** Un grupo vacío muestra **Aún no hay monitores aquí** con **Añadir monitor**, **Añadir varios** y, solo mientras la página no tenga ningún grupo, **Crear un grupo**. Una búsqueda sin resultados muestra **Ningún recurso coincide con tu búsqueda**.

## Añadir un monitor

:::steps
### Elegir dónde va la fila

En el navegador de grupos, selecciona el grupo al que pertenece el recurso, o **Parte superior de la página** para una fila sin grupo.

### Hacer clic en Añadir monitor

Se abre el cuadro de diálogo **Add a monitor to {group}**. Ocupa una sola página.

### Elegir el monitor

Elígelo en **Monitor** (texto de ejemplo **Seleccionar monitor**). **Nombre para mostrar**, el texto que leen los visitantes, se rellena con el nombre del monitor y lo sigue si eliges otro monitor, hasta que escribas un nombre propio. Se guarda aparte del nombre del monitor, así que cambiarlo aquí no cambia nada de la monitorización.

### Configurar las opciones de visualización, si quieres

**Más campos** está plegado. Contiene **Descripción** (Markdown opcional que se muestra bajo la fila, ideal para una frase que explique qué hace realmente el servicio; una imagen incluida se muestra a todos los visitantes) y las [opciones de visualización](#opciones-de-visualización-de-un-recurso). Si lo dejas cerrado, el recurso recibe sus valores predeterminados.

### Guardar el recurso

Haz clic en **Añadir monitor**. La fila aparece en el grupo y en la página de estado.
:::

En un grupo de cuadrícula, el cuadro de diálogo también pide la fila y la columna donde va el monitor, por encima de **Más campos**; consulta [Diseño de lista o de cuadrícula](#diseño-de-lista-o-de-cuadrícula).

> [!TIP]
> Para mostrar varias comprobaciones como una sola fila, añade un grupo de monitores. Con el interruptor **Grupos de monitores** activado (**Ajustes del proyecto** > **Avanzado** > **Feature flags**, que se guarda en cuanto lo cambias), un enlace bajo la lista desplegable dice **Añade un grupo de monitores en su lugar.** Haz clic en él y **Monitor** pasa a ser **Grupo de monitores** (**Seleccionar grupo de monitores**); **Añade un monitor en su lugar.** vuelve atrás.

### Añadir varios a la vez

**Añadir varios** (también **Añadir varios monitores** en el menú **Más acciones**) abre **Añadir varios monitores**. También ocupa una sola página: una selección múltiple **Monitores** y luego los mismos **Más campos** plegados, cuyas opciones de visualización se aplican a cada monitor que elijas. Cada recurso toma el nombre para mostrar y la descripción de su monitor, y **Añadir monitores** los añade todos. Es la forma más rápida de llenar una página nueva.

La selección múltiple tiene una pestaña **Etiquetas**: haz clic en una etiqueta y se seleccionan a la vez todos los monitores que la llevan.

### Añadir dos veces por etiqueta es seguro

Una página de estado lista un monitor una sola vez. Añadir es idempotente, así que elegir de nuevo la misma etiqueta después de etiquetar unos cuantos monitores nuevos solo añade los nuevos: los monitores que ya estaban en la página se quedan exactamente como están, con el nombre para mostrar y las opciones que les diste.

El resumen al final de la adición masiva lo dice: los monitores añadidos aparecen en **Añadido**, y los que ya estaban en **Already Added**. Nada se notifica como fallo y no se escribe nada para ellos.

La misma regla se aplica en cualquier otro lugar donde se crea un recurso. Añadir un monitor que ya está en la página desde el formulario de adición individual, o apuntar a él un recurso existente desde el formulario de edición, se rechaza con *«This monitor is already added to this status page»*, también cuando el recurso existente está en otro grupo, porque un visitante seguiría viendo el monitor dos veces. Para mostrar un monitor en otro grupo, elimina el recurso que ya tiene y añádelo donde lo quieras.

## Opciones de visualización de un recurso

La sección **Más campos** es la misma en el formulario de adición individual y en el cuadro de diálogo masivo. Empieza plegada en ambos, y también en **Editar recurso**, donde su cabecera plegada muestra lo que no está en su valor predeterminado. Todo aquí es por recurso: dos filas del mismo grupo pueden configurarse de forma distinta.

| Campo | Predeterminado | Qué hace |
| ----- | ------- | ------------ |
| **Información sobre herramientas** (`displayTooltip`) | Vacío | Se muestra como información emergente junto al recurso en tu página de estado. Úsalo para el alcance: «Clientes de EE. UU. y de la UE». |
| **Mostrar estado actual del recurso** (`showCurrentStatus`) | Activado | Muestra el estado actual, como operativo, degradado o fuera de línea, junto a la fila. |
| **Mostrar % de tiempo de actividad** (`showUptimePercent`) | Desactivado | Muestra un porcentaje de tiempo de actividad junto al recurso. |
| **Seleccionar precisión de tiempo de actividad** (`uptimePercentPrecision`) | Un decimal | Aparece cuando **Mostrar % de tiempo de actividad** está activado, y entonces es obligatorio. |
| **Mostrar gráfico de historial de estado** (`showStatusHistoryChart`) | Activado | Muestra las barras diarias del historial de tiempo de actividad del recurso. |

**Nombre para mostrar** (`displayName`) y **Descripción** (`displayDescription`) también son solo de visualización: nunca cambian el propio monitor.

## Porcentajes de tiempo de actividad y gráficos de historial

**Mostrar % de tiempo de actividad** y **Mostrar gráfico de historial de estado** leen un mismo ajuste de toda la página: cuántos días abarcan. Es **Historial de tiempo de actividad** en la tarjeta **Lo que muestra tu página de estado** de **Páginas de estado → tu página → Avanzado → Ajustes avanzados**. Acepta de 1 a 90 días y su valor predeterminado es 90. Así que activa los interruptores recurso por recurso y define la ventana una sola vez para toda la página.

**La precisión es cuestión de criterio.** **Seleccionar precisión de tiempo de actividad** ofrece `99% (No Decimal)`, `99.9% (One Decimal)`, `99.99% (Two Decimal)` y `99.999% (Three Decimal)`. Más decimales parecen precisos e invitan a discutir el tercero; si publicas un SLA de tres nueves, ajústate a él y no más.

Los grupos tienen sus propias copias de estos interruptores (ver más abajo), así que un grupo puede mostrar un porcentaje acumulado mientras los monitores que contiene no muestran nada, o al revés.

Los colores de las barras del gráfico de historial se definen en **Más ajustes** de la página **Marca**, y qué estados de monitor cuentan como «caído», en **Cuenta como tiempo de inactividad**, en la tarjeta **Lo que muestra tu página de estado** de **Ajustes avanzados**; ambos se explican en [Marca y dominios de la página de estado](/docs/status-pages/branding-and-domains).

## Grupos

La mayoría de los grupos solo necesitan un nombre.

:::steps
### Hacer clic en Nuevo grupo

Se abre **Crear nuevo grupo de la página de estado**: dos campos y luego dos secciones plegadas.

### Nombrar el grupo

Escribe el **Nombre del grupo**: el encabezado de sección que ven los visitantes.

### Anidarlo, si pertenece a otro grupo

Elige un **Grupo padre**, o déjalo en **Sin grupo padre (nivel superior)**. **Añadir un subgrupo** en los menús de un grupo lo rellena por ti.

### Crear el grupo

Haz clic en **Crear grupo de la página de estado**. El grupo aparece en el navegador, listo para recibir monitores.
:::

Los dos campos son **Nombre del grupo** (`name`) y **Grupo padre** (`parentStatusPageGroupId`). Las dos secciones plegadas contienen todo lo demás:

- **Diseño**: su cabecera plegada dice **Lista** o **Cuadrícula**. Contiene **Modo de visualización** y los ejes de una cuadrícula (consulta [Diseño de lista o de cuadrícula](#diseño-de-lista-o-de-cuadrícula)), y se abre sola en un grupo de cuadrícula.
- **Más campos**: las copias, a nivel de grupo, de las opciones de recurso:
  - **Descripción del grupo** (`description`): Markdown opcional que se muestra bajo el encabezado. Una imagen incluida se muestra a todos los visitantes.
  - **Expandir en la página de estado de forma predeterminada** (`isExpandedByDefault`): activado de forma predeterminada; indica si la sección empieza abierta o plegada para los visitantes.
  - **Mostrar estado actual del grupo** (`showCurrentStatus`): activado de forma predeterminada. Muestra un estado junto al encabezado del grupo.
  - **Mostrar % de tiempo de actividad** (`showUptimePercent`): desactivado de forma predeterminada, con **Seleccionar precisión de tiempo de actividad** cuando está activado.

Para cambiar un grupo, usa **Editar grupo** en la cabecera del panel, o **Editar grupo** en el menú de fila del navegador: se abre **Editar grupo de la página de estado**, con un botón **Guardar cambios**. La cabecera del panel muestra etiquetas para los ajustes activados (**Cuadrícula**, **Contraído de forma predeterminada**, **% de tiempo de actividad**), para que veas cómo está configurado un grupo sin abrir el formulario.

### Gestionar un grupo

| Dónde | Acciones |
| ----- | ------- |
| El menú de fila del navegador | **Editar grupo**, **Subir**, **Bajar**, **Mostrar ID**, **Eliminar grupo** |
| El menú **Más acciones** del panel | **Editar este grupo**, **Añadir un subgrupo**, **Subir grupo**, **Bajar grupo**, **Mostrar ID del grupo**, **Actualizar**, **Eliminar este grupo** |

Un grupo guardado sin nombre se muestra como **Grupo sin título**, buena señal de que querías escribir algo.

## Anidar grupos

Los grupos se anidan: define **Grupo padre** en el hijo, o usa **Añadir un subgrupo dentro de este grupo** en el navegador. El texto de ayuda del formulario describe la forma para la que está pensado (algo como Unidades corporativas › Región › Mercado), y cada nivel muestra el estado y el tiempo de actividad acumulados de todo lo que hay debajo.

Cuando un grupo tiene hijos, el panel de recursos muestra una fila de etiquetas **Subgrupos** que enlaza directamente con cada uno, para que recorras la jerarquía sin volver al navegador.

El anidamiento compensa en páginas grandes: un proveedor de hosting con regiones dentro de productos, o un minorista con mercados dentro de unidades de negocio. En una página con doce monitores, un solo nivel plano es más amable.

## Diseño de lista o de cuadrícula

La sección **Diseño** del formulario del grupo define el **Modo de visualización** (`viewMode`) del grupo, que cambia cómo se muestra el grupo en la página de estado.

| Si quieres… | Elige |
| --------------- | ---- |
| Mostrar una simple lista vertical de servicios, uno por fila | **Lista** (el predeterminado) |
| Mostrar el mismo servicio en varias regiones o inquilinos como una matriz | **Cuadrícula** |

Elige **Cuadrícula** y aparecen cuatro campos más:

| Campo | Qué escribir |
| ----- | ------------- |
| **Etiqueta del eje de filas** | El nombre de la dimensión de las filas, texto de ejemplo `Service`. |
| **Valores del eje de filas** | Las filas, añadidas de una en una con **Add Row** (texto de ejemplo `e.g. Auth`). |
| **Etiqueta del eje de columnas** | La dimensión de las columnas, texto de ejemplo `Region`. |
| **Valores del eje de columnas** | Las columnas, añadidas con **Add Column** (texto de ejemplo `e.g. US-East`). |

Cada monitor de un grupo de cuadrícula ocupa una celda, así que **Añadir monitor** y el cuadro de diálogo masivo piden la fila y la columna además del monitor, con tus propias etiquetas de ejes.

> [!IMPORTANT]
> Configura los ejes antes de añadir monitores. Un grupo de cuadrícula sin filas ni columnas muestra un aviso de que aún no hay dónde colocar un monitor, con un botón **Configurar la cuadrícula** que abre el formulario del grupo en su sección **Diseño**, y su botón **Añadir monitor** desaparece hasta que lo hagas.

## Ordenar lo que ven los visitantes

El orden lo decides tú, no el alfabeto:

| Qué | Cómo reordenarlo |
| ---- | ------------------ |
| Los recursos dentro de un grupo | Arrastra una fila. El panel lo dice: **Arrastra una fila para cambiar el orden que ven los visitantes**. |
| Los grupos entre sí | **Subir** / **Bajar** en el menú de fila del navegador, o **Subir grupo** / **Bajar grupo** en **Más acciones**. |
| Los recursos sin grupo | Están en **Parte superior de la página** y siempre se muestran por encima de todos los grupos, así que pon ahí lo que todo el mundo mira primero. |

**Dos casos en los que no se puede arrastrar.** Buscar en el cuadro **Search in {group}...** desactiva el reordenamiento (el panel dice `N of M shown · drag to reorder is off while filtering`), así que borra primero la búsqueda. Y los grupos de cuadrícula nunca se reordenan arrastrando, porque el lugar de un monitor viene de su fila y su columna.

Pon arriba el servicio por el que más te preguntan. Los visitantes que llegan a la página durante una caída suelen dejar de leer después de la primera pantalla.

## Añadir monitores automáticamente con reglas de monitores

Una regla de monitores añade monitores a la página por ti: describe los monitores una vez, y cada monitor que coincida acaba en el grupo que elegiste. Las reglas están en **Recursos → Reglas de monitores**, junto a la pantalla Recursos.

:::steps
### Abrir Reglas de monitores

Abre la página de estado, elige **Reglas de monitores** en la sección **Recursos** de su menú lateral y haz clic en **Crear Regla de monitores de la página de estado**.

### Nombrar la regla

En **Información básica**, escribe un **Nombre**. **Habilitado** está activado de forma predeterminada.

### Indicar con qué monitores coincide

En **Criterios de coincidencia**, rellena al menos uno de **Etiquetas del monitor** (coincide un monitor que lleve cualquiera de ellas), **Nombre del monitor** y **Descripción del monitor**. Un monitor tiene que cumplir todos los criterios que rellenes. Los dos patrones admiten una expresión regular que no distingue mayúsculas y minúsculas (`^api-.*`) o un comodín `*` (`*checkout*`); `.*` coincide con todos los monitores.

### Elegir el grupo

En **Grupo**, elige **Añadir monitores al grupo**, o déjalo vacío para añadir los monitores sin grupo. Siguen las mismas opciones de visualización que en un recurso; en una regla, **Mostrar % de tiempo de actividad** empieza activado.

### Guardar la regla

La regla se ejecuta al momento sobre todos los monitores que ya existen, y la lista muestra el grupo al que añade monitores en **Añade monitores a**.
:::

Después, una regla vuelve a ejecutarse para un monitor cada vez que se crea uno o cambian sus etiquetas, su nombre o su descripción. Una regla solo quita los recursos que añadió: desactivarla o eliminarla los quita de la página, y un monitor que añadiste a mano nunca se toca. Un monitor que ya está en la página nunca se añade dos veces.

## Importar grupos desde CSV

Construir a mano una jerarquía profunda es tedioso. **Importar grupos desde CSV**, en el menú de tres puntos de la cabecera de la tarjeta, abre el cuadro de diálogo **Importar grupos desde CSV**.

:::steps
### Descargar la plantilla

Haz clic en **Descargar plantilla CSV** para obtener `status-page-groups-template.csv`.

### Rellenarla

Una fila por grupo. Solo `name` es obligatorio; las columnas se enumeran más abajo.

### Subir y previsualizar

Haz clic en **Elegir archivo CSV**, elige tu archivo y después **Previsualizar importación** para comprobar qué se va a crear antes de escribir nada.

### Importar

Ejecuta la importación. Una tabla **Resultados de la importación** lista cada fila como **Creado**, **Fallido** u **Omitido**, con el motivo, para que una fila incorrecta nunca desaparezca sin avisar.
:::

| Columna | Qué define |
| ------ | ------------ |
| `name` | El nombre del grupo. Obligatorio. |
| `parentName` | El nombre del grupo dentro del cual se anida este. |
| `description` | La descripción del grupo. |
| `isExpandedByDefault` | Si la sección empieza abierta para los visitantes. |
| `showCurrentStatus` | Si se muestra un estado junto al encabezado del grupo. |
| `showUptimePercent` | Si se muestra un porcentaje de tiempo de actividad junto al grupo. |
| `uptimePercentPrecision` | Cuántos decimales usa ese porcentaje. |
| `viewMode` | `List` o `Grid`. |
| `rowAxisLabel` | El nombre de la dimensión de las filas, para un grupo de cuadrícula. |
| `rowAxisValues` | Los valores de las filas, para un grupo de cuadrícula. |
| `columnAxisLabel` | El nombre de la dimensión de las columnas, para un grupo de cuadrícula. |
| `columnAxisValues` | Los valores de las columnas, para un grupo de cuadrícula. |

La importación crea grupos, no recursos: añade después los monitores con **Añadir monitor**, **Añadir varios** o una regla de monitores.

## Solución de problemas

:::details «This monitor is already added to this status page»
Una página lista cada monitor una sola vez, también entre grupos. El monitor ya tiene un recurso, quizá en otro grupo o añadido por una regla de monitores. Búscalo en el navegador, elimina ese recurso y añade el monitor donde lo quieras.
:::

:::details Un monitor que añadí no aparece en la página de estado
Comprueba si el monitor está archivado: la fila de un monitor archivado se omite hasta que lo desarchives. Comprueba también el grupo: un grupo configurado para empezar plegado (**Expandir en la página de estado de forma predeterminada** desactivado) oculta sus filas hasta que un visitante lo abre.
:::

:::details No hay botón Añadir monitor en un grupo de cuadrícula
La cuadrícula aún no tiene filas ni columnas. Haz clic en **Configurar la cuadrícula**, añade los valores de los ejes en la sección **Diseño** y **Añadir monitor** vuelve.
:::

:::details No puedo arrastrar las filas
Borra el cuadro **Search in {group}...**: el reordenamiento se desactiva mientras el panel está filtrado. Los grupos de cuadrícula nunca se reordenan arrastrando.
:::

## Próximos pasos

:::cards
- [Marca y dominios de la página de estado](/docs/status-pages/branding-and-domains): Logotipo, favicon, colores del gráfico de historial y tu propio dominio.
- [Suscriptores y anuncios](/docs/status-pages/subscribers): A quién se avisa cuando cambian estos recursos.
- [Una página de estado por audiencia](/docs/status-pages/one-status-page-per-audience): El mismo monitor en muchas páginas, y un incidente que solo llega a algunas.
- [API pública](/docs/status-pages/public-api): Lee recursos, grupos y tiempo de actividad como JSON.
:::
