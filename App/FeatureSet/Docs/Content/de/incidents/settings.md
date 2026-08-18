# Einstellungen & Automatisierung

Die Vorfallkonfiguration liegt nicht in den Projekteinstellungen. Sie befindet sich innerhalb des Produktbereichs Vorfälle selbst, unter **Incidents → Settings** und **Incidents → Rules**, unter Routen, die mit `/dashboard/{projectId}/incidents/settings/` beginnen. Wenn Sie in **Project Settings** nach Vorfall-Vorlagen oder benutzerdefinierten Feldern gesucht haben, ist das der Grund, warum Sie sie nicht gefunden haben.

Sowohl der Abschnitt **Rules** als auch der Abschnitt **Settings** im Seitenmenü Vorfälle sind standardmäßig eingeklappt, sodass Sie sie aufklappen müssen, bevor die unten stehenden Einträge erscheinen. Alles hier ist projektbezogen: Vorlagen, Rollen, benutzerdefinierte Felder und Regeln gehören zu einem Projekt und gelten für jeden in diesem Projekt gemeldeten Vorfall.

Diese Seite ist die Referenz für diese Konfiguration – was jede Seite enthält und welcher Teil davon automatisch abläuft, sobald ein Vorfall angelegt wird.

## Wo die Vorfalleinstellungen liegen

Öffnen Sie **Incidents** in der linken Navigation und klappen Sie dann **Settings** unten im Seitenmenü auf.

| Seite                     | Was Sie dort tun                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| **Incident State**        | Fügen Sie die Status hinzu, durch die ein Vorfall läuft, benennen Sie sie um, färben Sie sie um und ordnen Sie sie neu. |
| **Incident Severity**     | Fügen Sie Schweregrade hinzu, benennen Sie sie um, färben Sie sie um und ordnen Sie sie neu.  |
| **Incident Templates**    | Füllen Sie einen ganzen Vorfall vor – Titel, Beschreibung, Ressourcen, Bereitschaftsrichtlinien, Eigentümer, Beschriftungen. |
| **Note Templates**        | Wiederverwendbarer Text für öffentliche und private Notizen.                                  |
| **Postmortem Templates**  | Wiederverwendbare Postmortem-Strukturen.                                                       |
| **Custom Fields**         | Definieren Sie zusätzliche Felder, die bei jedem Vorfall erscheinen.                           |
| **Incident Roles**        | Definieren Sie die Rollen, denen Sie Responder zuweisen, etwa Incident Commander.               |
| **More Settings**         | Die Nummernpräfixe für Vorfall und Vorfall-Episode.                                             |

**Incident State** und **Incident Severity** werden ausführlich unter [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities) behandelt – der Rest dieser Seite setzt bei **Incident Templates** an.

Klappen Sie **Rules** auf, und Sie erhalten acht weitere Seiten: **Grouping Rules**, **On-Call Rules**, **Owner Rules**, **Runbook Rules**, **Privacy Rules**, **Label Rules**, **SLA Rules** und **Reminder Rules**. Diese werden weiter unten behandelt.

## Vorfall-Vorlagen

Eine Vorfall-Vorlage ist ein gespeichertes Grundgerüst für einen Vorfall. Statt jedes Mal, wenn der Zahlungscluster wackelt, denselben Titel, dieselbe Monitor-Liste und dieselbe Bereitschaftsrichtlinie neu einzutippen, speichern Sie sie einmal und melden den Vorfall daraus.

Gehen Sie zu **Incidents → Settings → Incident Templates** (`/dashboard/{projectId}/incidents/settings/templates`). Die Karte trägt den Titel **Incident Templates**. Beim Erstellen führt Sie ein sechsstufiger Assistent durch den Vorgang:

- **Template Info** – **Template Name** und **Template Description**. Diese benennen die Vorlage selbst; sie erscheinen niemals auf dem Vorfall.
- **Incident Details** – **Title**, **Description** (Markdown), **Incident Severity** und **Initial Incident State**. **Initial Incident State** ist optional und beginnt leer; seine Optionen werden in Statusreihenfolge aufgelistet. Lassen Sie es leer, landen Vorfälle aus dieser Vorlage im Erstellungsstatus des Projekts.
- **Resources Affected** – die Monitore, Hosts, Cluster und Dienste, an die der Vorfall angehängt werden soll, plus **Change Monitor Status to**.
- **On-Call** – **On-Call Policy**, die Richtlinien, die ausgeführt werden, wenn ein aus dieser Vorlage erstellter Vorfall gemeldet wird.
- **Owners** – **Owner - Teams** und **Owner - Users**.
- **Labels** – **Labels**.

