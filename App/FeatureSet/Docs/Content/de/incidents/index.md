# Vorfälle – Übersicht

Ein Vorfall ist in OneUptime der Datensatz, um den sich Ihr Team versammelt, wenn etwas kaputtgeht. Er trägt eine Nummer, einen Titel, einen Schweregrad, einen aktuellen Status, die betroffenen Ressourcen und alles, was Ihr Team während der Reaktion festhält – Notizen, Grundursache, Behebungsschritte und einen Feed, an den nur angehängt wird und der festhält, wer was getan hat.

Vorfälle sind das, was aus einem rot werdenden Monitor eine koordinierte Reaktion macht. Einen Vorfall zu melden alarmiert die richtige Bereitschaftsrotation, fügt Eigentümer hinzu, die über jede Änderung benachrichtigt werden, startet Runbooks und veröffentlicht – wenn Sie das möchten – die Störung auf Ihrer öffentlichen Statusseite, damit Kunden keine Tickets mehr öffnen, um zu fragen, ob Sie schon Bescheid wissen.

Sie können einen Vorfall um 3 Uhr nachts von Hand melden oder einen Monitor das für Sie erledigen lassen, sobald seine Kriterien zutreffen. So oder so ist der Vorfall dasselbe Objekt, mit demselben Lebenszyklus und derselben Aktenlage am Ende.

## Auf einen Blick

- **Eigenständiger Produktbereich** – **Vorfälle** in der linken Navigation des Dashboards, unter `/dashboard/{projectId}/incidents`.
- **Drei vorkonfigurierte Status** – **Identified**, **Bestätigt** und **Behoben** werden für jedes neue Projekt angelegt. Sie können eigene hinzufügen; die drei vorkonfigurierten lassen sich umbenennen und umfärben, aber niemals löschen.
- **Drei vorkonfigurierte Schweregrade** – **Critical Incident**, **Major Incident** und **Minor Incident**. Der Schweregrad ist eine Bezeichnung mit einer Farbe und einer Reihenfolge – er hat kein eigenes Verhalten.
- **Vier Wege hinein** – der Assistent **Vorfall melden**, **Aus Vorlage erstellen**, eine Monitor-Kriterienregel oder `POST /api/incident`.
- **Nummeriert pro Projekt** – jeder Vorfall erhält eine Vorfallnummer, standardmäßig als `#42` dargestellt oder mit Ihrem eigenen Präfix, etwa `INC-42`.
- **Zwei Arten von Notizen** – private Notizen (interne Notizen) für Ihr Team, öffentliche Notizen für Statusseiten-Abonnenten.
- **Die Einstellungen liegen unter Vorfälle, nicht unter Projekteinstellungen** – Status, Schweregrade, Vorlagen, benutzerdefinierte Felder und die Regelwerke finden Sie alle unter **Vorfälle → Einstellungen** und **Vorfälle → Regeln**.

## Wichtige Begriffe

Eine Handvoll Wörter taucht auf jeder zweiten Seite in diesem Abschnitt auf. Klären Sie diese zuerst.

