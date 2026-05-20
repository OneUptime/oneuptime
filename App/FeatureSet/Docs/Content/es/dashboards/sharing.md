# Compartir y paneles públicos

La mayoría de los paneles son privados para tu proyecto — solo los miembros del proyecto que han iniciado sesión pueden verlos. Pero OneUptime también te permite publicar un panel en una URL pública, protegerlo opcionalmente con una contraseña, restringirlo por IP y alojarlo en un dominio personalizado. Esta página cubre los cuatro.

## Paneles privados (por defecto)

Por defecto, un panel solo es accesible para usuarios que han iniciado sesión y son miembros del proyecto. La URL se ve como `https://oneuptime.com/dashboards/<id>/view`. El acceso directo requiere autenticación y el permiso de lectura adecuado sobre el panel.

Dentro del proyecto, la propiedad y las etiquetas controlan quién ve qué — consulta [Configuración y permisos del panel](/docs/dashboards/configuration).

## Paneles públicos

En **Dashboard → Settings**, activa **Public Dashboard**. El panel ahora tiene una segunda URL que no requiere inicio de sesión. Compártela con proveedores, socios, clientes, o pégala en un README público.

Un panel público:

- Se renderiza solo en modo **View**. Los visitantes públicos no pueden editar, ni ver la paleta de widgets, salvo cambios de URL de rango de tiempo.
- Incluye las variables que has definido — los visitantes pueden elegir de los desplegables igual que los usuarios internos.
- Lleva la **marca** que configures en Settings: título de página, descripción de página, archivo de logo, favicon. Estos son los que aparecen en la pestaña del navegador y en las previsualizaciones sociales.

Trata activar **Public Dashboard** como publicar una página web. Cada widget en el panel ahora es legible por todo el mundo. Audita lo que hay en el lienzo antes de activar el interruptor.

## Contraseña maestra

Para poner una puerta con contraseña a un panel público en lugar de dejarlo totalmente abierto:

1. Activa **Public Dashboard**.
2. Activa **Master Password**.
3. Establece la contraseña.

Los visitantes ven un aviso de contraseña antes de que se renderice el panel. La contraseña se hashea en reposo; solo se almacena el hash.

Usa una contraseña maestra cuando:

- Quieres compartir con un socio o cliente pero no quieres que la URL sea válida si se filtra.
- El panel es "semi-público" — lo suficientemente abierto como para no querer crear cuentas de OneUptime para cada espectador, pero no tanto como para ponerlo en la internet abierta.

Para un control de mayor valor (cuentas por espectador, registro de auditoría de quién vio qué), mantén el panel privado e invita a los espectadores al proyecto como miembros de solo lectura.

## Lista blanca de IP

En el plan **Scale**, puedes restringir un panel público a una lista de IP de origen o rangos CIDR. Configura la lista en **Dashboard → Settings → IP Whitelist**.

Usa una lista blanca de IP cuando:

- El panel solo debería ser accesible desde tu oficina o VPN.
- Un portal de proveedor solo debería ser accesible desde sus IP de salida publicadas.
- Quieres defensa en profundidad sobre una contraseña maestra.

Las peticiones desde cualquier otra IP reciben un 403.

## Dominios personalizados

De fábrica, un panel público se sirve en `oneuptime.com`. Para alojarlo en tu propio subdominio (por ejemplo, `dashboard.acme.com`):

1. Añade un registro CNAME en tu DNS apuntando el subdominio al destino publicado de OneUptime.
2. En **Dashboard → Settings → Custom Domains**, añade el dominio.
3. Verifica el registro DNS (OneUptime lo comprueba por ti).
4. Una vez verificado, el panel es accesible tanto en la URL de OneUptime como en tu dominio personalizado.

Los dominios personalizados son útiles para:

- Paneles orientados al cliente con tu marca.
- Paneles de socios co-marcados.
- SEO en una página pública de salud.

Puedes adjuntar múltiples dominios personalizados a un panel si sirves el mismo contenido a varias audiencias.

## Marca para paneles públicos

En **Dashboard → Settings**, configura:

- **Page title** — la etiqueta `<title>` y el encabezado que ven los visitantes.
- **Page description** — la meta descripción utilizada por los motores de búsqueda y las previsualizaciones sociales.
- **Logo file** — sube un PNG/SVG; se muestra en el encabezado del panel.
- **Favicon** — subido; se muestra en la pestaña del navegador.

La marca solo se aplica al renderizado en modo público. Los espectadores internos siempre ven la marca de OneUptime.

## Incrustar (embedding)

Puedes incrustar un panel público en un `<iframe>` en tu propio sitio:

```html
<iframe src="https://dashboard.acme.com/view"
        width="100%" height="800"
        frameborder="0"></iframe>
```

Si incrustas un panel protegido por una contraseña maestra, el visitante sigue viendo el aviso de contraseña dentro del iframe.

## URLs compartibles con estado de variables

La URL del panel codifica las selecciones actuales de variables y el rango de tiempo como parámetros de consulta. Ajusta los desplegables, copia la URL y pégala en el chat — el destinatario ve el panel con exactamente la misma vista, incluyendo el rango de tiempo que estabas mirando.

Esta es la forma más rápida de señalar a un compañero "el panel en el momento en que comenzó el incidente" — fija el rango de tiempo, copia, pega.

## Qué leer a continuación

- [Configuración y permisos del panel](/docs/dashboards/configuration) — control de acceso en modo privado.
- [Variables y filtros del panel](/docs/dashboards/variables) — variables con las que los visitantes públicos pueden interactuar.
- [Crear un panel](/docs/dashboards/authoring) — qué va en el lienzo en primer lugar.
