# Compartir y Paneles Públicos

Por defecto, los paneles son privados para tu proyecto: solo los miembros del equipo que han iniciado sesión pueden verlos. Pero OneUptime también te permite compartir un panel públicamente, protegerlo con una contraseña, restringirlo a ciertas IPs y alojarlo en tu propio dominio. Esta página cubre los cuatro casos.

## Paneles privados (el valor predeterminado)

Un panel es accesible solo para los miembros del proyecto que han iniciado sesión. La URL se ve como `https://oneuptime.com/dashboards/<id>/view` y requiere inicio de sesión.

Dentro del proyecto, los propietarios y las etiquetas controlan quién ve qué; consulta [Configuración y Permisos](/docs/dashboards/configuration).

## Paneles públicos

En **Panel → Configuración**, activa **Panel Público**. El panel ahora tiene una segunda URL que no necesita inicio de sesión. Compártela con proveedores, socios, clientes, o pégala en un README público.

Un panel público:

- Siempre se abre en modo **Vista**. Los visitantes públicos no pueden editar ni ver la paleta de widgets.
- Incluye las variables que has añadido. Los visitantes eligen de los mismos menús desplegables que usa tu equipo.
- Usa la **marca** que configuras en Configuración: título de página, descripción, logo, favicon.

Trata activar un panel público como publicar una página web. Cada widget en él se vuelve legible para el mundo. Mira lo que hay en el lienzo antes de pulsar el interruptor.

## Contraseña maestra

Para poner una contraseña en un panel público:

1. Activa **Panel Público**.
2. Activa **Contraseña Maestra**.
3. Establece la contraseña.

Los visitantes ven una solicitud de contraseña antes de que aparezca el panel. La contraseña se almacena como un hash; nunca vemos la contraseña real.

Usa una contraseña maestra cuando:

- Quieras compartir con un socio o cliente pero no quieras que la URL sea útil si se filtra.
- El panel sea "semi-público" — lo suficientemente abierto para no querer invitar a cada espectador como miembro del equipo, pero no lo suficientemente abierto para ponerlo en la internet abierta.

Para un control más estricto (cuentas separadas por espectador, una auditoría de quién vio qué), mantén el panel privado e invita a los espectadores como miembros del equipo de solo lectura.

## Lista de IPs permitidas

En el plan **Scale**, puedes restringir un panel público a una lista de direcciones IP o rangos. Configúralo en **Panel → Configuración → Lista Blanca de IPs**.

Úsalo cuando:

- El panel solo debería ser accesible desde tu oficina o VPN.
- Un portal de proveedor solo debería ser accesible desde sus IPs conocidas.
- Quieres protección adicional sobre una contraseña maestra.

Las solicitudes desde cualquier otra IP se rechazan.

## Dominios personalizados

De forma predeterminada, un panel público se sirve en `oneuptime.com`. Para alojarlo en tu propio subdominio como `dashboard.acme.com`:

1. Añade un registro CNAME en tu DNS apuntando el subdominio al destino de OneUptime.
2. En **Panel → Configuración → Dominios Personalizados**, añade el dominio.
3. Verifícalo. OneUptime comprueba el registro DNS por ti.
4. Una vez verificado, el panel es accesible tanto en tu dominio personalizado como en la URL original.

Los dominios personalizados son útiles para:

- Paneles de cara al cliente con tu propia marca.
- Paneles de socios co-marcados.
- Páginas públicas de salud con su propia URL.

Puedes adjuntar más de un dominio personalizado a un solo panel si sirves el mismo contenido a múltiples audiencias.

## Marca

En **Panel → Configuración**, puedes configurar:

- **Título de página** — lo que se muestra en la pestaña del navegador y en la parte superior de la página.
- **Descripción de página** — la descripción usada por los motores de búsqueda y las vistas previas sociales.
- **Logo** — sube un PNG o SVG para mostrarlo en el encabezado.
- **Favicon** — el pequeño icono en la pestaña del navegador.

La marca se aplica solo cuando el panel se ve públicamente. Los espectadores internos siempre ven la marca de OneUptime.

## Incrustar

Puedes incrustar un panel público en tu propio sitio con un iframe:

```html
<iframe
  src="https://dashboard.acme.com/view"
  width="100%"
  height="800"
  frameborder="0"
></iframe>
```

Si el panel tiene una contraseña maestra, los visitantes verán la solicitud de contraseña dentro del iframe.

## URLs compartibles

La URL del panel incluye las selecciones actuales de variables y el rango de tiempo como parámetros de consulta. Ajusta los menús desplegables, copia la URL, pégala en el chat: la persona que abre el enlace ve el panel con la misma vista exacta.

Esta es la forma más rápida de apuntar a un compañero de equipo a "el panel en el momento en que comenzó el incidente". Fija el rango de tiempo, copia, pega.

## Dónde seguir leyendo

- [Configuración y Permisos](/docs/dashboards/configuration) — control de acceso en modo privado.
- [Variables y Filtros](/docs/dashboards/variables) — variables con las que los visitantes pueden interactuar.
- [Crear un Panel](/docs/dashboards/authoring) — qué va en el lienzo.
