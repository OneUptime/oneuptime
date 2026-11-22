# Cloudflare

Importer det [Cloudflare](https://www.cloudflare.com)s brannmur gjorde ved kanten til sikkerhetshendelsene i OneUptime: forespørslene som de administrerte og egne WAF-reglene, hastighetsbegrensningen, IP Access Rules, botadministrasjonen og HTTP-DDoS-beskyttelsen blokkerte, utfordret eller logget. Hver av dem står ved siden av appens egne forespørsler, så en sak sier hva Cloudflare stoppet og hva som likevel nådde appen din. OneUptime leser dem med et API-token som bare kan lese, og endrer ingenting i Cloudflare med mindre du slår på blokkering, som håndhever blokkeringslisten din der.

:::cards
- [Sett opp tilkoblingen](#sett-opp-tilkoblingen): Et API-token med to lesetillatelser, og skjemaet til tilkoblingen.
- [Hva som importeres](#hva-som-importeres): Hvilke hendelser, og hvordan hver blir en sikkerhetshendelse.
- [Slik fungerer polling](#slik-fungerer-polling): Vinduet hver henting leser, og hvorfor det overlapper med 10 minutter.
- [Blokker adresser hos Cloudflare](#blokker-adresser-hos-cloudflare): Blokkeringslisten din, håndhevet med to IP-lister og én egendefinert regel per liste.
- [Feilsøking](#feilsøking): Hva hver feil betyr, og hva du skal endre.
:::

## Slik fungerer det

```mermaid title="Fra en forespørsel Cloudflare handlet på, til en sikkerhetshendelse"
flowchart TB
    edge["Cloudflares brannmur<br/>handler på en<br/>forespørsel"] --> poll["OneUptime henter<br/>i tilkoblingens<br/>intervall"]
    poll --> zones["Den leser hver<br/>sones brannmur-<br/>hendelser siden<br/>sist"]
    zones --> event["Hver lagres som<br/>en HTTP Activity-<br/>hendelse"]
```

Hvert minutt henter OneUptime fra hver aktiverte tilkobling der henteintervallet har gått. En henting lister kontoens soner, leser i settings-noden til GraphQL Analytics API hva abonnementet til hver sone tillater, og leser hver sones brannmurhendelser siden forrige henting fra datasettet `firewallEventsAdaptive` ([Security Events](https://developers.cloudflare.com/waf/analytics/security-events/)), de eldste først. Hver hendelse lagres som en [OCSF](https://schema.ocsf.io/)-hendelse av typen HTTP Activity.

## Før du begynner

- I OneUptime rollen Prosjekteier, Prosjektadministrator eller Sikkerhetsadministrator. Sikkerhetsmedlem og Sikkerhetsleser kan se tilkoblinger og kjøringshistorikken deres, men ikke endre dem.
- En Cloudflare-bruker som kan opprette API-tokener for kontoens soner.
- Soner der trafikken går gjennom Cloudflare: DNS-postene deres er proxied.
- Utgående HTTPS fra OneUptime-appen og workerne til `api.cloudflare.com`.

## Sett opp tilkoblingen

Tilkoblingen leser med et [API-token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/), aldri med en Global API Key: et token er begrenset til kontoen og sonene, og du kan tilbakekalle det for seg. Det trenger to [tillatelser](https://developers.cloudflare.com/fundamentals/api/reference/permissions/), begge bare for lesing:

| Tillatelse | Hva OneUptime leser med den |
| --- | --- |
| `Zone > Zone > Read` | Sonene, med kontoer og abonnementer. |
| `Zone > Analytics > Read` | Brannmurhendelsene til hver sone, gjennom GraphQL Analytics API. |

:::steps
### Opprett et API-token

1. Åpne **My Profile → API Tokens** i Cloudflare-dashbordet, velg **Create Token**, og velg **Create Custom Token**.
2. Kall det `oneuptime-security-events`. Legg til `Zone > Zone > Read` og `Zone > Analytics > Read` under **Permissions**.
3. Ta med alle kontoens soner under **Zone Resources**, eller sonene som skal importeres.
4. Velg **Continue to summary**, så **Create Token**, og kopier tokenet. Cloudflare viser det bare én gang.

### Legg til tilkoblingen i OneUptime

Åpne **Produkter → Sikkerhetshendelser → Tilkoblinger** (`/dashboard/{projectId}/security-events/connections`), klikk på **Legg til tilkobling**, velg **Cloudflare** under **Skysikkerhet**, og klikk på **Neste**. Lim inn tokenet i **API-token**. OneUptime lister deretter kontoene og sonene tokenet kan lese: velg **Konto**, og la **Alle soner** stå under **Soner**, eller velg sonene som skal importeres.

### Test den før du lagrer

Klikk på **Test disse innstillingene** under **Test før du lagrer**. Testen sjekker hver tillatelse med verdiene i skjemaet, nevner den som mangler, og lagrer ingenting. Klikk deretter på **Neste**, gi tilkoblingen et **Navn**, og opprett den.
:::

| Innstilling | Hva du skal skrive inn |
| --- | --- |
| **Konto** | Cloudflare-kontoen som skal leses, valgt blant kontoene API-tokenet ditt leser. Et token som leser én konto, velger den for deg. |
| **Soner** | Valgfritt. Tomt leser hver aktive sone i kontoen, også soner som legges til senere. Én tilkobling leser høyst 50 soner. |
| **API-token** | Bare tokenet, uten `Bearer`. Det krypteres, returneres aldri av API-et og vises aldri igjen. Erstatt det med **Oppdater påloggingsinformasjon** på tilkoblingen. |

Trinnet **Henting** har også en valgfri **Beskrivelse**, **Henteintervall (minutter)**, et heltall fra `1` til `1440` som starter på `5`, og **Aktivert**, som starter slått på. Cloudflares hendelser er forespørsler, ikke varsler, så skjemaet spør ikke om **Åpne saker fra**: saker kommer fra deteksjonsreglene som leser dem.

### Skrivetilgang er et eget valg

Denne tilkoblingen endrer ingenting i Cloudflare før du slår på blokkering på raden dens. Først da ber OneUptime om skrivetillatelser, og det sjekker dem før det blokkerer noe: [Blokker adresser hos Cloudflare](#blokker-adresser-hos-cloudflare) nevner hver av dem og hva den brukes til. Legg dem til i tokenet først når du slår på blokkering.

## Hva som importeres

Hver hendelse har leverandøren `Cloudflare` og produktet `Cloudflare WAF`, og er en hendelse av typen HTTP Activity (`4002`).

| Cloudflares felt | I sikkerhetshendelsen |
| --- | --- |
| `clientIP` | Principal-IP-en og `client.address` |
| `clientRequestHTTPHost`, `clientRequestPath`, `clientRequestQuery` | Målverten, målressursen (stien og spørringen) og `url.original` |
| `clientRequestHTTPMethodName`, `userAgent` | Aktiviteten, `http.request.method` og `user_agent.original` |
| `action` | Statusen og `oneuptime.edge.action` |
| `source`, `ruleId`, `description` | Regel-ID-en, regelnavnet og `cloudflare.source` |
| `rayName`, `clientCountryName`, `clientAsn` | `cloudflare.ray_id`, `cloudflare.client.country` og `cloudflare.client.asn` |
| `sampleInterval` | `oneuptime.edge.sample_interval` |

| Hva Cloudflare gjorde | Status | `oneuptime.edge.action` | Utfallet av forespørselen | Alvorlighetsgrad |
| --- | --- | --- | --- | --- |
| Blokkerte, lukket tilkoblingen, eller en utfordring mislyktes | Blocked, eller Dropped for en lukket tilkobling | `blocked` | Rejected | Low |
| Svarte med en administrert, JS- eller interaktiv utfordring | Challenge | `challenged` | Rejected | Low |
| En bestått utfordring, eller en besøkende som allerede hadde bestått en | Allowed | `passed-challenge` | Ingen | Informational |
| Logget den og slapp den gjennom | Logged | `logged` | Statuskoden fra opprinnelsen | Medium; High når opprinnelsen feilet; Low når den avviste forespørselen |
| Slapp den gjennom på en av dine skip- eller allow-regler | Allowed | `let-through` | Statuskoden fra opprinnelsen | Som for en logget forespørsel |

En forespørsel som en av dine egne skip- eller allow-regler slapp gjennom, importeres bare når den inneholder et angrep (SQL-injeksjon, path traversal eller et Log4Shell-oppslag), eller når Cloudflares WAF attack score regner den som et. Resten er trafikk du tillater med vilje, som monitorene dine: hver kjøring teller den og utelater den.

Cloudflare tar utvalg av hendelsene til en travel sone. Hver hendelse beholder utvalgsintervallet sitt, antallet lignende forespørsler den står for, og hvert antall OneUptime lager av dem sier *omtrent*.

Hendelsene vises under Hendelser, under Kampanjer (angrepsforespørsler etter adresse), i enhetsrisiko og i deteksjonsregler. En sak om en adresse viser under **Ved kanten** i påvirkningen hva Cloudflare gjorde med forespørslene fra adressen, ved siden av det som nådde appen din. Regelbibliotekets Cloudflare-regler leser dem slik de importeres her: mange treff på administrerte regler fra én adresse, en adresse som besto en utfordring og så sendte angrep, og et angrep Cloudflare slapp gjennom som nådde appen din.

## Abonnementsgrenser

Hvert abonnement har brannmurhendelser gjennom API-et. **What each zone's plan gives** i **Test tilkoblingen** leser grensene til hver sone hos Cloudflare.

| Abonnement | Free | Pro | Business | Enterprise |
| --- | --- | --- | --- | --- |
| Lagrede brannmurhendelser | 31 dager | 31 dager | 31 dager | 31 dager |
| Lengste spørring | 30 dager | 30 dager | 30 dager | 31 dager |

Cloudflares Logpush kan også sende brannmurhendelser, på hvert abonnement siden 30. september 2026, priset etter bruk. Denne tilkoblingen henter i stedet, så den trenger ingenting utover de to lesetillatelsene.

## Slik fungerer polling

- **Hendelser leses etter når de skjedde ved kanten.** Analysedataene til Cloudflare kan spørres et minutt eller to etter forespørselen.
- **Den første pollen ser 24 timer tilbake**, slik at en ny tilkobling viser de nylige hendelsene sine med en gang.
- **Hver senere henting starter 10 minutter før den lagrede markøren**, så en hendelse Cloudflare gjør lesbar sent, leses ved neste henting, og duplikater forkastes på Ray ID-en til hver hendelse i prosjektet.
- **En poll leser høyst 24 timer forbi markøren.** En tilkobling der markøren har kommet på etterskudd, tar igjen i en rekke vinduer på 24 timer.
- **Sonene leses etter tur**, én side med opptil 2 000 hendelser hver, så en travel sone ikke kan bruke opp en henting før en rolig er lest.
- **Cloudflares hastighetsgrenser overholdes.** Cloudflare tillater 1 200 REST-forespørsler og 300 GraphQL-spørringer på fem minutter. En `429` som ber om å vente 30 sekunder eller mindre, ventes ut og spørres igjen; en lengre stopper hentingen, og den neste fortsetter.
- **En sone tokenet ikke kan lese, holder ingenting igjen.** De andre sonene importeres, kjøringen er **Delvis**, og advarselen nevner sonen. Gi tokenet `Zone > Analytics > Read` der, og bruk så **Importer dette tidsrommet** for å hente inn vinduet.
- **En mislykket kjøring endrer ingenting.** Etter en nettverksfeil, eller en feilstatus fra Cloudflare, blir markøren og vinduets lengde som de var, og neste henting leser det samme vinduet igjen. Det eneste unntaket er en forespørsel som fikk tidsavbrudd: markøren blir, men neste vindu er halvparten så langt, siden et vindu som er for tungt til å svare i tide, ville få tidsavbrudd ved hvert forsøk.

### Når et vindu inneholder mer enn én poll kan lese

En henting sender høyst 120 forespørsler, leser høyst 20 000 hendelser og stopper etter 4 minutter. Hendelser leses de eldste først, så når et budsjett stopper en henting, er kjøringen **Delvis**, og neste henting fortsetter fra den eldste hendelsen de uferdige sonene ble lest til. Når ikke hver sone kunne leses én gang, gjør OneUptime i stedet vinduet kortere:

1. **Snevre inn.** Neste henting leser et vindu som er halvparten så langt, fra samme startpunkt, og halverer igjen til et vindu leses helt, ned til ett minutt. Advarselen til kjøringen sier det: `This window holds more records than one poll can read; the next poll reads a {n} minute window from the same starting point.` Hendelser som allerede er importert fra det lengre vinduet, hoppes over som duplikater.
2. **Vokse igjen.** Når et vindu er lest helt, flyttes markøren til slutten av det, og det neste vinduet er igjen dobbelt så langt, opptil 24 timer.
3. **Gå forbi ett enkelt minutt.** Hvis selv ett minutt inneholder mer enn en henting kan lese, går hentingen forbi det, så nyere hendelser fortsetter å komme. Kjøringen forblir **Delvis**, og **Siste feil** lyder `More records were created in the one minute from {cursor} to {end} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.` Importer det minuttet med **Importer dette tidsrommet** for å hente inn det én kjøring kan lese.

Å endre **Henteintervall (minutter)** endrer ingenting av dette: det avgjør hvor ofte en poll starter, ikke hvor vinduet begynner.

### Kjør, forhåndsvis og importer ved behov

Klikk på **Diagnostikk** på en tilkobling for å se de siste kjøringene og arbeide med den manuelt. Alle som kan endre tilkoblingen, kan starte disse handlingene; alle som kan se den, kan lese historikken.

- **Kjør nå** starter en poll med en gang, med den vanlige markøren, også når tilkoblingen ikke er **Aktivert**.
- **Forhåndsvis brannmurhendelser** leser et tidsrom på opptil 7 dager og importerer ingenting.
- **Importer dette tidsrommet** importerer et tidsrom på opptil 7 dager etter at du bekrefter, uten å flytte markøren. Hendelser som allerede er importert, hoppes over. Cloudflare lagrer brannmurhendelser i 31 dager.
- **Kopier diagnostikk** på en kjøring kopierer rapporten for brukerstøtte. Den inneholder aldri legitimasjon.

## Test tilkoblingen

**Test tilkoblingen** på raden til en tilkobling og **Test disse innstillingene** i skjemaet kjører i API-prosessen, ikke i en bakgrunnsworker, slik at en test også svarer når det er workerne som er problemet. Den kjører disse kontrollene i rekkefølge:

| Kontroll | Hva den kontrollerer |
| --- | --- |
| **Konfigurasjon** | Tokenet, kontoen og sonene er velformede. Ingenting kontaktes når dette feiler. |
| **Verify the API token** | Cloudflare godtar tokenet, en brukers eller et som kontoen eier, og det er aktivt. Et som utløper innen 14 dager, er en advarsel. |
| **List the zones** | Tokenet har `Zone > Zone > Read`: det lister kontoens soner, og hver valgte sone. |
| **Read firewall events** | Tokenet har `Zone > Analytics > Read` på hver sone. En feil nevner sonene den mangler på. |
| **What each zone's plan gives** | Hvor lenge abonnementet til hver sone lagrer brannmurhendelser, og hvor lang én spørring kan være. En sone der abonnementet ikke har noen, er en advarsel. |
| **Firewall events available to import** | Omtrent hvor mange hendelser de siste 24 timene og de siste 7 dagene inneholder. Ingen er en advarsel. |
| **Background workers**, **Poll scheduler**, **Security event storage** | OneUptimes egen side: en prosess tar jobbene fra Worker-køen, poll-jobben kjører hvert minutt, og lageret for sikkerhetshendelser svarer. |
| **Planlagt henting** | For en lagret tilkobling: polling er slått på, ingen kjøring sitter fast og venter på en worker, og poller kjører i tide. |

Hver forespørsel i en test har en frist på 20 sekunder. En test importerer aldri noe og flytter aldri markøren, og hver kontroll som mislykkes, sier hva du skal endre.

## Blokker adresser hos Cloudflare

Med blokkering slått på håndhever Cloudflare [blokkeringslisten](/docs/telemetry/security-cases#blokkeringsliste) til prosjektet ditt. Hver adresse du blokkerer, havner innen ett minutt på en IP-liste i Cloudflare-kontoen din, og i hver sone blokkerer én egendefinert regel per liste adressene listen inneholder, eller gir dem en utfordring. På **Blokkeringsliste** nevner **Håndhevet hos** Cloudflare for hver blokkering OneUptime har lest tilbake fra Cloudflare; en blokkering som ikke er lest tilbake innen 10 minutter, håndheves ikke der. Blokkeringstrinnet i en sak sier da også hvor mange av adressens forespørsler Cloudflare har stoppet siden blokkeringen.

Blokkering trenger skrivetillatelser på API-tokenet til tilkoblingen:

| Tillatelse | Hva OneUptime gjør med den |
| --- | --- |
| `Account > Account Filter Lists > Edit` | Lager sine to lister, og legger til og fjerner adressene deres. |
| `Zone > Zone WAF > Edit`, på hver sone det skal blokkeres i | Legger til sine egendefinerte regler, og leser sonens egne. |
| `Account > Account Firewall Access Rules > Edit` | Legger til og fjerner IP Access Rules, på en plan uten en ledig liste eller en ledig egendefinert regel. |

:::steps
### Gi tokenet skrivetillatelser

Åpne **My Profile → API Tokens** i Cloudflare, rediger tokenet til tilkoblingen, og legg til tillatelsene over. Eller lag et token som har dem og de to lesetillatelsene.

### Slå på blokkering

Velg **Blokker adresser** på raden til tilkoblingen. Lim inn et nytt token i **Nytt API-token**, eller la feltet stå tomt for å beholde det gjeldende, og la **Alle soner** stå i **Soner**, eller velg sonene det skal blokkeres i. **Sjekk tillatelser** spør Cloudflare om tokenet har hver tillatelse, og endrer ingenting. **Slå på blokkering** slår bare på blokkering når hver sjekk består, og OneUptime setter opp Cloudflare innen ett minutt.
:::

Mens blokkering er slått på, kjører **Test tilkoblingen** de samme sjekkene: **How blocking is set up**, **Edit the lists**, **Edit custom rules in each zone** og, der IP Access Rules brukes, **Edit IP Access Rules**.

### Hva OneUptime legger til i Cloudflare

| I Cloudflare | Hva det er |
| --- | --- |
| Listene `oneuptime_block` og `oneuptime_challenge` | To IP-lister i kontoen, én for blokkeringer og én for utfordringer. Beskrivelsen deres nevner OneUptime-prosjektet ditt. |
| Én egendefinert regel per liste, i hver sone | `(ip.src in $oneuptime_block)` med handlingen Block, og `(ip.src in $oneuptime_challenge)` med handlingen Managed Challenge. Beskrivelsen deres sier at OneUptime administrerer dem. |
| Ett listeelement per blokkering | Kommentaren nevner saken og når blokkeringen slutter, for eksempel `OneUptime case CASE-42 until 2026-11-21 10:42 UTC`. |

Hver regel kommer først blant sonens egendefinerte regler, så den kjører før dine: En Skip-regel fra deg kan ikke slippe en blokkert adresse forbi den. Når Skip-reglene dine slipper adresser gjennom, for eksempel monitorene dine eller en partners, nevner **Blokkeringsstatus** dem. **Beskytt disse adressene** legger dem til i **Beskyttede entiteter**, som ingen kan blokkere.

### Plangrenser for blokkering

| Abonnement | Free | Pro | Business | Enterprise |
| --- | --- | --- | --- | --- |
| Lister i kontoen | 1 | 10 | 10 | 1 000 |
| Listeelementer i kontoen | 10 000 | 10 000 | 10 000 | 500 000 |
| Egendefinerte regler i en sone | 5 | 20 | 100 | 1 000 |

Dine egne lister og regler teller også. Når du slår på blokkering, tar hver handling en liste, og en regel i hver sone, der planen har dem ledige, Block først; der ikke, tar den IP Access Rules. På en Free-plan der den ene listen er ledig, tar blokkeringer listen og utfordringer IP Access Rules. En konto rommer 50 000 IP Access Rules, hver en adresse, et IPv4-område på /16 eller /24 eller et IPv6-område på /32, /48 eller /64: En blokkering av et annet område håndheves ikke der, og **Blokkeringsliste** sier hvorfor. **How blocking is set up** sier hva hver handling tar, og hvorfor.

### Når noen endrer en regel

OneUptime leser listene og reglene sine tilbake hvert 3. minutt, og angrer aldri en endring noen har gjort i Cloudflare. En regel som er slått av, slettet eller endret der, vises på raden til tilkoblingen og i **Blokkeringsstatus**, med sonen sin, og **Blokkeringsliste** viser blokkeringene til den sonens regel som ikke håndhevet hos Cloudflare. **Gjenopprett** setter opp regelen igjen. Så lenge **Soner** står på **Alle soner**, settes en sone som legges til i kontoen senere, opp av seg selv.

### Slå av blokkering

**Slå av blokkering** spør om listene og reglene til OneUptime skal fjernes fra Cloudflare, med **Fjern OneUptimes lister og regler fra Cloudflare** valgt. Fjerningen tar bort reglene til OneUptime, de to listene og IP Access Rules det har lagt til, funnet ut fra navnene, referansene og notatene det ga dem, og ingenting annet. Beholdes de, blir de i Cloudflare og fortsetter å blokkere det de inneholder. En tilkobling som blokkerer adresser, kan ikke slettes: Slå av blokkering først, og slett den når fjerningen er ferdig.

## Feilsøking

**Siste feil** for tilkoblingen beholder hele feilmeldingen, med påloggingsinformasjon skjult. Når en tilkobling har en feil, velger du **Vis feil** i kolonnen **Handlinger** for å lese den, og **Kopier feil** i dialogen for å kopiere den. Hver melding nevner forespørselen som feilet, og siterer Cloudflares egen begrunnelse.

:::details Siste feil lyder `Invalid API Token (1000)`
Cloudflare kjenner ikke tokenet: det ble slettet, fornyet eller aldri limt inn helt. En Global API Key avvises før den sendes. Opprett et token som over, og lagre det med **Oppdater påloggingsinformasjon**.
:::

:::details Siste feil lyder `Unauthorized to access requested resource (9109)`
Tokenet kan ikke liste soner. Gi det `Zone > Zone > Read`, med sonene som skal importeres under **Zone Resources**.
:::

:::details Siste feil lyder `cannot read the analytics of`
Tokenet mangler `Zone > Analytics > Read` på sonene meldingen nevner. Legg den til der, og bruk så **Importer dette tidsrommet** for å hente inn det som ikke ble importert.
:::

:::details Siste feil lyder `rate limit`
Noe annet som bruker den samme Cloudflare-brukeren, har brukt opp kvoten. Hentingen fortsetter av seg selv når de fem minuttene er over; gi OneUptime et token fra en egen bruker for å holde kvoten adskilt.
:::

:::details Siste feil sier `did not complete`
Forespørselen fikk ikke noe svar: et tidsavbrudd, et navn som ikke kan slås opp, eller en avvist adresse. Sjekk at OneUptime-appen og workerne når `api.cloudflare.com`, gjennom en eventuell proxy du bruker.
:::

:::details En sak viser Cloudflares handlinger, men ingen av adressens forespørsler i appen din
Bak Cloudflare kommer forespørslene til appen din fra adressene til Cloudflare, og besøkerens adresse er den siste Cloudflare legger til i `X-Forwarded-For`. Registrer den headeren (`http.request.header.x-forwarded-for`) og tilkoblingens egen adresse (`network.peer.address`) i tracene dine. Så lenge denne tilkoblingen finnes, stoler OneUptime på adressene til Cloudflare som proxy, så det leser besøkeren fra headeren og kobler forespørslene til appen din til adressen Cloudflare handlet på. En `client.address` som appen din kopierer fra `CF-Connecting-IP`, stoles det ikke på: Alle som når appen din direkte, kan sende den headeren.
:::

:::details Blokkeringsstatus sier `already exists in this Cloudflare account`
Et annet OneUptime-prosjekt, eller en person, har laget en liste med navnet `oneuptime_block` eller `oneuptime_challenge`, og OneUptime endrer aldri en liste det ikke har laget for dette prosjektet. Gi listen nytt navn eller slett den i Cloudflare, eller slå av blokkering i prosjektet som laget den. OneUptime setter opp blokkering igjen innen 5 minutter.
:::

:::details Testen lykkes, men Last Polled er Never
Poll-jobben har aldri kjørt. Les kontrollene **Background workers** og **Poll scheduler**. På en selvdriftet installasjon er den vanlige årsaken `DISABLE_QUEUE_WORKERS=true` på appen, uten en separat worker-utrulling som tar jobbene: sett den til `false`, eller kjør worker-utrullingen (Helm: `worker.enabled: true`, som er `false` som standard).
:::

## Neste trinn

:::cards
- [Sikkerhetshendelser](/docs/telemetry/security-events): Søk, korreler og varsle på det du importerer.
- [Sikkerhetssaker](/docs/telemetry/security-cases): Se hva Cloudflare gjorde, ved siden av det som nådde appen din.
- [Oversikt over integrasjoner](/docs/integrations/index): De andre verktøyene du kan koble til.
:::
