# Netzwerkverkehr (NetFlow, IPFIX und sFlow)

Router, Firewalls und Switches können den Verkehr, der durch sie fließt, als **Flow-Datensätze** beschreiben: wer mit wem gesprochen hat, über welches Protokoll und welche Ports, über welche Schnittstellen und mit wie vielen Bytes. Richten Sie diesen Export auf eine OneUptime-Sonde, und die **Datenverkehr**-Seiten zeigen, wohin Ihr Verkehr geht: die aktivsten Adressen, Verbindungen, Anwendungen und Schnittstellen, über jeden Zeitraum.

Eine Datenverkehr-Seite gibt es an drei Stellen:

- **Netzwerk** -> **Datenverkehr**: das ganze Netzwerk, die Flows aller Geräte auf einer Seite und jede Adresse, die Flows sendet, ohne schon ein Gerät zu sein.
- Die **Datenverkehr**-Seite eines Standorts: die Geräte an diesem Standort.
- Der **Datenverkehr**-Tab eines Geräts: dieses eine Gerät mit seinen Schnittstellen. Paketmitschnitte, die auf der Sonde des Geräts laufen, stehen unter den Flows, für den Fall, dass Sie die Pakete selbst brauchen.

## Was die Datenverkehr-Seite zeigt

- Vier Zahlen für den Zeitraum: **Datenverkehr** (Bytes), die **Durchschnitt**- und die **Spitze**-Rate sowie **Flows** (wie viele Flow-Datensätze die Geräte gesendet haben).
- **Datenverkehr im Zeitverlauf**, in Bits pro Sekunde. Ziehen Sie über das Diagramm, um in einen Abschnitt hineinzuzoomen; doppelklicken Sie darauf oder verwenden Sie **Zoom zurücksetzen**, um zurückzukehren.
- **Top-Quellen** und **Top-Ziele**: die zehn Adressen, die am meisten gesendet und empfangen haben.
- **Top-Anwendungen**: Verkehr nach Protokoll und Dienst-Port, benannt nach dem Dienst, der üblicherweise auf diesem Port läuft (HTTPS ist TCP-Port 443).
- **Top-Schnittstellen** auf der Seite eines Geräts: was über jede Schnittstelle herein- und hinausging, mit Name und Geschwindigkeit aus dem SNMP-Walk des Geräts. **Top-Geräte** auf der Seite eines Standorts und des Netzwerks.
- **Top-Verbindungen**: die zehn aktivsten Adresspaare, als Diagramm von den Sendern zu den Empfängern gezeichnet oder als Liste.

Klicken Sie auf eine Zeile - eine Adresse, eine Anwendung, eine Schnittstelle, ein Gerät, ein Band des Diagramms - und die ganze Seite beschränkt sich auf diesen Verkehr. Ein Chip über der Seite sagt, worauf sie beschränkt ist; ein Klick auf sein x hebt die Beschränkung wieder auf. **IP-Adresse suchen** beschränkt die Seite auf den Verkehr an oder von einer Adresse. Zeitraum und Filter stehen in der Adresse der Seite, ein Link öffnet also genau dieselbe Ansicht.

## Wie die Flows hierher kommen

Jede Sonde betreibt einen Flow-Collector. Er lauscht auf drei UDP-Ports, und jeder Port liest jedes Format:

| Port     | Üblicherweise genutzt für   |
| -------- | --------------------------- |
| UDP 2055 | NetFlow v5, NetFlow v9      |
| UDP 4739 | IPFIX                       |
| UDP 6343 | sFlow v5                    |

Die Sonde dekodiert die Datensätze, rechnet abgetastete Zahlen mit der Abtastrate wieder hoch, fasst die Datensätze einer Verbindung alle paar Sekunden zusammen und sendet sie an OneUptime. Jeder Datensatz wird einem Gerät anhand der Adresse zugeordnet, von der sein Gerät ihn sendet - bei sFlow die Agent-Adresse im Datagramm:

1. einem Gerät, das die Sonde abfragt und dessen Hostname diese Adresse ist (oder zu ihr auflöst) oder das sie auf seiner **Einstellungen**-Seite unter **Weitere Adressen** führt;
2. auf Ihrer eigenen (benutzerdefinierten) Sonde einem beliebigen Gerät des Projekts, das diese Adresse als Hostnamen oder unter seinen weiteren Adressen hat;
3. andernfalls werden die Flows auf Ihrer eigenen Sonde für die Datenverkehr-Seite des Netzwerks unter **Flow-Absender** aufbewahrt, bis Sie sagen, zu welchem Gerät sie gehören. Eine globale Sonde verwirft sie.

