# Vorfälle – Übersicht

Ein Vorfall ist in OneUptime der Datensatz, um den sich Ihr Team schart, wenn etwas kaputtgeht. Er trägt eine Nummer, einen Titel, einen Schweregrad, einen aktuellen Status, die betroffenen Ressourcen – und alles, was Ihr Team während der Reaktion festhält: Notizen, Grundursache, Behebungsschritte und einen Feed, der nur ergänzt wird und protokolliert, wer was getan hat.

Vorfälle sind das, was aus einem rot werdenden Monitor eine koordinierte Reaktion macht. Einen zu melden alarmiert die richtige Bereitschaftsrotation, ergänzt Eigentümer, die über jede Änderung informiert werden, startet Runbooks und stellt den Ausfall – wenn Sie das möchten – auf Ihre öffentliche Statusseite, damit Kunden keine Tickets mehr aufmachen, um zu fragen, ob Sie schon Bescheid wissen.

Sie können einen Vorfall um 3 Uhr nachts von Hand melden oder ihn von einem Monitor melden lassen, sobald dessen Kriterien greifen. So oder so ist der Vorfall dasselbe Objekt, mit demselben Lebenszyklus und derselben Aktenlage am Ende.

## Auf einen Blick

- **Funktion oberster Ebene** – **Vorfälle** in der linken Navigation des Dashboards, unter `/dashboard/{projectId}/incidents`.
- **Drei vorangelegte Status** – **Identified**, **Bestätigt** und **Behoben** werden für jedes neue Projekt angelegt. Sie können eigene ergänzen; die drei vorangelegten lassen sich umbenennen und umfärben, aber nie löschen.
- **Drei vorangelegte Schweregrade** – **Critical Incident**, **Major Incident** und **Minor Incident**. Ein Schweregrad ist eine Beschriftung mit Farbe und Reihenfolge – er bringt kein eigenes Verhalten mit.
- **Vier Wege hinein** – der Assistent **Vorfall melden**, **Aus Vorlage erstellen**, eine Monitor-Kriterienregel oder `POST /api/incident`.
- **Nummeriert pro Projekt** – jeder Vorfall erhält eine Vorfallnummer, standardmäßig als `#42` dargestellt oder mit Ihrem eigenen Präfix, etwa `INC-42`.
- **Zwei Arten von Notizen** – private Notizen (interne Notizen) für Ihr Team, öffentliche Notizen für Statusseiten-Abonnenten.
- **Die Einstellungen liegen unter Vorfälle, nicht in den Projekteinstellungen** – Status, Schweregrade, Vorlagen, benutzerdefinierte Felder und die Regel-Engines finden Sie alle unter **Vorfälle → Einstellungen** und **Vorfälle → Regeln**.

## Wichtige Begriffe

Eine Handvoll Begriffe taucht auf jeder weiteren Seite dieses Abschnitts auf. Klären Sie diese zuerst.

| Begriff                        | Bedeutung                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vorfall**                    | Der Datensatz selbst – Titel, Beschreibung, Schweregrad, aktueller Status, betroffene Ressourcen und alles, was während der Reaktion dazu geschrieben wird. |
| **Vorfallsstatus**             | Wo der Vorfall in seinem Lebenszyklus steht. Ein projektbezogener Datensatz mit Name, Farbe und `order`, dazu die Flags, die ihm Bedeutung geben.       |
| **Vorfallsschweregrad**        | Wie schlimm es ist. Ein projektbezogener Datensatz mit Name, Farbe und `order`. Reine Klassifizierung – nichts im Produkt behandelt einen Schweregrad besonders. |
| **Vorfallnummer**              | Ein Zähler pro Projekt, angezeigt als `#42` oder, mit einem von Ihnen konfigurierten Präfix, als `INC-42`.                                              |
| **Betroffene Ressourcen**      | Die Monitore, Hosts, Kubernetes-Cluster, Docker-Hosts, Dienste und weitere Infrastruktur, die Sie an den Vorfall hängen.                                |
| **Öffentliche Notiz**          | Ein Update für Leser und Abonnenten der Statusseite. Es erscheint in der Zeitachse der Statusseite.                                                     |
| **Private Notiz**              | Eine interne Notiz (das Modell `IncidentInternalNote`) für das reagierende Team. Sie erreicht nie eine Statusseite.                                     |
| **Eigentümer**                 | Ein Benutzer oder Team, das für den Vorfall verantwortlich ist. Eigentümer werden bei der Erstellung, bei neuen Notizen und bei Statuswechseln benachrichtigt. |
| **Vorfall Feed**               | Die nur ergänzbare Aktivitätszeitachse auf der **Übersicht** des Vorfalls, die Statuswechsel, Notizen, Eigentümerwechsel, Regelausführungen und Benachrichtigungen festhält. |
| **Zustands-Zeitachse**         | Der Nachweis, in welchem Status der Vorfall wann und wie lange war – mit dem Abonnenten-Benachrichtigungsstatus für jeden Übergang.                     |

