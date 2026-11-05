# Nubes OpenStack muy grandes

Lo que cuesta una nube de cualquier tamaño antes de instalar nada: cuánto presiona la monitorización su plano de control, cuántos datos envía y qué hace OneUptime de forma distinta a medida que una nube crece. Casi ninguna nube necesita nada de esto: los valores predeterminados del [agente de OpenStack](/docs/telemetry/openstack) y de una [sonda](/docs/telemetry/openstack-agentless) aguantan miles de instancias sin configurar nada.

:::cards
- [La carga sobre tu plano de control](#la-carga-sobre-tu-plano-de-control): Peticiones por minuto a cada servicio, a cada tamaño.
- [Los datos que envía](#los-datos-que-envía): Series y gigabytes al día, a partir de los recuentos de tu nube.
- [Modo resumen](#modo-resumen): Qué conserva una nube de más de 5000 instancias y a qué renuncia.
- [Compartir una nube entre recopiladores](#compartir-una-nube-entre-recopiladores): Un agente por región o por servicio.
- [La vía de la base de datos](#la-vía-de-la-base-de-datos): Leer las nubes más grandes desde sus bases de datos.
- [A qué se sometió el tamaño más grande](#a-qué-se-sometió-el-tamaño-más-grande): Una hora con 200 000 instancias, con sus presupuestos y lo que midió.
:::

## La carga sobre tu plano de control

### A través de una sonda

Una sonda se mantiene dentro de una carga declarada por grande que sea la nube. Pregunta a cada servicio una petición cada vez, a Placement cuatro, lee las instancias por lo que cambió entre lecturas completas y, pasado un número declarado, lee en turnos lo que es una llamada por cosa (los usos de un hipervisor, los agentes de un router, las cuotas de un proyecto). Cada recopilación envía todo tal como se leyó por última vez, así que ninguna serie tiene huecos: solo cambia la frescura de esas partes.

Peticiones por minuto con los valores predeterminados, una vez estabilizada una recopilación, en una nube con OVN:

| Nube | Keystone | Nova | Placement | Neutron | Cinder | Glance |
| --- | --- | --- | --- | --- | --- | --- |
| 10 hipervisores, 100 instancias, 20 proyectos | 1,3 | 3,5 | 12,5 | 3,5 | 2,5 | 0,3 |
| 500 hipervisores, 20 000 instancias, 1000 proyectos | 1,3 | 4,2 | 253 | 7,5 | 8,5 | 0,3 |
| 5000 hipervisores, 200 000 instancias, 10 000 proyectos | 1,3 | 12,7 | 1003 | 43,5 | 62,5 | 0,5 |

Estas cifras están contadas, no estimadas: una prueba ejecuta el recopilador real contra una API simulada de cada tamaño, con un reloj que ella misma mueve, y ajusta lo que pidió exactamente a estos números, servicio por servicio, dondequiera que venza algo distinto. Un recuento de peticiones no depende de la máquina en la que se contó.

Lo que contiene cada tamaño además de sus hipervisores, instancias y proyectos se supone, y una nube real difiere: un volumen por cada segunda instancia, un snapshot y un backup por cada décimo volumen, una red, subred, router y grupo de seguridad por proyecto, una IP flotante por cada décima instancia, 40 flavors, dos agentes de Neutron por hipervisor y una imagen por cada diez proyectos, entre 10 y 1000. Una lista cuesta una petición por cada mil filas, así que lo que tu nube contiene realmente los mueve solo un poco. Lo que más los mueve:

| Qué cambia | Qué cuesta |
| --- | --- |
| La primera recopilación tras iniciarse una sonda | Una llamada por los inventarios de cada hipervisor y otra por sus usos, sean cuantos sean |
| ML2/OVS en lugar de OVN | Una llamada por router para preguntar qué agentes L3 lo contienen, como máximo 2000 por recopilación |
| Instancias que cambian | Una llamada por instancia que cambió, a Nova, para leer lo que le pasó, como máximo 25 por recopilación |
| [Límites de proyecto](/docs/telemetry/openstack-agentless#lo-que-le-cuesta-a-tu-nube) activados | Cuatro llamadas por proyecto, como máximo 250 proyectos por recopilación, así que una nube de 10 000 tarda 80 minutos en dar la vuelta |
| Recopilar con menos frecuencia | **Recopilar cada** en la página de **Ajustes** de la nube. El doble de tiempo es la mitad de llamadas |
| Más regiones | Todo menos Keystone otra vez, por región |

Una recopilación dispone de nueve décimas de su intervalo, y como máximo diez minutos, y cada servicio se lee una petición cada vez. Así que la rapidez con que responden las API de una nube grande decide con qué frecuencia se puede recopilar: con 200 000 instancias y los dos minutos predeterminados, Nova tiene que responder cada página de su lectura completa en aproximadamente medio segundo, y Cinder sus listas en unos 0,8 de segundo. Un servicio que no puede terminar figura como caído hasta que lo hace, y la tarjeta dice **La recopilación tardó demasiado**. Sube **Recopilar cada**, lo que también reduce la carga, o usa la [vía de la base de datos](#la-vía-de-la-base-de-datos).

### A través del agente

El exportador del agente inicia sesión y lee cada lista completa en cada scrape, y pregunta a Placement tres cosas por hipervisor, una llamada cada vez. Peticiones por minuto con los valores predeterminados:

| Nube | Keystone | Nova | Placement | Neutron | Cinder | Glance |
| --- | --- | --- | --- | --- | --- | --- |
| 10 hipervisores, 100 instancias, 20 proyectos | 3,4 | 3 | 15,5 | 3,5 | 2 | 0,2 |
| 500 hipervisores, 20 000 instancias, 1000 proyectos | 3,4 | 13 | 751 | 7,5 | 7,5 | 0,2 |
| 5000 hipervisores, 200 000 instancias, 10 000 proyectos | 3,4 | 106 | 7501 | 43,5 | 57 | 0,4 |

Estas cifras se cuentan a partir del código fuente del exportador, y el exportador no se ha ejecutado a estos tamaños. Un scrape dispone de 110 segundos, así que un Placement que responde en 20 ms se queda sin tiempo a unos 1800 hipervisores, y Nova, a un segundo por página, a unas 110 000 instancias. Pasado eso, un scrape de ellos falla por suave que se haya pedido. Pasados esos tamaños, usa la [vía de la base de datos](#la-vía-de-la-base-de-datos) o una sonda.

### Cuando una API se ralentiza

Una sonda vigila en cuánto suele responder cada servicio, y cuando una respuesta tarda tres veces eso y al menos un segundo, o cinco segundos sea cual sea lo habitual, espera tanto como tardó esa respuesta antes de volver a preguntar a ese servicio. Varias lecturas que esperan a la vez se turnan, de modo que una pausa no acaba en una ráfaga. Un servicio que sigue respondiendo `429` o `503` se deja en paz durante un minuto, luego dos, luego cuatro, hasta media hora. Nada más se retiene: cada servicio se consulta por separado.

La tarjeta **Recopilación de datos** de la nube lo indica mientras dura, servicio por servicio: cuánto tardó su respuesta más lenta y cuánto se contuvo la sonda. El exportador del agente no puede hacer esto. Un scrape se ejecuta entero, a su intervalo: sube `scrape_interval` y `scrape_timeout` para ese job para ser más suave con un servicio.

## Los datos que envía

Las series de una nube se derivan de sus recuentos. La calculadora de la página de **Documentación** de una nube en OneUptime lo calcula a partir de tres números. Para calcularlo tú mismo, para una región:

| Series | Cuántas |
| --- | --- |
| Cómputo | 10 por hipervisor, más flavors y servicios de control, más 7 |
| Placement | 15 por hipervisor, más 4. Una sonda añade unas 2 por flavor, para [cuántos de cada uno caben](/docs/telemetry/openstack#capacidad) |
| Neutron | Agentes, redes, routers e IP flotantes, 3 por subred, más 11. Una más por router en ML2/OVS |
| Cinder | Servicios, snapshots y backups, 2 por pool de almacenamiento, más 26 |
| Instancias y volúmenes, a menos que el modo resumen esté activado | 4 por instancia, 2 por volumen |
| Recuentos del modo resumen, cuando está activado | Uno por estado y uno por proyecto: unos 6 más los proyectos |
| Keystone, Glance | Proyectos, dominios y 9, y 2 por imagen más 5. Una sonda añade 3 por cada uno de Heat y Magnum, los ejecute o no una nube |

Las filas de cada scrape son por lo que se te factura: las primeras cinco líneas llegan cada 2 minutos, 720 veces al día, y la última cada 5 minutos, 288 veces. El precio es el de tu factura, [por GB según el tiempo que se conserva](/docs/telemetry/openstack#lo-que-cuesta). La factura lee el tamaño real de cada fila, y esto lo calcula a 1024 bytes por fila, a lo que recurre la facturación de OneUptime cuando no tiene tamaño para una fila. Una fila con muchas etiquetas, como la de una instancia, cuesta más que eso, y una sin ninguna cuesta menos.

| Nube | Series | GB al día, todas las series | GB al día, en modo resumen | Un mes conservado 15 días, en modo resumen |
| --- | --- | --- | --- | --- |
| 10 hipervisores, 100 instancias, 20 proyectos | 1075 | 0,7 | No en modo resumen | $2,12 |
| 500 hipervisores, 20 000 instancias, 1000 proyectos | 123 847 | 84,5 | 16,6 | $49,71 |
| 5000 hipervisores, 200 000 instancias, 10 000 proyectos | 1 237 183 | 844,5 | 164,9 | $494,73 |

Estas cifras son a través del agente, con una instancia de cada mil en un estado que conserva sus series. Una sonda pasado el tamaño de resumen envía lo que no ha cambiado una vez por ciclo en lugar de en cada recopilación, lo que suma unos 13,2 GB al día en el segundo tamaño y 116 GB en el tercero.

El uso real por instancia, desde libvirt o Ceilometer, se suma a todo esto: consulta [lo que cuesta](/docs/telemetry/openstack#lo-que-cuesta).

## Modo resumen

Pasadas 5000 instancias, una nube conserva recuentos y filas, en lugar de una serie por instancia. A ese tamaño esas series son la mayor parte de la factura, con unos 17 GB al día frente a 4 GB para todo lo demás, y dicen lo que las filas y los recuentos ya dicen.

**Lo que conserva:**

- Una fila por cada parte, en cada página y lista, siempre actualizada. Los cambios de estado la alcanzan como de costumbre.
- Todas las series de hipervisores, workers, redes, routers, IP flotantes, pools de direcciones y pools de almacenamiento.
- `openstack_nova_instances_by_status` y `openstack_nova_instances_by_project`, en cada región.
- Las series de cualquier instancia o volumen en un estado que vigila una alerta: en `ERROR`, o atascado en `BUILD`, `RESIZE`, `attaching` y similares. Así todas las [plantillas de alerta](/docs/monitor/openstack-monitor#pre-built-alert-templates) siguen funcionando y siguen recuperándose por sí solas.

**A lo que renuncia:**

- El historial del estado de cada instancia y volumen estabilizados, y una gráfica o un monitor sobre esas series. `openstack_nova_server_status`, `openstack_cinder_volume_gb` y `openstack_cinder_volume_status` dejan de enviarse para una parte una vez estabilizada. Un monitor que necesite una instancia debería elegir su proyecto, más abajo.
- `openstack_placement_resource_provider_allocations` y `openstack_nova_server_local_gb`, sean de quien sean. Una sonda deja de pedir a Placement las asignaciones por completo.

**Para conservar de todos modos las series de una instancia**, abre los **Ajustes** de la nube y luego **Uso real por instancia**. **Solo los proyectos y agregados que elija** conserva cada instancia y volumen de esos proyectos, sea cual sea el tamaño de la nube. **Cada instancia** desactiva el modo resumen para toda la nube. Una sonda lo rechaza pasados unos 480 MiB de métricas por recopilación, en lugar de mantener eso en memoria: usa el agente para una nube así.

**A través de una sonda** hay una diferencia más. Pasado el tamaño de resumen lee todo cada vez, y envía solo lo que cambió, lo que alguien eligió, lo que vigila una alerta y una parte del resto. Cada parte da la vuelta una vez por ciclo, dimensionado para que la subida de una recopilación se quede en unos 24 MiB más allá de las series que van siempre: 6 minutos con 20 000 instancias, 44 con 200 000. La tarjeta **Recopilación de datos** indica cuánto dura el ciclo. De esto se derivan dos cosas:

- **Las listas de una nube nueva se llenan durante su primer ciclo.** La primera recopilación sabe qué contiene la nube, y la tarjeta lo dice de inmediato, pero sus filas llegan una parte cada vez. Lo mismo ocurre con una sonda que se ha reiniciado, aunque las filas que dejó permanecen mientras tanto en las páginas. La tarjeta indica cuándo habrán llegado todas.
- **Una parte que ha desaparecido sigue listada un poco más.** Se va a los 15 minutos de que nada la informe, más el ciclo, más dos lecturas. Así que 15 minutos y unos pocos más en la mayoría de las nubes, y algo más de una hora con 200 000 instancias. Una parte que sigue ahí nunca se elimina. Una lectura fallida no elimina nada, por mucho que dure.

## Compartir una nube entre recopiladores

Un agente lee una nube tenga las regiones que tenga, y con eso hay que empezar. Cuando uno es demasiado para la máquina en la que se ejecuta o para el tiempo de un scrape, dale a cada agente una parte. Todos envían a la misma nube de OneUptime con el mismo `OPENSTACK_CLOUD_NAME`. Dos reglas evitan que una gráfica y una factura cuenten doble:

- **Cada par de región y servicio pertenece a un agente.** Una fila es la misma fila por muchos agentes que la informen, pero las series de cada agente se almacenan y se facturan.
- **Keystone pertenece a un agente.** Es uno para toda la nube, la región que lo pregunte.

**Un agente por región** es lo que quieren la mayoría de las nubes. Enumera solo las entradas de esa región en `clouds.yaml` y `OPENSTACK_EXPORTER_CLOUDS`. Solo el primer agente conserva Keystone:

```bash
# On the agent for RegionOne, in .env
OPENSTACK_CLOUD_NAME=prod
OPENSTACK_EXPORTER_CLOUDS=[RegionOne]

# On the agent for RegionTwo
OPENSTACK_CLOUD_NAME=prod
OPENSTACK_EXPORTER_CLOUDS=[RegionTwo]
OPENSTACK_AGENT_SERVICES=compute|placement|network|volume|image
```

**Un agente por servicio** es para las nubes más grandes, donde las listas de un servicio son lo que un scrape no puede terminar. `OPENSTACK_AGENT_SERVICES` conserva los jobs que nombra y deja el resto a otro agente:

```bash
# Nova and Placement, which take the most
OPENSTACK_AGENT_SERVICES=compute|placement

# And everything else
OPENSTACK_AGENT_SERVICES=identity|network|volume|image
```

Define `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` en un agente que tenga una parte grande: mantiene un scrape en memoria de camino a la salida, y el valor predeterminado es 512 MiB. Una fila la avala su propio servicio en su propia región, así que un agente que se detiene no se lleva nada de lo que lee otro. Nombra lo que sostiene una nube, los `OPENSTACK_RABBITMQ_TARGETS` y [los demás como ellos](/docs/telemetry/openstack#variables-de-entorno), en un solo agente. Si ese agente se detiene mientras los demás continúan, esas máquinas salen de las páginas a los 15 minutos y vuelven cuando él lo hace.

**Con sondas**, una nube tiene una sola sonda. Dale a una región una sonda propia conectándola como una nube propia, con solo esa región elegida: nada se cuenta dos veces, porque cada una lee solo su propia región, y cada una lee Keystone por sí misma. Cada una es entonces una nube propia en OneUptime, con sus propias páginas y sus propias alertas.

## La vía de la base de datos

Pasados **1500 hipervisores o 100 000 instancias** el agente puede leer las bases de datos de una nube en lugar de sus API, con [`openstack_database_exporter`](https://github.com/vexxhost/openstack_database_exporter). A ese tamaño un scrape de las API se queda sin tiempo, y las lecturas que no pueden terminar son carga para nada. Una lectura de base de datos no cuesta nada a las API. Se ofrece solo pasado ese tamaño, porque por debajo las API responden suficientemente bien y esta vía renuncia a cosas.

**Lo que te pide:**

- Una cuenta de solo lectura en la base de datos de cada servicio: Nova, Nova API, Placement, Neutron, Cinder, Glance y Keystone. Una base de datos que se deja fuera es un servicio que se deja en paz.
- Una ruta desde la máquina del agente hasta esas bases de datos, que en la mayoría de las nubes se mantienen bien alejadas de todo lo demás. Es una cosa más que puede leer los registros de cada proyecto.
- Un exportador por región, y por celda de Nova. Lee lo que le indicas, y una segunda celda necesita un segundo exportador.
- Que sus esquemas sigan tu versión. Lee directamente las tablas de cada servicio, así que una actualización de OpenStack puede cambiar lo que puede leer antes de que lo haga una nueva versión del exportador.

**Para activarla**, en `.env`:

```bash
COMPOSE_PROFILES=openstack-database-exporter
# Read from the databases, and from nowhere else: with the two together every series arrives twice.
OPENSTACK_EXPORTER_CLOUDS=[]
OPENSTACK_DATABASE_EXPORTER_TARGETS=[openstack-database-exporter:9180]
# What a hypervisor's full name adds to Nova's host name, so an instance finds its hypervisor.
OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX=.example.org
# oslo.db's form. Each is kept in .env, which only its owner can read.
NOVA_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/nova
NOVA_API_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/nova_api
PLACEMENT_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/placement
NEUTRON_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/neutron
CINDER_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/cinder
GLANCE_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/glance
KEYSTONE_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/keystone
# What a database cannot say, from the API: each is one small list a scrape.
OPENSTACK_WORKER_STATE_CLOUDS=[RegionOne]
```

**Lo que cubre.** Las mismas series con los mismos nombres, así que cada página, monitor y plantilla de alerta las lee de la misma manera. Una prueba las ajusta a las del exportador de API, nombre por nombre y etiqueta por etiqueta.

**Lo que no cubre:**

| Qué | Por qué, y qué ocurre en su lugar |
| --- | --- |
| Si cada worker de Nova está vivo | Su `openstack_nova_agent_state` vale 1 para cualquier servicio habilitado, así que un `nova-compute` detenido figuraría como activo. El agente descarta esa serie y la lee de la API de Nova, que es una lista pequeña |
| Cuán lleno está cada pool de almacenamiento | Cada backend lo informa al scheduler de Cinder, y no está en la base de datos. El agente lo lee de la API de Cinder, que es una más |
| La MTU de una red | Figura como desconocida |
| `openstack_placement_resource_provider_allocations`, la generación de un proveedor | Nada las lee |
| Cuotas y límites por proyecto | Puede leerlos, y con 10 000 proyectos eso son 790 000 puntos de datos por scrape, así que el agente los deja fuera. Elimina esa regla en `otel-collector-config.yaml` para conservarlos |
| Si una API responde | `openstack_<service>_up` indica si responde su base de datos. Una API detenida con una base de datos sana figura como activa, así que vigila las propias API con un [monitor de sitio web](/docs/monitor/website-monitor) |

**Hasta dónde está demostrado.** Las series se leyeron del código fuente del exportador y de sus propias pruebas en la etiqueta que fija el agente, y cada una coincide con lo que lee OneUptime. No se ha ejecutado aquí contra una base de datos real.

## A qué se sometió el tamaño más grande

El recopilador real leyó una API simulada de 5000 hipervisores, 200 000 instancias y 10 000 proyectos cada dos minutos durante 60 minutos, con un reloj real. Lo que envió pasó por el fold real y las escrituras reales en un Postgres real, con las lecturas de la Vista general y el barrido de filas obsoletas ejecutándose a su lado cada 30 segundos, y 200 instancias cambiando en cada recopilación. Cada presupuesto de abajo se verifica, y una ejecución que incumple uno falla.

| Qué | Presupuesto | Medido |
| --- | --- | --- |
| Peticiones por minuto, tal como se piden a cada servicio | Exactamente lo que dice el calendario del recopilador, servicio por servicio | Exacto. Keystone 1,3, Nova 25,1, Placement 1166, Neutron 43,5, Cinder 62,4, Glance 0,5 |
| Recopilaciones omitidas porque la anterior seguía en ejecución | Ninguna | 0 de 30 |
| Retraso de ingesta, desde que empieza una recopilación hasta que se escribe su última fila | Menos de 2 minutos | 37 s en la mediana, 112 s en el peor caso |
| La apertura de una Vista general, todas las lecturas que hace a la vez | Menos de 6 segundos | 0,6 s en la mediana, 4,1 s en el peor caso, y 5008 bytes de lo que requiere atención |
| Lo máximo que un escritor esperó por un bloqueo en la tabla de inventario | Menos de 5 segundos | 0,0 s, en 2739 comprobaciones una vez por segundo |
| Partes eliminadas que seguían ahí | Ninguna | 0 |

Y lo que costó, que no tiene presupuesto: 73 MiB de métricas por recopilación antes de comprimir, en hasta 2 subidas, 14 s de CPU de este proceso por recopilación para leer, enviar y escribir en conjunto, y como máximo 998 MiB de heap de JavaScript. Una sonda que recopile una nube de este tamaño necesita esa memoria además de su otro trabajo.

Esto se ejecutó en un Mac con 10 núcleos, compartido con otro trabajo con una carga media de unos 33, y PostgreSQL 14 en la misma máquina, así que los tiempos son lo que logró una máquina ocupada y no lo que lograría un servidor. Se midió el 2026-11-05. Las peticiones de una hora incluyen su primera recopilación, que pide a Placement los inventarios de cada hipervisor, así que figuran algo por encima de [la tabla](#a-través-de-una-sonda) de una ya estabilizada, y las 200 instancias que cambian en cada recopilación son el resto de lo que leen allí las lecturas de Nova.

El margen no es amplio en una máquina tan ocupada. Una hora anterior, con una carga media de unos 42 que llegó a 95, llegó a que la última fila de una recopilación aterrizara a los 124 segundos, así que se omitió la siguiente recopilación, y todos los demás presupuestos se cumplieron.

**Lo que esto deja fuera.** La simulación responde al instante, así que esto no dice nada sobre la rapidez de tus API: [lo que permite el tiempo de una recopilación](#a-través-de-una-sonda) trata de eso. Deja fuera el servidor HTTP y la cola entre una sonda y la ingesta, y ClickHouse, así que la lectura de las series por una gráfica o un monitor no está aquí, solo las escrituras y lecturas del inventario. Las filas tienen la forma de las de un DevStack real y los recuentos son inventados. Ninguna nube de este tamaño se ha ejecutado contra ello.

## Lo que leen las páginas

Las páginas de una nube grande se leen tan rápido como las de una pequeña, porque ninguna lee toda la nube.

| Página | Qué lee |
| --- | --- |
| **Vista general** | Recuentos calculados en el servidor y las filas que pueden necesitar a alguien. Pasados 1000 hosts o workers, el resto solo se cuenta, así que lo que trae se queda por debajo de un megabyte por grande que sea la nube |
| **Servicios** | Lo mismo: una tarjeta por servicio, primero lo que necesita a alguien y cuántos otros están bien. Una búsqueda pregunta al servidor, así que encuentra cualquier host |
| Listas | Una página cada vez, cada una desde la última fila de la página anterior. Un salto a una página lejana va por desplazamiento, que en la última página de 200 000 filas tarda segundos en lugar de un milisegundo |
| **Topología** | Pasadas 5000 partes, la estructura, lo que ha fallado y lo que eso se lleva consigo. Indica lo que dejó fuera |
| **Escrituras del inventario** | Como máximo 500 filas por sentencia, y 5000 en un delete, cada una en su propia transacción, de modo que ningún escritor espera mucho a otro. Una fila en la que nada ha cambiado no se reescribe hasta pasados 5 minutos, lo que reduce el write-ahead log más de veinte veces |

## Uso y gasto

La [página de gasto](/docs/telemetry/openstack#gasto) de una nube lee las filas del inventario en lugar de las series de cualquier instancia, así que funciona igual en modo resumen, y su coste crece con los proyectos en lugar de con las instancias. Lee una fila de la nube y una página de proyectos. [Su propia sección](/docs/telemetry/openstack#en-cada-tamaño) tiene los números a cada tamaño.

## Siguientes pasos

:::cards
- [Agente de OpenStack](/docs/telemetry/openstack): Instala el agente.
- [OpenStack sin agente](/docs/telemetry/openstack-agentless): Recopila una nube con una sonda.
- [Monitor de OpenStack](/docs/monitor/openstack-monitor): Alerta sobre lo que llega.
:::
