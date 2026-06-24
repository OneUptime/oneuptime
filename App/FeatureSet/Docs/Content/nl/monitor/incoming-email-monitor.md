# Inkomend e-mail-monitor

Met de Inkomend e-mail-monitor kunt u meldingen aanmaken en oplossen op basis van e-mails die worden verzonden naar unieke, monitorspecifieke e-mailadressen. Dit is nuttig voor integratie met verouderde systemen, externe meldingstools of elke dienst die e-mailmeldingen kan versturen.

## Hoe het werkt

1. Wanneer u een Inkomend e-mail-monitor aanmaakt, genereert OneUptime een uniek e-mailadres voor die monitor
2. Elke e-mail die naar dat adres wordt verzonden, wordt ontvangen en geëvalueerd aan de hand van uw geconfigureerde criteria
3. Op basis van de criteria kan OneUptime nieuwe meldingen aanmaken of bestaande oplossen

Dit is een krachtige manier om e-mailgebaseerde meldingssystemen te integreren met de incidentbeheerworkflow van OneUptime.

## Een Inkomend e-mail-monitor aanmaken

1. Navigeer naar **Monitors** in uw OneUptime-dashboard
2. Klik op **Monitor aanmaken**
3. Selecteer **Inkomend e-mail** als het monitortype
4. Configureer de monitorinstellingen:
   - **Naam:** Een beschrijvende naam voor uw monitor
   - **Beschrijving:** Waarvoor deze monitor dient
5. Stel uw **Criteria voor het aanmaken van meldingen** in (voorwaarden die meldingen aanmaken)
6. Stel uw **Criteria voor het oplossen van meldingen** in (voorwaarden die meldingen oplossen)
7. Klik op **Aanmaken**

Na aanmaak ziet u het unieke e-mailadres voor deze monitor weergegeven op de monitordetailpagina.

## Format van e-mailadres

Elke Inkomend e-mail-monitor krijgt een uniek e-mailadres in het formaat:

```
monitor-{secret-key}@{inbound-domain}
```

Bijvoorbeeld: `monitor-abc123def456@inbound.yourdomain.com`

U kunt dit adres kopiëren van de monitordetailpagina en uw externe systemen configureren om e-mails ernaartoe te sturen.

## Beschikbare criteriumvelden

U kunt criteria aanmaken op basis van de volgende e-mailvelden:

| Veld                 | Beschrijving                                                      |
| -------------------- | ----------------------------------------------------------------- |
| **E-mailonderwerp**  | De onderwerpregel van de inkomende e-mail                         |
| **E-mail van**       | Het e-mailadres van de afzender                                   |
| **E-maillichaam**    | De gewone tekstinhoud van het e-maillichaam                       |
| **E-mail naar**      | Het e-mailadres van de ontvanger                                  |
| **E-mail ontvangen** | Op tijd gebaseerde criteria voor wanneer e-mails worden ontvangen |

## Beschikbare filtertypen

### Tekenreeksfilters (Onderwerp, Van, Lichaam, Naar)

| Filter              | Beschrijving                                   | Voorbeeld                            |
| ------------------- | ---------------------------------------------- | ------------------------------------ |
| **Bevat**           | Veld bevat de opgegeven tekst                  | Onderwerp bevat "KRITIEK"            |
| **Bevat niet**      | Veld bevat de opgegeven tekst niet             | Onderwerp bevat niet "TEST"          |
| **Gelijk aan**      | Veld komt exact overeen met de opgegeven tekst | Van gelijk aan "meldingen@dienst.nl" |
| **Niet gelijk aan** | Veld komt niet overeen                         | Onderwerp niet gelijk aan "OK"       |
| **Begint met**      | Veld begint met de opgegeven tekst             | Onderwerp begint met "[MELDING]"     |
| **Eindigt met**     | Veld eindigt met de opgegeven tekst            | Onderwerp eindigt met "- Productie"  |
| **Is leeg**         | Veld is leeg of blanco                         | Lichaam is leeg                      |
| **Is niet leeg**    | Veld heeft inhoud                              | Onderwerp is niet leeg               |

### Op tijd gebaseerde filters (E-mail ontvangen)

| Filter                        | Beschrijving                           | Voorbeeld                           |
| ----------------------------- | -------------------------------------- | ----------------------------------- |
| **Ontvangen in minuten**      | E-mail werd ontvangen binnen X minuten | E-mail ontvangen in 30 minuten      |
| **Niet ontvangen in minuten** | Geen e-mail ontvangen in X minuten     | E-mail niet ontvangen in 60 minuten |

## Voorbeeldconfiguraties

### Voorbeeld 1: Melding aanmaken bij kritieke e-mails

**Criteria voor het aanmaken van meldingen:**

- E-mailonderwerp **bevat** "KRITIEK"
- OF E-mailonderwerp **bevat** "MELDING"
- OF E-mailonderwerp **bevat** "FOUT"

**Criteria voor het oplossen van meldingen:**

- E-mailonderwerp **bevat** "OPGELOST"
- OF E-mailonderwerp **bevat** "OK"
- OF E-mailonderwerp **bevat** "HERSTELD"

### Voorbeeld 2: Specifieke afzender bewaken

**Criteria voor het aanmaken van meldingen:**

- E-mail van **gelijk aan** "monitoring@verouderd-systeem.nl"
- EN E-mailonderwerp **bevat** "Mislukt"

