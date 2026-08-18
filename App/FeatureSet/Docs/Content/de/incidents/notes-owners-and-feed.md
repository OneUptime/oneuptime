# Notizen, Eigentümer & Feed

Jeder Vorfall sammelt während der Bearbeitung eine schriftliche Spur an. Ein Teil davon ist für Ihre Kunden – das Update, das um 02:14 Uhr auf der Statusseite erscheint und sagt, dass Sie das fehlerhafte Deployment gefunden haben. Der Rest ist für Ihr Team – der Stacktrace, den jemand eingefügt hat, der Graph, der endlich Sinn ergab, die Entscheidung zum Failover.

OneUptime hält diese beiden Zielgruppen auseinander. **Öffentliche Notizen** werden auf Ihrer Statusseite veröffentlicht und können Abonnenten benachrichtigen. **Private Notizen** (das Modell `IncidentInternalNote`) bleiben im Dashboard. Unter beiden liegt der **Vorfall Feed**, eine Zeitachse, an die nur angehängt wird und die alles festhält, was mit dem Vorfall passiert ist, sowie die Liste **Eigentümer**, die entscheidet, wer informiert wird.

All das hängt am linken Seitenmenü des Vorfalls: **Notizen → Öffentliche Notizen**, **Notizen → Private Notizen** und **Team → Eigentümer**. Der Feed liegt auf der Seite **Übersicht** des Vorfalls.

## Öffentliche Notizen im Vergleich zu privaten Notizen

Die beiden Notizarten sehen im Dashboard ähnlich aus und verhalten sich sehr unterschiedlich.

- **Öffentliche Notizen** – das Modell `IncidentPublicNote`, das Statusseiten als Teil der Vorfalls-Zeitachse ausgeliefert wird. Sie tragen ein Datum **Gepostet am**, das Sie selbst setzen können, und ein Kontrollkästchen **Statusseiten-Abonnenten benachrichtigen**.
- **Private Notizen** – das Modell `IncidentInternalNote`. Nichts in der Statusseiten-Anwendung liest sie. Sie haben kein Posted-at-Feld (die Liste wird nach `createdAt` gestempelt und sortiert) und überhaupt keine Abonnentenfelder, sodass eine private Notiz niemals eine Abonnentenbenachrichtigung auslösen kann.

**Was „privat" tatsächlich bedeutet.** Es bedeutet „nicht auf der Statusseite veröffentlicht" – nicht „auf einen kleineren Personenkreis beschränkt". Beide Notizarten teilen sich dieselben Leseberechtigungen, wer also den Vorfall lesen kann, kann auch seine privaten Notizen lesen. Wenn Sie einschränken müssen, wer einen Vorfall überhaupt sehen darf, verwenden Sie das Flag **Privater Vorfall** (`isPrivate`) am Vorfall selbst, das den Vorfall von jeder Statusseite ausblendet und ihn auf die Eigentümer-Benutzer des Vorfalls, die Mitglieder seiner Eigentümer-Teams sowie Projektadministratoren und -eigentümer beschränkt.

**Eigentümer sehen beides.** Der Job für Eigentümerbenachrichtigungen fragt öffentliche und private Notizen gemeinsam ab. Eine private Notiz ist privat gegenüber Ihren Abonnenten, nicht gegenüber den Reagierenden.

| Wenn Sie … möchten                                                       | Wählen Sie              |
| ------------------------------------------------------------------------ | ----------------------- |
| Kunden sagen, was Sie wissen und wann Sie mehr wissen werden             | **Öffentliche Notiz**   |
| Ein Update zurückdatieren, das Sie bereits woanders verschickt haben     | **Öffentliche Notiz**   |
| Eine Hypothese, einen ausgeführten Befehl oder eine Sackgasse festhalten | **Private Notiz**       |
| Einen Heap-Dump oder einen internen Dashboard-Screenshot anhängen        | **Private Notiz**       |

## Eine öffentliche Notiz posten

Öffnen Sie **Notizen → Öffentliche Notizen** im Seitenmenü des Vorfalls und erstellen Sie eine Notiz. Die Karte erklärt, dass das, was Sie hier schreiben, auf der Statusseite erscheint; der Leerzustand meldet, dass für diesen Vorfall bislang keine öffentlichen Notizen erstellt wurden.

