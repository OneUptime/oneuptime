# Crear un monitor

Un monitor comprueba algo que usted opera, como un sitio web, una API, un host o un clúster de Kubernetes, y le avisa cuando deja de funcionar. **Crear monitor** pregunta primero qué monitorear, luego qué comprobar y después con qué frecuencia. Todo, salvo el tipo, el nombre y lo que se comprueba, empieza con valores predeterminados que sirven para la mayoría de los monitores.

> [!NOTE]
> Para crear un monitor necesita el rol Project Owner, Project Admin, Project Member, Monitor Admin o Monitor Member, o un rol personalizado con el permiso Create Monitor.

## Información del monitor

El primer paso pregunta qué monitorear y cómo llamarlo.

:::steps
### Abrir Crear monitor

Vaya a **Monitores** y haga clic en **Crear monitor**. El formulario se abre en su primer paso, **Información del monitor**.

### Elegir el tipo de monitor

La primera pregunta es el **Tipo de monitor**: ¿qué quiere monitorear?

- Los seis tipos que más se crean aparecen primero: **Sitio web**, **API**, **Ping**, **Puerto**, **Certificado SSL** y **Solicitud entrante**, para los heartbeats de tareas cron y webhooks.
- **Más tipos de monitor** lista todos los demás tipos bajo su categoría, como **Infraestructura** (Kubernetes, Docker, host) y **Telemetría** (registros, métricas, trazas). **Manual**, un monitor cuyo estado usted establece, está en **Otro**.
- O escriba en el cuadro de búsqueda. Conoce las palabras que usted ya usa, como `k8s`, `postgres`, `heartbeat` o `tls`, e **Intro** elige la primera coincidencia.

El tipo elegido se reduce a una línea. Haga clic en **Cambiar** para elegir otro; pulse **Escape** mientras elige para conservar el tipo que tenía.

### Poner nombre al monitor

Rellene el **Nombre**. Se usa en las alertas y en los títulos de los incidentes. **Descripción** y **Etiquetas** son opcionales y esperan en **Más campos**.

Un monitor **Manual** no necesita nada más, así que **Crear monitor** está en este paso. Para cualquier otro tipo, haga clic en **Siguiente**.
:::

## Criterios

El segundo paso pregunta qué comprobar y decide qué cuenta como un problema.

:::steps
### Introducir qué comprobar

Este paso se abre en lo que hay que comprobar. Para un sitio web es su URL, con un ejemplo en el cuadro; otros tipos piden un host, una consulta, un clúster o un filtro de registros. Los ajustes que la mayoría de los monitores nunca cambian, como los tiempos de espera y los reintentos, están plegados en **Más campos**.

En un monitor que comprueban las sondas, **Probar monitor** ejecuta la comprobación una vez antes de guardarlo: elija una sonda en **Seleccionar sonda** y haga clic en **Ejecutar prueba**. La respuesta se abre en **Resultado de la prueba del monitor**.

### Revisar los criterios

Debajo, los **Criterios del monitor** deciden cuándo el monitor cambia de estado, declara un incidente o crea una alerta. Un monitor nuevo empieza con criterios que sirven para la mayoría de los monitores, cada uno plegado en una línea que dice qué comprueba y qué hace. Un monitor de sitio web nuevo, por ejemplo, se marca sin conexión y declara un incidente cuando el sitio no responde o responde con un código de estado de error.

Haga clic en un criterio para abrirlo y cambiarlo. **Añadir criterios** añade uno, abierto y listo para rellenar. Para cambiar el orden, arrastre un criterio por el asa de su izquierda.

### Ir al siguiente paso

Haga clic en **Siguiente**. Nada en este paso se marca como pendiente hasta que hace clic en **Siguiente**.
:::

### Cómo se evalúan los criterios

El resultado de cada comprobación pasa por los criterios de arriba abajo, y el primero que coincide decide qué ocurre. Ese criterio puede cambiar el estado del monitor, declarar un incidente, crear una alerta o cualquier combinación de las tres cosas. Cuando ninguno coincide, el monitor muestra su **Estado de monitor predeterminado**, que se configura en **Más campos** debajo de los criterios (**Operativo** salvo que elija otro).

```mermaid title="De una comprobación a un estado, un incidente o una alerta"
flowchart TB
    check["Resultado de una comprobación"] --> criteria{"Primer criterio<br/>que coincide"}
    criteria -->|"Ninguno coincide"| fallback["Estado de monitor predeterminado"]
    criteria -->|"Uno coincide"| actions
    subgraph actions["Lo que hace ese criterio"]
        direction LR
        status["Cambiar el estado"]
        incident["Declarar un incidente"]
        alert["Crear una alerta"]
    end
```

Los incidentes y las alertas configurados para resolverse automáticamente, como los de los criterios predeterminados, se resuelven solos en cuanto su criterio deja de coincidir. Un monitor que comprueba más de una sonda solo cambia cuando sus sondas están de acuerdo: de forma predeterminada, cada sonda activada y conectada debe llegar al mismo resultado. Para exigir menos, configure **Acuerdo de sondas** en la página **Configuración → Sondas e intervalo** del monitor.

## Sondas e intervalo

Los monitores que comprueban las sondas terminan con este paso: Sitio web, API, Ping, IP, Puerto, Certificado SSL, DNS, DNSSEC, NTP, Dominio, Consulta SQL, Salud de la base de datos, Monitor sintético, Custom JavaScript Code y Página de estado externa. Las **Sondas** son las máquinas que ejecutan las comprobaciones, y las sondas predeterminadas de su proyecto empiezan seleccionadas. El **Intervalo de monitoreo** empieza en **Cada 5 minutos**.

:::steps
### Elegir las sondas

Conserve las **Sondas** seleccionadas o elija otras. Un monitor sin sondas nunca se comprueba. Para comprobar algo en una red privada, ejecute una [sonda personalizada](/docs/probe/custom-probe) dentro de esa red y elíjala aquí.

### Elegir cada cuánto comprobar

Elija un **Intervalo de monitoreo**, de **Cada minuto** a **Cada semana**. A los monitores Monitor sintético, Custom JavaScript Code y Certificado SSL se les ofrecen intervalos de 5 minutos o más.

### Crear el monitor

Haga clic en **Crear monitor**. Se abre la página del nuevo monitor. Para cambiar sus sondas o su intervalo más adelante, abra **Configuración → Sondas e intervalo** en esa página.
:::

Todos los demás tipos, excepto Manual, se crean desde el paso **Criterios**.

## Empezar desde una plantilla o un enlace

Una plantilla de monitor, y los enlaces que crean un monitor en otras partes de OneUptime (en un gráfico de métricas, un dispositivo de red o una regla de detección), abren **Crear monitor** con el tipo elegido y el resto rellenado. Haga clic en **Cambiar** para elegir otro tipo. El formulario de una plantilla usa el mismo selector de tipo: consulte [Plantillas de monitor](/docs/monitor/monitor-templates).

Cada tipo de monitor tiene su propia página con sus ajustes, sus criterios predeterminados y ejemplos. Buenos lugares para seguir:

:::cards
- [Monitor de sitio web](/docs/monitor/website-monitor): Comprobar que una página carga, y qué responde.
- [Monitor de API](/docs/monitor/api-monitor): Llamar a un endpoint con un método, encabezados y un cuerpo.
- [Plantillas de monitor](/docs/monitor/monitor-templates): Crear muchos monitores a partir de una configuración y mantenerlos sincronizados.
- [Incidentes](/docs/incidents/index): Qué ocurre después de que un monitor declara un incidente.
:::
