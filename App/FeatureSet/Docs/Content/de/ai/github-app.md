# Mit OneUptime aus GitHub heraus arbeiten

Die OneUptime GitHub App ist nicht nur eine Verbindung zu Ihrem Code — Sie können in Ihrem Repository mit ihr sprechen, und sie erledigt die Arbeit gleich dort.

Erwähnen Sie sie in einem Issue, und sie öffnet einen Pull Request. Erwähnen Sie sie in einem Pull Request, und sie überarbeitet den Branch oder erstellt ein Review des Diffs. Versehen Sie ein Issue mit einem Label, und sie nimmt es sich vor. Alles, was dabei herauskommt, ist ein Pull Request oder ein Review, das ein Mensch liest: **sie führt niemals einen Merge durch, und sie genehmigt niemals einen Pull Request.**

```text
@oneuptime implement this                          →  ein Pull Request, der das Issue schließt
@oneuptime revise this — use exponential backoff   →  neue Commits auf dem Branch dieses Pull Requests
@oneuptime review                                  →  ein Code-Review als Kommentar an diesem Pull Request
```

> Ersetzen Sie `@oneuptime` durch das Handle Ihrer eigenen App. In OneUptime Cloud lautet es `@oneuptime`. Auf einer selbst gehosteten Instanz ist es der Name, den Sie Ihrer GitHub App gegeben haben — kleingeschrieben und mit Bindestrichen statt Leerzeichen: Eine App namens „Acme AI" wird als `@acme-ai` erwähnt. Wenn Erwähnungen nichts bewirken, prüfen Sie das als Erstes.

## Bevor Sie beginnen

