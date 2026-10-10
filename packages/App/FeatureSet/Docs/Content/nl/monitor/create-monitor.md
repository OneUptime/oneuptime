# Een monitor maken

Een monitor controleert iets wat u beheert, zoals een website, een API, een host of een Kubernetes-cluster, en laat het u weten wanneer het niet meer werkt. **Monitor maken** vraagt eerst wat u wilt bewaken, dan wat er gecontroleerd wordt en daarna hoe vaak. Alles behalve het type, de naam en wat er gecontroleerd wordt, begint met standaardwaarden die bij de meeste monitoren passen.

> [!NOTE]
> Om een monitor te maken hebt u de rol Project Owner, Project Admin, Project Member, Monitor Admin of Monitor Member nodig, of een aangepaste rol met de machtiging Create Monitor.

## Monitorinfo

De eerste stap vraagt wat u wilt bewaken en hoe de monitor heet.

:::steps
### Monitor maken openen

Ga naar **Monitoren** en klik op **Monitor maken**. Het formulier opent op de eerste stap, **Monitorinfo**.

### Het monitortype kiezen

De eerste vraag is het **Monitortype**: wat wilt u bewaken?

- De zes types die het vaakst worden gemaakt staan bovenaan: **Website**, **API**, **Ping**, **Poort**, **SSL Certificate** en **Incoming Request**, voor heartbeats van cronjobs en webhooks.
- **Meer monitortypen** toont alle andere types onder hun categorie, zoals **Infrastructuur** (Kubernetes, Docker, host) en **Telemetrie** (logboeken, metrieken, traces). **Manual**, een monitor waarvan u de status zelf instelt, staat onder **Overig**.
- Of typ in het zoekvak. Het kent de woorden die u al gebruikt, zoals `k8s`, `postgres`, `heartbeat` of `tls`, en **Enter** kiest de eerste treffer.

Het gekozen type krimpt tot één regel. Klik op **Wijzigen** om een ander te kiezen; druk tijdens het kiezen op **Escape** om het type te houden dat u had.

### De monitor een naam geven

Vul de **Naam** in. Die wordt gebruikt in waarschuwingen en in de titels van incidenten. **Beschrijving** en **Labels** zijn optioneel en wachten onder **Meer velden**.

Een **Manual**-monitor heeft niets meer nodig, dus **Monitor maken** staat op deze stap. Klik bij elk ander type op **Volgende**.
:::

## Criteria

De tweede stap vraagt wat er gecontroleerd wordt en bepaalt wat als een probleem telt.

:::steps
### Invullen wat er gecontroleerd wordt

Deze stap opent op wat er gecontroleerd wordt. Voor een website is dat de URL, met een voorbeeld in het vak; andere types vragen om een host, een query, een cluster of een logfilter. Instellingen die de meeste monitoren nooit wijzigen, zoals time-outs en nieuwe pogingen, zijn ingeklapt onder **Meer velden**.

Voor een monitor die sondes controleren, voert **Monitor testen** de controle één keer uit voordat u opslaat: kies een sonde onder **Selecteer sonde** en klik op **Test uitvoeren**. Het antwoord opent in **Testresultaat van monitor**.

### De criteria nakijken

Daaronder bepalen de **Monitorcriteria** wanneer de monitor van status verandert, een incident meldt of een waarschuwing maakt. Een nieuwe monitor begint met criteria die bij de meeste monitoren passen, elk ingeklapt tot één regel die zegt wat het controleert en wat het doet. Een nieuwe websitemonitor wordt bijvoorbeeld als offline gemarkeerd en meldt een incident wanneer de site niet antwoordt of antwoordt met een foutstatuscode.

Klik op een criterium om het te openen en te wijzigen. **Criteria toevoegen** voegt er een toe, geopend en klaar om in te vullen. Om de volgorde te wijzigen, sleept u een criterium aan de greep links ervan.

### Naar de volgende stap gaan

Klik op **Volgende**. Niets op deze stap wordt als ontbrekend gemarkeerd voordat u op **Volgende** klikt.
:::