| Feld                                              | Zweck                                                                                                                            |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Öffentliche Vorfallsnotiz**                     | Der Text, in Markdown. Erforderlich. Das Formular erinnert Sie daran, dass die Notiz auf Ihrer Statusseite sichtbar ist, und verlinkt einen Spickzettel. |
| **Anhänge**                                       | Dateien, die mit Abonnenten auf der Statusseite geteilt werden. Optional.                                                        |
| **Statusseiten-Abonnenten benachrichtigen**       | Kontrollkästchen, standardmäßig aktiviert. Schalten Sie es ab, um still zu veröffentlichen.                                      |
| **Gepostet am**                                   | Erforderliches Datum mit Uhrzeit, standardmäßig jetzt, angezeigt in Ihrer aktuellen Zeitzone.                                    |

**Gepostet am ist der echte Zeitstempel der Notiz.** Statusseiten sortieren und zeigen öffentliche Notizen nach `postedAt`, nicht danach, wann Sie sie getippt haben – wenn Sie also die Statusseite über ein Update nachziehen, das Sie vor 40 Minuten verschickt haben, setzen Sie **Gepostet am** auf den tatsächlichen Zeitpunkt. Kommt eine Notiz ohne Angabe über die API, stempelt OneUptime die aktuelle Zeit auf.

Die Liste zeigt, wer jede Notiz geschrieben hat, ihr **Gepostet am**, das gerenderte Markdown mit seinen Anhängen und eine Spalte **Abonnenten-Benachrichtigungsstatus**. Sie können nach **Erstellt von**, **Notiz** und **Erstellt am** filtern.

## Eine private Notiz posten

**Notizen → Private Notizen** ist bewusst schlichter. Es gibt nur zwei Felder:

- **Private Vorfallsnotiz** – Markdown-Text, erforderlich. Das Formular sagt unumwunden, dass dies für Ihr Team privat und auf der Statusseite nicht sichtbar ist.
- **Anhänge** – Dateien für das Vorfallsreaktionsteam.

Kein **Gepostet am**, kein Abonnenten-Kontrollkästchen – die Notiz wird beim Erstellen gestempelt.

## Anhänge an Notizen

Beide Notizarten akzeptieren Dateianhänge über ein Feld **Anhänge**, und beide stellen unter dem Notiztext eine Anhangliste mit einem Link **Download attachment** je Datei dar.

Sie unterscheiden sich darin, wer die Datei abrufen kann:

- **Anhänge öffentlicher Notizen** können von Statusseiten-Besuchern über eine Statusseiten-Route heruntergeladen werden, gemeinsam mit der Notiz selbst.
- **Anhänge privater Notizen** sind nur über die authentifizierte Dashboard-API erreichbar. Es gibt keine Statusseiten-Route dafür.

Damit sind Anhänge dieselbe öffentlich/privat-Entscheidung wie der Notiztext. Ein kundenseitiges Zeitachsen-Bild gehört an eine öffentliche Notiz; ein Konfigurations-Dump an eine private.

## Eine Notiz mit KI erzeugen

Beide Notizseiten tragen eine Schaltfläche **Generate with AI**. Sie sendet den Vorfall an den KI-Anbieter Ihres Projekts und legt das erzeugte Markdown in den Notizeditor, wo Sie es vor dem Speichern bearbeiten – nichts wird automatisch veröffentlicht.

- **Generate Public Note with AI** – beschrieben als Analyse der Vorfallsdaten, um eine kundenseitige Notiz zu erzeugen. Zu den Vorlagen zählen **Status Update** und **Resolution Notice**.
- **Generate Private Note with AI** – erzeugt stattdessen eine interne technische Notiz. Zu den Vorlagen zählen **Investigation Update** und **Technical Analysis**.

Hinter der Schaltfläche postet das Dashboard an `/incident/generate-note-from-ai/{incidentId}` mit der gewählten Vorlage und einem Notiztyp von `public` oder `internal`.

## Notiz-Vorlagen

Wenn Ihr Team bei jedem Ausfall dieselben drei Updates schreibt, speichern Sie sie einmal. Beide Notizseiten haben eine Schaltfläche **Aus Vorlage erstellen**, die eine Auswahl **Notiz aus Vorlage erstellen** mit einem Dropdown **Notizvorlage auswählen** öffnet.

