# Status & Schweregrade

Jeder Vorfall trägt zwei Klassifizierungen: einen **Status**, der sagt, wo er in Ihrer Reaktion steht, und einen **Schweregrad**, der sagt, wie sehr es wehtut. Im Dashboard sehen sie sich ähnlich – beide erscheinen als farbige Plaketten in der Vorfallsliste, beide sind projektbezogene Listen, die Sie umbenennen und umfärben können. Sie erfüllen sehr unterschiedliche Aufgaben.

Status steuern Verhalten. Drei boolesche Flags auf den Statusdatensätzen entscheiden, welche Vorfälle als aktiv gelten, welche Schaltflächen in der Vorfall-Kopfzeile erscheinen, wann die SLA-Uhr stoppt und wann der Vorfall von Ihrer Statusseite verschwindet. Schweregrade steuern von sich aus gar nichts – sie sind Bezeichnungen, die Auswirkungen beschreiben und auf die andere Regeln passen können.

Beide Listen werden beim Anlegen Ihres Projekts erstellt, und beide werden unter **Vorfälle → Einstellungen** bearbeitet. Dieser Abschnitt des Seitenmenüs Vorfälle ist standardmäßig eingeklappt – klappen Sie also **Einstellungen** auf, bevor Sie danach suchen.

## Status tragen Verhalten, Schweregrade tragen Bedeutung

Das Modell `IncidentState` hat `name`, `description`, `color` und `order` sowie drei Booleans: `isCreatedState`, `isAcknowledgedState` und `isResolvedState`. Alles, was das Produkt mit Status macht, richtet sich nach diesen Booleans und nach `order` – niemals nach dem Namen des Status. Deshalb können Sie **Behoben** in „Geschlossen" umbenennen, ohne dass etwas kaputtgeht: Das Flag reist mit dem Datensatz.

Das Modell `IncidentSeverity` hat `name`, `description`, `color` und `order` und sonst nichts. Es gibt keine Flags. Nichts in OneUptime behandelt **Critical Incident** von sich aus anders als **Minor Incident** – der Schweregrad zählt nur dort, wo Sie etwas darauf ausrichten, etwa beim Übereinstimmungskriterium **Vorfall Schweregrade** einer Bereitschaftsregel.

Ein paar kurze Regeln:

- **Wählen Sie den Schweregrad, um Auswirkungen zu kommunizieren** – er erscheint in der Vorfallsliste, auf der **Übersicht** des Vorfalls, und er ist ein Pflichtfeld, wenn Sie einen Vorfall melden.
- **Wählen Sie Status, um Ihren Prozess abzubilden** – die Reaktionsschritte, die Sie tatsächlich durchlaufen, in der Reihenfolge, in der Sie sie durchlaufen.
- **Kodieren Sie Dringlichkeit nicht in Status** – ein Status namens „Kritisch" würde niemanden alarmieren. Das machen Schweregrad plus Bereitschaftsregel.

## Die vorkonfigurierten Status

Drei Status werden mit dem Projekt erstellt, in dieser Reihenfolge. Das Anlegen ist idempotent – ein Status wird nur hinzugefügt, wenn noch keiner mit diesem Namen existiert.

| Status           | `order` | Flag                  | Farbe     | Bedeutung                                                     |
| ---------------- | ------- | --------------------- | --------- | -------------------------------------------------------------- |
| **Identified**   | `1`     | `isCreatedState`      | `#fd625e` | Der Status, in dem neue Vorfälle landen.                       |
| **Bestätigt**    | `2`     | `isAcknowledgedState` | `#ffbf53` | Jemand hat den Vorfall übernommen.                             |
| **Behoben**      | `3`     | `isResolvedState`     | `#2ab57d` | Der Vorfall ist vorbei und zählt nicht mehr als aktiv.         |

Achten Sie auf den Namen: Der erste Status heißt **Identified**, auch wenn ihn mehrere Beschreibungen im Produkt weiterhin „Erstellungsstatus" nennen. Wenn ein Dokument oder ein Tooltip von „Erstellungsstatus" spricht, ist derjenige Status gemeint, der `isCreatedState` trägt – in einem frischen Projekt ist das **Identified**.

## Was jedes Status-Flag tatsächlich tut

