# Grundkonzepte

OneUptime hat viele Produkte, aber sie beruhen auf einer Handvoll Ideen: Projekte, Monitore, Vorfälle und Warnungen, Bereitschaft, Statusseiten und Telemetrie. Um sie herum stehen das, was Sie überwachen, das, was Sie installieren, und die Regeln, die für Sie handeln. Diese Seite erklärt jede davon in wenigen Sätzen, zeigt, wie sie zusammenhängen, und verlinkt auf die Seiten, die sie ausführlich behandeln. Lesen Sie sie einmal, und jede andere Seite der Dokumentation liest sich leichter. Einzelne Wörter erklärt das [Glossar](/docs/introduction/glossary); um zwischen zwei Dingen zu wählen, die sich ähnlich sehen, lesen Sie [Was nehme ich wann?](/docs/introduction/which-one).

:::cards
- [Projekte und Personen](#projekte-und-personen): Wo alles liegt und wer was darf.
- [Monitore und Sonden](#monitore-und-sonden): Wie OneUptime bemerkt, dass etwas nicht stimmt.
- [Vorfälle und Warnungen](#vorfälle-und-warnungen): Der Datensatz, mit dem Ihr Team arbeitet.
- [Bereitschaft](#bereitschaft): Wer alarmiert wird, wie, und wer als Nächstes dran ist.
:::

## Wie die Teile zusammenhängen

Ein Problem bewegt sich in einer Richtung durch OneUptime. Sonden und Ihre eigene Telemetrie speisen Monitore. Die Kriterien eines Monitors entscheiden, wann etwas nicht stimmt und was eröffnet wird: ein Vorfall, eine Warnung oder beides. Bereitschaftsrichtlinien alarmieren Personen dazu, und Statusseiten informieren Ihre Kunden über Vorfälle.

```mermaid title="Wie ein Problem durch OneUptime läuft"
flowchart TB
    probes["Sonden prüfen"] --> monitors["Monitore"]
    telemetry["Anwendungen und Agenten<br/>senden Telemetrie"] --> monitors
    monitors -->|"meldet"| incident["Vorfall"]
    monitors -->|"erstellt"| alert["Warnung"]
    incident --> policy["Bereitschaftsrichtlinie"]
    alert --> policy
    incident --> statuspage["Statusseite"]
    policy --> person["Wer Bereitschaft hat"]
    statuspage --> subscribers["Abonnenten"]
```

## Projekte und Personen

Ein **Projekt** enthält alles: Monitore, Vorfälle, Bereitschaftsrichtlinien, Statusseiten, Telemetrie und Einstellungen. Die meisten Unternehmen brauchen eines, manche führen eines pro Umgebung oder Geschäftsbereich. Nichts, was Sie in einem Projekt anlegen, ist in einem anderen sichtbar.

Ihr **Konto** ist von Ihren Projekten getrennt. Ein Konto, mit einer E-Mail-Adresse und einem Passwort, kann zu beliebig vielen Projekten gehören; zwischen ihnen wechseln Sie mit der Projektauswahl oben links. Siehe [Ihr Konto](/docs/introduction/your-account).

Personen gehören über **Teams** zu einem Projekt, und die Berechtigungen eines Teams bestimmen, was seine Mitglieder tun dürfen. Jedes neue Projekt beginnt mit drei Teams: Owners, mit Ihnen darin, Admin und Members. Bei OneUptime Cloud hat jedes Projekt seinen eigenen Tarif.

:::cards
- [Benutzer, Teams & Berechtigungen](/docs/permissions/index): Personen einladen und festlegen, was sie dürfen.
:::

## Monitore und Sonden

Ein **Monitor** prüft eine Sache, die Sie betreiben, und entscheidet, ob sie funktioniert. Die meisten Monitore werden von **Sonden** geprüft: Rechnern, die die Prüfung nach Zeitplan ausführen, etwa eine Seite abrufen, eine API aufrufen, einen Host anpingen oder eine Datenbank abfragen. OneUptime Cloud betreibt Sonden in mehreren Regionen, eine selbst gehostete Installation betreibt ihre eigenen, und Sie können benutzerdefinierte Sonden in Ihrem Netzwerk hinzufügen. Andere Monitore lesen stattdessen, was Sie senden: die Telemetrie Ihrer Anwendungen oder die Daten, die ein Agent auf Ihren Servern, Kubernetes-Clustern und anderer Infrastruktur meldet.

Die **Kriterien** eines Monitors entscheiden, was jedes Ergebnis bedeutet. Sie werden der Reihe nach geprüft, und das erste zutreffende kann den Status des Monitors ändern, einen Vorfall melden, eine Warnung erstellen oder alles drei. Jedes neue Projekt hat drei Monitorstatus: **Betriebsbereit**, **Beeinträchtigt** und **Offline**.

:::cards
- [Einen Monitor erstellen](/docs/monitor/create-monitor): Einen Typ wählen, festlegen, was geprüft wird, und wie oft.
- [Benutzerdefinierte Probes](/docs/probe/custom-probe): Prüfen, was nur Ihr eigenes Netzwerk erreicht.
:::

## Was Sie überwachen

Ein Monitor prüft eine Sache. Rund um Ihre Monitore führt OneUptime Buch über das, was Sie betreiben, und diesen Datensätzen begegnen Sie im Menü:

- Eine **Monitor-Gruppe** fasst mehrere Monitore zu einem Status zusammen, sodass eine Statusseite etwas, das aus vielen Teilen besteht, etwa Checkout, als eine Zeile zeigen kann.
- Ein **Dienst** ist eine Anwendung oder ein Microservice, den Sie betreiben. OneUptime legt ihn an, sobald seine Telemetrie zum ersten Mal eintrifft, und führt seine Protokolle, Traces, Metriken, Ausnahmen und Vorfälle auf einer Seite zusammen.
- **Hosts**, Cluster unter **Kubernetes** und der Rest der **Infrastruktur** sind die Rechner und Plattformen, die Sie betreiben, gefüllt von den Agenten, die Sie installieren.
- Das **Inventar** ist eine einzige Liste von allem: Dienste, Hosts, Cluster, Geräte, Cloud-Ressourcen und die Dinge, die gar keine Telemetrie senden.

Sie treffen sich dort, wo sich ein Problem zeigt. Die Monitore eines Dienstes können in einer Monitor-Gruppe zusammenlaufen, ein SLO misst sie, und wenn einer ausfällt, meldet er einen Vorfall. Der Vorfall führt den Dienst unter den Ressourcen, die er betrifft, und die Statusseite zeigt die Gruppe und den Vorfall.

```mermaid title="Ein Dienst, was ihn überwacht und wo er erscheint"
flowchart TB
    service["Dienst: Checkout"] -->|"überwacht von"| monitors["Seine Monitore"]
    monitors --> group["Monitor-Gruppe"]
    monitors --> slo["SLO"]
    monitors -->|"melden"| incident["Vorfall"]
    group --> statuspage["Statusseite"]
    incident --> statuspage
```

:::cards
- [Monitor-Gruppen](/docs/monitor/monitor-groups): Mehrere Monitore zu einem Status zusammenfassen.
- [Dienste](/docs/telemetry/services): Jede Anwendung, die Sie betreiben, auf je einer eigenen Seite.
- [Inventar – Übersicht](/docs/inventory/overview): Alles, was OneUptime über Ihre Umgebung weiß.
:::

## Zuverlässigkeitsziele

Ein **SLO** (Service Level Objective) ist ein Zuverlässigkeitsziel für das, was Sie überwachen, etwa 99,9 % der Zeit verfügbar über 30 Tage. OneUptime misst es alle 5 Minuten anhand seiner Monitore. Die Ausfallzeit, die das Ziel erlaubt, ist sein Fehlerbudget: Bleibt viel davon übrig, können Sie Risiken eingehen, und bleibt wenig, treten Sie kürzer und investieren in Stabilität.

:::cards
- [SLOs – Übersicht](/docs/slo/introduction): Ein Ziel setzen und sehen, wie viel vom Budget übrig ist.
:::

## Vorfälle und Warnungen

Beide halten ein Problem fest, und beide können die Bereitschaft alarmieren. Der Unterschied liegt darin, wen das Problem betrifft.

| | Vorfall | Warnung |
| --- | --- | --- |
| **Was es ist** | Ein Problem, das Ihre Nutzer betrifft, etwa ein Ausfall oder eine Verlangsamung | Ein Problem, das sich Ihr Team ansehen sollte, bevor Nutzer betroffen sind |
| **Auf Statusseiten** | Kann erscheinen und informiert Abonnenten | Nie |
| **Anfangsstatus** | **Identifiziert**, **Bestätigt**, **Behoben** | **Identifiziert**, **Bestätigt**, **Behoben** |
| **Anfangsschweregrade** | Critical Incident, Major Incident, Minor Incident | **Hoch**, **Niedrig** |

Wer einen bestätigt, sagt damit, dass sich jemand darum kümmert, und hält seine Bereitschaftsrichtlinien davon ab, die nächste Stufe zu alarmieren. Wer ihn behebt, schließt ihn ab. Sie können eigene Status und Schweregrade hinzufügen und Warnungen mit dem Vorfall verknüpfen, zu dem sie sich als zugehörig erweisen.

Eine **Episode** fasst zusammengehörige Vorfälle oder zusammengehörige Warnungen zusammen, damit Ihr Team sie als eins bearbeitet. Gruppierungsregeln entscheiden, was zusammengehört.

:::cards
- [Vorfälle – Übersicht](/docs/incidents/index): Wie Vorfälle gemeldet, bearbeitet und behoben werden.
- [Warnungen – Übersicht](/docs/alerts/index): Woher Warnungen kommen und wie Episoden sie gruppieren.
- [Verknüpfte Warnungen](/docs/incidents/linked-alerts): Die Warnungen eines Ausfalls mit seinem Vorfall verknüpfen.
:::

## Bereitschaft

Eine **Bereitschaftsrichtlinie** entscheidet, wer zu einem Vorfall oder einer Warnung alarmiert wird und wer als Nächstes dran ist, wenn niemand reagiert. Ihre **Eskalationsregeln** sind ihre Stufen: Jede alarmiert ihre Personen und wartet dann darauf, dass jemand bestätigt, bevor die nächste Stufe alarmiert wird. Eine Stufe kann Personen, Teams oder einen **Bereitschaftsplan** alarmieren, eine Rotation, die zu jedem Zeitpunkt weiß, wer Bereitschaft hat.

Wie jede Person erreicht wird, legt sie selbst fest. In den **Benutzereinstellungen** hält jede Person die Wege fest, auf denen OneUptime sie erreichen kann, etwa E-Mail, SMS, Anrufe, Push-Benachrichtigungen, Slack oder Microsoft Teams, und welche davon bei einer Alarmierung genutzt werden.

:::cards
- [Bereitschaft – Übersicht](/docs/on-call/index): Wie eine Alarmierung jemanden erreicht und wo jedes Teil zu finden ist.
- [Eskalationsregeln](/docs/on-call/escalation-rules): Personen Stufe für Stufe alarmieren, bis jemand reagiert.
- [Bereitschaftspläne](/docs/on-call/schedules): Rotationen, Ebenen und Übergaben.
- [Wie OneUptime Sie erreicht](/docs/notifications/index): Die Methoden, Regeln und Einstellungen, die bestimmen, wie jede Person erreicht wird.
:::

## Statusseiten und Wartung

Eine **Statusseite** zeigt Ihren Kunden, ob Ihre Dienste funktionieren. Sie wählen, welche Monitore sie zeigt, unter Namen, die Ihre Kunden verstehen. Solange ein Vorfall auf einem dieser Monitore aktiv ist, zeigt die Seite ihn, und ihre **Abonnenten** werden per E-Mail, SMS, Slack, Microsoft Teams oder Webhook informiert. Eine Statusseite kann öffentlich sein oder privat für die Personen, die Sie hereinlassen.

**Geplante Wartung** kündigt geplante Arbeiten vorab an. Ein Ereignis durchläuft **Geplant**, **Laufend**, **Beendet** und **Abgeschlossen**, und die Statusseiten, auf denen Sie es zeigen, informieren Besucher und Abonnenten darüber.

:::cards
- [Statusseiten – Übersicht](/docs/status-pages/index): Eine Statusseite anlegen und festlegen, was sie zeigt.
- [Abonnenten & Ankündigungen](/docs/status-pages/subscribers): Wer informiert wird, und wann.
- [Geplante Wartung – Übersicht](/docs/scheduled-maintenance/index): Wie ein Ereignis abläuft, und was es pausiert.
:::

## Telemetrie

**Telemetrie** ist das, was Ihre Systeme an OneUptime senden: Logs, Metriken, Traces, Ausnahmen und Profile. Anwendungen senden sie mit OpenTelemetry, und die Agenten von OneUptime senden sie von Hosts, Kubernetes-Clustern, Docker-Hosts und anderer Infrastruktur. Jeder Absender nutzt einen **Ingestion-Schlüssel**, angelegt unter **Projekteinstellungen → Telemetrie & APM → Ingestion-Schlüssel**. Sie durchsuchen Telemetrie, stellen sie auf Dashboards dar und überwachen sie mit Telemetrie-Monitoren, die wie jeder andere Monitor Vorfälle und Warnungen auslösen. Im Menü öffnen **Protokolle**, **Metriken**, **Traces**, **Profile** und **Ausnahmen** jeweils eine Art; **KI / LLM** verfolgt die Gespräche Ihrer KI, **Data Observability** beobachtet die Tabellen in Ihren Datenbanken, und **Topologie** zeigt, wie alles zusammenhängt.

:::cards
- [OpenTelemetry](/docs/telemetry/open-telemetry): Logs, Metriken und Traces aus Ihren Anwendungen senden.
- [Logs-Überwachung](/docs/monitor/logs-monitor): Erfahren, wenn ein Muster in Ihren Logs auftaucht.
:::

## Sicherheit

**Sicherheitsereignisse** speichert die Sicherheitsereignisse aus Ihren Protokollen, Ihren Sicherheitstools und allem anderen, was Sie senden. Seine Erkennungsregeln machen aus dem, was sie finden, Sicherheitsfälle, die Ihr Team in einer Warteschlange bearbeitet und auf die Playbooks reagieren. **Datensicherheit** findet die sensiblen Daten in Ihren Buckets, Datenbanken und Ihrer Telemetrie, und was an ihrer Aufbewahrung nicht stimmt.

:::cards
- [Erste Schritte mit Sicherheit](/docs/telemetry/security-getting-started): Bedrohungen in den Daten finden, die Sie bereits haben.
- [Übersicht der Datensicherheit](/docs/data-security/index): Ihre sensiblen Daten finden und ihre Aufbewahrung in Ordnung bringen.
:::

## Was Sie installieren, und die Schlüssel dazu

Das meiste in OneUptime braucht keine Installation. Sie installieren nur dann etwas, wenn Sie erreichen wollen, was OneUptime von außen nicht sehen kann, und jedes Teil verbindet sich ausgehend mit einem Schlüssel mit OneUptime:

- Eine benutzerdefinierte Sonde führt die Prüfungen von Monitoren in Ihrem Netzwerk aus, mit eigener Sonden-ID und eigenem Schlüssel.
- Der **OpenTelemetry Collector**, der Kubernetes-Agent und der Docker-Agent senden Telemetrie mit einem **Ingestion-Schlüssel**. Der Infrastruktur-Agent hinter einer Server- / VM-Überwachung sendet mit dem geheimen Schlüssel dieses Monitors.
- Ein **Runner** führt Runbook-Schritte in Ihrer Infrastruktur aus, mit eigener Runner-ID und eigenem Schlüssel.

Ein Ingestion-Schlüssel sendet nur Telemetrie herein. Ein **API-Schlüssel** ist die andere Art: Mit ihm kann ein Skript, die CLI, Terraform oder ein KI-Assistent Ihr Projekt lesen und ändern, mit den Berechtigungen, die Sie ihm geben. Keiner funktioniert anstelle des anderen.

:::cards
- [Was nehme ich wann?](/docs/introduction/which-one#sonde-agent-collector-oder-runner): Was Sie installieren, und welchen Schlüssel jedes Teil braucht.
- [Ingestion-Schlüssel](/docs/telemetry/ingestion-keys): Die Schlüssel anlegen, eingrenzen und rotieren, die Telemetrie senden.
:::

## Automatisierung und KI

- **Arbeitsabläufe** führen Aktionen aus, wenn etwas passiert, etwa eine Nachricht in Slack, wenn ein Vorfall gemeldet wird.
- **Runbooks** verwandeln einen Ablauf für den Ernstfall in Schritte, die Ihr Team von Hand oder automatisch ausführen kann.
- **OneUptime AI** untersucht neue Vorfälle und Warnungen und veröffentlicht, was sie gefunden hat, in ihrer Zeitleiste, und **KI fragen** beantwortet Fragen zu Ihrem Projekt. Ein neues Projekt beginnt mit eingeschalteter KI; der Schalter **KI aktivieren** unter **Projekteinstellungen → KI → KI-Funktionen** schaltet alles davon aus.

:::cards
- [Workflows – Übersicht](/docs/workflows/index): Aktionen mit Auslösern und Komponenten automatisieren.
- [AI SRE](/docs/ai/ai-sre): Wie OneUptime AI Vorfälle und Warnungen untersucht.
:::

## Beschriftungen und Eigentümer

**Beschriftungen** sind Schlagwörter, die Sie an Monitore, Vorfälle, Statusseiten und die meisten anderen Ressourcen hängen, um sie zu filtern und zu gruppieren. Die Berechtigungen eines Teams lassen sich auf Ressourcen mit bestimmten Beschriftungen beschränken. **Eigentümer** sind die Personen und Teams, die für eine Ressource verantwortlich sind: Sie werden informiert, wenn mit ihr etwas passiert. Beschriftungsregeln und Eigentümerregeln versehen neue Ressourcen für Sie mit Beschriftungen und Eigentümern.

:::cards
- [Beschriftungs- und Eigentümerregeln](/docs/configuration/label-and-owner-rules): Neue Ressourcen automatisch beschriften und ihnen Eigentümer geben.
:::

## Die Arten von Regeln

Vieles in OneUptime heißt Regel. Jede trifft eine Entscheidung für Sie, wenn etwas Neues eintrifft, und es gibt sie in einigen Familien. Die meisten finden Sie unter **Regeln** in den Seitenmenüs von **Vorfälle** und **Warnungen**.

| Was sie entscheidet | Regeln |
| --- | --- |
| Wer alarmiert wird | **Bereitschaftsregeln** wählen die Bereitschaftsrichtlinien, die ein neuer Vorfall oder eine neue Warnung durchläuft, und die **Eskalationsregeln** einer Richtlinie alarmieren Stufe für Stufe |
| Wem es gehört und wie es beschriftet wird | **Eigentümerregeln**, **Beschriftungsregeln** und **Datenschutzregeln** |
| Was zusammengehört | **Gruppierungsregeln** eröffnen Episoden und fügen ihnen weitere hinzu |
| Was darauf läuft | **Runbook-Regeln** starten Runbooks, und **KI-Regeln** entscheiden, was OneUptime AI untersucht und behebt |
| Wann nachgefasst wird | **SLA-Regeln** verfolgen Reaktions- und Lösungszeiten, und **Erinnerungsregeln** erinnern die Eigentümer, solange etwas offen ist |

Die eigenen Regeln eines Monitors sind seine Kriterien. Die Bereitschaftsregeln unter **Benutzereinstellungen** sind wieder etwas anderes: Sie gehören jeder Person selbst und entscheiden, wie eine Alarmierung diese Person erreicht.

:::cards
- [Vorfalleinstellungen & Automatisierung](/docs/incidents/settings#regeln-die-beim-anlegen-eines-vorfalls-laufen): Die Regeln, die laufen, wenn ein Vorfall angelegt wird, der Reihe nach.
- [Wie ich erreichbar bin](/docs/notifications/on-call-rules): Wie eine Alarmierung Sie erreicht.
:::

## Nächste Schritte

:::cards
- [Schnellstart](/docs/introduction/quickstart): Diese Ideen in fünfzehn Minuten anwenden.
- [Glossar](/docs/introduction/glossary): Jedes Wort, das OneUptime verwendet, in ein oder zwei Sätzen.
- [Was nehme ich wann?](/docs/introduction/which-one): Vorfall oder Warnung, Workflow oder Runbook und die anderen Doppelgänger.
- [Vorfälle – Übersicht](/docs/incidents/index): Was passiert, nachdem ein Monitor einen Vorfall meldet.
:::
