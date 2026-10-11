# Protokoll-Pipelines

Protokoll-Pipelines verändern Protokolle, während OneUptime sie aufnimmt, noch bevor sie gespeichert werden. Eine Pipeline hat einen **Filter**, der entscheidet, für welche Protokolle sie gilt, und eine geordnete Liste von **Prozessoren**, die diese Protokolle jeweils verändern: Felder aus der Nachricht ziehen, den Schweregrad korrigieren, ein Attribut umbenennen oder das Protokoll mit einer Kategorie versehen.

Pipelines finden Sie unter **Protokolle → Einstellungen → Pipelines**.

:::cards
- [So läuft eine Pipeline](#so-läuft-eine-pipeline): Wo Pipelines bei der Aufnahme sitzen und in welcher Reihenfolge sie laufen.
- [Eine Pipeline erstellen](#eine-pipeline-erstellen): Einige Protokolle auswählen und ihnen Prozessoren hinzufügen.
- [Key=Value Parser](#keyvalue-parser): Firewall- und logfmt-Zeilen in Attribute verwandeln.
- [Beispiel: Sophos-XGS-Firewall](#beispiel-sophos-xgs-firewall): Firewall-Syslog von Anfang bis Ende parsen.
:::

## So läuft eine Pipeline

Pipelines laufen bei jedem Protokoll, das OneUptime aufnimmt – ob OpenTelemetry-Protokolle, Syslog oder Fluentd –, nach den Drop-Filtern und Scrub-Regeln und bevor das Protokoll gespeichert wird:

```mermaid title="Wo Pipelines laufen, während ein Protokoll aufgenommen wird"
flowchart TB
    arrive["Protokoll trifft ein"] --> drop{"Trifft ein Drop-Filter zu?"}
    drop -->|"ja"| discarded["Verworfen"]
    drop -->|"nein"| scrub["Scrub-Regeln maskieren Daten"]
    scrub --> filter{"Trifft der Filter der<br/>nächsten Pipeline zu?"}
    filter -->|"ja"| processors["Ihre Prozessoren der Reihe nach ausführen"]
    filter -->|"nein"| more{"Weitere Pipelines?"}
    processors --> more
    more -->|"ja"| filter
    more -->|"nein"| stored["Protokoll wird gespeichert"]
```

- **Pipelines laufen der Reihe nach** – in der Reihenfolge der Liste, die Sie durch Ziehen der Zeilen ändern. Eine Pipeline berührt nur die Protokolle, auf die ihr Filter zutrifft, und jede Pipeline mit zutreffendem Filter läuft, nicht nur die erste.
- **Auch Prozessoren laufen der Reihe nach**, und jeder sieht, was der vorige erzeugt hat; ein Parser muss also vor einem Prozessor stehen, der die von ihm extrahierten Felder liest. Auch der Filter einer späteren Pipeline sieht, was frühere Pipelines geändert haben.
- **Die Verarbeitung geschieht bei der Aufnahme.** Eine Änderung an einer Pipeline wirkt auf Protokolle, die danach eintreffen, innerhalb etwa einer Minute; bereits gespeicherte Protokolle werden nicht erneut verarbeitet.
- **Ein Prozessor verwirft oder leert nie ein Protokoll.** Eine Zeile, die ein Parser nicht lesen kann, läuft unverändert durch. Um Protokolle zu verwerfen, verwenden Sie **Protokolle → Einstellungen → Drop-Filter**.
- **Nur aktivierte Pipelines und Prozessoren laufen.** Schalten Sie einen auf seiner Seite aus, um ihn zu pausieren, ohne seine Einrichtung zu verlieren.

## Prozessortypen

| Prozessor | Was er tut |
| --- | --- |
| Grok-Parser | Zieht Felder aus einer Zeile mit festem Aufbau (einer nginx-Zugriffszeile) mithilfe eines benannten Musters. |
| Key=Value Parser | Zerlegt eine Zeile aus `key=value`-Paaren (Sophos XGS, Fortinet, logfmt) in Attribute, in beliebiger Reihenfolge. |
| Schweregrad-Remapper | Bildet eine Rohstufe wie `warn` aus einem Attribut auf den Standard-Schweregrad des Protokolls ab. |
| Attribut-Neuzuordnung | Benennt ein Attribut um oder kopiert es, zum Beispiel `src_ip` nach `source_ip`. |
| Kategorie-Prozessor | Versieht ein Protokoll mit einem Kategorienamen, wenn es auf einen Filter zutrifft, zum Beispiel „Payment Error“. |

## Bevor Sie beginnen

- Protokolle, die in OneUptime ankommen – über [OpenTelemetry](/docs/telemetry/open-telemetry), [Syslog](/docs/telemetry/syslog), [Fluentd](/docs/telemetry/fluentd) oder eine Probe.
- Die Berechtigung, Pipelines zu ändern. Projektinhaber und Admins haben sie; alle anderen brauchen die Berechtigungen **Create Log Pipeline** und **Create Log Pipeline Processor**.

## Eine Pipeline erstellen

:::steps
### Die Pipeline anlegen

Gehen Sie zu **Protokolle → Einstellungen → Pipelines** und klicken Sie auf **Protokoll-Pipeline erstellen**. Geben Sie ihr einen **Name**, etwa *Firewall-Protokolle parsen*, und erstellen Sie sie. Die Seite der Pipeline öffnet sich.

### Festlegen, für welche Protokolle sie gilt

Klicken Sie unter **Filterbedingungen** auf **Bearbeiten** und fügen Sie Bedingungen zu **Schweregrad**, **Protokolltext**, **Dienst-ID** oder einem eigenen Attribut hinzu. Verknüpfen Sie sie mit **Alle Bedingungen** oder **Eine beliebige Bedingung** und klicken Sie dann auf **Änderungen speichern**. Eine Pipeline ohne Bedingungen gilt für jedes Protokoll.

### Prozessoren hinzufügen

Klicken Sie unter **Prozessoren** auf **Prozessor hinzufügen**, geben Sie einen **Prozessorname** ein, wählen Sie einen **Prozessortyp** und füllen Sie seine Einstellungen aus. Der Grok- und der Key=Value-Parser haben einen Tester: Fügen Sie eine Beispielzeile ein, um zu sehen, was sie extrahieren würden. Klicken Sie auf **Prozessor erstellen**.

### In die richtige Reihenfolge bringen

Ziehen Sie Prozessoren, um ihre Ausführungsreihenfolge zu ändern, und ziehen Sie Pipelines in der Liste **Pipelines** auf dieselbe Weise. Neue Protokolle werden innerhalb etwa einer Minute verarbeitet.
:::

### Filterbedingungen

Jede Bedingung vergleicht ein Feld mit einem Wert. Hinter dem Baukasten ist der Filter eine Abfrage wie `severityText = 'Error' AND body LIKE 'timeout'`, die **Abfragevorschau** zeigt.

| Operator | In der Abfrage | Hinweise |
| --- | --- | --- |
| entspricht | `=` | Exakt und mit Groß- und Kleinschreibung. |
| ist nicht gleich | `!=` | Exakt und mit Groß- und Kleinschreibung. |
| enthält | `LIKE` | Ignoriert die Groß- und Kleinschreibung. `%` im Wert ist ein Platzhalter. |
| ist eines von | `IN` | Eine kommagetrennte Liste exakter Werte. |

Die Schweregrade lauten `Fatal`, `Error`, `Warning`, `Information`, `Debug`, `Trace` und `Unspecified` – `severityText = 'Error'` trifft also zu, `'ERROR'` dagegen nie. Ein eigenes Attribut schreiben Sie als `attributes.<key>`, zum Beispiel `attributes.networkDevice.name = 'hq-firewall'`.

## Key=Value Parser

Firewalls und andere Netzwerkgeräte protokollieren jedes Ereignis als eine Zeile aus `key=value`-Paaren. Welche Felder eine Zeile hat und in welcher Reihenfolge, hängt vom Ereignis ab, daher kann kein einzelnes Grok-Muster sie beschreiben. Der Key=Value Parser braucht keines: Er geht die Zeile durch und macht aus jedem gefundenen Paar ein Protokollattribut, unabhängig von der Reihenfolge. Als Attribute können Sie danach suchen und filtern, sie in einem [Logs-Monitor](/docs/monitor/logs-monitor) verwenden und mit [Gruppieren nach](/docs/monitor/logs-monitor) einmal pro Tunnel, Schnittstelle oder Benutzer warnen.

### Konfiguration

| Einstellung | Standard | Beschreibung |
| --- | --- | --- |
| Quellfeld | `body` | Das zu parsende Feld: `body` für die Protokollnachricht oder ein Attribut wie `attributes.raw_line`. |
| Zielpräfix | keiner | Ein Namensraum für die extrahierten Schlüssel. `sophos` speichert `con_name` als `sophos.con_name`. Ein Trennzeichen wird ergänzt, außer das Präfix endet bereits auf `.`, `_`, `-` oder `:`. |
| Pair Delimiter | beliebiger Leerraum | Was ein Paar vom nächsten trennt. Lassen Sie es für Sophos, Fortinet und logfmt leer; setzen Sie `,`, `;` oder `\|` für andere Formate. |
| Key-Value Delimiter | `=` | Was einen Schlüssel von seinem Wert trennt, zum Beispiel `:` für `status:up`. |
| Bei Konflikt überschreiben | aus | Ob ein Schlüssel ein Attribut ersetzen darf, das das Protokoll schon hat. Standardmäßig aus: Die Schlüssel stammen aus der Zeile selbst, sonst könnte eine Zeile bei der Aufnahme gesetzte Attribute überschreiben, etwa das Gerät, von dem sie kam. |

Die beiden Trennzeichen müssen verschieden sein, dürfen einander nicht enthalten und keine Anführungszeichen oder Backslashes enthalten; jedes ist höchstens 8 Zeichen lang. Das Prozessorformular prüft das vor dem Speichern, und sein Tester, **Test With a Sample Line**, zeigt genau die Attribute, die eine Beispielzeile ergeben würde.

### Parsing-Regeln

- **Werte in Anführungszeichen** behalten ihre Leerzeichen und Trennzeichen: `message="IPSec Connection HQ-Branch1 terminated"` ist ein Wert. Doppelte und einfache Anführungszeichen funktionieren beide, und `\"` in einem Wert ist ein wörtliches Anführungszeichen. Ein nie geschlossenes Anführungszeichen – eine Zeile, die an einer Syslog-Größengrenze abgeschnitten wurde – reicht bis zum Zeilenende.
- **Werte ohne Anführungszeichen** reichen bis zum nächsten Paartrennzeichen, `url=https://example.com/?a=b` behält also sein `=`.
- **Leere Werte** (`key=` und `key=""`) werden als leere Zeichenketten gespeichert.
- **Werte sind immer Text.** `latency=11` wird als `"11"` gespeichert, genau wie ein Grok-Treffer ohne Typ.
- **Schlüssel** beginnen mit einem Buchstaben oder Unterstrich und enthalten Buchstaben, Ziffern und `. _ - @`. Text vor dem ersten Paar, etwa ein Syslog-Header nach RFC 3164, und einzelne Wörter ohne Trennzeichen werden übersprungen. Eine Syslog-Priorität, die am ersten Schlüssel klebt (`<30>device_name="SFW"`), wird entfernt und der Schlüssel behalten.
- **Ein wiederholter Schlüssel behält seinen ersten Wert**; spätere werden ignoriert.
- **Grenzen:** Eine Zeile über 32 KiB wird nicht geparst, aus einer Zeile werden höchstens 100 Paare übernommen, Schlüssel über 256 Zeichen werden übersprungen und Werte über 4.096 Zeichen gekürzt.

### Beispiel: Sophos-XGS-Firewall

Wenn eine Sophos-XGS-Firewall Syslog an eine [Probe](/docs/monitor/network-device-monitor) sendet, wird jede Meldung als Protokoll des Netzwerkgeräts gespeichert, mit der Syslog-Meldung als Text. So parsen Sie sie:

:::steps
#### Eine Pipeline für die Firewall erstellen

Gehen Sie zu **Protokolle → Einstellungen → Pipelines** und erstellen Sie eine Pipeline. Geben Sie ihr einen Filter, der auf die Protokolle der Firewall zutrifft, zum Beispiel das eigene Attribut `networkDevice.name` entspricht `hq-firewall` (`attributes.networkDevice.name = 'hq-firewall'`), oder **Protokolltext** enthält `log_component=`, um jede Sophos-Zeile zu treffen.

#### Den Parser hinzufügen

Öffnen Sie die Pipeline und klicken Sie auf **Prozessor hinzufügen**. Wählen Sie **Key=Value Parser**, lassen Sie **Quellfeld** auf `body` und setzen Sie **Zielpräfix** auf `sophos` (optional, hält aber die Felder der Firewall zusammen).

#### Testen und speichern

Fügen Sie eine Zeile der Firewall in **Test With a Sample Line** ein, um das Ergebnis zu prüfen, und klicken Sie dann auf **Prozessor erstellen**.
:::

Ein Sophos-IPsec-Ereignis:

```text
device_name="SFW" timestamp="2024-05-02T11:03:12+0200" device_model="XGS2100" device_serial_id="X1234" log_id="010101600001" log_type="Event" log_component="IPSec" log_subtype="System" severity="Information" con_name="HQ-Branch1" src_ip="10.171.4.117" dst_ip="10.171.4.118" status="Terminated" message="IPSec Connection HQ-Branch1 between 10.171.4.117 and 10.171.4.118 for Child HQ-Branch1 terminated."
```

wird zu diesen Attributen (unter anderem):

| Attribut | Wert |
| --- | --- |
| `sophos.log_component` | `IPSec` |
| `sophos.con_name` | `HQ-Branch1` |
| `sophos.status` | `Terminated` |
| `sophos.src_ip` | `10.171.4.117` |
| `sophos.message` | `IPSec Connection HQ-Branch1 between 10.171.4.117 and 10.171.4.118 for Child HQ-Branch1 terminated.` |

Eine SD-WAN-SLA-Zeile hat andere Felder in anderer Reihenfolge, und derselbe Prozessor verarbeitet sie:

```text
log_id=158825619025 log_type="SD-WAN" log_component="SLA" profile_name="Branch-Internet" gw_name="WAN2" latency=11 jitter=2 packet_loss=0 gw_status="up" sla_status="SLA met"
```

ergibt `sophos.gw_name = WAN2`, `sophos.latency = 11`, `sophos.packet_loss = 0`, `sophos.gw_status = up` und `sophos.sla_status = SLA met`. Ältere SFOS-Versionen protokollieren ein Altformat (`device="SFW" date=2017-01-31 time=18:02:03 timezone="IST" ... connectionname="Tunnel A"`); es wird genauso geparst, mit dem Tunnelnamen in `connectionname` statt in `con_name`.

Wie Sie aus diesen SLA-Zeilen Metriken für Latenz, Jitter und Paketverlust pro Gateway machen, zeigt das Beispiel unter [Aufzeichnungsregeln für Protokolle](/docs/telemetry/log-recording-rules).

### Beispiel: Fortinet FortiGate

FortiGate-Protokolle folgen demselben Stil:

```text
date=2024-01-01 time=10:00:00 devname="FG100" logid="0100032001" type="event" subtype="vpn" level="notice" action="tunnel-down" vpntunnel="HQ-to-Branch2" msg="IPsec tunnel down"
```

Mit den Standardeinstellungen und dem Präfix `fortigate` ergibt das `fortigate.devname = FG100`, `fortigate.subtype = vpn`, `fortigate.action = tunnel-down`, `fortigate.vpntunnel = HQ-to-Branch2` und `fortigate.time = 10:00:00` – die Doppelpunkte in einer Uhrzeit gehören zum Wert, sie sind kein Trennzeichen.

### Einmal pro Tunnel warnen

Mit den geparsten Feldern kann ein [Logs-Monitor](/docs/monitor/logs-monitor) die Ausfälle zählen und für jeden Tunnel eine eigene Warnung auslösen: Filtern Sie auf `sophos.log_component` = `IPSec` mit einem Text, der `terminated` enthält, und gruppieren Sie nach `sophos.con_name`. Siehe [Warnungen pro Gruppe](/docs/monitor/logs-monitor).

## Grok-Parser

Zieht strukturierte Felder aus einer Zeile mit festem Aufbau. Ein Grok-Muster ist ein regulärer Ausdruck mit benannten Verweisen: `%{IPV4:client_ip}` bedeutet „eine IPv4-Adresse treffen und als `client_ip` speichern“. Das Muster muss nicht die ganze Zeile treffen, und eine Zeile, auf die es nicht zutrifft, bleibt unverändert.

| Einstellung | Standard | Beschreibung |
| --- | --- | --- |
| **Quellfeld** | `body` | Das zu parsende Feld, wie beim Key=Value Parser. |
| **Zielpräfix** | keiner | Ein Namensraum für die extrahierten Felder, auf dieselbe Weise ergänzt. |
| **Grok-Muster** | — | Das Muster. Das Formular listet die verfügbaren benannten Muster. |

Ein Treffer wird als Text gespeichert, sofern Sie ihm keinen Typ geben: `%{NUMBER:status:int}` speichert ihn als Zahl. Die Typen sind `int`, `long`, `float`, `double`, `boolean` und `string`. Prüfen Sie ein Muster vor dem Speichern in **Ihr Muster testen** an einer Beispielzeile.

| Protokolltext | Muster | Hinzugefügte Attribute |
| --- | --- | --- |
| `10.0.1.5 - GET /health 200` | `%{IPV4:client_ip} - %{WORD:method} %{NOTSPACE:path} %{NUMBER:status:int}` | client_ip, method, path, status |

Verwenden Sie stattdessen den Key=Value Parser, wenn die Zeile aus `key=value`-Paaren in wechselnder Reihenfolge besteht.

## Schweregrad-Remapper

Liest einen Rohwert aus einem Attribut und bildet ihn auf einen Standard-Schweregrad ab. Setzen Sie **Quellattribut** auf das Attribut, das die Stufe enthält (standardmäßig `level`), und fügen Sie dann **Zuordnungen** hinzu: Jede verbindet einen Wert, den Ihre Anwendung ausgibt, etwa `warn`, mit einem Schweregrad, etwa Warning. Der Abgleich ignoriert die Groß- und Kleinschreibung. Ein Wert ohne Zuordnung lässt den Schweregrad des Protokolls unverändert.

## Attribut-Neuzuordnung

Verschiebt den Wert eines Attributs (**Quellschlüssel**) in ein anderes (**Zielschlüssel**), zum Beispiel `src_ip` nach `source_ip`.

| Einstellung | Standard | Wirkung |
| --- | --- | --- |
| **Quelle beibehalten** | aus | Aus benennt das Attribut um: Der Quellschlüssel wird entfernt. An kopiert es und behält den Quellschlüssel. |
| **Bei Konflikt überschreiben** | an | An ersetzt das Ziel, wenn es bereits existiert. Aus lässt das Ziel unverändert und überspringt die Neuzuordnung. |

## Kategorie-Prozessor

Wertet eine Liste von Regeln der Reihe nach aus und speichert den Namen der ersten Regel, deren Filter zutrifft, in einem Zielattribut, sodass Sie alle „Payment Error“-Protokolle auf einmal finden. Setzen Sie **Zielattribut** (standardmäßig `category`) und fügen Sie dann **Kategorieregeln** hinzu: einen **Kategoriename** und die Bedingungen unter **Wenn Protokolle übereinstimmen**. Die erste zutreffende Regel gewinnt; ein Protokoll, auf das keine zutrifft, bleibt unverändert.

## Nächste Schritte

:::cards
- [Logs-Überwachung](/docs/monitor/logs-monitor): Bei den Attributen warnen, die Ihre Pipelines extrahieren.
- [Aufzeichnungsregeln für Protokolle](/docs/telemetry/log-recording-rules): Geparste Protokollfelder in Metriken verwandeln.
- [Syslog](/docs/telemetry/syslog): Firewall- und Server-Syslog an OneUptime senden.
- [Suchsyntax](/docs/telemetry/search-syntax): Im Protokoll-Explorer nach den neuen Attributen suchen.
:::
