# Ressourcen & Gruppen

Eine Ressource ist eine Zeile auf Ihrer Statusseite – ein Monitor (oder eine Monitor-Gruppe) mit einem Namen, den Besucher verstehen können, einem aktuellen Status und optional einer Verfügbarkeitszahl und einem Verlaufsdiagramm. Eine Gruppe ist ein Abschnitt, der Ressourcen enthält, sodass eine Seite mit vierzig Monitoren wie „API", „Web-App" und „Datenpipeline" wirkt, statt wie eine endlose Liste.

Beide bauen Sie auf einem einzigen Bildschirm auf. Öffnen Sie eine Statusseite und wählen Sie **Resources** im Seitenmenü (der Eintrag heißt **Monitors** bei Projekten, die keine Monitor-Gruppen aktiviert haben). Gruppen hatten früher eine eigene Seite; das ist nicht mehr so, und die alte `/groups`-URL leitet einfach hierher um.

Bekommen Sie diesen Teil richtig hin, ist der Rest der Statusseite Dekoration. Besucher beurteilen „bin ich es oder sind sie es?" anhand dieser Zeilen, benennen Sie sie also so, wie Kunden über Ihr Produkt sprechen – **Checkout API**, nicht `prod-checkout-lb-healthcheck-us-east-1`.

## Der Ressourcen-Bildschirm

Der Bildschirm ist zweigeteilt. Links befindet sich ein Navigator, der jede Gruppe auf der Seite auflistet; rechts der Inhalt der jeweils ausgewählten Gruppe.

- **Der Gruppen-Navigator (links)** – ein Baum aus Gruppen, mit einem Suchfeld (**Search groups...**) darüber und einer laufenden Zählung darunter, etwa `3 groups · 12 resources`. Wenn eine Seite mehr Gruppen hat, als hineinpassen, zeigt eine Schaltfläche **Show N more of M** den Rest.
- **Top of page** – die erste Zeile im Navigator. Sie enthält Ressourcen, die zu keiner Gruppe gehören, und ihr Tooltip erklärt genau, was das bedeutet: Besucher sehen diese zuerst, über allen Gruppen. Hat die Seite überhaupt keine Gruppen, ist der rechte Bereich stattdessen mit **All resources** überschrieben.
- **Der Ressourcenbereich (rechts)** – überschrieben mit der ausgewählten Gruppe. In seiner Kopfzeile befinden sich **Edit Group**, die primäre Schaltfläche **Add Monitor** und ein Überlaufmenü **More actions**.

Zwei Schaltflächen befinden sich in der Kopfzeile der Karte selbst: **New Group** sowie ein Drei-Punkte-Überlaufmenü mit **Import groups from CSV** und **Refresh**.

Die Beschreibung der Karte ändert sich mit der Form Ihrer Seite. Mit Gruppen liest man dort, dass dies alles ist, was Besucher sehen, und dass man links eine Gruppe auswählen soll, um deren Inhalt zu bearbeiten. Ohne Gruppen ermuntert sie Sie, eine anzulegen, um eine längere Seite in Abschnitte zu unterteilen.

**Leerzustände sagen Ihnen, was zu tun ist.** Eine leere Gruppe zeigt **No monitors here yet** mit **Add Monitor**, **Add Multiple** und – nur wenn die Statusseite überhaupt keine Gruppen hat – **Create a Group**. Eine Suche, die nichts findet, zeigt **No resources match your search**. Ein leerer Navigator erklärt, dass Gruppen eine längere Statusseite in Abschnitte unterteilen und dass sie verschachtelt werden können.

## Einen Monitor hinzufügen

Wählen Sie die Gruppe aus, in der die Ressource landen soll (oder **Top of page** für eine gruppenlose Zeile), und klicken Sie dann auf **Add Monitor**. Das Modal trägt den Titel **Add a monitor to {group}** und hat zwei Schritte: **Monitor Details** und **Advanced**.

Bei **Monitor Details**:

- **Monitor** – das Dropdown der Monitore in Ihrem Projekt, Platzhalter **Select Monitor**. Erforderlich.
- **Display Name** – erforderlich. Das ist der Text, den Besucher lesen, und er wird getrennt vom eigenen Namen des Monitors gespeichert, sodass Sie ihn hier umbenennen können, ohne die Überwachung anzufassen.
- **Description** – optionales Markdown, das unter der Zeile angezeigt wird. Gut für einen Satz, der erklärt, was der Dienst tatsächlich tut.

