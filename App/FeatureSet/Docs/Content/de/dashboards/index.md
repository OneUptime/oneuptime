# Dashboards – Übersicht

Dashboards sind die Art, wie Sie die Telemetrie, die OneUptime bereits sammelt — Metriken, Logs, Traces, Vorfälle, Monitore, Kubernetes- und Docker-Ressourcen — in eine einzige Seite verwandeln, auf die jemand einen Blick werfen und den Gesundheitszustand eines Systems verstehen kann.

Legen Sie ein Diagramm für die Anfragelatenz neben eine Liste offener Vorfälle neben ein Gauge für die CPU-Auslastung neben einen Statussatz in einfacher Sprache. Speichern Sie es. Teilen Sie den Link.

## Auf einen Blick

- **Top-Level-Feature** im OneUptime-Dashboard unter **Dashboards**.
- **Rasterbasierte Arbeitsfläche** — standardmäßig 12 Einheiten breit und 60 Einheiten hoch. Ziehen Sie Widgets hinein, ändern Sie ihre Größe, lassen Sie sie am Raster einrasten.
- **Mehr als 20 Widget-Typen** — Diagramme, Einzelwerte, Gauges, Tabellen, Textblöcke, Log-Streams, Trace-Listen und Live-Ressourcenlisten für Vorfälle, Warnmeldungen, Monitore, Kubernetes (Pods, Nodes, Deployments, …), Docker und Hosts.
- **Variablen und Filter** — verwandeln Sie ein einzelnes Dashboard in eine Vorlagenansicht, die für jeden Cluster, Service, Kunden oder jede Umgebung wiederverwendet wird.
- **Öffentliches Teilen** — legen Sie einen Schalter um und das Dashboard ist über eine öffentliche URL erreichbar, mit optionalem Passwortschutz und IP-Allowlisting.
- **Benutzerdefinierte Domains** — hosten Sie ein öffentliches Dashboard unter `status.your-domain.com` anstelle der OneUptime-Domain.

## Warum Dashboards verwenden?

Dashboards rechtfertigen sich, wenn eines davon zutrifft:

- **Sie benötigen eine „Ist alles in Ordnung?"-Seite** für eine Bereitschaftsrotation, ein Team-Standup oder einen CEO, der am Wand-TV vorbeiläuft.
- **Sie müssen Signale korrelieren** — eine CPU-Spitze zur selben Minute wie eine Erhöhung der Trace-Latenz und ein offener Vorfall ist auf einem Dashboard viel offensichtlicher als über drei Tabs verteilt.
- **Sie ermitteln** — ein freiformatiges Dashboard, das Sie während einer Debugging-Session bauen, ist schneller als zehn Abfragen von Hand auszuführen.
- **Sie veröffentlichen extern** — ein kundengerichtetes Performance-Dashboard, eine partnergerichtete Übersicht, eine öffentliche Gesundheitstafel für einen Open-Source-Service.

## Schlüsselbegriffe