| Flag                  | Zweck                                                                                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isCreatedState`      | Der Status, den ein Vorfall bekommt, wenn niemand einen ausgewählt hat. Trägt kein Status im Projekt dieses Flag, schlägt das Erstellen eines Vorfalls mit einem Fehler fehl, der Sie anweist, in den Einstellungen einen Erstellungsstatus hinzuzufügen. |
| `isAcknowledgedState` | Treibt die Schaltfläche **Acknowledge** und die Kennzahlkachel „<Statusname> in" auf der **Übersicht** des Vorfalls an. Bei einem Wechsel in diesen Status wird die SLA des Vorfalls als beantwortet markiert. |
| `isResolvedState`     | Treibt die Schaltfläche **Beheben** und die Kennzahlkachel für Behebung an, definiert die Liste **Aktive Vorfälle** und ist das, was den Vorfall aus dem aktiven Bereich einer Statusseite entfernt. Markiert die SLA als behoben. |

Pro Projekt wird erwartet, dass jedes Flag von genau einem Status getragen wird – die Abfragen holen einen einzelnen Datensatz. Die drei mit Flags versehenen Status können umbenannt, umgefärbt und umsortiert werden, aber die Einstellungsseite verweigert das Löschen und zeigt einen Fehler, der den Erstellungs-, Bestätigungs- und Behebungsstatus benennt.

Weil die Oberfläche Statusnamen dynamisch ausliest, ändert das Umbenennen eines Status überall das, was Sie sehen – die Kennzahlkacheln, die Titel der Bestätigungsdialoge und die Plakette in der Vorfallsliste folgen alle dem Namen, den Sie dem Datensatz gegeben haben.

## Eigene Status hinzufügen

Gehen Sie zu **Vorfälle → Einstellungen → Vorfallsstatus**. Die Seite ist eine geordnete Liste, aufsteigend nach `order` sortiert, und neue Status werden am Ende angehängt. Ziehen Sie einen Datensatz, um seine Position zu ändern.

**Felder eines Status:**

- **Name** – erforderlich, mindestens zwei Zeichen. Der Platzhalter schlägt so etwas wie „Investigating" vor.
- **Beschreibung** – optionaler Freitext, der erklärt, wann ein Vorfall in diesem Status steht.
- **Farbe** – erforderlich. Aus der Farbauswahl gewählt; als Hexadezimalwert wie `#fd625e` gespeichert.

Die drei Flags können Sie in diesem Formular nicht setzen – sie gehören zu den vorkonfigurierten Datensätzen. Ein von Ihnen hinzugefügter Status ist daher ein Status ohne Flag, was zwei Konsequenzen hat, die man einplanen sollte:

- **Er zählt als aktiv.** **Aktive Vorfälle** ist definiert als „der aktuelle Status ist nicht der behobene Status" – alles, was Sie außer dem behobenen Status hinzufügen, hält den Vorfall also in der aktiven Liste und im Zähler der Seitenleiste.
- **Seine Übergangs-Schaltfläche ist generisch.** Statt **Acknowledge** oder **Beheben** trägt der Bestätigungsdialog den Titel **Vorfall markieren als `<state name>`** mit einer Absende-Schaltfläche **Mark as `<state name>`**.

Eine gängige Form ist, einen Triage- oder Eindämmungsschritt zwischen den bestätigten und den behobenen Status einzuschieben – ziehen Sie zum Beispiel einen neuen Status „Mitigated" so, dass er nach **Bestätigt** und vor **Behoben** liegt.

## Die Reihenfolge ist eine echte Einschränkung, keine Anzeigepräferenz

Die Spalte `order` wird beim Schreiben eines Statuswechsels erzwungen, nicht nur beim Zeichnen der Liste:

- **Rückwärtsübergänge werden abgelehnt.** Ein Vorfall in einen Status zu verschieben, der in der Reihenfolge vor seinem aktuellen Status liegt, schlägt mit einem Fehler fehl, der beide Status benennt.
- **Die erneute Auswahl des aktuellen Status wird abgelehnt.** Einen Vorfall auf den Status zu setzen, in dem er bereits ist, schlägt fehl mit „Incident state cannot be same as previous state."
- **Ein rückdatierter Datensatz darf seinen Nachbarn nicht duplizieren.** Das Einfügen eines Zeitachsen-Datensatzes, dessen Status mit dem darauffolgenden Datensatz übereinstimmt, wird ebenfalls verweigert.
- **Die Schaltflächen in der Kopfzeile folgen der Position der mit Flags versehenen Status in der Reihenfolge.** **Acknowledge** und **Beheben** werden danach angeboten, wo der aktuelle Status in der nach Reihenfolge sortierten Liste steht. Ein eigener Status, der *nach* dem behobenen Status platziert ist, zeigt niemals eine Schaltfläche **Beheben**, weil es nichts mehr gibt, wohin man vorwärts wechseln könnte.

