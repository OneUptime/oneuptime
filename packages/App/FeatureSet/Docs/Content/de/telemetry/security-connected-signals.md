# Verbundene Signale

Ein Sicherheitsfall sagt, um welche Benutzer, Hosts und Adressen es geht. Verbundene Signale sagt, welche davon OneUptime bereits kennt - Ihre Hosts, Container-Hosts, Kubernetes-Cluster, Netzwerkgeräte, Cloud-Ressourcen, Serverless-Funktionen, Dienste, die Monitore, die sie prüfen, und Mitglieder - und was auf jedem davon rund um den Fall geschah: seine Protokolle, Traces und Metriken, die Vorfälle und Warnungen, die darauf offen sind, die Monitore, die ihn überwachen, und was sich daran geändert hat. Außerdem durchsucht es Ihre Protokolle und Traces selbst nach ihnen: die Adresse eines Angreifers im Zugriffsprotokoll eines Webservers, eine durchgesickerte E-Mail-Adresse im Fehler einer Anwendung. Umgekehrt sagt die Seite eines Hosts, eines Clusters, einer Cloud-Ressource, eines Dienstes, eines Monitors oder eines Mitglieds, was Sicherheitsereignisse darüber gefunden hat.

:::cards
- [Wo Sie es sehen](#wo-sie-es-sehen): Die Seite eines Falls, der Tab eines Ereignisses, die Seite einer Entität und die Seiten dessen, was sie nennen.
- [Wie ein Wert zugeordnet wird](#wie-ein-wert-zugeordnet-wird): Was als derselbe Datensatz zählt und was nur möglicherweise.
- [Was jeder Datensatz zeigt](#was-jeder-datensatz-zeigt): Seine Signale rund um den Fall und was darauf offen ist.
- [In Ihren Protokollen und Traces](#in-ihren-protokollen-und-traces): Wo eine Adresse, eine Domain oder eine E-Mail-Adresse, die es nennt, in Ihren Protokollzeilen und Spans vorkommt.
- [Wer was sieht](#wer-was-sieht): Jeder Datensatz wird mit der eigenen Rolle des Lesers gelesen.
:::

## So funktioniert es

```mermaid title="Von einem Fall zu dem, was er nennt"
flowchart TB
    case["Ein Fall, ein Ereignis<br/>oder eine Entität"] --> values["Seine Benutzer, Hosts<br/>und Adressen"]
    values -->|"Exakt oder<br/>möglich"| records["Ihre Hosts, Cluster,<br/>Dienste und Mitglieder"]
    records --> signals["Ihre Protokolle,<br/>Traces, Metriken und<br/>was offen ist"]
    records --> cards["Eine Karte Sicherheit<br/>auf ihren Seiten"]
```

OneUptime sucht jeden Wert unter den Datensätzen des Projekts, sagt, wie sicher jede Übereinstimmung ist, und zeigt, was auf jedem Datensatz rund um den Fall geschah.

## Bevor Sie beginnen

- Eingehende Sicherheitsereignisse, und Hosts, Kubernetes-Cluster, Cloud-Ressourcen, Dienste, Monitore oder Mitglieder im Projekt, die sie nennen können. Siehe [Erste Schritte mit Sicherheit](/docs/telemetry/security-getting-started).
- Eine Rolle, die Sicherheitsereignisse lesen darf, und die Arten von Datensätzen, die Sie sehen möchten.

## Wo Sie es sehen

- **Verbundene Signale**, eine Seite jedes Sicherheitsfalls: Öffnen Sie einen Fall unter **Produkte → Sicherheitsereignisse → Sicherheitsfälle → Offene Fälle** und dann **Verbundene Signale** nach **Entitäten** in seinem Menü.
- **Verbunden**, ein Tab jedes Sicherheitsereignisses: Öffnen Sie ein Ereignis unter **Produkte → Sicherheitsereignisse → Ereignisse**. Er listet, was das Ereignis nennt, in der Stunde rund um das Ereignis.
- Die Seite einer Entität unter **Produkte → Sicherheitsereignisse → Entitätsrisiko**: wo OneUptime den Benutzer, den Host oder die Adresse kennt, rund um sein letztes Sicherheitsereignis.
- Eine Karte **Sicherheit** auf der Seite jedes Hosts, Docker-Hosts, Podman-Hosts, Kubernetes-Clusters, Netzwerkgeräts, jeder Cloud-Ressource, jeder Serverless-Funktion, jedes Dienstes, Monitors, Mitglieds und Inventarelements: die offenen Sicherheitsfälle, die ihn nennen, wie viele Sicherheitsereignisse und Befunde ihn in den letzten 7 Tagen genannt haben, der schwerste davon und sein Risiko. **In Sicherheitsereignissen öffnen** öffnet ihn dort. Die Karte eines Monitors handelt von den Hosts und Adressen, die er prüft.
- Eine Karte **Sicherheit** auf der Seite eines Vorfalls, wenn ein Sicherheitsfall den Vorfall gemeldet hat (**Gemeldet aus**) oder offene Fälle einen Host oder Cluster nennen, den er betrifft (**Offene Fälle, die nennen, was der Vorfall betrifft**).

## Wie ein Wert zugeordnet wird

Jeder Benutzer, jeder Host und jede Adresse, die ein Fall oder ein Ereignis nennt, wird unter den Datensätzen des Projekts gesucht:

| Was der Fall oder das Ereignis nennt | Zugeordnet zu | Wie sicher |
| --- | --- | --- |
| Ein Host- oder Domainname, der dem Namen entspricht, den ein Host, ein Container-Host, ein Cluster oder ein Netzwerkgerät meldet, oder ein Name, unter dem eine Cloud-Ressource antwortet | Diesem Datensatz | Exakt |
| Derselbe Name, ohne Angabe, dass es ein Host ist | Diesem Datensatz | Möglich |
| Eine Kurz- oder Langform des Namens eines Datensatzes, etwa `web-1` und `web-1.acme.internal` | Diesem Datensatz | Möglich |
| Eine öffentliche IP-Adresse, die nur ein Host oder Netzwerkgerät hat oder unter der nur eine Cloud-Ressource antwortet | Diesem Datensatz | Exakt |
| Eine private IP-Adresse oder eine, die mehr als ein Datensatz hat | Jedem Datensatz, der sie hat | Möglich |
| Die eigene ID einer Cloud-Ressource: eine AWS-ARN, eine Azure-Ressourcen-ID oder ein Google-Cloud-Ressourcenname | Dieser Cloud-Ressource | Exakt |
| Ein Host, eine öffentliche IP-Adresse oder der Host einer URL, die ein Monitor prüft | Diesem Monitor | Exakt |
| Eine private IP-Adresse, die ein Monitor prüft | Diesem Monitor | Möglich |
| Die E-Mail-Adresse eines Mitglieds | Diesem Mitglied | Exakt |
| Der Datensatz, unter dem eine Protokollzeile gesendet wurde, für die Ereignisse aus Ihren Protokollen | Diesem Host, Cluster, dieser Cloud-Ressource, Serverless-Funktion oder diesem Dienst | Exakt |
| Ein bloßer Benutzername, ein Datei-Hash oder ein Prozess | Nichts: Kein Datensatz ist danach geschlüsselt | - |

- Eine mögliche Übereinstimmung zeigt **Mögliche Übereinstimmung** neben ihrem Namen und sagt, warum. Sie wird auf der Seite des Datensatzes nie gezählt, und ein Vorfall, den der Fall meldet, wird nie mit ihr verknüpft.
- Was gesucht wurde und kein Datensatz des Projekts ist, steht unter **Kein passender Datensatz**. Ein Wert steht dort nie, wenn eine Art von Datensatz, die er sein könnte, nicht gelesen werden konnte.
- Für einen Fall werden höchstens 10 Datensätze aufgeführt, die exakten zuerst.

## Was jeder Datensatz zeigt

- Seine Signale, jedes geöffnet auf dem Datensatz und dem Zeitraum des Falls: **Protokolle**, **Traces** und **Metriken**, die **Ausnahmen** eines Dienstes, die **Kubernetes-Ereignisse** eines Clusters, die **Topologie** des Datensatzes und sein Element im **Inventar**, wenn das Inventar eines hat.
- Die Vorfälle und Warnungen, die jetzt darauf offen sind, und die Monitore, die ihn überwachen, jeweils mit ihrer eigenen Seite. Ein Monitor zeigt seinen Status neben seinem Namen, und seine **Protokolle** zeigen, was er bei jeder Prüfung gesehen hat.
- Die Bereitschaftspläne eines Mitglieds, mit **Jetzt in Bereitschaft** neben denen, für die es gerade Bereitschaft hat, und die Teams, in denen es ist.
- Was sich im Zeitraum daran geändert hat: die Deployments eines Dienstes, die Rollouts eines Clusters und die Behebungen eines Hosts.

| Wo | Zeitraum |
| --- | --- |
| Ein Fall | Von 30 Minuten vor seiner ersten Erkennung bis 30 Minuten nach seiner letzten, höchstens seine letzten 24 Stunden |
| Ein Ereignis | 30 Minuten davor und danach |
| Die Seite einer Entität | 30 Minuten vor und nach ihrem letzten Sicherheitsereignis |
| Die Karte **Sicherheit** eines Datensatzes | Die letzten 7 Tage |

## In Ihren Protokollen und Traces

Unter den Datensätzen durchsucht Verbundene Signale Ihre Protokolle und Traces im selben Zeitraum nach den Werten, die es nennt und die nur eines bedeuten können: eine IP-Adresse (außer `127.0.0.1` und den anderen, die jeder Rechner hat), ein vollständiger Host- oder Domainname, eine E-Mail-Adresse, eine URL, die ID einer Cloud-Ressource und ein Datei-Hash. Nach einem bloßen Hostnamen, dem bloßen Namen eines Benutzers und einem Prozess wird nie gesucht: Eine Protokollzeile kann sie aus jedem Grund enthalten. Es wird nach höchstens 10 Werten gesucht.

| Wo | Es nennt einen Wert, wenn |
| --- | --- |
| Die Nachricht einer Protokollzeile | Sie enthält den ganzen Wert, unabhängig von Groß- und Kleinschreibung: `10.0.0.1` in `from 10.0.0.1:52144`, nie in `10.0.0.12` oder `110.0.0.1` |
| Ein Attribut einer Protokollzeile oder eines Spans | Sein Wert ist genau der Wert: wie geschrieben, in Klein- oder Großbuchstaben oder eine IPv6-Adresse in ihrer Kurzform |

- Jeder gefundene Wert zeigt, wie viele Protokollzeilen und Spans ihn nennen, wo er darin stand - **In der Nachricht** oder ein Attribut mit seinem Schlüssel -, jeweils mit **Protokolle** oder **Traces** geöffnet auf diesen Zeilen oder Spans und dem Zeitraum, und die Datensätze, die sie gesendet haben, die meisten zuerst.
- Ein Ressourcenattribut wie `resource.host.name` sagt nur, welcher Datensatz eine Zeile gesendet hat, und wird nie gezählt.
- Die Werte, nach denen gesucht wurde und die keines von beiden nennt, stehen unter **Nicht in Ihren Protokollen oder Traces**.
- Sie werden mit Ihrer eigenen Rolle durchsucht: Protokolle oder Traces, die Ihre Rolle nicht lesen darf, werden genannt und nicht durchsucht; solche, die gerade nicht durchsucht werden konnten, sagen das, mit **Erneut versuchen**. Eine Suche, die länger als 15 Sekunden dauert, wird abgebrochen und sagt das.

## Wer was sieht

- Verbundene Signale und die Karte **Sicherheit** eines Datensatzes erfordern eine Rolle, die Sicherheitsereignisse lesen darf: Security Admin, Security Member, Security Viewer, Project Owner oder Project Admin. Alle anderen sehen auf keiner Seite Sicherheitsdaten. Siehe [Rollen](/docs/permissions/reference#rollen).
- Die Karte **Sicherheit** eines Vorfalls erfordert eine Rolle, die Sicherheitsfälle lesen darf.
- Jeder Datensatz wird mit Ihrer eigenen Rolle gelesen, und ebenso, was darauf ist: Eine Rolle, die keine Bereitschaftspläne lesen darf, sieht die eines Mitglieds nicht. Eine Art von Datensatz, die Ihre Rolle nicht lesen darf, wird weggelassen, und die Seite sagt das; eine, die gerade nicht gelesen werden konnte, sagt das ebenfalls, mit **Erneut versuchen**.
- Die Seite eines Datensatzes zeigt ihre Karte **Sicherheit** nur in einem Projekt, das Sicherheitsereignisse nutzt: einem, das in den letzten 7 Tagen ein Sicherheitsereignis erhalten hat.

## Vorfälle, die ein Fall meldet

**Vorfall melden** auf einem Fall oder ein Playbook-Schritt, der einen meldet, verknüpft den Vorfall mit den Hosts, Docker- und Podman-Hosts, Kubernetes-Clustern, Netzwerkgeräten, Cloud-Ressourcen und Diensten, mit denen der Fall exakt verbunden ist. Ein Playbook-Schritt, der die Bereitschaft alarmiert, verknüpft die Warnung, die er öffnet, auf dieselbe Weise; jede Warnung und jeder Vorfall, den eine Erkennungsregel oder ein Threat-Intelligence-Treffer öffnet, wird mit dem verknüpft, was der Treffer exakt nennt, und jeder, den Data Security öffnet, mit dem Datenspeicher, um den es geht. Der Vorfall erscheint auf ihren Seiten, die Regeln ihrer Besitzer gelten für ihn, und sein Feed nennt den Fall und das, womit er verknüpft wurde. Eine mögliche Übereinstimmung wird nie verknüpft, und ein Monitor auch nicht: Ein Vorfall auf einem Monitor kann seinen Status ändern und auf seinen Statusseiten erscheinen.

## OneUptime AI

Die Triage eines Falls durch OneUptime AI liest seine verbundenen Signale: was offen ist und was sich an den Hosts, Diensten, Monitoren und Mitgliedern geändert hat, die der Fall nennt, die Bereitschaftspläne und Teams eines Mitglieds und wo seine Werte in Ihren Protokollen und Traces vorkommen. Die Untersuchung eines Vorfalls liest den Sicherheitsfall, der ihn gemeldet hat, und die offenen Fälle, die nennen, was er betrifft. Siehe [OneUptime AI in der Sicherheit](/docs/telemetry/security-ai).

## Fehlerbehebung

:::details Ein Host, den der Fall nennt, wird nicht aufgeführt
Prüfen Sie, ob der Fall den Host so nennt, wie der Host sich selbst nennt, oder eine öffentliche Adresse nennt, die nur dieser Host hat. Ein Kurzname wie `web-1` für `web-1.acme.internal` wird als mögliche Übereinstimmung aufgeführt, und ein bloßer Benutzername, ein Datei-Hash oder ein Prozess wird gar nicht gesucht. Eine URL wird nur unter den Monitoren gesucht, die ihren Host prüfen.
:::

:::details Eine Adresse, die der Fall nennt, ist nicht in seinen Protokollen und Traces
Nur der Zeitraum des Falls wird durchsucht, und nur die Protokolle und Traces, die Ihre Rolle lesen darf. Eine Nachricht nennt eine Adresse nur als Ganzes: `10.0.0.12` ist eine andere Adresse, auch wenn die Nachrichtensuche des Protokoll-Explorers sie ebenfalls findet. Ein Attribut nennt sie nur, wenn sein Wert genau die Adresse ist, und ein Ressourcenattribut nie.
:::

:::details Der richtige Host wird als mögliche Übereinstimmung aufgeführt
Eine mögliche Übereinstimmung wird nie gezählt oder verknüpft, damit ein Name, den zwei Rechner teilen, Ihnen nie etwas über den falschen sagt. Lassen Sie Ihre Protokolle und Erkennungen den Host mit dem Namen nennen, den er meldet.
:::

:::details Die Seite eines Hosts hat keine Karte Sicherheit
Die Karte wird einer Rolle gezeigt, die Sicherheitsereignisse lesen darf, in einem Projekt, das in den letzten 7 Tagen ein Sicherheitsereignis erhalten hat. Ein Host, den in dieser Zeit nichts genannt hat, zeigt eine Zeile, die das sagt.
:::

:::details Die Seite eines Monitors hat keine Karte Sicherheit
Die Karte erscheint für einen Monitor, der einen Host, eine Adresse oder eine URL prüft: einen Website-, API-, Ping-, Port-, SSL-Zertifikat-, DNS- oder Domain-Monitor. Ein Heartbeat, ein Skript oder ein Monitor Ihrer Telemetrie prüft keinen Host und hat daher keine.
:::

:::details Die Seite sagt, dass Ihre Rolle eine Art von Datensatz nicht sehen kann
Jeder Datensatz wird mit Ihrer eigenen Rolle gelesen. Bitten Sie einen Project Owner oder Project Admin um eine Rolle, die diese Art von Datensatz lesen darf.
:::

## Nächste Schritte

:::cards
- [Sicherheitsfälle und Playbooks](/docs/telemetry/security-cases): Einen Fall bearbeiten und daraus einen Vorfall melden.
- [Sicherheitsereignisse (SIEM)](/docs/telemetry/security-events): Die Ereignisse hinter einem Fall und die Protokolle, aus denen sie gelesen werden.
- [Entitätsrisiko (risikobasierte Alarmierung)](/docs/telemetry/security-entity-risk): Die Seite einer Entität, ihr Risiko und wo OneUptime sie kennt.
- [OneUptime AI in der Sicherheit](/docs/telemetry/security-ai): Wie eine Triage liest, was ein Fall nennt.
:::
