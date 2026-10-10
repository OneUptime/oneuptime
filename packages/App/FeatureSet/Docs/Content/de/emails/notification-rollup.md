# Benachrichtigungs-Zusammenfassung

Wenn etwas richtig schiefgeht, geht es selten nur einmal schief. Eine instabile Upstream-Verbindung reißt vierzig Monitore mit, vierzig Vorfälle werden ausgerufen, bestätigt und behoben, und jeder Besitzer bekommt für jeden Schritt eine E-Mail: zweihundert Nachrichten in einem Postfach, und niemand liest sie mehr.

OneUptime fasst solche Schübe automatisch zu einer E-Mail zusammen. Das ist für alle eingeschaltet und muss nicht konfiguriert werden — wenn Sie aber jede Benachrichtigung lieber als eigene E-Mail bekommen, können Sie [die Zusammenfassung für sich selbst ausschalten](#die-zusammenfassung-für-sich-selbst-ausschalten), Projekt für Projekt.

:::cards
- [So funktioniert es](#so-funktioniert-es): Vier E-Mails gehen sofort raus, der Rest kommt gesammelt.
- [Was nie zusammengefasst wird](#was-nie-zusammengefasst-wird): Alarmierung, Sicherheits-, Abrechnungs- und Abonnenten-E-Mails.
- [Zusammenfassung ausschalten](#die-zusammenfassung-für-sich-selbst-ausschalten): Jede Benachrichtigung wieder als eigene E-Mail erhalten.
- [Weniger Routine-E-Mails](#noch-weniger-e-mails): Die informativen E-Mails in einem Schritt abschalten.
:::

## So funktioniert es

Jede Besitzer-Benachrichtigung per E-Mail, die Sie erhalten, wird gegen ein kleines Budget gezählt — getrennt nach Projekt, Empfänger, E-Mail-Adresse und **Kategorie** der Ressource: Vorfälle, Warnungen, Monitore, geplante Wartungen, Statusseiten, Sonden, SLOs und so weiter.

```mermaid title="So wird eine Besitzer-Benachrichtigung per E-Mail zugestellt"
flowchart TB
    N["Besitzer-Benachrichtigung per E-Mail"] --> O{"Zusammenfassung<br/>für Sie an?"}
    O -->|"Nein"| S["Sofort gesendet"]
    O -->|"Ja"| C{"Fünfte oder spätere in dieser<br/>Kategorie in 30 Minuten?"}
    C -->|"Nein"| S
    C -->|"Ja"| H["Zurückgehalten"]
    H -->|"Etwa 5 Minuten später"| R["Eine Zusammenfassungs-E-Mail<br/>für das Projekt"]
```

- Die **ersten vier** E-Mails einer Kategorie innerhalb eines beliebigen Dreißig-Minuten-Fensters werden sofort gesendet, genau wie bisher. Gleicher Betreff, gleiche Vorlage, gleiche Links.
- Die **fünfte und jede weitere** E-Mail in diesem Fenster wird zurückgehalten.
- Etwa fünf Minuten später kommt alles, was in diesem Projekt für Sie zurückgehalten wurde — über alle Kategorien hinweg — als **eine** E-Mail, die auflistet, was passiert ist, mit einem Link zu jeder Ressource.

Die Zusammenfassung enthält die Benachrichtigungen, die Sie beim Versand noch abonniert haben. Schalten Sie die E-Mail eines Ereignisses ab, während seine Benachrichtigungen in der Warteschlange stehen, fallen diese Benachrichtigungen aus der Zusammenfassung heraus. Schalten Sie die E-Mail später wieder ein, werden die übersprungenen Updates nicht nachgeliefert.

Unterhalb der Schwelle tut die Funktion gar nichts. Ein Projekt, das drei Besitzer-E-Mails am Tag erzeugt, verschickt diese drei E-Mails weiterhin einzeln.

## So sieht die Zusammenfassungs-E-Mail aus

Die Betreffzeile verrät Ihnen das Ausmaß _und die Art_ des Sturms, bevor Sie die E-Mail öffnen:

```text
[Acme Production] 112 notifications: 63 Monitors, 41 Incidents, 6 Alerts +2 more
```

Darin nennt eine Übersichtskarte die Gesamtzahl, das Zeitfenster der Zusammenfassung und die Aufteilung nach Kategorie. Darunter sind die Benachrichtigungen in einen Abschnitt pro Kategorie gruppiert, das Dringendste zuerst — Vorfälle, dann Warnungen, dann die Monitore und Sonden, die sie bemerkt haben —, sodass das Erste unter der Übersicht auch das Erste ist, das einen Klick wert ist.

Jeder Abschnitt enthält eine Zeile pro Ressource statt einer Zeile pro Ereignis:

- **Zeilen zeigen, wo eine Ressource gelandet ist.** Wurde ein Vorfall erstellt, dann bestätigt, dann behoben, ist das eine einzige Zeile in seinem neuesten Zustand — damit ist die Zusammenfassung _aktueller_, als es drei einzelne E-Mails gewesen wären.
- **Die Zahlen gehen auf.** Jede Zeile trägt die Zeit ihres letzten Updates, und eine Zeile, die mehrere aufgenommen hat, sagt, wie viele, sodass die Abschnitte und die Übersichtskarte immer dieselbe Summe ergeben.
- **Schweregrad und Zustand werden angezeigt.** Karten von Warnungen und Vorfällen zeigen Schweregrad und Zustand aus ihrer letzten Benachrichtigung, auch eigene Namen. Ältere Benachrichtigungen in der Warteschlange ohne diese Angaben erscheinen trotzdem, nur ohne die fehlenden Bezeichnungen.

Zeiten werden in UTC angezeigt, zusätzlich mit Datum, sobald eine Zusammenfassung mehr als einen Tag umfasst.

![Eine Zusammenfassungs-E-Mail mit fünfzehn Benachrichtigungen](/docs/static/images/NotificationRollupEmail.png)

## Was nie zusammengefasst wird

Die Zusammenfassung betrifft immer nur Besitzer- und Mitglieder-Benachrichtigungen — die Familie „etwas, für das Sie verantwortlich sind, hat sich geändert“. Etwas anderes kann sie gar nicht erreichen, denn sie sitzt in dem einen Codepfad, den diese Benachrichtigungen nehmen, und kein anderer.

Nie verzögert und nie mitgezählt:

| Kategorie | Beispiele |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Bereitschaftsalarmierung | Jede Alarmierung einer Eskalationsrichtlinie und jede Bitte um Bestätigung |
| Bereitschaftszeiten | „Sie haben jetzt Bereitschaft“, „Sie haben als Nächstes Bereitschaft“, „Ihre Schicht beginnt bald“, „Ihre Schicht wurde neu zugewiesen“ |
| Kontosicherheit | Passwort zurücksetzen, E-Mail-Bestätigung, Passwort geändert, Zwei-Faktor-Backup-Code verwendet oder neu erzeugt |
| Verwaltungshinweise zu Ihrem Konto | Ein Administrator hat Ihre Benachrichtigungsmethoden oder Ihre Bereitschaftsregeln geändert |
| Abrechnung und Guthaben | Rechnungen, überfälliges Abonnement, „wir konnten niemanden alarmieren, weil die Karte abgelehnt wurde“ |
| Zustand der Instanz | Warnungen zu Postgres, Valkey und ClickHouse an Instanz-Administratoren |
| Abonnenten von Statusseiten | Jede E-Mail, die Ihre Statusseite an Ihre eigenen Abonnenten sendet |
| SLA-Verletzungen | Werden sofort gesendet, obwohl sie den Benachrichtigungstyp für erstellte Vorfälle wiederverwenden |

Betroffen sind nur E-Mails. SMS, Anrufe, Push-Benachrichtigungen, WhatsApp, Telegram, Slack, Microsoft Teams und Webhooks werden sofort zugestellt, genau wie vorher — auch für die Benachrichtigungen, deren E-Mail zurückgehalten wurde.

## Grenzen

| Grenze | Wert |
| --- | --- |
| Benachrichtigungen in einer Zusammenfassungs-E-Mail | Höchstens **500**. Alles darüber bleibt in der Warteschlange und geht mit der nächsten Zusammenfassung raus, höchstens fünf Minuten später. |
| Gezeichnete Zeilen in einer Zusammenfassungs-E-Mail | Höchstens **100**. Zeilen werden pro Ressource zusammengelegt, das sind also 100 verschiedene Ressourcen; darüber hinaus nennt die E-Mail die vollständigen Summen und verlinkt auf das Projekt. |
| Zusammenfassungs-E-Mails an einen Empfänger aus einem Projekt | Höchstens **12** pro Stunde. |
| Zusätzliche Verzögerung einer zurückgehaltenen Benachrichtigung | Im ungünstigsten Fall etwa sechs Minuten. |

Die stündliche Obergrenze setzt die Datenbank durch, nicht ein Timer, daher hält sie auch bei einem Sturm, der stundenlang dauert.

## Die Zusammenfassung für sich selbst ausschalten

Manche möchten die Bündelung. Andere legen jede Benachrichtigung ab, sobald sie eintrifft, oder lassen das Postfach von etwas verarbeiten, das genau das tut — und dafür ist eine Zusammenfassungs-E-Mail hinderlich. Deshalb lässt sich die Zusammenfassung ausschalten, pro Person und pro Projekt.

:::steps
### E-Mail-Einstellungen öffnen

Gehen Sie im Projekt zu **Benutzereinstellungen → E-Mail-Einstellungen** — dieselbe Seite, auf die jede Zusammenfassungs-E-Mail unten verlinkt.

### E-Mail-Zusammenfassung ausschalten

Schalten Sie in der Karte **E-Mail-Zusammenfassung** den Schalter aus. Die Änderung wird von selbst gespeichert, und die Karte zeigt dann „Aus: Jede Benachrichtigung kommt sofort als eigene E-Mail an.“
:::

Ist sie ausgeschaltet, wird Ihnen jede Besitzer- und Mitglieder-Benachrichtigung per E-Mail in diesem Projekt wieder einzeln und sofort gesendet: gleicher Betreff, gleiche Vorlage, gleiche Links, keine Schwelle und keine fünf Minuten Wartezeit. Was beim Ausschalten bereits für Sie in der Warteschlange steht, kommt noch einmal als letzte Zusammenfassung ein paar Minuten später; alles danach kommt einzeln.

Der Schalter gilt **nur für Sie und nur für ein Projekt**. Ihn auszuschalten ändert nichts daran, was Ihre Kolleginnen und Kollegen erhalten, und er gilt nicht projektübergreifend — so kann das laute Produktionsprojekt weiter bündeln, während das ruhige interne Projekt alles einzeln durchlässt, oder umgekehrt. Er ist für alle eingeschaltet, bis sie ihn ausschalten.

Was er **nicht** berührt:

- **Welche Benachrichtigungen Sie erhalten.** Das ist die Einstellung pro Ereignistyp und Kanal unter **Benutzereinstellungen → Benachrichtigungseinstellungen**, eine Seite weiter. Die Zusammenfassung und dieser Schalter ändern immer nur, in wie viele E-Mails diese Benachrichtigungen gepackt werden.
- **Bereitschaftsalarmierung und Schicht-E-Mails**, **E-Mails zur Kontosicherheit**, **Abrechnungs-E-Mails**, Warnungen zum Zustand der Instanz und E-Mails an Statusseiten-Abonnenten. Nichts davon wird überhaupt je zusammengefasst, das Ausschalten ändert daran also nichts — siehe [Was nie zusammengefasst wird](#was-nie-zusammengefasst-wird).
- **Alle anderen Kanäle.** SMS, Anrufe, Push, WhatsApp, Telegram, Slack, Microsoft Teams und Webhooks sind ohnehin sofort.

## Noch weniger E-Mails

Die Zusammenfassung bündelt Routine-Updates; Sie können die meisten davon auch ganz abbestellen.

:::steps
### Die Einstellungen aus einer Zusammenfassungs-E-Mail öffnen

Öffnen Sie den Link zu den Einstellungen unten in einer Zusammenfassungs-E-Mail, oder gehen Sie zu **Benutzereinstellungen → E-Mail-Einstellungen**.

### Routine-E-Mails reduzieren wählen

Wählen Sie in der Karte **Weniger Routine-E-Mails** die Schaltfläche **Routine-E-Mails reduzieren**. Sobald die Änderung gespeichert ist, zeigt die Karte **Routine-E-Mails deaktiviert.**
:::

Damit werden für Sie im aktuellen Projekt diese informativen E-Mails abgeschaltet:

- Notizen zu Vorfällen, Warnungen, Episoden und geplanten Wartungen.
- Hinweise, dass Sie als Besitzer einer Ressource hinzugefügt wurden.
- Neue Monitore und Statusseiten.
- Vorfälle oder Warnungen, die bestehenden Episoden hinzugefügt wurden.
- Hinzufügen zu oder Entfernen aus einer Bereitschaftsrichtlinie.

Ihre bisherigen Einstellungen für das Erstellen von Vorfällen und Warnungen, Zustandswechsel, Erinnerungen, Vorfallzuweisungen, Monitorzustand und Bereitschaftsschichten bleiben erhalten, und keine E-Mail, die Sie abgeschaltet hatten, wird eingeschaltet. Alarmierung, andere Zustellkanäle, Konto-E-Mails, Abrechnungs-E-Mails und E-Mails an Statusseiten-Abonnenten sind nicht betroffen.

Die Änderungen werden zusammen gespeichert. Prüfen Sie die Schalter pro Ereignis unter **Benutzereinstellungen → Benachrichtigungseinstellungen**, um einzelne E-Mails wieder einzuschalten. Diese Einstellungen gelten auch für Benachrichtigungen, die auf eine Zusammenfassung warten; eine bereits gesendete E-Mail lässt sich nicht zurückholen. Die E-Mail-Zusammenfassung bleibt eine eigene Einstellung, die die Bündelung der Ereignisse steuert, die Sie behalten.

## Fehlerbehebung

:::details Eine Benachrichtigung kam ein paar Minuten zu spät an
Sie war die fünfte oder eine spätere E-Mail ihrer Kategorie innerhalb von dreißig Minuten, wurde daher zurückgehalten und etwa fünf Minuten später in einer Zusammenfassung gesendet. Suchen Sie nach einer Zusammenfassungs-E-Mail aus demselben Projekt: Die Benachrichtigung ist dort eine Zeile. Alarmierung und die anderen Kanäle wurden nicht verzögert.
:::

:::details Ich habe die Zusammenfassung ausgeschaltet und trotzdem eine bekommen
Benachrichtigungen, die beim Ausschalten bereits für Sie in der Warteschlange standen, kommen als eine letzte Zusammenfassung ein paar Minuten später. Alles danach kommt als einzelne E-Mail.
:::

:::details Ein erwartetes Update fehlt in einer Zusammenfassungs-E-Mail
Jede Zeile zeigt eine Ressource in ihrem neuesten Zustand, ein Vorfall, der erstellt, bestätigt und behoben wurde, ist also eine Zeile mit der Anzahl der Updates, die sie aufgenommen hat. Eine Benachrichtigung fällt außerdem weg, wenn Sie die E-Mail dieses Ereignisses unter **Benutzereinstellungen → Benachrichtigungseinstellungen** abgeschaltet haben, während sie in der Warteschlange stand.
:::

## Nächste Schritte

:::cards
- [SMTP-Konfiguration](/docs/emails/smtp): OneUptimes E-Mails über Ihren eigenen Mailserver versenden.
- [Eskalationsregeln](/docs/on-call/escalation-rules): Wie die Bereitschaftsalarmierung Menschen erreicht — nie zusammengefasst.
:::