## Die drei Status, die OneUptime für jedes Projekt anlegt

Beim Anlegen eines Projekts erzeugt OneUptime genau drei Vorfallsstatus, in dieser Reihenfolge:

| Status           | Reihenfolge | Farbe              | Bedeutung                                                                     |
| ---------------- | ----------- | ------------------ | ------------------------------------------------------------------------------- |
| **Identified**   | 1           | Rot (`#fd625e`)    | Der Status, in dem ein brandneuer Vorfall landet. Das ist der Erstellungsstatus. |
| **Bestätigt**    | 2           | Gelb (`#ffbf53`)   | Jemand hat den Vorfall übernommen und arbeitet daran.                          |
| **Behoben**      | 3           | Grün (`#2ab57d`)   | Der Vorfall ist vorbei. Ihn zu beheben nimmt ihn von Ihrer Statusseite.        |

Die Namen sind bloß Beschriftungen – was das Verhalten tatsächlich steuert, sind drei Booleans auf dem Statusdatensatz: `isCreatedState`, `isAcknowledgedState` und `isResolvedState`. Pro Projekt sollte jedes dieser Flags nur ein einziger Status tragen.

Diese Unterscheidung wiegt schwerer, als sie klingt:

- `isCreatedState` legt fest, wo ein neuer Vorfall beginnt. Wird beim Anlegen kein Status ausdrücklich gewählt, sucht OneUptime den Erstellungsstatus des Projekts und verwendet ihn.
- `isAcknowledgedState` und `isResolvedState` steuern die Schaltflächen **Acknowledge** und **Beheben** im Vorfall-Header, die beiden Kennzahlkacheln auf der **Übersicht** des Vorfalls und das Zähler-Badge **Aktive Vorfälle** im Seitenmenü.
- **Aktive Vorfälle** ist ausschließlich definiert als „der aktuelle Status ist nicht der behobene Status". Jeder eigene Status, den Sie ergänzen, gilt daher als aktiv, solange er nicht der behobene ist.

**Achten Sie auf die Benennung.** Der erste angelegte Status heißt **Identified**, auch wenn ihn mehrere Beschreibungen im Produkt weiterhin Erstellungsstatus nennen. Wenn Sie in der Statusliste Ihres Projekts nach „Created" suchen: Gemeint ist die Zeile **Identified**.

Eigene Status legen Sie unter **Vorfälle → Einstellungen → Vorfallsstatus** an. Neue Status hängen sich ans Ende der sortierten Liste, und Sie können sie per Ziehen umsortieren. Die drei Status mit Flag lassen sich nicht löschen – OneUptime verhindert das –, aber Sie können sie umbenennen und umfärben; deshalb liest die Oberfläche Statusnamen dynamisch aus.

Die Reihenfolge wird erzwungen, sie ist nicht kosmetisch: Ein Vorfall kann nicht in einen Status wechseln, der in der Reihenfolge vor seinem aktuellen liegt.

Alle Einzelheiten stehen unter [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities).

## Die drei Schweregrade, die OneUptime für jedes Projekt anlegt

