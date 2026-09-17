# Status & Schweregrade

Jeder Vorfall trägt zwei Einordnungen: einen **Status**, der sagt, wo er in Ihrer Reaktion steht, und einen **Schweregrad**, der sagt, wie sehr es wehtut. Im Dashboard sehen sie sich ähnlich – beide erscheinen als farbige Pillen in der Vorfallliste, beide sind projektbezogene Listen, die Sie umbenennen und umfärben können. Ihre Aufgaben sind grundverschieden.

Status steuern Verhalten. Drei boolesche Flags auf den Statusdatensätzen entscheiden, welche Vorfälle als aktiv gelten, welche Schaltflächen im Vorfall-Header erscheinen, wann die SLA-Uhr stehen bleibt und wann der Vorfall von Ihrer Statusseite verschwindet. Schweregrade steuern von sich aus gar nichts – sie sind Beschriftungen, die die Auswirkung beschreiben und auf die andere Regeln passen können.

Beide Listen werden beim Anlegen Ihres Projekts erzeugt, und beide bearbeiten Sie unter **Vorfälle → Einstellungen**. Dieser Abschnitt im Seitenmenü Vorfälle ist standardmäßig eingeklappt – klappen Sie also **Einstellungen** auf, bevor Sie danach suchen.

## Status tragen Verhalten, Schweregrade tragen Bedeutung

Das Modell `IncidentState` hat `name`, `description`, `color` und `order`, dazu drei Booleans: `isCreatedState`, `isAcknowledgedState` und `isResolvedState`. Alles, was das Produkt mit Status tut, hängt an diesen Booleans und an `order` – nie am Namen des Status. Deshalb können Sie **Behoben** in „Geschlossen" umbenennen, ohne dass etwas kaputtgeht: Das Flag reist mit dem Datensatz.

Das Modell `IncidentSeverity` hat `name`, `description`, `color` und `order` – und sonst nichts. Flags gibt es keine. Nichts in OneUptime behandelt **Critical Incident** von sich aus anders als **Minor Incident** – der Schweregrad zählt nur dort, wo Sie etwas darauf richten, etwa das Übereinstimmungskriterium **Vorfall Schweregrade** an einer Bereitschaftsregel.

Ein paar kurze Regeln:

- **Wählen Sie den Schweregrad, um Auswirkung zu kommunizieren** – er erscheint in der Vorfallliste, auf der **Übersicht** des Vorfalls, und er ist ein Pflichtfeld, wenn Sie einen Vorfall melden.
- **Wählen Sie Status, um Ihren Prozess abzubilden** – die Reaktionsschritte, die Sie tatsächlich durchlaufen, in der Reihenfolge, in der Sie sie durchlaufen.
- **Verpacken Sie Dringlichkeit nicht in Status** – ein Status namens „Kritisch" würde niemanden alarmieren. Das erledigen Schweregrad plus Bereitschaftsregel.

## Die vorangelegten Status

Drei Status entstehen mit dem Projekt, in dieser Reihenfolge. Das Anlegen ist idempotent – ein Status wird nur ergänzt, wenn noch keiner mit diesem Namen existiert.

| Status           | `order` | Flag                  | Farbe     | Bedeutung                                              |
| ---------------- | ------- | --------------------- | --------- | -------------------------------------------------------- |
| **Identified**   | `1`     | `isCreatedState`      | `#fd625e` | Der Status, in dem neue Vorfälle landen.               |
| **Bestätigt**    | `2`     | `isAcknowledgedState` | `#ffbf53` | Jemand hat den Vorfall übernommen.                     |
| **Behoben**      | `3`     | `isResolvedState`     | `#2ab57d` | Der Vorfall ist vorbei und zählt nicht mehr als aktiv. |

Achten Sie auf den Namen: Der erste Status heißt **Identified**, auch wenn ihn mehrere Beschreibungen im Produkt weiterhin den „Erstellungsstatus" nennen. Wenn ein Dokument oder ein Tooltip von „created state" spricht, ist derjenige Status gemeint, der `isCreatedState` trägt – in einem frischen Projekt also **Identified**.

## Was jedes Status-Flag tatsächlich bewirkt

