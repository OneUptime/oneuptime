# Costos y ahorros en la nube

Una cuenta en la nube conectada también dice cuánto cuesta y cómo podría costar menos. OneUptime lee los costos de cada día de la propia facturación de tu nube y las recomendaciones del propio recomendador de tu nube, los muestra en **Nube → Gasto → Costos** y **Nube → Gasto → Ahorros**, lista tus Savings Plans, reservas y descuentos por compromiso de uso en **Nube → Gasto → Compromisos**, y alerta antes de que un mes cueste más que su presupuesto en **Nube → Gasto → Presupuestos**. Si lo permites, también aplica los ahorros que aprueba un propietario, detiene los recursos no productivos fuera del horario laboral y comprueba cada cambio con la factura.

:::cards
- [Amazon Web Services](#amazon-web-services): Cost Explorer y Cost Optimization Hub, cada uno activado una vez.
- [Microsoft Azure](#microsoft-azure): Cost Management y Azure Advisor, con un rol más.
- [Google Cloud](#google-cloud): Tu exportación de facturación a BigQuery y el Recommender.
- [Facturado, amortizado y neto](#facturado-amortizado-y-neto): Cada costo de tres maneras, para que los compromisos y los créditos caigan donde fue el dinero.
- [Compromisos y renovaciones](#compromisos-y-renovaciones): Cada compromiso, alertas antes de que termine uno o mientras se usa poco, y qué renovar o comprar.
- [Aplicar ahorros](#aplicar-ahorros): Aplica un ahorro con la aprobación de su propietario, y deshazlo.
- [Programaciones fuera de horario](#programaciones-fuera-de-horario): Detén los recursos no productivos por la noche y los fines de semana.
- [Reglas de IA para ahorros](#reglas-de-ia-para-ahorros): Propuestas para los propietarios, o cambios dentro de un límite.
- [Presupuestos](#presupuestos): Una alerta cuando el gasto de un mes supera una parte de su presupuesto.
:::

## Cómo funciona

```mermaid title="De la facturación de tu nube a las páginas de Nube"
flowchart TB
    bill["Facturación de tu nube,<br/>leída dos veces al día"] --> costs["Costos"]
    rec["Recomendador de tu nube,<br/>leído una vez al día"] --> savings["Ahorros"]
    costs --> budgets["Presupuestos que alertan"]
    costs --> overview["Vista general de Nube"]
    savings --> overview
```

- **Los costos vienen de la propia facturación de tu nube.** AWS Cost Explorer, Azure Cost Management y la exportación de facturación de Google Cloud a BigQuery, en la moneda en que se factura la cuenta, cada uno guardado facturado, amortizado y neto: consulta [Facturado, amortizado y neto](#facturado-amortizado-y-neto). Cada cifra es la de un día, en días UTC, como los factura tu nube.
- **Una nube informa del último día o dos con retraso.** Cada lectura vuelve a tomar la última semana, y todo el mes pasado en los primeros días de un mes, así que el costo de un día se asienta a medida que tu nube lo termina. La primera lectura de una conexión retrocede hasta el inicio del penúltimo mes.
- **La proyección del mes es el ritmo de la última semana.** Es lo que el mes ha costado hasta ahora, con cada día que queda al promedio de los últimos siete días completos.
- **Los ahorros vienen del propio recomendador de tu nube.** AWS Cost Optimization Hub, Azure Advisor y el Recommender de Google Cloud: un tamaño menor, un recurso inactivo, un compromiso que vale la pena, cada uno con lo que ahorraría al mes. Una recomendación que aplicas o descartas en la consola de tu nube desaparece en la siguiente lectura.

## Antes de empezar

- **Una cuenta conectada.** [Conectar una cuenta en la nube](/docs/telemetry/cloud-accounts) con el comando de configuración actual: permite que la conexión lea costos y recomendaciones. Una conexión creada antes no lee ninguno de los dos hasta que vuelvas a ejecutar su comando.

## Amazon Web Services

La conexión lee los costos con `ce:GetCostAndUsage`, sus compromisos con `ce:GetSavingsPlansCoverage`, `ce:GetSavingsPlansUtilization`, `ce:GetSavingsPlansUtilizationDetails`, `ce:GetReservationCoverage` y `ce:GetReservationUtilization`, los Savings Plans comprados con `savingsplans:DescribeSavingsPlans`, y las recomendaciones con `cost-optimization-hub:ListRecommendations` y `cost-optimization-hub:GetRecommendation`. El comando de configuración concede las lecturas de Cost Explorer como tres familias, `ce:GetCostAndUsage*`, `ce:GetSavingsPlans*` y `ce:GetReservation*`, todas ellas lecturas, para que el usuario de una clave de acceso siga cabiendo en los 2048 caracteres que IAM permite a su política. Cost Explorer y Cost Optimization Hub necesitan activarse antes en la cuenta:

:::steps
### Activar Cost Explorer

Abre Cost Explorer una vez en la consola de AWS Billing and Cost Management: AWS prepara los costos de la cuenta en menos de un día. Conecta la cuenta de administración de la organización para leer los costos de cada cuenta miembro.

### Activar Cost Optimization Hub

Abre Cost Optimization Hub en la misma consola y actívalo, para la organización desde su cuenta de administración o solo para la cuenta. Sus recomendaciones llegan en menos de un día.
:::

Cost Explorer cobra $0.01 por cada solicitud: una lectura de los costos hace dos o unas pocas más, una para facturado y amortizado y otra para neto, y los compromisos se leen con cuatro al día para su cobertura y uso, y seis a doce más al día para los de cada uno. La API de Savings Plans y Cost Optimization Hub son gratuitos.

### Costos por recurso

Cost Explorer también indica lo que cuesta cada recurso, de los últimos 14 días, una vez activados los datos a nivel de recurso. En la consola AWS Billing and Cost Management, abre las preferencias de Cost Management y activa los datos a nivel de recurso con granularidad diaria, para la organización desde su cuenta de administración. AWS los prepara en 48 horas.

Luego edita la conexión en **Nube → Conectar** y, en **Más campos**, activa **Costos por recurso**. La conexión los lee con `ce:GetCostAndUsageWithResources` una vez al día: los 14 días la primera vez y después los tres últimos de nuevo, con unas pocas solicitudes cada vez. Lo que lee se queda con los costos de la cuenta después de que Cost Explorer lo olvide. Una conexión creada antes necesita volver a ejecutar su comando de configuración, que añade la acción.

## Microsoft Azure

La aplicación lee los costos con el rol **Cost Management Reader**, en el mismo ámbito que **Monitoring Reader**: el comando de configuración concede ambos. Las recomendaciones de Azure Advisor se leen con **Monitoring Reader**, así que no hay nada que activar. Para dar el rol a una aplicación creada antes, ejecuta:

```bash
az role assignment create --assignee <APP_ID> --role "Cost Management Reader" --scope /subscriptions/<SUBSCRIPTION_ID>
```

Cost Management responde por cada suscripción, con el recurso al que corresponde cada costo, y leerlo no cuesta nada. Cuando no puede responder por una suscripción, los **Costos** de la cuenta dicen por qué.

Cost Management limita la rapidez con la que se leen los costos de un inquilino, igual para todos los que los leen: cada consulta cuesta una unidad de procesamiento de consultas (QPU) por cada mes de datos que lee, y un inquilino tiene 12 QPU cada 10 segundos, 60 por minuto y 600 por hora. OneUptime lee las suscripciones de un inquilino una tras otra dentro de dos tercios de cada cuota, espera lo que Cost Management pida cuando rechaza una consulta y sigue en la siguiente lectura donde se quedó. Una suscripción aún sin leer dice **En cola**, con cuándo se lee; una que ya tiene cifras las conserva mientras tanto. Su costo amortizado se lee en cada lectura y su costo real una vez al día, así que la primera lectura de una suscripción consulta Cost Management dos veces y gasta el doble de unidades de consulta: las primeras cifras de un inquilino grande tardan unas pocas lecturas más.

Las reservas y los planes de ahorro del inquilino se leen con **Reservations Reader** y **Savings plan Reader**, que Azure concede en el ámbito del propio inquilino, donde solo un administrador global con acceso elevado puede concederlos. El comando de configuración lo intenta, y lo dice cuando no puede. Para concederlos más tarde, como administrador global con acceso elevado:

```bash
az role assignment create --assignee <APP_ID> --role "Reservations Reader" --scope /providers/Microsoft.Capacity
az role assignment create --assignee <APP_ID> --role "Savings plan Reader" --scope /providers/Microsoft.BillingBenefits
```

Sin ellos, los costos y las recomendaciones se leen como antes, y **Nube → Gasto → Compromisos** indica qué rol conceder.

## Google Cloud

Google Cloud no tiene ninguna API para los costos de un proyecto: OneUptime los lee de la exportación de tu cuenta de facturación a BigQuery.

:::steps
### Exportar tu facturación a BigQuery

En la consola de Google Cloud, abre Billing, luego Billing export, y activa la exportación del costo de uso detallado a un conjunto de datos de BigQuery. Google la escribe con unas horas de retraso, desde el día en que la activas.

### Permitir que la cuenta de servicio la lea

Da a la cuenta de servicio de la conexión **BigQuery Data Viewer** en el conjunto de datos de la exportación. El comando de configuración ya le dio **BigQuery Job User**, para ejecutar la consulta en su propio proyecto.

### Indicar la tabla de la exportación

Edita la conexión en **Nube → Conectar** y, en **Más campos**, pon en **Tabla de la exportación de facturación** el nombre completo de la tabla: `<PROJECT_ID>.<DATASET>.gcp_billing_export_resource_v1_<BILLING_ACCOUNT_ID>`.
:::

La exportación detallada indica el recurso al que corresponde cada costo; la estándar solo dice el servicio y la región. BigQuery factura la consulta: el primer 1 TiB al mes es gratuito, luego $6.25 por TiB, y un mes de una exportación ocupa de unos pocos megabytes a unos pocos gigabytes. Las recomendaciones de tipo de máquina y de recursos inactivos del Recommender se leen con **Compute Recommender Viewer**, que concede el comando de configuración, y no cuestan nada. Los compromisos de Compute Engine se listan desde Cloud Asset Inventory con **Cloud Asset Viewer**, que el comando de configuración ya concede: no hay nada más que dar.

## Facturado, amortizado y neto

Cada costo se guarda de tres maneras, y **Nube → Gasto → Costos**, los **Costos** de una cuenta, la vista general de Nube y los presupuestos muestran la que elijas:

- **Facturado** es cada cargo el día en que tu nube lo facturó, antes de créditos y reembolsos. Un Savings Plan o una reserva pagados por adelantado son un solo cargo grande el día de su compra, y el uso que cubren parece gratis el resto de su plazo.
- **Amortizado** reparte las tarifas de cada compromiso sobre los días y recursos que cubre, para que el dinero caiga donde se gastó. Sigue siendo antes de créditos y reembolsos. Es lo que muestran las páginas salvo que elijas otra.
- **Neto** es el amortizado, menos créditos, reembolsos y descuentos: lo que suma la factura.

| | Facturado | Amortizado | Neto |
|---|---|---|---|
| AWS | El costo no combinado (unblended) de Cost Explorer | El costo amortizado de Cost Explorer | El costo amortizado neto de Cost Explorer, con créditos y reembolsos |
| Azure | El costo real de Cost Management | El costo amortizado de Cost Management | El costo amortizado: Azure descuenta los créditos en la cuenta de facturación, que la conexión de una suscripción no lee |
| Google Cloud | El costo de la exportación | El costo menos los créditos de los descuentos por compromiso de uso y de las suscripciones | El costo menos todos los créditos |

El selector sobre las cifras cambia la base en la página, y OneUptime recuerda tu elección en este proyecto, en tu navegador. La base propia del proyecto, con la que se abren las páginas y que vigilan los presupuestos, está en **Nube → Ajustes → Ajustes de costos**. Un presupuesto puede vigilar una base propia: edítalo y define **Base de costo**.

Los costos leídos antes de que se guardaran los tres muestran su cifra facturada en cada base. Cada conexión vuelve a leer sus costos una vez, tan atrás como una primera lectura, para que cada base se complete.

## Formas de gastar menos

**Nube → Gasto → Ahorros** enumera cada recomendación, el mayor ahorro primero: qué hacer, en qué recurso, qué cambiaría y cuánto ahorra al mes. La franja de arriba las suma, en total y por tipo: un tamaño menor, un recurso inactivo, un compromiso. Una recomendación enlaza a la página de su recurso cuando OneUptime tiene el recurso, y una que OneUptime puede aplicar tiene **Aplicar**: consulta [Aplicar ahorros](#aplicar-ahorros).

### Ajuste de tamaño con las propias lecturas de OneUptime

Un recurso del que no se ocupa ningún recomendador, porque no está activado, no cubre su tipo o lo considera demasiado nuevo, lo dimensiona OneUptime con las lecturas de CPU y memoria que su conexión tomó en los últimos 14 días. OneUptime dimensiona instancias EC2, bases de datos RDS y clústeres de ElastiCache en AWS, máquinas virtuales, servidores flexibles de PostgreSQL y MySQL y planes de App Service en Azure, y máquinas virtuales de Compute Engine e instancias de Cloud SQL en Google Cloud:

- **Sobreaprovisionado** cuando el tamaño la mitad de grande, o una cuarta parte, aún tendría margen: en el tamaño menor, el percentil 95 de su CPU sería como mucho del 60 %, su lectura de CPU más alta como mucho del 100 % y el pico de su memoria como mucho del 70 %, cuando se lee su memoria.
- **Infraaprovisionado** cuando el percentil 95 de su CPU es del 85 % o más, o el pico de su memoria del 90 % o más: el tamaño el doble de grande.

Un recurso se dimensiona en cuanto tiene 6 días de lecturas. Su página muestra su **Ajuste de tamaño** junto a lo que cuesta, y uno sobreaprovisionado aparece en **Nube → Gasto → Ahorros**, con OneUptime como origen. Lo que ahorra un cambio es su parte de lo que el recurso costó en los últimos 30 días, así que se conoce en cuanto tu nube factura el recurso por su nombre: la exportación detallada de Azure y de Google Cloud lo hace, y AWS también una vez activado Costos por recurso. Una instancia EC2 solo informa de su memoria con el agente de CloudWatch, y una máquina virtual de Compute Engine solo con el Ops Agent: sin él, se dimensiona solo por su CPU. Los tamaños con ráfagas, como t3, la serie B y e2-micro, nunca se dimensionan.

### Compromisos

**Nube → Gasto → Ahorros** y los **Costos** de una cuenta muestran cuánto del gasto de los últimos 30 días pagaron los compromisos de cada cuenta, y cuánto de ellos se usó, una línea por tipo:

- AWS: Savings Plans e instancias reservadas, desde Cost Explorer. La cuenta de administración de una organización los lee para cada cuenta de la organización.
- Azure: planes de ahorro y reservas, desde Cost Management, en costo amortizado.
- Google Cloud: descuentos por compromiso de uso, desde tu exportación de facturación. La exportación no dice cuánto de un compromiso quedó sin usar, así que no se muestra cuánto se usa.

Una cuenta sin compromisos indica lo que se ejecutó a tarifas bajo demanda y que un compromiso pagaría a menor precio. Las cifras de cada tipo son las de su nube, y los tipos nunca se suman: una reserva y un Savings Plan pueden contar ambos el gasto de la misma máquina como suyo para cubrir. Cada compromiso por separado aparece en **Nube → Gasto → Compromisos**: consulta [Compromisos y renovaciones](#compromisos-y-renovaciones).

## Compromisos y renovaciones

**Nube → Gasto → Compromisos** lista cada Savings Plan, reserva y descuento por compromiso de uso que tus conexiones pueden leer, para que ninguno termine sin que lo notes:

- **Compromisos activos**, arriba, cuenta los activos y los que terminan en 90 días, **Utilización** cuánto de ellos se usó en los últimos 30 días y lo que quedó sin usar, y **Cobertura** cuánto del gasto cubren.
- **Terminan pronto** lista los que terminan en 90 días y no se renuevan solos, cada uno con su plan de renovación: qué comprar para conservar su descuento (su compromiso por hora o sus instancias, en la parte que se usó), cuánto cuesta y ahorra al mes, cuándo se amortiza y cuánto del gasto está cubierto ahora y cuando termine. **Renovar en la consola** abre la página donde tu nube lo renueva.
- **Todos los compromisos** es la lista completa: qué es y qué cubre cada uno, su cuenta, cuándo termina, su plazo y opción de pago, cuánto de él se usó en los últimos 30 días, y el uso que pagó y lo que ahorró.
- **Planes de compra** son lo que el recomendador de tu nube sugiere comprar, cada uno con lo que costaría y ahorraría al mes, cuándo se amortizaría y cómo cambiaría la cobertura. **Comprar en la consola** abre la página donde comprarlo.
- Debajo, los compromisos de cada cuenta por tipo, como los muestran sus **Costos**, y cuándo alertan los compromisos, con **Cambiar alertas**.

OneUptime solo planifica: nunca compra, renueva ni devuelve un compromiso. Tú compras en la consola de tu nube.

| | De dónde vienen los compromisos | Qué se sabe de cada uno |
|---|---|---|
| AWS | Los Savings Plans e instancias reservadas de Cost Explorer, cada uno con su propio uso, y la API de Savings Plans para los planes comprados, incluidos los que están en cola para empezar | Su fin, plazo, opción de pago, compromiso por hora o instancias, tarifas y uso en los últimos 30 y 7 días |
| Azure | Las reservas y los planes de ahorro del inquilino | Su fin, plazo, plan de facturación, si se renueva solo, y uso en los últimos 30 y 7 días |
| Google Cloud | Los compromisos de Compute Engine, desde Cloud Asset Inventory | Su fin, plan, recursos y si se renueva solo. Google Cloud no dice cuánto de un compromiso se usa |

La cuenta de administración de una organización lista los de cada cuenta en AWS. Los descuentos por compromiso de uso basados en el gasto, que Google Cloud guarda en la cuenta de facturación en lugar de en un proyecto, aún no se listan.

### Alertas de compromisos

Los compromisos generan alertas, que avisan por las políticas de guardia como cualquier alerta. En **Nube → Ajustes → Ajustes de costos**, **Alertas de compromisos** dice cuándo:

- **Alertar antes de que termine un compromiso**: 90, 30 y 7 días antes de su fin para empezar. Una alerta en el más cercano de esos días que el compromiso ha alcanzado, y cada uno más cercano sustituye al anterior. Un compromiso que se renueva solo, o cuya renovación está en cola para empezar cuando termine, no genera ninguna.
- **Alertar cuando la utilización sea inferior a**: 80 % para empezar, de los últimos 7 días de un compromiso, una vez que ha funcionado una semana. La alerta se resuelve cuando vuelve su uso.
- **Alertar cuando la cobertura baje de**: 60 % para empezar, del gasto que los compromisos de un tipo de una cuenta podrían cubrir, tras haber cubierto más. Se resuelve cuando vuelve la cobertura. Vacío, la cobertura no genera ninguna alerta.

**Alertar sobre compromisos** las desactiva todas, y **Gravedad de la alerta**, **Políticas de guardia** y **Propietarios** dicen lo graves que son, a quién se avisa y de quién son. Cada alerta dice qué cubre el compromiso y qué pagó, y apunta a su plan de renovación. Una alerta se resuelve sola cuando su compromiso termina, se renueva o deja de listarse.

## Aplicar ahorros

OneUptime aplica un ahorro a través de la conexión a la nube de la cuenta en cuanto su ajuste **Acciones de ahorro** lo permite: [Acciones de ahorro](/docs/telemetry/cloud-accounts#acciones-de-ahorro) explica qué concede cada opción. Solo hace cambios de un paso: detiene una instancia o base de datos inactiva, cambia un volumen gp2 a gp3, elimina un disco sin conectar, una instantánea antigua o una imagen sin uso, libera una dirección sin uso y, si lo permites, cambia el tamaño de una instancia o base de datos al recomendado. Nunca compra un compromiso: **Comprar en la consola** abre la página de tu nube para ello.

:::steps
### Selecciona Aplicar

En **Nube → Gasto → Ahorros**, selecciona **Aplicar** en un ahorro. El diálogo dice qué cambia, cuánto ahorra al mes, cómo se deshace o que no se puede, y quién lo aprueba.

### Un propietario lo aprueba

Lo aprueba una persona nombrada propietaria del recurso, o un miembro de un equipo que lo posee, que además pueda editarlo. Un recurso sin propietario lo aprueba un Propietario del proyecto o un Administrador del proyecto. Si puedes aprobarlo tú, **Aplicar** lo hace al momento, en tu nombre. Si no, espera en **Esperando aprobación** a que un propietario lo apruebe con **Aprobar** o lo descarte con **Descartar** y un motivo.

### OneUptime lo hace

El cambio se hace a través de la conexión y queda en las cronologías del recurso y de la cuenta, con quién lo aprobó. A un disco eliminado se le toma primero una instantánea final, salvo que desactives **Tomar primero una instantánea final**.
:::

Cada cambio dice cómo se deshace: **Deshacer** en **Cambios realizados** vuelve a iniciar una instancia detenida, devuelve un volumen o un tamaño a como estaba, o vuelve a crear un disco eliminado a partir de su instantánea final. Lo que elimina para siempre, como una instantánea, una imagen o una dirección liberada, no se puede deshacer, y el diálogo lo dice antes de que lo apliques. Donde el proyecto pide dos aprobaciones con **Exigir dos aprobaciones para correcciones más arriesgadas**, un cambio que no se puede deshacer necesita a dos personas.

Un recurso cuyas etiquetas dicen que se gestiona como código, por ejemplo con Terraform o CloudFormation, se cambia en su código: el diálogo ofrece **Abrir pull request** en el repositorio que lo declara, para que el siguiente apply no deshaga el ahorro.

### Demostrado por la factura

**Ahorrado este mes** solo cuenta lo que muestra la factura de tu nube. En cuanto tres días posteriores a un cambio se asientan en la factura, el costo por día del recurso se compara con la semana anterior al cambio: es **Visible en la factura** cuando el costo bajó al menos una cuarta parte de lo prometido, **No visible en la factura** cuando no, y **No se puede medir** cuando tu nube no factura el recurso por su nombre. **Revisando la factura** cuenta los cambios que aún esperan esos días.

## Programaciones fuera de horario

En **Nube → Gasto → Programaciones**, una programación detiene instancias y bases de datos no productivas fuera del horario laboral, y las vuelve a iniciar:

:::steps
### Elige los recursos

Indica la etiqueta de la nube que los elige, por ejemplo `Schedule` = `office-hours`, en una cuenta o en todas.

### Di cuándo funcionan

Elige los días laborables, la hora a la que se inician y la hora a la que se detienen, en formato de 24 horas, y la zona horaria.
:::

Cuando termina el horario laboral, una programación detiene, a través de la conexión de su cuenta, cada recurso en marcha que elige su etiqueta y que se sabe que no es de producción, y cuando empieza solo vuelve a iniciar lo que detuvo: un recurso que alguien detuvo a mano sigue detenido. **Ver recursos** enumera lo que elige ahora una programación y por qué deja alguno en marcha. Detiene instancias EC2 y bases de datos RDS en AWS, máquinas virtuales en Azure e instancias de Compute Engine en Google Cloud. AWS vuelve a iniciar por su cuenta una base de datos detenida durante siete días.

Una programación nunca detiene la producción, ni un recurso cuyo entorno nada indica. Se sabe que un recurso no es de producción cuando:

- una de sus etiquetas lo dice, con una clave como `environment`, `env`, `stage`, `tier` o `deployment.environment`, y una palabra como `dev`, `test`, `qa`, `staging` o `sandbox`;
- su cuenta está marcada como **No productivo** en **Entorno** de los **Ajustes** de la cuenta;
- o una de sus etiquetas de OneUptime lo dice, por ejemplo `Staging` o `env: dev`.

Gana la producción: una etiqueta que dice `prod`, `production` o `live`, o una cuenta marcada como **Producción**, mantiene un recurso en marcha diga lo que diga lo demás. Para ello nunca se lee el nombre de un recurso. Desactiva una programación y ya no detiene nada, y vuelve a iniciar lo que detuvo cuando empieza su horario laboral; elimínala y lo que detuvo se inicia al momento.

## Reglas de IA para ahorros

Con **Habilitar IA** activado, OneUptime AI propone a los propietarios del recurso cada ahorro que puede aplicar después de cada lectura de los ahorros de la cuenta, y ellos lo aprueban o lo descartan en **Esperando aprobación**. En **Nube → Ajustes → Reglas de IA para ahorros**, una regla dice qué hace OneUptime AI con los ahorros que coinciden con ella, según el tipo de cambio, el entorno del recurso y su nube: **Desactivado**, **Proponer al propietario** o **Actuar sin preguntar**, hasta un límite mensual. Sin reglas, cada ahorro se propone y ninguno se aplica; con reglas, solo lo que coincide con una regla, y entre las reglas que coinciden gana la más prudente.

Una regla solo actúa sin preguntar sobre un recurso que se sabe que no es de producción, solo con un cambio que se puede deshacer, solo hasta el límite más pequeño de las reglas que coinciden, y como mucho 10 veces por hora en un proyecto: todo lo demás se propone. Un cambio hecho sin preguntar queda en las cronologías con la regla que lo hizo, y sus propietarios pueden deshacerlo. Un ahorro descartado o deshecho no se vuelve a proponer durante 30 días.

## Presupuestos

:::steps
### Crear un presupuesto

En **Nube → Gasto → Presupuestos**, crea un presupuesto: su **Importe mensual**, la **Cuenta** a la que se aplica, o ninguna para todas las cuentas, y la **Base de costo** que cuenta, o ninguna para la del proyecto.

### Elegir cuándo alerta

**Alertar en** recibe las partes del presupuesto en las que alertar, en porcentaje: 80 y 100 para empezar. **Alertar si va camino de superarse** también alerta, una vez al mes, cuando el ritmo de la última semana llevaría el mes por encima del presupuesto. **Alertar en días inusuales** también alerta el día después de un día que costó mucho más de lo habitual: consulta [Días inusuales](#días-inusuales). **Gravedad de la alerta** y **Políticas de guardia** dicen lo graves que son las alertas y a quién se avisa.
:::

Un presupuesto se comprueba tras cada lectura de los costos y cada hora. Cuando el gasto del mes supera un umbral, se genera una alerta por él, la más alta si una lectura supera varios a la vez, y un nuevo mes resuelve las alertas del mes pasado. Un presupuesto solo cuenta las cuentas que se facturan en su moneda, sobre su base: un presupuesto amortizado no se dispara por un compromiso pagado por adelantado, que uno facturado cuenta el día de su compra.

Los agentes de IA pueden crear y cambiar presupuestos a través del [servidor MCP](/docs/ai/mcp-server), y los scripts con el comando `oneuptime cloud-budget` de la CLI: consulta [Operaciones de recursos](/docs/cli/resource-operations).

### Días inusuales

Tras cada lectura, cada uno de los últimos 14 días completos de una cuenta se compara con los 14 días anteriores. Un día es inusual cuando un servicio costó el doble de su día habitual o más, o la cuenta entera una vez y media su día habitual o más. En ambos casos debe ser al menos 10 más de lo habitual, en la moneda de la cuenta, y al menos el 5 % del día habitual de la cuenta, para que unos centavos nunca cuenten como un pico. Lo habitual de un día es la mediana de los 14 días anteriores, así que un pico aislado apenas lo mueve, y una cuenta solo se juzga cuando tiene una semana de costos.

**Nube → Gasto → Costos** marca los días inusuales en el gasto diario, sobre sus barras, y los muestra debajo. Sobre todas las cuentas, cada marca abre los **Costos** de su cuenta. Un presupuesto que incluye la cuenta genera una alerta por cada cuenta y día, al día siguiente, que nombra cada servicio que se disparó. Un pico que dura varios días se avisa el día en que empezó, y un día de hace más de una semana no se avisa. Un presupuesto creado antes de que existieran estas alertas no las genera hasta que lo edites y las actives.

## Adónde va el dinero

**Nube → Gasto → Costos** desglosa el gasto de un periodo por servicio, región, cuenta o recurso, y de tres formas más:

- Por entorno de plataformas de aplicaciones: el servicio de plataforma de cada entorno en su cuenta y región, como Amazon ECS o Cloud Run, y los recursos de un entorno de Elastic Beanstalk por la etiqueta que AWS les pone.
- Por aplicación: lo que una plataforma factura a una aplicación por su nombre, como un servicio de Cloud Run o una Container App. Amazon ECS factura sus tareas y App Service sus planes, así que los costos de sus aplicaciones quedan en su entorno.
- Por etiqueta: cada valor de la etiqueta que elijas. Un costo conserva las etiquetas que tenía al leerse: las etiquetas de una exportación de facturación de Google Cloud o, si no, las del recurso al que se factura, lo que en AWS necesita Costos por recurso.

Debajo de la lista, la tarjeta dice a cuánto ascendió el resto: lo que no está en ningún entorno, lo que se factura a un entorno en conjunto o lo que no tiene la etiqueta. Los costos leídos antes de que se guardaran las etiquetas se vuelven a leer una vez, tan atrás como una primera lectura, para que se completen sus etiquetas.

## Informes y exportaciones

### Informes de costos

**Nube → Gasto → Informes** envía según una programación lo que cuestan las nubes, por correo y a canales de Slack o Microsoft Teams, para que quienes necesitan las cifras las reciban sin abrir OneUptime. Un informe tiene:

- **Cubre**: todas las cuentas, una cuenta, un grupo de costos o una vista de costos con todos sus grupos.
- **Periodo**: la semana pasada (de lunes a domingo), el mes pasado o el mes en curso. Cada uno se compara con el período anterior: la semana anterior, el mes anterior o el mes pasado hasta el mismo día.
- **Base de costo**: facturado, amortizado o neto. Vacío, es la del proyecto, con la que se abre Costos. El informe siempre dice en qué base está.
- **Programación**: cada semana o cada mes, un día y a una hora en una zona horaria, con las mismas reglas que los resúmenes de Slack y Microsoft Teams. Un informe semanal nuevo sale el próximo lunes a las 09:00 en tu zona horaria, uno mensual el día 1, y los informes siguientes mantienen ese día y esa hora todo el año.

El correo dice lo que costó el período frente al período anterior, los presupuestos a los que cuenta (cada mes en curso, en la base propia del presupuesto), los servicios que más subieron y más bajaron, los grupos de una vista de costos y lo que ningún grupo asume, los días inusuales, los mayores ahorros pendientes y cuánto del gasto cubren los compromisos. Sus cifras van adjuntas en CSV. **Abrir Costos** abre **Costos** exactamente en los días, la base y la vista del informe, para que las cifras del informe y las de la página sean las mismas. Las cuentas facturadas en otra moneda quedan fuera de las cifras, y el informe las nombra.

Un canal de Slack o Microsoft Teams recibe un mensaje breve: el total y su cambio, el presupuesto, las primeras líneas de las listas del informe y **Abrir Costos**.

### Quién recibe un informe

- Las personas y los equipos del proyecto lo reciben por correo, según sus ajustes de notificaciones, donde cada persona puede desactivar los informes de costos de nube. Cada persona recibe las cifras que puede leer: alguien cuyo acceso está limitado por etiquetas recibe solo sus cuentas, y alguien que ya no puede leer los costos de nube del proyecto queda fuera.
- Las **Direcciones de correo** fuera del proyecto, como la de tu contable, y los canales de Slack y Microsoft Teams requieren el permiso Administrador de la nube, o Administrador del proyecto o Propietario del proyecto, porque OneUptime no puede saber quién los lee. Reciben el informe tal como puede leerlo la persona que los añadió, y dejan de recibirlo si esa persona pierde el permiso. Una clave de API no puede definirlos.
- Quien puede crear los demás registros de Nube, desde Miembro de la nube, puede crear, cambiar y eliminar informes. Un Visor de la nube puede leerlos.

Un informe llega como máximo a 200 personas, 25 direcciones y 10 canales de cada tipo. **Último envío** dice cuándo salió por última vez, y a quién dejó fuera y por qué.

### Una sección para cada equipo

Un informe de una vista de costos puede enviar a cada grupo su propia sección con **Enviar a cada equipo de grupo su sección**. Los miembros del equipo de cada grupo, indicado en el grupo, reciben el gasto de su grupo frente al período anterior, los servicios que más subieron y bajaron en él y sus días inusuales. Un grupo compartido no tiene sección propia: sus costos están en los grupos entre los que se reparte. Las personas, equipos y direcciones del propio informe reciben todos los grupos. Quien está en los equipos de dos grupos recibe ambas secciones. Un informe mensual de una vista de costos así es el showback del mes.

### Vista previa y Enviarme una copia

**Vista previa** muestra lo que dice un informe ahora, tal como puedes leerlo y como lo presenta el correo, y a quién dejó fuera su último envío y por qué. **Enviarme una copia** te lo envía por correo ahora.

### Descargar CSV

**Descargar CSV** guarda lo que muestra una tarjeta: **Adónde va el dinero** en **Costos**, en cualquier desglose y frente al período anterior, el gasto de cada día, las recomendaciones de **Ahorros** y la página de un grupo de costos. El nombre del archivo dice lo que contiene, por qué se desglosa, la vista y la cuenta, la base de costo y los días, por ejemplo `cloud-costs-by-service-amortized-2026-11-01-to-2026-11-30.csv`. Las cifras son números simples, y un texto que una hoja de cálculo leería como una fórmula empieza con un apóstrofo.

### FOCUS

**Exportar FOCUS** en **Costos** descarga cada costo del período como un archivo FOCUS 1.2, la FinOps Open Cost and Usage Specification en su versión 1.2, que leen las herramientas financieras. Un archivo contiene como máximo 93 días, y cada moneda en la que se facturan las cuentas, cada fila en la suya.

El archivo tiene cada columna que FOCUS 1.2 hace obligatoria, y las condicionales para las que OneUptime tiene los datos: `RegionId`, `RegionName`, `ResourceId`, `ResourceName`, `SubAccountId`, `SubAccountName` y `Tags`. Tiene una fila por cada costo que OneUptime guarda: un día, una cuenta, un servicio, una región y, donde la nube lo nombra, un recurso.

- `BilledCost` es lo que facturó la nube, y `EffectiveCost` lo que costó con los compromisos repartidos sobre lo que cubren.
- Lo que la nube descontó, sus créditos, reembolsos y descuentos, es una fila propia, con una `ChargeCategory` de `Credit`. El `EffectiveCost` del archivo, sumado, es el costo neto.
- `ChargeCategory` es `Tax` para los costos que AWS factura bajo su servicio Tax, y `Usage` para el resto.
- `BillingAccountId` es la cuenta de la que la conexión lee la factura: la cuenta de administración de una organización de AWS, una cuenta de facturación de Google Cloud o la suscripción de Azure, ya que la cuenta de facturación de Azure no se lee. `SubAccountId` es la cuenta de AWS, la suscripción de Azure o el proyecto de Google Cloud.
- Las fechas son días UTC enteros, sin incluir el final del período del cargo ni el del período de facturación. El período de facturación es el mes natural.

Lo que FOCUS 1.2 pide y OneUptime no lee queda vacío o se iguala como la especificación lo permite. `PricingQuantity` y `PricingUnit` quedan vacíos, porque los costos se leen por día, servicio, región y recurso, no por tipo de uso. `ListCost` y `ContractedCost` son iguales a `BilledCost`, como pide FOCUS cuando no se conocen los precios unitarios. Una compra, como el pago por adelantado de una reserva, es el uso del servicio para el que se compró. No hay columnas de SKU, descuentos por compromiso, reservas de capacidad ni facturas. FOCUS 1.3 y 1.4 añaden columnas de las que prescinde un lector de 1.2.

### Desde la API y la CLI

La API responde con un desglose, no solo con las filas de los costos, para que un sistema financiero pueda traer la refacturación del mes:

- `POST /api/cloud-cost/breakdown` con `by` (`service`, `region`, `account`, `resource`, `environment`, `app`, `tag` con una `tagKey`, o `group` con un `cloudCostViewId`), un `period` (`this-month`, `last-month`, `last-week`, `last-30-days`) o una `startDate` y una `endDate`, y de forma opcional `cloudAccountIds`, `currency`, `basis` y `compareWithPrevious`. Responde con el total del período y cada parte, con el período anterior al lado, o con `"format": "csv"` el CSV que da **Descargar CSV**.
- `POST /api/cloud-cost/export` con un `period`, o una `startDate` y una `endDate`, responde con el archivo FOCUS.

Ambas leen como la clave puede leer los costos. Desde la [CLI](/docs/cli/command-reference):

```bash
oneuptime cloud-cost breakdown --by group --view <view-id> --period last-month
oneuptime cloud-cost export --period last-month --file focus.csv
```

### En un panel

El widget **Costo de nube** pone un total, un desglose o una tendencia del gasto junto a los servicios que lo generan. Consulta [Widgets del panel](/docs/dashboards/widgets#costos-de-nube).

## Qué ves en OneUptime

- **La vista general de Nube.** **Nube → Vista general** muestra el gasto del mes frente al del mes pasado hasta el mismo día, los servicios que más cuestan y las mayores formas de gastar menos, junto a lo que necesita atención.
- **El gasto de cada día.** **Nube → Gasto → Costos** dibuja cada uno de los últimos 30 días con los días que costaron mucho más de lo habitual marcados, muestra esos días y desglosa un periodo por servicio, región, cuenta, recurso, entorno de plataformas de aplicaciones, aplicación o etiqueta, facturado, amortizado o neto. Las cuentas cuyos costos no se leen aparecen debajo, cada una con el motivo.
- **Cada compromiso.** **Nube → Gasto → Compromisos** lista cada uno con cuándo termina y cuánto de él se usa, los que terminan pronto con qué renovar, y qué comprar.
- **Informes.** **Nube → Gasto → Informes** lista cada informe programado con lo que cubre, cuándo sale la próxima vez y cómo fue su último envío.
- **Los costos de una cuenta.** Los **Costos** de una cuenta muestran lo mismo solo para la cuenta, con sus compromisos y sus formas de gastar menos.
- **El costo de un recurso.** La página de un recurso muestra lo que costó este mes y en los últimos 30 días cuando su nube lo factura por su nombre, con sus formas de gastar menos y su ajuste de tamaño.
- **Lo que se ahorró.** **Nube → Gasto → Ahorros** empieza por lo que ahorraron este mes los cambios realizados, según la factura, los cambios que esperan aprobación y los realizados, y las horas durante las que las programaciones detuvieron recursos.

## Solución de problemas

:::details Una cuenta dice Necesita permiso
La conexión todavía no puede leer los costos de la cuenta. Vuelve a ejecutar su comando de configuración desde **Nube → Conectar**: añade lo que necesita leer los costos. En Google Cloud, da también a la cuenta de servicio **BigQuery Data Viewer** en el conjunto de datos de la exportación.
:::

:::details Una cuenta dice Sin configurar
Su nube todavía no tiene costos que dar. En AWS, activa Cost Explorer; en Google Cloud, indica la tabla de la exportación en **Tabla de la exportación de facturación**. Las primeras cifras llegan con la siguiente lectura, en menos de 12 horas.
:::

:::details Una cuenta dice En cola
Sus costos esperan su turno: Azure Cost Management limita la rapidez con la que se leen los costos de un inquilino. La cuenta dice cuándo se leen, en la primera lectura de la conexión a partir de entonces, y no hay nada que hacer. Una cuenta que ya tiene cifras las conserva mientras tanto.
:::

:::details Costos por recurso dice Sin configurar
Los datos a nivel de recurso no están activados para la cuenta. Actívalos con granularidad diaria en las preferencias de Cost Management de la consola AWS Billing and Cost Management, desde la cuenta de administración de la organización para sus miembros. AWS los prepara en 48 horas, y la lectura del día siguiente los toma.
:::

:::details Los compromisos dicen Necesita permiso
La conexión aún no puede leer los Savings Plans ni las reservas de la cuenta. Vuelve a ejecutar su comando de configuración desde **Nube → Conectar**: añade las acciones con las que se leen. En Azure, un administrador global con acceso elevado concede **Reservations Reader** y **Savings plan Reader**: consulta [Microsoft Azure](#microsoft-azure).
:::

:::details Amortizado y neto muestran lo mismo que facturado
Los costos leídos antes de que se guardaran los tres muestran su cifra facturada en cada base hasta la siguiente lectura de costos de la conexión, que los vuelve a leer tan atrás como la primera. En Azure, el neto es siempre el costo amortizado.
:::

:::details Un compromiso termina y no llegó ninguna alerta
Un compromiso que se renueva solo, o cuya renovación está en cola para empezar cuando termine, no genera ninguna, y tampoco uno de un proyecto cuyas alertas de compromisos están desactivadas en **Nube → Ajustes → Ajustes de costos**. Una alerta también necesita que el proyecto tenga una gravedad de alerta.
:::

:::details Las cifras dejan fuera una cuenta
Las cifras están en la moneda en que se factura la mayoría de tus cuentas. Una cuenta facturada en otra aparece debajo con su moneda, y un presupuesto solo cuenta las cuentas facturadas en la suya.
:::

:::details Un ahorro no tiene Aplicar
OneUptime solo hace cambios de un paso: un compromiso, o una recomendación que cambia más de una cosa, se hace en la consola de tu nube. Aplicar abre un diálogo que dice por qué no se puede hacer desde aquí cuando la conexión de la cuenta no lo permite: activa sus **Acciones de ahorro** y vuelve a ejecutar su comando de configuración.
:::

:::details Una programación deja un recurso en marcha
**Ver recursos** dice por qué: es de producción, nada indica que no sea de producción, o la conexión de su cuenta no permite acciones de ahorro. Etiquétalo, por ejemplo `environment` = `dev`, o marca su cuenta como **No productivo**.
:::

:::details Este mes es más bajo que en la consola de tu nube
Tu nube informa del último día o dos con retraso, y las cifras facturadas y amortizadas son antes de créditos y reembolsos. Las siguientes lecturas se ponen al día. Compara con la base que muestra la consola de tu nube: AWS se abre en los costos no combinados, que son los facturados.
:::

## Próximos pasos

:::cards
- [Asignación de costos de la nube](/docs/telemetry/cloud-cost-allocation): Reparte el gasto entre equipos, productos y centros de costo.
- [Conectar una cuenta en la nube](/docs/telemetry/cloud-accounts): Conecta otra cuenta o vuelve a ejecutar su comando.
- [Recursos en la nube](/docs/telemetry/cloud-resources): Las métricas de cada recurso, desde un recopilador propio.
- [Observabilidad de costos de Kubernetes](/docs/telemetry/kubernetes-cost): Lo que cuesta cada carga de trabajo de Kubernetes.
:::
