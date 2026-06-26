# SendGrid indgående e-mail-integration

OneUptimes **Indgående e-mailmonitor** giver dig mulighed for at oprette og løse advarsler baseret på e-mails sendt til unikke monitor-specifikke e-mailadresser. Dette er nyttigt til integration med ældre systemer, advarselsværktøjer eller enhver tjeneste, der kan sende e-mails.

Denne guide forklarer, hvordan du opsætter SendGrid Inbound Parse til at videresende indgående e-mails til din selvhostede OneUptime-instans.

## Forudsætninger

- En SendGrid-konto (gratis niveau fungerer)
- Et domæne, du kontrollerer, med adgang til DNS-indstillinger
- Din OneUptime-instans skal være offentligt tilgængeligt (for SendGrid til at sende webhooks)

## Sådan fungerer det

1. Du opretter en **Indgående e-mailmonitor** i OneUptime
2. OneUptime genererer en unik e-mailadresse til den pågældende monitor (f.eks. `monitor-abc123@inbound.yourdomain.com`)
3. Når en e-mail sendes til den adresse, modtager SendGrid den og videresender den til OneUptime via webhook
4. OneUptime evaluerer e-mailen mod dine konfigurerede kriterier for at oprette eller løse advarsler

## Opsætningsinstruktioner

### Trin 1: Vælg dit indgående e-maildomæne

Du skal bruge et underdomæne dedikeret til modtagelse af indgående e-mails. Vi anbefaler at bruge et underdomæne som:

- `inbound.yourdomain.com`
- `email.yourdomain.com`
- `monitor.yourdomain.com`

Dette underdomæne bruges udelukkende til OneUptime-monitore-e-mails.

### Trin 2: Konfigurer DNS MX-post

Tilføj en MX-post til din DNS-konfiguration for at dirigere e-mails for dit indgående underdomæne til SendGrid.

| Type | Host/Navn | Prioritet | Værdi           |
| ---- | --------- | --------- | --------------- |
| MX   | inbound   | 10        | mx.sendgrid.net |

**Eksempel:** Hvis dit domæne er `example.com` og du bruger `inbound.example.com`:

```
inbound.example.com.  IN  MX  10  mx.sendgrid.net.
```

**Bemærk:** DNS-ændringer kan tage op til 48 timer at sprede sig, men fuldføres typisk inden for få timer.

### Trin 3: Bekræft domæne i SendGrid (valgfrit men anbefalet)

For bedre levering og for at undgå, at e-mails markeres som spam:

1. Log ind på dit [SendGrid-dashboard](https://app.sendgrid.com)
2. Gå til **Indstillinger** > **Afsenderautentificering**
3. Klik på **Autentificér dit domæne**
4. Følg prompterne for at tilføje de nødvendige DNS-poster (CNAME-poster til DKIM)

### Trin 4: Konfigurer SendGrid Inbound Parse

1. Log ind på dit [SendGrid-dashboard](https://app.sendgrid.com)
2. Naviger til **Indstillinger** > **Inbound Parse**
3. Klik på **Add Host & URL**
4. Konfigurer følgende:

| Felt                                      | Værdi                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| **Modtagerdomæne**                        | Dit indgående underdomæne (f.eks. `inbound.yourdomain.com`)             |
| **Destinations-URL**                      | `https://your-oneuptime-domain.com/incoming-email/sendgrid/YOUR_SECRET` |
| **Kontroller indgående e-mails for spam** | Valgfrit – aktiver, hvis ønsket                                         |
| **Send rå, fuld MIME-meddelelse**         | Lad stå umarkeret (ikke påkrævet)                                       |
| **POST den rå, fulde MIME-meddelelse**    | Lad stå umarkeret (ikke påkrævet)                                       |

5. Klik på **Add**

### Trin 5: Konfigurer OneUptime-miljøvariabler

#### Docker Compose

Tilføj disse miljøvariabler til din `config.env`-fil:

```bash
# Konfiguration af indgående e-mail
INBOUND_EMAIL_PROVIDER=SendGrid
INBOUND_EMAIL_DOMAIN=inbound.yourdomain.com
# INBOUND_EMAIL_WEBHOOK_SECRET=your-optional-secret  # Valgfrit: til yderligere sikkerhed
```

#### Kubernetes med Helm

Tilføj disse til din `values.yaml`-fil:

```yaml
inboundEmail:
  provider: "SendGrid"
  domain: "inbound.yourdomain.com"
  # webhookSecret: "your-optional-secret"  # Valgfrit
```

**Vigtigt:** Genstart din OneUptime-server efter tilføjelse af disse miljøvariabler.

### Trin 6: Opret en Indgående e-mailmonitor

1. Log ind på dit OneUptime-dashboard
2. Naviger til **Monitorer** > **Opret monitor**
3. Vælg **Indgående e-mail** som monitortype
4. Konfigurer din monitor:
   - **Navn:** Giv din monitor et beskrivende navn
   - **Beskrivelse:** Beskriv, hvad denne monitor er til
5. Konfigurer **Advarselsopretnelseskriterier** (hvornår der skal oprettes en advarsel):
   - Eksempel: E-mailemne indeholder "ADVARSEL" eller "KRITISK"
6. Konfigurer **Advarselssolverende kriterier** (hvornår advarslen skal løses):
   - Eksempel: E-mailemne indeholder "LØST" eller "OK"
7. Klik på **Opret**

Efter oprettelse vil du se den unikke e-mailadresse til denne monitor (f.eks. `monitor-abc123def456@inbound.yourdomain.com`).

### Trin 7: Test integrationen

1. Kopiér monitorens e-mailadresse fra OneUptime-dashboardet
2. Send en test-e-mail til den adresse med et emne, der matcher dine advarselskriterier
3. Kontroller OneUptime-dashboardet for at bekræfte:
   - E-mailen er modtaget (synlig i Monitor-oversigt)
   - En advarsel er oprettet (hvis kriterierne matchede)

## Miljøvariabelreference

| Variabel                       | Beskrivelse                                                                                                                                                     | Påkrævet | Standard |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------- |
| `INBOUND_EMAIL_PROVIDER`       | Den indgående e-mailudbyder, der skal bruges                                                                                                                    | Ja       | –        |
| `INBOUND_EMAIL_DOMAIN`         | Det underdomæne, der er konfigureret til indgående e-mails                                                                                                      | Ja       | –        |
| `INBOUND_EMAIL_WEBHOOK_SECRET` | Hemmelighed til validering af webhook-anmodninger. Når indstillet, skal du tilføje denne hemmelighed til webhook-URL'en: `/incoming-email/sendgrid/YOUR_SECRET` | Nej      | –        |

## Understøttede e-mailkriterier

Når du konfigurerer din Indgående e-mailmonitor, kan du oprette kriterier baseret på:

| Felt                | Beskrivelse                            | Tilgængelige filtre                                                                                       |
| ------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **E-mailemne**      | Emnelinjen i e-mailen                  | Indeholder, Indeholder ikke, Er lig med, Er ikke lig med, Starter med, Slutter med, Er tomt, Er ikke tomt |
| **E-mail fra**      | Afsenderens e-mailadresse              | Indeholder, Indeholder ikke, Er lig med, Er ikke lig med, Starter med, Slutter med, Er tomt, Er ikke tomt |
| **E-mailindhold**   | Den rene tekstkrop i e-mailen          | Indeholder, Indeholder ikke, Er lig med, Er ikke lig med, Starter med, Slutter med, Er tomt, Er ikke tomt |
| **E-mail til**      | Modtagerens e-mailadresse              | Indeholder, Indeholder ikke, Er lig med, Er ikke lig med, Starter med, Slutter med, Er tomt, Er ikke tomt |
| **E-mail modtaget** | Tid siden seneste e-mail blev modtaget | Modtaget inden for minutter, Ikke modtaget inden for minutter                                             |

## Eksempel på anvendelsesscenarier

### Advarsler fra ældre systemer

Mange ældre systemer kan kun sende e-mailadvarsler. Opret en Indgående e-mailmonitor til at:

- Oprette OneUptime-advarsler, når det ældre system sender `[KRITISK]`-e-mails
- Løse advarsler, når `[LØST]`-e-mails modtages

### Integration med tredjepartstjenester

Integrer med tjenester, der sender e-mailnotifikationer:

- Overvågningsværktøjer uden API-integrationer
- Cloud-udbydernotifikationer
- Sikkerhedsscanningsværktøjer

### Hjerteslag via e-mail

Brug "E-mail modtaget"-kriterier for at sikre, at du modtager periodiske e-mails:

- Opret advarsel, hvis ingen e-mail modtages inden for 60 minutter
- Nyttigt til overvågning af batchjobs eller planlagte opgaver, der sender afslutnings-e-mails

## Fejlfinding

### E-mails modtages ikke

1. **Kontroller DNS-spredning:**

   ```bash
   dig MX inbound.yourdomain.com
   ```

   Bør returnere `mx.sendgrid.net`

2. **Bekræft SendGrid Inbound Parse-indstillinger:**

   - Log ind på SendGrid-dashboardet
   - Gå til Indstillinger > Inbound Parse
   - Bekræft dit domæne og webhook-URL er korrekte

3. **Kontroller OneUptime-logs:**
   - Se efter webhook-anmodninger i ProbeIngest-servicens logs
   - Kontroller for eventuelle fejlmeddelelser

### Webhooks mislykkes

1. **Sørg for, at OneUptime er offentligt tilgængeligt:**

   - Webhook-URL'en skal være tilgængeligt fra internettet
   - Test med: `curl -X POST https://your-oneuptime-domain.com/incoming-email/sendgrid`

2. **Kontroller firewallregler:**

   - Tillad indgående HTTPS-trafik fra SendGrids IP-intervaller

3. **Bekræft SSL-certifikat:**
   - SendGrid kræver et gyldigt SSL-certifikat
   - Selvsignerede certifikater kan forårsage problemer

### Monitor opretter ikke advarsler

1. **Bekræft kriteriekonfiguration:**

   - Kontroller, at dine advarselsopretnelseskriterier matcher e-mailindholdet
   - Test med nøjagtige strenge inden du bruger mønstermatch

2. **Kontroller monitorstatus:**

   - Sørg for, at monitoren ikke er deaktiveret
   - Bekræft, at monitortypen er "Indgående e-mail"

3. **Gennemgå Monitor-oversigt:**
   - Kontroller, om e-mailen er modtaget og behandlet
   - Gennemgå evalueringsloggene for kriteriematchning

### SendGrid webhook-leveringslogge

For at kontrollere, om SendGrid med succes sender webhooks:

1. Desværre leverer SendGrid ikke detaljerede logge til Inbound Parse
2. Kontroller dine OneUptime-serverlogge for indgående webhook-anmodninger
3. Brug et værktøj som [RequestBin](https://requestbin.com) til midlertidigt at teste webhook-levering

## Bedste sikkerhedspraksis

1. **Brug HTTPS:** Brug altid HTTPS til dit webhook-endpoint
2. **Webhook-hemmelighed:** Konfigurer `INBOUND_EMAIL_WEBHOOK_SECRET` og inkludér det i din webhook-URL (f.eks. `/incoming-email/sendgrid/your-secret`) til yderligere validering
3. **Domæneverifikation:** Bekræft dit domæne i SendGrid for bedre e-mailsikkerhed
4. **Begræns adgang:** Opret kun monitorer til betroede e-mailkilder
5. **Overvåg logs:** Gennemgå regelmæssigt indgående e-maillogge for mistænkelig aktivitet

## Alternative udbydere

OneUptime er designet til at understøtte flere indgående e-mailudbydere. Understøttede i øjeblikket:

| Udbyder             | Status       |
| ------------------- | ------------ |
| SendGrid            | Understøttet |
| Haraka (selvhostet) | Planlagt     |

Hvis du har brug for understøttelse af en anden udbyder, bedes du kontakte os eller indsende en funktionsanmodning.

## Support

Hvis du støder på problemer med SendGrid Inbound Email-integrationen:

1. Kontroller fejlfindingsafsnittet ovenfor
2. Gennemgå OneUptime-logs for detaljerede fejlmeddelelser
3. Kontakt os på [hello@oneuptime.com](mailto:hello@oneuptime.com)

Vi byder feedback til forbedring af denne integration velkommen!