| Flag                  | Zweck                                                                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isCreatedState`      | Der Status, den ein Vorfall erhält, wenn niemand einen gewählt hat. Trägt kein Status im Projekt dieses Flag, schlägt das Anlegen eines Vorfalls mit einem Fehler fehl, der Sie auffordert, in den Einstellungen einen Erstellungsstatus anzulegen. |
| `isAcknowledgedState` | Treibt die Schaltfläche **Acknowledge** und die Kennzahlkachel „<Statusname> in" auf der **Übersicht** des Vorfalls an. Bei einem Wechsel in diesen Status wird die SLA des Vorfalls als beantwortet markiert. |
| `isResolvedState`     | Treibt die Schaltfläche **Beheben** und die Behoben-Kachel an, definiert die Liste **Aktive Vorfälle** und nimmt den Vorfall aus dem aktiven Bereich einer Statusseite. Markiert die SLA als behoben.   |

Pro Projekt sollte jedes Flag nur ein einziger Status tragen – die Abfragen holen jeweils genau eine Zeile. Die drei Status mit Flag lassen sich umbenennen, umfärben und umsortieren, aber die Einstellungsseite verweigert das Löschen und zeigt einen Fehler, der den erstellten, den bestätigten und den behobenen Status benennt.

Weil die Oberfläche Statusnamen dynamisch ausliest, ändert das Umbenennen eines Status überall, was Sie sehen – die Kennzahlkacheln, die Titel der Bestätigungsdialoge und die Pille in der Vorfallliste folgen alle dem Namen, den Sie dem Datensatz gegeben haben.

## Eigene Status ergänzen

Gehen Sie zu **Vorfälle → Einstellungen → Vorfallsstatus**. Die Seite ist eine nach `order` aufsteigend sortierte Liste, und neue Status hängen sich ans Ende. Ziehen Sie eine Zeile, um ihre Position zu ändern.

**Felder eines Status:**

- **Name** – Pflichtfeld, mindestens zwei Zeichen. Der Platzhalter schlägt so etwas wie „Untersuchung läuft" vor.
- **Beschreibung** – optionaler Freitext, der erklärt, wann ein Vorfall in diesem Status steht.
- **Farbe** – Pflichtfeld. Über die Farbauswahl gewählt; gespeichert als Hex-Wert wie `#fd625e`.

Die drei Flags können Sie in diesem Formular nicht setzen – sie gehören zu den vorangelegten Datensätzen. Ein von Ihnen ergänzter Status ist damit ein Status ohne Flag, und das hat zwei Folgen, die Sie einplanen sollten:

- **Er zählt als aktiv.** **Aktive Vorfälle** ist definiert als „der aktuelle Status ist nicht der behobene Status" – alles, was Sie außer dem behobenen Status ergänzen, hält den Vorfall also in der aktiven Liste und im Zähler der Seitenleiste.
- **Seine Übergangs-Schaltfläche ist generisch.** Statt **Acknowledge** oder **Beheben** trägt der Bestätigungsdialog den Titel **Vorfall markieren als `<state name>`** mit einer Absende-Schaltfläche **Mark as `<state name>`**.

Ein häufiger Zuschnitt ist ein Triage- oder Eindämmungsschritt zwischen dem bestätigten und dem behobenen Status – ziehen Sie zum Beispiel einen neuen Status „Eingedämmt" so, dass er nach **Bestätigt** und vor **Behoben** steht.

## Die Reihenfolge ist eine echte Einschränkung, keine Anzeigepräferenz

Die Spalte `order` wird beim Schreiben eines Statuswechsels erzwungen, nicht bloß beim Zeichnen der Liste:

- **Rückwärtsübergänge werden abgelehnt.** Einen Vorfall in einen Status zu bewegen, der in der Reihenfolge vor seinem aktuellen liegt, schlägt mit einem Fehler fehl, der beide Status benennt.
- **Den aktuellen Status erneut zu wählen wird abgelehnt.** Einen Vorfall auf den Status zu setzen, in dem er schon ist, scheitert mit „Incident state cannot be same as previous state."
- **Eine rückdatierte Zeile darf ihre Nachbarin nicht doppeln.** Eine Zeitachsenzeile einzufügen, deren Status mit der darauffolgenden Zeile übereinstimmt, wird ebenfalls abgewiesen.
- **Die Header-Schaltflächen folgen der Position der geflaggten Status in der Reihenfolge.** **Acknowledge** und **Beheben** werden danach angeboten, wo der aktuelle Status in der nach Reihenfolge sortierten Liste steht. Ein eigener Status *nach* dem behobenen Status zeigt nie eine Schaltfläche **Beheben**, weil nichts mehr übrig ist, wohin er vorrücken könnte.

