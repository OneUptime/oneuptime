# Glossar

Jedes Wort, das OneUptime verwendet, in ein oder zwei Sätzen, mit den anderen Namen, unter denen es bekannt ist, und der Seite, die es ausführlich behandelt. Die Wörter sind so gruppiert, wie Sie ihnen begegnen: Die erste Gruppe ist der Kreislauf, den jedes Projekt durchläuft, die letzte sind die Wörter, die mehr als eine Sache bedeuten.

:::cards
- [Hier beginnen](#hier-beginnen): Der Kreislauf, den jedes Projekt durchläuft, vom Monitor bis zur Alarmierung und zur Statusseite.
- [Was Sie überwachen](#was-sie-überwachen): Dienste, Hosts, Cluster, Clouds und die Ziele, an denen Sie sie messen.
- [An einem Problem arbeiten](#an-einem-problem-arbeiten): Status, Schweregrade, Eigentümer und Beschriftungen, und die anderen Arten von Problemen.
- [Telemetrie und Dashboards](#telemetrie-und-dashboards): Was Ihre Systeme senden, und wo Sie es sich ansehen.
- [Automatisierung und KI](#automatisierung-und-ki): Was von selbst läuft, und was OneUptime AI tut.
- [Was Sie installieren, und die Schlüssel dazu](#was-sie-installieren-und-die-schlüssel-dazu): Die Agenten, die Sie betreiben, und der Schlüssel, den jeder braucht.
- [Wörter mit mehr als einer Bedeutung](#wörter-mit-mehr-als-einer-bedeutung): Regel, Rolle, Ressource, Einstellungen und die anderen Wörter mit mehreren Aufgaben.
:::

## Hier beginnen

### Projekt

Wo alles liegt, was Sie einrichten: Monitore, Vorfälle, Bereitschaft, Statusseiten, Telemetrie und Einstellungen. Nichts aus einem Projekt ist in einem anderen sichtbar, und die meisten Unternehmen brauchen nur eines.

Siehe [Grundkonzepte](/docs/introduction/core-concepts#projekte-und-personen).

### Konto

Sie selbst: die E-Mail-Adresse und das Passwort, mit denen Sie sich anmelden, Ihr Name, Ihre Zeitzone und Ihre Sprache. Ein Konto kann zu beliebig vielen Projekten gehören.

Siehe [Ihr Konto](/docs/introduction/your-account).

### Team

Eine Gruppe von Personen in einem Projekt, deren Berechtigungen bestimmen, was ihre Mitglieder tun dürfen. Jedes neue Projekt beginnt mit drei Teams: Owners, Admin und Members. Laden Sie Personen unter **Benutzer** ein, und gruppieren Sie sie unter **Teams**.

Siehe [Benutzer, Teams & Berechtigungen](/docs/permissions/index).

### Überwachung

Prüft eine Sache, die Sie betreiben, etwa eine Website, eine API, einen Server oder einen Kubernetes-Cluster, und entscheidet, ob sie funktioniert. Treffen die Kriterien des Monitors zu, ändert er seinen Status und kann einen Vorfall melden oder eine Warnung erstellen.

Siehe [Einen Monitor erstellen](/docs/monitor/create-monitor).

### Kriterien

Die Regeln eines Monitors: was jedes Prüfergebnis bedeutet. Sie werden der Reihe nach geprüft, und die erste zutreffende kann den Status des Monitors ändern, einen Vorfall melden, eine Warnung erstellen oder alles drei.

Auch genannt: **Überwachungskriterien**, **Monitor-Kriterien**, **Monitor-Schritte**. Siehe [Kriterien & Status](/docs/monitor/criteria-and-statuses).

### Monitor-Status

In welchem Zustand ein Monitor gerade ist. Jedes neue Projekt hat drei Monitor-Status, **Betriebsbereit**, **Beeinträchtigt** und **Offline**, und Sie können eigene hinzufügen.

Siehe [Kriterien & Status](/docs/monitor/criteria-and-statuses).

### Sonde

Ein Rechner, der die Prüfungen von Monitoren nach Zeitplan ausführt: Er ruft eine Seite ab, ruft eine API auf oder pingt einen Host an. OneUptime Cloud betreibt Sonden in mehreren Regionen, und eine benutzerdefinierte Sonde, die Sie in Ihrem eigenen Netzwerk betreiben, prüft, was nur dieses Netzwerk erreicht.

Auch genannt: **Benutzerdefinierte Sonden**. Siehe [Benutzerdefinierte Probes](/docs/probe/custom-probe).

### Vorfall

Ein Problem, das Ihre Nutzer betrifft, etwa ein Ausfall oder eine Verlangsamung, und der Datensatz, mit dem Ihr Team arbeitet, solange es andauert. Er kann die Bereitschaft alarmieren und auf Ihren Statusseiten erscheinen.

Siehe [Vorfälle – Übersicht](/docs/incidents/index).

### Warnung

Ein Problem, das sich Ihr Team ansehen sollte, bevor Nutzer es bemerken, etwa eine Festplatte, die vollläuft, oder ein Zertifikat kurz vor dem Ablauf. Sie kann die Bereitschaft alarmieren, erscheint aber nie auf einer Statusseite.

Siehe [Warnungen – Übersicht](/docs/alerts/index).

### Episode

Eine Gruppe zusammengehöriger Vorfälle oder zusammengehöriger Warnungen, die Ihr Team als eins bearbeitet, mit einer gemeinsamen Gruppe von Eigentümern und einem gemeinsamen Status. Gruppierungsregeln entscheiden, was in welche Episode gehört.

Auch genannt: **Vorfallsepisode**, **Warnungsepisode**. Siehe [Episoden](/docs/incidents/episodes).

### Bereitschaftsrichtlinie

Entscheidet, wer zu einem Vorfall, einer Warnung oder einer Episode alarmiert wird und wer als Nächstes dran ist, wenn niemand bestätigt. Ihre Stufen sind Eskalationsregeln.

Auch genannt: **Bereitschaftsdienst**, **Bereitschaft**, `OnCallDutyPolicy`. Siehe [Bereitschaftsrichtlinien](/docs/on-call/policies).

### Eskalationsregel

Eine Stufe einer Bereitschaftsrichtlinie: wer alarmiert wird und wie lange auf eine Bestätigung gewartet wird, bevor die nächste Stufe alarmiert wird. Eine Stufe kann Personen, Teams oder einen Bereitschaftsplan alarmieren.

Siehe [Eskalationsregeln](/docs/on-call/escalation-rules).

### Bereitschaftszeitplan

Wer zu jedem Zeitpunkt Bereitschaft hat: Personen wechseln sich ab, und jede übergibt an die nächste. Eine Eskalationsregel, die einen Plan alarmiert, alarmiert die Person, die darin gerade Bereitschaft hat.

Auch genannt: **Rotation**, **Bereitschaftsplan der Richtlinie**. Siehe [Bereitschaftspläne](/docs/on-call/schedules).

### Ebene

Eine Rotation innerhalb eines Bereitschaftsplans: wer sich abwechselt, wie oft übergeben wird und welche Zeiten sie abdeckt. Es alarmiert die oberste Ebene, in der gerade jemand Bereitschaft hat, daher gehört die Hauptrotation nach oben und die Vertretung darunter.

Siehe [Bereitschaftspläne](/docs/on-call/schedules#ebenen).

### Benachrichtigungsmethode

Eine Adresse, unter der OneUptime Sie in einem Projekt erreichen darf: eine E-Mail-Adresse, eine Telefonnummer für SMS oder Anrufe, Ihr Slack- oder Microsoft-Teams-Konto oder die OneUptime-App auf Ihrem Telefon. Jede Person fügt ihre eigenen unter **Benutzereinstellungen** hinzu.

Siehe [Benachrichtigungsmethoden](/docs/notifications/notification-methods).

### Wie ich erreichbar bin

Ihre eigenen Regeln, wie Sie alarmiert werden: welche Ihrer Benachrichtigungsmethoden eine Alarmierung versucht, und nach welcher Zeit. Eine Leiter gilt für jeden Vorfall, jede Warnung und jede Episode, und ein Schweregrad kann eigene Regeln haben. Jede Person legt ihre eigenen unter **Benutzereinstellungen** fest.

Auch genannt: **Persönliche Bereitschaftsregeln**. Siehe [Wie ich erreichbar bin](/docs/notifications/on-call-rules).

### Statusseite

Eine Seite, die Ihren Kunden zeigt, ob Ihre Dienste funktionieren, und welche Vorfälle und Wartungen sie betreffen. Sie kann öffentlich sein oder privat für die Personen, die Sie hereinlassen.

Siehe [Statusseiten – Übersicht](/docs/status-pages/index).

### Abonnent

Jemand, der einer Statusseite per E-Mail, SMS, Slack, Microsoft Teams oder Webhook folgt und informiert wird, wenn ein Vorfall oder eine Wartung darauf beginnt, sich ändert und endet.

Siehe [Abonnenten & Ankündigungen](/docs/status-pages/subscribers).

### Geplante Wartung

Geplante Arbeiten, vorab angekündigt. Jedes Wartungsereignis durchläuft die Wartungsstatus **Geplant**, **Laufend**, **Beendet** und **Abgeschlossen**, und die Statusseiten, auf denen es angezeigt wird, informieren Besucher und Abonnenten darüber.

Auch genannt: **Geplantes Wartungsereignis**, **Geplantes Ereignis**, **Ereignis**. Siehe [Geplante Wartung – Übersicht](/docs/scheduled-maintenance/index).

### Telemetrie

Was Ihre Systeme an OneUptime senden: Protokolle, Metriken, Traces, Ausnahmen und Profile. Anwendungen senden sie mit OpenTelemetry, und die Agenten von OneUptime senden sie von Hosts, Clustern und anderer Infrastruktur, jeweils mit einem Ingestion-Schlüssel.

Siehe [OpenTelemetry](/docs/telemetry/open-telemetry).

## Was Sie überwachen

### Monitor-Gruppe

Mehrere Monitore, zu einem Status zusammengefasst, dem schlimmsten unter ihnen, mit eigener Verfügbarkeit. Eine Statusseite kann die ganze Gruppe als eine Zeile anzeigen. Schalten Sie Monitor-Gruppen unter **Projekteinstellungen → Erweitert → Feature-Flags** ein.

Siehe [Monitor-Gruppen](/docs/monitor/monitor-groups).

### Dienst

Eine Anwendung oder ein Microservice, den Sie betreiben. OneUptime legt ihn an, sobald seine Telemetrie zum ersten Mal eintrifft, benannt nach seinem `service.name`, und führt seine Protokolle, Traces, Metriken, Ausnahmen, Vorfälle und Eigentümer auf einer Seite zusammen.

Auch genannt: **Dienstkatalog**, **Telemetrie-Dienst**. Siehe [Dienste](/docs/telemetry/services).

### Host

Ein Linux-, Windows- oder macOS-Rechner, der seine Metriken, Prozesse, Protokolle und Dienstzustände über den OpenTelemetry Collector sendet. **Host hinzufügen** installiert den Collector mit einem Befehl, und OneUptime hält seine Konfiguration aktuell.

Siehe [Hosts](/docs/telemetry/hosts).

### Kubernetes

Ihre Kubernetes-Cluster mit ihren Knoten, Pods, Workloads, Ereignissen und Protokollen, gesendet vom Kubernetes-Agenten, den Sie mit Helm installieren.

Siehe [Kubernetes-Agent](/docs/telemetry/kubernetes-agent).

### Infrastruktur

Die Menügruppe der Rechner und Plattformen, die Sie betreiben: Hosts, Kubernetes, Docker, Docker Swarm, Podman, Proxmox, OpenStack, VMware, Ceph, Speicher-Arrays, Netzwerk und IoT. Ein Agent oder eine Verbindung füllt jeden Eintrag, und jeder zeigt, wie es jedem Rechner, Cluster oder Gerät darin geht.

Siehe [Hosts](/docs/telemetry/hosts).

### Netzwerk

Ihre Switches, Router, Firewalls, Access Points und alles andere mit einer Adresse in Ihrem Netzwerk, ob es SNMP spricht oder nicht.

Siehe [Netzwerkgeräte-Überwachung](/docs/monitor/network-device-monitor).

### Cloud

Ihre AWS-Konten, Azure-Abonnements und Google-Cloud-Projekte, verbunden über das Dashboard. OneUptime listet jede Ressource darin auf, liest ihre wichtigsten Metriken und hält fest, was sich darin geändert hat.

Siehe [Ein Cloud-Konto verbinden](/docs/telemetry/cloud-accounts).

### App-Plattformen

Die Anwendungen, die Sie auf verwalteten Plattformen wie Amazon ECS und Fargate, Google Cloud Run und Azure App Service betreiben. Jeder Ort, an dem sie laufen, ist eine Cloud-Umgebung, die OneUptime anlegt, sobald ihre Telemetrie zum ersten Mal eintrifft.

Auch genannt: **Cloud-Umgebung**. Siehe [Cloud-Umgebungen](/docs/telemetry/cloud-environments).

### Serverlos

Ihre Serverless-Funktionen, etwa AWS Lambda, Google Cloud Functions und Azure Functions, aufgelistet mit ihren Traces, Protokollen und Metriken, sobald ihre OpenTelemetry-Daten eintreffen.

Auch genannt: **Serverless-Funktionen**. Siehe [Serverless-Funktionen](/docs/telemetry/serverless-functions).

### Datenbanken

Jede Datenbank, die Ihre Anwendungen abfragen, zusammengesetzt aus Ihren Traces, den eigenen Metriken der Datenbank und den anderen Quellen, die OneUptime lesen kann, samt dem Zustand ihrer Engine.

Siehe [Datenbanken](/docs/telemetry/databases).

### Warteschlangen

Die Nachrichtenwarteschlangen und Topics, die Ihre Dienste nutzen, etwa Apache Kafka, RabbitMQ und Amazon SQS, aus Ihren Traces und den Metriken Ihrer Broker.

Siehe [Warteschlangen](/docs/telemetry/queues).

### Real User Monitoring

Was echte Menschen in Ihren Web- und Mobil-Apps erleben: Seitenaufrufe, Anfragen, Fehler und Core Web Vitals, gemeldet von der App selbst statt von einer Sonde.

Siehe [RUM – Übersicht](/docs/rum/index).

### Inventar

Eine einzige Liste von allem, was OneUptime über Ihre Umgebung weiß: Dienste, Hosts, Kubernetes-Objekte, virtuelle Maschinen, Netzwerkgeräte, Cloud-Ressourcen und die Dinge, die gar keine Telemetrie senden. Das meiste füllt sich von selbst.

Siehe [Inventar – Übersicht](/docs/inventory/overview).

### Topologie

Eine Karte davon, wie Ihre Systeme zusammenhängen, welche Dienste welche aufrufen und was wo läuft, gezeichnet aus der Telemetrie, die Sie bereits senden.

Siehe [Topologie](/docs/telemetry/topology).

### SLO

Ein Zuverlässigkeitsziel für das, was Sie überwachen, etwa 99,9 % der Zeit verfügbar über 30 Tage. OneUptime misst jedes SLO alle 5 Minuten anhand seiner Monitore.

Auch genannt: **Service Level Objective**. Siehe [SLOs – Übersicht](/docs/slo/introduction).

### Fehlerbudget

Die Ausfallzeit, die das Ziel eines SLO erlaubt: bei 99,9 % über 30 Tage 43 Minuten und 12 Sekunden. Bleibt viel davon übrig, können Sie Risiken eingehen; bleibt wenig, treten Sie kürzer und investieren in Stabilität.

Siehe [Fehlerbudgets](/docs/slo/error-budget).

## An einem Problem arbeiten

### Status

Wo ein Vorfall oder eine Warnung in Ihrer Reaktion steht. Jedes neue Projekt beginnt mit **Identifiziert**, **Bestätigt** und **Behoben**: Bestätigen sagt, dass sich jemand darum kümmert, und verhindert, dass die nächste Eskalationsstufe alarmiert wird, und Beheben schließt das Problem ab.

Auch genannt: **Vorfallsstatus**, **Warnungsstatus**. Siehe [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities).

### Schweregrad

Wie wichtig ein Vorfall oder eine Warnung ist. Ein neues Projekt beginnt mit Critical Incident, Major Incident und Minor Incident für Vorfälle sowie **Hoch** und **Niedrig** für Warnungen; benennen Sie sie um, färben Sie sie neu ein oder fügen Sie eigene hinzu.

Auch genannt: **Vorfallsschweregrad**, **Warnungsschweregrad**. Siehe [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities).

### Eigentümer

Eine Person oder ein Team, die für einen Datensatz verantwortlich sind, etwa einen Monitor, einen Vorfall oder eine Statusseite. Eigentümer werden informiert, wenn mit dem, was ihnen gehört, etwas passiert.

Siehe [Beschriftungs- und Eigentümerregeln](/docs/configuration/label-and-owner-rules).

### Beschriftung

Ein Schlagwort wie Production oder Checkout, das Sie an Monitore, Vorfälle, Statusseiten und die meisten anderen Datensätze hängen, um sie zu filtern und zu gruppieren. Die Berechtigungen eines Teams lassen sich auf die Datensätze mit bestimmten Beschriftungen beschränken.

Siehe [Beschriftungs- und Eigentümerregeln](/docs/configuration/label-and-owner-rules).

### Ausnahme

Ein Fehler, den Ihr Code wirft. OneUptime fasst jedes Auftreten desselben Fehlers zu einer Ausnahme zusammen, mit ihrem Stacktrace, ihrem Verlauf und den Anfragen, in denen sie auftrat.

Auch genannt: **Ausnahmenverfolgung**, `/telemetry-exception`. Siehe [Ausnahmen](/docs/telemetry/exceptions).

### KI-Einblicke

Probleme, die OneUptime in Ihrer Telemetrie findet, bevor irgendetwas alarmiert: neue und sprunghaft ansteigende Ausnahmen, Spitzen bei Fehlerprotokollen, langsamere Traces, abdriftende Metriken und Deployments, die etwas verschlechtert haben. Einblicke alarmieren nie jemanden und eröffnen nie Vorfälle; sie warten in einem Posteingang, bis jemand nachsieht. Die Seite **Einblicke** im KI-Bereich eines Produkts oder eines Datensatzes zeigt, was OneUptime AI dort gelernt hat.

Auch genannt: **Einblicke**. Siehe [AI SRE](/docs/ai/ai-sre#einblicke-proaktive-erkennung).

### Sicherheitsereignisse

Das SIEM von OneUptime: die Sicherheitsereignisse aus Ihren Protokollen, Ihren Sicherheitstools und allem anderen, was Sie senden, in einer einheitlichen Form neben Ihrer Telemetrie gespeichert, mit Erkennungsregeln, die darin Bedrohungen finden.

Auch genannt: **SIEM**. Siehe [Sicherheitsereignisse (SIEM)](/docs/telemetry/security-events).

### Sicherheitsfall

Eine Sache, die eine Untersuchung wert ist, aus Erkennungsregeln, Threat Intelligence oder einem verbundenen Sicherheitsprodukt, in der jede Erkennung zum selben Benutzer, Host oder zur selben Adresse gebündelt ist. Analysten bearbeiten Fälle in einer Warteschlange, und Playbooks reagieren darauf.

Auch genannt: **Fall**. Siehe [Sicherheitsfälle und Playbooks (SOAR)](/docs/telemetry/security-cases).

## Telemetrie und Dashboards

### Protokolle

Die Zeilen, die Ihre Dienste, Hosts und Agenten schreiben und die Sie im Protokoll-Explorer durchsuchen und mit einer Logs-Überwachung beobachten.

Siehe [Protokoll-Explorer](/docs/telemetry/logs-explorer).

### Metriken

Die Zahlen, die Ihre Dienste und Ihre Infrastruktur im Zeitverlauf melden, etwa Anfragezahlen, Latenz, CPU und Warteschlangentiefe.

Siehe [Metrik-Explorer](/docs/telemetry/metrics-explorer).

### Traces

Der Weg einer Anfrage durch Ihre Dienste, Schritt für Schritt. Jeder Schritt ist ein Span, mit seiner Dauer und seinem Ergebnis.

Siehe [Trace-Explorer](/docs/telemetry/traces-explorer).

### Profile

Wie Ihre Anwendung CPU-Zeit und Speicher verbraucht, Funktion für Funktion, gesendet von einem Profiler, der an die Pyroscope-kompatible API von OneUptime liefert.

Auch genannt: **Leistungsprofile**, **Kontinuierliches Profiling**. Siehe [Profile](/docs/telemetry/profiles).

### KI / LLM

Die Gespräche, die Ihre KI-Anwendungen und Agenten führen: jeder Modellaufruf mit seinen Tokens, Kosten, Latenz, Prompt und Antwort, aufgebaut aus den OpenTelemetry-Spans, die Ihre Anwendung sendet.

Auch genannt: **KI-/LLM-Observability**. Siehe [KI- / LLM-Observability](/docs/telemetry/ai-llm-observability).

### Data Observability

Beobachtet die Tabellen in Ihren Datenbanken und Data Warehouses und sagt Ihnen, wenn ihre Daten verspätet, unvollständig oder falsch sind, und welcher Lauf, welches Deployment oder welche Tabelle dahintersteckt.

Siehe [Übersicht der Data Observability](/docs/data-observability/index).

### Datensicherheit

Findet die sensiblen Daten, die Ihr Unternehmen aufbewahrt, in Cloud-Buckets, Datenbanken, Data Warehouses und der Telemetrie, die Sie senden, und sagt Ihnen, was an ihrer Aufbewahrung nicht stimmt.

Siehe [Übersicht der Datensicherheit](/docs/data-security/index).

### Dashboard

Eine Seite mit Widgets, die Sie selbst anordnen: Diagramme Ihrer Metriken, Protokolle und Traces, Listen von Vorfällen und Monitoren, Ihre SLOs und mehr. Ein Dashboard ist privat für Ihr Projekt, bis Sie es teilen.

Siehe [Dashboards – Übersicht](/docs/dashboards/index).

### Öffentliches Dashboard

Ein Dashboard, das über einen öffentlichen Link geteilt wird, für Personen, die sich nicht bei Ihrem Projekt anmelden. Schützen Sie es mit einem Passwort, beschränken Sie es auf bestimmte IP-Adressen oder hosten Sie es auf Ihrer eigenen Domain.

Siehe [Teilen & öffentliche Dashboards](/docs/dashboards/sharing).

## Automatisierung und KI

### Arbeitsablauf

Eine Automatisierung ohne Code: Bausteine auf einer Arbeitsfläche, die laufen, wenn ihr Trigger auslöst, etwa eine Nachricht in Slack, wenn ein Vorfall gemeldet wird, oder der Aufruf eines anderen Tools.

Siehe [Workflows – Übersicht](/docs/workflows/index).

### Runbook

Ein wiederverwendbares Reaktionsverfahren: manuelle und automatisierte Schritte, die Ihr Team für einen Vorfall, eine Warnung oder ein Wartungsereignis ausführt, von Hand oder wenn eine Runbook-Regel zutrifft.

Siehe [Runbooks – Übersicht](/docs/runbooks/index).

### Playbook

Die Schritte, die auf einen Sicherheitsfall reagieren, etwa die Beweise sichern, die Bereitschaft alarmieren oder einen Benutzer sperren, von selbst ausgeführt oder per Klick.

Auch genannt: **Sicherheits-Playbook**. Siehe [Sicherheitsfälle und Playbooks (SOAR)](/docs/telemetry/security-cases#playbooks).

### KI-Regel

Entscheidet, welche neuen Vorfälle oder Warnungen OneUptime AI untersucht und behebt, und wie. Ohne KI-Regel untersucht sie alle, daher brauchen die meisten Projekte keine.

Auch genannt: **Regel zur automatischen Behebung**. Siehe [AI SRE](/docs/ai/ai-sre#welche-vorfälle-untersucht-und-behoben-werden).

### OneUptime AI

Die KI von OneUptime, die als Site Reliability Engineer arbeitet: Sie untersucht jeden neuen Vorfall und jede neue Warnung anhand Ihrer Telemetrie und veröffentlicht, was sie gefunden hat, in deren Zeitleiste. Der Schalter **KI aktivieren** in den **Projekteinstellungen** schaltet alles davon aus.

Auch genannt: **AI SRE**. Siehe [AI SRE](/docs/ai/ai-sre).

### KI fragen

Ein Chat über die Daten Ihres Projekts. Er fragt Ihre Protokolle, Traces, Metriken, Vorfälle, Monitore und mehr ab und belegt jede Aussage seiner Antwort mit einer Quelle.

Auch genannt: **Chat**. Siehe [KI fragen](/docs/ai/ask-ai).

### Code

Wo Sie OneUptime AI bitten, in Ihren Repositorys zu arbeiten, so wie Sie einen Coding-Agenten bitten würden: einen Fehler beheben, Tests schreiben oder eine Änderung vornehmen, und Sie erhalten einen Pull Request zurück.

Auch genannt: **Aufgaben**. Siehe [Code](/docs/ai/ai-agent).

### Formular

Eine Seite, die jeder mit ihrem Link ausfüllen kann, ohne Konto. Jede Einsendung erstellt einen Vorfall, für eine Problemmeldung, oder ein geplantes Wartungsereignis, für einen Änderungsantrag.

Siehe [Formulare – Übersicht](/docs/forms/index).

## Was Sie installieren, und die Schlüssel dazu

### Infrastruktur-Agent

Der Dienst `oneuptime-infrastructure-agent` hinter einer Server- / VM-Überwachung: Er meldet alle 30 Sekunden CPU, Arbeitsspeicher, Festplatten und Prozesse eines Rechners, signiert mit dem geheimen Schlüssel des Monitors.

Siehe [Server- / VM-Überwachung](/docs/monitor/server-monitor).

### Kubernetes-Agent

Ein Helm-Chart, das die Metriken, Ereignisse und Pod-Protokolle eines Clusters sammelt, mit eBPF auch seine Traces, und sie mit einem Ingestion-Schlüssel sendet.

Siehe [Kubernetes-Agent](/docs/telemetry/kubernetes-agent).

### OpenTelemetry Collector

Der Open-Source-Agent, der Telemetrie empfängt, verarbeitet und sendet. **Host hinzufügen** installiert ihn auf einem Rechner, der Docker-Agent ist einer, und Ihre eigenen Collectors senden mit einem Ingestion-Schlüssel an OneUptime.

Auch genannt: **Collector**. Siehe [Hosts](/docs/telemetry/hosts) und [Host-OpenTelemetry-Collector](/docs/telemetry/host-otel-collector).

### Runner

Ein kleiner Prozess, den Sie in Ihrer eigenen Infrastruktur betreiben und der die JavaScript-, Bash-, SSH- und kubectl-Schritte Ihrer Runbooks ausführt. Er verbindet sich ausgehend mit OneUptime, mit eigener Runner-ID und eigenem Schlüssel.

Auch genannt: **Runbook-Agents**. Siehe [Runbook-Agents](/docs/runbooks/agents).

### Aufnahmeschlüssel

Der Schlüssel, mit dem etwas Telemetrie in Ihr Projekt senden darf: Anwendungen mit OpenTelemetry, Collectors und Agenten. Er gehört in den Header `x-oneuptime-token`, und ein API-Schlüssel des Projekts funktioniert an seiner Stelle nicht.

Auch genannt: **Telemetrie-Aufnahmeschlüssel**, `oneuptime.apiKey`. Siehe [Ingestion-Schlüssel](/docs/telemetry/ingestion-keys).

### API-Schlüssel

Ein Schlüssel, mit dem ein Skript, die CLI, Terraform oder ein KI-Assistent Ihr Projekt über die API lesen und ändern kann, mit den Berechtigungen, die Sie ihm geben. Legen Sie einen unter **Projekteinstellungen → Erweitert → API-Schlüssel** an.

Siehe [Benutzer, Teams & Berechtigungen](/docs/permissions/index#api-schlüssel).

## Wörter mit mehr als einer Bedeutung

### Regel

Vieles in OneUptime sind Regeln, und jede trifft eine Entscheidung für Sie: wer alarmiert wird (**Bereitschaftsregeln**, **Eskalationsregeln**), wem neue Datensätze gehören und wie sie beschriftet werden (**Eigentümerregeln**, **Beschriftungsregeln**), was zusammengehört (**Gruppierungsregeln**) und was OneUptime AI tut (**KI-Regeln**). Die eigenen Regeln eines Monitors sind seine Kriterien.

Siehe [Grundkonzepte](/docs/introduction/core-concepts#die-arten-von-regeln).

### Rolle

Vier verschiedene Dinge: die Berechtigungen, die ein Team gewährt, etwa Project Owner oder Project Admin; eine **Benutzerdefinierte Rolle**, die Sie aus Berechtigungen zusammenstellen; eine **Vorfallsrolle**, also die Rolle, die jemand in einem Vorfall übernimmt; und eine **Netzwerkgeräterolle**, also das, was ein Gerät in Ihrem Netzwerk tut.

Siehe [Benutzer, Teams & Berechtigungen](/docs/permissions/index).

### Ressource

Meistens die Infrastruktur, die OneUptime erfasst, etwa Hosts, Cluster, Datenbanken und Cloud-Ressourcen. Unter **Betroffene Ressourcen** nennt ein Vorfall die Monitore und die Infrastruktur, die er berührt, die Ressourcen einer Statusseite sind die Monitore und Gruppen, die sie zeigt, und die Ressourcenattribute von OpenTelemetry sagen, woher Telemetrie stammt.

Siehe [Inventar – Übersicht](/docs/inventory/overview).

### Einstellungen

Jede Ebene hat ihre eigenen: **Projekteinstellungen** für das ganze Projekt, **Benutzereinstellungen** dafür, wie OneUptime Sie erreicht, und die eigenen **Einstellungen** eines Produkts in seinem Seitenmenü, etwa Vorfallstatus und Vorlagen unter **Vorfälle**. Die Einstellungen eines selbst gehosteten Servers liegen im Admin Dashboard.

Siehe [Projekteinstellungen](/docs/configuration/project-settings).

### Richtlinie

Meistens eine **Bereitschaftsrichtlinie**: wer alarmiert wird und wer als Nächstes dran ist. Eine Richtlinie für eingehende Anrufe gibt Ihrem Team eine Telefonnummer, die bei der Person klingelt, die Bereitschaft hat, und eine Fehlerbudget-Richtlinie hält fest, was Ihr Team tut, wenn das Budget eines SLO zur Neige geht.

Siehe [Bereitschaftsrichtlinien](/docs/on-call/policies).

### Vorlage

Ein gespeicherter Ausgangspunkt: Eine Monitorvorlage erstellt Monitore, Vorfall- und Warnungsvorlagen füllen neue Datensätze aus, Notiz- und Postmortem-Vorlagen geben den Anfang für das vor, was Sie schreiben, und Dashboard-Vorlagen bauen die Widgets eines Dashboards.

Siehe [Monitorvorlagen](/docs/monitor/monitor-templates).

### Arbeitsbereich

Ein Slack- oder Microsoft-Teams-Arbeitsbereich, den Sie unter **Arbeitsbereich-Verbindungen** mit OneUptime verbinden, um Updates in Ihren Kanälen zu posten und aus dem Chat heraus auf Vorfälle zu reagieren. Was manche anderen Tools einen Arbeitsbereich nennen, ist in OneUptime ein Projekt.

Siehe [Slack](/docs/workspace-connections/slack).

### Agent

Ein Programm, das Sie installieren und das an OneUptime meldet oder für OneUptime handelt: Die Infrastruktur-, Kubernetes- und Docker-Agenten senden, was sie sammeln, ein Runner führt Runbook-Schritte aus, und ein KI-Agent lässt OneUptime AI einen Cluster oder einen Host untersuchen. Die Aufgaben, die Sie **Code** geben, sind Aufgaben für KI-Agenten.

Siehe [Was nehme ich wann?](/docs/introduction/which-one#sonde-agent-collector-oder-runner).

### Bereitschaftsregeln

Unter **Vorfälle** und **Warnungen** wählen Bereitschaftsregeln die Bereitschaftsrichtlinien aus, die ein neuer Vorfall oder eine neue Warnung durchläuft. Die eigenen Regeln einer Person, wie eine Alarmierung sie erreicht, hießen auch Bereitschaftsregeln: Sie heißen jetzt **Wie ich erreichbar bin**, unter **Benutzereinstellungen**.

Siehe [Vorfalleinstellungen & Automatisierung](/docs/incidents/settings#bereitschaftsregeln-für-vorfälle) und [Wie ich erreichbar bin](/docs/notifications/on-call-rules).

### Benachrichtigungseinstellungen

Unter **Benutzereinstellungen** legen Sie fest, welche Updates Sie zu dem erreichen, was Ihnen gehört, und über welche Kanäle. Die Schalter des Projekts für SMS und Anrufe, sein Nachrichtenguthaben und sein eigenes SMTP und Twilio hießen auch Benachrichtigungseinstellungen: Sie heißen jetzt **Benachrichtigungskanäle**, unter **Projekteinstellungen**.

Siehe [Benachrichtigungseinstellungen](/docs/notifications/notification-settings).

## Nächste Schritte

:::cards
- [Was nehme ich wann?](/docs/introduction/which-one): Vorfall oder Warnung, Workflow oder Runbook und die anderen Doppelgänger nebeneinander.
- [Grundkonzepte](/docs/introduction/core-concepts): Wie die Teile zusammenhängen, auf einer Seite.
- [Schnellstart](/docs/introduction/quickstart): Die Begriffe in fünfzehn Minuten anwenden.
:::
