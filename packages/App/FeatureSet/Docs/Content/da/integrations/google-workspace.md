# Google Workspace

Importér auditlogs fra [Google Workspace](https://workspace.google.com) i OneUptimes sikkerhedsbegivenheder: logins og det, Google markerede ved dem, administratorers ændringer, apps, der fik adgang til data, single sign-on, kontiens egne sikkerhedsindstillinger og, hvis du vil, filer delt uden for organisationen eller downloadet i Google Drev. Der søger du i dem ved siden af dine logs, traces og metrikker, korrelerer dem med alle andre kilder og kalder vagten op for dem, der betyder noget. OneUptime læser dem med en tjenestekonto, der handler som en af dine administratorer, og ændrer intet i Google Workspace.

:::cards
- [Opsæt forbindelsen](#opsæt-forbindelsen): En tjenestekonto, domænedækkende delegering og forbindelsens formular.
- [Hvad der importeres](#hvad-der-importeres): Hvilke aktiviteter, og hvordan hver bliver en sikkerhedsbegivenhed.
- [Sådan fungerer polling](#sådan-fungerer-polling): Det vindue, hver poll læser, og hvorfor det overlapper med 2 timer.
- [Fejlfinding](#fejlfinding): Hvad hver fejl betyder, og hvad du skal ændre.
:::

## Sådan fungerer det

```mermaid title="Fra en Google Workspace-aktivitet til en sikkerhedsbegivenhed"
flowchart TB
    gws["Google Workspace<br/>registrerer en<br/>aktivitet"] --> poll["OneUptime poller<br/>med forbindelsens<br/>interval"]
    poll --> token["Dens tjenestekonto<br/>handler som din<br/>administrator"]
    token --> list["Den viser hver logs<br/>aktiviteter siden<br/>sidst"]
    list --> event["Hver gemmes som en<br/>OCSF-begivenhed af<br/>sin slags"]
```

Hvert minut poller OneUptime hver aktiveret forbindelse, hvis pollinterval er gået. En poll logger på som din tjenestekonto på vegne af den administrator, du angiver, og viser hver auditlogs aktiviteter siden sidste poll ([Activities: list](https://developers.google.com/admin-sdk/reports/reference/rest/v1/activities/list)): administration, logins, OAuth-tokens, SAML, kontosikkerhed og, når indstillingen **Drev-aktivitet** er slået til, Drev. Hver begivenhed i en aktivitet gemmes som en [OCSF](https://schema.ocsf.io/)-begivenhed: et login som en begivenhed Authentication, en tildelt administratorrolle som en begivenhed User Access Management, et login, Google markerede, som et Detection Finding.

## Før du går i gang

- I OneUptime rollen Project Owner, Project Admin eller Security Admin. Security Member og Security Viewer kan se forbindelser og deres kørselshistorik, men ikke ændre dem.
- En superadministrator i Google Workspace til at tillade domænedækkende delegering, og en administrator, som tjenestekontoen handler som, med rettigheden Reports. En superadministrator har den.
- Et Google Cloud-projekt, hvor du kan oprette en tjenestekonto og slå Admin SDK API til.
- Til Drev-aktivitet: en udgave med Drevs auditlog, som Business Standard, Business Plus, Enterprise eller Education.
- Udgående HTTPS fra OneUptimes app og workere til `oauth2.googleapis.com` og `admin.googleapis.com`.

## Opsæt forbindelsen

Forbindelsen logger på med en tjenestekontos nøgle og [domænedækkende delegering](https://developers.google.com/identity/protocols/oauth2/service-account#delegatingauthority), med ét skrivebeskyttet omfang: `https://www.googleapis.com/auth/admin.reports.audit.readonly`.

:::steps
### Opret en tjenestekonto og en nøgle

1. I [Google Cloud-konsollen](https://console.cloud.google.com) vælger du et projekt, åbner **APIs & Services → Library**, finder **Admin SDK API** og vælger **Enable**.
2. Åbn **IAM & Admin → Service accounts → Create service account**, kald den `oneuptime-security-events`, og vælg **Done**. Den behøver ingen rolle i projektet.
3. Åbn tjenestekontoen, og kopiér dens **Unique ID**, det klient-id, som delegeringen navngiver. På fanen **Keys** vælger du **Add key → Create new key → JSON** og gemmer filen: den er nøglen.

### Tillad domænedækkende delegering

1. I [Google Administrationskonsol](https://admin.google.com) åbner du som superadministrator **Security → Access and data control → API controls → Manage domain-wide delegation** og vælger **Add new**.
2. Angiv tjenestekontoens **Unique ID** som **Client ID**, og `https://www.googleapis.com/auth/admin.reports.audit.readonly` som det eneste **OAuth scope**. Vælg **Authorize**. Google kan bruge et par minutter på at anvende det.

### Tilføj forbindelsen i OneUptime

Åbn **Produkter → Security Events → Forbindelser** (`/dashboard/{projectId}/security-events/connections`), klik på **Tilføj forbindelse**, vælg **Google Workspace** under **Identitet**, og klik på **Næste**. Angiv **Administrator email**, klik på **Næste**, og indsæt nøglefilens indhold i **Tjenestekontoens JSON**. Slå **Drev-aktivitet** til i trinnet **Hentning** for også at læse Drev.

### Test den, før du gemmer

Klik på **Test disse indstillinger** under **Test, før du gemmer**. Testen logger på og læser login- og administrationsloggene med værdierne i formularen og gemmer intet, så en manglende delegering viser sig, før forbindelsen findes. Klik derefter på **Næste**, giv forbindelsen et **Navn**, og opret den.
:::

| Indstilling | Hvad du skal angive |
| --- | --- |
| **Administrator email** | Adressen på den administrator, tjenestekontoen handler som, som `admin@example.com`. Den skal have rettigheden Reports. |
| **Drev-aktivitet** | Valgfri, slået fra som standard. Slået til læser hver poll også deling og downloads i Drev. |
| **Tjenestekontoens JSON** | Hele nøglefilen, der indeholder `client_email` og `private_key`. Den krypteres, returneres aldrig af API'et og vises aldrig igen. Erstat den med **Opdater legitimationsoplysninger** på forbindelsen. |

Trinnet **Hentning** har også en valgfri **Beskrivelse**, **Hentningsinterval (minutter)**, et heltal fra `1` til `1440`, der starter på `5`, og **Aktiveret**, som starter slået til.

## Hvad der importeres

Hver begivenhed har leverandøren `Google` og produktet `Google Workspace`. En aktivitet, der indeholder flere begivenheder, bliver én sikkerhedsbegivenhed for hver, og hver begivenhed beholder aktivitetens felter og sine egne, som `event.name`, `event.type` og `parameters.<name>`, så en regel læser dem under Googles navne.

| Log | Begivenheder | OCSF-klasse | Alvorlighed |
| --- | --- | --- | --- |
| Logins (`login`) | `login_success`, `login_failure` med årsagen, `login_challenge`. Et logout læses, men importeres ikke. | Authentication (`3002`) | Informational; Low for et mislykket login; Medium, når Google markerer det `is_suspicious` |
| Googles fund (`login`) | `suspicious_login` og dens varianter, `gov_attack_warning`, `account_disabled_hijacked` og de andre konti, Google deaktiverede | Detection Finding (`2004`) | Medium; High for et regeringsstøttet angreb, en kapret konto eller en lækket adgangskode |
| Administration (`admin`) | Administratorrettigheder og -roller tildelt eller tilbagekaldt, domænedækkende delegering, brugere oprettet, slettet eller suspenderet, totrinsbekræftelse slået fra, gruppemedlemmer, indstillinger | User Access Management (`3005`), Account Change (`3001`), Group Management (`3006`), Entity Management (`3004`) | Medium for tildelt magt; Low for en slettet bruger eller totrinsbekræftelse slået fra |
| OAuth-tokens (`token`) | En app, der fik adgang til nogens data, med dens omfang, eller som mistede den adgang | Authorize Session (`3003`) | Informational |
| SAML (`saml`) | Single sign-on til en app | Authentication (`3002`) | Low for et mislykket login |
| Kontosikkerhed (`user_accounts`) | Ændringer af totrinsbekræftelse, adgangskode og gendannelse | Account Change (`3001`) | Low, når det svækker kontoen |
| Drev (`drive`), med indstillingen slået til | `change_user_access`, `change_document_visibility`, `change_document_access_scope`, `change_acl_editors`, `download` | File Hosting Activity (`6006`) | Low for en fil delt uden for ejerens domæne eller åbnet for et link |

Regelbibliotekets regler for Google Workspace læser dem, som de importeres her, som reglerne for et login, Google markerede, tildelte administratorrettigheder og en fil, der er gjort offentlig i Drev.

## Sådan fungerer polling

- **Aktiviteter læses efter, hvornår de skete.** Reports API har intet andet tidspunkt at vise dem efter, og Google dokumenterer, at dets logs ankommer minutter til timer for sent.
- **Den første poll ser 24 timer tilbage**, så en ny forbindelse straks viser sine nylige aktiviteter.
- **Hver senere poll starter 120 minutter før den gemte markør**, så en aktivitet, som Google gør læsbar op til 2 timer for sent, læses ved den næste poll, og dubletter kasseres efter hver begivenheds id i projektet. En, der ankommer senere end det, læses ikke af pollingen: importér dens tidsinterval fra **Diagnosticering**.
- **En poll læser højst 24 timer forbi markøren.** En forbindelse, hvis markør er kommet bagud, indhenter i en række vinduer på 24 timer.
- **Drev læses én begivenhed ad gangen**, da Drev registrerer hver fil, nogen åbner. Når Google afviser Drevs log, advarer kørslen, og de andre logs importeres stadig.
- **En mislykket kørsel ændrer intet.** Efter en netværksfejl, eller en fejlstatus fra Google, forbliver markøren og vindueslængden, som de var, og den næste poll læser det samme vindue igen. Den eneste undtagelse er en anmodning, der fik timeout: markøren bliver, men det næste vindue er halvt så langt, fordi et vindue, der er for tungt til at blive besvaret i tide, ville få timeout ved hvert forsøg.

### Når et vindue indeholder mere, end én poll kan læse

Hver log har sit eget budget, i sider med 1.000 aktiviteter: 10 til logins, 5 hver til administration, OAuth-tokens og SAML, 3 til kontosikkerhed og 4 til hver Drev-begivenhed. En poll stopper efter 4 minutter. Når et budget stopper en log før slutningen af dens vindue, er kørslen **Delvis**, og dens advarsel navngiver loggen og budgettet. Google viser de nyeste aktiviteter først, så OneUptime forkorter vinduet i stedet for at flytte markøren forbi aktiviteter, den aldrig nåede:

1. **Indsnævr.** Den næste poll læser et vindue, der er halvt så langt, fra det samme startpunkt, og bliver ved med at halvere, indtil et vindue læses helt, ned til ét minut. Kørslens advarsel siger det: `This window holds more records than one poll can read; the next poll reads a {n} minute window from the same starting point.` Aktiviteter, der allerede er importeret fra det længere vindue, springes over som dubletter.
2. **Voks igen.** Når et vindue er læst helt, flyttes markøren til dets slutning, og det næste vindue er igen dobbelt så langt, op til 24 timer.
3. **Gå forbi et enkelt minut.** Hvis selv ét minut indeholder mere, end en poll kan læse, går pollingen forbi det, så nyere aktiviteter bliver ved med at komme. Kørslen forbliver **Delvis**, og **Seneste fejl** lyder `More records were created in the one minute from {cursor} to {end} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.` Importér det minut med **Import this time range** for at hente det, én kørsel kan læse.

At ændre **Hentningsinterval (minutter)** ændrer intet af dette: det afgør, hvor ofte en poll starter, ikke hvor dens vindue begynder.

### Kør, se forhåndsvisning og importér efter behov

Klik på **Diagnosticering** på en forbindelse for at se dens seneste kørsler og arbejde med den manuelt. Alle, der kan ændre forbindelsen, kan starte disse handlinger; alle, der kan se den, kan læse historikken.

- **Kør nu** starter straks en poll med den sædvanlige markør, også når forbindelsen ikke er **Aktiveret**.
- **Preview audit events** læser et tidsinterval på op til 7 dage og importerer intet.
- **Import this time range** importerer et interval på op til 7 dage, efter at du har bekræftet, uden at flytte markøren. Aktiviteter, der allerede er importeret, springes over. Google gemmer 6 måneders auditlogs.
- **Copy diagnostics** på en kørsel kopierer dens rapport til support. Den indeholder aldrig legitimationsoplysninger.

## Test forbindelse

**Test forbindelse** på en forbindelses række og **Test disse indstillinger** i formularen kører i API-processen, ikke i en baggrundsworker, så en test også svarer, når det er workerne, der er problemet. Den kører disse kontroller i rækkefølge:

| Kontrol | Hvad den kontrollerer |
| --- | --- |
| **Konfiguration** | Administratorens adresse og nøglen er velformede. Der kontaktes intet, når dette mislykkes. |
| **Authenticate with Google** | Google lader tjenestekontoen handle som administratoren: den domænedækkende delegering er på plads. |
| **Read the audit logs** | Login- og administrationsloggene fra de seneste 24 timer kan læses. |
| **Read Drive activity** | Kun med indstillingen slået til: Drevs log kan læses. |
| **Activities available to import** | Hvor mange login- og administrationsaktiviteter de seneste 24 timer indeholder, højst 1.000 af hver, så `1000+` betyder flere. Ingen er en advarsel. |
| **Background workers**, **Poll scheduler**, **Security event storage** | OneUptimes egen side: en proces tager jobbene fra Worker-køen, poll-jobbet kører hvert minut, og lageret for sikkerhedsbegivenheder svarer. |
| **Scheduled polling** | For en gemt forbindelse: polling er slået til, ingen kørsel sidder fast og venter på en worker, og polls kører til tiden. |

Hver anmodning i en test har en frist på 20 sekunder. En test importerer aldrig noget og flytter aldrig markøren, og hver mislykket kontrol siger, hvad du skal ændre.

## Fejlfinding

Forbindelsens **Seneste fejl** gemmer hele fejlmeddelelsen, med legitimationsoplysninger maskeret. Når en forbindelse har en fejl, vælger du **Vis fejl** i dens kolonne **Handlinger** for at læse den og **Kopiér fejl** i dialogen for at kopiere den. Hver meddelelse starter med `Google Workspace`, navngiver derefter den anmodning, der mislykkedes, og citerer Googles egen årsag.

:::details Seneste fejl siger `token request failed`
- `unauthorized_client`: tjenestekontoen har ingen domænedækkende delegering til omfanget. Tilføj dens **Unique ID** med `https://www.googleapis.com/auth/admin.reports.audit.readonly` under **Manage domain-wide delegation**.
- `invalid_grant` med `Invalid email or User ID`: **Administrator email** er ikke en bruger i dette Google Workspace.
- `invalid_grant` med `Invalid JWT Signature`: nøglen er slettet eller deaktiveret. Opret en ny nøgle, og gem den med **Opdater legitimationsoplysninger**.
:::

:::details Seneste fejl siger `activities request failed (HTTP 403)`
- Årsag `SERVICE_DISABLED` eller `accessNotConfigured`: Admin SDK API er slået fra i tjenestekontoens projekt. Slå den til, og test igen om et par minutter.
- Årsag `forbidden`: administratoren mangler rettigheden Reports. Tildel den under **Account → Admin roles** i Google Administrationskonsol, eller angiv en superadministrator.
:::

:::details Drev-aktivitet læses ikke
Drevs log kræver en udgave, der har den, og en administrator med rettigheden Reports. Hver kørsel advarer `Drive activity was not read`, og de andre logs importeres stadig. Slå **Drev-aktivitet** fra, når din udgave ikke har en Drev-log.
:::

:::details Seneste fejl siger `did not complete`
Anmodningen fik intet svar: en timeout, et navn, der ikke kan slås op, eller en afvist adresse. Tjek, at OneUptimes app og workere kan nå `oauth2.googleapis.com` og `admin.googleapis.com`, gennem enhver proxy, du bruger.
:::

:::details Testen lykkes, men Last Polled er Never
Poll-jobbet har aldrig kørt. Læs kontrollerne **Background workers** og **Poll scheduler**. På en selvhostet installation er den sædvanlige årsag `DISABLE_QUEUE_WORKERS=true` på appen, uden en separat worker-udrulning, der tager jobbene: sæt den til `false`, eller kør worker-udrulningen (Helm: `worker.enabled: true`, som er `false` som standard).
:::

## Næste trin

:::cards
- [Sikkerhedsbegivenheder](/docs/telemetry/security-events): Søg, korrelér og advar på det, du importerer.
- [Microsoft Entra ID](/docs/integrations/microsoft-entra-id): Importér Microsofts logins og mappeændringer.
- [Google SecOps](/docs/integrations/google-secops): Hent også registreringer fra Google SecOps ind.
- [Oversigt over integrationer](/docs/integrations/index): De andre værktøjer, du kan forbinde.
:::
