# Dimensionamiento y planificación de capacidad

Esta guía le ayuda a dimensionar una implementación autoalojada de OneUptime en Kubernetes (Helm). Cubre los tres almacenes de datos de los que depende OneUptime — **PostgreSQL**, **Redis** y **ClickHouse** — más el cómputo de la aplicación, y ofrece niveles iniciales que puede ajustar una vez que tenga cifras reales.

> **Lea esto primero:** el chart de Helm se distribuye **sin solicitudes ni límites de CPU/memoria establecidos** y con pequeños volúmenes predeterminados de **25 Gi** para PostgreSQL y ClickHouse. Esos valores predeterminados existen para que el chart se instale y se ejecute en cualquier clúster — **no** son un dimensionamiento de producción. Para cualquier cosa que vaya más allá de una prueba rápida, configure los recursos y el almacenamiento de forma explícita usando las cifras de abajo.

Si en su lugar está ejecutando la instalación de servidor único con Docker Compose, el dimensionamiento es más sencillo — consulte [Docker Compose](/docs/installation/docker-compose) (recomendado: 16 GB RAM, 8 núcleos, 400 GB de disco).

## Qué determina cada almacén de datos

OneUptime requiere tres almacenes de datos en producción. Escalan según entradas completamente diferentes, así que dimensiónelos de forma independiente.

| Almacén de datos | Qué almacena | Qué determina su tamaño |
| --- | --- | --- |
| **ClickHouse** | Toda la telemetría — logs, métricas, trazas, excepciones, perfiles | **Tasa de ingesta × retención** de la telemetría. Esto representa ~95% de su almacenamiento y el costo dominante. |
| **PostgreSQL** | Configuración y estado — monitores, incidentes, alertas, usuarios, equipos, proyectos, flujos de trabajo, páginas de estado, paneles | **Cantidad de entidades e historial**, no el volumen de telemetría. Crece lentamente. |
| **Redis** | Caché, colas de trabajo y sesiones | **Profundidad de cola y sesiones activas**. Limitado por memoria y modesto. No es una fuente de verdad. |

El almacenamiento de objetos (S3/MinIO) **no** es necesario para que OneUptime funcione. Solo se utiliza de forma opcional para las **copias de seguridad** de la base de datos (a través del complemento Barman de CloudNativePG para PostgreSQL, o `clickhouse-backup` para ClickHouse). OneUptime no transfiere la telemetría por niveles al almacenamiento de objetos — consulte la sección "Retención y cómo afecta al almacenamiento" más abajo.

## ClickHouse — el factor dominante

Casi todo su almacenamiento y una gran parte de su RAM se destinarán a ClickHouse, porque cada línea de log, punto de métrica, span de traza y excepción vive ahí.

### Fórmula de almacenamiento

```
ClickHouse disk ≈ (daily raw telemetry GB ÷ compression) × retention days × replicas × 1.3 (headroom)
```

La compresión depende de la señal:

- **Logs** comprimen bien — aproximadamente **5:1**.
- **Métricas** comprimen menos — aproximadamente **2:1** — y una alta **cardinalidad** de etiquetas infla tanto el disco como la RAM más rápido que el volumen bruto. Mantenga las etiquetas de baja cardinalidad.
- **Trazas** se sitúan en un punto intermedio, dependiendo de los atributos del span.

### Ejemplo práctico

Una flota de **10 clústeres**, cada uno con ~10 nodos / ~100 pods con un nivel de detalle INFO, produce aproximadamente **50–150 GB de logs en bruto por clúster durante 30 días** (≈ 1.7–5 GB/día por clúster). En toda la flota, con métricas y trazas añadidas y después de la compresión, presupueste aproximadamente **5–15 GB/día de telemetría comprimida**.

| Retención | Réplica única | 2 réplicas + 30% de margen |
| --- | --- | --- |
| 30 days | ~150–450 GB | **~0.4–1.2 TB** |
| 90 days | ~0.45–1.35 TB | **~1.2–3.5 TB** |

El almacenamiento escala **linealmente con la retención** — una ventana de 90 días cuesta ~3× una ventana de 30 días.

### RAM y tipo de disco

- **Use NVMe/SSD.** La telemetría implica muchas escrituras con lecturas de agregación a ráfagas; ClickHouse en disco mecánico tendrá dificultades.
- **Dé a ClickHouse RAM generosa.** Las consultas de agregación consumen mucha memoria. Como regla general, dimensione la RAM a una fracción significativa (25–50%) de su conjunto de datos comprimido *en caliente* (consultado recientemente), con un piso práctico de 16 GB para cualquier flota de producción real.
- **Controle la cardinalidad de las métricas.** Es la palanca más importante tanto para la RAM como para el disco de ClickHouse. Imponga convenciones de etiquetas de baja cardinalidad en la capa de recolección y vigile el recuento de series activas.

## PostgreSQL — configuración y estado

PostgreSQL almacena su configuración y estado operativo, no la telemetría, por lo que crece lentamente y se mantiene pequeño en relación con ClickHouse. Incluso las implementaciones grandes suelen estar en el rango de las decenas de GB. El volumen predeterminado de **25 Gi** está bien para instalaciones pequeñas; planifique 50–100 GB para las más grandes con margen para el historial de incidentes/alertas.

