# Zugriff auf private Netzwerke

OneUptime verweigert bestimmte ausgehende Anfragen an Hosts, die in einen privaten, Loopback- oder Link-Local-Bereich aufgelöst werden. Wenn Sie schon versucht haben, einen Workflow auf ein internes Tool zu richten, kennen Sie die Meldung:

> Webhook URL resolves to a private, loopback, or link-local address and is not allowed

Für das gehostete Produkt ist diese Voreinstellung richtig: Dort kann sich jeder registrieren, und ein Webhook-Ziel ist nicht vertrauenswürdige Eingabe. Auf einer selbst gehosteten Instanz steht sie etwas Alltäglichem im Weg: einen Alarm an ein selbst gehostetes Mattermost, Jira oder Ticketsystem zu senden, das nur in Ihrem eigenen Netzwerk existiert.

Diese Seite erklärt, wie Sie das bewusst und eng begrenzt erlauben. Drei Schalter entscheiden darüber, jeder für seine eigene Art von Verbindung, und sie werden auf verschiedenen Maschinen konfiguriert:

| Was Sie intern erreichen möchten | Wo die Einstellung liegt | Standard bei einer selbst gehosteten Installation |
| --- | --- | --- |
| Workflows, Projekt-Webhooks, Benutzer-Webhooks der Bereitschaft | Die Umgebung des **API-Servers** | Private Adressen verweigert |
| Datenquellen, LLM-Anbieter, SMTP-Server, OIDC-Discovery und andere Verbindungen | Die Umgebung des **API-Servers** | Private Adressen erlaubt |
| **Monitore** vom Typ API, Website, External Status Page und Custom JavaScript Code | Die eigene Umgebung der **Probe** | Private Adressen verweigert |

```mermaid title="Drei Schalter, jeder für seine eigene Art von Verbindung"
flowchart TB
    subgraph Server["Der OneUptime-Server"]
        direction TB
        Webhooks["Workflows und Webhooks"]
        Outbound["Datenquellen, LLM-Anbieter,<br/>SMTP und andere Verbindungen"]
    end
    subgraph Probe["Jede Probe"]
        Monitors["Monitore vom Typ API, Website,<br/>External Status Page und<br/>Custom JavaScript Code"]
    end
    Private["Ihr privates Netzwerk"]
    Webhooks -->|"standardmäßig aus"| Private
    Outbound -->|"standardmäßig an"| Private
    Monitors -->|"standardmäßig aus"| Private
```

Netzwerknahe Monitortypen wie Ping, Port, SSL-Zertifikat, DNS, DNSSEC, SNMP / Netzwerkgerät, SQL-Abfrage, Datenbankzustand, Synthetic und Network Path nutzen ihre eigenen Transporte. Die Einstellung auf dieser Seite regelt die HTTP-Transporte, die beliebige Antwortinhalte an ein Projekt zurückgeben: Monitore vom Typ API, Website, External Status Page und Custom JavaScript Code.

