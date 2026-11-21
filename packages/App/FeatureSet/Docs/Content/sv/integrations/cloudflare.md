# Cloudflare

Importera det som [Cloudflare](https://www.cloudflare.com)s brandvägg gjorde vid kanten till OneUptimes säkerhetshändelser: de begäranden som dess hanterade och egna WAF-regler, hastighetsbegränsning, IP Access Rules, bothantering och HTTP-DDoS-skydd blockerade, utmanade eller loggade. Var och en står bredvid appens egna begäranden, så ett ärende säger vad Cloudflare stoppade och vad som ändå nådde din app. OneUptime läser dem med en API-token som bara kan läsa, och ändrar ingenting i Cloudflare om du inte slår på blockering, som tillämpar din blocklista där.

:::cards
- [Konfigurera anslutningen](#konfigurera-anslutningen): En API-token med två läsbehörigheter, och anslutningens formulär.
- [Vad som importeras](#vad-som-importeras): Vilka händelser, och hur var och en blir en säkerhetshändelse.
- [Så fungerar avsökningen](#så-fungerar-avsökningen): Fönstret som varje hämtning läser, och varför det överlappar med 10 minuter.
- [Blockera adresser hos Cloudflare](#blockera-adresser-hos-cloudflare): Din blocklista, tillämpad med två IP-listor och en anpassad regel per lista.
- [Felsökning](#felsökning): Vad varje fel betyder och vad du ska ändra.
:::

## Så fungerar det

```mermaid title="Från en begäran som Cloudflare agerade på till en säkerhetshändelse"
flowchart TB
    edge["Cloudflares brandvägg<br/>agerar på en<br/>begäran"] --> poll["OneUptime hämtar<br/>i anslutningens<br/>intervall"]
    poll --> zones["Den läser varje<br/>zons brandväggs-<br/>händelser sedan<br/>förra gången"]
    zones --> event["Var och en sparas<br/>som en HTTP Activity-<br/>händelse"]
```

Varje minut hämtar OneUptime från varje aktiverad anslutning vars hämtningsintervall har gått. En hämtning listar kontots zoner, läser i settings-noden i GraphQL Analytics API vad varje zons abonnemang tillåter, och läser varje zons brandväggshändelser sedan förra hämtningen från datamängden `firewallEventsAdaptive` ([Security Events](https://developers.cloudflare.com/waf/analytics/security-events/)), de äldsta först. Varje händelse sparas som en [OCSF](https://schema.ocsf.io/)-händelse av typen HTTP Activity.

## Innan du börjar

- I OneUptime rollen Projektägare, Projektadministratör eller Säkerhetsadministratör. Säkerhetsmedlem och Säkerhetstittare kan se anslutningar och deras körningshistorik, men inte ändra dem.
- En Cloudflare-användare som kan skapa API-token för kontots zoner.
- Zoner vars trafik går genom Cloudflare: deras DNS-poster är proxied.
- Utgående HTTPS från OneUptimes app och workers till `api.cloudflare.com`.

## Konfigurera anslutningen

Anslutningen läser med en [API-token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/), aldrig med en Global API Key: en token är begränsad till kontot och dess zoner, och du kan återkalla den för sig. Den behöver två [behörigheter](https://developers.cloudflare.com/fundamentals/api/reference/permissions/), båda bara för läsning:

| Behörighet | Vad OneUptime läser med den |
| --- | --- |
| `Zone > Zone > Read` | Zonerna, med deras konton och abonnemang. |
| `Zone > Analytics > Read` | Varje zons brandväggshändelser, genom GraphQL Analytics API. |

:::steps
### Skapa en API-token

1. Öppna **My Profile → API Tokens** i Cloudflares instrumentpanel, välj **Create Token** och välj **Create Custom Token**.
2. Kalla den `oneuptime-security-events`. Lägg till `Zone > Zone > Read` och `Zone > Analytics > Read` under **Permissions**.
3. Ta med alla kontots zoner under **Zone Resources**, eller de zoner som ska importeras.
4. Välj **Continue to summary**, sedan **Create Token**, och kopiera token. Cloudflare visar den bara en gång.

### Lägg till anslutningen i OneUptime

Öppna **Produkter → Säkerhetshändelser → Anslutningar** (`/dashboard/{projectId}/security-events/connections`), klicka på **Lägg till anslutning**, välj **Cloudflare** under **Molnsäkerhet** och klicka på **Nästa**. Klistra in token i **API-token**. OneUptime listar sedan de konton och zoner som token kan läsa: välj **Konto**, och låt **Alla zoner** stå kvar under **Zoner**, eller välj de zoner som ska importeras.

### Testa den innan du sparar

Klicka på **Testa de här inställningarna** under **Testa innan du sparar**. Testet kontrollerar varje behörighet med värdena i formuläret, nämner den som saknas och sparar ingenting. Klicka sedan på **Nästa**, ge anslutningen ett **Namn** och skapa den.
:::

| Inställning | Vad du anger |
| --- | --- |
| **Konto** | Cloudflare-kontot som ska läsas, valt bland de konton din API-token läser. En token som läser ett enda konto väljer det åt dig. |
| **Zoner** | Valfritt. Tomt läser varje aktiv zon i kontot, även zoner som läggs till senare. En anslutning läser högst 50 zoner. |
| **API-token** | Bara token, utan `Bearer`. Den krypteras, returneras aldrig av API:t och visas aldrig igen. Ersätt den med **Uppdatera inloggningsuppgifter** på anslutningen. |

Steget **Hämtning** har också en valfri **Beskrivning**, **Hämtningsintervall (minuter)**, ett heltal från `1` till `1440` som börjar på `5`, och **Aktiverad**, som börjar påslagen. Cloudflares händelser är begäranden, inte larm, så formuläret frågar inte efter **Öppna ärenden från**: ärenden kommer från de detekteringsregler som läser dem.

### Skrivåtkomst är ett eget val

Den här anslutningen ändrar ingenting i Cloudflare förrän du slår på blockering på dess rad. Först då ber OneUptime om skrivbehörigheter, och det kontrollerar dem innan det blockerar något: [Blockera adresser hos Cloudflare](#blockera-adresser-hos-cloudflare) nämner var och en och vad den används till. Lägg till dem i token först när du slår på blockering.

## Vad som importeras

Varje händelse har leverantören `Cloudflare` och produkten `Cloudflare WAF`, och är en händelse av typen HTTP Activity (`4002`).

| Cloudflares fält | I säkerhetshändelsen |
| --- | --- |
| `clientIP` | Principal-IP:n och `client.address` |
| `clientRequestHTTPHost`, `clientRequestPath`, `clientRequestQuery` | Målvärden, målresursen (sökvägen och frågan) och `url.original` |
| `clientRequestHTTPMethodName`, `userAgent` | Aktiviteten, `http.request.method` och `user_agent.original` |
| `action` | Statusen och `oneuptime.edge.action` |
| `source`, `ruleId`, `description` | Regel-ID:t, regelns namn och `cloudflare.source` |
| `rayName`, `clientCountryName`, `clientAsn` | `cloudflare.ray_id`, `cloudflare.client.country` och `cloudflare.client.asn` |
| `sampleInterval` | `oneuptime.edge.sample_interval` |

| Vad Cloudflare gjorde | Status | `oneuptime.edge.action` | Begärans utfall | Allvarlighetsgrad |
| --- | --- | --- | --- | --- |
| Blockerade, stängde anslutningen, eller en utmaning misslyckades | Blocked, eller Dropped för en stängd anslutning | `blocked` | Rejected | Low |
| Svarade med en hanterad, JS- eller interaktiv utmaning | Challenge | `challenged` | Rejected | Low |
| En klarad utmaning, eller en besökare som redan hade klarat en | Allowed | `passed-challenge` | Inget | Informational |
| Loggade den och släppte igenom den | Logged | `logged` | Ursprungets statuskod | Medium; High när ursprunget misslyckades; Low när det avvisade begäran |
| Släppte igenom den på en av dina skip- eller allow-regler | Allowed | `let-through` | Ursprungets statuskod | Som för en loggad begäran |

En begäran som en av dina egna skip- eller allow-regler släppte igenom importeras bara när den innehåller en attack (SQL-injektion, path traversal eller en Log4Shell-uppslagning), eller när Cloudflares WAF attack score bedömer den som en. Resten är trafik du tillåter med avsikt, som dina monitorer: varje körning räknar den och utelämnar den.

Cloudflare tar urval av en belastad zons händelser. Varje händelse behåller sitt urvalsintervall, antalet liknande begäranden den står för, och varje antal som OneUptime gör av dem säger *ungefär*.

Händelserna visas under Händelser, under Kampanjer (attackbegäranden per adress), i entitetsrisk och i detekteringsregler. Ett ärende om en adress visar under **Vid kanten** i dess påverkan vad Cloudflare gjorde med adressens begäranden, bredvid det som nådde din app. Regelbibliotekets Cloudflare-regler läser dem som de importeras här: många träffar på hanterade regler från en adress, en adress som klarade en utmaning och sedan skickade attacker, och en attack som Cloudflare släppte igenom och som nådde din app.

## Abonnemangsgränser

Varje abonnemang har brandväggshändelser genom API:t. **What each zone's plan gives** i **Testa anslutningen** läser varje zons egna gränser hos Cloudflare.

| Abonnemang | Free | Pro | Business | Enterprise |
| --- | --- | --- | --- | --- |
| Sparade brandväggshändelser | 31 dagar | 31 dagar | 31 dagar | 31 dagar |
| Längsta fråga | 30 dagar | 30 dagar | 30 dagar | 31 dagar |

Cloudflares Logpush kan också skicka brandväggshändelser, på varje abonnemang sedan den 30 september 2026, med pris efter användning. Den här anslutningen hämtar i stället, så den behöver inget utöver de två läsbehörigheterna.

## Så fungerar avsökningen

- **Händelser läses efter när de inträffade vid kanten.** Cloudflares analysdata kan efterfrågas en minut eller två efter begäran.
- **Den första avsökningen ser 24 timmar bakåt**, så att en ny anslutning direkt visar sina senaste händelser.
- **Varje senare hämtning börjar 10 minuter före den sparade markören**, så en händelse som Cloudflare gör läsbar sent läses vid nästa hämtning, och dubbletter sorteras bort på varje händelses Ray ID i projektet.
- **En avsökning läser högst 24 timmar förbi markören.** En anslutning vars markör har hamnat efter kommer ikapp i en serie fönster på 24 timmar.
- **Zonerna läses i tur och ordning**, en sida med upp till 2 000 händelser var, så en belastad zon inte kan förbruka en hämtning innan en lugn är läst.
- **Cloudflares hastighetsgränser följs.** Cloudflare tillåter 1 200 REST-begäranden och 300 GraphQL-frågor på fem minuter. En `429` som ber om att vänta 30 sekunder eller mindre väntas ut och frågas igen; en längre stoppar hämtningen, och nästa fortsätter.
- **En zon som token inte kan läsa håller inte upp något.** De andra zonerna importeras, körningen är **Delvis**, och dess varning nämner zonen. Ge token `Zone > Analytics > Read` där, och använd sedan **Importera det här tidsintervallet** för att hämta in fönstret.
- **En misslyckad körning ändrar ingenting.** Efter ett nätverksfel, eller en felstatus från Cloudflare, förblir markören och fönstrets längd som de var, och nästa hämtning läser samma fönster igen. Det enda undantaget är en begäran som fick tidsgräns: markören stannar, men nästa fönster är hälften så långt, eftersom ett fönster som är för tungt att svara på i tid skulle få tidsgräns vid varje försök.

### När ett fönster innehåller mer än en avsökning kan läsa

En hämtning skickar högst 120 begäranden, läser högst 20 000 händelser och stannar efter 4 minuter. Händelser läses de äldsta först, så när en budget stoppar en hämtning är körningen **Delvis**, och nästa hämtning fortsätter från den äldsta händelse som de ofärdiga zonerna lästes till. När inte varje zon kunde läsas en gång gör OneUptime i stället fönstret kortare:

1. **Smalna av.** Nästa hämtning läser ett hälften så långt fönster, från samma startpunkt, och halverar igen tills ett fönster läses helt, ned till en minut. Körningens varning säger det: `This window holds more records than one poll can read; the next poll reads a {n} minute window from the same starting point.` Händelser som redan har importerats från det längre fönstret hoppas över som dubbletter.
2. **Växa igen.** När ett fönster har lästs helt flyttas markören till dess slut, och nästa fönster är dubbelt så långt igen, upp till 24 timmar.
3. **Gå förbi en enda minut.** Om även en minut innehåller mer än en hämtning kan läsa går hämtningen förbi den, så att nyare händelser fortsätter att komma. Körningen förblir **Delvis**, och **Senaste fel** lyder `More records were created in the one minute from {cursor} to {end} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.` Importera den minuten med **Importera det här tidsintervallet** för att hämta in det som en körning kan läsa.

Att ändra **Hämtningsintervall (minuter)** ändrar inget av detta: det avgör hur ofta en avsökning startar, inte var dess fönster börjar.

### Kör, förhandsgranska och importera vid behov

Klicka på **Diagnostik** på en anslutning för att se dess senaste körningar och arbeta med den manuellt. Alla som kan ändra anslutningen kan starta de här åtgärderna; alla som kan se den kan läsa historiken.

- **Kör nu** startar en avsökning direkt, med den vanliga markören, även när anslutningen inte är **Aktiverad**.
- **Förhandsgranska brandväggshändelser** läser ett tidsintervall på upp till 7 dagar och importerar ingenting.
- **Importera det här tidsintervallet** importerar ett intervall på upp till 7 dagar efter att du bekräftat, utan att flytta markören. Händelser som redan har importerats hoppas över. Cloudflare sparar brandväggshändelser i 31 dagar.
- **Kopiera diagnostik** på en körning kopierar dess rapport till supporten. Den innehåller aldrig autentiseringsuppgifter.

## Testa anslutningen

**Testa anslutningen** på en anslutnings rad och **Testa de här inställningarna** i formuläret körs i API-processen, inte i en bakgrundsworker, så att ett test svarar även när det är workerna som är problemet. Det kör de här kontrollerna i ordning:

| Kontroll | Vad den kontrollerar |
| --- | --- |
| **Konfiguration** | Token, kontot och zonerna är välformade. Ingenting kontaktas när detta misslyckas. |
| **Verify the API token** | Cloudflare godtar token, en användares eller en som kontot äger, och den är aktiv. En som går ut inom 14 dagar är en varning. |
| **List the zones** | Token har `Zone > Zone > Read`: den listar kontots zoner, och varje vald zon. |
| **Read firewall events** | Token har `Zone > Analytics > Read` på varje zon. Ett fel nämner de zoner där den saknas. |
| **What each zone's plan gives** | Hur länge varje zons abonnemang sparar brandväggshändelser, och hur lång en fråga får vara. En zon vars abonnemang saknar dem är en varning. |
| **Firewall events available to import** | Ungefär hur många händelser de senaste 24 timmarna och de senaste 7 dagarna innehåller. Inga är en varning. |
| **Background workers**, **Poll scheduler**, **Security event storage** | OneUptimes egen sida: en process tar jobben från Worker-kön, avsökningsjobbet körs varje minut och lagringen för säkerhetshändelser svarar. |
| **Schemalagd hämtning** | För en sparad anslutning: avsökningen är påslagen, ingen körning har fastnat i väntan på en worker och avsökningar körs i tid. |

Varje begäran i ett test har en tidsgräns på 20 sekunder. Ett test importerar aldrig något och flyttar aldrig markören, och varje kontroll som misslyckas säger vad du ska ändra.

## Blockera adresser hos Cloudflare

Med blockering påslagen tillämpar Cloudflare ditt projekts [blocklista](/docs/telemetry/security-cases#blocklista). Varje adress du blockerar hamnar inom en minut på en IP-lista i ditt Cloudflare-konto, och i varje zon blockerar en anpassad regel per lista de adresser listan innehåller, eller ger dem en utmaning. På **Blocklista** nämner **Tillämpad hos** Cloudflare för varje blockering som OneUptime har läst tillbaka från Cloudflare; en blockering som inte läses tillbaka inom 10 minuter tillämpas inte där.

Blockering behöver skrivbehörigheter på anslutningens API-token:

| Behörighet | Vad OneUptime gör med den |
| --- | --- |
| `Account > Account Filter Lists > Edit` | Skapar sina två listor, och lägger till och tar bort deras adresser. |
| `Zone > Zone WAF > Edit`, på varje zon där det ska blockeras | Lägger till sina anpassade regler, och läser zonens egna. |
| `Account > Account Firewall Access Rules > Edit` | Lägger till och tar bort IP Access Rules, på en plan utan ledig lista eller ledig anpassad regel. |

:::steps
### Ge token skrivbehörigheter

Öppna **My Profile → API Tokens** i Cloudflare, redigera anslutningens token och lägg till behörigheterna ovan. Eller skapa en token som har dem och de två läsbehörigheterna.

### Slå på blockering

Välj **Blockera adresser** på anslutningens rad. Klistra in en ny token i **Nytt API-token**, eller lämna fältet tomt för att behålla den nuvarande, och låt **Alla zoner** stå kvar i **Zoner**, eller välj de zoner där det ska blockeras. **Kontrollera behörigheter** frågar Cloudflare om token har varje behörighet, och ändrar ingenting. **Slå på blockering** slår bara på blockering när varje kontroll går igenom, och OneUptime konfigurerar Cloudflare inom en minut.
:::

Medan blockering är påslagen kör **Testa anslutningen** samma kontroller: **How blocking is set up**, **Edit the lists**, **Edit custom rules in each zone** och, där IP Access Rules används, **Edit IP Access Rules**.

### Vad OneUptime lägger till i Cloudflare

| I Cloudflare | Vad det är |
| --- | --- |
| Listorna `oneuptime_block` och `oneuptime_challenge` | Två IP-listor i kontot, en för blockeringar och en för utmaningar. Deras beskrivning nämner ditt OneUptime-projekt. |
| En anpassad regel per lista, i varje zon | `(ip.src in $oneuptime_block)` med åtgärden Block, och `(ip.src in $oneuptime_challenge)` med åtgärden Managed Challenge. Deras beskrivning säger att OneUptime hanterar dem. |
| Ett listobjekt per blockering | Dess kommentar nämner ärendet och när blockeringen upphör, till exempel `OneUptime case CASE-42 until 2026-11-21 10:42 UTC`. |

Varje regel kommer först bland zonens anpassade regler, så den körs före dina: En Skip-regel från dig kan inte släppa förbi en blockerad adress. När dina Skip-regler släpper igenom adresser, till exempel dina monitorers eller en partners, nämner **Blockeringsstatus** dem. **Skydda dessa adresser** lägger till dem i **Skyddade entiteter**, som ingen kan blockera.

### Plangränser för blockering

| Abonnemang | Free | Pro | Business | Enterprise |
| --- | --- | --- | --- | --- |
| Listor i kontot | 1 | 10 | 10 | 1 000 |
| Listobjekt i kontot | 10 000 | 10 000 | 10 000 | 500 000 |
| Anpassade regler i en zon | 5 | 20 | 100 | 1 000 |

Dina egna listor och regler räknas också. När du slår på blockering tar varje åtgärd en lista, och en regel i varje zon, där planen har dem lediga, Block först; där inte, tar den IP Access Rules. På en Free-plan vars enda lista är ledig tar blockeringar listan och utmaningar IP Access Rules. Ett konto rymmer 50 000 IP Access Rules, var och en en adress, ett IPv4-intervall på /16 eller /24 eller ett IPv6-intervall på /32, /48 eller /64: En blockering av ett annat intervall tillämpas inte där, och **Blocklista** säger varför. **How blocking is set up** säger vad varje åtgärd tar, och varför.

### När någon ändrar en regel

OneUptime läser tillbaka sina listor och regler var 3:e minut, och ångrar aldrig en ändring som någon har gjort i Cloudflare. En regel som har stängts av, tagits bort eller ändrats där visas på anslutningens rad och i **Blockeringsstatus**, med sin zon, och **Blocklista** visar blockeringarna i den zonens regel som inte tillämpade hos Cloudflare. **Återställ** konfigurerar regeln igen. Så länge **Zoner** står på **Alla zoner** konfigureras en zon som läggs till i kontot senare av sig själv.

### Stäng av blockering

**Stäng av blockering** frågar om OneUptimes listor och regler ska tas bort från Cloudflare, med **Ta bort OneUptimes listor och regler från Cloudflare** valt. Borttagningen tar bort OneUptimes regler, dess två listor och de IP Access Rules det har lagt till, hittade genom de namn, referenser och anteckningar det gav dem, och inget annat. Behålls de, stannar de i Cloudflare och fortsätter blockera det de innehåller. En anslutning som blockerar adresser kan inte tas bort: Stäng av blockering först, och ta bort den när borttagningen är klar.

## Felsökning

Anslutningens **Senaste fel** behåller hela felmeddelandet, med inloggningsuppgifter dolda. När en anslutning har ett fel väljer du **Visa fel** i dess kolumn **Åtgärder** för att läsa det, och **Kopiera fel** i dialogen för att kopiera det. Varje meddelande nämner den begäran som misslyckades och citerar Cloudflares egen orsak.

:::details Senaste fel lyder `Invalid API Token (1000)`
Cloudflare känner inte till token: den har tagits bort, förnyats eller aldrig klistrats in helt. En Global API Key avvisas innan den skickas. Skapa en token som ovan, och spara den med **Uppdatera inloggningsuppgifter**.
:::

:::details Senaste fel lyder `Unauthorized to access requested resource (9109)`
Token kan inte lista zoner. Ge den `Zone > Zone > Read`, med de zoner som ska importeras under **Zone Resources**.
:::

:::details Senaste fel lyder `cannot read the analytics of`
Token saknar `Zone > Analytics > Read` på de zoner som meddelandet nämner. Lägg till den där, och använd sedan **Importera det här tidsintervallet** för att hämta in det som inte importerades.
:::

:::details Senaste fel lyder `rate limit`
Något annat som använder samma Cloudflare-användare har förbrukat sin kvot. Hämtningen fortsätter av sig själv när de fem minuterna har gått; ge OneUptime en token från en egen användare för att hålla isär kvoten.
:::

:::details Senaste fel säger `did not complete`
Begäran fick inget svar: en tidsgräns, ett namn som inte kan slås upp eller en nekad adress. Kontrollera att OneUptimes app och workers når `api.cloudflare.com`, genom eventuell proxy som du använder.
:::

:::details Ett ärende visar Cloudflares åtgärder, men ingen av adressens begäranden i din app
Bakom Cloudflare kommer din apps förfrågningar från Cloudflares adresser, och besökarens adress är den sista som Cloudflare lägger till i `X-Forwarded-For`. Registrera den headern (`http.request.header.x-forwarded-for`) och anslutningens egen adress (`network.peer.address`) i dina traces. Så länge den här anslutningen finns litar OneUptime på Cloudflares adresser som proxy, så det läser besökaren ur headern och matchar din apps förfrågningar mot adressen som Cloudflare agerade på. En `client.address` som din app kopierar från `CF-Connecting-IP` litas det inte på: Vem som helst som når din app direkt kan skicka den headern.
:::

:::details Blockeringsstatus lyder `already exists in this Cloudflare account`
Ett annat OneUptime-projekt, eller en person, har skapat en lista med namnet `oneuptime_block` eller `oneuptime_challenge`, och OneUptime ändrar aldrig en lista som det inte skapade för det här projektet. Byt namn på listan eller ta bort den i Cloudflare, eller stäng av blockering i projektet som skapade den. OneUptime konfigurerar blockering igen inom 5 minuter.
:::

:::details Testet lyckas, men Last Polled är Never
Avsökningsjobbet har aldrig körts. Läs kontrollerna **Background workers** och **Poll scheduler**. På en egenvärdad installation är den vanliga orsaken `DISABLE_QUEUE_WORKERS=true` på appen, utan en separat worker-distribution som tar jobben: sätt den till `false`, eller kör worker-distributionen (Helm: `worker.enabled: true`, som är `false` som standard).
:::

## Nästa steg

:::cards
- [Säkerhetshändelser](/docs/telemetry/security-events): Sök, korrelera och larma på det du importerar.
- [Säkerhetsärenden](/docs/telemetry/security-cases): Se vad Cloudflare gjorde, bredvid det som nådde din app.
- [Översikt över integrationer](/docs/integrations/index): De andra verktygen du kan ansluta.
:::