Wenn Ihr Projekt Monitor-Gruppen aktiviert hat, liest man unter dem Dropdown einen Link **Add a Monitor Group instead.** – klicken Sie ihn an, und das **Monitor**-Dropdown wird gegen ein **Monitor Group**-Dropdown getauscht (**Select Monitor Group**). Der Link kippt dann auf **Add a Monitor instead.**, damit Sie zurückwechseln können. Verwenden Sie eine Monitor-Gruppe, wenn eine Zeile auf der Seite mehrere zusammengefasste Prüfungen repräsentieren soll.

### Mehrere auf einmal hinzufügen

**Add Multiple** (auch **Add multiple monitors** im Menü **More actions**) öffnet **Add Multiple Monitors**. Es hat dieselben zwei Schritte, aber der erste ist eine Mehrfachauswahl **Monitors** statt eines einzelnen Dropdowns, und die auf **Advanced** gewählten Anzeigeoptionen gelten für jeden ausgewählten Monitor. Das ist der schnellste Weg, eine neue Seite zu befüllen.

## Anzeigeoptionen einer Ressource

Der Schritt **Advanced** ist im Einzelformular und im Sammelmodal identisch. Alles hier gilt pro Ressource – zwei Zeilen in derselben Gruppe können unterschiedlich konfiguriert sein.

| Feld                                                      | Zweck                                                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Tooltip** (`displayTooltip`)                            | Zusätzlicher Text, der neben der Ressource auf Ihrer Statusseite angezeigt wird. Nutzen Sie ihn für den Geltungsbereich: „US and EU customers". |
| **Show Current Resource Status** (`showCurrentStatus`)    | Standardmäßig an. Zeigt den Live-Status – operational, degraded, offline – neben der Zeile.        |
| **Show Uptime %** (`showUptimePercent`)                   | Standardmäßig aus. Zeigt einen Verfügbarkeitsprozentsatz neben der Ressource.                      |
| **Select Uptime Precision** (`uptimePercentPrecision`)    | Erscheint erst, wenn **Show Uptime %** an ist. Erforderlich, Standard ist eine Nachkommastelle.    |
| **Show Status History Chart** (`showStatusHistoryChart`)  | Standardmäßig an. Zeigt das tagesgenaue Balkendiagramm des Verfügbarkeitsverlaufs für die Ressource. |

**Display Name** (`displayName`) und **Description** (`displayDescription`) aus dem ersten Schritt sind ebenfalls rein anzeigebezogen – sie ändern nie den Monitor selbst.

## Verfügbarkeitsprozentsätze und Verlaufsdiagramme

Sowohl **Show Uptime %** als auch **Show Status History Chart** hängen von einer Einstellung ab, die sich woanders befindet. Das Zeitfenster, das sie abdecken, ist **Show Uptime History (in days)** unter **Status Pages → your page → Advanced → Advanced Settings**, in der Karte **Uptime History Settings**. Sie akzeptiert 1 bis 90 Tage und ist standardmäßig auf 90 gesetzt.

Die Reihenfolge ist also: die Umschalter pro Ressource aktivieren, dann das Zeitfenster einmal für die gesamte Seite festlegen.

**Genauigkeit ist eine Ermessensfrage.** Das Dropdown **Select Uptime Precision** bietet `99% (No Decimal)`, `99.9% (One Decimal)`, `99.99% (Two Decimal)` und `99.999% (Three Decimal)`. Mehr Nachkommastellen wirken präzise und laden zu Diskussionen über die dritte Stelle ein; wenn Sie ein SLA mit drei Neunen veröffentlichen, gleichen Sie es an, aber nicht mehr.

Gruppen haben ihre eigenen Kopien dieser Umschalter – siehe unten –, sodass eine Gruppe einen zusammengefassten Prozentsatz zeigen kann, während die einzelnen Monitore darin still bleiben, oder umgekehrt.

Die Farben der Verlaufsdiagramm-Balken und welche Monitorstatus als „down" gelten, werden auf dem Branding-Bildschirm **Overview Page** festgelegt, behandelt in [Statusseiten – Branding & Domains](/docs/status-pages/branding-and-domains).

## Gruppen

Klicken Sie auf **New Group**, um **Create New Status Page Group** zu öffnen. Das Formular hat drei Schritte: **Group Details**, **Layout** und **Advanced**.

**Group Details**:

- **Group Name** (`name`) – erforderlich. Das ist die Abschnittsüberschrift, die Besucher sehen.
- **Group Description** (`description`) – optionales Markdown, unter der Überschrift angezeigt.
- **Parent Group** (`parentStatusPageGroupId`) – optional. Belassen Sie es bei **No parent group (top level)**, um die Gruppe auf oberster Ebene zu halten.
- **Expand on Status Page by Default** (`isExpandedByDefault`) – ob der Abschnitt für Besucher geöffnet oder eingeklappt startet.

**Advanced** spiegelt die Ressourcen-Umschalter auf Gruppenebene:

- **Show Current Group Status** (`showCurrentStatus`) – standardmäßig an. Zeigt einen Status neben der Gruppenüberschrift.
- **Show Uptime %** (`showUptimePercent`) – standardmäßig aus, wobei **Select Uptime Precision** erscheint, sobald es an ist.

Das Bearbeiten funktioniert genauso: **Edit Group** in der Kopfzeile des Bereichs oder **Edit group** im Zeilenmenü des Navigators öffnet **Edit Status Page Group** mit einer Schaltfläche **Save Changes**.

Die Kopfzeile des Bereichs zeigt Chips für die derzeit aktiven Einstellungen – **Grid**, **Collapsed by default**, **Uptime %** –, sodass Sie sehen können, wie eine Gruppe konfiguriert ist, ohne das Formular zu öffnen.

### Eine Gruppe verwalten

Das Zeilenmenü des Navigators enthält **Edit group**, **Move up**, **Move down**, **Show ID** und **Delete group**. Das Überlaufmenü **More actions** des Bereichs hat die ausführlicheren Entsprechungen – **Edit this group**, **Add a sub group**, **Move group up**, **Move group down**, **Show group ID**, **Refresh** und **Delete this group**. Eine ohne Namen gespeicherte Gruppe erscheint als **Untitled group**, ein guter Hinweis darauf, dass Sie eigentlich etwas eingeben wollten.

## Gruppen verschachteln

Gruppen sind verschachtelbar: Setzen Sie **Parent Group** beim Kind, oder nutzen Sie die Aktion **Add a sub group inside this group** des Navigators. Der Hilfetext des Formulars selbst beschreibt die Form, für die es gebaut ist – etwas wie Corporate Units › Region › Market – und weist darauf hin, dass jede Ebene den zusammengefassten Status und die Verfügbarkeit von allem darunter zeigt.

Hat eine Gruppe Kinder, zeigt der Ressourcenbereich eine Chip-Zeile **Sub groups**, die direkt zu jedem Kind führt, sodass Sie die Hierarchie durchgehen können, ohne zum Navigator zurückzukehren.

Verschachtelung lohnt sich bei großen Seiten: ein Hosting-Anbieter mit Regionen innerhalb von Produkten, oder ein Händler mit Märkten innerhalb von Geschäftsbereichen. Bei einer Seite mit zwölf Monitoren ist eine flache Ebene freundlicher.

## Listen-Layout vs. Grid-Layout

Der Schritt **Layout** legt **View Mode** (`viewMode`) für die Gruppe fest, und das ändert, wie die Gruppe öffentlich dargestellt wird.

| Wenn Sie möchten …                                                          | Wählen                  |
| ----------------------------------------------------------------------------- | ------------------------ |
| Eine schlichte vertikale Liste von Diensten anzeigen, einer pro Zeile         | **List** (Standard)      |
| Denselben Dienst über mehrere Regionen oder Mandanten als Matrix anzeigen     | **Grid**                 |

Wählen Sie **Grid**, erscheinen vier weitere Felder:

- **Row Axis Label** – der Name der Zeilendimension, Platzhalter `Service`.
- **Row Axis Values** – die Zeilen selbst, einzeln hinzugefügt mit **Add Row** (Platzhalter `e.g. Auth`).
- **Column Axis Label** – die Spaltendimension, Platzhalter `Region`.
- **Column Axis Values** – hinzugefügt mit **Add Column** (Platzhalter `e.g. US-East`).

Jeder Monitor in einer Grid-Gruppe wird dann in eine Zelle eingeordnet, weshalb das Sammelmodal neben den Monitoren nach Zeile und Spalte fragt, unter Verwendung Ihrer eigenen Achsenbeschriftungen.

**Richten Sie die Achsen ein, bevor Sie Monitore hinzufügen.** Eine Grid-Gruppe ohne Zeilen oder Spalten zeigt einen gelben Hinweis, dass es nirgendwo hin gibt, einen Monitor zu platzieren, bis die Achsen existieren, mit einer Schaltfläche **Set up the grid** – und die Schaltfläche **Add Monitor** wird bis dahin zurückgezogen.

