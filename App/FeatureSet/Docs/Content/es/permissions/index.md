# Usuarios, equipos y permisos

Todo en OneUptime vive dentro de un **proyecto**. Quién puede hacer qué dentro de ese proyecto se reduce a tres cosas: los **usuarios** que hay en él, los **equipos** a los que pertenecen y los **permisos** concedidos a esos equipos.

La regla que explica casi todo el comportamiento: **los usuarios nunca tienen permisos directamente.** El acceso de un usuario es la unión de los permisos de todos los equipos a los que pertenece en ese proyecto. Si quiere cambiar lo que alguien puede hacer, cambie su pertenencia a un equipo o cambie los permisos de ese equipo.

Los **propietarios** son otra idea. Un propietario es quien se responsabiliza de un recurso concreto: un monitor, un incidente, un panel. A los propietarios se les notifica sobre sus recursos, y los permisos pueden acotarse opcionalmente a «solo lo que me pertenece».

## El modelo de un vistazo

```text
Proyecto
  └── Equipo                     ← aquí se adjuntan los permisos
       ├── Permisos permitidos   ← cada uno con un alcance: Todos / Propios / Etiquetas
       ├── Permisos bloqueados   ← siempre prevalecen sobre los permitidos
       └── Miembros del equipo   ← usuarios que aceptaron la invitación
```

| Concepto | Qué es |
| --- | --- |
| Usuario | Una única cuenta de OneUptime. Un inicio de sesión, cualquier número de proyectos. |
| Proyecto | La frontera del inquilino. Monitores, incidentes, equipos y datos pertenecen a un solo proyecto. |
| Equipo | Un grupo con nombre dentro de un proyecto que porta los permisos. |
| Miembro del equipo | Un usuario invitado a un equipo que ha aceptado. |
| Permiso | Una capacidad concreta, p. ej. `CreateProjectMonitor`, o un rol que agrupa muchas, p. ej. `MonitorAdmin`. |
| Alcance | Hasta dónde llega un permiso permitido: todos los recursos, solo los propios o solo los etiquetados. |
| Propietario | Un usuario o equipo marcado como responsable de un recurso concreto. |
| Etiqueta | Una marca que pone en los recursos, usada para restringir permisos y para organizar. |

## Usuarios

Una cuenta de usuario es global a la instancia de OneUptime: el mismo inicio de sesión funciona en todos los proyectos a los que se le haya invitado.

Un usuario está «en» un proyecto cuando es miembro de **al menos un equipo** de ese proyecto. No hay un paso separado de «añadir usuario al proyecto»: invitar a alguien a un proyecto es invitarlo a un equipo.

- Las invitaciones crean un miembro de equipo pendiente. El usuario solo cuenta como miembro del proyecto —y solo obtiene algún permiso— **después de aceptar la invitación.**
- Quitar a un usuario de todos los equipos de un proyecto le retira el acceso a ese proyecto.
- Si su proyecto exige SSO y un usuario aún no se ha autenticado con el proveedor de identidad, se le trata como usuario SSO no autorizado y no ve nada hasta que lo haga. Consulte [SSO](/docs/identity/sso).
- Con SCIM configurado, su proveedor de identidad puede crear, actualizar y eliminar usuarios y sus pertenencias a equipos automáticamente. Consulte [SCIM](/docs/identity/scim).

Dónde encontrarlo: **Configuración → Usuarios** enumera a todas las personas del proyecto y su estado de invitación.

## Equipos

Los equipos son el camino por el que los permisos llegan a las personas. Cada proyecto nuevo empieza con tres:

| Equipo | Permiso que tiene | Editable |
| --- | --- | --- |
| Owners | `ProjectOwner` | No. Siempre tiene al menos un miembro. |
| Admin | `ProjectAdmin` | No |
| Members | `ProjectMember` | Sí — es un punto de partida, modifíquelo libremente |

Los equipos **Owners** y **Admin** están bloqueados a propósito: sus permisos no se pueden editar y los equipos no se pueden eliminar ni renombrar. Eso es lo que evita que un proyecto se quede accidentalmente sin acceso. El equipo Owners debe mantener siempre al menos un miembro.

`ProjectOwner` es el nivel de acceso más alto: facturación, eliminar el proyecto y todo lo que puede hacer un administrador. `ProjectAdmin` cubre todo excepto la facturación y la eliminación del proyecto.

Cree tantos equipos adicionales como quiera —«Guardia de Frontend», «Soporte», «Auditores de solo lectura»— y dé a cada uno los permisos que necesite.

