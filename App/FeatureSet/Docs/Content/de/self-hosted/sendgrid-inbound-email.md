# SendGrid Inbound Email-Integration

Der **Eingehende E-Mail-Monitor** von OneUptime ermöglicht das Erstellen und Auflösen von Benachrichtigungen basierend auf E-Mails, die an eindeutige monitor-spezifische E-Mail-Adressen gesendet werden. Diese Anleitung erklärt, wie Sie SendGrid Inbound Parse einrichten, um eingehende E-Mails an Ihre selbst gehostete OneUptime-Instanz weiterzuleiten.

## Voraussetzungen

- Ein SendGrid-Konto mit Zugriff auf Inbound Parse
- Eine Domain, die Sie kontrollieren, mit Zugriff auf DNS-Einstellungen
- Ein öffentlicher HTTPS-Endpunkt, der SendGrid-Webhooks an OneUptime weiterleitet

## Netzwerkzugriff

Inbound Parse benötigt eine von SendGrid eingeleitete Verbindung zu OneUptime. Ausschließlich ausgehender Internetzugriff reicht dafür nicht aus.

| Richtung | Ziel | Protokoll / Port | Zweck |
| --- | --- | --- | --- |
| SendGrid → OneUptime | `https://your-oneuptime-domain.com/incoming-email/sendgrid/YOUR_SECRET` | HTTPS / TCP 443 | Geparste E-Mails als Multipart-POST zustellen. |
| Sendende Mailserver → SendGrid | `mx.sendgrid.net`, über den öffentlichen MX-Eintrag Ihrer Empfangsdomain | SMTP / TCP 25 | E-Mails bei SendGrid empfangen, nicht auf dem OneUptime-Server. |
| OneUptime → SendGrid, nur bei separat konfiguriertem E-Mail-Versand | `api.sendgrid.com` | HTTPS / TCP 443 | Benachrichtigungen über die Mail Send API versenden. |

