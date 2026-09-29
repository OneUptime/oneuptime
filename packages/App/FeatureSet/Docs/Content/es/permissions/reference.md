# Referencia de permisos

Todos los permisos que OneUptime puede conceder, agrupados exactamente como los agrupa el selector de permisos del panel.

Esta página se genera a partir del código fuente de OneUptime en el momento de la petición, desde la misma lista que usan el panel, la API y el proveedor de Terraform. No puede desviarse del producto y refleja la versión que está ejecutando.

Si busca cómo encajan las piezas —equipos, alcances, propietarios, bloqueos— empiece por [Usuarios, equipos y permisos](/docs/permissions/index).

La columna **Clave de permiso** contiene el valor que se usa con la [API](/docs/api-reference/api-reference), la [CLI](/docs/cli/index) y el [proveedor de Terraform](/docs/terraform/index). Los títulos son los que ve en el panel.

## Roles

{{PERMISSION_ROLE_COUNT}} roles, cada uno agrupando un área del producto en el nivel Admin, Member o Viewer. Son los que ofrece el selector **Rol** cuando añade un permiso a un equipo.

La columna **Alcance** indica si el rol puede acotarse al concederlo. `Todos, Propios o Etiquetas` significa que puede elegir; `Solo a nivel de proyecto` significa que el rol siempre se aplica a todo el proyecto.

{{PERMISSION_ROLE_TABLES}}

## Permisos granulares

{{PERMISSION_TOTAL_COUNT}} capacidades individuales repartidas en {{PERMISSION_GROUP_COUNT}} grupos. Son las que ofrece el selector **Granular** y las que asigna a las claves de API.

La columna **Restringir por etiquetas** indica si una concesión de este permiso puede limitarse a recursos que lleven determinadas etiquetas.

{{PERMISSION_GRANULAR_TABLES}}