Wenn Sie also einen Status ergänzen, setzen Sie ihn dorthin, wo ein Vorfall ihn wirklich durchlaufen würde. Ihn falsch einzuordnen sieht nicht nur schief aus – es macht Übergänge unmöglich.

## Die vorangelegten Schweregrade

Drei Schweregrade entstehen mit dem Projekt, in dieser Reihenfolge:

- **Critical Incident** (`order` 1, `#b70400`) – Probleme mit sehr hoher Auswirkung auf Kunden, die eine sofortige Reaktion verlangen. Ein Komplettausfall oder ein Datenleck.
- **Major Incident** (`order` 2, `#fd625e`) – erhebliche Auswirkung, meist mit sofortiger Reaktion, manchmal mit einem Workaround, der den Schaden begrenzt. Ein wichtiges Teilsystem fällt aus.
- **Minor Incident** (`order` 3, `#ffbf53`) – geringe Auswirkung, meist innerhalb der Arbeitszeit erledigt, und die meisten Kunden merken vermutlich nichts. Ein leichter Einbruch der Anwendungsleistung.

Der Schweregrad ist Pflicht, wenn Sie einen Vorfall melden, und er ist Pflicht in jeder Vorfall-Spezifikation in den Kriterien eines Monitors – jeder Vorfall, ob von Hand oder automatisch, kommt also mit einem an. Zum Meldevorgang siehe [Einen Vorfall melden](/docs/incidents/declaring-incidents), zum monitorgetriebenen Weg [Vorfall- & Warnmeldungsvorlagen](/docs/monitor/incident-alert-templating).

## Schweregrade bearbeiten

Gehen Sie zu **Vorfälle → Einstellungen → Vorfallsschweregrad**. Gleicher Zuschnitt wie die Status-Seite – eine nach `order` sortierte Liste, Umsortieren per Ziehen, neue Schweregrade hängen sich ans Ende, und das Formular hat **Name**, **Beschreibung** und **Farbe**.

Zwei Unterschiede zu den Status:

- **Es gibt keinen Löschschutz.** Jeder Schweregrad lässt sich löschen, auch die drei vorangelegten.
- **Es gibt keine Flags zu erben.** Ein neuer Schweregrad verhält sich genau wie die vorangelegten – eine Beschriftung mit einer Farbe und einer Position.

**Ein Hinweis zu den Platzhaltern.** Das Schweregrad-Formular übernimmt den Beispieltext des Status-Formulars wortwörtlich, die Hinweise sprechen also von Vorfallsstatus statt von Schweregraden. Ignorieren Sie sie und schreiben Sie Ihre eigenen Schweregradnamen und -beschreibungen.

Wo ein Schweregrad mehr tut, als nur zu beschreiben: Unter **Vorfälle → Regeln → Bereitschaftsregeln** ist das Feld **Vorfall Schweregrade** einer Regel ein Übereinstimmungskriterium. Dort **Critical Incident** aufzuführen ist die Art, wie „bei allem Kritischen das Datenbank-Team alarmieren" ausgedrückt wird – die Bereitschaftsrichtlinie hängt an der Regel, nicht am Schweregrad.

## Einen Vorfall durch seine Status bewegen

Es gibt vier Wege, wie ein Vorfall den Status wechselt:

- **Die Header-Schaltflächen.** Öffnen Sie einen Vorfall. Liegt sein aktueller Status vor dem bestätigten Status, erhalten Sie **Acknowledge** und **Beheben**; liegt er zwischen beiden, erhalten Sie **Beheben**. Jede öffnet einen Bestätigungsdialog – **Acknowledge Incident** oder **Resolve Incident** –, der außerdem **Notizvorlage auswählen**, **Öffentliche Notiz** und **Statusseiten-Abonnenten benachrichtigen** anbietet.
- **Die Zustands-Zeitachse.** Fügen Sie auf der Seite **Zustands-Zeitachse** des Vorfalls von Hand eine Zeile mit **Vorfallstatus**, **Beginnt am** und **Statusseiten-Abonnenten benachrichtigen** hinzu.
- **Massenänderung.** Die Vorfallliste hat die Massenaktion **Status ändern**, um mehrere Vorfälle auf einmal zu bewegen.
- **Automatisch.** Ein Monitor-Kriterium mit aktiviertem **Vorfall automatisch beheben** behebt seinen Vorfall, sobald das Kriterium nicht mehr erfüllt ist, und die API kann den Status über `/api/incident-state-timeline` aktualisieren.