Veröffentlichen Sie DNS für den Webhook-Hostnamen und verwenden Sie ein öffentlich vertrauenswürdiges Zertifikat. Eine private Installation kann nur den Webhook-Pfad über einen öffentlichen Reverse-Proxy oder ein Gateway freigeben, das OneUptime intern erreicht. Pfad, geheimer Wert, Inhaltstyp und Multipart-Inhalt müssen erhalten bleiben. Erlauben Sie POST-Anfragen ohne interaktive Anmeldung oder Browserprüfung. OneUptime benötigt keinen eingehenden SMTP-Listener. Siehe [SendGrid-Einrichtung](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/setting-up-the-inbound-parse-webhook). Die Empfangsdomain muss zu einer [authentifizierten Domain](https://www.twilio.com/docs/sendgrid/ui/account-and-settings/inbound-parse) gehören.

Setzen Sie `INBOUND_EMAIL_WEBHOOK_SECRET` auf einen starken Zufallswert und ersetzen Sie `YOUR_SECRET` damit. Das letzte Pfadsegment ist erforderlich. OneUptime vergleicht es mit dem konfigurierten Wert; ein leerer Umgebungswert deaktiviert diese Prüfung. Halten Sie die vollständige URL und Monitor-E-Mail-Adressen geheim, auch in Proxy-Protokollen. OneUptime prüft derzeit weder signierte Inbound-Parse-Header noch OAuth-Token von SendGrid. Falls erforderlich, muss ein Gateway diese vor der Weiterleitung gemäß [SendGrids Sicherheitsdokumentation](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/securing-your-parse-webhooks) prüfen.

SendGrid stellt keine verlässliche statische Liste der Inbound-Parse-Quell-IP-Adressen bereit. Versand-IP-Adressen und DNS-Ergebnisse für `mx.sendgrid.net` eignen sich nicht als Webhook-Freigabeliste. Befolgen Sie [SendGrids Firewall-Hinweise](https://support.sendgrid.com/hc/en-us/articles/44375457225371-How-to-Configure-Firewall-Settings-for-SendGrid-Webhook-and-Inbound-Parse-IPs).

Inbound Parse ist vom E-Mail-Versand getrennt. Für den Empfang muss OneUptime die SendGrid-API nicht aufrufen. Für SendGrid-Benachrichtigungen erlauben Sie DNS und ausgehendes HTTPS zu `api.sendgrid.com`; [Mail Send](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send) benötigt zum Einreichen keine eingehende Rückmeldung. Bei SMTP erlauben Sie den in OneUptime konfigurierten Server und Port.

Prüfen Sie den öffentlichen MX-Eintrag, senden Sie eine E-Mail an einen Testmonitor und bestätigen Sie Webhook-Eingang sowie Erstellung oder Auflösung des passenden Alarms. Ein leerer POST oder ein erfolgreicher Versandtest bestätigt den Inbound-Parse-Ablauf nicht.

## Funktionsweise

1. Sie erstellen einen **Eingehenden E-Mail-Monitor** in OneUptime
2. OneUptime generiert eine eindeutige E-Mail-Adresse für diesen Monitor (z. B. `monitor-abc123@inbound.yourdomain.com`)
3. Wenn eine E-Mail an diese Adresse gesendet wird, empfängt SendGrid sie und leitet sie über Webhook an OneUptime weiter
4. OneUptime wertet die E-Mail anhand Ihrer konfigurierten Kriterien aus, um Benachrichtigungen zu erstellen oder aufzulösen

## Einrichtungsanweisungen

### Schritt 1: Eingehende E-Mail-Domain wählen

Sie benötigen eine Subdomain, die ausschließlich für eingehende E-Mails bestimmt ist. Wir empfehlen eine Subdomain wie:

- `inbound.yourdomain.com`
- `email.yourdomain.com`
- `monitor.yourdomain.com`

### Schritt 2: DNS MX-Eintrag konfigurieren

Fügen Sie einen MX-Eintrag zu Ihrer DNS-Konfiguration hinzu, um E-Mails für Ihre eingehende Subdomain an SendGrid weiterzuleiten.

| Typ | Host/Name | Priorität | Wert            |
| --- | --------- | --------- | --------------- |
| MX  | inbound   | 10        | mx.sendgrid.net |

**Hinweis:** DNS-Änderungen können bis zu 48 Stunden dauern, bis sie sich propagiert haben.

### Schritt 3: SendGrid Inbound Parse konfigurieren

1. Melden Sie sich bei Ihrem [SendGrid-Dashboard](https://app.sendgrid.com) an
2. Navigieren Sie zu **Einstellungen** > **Inbound Parse**
3. Klicken Sie auf **Host & URL hinzufügen**
4. Konfigurieren Sie Folgendes:

| Feld               | Wert                                                                    |
| ------------------ | ----------------------------------------------------------------------- |
| **Empfangsdomain** | Ihre eingehende Subdomain (z. B. `inbound.yourdomain.com`)              |
| **Ziel-URL**       | `https://your-oneuptime-domain.com/incoming-email/sendgrid/YOUR_SECRET` |

5. Klicken Sie auf **Hinzufügen**

### Schritt 4: OneUptime-Umgebungsvariablen konfigurieren

#### Docker Compose

Fügen Sie diese Umgebungsvariablen zu Ihrer `config.env`-Datei hinzu:

```bash
# Eingehende E-Mail-Konfiguration
INBOUND_EMAIL_PROVIDER=SendGrid
INBOUND_EMAIL_DOMAIN=inbound.yourdomain.com
INBOUND_EMAIL_WEBHOOK_SECRET=replace-with-a-strong-random-secret
```

#### Kubernetes mit Helm

```yaml
inboundEmail:
  provider: "SendGrid"
  domain: "inbound.yourdomain.com"
  webhookSecret: "replace-with-a-strong-random-secret"
```

Verwenden Sie denselben geheimen Wert in der Ziel-URL und starten Sie OneUptime nach der Konfigurationsänderung neu.

### Schritt 5: Eingehenden E-Mail-Monitor erstellen

1. Melden Sie sich bei Ihrem OneUptime-Dashboard an
2. Navigieren Sie zu **Monitore** > **Monitor erstellen**
3. Wählen Sie **Eingehende E-Mail** als Monitortyp
4. Konfigurieren Sie Ihren Monitor und Ihre Kriterien
5. Klicken Sie auf **Erstellen**

Nach der Erstellung sehen Sie die eindeutige E-Mail-Adresse für diesen Monitor.

## Umgebungsvariablen-Referenz

| Variable                       | Beschreibung                                       | Erforderlich | Standard |
| ------------------------------ | -------------------------------------------------- | ------------ | -------- |
| `INBOUND_EMAIL_PROVIDER`       | Der zu verwendende eingehende E-Mail-Anbieter      | Ja           | -        |
| `INBOUND_EMAIL_DOMAIN`         | Die für eingehende E-Mails konfigurierte Subdomain | Ja           | -        |
| `INBOUND_EMAIL_WEBHOOK_SECRET` | Wird mit dem letzten URL-Segment `/incoming-email/sendgrid/YOUR_SECRET` verglichen. Für öffentliche Endpunkte konfigurieren; ein leerer Wert deaktiviert die Prüfung. | Empfohlen | - |

## Fehlerbehebung

### E-Mails werden nicht empfangen

1. **DNS-Propagation prüfen:**

   ```bash
   dig MX inbound.yourdomain.com
   ```

   Sollte `mx.sendgrid.net` zurückgeben

2. **SendGrid Inbound Parse-Einstellungen überprüfen:**
   - Beim SendGrid-Dashboard anmelden
   - Zu Einstellungen > Inbound Parse gehen
   - Domain und Webhook-URL auf Korrektheit prüfen

## Support

Bei Problemen mit der SendGrid Inbound Email-Integration:

1. Prüfen Sie den Abschnitt zur Fehlerbehebung oben
2. Überprüfen Sie die OneUptime-Logs auf detaillierte Fehlermeldungen
3. Kontaktieren Sie uns unter [hello@oneuptime.com](mailto:hello@oneuptime.com)