:::cards
- [Webhooks und Workflows](#webhooks-und-workflows): Einem Webhook erlauben, in Ihr Netzwerk zu senden.
- [Andere ausgehende Verbindungen](#andere-ausgehende-verbindungen): Datenquellen, LLM-Anbieter und Mailserver.
- [Probes und Monitore](#probes-und-monitore): Eine Probe private Sites prüfen lassen.
- [Prüfen, ob es funktioniert](#prüfen-ob-es-funktioniert): Lesen, welchen Schalter eine Ablehnung nennt.
:::

## Was blockiert ist und was sich freigeben lässt

Blockierte Ziele fallen in zwei Stufen.

| Stufe | Bereiche | Lässt es sich erlauben? |
| --- | --- | --- |
| **Privat** | RFC-1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), CGNAT (`100.64.0.0/10`), IPv6 Unique-Local (`fc00::/7`) und Site-Local (`fec0::/10`) | Ja |
| **Verboten** | Loopback (`127.0.0.0/8`, `::1`), die unspezifizierte Adresse, Link-Local (`169.254.0.0/16`, `fe80::/10`), Multicast, reservierte Bereiche, Broadcast sowie die Namen `localhost` und `metadata.google.internal` | Nur indem Sie den genauen Host oder CIDR in der Webhook-Allowlist nennen. Für Monitore nie. |

Der Cloud-Metadaten-Endpunkt `169.254.169.254` liegt aus gutem Grund in der verbotenen Stufe. Auf einer Cloud-VM gibt er die IAM-Zugangsdaten der Instanz an alles heraus, was von der Maschine aus eine HTTP-Anfrage stellen kann; keine pauschale Einstellung wird ihn deshalb je öffnen.

IPv6-Schreibweisen, die ein IPv4-Ziel in sich tragen – IPv4-mapped (`::ffff:10.0.0.5`), NAT64, 6to4, Teredo –, werden nach der IPv4-Adresse eingestuft, die sie erreichen; sie lassen sich also nicht nutzen, um eine verbotene Adresse an einer Freigabe der privaten Stufe vorbeizuschmuggeln.

## Webhooks und Workflows

Diese Ziele sind abgedeckt, weil das Ziel eine URL ist, die ein authentifiziertes Mitglied Ihres Projekts geschrieben hat:

- **API**-Komponenten in Workflows (GET / POST / PUT / PATCH / DELETE)
- HTTP-Anfragen der Workflow-Komponente **Custom JavaScript**
- Projekt-Webhook-Benachrichtigungen (Incidents, Alarme, Monitore, Bereitschaft, geplante Wartung, Statusseiten-Ereignisse)
- **Benutzer-Webhooks** der Bereitschaft

**Nicht** abgedeckt, und das wird auch so bleiben: **Webhooks von Statusseiten-Abonnenten**. Jeder Besucher einer öffentlichen Statusseite kann einen registrieren; dieses Ziel zu lockern ließe also jeden im Internet Ihren Server in Ihr privates Netzwerk POSTen. Das ist nicht konfigurierbar.

Ausgehende Verbindungen, die keine Webhooks sind – externe Datenquellen, LLM-Anbieter, SMTP-Server (die SMTP-Einstellungen eines Projekts und die Workflow-Komponente **Email**), SMTP-OAuth-Token-Endpunkte, OIDC-Discovery und HTTP-Schritte in Runbooks –, regelt getrennt davon `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES`, und bei selbst gehosteten Installationen erlauben sie private Bereiche bereits. Siehe [Andere ausgehende Verbindungen](#andere-ausgehende-verbindungen).

### Den API-Server konfigurieren

Setzen Sie eine oder beide dieser Variablen auf dem API-Server und starten Sie ihn neu. Sie sind standardmäßig aus, sodass sich eine Instanz, die keine von beiden setzt, genau wie vorher verhält.

| Variable | Helm-Wert | Was sie erlaubt |
| --- | --- | --- |
| `ALLOW_PRIVATE_NETWORK_WEBHOOKS` | `webhooks.allowPrivateNetwork` | Die gesamte private Stufe, wenn auf `true` gesetzt. |
| `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` | `webhooks.privateNetworkAllowlist` | Die Hosts und CIDRs, die sie nennt, egal in welcher Stufe. |

:::tabs
@tab Docker Compose
```bash title="config.env"
ALLOW_PRIVATE_NETWORK_WEBHOOKS=true
PRIVATE_NETWORK_WEBHOOK_ALLOWLIST=mattermost.internal,*.svc.cluster.local,10.20.0.0/16
```
@tab Kubernetes
```yaml title="values.yaml"
webhooks:
  allowPrivateNetwork: true
  privateNetworkAllowlist: "mattermost.internal,10.20.0.0/16"
```
:::

Unter Docker Compose enthält `config.env` eine Zeile `ALLOW_PRIVATE_NETWORK_WEBHOOKS=false`: Ändern Sie diese, statt eine zweite hinzuzufügen, und führen Sie dann `npm run start` aus. Unter Kubernetes aktualisieren Sie das Release.

Einträge der Allowlist können durch Kommas, Leerzeichen oder Zeilenumbrüche getrennt sein, und jeder kann Folgendes sein:

- ein Hostname – `mattermost.internal`
- ein Platzhalter – `*.svc.cluster.local` (passt auf Subdomains, nicht auf das bloße Suffix)
- eine IPv4- oder IPv6-Adresse – `10.20.30.40`, `fd00::1`
- ein CIDR – `10.20.0.0/16`, `fd12:3456::/32`

Schema, Port, Pfad oder Benutzerangaben eines Eintrags werden entfernt; Sie können also einfach die Webhook-URL einfügen, die Sie schon haben.

Einem in der Allowlist genannten Hostnamen wird **ohne DNS-Prüfung** vertraut – genau darum nennen Sie ihn, denn er soll zu etwas aufgelöst werden, das die Sperrliste verweigern würde. Ein Adresseintrag wird mit dem Literal in der URL und mit jeder Adresse verglichen, die DNS dafür liefert.

> [!CAUTION]
> **Tragen Sie niemals `169.254.169.254` oder einen Bereich, der sie enthält, in die Allowlist ein.** Auf einer Cloud-VM gibt das jedem Projektmitglied die IAM-Zugangsdaten Ihrer Instanz.

## Andere ausgehende Verbindungen

Eine zweite Schutzschicht deckt ausgehende Verbindungen ab, deren Ziel ein Projektmitglied wählt, die aber keine Webhooks sind:

- externe Datenquellen (PostgreSQL-, MySQL-, SQL-Server-, ClickHouse-, Elasticsearch- und REST-API-Verbindungen), Verbindungen für Sicherheitsereignisse wie Splunk und Threat-Intel-Feeds
- LLM-Anbieter, einschließlich eines selbst gehosteten Ollama oder vLLM
- SMTP-Server – die SMTP-Einstellungen eines Projekts und die Workflow-Komponente **Email** – sowie OAuth-Token-URLs für SMTP und Workflows
- OIDC-Discovery für Single Sign-on
- die Überprüfung eigener Domains von Statusseiten und Dashboards
- HTTP-Schritte in Runbooks
- die URL der Grafana-OnCall-API, aus der ein Import liest (**Projekteinstellungen** > **Grundlegend** > **Aus einem anderen Tool importieren**)

Diese Schutzschicht funktioniert umgekehrt zu den Webhook-Einstellungen. Bei einer selbst gehosteten Installation **erlaubt** sie die private Stufe standardmäßig, weil die Datenbank, der Mailserver oder der Modellserver, mit denen sich diese Verbindungen verbinden, meist in Ihrem eigenen Netzwerk liegen. Die verbotene Stufe – Loopback, Link-Local und der Cloud-Metadaten-Endpunkt – wird in jedem Fall verweigert, und dafür gibt es keine Allowlist.

`DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` verschärft sie. Setzen Sie die Variable auf `true`, um die private Stufe auch für diese Verbindungen zu verweigern, etwa wenn die Projekte auf Ihrer Instanz Personen gehören, die Ihr internes Netzwerk nicht erreichen sollen:

:::tabs
@tab Docker Compose
```bash title="config.env"
DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true
```
@tab Kubernetes
```yaml title="values.yaml"
outboundConnections:
  blockPrivateNetwork: true
```
:::

Diese Einstellung gilt nicht für einen Globalen LLM-Anbieter, den ein Administrator statt eines Projekts konfiguriert (mit den Variablen `GLOBAL_LLM_PROVIDER_*`, dem Wert `vllm.globalProvider` des Helm-Charts oder im Admin-Dashboard unter **Einstellungen** > **Globale LLM-Anbieter**): Ein solcher Anbieter kann weiterhin private Adressen erreichen, wobei Loopback und Link-Local auch für ihn verweigert bleiben.

Nur der genaue Wert `true` schaltet sie ein. Auf einer Instanz mit `BILLING_ENABLED=true` ist sie immer an, egal was Sie setzen. Sie ändert nicht, welche Ziele die Webhook-Einstellungen oben oder die Probe-Einstellung unten erlauben; jedes Tor wird für sich konfiguriert. Sie ändert aber, wie Ablehnungen formuliert sind, auch für Webhooks und Workflow-Anfragen: Ist sie an, wird ein abgelehnter Hostname gemeldet, ohne zu sagen, wozu er aufgelöst wurde (siehe [Prüfen, ob es funktioniert](#prüfen-ob-es-funktioniert)).

Unter Docker Compose enthält `config.env` eine Zeile `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=false` (fügen Sie sie hinzu, wenn Ihre `config.env` älter ist). Ändern Sie diese Zeile auf `true`, statt eine zweite hinzuzufügen, und führen Sie dann `npm run start` aus, damit die Container mit dem neuen Wert neu erstellt werden; `docker compose restart` liest `config.env` nicht neu ein. Unter Kubernetes setzen Sie den Wert in Ihrer Values-Datei und aktualisieren das Release; das Chart gibt ihn an die App- und Worker-Pods weiter.

Ist sie an, wird ein abgelehnter Hostname gemeldet, ohne zu sagen, wozu er aufgelöst wurde, zum Beispiel _"LLM provider host ollama.internal could not be reached."_ Ein Name, der gar nicht aufgelöst wird, erhält dieselbe Meldung, sodass Projektmitglieder mit diesen Feldern nicht herausfinden können, welche internen Namen es gibt. Eine als IP eingegebene Adresse wird weiterhin zusammen mit dem Grund genannt, zum Beispiel _"LLM provider host 10.0.4.12 is not allowed: private network address."_ Mit `LOG_LEVEL=DEBUG` protokolliert die App die Adresse, zu der jeder abgelehnte Name aufgelöst wurde.

## Probes und Monitore

Vier Monitortypen sind betroffen: **API**, **Website**, **Externe Statusseite** und **Custom JavaScript Code**. Auf einer Standard-Probe können sie öffentliche HTTP(S)-Ziele erreichen, verweigern aber privaten Adressraum. Monitore vom Typ API, Website und External Status Page validieren DNS-Ergebnisse für jede Verbindung, legen sie fest und prüfen jede Weiterleitung erneut; Custom JavaScript Code wendet dieselbe Adressrichtlinie in seiner Sandbox-Brücke an.

Den Schalter liest der **Probe-Prozess aus seiner eigenen Umgebung**, nicht aus der des API-Servers, und jede Probe liest ihn: die mit Docker Compose mitgelieferten, die vom Helm-Chart bereitgestellten und jede [eigene Probe](/docs/probe/custom-probe), die Sie selbst betreiben. Wer eine Probe bereitstellt, kontrolliert ihre Umgebung und weiß, welches Netzwerk diese Probe sehen kann – eine eigene Probe ist meist eine andere Maschine, oft von einer anderen Person betrieben, und sie liest nie die Konfiguration des API-Servers.

:::tabs
@tab Docker Compose
`config.env` enthält bereits eine Zeile `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=false`: Ändern Sie diese Zeile auf `true`, statt eine zweite hinzuzufügen, denn wenn eine Variable zweimal vorkommt, gewinnt die spätere Zeile. Führen Sie dann `npm run start` aus, was die Container mit dem neuen Wert neu erstellt; `docker compose restart` liest `config.env` nicht neu ein. Jede mitgelieferte Probe liest diese eine Zeile, sie gilt also für `probe-1` und, wo Ihr Stack eine zweite Probe betreibt, für `probe-2`.

```bash title="config.env"
PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true
```
@tab Kubernetes
Setzen Sie den Wert pro Probe in Ihrer Values-Datei und aktualisieren Sie das Release. Jeder Eintrag unter `probes:` ist eine eigene Probe; setzen Sie ihn also bei jeder, die private Adressen erreichen soll:

```yaml title="values.yaml"
probes:
  one:
    allowPrivateNetworkMonitors: true
```
:::

Auf einer eigenen Probe setzen Sie `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true` in der eigenen Umgebung dieser Probe und starten sie neu. Der Wert muss genau `true` sein; alles andere, etwa `TRUE` oder `1`, lässt den Schalter aus, und die Probe sagt das in einer Warnung beim Start, egal auf welchen Wert `LOG_LEVEL` gesetzt ist.

Die mitgelieferten Probes sind **globale Probes**: Sie registrieren sich mit dem `REGISTER_PROBE_KEY` der Instanz, und jedes Projekt auf der Instanz kann sie auswählen. Den Schalter für eine mitgelieferte Probe einzuschalten, lässt daher Monitore aus **jedem Projekt auf der Instanz** über sie private Adressen erreichen. Das will eine Installation für ein einzelnes Team meist. Wo Projekte diese Reichweite nicht teilen sollen – getrennte Teams oder Kunden, die Sie hosten –, lassen Sie ihn auf den mitgelieferten Probes aus und stellen stattdessen in jedem Netzwerk eine private (eigene) Probe bereit, die nur dort eingeschaltet ist.

Es gibt eine Ausnahme. Eine Probe, die sich mit `REGISTER_PROBE_KEY` registriert und `BILLING_ENABLED=true` in ihrer eigenen Umgebung hat – eine globale Probe des gehosteten Produkts mit offener Registrierung, bei dem sich jeder anmelden kann und alle Projekte die globalen Probes teilen –, bleibt auch mit eingeschaltetem Schalter rein öffentlich und protokolliert beim Start eine Warnung, dass sie ihn nicht berücksichtigt. Die mit Docker Compose und dem Helm-Chart mitgelieferten Probes erhalten das `BILLING_ENABLED` der Instanz automatisch; geben Sie es jeder anderen `REGISTER_PROBE_KEY`-Probe, die Sie für eine solche Instanz betreiben. Auf andere Weise kann eine Probe nicht erkennen, dass sie global ist; eine im Admin-Dashboard angelegte und mit `PROBE_ID` und `PROBE_KEY` betriebene globale Probe beachtet den Schalter daher wie eine private: Schalten Sie ihn dort nicht ein, wenn Projekte das Netzwerk dieser Probe nicht teilen sollen. Eine private Probe beachtet den Schalter auf jeder Instanz.

Jede Probe protokolliert beim Start ihre wirksame Richtlinie für private Netzwerke: ob die Überwachung privater Netzwerke an oder aus ist, und warum. Ein Wert, der nicht berücksichtigt wird, und eine globale Probe, die der Schalter für jedes Projekt öffnet, werden auf jedem `LOG_LEVEL` als Warnungen protokolliert. Die normale Zeile „an“ oder „aus“ und das JSON „Probe environment“, das dieselbe Entscheidung unter `privateNetworkMonitors` festhält, werden bei `LOG_LEVEL=INFO` protokolliert, dem Standard des Helm-Charts; Docker Compose wird mit `LOG_LEVEL=ERROR` ausgeliefert, setzen Sie dort also `LOG_LEVEL=INFO`, um sie zu sehen. Prüfen Sie zuerst dieses Log, wenn ein Monitor auf einer gerade geänderten Probe weiterhin abgelehnt wird.

Das Einschalten öffnet Loopback, Link-Local und den Cloud-Metadaten-Endpunkt **nicht**. Diese bleiben auf jeder Probe verweigert, was vor allem für Probes zählt, die in einem Netzwerk laufen, das dem Autor des Monitors nicht gehört.

> [!WARNING]
> Lassen Sie es auf Probes aus, die Sie im Auftrag anderer Personen betreiben.

## Prüfen, ob es funktioniert

Führen Sie den Workflow oder Monitor erneut aus. Wird er weiterhin abgelehnt, nennt die Fehlermeldung, welches Tor geschlossen ist:

- _"...points to a private network address and is not allowed. Self-hosted instances can allow this by setting `ALLOW_PRIVATE_NETWORK_WEBHOOKS`..."_ – die Einstellung des API-Servers fehlt.
- _"...private network address... Set PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true on the probe running this monitor to allow it."_ – eine private (eigene) Probe hat den Monitor ausgeführt, und ihr Schalter ist aus. Beachten Sie, dass er auf der Probe gesetzt wird, nicht auf dem API-Server.
- _"...private network address... Set PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true on the probe running this monitor to allow it (probes.<name>.allowPrivateNetworkMonitors in the Helm chart). This is a global probe, so that allows it for every project on this instance; otherwise, select a private probe deployed on that network."_ – eine mitgelieferte (globale) Probe hat den Monitor ausgeführt, und ihr Schalter ist aus. Schalten Sie ihn wie oben beschrieben für diese Probe ein, wenn jedes Projekt auf der Instanz dieses Netzwerk erreichen darf; andernfalls wählen Sie für den Monitor eine private Probe.
- _"...Global probes cannot monitor private network addresses. Deploy and select a private probe for this target."_ – eine globale Probe mit `BILLING_ENABLED=true` in ihrer Umgebung hat den Monitor ausgeführt. Automatisch registrierte globale Probes bleiben dort rein öffentlich, egal was ihr Schalter sagt; stellen Sie eine private Probe im Netzwerk des Ziels bereit und wählen Sie sie für den Monitor.
- _"Monitor target host ... could not be reached."_ – ein Monitor vom Typ API, Website oder External Status Page, dessen Ziel ein **Hostname** ist, meldet dies sowohl, wenn der Name zu einer abgelehnten Adresse aufgelöst wird, als auch, wenn DNS fehlschlägt, sodass sich mit einem Monitor nicht ermitteln lässt, welche internen Namen es gibt. Die zugehörigen Fehlerdetails nennen in beiden Fällen `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS`; sie sagen nicht, welcher Fall vorlag. Zeigt der Name auf eine private Adresse, prüfen Sie im Start-Log der Probe deren Richtlinie für private Netzwerke; ist sie aus, ist die Lösung dieselbe wie bei den Meldungen oben. Mit `LOG_LEVEL=DEBUG` protokolliert die Probe außerdem den genauen Grund für jeden abgelehnten Namen.
- _"Request URL could not be reached."_ – dieselbe Regel für einen Monitor vom Typ **Custom JavaScript Code**: Ein Skript, das einen **Hostnamen** anfragt, erhält dies sowohl, wenn der Name zu einer abgelehnten Adresse aufgelöst wird, als auch, wenn DNS fehlschlägt. Mit `LOG_LEVEL=DEBUG` protokolliert die Probe den genauen Grund.
- _"Webhook URL could not be reached."_ oder, aus einem Workflow, _"Request URL could not be reached."_ – die Instanz läuft mit `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` (oder `BILLING_ENABLED=true`), sodass ein abgelehnter **Hostname** nicht erklärt wird: Er wurde entweder zu einer abgelehnten Adresse aufgelöst oder gar nicht. Mit `LOG_LEVEL=DEBUG` protokolliert die App oder der Worker, welcher Fall es war, und die Adresse.
- _"...points to a private, loopback, or link-local address and is not allowed."_ – das Ziel liegt in der verbotenen Stufe. Für einen Webhook nennen Sie den genauen Host oder CIDR in `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST`, wenn Sie ihn wirklich brauchen. Für einen Monitor gibt es keine Ausnahme.
- _"...hostname could not be resolved via DNS."_ – der Container kann den Namen nicht auflösen. Prüfen Sie, ob er ein Netzwerk mit dem Ziel teilt.

## Sicherheitshinweise

Dies zu öffnen ändert tatsächlich, was Ihre OneUptime-Instanz erreichen kann; es lohnt sich also, bewusst vorzugehen:

- **Bevorzugen Sie die Allowlist gegenüber dem pauschalen Schalter.** `mattermost.internal` zu nennen ist eine viel kleinere Freigabe, als jede RFC-1918-Adresse zu öffnen.
- **Wer einen Workflow oder einen Monitor vom Typ API, Website, External Status Page oder Custom JavaScript Code erstellen kann, erreicht alles, was Sie erlaubt haben.** Behandeln Sie die Mitgliedschaft in diesen Projekten entsprechend.
- **Der Antworttext kommt zurück.** Eine API-Komponente in einem Workflow gibt Status, Header und Body in das Workflow-Log zurück; ein erlaubter Host ist also lesbar, nicht nur beschreibbar.
- **Weiterleitungen werden bei Webhook-Anfragen nie befolgt**, sodass ein erlaubter öffentlicher Host den Server nicht mit einem zweiten Sprung auf einen internen weiterleiten kann.
- **Begrenzen Sie wo möglich pro Probe statt instanzweit.** Eine in einem Netzwerk bereitgestellte Probe ist eine engere Freigabe, als den ausgehenden Verkehr des API-Servers zu öffnen.

## Nächste Schritte

:::cards
- [Eigene Probes](/docs/probe/custom-probe): Eine Probe in dem Netzwerk betreiben, das sie prüfen soll.
- [Workflow-Konfiguration](/docs/workflows/configuration): Was Workflow-Schritte erreichen und tun können.
- [LLM-Anbieter](/docs/ai/llm-provider): OneUptime AI mit einem Modell in Ihrem Netzwerk verbinden.
- [Architektur](/docs/self-hosted/architecture): Welcher Teil einer selbst gehosteten Installation welche Verbindung herstellt.
:::
