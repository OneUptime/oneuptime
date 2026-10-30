# Google Workspace

Importera granskningsloggarna i [Google Workspace](https://workspace.google.com) till säkerhetshändelserna i OneUptime: inloggningar och det Google flaggade om dem, administratörers ändringar, appar som fått åtkomst till data, enkel inloggning, kontonas egna säkerhetsinställningar och, om du vill, filer som delats utanför organisationen eller laddats ned i Google Drive. Där söker du i dem bredvid dina loggar, spårningar och mätvärden, korrelerar dem med alla andra källor och larmar jouren för de som spelar roll. OneUptime läser dem med ett tjänstkonto som agerar som en av dina administratörer, och ändrar ingenting i Google Workspace.

:::cards
- [Konfigurera anslutningen](#konfigurera-anslutningen): Ett tjänstkonto, domänomfattande delegering och anslutningens formulär.
- [Vad som importeras](#vad-som-importeras): Vilka aktiviteter, och hur var och en blir en säkerhetshändelse.
- [Så fungerar avsökningen](#så-fungerar-avsökningen): Det fönster som varje avsökning läser, och varför det överlappar med 2 timmar.
- [Felsökning](#felsökning): Vad varje fel betyder och vad du ska ändra.
:::

## Så fungerar det

```mermaid title="Från en Google Workspace-aktivitet till en säkerhetshändelse"
flowchart TB
    gws["Google Workspace<br/>registrerar en<br/>aktivitet"] --> poll["OneUptime avsöker<br/>med anslutningens<br/>intervall"]
    poll --> token["Tjänstkontot<br/>agerar som din<br/>administratör"]
    token --> list["Den listar varje<br/>loggs aktiviteter<br/>sedan förra gången"]
    list --> event["Var och en sparas<br/>som en OCSF-händelse<br/>av sitt slag"]
```

Varje minut avsöker OneUptime varje aktiverad anslutning vars avsökningsintervall har passerat. En avsökning loggar in som ditt tjänstkonto för den administratör du anger, och listar varje granskningsloggs aktiviteter sedan förra avsökningen ([Activities: list](https://developers.google.com/admin-sdk/reports/reference/rest/v1/activities/list)): administration, inloggningar, OAuth-token, SAML, kontosäkerhet och, när alternativet **Drive-aktivitet** är påslaget, Drive. Varje händelse i en aktivitet sparas som en [OCSF](https://schema.ocsf.io/)-händelse: en inloggning som en händelse av typen Authentication, en tilldelad administratörsroll som en händelse av typen User Access Management, en inloggning som Google flaggade som ett Detection Finding.

## Innan du börjar

- I OneUptime rollen Project Owner, Project Admin eller Security Admin. Security Member och Security Viewer kan se anslutningar och deras körningshistorik, men inte ändra dem.
- En superadministratör i Google Workspace för att tillåta domänomfattande delegering, och en administratör som tjänstkontot agerar som, med behörigheten Reports. En superadministratör har den.
- Ett Google Cloud-projekt där du kan skapa ett tjänstkonto och slå på Admin SDK API.
- För Drive-aktivitet: en utgåva med granskningsloggen för Drive, till exempel Business Standard, Business Plus, Enterprise eller Education.
- Utgående HTTPS från OneUptimes app och workers till `oauth2.googleapis.com` och `admin.googleapis.com`.

## Konfigurera anslutningen

Anslutningen loggar in med ett tjänstkontos nyckel och [domänomfattande delegering](https://developers.google.com/identity/protocols/oauth2/service-account#delegatingauthority), med ett enda skrivskyddat omfång: `https://www.googleapis.com/auth/admin.reports.audit.readonly`.

:::steps
### Skapa ett tjänstkonto och en nyckel

1. I [Google Cloud-konsolen](https://console.cloud.google.com) väljer du ett projekt, öppnar **APIs & Services → Library**, letar upp **Admin SDK API** och väljer **Enable**.
2. Öppna **IAM & Admin → Service accounts → Create service account**, ge det namnet `oneuptime-security-events` och välj **Done**. Det behöver ingen roll i projektet.
3. Öppna tjänstkontot och kopiera dess **Unique ID**, det klient-ID som delegeringen namnger. På fliken **Keys** väljer du **Add key → Create new key → JSON** och sparar filen: den är nyckeln.

### Tillåt domänomfattande delegering

1. I [Googles administratörskonsol](https://admin.google.com) öppnar du som superadministratör **Security → Access and data control → API controls → Manage domain-wide delegation** och väljer **Add new**.
2. Ange tjänstkontots **Unique ID** som **Client ID**, och `https://www.googleapis.com/auth/admin.reports.audit.readonly` som **OAuth scope**. Välj **Authorize**. Det kan ta några minuter innan Google tillämpar det.
3. Om playbooks ska kunna stänga av, häva avstängning av och logga ut användare (se [Begränsning](/docs/telemetry/security-cases#begränsning)) lägger du till `https://www.googleapis.com/auth/admin.directory.user` och `https://www.googleapis.com/auth/admin.directory.user.security` i samma klients omfång, åtskilda med kommatecken. Administratören som anslutningen agerar som måste då vara en som hanterar de användarna.

### Lägg till anslutningen i OneUptime

Öppna **Produkter → Security Events → Anslutningar** (`/dashboard/{projectId}/security-events/connections`), klicka på **Lägg till anslutning**, välj **Google Workspace** under **Identitet** och klicka på **Nästa**. Ange **Administrator email**, klicka på **Nästa** och klistra in nyckelfilens innehåll i **Tjänstkontots JSON**. Slå på **Drive-aktivitet** i steget **Hämtning** för att läsa Drive också.

### Testa den innan du sparar

Klicka på **Testa de här inställningarna** under **Testa innan du sparar**. Testet loggar in och läser inloggnings- och administrationsloggarna med värdena i formuläret, och sparar ingenting, så en saknad delegering syns innan anslutningen finns. Klicka sedan på **Nästa**, ge anslutningen ett **Namn** och skapa den.
:::

| Inställning | Vad du anger |
| --- | --- |
| **Administrator email** | Adressen till den administratör som tjänstkontot agerar som, till exempel `admin@example.com`. Den måste ha behörigheten Reports. |
| **Drive-aktivitet** | Valfritt, avstängt som standard. Påslaget läser varje avsökning också delning och nedladdningar i Drive. |
| **Tjänstkontots JSON** | Hela nyckelfilen, som innehåller `client_email` och `private_key`. Den krypteras, returneras aldrig av API:et och visas aldrig igen. Ersätt den med **Uppdatera inloggningsuppgifter** på anslutningen. |

Steget **Hämtning** har också en valfri **Beskrivning**, **Hämtningsintervall (minuter)**, ett heltal från `1` till `1440` som börjar på `5`, och **Aktiverad**, som börjar påslagen.

## Vad som importeras

Varje händelse har leverantören `Google` och produkten `Google Workspace`. En aktivitet som innehåller flera händelser blir en säkerhetshändelse för var och en, och varje händelse behåller aktivitetens fält och sina egna, som `event.name`, `event.type` och `parameters.<name>`, så att en regel läser dem under Googles namn.

| Logg | Händelser | OCSF-klass | Allvarlighetsgrad |
| --- | --- | --- | --- |
| Inloggningar (`login`) | `login_success`, `login_failure` med orsaken, `login_challenge`. En utloggning läses men importeras inte. | Authentication (`3002`) | Informational; Low för en misslyckad inloggning; Medium när Google märker den som `is_suspicious` |
| Googles fynd (`login`) | `suspicious_login` och dess varianter, `gov_attack_warning`, `account_disabled_hijacked` och de andra konton som Google inaktiverade | Detection Finding (`2004`) | Medium; High för en statsstödd attack, ett kapat konto eller ett läckt lösenord |
| Administration (`admin`) | Administratörsbehörigheter och -roller som tilldelats eller återkallats, domänomfattande delegering, användare som skapats, tagits bort eller stängts av, tvåstegsverifiering som stängts av, gruppmedlemmar, inställningar | User Access Management (`3005`), Account Change (`3001`), Group Management (`3006`), Entity Management (`3004`) | Medium för tilldelad makt; Low för en borttagen användare eller avstängd tvåstegsverifiering |
| OAuth-token (`token`) | En app som fått åtkomst till någons data, med dess omfång, eller som förlorat den åtkomsten | Authorize Session (`3003`) | Informational |
| SAML (`saml`) | Enkel inloggning i en app | Authentication (`3002`) | Low för en misslyckad inloggning |
| Kontosäkerhet (`user_accounts`) | Ändringar av tvåstegsverifiering, lösenord och återställning | Account Change (`3001`) | Low när det försvagar kontot |
| Drive (`drive`), med alternativet påslaget | `change_user_access`, `change_document_visibility`, `change_document_access_scope`, `change_acl_editors`, `download` | File Hosting Activity (`6006`) | Low för en fil som delats utanför ägarens domän eller öppnats för en länk |

Regelbibliotekets regler för Google Workspace läser dem så som de importeras här, som reglerna för en inloggning som Google flaggade, tilldelade administratörsbehörigheter och en fil som gjorts offentlig i Drive.

## Så fungerar avsökningen

- **Aktiviteter läses efter när de inträffade.** Reports API har ingen annan tid att lista dem efter, och Google dokumenterar att dess loggar kommer minuter till timmar för sent.
- **Den första avsökningen ser 24 timmar bakåt**, så att en ny anslutning direkt visar sina senaste aktiviteter.
- **Varje senare avsökning börjar 120 minuter före den sparade markören**, så en aktivitet som Google gör läsbar upp till 2 timmar för sent läses vid nästa avsökning, och dubbletter tas bort efter varje händelses ID inom projektet. En som kommer senare än så läses inte av avsökningen: importera dess tidsintervall från **Diagnostik**.
- **En avsökning läser högst 24 timmar förbi markören.** En anslutning vars markör har hamnat efter kommer ikapp i en serie fönster på 24 timmar.
- **Drive läses en händelse i taget**, eftersom Drive registrerar varje fil som någon öppnar. När Google avvisar loggen för Drive varnar körningen, och de andra loggarna importeras fortfarande.
- **En misslyckad körning ändrar ingenting.** Efter ett nätverksfel, eller en felstatus från Google, förblir markören och fönsterlängden som de var, och nästa avsökning läser samma fönster igen. Det enda undantaget är en begäran som fick tidsgräns: markören stannar, men nästa fönster är hälften så långt, eftersom ett fönster som är för tungt för att besvaras i tid skulle få tidsgräns vid varje försök.

### När ett fönster innehåller mer än en avsökning kan läsa

Varje logg har en egen budget, i sidor med 1 000 aktiviteter: 10 för inloggningar, 5 vardera för administration, OAuth-token och SAML, 3 för kontosäkerhet, och 4 för varje Drive-händelse. En avsökning stoppar efter 4 minuter. När en budget stoppar en logg före slutet av dess fönster är körningen **Delvis**, och dess varning namnger loggen och budgeten. Google listar de nyaste aktiviteterna först, så OneUptime kortar fönstret i stället för att flytta markören förbi aktiviteter som den aldrig nådde:

1. **Smalna av.** Nästa avsökning läser ett fönster som är hälften så långt, från samma startpunkt, och fortsätter att halvera tills ett fönster läses helt, ner till en minut. Körningens varning säger det: `This window holds more records than one poll can read; the next poll reads a {n} minute window from the same starting point.` Aktiviteter som redan har importerats från det längre fönstret hoppas över som dubbletter.
2. **Växa igen.** När ett fönster har lästs helt flyttas markören till dess slut, och nästa fönster är dubbelt så långt igen, upp till 24 timmar.
3. **Gå förbi en enda minut.** Om till och med en minut innehåller mer än en avsökning kan läsa går avsökningen förbi den, så att nyare aktiviteter fortsätter att komma. Körningen förblir **Delvis**, och **Senaste fel** lyder `More records were created in the one minute from {cursor} to {end} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.` Importera den minuten med **Import this time range** för att hämta det som en körning kan läsa.

Att ändra **Hämtningsintervall (minuter)** ändrar inget av detta: det avgör hur ofta en avsökning startar, inte var dess fönster börjar.

### Kör, förhandsgranska och importera vid behov

Klicka på **Diagnostik** på en anslutning för att se dess senaste körningar och arbeta med den manuellt. Alla som kan ändra anslutningen kan starta de här åtgärderna; alla som kan se den kan läsa historiken.

- **Kör nu** startar en avsökning direkt, med den vanliga markören, även när anslutningen inte är **Aktiverad**.
- **Preview audit events** läser ett tidsintervall på upp till 7 dagar och importerar ingenting.
- **Import this time range** importerar ett intervall på upp till 7 dagar, efter att du har bekräftat, utan att flytta markören. Aktiviteter som redan har importerats hoppas över. Google sparar 6 månaders granskningsloggar.
- **Copy diagnostics** på en körning kopierar dess rapport till supporten. Den innehåller aldrig autentiseringsuppgifter.

## Testa anslutningen

**Testa anslutningen** på en anslutnings rad och **Testa de här inställningarna** i formuläret körs i API-processen, inte i en bakgrundsworker, så att ett test svarar även när det är workerna som är problemet. Det kör de här kontrollerna i ordning:

| Kontroll | Vad den kontrollerar |
| --- | --- |
| **Konfiguration** | Administratörens adress och nyckeln är korrekt formaterade. Ingenting kontaktas när detta misslyckas. |
| **Authenticate with Google** | Google låter tjänstkontot agera som administratören: den domänomfattande delegeringen är på plats. |
| **Read the audit logs** | Inloggnings- och administrationsloggarna från de senaste 24 timmarna kan läsas. |
| **Read Drive activity** | Bara med alternativet påslaget: loggen för Drive kan läsas. |
| **Activities available to import** | Hur många inloggnings- och administrationsaktiviteter de senaste 24 timmarna innehåller, högst 1 000 av varje, så `1000+` betyder fler. Inga är en varning. |
| **Background workers**, **Poll scheduler**, **Security event storage** | OneUptimes egen sida: en process tar jobben från Worker-kön, avsökningsjobbet körs varje minut och lagringen för säkerhetshändelser svarar. |
| **Scheduled polling** | För en sparad anslutning: avsökningen är påslagen, ingen körning har fastnat i väntan på en worker och avsökningar körs i tid. |

Varje begäran i ett test har en tidsgräns på 20 sekunder. Ett test importerar aldrig något och flyttar aldrig markören, och varje kontroll som misslyckas säger vad du ska ändra.

## Felsökning

Anslutningens **Senaste fel** sparar hela felmeddelandet, med autentiseringsuppgifter maskerade. När en anslutning har ett fel väljer du **Visa fel** i dess kolumn **Åtgärder** för att läsa det, och **Kopiera fel** i dialogrutan för att kopiera det. Varje meddelande börjar med `Google Workspace`, namnger sedan begäran som misslyckades, och citerar Googles egen orsak.

:::details Senaste fel säger `token request failed`
- `unauthorized_client`: tjänstkontot har ingen domänomfattande delegering för omfånget. Lägg till dess **Unique ID** med `https://www.googleapis.com/auth/admin.reports.audit.readonly` under **Manage domain-wide delegation**.
- `invalid_grant` med `Invalid email or User ID`: **Administrator email** är inte en användare i det här Google Workspace.
- `invalid_grant` med `Invalid JWT Signature`: nyckeln har tagits bort eller inaktiverats. Skapa en ny nyckel och spara den med **Uppdatera inloggningsuppgifter**.
:::

:::details Senaste fel säger `activities request failed (HTTP 403)`
- Orsak `SERVICE_DISABLED` eller `accessNotConfigured`: Admin SDK API är avstängt i tjänstkontots projekt. Slå på det och testa igen om några minuter.
- Orsak `forbidden`: administratören saknar behörigheten Reports. Tilldela den under **Account → Admin roles** i Googles administratörskonsol, eller ange en superadministratör.
:::

:::details Drive-aktivitet läses inte
Loggen för Drive kräver en utgåva som har den, och en administratör med behörigheten Reports. Varje körning varnar `Drive activity was not read`, och de andra loggarna importeras fortfarande. Stäng av **Drive-aktivitet** när din utgåva saknar logg för Drive.
:::

:::details Senaste fel säger `did not complete`
Begäran fick inget svar: en tidsgräns, ett namn som inte kan slås upp eller en nekad adress. Kontrollera att OneUptimes app och workers kan nå `oauth2.googleapis.com` och `admin.googleapis.com`, genom alla proxyservrar du använder.
:::

:::details Testet lyckas, men Last Polled är Never
Avsökningsjobbet har aldrig körts. Läs kontrollerna **Background workers** och **Poll scheduler**. På en egenvärdad installation är den vanliga orsaken `DISABLE_QUEUE_WORKERS=true` på appen, utan en separat worker-distribution som tar jobben: sätt den till `false`, eller kör worker-distributionen (Helm: `worker.enabled: true`, som är `false` som standard).
:::

## Nästa steg

:::cards
- [Säkerhetshändelser](/docs/telemetry/security-events): Sök, korrelera och larma på det du importerar.
- [Microsoft Entra ID](/docs/integrations/microsoft-entra-id): Importera Microsofts inloggningar och katalogändringar.
- [Google SecOps](/docs/integrations/google-secops): Hämta in identifieringarna från Google SecOps också.
- [Översikt över integrationer](/docs/integrations/index): De andra verktygen du kan ansluta.
:::