Jedes neue Projekt erhält außerdem drei Schweregrade:

| Schweregrad           | Reihenfolge | Farbe                     | Bedeutung                                                        |
| --------------------- | ----------- | ------------------------- | ------------------------------------------------------------------ |
| **Critical Incident** | 1           | Kastanienbraun (`#b70400`) | Sehr hohe Auswirkung auf Kunden, erfordert eine sofortige Reaktion. |
| **Major Incident**    | 2           | Rot (`#fd625e`)           | Erhebliche Auswirkung, erfordert meist eine sofortige Reaktion.   |
| **Minor Incident**    | 3           | Gelb (`#ffbf53`)          | Geringe Auswirkung, wird meist während der Arbeitszeit erledigt.  |

Die vollständigen vorangelegten Beschreibungen finden Sie unter [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities).

Schweregrade haben `name`, `description`, `color` und `order` – und sonst nichts. Es gibt keine Flags, und kein Codepfad behandelt „Critical Incident" anders als irgendeine andere Zeile. Der Schweregrad ist die Art, wie Menschen triagieren, und er steht als Übereinstimmungskriterium zur Verfügung, wenn Sie Bereitschaftsregeln schreiben – aber einen Schweregrad zu wählen alarmiert für sich genommen niemanden.

Schweregrade bearbeiten oder ergänzen Sie unter **Vorfälle → Einstellungen → Vorfallsschweregrad**.

## Das Leben eines Vorfalls

### 1. Er wird gemeldet

Vier Wege führen zum selben Objekt:

- **Von Hand** – klicken Sie in der Vorfallliste auf **Vorfall melden**. Das öffnet den Assistenten **Neuen Vorfall melden**, fünf Schritte lang: **Vorfalldetails**, **Betroffene Ressourcen**, **Vorfallsrollen**, **Bereitschaft**, **Mehr**.
- **Aus einer Vorlage** – klicken Sie auf **Aus Vorlage erstellen** und wählen Sie eine gespeicherte **Vorfall Vorlage**. Vorlagen füllen Titel, Beschreibung, Schweregrad, Anfangsstatus, Ressourcen, Bereitschaftsrichtlinien, Eigentümer und Beschriftungen vor.
- **Aus einem Monitor** – eine Monitor-Kriterienregel mit aktiviertem Schalter „einen Vorfall melden" erzeugt den Vorfall automatisch, sobald ihre Filter greifen. Titel und Beschreibungen unterstützen dort `{{variable}}`-Vorlagen.
- **Über die API** – `POST /api/incident` mit einem API-Schlüssel. Der Server ergänzt `declaredAt`, den Erstellungsstatus und die Vorfallnummer für Sie.

Die Anleitung Feld für Feld steht unter [Einen Vorfall melden](/docs/incidents/declaring-incidents).

### 2. Die richtigen Leute erfahren davon

Beim Anlegen führt OneUptime die von Ihnen konfigurierte Automatisierung aus: Beschriftungsregeln, Bereitschaftsregeln, Eigentümerregeln und Runbook-Regeln. Alle am Vorfall hängenden Bereitschaftsrichtlinien – von Hand gesetzt, aus einer Vorlage übernommen oder von einer passenden Bereitschaftsregel ergänzt – laufen parallel.

Eigentümer werden per E-Mail, SMS, Anruf, Push und WhatsApp benachrichtigt, jeweils nach den Benachrichtigungseinstellungen des einzelnen Benutzers. Hat ein Vorfall überhaupt keine Eigentümer, geht die Benachrichtigung ersatzweise an die Projekteigentümer, statt verloren zu gehen.

Ist der Vorfall auf einer Statusseite sichtbar und sind Abonnentenbenachrichtigungen aktiviert, erfahren auch die Abonnenten davon. Die Benachrichtigungen laufen über Cron-Jobs im Minutentakt – rechnen Sie also mit bis zu etwa einer Minute Verzögerung statt mit sofortigem Versand.

### 3. Ihr Team arbeitet daran

