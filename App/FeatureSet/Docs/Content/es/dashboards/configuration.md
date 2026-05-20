# Configuración y permisos del panel

Esta página reúne los ajustes y los controles de acceso que conviene conocer una vez que tienes un panel que de verdad quieres conservar.

## Propiedad

Los **propietarios** de un panel son los usuarios y equipos a los que se les conceden permisos explícitos sobre él (separados del rol a nivel de proyecto).

En **Dashboard → Owners**:

- Añade un **propietario usuario** para conceder a una persona específica acceso extra a este panel.
- Añade un **propietario equipo** para conceder lo mismo a cada miembro de un equipo.

Usa la propiedad cuando el rol de lectura a nivel de proyecto sea demasiado amplio — por ejemplo, un panel con detalle sensible a nivel de cliente que solo debería ser visible para el equipo de customer success.

## Etiquetas

Las etiquetas son tags muchos-a-muchos para organizar paneles. Aplícalas en **Dashboard → Overview**.

Patrones comunes de etiquetas:

- **Por equipo**: `team:platform`, `team:checkout`, `team:growth`.
- **Por entorno**: `env:prod`, `env:staging`.
- **Por propósito**: `purpose:oncall`, `purpose:exec`, `purpose:investigation`.

La lista **Dashboards** te permite filtrar por etiqueta, que es la forma más rápida de encontrar un panel en un proyecto que ha acumulado decenas.

## Permisos

Los paneles son recursos de primera clase en el control de acceso basado en roles de OneUptime. Los permisos relevantes:

| Permiso | Permite |
| --- | --- |
| `CreateDashboard` | Crear nuevos paneles en el proyecto. |
| `ReadDashboard` | Ver paneles (en modo privado). |
| `EditDashboard` | Modificar widgets, variables y ajustes de un panel. |
| `DeleteDashboard` | Eliminar un panel. |

Existen permisos equivalentes para las entidades de apoyo: los propietarios del panel (usuario / equipo) y los dominios personalizados tienen sus propios pares create / read / edit / delete para que puedas conceder "gestionar propietarios" sin conceder "editar el panel en sí".

Asígnalos en los roles de proyecto en **Project Settings → Teams & Roles**.

## Control de acceso en modo público

El acceso en modo público (consulta [Compartir y paneles públicos](/docs/dashboards/sharing)) se rige por tres capas, en orden:

1. Conmutador **Public Dashboard** — si está apagado, la URL pública devuelve un 404.
2. **Master Password** — si está establecido, los visitantes deben introducirlo antes de que se renderice el panel.
3. **IP Whitelist** (plan Scale) — si está establecido, las peticiones desde IP no listadas reciben un 403.

Un panel puede tener cualquier combinación. La configuración más defensiva es "Público activo, contraseña establecida, lista blanca de IP activa" — útil para portales de socios donde quieres las tres.

## Retención

Los paneles en sí no caducan. Los datos que muestran siguen la retención de telemetría del proyecto — métricas, logs y trazas son consultables mientras tu plan los retenga. Un widget apuntado a "los últimos 90 días" en un plan con 30 días de retención renderizará lo que aún quede en el almacén.

## Clonar un panel

Para duplicar un panel existente, ábrelo y usa la acción **Duplicate** desde la lista de paneles. La copia incluye cada widget, variable y ajuste excepto la configuración de modo público (que siempre empieza apagada — tú decides si reactivarla en la copia).

Este es el patrón adecuado cuando quieres bifurcar una plantilla ("nuestro panel de guardia") en una versión específica del servicio.

## Eliminar un panel

En **Dashboard → Delete**. Esto es irreversible — la configuración del lienzo y cualquier vinculación de dominio personalizado se eliminan. Los datos de telemetría no se ven afectados (viven en los almacenes de métricas / logs / trazas, no en el panel).

Si un panel se publica públicamente con un dominio personalizado, la URL pública deja de resolverse en el momento en que lo eliminas. Quita el dominio primero si necesitas reapuntarlo.

## Migración y respaldo

Para instalaciones auto-alojadas: la configuración completa del panel (widgets, variables, ajustes) vive en la tabla `Dashboard` en Postgres. Un respaldo regular de la base de datos es suficiente — no hay un formato separado de exportación de paneles.

Para OneUptime Cloud: los respaldos regulares se gestionan por ti. Si quieres una copia local de la configuración de un panel, usa la [API de OneUptime](/docs/api-reference/api-reference) para leer el registro `Dashboard`.

## Qué leer a continuación

- [Compartir y paneles públicos](/docs/dashboards/sharing) — el lado público del control de acceso.
- [Variables y filtros del panel](/docs/dashboards/variables) — templating.
- [Widgets del panel](/docs/dashboards/widgets) — el catálogo de widgets.
- [Visión general de los paneles](/docs/dashboards/index) — el mapa conceptual.
