# Sehr große OpenStack-Clouds

Was eine Cloud jeder Größe kostet, bevor Sie etwas installieren: wie stark das Monitoring ihre Steuerungsebene belastet, wie viele Daten es sendet und was OneUptime anders macht, wenn eine Cloud wächst. Fast jede Cloud sollte davon nichts brauchen: Nach den Zahlen unten tragen die Standardwerte des [OpenStack-Agents](/docs/telemetry/openstack) und einer [Sonde](/docs/telemetry/openstack-agentless) bis zu Tausenden von Instanzen, ohne dass etwas eingestellt wird.

:::cards
- [Die Last auf Ihrer Steuerungsebene](#die-last-auf-ihrer-steuerungsebene): Anfragen pro Minute und Dienst, in jeder Größe.
- [Die Daten, die gesendet werden](#die-daten-die-gesendet-werden): Serien und Gigabyte pro Tag, aus den Zahlen Ihrer Cloud.
- [Summary-Modus](#summary-modus): Was eine Cloud ab 5.000 Instanzen behält und worauf sie verzichtet.
- [Eine Cloud auf mehrere Collectors aufteilen](#eine-cloud-auf-mehrere-collectors-aufteilen): Ein Agent pro Region oder pro Dienst.
- [Der Datenbankpfad](#der-datenbankpfad): Die größten Clouds aus ihren Datenbanken lesen.
- [Woran die größte Größe gemessen wurde](#woran-die-größte-größe-gemessen-wurde): Eine Stunde bei 200.000 Instanzen, mit ihren Budgets und dem Gemessenen.
:::

## Die Last auf Ihrer Steuerungsebene

### Über eine Sonde

Eine Sonde bleibt bei einer genannten Last, wie groß die Cloud auch ist. Sie fragt jeden Dienst mit einer Anfrage nach der anderen, Placement mit vier, liest Instanzen zwischen vollständigen Lesevorgängen nach Änderung und liest ab einer genannten Zahl das, was ein Aufruf pro Objekt ist (die Nutzung eines Hypervisors, die Agents eines Routers, die Quoten eines Projekts), reihum. Jede Erfassung sendet alles, wie es zuletzt gelesen wurde, sodass keine Serie eine Lücke hat: Nur wie aktuell diese Teile sind, ändert sich.

Anfragen pro Minute mit den Standardwerten, nachdem sich eine Erfassung eingependelt hat, bei einer Cloud mit OVN:

| Cloud | Keystone | Nova | Placement | Neutron | Cinder | Glance |
| --- | --- | --- | --- | --- | --- | --- |
| 10 Hypervisoren, 100 Instanzen, 20 Projekte | 1,3 | 3,5 | 12,5 | 3,5 | 2,5 | 0,3 |
| 500 Hypervisoren, 20.000 Instanzen, 1.000 Projekte | 1,3 | 4,2 | 253 | 7,5 | 8,5 | 0,3 |
| 5.000 Hypervisoren, 200.000 Instanzen, 10.000 Projekte | 1,3 | 12,7 | 1.003 | 43,5 | 62,5 | 0,5 |

Das ist gezählt, nicht geschätzt: Ein Test führt den echten Collector gegen eine Mock-API jeder Größe aus, auf einer Uhr, die er selbst weiterstellt, und hält, was er angefragt hat, genau an diesen Zahlen fest, Dienst für Dienst, überall dort, wo etwas anderes fällig wird. Eine Anzahl von Anfragen hängt nicht von dem Rechner ab, auf dem gezählt wurde.

Was jede Größe außer ihren Hypervisoren, Instanzen und Projekten enthält, ist angenommen, und eine echte Cloud weicht ab: ein Volume für jede zweite Instanz, ein Snapshot und ein Backup für jedes zehnte Volume, pro Projekt ein Netzwerk, ein Subnetz, ein Router und eine Sicherheitsgruppe, eine Floating IP für jede zehnte Instanz, 40 Flavors, zwei Neutron-Agents pro Hypervisor und ein Image pro zehn Projekte, zwischen 10 und 1.000. Eine Liste kostet eine Anfrage pro tausend Zeilen, daher verschiebt das, was Ihre Cloud wirklich enthält, diese Werte nur wenig. Was sie am meisten verschiebt:

| Was sich ändert | Was es kostet |
| --- | --- |
| Die erste Erfassung nach dem Start einer Sonde | Ein Aufruf für die Inventare jedes Hypervisors und einer für seine Nutzung, egal wie viele es sind |
| ML2/OVS statt OVN | Ein Aufruf pro Router, um zu fragen, welche L3-Agents ihn halten, höchstens 2.000 pro Erfassung |
| Sich ändernde Instanzen | Ein Aufruf an Nova pro geänderter Instanz, um zu lesen, was mit ihr geschehen ist, höchstens 25 pro Erfassung |
| [Projektlimits](/docs/telemetry/openstack-agentless#was-es-ihre-cloud-kostet) eingeschaltet | Vier Aufrufe pro Projekt, höchstens 250 Projekte pro Erfassung, sodass eine Cloud mit 10.000 80 Minuten für eine Runde braucht |
| Seltener erfassen | **Erfassen alle** auf der Seite **Einstellungen** der Cloud. Doppelt so lang sind halb so viele Aufrufe |
| Mehr Regionen | Alles außer Keystone noch einmal, pro Region |

Eine Erfassung hat neun Zehntel ihres Intervalls, höchstens aber zehn Minuten, und jeder Dienst wird mit einer Anfrage nach der anderen gelesen. Wie schnell die APIs einer großen Cloud antworten, entscheidet also darüber, wie oft sie erfasst werden kann: Bei 200.000 Instanzen und den standardmäßigen zwei Minuten muss Nova jede Seite seines vollständigen Lesevorgangs in etwa einer halben Sekunde beantworten und Cinder seine Listen in etwa 0,8 Sekunden. Ein Dienst, der nicht fertig wird, gilt als ausgefallen, bis er es wird, und die Karte zeigt **Die Erfassung hat zu lange gedauert**. Erhöhen Sie **Erfassen alle**, was auch die Last senkt, oder verwenden Sie den [Datenbankpfad](#der-datenbankpfad).

### Über den Agent

Der Exporter des Agents meldet sich an und liest bei jedem Scrape jede Liste vollständig, und er fragt Placement pro Hypervisor nach drei Dingen, einen Aufruf nach dem anderen. Anfragen pro Minute mit den Standardwerten:

| Cloud | Keystone | Nova | Placement | Neutron | Cinder | Glance |
| --- | --- | --- | --- | --- | --- | --- |
| 10 Hypervisoren, 100 Instanzen, 20 Projekte | 5,2 | 3 | 15,5 | 3,5 | 2 | 0,2 |
| 500 Hypervisoren, 20.000 Instanzen, 1.000 Projekte | 5,2 | 13 | 751 | 7,5 | 7,5 | 0,2 |
| 5.000 Hypervisoren, 200.000 Instanzen, 10.000 Projekte | 5,2 | 106 | 7.501 | 43,5 | 57 | 0,4 |

Das ist aus dem Quellcode des Exporters gezählt, und der Exporter wurde in diesen Größen nicht ausgeführt. Ein Scrape hat 110 Sekunden, sodass ein Placement, das in 20 ms antwortet, bei etwa 1.800 Hypervisoren in ein Zeitlimit läuft, und Nova bei einer Sekunde pro Seite bei etwa 110.000 Instanzen. Darüber schlägt ein Scrape fehl, wie schonend er auch angefragt wurde. Verwenden Sie über diesen Größen den [Datenbankpfad](#der-datenbankpfad) oder eine Sonde.

### Wenn eine API langsamer wird

Eine Sonde beobachtet, in welcher Zeit jeder Dienst üblicherweise antwortet, und hält sich zurück, wenn eine Antwort langsam ist oder abgelehnt wird: [Was es Ihre Cloud kostet](/docs/telemetry/openstack-agentless#was-es-ihre-cloud-kostet) sagt, um wie viel. Mehrere gleichzeitig wartende Lesevorgänge kommen der Reihe nach dran, sodass eine Pause nicht in einem Schub endet. Nichts anderes wird aufgehalten: Jeder Dienst wird für sich gefragt.

Die Karte **Datenerfassung** der Cloud sagt das, solange es dauert, Dienst für Dienst: wie langsam seine langsamste Antwort war und wie lange die Sonde sich zurückgehalten hat. Der Exporter des Agents kann das nicht. Ein Scrape läuft ganz, in seinem Intervall: Erhöhen Sie `scrape_interval` und `scrape_timeout` für diesen Job, um einen Dienst zu schonen.

## Die Daten, die gesendet werden

Die Serien einer Cloud ergeben sich aus ihren Zahlen. Der Rechner unter **OpenStack → Dokumentation** in OneUptime errechnet das aus drei Zahlen. Um es selbst zu errechnen, für eine Region:

| Serie | Wie viele |
| --- | --- |
| Compute | 10 pro Hypervisor, plus Flavors und Steuerdienste, plus 7 |
| Placement | 15 pro Hypervisor, plus 4. Eine Sonde ergänzt etwa 2 pro Flavor, für [wie viele von jedem passen](/docs/telemetry/openstack#kapazität) |
| Neutron | Agents, Netzwerke, Router und Floating IPs, 3 pro Subnetz, plus 11. Einer mehr pro Router bei ML2/OVS |
| Cinder | Dienste, Snapshots und Backups, 2 pro Speicherpool, plus 26 |
| Instanzen und Volumes, sofern der Summary-Modus nicht an ist | 4 pro Instanz, 2 pro Volume |
| Zählwerte des Summary-Modus, wenn er an ist | Eine pro Status und eine pro Projekt: etwa 6 plus Projekte |
| Keystone, Glance | Projekte, Domänen und 9, sowie 2 pro Image plus 5. Eine Sonde ergänzt je 3 für Heat und Magnum, ob eine Cloud sie betreibt oder nicht |

Die Zeilen jedes Scrapes sind das, was Ihnen berechnet wird: Die ersten fünf Zeilen kommen alle 2 Minuten, 720-mal pro Tag, die letzte alle 5 Minuten, 288-mal. Der Preis ist der auf Ihrer Rechnung, [pro GB für die Dauer der Aufbewahrung](/docs/telemetry/data-retention#was-aufbewahrung-kostet). Die Rechnung liest die echte Größe jeder Zeile, und dies rechnet mit 1.024 Bytes pro Zeile, worauf die Abrechnung von OneUptime zurückgreift, wenn sie keine Größe für eine Zeile hat. Eine Zeile mit vielen Labels, wie die einer Instanz, kostet mehr als das, eine ohne weniger.

| Cloud | Serien | GB pro Tag, alle Serien | GB pro Tag, im Summary-Modus | Ein Monat bei 15 Tagen Aufbewahrung, im Summary-Modus |
| --- | --- | --- | --- | --- |
| 10 Hypervisoren, 100 Instanzen, 20 Projekte | 1.084 | 0,7 | Nicht im Summary-Modus | $2.12 |
| 500 Hypervisoren, 20.000 Instanzen, 1.000 Projekte | 123.856 | 84,5 | 16,6 | $49.71 |
| 5.000 Hypervisoren, 200.000 Instanzen, 10.000 Projekte | 1.237.192 | 844,5 | 164,9 | $494.73 |

Das gilt für den Weg über den Agent, mit einer Instanz von tausend in einem Zustand, der ihre Serie behält. Eine Sonde sendet ab der Größe des Summary-Modus das, was sich nicht geändert hat, einmal pro Zyklus statt bei jeder Erfassung, was bei der zweiten Größe auf etwa 13,2 GB pro Tag kommt und bei der dritten auf 116 GB.

Die echte Nutzung pro Instanz, aus libvirt oder Ceilometer, kommt zu all dem hinzu: siehe [was es kostet](/docs/telemetry/openstack#was-es-kostet).

## Summary-Modus

Ab 5.000 Instanzen behält eine Cloud Zählwerte und Zeilen statt einer Serie pro Instanz. Bei dieser Größe machen diese Serien den Großteil der Rechnung aus, mit etwa 17 GB pro Tag gegenüber 4 GB für alles andere, und sie sagen, was die Zeilen und die Zählwerte schon sagen.

**Was er behält:**

- Eine Zeile für jedes Teil, auf jeder Seite und in jeder Liste, aktuell gehalten. Statusänderungen erreichen sie wie gewohnt.
- Jede Serie von Hypervisoren, Workern, Netzwerken, Routern, Floating IPs, Adresspools und Speicherpools.
- `openstack_nova_instances_by_status` und `openstack_nova_instances_by_project`, in jeder Region.
- Die Serien jeder Instanz oder jedes Volumes in einem Zustand, den eine Warnung beobachtet: in `ERROR` oder hängend in `BUILD`, `RESIZE`, `attaching` und dergleichen. So arbeitet jede [Warnungsvorlage](/docs/monitor/openstack-monitor#vorgefertigte-warnungsvorlagen) weiter und erholt sich weiterhin von selbst.

**Worauf er verzichtet:**

- Der Verlauf des Status jeder beruhigten Instanz und jedes beruhigten Volumes sowie ein Diagramm oder ein Monitor über diese Serien. `openstack_nova_server_status`, `openstack_cinder_volume_gb` und `openstack_cinder_volume_status` enden für ein Teil, sobald es beruhigt ist. Ein Monitor, der eine einzelne Instanz braucht, sollte ihr Projekt wählen, siehe unten.
- `openstack_placement_resource_provider_allocations` und `openstack_nova_server_local_gb`, egal wem sie gehören. Eine Sonde hört ganz auf, Placement nach Allokationen zu fragen.

**Um die Serien einer Instanz trotzdem zu behalten**, öffnen Sie die **Einstellungen** der Cloud und dann **Echte Nutzung je Instanz**. **Nur die von mir gewählten Projekte und Aggregate** behält jede Instanz und jedes Volume dieser Projekte, egal wie groß die Cloud ist. **Jede Instanz** schaltet den Summary-Modus für die ganze Cloud aus. Eine Sonde lehnt das ab etwa 480 MiB an Metriken pro Erfassung ab, statt das im Speicher zu halten: Verwenden Sie für eine solche Cloud den Agent.

**Über eine Sonde** gibt es einen weiteren Unterschied. Ab der Größe des Summary-Modus liest sie jedes Mal alles und sendet nur, was sich geändert hat, was jemand gewählt hat, was eine Warnung beobachtet und einen Teil vom Rest. Jedes Teil kommt einmal pro Zyklus an die Reihe, so bemessen, dass der Upload einer Erfassung etwa 24 MiB über den Serien bleibt, die jedes Mal gesendet werden: 6 Minuten bei 20.000 Instanzen, 44 bei 200.000. Die Karte **Datenerfassung** sagt, wie lang der Zyklus ist. Daraus folgen zwei Dinge:

- **Die Listen einer neuen Cloud füllen sich während ihres ersten Zyklus.** Die erste Erfassung weiß, was die Cloud enthält, und die Karte sagt das sofort, doch ihre Zeilen kommen portionsweise an. Dasselbe gilt für eine Sonde, die neu gestartet wurde, obwohl die Zeilen, die sie hinterlassen hat, währenddessen auf den Seiten bleiben. Die Karte sagt, wann alle angekommen sein werden.
- **Ein Teil, das verschwunden ist, bleibt etwas länger gelistet.** Es verschwindet innerhalb von 15 Minuten, in denen es niemand meldet, plus dem Zyklus, plus zwei Lesevorgängen. Das sind bei den meisten Clouds 15 Minuten und ein paar mehr, und bei 200.000 Instanzen etwas über eine Stunde. Ein Teil, das noch da ist, wird nie entfernt. Ein fehlgeschlagener Lesevorgang entfernt nichts, wie lange er auch dauert.

## Eine Cloud auf mehrere Collectors aufteilen

Ein Agent liest eine Cloud, wie viele Regionen sie auch hat, und damit sollten Sie beginnen. Wenn einer für den Rechner, auf dem er läuft, oder für die Zeit eines Scrapes zu viel ist, geben Sie jedem Agent einen Anteil. Jeder von ihnen sendet unter demselben `OPENSTACK_CLOUD_NAME` an dieselbe OneUptime-Cloud. Zwei Regeln verhindern, dass ein Diagramm und eine Rechnung doppelt lesen:

- **Jedes Paar aus Region und Dienst gehört einem Agent.** Eine Zeile ist dieselbe Zeile, egal wie viele Agents sie melden, aber die Serien jedes Agents werden gespeichert und abgerechnet.
- **Keystone gehört einem Agent.** Es ist eines für die ganze Cloud, egal welche Region es fragt.

**Ein Agent pro Region** ist das, was die meisten Clouds wollen. Listen Sie in `clouds.yaml` und `OPENSTACK_EXPORTER_CLOUDS` nur die Einträge dieser Region auf. Nur der erste Agent behält Keystone. Ein Agent, der `OPENSTACK_AGENT_SERVICES` setzt, liest nur, was darin steht, fügen Sie also jeden anderen Dienst hinzu, den Ihre Cloud betreibt, etwa `load-balancer`:

```bash
# On the agent for RegionOne, in .env
OPENSTACK_CLOUD_NAME=prod
OPENSTACK_EXPORTER_CLOUDS=[RegionOne]

# On the agent for RegionTwo
OPENSTACK_CLOUD_NAME=prod
OPENSTACK_EXPORTER_CLOUDS=[RegionTwo]
OPENSTACK_AGENT_SERVICES=compute|placement|network|volume|image
```

**Ein Agent pro Dienst** ist für die größten Clouds, bei denen die Listen eines Dienstes das sind, was ein Scrape nicht beenden kann. `OPENSTACK_AGENT_SERVICES` behält die Jobs, die es nennt, und überlässt den Rest einem anderen Agent:

```bash
# Nova and Placement, which take the most
OPENSTACK_AGENT_SERVICES=compute|placement

# And the rest: add any other service you run, such as load-balancer
OPENSTACK_AGENT_SERVICES=identity|network|volume|image
```

Setzen Sie `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` bei einem Agent, der einen großen Anteil trägt: Er hält einen Scrape auf dem Weg nach draußen im Speicher, und der Standard ist 512 MiB. Eine Zeile wird von ihrem eigenen Dienst in ihrer eigenen Region bestätigt, sodass ein Agent, der anhält, nichts von dem mitnimmt, was ein anderer Agent liest. Nennen Sie das, worauf eine Cloud aufbaut, die `OPENSTACK_RABBITMQ_TARGETS` und die [übrigen dieser Art](/docs/telemetry/openstack#umgebungsvariablen), nur bei einem Agent. Hält dieser Agent an, während die anderen weiterlaufen, verschwinden diese Maschinen nach 15 Minuten von den Seiten und kehren zurück, wenn er es tut.

**Mit Sonden** hat eine Cloud eine Sonde. Geben Sie einer Region eine eigene Sonde, indem Sie sie als eigene Cloud verbinden, mit nur dieser gewählten Region: Nichts wird doppelt gezählt, weil jede nur ihre eigene Region liest und jede Keystone für sich liest. Jede ist dann eine eigene Cloud in OneUptime, mit eigenen Seiten und eigenen Warnungen.

## Der Datenbankpfad

Ab **1.500 Hypervisoren oder 100.000 Instanzen** kann der Agent die Datenbanken einer Cloud statt ihrer APIs lesen, mit [`openstack_database_exporter`](https://github.com/vexxhost/openstack_database_exporter). Bei dieser Größe läuft ein Scrape der APIs in ein Zeitlimit, und Lesevorgänge, die nicht fertig werden können, sind Last für nichts. Ein Datenbanklesevorgang kostet die APIs nichts. Er wird nur ab dieser Größe angeboten, weil darunter die APIs gut genug antworten und dieser Pfad Dinge aufgibt.

**Was er von Ihnen verlangt:**

- Ein schreibgeschütztes Konto auf der Datenbank jedes Dienstes: Nova, Nova API, Placement, Neutron, Cinder, Glance und Keystone. Eine ausgelassene Datenbank ist ein Dienst, den er in Ruhe lässt.
- Eine Route vom Rechner des Agents zu diesen Datenbanken, die bei den meisten Clouds weit weg von allem anderen gehalten werden. Es ist eine Sache mehr, die die Datensätze jedes Projekts lesen kann.
- Ein Exporter pro Region und pro Nova-Cell. Er liest, worauf Sie ihn richten, und eine zweite Cell braucht einen zweiten Exporter.
- Seine Schemas müssen Ihrem Release folgen. Er liest die Tabellen jedes Dienstes direkt, sodass ein Upgrade von OpenStack ändern kann, was er lesen kann, bevor eine neue Version des Exporters es tut.

**Um ihn einzuschalten**, in `.env`:

```bash
COMPOSE_PROFILES=openstack-database-exporter,openstack-ai-agent
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

**Was er abdeckt.** Dieselben Serien unter denselben Namen, sodass jede Seite, jeder Monitor und jede Warnungsvorlage sie auf dieselbe Weise liest. Ein Test hält sie an denen des API-Exporters fest, Name für Name und Label für Label.

**Was er nicht abdeckt:**

| Was | Warum, und was stattdessen geschieht |
| --- | --- |
| Ob jeder Nova-Worker lebt | Sein `openstack_nova_agent_state` liest 1 für jeden aktivierten Dienst, sodass ein angehaltenes `nova-compute` als aktiv gelesen würde. Der Agent verwirft diese Serie und liest sie aus der API von Nova, was eine kleine Liste ist |
| Wie voll jeder Speicherpool ist | Jedes Backend meldet das an den Scheduler von Cinder, und es steht nicht in der Datenbank. Der Agent liest es aus der API von Cinder, was eine weitere Liste ist |
| Die MTU eines Netzwerks | Gilt als nicht bekannt |
| `openstack_placement_resource_provider_allocations`, die Generation eines Providers | Nichts liest sie |
| Quoten und Limits pro Projekt | Er kann sie lesen, und bei 10.000 Projekten sind das 790.000 Datenpunkte pro Scrape, daher lässt der Agent sie weg. Löschen Sie diese Regel in `otel-collector-config.yaml`, um sie zu behalten |
| Ob eine API antwortet | `openstack_<service>_up` sagt, ob ihre Datenbank es tut. Eine angehaltene API mit gesunder Datenbank gilt als aktiv, beobachten Sie die APIs daher selbst mit einem [Website-Monitor](/docs/monitor/website-monitor) |

**Wie weit das belegt ist.** Die Serien wurden aus dem Quellcode des Exporters und seinen eigenen Tests bei dem Tag gelesen, den der Agent anpinnt, und jede stimmt mit dem überein, was OneUptime liest. Er wurde hier nicht gegen eine echte Datenbank ausgeführt.

## Woran die größte Größe gemessen wurde

Der echte Collector las 60 Minuten lang alle zwei Minuten eine Mock-API mit 5.000 Hypervisoren, 200.000 Instanzen und 10.000 Projekten, auf einer echten Uhr. Was er sendete, ging durch die echte Ingestion und die echten Schreibvorgänge in ein echtes Postgres, wobei die Lesevorgänge der Übersicht und der Sweep für veraltete Zeilen alle 30 Sekunden daneben liefen und sich bei jeder Erfassung 200 Instanzen änderten. Jedes Budget unten wird geprüft, und ein Lauf, der eines verfehlt, schlägt fehl.

| Was | Budget | Gemessen |
| --- | --- | --- |
| Anfragen pro Minute, wie bei jedem Dienst angefragt | Genau das, was der Zeitplan des Collectors sagt, Dienst für Dienst | Exakt. Keystone 1,3, Nova 25,1, Placement 1.166, Neutron 43,5, Cinder 62,4, Glance 0,5 |
| Übersprungene Erfassungen, weil die vorherige noch lief | Keine | 0 von 30 |
| Ingest-Verzögerung, vom Start einer Erfassung bis zum Schreiben ihrer letzten Zeile | Unter 2 Minuten | 37 s im Median, 112 s im schlechtesten Fall |
| Das Öffnen einer Übersicht, alle ihre Lesevorgänge auf einmal | Unter 6 Sekunden | 0,6 s im Median, 4,1 s im schlechtesten Fall, und 5.008 Bytes dessen, was Aufmerksamkeit braucht |
| Die längste Zeit, die ein Schreiber auf eine Sperre der Inventartabelle wartete | Unter 5 Sekunden | 0,0 s, bei 2.739 Prüfungen im Sekundentakt |
| Gelöschte Teile, die noch da waren | Keine | 0 |

Und was es gekostet hat, wofür es kein Budget gibt: 73 MiB an Metriken pro Erfassung vor der Kompression, in bis zu 2 Uploads, 14 s CPU dieses Prozesses pro Erfassung für Lesen, Senden und Schreiben zusammen und höchstens 998 MiB JavaScript-Heap. Eine Sonde, die eine Cloud dieser Größe erfasst, braucht diesen Speicher zusätzlich zu ihrer übrigen Arbeit.

Das lief auf einem Mac mit 10 Kernen, geteilt mit anderer Arbeit bei einer Load Average von etwa 33, und PostgreSQL 14 auf demselben Rechner, daher sind die Zeiten das, was ein ausgelasteter Rechner geschafft hat, und nicht das, was ein Server schaffen würde. Gemessen wurde am 2026-11-05. Die Anfragen einer Stunde enthalten ihre erste Erfassung, die Placement nach den Inventaren jedes Hypervisors fragt, daher liegen sie etwas über [der Tabelle](#über-eine-sonde) einer eingependelten, und 200 sich ändernde Instanzen pro Erfassung sind der Rest dessen, was Nova dort liest.

Die Reserve ist auf einem so ausgelasteten Rechner nicht groß. Eine frühere Stunde, bei einer Load Average von etwa 42, die bis 95 stieg, lief so weit, dass die letzte Zeile einer Erfassung bei 124 Sekunden landete und die nächste Erfassung übersprungen wurde, und jedes andere Budget hielt.

**Was das auslässt.** Die Mock-API antwortet sofort, daher sagt das nichts darüber, wie schnell Ihre APIs sind: [Was die Zeit einer Erfassung erlaubt](#über-eine-sonde) handelt davon. Es lässt den HTTP-Server und die Queue zwischen einer Sonde und dem Ingest aus sowie ClickHouse, sodass der Lesezugriff eines Diagramms oder Monitors auf die Serien hier nicht enthalten ist, nur die Schreib- und Lesevorgänge des Inventars. Die Zeilen sind geformt wie die eines echten DevStack, und die Zahlen sind ausgedacht. Gegen keine Cloud dieser Größe wurde es ausgeführt.

## Was die Seiten lesen

Die Seiten einer großen Cloud lesen kaum mehr als die einer kleinen, weil keine von ihnen die ganze Cloud liest.

| Seite | Was sie liest |
| --- | --- |
| **Übersicht** | Zählwerte, die auf dem Server errechnet werden, und die Zeilen, die jemanden brauchen könnten. Ab 1.000 Hosts oder Workern werden die übrigen nur gezählt, sodass das, was sie holt, unter einem Megabyte bleibt, wie groß die Cloud auch ist |
| **Dienste** | Dasselbe: eine Karte für jeden Dienst, zuerst das, was jemanden braucht, und wie viele andere in Ordnung sind. Eine Suche fragt den Server, sodass sie jeden Host findet |
| Listen | Eine Seite nach der anderen, jede ab der letzten Zeile der vorherigen. Ein Sprung auf eine weit entfernte Seite geht über einen Offset, was auf der letzten Seite von 200.000 Zeilen Sekunden statt einer Millisekunde dauert |
| **Topologie** | Ab 5.000 Teilen die Struktur, was ausgefallen ist und was das nach sich zieht. Sie sagt, was sie ausgelassen hat |
| **Inventar-Schreibvorgänge** | Höchstens 500 Zeilen pro Statement und 5.000 pro Löschvorgang, jeweils in einer eigenen Transaktion, sodass kein Schreiber lange auf einen anderen wartet. Eine Zeile, an der sich nichts geändert hat, wird bis zu 5 Minuten lang nicht neu geschrieben, was das Write-Ahead-Log um mehr als das Zwanzigfache senkt |

## Nutzung und Ausgaben

Die [Seite Ausgaben](/docs/telemetry/openstack#ausgaben) einer Cloud liest die Zeilen des Inventars statt der Serien einer Instanz, sodass sie im Summary-Modus genauso funktioniert und ihre Kosten mit den Projekten wachsen statt mit den Instanzen. Sie liest eine Zeile der Cloud und eine Seite von Projekten. [Ihr eigener Abschnitt](/docs/telemetry/openstack#bei-jeder-größe) enthält die Zahlen in jeder Größe.

## Nächste Schritte

:::cards
- [OpenStack-Agent](/docs/telemetry/openstack): Den Agent installieren.
- [OpenStack ohne Agent](/docs/telemetry/openstack-agentless): Eine Cloud mit einer Sonde erfassen.
- [OpenStack-Monitor](/docs/monitor/openstack-monitor): Warnungen für das, was ankommt.
:::
