# Ressourcen & Gruppen

Eine Ressource ist eine Zeile auf Ihrer Statusseite – ein Monitor (oder eine Monitorgruppe) mit einem Namen, den Besucher verstehen, einem aktuellen Status und wahlweise einer Verfügbarkeitszahl und einem Verlaufsdiagramm. Eine Gruppe ist ein Abschnitt, der Ressourcen aufnimmt, damit sich eine Seite mit vierzig Monitoren als „API“, „Web-App“ und „Datenpipeline“ liest statt als eine endlose Liste.

Beides bauen Sie auf einem einzigen Bildschirm. Öffnen Sie eine Statusseite und wählen Sie **Ressourcen** im Seitenmenü (in Projekten ohne aktivierte Monitorgruppen heißt der Eintrag **Monitore**). Gruppen hatten früher eine eigene Seite; das ist vorbei, und die alte URL `/groups` leitet einfach hierher um.

Machen Sie diesen Teil richtig, ist der Rest der Statusseite Dekoration. Besucher entscheiden anhand dieser Zeilen, ob es „an mir oder an denen“ liegt – benennen Sie sie also so, wie Kunden über Ihr Produkt sprechen: **Checkout API**, nicht `prod-checkout-lb-healthcheck-us-east-1`.

## Der Ressourcen-Bildschirm

Der Bildschirm ist zweigeteilt. Links steht ein Navigator mit allen Gruppen der Seite; rechts steht der Inhalt der Gruppe, die Sie ausgewählt haben.

- **Der Gruppennavigator (links)** – ein Baum von Gruppen, darüber ein Suchfeld (**Search groups...**) und darunter eine mitlaufende Zählung wie `3 groups · 12 resources`. Hat eine Seite mehr Gruppen, als hineinpassen, blendet eine Schaltfläche **Show N more of M** den Rest ein.
- **Top of page** – die erste Zeile im Navigator. Sie enthält Ressourcen, die in keiner Gruppe stecken, und ihr Tooltip sagt genau, was das heißt: Besucher sehen diese zuerst, über jeder Gruppe. Hat die Seite überhaupt keine Gruppen, heißt der rechte Bereich stattdessen **All resources**.
- **Der Ressourcenbereich (rechts)** – überschrieben mit der Gruppe, die Sie ausgewählt haben. Seine Kopfzeile trägt **Edit Group**, die primäre Schaltfläche **Monitor hinzufügen** und ein Überlaufmenü **More actions**.

Zwei Schaltflächen sitzen in der Kopfzeile der Karte selbst: **New Group** und ein Drei-Punkte-Menü mit **Import groups from CSV** und **Aktualisieren**.

Die Beschreibung der Karte richtet sich nach der Form Ihrer Seite. Mit Gruppen steht dort, dass dies alles ist, was Besucher sehen, und dass Sie links eine Gruppe wählen sollen, um deren Inhalt zu bearbeiten. Ohne Gruppen legt sie Ihnen nahe, eine anzulegen, um eine längere Seite in Abschnitte zu teilen.

**Leerzustände sagen Ihnen, was zu tun ist.** Eine leere Gruppe zeigt **No monitors here yet** mit **Monitor hinzufügen**, **Add Multiple** und – nur wenn die Statusseite überhaupt keine Gruppen hat – **Create a Group**. Eine Suche ohne Treffer zeigt **No resources match your search**. Ein leerer Navigator erklärt, dass Gruppen eine längere Statusseite in Abschnitte teilen und sich verschachteln lassen.

## Einen Monitor hinzufügen

Wählen Sie die Gruppe, in der die Ressource landen soll (oder **Top of page** für eine Zeile ohne Gruppe), und klicken Sie auf **Monitor hinzufügen**. Der Dialog heißt **Add a monitor to {group}** und hat zwei Schritte: **Monitordetails** und **Erweitert**.

Im Schritt **Monitordetails**:

- **Überwachung** – das Dropdown der Monitore in Ihrem Projekt, Platzhalter **Überwachung auswählen**. Pflichtfeld.
- **Anzeigename** – Pflichtfeld. Das ist der Text, den Besucher lesen; er wird getrennt vom eigenen Namen des Monitors gespeichert, Sie können ihn hier also ändern, ohne die Überwachung anzufassen.
- **Beschreibung** – optionales Markdown, unter der Zeile angezeigt. Gut für einen Satz, der erklärt, was der Dienst eigentlich tut.

