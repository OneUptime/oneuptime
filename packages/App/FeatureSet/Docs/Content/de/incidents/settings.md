# Einstellungen & Automatisierung

Die Vorfallkonfiguration liegt nicht in den Projekteinstellungen. Sie liegt im Produktbereich Vorfälle selbst, unter **Vorfälle → Einstellungen** und **Vorfälle → Regeln**, auf Routen, die mit `/dashboard/{projectId}/incidents/settings/` beginnen. Wenn Sie die **Projekteinstellungen** nach Vorfall-Vorlagen oder benutzerdefinierten Feldern abgesucht haben – das ist der Grund, warum Sie dort nichts gefunden haben.

Sowohl der Abschnitt **Regeln** als auch der Abschnitt **Einstellungen** im Seitenmenü von Vorfälle sind standardmäßig eingeklappt; Sie müssen sie also aufklappen, bevor die unten genannten Punkte erscheinen. Alles hier gilt pro Projekt: Vorlagen, Rollen, benutzerdefinierte Felder und Regeln gehören zu genau einem Projekt und greifen für jeden darin gemeldeten Vorfall.

Diese Seite ist die Referenz für diese Konfiguration – was auf welcher Seite steckt und was davon automatisch läuft, sobald ein Vorfall entsteht.

## Wo die Vorfalleinstellungen liegen

Öffnen Sie **Vorfälle** in der linken Navigation und klappen Sie unten im Seitenmenü **Einstellungen** auf.

| Seite                      | Was Sie dort tun                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Vorfallsstatus**         | Die Status, die ein Vorfall durchläuft, hinzufügen, umbenennen, neu einfärben und neu anordnen.            |
| **Vorfallsschweregrad**    | Schweregrade hinzufügen, umbenennen, neu einfärben und neu anordnen.                                       |
| **Vorfall-Vorlagen**       | Einen ganzen Vorfall vorbelegen – Titel, Beschreibung, Ressourcen, Bereitschaftsrichtlinien, Eigentümer, Beschriftungen. |
| **Notiz-Vorlagen**         | Wiederverwendbarer Text für öffentliche und private Notizen.                                               |
| **Postmortem-Vorlagen**    | Wiederverwendbare Postmortem-Strukturen.                                                                  |
| **Benutzerdefinierte Felder** | Zusätzliche Felder definieren, die an jedem Vorfall erscheinen.                                         |
| **Vorfallsrollen**         | Die Rollen definieren, denen Sie Responder zuweisen, etwa Incident Commander.                              |
| **Weitere Einstellungen**  | Die Nummernpräfixe für Vorfälle und Vorfall-Episoden.                                                      |

**Vorfallsstatus** und **Vorfallsschweregrad** werden ausführlich unter [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities) behandelt – der Rest dieser Seite setzt bei **Vorfall-Vorlagen** an.

Klappen Sie **Regeln** auf, kommen acht weitere Seiten dazu: **Gruppierungsregeln**, **Bereitschaftsregeln**, **Eigentümerregeln**, **Runbook-Regeln**, **Datenschutzregeln**, **Beschriftungsregeln**, **SLA-Regeln** und **Reminder Rules**. Die behandeln wir weiter unten.

## Vorfall-Vorlagen

Eine Vorfall-Vorlage ist das gespeicherte Gerüst eines Vorfalls. Statt jedes Mal denselben Titel, dieselbe Monitorliste und dieselbe Bereitschaftsrichtlinie neu einzutippen, wenn der Payments-Cluster wackelt, speichern Sie das alles einmal und melden daraus.

Gehen Sie zu **Vorfälle → Einstellungen → Vorfall-Vorlagen** (`/dashboard/{projectId}/incidents/settings/templates`). Die Karte heißt **Vorfall-Vorlagen**. Beim Anlegen führt Sie ein sechsstufiger Assistent:

