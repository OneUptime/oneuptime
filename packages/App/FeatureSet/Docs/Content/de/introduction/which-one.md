# Was nehme ich wann?

Manches in OneUptime sieht sich ähnlich. Diese Seite stellt jede dieser Gruppen nebeneinander, mit dem, wofür jedes Teil gedacht ist, damit Sie gleich beim ersten Mal das Richtige wählen. Jede Tabelle passt auf einen Bildschirm, und ihre erste Spalte öffnet die Seite, die diese Wahl ausführlich behandelt.

:::cards
- [Vorfall, Warnung oder eine andere Art von Problem?](#vorfall-warnung-oder-eine-andere-art-von-problem): Was aus einem Problem in OneUptime wird.
- [Workflow, Runbook, Playbook oder KI-Regel?](#workflow-runbook-playbook-oder-ki-regel): Womit Sie automatisieren.
- [Monitor-Gruppe, Dienst oder Beschriftung?](#monitor-gruppe-dienst-oder-beschriftung): Wie Sie gruppieren, was Sie überwachen.
- [Sonde, Agent, Collector oder Runner?](#sonde-agent-collector-oder-runner): Was Sie installieren, und welchen Schlüssel jedes Teil braucht.
- [Dashboard, öffentliches Dashboard oder Statusseite?](#dashboard-öffentliches-dashboard-oder-statusseite): Was Sie teilen, und mit wem.
:::

## Vorfall, Warnung oder eine andere Art von Problem?

Die meisten Probleme sind ein Vorfall oder eine Warnung: Wählen Sie danach, wen das Problem betrifft. Die anderen sind Datensätze, die OneUptime für Sie führt, und jeder davon kann zu einem Vorfall oder einer Warnung führen.

| Datensatz | Was es ist | Wann es passt |
| --- | --- | --- |
| [Vorfall](/docs/incidents/index) | Ein Problem, das Ihre Nutzer betrifft. Er kann die Bereitschaft alarmieren und auf Ihren Statusseiten erscheinen. | Kunden bemerken es oder werden es bald bemerken: ein Ausfall, eine Verlangsamung, ein Checkout, der fehlschlägt. |
| [Warnung](/docs/alerts/index) | Ein Problem für Ihr Team. Sie kann die Bereitschaft alarmieren, erscheint aber nie auf einer Statusseite. | Ihr Team sollte handeln, bevor Nutzer etwas bemerken: eine Festplatte, die vollläuft, ein Zertifikat kurz vor dem Ablauf. |
| [Episode](/docs/incidents/episodes) | Eine Gruppe zusammengehöriger Vorfälle oder zusammengehöriger Warnungen, die als eins bearbeitet wird. | Eine Ursache hat viele Vorfälle oder Warnungen ausgelöst. Gruppierungsregeln eröffnen Episoden für Sie. |
| [Ausnahme](/docs/telemetry/exceptions) | Jedes Auftreten eines Fehlers, den Ihr Code wirft, zusammengefasst, mit seinem Stacktrace. | Sie wollen einen Bug beheben. Eine Ausnahmen-Überwachung kann eine Warnung oder einen Vorfall auslösen, wenn Fehler sprunghaft ansteigen. |
| [KI-Einblick](/docs/ai/ai-sre#einblicke-proaktive-erkennung) | Ein Problem, das OneUptime in Ihrer Telemetrie gefunden hat, bevor irgendetwas alarmiert hat, etwa eine Spitze bei Fehlerprotokollen. | Sie wollen frühe Warnzeichen. Ein Einblick alarmiert nie jemanden und eröffnet nie einen Vorfall: Er wartet in einem Posteingang. |
| [Sicherheitsfall](/docs/telemetry/security-cases) | Eine Bedrohung, die eine Untersuchung wert ist, mit jeder Erkennung zum selben Benutzer, Host oder zur selben Adresse darin. | Ihr Sicherheitsteam untersucht. **Vorfall melden** an einem Fall eröffnet einen Vorfall, wenn Nutzer betroffen sind. |

Eine Warnung lässt sich mit dem Vorfall verknüpfen, zu dem sie sich als zugehörig erweist, sodass beim Start mit einer Warnung nichts verloren geht.

## Workflow, Runbook, Playbook oder KI-Regel?

Alle vier können von selbst laufen. Wählen Sie danach, worauf sie wirken und wer die Schritte geschrieben hat.

| Werkzeug | Was es tut | Wann es passt |
| --- | --- | --- |
| [Workflow](/docs/workflows/index) | Bausteine auf einer Arbeitsfläche, die laufen, wenn ihr Trigger auslöst: Ein Vorfall wird angelegt, ein Zeitplan ist fällig, ein anderes Tool ruft eine URL auf. | Sie wollen OneUptime mit anderen Tools verbinden oder auf seine Datensätze reagieren, ohne Code zu schreiben. |
| [Runbook](/docs/runbooks/index) | Ihr Reaktionsverfahren als Schritte, von manuellen Checklisten bis zu Skripten, HTTP-Anfragen und kubectl, ausgeführt für einen Vorfall, eine Warnung oder ein Wartungsereignis. | Einsatzkräfte sollen jedes Mal dieselben Schritte befolgen. Runbook-Regeln starten ein Runbook für die passenden Vorfälle. |
| [Playbook](/docs/telemetry/security-cases#playbooks) | Schritte, die auf einen Sicherheitsfall reagieren: die Beweise sichern, die Bereitschaft alarmieren, einen Benutzer sperren. | Ihr Sicherheitsteam reagiert auf dieselbe Art von Bedrohung jedes Mal auf dieselbe Weise. |
| [KI-Regel](/docs/ai/ai-sre#welche-vorfälle-untersucht-und-behoben-werden) | Entscheidet, welche neuen Vorfälle und Warnungen OneUptime AI untersucht und behebt, und ob sie vorher fragt. | OneUptime AI soll nur an manchen Vorfällen arbeiten oder ohne Nachfrage beheben. Ohne Regel untersucht sie alle. |

## Monitor-Gruppe, Dienst oder Beschriftung?

Alle drei fassen Dinge zusammen, für verschiedene Leser. Sie wirken auch zusammen: Die Monitore eines Dienstes können eine Monitor-Gruppe bilden, und alle können dieselbe Beschriftung tragen.

| Wahl | Was es ist | Wann es passt |
| --- | --- | --- |
| [Monitor-Gruppe](/docs/monitor/monitor-groups) | Mehrere Monitore, zu einem Status zusammengefasst, dem schlimmsten unter ihnen, mit eigener Verfügbarkeit. | Kunden sollen auf einer Statusseite eine Zeile für etwas sehen, das aus mehreren Monitoren besteht, etwa Checkout. |
| [Dienst](/docs/telemetry/services) | Eine Anwendung, die OneUptime in Ihrer Telemetrie gefunden hat, mit ihren Protokollen, Traces, Metriken, Vorfällen und Eigentümern auf einer Seite. | Sie wollen alles über eine Anwendung an einem Ort. Sie erscheint von selbst anhand ihres `service.name`. |
| [Beschriftung](/docs/configuration/label-and-owner-rules) | Ein Schlagwort, das Sie an Monitore und die meisten anderen Datensätze hängen. Ein Datensatz kann viele tragen. | Sie wollen Listen filtern, die Berechtigungen eines Teams beschränken oder Datensätze in Regeln herausgreifen. |

Monitor-Gruppen sind anfangs ausgeschaltet: Schalten Sie sie unter **Projekteinstellungen → Erweitert → Feature-Flags** ein.

## Sonde, Agent, Collector oder Runner?

Das meiste in OneUptime braucht keine Installation: Installieren Sie nur dann etwas, wenn Sie erreichen wollen, was OneUptime von außen nicht sehen kann. Jedes Teil verbindet sich ausgehend, mit einem Schlüssel seiner eigenen Art.

| Installation | Was es tut | Wann Sie es installieren | Welchen Schlüssel es braucht |
| --- | --- | --- | --- |
| [Benutzerdefinierte Sonde](/docs/probe/custom-probe) | Führt die Prüfungen Ihrer Monitore aus Ihrem Netzwerk heraus aus. | Was Sie prüfen, liegt hinter Ihrer Firewall. Die eigenen Sonden von OneUptime prüfen, was öffentlich ist. | Eigene Sonden-ID und eigener Schlüssel |
| [Infrastruktur-Agent](/docs/monitor/server-monitor) | Meldet CPU, Arbeitsspeicher, Festplatten und Prozesse eines Rechners an eine Server- / VM-Überwachung. | Sie wollen einen Monitor für einen Server, mit Kriterien auf seine Werte. | Der geheime Schlüssel des Monitors |
| [OpenTelemetry Collector](/docs/telemetry/hosts) | Sendet die Metriken, Protokolle und Prozesse eines Rechners. **Host hinzufügen** installiert ihn mit einem Befehl. | Sie wollen einen Rechner unter **Hosts**, mit seiner Telemetrie. | Ein Ingestion-Schlüssel |
| [Kubernetes-Agent](/docs/telemetry/kubernetes-agent) | Sammelt die Metriken, Ereignisse, Protokolle und Traces eines Clusters. Sie installieren ihn mit Helm. | Sie betreiben Kubernetes. | Ein Ingestion-Schlüssel |
| [Runner](/docs/runbooks/agents) | Führt Runbook-Schritte wie Bash, SSH und kubectl in Ihrer Infrastruktur aus. | Ihre Runbooks müssen Ihre eigenen Hosts und Cluster erreichen. | Eigene Runner-ID und eigener Schlüssel |

### Ingestion-Schlüssel oder API-Schlüssel?

| Schlüssel | Was Sie damit tun können | Wo Sie ihn anlegen |
| --- | --- | --- |
| [Ingestion-Schlüssel](/docs/telemetry/ingestion-keys) | Telemetrie in das Projekt senden, und sonst nichts. | **Projekteinstellungen → Telemetrie & APM → Ingestion-Schlüssel** |
| [API-Schlüssel](/docs/permissions/index#api-schlüssel) | Das Projekt über die API, die CLI, Terraform oder einen KI-Assistenten lesen und ändern, mit den Berechtigungen, die Sie ihm geben. | **Projekteinstellungen → Erweitert → API-Schlüssel** |

Keiner funktioniert anstelle des anderen.

## Dashboard, öffentliches Dashboard oder Statusseite?

Wählen Sie danach, wer es sehen soll.

| Teilen | Wer es sieht | Wann es passt |
| --- | --- | --- |
| [Dashboard](/docs/dashboards/index) | Personen, die sich bei Ihrem Projekt anmelden. | Ihr Team beobachtet Diagramme und Listen: ein Bildschirm für die Bereitschaft, die eigene Ansicht eines Teams. |
| [Öffentliches Dashboard](/docs/dashboards/sharing) | Jeder mit dem Link, es sei denn, Sie fügen ein Passwort hinzu, beschränken es auf bestimmte IP-Adressen oder hosten es auf Ihrer eigenen Domain. | Personen außerhalb des Projekts sollen Ihre Diagramme sehen, etwa ein Partner oder ein Bildschirm an der Wand. |
| [Statusseite](/docs/status-pages/index) | Ihre Kunden, öffentlich, oder nur die privaten Benutzer, die Sie hereinlassen. | Kunden wollen wissen, ob Ihre Dienste funktionieren, und über Vorfälle und Wartungen informiert werden. |

Eine Statusseite spricht in Vorfällen und in den Namen, die Sie Ihren Monitoren geben; ein Dashboard zeigt die Zahlen dahinter.

## Nächste Schritte

:::cards
- [Glossar](/docs/introduction/glossary): Jedes Wort, das OneUptime verwendet, in ein oder zwei Sätzen.
- [Grundkonzepte](/docs/introduction/core-concepts): Wie die Teile zusammenhängen, auf einer Seite.
- [Schnellstart](/docs/introduction/quickstart): Ein Monitor, eine Alarmierung und eine Statusseite in fünfzehn Minuten.
:::