Sind in Ihrem Projekt Monitorgruppen aktiviert, steht unter dem Dropdown ein Link **Add a Monitor Group instead.** – klicken Sie ihn an, und das Dropdown **Überwachung** wird gegen ein Dropdown **Monitor Gruppe** getauscht (**Überwachungsgruppe auswählen**). Der Link wechselt dann zu **Add a Monitor instead.**, damit Sie zurückkönnen. Nehmen Sie eine Monitorgruppe, wenn eine Zeile auf der Seite mehrere zusammengefasste Prüfungen darstellen soll.

### Mehrere auf einmal hinzufügen

**Add Multiple** (im Menü **More actions** auch **Add multiple monitors**) öffnet **Add Multiple Monitors**. Der Dialog hat dieselben zwei Schritte, aber der erste ist eine Mehrfachauswahl **Monitore** statt eines einzelnen Dropdowns, und die Anzeigeoptionen aus **Erweitert** gelten für jeden Monitor, den Sie ausgewählt haben. Das ist der schnellste Weg, eine neue Seite zu bestücken.

## Anzeigeoptionen an einer Ressource

Der Schritt **Erweitert** ist im Einzelformular und im Massendialog derselbe. Alles hier gilt pro Ressource – zwei Zeilen in derselben Gruppe dürfen unterschiedlich konfiguriert sein.

| Feld                                                              | Zweck                                                                                              |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **Tooltip** (`displayTooltip`)                                    | Zusätzlicher Text neben der Ressource auf Ihrer Statusseite. Nutzen Sie ihn für den Geltungsbereich: „Kunden in den USA und der EU“. |
| **Aktuellen Ressourcenstatus anzeigen** (`showCurrentStatus`)     | Standardmäßig an. Zeigt den Live-Status – betriebsbereit, beeinträchtigt, offline – neben der Zeile. |
| **Verfügbarkeit % anzeigen** (`showUptimePercent`)                | Standardmäßig aus. Zeigt einen Verfügbarkeitsprozentsatz neben der Ressource.                       |
| **Verfügbarkeitsgenauigkeit auswählen** (`uptimePercentPrecision`) | Erscheint erst, wenn **Verfügbarkeit % anzeigen** an ist. Pflichtfeld, Standard: eine Nachkommastelle. |
| **Statusverlaufsdiagramm anzeigen** (`showStatusHistoryChart`)    | Standardmäßig an. Zeigt das tagesweise Verfügbarkeits-Balkendiagramm der Ressource.                 |

Auch **Anzeigename** (`displayName`) und **Beschreibung** (`displayDescription`) aus dem ersten Schritt sind reine Anzeigefelder – sie ändern den Monitor selbst nie.

## Verfügbarkeitsprozente und Verlaufsdiagramme

Sowohl **Verfügbarkeit % anzeigen** als auch **Statusverlaufsdiagramm anzeigen** hängen an einer Einstellung, die woanders liegt. Der Zeitraum, den beide abdecken, ist **Verfügbarkeitsverlauf anzeigen (in Tagen)** unter **Statusseiten → Ihre Seite → Erweitert → Erweiterte Einstellungen**, in der Karte **Einstellungen für Verfügbarkeitsverlauf**. Sie nimmt 1 bis 90 Tage und steht standardmäßig auf 90.

Die Reihenfolge ist also: die Schalter pro Ressource einschalten, dann den Zeitraum einmal für die ganze Seite setzen.

**Die Genauigkeit ist eine Ermessensfrage.** Das Dropdown **Verfügbarkeitsgenauigkeit auswählen** bietet `99% (No Decimal)`, `99.9% (One Decimal)`, `99.99% (Two Decimal)` und `99.999% (Three Decimal)`. Mehr Nachkommastellen wirken präzise und laden zu Diskussionen über die dritte ein; wenn Sie ein SLA mit drei Neunen veröffentlichen, treffen Sie genau das und nicht mehr.

Gruppen haben eigene Kopien dieser Schalter – siehe unten –, eine Gruppe kann also einen zusammengefassten Prozentsatz zeigen, während die einzelnen Monitore darin stumm bleiben, oder umgekehrt.

Die Farben der Balken im Verlaufsdiagramm und die Frage, welche Monitorstatus als „down“ zählen, stellen Sie auf dem Branding-Bildschirm **Übersichtsseite** ein – beschrieben unter [Statusseiten – Branding & Domains](/docs/status-pages/branding-and-domains).

## Gruppen

Klicken Sie auf **New Group**, um **Create New Status Page Group** zu öffnen. Das Formular hat drei Schritte: **Gruppendetails**, **Layout** und **Erweitert**.

**Gruppendetails**:

