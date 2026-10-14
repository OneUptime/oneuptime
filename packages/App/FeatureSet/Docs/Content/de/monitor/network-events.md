# Netzwerkereignisse (Syslog und SNMP-Traps)

Router, Firewalls, Switches und Access Points sagen in ihrem Syslog, was mit ihnen geschieht: eine Verbindung ist ausgefallen, ein Tunnel abgebrochen, eine Firewall hat umgeschaltet, jemand hat sich angemeldet. Jeder Hersteller formuliert das auf seine Weise. Richten Sie ihr Syslog auf eine OneUptime-Sonde, und die Seiten **Ereignisse** zeigen in denselben Worten, was passiert ist, egal von welchem Hersteller das Gerät stammt, und warnen Sie, wenn es wieder passiert.

Eine Ereignisseite gibt es an zwei Stellen:

- **Netzwerk** -> **Ereignisse**: das ganze Netzwerk, die Ereignisse aller Geräte auf einer Seite und jede Adresse, die Syslog sendet, ohne schon ein Gerät zu sein.
- Der Tab **Ereignisse** eines Geräts: was dieses eine Gerät gemeldet hat.

## Was die Ereignisseite zeigt

- Die Ereignisse des Zeitraums, das Neueste zuerst. Jede Zeile sagt, was passiert ist, auf welchem Gerät, womit - der Schnittstelle, dem Tunnel, dem Gateway - und in den eigenen Worten des Geräts.
- **Probleme**, **Wiederherstellungen** und **Hinweise**, jeweils mit der Anzahl im Zeitraum. Klicken Sie auf eines, um nur diese zu sehen.
- Die Auswahl **Alle Ereignisse** und, auf der Seite des Netzwerks, die Auswahl **Alle Geräte** grenzen die Liste weiter ein. Zeitraum und Filter stehen in der Adresse der Seite, ein Link öffnet also genau dieselbe Ansicht.
- Klicken Sie auf ein Ereignis, um es zu öffnen: wann es passiert ist, worum es geht, die Nachricht, wie das Gerät sie gesendet hat, und jedes Attribut, das OneUptime daraus gelesen hat.
- **Warnung erstellen** bietet die Warnungen an, die die meisten Netzwerke brauchen, und **Warnung für dieses Ereignis erstellen** legt eine für das geöffnete Ereignis an. Siehe [Warnungen](#warnungen).

Ein Ereignis ist ein Log. Alles auf der Ereignisseite lässt sich auch unter **Protokolle** durchsuchen, als Diagramm darstellen und mit Warnungen versehen: Ein Ereignis ist ein Log, dessen Attribut `event.domain` den Wert `network` hat, und was passiert ist, steht in `event.name`.

## Was OneUptime liest

Syslog in der Form von RFC 3164 und RFC 5424 und das Common Event Format (CEF) werden von jedem Produkt gelesen. Darüber hinaus weiß OneUptime, was diese Produkte schreiben:

| Hersteller | Produkte | Gelesene Ereignisse | Attribute |
| --- | --- | --- | --- |
| Cisco | IOS, IOS XE, NX-OS, ASA | Schnittstellen, Geräte, Hochverfügbarkeit, VPN, Routing, Hardware, Switching, Anmeldungen | `cisco.*` |
| Sophos | Sophos Firewall (SFOS, XG, XGS) | Schnittstellen, Geräte, Hochverfügbarkeit, VPN, WAN, Anmeldungen | `sophos.*` |
| Fortinet | FortiGate (FortiOS) | Schnittstellen, Geräte, Hochverfügbarkeit, VPN, WAN, Hardware, Anmeldungen | `fortigate.*` |
| Extreme Networks | ExtremeXOS, Switch Engine | Schnittstellen, Geräte, Hochverfügbarkeit, Routing, Hardware, Switching, Anmeldungen | `extreme.*` |
| Extreme Networks | Fabric Engine, VOSS | Schnittstellen, Routing | `extreme.*` |
| HPE Aruba Networking | AOS-CX | Schnittstellen, Hardware | `aruba.*` |
| HPE Aruba Networking | AOS-Switch (ArubaOS-Switch, ProCurve) | Schnittstellen | `aruba.*` |
| MikroTik | RouterOS | Schnittstellen, Geräte, Anmeldungen | `mikrotik.*` |
| Cambium Networks | Enterprise Wi-Fi (cnPilot, XV, XE, XH) | Geräte, VPN, WLAN | `cambium.*` |
| Ubiquiti | UniFi Network | Geräte, WAN, Switching, Anmeldungen, WLAN | `cef.*` |
| Alle | Linux-basierte Geräte (Kernel, hostapd, OpenSSH, Dropbear) | Schnittstellen, Anmeldungen, WLAN | - |

Bei einer Nachricht in einem dieser Formate werden ihre eigenen Felder als Attribute unter dem Präfix der letzten Spalte gespeichert: `con_name="HQ-Branch1"` einer Sophos-Firewall ist also das Attribut `sophos.con_name`. Bei einer CEF-Nachricht eines anderen Produkts werden Header und Erweiterungsfelder unter `cef.*` gespeichert. Eine Nachricht, die OneUptime nicht einordnen kann, wird trotzdem als Log gespeichert, mit gelesenem Syslog-Header; ihre Ereignisse können Sie selbst benennen, siehe [Eigene Ereignisse](#eigene-ereignisse).

Die Standard-SNMP-Traps werden zu denselben Ereignissen: `linkDown` und `linkUp` werden zu **Schnittstelle ausgefallen** und **Schnittstelle aktiv**, `coldStart` und `warmStart` zu **Gerät neu gestartet**.

## Die Ereignisse

Jede Nachricht, die OneUptime erkennt, wird mit einem dieser Namen in `event.name` gespeichert, egal von welchem Hersteller das Gerät stammt:

| Ereignis | `event.name` | Art | Worum es geht |
| --- | --- | --- | --- |
| Schnittstelle ausgefallen | `interface.down` | Problem | `network.interface.name` |
| Schnittstelle aktiv | `interface.up` | Wiederherstellung | `network.interface.name` |
| Port vom Switch abgeschaltet | `interface.error_disabled` | Problem | `network.interface.name` |
| Gerät neu gestartet | `device.reboot` | Problem | - |
| Konfiguration geändert | `device.config_change` | Hinweise | `user.name` |
| Gerät offline | `device.offline` | Problem | - |
| Gerät online | `device.online` | Wiederherstellung | - |
| Failover | `ha.failover` | Problem | `ha.role` |
| Hochverfügbarkeitsstatus geändert | `ha.state_change` | Hinweise | `ha.role` |
| Hochverfügbarkeitspartner ausgefallen | `ha.peer_down` | Problem | `ha.peer` |
| Hochverfügbarkeitspartner verfügbar | `ha.peer_up` | Wiederherstellung | `ha.peer` |
| VPN-Tunnel ausgefallen | `vpn.tunnel_down` | Problem | `vpn.tunnel.name` |
| VPN-Tunnel aufgebaut | `vpn.tunnel_up` | Wiederherstellung | `vpn.tunnel.name` |
| Routing-Nachbar ausgefallen | `routing.neighbor_down` | Problem | `network.peer.address` |
| Routing-Nachbar verfügbar | `routing.neighbor_up` | Wiederherstellung | `network.peer.address` |
| Gateway ausgefallen | `gateway.down` | Problem | `network.gateway.name` |
| Gateway verfügbar | `gateway.up` | Wiederherstellung | `network.gateway.name` |
| WAN-Failover | `wan.failover` | Problem | `network.gateway.name` |
| SD-WAN-Verbindung unter ihrem SLA | `sdwan.sla_not_met` | Problem | `network.gateway.name` |
| SD-WAN-Verbindung wieder innerhalb ihres SLA | `sdwan.sla_met` | Wiederherstellung | `network.gateway.name` |
| Lüfter ausgefallen | `hardware.fan_failed` | Problem | `hw.name` |
| Lüfter funktioniert wieder | `hardware.fan_ok` | Wiederherstellung | `hw.name` |
| Netzteil ausgefallen | `hardware.power_supply_failed` | Problem | `hw.name` |
| Netzteil funktioniert wieder | `hardware.power_supply_ok` | Wiederherstellung | `hw.name` |
| Temperatur zu hoch | `hardware.temperature_high` | Problem | - |
| Schleife erkannt | `loop.detected` | Problem | `network.interface.name` |
| Änderung der Spanning-Tree-Topologie | `stp.topology_change` | Hinweise | - |
| PoE-Fehler | `poe.fault` | Problem | `network.interface.name` |
| Anmeldung fehlgeschlagen | `auth.login_failed` | Problem | `user.name` |
| Angemeldet | `auth.login_success` | Hinweise | `user.name` |
| WLAN-Client verbunden | `wireless.client_connected` | Hinweise | `client.mac` |
| WLAN-Client getrennt | `wireless.client_disconnected` | Hinweise | `client.mac` |

Die letzte Spalte ist das Attribut, das sagt, worum es bei dem Ereignis geht. Nicht jedes Produkt meldet jedes Ereignis: Ein Switch hat keine VPN-Tunnel, und das Syslog eines Produkts sagt nur so viel.

Jedes Ereignis trägt außerdem:

| Attribut | Was es enthält |
| --- | --- |
| `event.domain` | `network`, bei jedem Netzwerkereignis |
| `event.kind` | `problem`, `recovery` oder `info` |
| `event.category` | `interface`, `device`, `ha`, `vpn`, `routing`, `wan`, `hardware`, `switching`, `security` oder `wireless`, bei den Ereignissen oben |
| `event.device` | Welches Gerät: sein Name in OneUptime, sonst der Name, den es sich selbst gibt, sonst seine Adresse |
| `event.message` | Was das Gerät gesagt hat, in seinen eigenen Worten |
| `syslog.vendor`, `syslog.parser` | Als wessen Format die Nachricht gelesen wurde |

## Wie die Ereignisse hierher kommen

Jede Sonde lauscht auf Port 5140 auf Syslog, über UDP und über TCP. Über TCP ist eine Nachricht eine Zeile, oder ihr geht ihre Länge voraus, wie RFC 6587 es beschreibt. Die Sonde leitet alle paar Sekunden an OneUptime weiter, was sie hört, und OneUptime ordnet jede Nachricht einem Gerät anhand der Adresse zu, von der sie kam:

1. einem Gerät, das die Sonde abfragt und dessen Hostname diese Adresse ist (oder zu ihr auflöst) oder das sie auf seiner Seite **Einstellungen** unter **Weitere Adressen** führt;
2. auf Ihrer eigenen (benutzerdefinierten) Sonde jedem Gerät im Projekt mit dieser Adresse oder mit dem Hostnamen, den die Nachricht trägt, wenn genau ein Gerät diesen Namen hat;
3. andernfalls wird die Nachricht auf Ihrer eigenen Sonde für die Ereignisseite des Netzwerks unter **Sendet Syslog, noch kein Gerät** aufbewahrt, bis Sie sagen, zu welchem Gerät sie gehört. Eine globale Sonde verwirft sie.

Eine Zeile von einer unbekannten Adresse, die keine Syslog-Priorität hat und kein Ereignis ist, gilt als Rauschen und wird verworfen.

Ein Controller spricht für die Geräte, die er verwaltet: Eine UniFi-Konsole berichtet über ihre Access Points und Switches. Wenn eine Nachricht eines Geräts ein anderes Gerät mit dessen MAC-Adresse, Seriennummer, Adresse oder dem Namen benennt, den sein Controller ihm gibt, geht das Ereignis an dieses Gerät, und das Log hält den Namen des Controllers, der es weitergereicht hat, in `syslog.relay.name` fest.

Ein Log wird zu der Zeit gespeichert, zu der die Sonde es empfangen hat. Eine Nachricht, die zurückgehalten wurde - ihr eigener Zeitstempel hat die Form von RFC 5424, die ihre Zeitzone nennt, und ist älter als 5 Minuten -, behält die Zeit des Geräts, bis zu 7 Tage zurück. Jedem anderen Zeitstempel, der mehr als 5 Minuten von der Uhr der Sonde abweicht, wird nicht geglaubt: Das Log wird zu der Zeit gespeichert, zu der es empfangen wurde, und die Zeit des Geräts steht in `syslog.deviceTime`.

Syslog, das Sie per HTTPS an [den Syslog-Endpunkt](/docs/telemetry/syslog) senden, wird von denselben Parsern gelesen. Dort wird eine Nachricht zu einem Netzwerkereignis, wenn sie im eigenen Format eines Netzwerkherstellers vorliegt oder wenn sie eines Ihrer Netzwerkgeräte mit MAC-Adresse, Seriennummer, Adresse oder Hostnamen benennt; die `sshd`-Zeilen eines Servers bleiben gewöhnliche Logs.

## Einrichtung

1. **Verwenden Sie eine Sonde im Netzwerk des Geräts.** Syslog wird von Ihren Geräten gesendet, sie brauchen also eine [benutzerdefinierte Sonde](/docs/probe/custom-probe), die sie erreichen können. Eine globale Sonde im öffentlichen Internet empfängt es nicht.
2. **Lassen Sie Syslog zur Sonde durch.** Erlauben Sie Port 5140, UDP oder TCP, von den Geräten zur Sonde. Eine Sonde in Docker, die mit Host-Netzwerk (`--network host`) gestartet wurde, wie es die Seite zur benutzerdefinierten Sonde zeigt, empfängt es so, wie sie ist; ohne Host-Netzwerk veröffentlichen Sie den Port mit `-p 5140:5140/udp -p 5140:5140/tcp`. Für ein Gerät, das nur an Port 514 senden kann, veröffentlichen Sie ihn als `-p 514:5140/udp`, oder setzen Sie `PROBE_SYSLOG_RECEIVER_PORT=514` auf einer Sonde mit Host-Netzwerk.
3. **Richten Sie die Sonde als Syslog-Server des Geräts ein.** Die Befehle für gängige Geräte stehen unten. Die Seite **Ereignisse** zeigt dieselben Schritte, bis die erste Nachricht ankommt, und wird dann von selbst zur Liste.
4. **Prüfen Sie die Adresse des Geräts.** Nachrichten werden anhand der Adresse zugeordnet, von der das Gerät sendet. Sendet es von einem Loopback oder einer Management-Schnittstelle, die nicht sein Hostname ist, tragen Sie diese Adresse beim Gerät unter **Weitere Adressen** ein.

Der Syslog-Empfänger ist standardmäßig eingeschaltet. Seine Einstellungen sind Umgebungsvariablen der Sonde:

| Variable | Was sie bewirkt | Standard |
| --- | --- | --- |
| `PROBE_SYSLOG_RECEIVER_ENABLED` | Auf `false` setzen, um den Syslog-Empfänger auszuschalten | `true` |
| `PROBE_SYSLOG_RECEIVER_PORT` | Der Port, für UDP und TCP | `5140` |
| `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` | Weitergeleitete Nachrichten pro Minute, über alle Geräte hinweg | `600` |

Über dem Limit leitet die Sonde weiterhin die Nachrichten weiter, die sie als Netzwerkereignisse liest, noch einmal so viele, damit eine Flut von Routinezeilen nicht die eine verdrängt, die einen Verbindungsausfall meldet. Eine Sonde, die älter ist als diese Funktion, lauscht nur, wenn sie mit `PROBE_SYSLOG_RECEIVER_ENABLED=true` gestartet wird, und nur über UDP: Aktualisieren Sie sie.

### Cisco IOS, IOS XE und NX-OS

```text
logging host <probe-address> transport udp port 5140
logging trap informational
service timestamps log datetime msec
```

Die zweite Zeile sendet Informationsmeldungen und alles Schwerwiegendere: Verbindungsänderungen, Neustarts und Anmeldungen gehören dazu. Unter NX-OS lautet die Zeile `logging server <probe-address> 6 port 5140 use-vrf management`.

### Sophos Firewall

1. Öffnen Sie in der Webverwaltung der Firewall **System services** > **Log settings** und wählen Sie unter **Syslog servers** die Option **Add**.
2. Geben Sie die IP-Adresse der Sonde und Port `5140` ein und stellen Sie den Schweregrad auf **Information**. Beide Logformate, die die Firewall anbietet, werden gelesen.
3. Zurück unter **Log settings** haken Sie den neuen Server für die zu sendenden Logs an: mindestens die Systemereignisse, und **SD-WAN** für SLA-Änderungen. Die Datenverkehrslogs der Firewall sind zahlreich, lassen Sie sie also weg, wenn Sie sie nicht brauchen.

### Fortinet FortiGate

```text
config log syslogd setting
    set status enable
    set server "<probe-address>"
    set port 5140
    set mode udp
    set format default
end
```

FortiGate sendet, was seine Log-Einstellungen auswählen. Ereignislogs enthalten die Tunnel, Verbindungen und Failover; Datenverkehrslogs sind zahlreich, lassen Sie sie also weg, wenn Sie sie nicht brauchen.

### Extreme Networks

```text
configure syslog add <probe-address>:5140 vr VR-Default local7
enable log target syslog <probe-address>:5140 vr VR-Default local7
enable syslog
```

Ändern Sie `VR-Default` in den virtuellen Router, über den die Sonde erreicht wird.

### HPE Aruba

```text
logging <probe-address> udp 5140 severity info
```

Fügen Sie unter AOS-CX `vrf mgmt` zur Zeile hinzu, wenn die Sonde über den Management-Port erreicht wird. Unter AOS-Switch lautet die Zeile `logging <probe-address> udp 5140`.

### MikroTik RouterOS

```text
/system logging action set remote remote=<probe-address> remote-port=5140
/system logging add topics=info action=remote
/system logging add topics=warning action=remote
/system logging add topics=error action=remote
/system logging add topics=critical action=remote
```

Die erste Zeile richtet die eingebaute Remote-Aktion des Routers auf die Sonde; die anderen wählen, was er sendet. Lassen Sie das Remote-Logformat, wie es ist.

### Ubiquiti UniFi

1. Öffnen Sie in UniFi Network **Integration** > **System Logging / SIEM** und wählen Sie **SIEM Server** als Ziel.
2. Geben Sie die IP-Adresse der Sonde und Port `5140` ein und wählen Sie die Logkategorien für den Export.

Die Konsole berichtet über die Access Points und Switches, die sie verwaltet. Ereignisse landen auf der eigenen Seite jedes Geräts, wenn das Gerät mit seiner MAC-Adresse in OneUptime ist, und sonst auf der Seite der Konsole.

### Cambium Networks

1. Öffnen Sie in cnMaestro oder in der Weboberfläche des Access Points die Systemeinstellungen und suchen Sie die Syslog-Server.
2. Geben Sie die IP-Adresse der Sonde als Syslog-Server ein, mit Port `5140`, wo das Formular nach einem Port fragt, und stellen Sie den Syslog-Schweregrad auf **Info**.

Wo sich kein Port einstellen lässt, sendet der Access Point an Port 514: Veröffentlichen Sie den Port der Sonde dort, wie Schritt 2 unter [Einrichtung](#einrichtung) zeigt.

### Andere Geräte

Richten Sie auf dem Gerät einen entfernten Syslog-Server ein: die IP-Adresse der Sonde, Port 5140, über UDP oder TCP, mit Informationsmeldungen und allem Schwerwiegenderen. Auch die Nachrichten eines Geräts, dessen Format OneUptime nicht kennt, werden gespeichert, und Sie können seine Ereignisse selbst benennen.

## Warnungen

**Warnung erstellen** auf einer Ereignisseite listet die Warnungen auf, die die meisten Netzwerke brauchen. Jede öffnet **Monitor erstellen** ausgefüllt, wo Sie vor dem Speichern alles ändern können:

| Warnung | Meldet sich, wenn | Eine Warnung pro | Schließt, wenn |
| --- | --- | --- | --- |
| Ein VPN-Tunnel fällt aus | `vpn.tunnel_down` | Gerät und Tunnel | `vpn.tunnel_up` für diesen Tunnel |
| Eine Firewall oder ein Switch schaltet um | `ha.failover` | Gerät | 5 Minuten ohne ein weiteres vergehen |
| Eine WAN-Verbindung fällt aus | `gateway.down` | Gerät und Gateway | `gateway.up` für dieses Gateway |
| Ein Routing-Nachbar fällt aus | `routing.neighbor_down` | Gerät und Nachbar | `routing.neighbor_up` für diesen Nachbarn |
| Ein Gerät startet neu | `device.reboot` | Gerät | 5 Minuten ohne ein weiteres vergehen |
| Hardware fällt aus | ein Lüfter, ein Netzteil oder die Temperatur | Gerät und Komponente | dieselbe Komponente wieder als funktionierend gemeldet wird |
| Eine Schnittstelle fällt aus | `interface.down` | Gerät und Schnittstelle | `interface.up` für diese Schnittstelle |
| Jemand scheitert wiederholt an der Anmeldung | mehr als 10 `auth.login_failed` in 5 Minuten | Gerät | 5 Minuten mit 10 oder weniger vergehen |

Jede ist ein [Logs-Monitor](/docs/monitor/logs-monitor), der das Ereignis über die letzten 5 Minuten zählt, mit **Group by Attributes**, damit jeder Tunnel, jedes Gateway oder jede Schnittstelle eine eigene Warnung bekommt, und mit **Behoben durch Attribute**, gesetzt auf das Ereignis, das sagt, dass das Problem vorbei ist. Eine solche Warnung bleibt offen, bis dieses Ereignis für dasselbe Gerät und denselben Tunnel eintrifft, wie lange es auch dauert; siehe [Durch ein Log behoben](/docs/monitor/logs-monitor#durch-ein-log-behoben). OneUptime liest kein Ereignis, das sagt, dass eine Temperatur wieder normal ist, eine Temperaturwarnung bleibt also offen, bis Sie sie beheben.

Vom Tab **Ereignisse** eines Geräts aus überwachen die Monitore nur dieses Gerät. Für jedes andere Ereignis öffnen Sie eines auf der Ereignisseite und klicken auf **Warnung für dieses Ereignis erstellen**. Um eine Warnung irgendwohin zu senden oder jemanden zu alarmieren, fügen Sie dem Monitor wie jedem anderen eine Bereitschaftsrichtlinie oder einen Workflow hinzu.

## Adressen, die noch keine Geräte sind

Syslog kann ankommen, bevor das Gerät, das es sendet, zu OneUptime hinzugefügt wurde. Auf Ihrer eigenen Sonde wird es aufbewahrt, seine Ereignisse stehen auf der Ereignisseite des Netzwerks unter dem Namen, den das Gerät sich selbst gibt, und seine Adresse steht unter **Sendet Syslog, noch kein Gerät**:

- **Als Gerät hinzufügen** öffnet **Gerät hinzufügen** mit bereits eingetragener Adresse und Sonde. Die bereits angekommenen Nachrichten bleiben auf der Seite des Netzwerks; neue gehen an das Gerät.
- **Es ist eines meiner Geräte** trägt die Adresse bei einem Gerät unter **Weitere Adressen** ein: Verwenden Sie es, wenn ein bereits hinzugefügtes Gerät von einer anderen Adresse sendet, etwa einem Loopback. Seine Nachrichten gehen ab der nächsten Minute an dieses Gerät.

Mehrere Geräte hinter einer NAT-Adresse teilen sich diese Adresse, ihre Nachrichten gehen also an das eine Gerät, das sie hat, es sei denn, eine Nachricht benennt ihr eigenes Gerät.

## Eigene Ereignisse

Ein Gerät, dessen Format OneUptime nicht kennt, oder ein Ereignis, das es nicht liest, braucht eine [Log-Pipeline](/docs/telemetry/log-pipelines):

1. Legen Sie eine Pipeline an, deren Filter die Logs des Geräts erfasst, etwa `attributes.networkDevice.name = 'rack-ups'`.
2. Fügen Sie einen **Grok-Parser** oder einen **Key=Value Parser** hinzu, um die benötigten Felder aus der Nachricht zu ziehen.
3. Fügen Sie einen **Kategorie-Prozessor** mit **Zielattribut** `event.name` und eine Regel pro Ereignis hinzu. Benennen Sie jede wie die Ereignisse oben, in Kleinbuchstaben mit Punkten oder Unterstrichen: `ups.on_battery`.

Ein Log eines Netzwerkgeräts, das einen solchen Namen trägt, wird zu einem Netzwerkereignis: Es steht auf den Ereignisseiten, und **Warnung für dieses Ereignis erstellen** funktioniert dafür. Um zu sagen, worum es geht, fügen Sie einen **Attribut-Neuzuordnung** hinzu, der Ihr Feld in eines der Attribute der Ereignistabelle kopiert, etwa `hw.name`. Solange Ihre Pipeline `event.kind` nicht auf `problem` oder `recovery` setzt, wird das Ereignis unter **Hinweise** geführt. Eine Regel, die nach einem eingebauten Ereignis benannt ist, etwa `interface.down`, ergibt das eingebaute Ereignis, mit seiner Art und seinen Warnungen.

Eine Pipeline gehört zu ihrem Projekt. Um eine in einem anderen Projekt zu verwenden, legen Sie sie dort mit denselben Prozessoren an.

## Was nicht enthalten ist

- **Syslog über TLS** (RFC 5425). Die Sonde nimmt einfaches UDP und TCP an; halten Sie den Weg zwischen den Geräten und der Sonde in einem Netzwerk, dem Sie vertrauen.
- **Parser zwischen Projekten teilen.** Eine Pipeline lässt sich noch nicht exportieren und importieren.
- **Ereignisse aus anderen SNMP-Traps als den vier Standard-Traps.** Die eigenen Traps eines Herstellers werden als Logs gespeichert, und Warnungen dazu richten Sie mit dem Kriterium **SNMP Trap Received (Trap OID)** des [Network-Device-Monitors](/docs/monitor/network-device-monitor) ein.
- **Cambium-cnMatrix-Switches, Aruba Mobility Controller und FortiGate im CEF-Modus.** Ihre Nachrichten werden gespeichert und sind durchsuchbar; Ereignisse werden daraus noch nicht gelesen.
- **Eine Live-Ansicht.** Die Ereignisseite zeigt, was beim Öffnen angekommen war; verwenden Sie ihre Schaltfläche zum Aktualisieren oder die Live-Ansicht unter **Protokolle**.

## Fehlerbehebung

Wenn eine Ereignisseite noch ihre Einrichtungsschritte zeigt:

- **Empfängt die Sonde überhaupt etwas?** Die Ereignisseite des Netzwerks listet unter **Sendet Syslog, noch kein Gerät** jede Adresse auf, die im Zeitraum Syslog gesendet hat. Steht das Gerät dort, sendet es von einer Adresse, die nicht sein Hostname ist: Tragen Sie diese Adresse bei ihm unter **Weitere Adressen** ein.
- **Firewalls und Docker.** Erlauben Sie Port 5140 vom Gerät zur Sonde, und veröffentlichen Sie den Port, wenn die Sonde in Docker läuft. Viele Geräte senden an Port 514, wenn man es ihnen nicht anders sagt.
- **Das Log der Sonde.** Beim Start schreibt die Sonde den Port ins Log, auf dem sie lauscht, oder dass sie ihn nicht öffnen konnte. Verwirft sie Nachrichten wegen `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE`, schreibt sie einmal pro Minute ins Log, wie viele.
- **Eine globale Sonde.** Ein Gerät, das von einer globalen Sonde abgefragt wird, kann ihr aus einem privaten Netzwerk kein Syslog senden. Betreiben Sie eine benutzerdefinierte Sonde im Netzwerk des Geräts und wählen Sie sie in den Einstellungen des Geräts aus.
- **Nachrichten kommen an, aber keine Ereignisse.** Die Seite sagt das, und jede Nachricht steht auf dem Tab **Protokolle** des Geräts. Prüfen Sie, dass das Gerät Informationsmeldungen sendet, nicht nur Fehler, und dass das Produkt eines derer unter [Was OneUptime liest](#was-oneuptime-liest) ist; andernfalls benennen Sie seine Ereignisse in einer Log-Pipeline.
