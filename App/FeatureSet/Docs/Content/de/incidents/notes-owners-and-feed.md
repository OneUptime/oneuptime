# Notizen, Eigentümer & Feed

Jeder Vorfall sammelt beim Bearbeiten eine schriftliche Aufzeichnung an. Ein Teil davon ist für Ihre Kunden – das Update, das um 02:14 Uhr auf der Statusseite erscheint und sagt, dass Sie das fehlerhafte Deployment gefunden haben. Der Rest ist für Ihr Team – der Stacktrace, den jemand eingefügt hat, das Diagramm, das endlich Sinn ergab, die Entscheidung, umzuschalten.

OneUptime hält diese beiden Zielgruppen auseinander. **Öffentliche Notizen** erscheinen auf Ihrer Statusseite und können Abonnenten benachrichtigen. **Private Notizen** (das Modell `IncidentInternalNote`) bleiben im Dashboard. Unter beiden liegt der **Vorfall Feed**, eine nur ergänzbare Zeitachse, die alles festhält, was mit dem Vorfall passiert ist – und die Liste **Eigentümer**, die entscheidet, wer Bescheid bekommt.

All das hängt am linken Seitenmenü des Vorfalls: **Notizen → Öffentliche Notizen**, **Notizen → Private Notizen** und **Team → Eigentümer**. Der Feed lebt auf der Seite **Übersicht** des Vorfalls.

## Öffentliche gegen private Notizen

Die beiden Notiztypen sehen sich im Dashboard ähnlich und verhalten sich sehr unterschiedlich.

- **Öffentliche Notizen** – das Modell `IncidentPublicNote`, das Statusseiten als Teil der Vorfall-Zeitachse ausgeliefert wird. Sie tragen ein Datum **Gepostet am**, das Sie selbst setzen können, und ein Kontrollkästchen **Statusseiten-Abonnenten benachrichtigen**.
- **Private Notizen** – das Modell `IncidentInternalNote`. Nichts in der Statusseiten-App liest sie. Sie haben kein Feld für den Zeitpunkt der Veröffentlichung (die Liste wird nach `createdAt` gestempelt und sortiert) und überhaupt keine Abonnentenfelder – eine private Notiz kann also niemals eine Abonnentenbenachrichtigung auslösen.

**Was „privat" tatsächlich bedeutet.** Es bedeutet „nicht auf der Statusseite veröffentlicht" – nicht „auf einen kleineren Personenkreis beschränkt". Beide Notiztypen teilen sich dieselben Leseberechtigungen, wer also den Vorfall lesen kann, kann auch seine privaten Notizen lesen. Wenn Sie einschränken müssen, wer einen Vorfall überhaupt sieht, nutzen Sie das Flag **Privater Vorfall** (`isPrivate`) am Vorfall selbst: Es blendet den Vorfall auf jeder Statusseite aus und beschränkt ihn auf die Eigentümer-Benutzer des Vorfalls, die Mitglieder seiner Eigentümer-Teams sowie Projektadministratoren und -eigentümer.

**Eigentümer sehen beides.** Der Benachrichtigungsjob für Eigentümer fragt öffentliche und private Notizen gemeinsam ab. Eine private Notiz ist privat gegenüber Ihren Abonnenten, nicht gegenüber den Leuten, die reagieren.

| Wenn Sie …                                                            | Wählen Sie           |
| ---------------------------------------------------------------------- | ---------------------- |
| Kunden sagen wollen, was Sie wissen und wann Sie mehr wissen           | **Öffentliche Notiz** |
| ein Update zurückdatieren wollen, das Sie anderswo schon gesendet haben | **Öffentliche Notiz** |
| eine Hypothese, einen ausgeführten Befehl oder eine Sackgasse festhalten wollen | **Private Notiz**     |
| einen Heap-Dump oder einen Screenshot eines internen Dashboards anhängen wollen | **Private Notiz**     |

## Eine öffentliche Notiz posten

Öffnen Sie **Notizen → Öffentliche Notizen** im Seitenmenü des Vorfalls und legen Sie eine Notiz an. Die Karte erklärt, dass das hier Geschriebene auf der Statusseite erscheint; der Leerzustand sagt, dass für diesen Vorfall bislang keine öffentlichen Notizen angelegt wurden.

