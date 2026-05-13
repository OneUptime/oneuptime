# Eingehender E-Mail-Monitor

Der Eingehende E-Mail-Monitor ermöglicht das Erstellen und Auflösen von Benachrichtigungen basierend auf E-Mails, die an eindeutige monitor-spezifische E-Mail-Adressen gesendet werden. Dies ist nützlich für die Integration mit Legacy-Systemen, Drittanbieter-Benachrichtigungstools oder Diensten, die E-Mail-Benachrichtigungen senden können.

## Funktionsweise

1. Wenn Sie einen Eingehenden E-Mail-Monitor erstellen, generiert OneUptime eine eindeutige E-Mail-Adresse für diesen Monitor
2. Jede an diese Adresse gesendete E-Mail wird empfangen und anhand Ihrer konfigurierten Kriterien ausgewertet
3. Basierend auf den Kriterien kann OneUptime neue Benachrichtigungen erstellen oder vorhandene auflösen

Dies ist eine leistungsstarke Möglichkeit, E-Mail-basierte Benachrichtigungssysteme mit dem Incident-Management-Workflow von OneUptime zu integrieren.

## Einen Eingehenden E-Mail-Monitor erstellen

1. Navigieren Sie zu **Monitore** in Ihrem OneUptime-Dashboard
2. Klicken Sie auf **Monitor erstellen**
3. Wählen Sie **Eingehende E-Mail** als Monitortyp
4. Konfigurieren Sie die Monitor-Einstellungen:
   - **Name:** Ein beschreibender Name für Ihren Monitor
   - **Beschreibung:** Wofür dieser Monitor ist
5. Richten Sie Ihre **Benachrichtigungs-Erstellungskriterien** ein (Bedingungen, die Benachrichtigungen erstellen)
6. Richten Sie Ihre **Benachrichtigungs-Auflösungskriterien** ein (Bedingungen, die Benachrichtigungen auflösen)
7. Klicken Sie auf **Erstellen**

Nach der Erstellung sehen Sie die eindeutige E-Mail-Adresse für diesen Monitor auf der Monitor-Detailseite.

## E-Mail-Adressformat

Jeder Eingehende E-Mail-Monitor erhält eine eindeutige E-Mail-Adresse im Format:

```
monitor-{secret-key}@{inbound-domain}
```

Zum Beispiel: `monitor-abc123def456@inbound.yourdomain.com`

Sie können diese Adresse von der Monitor-Detailseite kopieren und Ihre externen Systeme so konfigurieren, dass E-Mails an sie gesendet werden.

## Verfügbare Kriterienfelder

Sie können Kriterien basierend auf den folgenden E-Mail-Feldern erstellen:

| Feld | Beschreibung |
|-------|-------------|
| **E-Mail-Betreff** | Die Betreffzeile der eingehenden E-Mail |
| **E-Mail von** | Die E-Mail-Adresse des Absenders |
| **E-Mail-Text** | Der Nur-Text-Inhalt des E-Mail-Textkörpers |
| **E-Mail an** | Die Empfänger-E-Mail-Adresse |
| **E-Mail erhalten** | Zeitbasierte Kriterien für den E-Mail-Eingang |

## Verfügbare Filtertypen

### Zeichenketten-Filter (Betreff, Von, Text, An)

| Filter | Beschreibung | Beispiel |
|--------|-------------|---------|
| **Enthält** | Feld enthält den angegebenen Text | Betreff enthält "CRITICAL" |
| **Enthält nicht** | Feld enthält den angegebenen Text nicht | Betreff enthält nicht "TEST" |
| **Gleich** | Feld stimmt exakt mit dem angegebenen Text überein | Von gleich "alerts@service.com" |
| **Ungleich** | Feld stimmt nicht mit dem angegebenen Text überein | Betreff ungleich "OK" |
| **Beginnt mit** | Feld beginnt mit dem angegebenen Text | Betreff beginnt mit "[ALERT]" |
| **Endet mit** | Feld endet mit dem angegebenen Text | Betreff endet mit "- Production" |
| **Ist leer** | Feld ist leer oder enthält keine Inhalte | Text ist leer |
| **Ist nicht leer** | Feld hat Inhalt | Betreff ist nicht leer |

