# OneUptime AI in der Datensicherheit

OneUptime AI arbeitet mit dem, was Datensicherheit gefunden hat, ohne Ihre Daten zu sehen. Es erhält Namen, Formen, Anzahlen und Konfiguration, nie einen Wert Ihrer Daten, eine maskierte Stichprobe, einen Datensatz oder eine Verbindungszeichenfolge. Jede Funktion läuft auf dem eigenen Modell Ihres Projekts, auch einem selbst gehosteten, und jede Seite, jede Prüfung, jeder Scan und jede Integration der Datensicherheit funktioniert auch mit ausgeschalteter KI.

:::cards
- [Von sich aus](#von-sich-aus): Was sie mit jedem neuen Problem tut, was auf Sie wartet, und die KI-Regeln.
- [Was OneUptime AI sieht](#was-oneuptime-ai-sieht): Was jede Funktion sendet und was sie nie sendet.
- [Selbst nachsehen](#selbst-nachsehen): Die genaue Eingabe, die eines Ihrer Probleme senden würde.
- [Ihr eigenes Modell](#ihr-eigenes-modell): Jede Funktion auf dem Anbieter Ihres Projekts, Ollama, vLLM oder einem beliebigen OpenAI-kompatiblen Endpunkt.
- [Wie es gemessen wird](#wie-es-gemessen-wird): Jede Funktion an festen Fällen, vor jedem Release.
:::

## Von sich aus

Ist **An neuen Problemen arbeiten** unter **Datensicherheit → KI** eingeschaltet, wie bei neuen Projekten, arbeitet OneUptime AI von sich aus an jedem neuen kritischen oder hohen Problem. Sie schreibt die Analyse jedes solchen Problems und jedes, das sich wieder öffnet, so wie **Problem analysieren** und aus dem, was das sendet, bevor jemand es öffnet, und schreibt sie nur neu, wenn sich etwas geändert hat, worauf sie beruht. Für ein Telemetrieproblem verbirgt sie ein Geheimnis in neuer Telemetrie von sich aus, wo die Regel an den Einträgen nachgewiesen ist, in denen das Geheimnis gesehen wurde, und nichts liest, was die Regel verbirgt, und schlägt für den Rest die Bereinigungsregeln vor (siehe [Von sich aus eingedämmt](/docs/data-security/telemetry#von-sich-aus-eingedämmt)). Ein Vorschlag wartet auf dieser Seite unter **Wartet auf Sie**, das Riskanteste zuerst, mit dem, was sich ändert, warum, wie es nachgewiesen wird und wie man es rückgängig macht. **Genehmigen** nimmt die Änderung mit Ihren eigenen Berechtigungen vor: Eine Bereinigungsregel erfordert die Berechtigung, Bereinigungsregeln für Logs, Bereinigungsregeln für Traces oder Metrik-Pipeline-Regeln zu erstellen. **Vorschlag verwerfen** sagt Nein, mit einer Begründung, die in die Zeitachse des Problems kommt. Ob eine Änderung gewirkt hat, entscheidet die eigene Prüfung des Problems: Der Datenspeicher wird erneut geprüft, und das Problem wird behoben, sobald keine seiner Daten mehr übrig sind.

OneUptime AI schlägt außerdem Eigentümer für Datenspeicher vor, die keine haben, aus dem, was schon auf sie hinweist: den Cloud-Tags des Datenspeichers, den Diensten, die ihn nutzen, und deren Eigentümern, den Code-Eigentümern der Datei, die ihn deklariert, wer ihn laut dem Änderungsprotokoll der Cloud geändert hat und wer ihn zu OneUptime hinzugefügt hat. Sie nennt nur die eigenen Teams und Personen Ihres Projekts, sagt, wie sicher sie ist, und sagt, wo sich die Belege widersprechen. Der Vorschlag für einen sensiblen Datenspeicher kommt mit seinem Problem **Dieser sensible Datenspeicher hat keinen Eigentümer**, und andere neue Datenspeicher erhalten ihren einmal täglich und wenn eine Cloud-Verbindung zum ersten Mal gelesen wird. Beruhen die Eigentümer von drei oder mehr Datenspeichern auf demselben Tag oder demselben Namensanfang, schlägt sie auch die Eigentümerregel vor, die den nächsten solchen Datenspeicher mit Eigentümern versorgt, und sagt, auf wie viele Datenspeicher die Regel passen würde. Diese Vorschläge warten unter **Zu prüfende Eigentümer**, auf dieser Seite und unter **Datenspeicher**: **Genehmigen** fügt die Eigentümer mit Ihren eigenen Berechtigungen hinzu, und sie werden benachrichtigt wie jeder Eigentümer; **Ändern und genehmigen** wählt zuerst andere Eigentümer; **Rückgängig** nimmt genau die hinzugefügten Eigentümer zurück, und die Regel mit ihnen. Einen Eigentümer hinzuzufügen ändert, wer benachrichtigt wird, deshalb wartet das immer auf Sie, was auch immer eine KI-Regel sagt.

Standardmäßig fragt OneUptime AI vor jeder Änderung, außer vor einer, die nur Daten verbirgt, rückgängig gemacht werden kann und nachweislich sicher ist, und sie löscht nie Daten und alarmiert nie jemanden ohne Rückfrage. Eine Änderung, die sie ohne Rückfrage vorgenommen hat, steht unter **Von der KI erledigt**, mit **Rückgängig**. **Warum die KI nicht gehandelt hat** listet die Probleme, die sie angesehen und unberührt gelassen hat, und warum. Jeder Vorschlag, jede Genehmigung, jedes Verwerfen und jedes Rückgängigmachen steht in der **Zeitachse** des Problems und des Datenspeichers. Mit ausgeschaltetem Schalter arbeitet Datensicherheit wie immer, und **Problem analysieren** und **Mit KI beheben** funktionieren weiterhin, wenn Sie sie drücken; mit ausgeschalteter KI für das Projekt keines von beiden.

Auf der Seite eines Problems zeigt die Karte **OneUptime AI** über **Behebung** die Analyse und was für dieses Problem vorgeschlagen wurde, mit denselben Schaltflächen. Die **Übersicht** der Datensicherheit sagt, wie viele Lecks OneUptime AI diese Woche eingedämmt hat und wie viele Vorschläge auf Sie warten. Was aus ihren Änderungen geworden ist, zählt **Notizen für OneUptime AI** Woche für Woche: siehe [Wie gut OneUptime AI abschneidet](/docs/ai/ai-sre#wie-gut-oneuptime-ai-abschneidet).

### KI-Regeln

Unter **KI-Regeln** auf **Datensicherheit → KI** legt eine Regel fest, an welchen Problemen OneUptime AI arbeitet - nach ihrer Prüfung oder Prüfungsgruppe, ihrem Schweregrad und der Sensibilität, Art, dem Anbieter, der Umgebung, den Beschriftungen, Datenkategorien und dem Dienst des Datenspeichers - und für jede Art von Arbeit, **Analysieren**, **Eindämmen**, **Behebung** und **Beurteilen**, ob sie **Aus** ist, **Vorschlagen** (sie schlägt vor und wartet auf Sie) oder **Automatisch**. Passen mehrere Regeln zu einem Problem, läuft eine Art von Arbeit, wenn eine von ihnen sie einschaltet, und **Vorschlagen** hat Vorrang vor **Automatisch**. Jeder Vorschlag sagt, welche Regel ihn entschieden hat. **Eindämmen** auf **Automatisch** lässt auch eine nachgewiesene Bereinigungsregel für personenbezogene Daten von sich aus laufen, nicht nur die für ein Geheimnis; eine Bereinigungsregel, die nicht nachweislich sicher ist, wartet immer auf Sie, was auch immer eine KI-Regel sagt. Ohne Regel gelten die Standards des Projekts: kritische und hohe Probleme analysieren und alles andere vorschlagen.

KI-Regeln gehören dem ganzen Projekt, wie die KI-Regeln für Vorfälle und Warnungen: Projektinhaber und Projektadministratoren ändern sie, ebenso alle, denen die Berechtigungen für KI-Regeln gegeben wurden. Die Sicherheitsrollen sehen, was OneUptime AI vorgeschlagen und getan hat, aber nicht die Regeln.

## Was OneUptime AI sieht

Keine Funktion sendet einem Modell jemals:

- einen Wert Ihrer Daten;
- eine maskierte Stichprobe wie `j***@e******.com`: Eine maskierte E-Mail-Adresse trägt noch eine Domain, eine maskierte Karte ihre letzten vier Ziffern;
- einen Datensatz Ihrer Telemetrie: eine Protokollzeile, einen Span oder eine Sitzung;
- eine Verbindungszeichenfolge, einen Schlüssel oder ein anderes Geheimnis.

Datensicherheit liest Ihre Daten selbst, in ihren Scans, und bewahrt nichts davon auf. Was sie OneUptime AI sendet, wird an einer einzigen Stelle gebaut, aus einer Liste dessen, was gesendet werden darf, und ein Test schlägt fehl, sobald eine Funktion einem Modell etwas anderes sendet.

| Funktion | Was sie sendet | Läuft von selbst |
| --- | --- | --- |
| **Analyse auf Anfrage** | Titel, Schweregrad und Nachweis des Problems, warum seine Prüfung wichtig ist und die Schritte, die es beheben; Name, Art, Region, Tags und Konfiguration des Datenspeichers, seine Empfindlichkeit, die Namen seiner Datentypen und etwa wie viele Datensätze er enthält; wer den Datenspeicher erreichen kann: Identität, Stufe und Art jeder Freigabe und ungefähr, wann sie zuletzt verwendet wurde, und die Dienste, die ihn nutzen; Kopien seiner Daten in anderen Datenspeichern, seine Sicherheitsfälle, die Reaktionsaktion, die das Problem behebt, und das Repository und die Dateien, die ihn deklarieren; wie viele Eigentümer er hat, nie wer sie sind; bei einem Telemetrie-Problem, wo jede Art von Daten gefunden wurde: das Attribut, der Log-Text oder der Prompt, in dem sie steht | Nein: eine Person fragt, auf der Seite eines Problems oder mit Mit KI erklären über die API oder den MCP-Server |
| **Analyse neuer Probleme** | Titel, Schweregrad und Nachweis des Problems, warum seine Prüfung wichtig ist und die Schritte, die es beheben; Name, Art, Region, Tags und Konfiguration des Datenspeichers, seine Empfindlichkeit, die Namen seiner Datentypen und etwa wie viele Datensätze er enthält; wer den Datenspeicher erreichen kann: Identität, Stufe und Art jeder Freigabe und ungefähr, wann sie zuletzt verwendet wurde, und die Dienste, die ihn nutzen; Kopien seiner Daten in anderen Datenspeichern, seine Sicherheitsfälle, die Reaktionsaktion, die das Problem behebt, und das Repository und die Dateien, die ihn deklarieren; wie viele Eigentümer er hat, nie wer sie sind; bei einem Telemetrie-Problem, wo jede Art von Daten gefunden wurde: das Attribut, der Log-Text oder der Prompt, in dem sie steht | Ja: ein neues oder wieder geöffnetes Problem mit dem Schweregrad Kritisch oder Hoch startet sie, solange **An neuen Problemen arbeiten** eingeschaltet ist |
| **Mit KI beheben** | Das Problem, wie seine Prüfung es sah, Name, Art, Region und Cloud-ID des Datenspeichers und bei einem Telemetrie-Problem, wo seine Daten gefunden wurden, als Anfrage an den Coding-Agenten, der dann den eigenen Code des Repositorys liest, um die Änderung vorzunehmen | Nein: eine Person fragt, in einem Repository, das sie unter **Code** ändern darf |
| **Vorschläge für Felder, die kein Detektor zugeordnet hat** | Die Art des Datenspeichers und die Datentypen, die die KI nennen darf; der Name jedes Felds, die Namen der Felder daneben und die Formen seiner Werte, jeder Buchstabe als `a` oder `A` und jede Ziffer als `9`; wie viele Werte gelesen wurden und wie lang sie sind | Ja: Der Inhaltsscan eines Datenspeichers startet sie |
| **KI fragen** | Die Datenspeicher, Probleme und Zugriffe, die die Person in Datensicherheit lesen darf; was wo gefunden wurde, jeder Datentyp nach seinem Ort, mit Anzahlen und Konfidenz | Nein: Eine Person stellt eine Frage |
| **Eigentümer für Datenspeicher** | Name, Art, Anbieter, Umgebung und Sensibilität des Datenspeichers und die Namen seiner Datentypen; was auf einen Eigentümer hinweist: seine Cloud-Tags, die Dienste, die ihn nutzen, die Code-Eigentümer der Datei, die ihn deklariert, und die Änderungen daran; die Teams, die die Belege nennen, mit Namen, und die Personen, die sie nennen, nur als nummerierte Kandidaten, nie mit Namen oder E-Mail-Adresse | Ja: Ein Datenspeicher ohne Eigentümer startet sie, einmal täglich für neue Datenspeicher und wenn eine Cloud-Verbindung zum ersten Mal gelesen wird, solange **An neuen Problemen arbeiten** eingeschaltet ist |
| **Namen für Probleme mit einer Ursache** | Was die Datenspeicher der Gruppe gemeinsam haben: das Modul, der Stack oder das Tag, das sie erzeugt hat, die Identität, die sie erstellt hat, oder ihr Namensmuster; die Prüfung, an der sie scheitern, wie viele Probleme die Gruppe enthält, die Art des Datenspeichers und der Code, der sie deklariert. Nie der Name eines einzelnen Datenspeichers der Gruppe | Ja: Eine Gruppe von Problemen, die ein Fehler verursacht hat, startet es, sobald sie entsteht oder sich ändert, was ihre Datenspeicher gemeinsam haben, solange **An neuen Problemen arbeiten** eingeschaltet ist |
| **Ursache beheben** | Die Prüfung, an der die Probleme der Gruppe scheitern, was ihre Datenspeicher gemeinsam haben und das Modul oder die Dateien, die sie deklarieren, als Anfrage an den Coding-Agenten; jeder Datenspeicher, den der Pull Request behebt: sein Name, seine Art, seine Region und Cloud-ID sowie sein Problem; der Coding-Agent liest dann den eigenen Code des Repositorys, um die Änderung vorzunehmen | Nein: Eine Person fragt, aus einer Gruppe unter **Probleme** oder indem sie den Vorschlag von OneUptime AI genehmigt, in einem Repository, das sie in **Code** ändern darf; oder der Schritt **Fix the code with AI** eines Sicherheits-Playbooks. Eine Regel, deren **Behebung** auf **Automatisch** steht, öffnet ihn von selbst |
| **Bereinigungsregeln für das, was „Bereinigen“ nicht abdecken kann** | Der Datentyp jedes Funds, seine Kategorie und ob er anhand seiner Werte oder anhand des Namens eines Felds gefunden wird; wo er steht, das Attribut oder der Log-Text, und die Namen der Attribute daneben; die Formen seiner Werte, etwa `AA-9999` für den Wert `AB-1234`, und wie viele Werte gelesen wurden | Ja: Ein Telemetrieproblem, das OneUptime AI eindämmt, startet sie, für die Daten, die keine Regel von „Bereinigen“ verbergen kann, solange **An neuen Problemen arbeiten** eingeschaltet ist |
| **Sensible Daten in Pull Requests** | Was die Regeln im Diff des Pull Requests gefunden haben: die Datei und die Zeile, den geschriebenen Namen, die Art der Daten, die er nennt, und die Prüfung, die er nicht bestehen würde; den Diff dieser Dateien und den Titel des Pull Requests, ohne das, was wie ein Geheimnis, eine E-Mail-Adresse oder eine IP-Adresse aussieht; nie, was die Produktion enthält: wo Ihre Telemetrie die Daten enthielt, den Namen eines Datenspeichers oder was ein Datenspeicher enthält, und auch keine Probe dessen, was gefunden wurde, nicht einmal eine maskierte | Ja: Die [Produktionsprüfung](/docs/ai/ai-agent#produktionsprüfung-von-pull-requests) eines Pull Requests startet sie, wenn ihre Regeln sensible Daten in der Änderung finden |

**Mit KI erklären** und **KI fragen** lesen außerdem zuerst den [KI-Kontext](/docs/ai/ai-context) Ihres Teams, wenn es einen hat: die Notizen, die Ihr Team für OneUptime AI über Ihre Systeme geschrieben hat. **Analyse neuer Probleme** liest ihn ebenfalls.

### Text aus Ihren Systemen ist Daten

Der Name eines Datenspeichers, seine Cloud-ID, seine Tags, die Belege, mit denen eine Cloud geantwortet hat, und der Schlüssel eines Attributs stammen aus Ihren Clouds und Ihrem Code, also schreibt jeder, der einen Bucket benennen oder eine Ressource taggen kann, mit an dem, was OneUptime AI liest. OneUptime AI erhält jede Anweisung in einer eigenen Nachricht und diesen Text in einer zweiten Nachricht, als Daten:

- jeder Text wird auf eine Länge begrenzt und in eine Zeile gesetzt, und was wie ein Geheimnis, eine E-Mail-Adresse oder eine IP-Adresse aussieht, wird weggelassen;
- Text, der wie Anweisungen an eine KI klingt, etwa „ignore previous instructions“, wird markiert, und OneUptime AI wird angewiesen, ihm nie zu folgen;
- eine strukturierte Antwort, etwa die der Feldvorschläge, wird streng gelesen: das angeforderte Objekt oder keine Antwort.

### Was aufbewahrt wird

Die Zeile jedes Aufrufs in **Projekteinstellungen → KI → KI-Protokolle** sagt, welche Funktion welches Modell aufgerufen hat, mit seinen Tokens und seinen Kosten. Sie bewahrt nie auf, was gesendet oder geantwortet wurde: Projektmitglieder und Betrachter lesen die KI-Protokolle, und die Datensätze der Datensicherheit sind für ihre Eigentümer und die Sicherheitsrollen bestimmt. Auch die eigene Telemetrie von OneUptime zeichnet nie auf, was Mit KI erklären oder die Feldvorschläge gesendet haben, selbst wo der Betreiber des Servers aufzeichnet, was andere KI-Aufrufe senden. Die Analyse selbst wird am Problem gespeichert, für alle, die das Problem lesen dürfen, und eine Zeile, die auf etwas beruht, das ein Leser nicht lesen darf, wird ihm ausgeblendet.

Schlägt ein Aufruf fehl, behalten Mit KI erklären und die Feldvorschläge kein Wort vom Fehler des Anbieters, der Gesendetes zitieren kann. Der Code-Agent hinter Mit KI beheben und Ursache beheben sowie der Chat von KI fragen behalten den Anbieterfehler eines fehlgeschlagenen Aufrufs weiterhin in seiner Zeile.

Die Eigentümervorschläge bewahren dasselbe auf wie Mit KI erklären: Die Zeilen ihrer Aufrufe nennen die Funktion, das Modell, die Tokens und die Kosten, nie, was gesendet oder geantwortet wurde, und kein Wort vom Fehler eines fehlgeschlagenen Aufrufs. Dasselbe gilt für die Bereinigungsregeln, die OneUptime AI schreibt, und jede Regel, die sie geschrieben hat, wird auf den Einträgen ausgeführt, in denen die Daten gesehen wurden, bevor sie vorgeschlagen oder erstellt wird. Ebenso die Lesevorgänge sensibler Daten eines Pull Requests, deren Punkte in seiner Produktionsprüfung aufbewahrt werden, in Code und in ihrem Kommentar.

## Selbst nachsehen

**Datensicherheit → Einstellungen → OneUptime AI** zeigt all das für Ihr Projekt:

- **Was OneUptime AI sieht**: jede Funktion, was sie sendet und nie sendet, was sie startet, das Modell, auf dem sie läuft, und was von ihr aufbewahrt wird. Das Modell wird jedem genannt, der die LLM-Anbieter des Projekts lesen darf.
- **Beispiel anzeigen**: die genaue Eingabe, die **Mit KI erklären** für Ihr riskantestes offenes Problem senden würde, so wie es sie senden würde, mit dem, was **Mit KI beheben** fragen würde. Der KI-Kontext Ihres Projekts, der zuerst kommt, wird mit seiner Länge gezeigt. Es zeigt nur ein Problem, das Sie lesen dürfen.

**Projekteinstellungen → KI → LLM-Anbieter** verlinkt darauf, für alle, die das Modell wählen.

## Ihr eigenes Modell

Jede KI-Funktion der Datensicherheit läuft auf dem Modell, das Ihr Projekt gewählt hat:

- **Mit KI erklären** und die Feldvorschläge laufen auf dem Anbieter, den eine KI-Regel für die Arbeit wählt, sonst auf dem Standard-LLM-Anbieter Ihres Projekts, sonst auf dem eigenen des Servers.
- Der Code-Agent von **Mit KI beheben** läuft auf dem Anbieter, den eine KI-Regel wählt, sonst auf einem der eigenen Anbieter Ihres Projekts, sonst auf dem eigenen des Servers.
- **KI fragen** läuft auf dem im Chat gewählten Anbieter, sonst auf dem Standard Ihres Projekts.
- Der Lesevorgang sensibler Daten eines Pull Requests läuft auf dem Anbieter, den das Repository für seine Produktionsprüfungen wählt, sonst auf dem Standard-LLM-Anbieter Ihres Projekts, sonst auf dem eigenen des Servers.

Ein selbst gehostetes Modell führt sie alle aus: Ollama, vLLM oder ein beliebiger OpenAI-kompatibler Endpunkt, den Sie unter **Projekteinstellungen → KI → LLM-Anbieter** hinzufügen. Auf einem Server ohne Internetzugang ist das im Helm-Chart mitgelieferte vLLM der eigene Anbieter des Servers, sodass nichts den Server verlässt.

### Mit ausgeschalteter KI

Ist **KI aktivieren** unter **Projekteinstellungen → KI → KI-Funktionen** ausgeschaltet, sendet OneUptime AI nichts, und Datensicherheit arbeitet wie zuvor weiter: jede Seite, jede Prüfung, jeder Scan und jede Integration. An einem Problem erscheint keine KI-Schaltfläche, und nach einem Scan wird zu keinem Feld gefragt.

## Wie es gemessen wird

Jede KI-Funktion der Datensicherheit wird an einem festen Satz erfundener Fälle gemessen, die so gebaut sind, wie die Funktion ihre Eingabe baut, und danach bewertet, was eine richtige Antwort sagt: eine Erklärung, die die Behebung nennt und nichts wiederholt, was ihr der Name eines Datenspeichers zu sagen befahl, der richtige Datentyp für jedes Feld, eine Behebung, die ändert, was die Prüfung braucht, und sonst nichts, und eine Antwort aus dem, was KI fragen gelesen hat. Die Fälle laufen jede Nacht gegen ein festgelegtes Modell, bei jeder Änderung an einem KI-Prompt der Datensicherheit und vor jedem Release, für das jede Funktion ihren Schwellenwert erreichen muss.

Die Eigentümervorschläge werden danach bewertet, ob sie den Eigentümer nennen, auf den die Belege hinweisen, niemanden wählen, wenn sie auf niemanden hinweisen, und unsicher sind, wo sich die Belege widersprechen. Die Bereinigungsregeln werden auf erfundenen Werten jeder Stelle ausgeführt, die das Modell nie sieht, und danach bewertet, ob sie jeden Wert verbergen, der die Daten enthält, und keinen der anderen, und ob sie für eine Stelle, für die keine Regel richtig ist, keine Regel schreiben. Die Lesevorgänge von Pull Requests werden danach bewertet, ob sie jeden Punkt behalten, der ein Leck ist, weglassen, was keines ist, und eine Korrektur schreiben, die sagt, was zu ändern ist.

Um Ihr eigenes Modell an denselben Fällen zu messen, führen Sie die Auswertung aus einem Checkout von OneUptime aus, mit dem Schlüssel Ihres Modells, falls es einen braucht, in `AI_EVAL_LLM_API_KEY`:

```bash
npm run ai-data-security-eval -- --llm-type=Ollama --model=llama3.1:70b --base-url=http://localhost:11434
```

In Ihrem Projekt zählt **Übereinstimmende Einschätzungen** unter **Projekteinstellungen → KI → KI-Ergebnisse**, wie oft die Entscheidung der Menschen über ein von OneUptime AI analysiertes Problem so verlief, wie seine Einschätzung sagte: behoben oder akzeptiert bei **Echt**, akzeptiert oder als absichtlich öffentlich markiert bei **Wahrscheinlich absichtlich**, als kein Problem markiert bei **Wahrscheinlich ein falscher Fund**.

## Nächste Schritte

:::cards
- [Integrationen der Datensicherheit](/docs/data-security/integrations): Was Mit KI erklären und Mit KI beheben an einem Problem tun.
- [LLM-Anbieter](/docs/ai/llm-provider): Fügen Sie Ihr eigenes Modell hinzu, auch ein selbst gehostetes.
- [Sensible Datentypen](/docs/data-security/data-types): Wie die Felder, die kein Detektor zuordnen konnte, vorgeschlagen werden.
- [Prüfungen und Probleme der Datensicherheit](/docs/data-security/checks-and-issues): Was jedes Problem bedeutet und wie Sie es beheben.
:::
