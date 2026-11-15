# KI fragen

KI fragen ist der Chat von OneUptime über die Daten Ihres Projekts. Fragen Sie nach Logs, Traces, Metriken, Ausnahmen, Vorfällen, Warnungen, Monitoren, Bereitschaft, Statusseiten, SLOs, Runbooks oder Workflows: Der Chat fragt Ihr Projekt live ab, belegt jede Aussage mit einer Quelle und handelt für Sie, wenn Sie es erlauben.

:::cards
- [KI fragen öffnen](#ki-fragen-öffnen): Aus der Kopfzeile, per Tastatur, aus einem Diagramm oder über das Produktmenü.
- [Was KI fragen sehen kann](#was-ki-fragen-sehen-kann): Die Daten, die der Chat für seine Antworten liest.
- [Aktionen und Berechtigungsmodi](#aktionen-und-berechtigungsmodi): Legen Sie fest, ob er handeln darf und wann er vorher fragt.
- [Aktionen erfolgen in Ihrem Namen](#aktionen-erfolgen-in-ihrem-namen): Ihre Berechtigungen, Ihr Name an jeder Änderung.
:::

## Wie KI fragen antwortet

KI fragen antwortet nur mit dem, was seine Werkzeuge zurückgeben: Der Chat führt Abfragen gegen Ihr Projekt aus, statt aus dem Gedächtnis zu antworten. Jede Tatsache in einer Antwort trägt einen Quellenchip, der die zugrunde liegende Abfrage zeigt und die gelesenen Daten öffnet. Wenn Sie ihn bitten, etwas zu ändern, entscheidet der Berechtigungsmodus der Unterhaltung, ob er Sie vorher fragt. Vor Ihrer Frage liest er den [KI-Kontext](/docs/ai/ai-context) des Projekts: was Ihr Team für OneUptime AI über Ihre eigenen Systeme aufgeschrieben hat.

```mermaid title="Von der Frage zur belegten Antwort"
flowchart TB
    Q["Ihre Frage, mit<br/>der Seite, auf der<br/>Sie gerade sind"] --> A["KI fragen"]
    A -->|"Lesewerkzeuge"| D["Die Daten Ihres<br/>Projekts, live<br/>abgefragt"]
    D --> R["Eine Antwort mit<br/>einer Quelle je<br/>Aussage"]
    A -->|"eine Aktion"| M{"Der Berechtigungs-<br/>modus"}
    M -->|"Ask to act"| C["Eine Genehmigungs-<br/>karte: Sie lassen zu<br/>oder überspringen"]
    M -->|"Auto-run"| X["Sie läuft, in<br/>Ihrem Namen"]
    C -->|"zugelassen"| X
```

Im Modus **Nur Lesezugriff** werden dem Modell keine Aktionen angeboten, die Unterhaltung liest also nur.

## Fragen zu OneUptime

KI fragen beantwortet auch Fragen zu OneUptime selbst: „Wie bekomme ich eine SMS, wenn meine Website ausfällt?“, „Was ist eine Episode?“, „Wo füge ich eine zweite Telefonnummer hinzu?“. Die Antworten stammen aus dieser Dokumentation, der Kopie, die Ihr OneUptime selbst ausliefert: Das funktioniert ohne Internetzugang und schickt nichts an neue Stellen. Eine übersetzte Seite liest es in Ihrer Sprache, zu jedem Schritt nennt es Seite und Abschnitt, und steht etwas nicht in der Dokumentation, sagt es das, statt zu raten.

Eine Antwort auf „Wie mache ich …?“ endet mit einer Schaltfläche, die die Seite Ihres Projekts öffnet, auf der Sie es tun, etwa **Monitor erstellen** oder **Benachrichtigungsmethoden**. Sie öffnet nur Seiten, die OneUptime hat: die, die die Suche (`Ctrl` + `K`) findet.

## KI fragen öffnen

| Wo | Wie |
| --- | --- |
| Auf jeder Seite | Klicken Sie in der Kopfzeile auf **KI fragen** oder drücken Sie `Ctrl` + `I` (`Cmd` + `I` auf einem Mac). Während Sie in ein Textfeld oder einen Editor tippen, bleibt die Tastenkombination die Kursiv-Taste des Editors. |
| Die Befehlspalette | Drücken Sie `Ctrl` + `K` (`Cmd` + `K` auf einem Mac) und wählen Sie **KI fragen**. |
| Ein Fehlermuster in den Logs oder die Befunde eines Diagramms | Klicken Sie auf **Mit KI erklären**: KI fragen öffnet sich mit den Belegen als Frage, die Sie vor dem Senden bearbeiten können. |
| Das Produktmenü | Öffnen Sie **Produkte → KI → Chat**. KI fragen öffnet sich neben der Seite, auf der Sie waren. Jede Unterhaltung hat eine eigene Adresse, sodass Sie sie als Lesezeichen speichern und später wieder aufrufen können. |

KI fragen öffnet sich am Rand des Fensters, und die Seite macht dafür Platz: Nichts wird dahinter verdeckt, sodass Sie auf der Seite weiterarbeiten, zu anderen Seiten wechseln und erneut fragen können. Ziehen Sie den Rand, um den Bereich breiter oder schmaler zu machen. Drücken Sie darin `Esc` oder klicken Sie erneut auf **KI fragen**, um der Seite das ganze Fenster zurückzugeben. Ist der Bereich offen, springt `Ctrl` + `I` (`Cmd` + `I` auf einem Mac) von der Seite in das Eingabefeld und schließt ihn von dort aus. Die Unterhaltung bleibt, wo Sie sie verlassen haben: Öffnen Sie KI fragen erneut, um weiterzumachen. Schließen Sie den Chat, während er noch antwortet, sagt ein Hinweis in der Ecke, wann die Antwort fertig ist, und öffnet sie. Auf einem Tablet oder Telefon, wo für beides kein Platz ist, öffnet er sich über der Seite und füllt auf einem Telefon den ganzen Bildschirm.

Bei einem Vorfall oder einer Warnung hat die Karte **OneUptime AI** eine eigene Unterhaltung, **OneUptime AI fragen**, die alle teilen, die diesen Vorfall oder diese Warnung sehen können: siehe [Mit OneUptime AI über den Vorfall sprechen](/docs/ai/ai-sre#mit-oneuptime-ai-über-den-vorfall-sprechen).

## Was KI fragen sehen kann

KI fragen liest Ihr Projekt mit Ihren eigenen Berechtigungen und sieht daher genau das, was Sie sehen dürfen, und nicht mehr.

| Bereich | Was KI fragen liest |
| --- | --- |
| Telemetrie | Logsuche und Histogramme, Trace-Aggregationen und Span-Bäume, Metriken, Ausnahmen, Sicherheitsereignisse, Real User Monitoring und Web Vitals, jüngste Änderungen sowie Anomalieprüfungen gegen gelernte Baselines. |
| Infrastruktur | Hosts, Docker, Podman, Kubernetes, Docker Swarm, Proxmox, VMware vCenter, Ceph, Speicher-Arrays, Serverless-Funktionen, Cloud-Umgebungen, IoT-Flotten und Netzwerkgeräte: was im Inventar ist, ihr gemeldeter Verbindungsstatus, Metrik-Trends, Anzahl der Logs je Schweregrad und Zusammenfassungen der Trace-Operationen. Eine Abfrage umfasst Telemetrie, die einen Dienst nennt, ebenso wie solche, die eine Infrastrukturressource nennt. |
| Vorfallreaktion | Vorfälle und Warnungen, mit Statusfiltern („was ist gerade aktiv?“), ihren Aktivitätszeitleisten (Statuswechsel, interne und öffentliche Notizen, der Feed) und Verantwortlichen sowie eine Suche in früheren Vorfällen, um ihre Lösung wiederzuverwenden. |
| Bereitschaft | Wer gerade Bereitschaft hat, Richtlinien und Eskalationsketten und ob die letzten Benachrichtigungen zugestellt und bestätigt wurden. |
| Die eigene Arbeit der KI | Die Ergebnisse der Untersuchungen von AI SRE und der KI-Einblicke, sodass „was hat die KI gefunden?“ aus der veröffentlichten Analyse beantwortet wird, statt es neu zu erarbeiten. |
| Plattform | Monitore (mit Statusfiltern), geplante Wartungen, Statusseiten und ihre Ankündigungen, SLOs, Runbooks, Workflow-Ausführungen, der Zustand der Probes, Teams und der Code verbundener Repositories auf GitHub, GitLab, Forgejo, Gitea und Azure DevOps (siehe [Was die KI in einem Git-Repository liest](/docs/ai/ai-agent#was-die-ki-in-einem-git-repository-liest)). |

## Seitenkontext

KI fragen weiß, von welcher Seite aus Sie den Chat geöffnet haben. Auf einer Vorfallseite meint „warum ist das passiert?“ genau diesen Vorfall: Der Eingabebereich zeigt einen Chip mit dem Gegenstand der Seite, und die vorgeschlagenen Fragen sind die dieser Seite. Entfernen Sie den Chip, um nach dem ganzen Projekt zu fragen, und fügen Sie ihn auf dieselbe Weise wieder hinzu. Öffnen Sie KI fragen auf einer anderen Seite, folgt Ihnen der Kontext. Die Unterhaltung merkt sich ihren ersten Gegenstand auch auf dem Server, sodass eine Nachfrage Tage später „diesen Vorfall“ noch richtig zuordnet.

Auf einem Vorfall, einer Warnung, einem Monitor oder einem Wartungsereignis richten sich die Fragen auch danach, wo dieser Datensatz steht; das liest KI fragen jedes Mal, wenn Sie den Chat darauf öffnen. Ein behobener Vorfall fragt, wie die Reaktion verlief und was eine Wiederholung verhindern würde, eine behobene Warnung, ob sie ein echtes Problem war und wie oft Warnungen wie sie ausgelöst werden, und ein Monitor, der nicht betriebsbereit ist, fragt nach dem Grund. Ein Wartungsereignis, das noch nicht begonnen hat, fragt, ob seine Monitore vorher gesund sind, und eines, das beendet ist, ob sie wieder normal laufen.

Infrastrukturlisten und Ressourcenseiten bieten Fragen zu der Art Ressource an, die Sie gerade ansehen. Öffnen Sie einen Kubernetes-Cluster und fragen Sie „Welche Metriken haben sich in den letzten 24 Stunden verändert?“, oder öffnen Sie einen Docker-Host und fragen Sie „Fasse die Log-Schweregrade und Trace-Fehler der letzten sechs Stunden zusammen.“ Belegverweise führen zurück zur Seite der Ressource. Lesezugriffe beachten Ihre Berechtigungen für Projekt, Ressourcen und Telemetrie, einschließlich der Einschränkungen nach Verantwortlichen und Labels.

Auf der Seite eines untergeordneten Objekts hält der Kontext zusätzlich den Pod, Container, die VM, den Prozess oder das andere Objekt fest, das Sie ausgewählt haben. Die Infrastrukturwerkzeuge lesen die Telemetrie der übergeordneten Ressource; ein einzelnes untergeordnetes Objekt können sie nicht allein anhand seines Namens messen. KI fragen sagt das und errät keinen Kubernetes-Namespace, den die Seite nicht angibt. Ein Verbindungsstatus ist nicht der Zustand eines Workloads, und fehlende Telemetrie bedeutet nicht, dass eine Ressource gesund ist.

## Befehle auf Ihrer Infrastruktur

Auf der Seite einer Ressource geöffnet, deren KI-Agent verbunden ist (ein Host, ein Docker- oder Podman-Host, ein Docker-Swarm-Cluster, ein Proxmox-Cluster, ein VMware vCenter, ein Ceph-Cluster, ein Datenbankserver oder ein Kubernetes-Cluster), führt KI fragen über diesen Agenten Befehle darauf aus, wenn Sie darum bitten: „führe `uptime` auf diesem Host aus“ oder „zeige die letzten 100 Zeilen von `journalctl -u nginx`“. Die Antwort zeigt, was zurückkam, belegt wie jeder andere Nachweis. Auf einem Vorfall oder einer Warnung geöffnet, erreicht KI fragen die damit verknüpften Ressourcen.

- Ausgeführt werden nur die nur lesenden Befehle, die eine KI-Untersuchung auf dieser Art Ressource ausführen darf (siehe [KI-Agenten für die Infrastruktur](/docs/ai/infrastructure-ai-agents)), so viele, wie die Antwort braucht, geprüft von OneUptime und erneut vom Agenten, in jedem Berechtigungsmodus. Eine Änderung über den Agenten, etwa der Neustart eines Dienstes, wird aus KI fragen nie ausgeführt: Sie erhalten stattdessen den genauen Befehl, und der Agent ändert nur dann etwas, wenn OneUptime AI einen Vorfall oder eine Warnung behebt, nach den eigenen Korrektureinstellungen der Ressource. Die eigenen Aktionen von KI fragen, etwa das Ausführen eines Runbooks, folgen dem Berechtigungsmodus der Unterhaltung, wie unten beschrieben.
- Erreicht werden nur die Ressourcen, die Sie sehen dürfen, und nur, solange die KI-Untersuchung für die Ressource eingeschaltet ist.
- Kann KI fragen dort keinen Befehl ausführen (kein Agent ist verbunden, der Agent ist offline oder die KI-Untersuchung ist für die Ressource ausgeschaltet), sagt es das, samt dem, was zu ändern ist, und antwortet stattdessen aus den Daten Ihres Projekts.

## Aktionen und Berechtigungsmodi

Jede Unterhaltung hat einen Berechtigungsmodus, den Sie im Eingabebereich neben dem Textfeld wählen:

| Modus | Was passiert |
| --- | --- |
| **Vor Aktionen fragen** | Die Voreinstellung. KI fragen schlägt jede Aktion auf einer Genehmigungskarte vor, und nichts läuft, bis Sie für sie **Zulassen** oder **Überspringen** wählen, oder **Alle ablehnen**. |
| **Automatisch ausführen** | Aktionen laufen, sobald das Modell sie anfordert, weiterhin begrenzt auf das, was Ihre Rolle darf. Setzen Sie diesen Modus mit Bedacht ein. |
| **Nur Lesezugriff** | Dem Modell werden überhaupt keine Aktionen angeboten: KI fragen kann nur lesen. |

Was KI fragen tun kann, wenn ein Modus es erlaubt:

- Einen Vorfall oder eine Warnung anlegen, Vorfälle und Warnungen bestätigen oder lösen und den Schweregrad eines Vorfalls ändern.
- Einen Vorfall oder eine Warnung mit der Infrastruktur und den Diensten verknüpfen, um die es geht. Einen Vorfall oder eine Warnung, die es auf der Seite einer Ressource anlegt, etwa der eines Hosts, verknüpft es mit dieser Ressource, und die Freigabekarte nennt, womit jede Aktion verknüpft. OneUptime AI untersucht und behebt, womit ein Vorfall oder eine Warnung verknüpft ist.
- Ein Problem festhalten, um das sich schon jemand kümmert oder das schon vorbei ist: Ein Vorfall oder eine Warnung, die es anlegt, kann bereits bestätigt oder behoben beginnen und alarmiert dann niemanden. Die Freigabekarte sagt, welches von beiden. Siehe [Bereits bestätigt oder behoben gemeldet](/docs/incidents/declaring-incidents#bereits-bestätigt-oder-behoben-gemeldet).
- Eine interne Notiz zu einem Vorfall oder einer Warnung veröffentlichen. Interne Notizen erscheinen nie auf einer Statusseite.
- Eine öffentliche Statusmeldung zu einem Vorfall veröffentlichen. Das ist eine eigene Aktion, weil sie die Abonnenten der Statusseite benachrichtigt.
- Eine Bereitschaftsrichtlinie alarmieren, ein Runbook ausführen oder eine KI-Untersuchung eines Vorfalls oder einer Warnung starten.
- Dinge aus einem Satz einrichten: eine Website- oder API-Überwachung, wer alarmiert wird, eine Statusseite und die Monitore, die sie zeigt, alles auf einer Genehmigungskarte. Siehe [Dinge einrichten](#dinge-einrichten).
- Eine Codeänderung vorschlagen: in einen neuen Branch eines Repositorys auf GitHub, GitLab, Forgejo oder Gitea committen und einen Pull Request öffnen (auf GitLab einen Merge Request). Er schreibt nie in den Standard-Branch oder einen geschützten Branch, sodass weiterhin ein Mensch die Änderung mergt. Ask AI schreibt jede Datei vollständig, ausgehend von der Datei, wie es sie zuletzt gelesen hat, und liest den Hauptbranch eines Repositorys, sofern es nicht um einen anderen gebeten wird. Wurde eine Datei auf dem Branch geändert, nachdem Ask AI sie gelesen hat, nennt die Karte sie, bevor Sie den Commit oder den Pull Request genehmigen, etwa „Diese Datei wurde auf fix/login geändert, nachdem die KI sie gelesen hat, und die Version der KI macht diese Änderung rückgängig: src/billing/charge.ts.“ Die Karte nennt auch eine Datei, die Ask AI nur auf einem anderen Branch gelesen hat, wo sie anders ist, eine Datei, die Ask AI nie gelesen hat, aber ersetzt, und eine Datei, die OneUptime nicht prüfen konnte. Ask AI liest eine lange Datei Stück für Stück, daher nennt die Karte auch eine Datei, die Ask AI nur zum Teil gelesen hat, etwa „Die KI hat nur einen Teil dieser Datei gelesen, und ihre Version ersetzt die ganze Datei: src/billing/charge.ts.“ Hat Ask AI die ganze Datei gelesen, in einem Durchgang oder in mehreren, sagt die Karte nichts dazu. Eine spätere Antwort kennt die Worte der früheren, nicht die Dateien, die sie gelesen haben, daher nennt die Karte auch eine Datei, die Ask AI nur in einer früheren Antwort gelesen hat, etwa „Die KI hat diese Datei in einer früheren Antwort gelesen und kennt ihren Text nicht mehr, und die Version der KI ersetzt die ganze Datei: src/billing/charge.ts.“ Eine sehr lange Antwort lässt außerdem ihre ältesten Ergebnisse weg, um innerhalb dessen zu bleiben, was das Modell auf einmal aufnehmen kann, daher nennt die Karte auch eine Datei, die Ask AI zuvor in derselben Antwort gelesen hat, wenn dieses Ergebnis weggelassen wurde, etwa „Die KI hat diese Datei zuvor in dieser Antwort gelesen und kennt ihren Text nicht mehr, und die Version der KI ersetzt die ganze Datei: src/billing/charge.ts.“ Hat Ask AI die Datei in mehreren Teilen gelesen und kennt nicht mehr alle davon, sagt die Karte auch das, etwa „Die KI hat diese Datei gelesen und kennt einen Teil ihres Textes nicht mehr, und die Version der KI ersetzt die ganze Datei: src/billing/charge.ts.“ Liest Ask AI die Datei in der Antwort, die sie ändert, erneut, sagt die Karte nichts dazu. Eine neue Datei zählt nie. Um zu behalten, was jemand anderes geändert hat, überspringen Sie die Aktion und bitten Sie Ask AI, die Dateien erneut zu lesen. Im Modus „Automatisch ausführen“, in dem niemand Aktionen zustimmt, nimmt Ask AI eine solche Änderung nicht vor: Es liest die Dateien erneut und nimmt seine Änderung an ihnen in ihrem jetzigen Stand vor. Ändert sich eine Datei, während die Karte auf Sie wartet, bewirkt die Genehmigung nichts, und Ask AI schlägt die Änderung erneut vor. Ein Pull Request, den Sie trotzdem genehmigen, nennt diese Dateien in seiner Beschreibung, für die Person, die ihn prüft. Ask AI bekommt Werte, die wie Geheimnisse oder personenbezogene Daten aussehen, etwa IP-Adressen, E-Mail-Adressen und Schlüssel, nie zu sehen: Es liest an ihrer Stelle einen Platzhalter wie `[redacted-ip]`. Daher nennt die Karte auch eine Datei, in die die Version von Ask AI solche Platzhalter schreibt, etwa „Werte, die wie Geheimnisse oder personenbezogene Daten aussehen, wurden vor der KI verborgen, und die Version der KI schreibt an deren Stelle Platzhalter in diese Datei: config/servers.ts.“ Ein Platzhalter, den die Datei auf dem Branch schon enthält, zählt nicht. Ask AI kann diese Werte nicht zurückschreiben, daher nimmt es diese Änderung im Modus „Automatisch ausführen“ nicht vor und sagt Ihnen stattdessen, was zu ändern ist.

Fragen Sie nach einem Vorfall, wenn Benutzer betroffen sind, und nach einer Warnung, wenn etwas zuerst die Aufmerksamkeit Ihres Teams braucht, etwa wenn der Speicher eines Hosts immer weiter steigt. Beides wird einmal angelegt und überwacht nichts: Um jedes Mal benachrichtigt zu werden, wenn der Speicher eines Hosts 75 % übersteigt, legen Sie eine [Host-Überwachung](/docs/monitor/host-monitor#fertige-warnungsvorlagen) aus ihrer Speichervorlage an, mit 75 % als Schwellenwert. KI fragen richtet nur Website- und API-Überwachungen ein (siehe [Dinge einrichten](#dinge-einrichten)). Nach einer anderen Art gefragt, sagt es das, prüft den aktuellen Wert und bietet an, eine Warnung auszulösen, wenn er schon darüber liegt.

## Aktionen erfolgen in Ihrem Namen

Jede Aktion, die KI fragen ausführt, erfolgt in Ihrem Namen: Sie bewirkt dieselbe Änderung wie das Dashboard für dieselbe Aktion, mit Ihren eigenen Berechtigungen im Projekt, und die Änderung wird Ihnen zugeschrieben. Wird ein Vorfall aus dem Chat bestätigt, entsteht derselbe Statuswechsel wie über das Statusfeld des Vorfalls, sodass Zeitleiste und Feed des Vorfalls zeigen, dass Sie seinen Status geändert haben. Eine aus dem Chat gesendete Alarmierung zeigt Sie als Auslöser.

- **Was jede Aktion braucht.** Die Berechtigung, die das Dashboard für dieselbe Änderung verlangt. Einen Vorfall oder eine Warnung anzulegen erfordert die Berechtigung, sie anzulegen: eine Rolle, die das darf, oder **Create Incident** oder **Create Alert** in einer benutzerdefinierten Rolle. Einen Vorfall zu bestätigen oder zu lösen erfordert die Berechtigung, seinen Status zu ändern: **Projektinhaber**, **Projektadministrator**, **Projektmitglied**, **Vorfall-Administrator** und **Vorfall-Mitglied**, oder **Create Incident State Timeline** in einer benutzerdefinierten Rolle; eine Warnung braucht dieselbe Berechtigung für Warnungen (**Create Alert State Timeline**). Einen Vorfall oder eine Warnung anzulegen, die bereits bestätigt oder behoben beginnt, erfordert beides: die Berechtigung, sie anzulegen, und die Berechtigung, ihren Status zu ändern. Eine Bereitschaftsrichtlinie zu alarmieren erfordert die Berechtigung, sie auszuführen (**Execute On-Call Policies**), und ein Runbook auszuführen erfordert die Berechtigung, Runbook-Ausführungen zu starten: eine Rolle, die Runbooks ausführt, für die Runbooks, die ihre Labels erreichen, oder **Create Runbook Execution** in einer benutzerdefinierten Rolle, die jedes Runbook des Projekts erreicht. Den Schweregrad eines Vorfalls zu ändern, eine KI-Untersuchung eines Vorfalls oder einer Warnung zu starten und Code in ein verbundenes Repository zu schreiben, erfordert die Berechtigung, diesen Vorfall, diese Warnung oder dieses Repository zu ändern. Eine Aktion, die Sie nicht ausführen dürfen, wird abgelehnt, und die KI sagt Ihnen, welche Berechtigung sie braucht. Haben Sie die Berechtigung, blockiert sie aber ein Team, dem Sie angehören, sagt die KI Ihnen das: Eine Blockierung für bestimmte Labels lehnt diese Aktion in KI fragen für jeden Datensatz ab, nicht nur für Datensätze mit diesen Labels.
- **Welche Datensätze.** Die, die Sie ändern dürfen, wie überall in OneUptime: Mit einer Rolle, die auf bestimmte Labels oder auf Ihre eigenen Datensätze beschränkt ist, ändert eine Aktion an jedem anderen Datensatz nichts. Ein Runbook läuft nur, wenn Ihre Berechtigung, Runbook-Ausführungen zu starten, es erreicht. In OneUptime Cloud wird eine Aktion, die der Tarif des Projekts nicht umfasst, mit dem nötigen Tarif abgelehnt.
- **Wenn eine Aktion abgelehnt wird.** Nichts ändert sich, und die KI sagt Ihnen klar, dass die Aktion nicht ausgeführt wurde und warum, statt sie erneut zu versuchen. Unter den Schritten der Antwort sagt der Schritt der Aktion, dass sie nicht ausgeführt wurde, und warum: Ihre Rolle erlaubt es nicht, ein Team, dem Sie angehören, blockiert es, oder der Tarif des Projekts umfasst es nicht.
- **Slack, Microsoft Teams und KI-Untersuchungen.** Die Antworten der KI in Slack und Microsoft Teams sowie autonome KI-Untersuchungen lesen nur: Sie führen keine dieser Aktionen aus. Um eine Änderung gebeten, sagt die KI, wie Sie sie im Chat vornehmen: `/oneuptime incident` meldet einen Vorfall, `/oneuptime incident 42` zeigt Vorfall 42 mit seinen Schaltflächen, `/oneuptime page` alarmiert jemanden (in Microsoft Teams dieselben Worte an den OneUptime-Bot), und die Schaltflächen an den Nachrichten von OneUptime handeln ebenfalls in Ihrem Namen (siehe [Slack](/docs/workspace-connections/slack#aus-slack-auf-vorfälle-warnungen-und-ereignisse-reagieren) und [Microsoft Teams](/docs/workspace-connections/microsoft-teams#aus-microsoft-teams-auf-vorfälle-warnungen-und-ereignisse-reagieren)). Für jede andere Änderung verlinkt sie auf KI fragen, das die Änderung vorschlägt und Sie freigeben lässt. Im eigenen Kanal eines Vorfalls oder einer Warnung gefragt, nimmt sie diesen Vorfall oder diese Warnung als den gemeinten.

## Dinge einrichten

KI fragen richtet aus einem Satz ein, was die geführten Einrichtungen einrichten: „Überwache example.com jede Minute und schick mir eine SMS, wenn es ausfällt.“

- **Ein Plan, eine Genehmigung.** KI fragen schlägt jeden Teil auf einer Genehmigungskarte vor, jeden in klaren Worten: eine Website- oder API-Überwachung, die erste Bereitschaftsrichtlinie des Projekts, eine Statusseite und die Monitore, die sie zeigt. Die Karte endet mit „Sonst ändert sich nichts.“ Wählen Sie **Überspringen** bei jedem Teil, den Sie nicht wollen, und führen Sie den Rest aus. Bis dahin wird nichts angelegt.
- **Immer gefragt.** Das Einrichten wartet in jedem Modus auf Ihre Genehmigung, auch bei **Automatisch ausführen**, weil es Dinge anlegt, die Personen alarmieren und die Ihre Kunden sehen. **Nur Lesezugriff** bietet es nicht an.
- **Die Datensätze der geführten Einrichtungen.** Die Überwachung ist die, die **Wissen, wenn meine Website oder API ausfällt** für dieselbe Adresse anlegt: mit den Standardwerten von „Monitor erstellen“, sie öffnet einen Vorfall, wenn die Adresse nicht antwortet oder mit einem Fehler antwortet, und wird alle 5 Minuten geprüft, sofern Sie nicht um ein anderes Intervall von „Monitor erstellen“ bitten. Sie gehört Ihnen, daher erhalten Sie eine E-Mail, wenn sich ihr Status ändert. Die Statusseite ist die, die **Statusseite veröffentlichen** anlegt: öffentlich, sobald sie angelegt ist, mit Status, Verfügbarkeit und Verlauf jedes Monitors.
- **Wer alarmiert wird.** In einem Projekt, das noch niemanden alarmiert, schlägt KI fragen die erste Bereitschaftsrichtlinie des Projekts vor, „Default on-call policy“, die Sie und die Mitglieder und Teams, die Sie nennen, bei jedem neuen Vorfall und jeder neuen Warnung alarmiert. Ein Projekt, das bereits Personen alarmiert, behält seine eigenen Bereitschaftsrichtlinien und -regeln, und KI fragen sagt das, statt eine weitere anzulegen.
- **Was fehlt.** KI fragen fügt nie eine Telefonnummer oder die mobile App hinzu: Sie fügen sie unter **Benutzereinstellungen → Benachrichtigungsmethoden** hinzu und bestätigen sie. Bitten Sie um SMS, ohne eine bestätigte Nummer zu haben, sagt die Karte das, und die Antwort verlinkt die Seite. Einen Teil, den KI fragen nicht anlegen kann, schlägt es nicht vor, etwa wenn Ihre Rolle es nicht erlaubt, die Adresse keine ist oder die Monitore nicht existieren: Die Antwort sagt, was nötig ist.
- **Was jeder Teil braucht.** Eine Überwachung braucht die Berechtigung, Monitore anzulegen. Die Alarmierung braucht die Berechtigung, Bereitschaftsrichtlinien, ihre Eskalationsregeln sowie Bereitschaftsregeln für Vorfälle und Warnungen anzulegen. Eine Statusseite braucht die Berechtigung, Statusseiten anzulegen und ihnen Monitore hinzuzufügen. Die Tariflimits des Projekts gelten wie bei den geführten Einrichtungen.
- **Dann testen.** Sobald der Plan gelaufen ist, öffnet jede Karte, was angelegt wurde, und **Diese Richtlinie testen** (oder **Mir eine Test-Alarmierung senden**, bei einer Überwachung allein) unter der Antwort sendet eine Test-Alarmierung, die Sie in der Nachricht bestätigen. Schlägt ein Teil fehl, sagt die Antwort, was angelegt wurde und was nicht.
- **Wer benachrichtigt wird.** Fragen Sie „Wer wird benachrichtigt, wenn example.com ausfällt?“, und KI fragen antwortet aus derselben Kette, die die Seite der Überwachung zeigt, und nennt jede Unterbrechung.

## Eine Unterhaltung steuern

- **Anhalten.** Während KI fragen arbeitet, wird die Senden-Schaltfläche zu einer Stopp-Schaltfläche. Halten Sie einen Lauf jederzeit an und fragen Sie sofort etwas anderes.
- **Die Arbeit verfolgen.** Während der Chat antwortet, sagt eine Zeile, was er gerade tut, etwa Protokolle durchsuchen. Klicken Sie auf die Zahl der Schritte daneben, um jeden Schritt zu sehen.
- **Das Modell wählen.** Wenn Ihr Projekt mehr als einen LLM-Anbieter nutzen kann, listet die Anbieterauswahl im Eingabebereich die LLM-Anbieter Ihres Projekts und die globalen auf, der Standardanbieter ist markiert. Eine neue Unterhaltung nutzt den Standardanbieter.
- **Eine Antwort bewerten.** **Gute Antwort** und **Schlechte Antwort** werden mit der Nachricht gespeichert, sodass sich die Qualität der Antworten über die Zeit messen lässt.
- **Die Kosten sehen.** Unter jeder Antwort öffnen sich ihre Quellen zu den Abfragen, die sie ausgeführt hat, und die der neuesten Antwort nennen auch, wie viele Abfragen sie ausgeführt hat, ihre Tokens und ihre Kosten. Jeder Quellenchip in einer Antwort öffnet die zugrunde liegenden Daten.
- **Eine Kopie behalten.** **Unterhaltung herunterladen** speichert den Verlauf mit **Als Markdown herunterladen**, zum Lesen oder Einfügen in ein Ticket, oder mit **Als PDF herunterladen**, zum Weitergeben.
- **Dort weitermachen, wo Sie aufgehört haben.** **Alle Unterhaltungen** in der Kopfzeile von KI fragen listet Ihre Unterhaltungen auf, die neueste zuerst, um sie wieder zu öffnen oder zu löschen. Der Start einer neuen Unterhaltung zeigt die letzten drei.

## Voraussetzungen

- **Ein LLM-Anbieter.** KI fragen nutzt den Standard-LLM-Anbieter des Projekts (siehe [LLM-Anbieter](/docs/ai/llm-provider)). In OneUptime Cloud funktioniert es sofort mit dem globalen Anbieter, bezahlt aus dem KI-Guthaben des Projekts; eine selbst gehostete Installation richtet einen Anbieter ein oder die Umgebungsvariablen des globalen Anbieters. Die Antworten sind nur so gut wie das Modell: Ein kleines selbst gehostetes Modell ohne zuverlässige Werkzeugaufrufe antwortet schlecht.
- **Der Growth-Tarif, in OneUptime Cloud.** Ein Projekt mit einem kleineren Tarif sieht, dass KI in seinem Tarif nicht enthalten ist, mit einem Link zu **Projekteinstellungen → Abrechnung und Rechnungen → Abrechnung**.
- **Für das Projekt eingeschaltete KI.** **KI aktivieren** unter **Projekteinstellungen → KI → KI-Funktionen** schaltet jede KI-Funktion des Projekts aus, KI fragen eingeschlossen. Es ist eingeschaltet, solange niemand es ausgeschaltet hat.

KI fragen zählt zu den eigenen täglichen KI-Limits des Projekts, wenn das Projekt sie festlegt (Projekteinstellungen → KI → KI-Funktionen → Weitere Einstellungen): Ist eines erreicht, zeigt KI fragen einen Satz, der sagt, welches Limit erreicht wurde, dass OneUptime AI um Mitternacht UTC wieder startet und wer das Limit erhöhen oder entfernen kann. Die Eigentümer des Projekts erhalten eine E-Mail, wenn an einem Tag zum ersten Mal ein Limit erreicht wird. Die täglichen Limits für Vorfälle und Warnungen halten KI fragen nie an. Siehe [die eigenen täglichen Limits des Projekts](/docs/ai/ai-sre#die-eigenen-täglichen-limits-des-projekts).

## Fehlerbehebung

:::details KI fragen sagt, dass KI nicht verfügbar ist
KI fragen sagt den Grund, bevor Sie tippen: Der Tarif des Projekts umfasst keine KI, **KI aktivieren** ist ausgeschaltet oder das Projekt hat keinen LLM-Anbieter. Jeder Hinweis verlinkt auf die Seite, auf der sich das ändern lässt.
:::

:::details Eine Aktion wurde abgelehnt
KI fragen sagt, welche Berechtigung die Aktion braucht oder welches Team sie blockiert. Bitten Sie jemanden, der die Änderung vornehmen darf, oder bitten Sie einen Projekteigentümer, Ihrer Rolle die Berechtigung zu geben. Es wurde nichts geändert.
:::

:::details Antworten sind vage oder nutzen nie Daten
Prüfen Sie das Modell hinter dem Anbieter. KI fragen braucht ein Modell, das Werkzeuge zuverlässig aufruft; kleine lokale Modelle antworten oft, ohne eine einzige Abfrage auszuführen. Siehe [LLM-Anbieter](/docs/ai/llm-provider).
:::

## Nächste Schritte

:::cards
- [AI SRE](/docs/ai/ai-sre): Lassen Sie OneUptime AI jeden neuen Vorfall und jede neue Warnung untersuchen.
- [LLM-Anbieter](/docs/ai/llm-provider): Wählen Sie das Modell, das KI fragen und die anderen KI-Funktionen nutzen.
- [MCP-Server](/docs/ai/mcp-server): Fragen Sie OneUptime stattdessen aus Claude, Cursor oder VS Code.
:::
