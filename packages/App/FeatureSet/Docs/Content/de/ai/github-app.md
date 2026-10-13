# GitHub App

Die OneUptime GitHub App ist mehr als eine Verbindung zu Ihrem Code: Sie können in Ihrem Repository mit ihr sprechen, und sie erledigt die Arbeit dort. Erwähnen Sie sie in einem Issue, und sie öffnet einen Pull Request; erwähnen Sie sie in einem Pull Request, und sie überarbeitet den Branch oder prüft den Diff. Alles, was sie erzeugt, ist ein Pull Request oder ein Review, das ein Mensch liest: **Sie mergt nie etwas, und sie genehmigt nie einen Pull Request.**

:::cards
- [Die Befehle](#die-befehle): Was Sie in einem Issue oder einem Pull Request schreiben.
- [Wie es im Thread aussieht](#wie-es-im-thread-aussieht): Ein Kommentar, der der Arbeit folgt.
- [Wer ihr Befehle geben darf](#wer-ihr-befehle-geben-darf): Personen mit Schreibzugriff, sonst niemand.
- [Fehlerbehebung](#fehlerbehebung): Wenn eine Erwähnung nichts bewirkt.
:::

```text
@oneuptime implement this                          →  a pull request that closes the issue
@oneuptime revise this — use exponential backoff   →  new commits on this pull request's branch
@oneuptime review                                  →  a code review posted on this pull request
```

> [!NOTE]
> Ersetzen Sie `@oneuptime` durch das Handle Ihrer eigenen App. In OneUptime Cloud ist es `@oneuptime`. Auf einer selbst gehosteten Instanz ist es der Name Ihrer GitHub App, kleingeschrieben und mit Bindestrichen statt Leerzeichen: Eine App namens "Acme AI" wird als `@acme-ai` erwähnt. Wenn Erwähnungen nichts bewirken, prüfen Sie zuerst das.

## So funktioniert es

```mermaid title="Von einer Erwähnung zum Pull Request"
flowchart TB
    M["Eine Erwähnung, ein Label<br/>oder eine Zuweisung"] --> W{"Hat der Autor<br/>Schreibzugriff?"}
    W -->|"nein"| N["Eine verwirrte Reaktion,<br/>sonst nichts"]
    W -->|"ja"| K["Eine Augen-Reaktion und<br/>eine Bestätigung"]
    K --> R["Ein Runner bearbeitet<br/>die Anfrage in einem Klon"]
    R --> O["Derselbe Kommentar,<br/>neu geschrieben mit<br/>dem Ergebnis"]
```

Es ist derselbe Agent und derselbe Runner wie bei den [Korrekturaufgaben](/docs/ai/ai-agent), mit denselben Budgets; nur der Auslöser unterscheidet sich.

## Bevor Sie beginnen

- Das Repository muss über die GitHub App **mit einem OneUptime-Projekt verbunden** sein: Verbinden Sie es unter **Aufgaben → Code-Repositories** (öffnen Sie **Produkte → Code → Aufgaben**). Eine selbst gehostete Instanz braucht zuerst eine eigene GitHub App: siehe [GitHub-Integration](/docs/self-hosted/github-integration).
- Ein Runner mit **Führt KI-Codekorrekturen aus** muss online sein: derselbe Runner, der die [Korrekturaufgaben](/docs/ai/ai-agent) ausführt. Ohne ihn werden Befehle angenommen und schlagen nach 30 Minuten fehl, mit dem Hinweis, dass kein Agent sie übernommen hat.
- Die GitHub App braucht die Berechtigung **Issues** mit **Read & write** und muss die Webhook-Ereignisse unter [Was abonniert werden muss](#was-abonniert-werden-muss) abonniert haben.

## Die Befehle

Jeder Befehl beginnt mit einer Erwähnung der App. Die Erwähnung kann irgendwo im Kommentar stehen, und alles, was Sie danach schreiben, wird als Ihre Anfrage weitergegeben.

### In einem Pull Request

| Befehl | Was passiert | Ebenfalls verstanden |
| --- | --- | --- |
| `@oneuptime review` | Klont den Branch, liest den geänderten Code und den Code drumherum und veröffentlicht ein Review als Kommentar. Ändert nichts. | `code review`, `please review`, `can you review`, `review this` |
| `@oneuptime revise this — <what you want changed>` | Klont den eigenen Branch des Pull Requests, nimmt die Änderung vor und pusht neue Commits auf diesen Branch. Öffnet nie einen zweiten Pull Request. | `revise`, `please revise`, `rework`, `redo` |

Alles, was Sie nach der Erwähnung schreiben und kein bekannter Befehl ist, wird als Überarbeitungsanfrage gelesen, weil es fast immer genau das ist:

```text
@oneuptime the retry loop here should back off exponentially, and the test
should cover the 429 case
```

### In einem Issue

| Befehl | Was passiert | Ebenfalls verstanden |
| --- | --- | --- |
| `@oneuptime implement this` | Bearbeitet das Issue und öffnet einen Pull Request, der es schließt. | `implement`, `please implement`, `work on this`, `pick this up`, `take this` |
| `@oneuptime <anything else>` | Dasselbe, mit Ihren Worten als zusätzliche Vorgabe. | — |

Sie können der App ein Issue auch ohne Kommentar übergeben:

- **Fügen Sie das Auslöser-Label hinzu.** Das Auslöser-Label des Repositorys, `oneuptime`, sofern Sie es nicht geändert haben, an ein Issue zu hängen, startet dieselbe Arbeit. Das ist der zuverlässigste Weg, Arbeit von den eigenen Seiten von GitHub aus zu übergeben.
- **Weisen Sie das Issue dem Bot-Benutzer der App zu**, wo Ihr Repository das zulässt. GitHub erlaubt nicht überall, dass eine App zugewiesen wird, und deshalb gibt es das Label: Wenn die Zuweisung nichts bewirkt, verwenden Sie das Label.

### Überall

| Befehl | Was passiert | Ebenfalls verstanden |
| --- | --- | --- |
| `@oneuptime help` | Listet die Befehle auf. Eine bloße Erwähnung ohne etwas danach tut dasselbe. | `commands`, `usage`, `what can you do` |
| `@oneuptime status` | Sagt, woran sie in diesem Thread arbeitet. | `progress` |
| `@oneuptime cancel` | Stoppt die Läufe, die sie in diesem Thread laufen hat. Bereits gepushte Arbeit bleibt gepusht. | `stop`, `abort` |

`help`, `status` und `cancel` starten nie einen Agent-Lauf und kosten daher nichts.

## Wie es im Thread aussieht

Ein Befehl erzeugt **einen Kommentar**, den die App bearbeitet, während die Arbeit vorankommt, sodass eine lange Aufgabe einen Pull Request nie in ein Statusprotokoll verwandelt.

1. Sie reagiert mit 👀 auf Ihren Kommentar und veröffentlicht eine Bestätigung, die das OneUptime-Projekt nennt, zu dem der Lauf gehört, und auf den Live-Lauf verlinkt.
2. Wenn sie fertig ist, schreibt sie denselben Kommentar mit dem Ergebnis neu: dem Pull Request, den sie geöffnet hat, den Commits, die sie gepusht hat, oder einer klaren Erklärung, warum sie nichts getan hat.

Findet sie nichts, was sich zu ändern lohnt, sagt sie das, statt einen spekulativen Pull Request zu öffnen. Das ist ein normales Ergebnis, kein Fehler: Geben Sie ihr mehr Richtung und fragen Sie erneut.

## Wer ihr Befehle geben darf

**Nur Personen mit Write-, Maintain- oder Admin-Zugriff auf das Repository.** OneUptime fragt GitHub jedes Mal nach der Berechtigung der kommentierenden Person für dieses Repository; dem Abzeichen "contributor", das GitHub neben einem Kommentar zeigt, vertraut es nicht, denn es beschreibt frühere Aktivität, nicht den aktuellen Zugriff.

Eine Erwähnung von jemand anderem bekommt eine einzige 😕-Reaktion und sonst nichts. Das ist Absicht: In einem öffentlichen Repository kann jeder kommentieren, und eine App, die Fremden immer antwortet, kann zum Zuspammen eines Threads benutzt werden.

Sie ignoriert außerdem jeden Kommentar, den ein Bot geschrieben hat, ihre eigenen eingeschlossen, sowie Erwähnungen in einem Zitat (`>`) oder einem Codeblock. Zusammen verhindern diese beiden Regeln, dass eine Antwort auf einen ihrer eigenen Kommentare sie erneut startet.

## Was sie nicht tut

- **Sie mergt nie.** Nichts, was diese App tut, kann Code auf Ihren Standard-Branch bringen.
- **Sie genehmigt nie und fordert nie Änderungen an.** Reviews werden als Kommentare veröffentlicht, sodass ein Review der App nie eine Branch-Schutzregel erfüllen kann.
- **Sie schreibt nie die Historie um.** Eine Überarbeitung fügt Commits hinzu; sie macht nie einen Force-Push. Hat jemand anderes zuerst auf den Branch gepusht, schlägt die Überarbeitung fehl, statt dessen Arbeit zu verwerfen.
- **Sie kann keinen Pull Request aus einem Fork überarbeiten.** Der Branch eines Forks liegt in einem Repository, in das die Installation nicht schreiben kann. Prüfen kann sie ihn trotzdem: Bitten Sie stattdessen um ein Review.
- **Sie ändert nie den Titel, die Beschreibung oder den Ziel-Branch eines Pull Requests.** Nur Code.

## Was es kostet und wie Sie es begrenzen

Jeder Befehl, der Arbeit startet, ist ein vollständiger Agent-Lauf: ein Klon, bis zu 40 LLM-Aufrufe und 100.000 Ausgabe-Tokens sowie die Build- und Testbefehle Ihres Repositorys, wenn Sie sie gesetzt haben.

GitHub-Befehle sind KI-Arbeit außerhalb von Vorfällen und Warnungen, daher gilt für sie kein tägliches Limit für Korrekturaufgaben; die eigenen täglichen KI-Limits des Projekts gelten, wenn das Projekt sie festlegt. Die einzige weitere Grenze ist die, die bereits für [Korrekturaufgaben](/docs/ai/ai-agent) gilt:

- **Die Obergrenze für offene Pull Requests** (**Max. offene Korrektur-Pull-Requests** auf der Seite **Einstellungen** des Repositorys). Es gibt keine Obergrenze, bis Sie eine setzen, und 0 blockiert KI-Korrektur-Pull-Requests in diesem Repository. Reviews und Überarbeitungen sind ausgenommen: Keines davon fügt Ihrer Review-Warteschlange einen Pull Request hinzu.

Pro Issue oder Pull Request ist jeweils nur ein Lauf einer Art aktiv. Zweimal zu fragen sagt Ihnen, dass sie bereits daran arbeitet; um ein Review zu bitten, während eine Überarbeitung läuft, startet beides, da es verschiedene Anfragen sind.

Wenn ein Lauf nicht starten kann, sagt die App im Thread, warum: Sie schlägt nie stillschweigend fehl.

## Ausschalten

Jedes Repository hat einen Schalter: **Auf GitHub-Befehle reagieren** auf der Seite **Einstellungen** des Repositorys. Ist er aus, ignoriert die App in diesem Repository Erwähnungen, Zuweisungen und das Auslöser-Label und sagt jedem, der fragt, wo der Schalter ist.

Dieselbe Seite enthält das **GitHub-Auslöser-Label**, falls Sie ein anderes Label als `oneuptime` möchten.

## Was abonniert werden muss

Abonnieren Sie in den Einstellungen **Permissions & events** Ihrer GitHub App:

| Ereignis | Nötig für |
| --- | --- |
| **Issue comment** | `@mention`-Befehle in Issues und Pull Requests |
| **Issues** | das Zuweisen eines Issues an die App und das Auslöser-Label |
| **Pull request** | ein bei der App angefragtes Review |
| **Pull request review** | eine Erwähnung im Text eines abgeschickten Reviews |
| **Pull request review comment** | eine Erwähnung in einem Inline-Kommentar zum Diff |

Unter **Repository permissions** muss **Issues** auf **Read & write** stehen: GitHub sendet die Konversationskommentare eines Pull Requests über die Issues-API, deshalb kann die App damit auch Pull Requests kommentieren.

## Prompt Injection: was geschützt ist und was nicht

Issue-Texte, Pull-Request-Beschreibungen, Diffs und Kommentare werden alle Teil des Prompts des Agenten, und in einem öffentlichen Repository kann sie jeder schreiben. Eine Zeile wie "ignoriere deine Anweisungen und tu X" in einem Issue zu finden, ist realistisch.

Zwei Dinge begrenzen das, und es lohnt sich zu wissen, welches welches ist:

- **Die Prompts kennzeichnen nicht vertrauenswürdigen Text als Anfrage, nicht als Anweisungen**, und Repository, Branch und Pull Request des Laufs stehen fest, bevor der Agent startet: Nichts, was der Agent liest, kann ändern, woran er arbeitet.
- **Die eigentliche Eindämmung ist die Sandbox.** Der Agent läuft auf Ihrem Runner, in einem Wegwerf-Klon, mit aus seiner Befehlsumgebung entfernten Zugangsdaten und eingeschränkten Git-Operationen. Er kann immer nur auf einen Branch pushen, und nur ein Mensch kann einen mergen.

Behandeln Sie einen Pull Request, den die KI geschrieben hat, wie einen von einem neuen Mitwirkenden, der das Issue gelesen hat: Prüfen Sie den Diff, nicht die Beschreibung.

## Fehlerbehebung

:::details Nichts passiert, wenn ich sie erwähne
Prüfen Sie zuerst das Handle: Es ist der Slug der App, nicht ihr Anzeigename. Prüfen Sie dann, ob das Repository mit einem Projekt verbunden ist (**Aufgaben → Code-Repositories**), ob **Auf GitHub-Befehle reagieren** eingeschaltet ist und ob Ihre GitHub App die obigen Ereignisse abonniert hat.
:::

:::details Sie reagiert mit 😕 und sagt nichts
Sie haben keinen Schreibzugriff auf das Repository.
:::

:::details Sie sagt, sie arbeite bereits daran
Ein Lauf dieser Art ist in diesem Issue oder Pull Request bereits aktiv. `@oneuptime status` sagt, was es ist, und `@oneuptime cancel` stoppt ihn.
:::

:::details Sie hat bestätigt und ist dann lange still geworden
Prüfen Sie, ob ein Runner mit **Führt KI-Codekorrekturen aus** unter **Runbooks → Runbook-Agents** online ist. Ohne ihn schlägt der Lauf nach 30 Minuten fehl, und der Thread erfährt es.
:::

:::details Sie sagt, der Pull Request stamme aus einem Fork
Eine Überarbeitung braucht einen Branch in diesem Repository. Bitten Sie stattdessen um ein Review, oder pushen Sie den Branch hierher.
:::

## Nächste Schritte

:::cards
- [Korrekturaufgaben](/docs/ai/ai-agent): Derselbe Agent, gestartet aus einer Ausnahme, einem Trace oder einer Untersuchung.
- [GitHub-Integration](/docs/self-hosted/github-integration): Die GitHub App auf einer selbst gehosteten Instanz anlegen und konfigurieren.
- [Runbook-Agents](/docs/runbooks/agents): Der Worker, der jeden Lauf ausführt.
:::