Wenn Sie also einen Status hinzufügen, setzen Sie ihn dorthin, wo ein Vorfall ihn tatsächlich durchlaufen würde. Ihn falsch einzuordnen sieht nicht nur seltsam aus – es macht Übergänge unmöglich.

## Die vorkonfigurierten Schweregrade

Drei Schweregrade werden mit dem Projekt erstellt, in dieser Reihenfolge:

- **Critical Incident** (`order` 1, `#b70400`) – Probleme mit sehr hoher Auswirkung auf Kunden, die eine sofortige Reaktion erfordern. Ein vollständiger Ausfall oder eine Datenpanne.
- **Major Incident** (`order` 2, `#fd625e`) – erhebliche Auswirkung, meist mit sofortiger Reaktion, manchmal mit einem Workaround, der den Schaden begrenzt. Ein wichtiges Teilsystem fällt aus.
- **Minor Incident** (`order` 3, `#ffbf53`) – geringe Auswirkung, meist innerhalb der Arbeitszeit bearbeitet, und die meisten Kunden bemerken es wahrscheinlich nicht. Ein leichter Rückgang der Anwendungsleistung.

Der Schweregrad ist beim Melden eines Vorfalls erforderlich, und er ist bei jeder Vorfallsspezifikation in den Kriterien eines Monitors erforderlich – jeder Vorfall, ob manuell oder automatisch, kommt also mit einem an. Siehe [Einen Vorfall melden](/docs/incidents/declaring-incidents) für den Meldeablauf und [Vorfall- & Warnmeldungsvorlagen](/docs/monitor/incident-alert-templating) für den monitorgetriebenen Weg.

## Schweregrade bearbeiten

Gehen Sie zu **Vorfälle → Einstellungen → Vorfallsschweregrad**. Gleiche Form wie die Statusseite – eine nach `order` sortierte geordnete Liste, Umsortieren per Ziehen, neue Schweregrade werden am Ende angehängt, mit **Name**, **Beschreibung** und **Farbe** im Formular.

Zwei Unterschiede zu Status:

- **Es gibt keinen Löschschutz.** Jeder Schweregrad kann gelöscht werden, auch die drei vorkonfigurierten.
- **Es gibt keine Flags zu erben.** Ein neuer Schweregrad verhält sich genau wie die vorkonfigurierten – er ist eine Bezeichnung mit einer Farbe und einer Position.

**Ein Hinweis zu den Platzhaltern.** Das Schweregrad-Formular übernimmt den Beispieltext des Statusformulars wortwörtlich, sodass die Hinweise von Vorfallsstatus statt von Schweregraden sprechen. Ignorieren Sie sie und schreiben Sie Ihre eigenen Schweregradnamen und -beschreibungen.

Wo der Schweregrad mehr tut als beschreiben: Unter **Vorfälle → Regeln → Bereitschaftsregeln** ist das Feld **Vorfall Schweregrade** einer Regel ein Übereinstimmungskriterium. Dort **Critical Incident** aufzuführen ist die Art, wie „das Datenbankteam für alles Kritische alarmieren" ausgedrückt wird – die Bereitschaftsrichtlinie lebt an der Regel, nicht am Schweregrad.

## Einen Vorfall durch seine Status bewegen

Es gibt vier Wege, auf denen ein Vorfall seinen Status ändert:

- **Die Schaltflächen in der Kopfzeile.** Öffnen Sie einen Vorfall. Liegt sein aktueller Status vor dem bestätigten Status, erhalten Sie **Acknowledge** und **Beheben**; liegt er zwischen beiden, erhalten Sie **Beheben**. Jede öffnet einen Bestätigungsdialog – **Acknowledge Incident** oder **Resolve Incident** –, der außerdem **Notizvorlage auswählen**, **Öffentliche Notiz** und **Statusseiten-Abonnenten benachrichtigen** anbietet.
- **Die Zustands-Zeitachse.** Fügen Sie von Hand einen Datensatz über die Seite **Zustands-Zeitachse** des Vorfalls hinzu, mit **Vorfallstatus**, **Beginnt am** und **Statusseiten-Abonnenten benachrichtigen**.
- **Massenänderung.** Die Vorfallsliste hat eine Massenaktion **Status ändern**, um mehrere Vorfälle auf einmal zu verschieben.
- **Automatisch.** Ein Monitor-Kriterium mit aktiviertem **Vorfall automatisch beheben** behebt seinen Vorfall, sobald das Kriterium nicht mehr erfüllt ist, und die API kann den Status über `/api/incident-state-timeline` aktualisieren.