### Zeitbasierte Filter (E-Mail erhalten)

| Filter | Beschreibung | Beispiel |
|--------|-------------|---------|
| **Empfangen in Minuten** | E-Mail wurde innerhalb von X Minuten empfangen | E-Mail innerhalb von 30 Minuten empfangen |
| **Nicht empfangen in Minuten** | Keine E-Mail in X Minuten empfangen | E-Mail nicht innerhalb von 60 Minuten empfangen |

## Beispielkonfigurationen

### Beispiel 1: Benachrichtigung bei kritischen E-Mails erstellen

**Benachrichtigungs-Erstellungskriterien:**
- E-Mail-Betreff **Enthält** "CRITICAL"
- ODER E-Mail-Betreff **Enthält** "ALERT"
- ODER E-Mail-Betreff **Enthält** "ERROR"

**Benachrichtigungs-Auflösungskriterien:**
- E-Mail-Betreff **Enthält** "RESOLVED"
- ODER E-Mail-Betreff **Enthält** "OK"
- ODER E-Mail-Betreff **Enthält** "RECOVERED"

### Beispiel 3: Heartbeat-Monitor (Keine E-Mail = Benachrichtigung)

**Benachrichtigungs-Erstellungskriterien:**
- E-Mail erhalten **Nicht empfangen in Minuten** mit Wert `60`

Dies erstellt eine Benachrichtigung, wenn 60 Minuten lang keine E-Mail empfangen wird – nützlich für die Überwachung geplanter Jobs oder Batch-Prozesse, die Abschluss-E-Mails senden sollten.

## Vorlagenvariablen

Bei der Konfiguration von Incident-Vorlagen können Sie diese Variablen aus eingehenden E-Mails verwenden:

| Variable | Beschreibung |
|----------|-------------|
| `{{emailSubject}}` | Der Betreff der empfangenen E-Mail |
| `{{emailFrom}}` | Die E-Mail-Adresse des Absenders |
| `{{emailTo}}` | Die Empfänger-E-Mail-Adresse |
| `{{emailBody}}` | Der Nur-Text-Textkörper der E-Mail |
| `{{emailReceivedAt}}` | Wann die E-Mail empfangen wurde |

## Self-Hosted-Einrichtung

Wenn Sie OneUptime selbst hosten, müssen Sie einen eingehenden E-Mail-Anbieter konfigurieren. Derzeit unterstützt:

- **SendGrid Inbound Parse** - Informationen zur Einrichtung finden Sie unter [SendGrid Inbound Email Integration](/docs/self-hosted/sendgrid-inbound-email)

## Zu beachtende Punkte

- **E-Mail-Adresssicherheit:** Die Monitor-E-Mail-Adresse enthält einen geheimen Schlüssel. Behandeln Sie sie wie ein Passwort und teilen Sie sie nicht öffentlich.
- **E-Mail-Größe:** Sehr große E-Mails (mit großen Anhängen) können vom E-Mail-Anbieter abgeschnitten oder abgelehnt werden.
- **Verarbeitungszeit:** E-Mails werden asynchron verarbeitet. Es kann eine kurze Verzögerung zwischen dem Senden einer E-Mail und der Benachrichtigungserstellung geben.
- **Groß-/Kleinschreibung:** Alle Zeichenkettenvergleiche (Enthält, Gleich usw.) unterscheiden nicht zwischen Groß- und Kleinschreibung.
- **Nur-Text:** E-Mail-Text-Kriterien verwenden die Nur-Text-Version der E-Mail. HTML-Formatierung wird entfernt.
