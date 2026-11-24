# Externe MCP-Server

OneUptime AI kann die Werkzeuge von MCP-Servern außerhalb von OneUptime nutzen – die Ihrer Cloud, Ihres Code-Hosts oder Ihres eigenen Teams, etwa AWS, Azure oder GitHub –, in KI fragen und während es Vorfälle und Warnungen untersucht und behebt. Fügen Sie einen Server einmal unter **Projekteinstellungen → KI → Externe MCP-Server** hinzu, und OneUptime AI nutzt ihn ab Ihrer nächsten Frage und dem nächsten Vorfall.

:::cards
- [Einen Server hinzufügen](#einen-server-hinzufügen): Seine Adresse und wie sich OneUptime anmeldet.
- [Was OneUptime AI mit einem Server tut](#was-oneuptime-ai-mit-einem-server-tut): Lesende Werkzeuge in Untersuchungen, die anderen in Behebungen.
- [In KI fragen](#in-ki-fragen): Bitten Sie es, die Werkzeuge eines Servers aufzulisten oder eines davon zu nutzen; eine Änderung wartet auf Ihre Genehmigung.
- [Die Server wählen, die eine Regel nutzen darf](#die-server-wählen-die-eine-regel-nutzen-darf): Alle, sofern eine Regel nicht einige auswählt.
- [Sicherheit](#sicherheit): Was ein Server OneUptime AI tun lassen kann und was nicht.
:::

Diese Seite handelt von Servern, mit denen sich OneUptime AI verbindet. Um stattdessen einen KI-Assistenten wie Claude oder Cursor mit OneUptime zu verbinden, siehe [MCP-Server](/docs/ai/mcp-server).

## Bevor Sie beginnen

- **OneUptime AI ist eingeschaltet** für das Projekt, mit einem LLM-Anbieter, den es nutzen kann: siehe [LLM-Anbieter](/docs/ai/llm-provider).
- **Die MCP-Adresse des Servers.** Streamable HTTP und das ältere HTTP mit SSE funktionieren beide: OneUptime erkennt beim Verbinden, welches der Server spricht.
- **Wie sich OneUptime dort anmeldet:** ein API-Token, eigene Header des Servers oder OAuth-Client-Anmeldedaten von Ihrem Identitätsanbieter.
- **Ein Project Owner oder ein Project Admin** fügt Server hinzu, ändert, testet und entfernt sie; Projektmitglieder und Betrachter können sie sehen. In OneUptime Cloud braucht das Hinzufügen eines Servers den Growth-Tarif oder höher.

## Einen Server hinzufügen

:::steps
### Externe MCP-Server öffnen
Gehen Sie zu **Projekteinstellungen → KI → Externe MCP-Server** und klicken Sie auf **Externer MCP-Server erstellen**.

### Angeben, wo er ist
Geben Sie ihm einen **Name**, unter dem OneUptime AI und die Leser dessen, was es getan hat, ihn sehen, und seine **URL**, etwa `https://mcp.example.com/mcp`. Unter **Weitere Felder** sagt eine **Beschreibung**, wofür der Server da ist; OneUptime AI liest sie, um den richtigen Server auszuwählen.

### Wählen, wie sich OneUptime anmeldet
Wählen Sie eine Karte unter **Authentifizierung** und füllen Sie aus, was sie verlangt (siehe [Authentifizierung](#authentifizierung)).

### Sehen, was OneUptime gefunden hat
Beim Speichern verbindet sich OneUptime sofort, und der Dialog **Verbindung testen** zeigt, was es gefunden hat: den Server, wie er kommuniziert, und jedes seiner Werkzeuge, markiert mit **Nur lesend** oder **Kann Änderungen vornehmen**. Konnte es sich nicht verbinden, sagt der Dialog warum und was zu prüfen ist.
:::

Die Serverliste zeigt, wie es jedem Server geht: **Verbunden**, **Keine Verbindung** (zeigen Sie darauf, um den Grund zu sehen), **Noch nicht geprüft** oder **Aus**, und wie viele Werkzeuge er anbietet. Die Seite eines Servers zeigt seine Details, den Schalter, der OneUptime AI ihn nutzen lässt, und seine **Werkzeuge**, mit **Verbindung testen**, um sich erneut zu verbinden und sie neu zu lesen. Ein Test ruft keines der Werkzeuge des Servers auf.

## Authentifizierung

| Authentifizierung | Was OneUptime sendet | Was Sie ausfüllen |
| --- | --- | --- |
| **Keine Anmeldung** | Nichts | Nichts. Für einen Server, der keine Anmeldung braucht oder nur aus Ihrem Netzwerk erreichbar ist. |
| **Bearer-Token** | `Authorization: Bearer <token>` | **Token** |
| **Benutzerdefinierte Header** | Die Header, die Sie eingeben, mit jeder Anfrage | Einen Namen und einen Wert je Header, etwa `X-API-Key`. Höchstens 10. |
| **OAuth-Client-Anmeldedaten** | Ein Token, das es bei Ihrem Identitätsanbieter anfordert, als Bearer-Token, und erneut anfordert, bevor es abläuft | **Token-URL**, **Client-ID** und **Client-Secret** auf einem eigenen Schritt; **Geltungsbereich** und **Zielgruppe (Audience)** unter **Weitere Felder** |

Das Token, die Werte der Header und das Client-Secret werden verschlüsselt gespeichert und nie wieder angezeigt, auch nicht denen, die sie gespeichert haben. Beim Bearbeiten sind sie leer; lassen Sie eines leer, um das Gespeicherte zu behalten. Die Seite des Servers zeigt die Namen der Header, die er sendet, nie ihre Werte. Eine Änderung der **Authentifizierung** entfernt die Geheimnisse, die die alte Anmeldung nutzte.

Setzen Sie nie ein Token oder ein Passwort in die **URL**: Jeder, der den Server lesen kann, liest seine Adresse, und ein Benutzername oder Passwort darin wird abgelehnt.

## Was OneUptime AI mit einem Server tut

Jedes Werkzeug, das ein Server anbietet, liest entweder nur oder kann etwas ändern. OneUptime richtet sich danach, was der Server über das Werkzeug sagt (sein `readOnlyHint`): Ein Werkzeug, das der Server nicht als nur lesend markiert, gilt als eines, das etwas ändern kann. Manche Server markieren keines ihrer Werkzeuge: Eine Untersuchung hat dann kein Werkzeug von ihnen, das sie nutzen kann, und in KI fragen wartet jeder Aufruf eines ihrer Werkzeuge auf Ihre Genehmigung.

```mermaid title="Welche Werkzeuge OneUptime AI von sich aus nutzt, und wann"
flowchart TB
    T["Ein Werkzeug<br/>Ihres MCP-Servers"] --> Q{"Liest es<br/>nur?"}
    Q -->|"ja"| R["Genutzt in<br/>Untersuchungen<br/>und Behebungen"]
    Q -->|"nein"| C["Nur in<br/>Behebungen<br/>genutzt"]
    C --> A{"Die Genehmigung<br/>der Regel"}
    A -->|"Vor dem Beheben<br/>fragen"| P["Vorgeschlagen,<br/>zur Freigabe<br/>durch eine Person"]
    A -->|"Ohne Nachfrage<br/>beheben"| M["Sofort ausgeführt,<br/>über die Server,<br/>die die Regel<br/>nennt"]
```

| | Werkzeuge, die nur lesen | Werkzeuge, die etwas ändern können |
| --- | --- | --- |
| **Untersuchungen** | Genutzt, neben OneUptimes eigenen Daten | Nie genutzt: OneUptime lehnt den Aufruf ab |
| **Behebungen** | Genutzt, um die Behebung auszuarbeiten | Zur Genehmigung vorgeschlagen oder sofort genutzt, wie die **Behebung** der KI-Regel es vorgibt |
| **KI fragen** | Genutzt, wenn Sie darum bitten | Genutzt, sobald Sie jeden Aufruf genehmigen |

**In einer Untersuchung** listet OneUptime AI die Werkzeuge der Server auf, die es nutzen darf, und ruft die lesenden auf, um sich anzusehen, was OneUptime selbst nicht sieht: Ihr Cloud-Konto, ein Deployment, einen Issue-Tracker. Was sie antworten, nutzt es in seiner Ursachenanalyse. Siehe [AI SRE](/docs/ai/ai-sre).

**Bei einer Behebung** arbeitet OneUptime AI eine Behebung über einen Server aus, den es nutzen darf, wenn er ein Werkzeug anbietet, das etwas ändern kann – nach der Ursachenanalyse, wenn es eine gibt:

- **Vor dem Beheben fragen** – jede Änderung, die es vornehmen würde, wird aufgezeichnet und nirgendwohin gesendet. Der Schritt **Behebung** der Karte **OneUptime AI** des Vorfalls fasst sie in einem Satz zusammen, und **Prüfen und genehmigen** listet sie der Reihe nach auf, jede mit ihrem Server, ihrem Werkzeug und dem, was sie senden würde. **Genehmigen & ausführen** nimmt genau diese Änderungen vor, in dieser Reihenfolge, unter Ihrem Namen; die Genehmigung erfordert dieselbe Berechtigung wie das Starten eines Runbooks. Eine fehlgeschlagene Änderung stoppt die nachfolgenden.
- **Ohne Nachfrage beheben** – OneUptime AI nimmt die Änderungen selbst vor, jede wird aufgezeichnet, bevor sie gesendet wird. Das tut es nur für eine Regel, die ihre MCP-Server nennt, wenn keine andere passende Regel zuerst fragt, nichts anderes den Vorfall bereits von sich aus behebt (ein KI-Agent auf einem Cluster oder Host oder ein Runbook) und die Regel noch nicht die meisten Behebungen vorgenommen hat, die sie in einer Stunde selbst vornehmen darf; sonst werden die Änderungen vorgeschlagen. Ohne eingerichtete Regel oder mit einer Regel, die keinen MCP-Server nennt, wird jede Änderung vorgeschlagen.

Eine Behebung nimmt höchstens 5 Änderungen vor. Danach beobachtet OneUptime die Monitore des Vorfalls, wie bei jeder Behebung. Nichts wird automatisch rückgängig gemacht: Ein MCP-Werkzeug hat kein Rückgängig, das OneUptime kennen kann, also bleibt eine Behebung, die nicht gewirkt hat, einer Person überlassen, und der Schritt **Behebung** zeigt, was jeder Server geantwortet hat.

Damit OneUptime AI einen Server nicht mehr nutzt, schalten Sie **OneUptime AI diesen Server nutzen lassen** auf seiner Seite aus. Es fragt zuerst: Der Server wird in keiner Untersuchung oder Behebung mehr genutzt, und eine vorgeschlagene Behebung über ihn kann nicht mehr genehmigt werden.

## In KI fragen

KI fragen und die Unterhaltung unter der Karte **OneUptime AI** eines Vorfalls oder einer Warnung können jeden eingeschalteten Server nutzen, für die Person, die fragt. Fragen Sie „Welche Werkzeuge hat AWS?“, und OneUptime AI listet sie auf, jedes markiert mit dem, was es tun darf; bitten Sie es, eines davon zu nutzen, mit Angabe seines Servers und seines Namens, und es ruft es auf und antwortet anhand dessen, was zurückkam.

- **Werkzeuge, die nur lesen**, laufen sofort, in jedem Berechtigungsmodus.
- **Jedes andere Werkzeug** wartet auf Sie, auch bei **Automatisch ausführen**: Die Genehmigungskarte nennt den Server und das Werkzeug und zeigt genau, was gesendet wird, und nichts erreicht den Server, bevor Sie es zulassen. Eine Unterhaltung im Modus **Nur Lesezugriff** bietet nie eines an.
- **Ihre Berechtigungen entscheiden.** Einen Server zu nutzen erfordert dasselbe wie das Lesen der externen MCP-Server des Projekts; eine Änderung über einen davon zu genehmigen erfordert die Berechtigung, Runbook-Ausführungen zu starten, wie die Genehmigung einer Behebung über MCP-Server. Ein abgelehnter Aufruf sagt, warum, und sendet nichts.

Die Server, die eine KI-Regel nennt, sind die, die OneUptime AI von sich aus nutzt, für das, worauf die Regel passt; in KI fragen wählen Sie den Server.

## Die Server wählen, die eine Regel nutzen darf

Jede KI-Regel kann die MCP-Server nennen, die OneUptime AI für das nutzen darf, worauf sie passt. Das Feld ist **MCP-Server** unter **Weitere Felder**. Bis Sie einige auswählen, darf OneUptime AI alle nutzen, und der eingeklappte Abschnitt sagt das.

- **Keiner ausgewählt** – alle eingeschalteten Server des Projekts.
- **Einige ausgewählt** – nur diese. Bei einer KI-Regel, die ohne Nachfrage behebt, ist das Nennen ihrer Server auch das, was OneUptime AI deren Änderungen ohne Nachfrage vornehmen lässt.

Passen mehrere Regeln, die untersuchen, darf OneUptime AI jeden Server nutzen, den eine von ihnen erlaubt; können die Regeln nicht gelesen werden, nutzt die Untersuchung gar keinen MCP-Server. Eine Untersuchung, die jemand für einen Vorfall oder eine Warnung startet, auf die keine Regel passt, darf alle nutzen. Jede passende Regel, die behebt, arbeitet ihre eigene Behebung über ihre Server aus, und die Regeln, die keinen nennen, teilen sich eine Behebung über alle.

## Sicherheit

- **Was ein Server zurücksendet, sind Daten, nie Anweisungen.** OneUptime AI liest die Beschreibungen und Antworten seiner Werkzeuge als Text von außerhalb von OneUptime: Sie ändern nie eine Regel, eine Genehmigung oder das, was OneUptime AI tun darf.
- **Ein Werkzeug bekommt nur, was es annimmt.** OneUptime sendet einem Werkzeug nur die Argumente, die sein Schema nennt; alles andere, was OneUptime AI geschrieben hat, bleibt in OneUptime.
- **Der Schalter „KI aktivieren“ stoppt jeden Aufruf.** Ist **KI aktivieren** ausgeschaltet, sendet OneUptime nichts an einen Server: keinen Aufruf einer Untersuchung, einer Behebung oder von KI fragen, nicht einmal einen, den eine Person schon genehmigt hat.
- **Die Adresse wird bei jeder Verbindung geprüft.** OneUptime verbindet sich nie mit seiner eigenen oder einer Link-Local-Adresse. In OneUptime Cloud lehnt es auch private Netzwerkadressen ab: Verwenden Sie die öffentliche Adresse des Servers. Ein selbst gehostetes OneUptime erreicht private Adressen, sofern `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` nicht gesetzt ist. Weiterleitungen folgt es nicht.
- **Grenzen.** Ein Projekt hat höchstens 20 Server, und OneUptime liest höchstens 200 Werkzeuge pro Server. Das Verbinden läuft nach 20 Sekunden ab, das Auflisten der Werkzeuge nach 30 und ein Werkzeugaufruf nach 60. Eine Antwort über 2 MB wird abgelehnt. Die Aufrufe einer Ausführung an MCP-Server zählen zu den Limits pro Ausführung des Projekts, wenn es welche festlegt.
- **Jeder Aufruf wird aufgezeichnet.** Jeder Aufruf ist ein Schritt des Laufs, in seiner Aktivität sichtbar (in KI fragen unter den Schritten der Antwort), und jede Änderung einer Behebung steht im Schritt **Behebung**, mit der Antwort des Servers. Die Modellaufrufe dahinter stehen unter **Projekteinstellungen → KI → KI-Protokolle**.

## Fehlerbehebung

:::details Keine Verbindung, oder der Test schlägt fehl
Der Dialog **Verbindung testen** sagt, was schiefging und was zu prüfen ist: die Adresse (eine private Adresse in OneUptime Cloud, ein Host, der nicht antwortet), die Anmeldung (ein Token oder Header, die der Server abgelehnt hat, oder eine Token-URL, die kein Token geliefert hat) oder eine URL, die nicht die MCP-Adresse des Servers ist. Korrigieren Sie die Einstellungen des Servers mit **Bearbeiten** auf seiner Seite und testen Sie erneut.
:::

:::details OneUptime AI nutzt einen Server nicht
Prüfen Sie, ob **OneUptime AI diesen Server nutzen lassen** eingeschaltet ist und ob die Werkzeuge des Servers gelesen wurden: Seine Karte **Werkzeuge** listet sie auf, jedes markiert mit **Nur lesend** oder **Kann Änderungen vornehmen**, und **Verbindung testen** liest sie erneut. Fragen Sie dann in KI fragen „Welche Werkzeuge hat AWS?“, mit dem Namen Ihres Servers: Es listet sie auf oder sagt, warum es den Server nicht erreichen kann oder nicht nutzen darf. Prüfen Sie für eine Untersuchung außerdem, ob die Regel, die auf den Vorfall passte, unter **Weitere Felder** keine anderen Server nennt: Eine Untersuchung nutzt nur die mit **Nur lesend** markierten Werkzeuge, ein Server, der keines seiner Werkzeuge markiert, bietet ihr also keines an.
:::

## Nächste Schritte

:::cards
- [AI SRE](/docs/ai/ai-sre): Wie OneUptime AI untersucht und behebt, und die Regeln, die entscheiden, welche Vorfälle.
- [LLM-Anbieter](/docs/ai/llm-provider): Das Modell, das die Werkzeuge der Server nutzt.
- [MCP-Server](/docs/ai/mcp-server): Stattdessen einen KI-Assistenten mit OneUptime verbinden.
:::
