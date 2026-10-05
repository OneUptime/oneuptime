# Een monitor maken

Een monitor controleert iets dat u draait, zoals een website, een API, een host of een Kubernetes-cluster, en laat het u weten wanneer het niet meer werkt. **Monitor maken** vraagt eerst wat u wilt bewaken, dan wat er wordt gecontroleerd en dan hoe vaak. Alles behalve het type, de naam en wat er wordt gecontroleerd begint met standaardwaarden die bij de meeste monitors passen.

## Monitorinfo

Ga naar **Monitoren** en klik op **Monitor maken**. De eerste vraag is het **Monitortype**: wat wilt u bewaken?

- De zes typen die de meeste mensen maken staan bovenaan: **Website**, **API**, **Ping**, **Poort**, **SSL Certificate** en **Incoming Request**, voor heartbeats van cronjobs en webhooks.
- **Meer monitortypen** toont alle andere typen onder hun categorie, zoals **Infrastructuur** (Kubernetes, Docker, Host) en **Telemetrie** (Logboeken, Metrieken, Traces). **Manual**, een monitor waarvan u de status zelf instelt, staat onder **Other**.
- Of typ in het zoekvak. Het kent de woorden die u al gebruikt, zoals `k8s`, `postgres`, `heartbeat` of `tls`, en **Enter** kiest de eerste treffer.

Het gekozen type krimpt tot één regel. Klik op **Wijzigen** om een ander te kiezen; druk tijdens het kiezen op **Escape** om het type te houden dat u had.

Vul daarna de **Naam** in. Die wordt gebruikt in waarschuwingen en in de titels van incidenten. **Beschrijving** en **Labels** zijn optioneel en wachten onder **Meer velden**.

Een **Manual**-monitor heeft niets meer nodig, dus **Monitor maken** staat op deze stap.

## Criteria

Deze stap begint met wat er wordt gecontroleerd. Voor een website is dat de URL, met een voorbeeld in het vak; andere typen vragen om een host, een query, een cluster of een logfilter. **Monitor testen** voert de controle één keer uit voordat u opslaat.

Daaronder bepalen de **Monitorcriteria** wanneer de monitor van status verandert, een incident meldt of een waarschuwing maakt. Een nieuwe monitor begint met criteria die bij de meeste monitors passen, elk ingeklapt tot één regel die zegt wat het controleert en wat het doet. Een nieuwe websitemonitor wordt bijvoorbeeld als offline gemarkeerd en meldt een incident wanneer de site niet antwoordt of antwoordt met een foutstatuscode. Klik op een criterium om het te openen en te wijzigen. **Criteria toevoegen** voegt er een toe, open en klaar om in te vullen.

Op deze stap wordt niets als ontbrekend gemarkeerd voordat u op **Volgende** klikt.

## Sondes en interval

Monitors die door sondes worden gecontroleerd eindigen met deze stap: Website, API, Ping, IP, Port, SSL Certificate, DNS, DNSSEC, Domain, SQL Query, Database Health, Synthetic Monitor, Custom JavaScript Code en External Status Page. **Sondes** zijn de machines die de controles uitvoeren, en de standaardsondes van uw project zijn al geselecteerd. Het **Bewakingsinterval** begint op **Elke 5 minuten**. Klik op **Monitor maken**.

Alle andere typen worden vanaf de stap **Criteria** gemaakt.

## Beginnen vanuit een sjabloon of een link

Een monitorsjabloon, en de links die elders in OneUptime een monitor maken (op een metriekgrafiek, een netwerkapparaat of een detectieregel), openen **Monitor maken** met het type al gekozen en de rest ingevuld. Klik op **Wijzigen** om een ander type te kiezen. Het formulier van een sjabloon gebruikt dezelfde typekiezer: zie [Monitorsjablonen](/docs/monitor/monitor-templates).
