# SendGrid Inbound E-mail-integratie

Met de **Inkomend e-mail-monitor** van OneUptime kunt u meldingen aanmaken en oplossen op basis van e-mails die worden verzonden naar unieke, monitorspecifieke e-mailadressen. Dit is nuttig voor integratie met verouderde systemen, meldingstools of elke dienst die e-mails kan sturen.

Deze handleiding legt uit hoe u SendGrid Inbound Parse instelt om inkomende e-mails door te sturen naar uw zelf-gehoste OneUptime-instantie.

## Vereisten

- Een SendGrid-account (gratis laag werkt)
- Een domein dat u beheert met toegang tot DNS-instellingen
- Uw OneUptime-instantie moet openbaar toegankelijk zijn (zodat SendGrid webhooks kan sturen)

## Hoe het werkt

1. U maakt een **Inkomend e-mail-monitor** aan in OneUptime
2. OneUptime genereert een uniek e-mailadres voor die monitor (bijv. `monitor-abc123@inbound.yourdomain.com`)
3. Wanneer een e-mail naar dat adres wordt verzonden, ontvangt SendGrid het en stuurt het via webhook door naar OneUptime
4. OneUptime evalueert de e-mail aan de hand van uw geconfigureerde criteria om meldingen aan te maken of op te lossen

## Installatie-instructies

### Stap 1: Kies uw inkomend e-maildomein

U heeft een subdomein nodig dat speciaal is bestemd voor het ontvangen van inkomende e-mails. We raden het gebruik van een subdomein aan zoals:

- `inbound.yourdomain.com`
- `email.yourdomain.com`
- `monitor.yourdomain.com`

Dit subdomein wordt uitsluitend gebruikt voor OneUptime monitor-e-mails.

### Stap 2: DNS MX-record configureren

Voeg een MX-record toe aan uw DNS-configuratie om e-mails voor uw inkomend subdomein naar SendGrid te routeren.

| Type | Host/Naam | Prioriteit | Waarde |
|------|-----------|----------|-------|
| MX | inbound | 10 | mx.sendgrid.net |

**Voorbeeld:** Als uw domein `example.com` is en u `inbound.example.com` gebruikt:

```
inbound.example.com.  IN  MX  10  mx.sendgrid.net.
```

**Opmerking:** DNS-wijzigingen kunnen tot 48 uur duren om door te werken, maar zijn doorgaans binnen een paar uur voltooid.

### Stap 3: Domein verifiëren in SendGrid (optioneel maar aanbevolen)

Voor betere bezorgbaarheid en om te voorkomen dat e-mails als spam worden gemarkeerd:

1. Log in op uw [SendGrid Dashboard](https://app.sendgrid.com)
2. Ga naar **Instellingen** > **Afzenderauthenticatie**
3. Klik op **Uw domein verifiëren**
4. Volg de aanwijzingen om de vereiste DNS-records toe te voegen (CNAME-records voor DKIM)

### Stap 4: SendGrid Inbound Parse configureren

1. Log in op uw [SendGrid Dashboard](https://app.sendgrid.com)
2. Navigeer naar **Instellingen** > **Inbound Parse**
3. Klik op **Host & URL toevoegen**
4. Configureer het volgende:

| Veld | Waarde |
|-------|-------|
| **Ontvangsdomein** | Uw inkomend subdomein (bijv. `inbound.yourdomain.com`) |
| **Doel-URL** | `https://your-oneuptime-domain.com/incoming-email/sendgrid/YOUR_SECRET` |
| **Controleer inkomende e-mails op spam** | Optioneel — schakel in indien gewenst |
| **Stuur onbewerkt, volledig MIME-bericht** | Laat ongevinkt (niet vereist) |
| **POST het onbewerkte, volledige MIME-bericht** | Laat ongevinkt (niet vereist) |

5. Klik op **Toevoegen**

### Stap 5: OneUptime omgevingsvariabelen configureren

#### Docker Compose

Voeg deze omgevingsvariabelen toe aan uw `config.env`-bestand:

```bash
# Inbound e-mailconfiguratie
INBOUND_EMAIL_PROVIDER=SendGrid
INBOUND_EMAIL_DOMAIN=inbound.yourdomain.com
# INBOUND_EMAIL_WEBHOOK_SECRET=your-optional-secret  # Optioneel: voor extra beveiliging
```

#### Kubernetes met Helm

Voeg deze toe aan uw `values.yaml`-bestand:

```yaml
inboundEmail:
  provider: "SendGrid"
  domain: "inbound.yourdomain.com"
  # webhookSecret: "your-optional-secret"  # Optioneel
```

**Belangrijk:** Herstart uw OneUptime-server na het toevoegen van deze omgevingsvariabelen.

### Stap 6: Een Inkomend e-mail-monitor aanmaken

1. Log in op uw OneUptime-dashboard
2. Navigeer naar **Monitors** > **Monitor aanmaken**
3. Selecteer **Inkomend e-mail** als het monitortype
4. Configureer uw monitor:
   - **Naam:** Geef uw monitor een beschrijvende naam
   - **Beschrijving:** Beschrijf waarvoor deze monitor dient
5. Configureer **Criteria voor het aanmaken van meldingen** (wanneer een melding aangemaakt moet worden):
   - Voorbeeld: E-mailonderwerp bevat "MELDING" of "KRITIEK"
6. Configureer **Criteria voor het oplossen van meldingen** (wanneer een melding opgelost moet worden):
   - Voorbeeld: E-mailonderwerp bevat "OPGELOST" of "OK"
7. Klik op **Aanmaken**

Na aanmaak ziet u het unieke e-mailadres voor deze monitor (bijv. `monitor-abc123def456@inbound.yourdomain.com`).

### Stap 7: De integratie testen

1. Kopieer het e-mailadres van de monitor van het OneUptime-dashboard
2. Stuur een test-e-mail naar dat adres met een onderwerp dat overeenkomt met uw meldingscriteria
3. Controleer het OneUptime-dashboard om te verifiëren:
   - De e-mail was ontvangen (zichtbaar in Monitorsamenvatting)
   - Er is een melding aangemaakt (als criteria overeenkwamen)

## Omgevingsvariabelen referentie

| Variabele | Beschrijving | Vereist | Standaard |
|----------|-------------|----------|---------|
| `INBOUND_EMAIL_PROVIDER` | De te gebruiken inbound e-mailprovider | Ja | - |
| `INBOUND_EMAIL_DOMAIN` | Het subdomein geconfigureerd voor inkomende e-mails | Ja | - |
| `INBOUND_EMAIL_WEBHOOK_SECRET` | Geheim voor het valideren van webhookverzoeken. Als ingesteld, voeg dit geheim toe aan de webhook-URL: `/incoming-email/sendgrid/YOUR_SECRET` | Nee | - |

## Ondersteunde e-mailcriteria

Bij het configureren van uw Inkomend e-mail-monitor kunt u criteria aanmaken op basis van:

| Veld | Beschrijving | Beschikbare filters |
|-------|-------------|-------------------|
| **E-mailonderwerp** | De onderwerpregel van de e-mail | Bevat, Bevat niet, Gelijk aan, Niet gelijk aan, Begint met, Eindigt met, Is leeg, Is niet leeg |
| **E-mail van** | Het e-mailadres van de afzender | Bevat, Bevat niet, Gelijk aan, Niet gelijk aan, Begint met, Eindigt met, Is leeg, Is niet leeg |
| **E-maillichaam** | De gewone tekstinhoud van de e-mail | Bevat, Bevat niet, Gelijk aan, Niet gelijk aan, Begint met, Eindigt met, Is leeg, Is niet leeg |
| **E-mail naar** | Het e-mailadres van de ontvanger | Bevat, Bevat niet, Gelijk aan, Niet gelijk aan, Begint met, Eindigt met, Is leeg, Is niet leeg |
| **E-mail ontvangen** | Tijd since de laatste e-mail was ontvangen | Ontvangen in minuten, Niet ontvangen in minuten |

## Voorbeeldgebruiksscenario's

### Meldingen van verouderde systemen

Veel verouderde systemen kunnen alleen e-mailmeldingen sturen. Maak een Inkomend e-mail-monitor aan om:
- OneUptime-meldingen aan te maken wanneer het verouderde systeem `[KRITIEK]`-e-mails stuurt
- Meldingen op te lossen wanneer `[OPGELOST]`-e-mails worden ontvangen

### Integratie met externe diensten

Integreer met diensten die e-mailmeldingen sturen:
- Monitoringtools zonder API-integraties
- Cloudprovider-meldingen
- Beveiligingsscan-tools

### Heartbeat via e-mail

Gebruik "E-mail ontvangen"-criteria om te zorgen dat u periodieke e-mails ontvangt:
- Melding aanmaken als er 60 minuten geen e-mail wordt ontvangen
- Nuttig voor het bewaken van batchtaken of geplande taken die voltooiings-e-mails sturen

## Probleemoplossing

### E-mails worden niet ontvangen

1. **Controleer DNS-doorwerking:**
   ```bash
   dig MX inbound.yourdomain.com
   ```
   Zou `mx.sendgrid.net` moeten retourneren

2. **Controleer SendGrid Inbound Parse-instellingen:**
   - Log in op het SendGrid Dashboard
   - Ga naar Instellingen > Inbound Parse
   - Verifieer dat uw domein en webhook-URL correct zijn

3. **Controleer OneUptime-logboeken:**
   - Zoek naar webhookverzoeken in de ProbeIngest-dienstlogboeken
   - Controleer op foutmeldingen

### Webhooks mislukken

1. **Zorg dat OneUptime openbaar toegankelijk is:**
   - De webhook-URL moet bereikbaar zijn vanaf het internet
   - Test met: `curl -X POST https://your-oneuptime-domain.com/incoming-email/sendgrid`

2. **Controleer firewallregels:**
   - Sta inkomend HTTPS-verkeer toe van de IP-reeksen van SendGrid

3. **Verifieer SSL-certificaat:**
   - SendGrid vereist een geldig SSL-certificaat
   - Zelfondertekende certificaten kunnen problemen veroorzaken

### Monitor maakt geen meldingen aan

1. **Verifieer criteriaconfiguratie:**
   - Controleer of uw meldingsaanmaakcriteria overeenkomen met de e-mailinhoud
   - Test eerst met exacte tekenreeksen voordat u patroonmatching gebruikt

2. **Controleer monitorstatus:**
   - Zorg dat de monitor niet is uitgeschakeld
   - Verifieer dat het monitortype "Inkomend e-mail" is

3. **Bekijk de Monitorsamenvatting:**
   - Controleer of de e-mail is ontvangen en verwerkt
   - Bekijk de evaluatielogboeken voor details over criteria-matching

## Beveiligingsbest practices

1. **Gebruik HTTPS:** Gebruik altijd HTTPS voor uw webhook-eindpunt
2. **Webhookgeheim:** Configureer `INBOUND_EMAIL_WEBHOOK_SECRET` en voeg het toe aan uw webhook-URL (bijv. `/incoming-email/sendgrid/your-secret`) voor extra validatie
3. **Domeinverificatie:** Verifieer uw domein in SendGrid voor betere e-mailbeveiliging
4. **Beperk toegang:** Maak alleen monitors aan voor vertrouwde e-mailbronnen
5. **Bewaken logboeken:** Controleer regelmatig inkomende e-maillogboeken op verdachte activiteit

## Alternatieve providers

OneUptime is ontworpen om meerdere inbound e-mailproviders te ondersteunen. Momenteel ondersteund:

| Provider | Status |
|----------|--------|
| SendGrid | Ondersteund |
| Haraka (Zelf-gehost) | Gepland |

Als u ondersteuning voor een andere provider nodig heeft, neem dan contact met ons op of dien een functieverzoek in.

## Ondersteuning

Als u problemen ondervindt met de SendGrid Inbound E-mail-integratie:

1. Controleer de bovenstaande sectie voor probleemoplossing
2. Bekijk de OneUptime-logboeken voor gedetailleerde foutmeldingen
3. Neem contact op via [hello@oneuptime.com](mailto:hello@oneuptime.com)

Feedback om deze integratie te verbeteren is van harte welkom!
