# Benachrichtigungseinstellungen

Benachrichtigungseinstellungen entscheiden, welche Neuigkeiten Sie erreichen, zu den Datensätzen, die Ihnen gehören, etwa einem Vorfall, einer Überwachung oder einer Statusseite, und zu Ihren eigenen Bereitschaftsschichten, und über welche Kanäle. Sie alarmieren Sie nie: Alarmieren ist die Aufgabe Ihrer Bereitschaftsregeln. Sie legen sie unter **Benutzereinstellungen → Benachrichtigungseinstellungen** fest, mit einem Schalter pro Ereignis und Kanal.

:::cards
- [So funktionieren die Einstellungen](#so-funktionieren-die-einstellungen): Ein Schalter pro Ereignis und Kanal, gesendet an jede verifizierte Methode.
- [Eine Einstellung ändern](#eine-einstellung-ändern): Drei Klicks, sofort gespeichert.
- [Was für ein neues Mitglied eingeschaltet ist](#was-für-ein-neues-mitglied-eingeschaltet-ist): Die Voreinstellungen, Tab für Tab.
- [Weniger E-Mails](#weniger-e-mails): Schübe zusammenfassen oder die Routine-E-Mails weglassen.
:::

## So funktionieren die Einstellungen

```mermaid title="Eine Neuigkeit zu einem Datensatz, der Ihnen gehört, und wohin sie geht"
flowchart TB
    event["Eine Neuigkeit, etwa eine<br/>Notiz zu Ihrem Vorfall"] --> setting["Ihre Einstellung<br/>für dieses Ereignis"]
    setting -->|"E-Mail an"| emails["Jede verifizierte<br/>E-Mail-Adresse"]
    setting -->|"alles aus"| nothing["Nichts wird gesendet"]
```

- Jede Zeile ist ein Ereignis und jede Spalte ein Kanal: E-Mail, SMS, Anruf, Push, WhatsApp, Telegram, Slack und Microsoft Teams sowie Webhook. Slack und Microsoft Teams sind nur dann Spalten, wenn das Projekt sie verbunden hat.
- Ein eingeschalteter Kanal sendet an jede verifizierte Methode, die Sie darauf in diesem Projekt haben, nicht nur an eine.
- Ein eingeschalteter Kanal ohne verifizierte Methode dahinter sendet nichts. **Ihre Einrichtungs-Checkliste** sagt das unter **Auf dem Laufenden bleiben**.
- Eine Neuigkeit geht an die Eigentümer des Datensatzes: die als Eigentümer genannten Personen und die Mitglieder seiner Eigentümer-Teams. Hat ein Datensatz keine Eigentümer, geht sie stattdessen an die Eigentümer des Projekts. Ein Ereignis darüber, als Eigentümer hinzugefügt worden zu sein, geht nur an die hinzugefügte Person.
- Sicherheitsfälle haben keine Eigentümer. Ein neuer Fall geht an alle, die die Fälle des Projekts sehen können, ab der Priorität, die jede Person für sich wählt, und ein zugewiesener Fall an die Personen, denen er zugewiesen ist. Siehe [Sicherheitsfälle](/docs/telemetry/security-cases#benachrichtigungen).
- Jede E-Mail an Eigentümer endet mit einem Link "Manage notification preferences", der hierher zurückführt.

## Eine Einstellung ändern

:::steps
### Ihre Einstellungen öffnen

Gehen Sie zu **Benutzereinstellungen → Benachrichtigungseinstellungen**. Die Tabs sind **Vorfälle**, **Warnungen**, **Überwachung**, **Statusseiten**, **Geplante Wartung**, **Bereitschaft** und **Sicherheit**.

### Das Ereignis finden

Jeder Tab enthält eine oder mehrere Karten, etwa **Vorfallsepisoden** auf dem Tab **Vorfälle**. Jede Zeile ist ein Ereignis, mit einer Zeile, die sagt, wann es gesendet wird.

### Einen Kanal anklicken

Klicken Sie auf den Kreis eines Kanals, um ihn einzuschalten, und erneut, um ihn auszuschalten. Ein Häkchen bedeutet eingeschaltet. Änderungen werden automatisch gespeichert.
:::

## Was für ein neues Mitglied eingeschaltet ist

Wenn Sie einem Projekt beitreten, sind diese Ereignisse per E-Mail eingeschaltet. Alles andere beginnt ausgeschaltet und sendet nichts, bis Sie einen Kanal einschalten.

| Tab | Per E-Mail eingeschaltet | Aus, bis Sie sie einschalten |
| --- | --- | --- |
| **Vorfälle** | **Vorfall erstellt**, **Vorfallsstatus geändert**, **Vorfallserinnerung**, **SLA eines Vorfalls verletzt**, **Vorfallsepisode erstellt**, **Status der Vorfallsepisode geändert**, **Vorfall zur Vorfallsepisode hinzugefügt** | **Vorfallsnotiz veröffentlicht**, **Als Eigentümer des Vorfalls hinzugefügt**, **Einem Vorfall zugewiesen**, **Notiz zur Vorfallsepisode veröffentlicht**, **Als Eigentümer der Vorfall-Episode hinzugefügt** |
| **Warnungen** | **Warnung erstellt**, **Warnungsstatus geändert**, **Warnungserinnerung**, **Warnungs-Episode erstellt**, **Status der Warnungs-Episode geändert**, **Warnung zur Warnungs-Episode hinzugefügt** | **Warnungsnotiz veröffentlicht**, **Als Eigentümer der Warnung hinzugefügt**, **Notiz zur Warnungs-Episode veröffentlicht**, **Als Eigentümer der Warnungs-Episode hinzugefügt** |
| **Überwachung** | **Sondenstatus für Ihre Überwachung geändert**, **Überwachung hat keine aktiven Sonden**, **SLO-Status geändert**, **Als SLO-Eigentümer hinzugefügt**, **Sondenstatus geändert**, **Als Eigentümer der Sonde hinzugefügt** | **Überwachung erstellt**, **Überwachungsstatus geändert**, **Als Eigentümer der Überwachung hinzugefügt**, **Status des KI-Agenten geändert**, **Als Eigentümer des KI-Agenten hinzugefügt** |
| **Statusseiten** | Keine | **Statusseite erstellt**, **Statusseiten-Ankündigung veröffentlicht**, **Als Eigentümer der Statusseite hinzugefügt** |
| **Geplante Wartung** | **Wartungserinnerung** | **Wartungsereignis erstellt**, **Wartungsstatus geändert**, **Wartungsnotiz veröffentlicht**, **Als Eigentümer der Wartung hinzugefügt** |
| **Bereitschaft** | **Ihr Bereitschaftsdienst beginnt**, **Sie sind als Nächstes im Bereitschaftsdienst**, **Ihr Bereitschaftsdienst endet**, **Zur Bereitschaftsdienst-Richtlinie hinzugefügt**, **Aus Bereitschaftsrichtlinie entfernt**, **Verpasster Anruf**, und zusätzlich per Push: **Bevor meine Bereitschaftsschicht beginnt**, **Meine bevorstehende Bereitschaftsschicht wird neu zugewiesen** | Keine |
| **Sicherheit** | Zusätzlich per Push: **Neuer Sicherheitsfall** (Fälle mit Priorität Hoch und Kritisch), **Mir zugewiesener Sicherheitsfall**, **Playbook-Schritt wartet auf meine Genehmigung**, **Reaktionsziel eines Sicherheitsfalls**, **Mir zugewiesene Aufgabe eines Sicherheitsfalls** | Keine |

> [!IMPORTANT]
> **Überwachungsstatus geändert** beginnt ausgeschaltet. Um zu erfahren, wenn eine Überwachung, die Ihnen gehört, ausfällt oder wieder läuft, schalten Sie es auf dem Tab **Überwachung** ein.

## Ihre Schichten

Der Tab **Bereitschaft** handelt von Ihnen, nicht von Datensätzen, die Ihnen gehören:

- **Ihr Bereitschaftsdienst beginnt**, **Sie sind als Nächstes im Bereitschaftsdienst** und **Ihr Bereitschaftsdienst endet** folgen Ihren Diensten in den Bereitschaftsplänen, in denen Sie sind.
- **Zur Bereitschaftsdienst-Richtlinie hinzugefügt** und **Aus Bereitschaftsrichtlinie entfernt** sagen Ihnen, wann eine Bereitschaftsrichtlinie beginnt oder aufhört, Sie zu nennen.
- **Bevor meine Bereitschaftsschicht beginnt** sendet Erinnerungen zu den Zeiten, die Sie unter **Benutzereinstellungen → Kalender → Kalender-Feed** wählen, und **Meine bevorstehende Bereitschaftsschicht wird neu zugewiesen** sagt Ihnen, wann jemand anderes eine Schicht übernimmt, an die Sie erinnert wurden. Siehe [Kalender-Feeds](/docs/on-call/calendar-feeds#erinnerungen-und-neuzuweisungs-hinweise).
- **Verpasster Anruf**, auf der Karte **Richtlinien für eingehende Anrufe**, sagt den Eigentümern einer Richtlinie für eingehende Anrufe, dass ein Anrufer niemanden erreicht hat. Siehe [Richtlinie für eingehende Anrufe](/docs/on-call/incoming-call-policy#verpasste-anrufe).

## Sicherheitsfälle

Der Tab **Sicherheit** handelt von den Sicherheitsfällen, die Sie sehen können:

- **Neuer Sicherheitsfall** hat unter seinem Namen eine Priorität: die niedrigste Priorität, ab der ein Fall Sie benachrichtigt. Sie steht auf **Hoch und höher**, sofern Sie nicht **Nur Kritisch**, **Mittel und höher**, **Niedrig und höher** oder **Jeder Fall** wählen.
- **Mir zugewiesener Sicherheitsfall** folgt den Fällen, die Ihnen und den Teams, in denen Sie sind, zugewiesen sind.
- **Playbook-Schritt wartet auf meine Genehmigung** bittet Sie, einen Playbook-Schritt an einem Fall zu genehmigen oder abzulehnen, bei dem Sie genehmigen dürfen.

Siehe [Sicherheitsfälle](/docs/telemetry/security-cases#benachrichtigungen).

## Weniger E-Mails

Diese Schalter entscheiden, welche Neuigkeiten Sie erreichen, nicht wie viele E-Mails daraus werden. **Benutzereinstellungen → E-Mail-Einstellungen** hat dafür zwei Karten, beide nur für Sie, in diesem Projekt:

- **E-Mail-Zusammenfassung** fasst einen Schub von Neuigkeiten in einer E-Mail zusammen: Die ersten kommen weiterhin einzeln, der Rest gemeinsam einige Minuten später.
- **Weniger Routine-E-Mails** schaltet mit **Routine-E-Mails reduzieren** die E-Mails zu Notizen, neuen Eigentümern, neuen Überwachungen und Statusseiten, Ergänzungen von Episoden und Änderungen an Bereitschaftsrichtlinien aus.

Siehe [Benachrichtigungs-Zusammenfassung](/docs/emails/notification-rollup).

## Fehlerbehebung

:::details Ein Schalter ist an, aber nichts kommt an
Prüfen Sie, ob Sie auf diesem Kanal eine verifizierte Methode unter **Benutzereinstellungen → Benachrichtigungsmethoden** haben. Für SMS, Anruf, WhatsApp und Telegram muss auch das Projekt den Kanal eingeschaltet haben.
:::

:::details Mir gehört eine Überwachung, aber ich erfahre nie, wenn sie ausfällt
**Überwachungsstatus geändert** beginnt ausgeschaltet. Schalten Sie dafür einen Kanal ein, auf dem Tab **Überwachung**.
:::

:::details Ich bekomme weiter E-Mails, obwohl ich alles ausgeschaltet habe
Alarme folgen Ihren Bereitschaftsregeln, nicht diesen Schaltern, und E-Mails zu Anmeldung, Sicherheit und Abrechnung sind keine Neuigkeiten zu Datensätzen. Jedes Projekt hat eigene Einstellungen, prüfen Sie also das Projekt, aus dem die E-Mail kam. Siehe [Persönliche Bereitschaftsregeln](/docs/notifications/on-call-rules).
:::

## Nächste Schritte

:::cards
- [Benachrichtigungsmethoden](/docs/notifications/notification-methods): Fügen Sie die Methoden hinzu, an die Ihre Einstellungen senden.
- [Persönliche Bereitschaftsregeln](/docs/notifications/on-call-rules): Legen Sie fest, wie ein Alarm Sie erreicht.
- [Benachrichtigungs-Zusammenfassung](/docs/emails/notification-rollup): Weniger, vollere E-Mails während eines Schubs.
- [Wie OneUptime Sie erreicht](/docs/notifications/index): Wie Methoden, Regeln und Einstellungen zusammenpassen.
:::
