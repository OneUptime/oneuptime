# SendGrid Inbound Email-Integration

Der **Eingehende E-Mail-Monitor** von OneUptime ermöglicht das Erstellen und Auflösen von Benachrichtigungen basierend auf E-Mails, die an eindeutige monitor-spezifische E-Mail-Adressen gesendet werden. Diese Anleitung erklärt, wie Sie SendGrid Inbound Parse einrichten, um eingehende E-Mails an Ihre selbst gehostete OneUptime-Instanz weiterzuleiten.

## Voraussetzungen

- Ein SendGrid-Konto (kostenloser Tarif funktioniert)
- Eine Domain, die Sie kontrollieren, mit Zugriff auf DNS-Einstellungen
- Ihre OneUptime-Instanz muss öffentlich erreichbar sein (damit SendGrid Webhooks senden kann)

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

| Typ | Host/Name | Priorität | Wert |
|------|-----------|----------|-------|
| MX | inbound | 10 | mx.sendgrid.net |

**Hinweis:** DNS-Änderungen können bis zu 48 Stunden dauern, bis sie sich propagiert haben.

### Schritt 3: SendGrid Inbound Parse konfigurieren

1. Melden Sie sich bei Ihrem [SendGrid-Dashboard](https://app.sendgrid.com) an
2. Navigieren Sie zu **Einstellungen** > **Inbound Parse**
3. Klicken Sie auf **Host & URL hinzufügen**
4. Konfigurieren Sie Folgendes:

| Feld | Wert |
|-------|-------|
| **Empfangsdomain** | Ihre eingehende Subdomain (z. B. `inbound.yourdomain.com`) |
| **Ziel-URL** | `https://your-oneuptime-domain.com/incoming-email/sendgrid/YOUR_SECRET` |

5. Klicken Sie auf **Hinzufügen**

### Schritt 4: OneUptime-Umgebungsvariablen konfigurieren

#### Docker Compose

Fügen Sie diese Umgebungsvariablen zu Ihrer `config.env`-Datei hinzu:

```bash
# Eingehende E-Mail-Konfiguration
INBOUND_EMAIL_PROVIDER=SendGrid
INBOUND_EMAIL_DOMAIN=inbound.yourdomain.com
# INBOUND_EMAIL_WEBHOOK_SECRET=your-optional-secret  # Optional: für zusätzliche Sicherheit
```

#### Kubernetes mit Helm

```yaml
inboundEmail:
  provider: "SendGrid"
  domain: "inbound.yourdomain.com"
  # webhookSecret: "your-optional-secret"  # Optional
```

**Wichtig:** Starten Sie Ihren OneUptime-Server nach dem Hinzufügen dieser Umgebungsvariablen neu.

### Schritt 5: Eingehenden E-Mail-Monitor erstellen

1. Melden Sie sich bei Ihrem OneUptime-Dashboard an
2. Navigieren Sie zu **Monitore** > **Monitor erstellen**
3. Wählen Sie **Eingehende E-Mail** als Monitortyp
4. Konfigurieren Sie Ihren Monitor und Ihre Kriterien
5. Klicken Sie auf **Erstellen**

Nach der Erstellung sehen Sie die eindeutige E-Mail-Adresse für diesen Monitor.

## Umgebungsvariablen-Referenz

| Variable | Beschreibung | Erforderlich | Standard |
|----------|-------------|----------|---------|
| `INBOUND_EMAIL_PROVIDER` | Der zu verwendende eingehende E-Mail-Anbieter | Ja | - |
| `INBOUND_EMAIL_DOMAIN` | Die für eingehende E-Mails konfigurierte Subdomain | Ja | - |
| `INBOUND_EMAIL_WEBHOOK_SECRET` | Geheimnis zur Validierung von Webhook-Anfragen | Nein | - |

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