| Begriff                    | Bedeutung                                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vorfall**                | Der Datensatz selbst – Titel, Beschreibung, Schweregrad, aktueller Status, betroffene Ressourcen und alles, was während der Reaktion dazu geschrieben wird.       |
| **Vorfallsstatus**         | Wo der Vorfall in seinem Lebenszyklus steht. Ein projektbezogener Datensatz mit Name, Farbe und `order` sowie den Flags, die ihm Bedeutung geben.                 |
| **Vorfallsschweregrad**    | Wie schlimm es ist. Ein projektbezogener Datensatz mit Name, Farbe und `order`. Reine Klassifizierung – nichts im Produkt behandelt einen Schweregrad besonders.  |
| **Vorfallnummer**          | Ein Zähler je Projekt, angezeigt als `#42` oder mit einem von Ihnen konfigurierten Präfix als `INC-42`.                                                           |
| **Betroffene Ressourcen**  | Die Monitore, Hosts, Kubernetes-Cluster, Docker-Hosts, Dienste und sonstige Infrastruktur, die Sie an den Vorfall anhängen.                                       |
| **Öffentliche Notiz**      | Ein Update, das für Statusseiten-Leser und Abonnenten geschrieben wird. Es erscheint auf der Zeitachse der Statusseite.                                           |
| **Private Notiz**          | Eine interne Notiz (das Modell `IncidentInternalNote`) für das reagierende Team. Sie erreicht niemals eine Statusseite.                                           |
| **Eigentümer**             | Ein Benutzer oder Team, der bzw. das für den Vorfall verantwortlich ist. Eigentümer werden bei Erstellung, bei neuen Notizen und bei Statuswechseln benachrichtigt. |
| **Vorfall-Feed**           | Die Aktivitätszeitachse auf der **Übersicht** des Vorfalls, an die nur angehängt wird und die Statuswechsel, Notizen, Eigentümeränderungen, Regelausführungen und Benachrichtigungen festhält. |
| **Zustands-Zeitachse**     | Der Nachweis darüber, in welchem Status der Vorfall wann und wie lange war – mit dem Abonnenten-Benachrichtigungsstatus für jeden Übergang.                       |

## Die drei Status, die OneUptime für jedes Projekt anlegt

Beim Anlegen eines Projekts erstellt OneUptime genau drei Vorfallsstatus, in dieser Reihenfolge:

| Status           | Reihenfolge | Farbe             | Bedeutung                                                                              |
| ---------------- | ----------- | ----------------- | -------------------------------------------------------------------------------------- |
| **Identified**   | 1           | Rot (`#fd625e`)   | Der Status, in dem ein brandneuer Vorfall landet. Das ist der Erstellungsstatus.        |
| **Bestätigt**    | 2           | Gelb (`#ffbf53`)  | Jemand hat den Vorfall übernommen und arbeitet daran.                                   |
| **Behoben**      | 3           | Grün (`#2ab57d`)  | Der Vorfall ist vorbei. Ihn zu beheben nimmt ihn von Ihrer Statusseite.                 |

Die Namen sind nur Bezeichnungen – was das Verhalten tatsächlich steuert, sind drei Booleans auf dem Statusdatensatz: `isCreatedState`, `isAcknowledgedState` und `isResolvedState`. Pro Projekt wird erwartet, dass jedes Flag von genau einem Status getragen wird.

Diese Unterscheidung ist wichtiger, als sie klingt:

- `isCreatedState` entscheidet, wo ein neuer Vorfall startet. Wird beim Erstellen kein Status ausdrücklich ausgewählt, sucht OneUptime den Erstellungsstatus des Projekts und verwendet ihn.
- `isAcknowledgedState` und `isResolvedState` steuern die Schaltflächen **Acknowledge** und **Beheben** in der Vorfall-Kopfzeile, die beiden Kennzahlkacheln auf der **Übersicht** des Vorfalls und das Zähler-Badge **Aktive Vorfälle** im Seitenmenü.
- **Aktive Vorfälle** ist ausschließlich definiert als „der aktuelle Status ist nicht der behobene Status". Jeder eigene Status, den Sie hinzufügen, ist daher aktiv, sofern er nicht der behobene ist.

**Achten Sie auf die Benennung.** Der erste vorkonfigurierte Status heißt **Identified**, auch wenn ihn mehrere Beschreibungen im Produkt weiterhin Erstellungsstatus nennen. Wenn Sie in der Statusliste Ihres Projekts nach „Created" suchen: Es ist der Datensatz mit dem Namen **Identified**.

Eigene Status fügen Sie unter **Vorfälle → Einstellungen → Vorfallsstatus** hinzu. Neue Status werden ans Ende der geordneten Liste angehängt und lassen sich per Ziehen umsortieren. Die drei mit Flags versehenen Status können nicht gelöscht werden – OneUptime blockiert das –, aber Sie können sie umbenennen und umfärben, weshalb die Oberfläche Statusnamen dynamisch ausliest.

Die Reihenfolge wird erzwungen, sie ist nicht kosmetisch: Ein Vorfall kann nicht in einen Status wechseln, der in der Reihenfolge vor seinem aktuellen liegt.

Alle Einzelheiten finden Sie unter [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities).