Ein paar kurze Regeln:

- Die Vorlagenliste zeigt nur **Name** und **Description**. Zeilen sind aus der Liste heraus nicht bearbeit- oder löschbar – öffnen Sie eine Vorlage (`/dashboard/{projectId}/incidents/settings/templates/{modelId}`), um sie zu ändern.
- Vorlagen unterstützen JSON-Import und -Export, sodass Sie eine zwischen Projekten verschieben können.
- Der leere Zustand zeigt „No incident templates found."

### Wie eine Vorlage angewendet wird

Es gibt zwei Wege, und sie verhalten sich gleich.

- **Aus dem Dashboard** – die Schaltfläche **Create from Template** in der Vorfallliste öffnet einen **Select Incident Template**-Auswähler, und die Meldeseite liest die Vorlage aus dem Query-String-Parameter `incidentTemplateId` und füllt das Formular anschließend mit der Vorlage sowie ihren Eigentümer-Teams und Eigentümer-Benutzern vor.
- **Über die API** – übergeben Sie `createdIncidentTemplateId` bei `POST /api/incident`, und der Server füllt den Vorfall aus der Vorlage.

Der wichtige Teil ist die Zusammenführungsregel: **Eine Vorlage füllt nur ein Feld, das Sie undefiniert gelassen haben.** Titel, Beschreibung, Schweregrad, Anfangsstatus, der Monitor-Status hinter **Change Monitor Status to**, Monitore, Hosts, Kubernetes-Cluster, Docker-Hosts, Podman-Hosts, Dienste, Bereitschaftsrichtlinien und Beschriftungen werden nur dann aus der Vorlage übernommen, wenn der Aufrufer oder das Formular nichts geliefert hat. Alles, was Sie ausdrücklich setzen, gewinnt immer.

**Der Leer-Zustand-Dialog zeigt auf die falsche Stelle.** Wenn Sie noch keine Vorlagen haben, zeigt die Schaltfläche **Create from Template** einen Dialog **No Incident Templates**. Sein Text verweist auf Project Settings, aber die Schaltfläche führt zu **Incidents → Settings → Incident Templates** – das ist der tatsächliche Ort.

## Notiz-Vorlagen

Notiz-Vorlagen geben Respondern vorgefertigten Text für Vorfall-Updates, damit ein Statusseiten-Update um 3 Uhr nachts nicht von jemandem halb im Schlaf frei formuliert werden muss.

Gehen Sie zu **Incidents → Settings → Note Templates** (`/dashboard/{projectId}/incidents/settings/note-templates`). Die Karte trägt den Titel **Public or Private Note Templates for Incidents** – eine Bibliothek bedient beide Notiztypen. Das Erstellungsformular hat zwei Schritte:

- **Template Info** – **Template Name** und **Template Description**, beide erforderlich.
- **Note Details** – den Notiztext selbst, in Markdown, erforderlich.

Wie bei Vorfall-Vorlagen werden Zeilen erstellt und angesehen, nicht inline bearbeitet; öffnen Sie eine Vorlage, um sie zu ändern.

Notiz-Vorlagen tauchen genau dort auf, wo Sie sie brauchen: Die Bestätigungsdialoge **Acknowledge Incident** und **Resolve Incident** bieten beide **Select Note Template** neben dem Feld **Public Note** an. Siehe [Vorfallnotizen, Eigentümer & Feed](/docs/incidents/notes-owners-and-feed) für die Unterschiede zwischen öffentlichen und privaten Notizen.

## Postmortem-Vorlagen

Eine Postmortem-Vorlage ist das Grundgerüst des Berichts, den Sie nach einem Vorfall erstellen – Ihre Überschriften, Ihre Leitfragen, Ihre Standardfragen –, damit jede Nachbetrachtung im Projekt derselben Struktur folgt.

Gehen Sie zu **Incidents → Settings → Postmortem Templates** (`/dashboard/{projectId}/incidents/settings/postmortem-templates`). Die Karte trägt den Titel **Postmortem Templates**. Das Erstellungsformular hat zwei Schritte:

- **Template Info** – **Template Name** und **Template Description**, beide erforderlich.
- **Postmortem Details** – **Postmortem Template**, den Text selbst, in Markdown, erforderlich.