Jeder dieser Wege schreibt eine Zeitachsenzeile. Ein Statuswechsel erledigt außerdem ein paar Dinge, um die Sie nicht bitten müssen: Er schreibt einen Eintrag in den Vorfall-Feed, bestimmt einen Incident Commander, falls der Vorfall noch keinen hat, und aktualisiert die SLA-Uhr. Einen behobenen Vorfall wieder zu öffnen startet einen frischen SLA-Datensatz ab dem Zeitpunkt der Wiedereröffnung.

## Die Zustands-Zeitachse

Die Seite **Zustands-Zeitachse** im Seitenmenü des Vorfalls ist der Prüfpfad über jeden Status, in dem der Vorfall war. Die Karte auf dieser Seite heißt **Status-Zeitachse** und ist neueste zuerst sortiert.

**Spalten:**

- **Vorfallstatus** – eine farbige Pille mit Name und Farbe des Status.
- **Beginnt am** – wann der Vorfall in diesen Status kam.
- **Endet am** – wann er ihn verlassen hat. Der aktuelle Status zeigt `Currently Active`.
- **Dauer** – im Status verbrachte Zeit, beim aktuellen bis jetzt gezählt.
- **Abonnenten-Benachrichtigungsstatus** – ob die Statusseiten-Benachrichtigung für diese Änderung gesendet, übersprungen oder noch ausstehend ist, mit einem Link **weitere Details** und – bei fehlgeschlagenem Versand – einer Aktion **Retry**.

**Zeilenaktionen:**

- **Ursache anzeigen** – öffnet einen Dialog **Grundursache**, der das mit diesem Statuswechsel erfasste Markdown darstellt.
- **Protokolle anzeigen** – öffnet einen Dialog, der erklärt, warum sich der Status geändert hat, mit einem Betrachter **Vorfallstatus-Protokoll**.

Zeitachsenzeilen lassen sich anlegen und löschen, aber nicht bearbeiten. Die falsche Zeile zu löschen schreibt die Geschichte des Vorfalls um – behandeln Sie es als Korrekturwerkzeug, nicht als Aufräumgewohnheit.

## Die Liste Aktive Vorfälle

**Vorfälle → Aktive Vorfälle** ist die Liste, die Sie während einer Schicht im Blick haben. Ihre Definition besteht aus genau einer Bedingung: Der aktuelle Status des Vorfalls ist ein Status, bei dem `isResolvedState` falsch ist. Sonst zählt nichts – nicht der Schweregrad, nicht das Alter, nicht, ob jemand ihn bestätigt hat.

Der Eintrag im Seitenmenü trägt ein rotes Zähler-Badge auf Basis derselben Abfrage, Badge und Liste stimmen also immer überein. Gibt es nichts zu sehen, sagt die Seite das.

Die praktische Folge: Jeder eigene Status, den Sie ergänzen, hält Vorfälle in dieser Liste. Meist ist das genau richtig – „Eingedämmt" ist nicht „erledigt" –, es bedeutet aber auch, dass sich das Badge erst leert, wenn Vorfälle tatsächlich den behobenen Status erreichen.

## Statusseiten-Abonnenten über einen Statuswechsel informieren

Ein Statuswechsel kann Ihren Statusseiten-Abonnenten eine E-Mail schicken, aber er muss dafür mehrere Tore passieren. Sie zu kennen erspart viel Suche nach dem „Warum hat niemand eine Benachrichtigung bekommen".

Die Benachrichtigung wird pro Zeitachsenzeile über **Statusseiten-Abonnenten benachrichtigen** (`shouldStatusPageSubscribersBeNotified`) angefordert – das Kontrollkästchen im Statuswechsel-Dialog und im manuellen Zeitachsenformular. Ist es aus, wird die Zeile mit übersprungenem Status und einer Erklärung gespeichert. Ist es an, wird die Zeile eingereiht und ein Hintergrundjob nimmt sie auf – der Job läuft jede Minute, die Zustellung ist also schnell, aber nicht augenblicklich.