**Criteria voor het oplossen van meldingen:**

- E-mail van **gelijk aan** "monitoring@verouderd-systeem.nl"
- EN E-mailonderwerp **bevat** "Geslaagd"

### Voorbeeld 3: Heartbeat-monitor (geen e-mail = melding)

**Criteria voor het aanmaken van meldingen:**

- E-mail ontvangen **Niet ontvangen in minuten** met waarde `60`

Dit maakt een melding aan als er 60 minuten geen e-mail wordt ontvangen — nuttig voor het bewaken van geplande taken of batchprocessen die voltooiings-e-mails moeten sturen.

**Criteria voor het oplossen van meldingen:**

- E-mail ontvangen **Ontvangen in minuten** met waarde `5`

Dit lost de melding op wanneer een e-mail wordt ontvangen.

## Gebruiksscenario's

### Integratie met verouderde systemen

Veel oudere systemen ondersteunen alleen e-mailgebaseerde meldingen. Gebruik de Inkomend e-mail-monitor om:

- E-mailmeldingen om te zetten in OneUptime-incidenten
- Incidenten automatisch op te lossen wanneer herstel-e-mails binnenkomen
- Meldingen van meerdere verouderde systemen te centraliseren

### Bewaken van externe diensten

Integreer met diensten die e-mailmeldingen versturen:

- Cloudprovider-meldingen (AWS, GCP, Azure)
- Beveiligingsscan-tools
- Meldingen over voltooiing van back-ups
- Waarschuwingen over verlopen SSL-certificaten

### Bewaken van geplande taken

Batch-taken en geplande processen bewaken:

- Meldingen aanmaken als voltooiings-e-mails niet op tijd worden ontvangen
- Taakfouten bijhouden via foutmeldings-e-mails
- Voltooiingen van datapijplijnen bewaken

### Aggregatie van meldingen van meerdere leveranciers

Meldingen van meerdere monitoringtools consolideren:

- Meldingen ontvangen van Nagios, Zabbix of andere tools via e-mail
- Incidentbeheer in OneUptime centraliseren
- Één bron van waarheid bijhouden voor alle meldingen

## Sjabloonvariabelen

Bij het configureren van incidentsjablonen kunt u deze variabelen van inkomende e-mails gebruiken:

| Variabele             | Beschrijving                          |
| --------------------- | ------------------------------------- |
| `{{emailSubject}}`    | Het onderwerp van de ontvangen e-mail |
| `{{emailFrom}}`       | Het e-mailadres van de afzender       |
| `{{emailTo}}`         | Het e-mailadres van de ontvanger      |
| `{{emailBody}}`       | De gewone tekstinhoud van de e-mail   |
| `{{emailReceivedAt}}` | Wanneer de e-mail werd ontvangen      |

## Monitorsamenvattingsweergave

De monitorsamenvatting toont:

- **Laatste e-mail ontvangen op:** Wanneer de meest recente e-mail werd ontvangen
- **Van:** De afzender van de laatste e-mail
- **Onderwerp:** De onderwerpregel van de laatste e-mail
- **E-mailheaders:** Volledige headers van de laatste e-mail (uitvouwbaar)
- **E-maillichaam:** Inhoud van de laatste e-mail (uitvouwbaar)

## Instelling voor zelf-gehoste omgevingen

Als u OneUptime zelf host, moet u een inbound e-mailprovider configureren. Momenteel ondersteund:

- **SendGrid Inbound Parse** - Zie [SendGrid Inbound E-mail integratie](/docs/self-hosted/sendgrid-inbound-email) voor installatie-instructies

## Aandachtspunten

- **Beveiliging van e-mailadres:** Het e-mailadres van de monitor bevat een geheime sleutel. Behandel het als een wachtwoord en deel het niet openbaar.
- **E-mailgrootte:** Zeer grote e-mails (met grote bijlagen) kunnen worden afgekapt of geweigerd door de e-mailprovider.
- **Verwerkingstijd:** E-mails worden asynchroon verwerkt. Er kan een paar seconden vertraging zijn tussen het verzenden van een e-mail en het aanmaken van een melding.
- **Hoofdletterongevoeligheid:** Alle tekenreeksvergelijkingen (Bevat, Gelijk aan, enz.) zijn hoofdletterongevoelig.
- **Gewone tekst:** E-maillichaamcriteria gebruiken de gewone tekstversie van de e-mail. HTML-opmaak wordt verwijderd.

## Probleemoplossing

### E-mails worden niet ontvangen

1. Controleer of het e-mailadres correct is (controleer op typefouten)
2. Controleer of de e-mail wordt geblokkeerd door spamfilters
3. Controleer of uw inbound e-mailprovider correct is geconfigureerd
4. Controleer de OneUptime-logboeken op foutmeldingen

### Meldingen worden niet aangemaakt

1. Controleer of uw criteria overeenkomen met de e-mailinhoud
2. Controleer of de monitor niet is uitgeschakeld
3. Bekijk de evaluatielogboeken in de monitordetails
4. Test eerst met exacte tekenreeksovereenkomsten voordat u patroonmatching gebruikt

### Meldingen worden niet opgelost

1. Controleer of uw oploosingscriteria overeenkomen met de herstel-e-mail
2. Zorg dat er een actieve melding is om op te lossen
3. Controleer of de oplossings-e-mail naar hetzelfde monitoradres wordt gestuurd
