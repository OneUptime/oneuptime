# Netzwerkstandorte (Integritätszusammenfassung & Verfügbarkeit)

Ein Netzwerkstandort ist ein Ort: eine Region, ein Markt, ein Franchisenehmer, ein Verteilzentrum, eine Filiale. Standorte sind ineinander verschachtelt, Netzwerkgeräte gehören zu ihnen, und OneUptime fasst die Integrität der Geräte den Baum hinauf zusammen, sodass ein Status an einer Region die Frage beantwortet: „Ist da draußen irgendetwas falsch?“

Sie finden sie unter **Netzwerk → Standorte** und auf einer Karte unter **Netzwerk → Karte**. Diese Seite legt fest, wie der Status eines Standorts aus dem ermittelt wird, was unter ihm liegt, was seine Verfügbarkeit bedeutet und wie geplante Wartung beides ändert.

:::cards
- [Einen Standort hinzufügen](#einen-standort-hinzufügen): Drei Schritte, oder eine CSV-Datei für einen ganzen Bestand.
- [Überwachungsstandards festlegen](#überwachungsstandards): Eine Sonde und Anmeldedaten für jedes Gerät eines Standorts.
- [Festlegen, wie die Integrität zusammengefasst wird](#wie-die-integrität-übergeordneter-standorte-berechnet-wird): Schlechtester Status für eine Filiale, ein Anteil für eine Region.
- [Die Verfügbarkeit lesen](#verfügbarkeit): Was die Prozentwerte zählen, Tag für Tag.
:::

## So funktioniert es

```mermaid title="Die Integrität wird den Standortbaum hinauf zusammengefasst"
flowchart BT
    Devices1["Geräte von Filiale 1"]
    Devices2["Geräte von Filiale 2"]
    Devices3["Geräte von Filiale 3"]
    Store1["Filiale 1<br/>schlechtester Status"]
    Store2["Filiale 2<br/>schlechtester Status"]
    Store3["Filiale 3<br/>schlechtester Status"]
    MarketA["Markt A<br/>Anteil ausgefallener Geräte"]
    MarketB["Markt B<br/>Anteil ausgefallener Geräte"]
    Region["Region<br/>Anteil ausgefallener Geräte"]
    Devices1 --> Store1
    Devices2 --> Store2
    Devices3 --> Store3
    Store1 --> MarketA
    Store2 --> MarketA
    Store3 --> MarketB
    MarketA --> Region
    MarketB --> Region
```

Der Status jedes Standorts ergibt sich aus jedem Gerät in seinem Teilbaum, beurteilt nach der eigenen [Zusammenfassungsrichtlinie](#wie-die-integrität-übergeordneter-standorte-berechnet-wird) des Standorts. Die Verfügbarkeit eines Standorts ergibt sich aus seiner eigenen Status-Zeitachse, und ein [Wartungsfenster](#geplante-wartung-für-netzwerkstandorte) an einem Standort nimmt seine Geräte aus der Abstimmung darüber heraus.

## Die Hierarchie

Standorte bilden einen Baum. Jeder Standort hat einen **Standorttyp** und optional einen übergeordneten Standort. Standorttypen sind die eigene Liste des Projekts, unter **Netzwerk → Einstellungen → Standorttypen**, und ein neues Projekt beginnt mit Account Type, Region, Franchisee, Market und Unit, in dieser Reihenfolge von oben, dazu Data Center und Other. Typen bilden eine eigene Hierarchie (**Übergeordneter Standorttyp**), die bestimmt, welche Standorte übergeordnete Standorte eines Standorts sein können. Ein mit **Ist Einheitenebene** markierter Typ ist die unterste Ebene Ihres Bestands, die einzelne Filiale oder Niederlassung: Seine Standorte enthalten Geräte, keine anderen Standorte.

Typ, Name, Beschreibung, übergeordneter Standort und Lage eines Standorts werden an einer Stelle bearbeitet: in der Karte **Standorteinstellungen** auf der **Einstellungen**-Seite des Standorts. Die Übersicht des Standorts zeigt sie mit einem Link **In den Einstellungen bearbeiten**, und die Liste **Standorte** fügt Standorte hinzu, bearbeitet sie aber nicht.

Jedes Gerät gehört zu einem Standort. Der Teilbaum eines Standorts ist der Standort selbst plus jeder Standort darunter, und aus den Geräten des Teilbaums ergibt sich seine Integrität, eine Region ohne eigene Geräte hat also trotzdem einen Status, weil die Einheiten unter ihr einen haben.

> [!NOTE]
> Eine Zusammenfassung wird neu berechnet, wenn sich der Status eines Geräts ändert, wenn ein Gerät an einen anderen Standort wandert, wenn ein Standort im Baum verschoben wird, und durch eine Durchsicht alle fünf Minuten, die die Fälle erfasst, in denen nur die verstrichene Zeit die Antwort geändert hat.

## Einen Standort hinzufügen

:::steps
### Einen neuen Standort beginnen
Gehen Sie zu **Netzwerk → Standorte** und klicken Sie auf **Standort hinzufügen**.

### Sagen, was der Standort ist
Wählen Sie im Schritt **Standortdetails** den **Standorttyp** (was für ein Ort das ist: eine Region, eine Filiale, ein Rechenzentrum) und geben Sie einen **Name** ein. Die Beschreibung, die Straßenadresse sowie Breiten- und Längengrad, die den Standort auf der Karte festlegen, sind unter **Weitere Felder** eingeklappt: Füllen Sie sie jetzt oder später aus.

### Ihn in den Baum einordnen
Wählen Sie im Schritt **Hierarchie** den **Übergeordneter Standort**, wenn der Standort unter einem anderen liegt. Lassen Sie ihn leer, um den Standort auf der obersten Ebene zu halten.

### Seine Standards festlegen
Wählen Sie im Schritt **Überwachungsstandards** die [Standardsonde und das Anmeldedatenprofil](#überwachungsstandards) für die Geräte, die dem Standort hinzugefügt werden, und klicken Sie auf **Standort hinzufügen**.
:::

Auf der eigenen Seite **Untergeordnete Standorte** eines Standorts fragt **Untergeordneter Standort hinzufügen** nur nach Typ und Name, auf einer Seite mit eingeklappter Lage, und setzt den neuen Standort unter diesen.

### Standorte aus einer CSV-Datei importieren

Um einen ganzen Bestand auf einmal hereinzubringen, öffnen Sie das Menü oben in der Liste **Standorte** und klicken Sie auf **Aus CSV importieren**. Die Datei braucht eine Kopfzeile; die Spalten können in beliebiger Reihenfolge stehen, und bei ihren Namen spielt Groß- und Kleinschreibung keine Rolle:

```csv title="sites.csv"
name,siteType,parentName,address,latitude,longitude
North,Region,,,,
Leeds,Market,North,,,
Store 0660,Unit,Leeds,"1 High Street, Leeds",53.7997,-1.5492
```

- `name` und `siteType` sind Pflicht. `siteType` muss einer der Standorttypen des Projekts sein.
- `parentName` nennt den übergeordneten Standort, der in derselben Datei stehen kann: Zeilen ohne übergeordneten Standort oder mit einem, der bereits existiert, kommen zuerst, dann ihre untergeordneten. Lassen Sie es für einen Standort der obersten Ebene leer.
- Eine Zeile, deren übergeordneter Standort nicht gefunden wird, wird übersprungen, und die Ergebnisse führen sie auf. **Importvorschau** zeigt, was die Datei anlegen wird, bevor etwas geschrieben wird.

## Die Karte

**Netzwerk → Karte** zeigt Ihre Standorte auf einer Karte, auf den Bereich zugeschnitten, wo sie liegen; klicken Sie auf einen Standort, um hineinzugehen. Ein Standort mit Standorten darunter zeigt diese, auf der Karte und als Graph der Verbindungen zwischen ihnen. Ein Standort ohne Standorte darunter, aber mit eigenen Geräten, oder ein Standort, dessen Typ auf Einheitenebene liegt, öffnet die Live-Topologie dieser Geräte.

Ein Projekt ohne Standorte hat trotzdem eine Karte: Die Karte zeigt stattdessen die Topologie seiner Geräte, und das Gruppieren von Geräten in Standorte setzt sie nach ihrer Lage auf die Karte.

## Überwachungsstandards

An einem Standort sagen Sie auch einmal, wie die Geräte darin überwacht werden. **Einstellungen bearbeiten** in der Karte **Standorteinstellungen** hat einen Schritt **Überwachungsstandards** mit zwei Feldern:

| Einstellung | Wirkung |
| --- | --- |
| **Standardsonde** | Die Sonde, die Geräte an diesem Standort anpingt und per SNMP abfragt, wenn sie Anmeldedaten haben. Ein Gerät, das ohne eigene Sonde am Standort angelegt wird, übernimmt sie, ebenso ein Gerät, das ohne Sonde hierher verschoben wird. |
| **Standard-SNMP-Anmeldedatenprofil** | Das [Anmeldedatenprofil](/docs/monitor/network-device-monitor#snmp-anmeldedaten-und-anmeldedatenprofile), mit dem Geräte an diesem Standort abgefragt werden, wenn weder das Gerät noch sein eigenes Profil Anmeldedaten hat. |

Legen Sie beides an einem Standort fest, und ein neues Gerät dort lässt sich allein mit seiner Adresse hinzufügen: Es wird ab seiner ersten Abfrage angepingt und ab seiner ersten Abfrage abgefragt.

Die beiden verhalten sich bewusst unterschiedlich:

- Die Sonde wird auf das Gerät kopiert, wenn das Gerät am Standort angelegt oder dorthin verschoben wird. Eine spätere Änderung der Standardsonde eines Standorts verschiebt keine Geräte, die schon eine haben: Welche Sonde ein Gerät erreicht, ist eine Tatsache des Netzwerks, keine Vorliebe, die man gesammelt aus einem Standortformular umschreibt.
- Das Anmeldedatenprofil wird live gelesen, bei jeder Abfrage. Legen Sie eines an einem Standort fest, und jedes Gerät darin ohne Anmeldedaten wird ab seiner nächsten Abfrage abgefragt, ohne Bearbeitung pro Gerät; entfernen Sie es, und sie werden wieder nur angepingt.

Sie reichen auch unterschiedlich weit den Baum hinunter:

- Die Sonde reicht durch den ganzen Baum. Ein Gerät, das an einem Standort ohne Standardsonde landet, übernimmt die des nächsten Vorfahren, eine an einer Region festgelegte Sonde deckt also jeden Markt und jede Einheit darunter ab, und ein Markt, der seine eigene nennt, überschreibt sie für seinen Teilbaum.
- Das Anmeldedatenprofil wird nur vom eigenen Standort des Geräts gelesen. Ein Gerät in einer Einheit übernimmt kein Profil, das an seiner Region festgelegt ist; legen Sie es also an den Standorten fest, zu denen die Geräte tatsächlich gehören.

## Wie die Integrität übergeordneter Standorte berechnet wird

Jeder Standort wählt eine von zwei Zusammenfassungsrichtlinien, in der Karte **Integritätszusammenfassung** auf seiner **Einstellungen**-Seite (**Zusammenfassungsrichtlinie**).

### Schlechtester Status eines Geräts (Standard)

Der schlechteste Status, den ein Gerät im Teilbaum meldet, wird zum Status des Standorts. Wie schlimm ein Status ist, ergibt sich aus seiner Priorität als Monitorstatus: Die Status eines neuen Projekts sind Operational (1), Degraded (2) und Offline (3), und höher ist schlimmer. Ein Offline-Gerät macht den Standort offline, egal wie viele gesunde Geräte daneben stehen.

Das ist die richtige Antwort für eine Einheit. Vier Switches und eine Firewall in einem Gebäude sind nicht unabhängig: Ist einer davon dunkel, ist das ein Problem an dieser Adresse, und es wegzumitteln verdeckt einen echten Ausfall.

Für eine Region über vierhundert Filialen ist es meist die falsche Antwort. Ein dunkler Switch in Filiale 12.000 färbt die ganze Region offline: im engsten Sinn wahr und in jedem praktischen nutzlos, denn die Region ist dann rot, sobald irgendeine Filiale irgendwo ein Problem hat, und sagt Ihnen nichts mehr.

### Anteil ausgefallener Geräte

Der Status des Standorts ergibt sich aus dem Anteil der berichtenden Geräte des Teilbaums, die nicht in einem betriebsbereiten Status sind:

| Anteil ausgefallener Geräte | Status des Standorts |
| --- | --- |
| 0% | Operational |
| Über 0%, unter dem Schwellenwert | Degraded: der Status des Projekts, der weder betriebsbereit noch offline ist, oder Offline, wenn das Projekt keinen hat |
| Am oder über dem Schwellenwert | Offline |

Der Schwellenwert wird pro Standort festgelegt, als **Offline-Schwellenwert (%)**, und ist standardmäßig 50.

Nichts ausgefallen ist Operational, wie niedrig der Schwellenwert auch ist: Ein Schwellenwert von 0 bedeutet „jedes ausgefallene Gerät macht dies offline“, nicht „eine gesunde Region ist offline“.

### Welche Geräte abstimmen

Hier sind sich beide Richtlinien einig, und es zählt mehr, als es klingt:

- Archivierte Geräte stimmen nie ab. Sie sind außer Betrieb genommen: Sie behalten ihren Standort, werden aber ausgelassen.
- Geräte, die noch nie etwas gemeldet haben, stimmen nie ab. Ein Gerät, das auf seine erste Abfrage wartet, ist kein Beleg für einen Ausfall, es fällt also aus beiden Seiten des Anteils heraus, und eine Region, die zur Hälfte eingebunden ist, wird nach der Hälfte bewertet, die geantwortet hat.
- Ein sondenabgefragtes Gerät, die normale Art, stimmt mit dem Ergebnis seiner letzten Abfrage ab: erreichbar per Ping oder SNMP, nicht danach, wie lange sein letzter Erfolg her ist. Ein Gerät, das auf Ping antwortet, während sein SNMP-Walk fehlschlägt, ist erreichbar und stimmt so ab; der Standort sagt, dass er erreichbar ist, und die Zeile des Geräts sagt **SNMP schlägt fehl**, damit jemand die Anmeldedaten in Ordnung bringt.
- Ein monitorgestütztes Gerät, eines, das auf seiner Einstellungen-Seite auf die Überschreibung mit gebundenem Monitor umgestellt ist, stimmt mit dem Status des daran gebundenen Monitors ab, weil nichts es abfragt. Ohne gebundenen Monitor hat es nie etwas gemeldet und stimmt also gar nicht ab.

Ein Netzwerkgerät-Monitor auf einem sondenabgefragten Gerät ändert nicht, wie das Gerät abstimmt. Ein Monitor mit dem Kriterium „Schnittstelle ausgefallen, also Offline“ würde Offline auf einen Switch stempeln, der jeden Ping beantwortet, und ein dunkler Port würde einen ganzen Standort rot färben, während jede Gerätezeile darunter Up zeigt: Der Standort würde der Liste widersprechen, die er zusammenfasst. Für ein abgefragtes Gerät ist die Abfrage die Quelle seiner Integrität; der Monitor ist dafür da, Vorfälle auszulösen.

### Eine Richtlinie wählen

Ein vernünftiger Anfang für einen Franchise-Bestand:

| Ebene | Richtlinie | Warum |
| --- | --- | --- |
| Einheit oder Filiale | Schlechtester Status | Ein ausgefallenes Gerät ist ein Standort mit Problemen. |
| Markt | Anteil, Schwellenwert etwa 50% | Ein Markt, dessen Filialen zur Hälfte ausgefallen sind, ist ausgefallen. |
| Region | Anteil, Schwellenwert 25% bis 50% | Der Ausfall einer einzelnen Filiale macht die Region Degraded, nicht Offline, und sie wird Offline, wenn etwas Systemisches passiert. |

Die Richtlinie wird pro Standort festgelegt, Sie können also den Regionen die Anteilsrichtlinie geben und alles darunter beim Standard lassen.

## Verfügbarkeit

Jeder Standort hat eine Status-Zeitachse: eine Zeile pro Änderung seines zusammengefassten Status, geöffnet, wenn sich der Status ändert, und geschlossen, wenn er sich wieder ändert. Die Verfügbarkeit wird daraus berechnet:

- Zeit in einem Status, der nicht als betriebsbereit markiert ist, ist Ausfallzeit.
- Überlappende Zeilen werden zusammengeführt, keine Sekunde zählt also doppelt.
- Zeit, die keine Zeile abdeckt, zählt als verfügbar. Die Zeitachse bekommt erst Zeilen, wenn eine Zusammenfassung gelaufen ist, und fehlende Belege sind kein Ausfall.
- Eine noch offene Zeile läuft bis zum Ende des gemessenen Fensters.

Degraded ist nicht betriebsbereit und zählt daher ebenfalls als ausgefallen. Unter beiden Richtlinien ist die Verfügbarkeit eines Standorts also der Anteil der Zeit, in der kein berichtendes Gerät darunter ausgefallen war: Die Richtlinie ändert, welchen Status ein Teilausfall zeigt, Degraded oder Offline, nicht ob er zählt.

Ein Standort ganz ohne Zeilen in der Zeitachse zeigt `—` statt 100%: Ein Standort, für den nie eine Zusammenfassung lief, ist nicht überwacht, nicht perfekt.

### Tägliche Verfügbarkeit

Neben dem 30-Tage-Wert zeigt die Übersicht jedes Standorts **Uptime (24h)**, und seine Seite **Status-Zeitachse** zeigt die letzten 24 Stunden, 7, 30 und 90 Tage sowie einen Balken pro Tag für die letzten 30.

Ein 30-Tage-Durchschnitt kann keinen schlechten Tag zeigen. Ein voller Ausfalltag in einem 30-Tage-Fenster kostet 3.3 Punkte, ein Standort, der einen ganzen Dienstag dunkel war, meldet für den Monat also immer noch 96.7%, eine Zahl, die wie Rundung aussieht. Die täglichen Balken legen dieselben Daten dorthin, wo ein schlechter Tag ein schlechter Balken ist.

Tage sind rollierende 24-Stunden-Abschnitte, die jetzt enden, keine Kalendertage: Die Geräte, der Betrachter und der Server können jeweils in einer anderen Zeitzone sein, und es gibt keinen einen „Tag“, auf den sie sich einigen würden.

### Die Verfügbarkeit übergeordneter Standorte ist kein Durchschnitt der untergeordneten

Die Verfügbarkeit eines übergeordneten Standorts ergibt sich aus seiner eigenen Zeitachse, die seine Zusammenfassungsrichtlinie erzeugt hat, nicht aus dem Durchschnitt der Prozentwerte seiner untergeordneten Standorte.

Ein Durchschnitt über die untergeordneten gewichtet eine Filiale mit zwei Geräten genauso wie ein Verteilzentrum mit zweihundert. Die eigene Zeitachse eines übergeordneten Standorts liefert stattdessen eine Lesart, die sich in einem Satz sagen lässt: der Anteil der Zeit, in der in der Region überhaupt nichts ausgefallen war. Sie ist bewusst streng, lesen Sie sie bei einer großen Region also zusammen mit den täglichen Balken und mit dem Status, der sagt, ob ein Teilausfall Degraded oder Offline war.

## Geplante Wartung für Netzwerkstandorte

Hängen Sie Standorte an ein geplantes Wartungsereignis unter **Andere betroffene Ressourcen**, im Schritt **Betroffene Ressourcen** des Ereignisses, wie Sie es mit einem Host tun würden. Die eigene Seite **Geplante Wartung** eines Standorts listet die daran gehängten Ereignisse, und ihr **Geplantes Wartungsereignis erstellen** öffnet das Formular mit dem schon gewählten Standort.

Ein Fenster an einem übergeordneten Standort deckt alles darunter ab: Ein Fenster an einer Region deckt jeden Markt und jede Einheit darin ab, auch Standorte, die nach der Planung des Fensters angelegt wurden, ein regionaler Providerwechsel muss also keine vierhundert Filialen aufzählen.

Die Abdeckung reicht nur nach unten. Ein Fenster an einer Einheit setzt ihre Region nicht in Wartung: Von der Region wird weiterhin erwartet, dass sie verfügbar ist, und ein echter Ausfall in einer anderen Einheit während derselben Stunden zählt weiter gegen sie.

### Was ein Wartungsfenster ändert

| Während des Fensters | Was passiert |
| --- | --- |
| Der Live-Status des Standorts | Unverändert. Eine Einheit, die für geplante Arbeiten aus ist, zeigt auf der Karte und im Baum weiterhin Offline, mit einem Abzeichen „In maintenance“ daneben: Wer darauf schaut, muss wissen, dass sie aus ist. |
| Die Verfügbarkeit des Standorts | Das Fenster wird sowohl aus der Ausfallzeit als auch aus dem gemessenen Zeitraum genommen. Zwei Stunden Wartung machen den Tag 22 Stunden lang, und nichts innerhalb dieser zwei Stunden zählt in die eine oder andere Richtung. |
| Die Integritätszusammenfassung seiner Vorfahren | Die Geräte des gewarteten Teilbaums stimmen nicht mehr ab, die Region wird also für einen Providerwechsel, der im Kalender stand, nicht rot. |
| Die Verfügbarkeit seiner Vorfahren | Unberührt, ohne dass etwas zu korrigieren ist, weil der geplante Ausfall ihre Zeitachsen nie erreicht hat. |

Die letzte Zeile ist der Grund, warum Vorfahren über das Zurückhalten von Stimmen behandelt werden statt über das Herausnehmen des Fensters aus ihrer Verfügbarkeit: Es aus dem Zeitraum der Region herauszunehmen, würde auch einen echten Ausfall anderswo in der Region während derselben Stunden löschen.

Die Verfügbarkeit wird mit dem angegebenen Beginn und Ende des Ereignisses korrigiert, nicht damit, wann ein Worker es zwischen Zuständen verschoben hat, die Zahl lässt sich also von Hand mit dem Kalender abgleichen. Ein Tag, der ganz in einem Fenster liegt, wird in den täglichen Balken als Wartung gezeichnet statt als perfekter Tag und trägt nichts zum Durchschnitt bei.

### Zusammenspiel mit Monitoren

Einen Monitor an dasselbe Ereignis zu hängen, tut weiterhin, was es immer tut: Die aktive Überwachung dieses Monitors pausiert für das Fenster. Die beiden sind unabhängig: Hängen Sie den Standort an, um ihn aus der Zusammenfassung und seiner Verfügbarkeit herauszuhalten, und die Monitore, damit sie nicht mehr warnen.

## Warnungen für einen Standort

Die Karte **Alarmierung** auf der **Einstellungen**-Seite eines Standorts hat **Bei fehlerhaftem Zustand warnen**: Eine Warnung öffnet sich, wenn die Zusammenfassung des Standorts in einen nicht betriebsbereiten Status wechselt, und löst sich selbst auf, wenn sich der Standort erholt. **Warnungsschweregrad** legt ihren Schweregrad fest; leer gelassen ist es der schwerste des Projekts.

Sie warnt nur bei der Änderung: Wenn Sie sie für einen Standort einschalten, der schon fehlerhaft ist, wird die nächste Änderung scharfgeschaltet, statt über die Vergangenheit zu warnen. Degraded ist nicht betriebsbereit, ein Standort mit der Anteilsrichtlinie warnt also, sobald eines seiner berichtenden Geräte ausgefallen ist, genau wie ein Standort mit der Richtlinie des schlechtesten Status; die Warnung bleibt offen, ohne eine zweite, während der Standort zwischen Degraded und Offline wechselt, und ihr Titel nennt den Status, den der Standort zuerst erreicht hat.

## Fehlerbehebung

:::details Eine Region ist immer rot
Der Standort nutzt die Richtlinie des schlechtesten Status, ein Offline-Gerät irgendwo darunter macht ihn also offline. Stellen Sie die Region in ihrer Karte **Integritätszusammenfassung** auf **Percentage of devices down** um, mit einem Schwellenwert, der dazu passt, wie viel der Region ausgefallen sein muss, bevor Sie sie ausgefallen nennen.
:::

:::details Ein Standort zeigt — statt einer Verfügbarkeit
Für den Standort lief nie eine Zusammenfassung, er hat also keine Zeilen in der Zeitachse: Er ist nicht überwacht, nicht perfekt. Fügen Sie dem Standort oder den Standorten darunter Geräte hinzu, und die nächste Zusammenfassung beginnt seine Zeitachse.
:::

:::details Ein Gerät zählt nicht für seinen Standort
Archivierte Geräte und Geräte, die noch nichts gemeldet haben, stimmen nie ab. Ein monitorgestütztes Gerät ohne gebundenen Monitor hat ebenfalls nie etwas gemeldet. Prüfen Sie den Status des Geräts: Ein Gerät mit **Ausstehend** stimmt nach seiner ersten Abfrage ab.
:::

:::details Die Warnung eines Standorts hat nicht ausgelöst
**Bei fehlerhaftem Zustand warnen** löst bei einem Wechsel von einem betriebsbereiten Status in einen anderen aus, ein Standort, der beim Einschalten schon fehlerhaft war, warnt also bei seiner nächsten Änderung, nachdem er sich erholt hat. Prüfen Sie auch, ob seine Geräte abstimmen: Archivierte Geräte und Geräte, die auf ihre erste Abfrage warten, tun es nie, und die Geräte eines Standorts in Wartung stimmen in den Zusammenfassungen darüber nicht ab.
:::

## Nächste Schritte

:::cards
- [Netzwerkgeräte-Überwachung](/docs/monitor/network-device-monitor): Die Geräte, die zu diesen Standorten gehören, hinzufügen, abfragen und dafür warnen.
- [Netzwerkverkehr](/docs/monitor/network-traffic): Den Verkehr eines Standorts aus den Flow-Datensätzen seiner Geräte sehen.
- [Inventar](/docs/inventory/overview): Netzwerkgeräte neben jedem anderen Asset, das Sie haben.
:::
