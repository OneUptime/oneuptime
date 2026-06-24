# Configuración y Permisos

Esta página cubre los ajustes y controles de acceso que conviene conocer una vez que tienes un panel que quieres mantener.

## Propietarios

Los **propietarios** de un panel son usuarios y equipos a los que has dado acceso explícito (además de su rol a nivel de proyecto).

En **Panel → Propietarios**:

- Añade un **propietario usuario** para darle a una persona acceso adicional a este panel.
- Añade un **propietario equipo** para darle lo mismo a cada miembro de un equipo.

Usa propietarios cuando el rol de lectura del proyecto sea demasiado amplio — por ejemplo, un panel con detalles a nivel de cliente que solo debería ser visible para el equipo de éxito del cliente.

## Etiquetas

Las etiquetas son tags para organizar paneles. Aplícalas en **Panel → Resumen**.

Patrones comunes:

- **Por equipo**: `team:platform`, `team:checkout`, `team:growth`.
- **Por entorno**: `env:prod`, `env:staging`.
- **Por propósito**: `purpose:oncall`, `purpose:exec`, `purpose:investigation`.

La lista de **Paneles** te permite filtrar por etiqueta, que es la forma más rápida de encontrar un panel en un proyecto que ha acumulado muchos.

## Permisos

Los paneles funcionan con el control de acceso basado en roles de tu proyecto. Los permisos relevantes:

| Permiso            | Qué permite                                 |
| ------------------ | ------------------------------------------- |
| **Crear Panel**    | Crear nuevos paneles.                       |
| **Leer Panel**     | Ver paneles (en modo privado).              |
| **Editar Panel**   | Cambiar widgets, variables y configuración. |
| **Eliminar Panel** | Eliminar un panel.                          |

Hay permisos equivalentes para propietarios de paneles y dominios personalizados, para que puedas otorgar "gestionar propietarios" sin otorgar "editar el panel".

Asígnalos en los roles del proyecto en **Configuración del Proyecto → Equipos y Roles**.

## Acceso para paneles públicos

Cuando haces que un panel sea público (consulta [Compartir y Paneles Públicos](/docs/dashboards/sharing)), tres ajustes controlan quién puede verlo:

1. Interruptor **Panel Público** — si está apagado, la URL pública devuelve un 404.
2. **Contraseña Maestra** — si está configurada, los visitantes introducen una contraseña antes de que aparezca el panel.
3. **Lista Blanca de IPs** (plan Scale) — si está configurada, se rechazan las solicitudes desde otras IPs.

Puedes combinar cualquiera de estos. La combinación más restrictiva es "Público activado, contraseña configurada, lista de IPs permitidas activa" — útil para portales de socios donde quieres las tres capas.

## Retención de datos

Los paneles en sí no caducan. Los datos que muestran siguen la configuración de retención de tu proyecto: las métricas, los logs y las trazas se pueden consultar durante el tiempo que tu plan los conserve. Un widget apuntado a "los últimos 90 días" en un plan que conserva 30 días mostrará lo que aún está almacenado.

## Duplicar un panel

Para copiar un panel existente, abre la lista de paneles y elige **Duplicar**. La copia incluye cada widget, variable y configuración excepto el uso compartido público — eso siempre comienza apagado para que puedas decidir si volver a activarlo.

Esta es la jugada correcta cuando quieres bifurcar una plantilla (como "nuestro panel de guardia") en una copia específica para un servicio.

## Eliminar un panel

En **Panel → Eliminar**. Esto no se puede deshacer: el diseño del panel y cualquier dominio personalizado asociado se eliminan. Tus datos de telemetría no se ven afectados.

Si el panel es público en un dominio personalizado, la URL deja de resolverse en cuanto lo eliminas. Mueve el dominio a un panel diferente primero si quieres mantener la URL funcionando.

## Copias de seguridad

Si te auto-alojas en OneUptime, una copia de seguridad regular de la base de datos es suficiente: la configuración del panel se almacena junto al resto de tu proyecto.

En OneUptime Cloud, las copias de seguridad se gestionan por ti. Si quieres tu propia copia, puedes leer el panel mediante la [API de OneUptime](/docs/api-reference/api-reference).

## Dónde seguir leyendo

- [Compartir y Paneles Públicos](/docs/dashboards/sharing) — controles en modo público.
- [Variables y Filtros](/docs/dashboards/variables) — plantillado.
- [Widgets](/docs/dashboards/widgets) — el catálogo de widgets.
- [Resumen de Paneles](/docs/dashboards/index) — la visión general.