Vorlagen werden zwischen öffentlichen und privaten Notizen geteilt: Eine einzige Vorlagenliste bedient beide, und dieselbe Vorlage kann in jede der beiden Notizarten eingefügt werden.

Sie verwalten sie unter **Vorfälle → Einstellungen → Notiz-Vorlagen** – die Karte trägt den Titel **Vorlagen für öffentliche oder private Notizen für Vorfälle**, und ihr Formular hat einen Schritt **Vorlageninformationen** (**Vorlagenname** und **Vorlagenbeschreibung**, beide erforderlich) sowie einen Schritt **Notizdetails** für den Text. Klicken Sie auf **Aus Vorlage erstellen**, bevor Sie eine erstellt haben, teilt OneUptime Ihnen mit, dass noch keine existiert; beachten Sie, dass die Meldung auf Projekteinstellungen verweist, die Seite aber tatsächlich unter **Vorfälle → Einstellungen → Notiz-Vorlagen** liegt.

## Notizen aus Slack oder Microsoft Teams posten

Wenn Sie einen Arbeitsbereich verbunden haben, müssen Reagierende den Kanal nie verlassen. Sowohl Slack als auch Microsoft Teams bieten eine Aktion zum Hinzufügen einer Notiz an, die einen Dialog mit einem Dropdown für **Öffentliche Notiz** oder **Private Notiz** plus einem Textfeld öffnet und das Ergebnis direkt in den Vorfall schreibt.

Zwei Details, die man kennen sollte:

- **Duplikatschutz** – jede Notiz merkt sich die Slack-Nachricht, aus der sie stammt (`postedFromSlackMessageId`, im Format `channel_id:message_ts`), sodass mehrere Personen, die auf dieselbe Nachricht reagieren, eine Notiz erzeugen und nicht fünf.
- **Notizen kommen zurück** – das Posten einer der beiden Notizarten schiebt außerdem eine Nachricht in den verbundenen Vorfallskanal, weil der Feed-Eintrag der Notiz mit aktivierter Arbeitsbereich-Benachrichtigung erstellt wird.

## Wann eine öffentliche Notiz die Abonnenten tatsächlich erreicht

Eine öffentliche Notiz mit aktiviertem **Statusseiten-Abonnenten benachrichtigen** zu erstellen garantiert für sich genommen nicht, dass eine E-Mail hinausgeht. Die Notiz muss eine Kette von Prüfungen bestehen, und jede Ablehnung hält einen konkreten Grund fest, statt einen Fehler zu werfen:

1. **Statusseiten-Abonnenten benachrichtigen** muss aktiviert sein. Ist es das nicht, wird die Notiz im Moment der Erstellung als übersprungen gestempelt.
2. Die Notiz muss zu einem Vorfall gehören, der noch existiert.
3. Am Vorfall muss mindestens ein Monitor hängen – ohne Monitore gibt es keine Statusseiten-Ressource, an die sich die Notiz leiten ließe.
4. Das Flag **Auf Statusseite sichtbar** (`isVisibleOnStatusPage`) des Vorfalls muss wahr sein.
5. Auf jeder Statusseite, die der Vorfall erreicht, muss **Vorfälle anzeigen** (`showIncidentsOnStatusPage`) eingeschaltet sein.
6. Jeder Abonnent muss seine eigenen Einstellungen bestehen – nicht abgemeldet und für diese Ressource sowie für den Ereignistyp `Incident` angemeldet, sofern die Seite Abonnenten wählen lässt.

**Benachrichtigungen sind nicht sofort.** Der Job, der sie versendet, läuft einmal pro Minute – rechnen Sie also mit bis zu etwa einer Minute zwischen dem Speichern der Notiz und dem Absenden der Mail. Genau das bedeutet die Kennzeichnung **Sending Soon**.

Die Spalte **Abonnenten-Benachrichtigungsstatus** verfolgt den gesamten Weg:

| Status                       | Bedeutung                                                       |
| ---------------------------- | ----------------------------------------------------------------- |
| **Notifications skipped.**   | Eine der obigen Schranken war zu. Der Grund wird festgehalten.    |
| **Sending Soon**             | Eingereiht, wartet auf den nächsten Lauf des Versandjobs.         |
| **Notifications Being Sent** | Der Job arbeitet sich durch die Abonnentenliste.                  |
| **Gesendete Benachrichtigungen** | Alle Abonnentenbenachrichtigungen sind hinausgegangen.        |
| **Fehlgeschlagen**           | Der Job ist gescheitert; der Fehler wird mit der Notiz gespeichert. |

