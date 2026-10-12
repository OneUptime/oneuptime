# Referencia de permisos

Todos los roles y permisos que OneUptime puede conceder, agrupados como los agrupa el selector de permisos del panel. Usa esta página para encontrar el nombre o la clave exacta que debes dar a un equipo, a una clave de API o a un recurso de Terraform.

Las tablas se generan a partir del código fuente de OneUptime cuando se sirve la página: es la misma lista que usan el panel, la API y el proveedor de Terraform. Por eso siempre coinciden con la versión que ejecutas. Para ver cómo encajan los permisos (equipos, alcances, propietarios y bloqueos), empieza por [Usuarios, equipos y permisos](/docs/permissions/index).

## Cómo leer las tablas

Cada rol y cada permiso tiene una fila con estas columnas:

- **Rol** o **Permiso**: el nombre que muestra el panel.
- **Clave de permiso**: el valor que se usa con la [API](/docs/api-reference/api-reference), la [CLI](/docs/cli/index) y el [proveedor de Terraform](/docs/terraform/index).
- **Alcance** (solo roles): `Todos, Propios o Etiquetas` significa que eliges hasta dónde llega el rol al concederlo. `Solo a nivel de proyecto` significa que el rol se aplica siempre a todo el proyecto.
- **Restringir por etiquetas** (solo permisos): `Sí` significa que una concesión de este permiso puede limitarse a los recursos que llevan determinadas etiquetas.
- **Descripción**: lo que permite el rol o el permiso.

> [!TIP]
> Recurre primero a un rol. Los roles siguen siendo correctos a medida que OneUptime añade funciones, mientras que una lista de permisos sueltos hay que mantenerla al día a mano.

## Roles

{{PERMISSION_ROLE_COUNT}} roles. Cuatro de ellos abarcan todo el proyecto: Project Owner, Project Admin, Project Member y Viewer. Cada uno de los demás cubre un área del producto, como los incidentes o los monitores, con nivel Admin, Member o Viewer. Son los que ofrece **Añadir rol** en la página **Permisos** de un equipo y en la página de una clave de API.

{{PERMISSION_ROLE_TABLES}}

## Permisos individuales

{{PERMISSION_TOTAL_COUNT}} capacidades individuales repartidas en {{PERMISSION_GROUP_COUNT}} grupos. Son las que ofrece **Añadir permiso**, para un equipo o una clave de API, cuando un rol concede más de lo que necesitas.

{{PERMISSION_GRANULAR_TABLES}}

## Próximos pasos

:::cards
- [Usuarios, equipos y permisos](/docs/permissions/index): Cómo deciden los equipos, los alcances, los propietarios y los bloqueos lo que puede hacer cada persona.
- [Referencia de la API](/docs/api-reference/api-reference): Usar las claves de permiso con claves de API.
- [Proveedor de Terraform](/docs/terraform/index): Gestionar los equipos y sus permisos como código.
:::
