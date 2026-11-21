# Cloudflare

Importieren Sie in die Sicherheitsereignisse von OneUptime, was die Firewall von [Cloudflare](https://www.cloudflare.com) am Edge getan hat: die Anfragen, die ihre verwalteten und eigenen WAF-Regeln, die Ratenbegrenzung, die IP Access Rules, das Bot-Management und der HTTP-DDoS-Schutz blockiert, mit einer Challenge geprüft oder protokolliert haben. Jede steht neben den eigenen Anfragen Ihrer App, sodass ein Fall sagt, was Cloudflare gestoppt hat und was Ihre App trotzdem erreicht hat. OneUptime liest sie mit einem API-Token, das nur lesen kann, und ändert nichts in Cloudflare, solange Sie das Sperren nicht einschalten, das Ihre Sperrliste dort durchsetzt.

:::cards
- [Die Verbindung einrichten](#die-verbindung-einrichten): Ein API-Token mit zwei Leseberechtigungen und das Formular der Verbindung.
- [Was importiert wird](#was-importiert-wird): Welche Ereignisse, und wie aus jedem ein Sicherheitsereignis wird.
- [So funktioniert das Abfragen](#so-funktioniert-das-abfragen): Das Zeitfenster jeder Abfrage, und warum es sich um 10 Minuten überlappt.
- [Adressen bei Cloudflare sperren](#adressen-bei-cloudflare-sperren): Ihre Sperrliste, durchgesetzt durch zwei IP-Listen und eine benutzerdefinierte Regel pro Liste.
- [Fehlerbehebung](#fehlerbehebung): Was jeder Fehler bedeutet und was zu ändern ist.
:::

## So funktioniert es

```mermaid title="Von einer Anfrage, auf die Cloudflare reagiert hat, zum Sicherheitsereignis"
flowchart TB
    edge["Die Firewall von<br/>Cloudflare reagiert<br/>auf eine Anfrage"] --> poll["OneUptime fragt im<br/>Intervall der<br/>Verbindung ab"]
    poll --> zones["Es liest die<br/>Firewall-Ereignisse<br/>jeder Zone seit dem<br/>letzten Mal"]
    zones --> event["Jedes wird als<br/>HTTP-Activity-<br/>Ereignis gespeichert"]
```

Jede Minute fragt OneUptime jede aktivierte Verbindung ab, deren Abfrageintervall abgelaufen ist. Eine Abfrage listet die Zonen des Kontos, liest aus dem Settings-Knoten der GraphQL Analytics API, was der Tarif jeder Zone erlaubt, und liest die Firewall-Ereignisse jeder Zone seit der letzten Abfrage aus dem Datensatz `firewallEventsAdaptive` ([Security Events](https://developers.cloudflare.com/waf/analytics/security-events/)), die ältesten zuerst. Jedes Ereignis wird als [OCSF](https://schema.ocsf.io/)-Ereignis HTTP Activity gespeichert.

## Bevor Sie beginnen

- In OneUptime die Rolle Projektinhaber, Projektadministrator oder Sicherheits-Administrator. Sicherheits-Mitglied und Sicherheits-Betrachter sehen Verbindungen und ihren Laufverlauf, können sie aber nicht ändern.
- Ein Cloudflare-Benutzer, der API-Tokens für die Zonen des Kontos anlegen kann.
- Zonen, deren Datenverkehr über Cloudflare läuft: Ihre DNS-Einträge sind proxied.
- Ausgehendes HTTPS von der OneUptime-App und den Workern zu `api.cloudflare.com`.

## Die Verbindung einrichten

Die Verbindung liest mit einem [API-Token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/), nie mit einem Global API Key: Ein Token ist auf das Konto und seine Zonen beschränkt, und Sie können es einzeln widerrufen. Es braucht zwei [Berechtigungen](https://developers.cloudflare.com/fundamentals/api/reference/permissions/), beide nur zum Lesen:

| Berechtigung | Was OneUptime damit liest |
| --- | --- |
| `Zone > Zone > Read` | Die Zonen, mit ihren Konten und Tarifen. |
| `Zone > Analytics > Read` | Die Firewall-Ereignisse jeder Zone, über die GraphQL Analytics API. |

:::steps
### Ein API-Token anlegen

1. Öffnen Sie im Cloudflare-Dashboard **My Profile → API Tokens**, wählen Sie **Create Token** und dann **Create Custom Token**.
2. Nennen Sie es `oneuptime-security-events`. Fügen Sie unter **Permissions** `Zone > Zone > Read` und `Zone > Analytics > Read` hinzu.
3. Nehmen Sie unter **Zone Resources** alle Zonen des Kontos auf, oder die zu importierenden Zonen.
4. Wählen Sie **Continue to summary**, dann **Create Token**, und kopieren Sie das Token. Cloudflare zeigt es nur einmal.

### Die Verbindung in OneUptime hinzufügen

Öffnen Sie **Produkte → Sicherheitsereignisse → Verbindungen** (`/dashboard/{projectId}/security-events/connections`), klicken Sie auf **Verbindung hinzufügen**, wählen Sie **Cloudflare** unter **Cloud-Sicherheit** und klicken Sie auf **Weiter**. Fügen Sie das Token in **API-Token** ein. OneUptime listet dann die Konten und Zonen, die das Token lesen kann: Wählen Sie das **Konto**, und lassen Sie unter **Zonen** **Alle Zonen** stehen, oder wählen Sie die zu importierenden Zonen.

### Vor dem Speichern testen

Klicken Sie auf **Diese Einstellungen testen** unter **Vor dem Speichern testen**. Der Test prüft jede Berechtigung mit den Werten im Formular, nennt jede fehlende und speichert nichts. Klicken Sie dann auf **Weiter**, geben Sie der Verbindung einen **Name** und legen Sie sie an.
:::

| Einstellung | Was einzutragen ist |
| --- | --- |
| **Konto** | Das zu lesende Cloudflare-Konto, ausgewählt aus den Konten, die Ihr API-Token liest. Ein Token, das ein einziges Konto liest, wählt es für Sie aus. |
| **Zonen** | Optional. Leer liest jede aktive Zone des Kontos, auch später hinzugefügte. Eine Verbindung liest höchstens 50 Zonen. |
| **API-Token** | Das Token allein, ohne `Bearer`. Es wird verschlüsselt, nie von der API zurückgegeben und nie wieder angezeigt. Ersetzen Sie es mit **Anmeldedaten aktualisieren** an der Verbindung. |

Der Schritt **Abfrage** hat außerdem eine optionale **Beschreibung**, das **Abfrageintervall (Minuten)**, eine ganze Zahl von `1` bis `1440`, die mit `5` beginnt, und **Aktiviert**, das eingeschaltet beginnt. Die Ereignisse von Cloudflare sind Anfragen, keine Warnungen, daher fragt das Formular nicht nach **Fälle eröffnen ab**: Fälle entstehen durch die Erkennungsregeln, die sie lesen.

### Schreibzugriff ist eine eigene Entscheidung

Diese Verbindung ändert nichts in Cloudflare, bis Sie das Sperren in ihrer Zeile einschalten. Erst dann fragt OneUptime nach Schreibberechtigungen, und es prüft sie, bevor es etwas sperrt: [Adressen bei Cloudflare sperren](#adressen-bei-cloudflare-sperren) nennt jede einzelne und wofür sie dient. Fügen Sie sie dem Token erst hinzu, wenn Sie das Sperren einschalten.

## Was importiert wird

Jedes Ereignis hat den Anbieter `Cloudflare` und das Produkt `Cloudflare WAF` und ist ein Ereignis HTTP Activity (`4002`).

| Feld von Cloudflare | Im Sicherheitsereignis |
| --- | --- |
| `clientIP` | Die Principal-IP und `client.address` |
| `clientRequestHTTPHost`, `clientRequestPath`, `clientRequestQuery` | Der Zielhost, die Zielressource (Pfad und Query) und `url.original` |
| `clientRequestHTTPMethodName`, `userAgent` | Die Aktivität, `http.request.method` und `user_agent.original` |
| `action` | Der Status und `oneuptime.edge.action` |
| `source`, `ruleId`, `description` | Die Regel-ID, der Regelname und `cloudflare.source` |
| `rayName`, `clientCountryName`, `clientAsn` | `cloudflare.ray_id`, `cloudflare.client.country` und `cloudflare.client.asn` |
| `sampleInterval` | `oneuptime.edge.sample_interval` |

| Was Cloudflare getan hat | Status | `oneuptime.edge.action` | Ergebnis der Anfrage | Schweregrad |
| --- | --- | --- | --- | --- |
| Blockiert, die Verbindung geschlossen oder eine Challenge nicht bestanden | Blocked, oder Dropped bei geschlossener Verbindung | `blocked` | Rejected | Low |
| Mit einer verwalteten, JS- oder interaktiven Challenge geantwortet | Challenge | `challenged` | Rejected | Low |
| Eine bestandene Challenge, oder ein Besucher, der schon eine bestanden hatte | Allowed | `passed-challenge` | Keines | Informational |
| Protokolliert und durchgelassen | Logged | `logged` | Der Statuscode des Ursprungs | Medium; High, wenn der Ursprung fehlschlug; Low, wenn er die Anfrage abwies |
| Durch eine eigene Skip- oder Allow-Regel durchgelassen | Allowed | `let-through` | Der Statuscode des Ursprungs | Wie bei einer protokollierten Anfrage |

Eine Anfrage, die eine Ihrer eigenen Skip- oder Allow-Regeln durchgelassen hat, wird nur importiert, wenn sie einen Angriff enthält (SQL-Injection, Path Traversal oder einen Log4Shell-Lookup) oder der WAF Attack Score von Cloudflare sie so einstuft. Der Rest ist Datenverkehr, den Sie bewusst erlauben, etwa Ihre Monitore: Jeder Lauf zählt ihn und lässt ihn weg.

Cloudflare nimmt bei einer ausgelasteten Zone Stichproben der Ereignisse. Jedes Ereignis behält sein Stichprobenintervall, die Zahl der gleichartigen Anfragen, für die es steht, und jede Zahl, die OneUptime daraus bildet, sagt *etwa*.

Die Ereignisse erscheinen unter Ereignisse, unter Kampagnen (Angriffsanfragen nach Adresse), im Entitätsrisiko und in Erkennungsregeln. Ein Fall zu einer Adresse zeigt unter **Am Edge** in seinen Auswirkungen, was Cloudflare mit den Anfragen der Adresse getan hat, neben dem, was Ihre App erreicht hat. Die Cloudflare-Regeln der Regelbibliothek lesen sie so, wie sie hier importiert werden: viele Treffer verwalteter Regeln von einer Adresse, eine Adresse, die eine Challenge bestanden und dann Angriffe gesendet hat, und ein von Cloudflare durchgelassener Angriff, der Ihre App erreicht hat.

## Tarifgrenzen

Jeder Tarif hat Firewall-Ereignisse über die API. **What each zone's plan gives** in **Verbindung testen** liest die eigenen Grenzen jeder Zone von Cloudflare.

| Tarif | Free | Pro | Business | Enterprise |
| --- | --- | --- | --- | --- |
| Aufbewahrte Firewall-Ereignisse | 31 Tage | 31 Tage | 31 Tage | 31 Tage |
| Längste Abfrage | 30 Tage | 30 Tage | 30 Tage | 31 Tage |

Logpush von Cloudflare kann Firewall-Ereignisse ebenfalls senden, seit dem 30. September 2026 bei jedem Tarif, nach Nutzung abgerechnet. Diese Verbindung fragt stattdessen ab und braucht deshalb nichts außer den zwei Leseberechtigungen.

## So funktioniert das Abfragen

- **Ereignisse werden danach gelesen, wann sie am Edge geschahen.** Die Analysedaten von Cloudflare sind ein bis zwei Minuten nach der Anfrage abfragbar.
- **Die erste Abfrage blickt 24 Stunden zurück**, sodass eine neue Verbindung ihre jüngsten Ereignisse sofort zeigt.
- **Jede spätere Abfrage beginnt 10 Minuten vor dem gespeicherten Cursor**, sodass ein Ereignis, das Cloudflare spät lesbar macht, bei der nächsten Abfrage gelesen wird; Duplikate werden innerhalb des Projekts anhand der Ray ID jedes Ereignisses verworfen.
- **Eine Abfrage liest höchstens 24 Stunden über den Cursor hinaus.** Eine Verbindung, deren Cursor zurückgefallen ist, holt in einer Reihe von 24-Stunden-Fenstern auf.
- **Die Zonen werden nacheinander gelesen**, je eine Seite mit bis zu 2.000 Ereignissen, sodass eine ausgelastete Zone eine Abfrage nicht aufbraucht, bevor eine ruhige gelesen ist.
- **Die Ratengrenzen von Cloudflare werden eingehalten.** Cloudflare erlaubt 1.200 REST-Anfragen und 300 GraphQL-Abfragen in fünf Minuten. Ein `429`, das um 30 Sekunden oder weniger Wartezeit bittet, wird abgewartet und erneut gestellt; ein längeres beendet die Abfrage, und die nächste macht weiter.
- **Eine Zone, die das Token nicht lesen kann, hält nichts auf.** Die anderen Zonen werden importiert, der Lauf ist **Teilweise**, und seine Warnung nennt die Zone. Geben Sie dem Token dort `Zone > Analytics > Read` und nutzen Sie dann **Diesen Zeitraum importieren**, um das Fenster nachzuholen.
- **Ein fehlgeschlagener Lauf ändert nichts.** Nach einem Netzwerkfehler oder einem Fehlerstatus von Cloudflare bleiben Cursor und Fensterlänge, wie sie waren, und die nächste Abfrage liest dasselbe Fenster erneut. Die einzige Ausnahme ist eine Anfrage, die das Zeitlimit überschritten hat: Der Cursor bleibt, aber das nächste Fenster ist halb so lang, denn ein Fenster, das zu schwer ist, um rechtzeitig zu antworten, würde bei jedem Versuch das Zeitlimit überschreiten.

### Wenn ein Fenster mehr enthält, als eine Abfrage lesen kann

Eine Abfrage sendet höchstens 120 Anfragen, liest höchstens 20.000 Ereignisse und hört nach 4 Minuten auf. Ereignisse werden die ältesten zuerst gelesen, daher ist der Lauf **Teilweise**, wenn ein Budget eine Abfrage stoppt, und die nächste Abfrage setzt beim ältesten Ereignis fort, bis zu dem die nicht fertigen Zonen gelesen wurden. Wenn nicht jede Zone einmal gelesen werden konnte, verkürzt OneUptime stattdessen das Fenster:

1. **Eingrenzen.** Die nächste Abfrage liest ein halb so langes Fenster vom selben Startpunkt und halbiert weiter, bis ein Fenster vollständig gelesen wird, bis hinunter zu einer Minute. Die Warnung des Laufs sagt es: `This window holds more records than one poll can read; the next poll reads a {n} minute window from the same starting point.` Ereignisse, die aus dem längeren Fenster schon importiert wurden, werden als Duplikate übersprungen.
2. **Wieder wachsen.** Nachdem ein Fenster vollständig gelesen wurde, rückt der Cursor an sein Ende, und das nächste Fenster ist wieder doppelt so lang, bis zu 24 Stunden.
3. **Über eine einzelne Minute hinweggehen.** Wenn schon eine Minute mehr enthält, als eine Abfrage lesen kann, geht das Abfragen über sie hinweg, damit neuere Ereignisse weiter ankommen. Der Lauf bleibt **Teilweise**, und **Letzter Fehler** lautet `More records were created in the one minute from {cursor} to {end} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.` Importieren Sie diese Minute mit **Diesen Zeitraum importieren**, um nachzuholen, was ein Lauf lesen kann.

Eine Änderung des **Abfrageintervall (Minuten)** ändert nichts davon: Es entscheidet, wie oft eine Abfrage startet, nicht, wo ihr Fenster beginnt.

### Auf Anforderung ausführen, voransehen und importieren

Klicken Sie an einer Verbindung auf **Diagnose**, um ihre letzten Läufe zu sehen und von Hand mit ihr zu arbeiten. Wer die Verbindung ändern darf, kann diese starten; wer sie sehen darf, kann den Verlauf lesen.

- **Jetzt ausführen** startet sofort eine Abfrage mit dem üblichen Cursor, auch wenn die Verbindung nicht **Aktiviert** ist.
- **Vorschau der Firewall-Ereignisse** liest einen Zeitraum von bis zu 7 Tagen und importiert nichts.
- **Diesen Zeitraum importieren** importiert nach Ihrer Bestätigung einen Zeitraum von bis zu 7 Tagen, ohne den Cursor zu bewegen. Bereits importierte Ereignisse werden übersprungen. Cloudflare bewahrt Firewall-Ereignisse 31 Tage auf.
- **Diagnosen kopieren** an einem Lauf kopiert seinen Bericht für den Support. Er enthält nie Anmeldedaten.

## Verbindung testen

**Verbindung testen** in der Zeile einer Verbindung und **Diese Einstellungen testen** im Formular laufen im API-Prozess, nicht in einem Hintergrund-Worker, sodass ein Test auch dann antwortet, wenn die Worker das Problem sind. Er führt diese Prüfungen der Reihe nach aus:

| Prüfung | Was sie prüft |
| --- | --- |
| **Konfiguration** | Token, Konto und Zonen sind wohlgeformt. Schlägt dies fehl, wird nichts kontaktiert. |
| **Verify the API token** | Cloudflare akzeptiert das Token, das eines Benutzers oder eines, das dem Konto gehört, und es ist aktiv. Eines, das innerhalb von 14 Tagen abläuft, ist eine Warnung. |
| **List the zones** | Das Token hat `Zone > Zone > Read`: Es listet die Zonen des Kontos und jede gewählte Zone. |
| **Read firewall events** | Das Token hat `Zone > Analytics > Read` auf jeder Zone. Ein Fehler nennt die Zonen, auf denen sie fehlt. |
| **What each zone's plan gives** | Wie lange der Tarif jeder Zone Firewall-Ereignisse aufbewahrt und wie lang eine Abfrage sein darf. Eine Zone, deren Tarif keine hat, ist eine Warnung. |
| **Firewall events available to import** | Etwa wie viele Ereignisse die letzten 24 Stunden und die letzten 7 Tage enthalten. Keine ist eine Warnung. |
| **Background workers**, **Poll scheduler**, **Security event storage** | Die Seite von OneUptime selbst: Ein Prozess nimmt die Jobs der Worker-Warteschlange an, der Abfragejob läuft jede Minute, und der Speicher der Sicherheitsereignisse antwortet. |
| **Geplante Abfrage** | Für eine gespeicherte Verbindung: Das Abfragen ist eingeschaltet, kein Lauf wartet festgefahren auf einen Worker, und Abfragen laufen pünktlich. |

Jede Anfrage in einem Test hat eine Frist von 20 Sekunden. Ein Test importiert nie etwas und bewegt nie den Cursor, und jede fehlgeschlagene Prüfung sagt, was zu ändern ist.

## Adressen bei Cloudflare sperren

Ist das Sperren eingeschaltet, setzt Cloudflare die [Sperrliste](/docs/telemetry/security-cases#sperrliste) Ihres Projekts durch. Jede Adresse, die Sie sperren, kommt innerhalb einer Minute auf eine IP-Liste in Ihrem Cloudflare-Konto, und in jeder Zone sperrt eine benutzerdefinierte Regel pro Liste die Adressen, die sie enthält, oder stellt ihnen eine Challenge. In der **Sperrliste** nennt **Durchgesetzt bei** Cloudflare für jede Sperre, die OneUptime von Cloudflare zurückgelesen hat; eine Sperre, die nicht innerhalb von 10 Minuten zurückgelesen wird, ist dort nicht durchgesetzt.

Das Sperren braucht Schreibberechtigungen auf dem API-Token der Verbindung:

| Berechtigung | Was OneUptime damit tut |
| --- | --- |
| `Account > Account Filter Lists > Edit` | Legt seine zwei Listen an und fügt ihre Adressen hinzu oder entfernt sie. |
| `Zone > Zone WAF > Edit`, auf jeder Zone, in der gesperrt wird | Fügt seine benutzerdefinierten Regeln hinzu und liest die eigenen der Zone. |
| `Account > Account Firewall Access Rules > Edit` | Fügt IP Access Rules hinzu und entfernt sie, bei einem Tarif ohne freie Liste oder freie benutzerdefinierte Regel. |

:::steps
### Dem Token Schreibberechtigungen geben

Öffnen Sie in Cloudflare **My Profile → API Tokens**, bearbeiten Sie das Token der Verbindung und fügen Sie die Berechtigungen oben hinzu. Oder legen Sie ein Token an, das sie und die zwei Leseberechtigungen hat.

### Das Sperren einschalten

Wählen Sie in der Zeile der Verbindung **Adressen sperren**. Fügen Sie ein neues Token in **Neues API-Token** ein, oder lassen Sie das Feld leer, um das aktuelle zu behalten, und lassen Sie in **Zonen** **Alle Zonen** stehen, oder wählen Sie die Zonen, in denen gesperrt wird. **Berechtigungen prüfen** fragt Cloudflare, ob das Token jede Berechtigung hat, und ändert nichts. **Sperren einschalten** schaltet das Sperren nur ein, wenn jede Prüfung besteht, und OneUptime richtet Cloudflare innerhalb einer Minute ein.
:::

Solange das Sperren eingeschaltet ist, führt **Verbindung testen** dieselben Prüfungen aus: **How blocking is set up**, **Edit the lists**, **Edit custom rules in each zone** und, wo IP Access Rules genutzt werden, **Edit IP Access Rules**.

### Was OneUptime Cloudflare hinzufügt

| In Cloudflare | Was es ist |
| --- | --- |
| Die Listen `oneuptime_block` und `oneuptime_challenge` | Zwei IP-Listen im Konto, eine für Sperren und eine für Challenges. Ihre Beschreibung nennt Ihr OneUptime-Projekt. |
| Eine benutzerdefinierte Regel pro Liste, in jeder Zone | `(ip.src in $oneuptime_block)` mit der Aktion Block und `(ip.src in $oneuptime_challenge)` mit der Aktion Managed Challenge. Ihre Beschreibung sagt, dass OneUptime sie verwaltet. |
| Ein Listeneintrag pro Sperre | Sein Kommentar nennt den Fall und wann die Sperre endet, etwa `OneUptime case CASE-42 until 2026-11-21 10:42 UTC`. |

Jede Regel steht an erster Stelle der benutzerdefinierten Regeln der Zone und läuft damit vor Ihren: Eine Skip-Regel von Ihnen kann keine gesperrte Adresse an ihr vorbeilassen. Wenn Ihre Skip-Regeln Adressen durchlassen, etwa die Ihrer Monitore oder eines Partners, nennt **Sperrstatus** sie. **Diese Adressen schützen** fügt sie zu **Geschützte Entitäten** hinzu, die niemand sperren kann.

### Tarifgrenzen für das Sperren

| Tarif | Free | Pro | Business | Enterprise |
| --- | --- | --- | --- | --- |
| Listen im Konto | 1 | 10 | 10 | 1.000 |
| Listeneinträge im Konto | 10.000 | 10.000 | 10.000 | 500.000 |
| Benutzerdefinierte Regeln in einer Zone | 5 | 20 | 100 | 1.000 |

Ihre eigenen Listen und Regeln zählen mit. Wenn Sie das Sperren einschalten, nimmt jede Aktion eine Liste und eine Regel in jeder Zone, wo der Tarif sie frei hat, Block zuerst; wo nicht, nimmt sie IP Access Rules. Bei einem Free-Tarif, dessen eine Liste frei ist, nehmen Sperren die Liste und Challenges IP Access Rules. Ein Konto fasst 50.000 IP Access Rules, jede eine Adresse, ein IPv4-Bereich von /16 oder /24 oder ein IPv6-Bereich von /32, /48 oder /64: Eine Sperre eines anderen Bereichs wird dort nicht durchgesetzt, und die **Sperrliste** sagt, warum. **How blocking is set up** sagt, was jede Aktion nimmt, und warum.

### Wenn jemand eine Regel ändert

OneUptime liest seine Listen und Regeln alle 3 Minuten zurück und macht nie eine Änderung rückgängig, die jemand in Cloudflare vorgenommen hat. Eine dort ausgeschaltete, gelöschte oder geänderte Regel erscheint in der Zeile der Verbindung und in **Sperrstatus**, mit ihrer Zone, und die **Sperrliste** zeigt die Sperren der Regel dieser Zone bei Cloudflare als nicht durchgesetzt. **Wiederherstellen** richtet die Regel wieder ein. Solange **Zonen** auf **Alle Zonen** steht, wird eine Zone, die später zum Konto hinzukommt, von selbst eingerichtet.

### Das Sperren ausschalten

**Sperren ausschalten** fragt, ob die Listen und Regeln von OneUptime aus Cloudflare entfernt werden sollen, mit ausgewähltem **Listen und Regeln von OneUptime aus Cloudflare entfernen**. Das Entfernen nimmt die Regeln von OneUptime, seine zwei Listen und die IP Access Rules weg, die es hinzugefügt hat, gefunden an den Namen, Referenzen und Notizen, die es ihnen gab, und sonst nichts. Behalten bleiben sie in Cloudflare und sperren weiter, was sie enthalten. Eine Verbindung, die Adressen sperrt, kann nicht gelöscht werden: Schalten Sie das Sperren zuerst aus, und löschen Sie sie, sobald das Entfernen abgeschlossen ist.

## Fehlerbehebung

**Letzter Fehler** der Verbindung behält die vollständige Fehlermeldung, mit geschwärzten Anmeldedaten. Wenn eine Verbindung einen Fehler hat, wählen Sie **Fehler anzeigen** in ihrer Spalte **Aktionen**, um ihn zu lesen, und **Fehler kopieren** im Dialog, um ihn zu kopieren. Jede Meldung nennt die Anfrage, die fehlschlug, und zitiert den Grund von Cloudflare.

:::details Letzter Fehler lautet `Invalid API Token (1000)`
Cloudflare kennt das Token nicht: Es wurde gelöscht, erneuert oder nie vollständig eingefügt. Ein Global API Key wird abgelehnt, bevor er gesendet wird. Legen Sie wie oben ein Token an und speichern Sie es mit **Anmeldedaten aktualisieren**.
:::

:::details Letzter Fehler lautet `Unauthorized to access requested resource (9109)`
Das Token kann keine Zonen auflisten. Geben Sie ihm `Zone > Zone > Read`, mit den zu importierenden Zonen unter **Zone Resources**.
:::

:::details Letzter Fehler lautet `cannot read the analytics of`
Dem Token fehlt `Zone > Analytics > Read` auf den Zonen, die die Meldung nennt. Fügen Sie es dort hinzu und nutzen Sie dann **Diesen Zeitraum importieren**, um nachzuholen, was nicht importiert wurde.
:::

:::details Letzter Fehler lautet `rate limit`
Etwas anderes, das denselben Cloudflare-Benutzer verwendet, hat sein Kontingent aufgebraucht. Das Abfragen macht von selbst weiter, sobald die fünf Minuten vorbei sind; geben Sie OneUptime ein Token eines eigenen Benutzers, um das Kontingent zu trennen.
:::

:::details Letzter Fehler lautet `did not complete`
Die Anfrage bekam keine Antwort: ein Zeitlimit, ein Name, der sich nicht auflösen lässt, oder eine abgelehnte Adresse. Prüfen Sie, ob die OneUptime-App und die Worker `api.cloudflare.com` erreichen, auch über einen Proxy, den Sie verwenden.
:::

:::details Ein Fall zeigt die Aktionen von Cloudflare, aber keine Anfrage der Adresse in Ihrer App
Hinter Cloudflare kommen die Anfragen Ihrer App von den Adressen von Cloudflare, und die Adresse des Besuchers ist die letzte, die Cloudflare an `X-Forwarded-For` anhängt. Zeichnen Sie diesen Header (`http.request.header.x-forwarded-for`) und die eigene Adresse der Verbindung (`network.peer.address`) in Ihren Traces auf. Solange diese Verbindung besteht, vertraut OneUptime den Adressen von Cloudflare als Proxy, liest also den Besucher aus dem Header und ordnet die Anfragen Ihrer App der Adresse zu, auf die Cloudflare reagiert hat. Einer `client.address`, die Ihre App aus `CF-Connecting-IP` kopiert, wird nicht vertraut: Jeder, der Ihre App direkt erreicht, kann diesen Header senden.
:::

:::details Sperrstatus lautet `already exists in this Cloudflare account`
Ein anderes OneUptime-Projekt oder eine Person hat eine Liste namens `oneuptime_block` oder `oneuptime_challenge` angelegt, und OneUptime ändert nie eine Liste, die es nicht für dieses Projekt angelegt hat. Benennen Sie diese Liste in Cloudflare um oder löschen Sie sie, oder schalten Sie das Sperren in dem Projekt aus, das sie angelegt hat. OneUptime richtet das Sperren innerhalb von 5 Minuten erneut ein.
:::

:::details Der Test besteht, aber die letzte Abfrage ist Nie
Der Abfragejob ist nie gelaufen. Lesen Sie die Prüfungen **Background workers** und **Poll scheduler**. Bei einer selbst gehosteten Installation ist die übliche Ursache `DISABLE_QUEUE_WORKERS=true` an der App, ohne ein eigenes Worker-Deployment, das die Jobs annimmt: Setzen Sie es auf `false`, oder führen Sie das Worker-Deployment aus (Helm: `worker.enabled: true`, standardmäßig `false`).
:::

## Nächste Schritte

:::cards
- [Sicherheitsereignisse](/docs/telemetry/security-events): Durchsuchen, verknüpfen und alarmieren Sie zu dem, was Sie importieren.
- [Sicherheitsfälle](/docs/telemetry/security-cases): Sehen Sie, was Cloudflare getan hat, neben dem, was Ihre App erreicht hat.
- [Integrationen – Überblick](/docs/integrations/index): Die anderen Tools, die Sie verbinden können.
:::