**Die eingereihte Zeile wird anschließend übersprungen, sobald eines davon zutrifft:**

- **Der neue Status ist der Erstellungsstatus.** Abonnenten wurden bereits beim Melden des Vorfalls informiert, deshalb sendet die erste Zeitachsenzeile absichtlich keine zweite Nachricht.
- **Am Vorfall hängen keine Monitore.** Ohne Ressourcen gibt es keine Statusseite, auf die sich der Vorfall abbilden ließe.
- **Der Vorfall ist auf der Statusseite nicht sichtbar** (`isVisibleOnStatusPage` ist aus).
- **Auf der Statusseite sind Vorfälle abgeschaltet** (`showIncidentsOnStatusPage` ist aus). Das gilt pro Statusseite – andere Seiten, die denselben Monitor zeigen, werden trotzdem benachrichtigt.

**Noch etwas, das das Ergebnis verändert.** Tippen Sie eine **Öffentliche Notiz** in den Statuswechsel-Dialog, wird die Zeitachsenzeile als bereits benachrichtigt markiert statt eingereiht. Die Notiz selbst ist es, die die Abonnenten erreicht, sie bekommen also eine Nachricht statt zwei. Der Ereignistyp hinter der schlichten Statuswechsel-Nachricht heißt `Subscriber Incident State Changed`.

Wer diese erhält und wie die Vorlagen gewählt werden, steht unter [Abonnenten & Ankündigungen](/docs/status-pages/subscribers).

## Einen Vorfall von der Statusseite fernhalten

Drei voneinander unabhängige Dinge entscheiden, ob ein Vorfall überhaupt auf der öffentlichen Seite steht, und alle drei müssen zutreffen:

- **Vorfälle anzeigen** (`showIncidentsOnStatusPage`) auf der Statusseite selbst.
- **Auf Statusseite sichtbar** (`isVisibleOnStatusPage`) am Vorfall – ein Schalter auf der Seite **Einstellungen** des Vorfalls. Er ist standardmäßig an und steht nicht im Melde-Assistenten; ein Monitor-Kriterium kann ihn über **Vorfall auf der Statusseite anzeigen** setzen.
- **Der aktuelle Status ist nicht der behobene Status.** Das ist es, was einen Vorfall aus dem aktiven Bereich nimmt: Die Statusseiten-Abfrage holt Vorfälle, deren aktueller Status irgendein unbehobener Status ist. Sie archivieren oder schließen nichts – Sie beheben es, und es wandert in die Historie.

**Private Vorfälle erscheinen nie.** **Privater Vorfall** einzuschalten blendet den Vorfall auf jeder Statusseite aus, unabhängig von den Schaltern oben, und beschränkt ihn auf seine Eigentümer plus Projektadministratoren und -eigentümer.

Wie viel behobene Historie die Seite aufhebt, ist eine Einstellung der Statusseite, keine des Vorfalls. Wie die Monitore auf der Seite entscheiden, welche Vorfälle überhaupt erscheinen, steht unter [Statusseiten – Ressourcen & Gruppen](/docs/status-pages/resources-and-groups).

## Wo Sie als Nächstes lesen sollten

- [Vorfälle – Übersicht](/docs/incidents/index) – wie der Funktionsbereich Vorfälle zusammenpasst.
- [Einen Vorfall melden](/docs/incidents/declaring-incidents) – der Melde-Assistent, Vorlagen und die API.
- [Vorfallnotizen, Eigentümer & Feed](/docs/incidents/notes-owners-and-feed) – öffentliche Notizen, private Notizen und der Aktivitäts-Feed.
- [Vorfalleinstellungen & Automatisierung](/docs/incidents/settings) – Vorlagen, benutzerdefinierte Felder, Regeln und Workflow-Trigger.
- [Abonnenten & Ankündigungen](/docs/status-pages/subscribers) – wer die E-Mails erhält, die ein Statuswechsel auslöst.
- [Statusseiten – Übersicht](/docs/status-pages/index) – was eine Statusseite zeigt und wem.
- [Workflows – Übersicht](/docs/workflows/index) – auf Statuswechsel mit Automatisierung reagieren.