Flows werden 30 Tage lang aufbewahrt, und eine Seite zeigt höchstens 31 Tage.

## Einrichtung

1. **Verwenden Sie eine Sonde im Netzwerk des Geräts.** Flows sind UDP-Datagramme, die Ihre Geräte senden, sie brauchen also eine [benutzerdefinierte Sonde](/docs/probe/custom-probe), die sie erreichen können. Eine globale Sonde im öffentlichen Internet empfängt sie nicht.
2. **Lassen Sie die Datagramme zur Sonde durch.** Erlauben Sie UDP 2055, 4739 und 6343 von den Geräten zur Sonde. Eine Sonde in Docker, die mit Host-Netzwerk (`--network host`) gestartet wurde, wie es die Seite zur benutzerdefinierten Sonde zeigt, empfängt sie so, wie sie ist; ohne Host-Netzwerk veröffentlichen Sie die Ports mit `-p 2055:2055/udp -p 4739:4739/udp -p 6343:6343/udp`.
3. **Schalten Sie den Flow-Export auf dem Gerät ein** und senden Sie ihn an die IP-Adresse der Sonde. Die Befehle für gängige Geräte stehen unten. Der eigene **Datenverkehr**-Tab des Geräts zeigt dieselben Schritte mit den Ports der Sonde, bis der erste Flow ankommt.
4. **Prüfen Sie die Adresse des Geräts.** Datensätze werden anhand der Adresse zugeordnet, von der das Gerät sendet. Sendet es von einem Loopback oder einer Management-Schnittstelle, die nicht sein Hostname ist, fügen Sie diese Adresse den **Weiteren Adressen** des Geräts hinzu.

Der Collector ist standardmäßig eingeschaltet. Seine Einstellungen sind Umgebungsvariablen der Sonde:

| Variable                            | Was sie bewirkt                                                     | Standard |
| ----------------------------------- | ------------------------------------------------------------------- | ------- |
| PROBE_NETFLOW_RECEIVER_ENABLED      | Auf `false` setzen, um den Flow-Collector auszuschalten             | true    |
| PROBE_NETFLOW_RECEIVER_PORT         | Der NetFlow-Port; `0` beendet das Lauschen darauf                   | 2055    |
| PROBE_IPFIX_RECEIVER_PORT           | Der IPFIX-Port; `0` beendet das Lauschen darauf                     | 4739    |
| PROBE_SFLOW_RECEIVER_PORT           | Der sFlow-Port; `0` beendet das Lauschen darauf                     | 6343    |
| PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE | Angenommene Datagramme pro Minute, über alle Geräte und Ports       | 6000    |

### Cisco IOS XE (Flexible NetFlow)

Exportiert IPFIX an UDP 4739. Fügen Sie die letzte Zeile jeder Schnittstelle hinzu, deren Verkehr Sie sehen möchten: Wird der Verkehr beim Eingang an jeder Schnittstelle gemessen, zählt jede Verbindung genau einmal.

```text
flow exporter ONEUPTIME
 destination <probe-address>
 source Loopback0
 transport udp 4739
 export-protocol ipfix
 template data timeout 60
 option interface-table
 option sampler-table
!
flow monitor ONEUPTIME
 exporter ONEUPTIME
 cache timeout active 60
 record netflow ipv4 original-input
!
interface GigabitEthernet0/0/0
 ip flow monitor ONEUPTIME input
```

### Cisco IOS (NetFlow v9)

Exportiert NetFlow v9 an UDP 2055.

```text
ip flow-export version 9
ip flow-export destination <probe-address> 2055
ip flow-export source Loopback0
ip flow-export template timeout-rate 1
ip flow-cache timeout active 1
!
interface GigabitEthernet0/0
 ip flow ingress
```

### Arista EOS (sFlow)

Exportiert sFlow an UDP 6343. sFlow tastet ein Paket von N ab (hier 16384), und die Datenverkehr-Seiten rechnen die Stichproben wieder hoch, die Zahlen sind also Schätzungen.

```text
sflow sample 16384
sflow destination <probe-address> 6343
sflow source-interface Loopback0
sflow run
```

### Cisco Meraki MX und Z

MX-Appliances und Teleworker-Gateways der Z-Serie exportieren NetFlow v9 aus dem Meraki-Dashboard:

1. Öffnen Sie **Network-wide** > **General** und suchen Sie **Reporting**.
2. Stellen Sie **NetFlow traffic reporting** auf **Enabled: send NetFlow traffic statistics**.
3. Geben Sie die IP-Adresse der Sonde als **NetFlow collector IP** und `2055` als **NetFlow collector port** ein und speichern Sie.

Ein MX oder Z sieht nur den Verkehr, der durch ihn hindurchgeht. Verkehr, den ein Switch innerhalb eines VLAN hält, erreicht ihn nie und ist daher nicht im Export.

### Juniper (Inline-J-Flow)

Exportiert IPFIX an UDP 4739 von MX-Routern; verwenden Sie die FPC, die die abgetasteten Schnittstellen trägt.

```text
set services flow-monitoring version-ipfix template ONEUPTIME ipv4-template
set services flow-monitoring version-ipfix template ONEUPTIME flow-active-timeout 60
set services flow-monitoring version-ipfix template ONEUPTIME template-refresh-rate seconds 60
set chassis fpc 0 sampling-instance ONEUPTIME
set forwarding-options sampling instance ONEUPTIME input rate 1
set forwarding-options sampling instance ONEUPTIME family inet output flow-server <probe-address> port 4739
set forwarding-options sampling instance ONEUPTIME family inet output flow-server <probe-address> version-ipfix template ONEUPTIME
set forwarding-options sampling instance ONEUPTIME family inet output inline-jflow source-address <device-address>
set interfaces ge-0/0/0 unit 0 family inet sampling input
```

### Fortinet FortiGate

Exportiert NetFlow v9 an UDP 2055. Ab FortiOS 7.2 ist der Collector ein Eintrag unter `config collectors` innerhalb von `config system netflow`.

```text
config system netflow
    set collector-ip <probe-address>
    set collector-port 2055
    set template-tx-timeout 60
end
config system interface
    edit "port1"
        set netflow-sampler both
    next
end
```

### Palo Alto Networks

1. Fügen Sie unter **Device** > **Server Profiles** > **NetFlow** ein Profil mit der IP-Adresse der Sonde und Port `2055` hinzu und setzen Sie das **Active Timeout** auf 1 Minute.
2. Öffnen Sie unter **Network** > **Interfaces** jede Schnittstelle, deren Verkehr Sie sehen möchten, und wählen Sie das Profil auf dem Tab **Advanced** als **NetFlow Profile**.
3. Führen Sie einen Commit aus.

### MikroTik RouterOS 7

```text
/ip traffic-flow set enabled=yes interfaces=all active-flow-timeout=1m
/ip traffic-flow target add dst-address=<probe-address> port=2055 version=9
```

### pfSense und Linux-Hosts

Installieren Sie auf pfSense das Paket **softflowd**, wählen Sie unter **Services** > **softflowd** die Schnittstellen, geben Sie die IP-Adresse der Sonde und Port `2055` ein und wählen Sie NetFlow-Version 9. Auf einem Linux-Host führen Sie softflowd auf der Schnittstelle aus, deren Verkehr Sie sehen möchten:

```bash
softflowd -i eth0 -n <probe-address>:2055 -v 9 -t maxlife=60
```

### Andere Geräte

Senden Sie NetFlow v5, NetFlow v9 oder IPFIX an die IP-Adresse der Sonde auf UDP 2055 (oder 4739) oder sFlow v5 auf UDP 6343. Stellen Sie das aktive Flow-Timeout des Geräts auf 60 Sekunden und senden Sie bei NetFlow v9 und IPFIX seine Templates alle 60 Sekunden. Die [Leitfäden für Netzwerkhersteller](/docs/monitor/network-vendor-guides) behandeln Sophos und Extreme Networks.

## Adressen, die noch keine Geräte sind

Flows können ankommen, bevor das Gerät, das sie sendet, in OneUptime hinzugefügt ist. Auf Ihrer eigenen Sonde werden sie aufbewahrt, und die Datenverkehr-Seite des Netzwerks führt ihre Adresse unter **Flow-Absender**, markiert als **Noch kein Gerät**:

- **Als Gerät hinzufügen** öffnet „Gerät hinzufügen“ mit bereits eingetragener Adresse und Sonde. Die bereits angekommenen Flows bleiben auf der Seite des Netzwerks; neue gehen an das Gerät.
- **Es ist eines meiner Geräte** fügt die Adresse den **Weiteren Adressen** eines Geräts hinzu: Verwenden Sie es, wenn ein bereits hinzugefügtes Gerät von einer anderen Adresse sendet, etwa einem Loopback. Seine Flows gehen ab der nächsten Minute an dieses Gerät.