Klicken Sie beim Status auf **weitere Details**, um **Details zum Benachrichtigungsstatus** zu öffnen. Wo ein erneuter Versand sinnvoll ist, lautet die Schaltfläche dieses Dialogs **Retry** und versetzt die Notiz zurück in den ausstehenden Zustand, damit der nächste Lauf sie erneut aufnimmt.

Die Nachricht, die Abonnenten tatsächlich erhalten, wird je Statusseite und je Kanal aus Vorlagen erzeugt – E-Mail, SMS, Slack und Microsoft Teams haben jeweils ihre eigene Vorlage für das Ereignis **Subscriber Incident Note Created**, mit Variablen für Name und URL der Statusseite, den Detail-Link, die betroffenen Ressourcen, den Vorfallsschweregrad und -titel, den Notiztext und einen Abmeldelink je Abonnent. Wie diese Vorlagen und Kanäle konfiguriert werden, steht unter [Abonnenten & Ankündigungen](/docs/status-pages/subscribers).

## Der Vorfall-Feed

Die Karte **Vorfall Feed** sitzt unten in der linken Spalte auf der Seite **Übersicht** des Vorfalls. Sie erzählt die Geschichte des Vorfalls der Reihe nach: Jeder Eintrag besteht aus einem Symbol, dem Avatar und Namen desjenigen, der ihn ausgelöst hat, einem relativen Zeitstempel mit der genauen lokalen Zeit beim Überfahren und einem Markdown-Text. Die Einträge sind nach Ältestem zuerst sortiert.

Manche Einträge tragen zusätzliche Details – eine Eigentümerbenachrichtigung listet zum Beispiel alle auf, die angeschrieben wurden. Diese zeigen eine Schaltfläche **More Information**, die ein Panel **More Information** öffnet.

Der Kartenkopf hat außerdem ein Menü **Aktionen**, damit Sie handeln können, ohne die Zeitachse zu verlassen:

- **Execute Runbook** – startet ein [Runbook](/docs/runbooks/index) für diesen Vorfall.
- **Bereitschaftsdienst-Richtlinie ausführen** – alarmiert eine Richtlinie auf Zuruf.
- **Add Public Note** – dieselben vier Felder wie auf der Seite Öffentliche Notizen, in einem Dialog.
- **Private Notiz hinzufügen** – nur Notiztext und Anhänge.

Daneben holt **Aktualisieren** den Feed neu.

**Der Feed wird nur angehängt, und er ist nicht Ihr Prüfprotokoll.** Die API erlaubt das Erstellen und Lesen von Feed-Einträgen, aber kein Aktualisieren oder Löschen, sodass niemand die Geschichte eines Vorfalls stillschweigend umschreiben kann. Dauerhaft ist er dennoch nicht: Auf abgerechneten Installationen werden Feed-Zeilen, die älter als drei Jahre sind, entfernt. Für einen dauerhaften Nachweis darüber, wer was geändert hat, verwenden Sie **Audit → Audit-Protokolle** im Seitenmenü des Vorfalls.

## Was der Feed festhält

Feed-Einträge werden vom Vorfallsdienst selbst geschrieben, von beiden Notizdiensten, von der Zustands-Zeitachse, von Eigentümer- und Mitgliederänderungen, von den Regelwerken, von der Bereitschaftsausführung, von den KI-Untersuchungs- und Postmortem-Läufen sowie von den Cron-Jobs für Benachrichtigungen. Die Ereignistypen umfassen:

- **Den Vorfall selbst** – `IncidentCreated`, `IncidentUpdated`, `IncidentStateChanged`.
- **Notizen und Aufarbeitungen** – `PublicNote`, `PrivateNote`, `RootCause`, `RemediationNotes`, `PostmortemNote`.
- **Personen** – `OwnerUserAdded`, `OwnerTeamAdded`, `OwnerUserRemoved`, `OwnerTeamRemoved`, `IncidentMemberAdded`, `IncidentMemberRemoved`.
- **Benachrichtigungen** – `OwnerNotificationSent`, `SubscriberNotificationSent`, `OnCallPolicy`, `OnCallNotification`.
- **Automatisierung** – `LabelRuleExecuted`, `OwnerRuleExecuted`, `PrivacyRuleExecuted`, `OnCallRuleExecuted`, `AutoRemediation`.