## Die drei Schweregrade, die OneUptime für jedes Projekt anlegt

Jedes neue Projekt erhält außerdem drei Schweregrade:

| Schweregrad           | Reihenfolge | Farbe                | Bedeutung                                                            |
| --------------------- | ----------- | -------------------- | -------------------------------------------------------------------- |
| **Critical Incident** | 1           | Bordeaux (`#b70400`) | Sehr hohe Kundenauswirkung, erfordert eine sofortige Reaktion.        |
| **Major Incident**    | 2           | Rot (`#fd625e`)      | Erhebliche Auswirkung, erfordert meist eine sofortige Reaktion.       |
| **Minor Incident**    | 3           | Gelb (`#ffbf53`)     | Geringe Auswirkung, wird meist während der Arbeitszeit bearbeitet.    |

Die vollständigen vorkonfigurierten Beschreibungen stehen unter [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities).

Schweregrade haben `name`, `description`, `color` und `order` und sonst nichts. Es gibt keine Flags, und kein Codepfad behandelt „Critical Incident" anders als irgendeinen anderen Datensatz. Der Schweregrad ist die Art, wie Menschen triagieren, und er steht als Übereinstimmungskriterium zur Verfügung, wenn Sie Bereitschaftsregeln schreiben – aber die Wahl eines Schweregrads alarmiert für sich genommen niemanden.

Schweregrade bearbeiten oder hinzufügen können Sie unter **Vorfälle → Einstellungen → Vorfallsschweregrad**.

## Das Leben eines Vorfalls

### 1. Er wird gemeldet

Vier Wege führen zu demselben Objekt:

- **Von Hand** – klicken Sie in der Vorfallsliste auf **Vorfall melden**. Damit öffnet sich der Assistent **Neuen Vorfall melden** mit fünf Schritten: **Vorfalldetails**, **Betroffene Ressourcen**, **Vorfallsrollen**, **Bereitschaft**, **Mehr**.
- **Aus einer Vorlage** – klicken Sie auf **Aus Vorlage erstellen** und wählen Sie eine gespeicherte **Vorfall Vorlage**. Vorlagen füllen Titel, Beschreibung, Schweregrad, Anfangsstatus, Ressourcen, Bereitschaftsrichtlinien, Eigentümer und Beschriftungen vor.
- **Aus einem Monitor** – eine Monitor-Kriterienregel mit aktiviertem Schalter „einen Vorfall melden" erstellt den Vorfall automatisch, sobald ihre Filter zutreffen. Titel und Beschreibungen unterstützen dort `{{variable}}`-Vorlagen.
- **Über die API** – `POST /api/incident` mit einem API-Schlüssel. Der Server füllt `declaredAt`, den Erstellungsstatus und die Vorfallnummer für Sie aus.

Die Feld-für-Feld-Anleitung finden Sie unter [Einen Vorfall melden](/docs/incidents/declaring-incidents).

### 2. Die richtigen Leute erfahren davon

Beim Erstellen führt OneUptime die von Ihnen konfigurierte Automatisierung aus: Beschriftungsregeln, Bereitschaftsregeln, Eigentümerregeln und Runbook-Regeln. Alle an den Vorfall angehängten Bereitschaftsdienst-Richtlinien – manuell, aus einer Vorlage oder durch eine passende Bereitschaftsregel eingefügt – werden parallel ausgeführt.

Eigentümer werden per E-Mail, SMS, Anruf, Push und WhatsApp benachrichtigt, jeweils gemäß den eigenen Benachrichtigungseinstellungen der Benutzer. Hat ein Vorfall überhaupt keine Eigentümer, geht die Benachrichtigung ersatzweise an die Projekteigentümer, statt verworfen zu werden.

Ist der Vorfall auf einer Statusseite sichtbar und sind Abonnentenbenachrichtigungen aktiviert, erfahren es auch die Abonnenten. Benachrichtigungen werden per Cron gesteuert und laufen jede Minute – rechnen Sie also mit bis zu etwa einer Minute Verzögerung statt mit einem sofortigen Versand.

### 3. Ihr Team arbeitet daran

