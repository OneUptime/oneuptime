# Crear un monitor

Un monitor comprueba algo que usted opera, como un sitio web, una API, un host o un clúster de Kubernetes, y le avisa cuando deja de funcionar. **Crear monitor** pregunta primero qué monitorear, después qué comprobar y después con qué frecuencia. Todo, salvo el tipo, el nombre y lo que se comprueba, empieza con valores predeterminados que sirven para la mayoría de los monitores.

## Información del monitor

Vaya a **Monitores** y haga clic en **Crear monitor**. La primera pregunta es el **Tipo de monitor**: ¿qué quiere monitorear?

- Los seis tipos que más se crean aparecen primero: **Website**, **API**, **Ping**, **Puerto**, **Certificado SSL** y **Solicitud entrante**, para los latidos de tareas cron y webhooks.
- **Más tipos de monitor** muestra todos los demás tipos bajo su categoría, como **Infraestructura** (Kubernetes, Docker, Host) y **Telemetría** (Registros, Métricas, Trazas). **Manual**, un monitor cuyo estado fija usted mismo, está en **Otro**.
- O escriba en el cuadro de búsqueda. Conoce las palabras que ya usa, como `k8s`, `postgres`, `heartbeat` o `tls`, e **Intro** elige la primera coincidencia.

El tipo elegido se reduce a una línea. Haga clic en **Cambiar** para elegir otro; pulse **Escape** mientras elige para quedarse con el tipo que tenía.

Después rellene el **Nombre**. Se usa en las alertas y en los títulos de los incidentes. **Descripción** y **Etiquetas** son opcionales y esperan en **Más campos**.

Un monitor **Manual** no necesita nada más, así que **Crear monitor** está en este paso.

## Criterios

Este paso empieza por lo que se comprueba. Para un sitio web es su URL, con un ejemplo en el cuadro; otros tipos piden un host, una consulta, un clúster o un filtro de registros. **Probar monitor** ejecuta la comprobación una vez antes de guardar.

Debajo, los **Criterios del monitor** deciden cuándo el monitor cambia de estado, declara un incidente o crea una alerta. Un monitor nuevo empieza con criterios que sirven para la mayoría de los monitores, cada uno plegado en una línea que dice qué comprueba y qué hace. Por ejemplo, un monitor de sitio web nuevo se marca como fuera de línea y declara un incidente cuando el sitio no responde o responde con un código de estado de error. Haga clic en un criterio para abrirlo y cambiarlo. **Añadir criterios** añade uno, abierto y listo para rellenar.

Nada en este paso se marca como pendiente hasta que hace clic en **Siguiente**.

## Sondas e intervalo

Los monitores que comprueban las sondas terminan con este paso: Website, API, Ping, IP, Port, SSL Certificate, DNS, DNSSEC, Domain, SQL Query, Database Health, Synthetic Monitor, Custom JavaScript Code y External Status Page. Las **Sondas** son las máquinas que ejecutan las comprobaciones, y las sondas predeterminadas de su proyecto ya vienen seleccionadas. El **Intervalo de monitoreo** empieza en **Cada 5 minutos**. Haga clic en **Crear monitor**.

Todos los demás tipos se crean desde el paso **Criterios**.

## Empezar desde una plantilla o un enlace

Una plantilla de monitor, y los enlaces que crean un monitor en otras partes de OneUptime (en un gráfico de métricas, un dispositivo de red o una regla de detección), abren **Crear monitor** con el tipo ya elegido y el resto rellenado. Haga clic en **Cambiar** para elegir otro tipo. El formulario de una plantilla usa el mismo selector de tipo: consulte [Plantillas de monitor](/docs/monitor/monitor-templates).