Sie wenden eine Vorlage aus dem Vorfall heraus an, nicht aus den Einstellungen. Öffnen Sie einen Vorfall, wählen Sie **Postmortem** in seinem Seitenmenü (`/dashboard/{projectId}/incidents/{incidentId}/postmortem`) und verwenden Sie **Apply Template**. Das öffnet einen Dialog **Apply Postmortem Template** mit einem Dropdown **Select Template**; die Auswahl einer Vorlage lädt deren Text in den Editor **Postmortem Note**, wo Sie ihn vor dem Speichern bearbeiten. Vorfall-Episoden haben dieselbe Seite **Postmortem** und greifen auf dieselbe Vorlagenbibliothek zu.

## Benutzerdefinierte Felder

Benutzerdefinierte Felder lassen Sie eigene Metadaten auf jedem Vorfall mitführen – einen internen Dienstnamen, eine Änderungsticket-Referenz, eine Kundenstufe.

Gehen Sie zu **Incidents → Settings → Custom Fields** (`/dashboard/{projectId}/incidents/settings/custom-fields`). Die Seite trägt den Titel **Incident Custom Fields**. Jede Definition hat:

- **Field Name** – erforderlich, mindestens zwei Zeichen. Der Platzhalter schlägt einen slug-artigen Namen wie `internal-service` vor.
- **Field Description** – optional.
- **Field Type** – erforderlich. Dies bestimmt, wie Daten eingegeben werden. Dropdown-Typen benötigen zudem aufgelistete Optionen.
- **Dropdown Options** – die Werte, die im Dropdown erscheinen, jeweils mit optionaler Farbe.

Definitionen leben in ihrem eigenen Modell; die Werte leben am Vorfall selbst in der Spalte `customFields`. Bei einem einzelnen Vorfall füllen Sie sie über **Custom Fields** im Seitenmenü des Vorfalls aus (`/dashboard/{projectId}/incidents/{incidentId}/custom-fields`).

**Eine Lücke, die es wert ist, bekannt zu sein.** Vorfall-Definitionen für benutzerdefinierte Felder sind der einzige Teil der Vorfallfamilie ohne Workflow-Trigger – siehe den Workflow-Abschnitt unten.

## Vorfallrollen

Vorfallrollen sind die benannten Aufgaben, denen Sie Personen während einer Reaktion zuweisen. Definieren Sie sie unter **Incidents → Settings → Incident Roles** (`/dashboard/{projectId}/incidents/settings/roles`); die Kartenbeschreibung nennt Incident Commander und Responder als Beispiele.

Rollen sind nur Definitionen. Sie weisen Personen ihnen pro Vorfall zu – der Melde-Assistent hat einen Schritt **Incident Roles** mit einem Feld **Assign Incident Roles**, und jeder Vorfall hat eine Seite **Roles** in seinem Seitenmenü.

## Nummernpräfixe

Jeder Vorfall erhält eine Nummer. Standardmäßig wird sie als `#42` dargestellt. Wenn Ihr Team laut „INC-42" sagt, lassen Sie das Produkt es auch sagen.

Gehen Sie zu **Incidents → Settings → More Settings** (`/dashboard/{projectId}/incidents/settings/more`). Die Karte heißt **Number Prefix** und enthält zwei Felder auf dem Projekt:

- **Incident Number Prefix** – bis zu 20 Zeichen, Platzhalter `INC-`. Setzen Sie es, und Vorfall `#42` wird als `INC-42` angezeigt.
- **Incident Episode Number Prefix** – dieselbe Idee für Vorfall-Episodennummern, Platzhalter `IE-`.

Lassen Sie beide leer, um das Standardpräfix `#` beizubehalten; das nicht gesetzte Feld zeigt `# (default)`. Speichern Sie mit **Update**. Der Wert mit Präfix wird am Vorfall als `incidentNumberWithPrefix` gespeichert, was die Vorfallliste und die Vorfall-Kopfzeile darstellen.

## Regeln, die beim Anlegen eines Vorfalls ausgeführt werden

**Incidents → Rules** enthält acht Regel-Engines. Sie alle erledigen dieselbe Aufgabe – einen Vorfall in dem Moment betrachten, in dem er angelegt wird, und handeln, wenn er passt –, unterscheiden sich aber darin, was sie tun und wie mehrere passende Regeln aufgelöst werden.

- **Grouping Rules** – gruppieren zusammengehörige Vorfälle in Episoden. Regeln werden in Prioritätsreihenfolge ausgewertet; niedrigere Prioritätszahlen zuerst.
- **On-Call Rules** – führen Bereitschaftsrichtlinien für passende Vorfälle aus. Wird weiter unten ausführlich behandelt.
- **Owner Rules** – weisen automatisch Eigentümer zu.
- **Runbook Rules** – starten ein [Runbook](/docs/runbooks/index), wenn ein Vorfall passt.
- **Privacy Rules** – entscheiden, ob ein passender Vorfall privat ist.
- **Label Rules** – wenden automatisch Beschriftungen an.
- **SLA Rules** – verfolgen Reaktions- und Behebungszeiten. Regeln werden der Reihe nach ausgewertet; niedrigere Reihenfolgezahlen zuerst.
- **Reminder Rules** – erinnern Vorfall-Eigentümer periodisch, während ein Vorfall noch offen ist. Regeln werden der Reihe nach ausgewertet, und die erste passende Regel gewinnt.