Jeder Typ erhält sein eigenes Symbol, sodass Sie einen langen Feed überfliegen und die Statuswechsel aus dem Geplauder herauspicken können. KI-erzeugte Grundursachenanalyse wird deutlich gekennzeichnet und in einem eingeschränkten Markdown-Modus dargestellt.

Feeds respektieren die Vertraulichkeit von Vorfällen: Bei privaten Vorfällen werden Feed-Lesezugriffe genauso gefiltert wie der Vorfall selbst.

## Eigentümer

Eigentümer sind die Personen und Teams, die für einen Vorfall verantwortlich sind. Sie sind das Benachrichtigungsziel für alles, was mit ihm passiert – und sie sind der Grund, warum ein Vorfall nicht unbemerkt bleibt, während alle annehmen, jemand anderes kümmere sich schon.

Öffnen Sie **Team → Eigentümer** im Seitenmenü des Vorfalls. Die Karte **Eigentümer** zeigt ein Zähler-Badge und beschreibt Eigentümer als die Personen und Teams, die für diesen Vorfall verantwortlich sind und über Änderungen benachrichtigt werden, mit einer laufenden Zählung wie „2 Personen · 1 Team". Eigentümer werden als überlappende Avatare dargestellt; beim Überfahren eines Avatars erscheint die E-Mail-Adresse der Person oder der Eintrag wird als **Team** gekennzeichnet.

- Klicken Sie auf **Eigentümer hinzufügen**, um eine Auswahl mit einem Suchfeld für Personen oder Teams zu öffnen.
- Klicken Sie auf das Entfernen-Symbol an einem Avatar, um die Bestätigung **Eigentümer entfernen** zu öffnen, dann auf **Entfernen**.
- Gibt es noch keine Eigentümer, sagt die Karte das und lädt Sie ein, einen Teamkollegen oder ein Team hinzuzufügen, damit diese über Änderungen benachrichtigt werden.

Eigentümer-Benutzer und Eigentümer-Teams sind getrennte Datensätze – ein Team hinzuzufügen macht jedes Mitglied dieses Teams zu einem Eigentümer im Sinne der Benachrichtigung, ohne sie einzeln aufzuführen.

## Wie Eigentümer zugewiesen werden

Es gibt vier Wege auf die Eigentümerliste:

- **Aus einer Vorfallsvorlage** – Vorlagen tragen die Felder **Eigentümer – Teams** und **Eigentümer – Benutzer**, beschrieben als die Teams und Benutzer, denen der Vorfall gehört und die bei seiner Erstellung oder Aktualisierung benachrichtigt werden. Einen Vorfall aus der Vorlage zu erstellen belegt sie vor. Siehe [Einen Vorfall melden](/docs/incidents/declaring-incidents).
- **Aus Vorfall-Eigentümerregeln** – passende Regeln fügen zum Erstellungszeitpunkt automatisch Eigentümer hinzu.
- **Beim Erstellen über die API** – Eigentümer-Benutzer und -Teams, die mit dem Erstellungsaufruf übergeben werden, werden sofort hinzugefügt, mit einem Flag, das steuert, ob sie die „Sie wurden hinzugefügt"-E-Mail erhalten.
- **Von Hand** – das Bedienelement **Eigentümer hinzufügen** auf der Seite **Eigentümer**, zu jedem Zeitpunkt während des Vorfalls.

Dieselbe Person zweimal hinzuzufügen ist unbedenklich; bereits zugewiesene Eigentümer werden nicht dupliziert.

## Vorfall-Eigentümerregeln

**Vorfall-Eigentümerregeln** weisen Eigentümer-Benutzer und -Teams automatisch zu, wenn passende Vorfälle erstellt werden – die Routing-Schicht, die dafür sorgt, dass ein Datenbank-Vorfall beim Datenbankteam landet, ohne dass jemand darüber nachdenken muss. Sie finden sie zusammen mit der übrigen Vorfallsautomatisierung unter [Vorfalleinstellungen & Automatisierung](/docs/incidents/settings).