Mehrere Geräte hinter einer NAT-Adresse teilen sich diese Adresse, ihre Flows gehen also an das eine Gerät, das sie hat.

## Die Zahlen lesen

- **Abtastung.** Ein Gerät, das abtastet - sFlow tut es immer, NetFlow oder IPFIX können es -, meldet ein Paket von N. Die Sonde multipliziert die Zahlen mit N, die Seite zeigt also Schätzungen und sagt das unter den vier Zahlen. Sie sind genau bei viel Verkehr und grob bei wenigen Paketen.
- **Doppelt gezählt.** Verkehr, der durch zwei exportierende Geräte fließt, wird von beiden gemeldet. Die Seite eines Geräts zählt ihn einmal; die Seite eines Standorts oder des Netzwerks zählt ihn einmal pro Gerät, das ihn gemeldet hat.
- **Anwendungen.** Eine Anwendung ist das Protokoll und der Dienst-Port, benannt nach dem Dienst, der üblicherweise auf diesem Port läuft. Das ist keine Deep Packet Inspection: HTTPS auf Port 9443 erscheint als TCP-Port 9443. Der kurzlebige Port des Clients wird weggelassen, tausend Browserverbindungen zu einem Server sind also eine Anwendung.
- **Spitze** ist die Rate des aktivsten Abschnitts des Diagramms, ein kürzerer Zeitraum mit kürzeren Abschnitten zeigt also eine schärfere Spitze. **Durchschnitt** sind die Bytes über den gesamten Zeitraum.
- **Zeit.** Ein Flow zählt in dem Abschnitt, in dem er begonnen hat. Ein langer Download wird als mehrere Flows gemeldet, einer für jede Minute, die er läuft, deshalb sollte das aktive Timeout der Geräte 60 Sekunden betragen.

## Was nicht enthalten ist

- **Alarme auf Flows.** Es gibt noch keinen Flow-basierten Monitor. Um bei einer ausgelasteten Leitung zu alarmieren, verwenden Sie die Alarme zur Schnittstellenauslastung des [Netzwerkgeräte-Monitors](/docs/monitor/network-device-monitor), die SNMP lesen.
- **Anwendungsnamen über den Port hinaus.** Es gibt keine Deep Packet Inspection, und Cisco-NBAR-Anwendungsnamen werden nicht gelesen.
- **Die Meraki Dashboard API.** Meraki-Verkehrsanalysen werden nicht importiert; MX- und Z-Appliances senden stattdessen NetFlow an die Sonde.
- **Anomalieerkennung** im Verkehr.
- **Schnittstellennamen aus Flow-Datensätzen.** Schnittstellennamen und -geschwindigkeiten stammen aus dem SNMP-Walk des Geräts; ein Gerät ohne Walk zeigt Schnittstellennummern.

## Fehlerbehebung

Wenn die Datenverkehr-Seite noch ihre Einrichtungsschritte zeigt:

- **Empfängt die Sonde überhaupt etwas?** Die Datenverkehr-Seite des Netzwerks führt jede Adresse, die in der letzten Stunde Flows gesendet hat, unter **Flow-Absender**. Steht das Gerät dort als **Noch kein Gerät**, sendet es von einer Adresse, die nicht sein Hostname ist: Fügen Sie diese Adresse seinen **Weiteren Adressen** hinzu.
- **Firewalls und Docker.** Erlauben Sie UDP 2055, 4739 und 6343 vom Gerät zur Sonde, und veröffentlichen Sie die Ports, wenn die Sonde in Docker läuft.
- **Das Protokoll der Sonde.** Einmal pro Minute protokolliert die Sonde, was sie nicht lesen konnte: Datagramme in einem nicht unterstützten Format (NetFlow v1, v6, v7 oder v8 oder sFlow vor Version 5), fehlerhafte Datagramme, Daten, die auf ein Template warten, und Datagramme, die über `PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE` hinaus verworfen wurden.
- **Templates.** NetFlow v9 und IPFIX senden den Aufbau ihrer Datensätze als Templates. Die Sonde hält Daten, die vor ihrem Template ankommen, bis zu 10 Minuten zurück; lassen Sie das Gerät seine Templates alle 60 Sekunden senden, damit sich die Seite innerhalb einer Minute füllt.
- **Eine globale Sonde.** Ein Gerät, das von einer globalen Sonde abgefragt wird, kann ihr aus einem privaten Netzwerk keine Flows senden. Betreiben Sie eine benutzerdefinierte Sonde im Netzwerk des Geräts und wählen Sie sie in den Einstellungen des Geräts.