Dónde encontrarlo: **Configuración → Equipos**. Abra un equipo para llegar a **Members**, **Permissions** y **Block Permissions**.

## Permisos

Un permiso es una capacidad concreta. Hay dos formas de repartirlos, y ambas están en la pestaña **Permissions** del equipo.

### Roles

Un rol agrupa toda un área del producto en uno de tres niveles:

- **Admin** — control total sobre esa área, incluida su configuración (gravedades, estados, plantillas).
- **Member** — el trabajo del día a día: crear, editar y eliminar los recursos, pero no reconfigurar el área.
- **Viewer** — solo lectura.

`MonitorAdmin`, `IncidentMember`, `StatusPageViewer`, etc. Los roles son lo que quiere casi siempre: siguen siendo correctos a medida que OneUptime añade funciones, porque una nueva tabla relacionada con monitores se añade a los roles de monitor existentes en lugar de exigirle una nueva concesión.

Los {{PERMISSION_ROLE_COUNT}} roles están en la [Referencia de permisos](/docs/permissions/reference).

### Permisos granulares

Cada capacidad individual también se puede asignar por separado: `CreateProjectMonitor`, `ReadProjectIncident`, `DeleteProjectStatusPage` y {{PERMISSION_TOTAL_COUNT}} más. Úselos cuando un rol resulte demasiado amplio y necesite conceder exactamente una cosa.

Son también las claves que usa al crear claves de API, y las que esperan la API y el proveedor de Terraform.

La lista completa está en la [Referencia de permisos](/docs/permissions/reference).

### Permitir y bloquear

Cada equipo tiene dos listas:

- **Permissions** (permitir) — lo que este equipo puede hacer.
- **Block Permissions** — lo que este equipo nunca puede hacer, sin importar ninguna entrada de permitir.

**El bloqueo siempre gana.** Una entrada de bloqueo sin etiquetas retira esa capacidad por completo al equipo. Una entrada de bloqueo con etiquetas la retira solo para los recursos que lleven esas etiquetas: útil para «este equipo puede editar monitores, salvo los etiquetados como Production».

Un permiso no puede llevar etiquetas de restricción en ambas listas a la vez; OneUptime rechaza la segunda con una explicación.

Como el acceso de un usuario es la unión de todos sus equipos, un bloqueo en un equipo **no** cancela un permiso concedido en otro. Los bloqueos restringen al equipo en el que se definen. Si alguien tiene más acceso del que espera, revise todos los equipos a los que pertenece.

## Alcance: hasta dónde llega un permiso concedido

Todo permiso concedido lleva un alcance, elegido al añadirlo:

| Alcance | Significado |
| --- | --- |
| Todos los recursos del proyecto | El valor por defecto. El permiso se aplica a todos los recursos que correspondan. |
| Propiedad de este equipo o de sus miembros | El permiso solo se aplica a recursos donde este equipo, o el usuario que actúa, figura como propietario. |
| Restringir por etiquetas (avanzado) | El permiso solo se aplica a recursos que lleven al menos una de las etiquetas seleccionadas. |

**Propios** es la forma más sencilla de construir un modelo de «cada uno cuida de sus servicios»: dé a un equipo `MonitorAdmin` con alcance Propios y luego haga a ese equipo propietario de los monitores de los que es responsable. Solo acota los recursos que realmente pueden tener propietarios: monitores, incidentes, paneles, servicios y similares. La configuración del proyecto (estados de incidente, etiquetas, los propios equipos) no tiene propietario, así que un rol con alcance Propios se comporta ahí con normalidad.

**Etiquetas** es la versión más manual de la misma idea: marque los recursos y luego conceda permisos restringidos a esas marcas.

Algunos roles son de proyecto completo por definición y no ofrecen alcance alguno, porque acotarlos no significaría nada: «Billing Admin, pero solo para la facturación que me pertenece» no describe nada:

{{PERMISSION_SCOPE_EXEMPT_ROLES}}

## Propietarios

Un propietario es un usuario o un equipo asociado a un recurso concreto. La mayoría de los recursos que representan algo que usted opera —monitores, incidentes, alertas, mantenimientos programados, políticas de guardia, paneles, servicios, páginas de estado, flujos de trabajo, runbooks y SLO— tienen una pestaña **Owners**.

Los propietarios cumplen dos funciones:

1. **Notificación.** Los propietarios son a quienes OneUptime avisa cuando le pasa algo al recurso: un monitor cae, se crea un incidente, un SLO empieza a consumir su presupuesto de error.
2. **Acceso, cuando usted lo pide.** La propiedad es contra lo que se resuelve el alcance Propios. Un usuario encaja si es propietario personalmente, o si lo es alguno de los equipos a los que pertenece.

La propiedad por sí sola no concede nada. Ser propietario de un monitor no le permite editarlo salvo que algún equipo suyo tenga además un permiso sobre monitores. La propiedad acota el acceso; nunca lo amplía.

## Etiquetas

Las etiquetas son marcas de ámbito de proyecto que adjunta a los recursos. Sirven para dos cosas: filtrar y agrupar en el panel, y restringir permisos como se ha descrito.

Una restricción por etiquetas se cumple si el recurso lleva **al menos una** de las etiquetas del permiso. Un recurso sin ninguna etiqueta no cumple ningún permiso restringido por etiquetas.

Dónde encontrarlo: **Configuración → Etiquetas**.

## Claves de API

A las claves de API se les conceden permisos directamente, en la propia clave: no pertenecen a equipos ni se ven afectadas por la pertenencia a ellos.

- Asigne los mismos permisos granulares y roles que daría a un equipo.
- Las claves admiten **permisos bloqueados** y **restricciones por etiquetas**, igual que los equipos.
- Las claves **no** admiten el alcance Propios. La propiedad se resuelve contra un usuario, y una clave no es un usuario, así que conceda a las claves el acceso que necesiten de forma explícita.

Dé a cada integración su propia clave con el conjunto de permisos más estrecho que funcione, para poder revocar una sin afectar a las demás.

Dónde encontrarlo: **Configuración → Claves de API**. Consulte también la [Referencia de la API](/docs/api-reference/api-reference).

## Cómo decide OneUptime si una petición está permitida

Para un usuario que ha iniciado sesión, en orden:

1. Encontrar los equipos a los que pertenece el usuario en este proyecto, contando solo invitaciones aceptadas.
2. Reunir todas las filas de permisos de esos equipos —permitir y bloquear—, cada una con sus etiquetas y su alcance.
3. Comprobar primero la lista de bloqueo. Un bloqueo coincidente sin etiquetas rechaza la petición de inmediato.
4. Comprobar la lista de permitidos. La petición necesita al menos un permiso que la tabla de destino acepte para esa operación.
5. Aplicar el alcance. Las concesiones con alcance Propios acotan la consulta a los recursos propios; las de etiquetas la acotan a las etiquetas que coincidan. Si cualquier otra concesión para la misma operación es más amplia, gana la más amplia.
6. Aplicar los bloqueos por etiquetas. Un bloqueo con etiquetas rechaza la petición si el recurso de destino lleva una de ellas.

Todo usuario con sesión iniciada tiene además un pequeño conjunto de permisos automáticos que cubren cosas como leer su propio perfil y sus propias reglas de notificación. No son permisos de administración y no dan acceso a los datos de nadie más.

Los permisos resueltos se almacenan en caché por usuario y proyecto, y se refrescan cuando cambia la pertenencia a equipos o los permisos de equipo. Si cambia permisos y un usuario no ve el cambio de inmediato, pídale que recargue.

## Recetas

**Un equipo que solo observa.** Cree el equipo y añada el rol `Viewer`, o los roles `*Viewer` por área para solo las áreas que deba ver.

**Ingenieros de guardia que gestionan sus propios servicios.** Dé al equipo `MonitorAdmin`, `IncidentMember` y `OnCallMember` con alcance **Propios**, y luego añada al equipo como propietario de los monitores que opera.

**Colaboradores externos alejados de producción.** Dé al equipo los roles que necesite con alcance **Todos** y añada después un **permiso bloqueado** para las capacidades sensibles, restringido a la etiqueta `Production`.

**Un pipeline de CI que solo informa de despliegues.** Cree una clave de API con únicamente los permisos granulares que necesite, sin roles.

**Alguien que no debe ver la facturación.** No lo añada al equipo Owners. `ProjectAdmin` ya excluye la facturación.

## Siguiente

- [Referencia de permisos](/docs/permissions/reference) — cada rol y cada permiso granular, generados desde el código fuente de OneUptime.
- [SSO](/docs/identity/sso) y [SCIM](/docs/identity/scim) — autenticación y aprovisionamiento automático de usuarios.
- [Referencia de la API](/docs/api-reference/api-reference) — usar permisos desde la API.