Das Regelformular hat drei Schritte – **Grundinformationen**, **Übereinstimmungskriterien** und **Eigentümer** –, und der Eigentümerschritt enthält zwei Bereiche:

- **Zuzuweisende Eigentümer** – wählen Sie **Eigentümer-Teams** und **Eigentümer-Benutzer**. Passt die Regel, werden alle ausgewählten Benutzer und Teams als Eigentümer hinzugefügt, und bereits zugewiesene Eigentümer werden nicht dupliziert.
- **Eigentümer erben** – weisen Sie Eigentümer aus verwandten Entitäten zu, statt sie zu benennen. **Eigentümer von Monitoren erben** macht jeden Eigentümer der Monitore des Vorfalls zu einem Eigentümer des Vorfalls, und **Eigentümer von Hosts erben**, **… von Kubernetes-Clustern**, **… von Docker-Hosts**, **… von Podman-Hosts** und **… von Diensten** tun dasselbe für diese Ressourcen.

Ein Schalter **Eigentümer benachrichtigen** steuert, ob die Betroffenen davon erfahren. Lassen Sie ihn für echtes Routing an; schalten Sie ihn aus, um Eigentümer stillschweigend hinzuzufügen – nützlich, wenn eine Regel eher der Buchführung dient als dem Alarmieren.

Jede Regelausführung wird in den Vorfall-Feed geschrieben, sodass Sie immer erkennen können, ob eine Person von einer Regel oder von einem Menschen hinzugefügt wurde.

## Worüber Eigentümer benachrichtigt werden

Fünf Jobs benachrichtigen Eigentümer, jeder läuft einmal pro Minute:

- **Vorfall erstellt** – Betreff `[New Incident {number}] - {title}`.
- **Eine Notiz wurde gepostet** – für öffentliche *und* private Notizen, Betreff `[Update Incident {number}] - {title}`.
- **Der Vorfallsstatus hat sich geändert** – siehe [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities).
- **Sie wurden als Eigentümer hinzugefügt** – Betreff `You have been added as the owner of Incident {number} - {title}`.
- **Weiterhin ungelöst** – eine Erinnerung, gesteuert durch die nächste Erinnerungszeit des Vorfalls, Betreff `[Reminder] Incident {number} is still {state} - {title}`.

Jede Benachrichtigung wird für E-Mail, SMS, Sprachanruf, Push und WhatsApp aufgebaut und an die Benachrichtigungseinstellungen des Benutzers übergeben, die entscheiden, was tatsächlich gesendet wird. Jeder Empfänger kann jede davon einzeln abschalten – die Einstellungen je Benutzer sind so formuliert, dass sie Ihnen die Benachrichtigungen zu Vorfallserstellung, geposteter Notiz, Statuswechsel, Eigentümer hinzugefügt, Mitglied zugewiesen und Erinnerung an offene Vorfälle senden. Wer nur bei Statuswechseln einen Anruf möchte, kann genau das haben.

**Vorfälle ohne Eigentümer bleiben nicht stumm.** Hat ein Vorfall überhaupt keine Eigentümer, greifen die Benachrichtigungsjobs auf die Eigentümer des Projekts zurück, sodass nichts unter den Tisch fällt. Jede benachrichtigte Person wird außerdem an den passenden Feed-Eintrag angehängt, sodass Sie im Nachhinein genau sehen können, wer unter welcher Adresse informiert wurde.

## Weiterführende Themen

- [Vorfälle – Übersicht](/docs/incidents/index) – was ein Vorfall ist und wie die Teile zusammenpassen.
- [Einen Vorfall melden](/docs/incidents/declaring-incidents) – Vorfälle von Hand, aus Vorlagen und aus Monitoren erstellen.
- [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities) – die Zustandsmaschine, die den halben Feed antreibt.
- [Vorfalleinstellungen & Automatisierung](/docs/incidents/settings) – Eigentümerregeln, Notiz-Vorlagen und der Rest der Automatisierung.
- [Abonnenten & Ankündigungen](/docs/status-pages/subscribers) – wo öffentliche Notizen landen und wer sie erhält.
- [Statusseiten – Übersicht](/docs/status-pages/index) – die kundenseitige Seite eines Vorfalls.
