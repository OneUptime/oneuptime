# Wechsel von Pingdom

**Aus einem anderen Tool importieren** holt Ihre Uptime-Prüfungen aus Pingdom in wenigen Minuten in OneUptime. Mit einem schreibgeschützten Pingdom-API-Token liest OneUptime Ihre Prüfungen ein, zeigt Ihnen, was es gefunden hat, und erstellt, was Sie auswählen. In Pingdom ändert sich nichts.

:::cards
- [Konto importieren](#ihr-pingdom-konto-importieren): Token erstellen, Konto einlesen und auswählen, was übernommen wird.
- [Was übernommen wird](#was-übernommen-wird): Wie aus jeder Pingdom-Prüfung ein OneUptime-Monitor wird.
- [Den Wechsel abschließen](#den-wechsel-abschließen): Was nach dem Import zu tun ist.
:::

## So funktioniert es

```mermaid title="Vom Pingdom-API-Token zum Bericht"
flowchart TB
    key["Schreibgeschütztes<br/>API-Token"] --> read["OneUptime liest<br/>Ihr Pingdom-Konto ein"]
    read --> preview["Sie sehen, was gefunden wurde,<br/>und wählen aus, was übernommen wird"]
    preview --> import["Der Import läuft<br/>im Hintergrund"]
    import --> report["Ein Bericht verlinkt<br/>jeden erstellten Datensatz"]
```

- **Der Schlüssel wird einmal verwendet.** Er wird verschlüsselt aufbewahrt, solange OneUptime Ihr Konto einliest, und gelöscht, sobald das Einlesen endet, ob es funktioniert hat oder nicht. Er wird nie wieder angezeigt und nie in ein Protokoll geschrieben.
- **OneUptime liest nur.** Es ruft ausschließlich die API von Pingdom auf: `api.pingdom.com`. Pingdom rechnet jede Anfrage auf das Kontingent des Tokens an, daher liest OneUptime die Einstellungen einer Prüfung nur, wenn sie welche hat, eine Anfrage nach der anderen. Wenn Pingdom um eine Pause bittet, wartet es und versucht es erneut.
- **Nichts wird erstellt, bevor Sie den Import starten.** Die Vorschau zeigt für jedes Element, ob es neu ist, bereits in OneUptime ist (und unverändert verwendet wird), von einem früheren Import übernommen wurde oder warum es nicht übernommen werden kann.
- **Ein erneuter Import erstellt nie etwas doppelt.** OneUptime merkt sich anhand der Pingdom-ID, was jeder Import übernommen hat. Führen Sie den Import erneut aus, nachdem Sie in Pingdom Prüfungen hinzugefügt haben, und nur die neuen werden erstellt.

## Bevor Sie beginnen

- **Ein OneUptime-Projekt und das Recht, das Übernommene zu erstellen.** Projektinhaber und Projektadmins können alles übernehmen. Andere Rollen können ebenfalls importieren und übernehmen die Arten von Datensätzen, die sie erstellen dürfen. Alles andere wird mit Begründung als nicht übernommen angezeigt.
- **Ein Pingdom-API-Token mit Read access.** Der Import schreibt nie in Pingdom.
- **Eine Zahlungsmethode, in OneUptime Cloud.** Monitore, die Prüfungen ausführen, werden nach Nutzung abgerechnet, auch im Free-Tarif. Fügen Sie daher vor dem Import unter **Projekteinstellungen** > **Abrechnung** eine hinzu. Ohne sie werden diese Monitore als nicht übernommen angezeigt.

## Ihr Pingdom-Konto importieren

:::steps
### Ein API-Token in Pingdom erstellen
Öffnen Sie in My Pingdom **Settings** > **Pingdom API** und wählen Sie **Add API token**. Nennen Sie es `OneUptime import`, wählen Sie **Read access** und kopieren Sie das Token.

### Die Importseite öffnen
Öffnen Sie in OneUptime **Projekteinstellungen** > **Aus einem anderen Tool importieren** und wählen Sie **Pingdom**.

### Pingdom verbinden
Fügen Sie das Token in **Pingdom-API-Schlüssel** ein und wählen Sie **Mein Pingdom-Konto einlesen**. Ein großes Konto dauert einige Minuten, und Sie können die Seite währenddessen verlassen.

### Auswählen, was übernommen wird
Die Vorschau listet auf, was gefunden wurde, mit einem Abschnitt pro Art. Alles, was erstellt würde, ist anfangs ausgewählt, außer Prüfungen, die in Pingdom pausiert sind. Sie werden pausiert übernommen, wenn Sie sie auswählen. Unter jedem Element sagt OneUptime, was nicht genau so übernommen wird, wie es war.

### Den Import starten
Wählen Sie **Import starten**. Der Import läuft im Hintergrund: Sie können die Seite verlassen, und der Bericht wartet dort auf Sie.
:::

Der Bericht zählt, was erstellt und nicht übernommen wurde, und listet jedes Element mit einem Link zu dem Datensatz auf, der daraus wurde, Fehler zuerst. Frühere Importe stehen auf derselben Seite unter **Frühere Importe**.

## Was übernommen wird

| In Pingdom | In OneUptime | Wie |
| --- | --- | --- |
| Uptime checks | Monitore | Jede Prüfung wird zu einem Monitor derselben Art, mit derselben Adresse, demselben Intervall und dem Text, den eine Seite enthalten soll oder nicht enthalten darf. |

- **HTTP-Prüfungen** werden zu Website-Monitoren, oder zu API-Monitoren, wenn sie Daten senden oder Header mitschicken.
- **Ping- und TCP-Prüfungen** werden zu Ping- und Port-Monitoren. **SMTP-, POP3- und IMAP-Prüfungen** werden zu Port-Monitoren auf ihrem Port: OneUptime prüft, ob der Port antwortet, nicht die Mail-Kommunikation.
- **DNS-Prüfungen** werden zu DNS-Monitoren, die denselben Nameserver fragen.
- **Zertifikatsprüfungen.** Eine HTTP-Prüfung, die ein ablaufendes Zertifikat als Ausfall wertet, erhält zusätzlich einen SSL-Zertifikat-Monitor, nach ihr benannt, der genauso viele Tage vorher warnt.

Jeder Monitor wird von den Sonden Ihres Projekts geprüft, so wie einer, den Sie selbst erstellen. Ein Intervall, das OneUptime nicht anbietet, wird zum nächstgelegenen, das es anbietet, und ein Timeout über einer Minute zu einer Minute. Die Vorschau sagt, wenn sich eines davon ändert.

## Was nicht übernommen wird

- **Verfügbarkeitsverlauf, Antwortzeiten und Vorfälle.** OneUptime beginnt mit den Prüfungen, wenn der Import fertig ist.
- **Alarmkontakte und Integrationen.** Legen Sie in OneUptime fest, wer benachrichtigt wird, wie unter [Den Wechsel abschließen](#den-wechsel-abschließen) beschrieben.
- **Passwörter und Header, die ein Geheimnis enthalten können.** Ein Monitor, der sich anmeldet oder einen `Authorization`-, Cookie- oder Token-Header sendet, wird ohne ihn übernommen: Fügen Sie ihn mit einem [Monitor-Geheimnis](/docs/monitor/monitor-secrets) hinzu.
- **UDP-, Custom-HTTP- und Transaktionsprüfungen.** OneUptime hat keinen Monitor, der dasselbe tut, und die Vorschau nennt jede. Ein [synthetischer Monitor](/docs/monitor/synthetic-monitor) kann eine Seite so durchlaufen wie eine Transaktionsprüfung.
- **Die Adresse, die eine DNS-Prüfung erwartet.** Fügen Sie sie in OneUptime als Kriterium hinzu.
- **Wartungsfenster.** Die Vorschau zählt sie: Planen Sie sie in OneUptime als geplante Wartung.

## Grenzen

Ein Import erstellt höchstens 2.000 Datensätze und höchstens 1.000 Monitore. Alles über einer Grenze wird als nicht übernommen angezeigt. Führen Sie den Import erneut aus, um den Rest zu übernehmen.

In OneUptime Cloud brauchen Monitore, die Prüfungen ausführen, eine Zahlungsmethode, und alles, wofür Ihr Tarif keinen Platz hat, wird als nicht übernommen angezeigt, mit dem, was es braucht.

Eine Vorschau wird einen Tag lang aufbewahrt. Nur die Person, die das Konto eingelesen hat, kann auswählen und den Import starten. Projektinhaber und Projektadmins sehen den Fortschritt und den Bericht jedes Imports.

## Den Wechsel abschließen

:::steps
### Ihre Monitore prüfen
Öffnen Sie jeden unter **Monitore** und prüfen Sie seine ersten Ergebnisse. Ein Heartbeat-Monitor hat eine neue Adresse: Richten Sie den Job, der ihn anpingt, darauf aus.

### Festlegen, wer benachrichtigt wird
Fügen Sie Ihren Monitoren Eigentümer hinzu oder den Vorfällen, die sie eröffnen, eine Bereitschaftsrichtlinie unter **Bereitschaftsdienst** > **Bereitschaftsrichtlinien**, damit die richtigen Personen erfahren, wenn etwas ausfällt.

### Die Prüfungen in Pingdom ausschalten
Sobald OneUptime dasselbe prüft, pausieren Sie die Prüfungen in Pingdom, damit niemand doppelt benachrichtigt wird.
:::

## Fehlerbehebung

:::details Pingdom hat den API-Schlüssel nicht akzeptiert
Prüfen Sie, ob Sie das ganze Token kopiert haben und ob es ein API-3.1-Token aus **Pingdom API** mit **Read access** ist. Wählen Sie dann **Erneut versuchen**.
:::

:::details Ein Monitor wird als nicht übernommen angezeigt
Bei ihm steht, warum: eine Art von Monitor, die OneUptime nicht hat, eine Adresse, die OneUptime nicht lesen kann, oder ein Projekt ohne Platz oder ohne Zahlungsmethode dafür. Ein Monitor, den OneUptime schon mit demselben Namen, Typ und derselben Adresse ausführt, wird unverändert verwendet.
:::

:::details Einige Elemente können nicht ausgewählt werden
Bei jedem steht, warum: ein Name, den das Projekt schon hat, etwas, das ein früherer Import übernommen hat, oder ein Datensatz, den Sie nicht erstellen dürfen oder den Ihr Tarif nicht enthält.
:::

## Nächste Schritte

:::cards
- [Website-Überwachung](/docs/monitor/website-monitor): Was ein Website-Monitor prüft und wie.
- [Port-Überwachung](/docs/monitor/port-monitor): Was ein Port-Monitor prüft und wie.
- [Wechsel von StatusCake](/docs/moving-to-oneuptime/statuscake): Ihre Prüfungen aus StatusCake übernehmen.
:::
