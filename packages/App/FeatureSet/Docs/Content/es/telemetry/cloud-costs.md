# Costos y ahorros en la nube

Una cuenta en la nube conectada también dice cuánto cuesta y cómo podría costar menos. OneUptime lee los costos de cada día de la propia facturación de tu nube y las recomendaciones del propio recomendador de tu nube, los muestra en **Nube → Gasto → Costos** y **Nube → Gasto → Ahorros**, lista tus Savings Plans, reservas y descuentos por compromiso de uso en **Nube → Gasto → Compromisos**, te avisa en **Nube → Gasto → Presupuestos** antes de que un mes, un trimestre o un año cueste más que su presupuesto, y prevé los próximos meses en **Nube → Gasto → Previsión**. Si lo permites, también aplica los ahorros que aprueba un propietario, detiene los recursos no productivos fuera del horario laboral y comprueba cada cambio con la factura.

:::cards
- [Amazon Web Services](#amazon-web-services): Cost Explorer y Cost Optimization Hub, cada uno activado una vez.
- [Microsoft Azure](#microsoft-azure): Cost Management y Azure Advisor, con un rol más.
- [Google Cloud](#google-cloud): Tu exportación de facturación a BigQuery y el Recommender.
- [Facturado, amortizado y neto](#facturado-amortizado-y-neto): Cada costo de tres maneras, para que los compromisos y los créditos caigan donde fue el dinero.
- [Compromisos y renovaciones](#compromisos-y-renovaciones): Cada compromiso, alertas antes de que termine uno o mientras se usa poco, y qué renovar o comprar.
- [Aplicar ahorros](#aplicar-ahorros): Aplica un ahorro con la aprobación de su propietario, y deshazlo.
- [Programaciones fuera de horario](#programaciones-fuera-de-horario): Detén los recursos no productivos por la noche y los fines de semana.
- [Reglas de IA para ahorros](#reglas-de-ia-para-ahorros): Propuestas para los propietarios, o cambios dentro de un límite.
- [Presupuestos](#presupuestos): El presupuesto de un mes, un trimestre o un año para cualquier cuenta, grupo de costos o servicio.
- [Previsiones](#previsiones): Lo que los próximos 12 meses van camino de costar, y con qué certeza.
- [Etiquetas obligatorias](#etiquetas-obligatorias): Qué parte de tu gasto lleva las etiquetas que exiges, y los recursos nuevos que no las llevan.
:::

## Cómo funciona

```mermaid title="De la facturación de tu nube a las páginas de Nube"
flowchart TB
    bill["Facturación de tu nube,<br/>leída dos veces al día"] --> costs["Costos"]
    rec["Recomendador de tu nube,<br/>leído una vez al día"] --> savings["Ahorros"]
    costs --> budgets["Presupuestos que alertan"]
    costs --> forecast["Previsiones"]
    forecast --> budgets
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

Un recurso se dimensiona en cuanto tiene 6 días de lecturas. Su página muestra su **Ajuste de tamaño** junto a lo que cuesta, y uno sobreaprovisionado aparece en **Nube → Gasto → Ahorros**, con OneUptime como origen. Lo que ahorra un cambio es su parte de lo que el recurso costó en los últimos 30 días, así que se conoce en cuanto tu nube factura el recurso por su nombre: la exportación detallada de Azure y de Google Cloud lo hace, y AWS también una vez activado Costos por recurso. Los tamaños con ráfagas, como t3, la serie B y e2-micro, nunca se dimensionan.

Tu nube solo lee la memoria de una máquina virtual con un agente propio dentro de ella: el agente de CloudWatch en una instancia EC2, el Ops Agent en una máquina virtual de Compute Engine, y ninguno en una máquina virtual de Azure, que informa de la memoria libre en lugar de la usada. Una máquina virtual en la que se ejecuta [el recolector de host de OneUptime](/docs/telemetry/hosts) se dimensiona en cambio con la memoria que lee el recolector de host:

- **La máquina virtual y el host son una misma máquina** cuando coinciden el proveedor, la cuenta, la región y el ID de instancia: el ID de la instancia EC2, el ID numérico de una máquina virtual de Compute Engine o el `vmId` de una máquina virtual de Azure. Un nombre de host por sí solo nunca basta, y una máquina virtual que reclaman dos hosts, como una máquina clonada, no se vincula a ninguno. La página de la máquina virtual nombra su host, y la del host nombra su máquina virtual, cada una con un enlace a la otra.
- **La memoria es la memoria usada del host, sin caché ni búferes**, la cifra que grafica la página del host, en los mismos 14 días. Una caché de archivos ocupada nunca se lee como una máquina llena. El host también necesita 6 días de lecturas.
- **Cuando ambos leen la memoria**, como en una máquina virtual de Compute Engine con el Ops Agent y el recolector de host, se usa el que tiene más lecturas. La CPU es siempre la lectura de tu nube.

El **Ajuste de tamaño** de la máquina virtual dice de dónde salió su memoria, y también su línea en **Nube → Gasto → Ahorros**. Una máquina virtual dimensionada solo por su CPU lo indica, con un enlace para instalar el recolector de host. El recolector de host marca la identidad de su nube con el paso `resourcedetection/cloud` que incluye [la configuración de la guía de hosts](/docs/telemetry/host-otel-collector). Un host con la configuración predeterminada de OneUptime recibe el paso con la próxima versión de OneUptime, y uno con una configuración propia necesita añadirlo. Los nodos de Kubernetes quedan para la [Observabilidad de costos de Kubernetes](/docs/telemetry/kubernetes-cost), que dimensiona las solicitudes de lo que se ejecuta en ellos.

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

En **Nube → Gasto → Presupuestos**, crea un presupuesto y elige a qué **Se aplica a**: todas las cuentas, una **Cuenta**, un **Grupo de costos** según sus reglas reparten el gasto, o los servicios, regiones y etiquetas que nombra un **Filtro**, escrito como las reglas de un grupo de costos. Deja vacía su **Base de costo** para contar la del proyecto.

### Indica cuánto puede costar

Su **Periodo** es un mes, un trimestre o un año, y su **Importe** es lo que puede costar un periodo. Los trimestres y los años empiezan en el **Primer mes del año**: desde abril, un año va de abril a marzo. El **Plan presupuestario** de un año puede repartir su importe por igual entre sus meses, o dar a cada mes el suyo en un **Plan mensual**. Así cada mes se ajusta a su propia parte, y un mes tranquilo nunca recibe alertas por el gasto de un mes con mucha actividad.

### Elegir cuándo alerta

**Alertar en** toma las partes del presupuesto en las que actuar, en porcentaje: 80 y 100 para empezar. **Alertar si va camino de superarse** también alerta, una vez por periodo, cuando el periodo va camino de costar más que el presupuesto. **Alertar en días inusuales** también alerta el día después de un día que costó mucho más de lo habitual: consulta [Días inusuales](#días-inusuales). **Gravedad de la alerta** indica la gravedad de sus alertas.

### Elige a quién se informa

Las personas y equipos de **Notificar** reciben aviso por correo electrónico y chat cuando el gasto supera una parte por debajo del 100%, sin alerta, así que no se avisa a nadie de guardia por un gasto dentro del presupuesto. **Informar al equipo del grupo de costos** informa también al equipo al que pertenece el grupo de costos. Desde el 100% se crea una alerta, son sus propietarios, y se avisa a las **Políticas de guardia**. Un presupuesto sin nadie a quien informar crea una alerta en cada parte.
:::

Un presupuesto se comprueba tras cada lectura de los costos y cada hora. Cuando el gasto del periodo supera una parte, se informa a las personas que notificar, o desde el 100% se crea una alerta, una vez para la más alta cuando una lectura supera varias a la vez, y un periodo nuevo resuelve las alertas del anterior. Un año dividido por meses se comprueba mes a mes, frente a la parte de ese mes. Un presupuesto solo cuenta las cuentas facturadas en su moneda, en su base: un presupuesto amortizado no se dispara por un compromiso comprado por adelantado, que un presupuesto facturado cuenta el día en que se compró.

Un periodo va camino de superar el presupuesto cuando lo que ha costado hasta ahora, el resto de este mes al ritmo de la última semana completa y los meses siguientes de un trimestre o un año según la [previsión](#previsiones) suman más que el presupuesto.

La fila de cada presupuesto dice lo que cuenta, su periodo y el periodo hasta ahora: en un año dividido por meses, este mes frente a su parte, con el año al lado. Su página muestra el periodo mes a mes frente a la parte de cada mes, este mes día a día, lo que más costó y quién se entera. La página de un presupuesto anual puede guardar su previsión como su plan.

Los agentes de IA pueden crear y cambiar presupuestos a través del [servidor MCP](/docs/ai/mcp-server), y los scripts con el comando `oneuptime cloud-budget` de la CLI: consulta [Operaciones de recursos](/docs/cli/resource-operations).

### Días inusuales

Tras cada lectura, cada uno de los últimos 14 días completos de una cuenta se compara con los 14 días anteriores. Un día es inusual cuando un servicio costó el doble de su día habitual o más, o la cuenta entera una vez y media su día habitual o más. En ambos casos debe ser al menos 10 más de lo habitual, en la moneda de la cuenta, y al menos el 5 % del día habitual de la cuenta, para que unos centavos nunca cuenten como un pico. Lo habitual de un día es la mediana de los 14 días anteriores, así que un pico aislado apenas lo mueve, y una cuenta solo se juzga cuando tiene una semana de costos.

**Nube → Gasto → Costos** marca los días inusuales en el gasto diario, sobre sus barras, y los enumera debajo. Sobre todas las cuentas, cada marca abre los **Costos** de su cuenta. Un presupuesto mensual para todas las cuentas o una crea una alerta por cada cuenta y día, al día siguiente, nombrando cada servicio que subió. Cualquier otro presupuesto compara lo que cuenta con su propio día habitual de la misma manera. Un pico que dura varios días se informa el día en que empezó, y un día de hace más de una semana no se informa. Un presupuesto creado antes de estas alertas no las crea hasta que lo editas y las activas.

## Previsiones

**Nube → Gasto → Previsión** dice lo que el gasto va camino de costar en cada uno de los próximos 12 meses, para todo, una cuenta, un grupo de costos o un servicio, en la base de costo que elijas. Dice cómo se hace cada previsión, a partir de los meses completos de costos que guarda OneUptime, un año o algo más:

- **Este mes** es lo que ha costado hasta ahora, con cada día que queda a la media de los últimos siete días completos, como lo proyecta un presupuesto.
- **Con menos de 3 meses completos**, cada mes siguiente prolonga ese ritmo, sin rango probable: se ha leído demasiado poco para distinguir una tendencia de un pico aislado.
- **Desde 3 meses completos**, una tendencia pasa por el día medio de cada mes: la mediana de las pendientes entre cada dos meses, así que un mes raro apenas la mueve.
- **Desde 12 meses completos**, cada mes del calendario guarda además cuánto estuvo por encima o por debajo de la tendencia el año pasado, así que un pico de diciembre también se prevé para el diciembre siguiente.

Cada mes siguiente tiene un rango probable, donde debería caer 8 de cada 10 veces, según cuánto se alejaron los meses pasados de su tendencia, y nunca más estrecho que un 5% a cada lado. Se ensancha cuanto más lejos está un mes y cuantos menos meses tiene la previsión detrás. Desde 12 meses completos, cada rango es aún más ancho, porque un año muestra cada mes del calendario una sola vez. Una previsión no es una promesa: un servicio nuevo, una migración o un cambio de precio mueven los próximos meses de formas que ningún mes pasado muestra.

**Simulación** hace crecer o decrecer cada mes siguiente desde el mes que elijas, en la parte que escribas, como un 20% desde enero. **Guardar como plan presupuestario** convierte los próximos doce meses en el plan de un presupuesto anual, en uno nuevo o en uno que ya tengas, con cada mes ajustado a su parte prevista.

## Presupuestos y previsiones en la API

Los presupuestos son un recurso de la API (`cloud-budget`), con comandos de CLI y herramientas MCP como todo recurso. El `scope` de un presupuesto es `allAccounts`, `account` (con `cloudAccountId`), `costGroup` (con `cloudCostGroupId`) o `filter` (con `filterRules`, escrito como las reglas de un grupo de costos). Su `period` es `month`, `quarter` o `year`, desde `fiscalYearStartMonth`, de 1 a 12. El `planSplit` de un año es `none`, `equal` o `byMonth`, con sus doce meses en `monthlyPlan`, en el orden del año fiscal.

Para leer el periodo de un presupuesto mes a mes, los días de este mes y lo que más costó, como hace su página:

```bash
curl -X POST "https://oneuptime.com/api/cloud-budget/<budget ID>/spend" \
  -H "apikey: <API key>" -H "tenantid: <project ID>"
```

Para prever un alcance, de 1 a 24 meses vista, con una simulación opcional:

```bash
curl -X POST "https://oneuptime.com/api/cloud-budget/forecast" \
  -H "apikey: <API key>" -H "tenantid: <project ID>" -H "Content-Type: application/json" \
  -d '{"scope": "costGroup", "cloudCostGroupId": "<group ID>", "monthsAhead": 12, "growth": {"percent": 20, "fromMonth": "2027-01"}}'
```

El `forecast` de la respuesta tiene su `method` (`pace`, `trend` o `trendAndSeason`), los meses de los que se hizo y cada mes con su `amount` y, en los siguientes, su `low` y su `high`. Envía `basis` como `billed`, `amortized` o `net` para prever en esa base; sin él, la previsión está en la del proyecto, y el `basis` de la respuesta dice cuál. El gasto de un presupuesto está en su propia base.

## Adónde va el dinero

**Nube → Gasto → Costos** desglosa el gasto de un periodo por servicio, región, cuenta o recurso, y de tres formas más:

- Por entorno de plataformas de aplicaciones: el servicio de plataforma de cada entorno en su cuenta y región, como Amazon ECS o Cloud Run, y los recursos de un entorno de Elastic Beanstalk por la etiqueta que AWS les pone.
- Por aplicación: lo que una plataforma factura a una aplicación por su nombre, como un servicio de Cloud Run o una Container App. Amazon ECS factura sus tareas y App Service sus planes, así que los costos de sus aplicaciones quedan en su entorno.
- Por etiqueta: cada valor de la etiqueta que elijas. Un costo conserva las etiquetas que tenía al leerse: las etiquetas de una exportación de facturación de Google Cloud o, si no, las del recurso al que se factura, lo que en AWS necesita Costos por recurso.

Debajo de la lista, la tarjeta dice a cuánto ascendió el resto: lo que no está en ningún entorno, lo que se factura a un entorno en conjunto o lo que no tiene la etiqueta. Los costos leídos antes de que se guardaran las etiquetas se vuelven a leer una vez, tan atrás como una primera lectura, para que se completen sus etiquetas.

## Etiquetas obligatorias

El gasto solo está bien repartido si lleva las etiquetas correctas. En **Nube → Gasto → Etiquetas**, indica qué etiquetas debe llevar cada recurso, como `team`, `env` y `cost-center`, y ve qué parte de tu gasto y de tus recursos las lleva, qué recursos no, y quién creó cada recurso nuevo sin ellas.

:::steps
### Exigir una etiqueta

Elige **Exigir una etiqueta** e introduce su **Clave de la etiqueta**. En **Valores permitidos**, enumera los valores que puede tomar, separados por comas, o déjalo vacío para aceptar cualquier valor. Elige una **Cuenta** para exigir la etiqueta solo en esa cuenta. Una **Descripción**, en **Más campos**, dice en los correos para qué sirve la etiqueta.

### Leer la cobertura

La página empieza con qué parte del gasto de los últimos 30 días y de tus recursos lleva todas las etiquetas obligatorias. Debajo están los recursos a los que les falta una etiqueta, los más costosos primero, luego cada etiqueta por separado, la tendencia de las últimas 12 semanas y cada cuenta.

### Etiquetar lo que falta

Cada recurso al que le falta una etiqueta muestra el valor que sugiere OneUptime y el comando que lo aplica en tu nube. Un recurso declarado en código dice qué código lo declara: añade la etiqueta ahí, o el próximo despliegue la volverá a quitar.
:::

- **Las claves coinciden sin importar mayúsculas.** `Team`, `team` y `TEAM` son una sola clave, y un recurso lleva la etiqueta cuando cualquier forma de escribirla tiene un valor permitido. Los valores también coinciden sin importar mayúsculas, y un valor vacío no es un valor.
- **Un valor permitido puede ser un patrón.** `*` representa cualquier serie de caracteres y `?` uno solo, así que `prod-*` acepta `prod-eu` y `prod-us`. Los patrones no son expresiones regulares.
- **Etiquetas propias de una cuenta.** Una etiqueta exigida en una cuenta sustituye allí a la etiqueta del proyecto con la misma clave, y una cuenta puede exigir una clave propia. Las **Etiquetas** de una cuenta muestran ambas.
- **No se cambia nada en tu nube.** OneUptime nunca detiene ni etiqueta un recurso por una etiqueta que falta. Avisa a las personas y sugiere el valor.

### Cobertura

- **Gasto etiquetado** es la parte de los costos de los últimos 30 días que lleva todas las etiquetas obligatorias, según las etiquetas con que se leyó cada costo. Se calcula cada vez que abres la página, así que una etiqueta que exiges hoy también se mide en los últimos 30 días. Los costos de AWS solo llevan etiquetas una vez activado [Costos por recurso](#costos-por-recurso): hasta entonces, el gasto de una cuenta de AWS dice **No medido** en lugar de 0 %.
- **Recursos etiquetados** es la parte de los recursos que listan tus conexiones que llevan todas las etiquetas obligatorias, tal como están etiquetados ahora.
- **Cobertura a lo largo del tiempo** muestra cada una de las últimas 12 semanas: el gasto según los costos, y los recursos según el recuento que OneUptime hace cada día.

### Recursos nuevos

Un recurso que tu conexión lista después del primer listado completo de su cuenta es nuevo. La conexión lista cada 30 minutos, así que un recurso nuevo se encuentra dentro de la hora en que se crea. Del que no lleva una etiqueta obligatoria se avisa una vez:

- **A quién se avisa.** A la persona que lo creó, cuando el registro de cambios de la cuenta nombra a un miembro de tu proyecto por su dirección de correo, y a los propietarios del recurso, según las reglas de propiedad y los equipos. Cuando no se puede avisar a ninguno, se avisa a los Propietarios del proyecto. Cada uno debe poder leer tus recursos en la nube.
- **Con qué frecuencia.** Un correo por hora reúne todo lo nuevo para cada persona. En **Más ajustes**, **Un correo por recurso** envía cada uno por separado, y **Generar una alerta** también genera una alerta por cada cuenta, con la gravedad y las políticas de guardia de **Adónde van las alertas**.
- **Cuando se etiqueta.** Un recurso etiquetado antes de que salga el correo queda fuera de él, y la lista **Recursos nuevos** marca cada uno como **Etiquetado** en cuanto las lleva.

### Valores sugeridos

OneUptime sugiere un valor solo cuando la etiqueta lo permite:

- **Una clave de tipo equipo**, como `team`, `owner` o `squad`: el equipo propietario del recurso.
- **Una clave de tipo entorno**, como `env`, `environment` o `stage`: el entorno de App Platforms de una aplicación que se ejecuta como el recurso, o en una máquina virtual, el entorno de despliegue que informa su host.
- **Cualquier clave**: el valor que lleva la mayoría de los recursos de al lado, en la misma pila de CloudFormation, el mismo grupo de recursos de Azure o con el mismo nombre antes de su número, como `web-1` y `web-2`. Al menos dos deben coincidir.
- **Una etiqueta que permite un solo valor**: ese valor.

El comando aplica la etiqueta en un paso, desde el propio shell de tu nube: `aws resourcegroupstaggingapi tag-resources` en AWS, `az tag update --operation Merge` en Azure, y `gcloud ... add-labels` o `--update-labels` para las máquinas virtuales y los discos de Compute Engine, los buckets de Cloud Storage y las instancias de Cloud SQL en Google Cloud.

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
- **Etiquetas obligatorias.** **Nube → Gasto → Etiquetas** muestra qué parte del gasto y de los recursos lleva tus etiquetas obligatorias, y las **Etiquetas** de una cuenta muestran lo mismo solo para esa cuenta.
- **El costo de un recurso.** La página de un recurso muestra lo que costó este mes y en los últimos 30 días cuando su nube lo factura por su nombre, con sus formas de gastar menos y su ajuste de tamaño.
- **Cada presupuesto.** **Nube → Gasto → Presupuestos** enumera cada presupuesto con lo que cuenta, su periodo y el periodo hasta ahora, y cada uno abre su página.
- **Los próximos meses.** **Nube → Gasto → Previsión** dibuja los meses de los que se hizo una previsión, este mes según su rumbo y los próximos 12, con cómo se hizo.
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

:::details Una previsión no tiene rango probable
Se hizo con menos de 3 meses completos de costos, así que cada mes siguiente prolonga el ritmo de la última semana completa y no se da ningún rango. El rango llega en cuanto se lee el tercer mes completo. La primera lectura de una conexión se remonta al inicio del mes anterior al pasado.
:::

:::details Se informó a alguien de un presupuesto pero no llegó ninguna alerta
Por debajo del 100%, un presupuesto que nombra personas o equipos a notificar les informa y no crea ninguna alerta, así que no se avisa a nadie. Desde el 100% crea una alerta, y se avisa a sus políticas de guardia. Un presupuesto sin nadie a quien informar crea una alerta en cada parte.
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
