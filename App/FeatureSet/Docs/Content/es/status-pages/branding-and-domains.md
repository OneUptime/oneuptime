# Marca y dominios personalizados

Una página de estado es la única superficie de OneUptime que tus clientes miran de verdad, así que debería parecer tuya y vivir en tu propio dominio. Ambas cosas se configuran desde la sección **Marca** del menú lateral de una página de estado, más un ajuste que se esconde en **Ajustes Avanzados**.

Lo que conviene saber antes de empezar: la configuración de marca está repartida en siete pantallas distintas, y el reparto no siempre cae donde uno imagina. El logotipo y la imagen de portada no están en **Marca Esencial**, sino en **Encabezado**. El favicon sí está en **Marca Esencial**. Los colores están en **Página de Vista General**. Todo lo demás que se te ocurra llamar "tematización" es CSS personalizado.

Esta página recorre cada pantalla por turnos y luego te lleva por la secuencia completa de CNAME y SSL para poner la página en `status.tuempresa.com`.

## Dónde vive cada control de marca

Abre una página de estado y verás que la sección **Marca** del menú lateral tiene siete elementos. Aquí tienes el mapa, para que dejes de buscar.

| Página                       | Qué configuras ahí                                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Marca Esencial**           | Título de la página, descripción, indexación en buscadores y favicon.                                                    |
| **Encabezado**               | Logotipo, imagen de portada, sus textos alternativos y la barra de enlaces de la cabecera.                                |
| **Pie de Página**            | La línea de copyright y la barra de enlaces del pie.                                                                     |
| **Página de Vista General**  | Descripción del resumen, colores de las barras del gráfico de historial, estados de caída y porcentaje general de tiempo de actividad. |
| **HTML, CSS y JavaScript**   | HTML de la cabecera, HTML del pie, CSS personalizado y JavaScript personalizado.                                         |
| **Dominios Personalizados**  | Tu propio dominio, la verificación del CNAME y el SSL.                                                                   |
| **Idiomas**                  | Idioma predeterminado y los idiomas que se ofrecen en el selector del pie.                                               |

## Marca esencial

**Páginas de Estado → tu página → Marca → Marca Esencial** (`{id}/branding`) contiene tres tarjetas.

- **Título y descripción** — la tarjeta señala que esto se usa también para SEO. **Editar** abre **Título de la página** (marcador de posición `Please enter page title here.`) y **Descripción de la página**. Es lo que muestran los buscadores y las vistas previas de enlaces, así que escríbelo para un cliente, no para tu equipo.
- **Search Engine Indexing** — un único interruptor, **Allow Search Engines to Index this Status Page**, descrito en el producto como el control de si Google y Bing pueden listar la página en sus resultados. Viene activado. Desactívalo y la página se sirve con `noindex, nofollow`.
- **Favicon** — **Edit Favicon** abre la subida de la imagen **Favicon**. Es el iconito de la pestaña del navegador.

Úsalo cuando: la página es solo interna o todavía la estás montando. Desactiva **Allow Search Engines to Index this Status Page** para que una página a medias no empiece a posicionar por el nombre de tu marca.

## La pantalla del encabezado

**Páginas de Estado → tu página → Marca → Encabezado** (`{id}/header-style`). A pesar del nombre en el menú lateral, aquí es donde viven tus dos mayores activos de marca.

La primera tarjeta se titula **Logotipo, portada y favicon**, con un botón **Edit Images**:

- **Logotipo** — subida de imagen, marcador de posición `Upload logo`.
- **Logo Alt Text** — marcador de posición `Logo of My Company`. Si lo dejas en blanco, se usa el título de la página de estado.
- **Portada** — subida de imagen, marcador de posición `Upload cover image`. Es el banner ancho que va detrás de la cabecera.
- **Cover Image Alt Text** — la misma idea para la portada.

Debajo hay una tabla **Enlaces de la cabecera** ("Header Links for your status page"). Cada enlace tiene un **Título** y un **Enlace** (una URL, marcador de posición `https://link.com`), y las filas se reordenan arrastrando. Sin ninguno configurado, la tabla dice "No status header link for this status page."

Va bien para: devolver a los visitantes a tu web de marketing, a tu documentación o a un portal de soporte sin que tengan que adivinar la URL.

## La pantalla del pie de página

**Páginas de Estado → tu página → Marca → Pie de Página** (`{id}/footer-style`) tiene la misma forma que **Encabezado**: una tarjeta y una tabla.

- **Información de copyright** — **Edit Copyright** abre un único campo, **Información de copyright**, con el marcador de posición `Acme, Inc.`.
- **Enlaces del pie de página** — el mismo par de **Título** y **Enlace**, ordenado arrastrando, con el mensaje vacío "No status footer link for this status page."

Los enlaces legales, de privacidad y de términos van aquí. Los de la cabecera son para navegar; los del pie, para la letra pequeña.

## Marca de la página de resumen

**Páginas de Estado → tu página → Marca → Página de Vista General** (`{id}/overview-page-branding`) es la única pantalla donde los colores se pueden configurar, y además decide qué significa "caído" en el gráfico.