| Feld                                        | Zweck                                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Öffentliche Vorfallsnotiz**               | Der Text, in Markdown. Pflichtfeld. Das Formular erinnert daran, dass die Notiz auf Ihrer Statusseite sichtbar ist, und verlinkt einen Spickzettel. |
| **Anhänge**                                 | Dateien, die auf der Statusseite mit Abonnenten geteilt werden. Optional.                                                 |
| **Statusseiten-Abonnenten benachrichtigen** | Kontrollkästchen, standardmäßig an. Schalten Sie es ab, um still zu veröffentlichen.                                     |
| **Gepostet am**                             | Pflichtfeld für Datum und Uhrzeit, standardmäßig jetzt, angezeigt in Ihrer aktuellen Zeitzone.                            |

**Gepostet am ist der echte Zeitstempel der Notiz.** Statusseiten sortieren und zeigen öffentliche Notizen nach `postedAt`, nicht danach, wann Sie sie getippt haben – wenn Sie also die Statusseite mit einem Update nachziehen, das Sie vor 40 Minuten verschickt haben, setzen Sie **Gepostet am** auf den tatsächlichen Zeitpunkt. Kommt eine Notiz ohne diesen Wert über die API, stempelt OneUptime die aktuelle Zeit darauf.

Die Liste zeigt, wer jede Notiz geschrieben hat, ihr **Gepostet am**, das gerenderte Markdown mit seinen Anhängen und eine Spalte **Abonnenten-Benachrichtigungsstatus**. Filtern können Sie nach **Erstellt von**, **Notiz** und **Erstellt am**.

## Eine private Notiz posten

**Notizen → Private Notizen** ist bewusst schlichter. Es gibt nur zwei Felder:

- **Private Vorfallsnotiz** – Markdown-Text, Pflichtfeld. Das Formular sagt unumwunden, dass dies privat für Ihr Team ist und nicht auf der Statusseite erscheint.
- **Anhänge** – Dateien für das Team, das auf den Vorfall reagiert.

Kein **Gepostet am**, kein Abonnenten-Kontrollkästchen – die Notiz wird beim Anlegen gestempelt.

## Anhänge an Notizen

Beide Notiztypen nehmen über ein Feld **Anhänge** Dateianhänge auf, und beide zeigen unter dem Notiztext eine Anhangsliste mit einem Link **Download attachment** je Datei.

Wo sie auseinandergehen, ist die Frage, wer die Datei abrufen kann:

- **Anhänge öffentlicher Notizen** sind für Besucher der Statusseite über eine Statusseiten-Route herunterladbar, zusammen mit der Notiz selbst.
- **Anhänge privater Notizen** sind nur über die authentifizierte Dashboard-API erreichbar. Es gibt keine Statusseiten-Route dafür.

Damit sind Anhänge dieselbe Entscheidung zwischen öffentlich und privat wie der Notiztext. Ein Bild für die Kunden-Zeitachse gehört an eine öffentliche Notiz, ein Config-Dump an eine private.

## Eine Notiz mit KI erzeugen

Beide Notizseiten tragen eine Schaltfläche **Generate with AI**. Sie schickt den Vorfall an den KI-Anbieter Ihres Projekts und legt das erzeugte Markdown in den Notiz-Editor, wo Sie es vor dem Speichern bearbeiten – automatisch veröffentlicht wird nichts.

- **Generate Public Note with AI** – beschrieben als Analyse der Vorfalldaten, um eine an Kunden gerichtete Notiz zu erzeugen. Zu den Vorlagen zählen **Status Update** und **Resolution Notice**.
- **Generate Private Note with AI** – erzeugt stattdessen eine interne technische Notiz. Zu den Vorlagen zählen **Investigation Update** und **Technical Analysis**.

Hinter der Schaltfläche postet das Dashboard an `/incident/generate-note-from-ai/{incidentId}` mit der gewählten Vorlage und einem Notiztyp `public` oder `internal`.

## Notiz-Vorlagen

Wenn Ihr Team bei jedem Ausfall dieselben drei Updates schreibt, speichern Sie sie einmal. Beide Notizseiten haben eine Schaltfläche **Aus Vorlage erstellen**, die einen Auswähler **Notiz aus Vorlage erstellen** mit einem Dropdown **Notizvorlage auswählen** öffnet.