- **Vorlageninformationen** – **Vorlagenname** und **Vorlagenbeschreibung**. Sie benennen die Vorlage selbst und erscheinen nie am Vorfall.
- **Vorfalldetails** – **Titel**, **Beschreibung** (Markdown), **Vorfallsschweregrad** und **Anfänglicher Vorfallstatus**. **Anfänglicher Vorfallstatus** ist optional und startet leer; die Optionen sind in Statusreihenfolge aufgelistet. Lassen Sie das Feld leer, landen Vorfälle aus dieser Vorlage im Erstellungsstatus des Projekts.
- **Betroffene Ressourcen** – die Monitore, Hosts, Cluster und Dienste, an die der Vorfall gehängt werden soll, dazu **Überwachungsstatus ändern in**.
- **Bereitschaft** – **Bereitschaftsrichtlinie**, also die Richtlinien, die ausgeführt werden, wenn ein aus dieser Vorlage erstellter Vorfall gemeldet wird.
- **Eigentümer** – **Eigentümer – Teams** und **Eigentümer – Benutzer**.
- **Beschriftungen** – **Beschriftungen**.

Ein paar knappe Regeln dazu:

- Die Vorlagenliste zeigt nur **Name** und **Beschreibung**. Zeilen lassen sich aus der Liste heraus weder bearbeiten noch löschen – öffnen Sie eine Vorlage (`/dashboard/{projectId}/incidents/settings/templates/{modelId}`), um sie zu ändern.
- Vorlagen unterstützen JSON-Import und -Export, Sie können eine also zwischen Projekten umziehen.
- Der Leerzustand lautet „No incident templates found.“

### Wie eine Vorlage angewendet wird

Es gibt zwei Wege, und beide verhalten sich gleich.

- **Aus dem Dashboard** – die Schaltfläche **Aus Vorlage erstellen** in der Vorfallliste öffnet den Auswahldialog **Vorfallvorlage auswählen**; die Meldeseite liest die Vorlage aus dem Query-String-Parameter `incidentTemplateId` und belegt das Formular dann mit der Vorlage samt ihren Eigentümer-Teams und Eigentümer-Benutzern vor.
- **Über die API** – übergeben Sie `createdIncidentTemplateId` an `POST /api/incident`, und der Server füllt den Vorfall aus der Vorlage.

Entscheidend ist die Zusammenführungsregel: **Eine Vorlage füllt nur ein Feld, das Sie undefiniert gelassen haben.** Titel, Beschreibung, Vorfallsschweregrad, anfänglicher Vorfallstatus, der Monitor-Status hinter **Überwachungsstatus ändern in**, Monitore, Hosts, Kubernetes-Cluster, Docker-Hosts, Podman-Hosts, Dienste, Bereitschaftsrichtlinien und Beschriftungen werden nur dann aus der Vorlage übernommen, wenn Aufrufer oder Formular nichts geliefert haben. Was Sie ausdrücklich setzen, gewinnt immer.

**Der Dialog im Leerzustand verweist an die falsche Stelle.** Haben Sie noch keine Vorlagen, öffnet die Schaltfläche **Aus Vorlage erstellen** einen Dialog **No Incident Templates**. Dessen Text zeigt auf die Projekteinstellungen, die Schaltfläche führt aber nach **Vorfälle → Einstellungen → Vorfall-Vorlagen** – und das ist der tatsächliche Ort.

## Notiz-Vorlagen

Notiz-Vorlagen geben Respondern fertigen Text für Vorfall-Updates an die Hand, damit ein Statusseiten-Update um 3 Uhr nachts nicht von jemandem im Halbschlaf frei formuliert werden muss.

Gehen Sie zu **Vorfälle → Einstellungen → Notiz-Vorlagen** (`/dashboard/{projectId}/incidents/settings/note-templates`). Die Karte heißt **Vorlagen für öffentliche oder private Notizen für Vorfälle** – eine Bibliothek bedient beide Notiztypen. Das Erstellungsformular hat zwei Schritte:

- **Vorlageninformationen** – **Vorlagenname** und **Vorlagenbeschreibung**, beide Pflicht.
- **Notizdetails** – der Notiztext selbst, in Markdown, Pflichtfeld.