Jeder dieser Wege schreibt einen Zeitachsen-Datensatz. Ein Statuswechsel tut außerdem ein paar Dinge, um die Sie nicht bitten müssen: Er trägt einen Eintrag in den Vorfall-Feed ein, weist einen Incident Commander zu, falls der Vorfall noch keinen hat, und aktualisiert die SLA-Uhr. Das Wiedereröffnen eines behobenen Vorfalls startet einen frischen SLA-Datensatz ab dem Zeitpunkt der Wiedereröffnung.

## Die Zustands-Zeitachse

Die Seite **Zustands-Zeitachse** im Seitenmenü des Vorfalls ist der Prüfpfad über jeden Status, in dem der Vorfall war. Die Karte auf dieser Seite trägt den Titel **Status-Zeitachse** und ist nach Neuestem zuerst sortiert.

**Spalten:**

- **Vorfallstatus** – eine farbige Plakette mit Name und Farbe des Status.
- **Beginnt am** – wann der Vorfall diesen Status betreten hat.
- **Endet am** – wann er ihn verlassen hat. Der aktuelle Status zeigt `Currently Active`.
- **Dauer** – im Status verbrachte Zeit, für den aktuellen bis jetzt gezählt.
- **Abonnenten-Benachrichtigungsstatus** – ob die Statusseiten-Benachrichtigung für diese Änderung gesendet, übersprungen oder noch ausstehend ist, mit einem Link **weitere Details** und – wenn der Versand fehlgeschlagen ist – einer Aktion **Retry**.

**Zeilenaktionen:**

- **Ursache anzeigen** – öffnet einen Dialog **Grundursache**, der das mit diesem Statuswechsel erfasste Markdown darstellt.
- **Protokolle anzeigen** – öffnet einen Dialog, der erklärt, warum sich der Status geändert hat, mit einem Betrachter **Vorfallstatus-Protokoll**.

Zeitachsen-Datensätze können erstellt und gelöscht, aber nicht bearbeitet werden. Den falschen Datensatz zu löschen schreibt die Geschichte des Vorfalls um – behandeln Sie das also als Korrekturwerkzeug und nicht als Aufräumgewohnheit.

## Die Liste der aktiven Vorfälle

**Vorfälle → Aktive Vorfälle** ist die Liste, die Sie während einer Schicht im Blick haben. Ihre Definition ist genau eine Bedingung: Der aktuelle Status des Vorfalls ist ein Status, bei dem `isResolvedState` falsch ist. Sonst wird nichts berücksichtigt – nicht der Schweregrad, nicht das Alter, nicht, ob ihn jemand bestätigt hat.

Der Eintrag im Seitenmenü trägt ein rotes Zähler-Badge, das dieselbe Abfrage verwendet, sodass Badge und Liste immer übereinstimmen. Gibt es nichts zu sehen, sagt die Seite das auch.

Die praktische Konsequenz: Jeder eigene Status, den Sie hinzufügen, hält Vorfälle in dieser Liste. Das ist üblicherweise gewollt – „Mitigated" ist nicht „fertig" –, bedeutet aber, dass sich das Badge erst leert, wenn Vorfälle tatsächlich den behobenen Status erreichen.

## Statusseiten-Abonnenten über einen Statuswechsel informieren

Ein Statuswechsel kann Ihren Statusseiten-Abonnenten eine E-Mail schicken, aber er passiert dabei mehrere Schranken. Diese zu verstehen erspart viel „Warum wurde niemand benachrichtigt"-Debugging.

Die Benachrichtigung wird je Zeitachsen-Datensatz über **Statusseiten-Abonnenten benachrichtigen** (`shouldStatusPageSubscribersBeNotified`) angefordert, das Kontrollkästchen im Statuswechsel-Dialog und im manuellen Zeitachsen-Formular. Ist es aus, wird der Datensatz mit einem Status „übersprungen" und einer Erklärung gespeichert. Ist es an, wird der Datensatz eingereiht und ein Hintergrundjob nimmt ihn auf – der Job läuft jede Minute, die Zustellung ist also schnell, aber nicht augenblicklich.