**Die Reihenfolge-Semantik ist nicht einheitlich.** Grouping Rules, SLA Rules und Reminder Rules werden reihenfolge-ausgewertet. On-Call Rules sind es nicht – jede passende Regel wird ausgelöst. Gehen Sie nicht davon aus, dass ein Modell für alle acht gilt.

Die Seiten **On-Call Rules**, **Owner Rules**, **Label Rules** und **Privacy Rules** sind in Tabs unterteilt – ein Tab **Incident Rules** und ein Tab **Episode Rules**, jeweils mit eigener Tabelle. Konfigurieren Sie den Tab **Incident Rules**, sofern Sie nicht ausdrücklich Episoden meinen. **Grouping Rules**, **Runbook Rules**, **SLA Rules** und **Reminder Rules** sind einzelne Tabellen.

## Bereitschaftsregeln für Vorfälle

**Incidents → Rules → On-Call Rules** (`/dashboard/{projectId}/incidents/settings/on-call-rules`) ist der Ort, an dem Sie die Alarmierung automatisieren. Die Karte **Incident On-Call Rules** beschreibt Regeln, die automatisch Bereitschaftsrichtlinien ausführen, wenn passende Vorfälle angelegt werden. Die Seite hat zwei Tabs: **Incident Rules** und **Episode Rules**.

Das Erstellungsformular hat drei Schritte:

- **Basic Info** – **Name** (der Platzhalter schlägt etwas wie „das Datenbankteam für jeden DB-Vorfall alarmieren" vor), **Description** und einen Schalter **Enabled**. Die Liste zeigt pro Regel eine grüne Plakette **Enabled** oder eine rote **Disabled**.
- **Match Criteria** – **Monitors**, **Incident Severities**, **Incident Labels**, **Monitor Labels**, plus Groß-/Kleinschreibung ignorierende Regex-Felder für den Vorfalltitel, die Vorfallbeschreibung, den Monitor-Namen und die Monitor-Beschreibung.
- **On-Call Policies** – die Richtlinien, die diese Regel ausführt.

### Wie das Matching aufgelöst wird

Die Regeln, die die Seite selbst mitbringt, lohnt es sich zu verinnerlichen:

- Eine Regel passt nur, wenn **alle** von Ihnen ausgefüllten Kriterien zutreffen. Leer gelassene Kriterien werden übersprungen, nicht als nicht erfüllt gewertet.
- Innerhalb eines einzelnen Listenkriteriums – **Monitors**, **Incident Severities**, **Incident Labels**, **Monitor Labels** – ist das Matching ein Oder.
- Die Musterfelder sind Groß-/Kleinschreibung ignorierende reguläre Ausdrücke.
- **Alle passenden Regeln werden ausgelöst.** Es gibt weder eine Priorität noch einen Kurzschluss.
- Die Menge der Richtlinien, die tatsächlich ausgeführt wird, ist die Vereinigung der Richtlinien aller passenden Regeln plus aller Richtlinien, die manuell oder per Vorlage am Vorfall angehängt wurden, dedupliziert, sodass jede Richtlinie höchstens einmal läuft.

Schweregrad ist hier und nirgendwo sonst ein Match-Kriterium. Es gibt kein Bereitschaftsfeld auf einem Vorfallschweregrad – die Auswahl von „Critical Incident" alarmiert für sich genommen niemanden. Wenn Sie möchten, dass der Schweregrad die Alarmierung antreibt, schreiben Sie eine On-Call-Regel, die darauf passt.

## Bereitschaftsrichtlinien direkt anhängen

Regeln sind nicht der einzige Weg. Jeder Vorfall führt eine eigene Liste von Bereitschaftsrichtlinien mit, die als Feld **On-Call Policy** im Schritt **On-Call** des Melde-Assistenten und im Schritt **On-Call** einer Vorfall-Vorlage auftaucht. Die Feldbeschreibung sagt es unumwunden: Dies sind die Bereitschaftsrichtlinien, die ausgeführt werden, wenn dieser Vorfall angelegt wird.

Wenn ein Vorfall angelegt wird, führt OneUptime zunächst die Label-Regeln aus, dann die On-Call-Regeln (die ihre passenden Richtlinien in die Liste des Vorfalls einfügen), dann die Runbook-Regeln – und wenn die resultierende Liste nicht leer ist, wird jede Richtlinie darin ausgeführt. Ausführungen laufen parallel und werden unabhängig voneinander abgeschlossen, sodass eine fehlschlagende Richtlinie die anderen nicht stoppt. Jede Ausführung ist mit dem auslösenden Vorfall und dem Benachrichtigungs-Ereignistyp „Vorfall angelegt" verknüpft.

Um zu sehen, was passiert ist, öffnen Sie den Vorfall und wählen **On-Call Executions** in seinem Seitenmenü (`/dashboard/{projectId}/incidents/{incidentId}/on-call-policy-execution-logs`).

## Vorfälle aus Workflows heraus steuern

Workflow-Trigger für Vorfälle werden nicht von Hand geschrieben – OneUptime generiert sie aus den Datenmodellen, sodass jedes Modell der Vorfallfamilie die Komponenten **On Create X**, **On Update X** und **On Delete X** erhält, benannt nach dem Singularnamen des Modells. Die wichtigsten drei sind **On Create Incident**, **On Update Incident** und **On Delete Incident**, und sie leben in der Kategorie **Incident** der Workflow-Komponentenpalette unter `/dashboard/{projectId}/workflows`.

Dieselbe Generierung liefert Ihnen Trigger für die Konfiguration selbst: **On Create Incident State**, **On Update Incident Severity**, **On Create Incident Template**, **On Create Incident Note Template**, **On Create Incident State Timeline**, **On Create Incident Public Note**, **On Create Incident Internal Note**, **On Create Incident On-Call Rule**, **On Create Incident Role**, **On Create Incident Member** und weitere. Jedes Modell erhält außerdem passende Aktionskomponenten – **Find One Incident**, **Create One Incident**, **Update One Incident**, **Delete One Incident** und ihre Viele-Zeilen-Entsprechungen –, sodass ein Trigger und eine Aktion mit ähnlichen Namen nebeneinander in derselben Kategorie stehen. **On Create Incident** startet einen Workflow; **Create One Incident** öffnet einen.

Ein paar Details, die wichtig sind, wenn Sie diese verdrahten:

- **On Update X** nimmt ein optionales Argument **Listen on**, das den Trigger auf Updates einschränkt, die bestimmte Felder betreffen. Lassen Sie es leer, um bei jeder Änderung auszulösen. Kommt ein Update ohne Aufzeichnung an, welche Felder sich geändert haben, wird der Filter übersprungen und der Workflow läuft trotzdem.
- **On Create X** und **On Update X** nehmen beide ein erforderliches Argument **Select Fields**; **On Delete X** nimmt keine Argumente.
- Alle drei stellen einen einzigen Ausgangsport **Success** bereit, und jede akzeptiert ein ID-Argument, sodass Sie den Workflow von Hand für einen einzelnen Datensatz ausführen können.
- Namen stammen vom Singularnamen des Modells, nicht von seinem Tabellennamen – deshalb sehen Sie **On Create Incident Team Owner** und **On Create Incident User Owner** statt tabellenförmiger Namen.
- Es gibt keine Trigger für Vorfall-Definitionen benutzerdefinierter Felder. Dieses Modell ist das einzige Mitglied der Vorfallfamilie mit deaktivierten Workflows.

Für den Rest des Workflow-Aufbaus siehe [Einen Workflow erstellen](/docs/workflows/authoring) und [Variablen](/docs/workflows/variables).

## Wo Sie als Nächstes lesen sollten

- [Vorfälle – Übersicht](/docs/incidents/index) – wie das Vorfall-Feature zusammenspielt.
- [Einen Vorfall melden](/docs/incidents/declaring-incidents) – der Melde-Assistent, Vorlagen und die API.
- [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities) – die Einstellungsseiten für Status und Schweregrad und was die Flags bewirken.
- [Vorfallnotizen, Eigentümer & Feed](/docs/incidents/notes-owners-and-feed) – wo Notiz-Vorlagen verwendet werden.
- [Abonnenten & Ankündigungen](/docs/status-pages/subscribers) – wer außerhalb Ihres Teams von einem Vorfall erfährt.
- [Workflows – Übersicht](/docs/workflows/index) – Automatisierung auf Basis von Vorfall-Triggern.
- [Runbooks – Übersicht](/docs/runbooks/index) – die Abläufe, an die Runbook-Regeln anknüpfen.