Wie bei Vorfall-Vorlagen werden Zeilen angelegt und angesehen, nicht direkt in der Liste bearbeitet; öffnen Sie eine Vorlage, um sie zu ändern.

Notiz-Vorlagen tauchen dort auf, wo Sie sie wirklich brauchen: Die Bestätigungsdialoge **Acknowledge Incident** und **Resolve Incident** bieten beide neben dem Feld **Öffentliche Notiz** die Auswahl **Notizvorlage auswählen**. Wie sich öffentliche und private Notizen unterscheiden, steht unter [Vorfallnotizen, Eigentümer & Feed](/docs/incidents/notes-owners-and-feed).

## Postmortem-Vorlagen

Eine Postmortem-Vorlage ist das Gerüst der Aufarbeitung, die Sie nach einem Vorfall schreiben – Ihre Überschriften, Ihre Denkanstöße, Ihre Standardfragen –, damit jede Nachbetrachtung im Projekt derselben Form folgt.

Gehen Sie zu **Vorfälle → Einstellungen → Postmortem-Vorlagen** (`/dashboard/{projectId}/incidents/settings/postmortem-templates`). Die Karte heißt **Postmortem-Vorlagen**. Das Erstellungsformular hat zwei Schritte:

- **Vorlageninformationen** – **Vorlagenname** und **Vorlagenbeschreibung**, beide Pflicht.
- **Postmortem-Details** – **Postmortem-Vorlage**, der Text selbst, in Markdown, Pflichtfeld.

Angewendet wird eine Vorlage vom Vorfall aus, nicht aus den Einstellungen. Öffnen Sie einen Vorfall, wählen Sie **Postmortem** in seinem Seitenmenü (`/dashboard/{projectId}/incidents/{incidentId}/postmortem`) und nutzen Sie **Vorlage anwenden**. Das öffnet den Dialog **Postmortem-Vorlage anwenden** mit dem Dropdown **Vorlage auswählen**; sobald Sie eine auswählen, lädt ihr Text in den Editor **Postmortem-Notiz**, wo Sie ihn vor dem Speichern bearbeiten. Vorfall-Episoden haben dieselbe Seite **Postmortem** und greifen auf dieselbe Vorlagenbibliothek zu.

## Benutzerdefinierte Felder

Mit benutzerdefinierten Feldern führen Sie eigene Metadaten an jedem Vorfall mit – einen internen Dienstnamen, die Referenz auf ein Change-Ticket, eine Kundenstufe.

Gehen Sie zu **Vorfälle → Einstellungen → Benutzerdefinierte Felder** (`/dashboard/{projectId}/incidents/settings/custom-fields`). Die Seite heißt **Benutzerdefinierte Vorfall-Felder**. Jede Definition hat:

- **Feldname** – Pflicht, mindestens zwei Zeichen. Der Platzhalter schlägt einen Slug-artigen Namen wie `internal-service` vor.
- **Feldbeschreibung** – optional.
- **Feldtyp** – Pflicht. Er bestimmt, wie Daten eingegeben werden. Dropdown-Typen brauchen zusätzlich ihre Optionen.
- **Dropdown-Optionen** – die Werte, die im Dropdown erscheinen, jeder mit einer optionalen Farbe.

Die Definitionen liegen in einem eigenen Modell; die Werte liegen am Vorfall selbst in der Spalte `customFields`. An einem einzelnen Vorfall füllen Sie sie über **Benutzerdefinierte Felder** im Seitenmenü des Vorfalls aus (`/dashboard/{projectId}/incidents/{incidentId}/custom-fields`).

**Eine Lücke, die man kennen sollte.** Definitionen benutzerdefinierter Vorfall-Felder sind der einzige Teil der Vorfall-Familie ohne Workflow-Trigger – siehe den Workflow-Abschnitt weiter unten.

## Vorfallsrollen

