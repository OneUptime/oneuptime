# Variables y Filtros

Una variable convierte un solo panel en una plantilla. Añade una variable `service` a tu panel y los mismos gráficos se vuelven a renderizar para `checkout`, `payments` o `search`: los espectadores eligen de un menú desplegable en la parte superior en lugar de que construyas tres paneles casi idénticos.

## Tipos de variables

Añade variables en **Panel → Configuración → Variables**. Cada variable tiene un nombre (usado como `{{name}}` en tus widgets), una etiqueta opcional y un tipo.

### Lista personalizada

Un menú desplegable estático. Escribes las opciones tú mismo.

Úsalo cuando: las opciones son pocas y fijas. `environment` con valores `prod, staging, dev`. `region` con valores `us-east-1, eu-west-1, ap-south-1`.

### Consulta

Las opciones provienen de una consulta sobre tus datos.

Úsalo cuando: las opciones cambian con el tiempo y quieres que el menú desplegable se mantenga al día. "Cada ID de cliente visto en las últimas 24 horas". La consulta se ejecuta sobre los datos de tu proyecto y los resultados se convierten en el menú desplegable.

### Entrada de texto

Un campo de texto libre. Se usa lo que el espectador escriba.

Úsalo cuando: quieres que el panel actúe como una herramienta de búsqueda. Filtrar por dirección IP, ID de solicitud o cualquier otro valor de formato libre.

### Atributo de telemetría

Las opciones son los valores distintos de un atributo en tu telemetría durante el rango de tiempo del panel.

Configura la **clave de atributo** (por ejemplo, `service.name`, `host.name`, `k8s.cluster.name`). El menú desplegable se rellena con cada valor distinto visto en tus logs, métricas y trazas.

Úsalo cuando: las opciones coinciden con las etiquetas que ya envías con tu telemetría. Este es el tipo más común porque se actualiza automáticamente: cuando despliegas un nuevo servicio etiquetado como `service.name = inventory`, ese nombre aparece en el menú desplegable sin que tengas que editar el panel.

## Selección múltiple

Cada variable puede permitir múltiples selecciones. Cuando está activada, el espectador puede elegir uno o más valores; el panel filtra a cualquiera de ellos.

Usa selección múltiple cuando: quieres comparar "checkout y payments juntos" sin salir del panel. Evítala cuando las matemáticas no funcionan entre los valores seleccionados (por ejemplo, promediar promedios).

## Valores predeterminados

Cada variable puede tener un valor predeterminado. El panel se renderiza con el valor predeterminado hasta que el espectador lo cambie. Para paneles públicos, el valor predeterminado es lo que los visitantes ven primero.

## Cómo usar una variable en un widget

En cualquier lugar donde un widget acepte un filtro —un `WHERE` de una métrica, el filtro de una lista, una coincidencia de atributo en un flujo de logs— puedes usar `{{variable_name}}`.

Por ejemplo, un gráfico filtrado por servicio:

```
service.name = '{{service}}'
```

Cuando el menú desplegable está en `checkout`, el gráfico filtra al servicio de checkout. Cuando el espectador cambia a `payments`, el gráfico se vuelve a renderizar para payments.

Para variables de **Atributo de telemetría**, OneUptime sabe a qué atributo se asigna la variable y aplica el filtro a cada widget que use el mismo atributo: no tienes que editar cada widget a mano.

## Rango de tiempo

El encabezado del panel tiene un rango de tiempo global. Cada widget de métrica consulta sobre esta ventana. Opciones:

- **Preajustes** — última hora, 24 horas, 7 días, 30 días, 90 días (dependiendo de tu retención de datos).
- **Personalizado** — elige una hora de inicio y de fin.

El rango de tiempo es parte de la URL del panel: al compartir la URL se comparte la ventana. Útil durante un incidente: fija el rango de tiempo en "10:00–10:30 UTC de hoy" y pega el enlace en el canal del incidente.

## Intervalo de actualización

Junto al rango de tiempo, elige con qué frecuencia los widgets vuelven a consultar:

- **Apagado** — los widgets consultan una vez cuando se carga la página.
- **5s / 10s / 30s / 1m / 5m / 15m** — actualización automática.

La actualización automática es buena para una pantalla en la pared o una vista de incidente en vivo. Déjala apagada cuando estés investigando para que la vista no se mueva mientras miras.

## Juntándolo todo

Un panel templado por servicio normalmente tiene:

1. Una variable `service` de tipo **Atributo de telemetría** para `service.name`. Predeterminado: tu servicio más vigilado. Selección múltiple desactivada (para que los gráficos siempre muestren uno a la vez).
2. Una variable `environment` de tipo **Lista personalizada**. Predeterminado: `prod`.
3. Una variable `cluster` de tipo **Atributo de telemetría** para `k8s.cluster.name`. Selección múltiple activada (para que puedas comparar entre clusters).
4. Widgets que referencian estas variables en sus filtros.

El resultado: un panel, cada servicio cubierto, tres menús desplegables en la parte superior.

## Dónde seguir leyendo

- [Widgets](/docs/dashboards/widgets) — cómo usa un filtro cada widget.
- [Compartir y Paneles Públicos](/docs/dashboards/sharing) — variables y enlaces compartidos.
- [Crear un Panel](/docs/dashboards/authoring) — la mecánica del lienzo.