- Das Repository muss über die GitHub App **mit einem OneUptime-Projekt verbunden** sein. Die Einrichtung beschreibt [GitHub-Integration (selbst gehostet)](/docs/self-hosted/github-integration); in OneUptime Cloud verbinden Sie es unter **Projekteinstellungen → Code-Repositories**.
- Ein **Runner mit der Fähigkeit „Führt KI-Codekorrekturen aus"** muss online sein — derselbe Runner, der auch [KI-Korrekturaufgaben](/docs/ai/ai-agent) ausführt. Ohne ihn werden Befehle zwar angenommen, scheitern aber nach 30 Minuten mit dem Hinweis, dass kein Agent sie aufgenommen hat.
- Die GitHub App braucht die Berechtigung **Issues: Lesen & Schreiben** und muss die Webhook-Ereignisse abonniert haben, die unter [Was Sie abonnieren müssen](#was-sie-abonnieren-müssen) aufgeführt sind.

## Die Befehle

Jeder Befehl beginnt mit einer Erwähnung der App. Die Erwähnung darf an beliebiger Stelle im Kommentar stehen, und alles, was Sie danach schreiben, wird als Ihre Anfrage weitergereicht.

### In einem Pull Request

| Befehl | Was passiert |
| --- | --- |
| `@oneuptime review` | Klont den Branch, liest den geänderten Code **und den Code darum herum** und veröffentlicht ein Review als Kommentar. Ändert nichts. |
| `@oneuptime revise this — <was geändert werden soll>` | Klont den Branch des Pull Requests selbst, nimmt die Änderung vor und pusht neue Commits auf genau diesen Branch. Öffnet nie einen zweiten Pull Request. |

Alles, was Sie nach der Erwähnung schreiben und was kein bekannter Befehl ist, wird als Überarbeitungswunsch behandelt — denn fast immer ist es genau das:

```text
@oneuptime the retry loop here should back off exponentially, and the test
should cover the 429 case
```

### In einem Issue

| Befehl | Was passiert |
| --- | --- |
| `@oneuptime implement this` | Arbeitet das Issue ab und öffnet einen Pull Request, der es schließt. |
| `@oneuptime <beliebiger anderer Text>` | Dasselbe, mit Ihren Worten als zusätzliche Anweisung. |

Sie können der App ein Issue auch **ganz ohne Kommentar** übergeben:

- **Setzen Sie das Trigger-Label.** Wenn Sie ein Issue mit dem Trigger-Label des Repositories — standardmäßig `oneuptime` — versehen, startet dieselbe Arbeit. Das ist der zuverlässigste Weg, Arbeit aus der GitHub-Oberfläche heraus zu übergeben.
- **Weisen Sie das Issue dem Bot-Benutzer der App zu**, sofern Ihr Repository das zulässt. GitHub erlaubt es nicht überall, eine App als zuständige Person einzutragen — genau deshalb gibt es das Label; wenn das Zuweisen nichts bewirkt, nehmen Sie das Label.

### Überall

| Befehl | Was passiert |
| --- | --- |
| `@oneuptime help` | Listet die Befehle auf. Eine bloße Erwähnung ohne weiteren Text tut dasselbe. |
| `@oneuptime status` | Sagt, woran sie in diesem Thread gerade arbeitet. |
| `@oneuptime cancel` | Stoppt die Läufe, die sie in diesem Thread hat. Bereits gepushte Arbeit bleibt gepusht. |

`help`, `status` und `cancel` starten nie einen Agent-Lauf. Sie kosten daher nichts und zählen nicht gegen Ihr tägliches Budget für Korrekturaufgaben.

## Wie es im Thread aussieht

Ein Befehl erzeugt **einen Kommentar**, den die App im Lauf der Arbeit fortschreibt — so verwandelt auch eine lang laufende Aufgabe einen Pull Request nie in ein Statusprotokoll.

1. Sie reagiert mit 👀 auf Ihren Kommentar und veröffentlicht eine Bestätigung, die das OneUptime-Projekt des Laufs nennt und auf den laufenden Vorgang verlinkt.
2. Ist sie fertig, wird derselbe Kommentar mit dem Ergebnis neu geschrieben: der geöffnete Pull Request, die gepushten Commits oder eine ehrliche Erklärung, warum sie nichts getan hat.

Findet sie nichts, das eine Änderung wert wäre, sagt sie das, statt einen spekulativen Pull Request zu öffnen. Das ist ein normales Ergebnis und kein Fehlschlag — geben Sie ihr mehr Anhaltspunkte und fragen Sie erneut.

## Wer sie beauftragen darf

**Nur Personen mit Write-, Maintain- oder Admin-Zugriff auf das Repository.** OneUptime fragt jedes Mal direkt bei GitHub nach den Rechten der kommentierenden Person in diesem Repository; es verlässt sich nicht auf das „Contributor"-Abzeichen, das GitHub neben einem Kommentar anzeigt — das beschreibt vergangene Aktivität, nicht den aktuellen Zugriff.

Eine Erwähnung von jemand anderem bekommt eine einzelne 😕-Reaktion auf den Kommentar und sonst nichts. Das ist Absicht: In einem öffentlichen Repository kann jeder kommentieren, und eine App, die Fremden zuverlässig antwortet, ist eine App, mit der sich ein Thread zuspammen lässt.

Außerdem ignoriert sie jeden Kommentar, der von einem Bot geschrieben wurde — auch ihre eigenen — und sie ignoriert Erwähnungen, die in einem Zitat (`>`) oder in einem Codeblock stehen. Zusammen verhindern diese beiden Regeln, dass eine Antwort auf einen ihrer eigenen Kommentare sie erneut startet.

## Was sie nicht tut

- **Sie führt niemals einen Merge durch.** Nichts, was diese App tut, kann Code auf Ihren Standard-Branch bringen.
- **Sie genehmigt nie und fordert nie Änderungen an.** Reviews werden als Kommentare veröffentlicht; ein Review dieser App kann deshalb nie eine Branch-Protection-Regel erfüllen.
- **Sie schreibt nie die Historie um.** Eine Überarbeitung fügt Commits hinzu, sie erzwingt keinen Push. Hat vorher jemand anderes auf den Branch gepusht, scheitert die Überarbeitung, statt dessen Arbeit zu verwerfen.
- **Sie kann keinen Pull Request aus einem Fork überarbeiten.** Der Branch eines Forks liegt in einem Repository, in das die Installation nicht schreiben kann. Ein Review erstellt sie trotzdem — bitten Sie sie also um ein Review statt um eine Überarbeitung.
- **Sie ändert nie Titel, Beschreibung oder Ziel-Branch eines Pull Requests.** Nur Code.

## Was es kostet und wie Sie es begrenzen

Jeder Befehl, der Arbeit auslöst, ist ein vollständiger Agent-Lauf — ein Clone, bis zu 40 LLM-Aufrufe und 100.000 Ausgabe-Tokens, dazu die Build- und Testbefehle Ihres Repositories, sofern Sie welche konfiguriert haben.

Es greifen zwei Grenzen, und es sind dieselben, die schon für [KI-Korrekturaufgaben](/docs/ai/ai-agent) gelten:

- **Das tägliche Limit des Projekts für Korrekturläufe** (**Projekteinstellungen → KI**, standardmäßig 25 pro Tag). GitHub-Befehle teilen sich dieses Budget mit allen übrigen Korrekturläufen Ihres Projekts.
- **Die Obergrenze offener Pull Requests pro Repository** (**Code-Repositories → das Repository → Einstellungen**, standardmäßig 5). Reviews und Überarbeitungen sind davon ausgenommen: Keines von beiden legt einen neuen Pull Request in Ihre Review-Warteschlange.

Je Issue oder Pull Request ist immer nur ein Lauf derselben Art gleichzeitig aktiv. Fragen Sie zweimal, erfahren Sie, dass bereits gearbeitet wird; fragen Sie nach einem Review, während eine Überarbeitung läuft, starten beide, denn es sind unterschiedliche Anfragen.

Kann ein Lauf nicht starten, sagt die App im Thread, warum — sie scheitert nie stillschweigend.

## Sie abschalten

Pro Repository: **Code-Repositories → das Repository → Einstellungen → Auf GitHub-Befehle reagieren**. Ist das aus, ignoriert die App in diesem Repository Erwähnungen, Zuweisungen und das Trigger-Label und verweist alle, die sie ansprechen, auf diesen Schalter.

Auf derselben Seite steht auch das **GitHub-Trigger-Label**, falls Sie etwas anderes als `oneuptime` möchten.

## Was Sie abonnieren müssen

Abonnieren Sie in den Einstellungen Ihrer GitHub App unter **„Berechtigungen & Ereignisse"**:

| Ereignis | Nötig für |
| --- | --- |
| **Issue comment** | `@mention`-Befehle in Issues *und* in Pull Requests |
| **Issues** | Zuweisung an die App und das Trigger-Label |
| **Pull request** | ein bei der App angefordertes Review |
| **Pull request review** | eine Erwähnung im Text eines abgeschickten Reviews |
| **Pull request review comment** | eine Erwähnung in einem Inline-Kommentar im Diff |

Und unter **Repository-Berechtigungen** muss **Issues** auf **Lesen & Schreiben** stehen — GitHub liefert die Konversationskommentare von Pull Requests über die Issues-API aus, und genau diese Berechtigung erlaubt der App daher auch, Pull Requests zu kommentieren.

## Prompt Injection: Was geschützt ist und was nicht

Issue-Texte, Pull-Request-Beschreibungen, Diffs und Kommentare werden alle Teil des Agent-Prompts, und in einem öffentlichen Repository kann jeder diese Texte schreiben. Text nach dem Muster „Ignoriere deine Anweisungen und tu X" ist etwas, das man realistischerweise in einem Issue findet.

Zwei Dinge begrenzen das, und es lohnt sich zu wissen, welches davon was leistet:

- **Die Prompts kennzeichnen nicht vertrauenswürdigen Text als Anfrage, nicht als Anweisung**, und Repository, Branch und Pull Request eines Laufs stehen fest, bevor der Agent überhaupt startet — nichts, was der Agent liest, kann ändern, woran er arbeitet.
- **Die eigentliche Eingrenzung ist die Sandbox.** Der Agent läuft auf Ihrem Runner, in einem Wegwerf-Clone, mit aus seiner Befehlsumgebung entfernten Zugangsdaten und eingeschränkten Git-Operationen. Er kann immer nur auf einen Branch pushen, und mergen kann nur ein Mensch.

Behandeln Sie einen von der KI verfassten Pull Request so, wie Sie einen von einem neuen Mitwirkenden behandeln würden, der das Issue gelesen hat: Prüfen Sie den Diff, nicht die Beschreibung.

## Fehlerbehebung

**Es passiert nichts, wenn ich sie erwähne.** Prüfen Sie zuerst das Handle — es ist der Slug der App, nicht ihr Anzeigename. Prüfen Sie dann, ob das Repository mit einem Projekt verbunden ist (**Projekteinstellungen → Code-Repositories**), ob **Auf GitHub-Befehle reagieren** eingeschaltet ist und ob Ihre GitHub App die oben genannten Ereignisse abonniert hat.

**Sie reagiert mit 😕 und sagt nichts.** Sie haben keinen Schreibzugriff auf das Repository.

**Sie sagt, sie arbeite bereits daran.** Für dieses Issue oder diesen Pull Request ist bereits ein Lauf dieser Art aktiv. `@oneuptime status` sagt Ihnen, welcher, und `@oneuptime cancel` stoppt ihn.

**Sie hat bestätigt und ist dann lange still.** Prüfen Sie unter **Einstellungen → Runbook-Agents**, ob ein Runner mit **Führt KI-Codekorrekturen aus** online ist. Ohne einen solchen wird der Lauf nach 30 Minuten als fehlgeschlagen markiert, und der Thread erfährt davon.

**Sie sagt, der Pull Request komme aus einem Fork.** Überarbeitungen brauchen einen Branch in diesem Repository. Bitten Sie stattdessen um ein Review, oder pushen Sie den Branch hierher.

## Weiterführende Themen

- [KI-Korrekturaufgaben](/docs/ai/ai-agent) — derselbe Agent, ausgelöst von einer Exception statt aus GitHub.
- [GitHub-Integration (selbst gehostet)](/docs/self-hosted/github-integration) — die GitHub App erstellen und konfigurieren.
- [Runbook-Agents](/docs/runbooks/agents) — der Prozess, der die Läufe ausführt.