Vorfallsrollen sind die benannten Aufgaben, denen Sie während einer Reaktion Personen zuweisen. Definiert werden sie unter **Vorfälle → Einstellungen → Vorfallsrollen** (`/dashboard/{projectId}/incidents/settings/roles`); die Kartenbeschreibung nennt Incident Commander und Responder als Beispiele.

Rollen sind nur Definitionen. Zugewiesen werden Personen pro Vorfall – der Melde-Assistent hat einen Schritt **Vorfallsrollen** mit dem Feld **Vorfallrollen zuweisen**, und jeder Vorfall hat eine Seite **Rollen** in seinem Seitenmenü.

## Nummernpräfixe

Jeder Vorfall bekommt eine Nummer. Standardmäßig erscheint sie als `#42`. Wenn Ihr Team laut „INC-42“ sagt, soll das Produkt es auch sagen.

Gehen Sie zu **Vorfälle → Einstellungen → Weitere Einstellungen** (`/dashboard/{projectId}/incidents/settings/more`). Die Karte heißt **Nummernpräfix** und enthält zwei Felder am Projekt:

- **Vorfallnummern-Präfix** – bis zu 20 Zeichen, Platzhalter `INC-`. Setzen Sie es, und Vorfall `#42` erscheint als `INC-42`.
- **Nummernpräfix der Vorfall-Episode** – dieselbe Idee für die Nummern von Vorfall-Episoden, Platzhalter `IE-`.

Lassen Sie eines davon leer, bleibt das Standardpräfix `#`; das nicht gesetzte Feld zeigt `# (default)`. Speichern Sie mit **Aktualisieren**. Der präfixierte Wert wird am Vorfall als `incidentNumberWithPrefix` gespeichert – und genau den rendern die Vorfallliste und der Vorfall-Header.

## Regeln, die beim Anlegen eines Vorfalls laufen

**Vorfälle → Regeln** enthält acht Regel-Engines. Alle machen dasselbe – sie sehen sich einen Vorfall in dem Moment an, in dem er entsteht, und handeln, wenn er passt –, unterscheiden sich aber darin, was sie tun und wie mehrere zutreffende Regeln aufgelöst werden.

- **Gruppierungsregeln** – fassen verwandte Vorfälle zu Episoden zusammen. Die Regeln werden in Prioritätsreihenfolge ausgewertet; niedrigere Prioritätsnummern zuerst.
- **Bereitschaftsregeln** – führen Bereitschaftsrichtlinien für passende Vorfälle aus. Weiter unten im Detail.
- **Eigentümerregeln** – weisen automatisch Eigentümer zu.
- **Runbook-Regeln** – starten ein [Runbook](/docs/runbooks/index), wenn ein Vorfall passt.
- **Datenschutzregeln** – entscheiden, ob ein passender Vorfall privat ist.
- **Beschriftungsregeln** – vergeben automatisch Beschriftungen.
- **SLA-Regeln** – verfolgen Reaktions- und Behebungszeiten. Die Regeln werden der Reihe nach ausgewertet; niedrigere Reihenfolgenummern zuerst.
- **Reminder Rules** – erinnern die Eigentümer eines Vorfalls in regelmäßigen Abständen, solange er noch offen ist. Die Regeln werden der Reihe nach ausgewertet, und die erste passende gewinnt.

**Die Reihenfolge-Semantik ist nicht einheitlich.** Gruppierungsregeln, SLA-Regeln und Reminder Rules werden der Reihe nach ausgewertet. Bereitschaftsregeln nicht – dort feuert jede passende Regel. Gehen Sie nicht davon aus, dass ein Modell für alle acht gilt.

Die Seiten **Bereitschaftsregeln**, **Eigentümerregeln**, **Beschriftungsregeln** und **Datenschutzregeln** haben Reiter – **Incident Rules** und **Episode Rules**, jeder mit eigener Tabelle. Konfigurieren Sie den Reiter **Incident Rules**, sofern Sie nicht ausdrücklich Episoden meinen. **Gruppierungsregeln**, **Runbook-Regeln**, **SLA-Regeln** und **Reminder Rules** sind einfache Tabellen.

## Bereitschaftsregeln für Vorfälle