Responder bestätigen den Vorfall, hängen betroffene Ressourcen an, führen Runbooks aus, vergeben Vorfallsrollen und schreiben auf, was sie herausfinden – private Notizen fürs Team, öffentliche Notizen für Kunden, dazu die Seiten **Grundursache** und **Behebung**, sobald das Bild klarer wird. Alles davon landet im **Vorfall Feed** auf der Seite **Übersicht**.

### 4. Er wird behoben

Ein Klick auf **Beheben** setzt den Vorfall auf den behobenen Status, hält das in der Zustands-Zeitachse fest, stoppt die Dauer-Uhr und nimmt den Vorfall aus dem aktiven Bereich jeder Statusseite, auf der er zu sehen war. Mehr muss sich dafür nicht ändern – die Statusseiten-Abfrage schaut allein auf das Flag des behobenen Status.

Danach können Sie ein Postmortem schreiben und es optional auf der Statusseite veröffentlichen.

## Wo Vorfälle im Dashboard liegen

Öffnen Sie **Vorfälle** in der linken Navigation. Das Seitenmenü ist in Abschnitte gegliedert:

| Abschnitt          | Was Sie dort tun                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Übersicht**      | **Alle Vorfälle** und **Aktive Vorfälle** – Letzteres trägt ein rotes Badge mit der Anzahl der Vorfälle, die nicht im behobenen Status sind.                            |
| **Episoden**       | Vorfall-Episoden, eine eigenständige Gruppierungsfunktion mit eigenen Seiten.                                                                                           |
| **KI**             | **Untersuchung** und **Behebung** – die Einstellungen für automatische Untersuchung und Auto-Behebung.                                                                  |
| **Arbeitsbereich** | **Slack**- und **Microsoft Teams**-Verbindungen für Vorfälle.                                                                                                           |
| **Regeln**         | Die Regel-Engines: **Gruppierungsregeln**, **Bereitschaftsregeln**, **Eigentümerregeln**, **Runbook-Regeln**, **Datenschutzregeln**, **Beschriftungsregeln**, **SLA-Regeln**, **Reminder Rules**. |
| **Einstellungen**  | **Vorfallsstatus**, **Vorfallsschweregrad**, **Vorfall-Vorlagen**, **Notiz-Vorlagen**, **Postmortem-Vorlagen**, **Benutzerdefinierte Felder**, **Vorfallsrollen**, **Weitere Einstellungen**. |

**Regeln** und **Einstellungen** sind standardmäßig eingeklappt – klappen Sie sie auf, um die Seiten zu finden, auf die sich der Rest dieser Dokumentation bezieht. Die Vorfallkonfiguration liegt nicht in den Projekteinstellungen; sie ist vollständig hier zu Hause.

Die Vorfallliste selbst zeigt **Vorfallnummer**, **Titel**, **Status**, **Schweregrad**, **Betroffene Ressourcen**, **Erklärt**, **Dauer**, **Beschriftungen** und **Eigentümer**, dazu die Massenaktion **Status ändern**, um mehrere auf einmal zu schließen.

## Was jede Seite eines Vorfalls zeigt

Öffnen Sie einen Vorfall, und Sie erhalten ein linkes Seitenmenü, so gegliedert:

- **Übersicht** – die Karte **Vorfalldetails** (Titel, Schweregrad, Beschriftungen, Vorfallnummer, gemeldet am, gemeldet von, Bereitschaftsrichtlinien), eine Karte **Betroffene Ressourcen** und der **Vorfall Feed**. Darüber Kennzahlkacheln für die Bestätigungszeit, die Behebungszeit und die gesamte **Dauer**.
- **Zustands-Zeitachse** – jeder Status, in dem der Vorfall war, mit **Beginnt am**, **Endet am**, **Dauer** und dem Abonnenten-Benachrichtigungsstatus je Übergang. **Ursache anzeigen** und **Protokolle anzeigen** erklären, warum es zu jeder Änderung kam.
- **SLA** – die SLA-Verfolgung für diesen Vorfall.
- **Beschreibung**, **Grundursache**, **Behebung** – drei Markdown-Seiten. Die Beschreibung ist die, die auf Ihrer Statusseite erscheint.
- **Runbooks** – die Runbook-Ausführungen an diesem Vorfall.
- **Postmortem** – die Aufarbeitung, die Sie optional auf der Statusseite veröffentlichen können.
- **Rollen**, **Bereitschaftsausführungen**, **Eigentümer** – wer dran ist, welche Richtlinien ausgelöst haben und wer benachrichtigt wird.
- **Benachrichtigungsprotokolle**, **KI-Protokolle**, **Audit-Protokolle** – was gesendet wurde und was sich geändert hat.
- **Private Notizen** und **Öffentliche Notizen** – im Abschnitt **Notizen** des Seitenmenüs.
- **Benutzerdefinierte Felder**, **Einstellungen**, **Vorfall löschen** – unter **Erweitert**. Die Seite **Einstellungen** enthält **Auf Statusseite sichtbar**, **Privater Vorfall** und die Karte **Reminders**.

[Vorfallnotizen, Eigentümer & Feed](/docs/incidents/notes-owners-and-feed) behandelt die Seiten für die Zusammenarbeit im Detail.

## Wie Vorfälle zum Rest von OneUptime passen

- **Monitore entdecken das Problem; Vorfälle halten es fest.** Eine Monitor-Kriterienregel kann einen Vorfall automatisch melden und dabei Titel, Schweregrad, Bereitschaftsrichtlinien, Eigentümer, Beschriftungen und Behebungs-Notizen vorbelegen. Welche Variablen dort zur Verfügung stehen, steht unter [Vorfall- & Warnmeldungsvorlagen](/docs/monitor/incident-alert-templating).
- **Bereitschaftsrichtlinien übernehmen das Alarmieren.** Hängen Sie Richtlinien im Schritt **Bereitschaft** des Melde-Assistenten an, an eine Vorlage oder über **Vorfälle → Regeln → Bereitschaftsregeln**. Jede passende Regel greift – ausgeführt wird die Vereinigung aller Treffer plus alles direkt Angehängte, ohne Dubletten.
- **Runbooks sagen den Leuten, was zu tun ist.** Runbook-Regeln hängen automatisch eine Prozedur an, wenn ein passender Vorfall entsteht, und Responder können eine davon aus dem Vorfall heraus von Hand starten. Siehe [Runbooks – Übersicht](/docs/runbooks/index).
- **Statusseiten informieren Kunden.** Ein Vorfall erscheint in der aktiven Liste einer Statusseite, wenn auf der Seite Vorfälle aktiviert sind, der Vorfall als auf der Statusseite sichtbar markiert ist und sein aktueller Status nicht der behobene ist. Private Vorfälle sind auf jeder Statusseite ausgeblendet, immer. Siehe [Statusseiten – Übersicht](/docs/status-pages/index).
- **Workflows automatisieren drumherum.** Mit den Triggern **On Create Incident**, **On Update Incident** und **On Delete Incident** bauen Sie Automatisierung ohne Code auf dem Vorfall-Lebenszyklus auf. Siehe [Workflows – Übersicht](/docs/workflows/index).

## Wo Sie als Nächstes lesen sollten

- [Einen Vorfall melden](/docs/incidents/declaring-incidents) – der Assistent, Vorlagen, Monitor-Kriterien und die API.
- [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities) – die Status-Flags, eigene Status und die Schweregrad-Klassifizierung.
- [Vorfallnotizen, Eigentümer & Feed](/docs/incidents/notes-owners-and-feed) – öffentliche und private Notizen, Eigentümer und der Aktivitäts-Feed.
- [Vorfalleinstellungen & Automatisierung](/docs/incidents/settings) – Vorlagen, benutzerdefinierte Felder, Nummernpräfixe und die Regel-Engines.
- [Statusseiten – Übersicht](/docs/status-pages/index) – wie Vorfälle bei Ihren Kunden ankommen.
- [Abonnenten & Ankündigungen](/docs/status-pages/subscribers) – wer benachrichtigt wird, wenn sich ein Vorfall bewegt.