Vorlagen sind zwischen öffentlichen und privaten Notizen geteilt: Eine einzige Vorlagenliste bedient beide, und dieselbe Vorlage lässt sich in beide Notizarten einfügen.

Verwaltet werden sie unter **Vorfälle → Einstellungen → Notiz-Vorlagen** – die Karte heißt **Vorlagen für öffentliche oder private Notizen für Vorfälle**, und ihr Formular hat einen Schritt **Vorlageninformationen** (**Vorlagenname** und **Vorlagenbeschreibung**, beide Pflicht) sowie einen Schritt **Notizdetails** für den Text. Klicken Sie auf **Aus Vorlage erstellen**, bevor Sie eine angelegt haben, teilt OneUptime Ihnen mit, dass noch keine existiert; beachten Sie, dass die Meldung auf die Projekteinstellungen zeigt, die Seite aber tatsächlich unter **Vorfälle → Einstellungen → Notiz-Vorlagen** liegt.

## Notizen aus Slack oder Microsoft Teams posten

Haben Sie einen Arbeitsbereich verbunden, müssen Responder den Kanal nie verlassen. Sowohl Slack als auch Microsoft Teams bieten eine Aktion zum Hinzufügen einer Notiz, die einen Dialog mit einem Dropdown für **Öffentliche Notiz** oder **Private Notiz** plus einem Textfeld öffnet und das Ergebnis direkt an den Vorfall schreibt.

Zwei Details, die man kennen sollte:

- **Dublettenschutz** – jede Notiz merkt sich die Slack-Nachricht, aus der sie kam (`postedFromSlackMessageId`, formatiert als `channel_id:message_ts`), sodass mehrere Leute, die auf dieselbe Nachricht reagieren, eine Notiz erzeugen und nicht fünf.
- **Notizen kommen zurück** – beide Notizarten zu posten schiebt außerdem eine Nachricht in den verbundenen Vorfallkanal, weil das Feed-Element der Notiz mit aktivierter Arbeitsbereich-Benachrichtigung angelegt wird.

## Wann eine öffentliche Notiz Abonnenten tatsächlich erreicht

Eine öffentliche Notiz mit aktivem **Statusseiten-Abonnenten benachrichtigen** anzulegen garantiert für sich genommen noch keine E-Mail. Die Notiz muss eine Kette von Prüfungen passieren, und jedes Scheitern wird mit einem konkreten Grund festgehalten statt als Fehler geworfen:

1. **Statusseiten-Abonnenten benachrichtigen** muss an sein. Ist es das nicht, wird die Notiz im Moment des Anlegens als übersprungen gestempelt.
2. Die Notiz muss zu einem Vorfall gehören, den es noch gibt.
3. Am Vorfall muss mindestens ein Monitor hängen – ohne Monitore gibt es keine Statusseiten-Ressource, an die sich die Notiz leiten ließe.
4. Das Flag **Auf Statusseite sichtbar** (`isVisibleOnStatusPage`) des Vorfalls muss wahr sein.
5. Auf jeder Statusseite, die der Vorfall erreicht, muss **Vorfälle anzeigen** (`showIncidentsOnStatusPage`) eingeschaltet sein.
6. Jeder Abonnent muss seine eigenen Einstellungen passieren – nicht abgemeldet, und auf diese Ressource sowie den Ereignistyp `Incident` abonniert, wo die Seite Abonnenten die Wahl lässt.

**Benachrichtigungen sind nicht augenblicklich.** Der Job, der sie versendet, läuft einmal pro Minute – rechnen Sie also mit bis zu etwa einer Minute zwischen dem Speichern der Notiz und dem Abgang der Mail. Genau das bedeutet die Kennzeichnung **Sending Soon**.

Die Spalte **Abonnenten-Benachrichtigungsstatus** verfolgt den ganzen Weg:

| Status                            | Bedeutung                                                     |
| --------------------------------- | --------------------------------------------------------------- |
| **Notifications skipped.**        | Eines der Tore oben war zu. Der Grund wird festgehalten.       |
| **Sending Soon**                  | Eingereiht, wartet auf den nächsten Lauf des Versandjobs.      |
| **Notifications Being Sent**      | Der Job arbeitet die Abonnentenliste ab.                       |
| **Gesendete Benachrichtigungen**  | Jede Abonnentenbenachrichtigung ist rausgegangen.              |
| **Fehlgeschlagen**                | Der Job ist gescheitert; der Fehler wird bei der Notiz gespeichert. |

Klicken Sie am Status auf **weitere Details**, um **Details zum Benachrichtigungsstatus** zu öffnen. Wo ein erneuter Versand sinnvoll ist, heißt die Schaltfläche dieses Dialogs **Retry** und setzt die Notiz zurück in den Wartezustand, damit der nächste Lauf sie wieder aufgreift.

Die Nachricht, die Abonnenten tatsächlich erhalten, wird pro Statusseite und pro Kanal aus Vorlagen erzeugt – E-Mail, SMS, Slack und Microsoft Teams haben je eine eigene Vorlage für das Ereignis **Subscriber Incident Note Created**, mit Variablen für Name und URL der Statusseite, den Detail-Link, die betroffenen Ressourcen, Schweregrad und Titel des Vorfalls, den Notiztext und einen Abmeldelink je Abonnent. Wie diese Vorlagen und Kanäle konfiguriert werden, steht unter [Abonnenten & Ankündigungen](/docs/status-pages/subscribers).

## Der Vorfall-Feed

Die Karte **Vorfall Feed** sitzt unten in der linken Spalte auf der Seite **Übersicht** des Vorfalls. Sie ist die Geschichte des Vorfalls der Reihe nach: Jedes Element besteht aus einem Symbol, dem Avatar und Namen dessen, der es ausgelöst hat, einem relativen Zeitstempel mit der genauen Ortszeit beim Überfahren und einem Markdown-Text. Sortiert wird älteste zuerst.

Manche Elemente tragen zusätzliche Details – eine Eigentümerbenachrichtigung listet zum Beispiel alle Angeschriebenen auf. Diese zeigen eine Schaltfläche **More Information**, die ein Panel **More Information** öffnet.

Der Kartenkopf hat außerdem ein Menü **Aktionen**, damit Sie handeln können, ohne die Zeitachse zu verlassen:

- **Execute Runbook** – startet ein [Runbook](/docs/runbooks/index) für diesen Vorfall.
- **Bereitschaftsdienst-Richtlinie ausführen** – alarmiert eine Richtlinie auf Zuruf.
- **Add Public Note** – dieselben vier Felder wie auf der Seite Öffentliche Notizen, in einem Dialog.
- **Private Notiz hinzufügen** – nur Notiztext und Anhänge.

Daneben holt **Aktualisieren** den Feed neu.

**Der Feed wird nur ergänzt, und er ist nicht Ihr Audit-Log.** Die API erlaubt es, Feed-Elemente anzulegen und zu lesen, aber nicht zu ändern oder zu löschen – niemand kann also klammheimlich die Geschichte eines Vorfalls umschreiben. Dauerhaft ist er trotzdem nicht: Auf abgerechneten Installationen werden Feed-Zeilen entfernt, die älter als drei Jahre sind. Für einen belastbaren Nachweis, wer was geändert hat, nutzen Sie **Audit → Audit-Protokolle** im Seitenmenü des Vorfalls.

## Was der Feed festhält

Feed-Elemente werden vom Vorfalldienst selbst geschrieben, von beiden Notizdiensten, von der Zustands-Zeitachse, von Eigentümer- und Mitgliederänderungen, von den Regel-Engines, von der Bereitschaftsausführung, von den KI-Untersuchungs- und Postmortem-Läufen und von den Benachrichtigungs-Cronjobs. Die Ereignistypen umfassen:

- **Den Vorfall selbst** – `IncidentCreated`, `IncidentUpdated`, `IncidentStateChanged`.
- **Notizen und Aufarbeitungen** – `PublicNote`, `PrivateNote`, `RootCause`, `RemediationNotes`, `PostmortemNote`.
- **Personen** – `OwnerUserAdded`, `OwnerTeamAdded`, `OwnerUserRemoved`, `OwnerTeamRemoved`, `IncidentMemberAdded`, `IncidentMemberRemoved`.
- **Benachrichtigungen** – `OwnerNotificationSent`, `SubscriberNotificationSent`, `OnCallPolicy`, `OnCallNotification`.
- **Automatisierung** – `LabelRuleExecuted`, `OwnerRuleExecuted`, `PrivacyRuleExecuted`, `OnCallRuleExecuted`, `AutoRemediation`.