- **Gruppenname** (`name`) – Pflichtfeld. Das ist die Abschnittsüberschrift, die Besucher sehen.
- **Gruppenbeschreibung** (`description`) – optionales Markdown, unter der Überschrift angezeigt.
- **Parent Group** (`parentStatusPageGroupId`) – optional. Lassen Sie das Feld auf **No parent group (top level)**, damit die Gruppe auf oberster Ebene bleibt.
- **Auf Statusseite standardmäßig erweitern** (`isExpandedByDefault`) – ob der Abschnitt für Besucher offen oder eingeklappt startet.

**Erweitert** spiegelt die Ressourcenschalter auf Gruppenebene:

- **Aktuellen Gruppenstatus anzeigen** (`showCurrentStatus`) – standardmäßig an. Zeigt einen Status neben der Gruppenüberschrift.
- **Verfügbarkeit % anzeigen** (`showUptimePercent`) – standardmäßig aus; **Verfügbarkeitsgenauigkeit auswählen** erscheint, sobald der Schalter an ist.

Das Bearbeiten läuft genauso: **Edit Group** in der Kopfzeile des Bereichs oder **Edit group** im Zeilenmenü des Navigators öffnet **Edit Status Page Group** mit einer Schaltfläche **Änderungen speichern**.

Die Kopfzeile des Bereichs zeigt Chips für die gerade aktiven Einstellungen – **Grid**, **Collapsed by default**, **Uptime %** –, sodass Sie die Konfiguration einer Gruppe sehen, ohne das Formular zu öffnen.

### Eine Gruppe verwalten

Das Zeilenmenü des Navigators enthält **Edit group**, **Move up**, **Move down**, **ID anzeigen** und **Delete group**. Das Überlaufmenü **More actions** des Bereichs hat die ausführlicheren Entsprechungen – **Edit this group**, **Add a sub group**, **Move group up**, **Move group down**, **Show group ID**, **Aktualisieren** und **Delete this group**. Eine ohne Namen gespeicherte Gruppe erscheint als **Untitled group** – ein deutliches Zeichen, dass Sie eigentlich etwas eintippen wollten.

## Gruppen verschachteln

Gruppen lassen sich verschachteln: Setzen Sie **Parent Group** an der Untergruppe oder nutzen Sie im Navigator die Aktion **Add a sub group inside this group**. Der Hilfetext des Formulars beschreibt die Form, für die es gebaut ist – etwa Geschäftsbereich › Region › Markt – und weist darauf hin, dass jede Ebene den zusammengefassten Status und die Verfügbarkeit von allem darunter zeigt.

Hat eine Gruppe Untergruppen, zeigt der Ressourcenbereich eine Chip-Zeile **Sub groups**, die direkt in jede Untergruppe verlinkt – so laufen Sie durch die Hierarchie, ohne zum Navigator zurückzukehren.

Verschachtelung lohnt sich auf großen Seiten: ein Hosting-Anbieter mit Regionen innerhalb von Produkten oder ein Händler mit Märkten innerhalb von Geschäftsbereichen. Auf einer Seite mit zwölf Monitoren ist eine flache Ebene freundlicher.

## Listen-Layout und Raster-Layout

Der Schritt **Layout** setzt den **Ansichtsmodus** (`viewMode`) der Gruppe und verändert, wie die Gruppe öffentlich dargestellt wird.

| Wenn Sie …                                                                  | Wählen Sie             |
| ----------------------------------------------------------------------------- | ---------------------- |
| eine schlichte senkrechte Liste von Diensten zeigen wollen, einen pro Zeile   | **List** (Standard)    |
| denselben Dienst über mehrere Regionen oder Mandanten hinweg als Matrix zeigen wollen | **Grid**       |

Wählen Sie **Grid**, erscheinen vier weitere Felder:

- **Beschriftung der Zeilenachse** – der Name der Zeilendimension, Platzhalter `Service`.
- **Werte der Zeilenachse** – die Zeilen selbst, einzeln über **Add Row** hinzugefügt (Platzhalter `e.g. Auth`).
- **Beschriftung der Spaltenachse** – die Spaltendimension, Platzhalter `Region`.
- **Werte der Spaltenachse** – über **Add Column** hinzugefügt (Platzhalter `e.g. US-East`).

Jeder Monitor in einer Grid-Gruppe sitzt dann in einer Zelle – der Massendialog fragt deshalb neben den Monitoren auch nach Zeile und Spalte und benutzt dabei Ihre eigenen Achsenbeschriftungen.