Unter **Vorfälle → Regeln → Bereitschaftsregeln** (`/dashboard/{projectId}/incidents/settings/on-call-rules`) machen Sie das Alarmieren automatisch. Die Karte **Vorfalls-Bereitschaftsregeln** beschreibt Regeln, die beim Anlegen passender Vorfälle automatisch Bereitschaftsrichtlinien ausführen. Die Seite hat zwei Reiter: **Incident Rules** und **Episode Rules**.

Das Erstellungsformular hat drei Schritte:

- **Grundinformationen** – **Name** (der Platzhalter schlägt so etwas vor wie „bei jedem DB-Vorfall das Datenbankteam alarmieren“), **Beschreibung** und ein Schalter **Aktiviert**. Die Liste zeigt pro Regel eine grüne Pille **Aktiviert** oder eine rote **Deaktiviert**.
- **Übereinstimmungskriterien** – **Monitore**, **Vorfall Schweregrade**, **Vorfall-Beschriftungen**, **Überwachungs-Beschriftungen** sowie Felder mit regulären Ausdrücken ohne Beachtung der Groß-/Kleinschreibung für Vorfalltitel, Vorfallbeschreibung, Monitorname und Monitorbeschreibung.
- **Bereitschaftsrichtlinien** – die Richtlinien, die diese Regel ausführt.

### Wie Übereinstimmungen aufgelöst werden

Die Regeln, die die Seite selbst mitbringt, sollten Sie verinnerlichen:

- Eine Regel greift nur, wenn **alle** von Ihnen ausgefüllten Kriterien zutreffen. Leer gelassene Kriterien werden übersprungen, nicht als Fehlschlag gewertet.
- Innerhalb eines einzelnen Listenkriteriums – **Monitore**, **Vorfall Schweregrade**, **Vorfall-Beschriftungen**, **Überwachungs-Beschriftungen** – genügt ein Treffer.
- Die Musterfelder sind reguläre Ausdrücke ohne Beachtung der Groß-/Kleinschreibung.
- **Alle passenden Regeln feuern.** Es gibt keine Priorität und keinen Abbruch nach der ersten.
- Ausgeführt wird am Ende die Vereinigung der Richtlinien aller passenden Regeln plus aller Richtlinien, die dem Vorfall von Hand oder über eine Vorlage angehängt wurden – dublettenfrei, sodass jede Richtlinie höchstens einmal läuft.

Der Schweregrad ist hier ein Übereinstimmungskriterium und sonst nirgends. An einem Vorfallsschweregrad gibt es kein Bereitschaftsfeld – „Critical Incident“ auszuwählen alarmiert für sich genommen niemanden. Soll der Schweregrad das Alarmieren steuern, schreiben Sie eine Bereitschaftsregel, die darauf passt.

## Bereitschaftsrichtlinien direkt anhängen

Regeln sind nicht der einzige Weg. Jeder Vorfall führt eine eigene Liste von Bereitschaftsrichtlinien mit, sichtbar als Feld **Bereitschaftsrichtlinie** im Schritt **Bereitschaft** des Melde-Assistenten und im Schritt **Bereitschaft** einer Vorfall-Vorlage. Die Feldbeschreibung sagt es klar: Das sind die Bereitschaftsrichtlinien, die beim Anlegen dieses Vorfalls ausgeführt werden.

Entsteht ein Vorfall, führt OneUptime zuerst die Beschriftungsregeln aus, dann die Bereitschaftsregeln (die ihre passenden Richtlinien in die Liste des Vorfalls einmischen), dann die Runbook-Regeln – und ist die entstandene Liste nicht leer, wird jede Richtlinie darin ausgeführt. Die Ausführungen laufen parallel und werden unabhängig voneinander abgeschlossen; eine fehlschlagende Richtlinie stoppt die anderen also nicht. Jede Ausführung trägt eine Markierung mit dem auslösenden Vorfall und mit dem Benachrichtigungs-Ereignistyp für das Anlegen eines Vorfalls.