Jeder Typ bekommt sein eigenes Symbol, sodass Sie einen langen Feed überfliegen und die Statuswechsel aus dem Geplauder herausfischen können. KI-erzeugte Grundursachenanalyse wird eigens gekennzeichnet und in einem eingeschränkten Markdown-Modus dargestellt.

Feeds respektieren den Datenschutz des Vorfalls: Bei privaten Vorfällen werden Feed-Zugriffe genauso gefiltert wie der Vorfall selbst.

## Eigentümer

Eigentümer sind die Personen und Teams, die für einen Vorfall verantwortlich sind. Sie sind das Benachrichtigungsziel für alles, was mit ihm passiert – und sie sind der Grund, warum ein Vorfall nicht unbemerkt bleibt, während alle davon ausgehen, dass sich schon jemand anderes kümmert.

Öffnen Sie **Team → Eigentümer** im Seitenmenü des Vorfalls. Die Karte **Eigentümer** zeigt ein Zähler-Badge und beschreibt Eigentümer als die für diesen Vorfall verantwortlichen Personen und Teams, die über Änderungen benachrichtigt werden, mit einer laufenden Zählung wie „2 Personen · 1 Team". Eigentümer erscheinen als überlappende Avatare; wer einen überfährt, sieht die E-Mail-Adresse der Person oder die Kennzeichnung als **Team**.

- Klicken Sie auf **Eigentümer hinzufügen**, um einen Auswähler mit Suchfeld für Personen oder Teams zu öffnen.
- Klicken Sie auf das Entfernen-Element an einem Avatar, um die Bestätigung **Eigentümer entfernen** zu öffnen, dann auf **Entfernen**.
- Gibt es noch keine Eigentümer, sagt die Karte das und lädt Sie ein, eine Kollegin oder ein Team hinzuzufügen, damit sie über Änderungen benachrichtigt werden.

Eigentümer-Benutzer und Eigentümer-Teams sind getrennte Datensätze – ein Team hinzuzufügen macht jedes Mitglied dieses Teams für Benachrichtigungszwecke zum Eigentümer, ohne sie einzeln aufzuführen.

## Wie Eigentümer zugewiesen werden

Es gibt vier Wege auf die Eigentümerliste:

- **Aus einer Vorfall-Vorlage** – Vorlagen tragen die Felder **Eigentümer – Teams** und **Eigentümer – Benutzer**, beschrieben als die Teams und Benutzer, denen der Vorfall gehört und die benachrichtigt werden, wenn er erstellt oder aktualisiert wird. Einen Vorfall aus der Vorlage zu erstellen belegt sie vor. Siehe [Einen Vorfall melden](/docs/incidents/declaring-incidents).
- **Aus Vorfall-Eigentümerregeln** – passende Regeln ergänzen Eigentümer beim Anlegen automatisch.
- **Beim Anlegen über die API** – mit dem Erstellungsaufruf übergebene Eigentümer-Benutzer und -Teams werden sofort ergänzt, mit einem Flag, das steuert, ob sie die „Sie wurden hinzugefügt"-E-Mail erhalten.
- **Von Hand** – über **Eigentümer hinzufügen** auf der Seite **Eigentümer**, zu jedem Zeitpunkt während des Vorfalls.

Dieselbe Person zweimal hinzuzufügen ist unbedenklich; bereits zugewiesene Eigentümer werden nicht gedoppelt.

## Vorfall-Eigentümerregeln

**Vorfall-Eigentümerregeln** weisen Eigentümer-Benutzer und -Teams automatisch zu, wenn passende Vorfälle entstehen – die Routing-Schicht, die dafür sorgt, dass ein Datenbankvorfall beim Datenbank-Team landet, ohne dass jemand darüber nachdenken muss. Sie finden sie zusammen mit der übrigen Vorfall-Automatisierung in [Vorfalleinstellungen & Automatisierung](/docs/incidents/settings).

