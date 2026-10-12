# Skift fra Pingdom

**Importér fra et andet værktøj** henter dine Pingdom-oppetidskontroller over i OneUptime på få minutter. Med et skrivebeskyttet Pingdom-API-token læser OneUptime dine kontroller, viser dig, hvad det fandt, og opretter det, du markerer. Intet ændres i Pingdom.

:::cards
- [Importér din konto](#importér-din-pingdom-konto): Opret et token, læs din konto, og markér, hvad der skal overføres.
- [Hvad overføres](#hvad-overføres): Hvilken OneUptime-monitor hver Pingdom-kontrol bliver til.
- [Gør skiftet færdigt](#gør-skiftet-færdigt): Hvad du gør, når importen er færdig.
:::

## Sådan fungerer det

```mermaid title="Fra et Pingdom-API-token til en rapport"
flowchart TB
    key["Skrivebeskyttet<br/>API-token"] --> read["OneUptime læser<br/>din Pingdom-konto"]
    read --> preview["Du ser, hvad der blev fundet,<br/>og markerer, hvad der skal overføres"]
    preview --> import["Importen kører<br/>i baggrunden"]
    import --> report["En rapport linker til<br/>hver oprettet post"]
```

- **Nøglen bruges én gang.** Den opbevares krypteret, mens OneUptime læser din konto, og slettes, så snart læsningen slutter, uanset om den lykkedes. Den vises aldrig igen og skrives aldrig i en log.
- **OneUptime læser kun.** Det kalder kun Pingdoms egen API: `api.pingdom.com`. Pingdom trækker hver anmodning fra tokenets kvote, så OneUptime læser kun en kontrols indstillinger, når den har nogen, én anmodning ad gangen. Når Pingdom beder det om at sætte farten ned, venter det og prøver igen.
- **Intet oprettes, før du starter importen.** Forhåndsvisningen viser for hvert element, om det er nyt, allerede findes i OneUptime (og bruges som det er), er overført af en tidligere import, eller hvorfor det ikke kan overføres.
- **At køre den igen opretter aldrig noget to gange.** OneUptime husker, hvad hver import overførte, ud fra Pingdom-id'et. Kør den igen, når du har tilføjet kontroller i Pingdom, og kun de nye oprettes.

## Før du begynder

- **Et OneUptime-projekt og retten til at oprette det, du overfører.** Projektejere og projektadministratorer kan overføre alt. Andre roller kan også køre en import og overføre de typer poster, de må oprette. Resten vises som ikke overført, med årsagen.
- **Et Pingdom-API-token med Read access.** Importen skriver aldrig til Pingdom.
- **En betalingsmetode, i OneUptime Cloud.** Monitorer, der udfører kontroller, faktureres efter forbrug, også på Free-abonnementet, så tilføj en under **Projektindstillinger** > **Fakturering**, før du importerer. Uden en vises de monitorer som ikke overført.

## Importér din Pingdom-konto

:::steps
### Opret et API-token i Pingdom
Åbn **Settings** > **Pingdom API** i My Pingdom, og vælg **Add API token**. Kald det `OneUptime import`, vælg **Read access**, og kopiér tokenet.

### Åbn importsiden
Gå i OneUptime til **Projektindstillinger** > **Importér fra et andet værktøj**, og vælg **Pingdom**.

### Forbind Pingdom
Indsæt tokenet i **Pingdom-API-nøgle**, og vælg **Læs min Pingdom-konto**. En stor konto tager et par minutter, og du kan forlade siden, mens den læses.

### Markér, hvad der skal overføres
Forhåndsvisningen viser, hvad der blev fundet, med én sektion pr. type. Alt, der ville blive oprettet, er markeret fra start, undtagen kontroller, der er sat på pause i Pingdom. De overføres på pause, hvis du markerer dem. Under hvert element fortæller OneUptime, hvad der ikke overføres præcis, som det var.

### Start importen
Vælg **Start import**. Importen kører i baggrunden: Du kan forlade siden, og rapporten venter på dig der.
:::

Rapporten tæller, hvad der blev oprettet og ikke overført, og viser hvert element med et link til den post, det blev til, fejl først. Tidligere importer står under **Tidligere importer** på samme side.

## Hvad overføres

| I Pingdom | I OneUptime | Hvordan |
| --- | --- | --- |
| Uptime checks | Monitorer | Hver kontrol bliver en monitor af samme type, med samme adresse, interval og den tekst, en side skal eller ikke må indeholde. |

- **HTTP-kontroller** bliver webstedsmonitorer, eller API-monitorer, når de sender data eller headers.
- **Ping- og TCP-kontroller** bliver ping- og portmonitorer. **SMTP-, POP3- og IMAP-kontroller** bliver portmonitorer på deres port: OneUptime kontrollerer, at porten svarer, ikke mailsamtalen.
- **DNS-kontroller** bliver DNS-monitorer, der spørger den samme navneserver.
- **Certifikatkontroller.** En HTTP-kontrol, der regner et udløbende certifikat som nede, får også en SSL-certifikatmonitor, opkaldt efter den, der advarer lige så mange dage før.

Hver monitor kontrolleres fra dit projekts sonder, ligesom en, du selv opretter. Et interval, som OneUptime ikke tilbyder, bliver det nærmeste, det tilbyder, og en timeout på over et minut bliver ét minut. Forhåndsvisningen siger, når et af dem ændres.

## Hvad overføres ikke

- **Oppetidshistorik, svartider og hændelser.** OneUptime begynder at kontrollere, når importen er færdig.
- **Alarmkontakter og integrationer.** Vælg i OneUptime, hvem der får besked, som beskrevet i [Gør skiftet færdigt](#gør-skiftet-færdigt).
- **Adgangskoder og headers, der kan indeholde en hemmelighed.** En monitor, der logger ind eller sender en `Authorization`-, cookie- eller token-header, overføres uden den: Tilføj den med en [monitorhemmelighed](/docs/monitor/monitor-secrets).
- **UDP-, custom HTTP- og transaktionskontroller.** OneUptime har ingen monitor, der gør det samme, og forhåndsvisningen nævner hver enkelt. En [syntetisk monitor](/docs/monitor/synthetic-monitor) kan gå en side igennem, som en transaktionskontrol gør.
- **Den adresse, en DNS-kontrol forventer.** Tilføj den som kriterium i OneUptime.
- **Vedligeholdelsesvinduer.** Forhåndsvisningen tæller dem: Planlæg dem som planlagt vedligeholdelse i OneUptime.

## Grænser

Én import opretter højst 2.000 poster og højst 1.000 monitorer. Alt over en grænse vises som ikke overført. Kør importen igen for at overføre resten.

I OneUptime Cloud kræver monitorer, der udfører kontroller, en betalingsmetode, og det, dit abonnement ikke har plads til, vises som ikke overført, med det, det kræver.

En forhåndsvisning gemmes i en dag. Kun den person, der læste kontoen, kan markere elementer og starte importen. Projektejere og projektadministratorer ser forløbet og rapporten for hver import.

## Gør skiftet færdigt

:::steps
### Tjek dine monitorer
Åbn hver enkelt under **Monitorer**, og tjek de første resultater. En heartbeat-monitor har en ny adresse: Peg det job, der kalder den, derhen.

### Vælg, hvem der får besked
Tilføj ejere til dine monitorer eller en vagtpolitik under **Vagtordning** > **Vagtpolitikker** til de hændelser, de åbner, så de rigtige personer får besked, når noget går ned.

### Slå kontrollerne fra i Pingdom
Når OneUptime kontrollerer de samme ting, så sæt dem på pause i Pingdom, så ingen får besked to gange.
:::

## Fejlfinding

:::details Pingdom accepterede ikke API-nøglen
Tjek, at du kopierede hele tokenet, og at det er et API 3.1-token fra **Pingdom API** med **Read access**. Vælg derefter **Prøv igen**.
:::

:::details En monitor vises som ikke overført
Der står hvorfor: en type monitor, som OneUptime ikke har, en adresse, som OneUptime ikke kan læse, eller et projekt uden plads eller betalingsmetode til den. En monitor, som OneUptime allerede kører med samme navn, type og adresse, bruges, som den er.
:::

:::details Nogle elementer kan ikke markeres
Ved hvert står der hvorfor: et navn, projektet allerede har, noget, en tidligere import har overført, eller en post, du ikke må oprette, eller som dit abonnement ikke omfatter.
:::

## Næste trin

:::cards
- [Websted-monitor](/docs/monitor/website-monitor): Hvad en webstedsmonitor kontrollerer, og hvordan.
- [Port-monitor](/docs/monitor/port-monitor): Hvad en portmonitor kontrollerer, og hvordan.
- [Skift fra StatusCake](/docs/moving-to-oneuptime/statuscake): Hent dine kontroller over fra StatusCake.
:::
