# Dashboards – Überblick

Dashboards verwandeln die Daten, die OneUptime bereits sammelt – Metriken, Logs, Traces, Vorfälle, Monitore, Kubernetes-Ressourcen, Hosts – in eine einzige Seite, auf der man mit einem Blick erkennt, was los ist.

Platzieren Sie ein Diagramm zur Anfrage-Latenz neben einer Liste offener Vorfälle, daneben eine Anzeige für die CPU und einen Textabschnitt mit Kontext. Speichern. Link teilen.

## Wofür Dashboards gut sind

- **Eine „Ist alles in Ordnung?"-Seite** – für die Rufbereitschaft, das tägliche Standup oder ein Wand-TV.
- **Zusammenhänge erkennen** – ein CPU-Spitzenwert zur selben Zeit wie ein Latenzanstieg und ein offener Vorfall ist auf einer Seite viel leichter zu sehen als über drei Tabs verteilt.
- **Untersuchen** – wenn Sie ein Problem analysieren, schlägt ein spontan zusammengestelltes Dashboard zehn nacheinander ausgeführte Abfragen.
- **Extern teilen** – eine kundenseitige Performance-Seite, ein Partner-Statusbereich, ein öffentliches Dashboard für ein Open-Source-Projekt.

## Was Sie auf einem Dashboard platzieren können

- **Diagramme** für Trends im Zeitverlauf – Latenz, Fehler, Durchsatz.
- **Einzelwertfelder und Anzeigen** – aktuelle Fehlerquote, CPU, offene Vorfälle.
- **Tabellen** für Aufschlüsselungen – Top-10-lauteste Hosts, Fehler je Service.
- **Textblöcke** für Überschriften, Kontext und Links zu Runbooks.
- **Live-Listen** von Vorfällen, Benachrichtigungen, Monitoren, Logs, Traces, Kubernetes-Ressourcen, Docker-Ressourcen und Hosts.

Die vollständige Liste mit dem, was jedes Widget zeigt, finden Sie unter [Widgets](/docs/dashboards/widgets).

## Wichtige Begriffe

| Begriff            | Bedeutung                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Dashboard**      | Die gesamte Seite – ein Name, ein Raster aus Widgets, Steuerung des Zeitbereichs und eine Liste von Variablen. |
| **Widget**         | Eine Kachel auf der Seite – ein Diagramm, eine Zahl, eine Liste, ein Textabschnitt.                            |
| **Variable**       | Ein Dropdown oben, das alle Widgets gleichzeitig filtert (Cluster, Service, Kunde, Umgebung).                  |
| **Zeitbereich**    | Das Zeitfenster, das jedes Diagramm und jede Zahl verwendet. Wird einmal oben auf der Seite eingestellt.       |
| **Aktualisierung** | Wie oft Widgets die Daten neu abfragen. Aus, alle paar Sekunden, alle paar Minuten.                            |
| **Modus**          | Entweder **Bearbeiten** (Widgets verschieben) oder **Ansicht** (nur lesen, wie Besucher sie sehen).            |

## Wo Sie Dashboards finden

Öffnen Sie **Dashboards** in der linken Navigation.

| Seite                         | Was Sie dort tun                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| **Dashboards**                | Ihre Liste der Dashboards. Neues erstellen, suchen oder nach Label filtern.             |
| **Dashboard → Ansicht**       | Die Arbeitsfläche. Im Kopfbereich wechseln Sie zwischen **Bearbeiten** und **Ansicht**. |
| **Dashboard → Übersicht**     | Beschreibung, Eigentümer und Labels.                                                    |
| **Dashboard → Einstellungen** | Öffentliche Freigabe, Passwort, IP-Zugriffsliste, eigene Domain, Branding.              |
| **Dashboard → Eigentümer**    | Benutzer und Teams mit explizitem Zugriff.                                              |
| **Dashboard → Löschen**       | Das Dashboard entfernen.                                                                |

## Ein Dashboard aufbauen

1. **Erstellen** – wählen Sie einen Namen. Die Arbeitsfläche öffnet sich leer.
2. **Widgets hinzufügen** – Widget-Typ wählen, dessen Daten konfigurieren und an die gewünschte Stelle ziehen.
3. **(Optional) Variablen hinzufügen** – zum Beispiel ein Dropdown `service`, damit dasselbe Dashboard für jeden Service funktioniert.
4. **Zeitbereich einstellen** – die Voreinstellungen passen meist; später feinjustieren.
5. **(Optional) Öffentlich freigeben** – den Schalter in den Einstellungen umlegen, bei Bedarf Passwort oder IP-Zugriffsliste hinzufügen.
6. **(Optional) Eigene Domain** – das Dashboard auf `status.ihre-domain.de` hosten.

## Ein kurzes Beispiel

Ziel: eine Rufbereitschafts-Seite für den Checkout-Service mit Latenz, Fehlerquote, offenen Vorfällen und einem Live-Log-Stream.

1. Erstellen Sie ein Dashboard mit dem Namen „Checkout Rufbereitschaft".
2. Fügen Sie eine Variable `service` hinzu. Standardwert `checkout`.
3. Fügen Sie ein **Diagramm**-Widget mit P95-Latenz hinzu, gefiltert nach der Variablen `service`.
4. Daneben ein **Wert**-Widget für die Fehlerquote, mit Warnung bei 1 % und kritisch bei 5 %.
5. Darunter ein **Vorfall-Liste**-Widget für Vorfälle mit dem Label `checkout`.
6. Darunter ein **Log-Stream**-Widget, das Logs desselben Service zeigt.
7. Speichern. Wechseln Sie das Dropdown auf `payments` – dasselbe Dashboard zeigt nun den Payments-Service.

## Wie Dashboards in OneUptime hineinpassen

- **Monitore und Telemetrie** sind die Datenquellen. Jede Metrik, jedes Log und jeder Trace, den Sie sammeln, ist in einem Widget abfragbar.
- **Vorfälle und Benachrichtigungen** tauchen in Widgets vom Typ **Vorfall-Liste** und **Benachrichtigungs-Liste** auf. Dashboards sind dafür nur lesend – erstellen und aktualisieren Sie diese an anderer Stelle.
- **Statusseiten** sind die kundenseitige Kommunikation („Funktioniert das System?"). Dashboards dienen dazu, im Detail zu sehen, wie sich das System verhält. Beide ergänzen sich, sie ersetzen einander nicht.
- **Workflows** sind das Mittel, mit dem OneUptime handelt. Dashboards sind das Mittel, mit dem Sie sehen, was passiert.

## Weiterführende Themen

- [Dashboard erstellen](/docs/dashboards/authoring) – Arbeitsfläche nutzen, Widgets bearbeiten.
- [Widgets](/docs/dashboards/widgets) – die vollständige Liste der Widgets.
- [Variablen & Filter](/docs/dashboards/variables) – ein Dashboard für viele Services oder Kunden nutzbar machen.
- [Freigabe & öffentliche Dashboards](/docs/dashboards/sharing) – öffentliche URLs, Passwörter, IP-Zugriffsliste, eigene Domains.
- [Konfiguration & Berechtigungen](/docs/dashboards/configuration) – Eigentümer, Labels, Zugriffskontrolle.