Das Regelformular hat drei Schritte – **Grundinformationen**, **Übereinstimmungskriterien** und **Eigentümer** –, und der Eigentümer-Schritt enthält zwei Abschnitte:

- **Zuzuweisende Eigentümer** – wählen Sie **Eigentümer-Teams** und **Eigentümer-Benutzer**. Greift die Regel, wird jeder ausgewählte Benutzer und jedes Team als Eigentümer ergänzt, und bereits zugewiesene Eigentümer werden nicht gedoppelt.
- **Eigentümer erben** – Eigentümer aus verwandten Objekten übernehmen, statt sie zu benennen. **Eigentümer von Monitoren erben** macht jeden Eigentümer der Monitore des Vorfalls zum Eigentümer des Vorfalls, und **Eigentümer von Hosts erben**, **… von Kubernetes-Clustern**, **… von Docker-Hosts**, **… von Podman-Hosts** und **… von Diensten** tun dasselbe für diese Ressourcen.

Ein Schalter **Eigentümer benachrichtigen** steuert, ob die Leute davon erfahren. Lassen Sie ihn für echtes Routing an; schalten Sie ihn ab, um Eigentümer still zu ergänzen – nützlich, wenn eine Regel eher der Ordnung dient als dem Alarmieren.

Jede Regelausführung wird in den Vorfall-Feed geschrieben, Sie können also immer erkennen, ob eine Person von einer Regel oder von einem Menschen hinzugefügt wurde.

## Worüber Eigentümer benachrichtigt werden

Fünf Jobs benachrichtigen Eigentümer, jeder läuft einmal pro Minute:

- **Vorfall erstellt** – Betreff `[New Incident {number}] - {title}`.
- **Eine Notiz wurde gepostet** – für öffentliche *und* private Notizen, Betreff `[Update Incident {number}] - {title}`.
- **Der Vorfallstatus hat sich geändert** – siehe [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities).
- **Sie wurden als Eigentümer hinzugefügt** – Betreff `You have been added as the owner of Incident {number} - {title}`.
- **Immer noch offen** – eine Erinnerung, gesteuert über den nächsten Erinnerungszeitpunkt des Vorfalls, Betreff `[Reminder] Incident {number} is still {state} - {title}`.

Jede Benachrichtigung wird für E-Mail, SMS, Sprachanruf, Push und WhatsApp aufgebaut und an die Benachrichtigungseinstellungen des Benutzers übergeben, die entscheiden, was tatsächlich rausgeht. Jeder Empfänger kann jede davon einzeln abschalten – die Einstellungen pro Benutzer sind formuliert als das Senden der Benachrichtigungen zu erstelltem Vorfall, geposteter Notiz, Statuswechsel, hinzugefügtem Eigentümer, zugewiesenem Mitglied und der Erinnerung an noch offene Vorfälle. Wer nur bei Statuswechseln einen Anruf möchte, bekommt genau das.

**Vorfälle ohne Eigentümer bleiben nicht stumm.** Hat ein Vorfall überhaupt keine Eigentümer, greifen die Benachrichtigungsjobs auf die Eigentümer des Projekts zurück, sodass nichts unter den Tisch fällt. Jede benachrichtigte Person wird außerdem an das passende Feed-Element angehängt, sodass Sie hinterher genau sehen, wer unter welcher Adresse informiert wurde.

## Wo Sie als Nächstes lesen sollten

- [Vorfälle – Übersicht](/docs/incidents/index) – was ein Vorfall ist und wie die Teile zusammenpassen.
- [Einen Vorfall melden](/docs/incidents/declaring-incidents) – Vorfälle von Hand, aus Vorlagen und aus Monitoren erstellen.
- [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities) – der Zustandsautomat, der den halben Feed antreibt.
- [Vorfalleinstellungen & Automatisierung](/docs/incidents/settings) – Eigentümerregeln, Notiz-Vorlagen und der Rest der Automatisierung.
- [Abonnenten & Ankündigungen](/docs/status-pages/subscribers) – wo öffentliche Notizen landen und wer sie erhält.
- [Statusseiten – Übersicht](/docs/status-pages/index) – die kundenseitige Seite eines Vorfalls.