**Der eingereihte Datensatz wird anschließend übersprungen, wenn eines davon zutrifft:**

- **Der neue Status ist der Erstellungsstatus.** Den Abonnenten wurde bereits bei der Meldung des Vorfalls Bescheid gegeben, deshalb sendet der erste Zeitachsen-Datensatz bewusst keine zweite Nachricht.
- **Am Vorfall hängen keine Monitore.** Ohne Ressourcen gibt es keine Statusseite, auf die sich der Vorfall abbilden ließe.
- **Der Vorfall ist auf der Statusseite nicht sichtbar** (`isVisibleOnStatusPage` ist aus).
- **Auf der Statusseite sind Vorfälle abgeschaltet** (`showIncidentsOnStatusPage` ist aus). Das gilt je Statusseite – andere Seiten, die denselben Monitor zeigen, werden weiterhin benachrichtigt.

**Noch etwas, das das Ergebnis ändert.** Tippen Sie eine **Öffentliche Notiz** in den Statuswechsel-Dialog, wird der Zeitachsen-Datensatz als bereits benachrichtigt markiert statt eingereiht. Die Notiz selbst ist das, was die Abonnenten erreicht, sie bekommen also eine Nachricht statt zweier. Der Ereignistyp hinter der reinen Statuswechsel-Nachricht lautet `Subscriber Incident State Changed`.

Wer diese erhält und wie die Vorlagen ausgewählt werden, steht unter [Abonnenten & Ankündigungen](/docs/status-pages/subscribers).

## Einen Vorfall von der Statusseite fernhalten

Drei getrennte Dinge entscheiden, ob ein Vorfall überhaupt auf der öffentlichen Seite steht, und alle drei müssen zutreffen:

- **Vorfälle anzeigen** (`showIncidentsOnStatusPage`) auf der Statusseite selbst.
- **Auf Statusseite sichtbar** (`isVisibleOnStatusPage`) am Vorfall – ein Schalter auf der Seite **Einstellungen** des Vorfalls. Er ist standardmäßig aktiviert und steht nicht im Melde-Assistenten; ein Monitor-Kriterium kann ihn mit **Vorfall auf der Statusseite anzeigen** setzen.
- **Der aktuelle Status ist nicht der behobene Status.** Das ist es, was einen Vorfall aus dem aktiven Bereich entfernt: Die Statusseiten-Abfrage holt Vorfälle, deren aktueller Status irgendein nicht behobener Status ist. Sie archivieren oder schließen nichts – Sie beheben es, und es wandert in die Historie.

**Private Vorfälle erscheinen nie.** **Privater Vorfall** einzuschalten blendet den Vorfall unabhängig von den obigen Schaltern von jeder Statusseite aus und beschränkt ihn auf seine Eigentümer plus Projektadministratoren und -eigentümer.

Wie viel behobene Historie die Seite behält, ist eine Einstellung der Statusseite, keine des Vorfalls. Siehe [Statusseiten – Ressourcen & Gruppen](/docs/status-pages/resources-and-groups) dazu, wie die Monitore auf der Seite entscheiden, welche Vorfälle überhaupt auftauchen.

## Weiterführende Themen

- [Vorfälle – Übersicht](/docs/incidents/index) – wie der Funktionsbereich Vorfälle zusammenpasst.
- [Einen Vorfall melden](/docs/incidents/declaring-incidents) – der Melde-Assistent, Vorlagen und die API.
- [Vorfallnotizen, Eigentümer & Feed](/docs/incidents/notes-owners-and-feed) – öffentliche Notizen, private Notizen und der Aktivitäts-Feed.
- [Vorfalleinstellungen & Automatisierung](/docs/incidents/settings) – Vorlagen, benutzerdefinierte Felder, Regeln und Workflow-Auslöser.
- [Abonnenten & Ankündigungen](/docs/status-pages/subscribers) – wer die E-Mails erhält, die ein Statuswechsel versendet.
- [Statusseiten – Übersicht](/docs/status-pages/index) – was eine Statusseite zeigt und wem.
- [Workflows – Übersicht](/docs/workflows/index) – mit Automatisierung auf Statuswechsel reagieren.
