# Productos de datos

Las personas que usan los datos (analistas, el equipo de finanzas, directivos, agentes de IA) piensan en lo que usan: «las tablas del panel de ingresos», no en bases de datos. Un **producto de datos** da nombre a esas tablas, con su propietario, sus consumidores y su SLA de frescura, y les dice a todos los que dependen de él si los datos de hoy ya han llegado.

## Crear un producto de datos

En **Observabilidad de datos > Productos de datos**, crea un producto de datos: ponle nombre, elige sus tablas y dale un SLA con uno de estos criterios o con los dos:

- **Actualizado antes de una hora del día (UTC):** los datos de cada día llegan ese mismo día, antes de esa hora. A partir de esa hora, cada tabla debe haber cambiado ese día; hasta entonces, vale la carga de ayer. Una carga que siempre llega con media hora de retraso va con retraso esa media hora todos los días.
- **Una antigüedad máxima:** ninguna tabla puede tener un último cambio más antiguo que este valor.

Cada cinco minutos, las tablas de cada producto se comprueban frente a su SLA. El producto está **Late** cuando lo está cualquiera de sus tablas, y sus datos son de la fecha del último cambio más antiguo entre ellas. Escribe `oneuptime.data.product.late_tables` y `oneuptime.data.product.data_age`, para que puedas graficar lado a lado la frescura de todos los productos.

## En páginas de estado

Al guardar un producto también se crea un **monitor** para él, en tu nombre y con tus permisos. El monitor está Degradado mientras una tabla llega tarde, y abre un incidente y una alerta con el nivel de gravedad más bajo de tu proyecto, que se resuelven solos. Añádelo como recurso a una página de estado, privada o pública: los consumidores que se suscriben se enteran cuando el producto llega tarde y cuando vuelve a estar actualizado. Consulta [Recursos de la página de estado](/docs/status-pages/resources-and-groups).

## Como SLO

Al guardar un producto también se crea un **SLO** sobre su monitor: la proporción del tiempo en que los datos llegan a tiempo, frente al objetivo del producto durante 30 días, con las alertas de tasa de consumo rápida y lenta con las que empieza todo SLO. Consulta [SLO](/docs/slo/introduction). Al eliminar el producto se eliminan su monitor y su SLO.

## La insignia «data as of»

Cada producto tiene una **insignia** que dice de cuándo son sus datos, en verde mientras van a tiempo y en ámbar con «late» cuando no. Insértala en un panel de BI, una página de wiki o un README desde la **Vista general** del producto:

```markdown
![Data as of](https://oneuptime.com/api/data-observability/data-products/<data product ID>/badge?token=<badge token>)
```

Su enlace no necesita iniciar sesión, así que trátalo como un enlace compartido. **Restablecer enlace de la insignia** crea uno nuevo y retira el anterior.

## Próximos pasos

:::cards
- [Salud de las tablas](/docs/data-observability/table-health): Cómo se aprende la frescura de cada tabla.
- [OneUptime AI y la API](/docs/data-observability/ai-and-api): Deja que los agentes de IA comprueben las tablas de un producto antes de usarlas.
:::
