# Cloudflare

Importér det, som [Cloudflare](https://www.cloudflare.com)s firewall gjorde ved edge, til OneUptimes sikkerhedshændelser: de anmodninger, som dens administrerede og egne WAF-regler, hastighedsbegrænsning, IP Access Rules, bot-administration og HTTP-DDoS-beskyttelse blokerede, udfordrede eller loggede. Hver enkelt står ved siden af din apps egne anmodninger, så en sag siger, hvad Cloudflare stoppede, og hvad der alligevel nåede din app. OneUptime læser dem med et API-token, der kun kan læse, og ændrer intet i Cloudflare, medmindre du slår blokering til, som håndhæver din blokeringsliste dér.

:::cards
- [Opsæt forbindelsen](#opsæt-forbindelsen): Et API-token med to læsetilladelser og forbindelsens formular.
- [Hvad der importeres](#hvad-der-importeres): Hvilke begivenheder, og hvordan hver bliver en sikkerhedsbegivenhed.
- [Sådan fungerer polling](#sådan-fungerer-polling): Det vindue, hver hentning læser, og hvorfor det overlapper med 10 minutter.
- [Blokér adresser hos Cloudflare](#blokér-adresser-hos-cloudflare): Din blokeringsliste, håndhævet med to IP-lister og én brugerdefineret regel pr. liste.
- [Fejlfinding](#fejlfinding): Hvad hver fejl betyder, og hvad du skal ændre.
:::

## Sådan fungerer det

```mermaid title="Fra en anmodning, Cloudflare handlede på, til en sikkerhedshændelse"
flowchart TB
    edge["Cloudflares firewall<br/>handler på en<br/>anmodning"] --> poll["OneUptime henter<br/>i forbindelsens<br/>interval"]
    poll --> zones["Den læser hver<br/>zones firewall-<br/>hændelser siden<br/>sidste gang"]
    zones --> event["Hver gemmes som<br/>en HTTP Activity-<br/>hændelse"]
```

Hvert minut henter OneUptime fra hver aktiveret forbindelse, hvis hentningsinterval er gået. En hentning lister kontoens zoner, læser i GraphQL Analytics API'ets settings-node, hvad hver zones abonnement tillader, og læser hver zones firewallhændelser siden sidste hentning fra datasættet `firewallEventsAdaptive` ([Security Events](https://developers.cloudflare.com/waf/analytics/security-events/)), de ældste først. Hver hændelse gemmes som en [OCSF](https://schema.ocsf.io/)-hændelse af typen HTTP Activity.

## Før du går i gang

- I OneUptime rollen Projektejer, Projektadministrator eller Sikkerhedsadministrator. Sikkerhedsmedlem og Sikkerhedsseer kan se forbindelser og deres kørselshistorik, men ikke ændre dem.
- En Cloudflare-bruger, der kan oprette API-tokens til kontoens zoner.
- Zoner, hvis trafik går gennem Cloudflare: deres DNS-poster er proxied.
- Udgående HTTPS fra OneUptimes app og workers til `api.cloudflare.com`.

## Opsæt forbindelsen

Forbindelsen læser med et [API-token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/), aldrig med en Global API Key: et token er begrænset til kontoen og dens zoner, og du kan tilbagekalde det for sig. Det skal have to [tilladelser](https://developers.cloudflare.com/fundamentals/api/reference/permissions/), begge kun til læsning:

| Tilladelse | Hvad OneUptime læser med den |
| --- | --- |
| `Zone > Zone > Read` | Zonerne, med deres konti og abonnementer. |
| `Zone > Analytics > Read` | Hver zones firewallhændelser, gennem GraphQL Analytics API'et. |

:::steps
### Opret et API-token

1. Åbn **My Profile → API Tokens** i Cloudflares dashboard, vælg **Create Token**, og vælg **Create Custom Token**.
2. Kald det `oneuptime-security-events`. Tilføj `Zone > Zone > Read` og `Zone > Analytics > Read` under **Permissions**.
3. Medtag under **Zone Resources** alle kontoens zoner, eller de zoner, der skal importeres.
4. Vælg **Continue to summary**, derefter **Create Token**, og kopiér tokenet. Cloudflare viser det kun én gang.

### Tilføj forbindelsen i OneUptime

Åbn **Produkter → Sikkerhedshændelser → Forbindelser** (`/dashboard/{projectId}/security-events/connections`), klik på **Tilføj forbindelse**, vælg **Cloudflare** under **Cloudsikkerhed**, og klik på **Næste**. Indsæt tokenet i **API-token**. OneUptime lister derefter de konti og zoner, tokenet kan læse: vælg **Konto**, og lad **Alle zoner** stå under **Zoner**, eller vælg de zoner, der skal importeres.

### Test den, før du gemmer

Klik på **Test disse indstillinger** under **Test, før du gemmer**. Testen kontrollerer hver tilladelse med værdierne i formularen, nævner dem, der mangler, og gemmer intet. Klik derefter på **Næste**, giv forbindelsen et **Navn**, og opret den.
:::

| Indstilling | Hvad du skal angive |
| --- | --- |
| **Konto** | Den Cloudflare-konto, der skal læses, valgt blandt de konti, dit API-token læser. Et token, der læser én konto, vælger den for dig. |
| **Zoner** | Valgfri. Tom læser hver aktiv zone på kontoen, også zoner, der tilføjes senere. En forbindelse læser højst 50 zoner. |
| **API-token** | Kun tokenet, uden `Bearer`. Det krypteres, returneres aldrig af API'et og vises aldrig igen. Erstat det med **Opdater legitimationsoplysninger** på forbindelsen. |

Trinnet **Hentning** har også en valgfri **Beskrivelse**, **Hentningsinterval (minutter)**, et heltal fra `1` til `1440`, der starter ved `5`, og **Aktiveret**, der starter slået til. Cloudflares hændelser er anmodninger, ikke alarmer, så formularen spørger ikke om **Åbn sager fra**: sager kommer fra de detektionsregler, der læser dem.

### Skriveadgang er et særskilt valg

Denne forbindelse ændrer intet i Cloudflare, før du slår blokering til på dens række. Først da beder OneUptime om skrivetilladelser, og det tjekker dem, før det blokerer noget: [Blokér adresser hos Cloudflare](#blokér-adresser-hos-cloudflare) nævner hver enkelt, og hvad den bruges til. Føj dem først til tokenet, når du slår blokering til.

## Hvad der importeres

Hver hændelse har leverandøren `Cloudflare` og produktet `Cloudflare WAF` og er en hændelse af typen HTTP Activity (`4002`).

| Cloudflares felt | I sikkerhedshændelsen |
| --- | --- |
| `clientIP` | Principal-IP'en og `client.address` |
| `clientRequestHTTPHost`, `clientRequestPath`, `clientRequestQuery` | Målværten, målressourcen (stien og forespørgslen) og `url.original` |
| `clientRequestHTTPMethodName`, `userAgent` | Aktiviteten, `http.request.method` og `user_agent.original` |
| `action` | Status og `oneuptime.edge.action` |
| `source`, `ruleId`, `description` | Regel-ID'et, regelnavnet og `cloudflare.source` |
| `rayName`, `clientCountryName`, `clientAsn` | `cloudflare.ray_id`, `cloudflare.client.country` og `cloudflare.client.asn` |
| `sampleInterval` | `oneuptime.edge.sample_interval` |

| Hvad Cloudflare gjorde | Status | `oneuptime.edge.action` | Anmodningens udfald | Alvorlighed |
| --- | --- | --- | --- | --- |
| Blokerede, lukkede forbindelsen, eller en udfordring mislykkedes | Blocked, eller Dropped ved en lukket forbindelse | `blocked` | Rejected | Low |
| Svarede med en administreret, JS- eller interaktiv udfordring | Challenge | `challenged` | Rejected | Low |
| En bestået udfordring, eller en besøgende, der allerede havde bestået en | Allowed | `passed-challenge` | Intet | Informational |
| Loggede den og lukkede den igennem | Logged | `logged` | Oprindelsens statuskode | Medium; High når oprindelsen fejlede; Low når den afviste anmodningen |
| Lukkede den igennem på en af dine skip- eller allow-regler | Allowed | `let-through` | Oprindelsens statuskode | Som for en logget anmodning |

En anmodning, som en af dine egne skip- eller allow-regler lukkede igennem, importeres kun, når den indeholder et angreb (SQL-injektion, path traversal eller et Log4Shell-opslag), eller Cloudflares WAF attack score vurderer den som et. Resten er trafik, du tillader med vilje, som dine monitorer: hver kørsel tæller den og udelader den.

Cloudflare tager stikprøver af en travl zones hændelser. Hver hændelse beholder sit stikprøveinterval, antallet af lignende anmodninger, den repræsenterer, og hvert antal, OneUptime laver ud fra dem, siger *cirka*.

Hændelserne vises under Hændelser, under Kampagner (angrebsanmodninger efter adresse), i enhedsrisiko og i detektionsregler. En sag om en adresse viser under **Ved edge** i dens påvirkning, hvad Cloudflare gjorde med adressens anmodninger, ved siden af det, der nåede din app. Regelbibliotekets Cloudflare-regler læser dem, som de importeres her: mange hits fra administrerede regler fra én adresse, en adresse, der bestod en udfordring og derefter sendte angreb, og et angreb, som Cloudflare lukkede igennem, og som nåede din app.

## Abonnementsgrænser

Hvert abonnement har firewallhændelser gennem API'et. **What each zone's plan gives** i **Test forbindelse** læser hver zones egne grænser hos Cloudflare.

| Abonnement | Free | Pro | Business | Enterprise |
| --- | --- | --- | --- | --- |
| Gemte firewallhændelser | 31 dage | 31 dage | 31 dage | 31 dage |
| Længste forespørgsel | 30 dage | 30 dage | 30 dage | 31 dage |

Cloudflares Logpush kan også sende firewallhændelser, på hvert abonnement siden 30. september 2026, med betaling efter forbrug. Denne forbindelse henter i stedet, så den behøver intet ud over de to læsetilladelser.

## Sådan fungerer polling

- **Hændelser læses efter, hvornår de skete ved edge.** Cloudflares analysedata kan forespørges et minut eller to efter anmodningen.
- **Den første poll ser 24 timer tilbage**, så en ny forbindelse straks viser sine nylige begivenheder.
- **Hver senere hentning starter 10 minutter før den gemte markør**, så en hændelse, som Cloudflare gør læsbar sent, læses ved næste hentning, og dubletter frasorteres på hver hændelses Ray ID i projektet.
- **En poll læser højst 24 timer forbi markøren.** En forbindelse, hvis markør er kommet bagud, indhenter i en række vinduer på 24 timer.
- **Zonerne læses på skift**, en side med op til 2.000 hændelser hver, så en travl zone ikke kan bruge en hentning op, før en rolig er læst.
- **Cloudflares hastighedsgrænser overholdes.** Cloudflare tillader 1.200 REST-anmodninger og 300 GraphQL-forespørgsler på fem minutter. En `429`, der beder om at vente 30 sekunder eller mindre, ventes ud og spørges igen; en længere stopper hentningen, og den næste fortsætter.
- **En zone, tokenet ikke kan læse, holder intet tilbage.** De andre zoner importeres, kørslen er **Delvis**, og dens advarsel nævner zonen. Giv tokenet `Zone > Analytics > Read` der, og brug derefter **Importér dette tidsinterval** til at hente vinduet ind.
- **En mislykket kørsel ændrer intet.** Efter en netværksfejl, eller en fejlstatus fra Cloudflare, forbliver markøren og vinduets længde, som de var, og den næste hentning læser det samme vindue igen. Den eneste undtagelse er en anmodning, der fik timeout: markøren bliver, men det næste vindue er halvt så langt, da et vindue, der er for tungt til at svare i tide, ville få timeout ved hvert forsøg.

### Når et vindue indeholder mere, end én poll kan læse

En hentning sender højst 120 anmodninger, læser højst 20.000 hændelser og stopper efter 4 minutter. Hændelser læses de ældste først, så når et budget stopper en hentning, er kørslen **Delvis**, og den næste hentning fortsætter fra den ældste hændelse, de ufærdige zoner blev læst til. Når ikke hver zone kunne læses én gang, gør OneUptime i stedet vinduet kortere:

1. **Indsnævr.** Den næste hentning læser et halvt så langt vindue fra samme startpunkt og halverer igen, indtil et vindue læses helt, ned til ét minut. Kørslens advarsel siger det: `This window holds more records than one poll can read; the next poll reads a {n} minute window from the same starting point.` Hændelser, der allerede er importeret fra det længere vindue, springes over som dubletter.
2. **Voks igen.** Når et vindue er læst helt, flyttes markøren til dets slutning, og det næste vindue er igen dobbelt så langt, op til 24 timer.
3. **Gå forbi et enkelt minut.** Hvis selv ét minut indeholder mere, end en hentning kan læse, går hentningen forbi det, så nyere hændelser bliver ved med at komme. Kørslen forbliver **Delvis**, og **Seneste fejl** lyder `More records were created in the one minute from {cursor} to {end} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.` Importér det minut med **Importér dette tidsinterval** for at hente det ind, en kørsel kan læse.

At ændre **Hentningsinterval (minutter)** ændrer intet af dette: det afgør, hvor ofte en poll starter, ikke hvor dens vindue begynder.

### Kør, se forhåndsvisning og importér efter behov

Klik på **Diagnosticering** på en forbindelse for at se dens seneste kørsler og arbejde med den manuelt. Alle, der kan ændre forbindelsen, kan starte disse handlinger; alle, der kan se den, kan læse historikken.

- **Kør nu** starter straks en poll med den sædvanlige markør, også når forbindelsen ikke er **Aktiveret**.
- **Forhåndsvis firewallhændelser** læser et tidsinterval på op til 7 dage og importerer intet.
- **Importér dette tidsinterval** importerer et interval på op til 7 dage, efter du har bekræftet, uden at flytte markøren. Hændelser, der allerede er importeret, springes over. Cloudflare gemmer firewallhændelser i 31 dage.
- **Kopiér diagnosticering** på en kørsel kopierer dens rapport til support. Den indeholder aldrig legitimationsoplysninger.

## Test forbindelse

**Test forbindelse** på en forbindelses række og **Test disse indstillinger** i formularen kører i API-processen, ikke i en baggrundsworker, så en test også svarer, når det er workerne, der er problemet. Den kører disse kontroller i rækkefølge:

| Kontrol | Hvad den kontrollerer |
| --- | --- |
| **Konfiguration** | Tokenet, kontoen og zonerne er velformede. Intet kontaktes, når dette fejler. |
| **Verify the API token** | Cloudflare accepterer tokenet, en brugers eller et, kontoen ejer, og det er aktivt. Et, der udløber inden for 14 dage, er en advarsel. |
| **List the zones** | Tokenet har `Zone > Zone > Read`: det lister kontoens zoner og hver valgt zone. |
| **Read firewall events** | Tokenet har `Zone > Analytics > Read` på hver zone. En fejl nævner de zoner, den mangler på. |
| **What each zone's plan gives** | Hvor længe hver zones abonnement gemmer firewallhændelser, og hvor lang én forespørgsel må være. En zone, hvis abonnement ingen har, er en advarsel. |
| **Firewall events available to import** | Cirka hvor mange hændelser de sidste 24 timer og de sidste 7 dage indeholder. Ingen er en advarsel. |
| **Background workers**, **Poll scheduler**, **Security event storage** | OneUptimes egen side: en proces tager jobbene fra Worker-køen, poll-jobbet kører hvert minut, og lageret for sikkerhedsbegivenheder svarer. |
| **Planlagt hentning** | For en gemt forbindelse: polling er slået til, ingen kørsel sidder fast og venter på en worker, og polls kører til tiden. |

Hver anmodning i en test har en frist på 20 sekunder. En test importerer aldrig noget og flytter aldrig markøren, og hver mislykket kontrol siger, hvad du skal ændre.

## Blokér adresser hos Cloudflare

Med blokering slået til håndhæver Cloudflare dit projekts [blokeringsliste](/docs/telemetry/security-cases#blokeringsliste). Hver adresse, du blokerer, kommer inden for et minut på en IP-liste i din Cloudflare-konto, og i hver zone blokerer én brugerdefineret regel pr. liste de adresser, listen indeholder, eller giver dem en udfordring. På **Blokeringsliste** nævner **Håndhævet hos** Cloudflare for hver blokering, OneUptime har læst tilbage fra Cloudflare; en blokering, der ikke er læst tilbage inden for 10 minutter, håndhæves ikke dér.

Blokering kræver skrivetilladelser på forbindelsens API-token:

| Tilladelse | Hvad OneUptime gør med den |
| --- | --- |
| `Account > Account Filter Lists > Edit` | Opretter sine to lister og tilføjer og fjerner deres adresser. |
| `Zone > Zone WAF > Edit`, på hver zone, der skal blokeres i | Tilføjer sine brugerdefinerede regler og læser zonens egne. |
| `Account > Account Firewall Access Rules > Edit` | Tilføjer og fjerner IP Access Rules på en plan uden en ledig liste eller en ledig brugerdefineret regel. |

:::steps
### Giv tokenet skrivetilladelser

Åbn **My Profile → API Tokens** i Cloudflare, redigér forbindelsens token, og tilføj tilladelserne ovenfor. Eller opret et token, der har dem og de to læsetilladelser.

### Slå blokering til

Vælg **Blokér adresser** på forbindelsens række. Indsæt et nyt token i **Nyt API-token**, eller lad feltet være tomt for at beholde det nuværende, og lad **Alle zoner** stå i **Zoner**, eller vælg de zoner, der skal blokeres i. **Tjek tilladelser** spørger Cloudflare, om tokenet har hver tilladelse, og ændrer intet. **Slå blokering til** slår kun blokering til, når hvert tjek består, og OneUptime sætter Cloudflare op inden for et minut.
:::

Mens blokering er slået til, kører **Test forbindelse** de samme tjek: **How blocking is set up**, **Edit the lists**, **Edit custom rules in each zone** og, hvor IP Access Rules bruges, **Edit IP Access Rules**.

### Hvad OneUptime tilføjer i Cloudflare

| I Cloudflare | Hvad det er |
| --- | --- |
| Listerne `oneuptime_block` og `oneuptime_challenge` | To IP-lister i kontoen, én til blokeringer og én til udfordringer. Deres beskrivelse nævner dit OneUptime-projekt. |
| Én brugerdefineret regel pr. liste, i hver zone | `(ip.src in $oneuptime_block)` med handlingen Block og `(ip.src in $oneuptime_challenge)` med handlingen Managed Challenge. Deres beskrivelse siger, at OneUptime administrerer dem. |
| Ét listeelement pr. blokering | Dets kommentar nævner sagen, og hvornår blokeringen slutter, f.eks. `OneUptime case CASE-42 until 2026-11-21 10:42 UTC`. |

Hver regel kommer først blandt zonens brugerdefinerede regler, så den kører før dine: En Skip-regel fra dig kan ikke lukke en blokeret adresse forbi den. Når dine Skip-regler lukker adresser igennem, f.eks. dine monitorers eller en partners, nævner **Blokeringsstatus** dem. **Beskyt disse adresser** føjer dem til **Beskyttede entiteter**, som ingen kan blokere.

### Planbegrænsninger for blokering

| Abonnement | Free | Pro | Business | Enterprise |
| --- | --- | --- | --- | --- |
| Lister i kontoen | 1 | 10 | 10 | 1.000 |
| Listeelementer i kontoen | 10.000 | 10.000 | 10.000 | 500.000 |
| Brugerdefinerede regler i en zone | 5 | 20 | 100 | 1.000 |

Dine egne lister og regler tæller med. Når du slår blokering til, tager hver handling en liste og en regel i hver zone, hvor planen har dem ledige, Block først; hvor ikke, tager den IP Access Rules. På en Free-plan, hvis ene liste er ledig, tager blokeringer listen og udfordringer IP Access Rules. En konto rummer 50.000 IP Access Rules, hver en adresse, et IPv4-interval på /16 eller /24 eller et IPv6-interval på /32, /48 eller /64: En blokering af et andet interval håndhæves ikke dér, og **Blokeringsliste** siger hvorfor. **How blocking is set up** siger, hvad hver handling tager, og hvorfor.

### Når nogen ændrer en regel

OneUptime læser sine lister og regler tilbage hvert 3. minut og fortryder aldrig en ændring, som nogen har lavet i Cloudflare. En regel, der er slået fra, slettet eller ændret dér, vises på forbindelsens række og i **Blokeringsstatus** med sin zone, og **Blokeringsliste** viser blokeringerne i den zones regel som ikke håndhævet hos Cloudflare. **Gendan** sætter reglen op igen. Så længe **Zoner** står på **Alle zoner**, sættes en zone, der senere føjes til kontoen, op af sig selv.

### Slå blokering fra

**Slå blokering fra** spørger, om OneUptimes lister og regler skal fjernes fra Cloudflare, med **Fjern OneUptimes lister og regler fra Cloudflare** valgt. Fjernelsen tager OneUptimes regler, dets to lister og de IP Access Rules, det har tilføjet, fundet ud fra de navne, referencer og noter, det gav dem, og intet andet. Beholdes de, bliver de i Cloudflare og fortsætter med at blokere det, de indeholder. En forbindelse, der blokerer adresser, kan ikke slettes: Slå blokering fra først, og slet den, når fjernelsen er færdig.

## Fejlfinding

Forbindelsens **Seneste fejl** gemmer hele fejlmeddelelsen, med legitimationsoplysninger skjult. Når en forbindelse har en fejl, så vælg **Vis fejl** i dens kolonne **Handlinger** for at læse den, og **Kopiér fejl** i dialogen for at kopiere den. Hver meddelelse nævner den anmodning, der fejlede, og citerer Cloudflares egen begrundelse.

:::details Seneste fejl lyder `Invalid API Token (1000)`
Cloudflare kender ikke tokenet: det blev slettet, fornyet eller aldrig indsat helt. En Global API Key afvises, før den sendes. Opret et token som ovenfor, og gem det med **Opdater legitimationsoplysninger**.
:::

:::details Seneste fejl lyder `Unauthorized to access requested resource (9109)`
Tokenet kan ikke liste zoner. Giv det `Zone > Zone > Read`, med de zoner, der skal importeres, under **Zone Resources**.
:::

:::details Seneste fejl lyder `cannot read the analytics of`
Tokenet mangler `Zone > Analytics > Read` på de zoner, meddelelsen nævner. Tilføj den der, og brug derefter **Importér dette tidsinterval** til at hente det ind, der ikke blev importeret.
:::

:::details Seneste fejl lyder `rate limit`
Noget andet, der bruger den samme Cloudflare-bruger, har brugt sin kvote op. Hentningen fortsætter af sig selv, når de fem minutter er gået; giv OneUptime et token fra en bruger for sig selv for at holde kvoten adskilt.
:::

:::details Seneste fejl siger `did not complete`
Anmodningen fik intet svar: en timeout, et navn, der ikke kan slås op, eller en afvist adresse. Kontrollér, at OneUptimes app og workers kan nå `api.cloudflare.com`, gennem en eventuel proxy, du bruger.
:::

:::details En sag viser Cloudflares handlinger, men ingen af adressens anmodninger i din app
Bag Cloudflare kommer din apps forespørgsler fra Cloudflares adresser, og besøgerens adresse er den sidste, Cloudflare føjer til `X-Forwarded-For`. Registrér den header (`http.request.header.x-forwarded-for`) og forbindelsens egen adresse (`network.peer.address`) i dine traces. Så længe denne forbindelse findes, stoler OneUptime på Cloudflares adresser som proxy, så det læser besøgeren fra headeren og matcher din apps forespørgsler med den adresse, Cloudflare handlede på. En `client.address`, som din app kopierer fra `CF-Connecting-IP`, stoles der ikke på: Alle, der når din app direkte, kan sende den header.
:::

:::details Blokeringsstatus lyder `already exists in this Cloudflare account`
Et andet OneUptime-projekt, eller en person, har oprettet en liste med navnet `oneuptime_block` eller `oneuptime_challenge`, og OneUptime ændrer aldrig en liste, det ikke har oprettet til dette projekt. Omdøb eller slet listen i Cloudflare, eller slå blokering fra i det projekt, der oprettede den. OneUptime sætter blokering op igen inden for 5 minutter.
:::

:::details Testen lykkes, men Last Polled er Never
Poll-jobbet har aldrig kørt. Læs kontrollerne **Background workers** og **Poll scheduler**. På en selvhostet installation er den sædvanlige årsag `DISABLE_QUEUE_WORKERS=true` på appen, uden en separat worker-udrulning, der tager jobbene: sæt den til `false`, eller kør worker-udrulningen (Helm: `worker.enabled: true`, som er `false` som standard).
:::

## Næste trin

:::cards
- [Sikkerhedsbegivenheder](/docs/telemetry/security-events): Søg, korrelér og advar på det, du importerer.
- [Sikkerhedssager](/docs/telemetry/security-cases): Se, hvad Cloudflare gjorde, ved siden af det, der nåede din app.
- [Oversigt over integrationer](/docs/integrations/index): De andre værktøjer, du kan forbinde.
:::