## Reihenfolge dessen, was Besucher sehen

Die Reihenfolge ist explizit, nicht alphabetisch, und sie wird an drei Stellen festgelegt:

- **Ressourcen innerhalb einer Gruppe** – eine Zeile ziehen. Der Bereich weist darauf hin: **Drag a row to change the order visitors see**.
- **Gruppen zueinander** – **Move up** / **Move down** im Zeilenmenü des Navigators, oder **Move group up** / **Move group down** im Überlaufmenü des Bereichs.
- **Gruppenlose Ressourcen** – sie befinden sich unter **Top of page** und erscheinen immer über jeder Gruppe, platzieren Sie also dort das eine, das jeder zuerst prüft.

**Zwei Fälle, in denen Ziehen deaktiviert ist.** Das Filtern des Bereichs mit dem Feld **Search in {group}...** deaktiviert das Neuanordnen – der Bereich meldet `N of M shown · drag to reorder is off while filtering`, löschen Sie also zuerst die Suche. Und Grid-Gruppen unterstützen niemals Ziehen zum Anordnen, weil die Position stattdessen von den Zeilen- und Spaltenachsen kommt.

Setzen Sie den am meisten nachgefragten Dienst nach oben. Besucher, die während eines Ausfalls auf die Seite kommen, hören meist nach dem ersten Bildschirm auf zu lesen.

## Gruppen aus CSV importieren

Eine tiefe Hierarchie von Hand aufzubauen ist mühsam. Das Drei-Punkte-Überlaufmenü in der Kopfzeile der Karte hat **Import groups from CSV**, das das Modal **Import Groups from CSV** öffnet.

Der Ablauf ist: **Download CSV Template**, um `status-page-groups-template.csv` zu erhalten, ausfüllen, **Choose CSV File**, dann **Preview Import**, um zu prüfen, was angelegt wird, bevor irgendetwas geschrieben wird. Das Ergebnis teilt sich in **Groups Imported** und **Some Groups Could Not Be Imported**, sodass eine fehlerhafte Zeile nicht stillschweigend verschwindet.

Nur `name` ist erforderlich. Die akzeptierten Spalten sind:

| Spalte                    | Was sie festlegt                                        |
| ---------------------------- | ----------------------------------------------------------- |
| `name`                       | Der Gruppenname. Erforderlich.                              |
| `parentName`                 | Der Name der Gruppe, in die diese verschachtelt wird.        |
| `description`                | Die Gruppenbeschreibung.                                     |
| `isExpandedByDefault`        | Ob der Abschnitt für Besucher geöffnet startet.               |
| `showCurrentStatus`          | Ob ein Status neben der Gruppenüberschrift angezeigt wird.    |
| `showUptimePercent`          | Ob ein Verfügbarkeitsprozentsatz neben der Gruppe angezeigt wird. |
| `uptimePercentPrecision`     | Wie viele Nachkommastellen dieser Prozentsatz verwendet.      |
| `viewMode`                   | `List` oder `Grid`.                                          |
| `rowAxisLabel`               | Name der Zeilendimension für eine Grid-Gruppe.                |
| `rowAxisValues`              | Die Zeilenwerte für eine Grid-Gruppe.                         |
| `columnAxisLabel`            | Name der Spaltendimension für eine Grid-Gruppe.               |
| `columnAxisValues`           | Die Spaltenwerte für eine Grid-Gruppe.                        |

Der Import legt Gruppen an, keine Ressourcen – fügen Sie Monitore anschließend mit **Add Monitor** oder **Add Multiple** hinzu.

## Wo Sie als Nächstes lesen sollten

- [Statusseiten – Übersicht](/docs/status-pages/index) – was eine Statusseite ist und wie die Teile zusammenpassen.
- [Statusseiten – Branding & Domains](/docs/status-pages/branding-and-domains) – Logo, Favicon, Diagrammfarben und die Seite auf Ihre eigene Domain bringen.
- [Abonnenten & Ankündigungen](/docs/status-pages/subscribers) – wer benachrichtigt wird, wenn sich diese Ressourcen ändern.
- [Public API](/docs/status-pages/public-api) – Statusseitendaten programmatisch abrufen.
- [Vorfallstatus & Schweregrade](/docs/incidents/states-and-severities) – was einen Vorfall auf der Seite erscheinen und wieder verschwinden lässt.
