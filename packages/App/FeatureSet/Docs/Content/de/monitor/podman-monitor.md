# Podman-Überwachung

Ein Podman-Monitor überwacht die Container auf einem Podman-Host und meldet Ihnen, wenn ein Container heiß läuft, keinen Arbeitsspeicher mehr hat oder immer wieder neu startet. Er liest die Metriken, die der OneUptime-Podman-Agent vom Host sendet, es wird also nichts von außen geprüft: Installieren Sie den Agent und erstellen Sie den Monitor dann aus einer Vorlage oder Ihrer eigenen Abfrage.

:::cards
- [Den Monitor erstellen](#einen-podman-monitor-erstellen): Sechs Schritte im Dashboard.
- [Vorlagen](#fertige-warnungsvorlagen): Fünf fertige Warnungen, ein Vorfall pro Container.
- [Metriken](#erfasste-metriken): Was der Agent erfasst und was jede Metrik bedeutet.
- [Protokolle](#erfasste-protokolle): Container-Protokolle und der Log-Treiber, den sie brauchen.
:::

## So funktioniert es

Der OneUptime-Podman-Agent läuft als Container auf dem Host. Alle 30 Sekunden liest er die Container-Statistiken über den Docker-kompatiblen API-Socket von Podman, liest die Protokolldateien der Container mit und sendet beides über OTLP an OneUptime. Die ersten Daten eines Hosts registrieren ihn in OneUptime.

Ein Podman-Monitor ist an einen Host gebunden. Jede Minute führt er seine Abfrage über die Container-Metriken dieses Hosts aus und vergleicht das Ergebnis mit seinen Kriterien.

```mermaid title="Vom Podman-Host zum Vorfall"
flowchart TB
    subgraph host["Ihr Podman-Host"]
        direction LR
        containers["Container"] --> agent["OneUptime-Podman-Agent"]
    end
    agent -->|"Metriken und Protokolle über OTLP"| oneuptime["OneUptime"]
    oneuptime -->|"erste Daten"| registered["Podman-Host registriert"]
    oneuptime --> monitor["Podman-Monitor"]
    monitor -->|"jede Minute"| criteria{"Kriterien erfüllt?"}
    criteria -->|"ja"| incident["Vorfall oder Warnung"]
    criteria -->|"nein"| online["Monitor online"]
```

## Bevor Sie beginnen

- **Den Podman-Agent installieren** auf dem Host. Die [Anleitung zum Podman-Agent](/docs/telemetry/podman-host) behandelt Installation, Aktualisierung und Prüfung. Der Agent braucht den API-Socket von Podman unter `/run/podman/podman.sock`.
- **Prüfen Sie, ob der Host registriert ist.** Er erscheint unter **Produkte → Infrastruktur → Podman → Alle Hosts**, benannt nach dem `PODMAN_HOST_NAME` des Agents, sobald seine ersten Daten eintreffen.
- **Für Container-Protokolle** führen Sie die Container mit dem Log-Treiber `k8s-file` aus. Siehe [Anforderung an den Log-Treiber](#anforderung-an-den-log-treiber).

## Einen Podman-Monitor erstellen

:::steps
### Einen neuen Monitor beginnen

Gehen Sie zu **Monitore** und klicken Sie auf **Monitor erstellen**.

### Podman Container wählen

Klicken Sie unter **Monitortyp** auf **Weitere Monitortypen** und wählen Sie **Podman Container** unter **Infrastruktur**, oder geben Sie `podman` in das Suchfeld ein. Geben Sie einen **Name** ein – er wird in den Titeln von Vorfällen und Warnungen verwendet – und klicken Sie auf **Weiter**.

### Den Host wählen

Wählen Sie unter **Podman-Monitor-Konfiguration** den Host aus **Podman-Host**. Jeder Host, der Daten gesendet hat, steht in der Liste.

### Festlegen, was überwacht wird

Wählen Sie einen der drei Tabs:

- **Quick Setup** – klicken Sie auf eine [Vorlage](#fertige-warnungsvorlagen). Sie legt Metrik, Aggregation, Zeitbereich und Schwellenwerte fest und ersetzt die Kriterien weiter unten durch ihre eigenen. Den **Zeitbereich** können Sie weiterhin ändern.
- **Custom Metric** – wählen Sie eine Metrik unter **Podman-Metrik** und legen Sie dann **Aggregation** und **Zeitbereich** fest. **Container-Name** und **Container-Image** grenzen sie auf bestimmte Container ein.
- **Erweitert** – bauen Sie unter **Metriken auswählen** selbst Abfragen und Formeln. Verwenden Sie **Gruppieren nach** `resource.container.name`, um jeden Container einzeln zu beurteilen.

### Die Kriterien prüfen

Öffnen Sie unter **Monitor-Kriterien** jedes Kriterium und prüfen Sie seine **Metrik**, **Aggregation**, **Bedingung** und seinen **Schwellenwert**. Eine Vorlage füllt diese aus. Mit **Custom Metric** oder **Erweitert** beginnt der Monitor mit den [Standardkriterien](#standardkriterien), die nur bemerken, wenn eine Metrik auf null fällt; legen Sie daher Ihren eigenen Schwellenwert fest.

### Den Monitor erstellen

Klicken Sie auf **Monitor erstellen**. OneUptime öffnet die Seite des Monitors und wertet ihn jede Minute aus. Vorfälle und Warnungen, die er auslöst, stehen auch auf den Seiten **Vorfälle** und **Warnungen** des Hosts.
:::

> [!TIP]
> Um mehrere Vorlagen auf einmal einzurichten, öffnen Sie den Host über **Produkte → Infrastruktur → Podman** und gehen Sie zu **Empfehlungen**. Wählen Sie die gewünschten Vorlagen, legen Sie fest, wer alarmiert wird, und OneUptime erstellt einen Monitor pro Vorlage.

## Monitor-Einstellungen

| Feld | Tab | Was es tut |
| --- | --- | --- |
| **Podman-Host** | Alle | Erforderlich. Beschränkt jede Abfrage auf den `resource.host.name` des Hosts. OneUptime fügt außerdem jeder Abfrage `resource.container.runtime = podman` hinzu. |
| **Podman-Metrik** | Custom Metric | Eine Metrik aus dem Katalog des Agents, gruppiert nach CPU, Arbeitsspeicher, Netzwerk, Block-I/O und Container. |
| **Container-Name** | Custom Metric, Erweitert | Optional. Exakte Übereinstimmung mit `resource.container.name`, zum Beispiel `my-container`. |
| **Container-Image** | Custom Metric, Erweitert | Optional. Exakte Übereinstimmung mit `resource.container.image.name`, zum Beispiel `nginx:latest`. |
| **Aggregation** | Custom Metric | Wie Messwerte zusammengefasst werden: **Durchschnitt**, **Maximum**, **Minimum**, **Summe** oder **Anzahl**. Beginnt bei der üblichen Aggregation der Metrik. |
| **Zeitbereich** | Alle | Das gleitende Zeitfenster, das die Abfrage liest, von **Past 1 Minute** bis **Past 365 Days**. Ein neuer Monitor beginnt bei **Past 1 Minute**; Vorlagen legen ihr eigenes fest. |
| **Metriken auswählen** | Erweitert | Der Abfrage-Builder: **Metrik**, **Aggregieren nach**, **Nach Attributen filtern**, **Gruppieren nach**, dazu **Metrik hinzufügen** und **Formel hinzufügen**, um Abfragen zu kombinieren. |

## Fertige Warnungsvorlagen

**Quick Setup** bietet fünf Vorlagen. Jede baut einen vollständigen Monitor: eine nach `resource.container.name` gruppierte Abfrage, ein Kriterium, das auslöst, und eines, das wiederherstellt. Jeder Container wird einzeln beurteilt und erhält seinen eigenen Vorfall und seine eigene Warnung. Die Schwellenwerte sind Ausgangswerte, die Sie anpassen können.

Ein Kriterium löst nur aus, wenn die Bedingung in jeder Minute seines Zeitfensters gilt, und es wird 10 % jenseits des Schwellenwerts wiederhergestellt, damit ein Wert, der um die Grenze pendelt, nicht hin- und herspringt.

| Vorlage | Schweregrad | Überwacht | Löst aus, wenn | Wiederhergestellt, wenn |
| --- | --- | --- | --- | --- |
| High Container CPU Usage | Warnung | `container.cpu.utilization`, Avg pro Container, letzte 5 Minuten | Über 80 (% eines Kerns) | Bei oder unter 72 |
| High Container Memory Usage | Warnung | `container.memory.percent`, Avg pro Container, letzte 5 Minuten | Über 85 % | Bei oder unter 76,5 % |
| High Container Restart Count | Kritisch | `container.restarts`, Max pro Container, letzte 5 Minuten | Über 5 Neustarts insgesamt | 4,5 oder weniger |
| High Container Process Count | Warnung | `container.pids.count`, Max pro Container, letzte 5 Minuten | Über 500 | Bei oder unter 450 |
| Container Restarted (Low Uptime) | Kritisch | `container.uptime`, Min pro Container, letzte 1 Minute | Unter 120 Sekunden | Bei oder über 132 Sekunden |

**Schweregrad** ist die Bezeichnung, die die Auswahl anzeigt. Vorfall und Warnung, die eine Vorlage erstellt, beginnen mit dem schwersten Vorfall- und Warnungsschweregrad Ihres Projekts; ändern Sie sie in den Kriterien.

Die beiden Prozent-Vorlagen verwenden **Durchschnitt**: Ihre Metriken sind bereits Prozentwerte pro Container, der Durchschnitt einer Minute ist also der anhaltende Messwert. Neustartzahl und Prozessanzahl verwenden **Maximum**, bei denen ein einzelner Messwert über dem Schwellenwert das Signal ist.

> [!NOTE]
> `container.cpu.utilization` ist die Zahl, die `podman stats` ausgibt: 100 % ist ein voller CPU-Kern, nicht das gesamte CPU-Kontingent des Containers. Ein Container mit mehreren Kernen liest im gesunden Zustand deutlich über 100; erhöhen Sie für solche den Schwellenwert.

> [!NOTE]
> `container.restarts` ist eine laufende Summe, die Podman führt, keine Zahl der Neustarts im Zeitfenster. **High Container Restart Count** bleibt daher offen, bis der Container neu erstellt wird, was die Zahl zurücksetzt.

> [!CAUTION]
> `container.uptime` gibt es nur für laufende Container. Ein Container, der stoppt und gestoppt bleibt, sendet keine Daten; **Container Restarted (Low Uptime)** erkennt daher Neustarts und erneute Deployments, kein dauerhaftes Herunterfahren. Ein Container, der weniger als zwei Minuten laufen soll, bleibt sein ganzes Leben lang im Warnzustand.

Es gibt keine Vorlage für CPU-Drosselung. Die Drosselungsmetriken, die der Agent erfasst, wachsen nur, und eine Warnung „überhaupt gedrosselt“ würde einmal auslösen und nie wieder abklingen. Beide werden dennoch erfasst, Sie können sie also in Diagrammen darstellen.

## Erfasste Metriken

Der Agent verwendet den OpenTelemetry-Receiver `docker_stats`, gerichtet auf den Docker-kompatiblen Socket von Podman, `/run/podman/podman.sock`, alle 30 Sekunden. Die Metriken jedes Containers tragen seine Identität als Ressourcenattribute: `resource.container.name`, `resource.container.image.name`, `resource.container.id`, `resource.container.runtime` (`podman`) und `resource.host.name`.

### CPU

| Metrik | Beschreibung |
| --- | --- |
| `container.cpu.utilization` | CPU-Auslastung des Containers, wobei 100 % ein voller CPU-Kern ist. |
| `container.cpu.usage.total` | Seit dem Start des Containers verbrauchte CPU-Zeit, in Nanosekunden. Ein Zähler über die gesamte Lebensdauer. |
| `container.cpu.throttling_data.throttled_time` | Nanosekunden, die der Container durch sein CPU-Limit gedrosselt wurde. Ein Zähler über die gesamte Lebensdauer. |
| `container.cpu.throttling_data.throttled_periods` | Drosselungsperioden seit dem Start des Containers. Ein Zähler über die gesamte Lebensdauer. |

### Arbeitsspeicher

| Metrik | Beschreibung |
| --- | --- |
| `container.memory.usage.total` | Belegter Arbeitsspeicher, in Bytes. |
| `container.memory.usage.limit` | Speicherlimit, in Bytes. |
| `container.memory.percent` | Speichernutzung als Prozentsatz des Container-Limits oder des Arbeitsspeichers des Hosts, wenn der Container kein Limit hat. |

### Netzwerk

| Metrik | Beschreibung |
| --- | --- |
| `container.network.io.usage.rx_bytes` | Empfangene Bytes. Ein Zähler über die gesamte Lebensdauer. |
| `container.network.io.usage.tx_bytes` | Gesendete Bytes. Ein Zähler über die gesamte Lebensdauer. |

### Block-I/O

| Metrik | Beschreibung |
| --- | --- |
| `container.blockio.io_service_bytes_recursive.read` | Von Blockgeräten gelesene Bytes. |
| `container.blockio.io_service_bytes_recursive.write` | Auf Blockgeräte geschriebene Bytes. |

### Container

| Metrik | Beschreibung |
| --- | --- |
| `container.uptime` | Sekunden seit dem Start des Containers. Nur laufende Container melden sie. |
| `container.restarts` | Wie oft der Container neu gestartet wurde. Eine laufende Summe. |
| `container.pids.count` | Tasks im Container. Der pids-Controller der cgroup zählt Threads ebenso wie Prozesse. |

Die Liste **Podman-Metrik** bietet außerdem `container.cpu.usage.percpu`, `container.memory.rss`, `container.memory.cache` und die Netzwerk-Paketzähler. Die mitgelieferte Agent-Konfiguration schaltet diese nicht ein; prüfen Sie daher die Seite **Metriken** des Hosts, bevor Sie darauf aufbauen. `container.cpu.throttling_data.throttled_periods` steht nicht in der Liste; fragen Sie sie über **Erweitert** ab.

## Überwachungskriterien

Ein Kriterium vergleicht eine der Abfragen oder Formeln des Monitors mit einem Schwellenwert. Die Kriterien eines Podman-Monitors haben keinen **Filtertyp**: Jede Regel prüft den Metrikwert, mit diesen Feldern.

| Feld | Was es tut |
| --- | --- |
| **Metrik** | Die zu prüfende Abfrage oder Formel, anhand ihres Variablennamens. |
| **Aggregation** | Wie die Werte im Zeitfenster zu einer Antwort werden: **Durchschnitt**, **Summe**, **Maximum Value**, **Minimum Value**, **All Values** (jeder Wert muss zutreffen) oder **Any Value** (einer genügt). |
| **Bedingung** | **Greater Than**, **Less Than**, **Greater Than Or Equal To**, **Less Than Or Equal To** oder **Equal To** – oder eine Anomaliebedingung: **Anomalously High**, **Anomalously Low** oder **Anomalous**. |
| **Schwellenwert** | Der Vergleichswert. Daneben steht eine Einheitenliste, wenn die Metrik eine Einheit hat. Wird bei Anomaliebedingungen nicht angezeigt. |
| **Empfindlichkeit** | Nur bei Anomaliebedingungen. **Niedrig** (4σ), **Mittel** (3σ, der Standard) oder **Hoch** (2σ). |
| **Baseline-Fenster** | Nur bei Anomaliebedingungen. 14 Tage (der Standard), 28, 60 oder 90 Tage Verlauf. |
| **Bei keinen Daten** | Unter **Weitere Felder**. Was geschieht, wenn das Zeitfenster keine Messwerte hat: **Ignore** (der Standard), **Treat As Zero** oder **Auslöser**. |

Anomaliebedingungen vergleichen jeden Wert mit derselben Stunde der Woche in der Baseline. Sie bleiben im Zustand „Learning“ und lösen nichts aus, bis das Baseline-Fenster genug Verlauf enthält.

Jedes Kriterium legt außerdem fest, was geschieht, wenn es zutrifft: den Monitorstatus ändern, eine Warnung erstellen oder einen Vorfall melden. Kriterien werden von oben nach unten geprüft, und das erste zutreffende entscheidet.

### Standardkriterien

Ein Monitor, den Sie nicht aus einer Vorlage erstellen, beginnt mit zwei Kriterien:

| Reihenfolge | Kriterium | Trifft zu, wenn | Dann |
| --- | --- | --- | --- |
| 1 | Check if _monitor name_ is offline | Ein beliebiger Wert der ersten Abfrage `0` ist | Markiert den Monitor als **Offline** und meldet den Vorfall „_monitor name_ is offline“, der sich von selbst auflöst, wenn der Monitor sich erholt. |
| 2 | Check if _monitor name_ is online | Ein beliebiger Wert über `0` liegt | Markiert den Monitor als **Betriebsbereit**. |

> [!IMPORTANT]
> Stille erfüllt keines der beiden Kriterien: Ein Host, der keine Daten mehr sendet, lässt den Monitor, wie er war. Um benachrichtigt zu werden, wenn keine Daten mehr kommen, setzen Sie **Bei keinen Daten** in einem Kriterium auf **Auslöser**. Zeit, in der OneUptime selbst keine Daten empfing, gilt nie als fehlende Daten: Eine Prüfung, deren Zeitfenster solche Zeit enthält, wartet stattdessen, wie [Wenn OneUptime keine Daten empfängt](/docs/monitor/when-oneuptime-is-not-receiving) erklärt.

## Erfasste Protokolle

Der Agent liest außerdem die Datei `ctr.log` jedes Containers mit und sendet jede Zeile als OpenTelemetry-Protokolleintrag mit:

| Feld | Wert |
| --- | --- |
| `resource.host.name` | Der Host, aus `PODMAN_HOST_NAME`. |
| `resource.container.id` | Die vollständige Container-ID. |
| `resource.container.runtime` | Immer `podman`. |
| `attributes["log.iostream"]` | `stdout` oder `stderr`. |
| `severityText` / `severityNumber` | Aus einem Level-Schlüsselwort gelesen, wo in der Zeile ein Level steht (`[ERROR]`, `app.INFO:`, `{"level":"warn"}`, `level=error`). Eine Zeile ohne Level fällt auf ihren Stream zurück: `stderr` ist `ERROR`, `stdout` ist `INFO`. |
| `body` | Die Zeile, die der Container geschrieben hat. Zeilen, die mit Leerraum oder einer schließenden Klammer beginnen, etwa Stacktrace-Zeilen, werden an die vorherige Zeile angehängt. |
| `time` | Der Zeitstempel von Podman für die Zeile. |

Protokolle erscheinen auf der Seite **Protokolle** des Hosts und auf der Seite jedes Containers.

### Anforderung an den Log-Treiber

Der Agent liest die Dateien, die der Podman-Log-Treiber `k8s-file` schreibt, unter `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log`. Rootful-Podman verwendet standardmäßig `journald`, das stattdessen in das systemd-Journal schreibt, es gibt also keine Datei zum Lesen:

| Treiber | Was der Agent sieht |
| --- | --- |
| `k8s-file` (oder `json-file`, das Podman genauso behandelt) | Jede Zeile. |
| `journald` | Nichts: Die Protokolle stehen im systemd-Journal. |
| `none` | Nichts: Die Protokolle werden verworfen. |

Metriken hängen nicht vom Log-Treiber ab: Ein Host, dessen Container `journald` verwenden, meldet weiterhin Metriken, nur seine Seite **Protokolle** bleibt leer.

Prüfen Sie den Treiber eines Containers und den Standard von Podman:

```bash
podman inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
podman info --format '{{.Host.LogDriver}}'
```

Wechseln Sie zu `k8s-file`. Podman legt den Log-Treiber eines Containers beim Erstellen des Containers fest; erstellen Sie daher jeden Container nach der Änderung neu – ein Neustart behält den alten Treiber.

:::tabs
@tab podman run
Starten Sie den Container mit dem Treiber:

```bash
podman run --log-driver k8s-file ... <image>
```

Um einen bestehenden Container umzustellen, entfernen Sie ihn und führen Sie ihn erneut aus:

```bash
podman rm -f <container>
podman run --log-driver k8s-file ... <image>
```
@tab Podman Compose
Setzen Sie den Treiber für jeden Dienst:

```yaml title="docker-compose.yml"
services:
  my-app:
    image: my-app:latest
    logging:
      driver: "k8s-file"
      options:
        max-size: "100m"
```

Erstellen Sie dann den Dienst neu:

```bash
podman compose up -d --force-recreate <service>
```
@tab containers.conf
Machen Sie `k8s-file` zum Standard für jeden danach erstellten Container, in `/etc/containers/containers.conf` (rootful) oder `~/.config/containers/containers.conf` (rootless):

```toml title="containers.conf"
[containers]
log_driver = "k8s-file"
```

Entfernen Sie dann jeden Container und erstellen Sie ihn neu.
:::

## Fehlerbehebung

:::details Der Host steht nicht in der Liste Podman-Host
Hosts registrieren sich selbst aus den Daten des Agents. Prüfen Sie, ob der Agent-Container läuft, ob der API-Socket von Podman aktiviert ist und ob der Host unter **Produkte → Infrastruktur → Podman → Alle Hosts** aufgeführt ist. Die [Anleitung zum Podman-Agent](/docs/telemetry/podman-host) enthält die Prüfungen, die Sie auf dem Host ausführen.
:::

:::details Metriken kommen an, aber die Seite Protokolle ist leer
Die Container verwenden mit ziemlicher Sicherheit `journald`. Stellen Sie die Container, deren Protokolle Sie brauchen, auf `k8s-file` um (siehe [Anforderung an den Log-Treiber](#anforderung-an-den-log-treiber)) und erstellen Sie sie neu.
:::

:::details Der Agent protokolliert „no files match the configured criteria“
Der Agent sucht nach `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log` und hat nichts gefunden. Entweder verwendet kein Container auf dem Host `k8s-file`, oder das Mount von `/var/lib/containers/storage` des Agents fehlt oder ist leer, oder Agent und Container laufen in unterschiedlichen Modi – rootless-Container legen ihren Speicher an einem Ort ab, den der rootful-Pfad nicht abdeckt, und umgekehrt.
:::

:::details Daten kommen unter dem falschen Hostnamen an
OneUptime erkennt einen Host an `resource.host.name`, den der Agent aus `PODMAN_HOST_NAME` übernimmt. Wird `PODMAN_HOST_NAME` nach den ersten Daten geändert, entsteht ein zweiter Host, statt dass der erste umbenannt wird, und ein Monitor bleibt an den Namen gebunden, mit dem er erstellt wurde.
:::

:::details Eine CPU-Warnung löst nie aus
Gruppieren Sie die Abfrage nach `resource.container.name`, wie es die Vorlage **High Container CPU Usage** tut, damit jeder Container einzeln beurteilt wird. Ein Durchschnitt über alle Container eines ausgelasteten Hosts wird von den untätigen nach unten gezogen. Denken Sie daran, dass 100 % einen vollen Kern bedeuten; ein Container, dem mehrere Kerne zustehen, braucht daher einen höheren Schwellenwert.
:::

:::details Die Warnung zur Neustartzahl klingt nie ab
`container.restarts` ist eine laufende Summe und fällt daher nicht von selbst unter den Schwellenwert zurück. Beheben Sie die Ursache und erstellen Sie den Container dann neu, um die Zahl zurückzusetzen, oder erhöhen Sie den Schwellenwert.
:::

## Nächste Schritte

:::cards
- [Podman-Agent](/docs/telemetry/podman-host): Den Agent installieren, aktualisieren und Fehler beheben, den dieser Monitor liest.
- [Docker-Überwachung](/docs/monitor/docker-monitor): Derselbe Monitor für Docker-Hosts.
- [Vorfälle – Übersicht](/docs/incidents/index): Was passiert, nachdem ein Kriterium einen Vorfall gemeldet hat.
- [Bereitschaftspläne](/docs/on-call/schedules): Festlegen, wer alarmiert wird, wenn ein Container ausfällt.
:::
