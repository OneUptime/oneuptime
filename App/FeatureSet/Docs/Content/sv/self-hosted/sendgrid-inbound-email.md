# SendGrid Integration för inkommande e-post

OneUptimes **Monitor för inkommande e-post** gör det möjligt att skapa och lösa varningar baserat på e-postmeddelanden som skickas till unika monitorspecifika e-postadresser. Det är användbart för integration med äldre system, varningsverktyg eller vilken tjänst som helst som kan skicka e-postmeddelanden.

Den här guiden förklarar hur du konfigurerar SendGrid Inbound Parse för att vidarebefordra inkommande e-postmeddelanden till din egeninstallerade OneUptime-instans.

## Förutsättningar

- Ett SendGrid-konto (gratistjänsten fungerar)
- En domän du kontrollerar med åtkomst till DNS-inställningar
- Din OneUptime-instans måste vara offentligt tillgänglig (för att SendGrid ska kunna skicka webhooks)

## Hur det fungerar

1. Du skapar en **Monitor för inkommande e-post** i OneUptime
2. OneUptime genererar en unik e-postadress för den monitorn (t.ex. `monitor-abc123@inbound.yourdomain.com`)
3. När ett e-postmeddelande skickas till den adressen tar SendGrid emot det och vidarebefordrar det till OneUptime via webhook
4. OneUptime utvärderar e-postmeddelandet mot dina konfigurerade kriterier för att skapa eller lösa varningar

## Konfigurationsinstruktioner

### Steg 1: Välj din inkommande e-postdomän

Du behöver en underdomän dedikerad till att ta emot inkommande e-postmeddelanden. Vi rekommenderar att använda en underdomän som:

- `inbound.yourdomain.com`
- `email.yourdomain.com`
- `monitor.yourdomain.com`

Denna underdomän används uteslutande för OneUptime-monitormeddelanden.

### Steg 2: Konfigurera DNS MX-post

Lägg till en MX-post i din DNS-konfiguration för att dirigera e-postmeddelanden för din inkommande underdomän till SendGrid.

| Typ | Värd/Namn | Prioritet | Värde           |
| --- | --------- | --------- | --------------- |
| MX  | inbound   | 10        | mx.sendgrid.net |

**Exempel:** Om din domän är `example.com` och du använder `inbound.example.com`:

```
inbound.example.com.  IN  MX  10  mx.sendgrid.net.
```

**Observera:** DNS-ändringar kan ta upp till 48 timmar att spridas, men slutförs vanligtvis inom några timmar.

### Steg 3: Verifiera domän i SendGrid (valfritt men rekommenderas)

För bättre leveransbarhet och för att undvika att e-postmeddelanden markeras som skräppost:

1. Logga in på din [SendGrid-instrumentpanel](https://app.sendgrid.com)
2. Gå till **Settings** > **Sender Authentication**
3. Klicka på **Authenticate Your Domain**
4. Följ anvisningarna för att lägga till de obligatoriska DNS-posterna (CNAME-poster för DKIM)

### Steg 4: Konfigurera SendGrid Inbound Parse

1. Logga in på din [SendGrid-instrumentpanel](https://app.sendgrid.com)
2. Navigera till **Settings** > **Inbound Parse**
3. Klicka på **Add Host & URL**
4. Konfigurera följande:

| Fält                                | Värde                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------- |
| **Receiving Domain**                | Din inkommande underdomän (t.ex. `inbound.yourdomain.com`)              |
| **Destination URL**                 | `https://your-oneuptime-domain.com/incoming-email/sendgrid/YOUR_SECRET` |
| **Check incoming emails for spam**  | Valfritt – aktivera om du vill                                          |
| **Send raw, full MIME message**     | Lämna omarkerat (krävs inte)                                            |
| **POST the raw, full MIME message** | Lämna omarkerat (krävs inte)                                            |

5. Klicka på **Add**

### Steg 5: Konfigurera OneUptime-miljövariabler

#### Docker Compose

Lägg till dessa miljövariabler i din `config.env`-fil:

```bash
# Konfiguration för inkommande e-post
INBOUND_EMAIL_PROVIDER=SendGrid
INBOUND_EMAIL_DOMAIN=inbound.yourdomain.com
# INBOUND_EMAIL_WEBHOOK_SECRET=your-optional-secret  # Valfritt: för ytterligare säkerhet
```

#### Kubernetes med Helm

Lägg till dessa i din `values.yaml`-fil:

```yaml
inboundEmail:
  provider: "SendGrid"
  domain: "inbound.yourdomain.com"
  # webhookSecret: "your-optional-secret"  # Valfritt
```

**Viktigt:** Starta om din OneUptime-server efter att du har lagt till dessa miljövariabler.

### Steg 6: Skapa en Monitor för inkommande e-post

1. Logga in på din OneUptime-instrumentpanel
2. Navigera till **Monitorer** > **Skapa monitor**
3. Välj **Inkommande e-post** som monitortyp
4. Konfigurera din monitor:
   - **Namn:** Ge din monitor ett beskrivande namn
   - **Beskrivning:** Beskriv vad den här monitorn är till för
5. Konfigurera **Kriterier för varningsskapande**:
   - Exempel: E-postämne innehåller "ALERT" eller "CRITICAL"
6. Konfigurera **Kriterier för varningslösning**:
   - Exempel: E-postämne innehåller "RESOLVED" eller "OK"
7. Klicka på **Skapa**

### Steg 7: Testa integrationen

1. Kopiera monitorns e-postadress från OneUptime-instrumentpanelen
2. Skicka ett testmail till den adressen med ett ämne som matchar dina varningskriterier
3. Kontrollera OneUptime-instrumentpanelen för att verifiera att:
   - E-postmeddelandet togs emot (synligt i monitoröversikten)
   - En varning skapades (om kriterierna matchade)

## Referens för miljövariabler

| Variabel                       | Beskrivning                                                                                                                                          | Obligatorisk | Standard |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | -------- |
| `INBOUND_EMAIL_PROVIDER`       | Den inkommande e-postleverantören att använda                                                                                                        | Ja           | –        |
| `INBOUND_EMAIL_DOMAIN`         | Underdomänen konfigurerad för inkommande e-postmeddelanden                                                                                           | Ja           | –        |
| `INBOUND_EMAIL_WEBHOOK_SECRET` | Hemlighet för att validera webhook-förfrågningar. När angiven, lägg till denna hemlighet till webhook-URL:en: `/incoming-email/sendgrid/YOUR_SECRET` | Nej          | –        |

## Felsökning

### E-postmeddelanden tas inte emot

1. **Kontrollera DNS-spridning:**

   ```bash
   dig MX inbound.yourdomain.com
   ```

   Bör returnera `mx.sendgrid.net`

2. **Verifiera SendGrid Inbound Parse-inställningar:**

   - Logga in på SendGrid-instrumentpanelen
   - Gå till Settings > Inbound Parse
   - Verifiera att din domän och webhook-URL är korrekta

3. **Kontrollera OneUptime-loggar:**
   - Leta efter webhook-förfrågningar i ProbeIngest-tjänstens loggar

### Webhooks misslyckas

1. **Se till att OneUptime är offentligt tillgängligt:**

   - Webhook-URL:en måste vara nåbar från internet
   - Testa med: `curl -X POST https://your-oneuptime-domain.com/incoming-email/sendgrid`

2. **Kontrollera brandväggsregler:**

   - Tillåt inkommande HTTPS-trafik från SendGrids IP-intervall

3. **Verifiera SSL-certifikatet:**
   - SendGrid kräver ett giltigt SSL-certifikat

## Säkerhetsbästa praxis

1. **Använd HTTPS:** Använd alltid HTTPS för din webhook-slutpunkt
2. **Webhook-hemlighet:** Konfigurera `INBOUND_EMAIL_WEBHOOK_SECRET` och inkludera den i din webhook-URL för ytterligare validering
3. **Domänverifiering:** Verifiera din domän i SendGrid för bättre e-postsäkerhet
4. **Begränsa åtkomst:** Skapa bara monitorer för betrodda e-postkällor
5. **Övervaka loggar:** Granska regelbundet inkommande e-postloggar för misstänkt aktivitet

## Support

Om du stöter på problem med SendGrid-integrationen för inkommande e-post:

1. Kontrollera felsökningsavsnittet ovan
2. Granska OneUptime-loggarna för detaljerade felmeddelanden
3. Kontakta oss på [hello@oneuptime.com](mailto:hello@oneuptime.com)

Vi välkomnar feedback för att förbättra denna integration!