| Begriff | Bedeutung |
| --- | --- |
| **Dashboard** | Die Arbeitsfläche. Eine benannte, wiederverwendbare Ansicht, die eine Liste von Widgets, eine Zeitbereichssteuerung und einen Satz Variablen enthält. |
| **Widget** | Eine Komponente auf der Arbeitsfläche — ein Diagramm, ein Wert, eine Tabelle, ein Textblock, eine Liste. Jedes hat einen Typ und eine JSON-artige Konfiguration. |
| **Dashboard-Einheit** | Das Rasterquadrat. Widgets werden in Dashboard-Einheiten dimensioniert (z. B. „4 breit × 6 hoch"). Einheiten werden basierend auf dem Viewport in Pixel umgerechnet. |
| **Variable** | Ein benannter Wert, den der Betrachter aus einem Dropdown auswählt (oder eingibt) und den das Dashboard in die Abfrage jedes Widgets einfügt. Cluster, Service, Kunde, Umgebung — alles, wonach Sie filtern würden. |
| **Zeitbereich** | Das Zeitfenster, gegen das jedes Widget abfragt. Wählen Sie eine Voreinstellung („letzte 24 Stunden") oder einen benutzerdefinierten Bereich. |
| **Aktualisierungsintervall** | Wie oft Widgets im **Anzeige**-Modus erneut abfragen. Aus, 5s, 10s, 30s, 1m, 5m, 15m. |
| **Modus** | `Edit` (ziehen, Größe ändern, konfigurieren) oder `View` (schreibgeschützt). Beide teilen sich dieselbe Arbeitsfläche. |

## Der Widget-Katalog

Eine nicht erschöpfende Übersicht dessen, was Sie auf ein Dashboard setzen können:

| Kategorie | Widgets |
| --- | --- |
| **Zeitreihen** | Chart |
| **Einzelne Zahl** | Value, Gauge |
| **Tabellarisch** | Table |
| **Annotation** | Text |
| **Logs & Traces** | LogStream, TraceList |
| **Betriebslisten** | IncidentList, AlertList, MonitorList |
| **Kubernetes** | KubernetesPodList, KubernetesNodeList, KubernetesNamespaceList, KubernetesDeploymentList, KubernetesStatefulSetList, KubernetesDaemonSetList, KubernetesJobList, KubernetesCronJobList |
| **Docker** | DockerHostList, DockerContainerList, DockerImageList, DockerNetworkList, DockerVolumeList |
| **Infrastruktur** | HostList |

Für die Argumente jedes Widgets und wann Sie dazu greifen, siehe [Widgets](/docs/dashboards/widgets).

## Wo Dashboards im Dashboard leben

| Seite | Was Sie dort tun |
| --- | --- |
| **Dashboards** | Dashboards durchsuchen, erstellen, suchen, beschriften. |
| **Ein Dashboard → View** | Die Arbeitsfläche — Edit-Modus für Autoren, View-Modus für alle anderen. Wechseln Sie zwischen ihnen in der Kopfzeile. |
| **Ein Dashboard → Overview** | Beschreibung, Ownership, Labels. |
| **Ein Dashboard → Settings** | Öffentliches Teilen, Master-Passwort, IP-Allowlist, benutzerdefinierte Domains, Branding (Seitentitel, Beschreibung, Logo, Favicon). |
| **Ein Dashboard → Owners** | Benutzer und Teams mit explizitem Ownership. |
| **Ein Dashboard → Delete** | Das Dashboard entfernen (unwiderruflich). |

## Der Lebenszyklus eines Dashboards

1. **Erstellen** — Unter **Dashboards → Dashboard erstellen** geben Sie ihm einen Namen. Die Arbeitsfläche öffnet sich leer.
2. **Widgets ablegen** — Aus der Widget-Palette wählen Sie einen Typ aus, konfigurieren seine Quelle (eine Metrik-Abfrage, einen Listenfilter, einen freien Textkörper). Positionieren und Größe ändern.
3. **(Optional) Variablen hinzufügen** — Definieren Sie ein Dropdown wie `cluster` oder `service`, damit dasselbe Dashboard für jeden Wert gerendert wird.
4. **Zeitbereich und Aktualisierungsintervall festlegen** — die Standardwerte funktionieren gut; passen Sie sie später an.
5. **(Optional) Öffentlich teilen** — Unter **Settings** schalten Sie **Public Dashboard** ein. Fügen Sie ein Master-Passwort hinzu, wenn Sie eine Zugriffskontrolle möchten, oder beschränken Sie nach IP.
6. **(Optional) Benutzerdefinierte Domain** — Fügen Sie einen `dashboard.your-domain.com`-Datensatz hinzu und verifizieren Sie DNS, dann wird das Dashboard unter Ihrer eigenen URL bereitgestellt.

## Ein durchgespieltes Beispiel

Ziel: eine Bereitschafts-Seite für den Checkout-Service mit Latenz, Fehlerrate, offenen Vorfällen und einem aktuellen Log-Tail.

1. Erstellen Sie ein Dashboard „Checkout-Bereitschaft".
2. Fügen Sie eine `service`-Variable vom Typ **Telemetrie-Attribut** hinzu, gebunden an den Attributschlüssel `service.name`. Standardwert `checkout`.
3. Fügen Sie ein **Chart**-Widget hinzu: P95-Latenz aus Ihrer APM-Metrik, gefiltert nach `service.name = {{service}}`. Zeitbereich folgt dem Dashboard.
4. Daneben fügen Sie ein **Value**-Widget hinzu: Fehlerrate in Prozent mit einem Warnschwellenwert bei 1 % und einem kritischen Schwellenwert bei 5 %.
5. Darunter fügen Sie ein **IncidentList**-Widget hinzu, gefiltert nach Labels, die `checkout` enthalten.
6. Darunter ein **LogStream**-Widget, gefiltert nach `service.name = {{service}}`.
7. Speichern. Ändern Sie das Variablen-Dropdown auf `payments` — das gesamte Dashboard wird für den Payments-Service neu gerendert. Gleiches Template, anderer Filter.

## Wie Dashboards zum Rest von OneUptime passen

- **Monitore und Telemetrie** speisen Dashboards mit Rohdaten — jede Metrik, die Sie konfiguriert haben, jede Logzeile, die Sie aufgenommen haben, jeder Trace-Span ist auf einem Widget abfragbar.
- **Vorfälle und Warnmeldungen** erscheinen in **IncidentList**- und **AlertList**-Widgets — Dashboards sind schreibgeschützte Ansichten darauf; erstellen/bearbeiten Sie diese Entitäten anderswo.
- **Statusseiten** sind ein kundengerichtetes Kommunikationswerkzeug („läuft das System gerade?"). Dashboards sind ein analytisches Werkzeug („wie verhält sich das System im Detail?"). Die beiden ergänzen sich, sie sind kein Ersatz füreinander.
- **Workflows** sind die Schreibseite von OneUptime — Dashboards sind die Leseseite.

## Wo weiterlesen

- [Ein Dashboard erstellen](/docs/dashboards/authoring) — Verwendung der Arbeitsfläche, des Rasters, Edit- vs. View-Modus.
- [Widgets](/docs/dashboards/widgets) — der Katalog und die Konfiguration pro Widget.
- [Variablen & Filter](/docs/dashboards/variables) — ein Dashboard so anlegen, dass es für viele Services / Kunden / Cluster funktioniert.
- [Teilen & öffentliche Dashboards](/docs/dashboards/sharing) — öffentliche URLs, Master-Passwort, IP-Allowlist, benutzerdefinierte Domains.
- [Konfiguration & Berechtigungen](/docs/dashboards/configuration) — Ownership, Labels, Aufbewahrung, rollenbasierter Zugriff.