### Hoe criteria worden geëvalueerd

Het resultaat van elke controle gaat van boven naar beneden door de criteria, en het eerste dat overeenkomt bepaalt wat er gebeurt. Dat criterium kan de status van de monitor wijzigen, een incident melden, een waarschuwing maken of een combinatie daarvan. Komt er geen overeen, dan toont de monitor zijn **Standaard monitorstatus**, ingesteld onder **Meer velden** onder de criteria (**Operationeel**, tenzij u een andere kiest).

```mermaid title="Van een controle naar een status, een incident of een waarschuwing"
flowchart TB
    check["Het resultaat van een controle"] --> criteria{"Eerste criterium<br/>dat overeenkomt"}
    criteria -->|"Geen komt overeen"| fallback["Standaard monitorstatus"]
    criteria -->|"Eén komt overeen"| actions
    subgraph actions["Wat dat criterium doet"]
        direction LR
        status["De status<br/>wijzigen"]
        incident["Een incident<br/>melden"]
        alert["Een waarschuwing<br/>maken"]
    end
```

Incidenten en waarschuwingen die automatisch worden opgelost, zoals die van de standaardcriteria, lossen zichzelf op zodra hun criterium niet meer overeenkomt. Een monitor die door meer dan één sonde wordt gecontroleerd, verandert pas wanneer zijn sondes het eens zijn: standaard moet elke ingeschakelde en verbonden sonde tot hetzelfde resultaat komen. Om minder te eisen, stelt u **Sonde-overeenstemming** in op de pagina **Configuratie → Sondes en interval** van de monitor.

## Sondes en interval

Monitoren die sondes controleren eindigen met deze stap: Website, API, Ping, IP, Poort, SSL Certificate, DNS, DNSSEC, NTP, Domein, SQL Query, Database Health, Synthetic Monitor, Custom JavaScript Code en External Status Page. **Sondes** zijn de machines die de controles uitvoeren, en de standaardsondes van uw project zijn al geselecteerd. Het **Bewakingsinterval** begint bij **Elke 5 minuten**.

:::steps
### De sondes kiezen

Houd de geselecteerde **Sondes** of kies andere. Een monitor zonder sondes wordt nooit gecontroleerd. Om iets in een privénetwerk te controleren, draait u een [aangepaste sonde](/docs/probe/custom-probe) in dat netwerk en kiest u die hier.

### Kiezen hoe vaak er gecontroleerd wordt

Kies een **Bewakingsinterval**, van **Elke minuut** tot **Elke week**. Monitoren van het type Synthetic Monitor, Custom JavaScript Code en SSL Certificate krijgen intervallen van 5 minuten of langer aangeboden.

### De monitor maken

Klik op **Monitor maken**. De pagina van de nieuwe monitor opent. Om later de sondes of het interval te wijzigen, opent u **Configuratie → Sondes en interval** op die pagina.
:::

Alle andere types behalve Manual worden vanuit de stap **Criteria** gemaakt.

## Beginnen vanuit een sjabloon of een link

Een monitorsjabloon, en de links die elders in OneUptime een monitor maken (op een metriekgrafiek, een netwerkapparaat of een detectieregel), openen **Monitor maken** met het type al gekozen en de rest ingevuld. Klik op **Wijzigen** om een ander type te kiezen. Het formulier van een sjabloon gebruikt dezelfde typekiezer: zie [Monitorsjablonen](/docs/monitor/monitor-templates).

Elk monitortype heeft een eigen pagina met zijn instellingen, zijn standaardcriteria en voorbeelden. Goede plekken om verder te gaan:

:::cards
- [Website-monitor](/docs/monitor/website-monitor): Controleren of een pagina laadt, en wat die antwoordt.
- [API-monitor](/docs/monitor/api-monitor): Een endpoint aanroepen met een methode, headers en een body.
- [Monitorsjablonen](/docs/monitor/monitor-templates): Veel monitoren maken vanuit één configuratie en ze gelijk houden.
- [Incidenten](/docs/incidents/index): Wat er gebeurt nadat een monitor een incident meldt.
:::