- **Página de Vista General** — **Edit Branding** abre un campo markdown, **Descripción de la página de Vista General.**, que se muestra sobre la lista de recursos. Úsalo para una frase de contexto: qué cubre esta página y adónde ir a por soporte.
- **Rules for Bar Colors of History Chart** — una tabla ordenada de reglas que se reordena arrastrando. Cada regla tiene **Cuando el % de tiempo de actividad es mayor o igual que** y **Entonces, usa este color de barra**; las columnas de la tabla ponen `When Uptime Percent >=` y `Then, Bar Color is`. El orden importa, así que colócalas tal como quieras que se evalúen.
- **Estados de monitor de tiempo de inactividad** — **Edit Statuses** abre un selector múltiple descrito como "These monitor statuses are considered as down". Así decides si, por ejemplo, un estado degradado cuenta contra el tiempo de actividad en esta página.
- **Color de barra predeterminado del gráfico de historial** — **Edit Default Bar Color** abre el selector **Color de barra predeterminado**, el color que se usa cuando no coincide ninguna regla.
- **Porcentaje de tiempo de actividad general** — **Edit Settings** abre el interruptor **Mostrar porcentaje de tiempo de actividad general** y un desplegable **Seleccionar precisión de tiempo de actividad**, que por defecto va a dos decimales (`99.99% (Two Decimal)`).

**Cuántos días cubre el gráfico no se fija aquí.** Eso es **Mostrar historial de tiempo de actividad (en días)**, en **Páginas de Estado → tu página → Avanzado → Ajustes Avanzados** (`{id}/settings`), válido de 1 a 90.

## HTML, CSS y JavaScript personalizados

**Páginas de Estado → tu página → Marca → HTML, CSS y JavaScript** (`{id}/custom-code`) tiene cuatro tarjetas que se editan por separado, respaldadas por las columnas `headerHTML`, `footerHTML`, `customCSS` y `customJavaScript` de la página de estado:

- **HTML de la cabecera** — marcador de posición `Insert Custom HTML here.`, se inyecta en la cabecera de la página.
- **HTML del pie de página** — lo mismo, para el pie.
- **CSS personalizado** — marcador de posición `Insert Custom CSS here.`
- **JavaScript personalizado** — marcador de posición `Insert Custom JavaScript here.`

**No hay selector de tema.** Las páginas de estado de OneUptime no tienen ningún ajuste de tema ni de color de marca: los únicos controles de color integrados son **Color de barra predeterminado** y las reglas de color de las barras del gráfico de historial, en la pantalla **Página de Vista General**. Las tipografías, los colores de fondo, los colores de acento y los retoques de maquetación pasan todos por el **CSS personalizado** de aquí. Si llevas rato buscando un campo de "color de marca", esta es la respuesta: no existe, y esta caja es la vía de escape.

> El JavaScript personalizado se ejecuta en el navegador de tus visitantes, en una página que la gente carga precisamente cuando teme que algo esté roto. Mantenlo pequeño, aloja tú mismo lo que puedas y pruébalo antes de depender de él.

## Ajustes de idioma

**Páginas de Estado → tu página → Marca → Idiomas** (`{id}/languages`) tiene dos tarjetas, y ambas van del selector de idioma que los visitantes encuentran en el pie de la página.

- **Idioma predeterminado** — **Edit Default Language** abre un desplegable que lista cada idioma admitido por su nombre nativo y su nombre en inglés (`Deutsch (German)`). La tarjeta lo describe como el idioma que ven quienes llegan por primera vez; los visitantes siempre pueden cambiarlo desde el pie. Por defecto es inglés.
- **Idiomas habilitados** — **Edit Enabled Languages** abre un selector múltiple, marcador de posición `All languages`. Déjalo vacío y se ofrecen todos los idiomas admitidos. Elige unos pocos y el selector del pie lista solo esos.

OneUptime viene con dieciséis idiomas: inglés, alemán, francés, español, italiano, portugués, neerlandés, danés, noruego, sueco, ruso, japonés, coreano, chino (simplificado), chino (tradicional) e hindi.

## Dominios personalizados

De forma predeterminada, una página de estado es accesible en la URL de vista previa que aparece en su pantalla **Vista General**. Para ponerla en tu propio nombre de host, ve a **Páginas de Estado → tu página → Marca → Dominios Personalizados** (`{id}/domains`).

La tarjeta se titula **Dominios Personalizados** y su descripción deletrea el requisito: añade el registro CNAME de página de estado de tu instalación como CNAME de estos dominios para que esto funcione. Sin nada configurado, la tabla dice "No custom domains found." La tabla tiene dos columnas, **Dominio** y **Estado**, y filtros de **Dominio**, **CNAME válido** y **SSL aprovisionado**.

### Antes de empezar

Dos requisitos previos, y saltarse cualquiera de los dos es el motivo habitual de que esto no funcione:

- **El dominio padre ya tiene que estar verificado.** El desplegable **Dominio** solo lista dominios verificados desde los ajustes del proyecto; el propio texto de ayuda del campo te remite a **Más → Ajustes del proyecto → Dominios Personalizados** para añadir uno primero.
- **La instalación tiene que tener configurado un registro CNAME de página de estado.** En despliegues autoalojados es la variable de entorno `STATUS_PAGE_CNAME_RECORD` en Docker Compose, o `statusPage.cnameRecord` en el `values.yaml` de Helm. Sin eso, los modales **Añadir CNAME** y **Solicitar SSL gratuito** muestran un mensaje "Custom Domains not enabled for this OneUptime installation" en lugar de instrucciones.

### Añadir el dominio

Pulsa **Create Status Page Domain**. El modal (**Create New Status Page Domain**) tiene dos pasos:

**Básico**

- **Subdominio** — solo la etiqueta, marcador de posición `status (leave blank for root)`. Escribe únicamente `status`, no el nombre de host completo. Déjalo en blanco o pon `@` para usar el dominio raíz o apex.
- **Dominio** — un desplegable de dominios verificados, marcador de posición `Seleccionar dominio`.

**Más**

- **Subir certificado personalizado** — un interruptor, desactivado de forma predeterminada. Déjalo apagado y OneUptime solicita por ti un certificado gratuito. Enciéndelo y aparecen los campos **Certificado** y **Clave privada del certificado** para tu propio material PEM.

## Verificar el CNAME

Mientras el dominio esté sin verificar, la fila muestra una acción **Añadir CNAME**. Abre un modal titulado **Añadir CNAME** que te da exactamente lo que hay que pegar en tu proveedor de DNS:

- **Tipo de registro** — `CNAME`
- **Nombre** — el dominio completo que acabas de crear, por ejemplo `status.tuempresa.com`
- **Contenido** — el registro CNAME de página de estado de tu instalación

El modal advierte de que, una vez puesto el registro, la verificación automática puede tardar hasta 24 horas. No tienes que esperar tanto: el botón de envío del modal es **Verificar CNAME**, que comprueba el registro al momento.

Crea primero el registro DNS y luego pulsa **Verificar CNAME**. Pulsarlo antes de que el registro exista simplemente falla.

## Solicitar un certificado SSL

Una vez verificado el CNAME —y solo si no subiste tu propio certificado— aparece en la fila una acción **Solicitar SSL gratuito**. Su modal, **Order Free SSL Certificate for this Status Page**, explica que OneUptime usa LetsEncrypt, que el proceso es seguro y gratuito, y que el aprovisionamiento tarda unas horas desde que se hace la solicitud. El botón de envío es **Solicitar SSL gratuito**.

**Los tiempos que se anuncian no coinciden entre pantallas**, así que no te tomes ningún número al pie de la letra: el modal de solicitud dice tres horas, la columna **Estado** dice una hora, y un certificado propio dice treinta minutos. Trátalos todos como "vuelve más tarde hoy" y contacta con soporte si a esas alturas no ha pasado nada.

Una vez aprovisionado, la renovación es automática. No hay nada recurrente que tengas que hacer.

## Leer la columna Estado del dominio

La columna **Estado** es toda la máquina de estados de la configuración en una sola celda. Cada mensaje te dice o qué hacer a continuación, o que ya has terminado.

| Lo que dice la columna Estado                         | Qué significa                                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Action Required: Please add your CNAME record.        | El CNAME aún no está verificado. Añade el registro y luego **Verificar CNAME**.        |
| Action Required: Please order SSL certificate.        | El CNAME está verificado pero no hay certificado solicitado. Pulsa **Solicitar SSL gratuito**. |
| No action is required, allow 30 minutes to provision. | Subiste un certificado propio y se está instalando.                                    |
| No action is required, this will be provisioned soon. | El certificado gratuito está solicitado y en camino. Contacta con soporte si nunca llega. |
| Certificate Provisioned. No action required.          | Listo. OneUptime renueva el certificado automáticamente.                                |

Si una fila se queda en "Action Required: Please add your CNAME record." mucho después de que crearas la entrada DNS, comprueba que el nombre del registro sea el dominio completo y que su contenido coincida exactamente con el registro CNAME de tu instalación.

## Powered by OneUptime

La línea "Powered by OneUptime" no es un ajuste de la sección de marca. Vive en **Páginas de Estado → tu página → Avanzado → Ajustes Avanzados** (`{id}/settings`), en la tarjeta **Marca "Powered By OneUptime"**, como un único interruptor: **Ocultar la marca Powered By OneUptime**. **Edit Settings** lo abre, igual que en el resto de tarjetas de esa pantalla.

## Qué leer a continuación

- [Visión general de las páginas de estado](/docs/status-pages/index) — qué es una página de estado y cómo encajan entre sí sus piezas.
- [Recursos y grupos de la página de estado](/docs/status-pages/resources-and-groups) — elegir qué ven realmente los visitantes en la página.
- [Suscriptores y anuncios](/docs/status-pages/subscribers) — suscriptores por correo, SMS, Slack y webhook, más los anuncios.
- [API pública](/docs/status-pages/public-api) — leer los datos de la página de estado mediante programación.
- [Estados y severidades de incidentes](/docs/incidents/states-and-severities) — qué hace que un incidente aparezca en la página y qué lo hace desaparecer.
