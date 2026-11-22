# OneUptime AI in der Datensicherheit

OneUptime AI arbeitet mit dem, was Datensicherheit gefunden hat, ohne Ihre Daten zu sehen. Es erhält Namen, Formen, Anzahlen und Konfiguration, nie einen Wert Ihrer Daten, eine maskierte Stichprobe, einen Datensatz oder eine Verbindungszeichenfolge. Jede Funktion läuft auf dem eigenen Modell Ihres Projekts, auch einem selbst gehosteten, und jede Seite, jede Prüfung, jeder Scan und jede Integration der Datensicherheit funktioniert auch mit ausgeschalteter KI.

:::cards
- [Was OneUptime AI sieht](#was-oneuptime-ai-sieht): Was jede Funktion sendet und was sie nie sendet.
- [Selbst nachsehen](#selbst-nachsehen): Die genaue Eingabe, die eines Ihrer Probleme senden würde.
- [Ihr eigenes Modell](#ihr-eigenes-modell): Jede Funktion auf dem Anbieter Ihres Projekts, Ollama, vLLM oder einem beliebigen OpenAI-kompatiblen Endpunkt.
- [Wie es gemessen wird](#wie-es-gemessen-wird): Jede Funktion an festen Fällen, vor jedem Release.
:::

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

**Mit KI erklären** und **KI fragen** lesen außerdem zuerst den [KI-Kontext](/docs/ai/ai-context) Ihres Teams, wenn es einen hat: die Notizen, die Ihr Team für OneUptime AI über Ihre Systeme geschrieben hat. **Analyse neuer Probleme** liest ihn ebenfalls.

### Text aus Ihren Systemen ist Daten

Der Name eines Datenspeichers, seine Cloud-ID, seine Tags, die Belege, mit denen eine Cloud geantwortet hat, und der Schlüssel eines Attributs stammen aus Ihren Clouds und Ihrem Code, also schreibt jeder, der einen Bucket benennen oder eine Ressource taggen kann, mit an dem, was OneUptime AI liest. OneUptime AI erhält jede Anweisung in einer eigenen Nachricht und diesen Text in einer zweiten Nachricht, als Daten:

- jeder Text wird auf eine Länge begrenzt und in eine Zeile gesetzt, und was wie ein Geheimnis, eine E-Mail-Adresse oder eine IP-Adresse aussieht, wird weggelassen;
- Text, der wie Anweisungen an eine KI klingt, etwa „ignore previous instructions“, wird markiert, und OneUptime AI wird angewiesen, ihm nie zu folgen;
- eine strukturierte Antwort, etwa die der Feldvorschläge, wird streng gelesen: das angeforderte Objekt oder keine Antwort.

### Was aufbewahrt wird

Die Zeile jedes Aufrufs in **Projekteinstellungen → KI → KI-Protokolle** sagt, welche Funktion welches Modell aufgerufen hat, mit seinen Tokens und seinen Kosten. Sie bewahrt nie auf, was gesendet oder geantwortet wurde: Projektmitglieder und Betrachter lesen die KI-Protokolle, und die Datensätze der Datensicherheit sind für ihre Eigentümer und die Sicherheitsrollen bestimmt. Auch die eigene Telemetrie von OneUptime zeichnet nie auf, was Mit KI erklären oder die Feldvorschläge gesendet haben, selbst wo der Betreiber des Servers aufzeichnet, was andere KI-Aufrufe senden. Die Analyse selbst wird am Problem gespeichert, für alle, die das Problem lesen dürfen, und eine Zeile, die auf etwas beruht, das ein Leser nicht lesen darf, wird ihm ausgeblendet.

Schlägt ein Aufruf fehl, behalten Mit KI erklären und die Feldvorschläge kein Wort vom Fehler des Anbieters, der Gesendetes zitieren kann. Der Code-Agent hinter Mit KI beheben und der Chat von KI fragen behalten den Anbieterfehler eines fehlgeschlagenen Aufrufs weiterhin in seiner Zeile.

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

Ein selbst gehostetes Modell führt sie alle aus: Ollama, vLLM oder ein beliebiger OpenAI-kompatibler Endpunkt, den Sie unter **Projekteinstellungen → KI → LLM-Anbieter** hinzufügen. Auf einem Server ohne Internetzugang ist das im Helm-Chart mitgelieferte vLLM der eigene Anbieter des Servers, sodass nichts den Server verlässt.

### Mit ausgeschalteter KI

Ist **KI aktivieren** unter **Projekteinstellungen → KI → KI-Funktionen** ausgeschaltet, sendet OneUptime AI nichts, und Datensicherheit arbeitet wie zuvor weiter: jede Seite, jede Prüfung, jeder Scan und jede Integration. An einem Problem erscheint keine KI-Schaltfläche, und nach einem Scan wird zu keinem Feld gefragt.

## Wie es gemessen wird

Jede KI-Funktion der Datensicherheit wird an einem festen Satz erfundener Fälle gemessen, die so gebaut sind, wie die Funktion ihre Eingabe baut, und danach bewertet, was eine richtige Antwort sagt: eine Erklärung, die die Behebung nennt und nichts wiederholt, was ihr der Name eines Datenspeichers zu sagen befahl, der richtige Datentyp für jedes Feld, eine Behebung, die ändert, was die Prüfung braucht, und sonst nichts, und eine Antwort aus dem, was KI fragen gelesen hat. Die Fälle laufen jede Nacht gegen ein festgelegtes Modell, bei jeder Änderung an einem KI-Prompt der Datensicherheit und vor jedem Release, für das jede Funktion ihren Schwellenwert erreichen muss.

In Ihrem Projekt zählt **Übereinstimmende Einschätzungen** unter **Projekteinstellungen → KI → KI-Ergebnisse**, wie oft die Entscheidung der Menschen über ein von OneUptime AI analysiertes Problem so verlief, wie seine Einschätzung sagte: behoben oder akzeptiert bei **Echt**, akzeptiert oder als absichtlich öffentlich markiert bei **Wahrscheinlich absichtlich**, als kein Problem markiert bei **Wahrscheinlich ein falscher Fund**.

Um Ihr eigenes Modell an denselben Fällen zu messen, führen Sie die Auswertung aus einem Checkout von OneUptime aus, mit dem Schlüssel Ihres Modells, falls es einen braucht, in `AI_EVAL_LLM_API_KEY`:

```bash
npm run ai-data-security-eval -- --llm-type=Ollama --model=llama3.1:70b --base-url=http://localhost:11434
```

## Nächste Schritte

:::cards
- [Integrationen der Datensicherheit](/docs/data-security/integrations): Was Mit KI erklären und Mit KI beheben an einem Problem tun.
- [LLM-Anbieter](/docs/ai/llm-provider): Fügen Sie Ihr eigenes Modell hinzu, auch ein selbst gehostetes.
- [Sensible Datentypen](/docs/data-security/data-types): Wie die Felder, die kein Detektor zuordnen konnte, vorgeschlagen werden.
- [Prüfungen und Probleme der Datensicherheit](/docs/data-security/checks-and-issues): Was jedes Problem bedeutet und wie Sie es beheben.
:::