Si ejecuta muchas réplicas de aplicación, de worker y de sondas, la cantidad de conexiones a la base de datos puede convertirse en el cuello de botella antes que el almacenamiento. El chart de Helm de OneUptime incluye un agrupador de conexiones **PgBouncer** opcional (`pgbouncer.enabled`) para exactamente esto — actívelo para implementaciones con muchas réplicas.

## Redis — caché, colas y sesiones

Redis se utiliza como caché, cola de trabajo y almacén de sesiones. Está **limitado por memoria** y la persistencia está **deshabilitada de forma predeterminada** (Redis aquí no es una fuente de verdad — puede reconstruirse). Dimensiónelo según la profundidad de cola esperada y las sesiones concurrentes; 2–8 GB de memoria cubren la mayoría de las implementaciones. Tenga en cuenta que la política de desalojo predeterminada es `noeviction`, así que si las colas se acumulan bajo una sobrecarga sostenida, supervise la memoria de Redis.

## Cómputo de la aplicación

Más allá de los almacenes de datos, dimensione las cargas de trabajo sin estado (ingress, web/API, workers y sondas). Todas tienen como valor predeterminado **1 réplica** sin límites de recursos — configúrelos de forma explícita. El chart incluye **KEDA** para que los workers y las sondas puedan autoescalar según la profundidad de cola; actívelo para cargas variables. Los workers escalan con el volumen de procesamiento de telemetría/ingesta, y las sondas escalan con la cantidad de monitores activos.

## Niveles iniciales

Elija el nivel más cercano a su entorno como punto de partida, luego observe el uso real (`kubectl top pods`, crecimiento del disco de ClickHouse/Postgres) y ajuste.

- **Pequeño / PoC** — 1–3 clústeres, ≤30 nodos, ≤5 GB/día de telemetría en bruto, retención de 30 días.
- **Mediano / Flota de producción** — ~10 clústeres, ~100 nodos, 10–30 GB/día de telemetría en bruto, retención de 30–90 días.
- **Grande / Multi-flota** — 50+ clústeres, 500+ nodos, 100+ GB/día de telemetría en bruto, retención de 90 días.

| | Pequeño / PoC | Mediano / Flota de producción | Grande / Multi-flota |
| --- | --- | --- | --- |
| **ClickHouse** | 4 vCPU / 16 GB / 200 GB NVMe | 8 vCPU / 32 GB / 1–3 TB NVMe | 16+ vCPU / 64–128 GB / 5–15 TB NVMe, **fragmentado** |
| **PostgreSQL** | 2 vCPU / 4 GB / 50 GB SSD | 4 vCPU / 8 GB / 100 GB SSD | 8 vCPU / 16–32 GB / 250 GB SSD (+ PgBouncer) |
| **Redis** | 1 vCPU / 2 GB | 2 vCPU / 4 GB | 4 vCPU / 8–16 GB |
| **Retention assumed** | 30 days | 30–90 days | 90 days |

Estos dimensionan el **backend** de OneUptime. Los recolectores de OneUptime que se ejecutan en cada clúster monitoreado se dimensionan por separado — consulte los niveles de dimensionamiento del [Agente de Kubernetes](/docs/telemetry/kubernetes-agent).

## Alta disponibilidad

Los almacenes de datos integrados del chart se ejecutan como **instancias únicas** de forma predeterminada. Para HA en producción:

- **PostgreSQL** — active el operador [CloudNativePG](https://cloudnative-pg.io) incluido (`postgresOperator.cnpg.enabled`) con **3 instancias** (1 primaria + 2 hot standbys) para conmutación por error automática.
- **ClickHouse** — active el operador [Altinity](https://github.com/Altinity/clickhouse-operator) incluido (`clickhouseOperator.altinity.enabled`) con **≥2 réplicas por fragmento** y **3 nodos de ClickHouse Keeper** para quórum. Añada fragmentos una vez que el disco o la RAM de un solo nodo se conviertan en el límite.
- **Redis** — el chart no tiene replicación interna. Para HA, apunte OneUptime a un **Redis gestionado externo** (o una implementación de Sentinel/clúster).

## Retención y cómo afecta al almacenamiento

La retención de telemetría se aplica como un **TTL de ClickHouse configurado en días**, establecido **por proyecto** y refinable **por señal** (logs, métricas, trazas, perfiles) y por bucket (por ejemplo, por severidad de log). El valor predeterminado codificado es de 15 días.

Dado que la retención multiplica directamente el almacenamiento de ClickHouse, decídala antes de dimensionar el disco. OneUptime **no** archiva ni transfiere por niveles automáticamente la telemetría antigua al almacenamiento de objetos — para una retención de cumplimiento de varios años, amplíe la ventana de retención y dimensione el almacenamiento de ClickHouse en consecuencia (o exporte a un archivo externo de su elección).

## Mida antes de comprometerse

El volumen de telemetría varía enormemente según el nivel de detalle de los logs de la aplicación, la cantidad de namespaces, el intervalo de scrape y si el registro DEBUG está habilitado en algún lugar. Trate los niveles anteriores como puntos de partida: **instrumente su entorno durante al menos cuatro semanas**, mida los GB/día reales por señal, y luego dimensione la retención y el almacenamiento a partir de datos reales.

## Relacionado

- [Docker Compose](/docs/installation/docker-compose) — dimensionamiento de servidor único
- [Arquitectura autoalojada](/docs/self-hosted/architecture) — cómo encajan los componentes
- [Agente de Kubernetes](/docs/telemetry/kubernetes-agent) — dimensionamiento del recolector (plano de datos)
- [Chart de Helm en Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime)