**Richten Sie die Achsen ein, bevor Sie Monitore hinzufügen.** Eine Grid-Gruppe ohne Zeilen und Spalten zeigt einen bernsteinfarbenen Hinweis, dass es keinen Platz für einen Monitor gibt, solange die Achsen fehlen, dazu eine Schaltfläche **Set up the grid** – und die Schaltfläche **Monitor hinzufügen** verschwindet, bis Sie das erledigt haben.

## Die Reihenfolge festlegen, die Besucher sehen

Die Reihenfolge ist ausdrücklich gesetzt, nicht alphabetisch, und sie entsteht an drei Stellen:

- **Ressourcen innerhalb einer Gruppe** – ziehen Sie eine Zeile. Der Bereich sagt es selbst: **Drag a row to change the order visitors see**.
- **Gruppen zueinander** – **Move up** / **Move down** im Zeilenmenü des Navigators oder **Move group up** / **Move group down** im Überlaufmenü des Bereichs.
- **Ressourcen ohne Gruppe** – sie liegen unter **Top of page** und stehen immer über jeder Gruppe; setzen Sie also das eine Ding dorthin, das alle zuerst prüfen.

**Zwei Fälle, in denen das Ziehen abgeschaltet ist.** Filtern Sie den Bereich über das Feld **Search in {group}...**, ist das Umsortieren deaktiviert – der Bereich meldet `N of M shown · drag to reorder is off while filtering`, löschen Sie also zuerst die Suche. Und Grid-Gruppen unterstützen Drag-Sortierung grundsätzlich nicht, weil die Position dort aus den Zeilen- und Spaltenachsen kommt.

Setzen Sie den Dienst, nach dem am häufigsten gefragt wird, ganz nach oben. Besucher, die während eines Ausfalls auf die Seite kommen, hören meist nach dem ersten Bildschirm auf zu lesen.

## Gruppen aus CSV importieren

Eine tiefe Hierarchie von Hand zu bauen ist mühsam. Das Drei-Punkte-Menü in der Kopfzeile der Karte hat **Import groups from CSV**, das den Dialog **Import Groups from CSV** öffnet.

Der Ablauf: **Download CSV Template** liefert `status-page-groups-template.csv`, Sie füllen die Datei aus, wählen **Choose CSV File** und prüfen mit **Preview Import**, was angelegt wird, bevor irgendetwas geschrieben wird. Das Ergebnis teilt sich in **Groups Imported** und **Some Groups Could Not Be Imported** – eine fehlerhafte Zeile verschwindet also nicht stillschweigend.

Pflicht ist nur `name`. Akzeptiert werden diese Spalten:

| Spalte                   | Was sie setzt                                            |
| ------------------------ | -------------------------------------------------------- |
| `name`                   | Der Gruppenname. Pflicht.                                |
| `parentName`             | Der Name der Gruppe, in der diese steckt.                |
| `description`            | Die Gruppenbeschreibung.                                 |
| `isExpandedByDefault`    | Ob der Abschnitt für Besucher offen startet.             |
| `showCurrentStatus`      | Ob neben der Gruppenüberschrift ein Status erscheint.    |
| `showUptimePercent`      | Ob neben der Gruppe ein Verfügbarkeitsprozentsatz erscheint. |
| `uptimePercentPrecision` | Wie viele Nachkommastellen dieser Prozentsatz nutzt.     |
| `viewMode`               | `List` oder `Grid`.                                      |
| `rowAxisLabel`           | Name der Zeilendimension einer Grid-Gruppe.              |
| `rowAxisValues`          | Die Zeilenwerte einer Grid-Gruppe.                       |
| `columnAxisLabel`        | Name der Spaltendimension einer Grid-Gruppe.             |
| `columnAxisValues`       | Die Spaltenwerte einer Grid-Gruppe.                      |

Der Import legt Gruppen an, keine Ressourcen – Monitore fügen Sie danach über **Monitor hinzufügen** oder **Add Multiple** hinzu.

## Wo Sie als Nächstes lesen sollten

- [Statusseiten – Übersicht](/docs/status-pages/index) – was eine Statusseite ist und wie die Teile zusammenpassen.
- [Statusseiten – Branding & Domains](/docs/status-pages/branding-and-domains) – Logo, Favicon, Diagrammfarben und die Seite unter Ihrer eigenen Domain.
- [Abonnenten & Ankündigungen](/docs/status-pages/subscribers) – wer erfährt, wenn sich diese Ressourcen verändern.
- [Öffentliche API](/docs/status-pages/public-api) – Statusseitendaten programmatisch lesen.
- [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities) – was einen Vorfall auf der Seite erscheinen und wieder verschwinden lässt.