Was passiert ist, sehen Sie im Vorfall selbst unter **Bereitschaftsausführungen** in seinem Seitenmenü (`/dashboard/{projectId}/incidents/{incidentId}/on-call-policy-execution-logs`).

## Vorfälle aus Workflows steuern

Workflow-Trigger für Vorfälle sind nicht von Hand geschrieben – OneUptime erzeugt sie aus den Datenmodellen. Jedes Modell der Vorfall-Familie bekommt damit die Komponenten **On Create X**, **On Update X** und **On Delete X**, benannt nach dem Singularnamen des Modells. Die drei wichtigsten sind **On Create Incident**, **On Update Incident** und **On Delete Incident**; Sie finden sie unter der Kategorie **Vorfall** im Panel **Komponente hinzufügen** unter `/dashboard/{projectId}/workflows`.

Dieselbe Erzeugung liefert Ihnen Trigger für die Konfiguration selbst: **On Create Incident State**, **On Update Incident Severity**, **On Create Incident Template**, **On Create Incident Note Template**, **On Create Incident State Timeline**, **On Create Incident Public Note**, **On Create Incident Internal Note**, **On Create Incident On-Call Rule**, **On Create Incident Role**, **On Create Incident Member** und weitere. Zu jedem Modell gehören außerdem passende Aktionskomponenten – **Find One Incident**, **Create One Incident**, **Update One Incident**, **Delete One Incident** und ihre Mehrzeilen-Entsprechungen –, sodass Trigger und Aktion mit ähnlichen Namen nebeneinander in derselben Kategorie stehen. **On Create Incident** startet einen Workflow; **Create One Incident** eröffnet einen Vorfall.

Ein paar Details, die beim Verdrahten zählen:

- **On Update X** nimmt ein optionales Argument **Listen on** entgegen, das den Trigger auf Aktualisierungen bestimmter Felder einengt. Lassen Sie es leer, feuert er bei jeder Änderung. Kommt eine Aktualisierung ohne Vermerk darüber an, welche Felder sich bewegt haben, wird der Filter übersprungen und der Workflow läuft trotzdem.
- **On Create X** und **On Update X** verlangen beide das Argument **Select Fields**; **On Delete X** nimmt keine Argumente entgegen.
- Alle drei haben genau einen Ausgangsport **Erfolg**, und jeder nimmt ein ID-Argument entgegen, damit Sie den Workflow von Hand gegen einen einzelnen Datensatz laufen lassen können.
- Die Namen stammen vom Singularnamen des Modells, nicht vom Tabellennamen – deshalb sehen Sie **On Create Incident Team Owner** und **On Create Incident User Owner** statt der tabellenförmigen Namen.
- Für Definitionen benutzerdefinierter Vorfall-Felder gibt es keine Trigger. Dieses Modell ist das einzige Mitglied der Vorfall-Familie, bei dem Workflows deaktiviert sind.

Wie Sie den Rest des Workflows bauen, steht unter [Einen Workflow erstellen](/docs/workflows/authoring) und [Workflow-Variablen](/docs/workflows/variables).

## Wo Sie als Nächstes lesen sollten

- [Vorfälle – Übersicht](/docs/incidents/index) – wie das Vorfall-Feature zusammenpasst.
- [Einen Vorfall melden](/docs/incidents/declaring-incidents) – der Melde-Assistent, Vorlagen und die API.
- [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities) – die Einstellungsseiten für Status und Schweregrad und was die Flags bewirken.
- [Vorfallnotizen, Eigentümer & Feed](/docs/incidents/notes-owners-and-feed) – wo Notiz-Vorlagen zum Einsatz kommen.
- [Abonnenten & Ankündigungen](/docs/status-pages/subscribers) – wer außerhalb Ihres Teams von einem Vorfall erfährt.
- [Workflows – Übersicht](/docs/workflows/index) – Automatisierung auf Basis der Vorfall-Trigger.
- [Runbooks – Übersicht](/docs/runbooks/index) – die Abläufe, an die Runbook-Regeln anknüpfen.