Reagierende bestätigen den Vorfall, hängen betroffene Ressourcen an, führen Runbooks aus, weisen Vorfallsrollen zu und schreiben auf, was sie herausfinden – private Notizen fürs Team, öffentliche Notizen für Kunden sowie die Seiten **Grundursache** und **Behebung**, sobald das Bild klarer wird. Alles, was sie tun, landet im **Vorfall Feed** auf der Seite **Übersicht**.

### 4. Er wird behoben

Ein Klick auf **Beheben** setzt den Vorfall auf den behobenen Status, trägt das in die Zustands-Zeitachse ein, stoppt die Dauer-Uhr und entfernt den Vorfall aus dem aktiven Bereich jeder Statusseite, auf der er angezeigt wurde. Sonst muss sich dafür nichts ändern – das Flag des behobenen Status ist das, worauf die Statusseiten-Abfrage schaut.

Danach können Sie ein Postmortem schreiben und es optional auf der Statusseite veröffentlichen.

## Wo Vorfälle im Dashboard leben

Öffnen Sie **Vorfälle** in der linken Navigation. Das Seitenmenü ist in Abschnitte gegliedert:

| Abschnitt          | Was Sie dort tun                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Übersicht**      | **Alle Vorfälle** und **Aktive Vorfälle** – letzteres trägt ein rotes Badge mit der Anzahl der Vorfälle, die nicht im behobenen Status sind.                          |
| **Episoden**       | Vorfallsepisoden, eine eigene Gruppierungsfunktion mit eigenen Seiten.                                                                                               |
| **KI**             | **Untersuchung** und **Behebung** – Einstellungen für automatische Untersuchung und automatische Behebung.                                                            |
| **Arbeitsbereich** | **Slack**- und **Microsoft Teams**-Verbindungen für Vorfälle.                                                                                                        |
| **Regeln**         | Die Regelwerke: **Gruppierungsregeln**, **Bereitschaftsregeln**, **Eigentümerregeln**, **Runbook-Regeln**, **Datenschutzregeln**, **Beschriftungsregeln**, **SLA-Regeln**, **Reminder Rules**. |
| **Einstellungen**  | **Vorfallsstatus**, **Vorfallsschweregrad**, **Vorfall-Vorlagen**, **Notiz-Vorlagen**, **Postmortem-Vorlagen**, **Benutzerdefinierte Felder**, **Vorfallsrollen**, **Weitere Einstellungen**. |

**Regeln** und **Einstellungen** sind standardmäßig eingeklappt – klappen Sie sie auf, um die Seiten zu finden, auf die sich der Rest dieser Dokumentation bezieht. Die Vorfallskonfiguration liegt nicht unter Projekteinstellungen; sie wohnt komplett hier.

Die Vorfallsliste selbst zeigt **Vorfallnummer**, **Titel**, **Status**, **Schweregrad**, **Betroffene Ressourcen**, **Erklärt**, **Dauer**, **Beschriftungen** und **Eigentümer**, mit einer Massenaktion **Status ändern**, um mehrere auf einmal abzuschließen.

## Was jede Seite eines Vorfalls zeigt

Öffnen Sie einen Vorfall, und Sie erhalten ein linkes Seitenmenü, das so gegliedert ist:

- **Übersicht** – die Karte **Vorfalldetails** (Titel, Schweregrad, Beschriftungen, Vorfallnummer, gemeldet am, gemeldet von, Bereitschaftsrichtlinien), eine Karte **Betroffene Ressourcen** und der **Vorfall Feed**. Darüber Kennzahlkacheln für Zeit bis zur Bestätigung, Zeit bis zur Behebung und die gesamte **Dauer**.
- **Zustands-Zeitachse** – jeder Status, in dem der Vorfall war, mit **Beginnt am**, **Endet am**, **Dauer** und dem Abonnenten-Benachrichtigungsstatus für jeden Übergang. **Ursache anzeigen** und **Protokolle anzeigen** erklären, warum jede Änderung passiert ist.
- **SLA** – SLA-Nachverfolgung für diesen Vorfall.
- **Beschreibung**, **Grundursache**, **Behebung** – drei Markdown-Seiten. Die Beschreibung ist diejenige, die auf Ihrer Statusseite erscheint.
- **Runbooks** – Runbook-Ausführungen, die an diesen Vorfall angehängt sind.
- **Postmortem** – die Aufarbeitung, die Sie optional auf der Statusseite veröffentlichen können.
- **Rollen**, **Bereitschaftsausführungen**, **Eigentümer** – wer daran arbeitet, welche Richtlinien ausgelöst haben und wer benachrichtigt wird.
- **Benachrichtigungsprotokolle**, **KI-Protokolle**, **Audit-Protokolle** – was gesendet wurde und was sich geändert hat.
- **Private Notizen** und **Öffentliche Notizen** – unter dem Abschnitt **Notizen** des Seitenmenüs.
- **Benutzerdefinierte Felder**, **Einstellungen**, **Vorfall löschen** – unter **Erweitert**. Die Seite **Einstellungen** enthält **Auf Statusseite sichtbar**, **Privater Vorfall** und die Karte **Reminders**.

[Vorfallnotizen, Eigentümer & Feed](/docs/incidents/notes-owners-and-feed) behandelt die Zusammenarbeitsseiten im Detail.

## Wie Vorfälle zum Rest von OneUptime passen

- **Monitore erkennen das Problem; Vorfälle halten es fest.** Eine Monitor-Kriterienregel kann automatisch einen Vorfall melden und dabei Titel, Schweregrad, Bereitschaftsrichtlinien, Eigentümer, Beschriftungen und Behebungsnotizen vorbelegen. Die dort verfügbaren Variablen finden Sie unter [Vorfall- & Warnmeldungsvorlagen](/docs/monitor/incident-alert-templating).
- **Bereitschaftsrichtlinien übernehmen das Alarmieren.** Hängen Sie Richtlinien im Schritt **Bereitschaft** des Melde-Assistenten an, an einer Vorlage oder über **Vorfälle → Regeln → Bereitschaftsregeln**. Jede passende Regel löst aus – die ausgeführte Menge ist die Vereinigung aller Treffer plus allem, was direkt angehängt wurde, dedupliziert.
- **Runbooks sagen den Leuten, was zu tun ist.** Runbook-Regeln hängen automatisch eine Prozedur an, wenn ein passender Vorfall erstellt wird, und Reagierende können eine von Hand aus dem Vorfall heraus starten. Siehe [Runbooks – Übersicht](/docs/runbooks/index).
- **Statusseiten informieren Kunden.** Ein Vorfall erscheint in der aktiven Liste einer Statusseite, wenn auf der Seite Vorfälle aktiviert sind, der Vorfall als auf der Statusseite sichtbar markiert ist und sein aktueller Status nicht der behobene Status ist. Private Vorfälle sind immer von jeder Statusseite ausgeblendet. Siehe [Statusseiten – Übersicht](/docs/status-pages/index).
- **Arbeitsabläufe automatisieren rundherum.** Mit den Auslösern **On Create Incident**, **On Update Incident** und **On Delete Incident** bauen Sie No-Code-Automatisierung auf dem Vorfalls-Lebenszyklus auf. Siehe [Workflows – Übersicht](/docs/workflows/index).

## Weiterführende Themen

- [Einen Vorfall melden](/docs/incidents/declaring-incidents) – der Assistent, Vorlagen, Monitor-Kriterien und die API.
- [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities) – die Status-Flags, eigene Status und die Schweregrad-Klassifizierung.
- [Vorfallnotizen, Eigentümer & Feed](/docs/incidents/notes-owners-and-feed) – öffentliche und private Notizen, Eigentümer und der Aktivitäts-Feed.
- [Vorfalleinstellungen & Automatisierung](/docs/incidents/settings) – Vorlagen, benutzerdefinierte Felder, Nummernpräfixe und die Regelwerke.
- [Statusseiten – Übersicht](/docs/status-pages/index) – wie Vorfälle Ihre Kunden erreichen.
- [Abonnenten & Ankündigungen](/docs/status-pages/subscribers) – wer benachrichtigt wird, wenn sich ein Vorfall bewegt.
