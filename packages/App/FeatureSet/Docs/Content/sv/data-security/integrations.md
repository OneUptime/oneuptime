# Integrationer för Datasäkerhet

Datasäkerhet har ingen egen personsökning eller säkerhetskö. Den lämnar det den hittar till de delar av OneUptime som redan har det: ett kritiskt problem blir ett säkerhetsärende, det kan larma den som har jour eller deklarera en incident, och varje nytt problem skickas med e-post till datalagrets ägare. Arbetsflöden, OneUptime AI, API:t, Terraform och MCP-servern når allt som den sparar.

:::cards
- [Security Operations](#security-operations): Ett säkerhetsärende för varje datalager med ett kritiskt problem.
- [Larm och jour](#larm-och-jour): Larma den som har jour när ett kritiskt problem öppnas.
- [Incidenter](#incidenter): Deklarera en incident för ett intrång som din incidentprocess ska hantera.
- [Ägare](#ägare): Vem som äger varje datalager, angivet för hand eller via regler, och e-postmeddelandet de får.
- [OneUptime AI](#oneuptime-ai): Förklara ett problem, öppna en pull request som åtgärdar det, eller ställ frågor om dina data till Fråga AI.
- [Stäng en exponering](#stäng-en-exponering): Blockera offentlig åtkomst eller sluta dela, från ett problem eller en playbook, och slå på ett skydd som saknas från ett problem.
:::

## Så fungerar det

```mermaid title="Vad som följer på ett nytt problem"
flowchart TB
    issue["Ett problem<br/>öppnas,<br/>eller<br/>öppnas igen"] --> critical{"Är det kritiskt?"}
    critical -->|"Ja"| soc["Ett<br/>säkerhetsärende<br/>om datalagret"]
    critical -->|"Ja, om larm är på"| alert["Ett larm som når<br/>den som har jour"]
    critical -->|"Ja, om<br/>incidenter är på"| incident["En incident<br/>som din<br/>process hanterar"]
    issue --> owners["Ett<br/>e-postmeddelande<br/>till datalagrets<br/>ägare"]
    issue --> flows["Arbetsflöden som<br/>bevakar problem"]
```

Var och en av dessa körs när en utvärdering öppnar ett problem, eller öppnar ett igen. Var och en görs i mån av möjlighet: problemet är redan öppet och finns redan på sin tidslinje, så en integration som misslyckas loggas och hoppas över, och görs aldrig om så att den blir ett andra ärende eller ett andra larm. Det som var och en gjorde skrivs till problemets **Tidslinje**, och problemets sida länkar till ärendet, larmet och incidenten som det startade.

| Inställning | Standard | Vad den gör |
| --- | --- | --- |
| **Öppna säkerhetsärenden** | På | Ett kritiskt problem öppnar ett säkerhetsärende, grupperat efter datalager. |
| **Skapa larm** | Av | Ett kritiskt problem skapar ett larm, som larmar den som har jour. |
| **Larmallvar** | Tom | Allvarlighetsgraden för de larmen. Tom är projektets allvarligaste. |
| **Deklarera incidenter** | Av | Ett kritiskt problem deklarerar en incident, som din incidentprocess hanterar. |
| **Incidentallvar** | Tom | Allvarlighetsgraden för de incidenterna. Tom är projektets allvarligaste. |
| **Avisera ägare** | På | Varje nytt problem skickas med e-post till datalagrets ägare. |

## Security Operations

Varje datalager är en egen entitet i Security Operations, av typen **Datalager**. Med **Öppna säkerhetsärenden** påslaget skickas ett kritiskt problem till Security Operations som en detektion om datalagret:

- dess källa är **Datasäkerhet**, och dess regel är uppkallad efter kontrollen, till exempel `Data Security: public-read`;
- den är kritisk, så ärendet den öppnar får projektets kritiska prioritet;
- den grupperas efter datalagret: ett andra kritiskt problem på samma datalager läggs till i det öppna ärendet om det i stället för att öppna ett nytt.

Därifrån hanteras ärendet som vilket annat som helst: det tilldelas, får anteckningar, stängs och besvaras av projektets playbooks. Datalagrets detektioner räknas in i dess risk under [Entitetsrisk](/docs/telemetry/security-entity-risk), precis som för alla andra entiteter. Se [Säkerhetsärenden och playbooks](/docs/telemetry/security-cases).

Varje säkerhetsärende, oavsett vad som öppnade det, visar data i riskzonen under **Påverkan**: de datalager med känsliga data som ärendet gäller, och varje datalager som dess användare och roller kan nå, det känsligaste först, med vad vart och ett innehåller, ungefär hur många poster, hur exponerat det är och hur många identiteter som kan nå det. En antagen rollsession som ärendet nämner räknas som sin roll, och en e-postadress som de molnanvändare den hör till. Det läses med läsarens egna behörigheter, så en roll som inte får läsa Datasäkerhet ser att den här delen är utelämnad.

## Larm och jour

Med **Skapa larm** påslaget skapar ett kritiskt problem ett larm, med namnet ”Data Security:” följt av problemets titel och datalagret. Larmet når den som har jour via sina egna regler, som vilket annat larm som helst (se [Larm](/docs/alerts/index) och [Jour](/docs/on-call/index)). Ett problem har högst ett öppet larm åt gången, hur ofta det än utvärderas. **Larmallvar** anger larmets allvarlighetsgrad; lämnas den tom är det projektets allvarligaste.

Ett larm avslutas tillsammans med sitt problem: när problemet inte längre är öppet – dess kontroll godkänns, eller en person markerar det som löst, accepterar dess risk eller säger att det inte är ett problem – löses larmet, och problemets **Tidslinje** anger det. Ett problem som öppnas igen skapar ett nytt larm.

Larm är avstängda som standard eftersom de flesta team vill se ett fynd från datasäkerheten i ett säkerhetsärende först. Slå på dem när en offentlig bucket med kortnummer ska väcka någon.

## Incidenter

Med **Deklarera incidenter** påslaget deklarerar ett kritiskt problem en incident, namngiven på samma sätt som problemets larm, för ett intrång som din incidentprocess ska hantera: jour, kanaler i arbetsytan, statussidor och en postmortem (se [Incidenter](/docs/incidents/index)). Ett problem har högst en öppen incident åt gången. **Incidentallvar** anger incidentens allvarlighetsgrad; lämnas den tom är det projektets allvarligaste.

Datasäkerhet löser aldrig en incident, inte ens när dess problem har lösts: en incident kan ha en statussida och en postmortem, så den som hanterar den stänger den. Ett säkerhetsärende är den andra vägen till en incident: **Deklarera incident** på ärendet öppnar en som är länkad till det (se [Deklarera en incident](/docs/telemetry/security-cases#deklarera-en-incident)).

## Ägare

Ett datalagers ägare är personer och team, på datalagrets sida **Ägare**. Det är dem ett problem är till för: de får e-postmeddelandet, och **Ingen äger detta känsliga datalager** misslyckas för ett känsligt datalager som inte har några.

Med **Avisera ägare** påslaget skickar varje utvärdering som öppnar problem på ett datalager ett e-postmeddelande till dess ägare – personerna som äger det, och medlemmarna i de team som gör det, upp till 50 – med en rubrik som anger hur många nya problem datalagret har, till exempel ”Data Security: 2 new issues on orders-db”. Det listar varje nytt problems allvarlighetsgrad och titel och datalagrets känslighet, och länkar till datalagret. Det innehåller aldrig något prov.

Medan OneUptime AI själv arbetar med nya problem väntar e-postmeddelandet på dess analys, i upp till 10 minuter, och ger varje analyserat problem två rader till: dess bedömning och varför, och den kortaste vägen till åtgärdat. Varje ägare får de rader ägaren får läsa: en ägare som inte får läsa problemet får inga, och en rad som bygger på något ägaren inte får läsa utelämnas.

### Ägarregler och etikettregler

Regler anger ägare och etiketter åt dig, när datalager hittas:

| Regel | Var | Vad den gör |
| --- | --- | --- |
| **Ägarregler** | **Datasäkerhet → Regler → Ägarregler** | Lägger till ägaranvändare och ägarteam på varje datalager som matchar |
| **Etikettregler** | **Datasäkerhet → Regler → Etikettregler** | Lägger till etiketter på varje datalager som matchar |

En regel matchar ett datalager via dess etiketter, via ett mönster för dess namn eller beskrivning, eller via **Molntaggmönster**: ett mönster som matchas mot var och en av datalagrets molntaggar, skrivna `key=value`. `^team=payments$` matchar varje datalager som är taggat `team=payments`, och `^env=` varje datalager med en `env`-tagg. Ett nytt datalager får projektets regler i samma ögonblick som det hittas, och en ägarregels **Avisera ägare** anger om de ägare som den lägger till underrättas. [Etikett- och ägarregler](/docs/configuration/label-and-owner-rules) beskriver hur varje regel matchar och när regler körs.

## Arbetsflöden

**Datalager** och **Datasäkerhetsproblem** är utlösare för arbetsflöden, var och en med **Vid skapande**, **Vid uppdatering**, **Vid skapande eller uppdatering** och **Vid borttagning**. Välj dem i panelen **Lägg till utlösare**, under **OneUptime-resurser**.

- **Datasäkerhetsproblem → Vid skapande** körs när ett problem öppnas för första gången. Läs dess allvarlighetsgrad i ett block av typen **Om / Annars**, och posta kritiska problem i en kanal eller öppna en ticket i ditt ärendesystem.
- **Datasäkerhetsproblem → Vid uppdatering**, med **Fält att bevaka** inställt på dess status, körs när ett problem löses, accepteras eller öppnas igen.
- **Datalager → Vid skapande** körs när upptäckten hittar ett datalager, till exempel för att berätta för ett team om varje ny bucket.

Se [Utlösare för arbetsflöden](/docs/workflows/triggers) för de fält som varje utlösare skickar vidare.

## OneUptime AI

Två åtgärder på ett problem ber OneUptime AI om hjälp. Båda skickar till OneUptime AI problemets titel och allvarlighetsgrad, datalagrets namn, typ, region och moln-ID, dess känslighet och datatyper, var och en med sitt namn (dina egna datatyper med namnet du gav dem), bevisen, varför kontrollen spelar roll och åtgärden för datalagrets moln – aldrig ett fynds prov. Båda körs under projektets reglage och gränser för OneUptime AI. Vad var och en skickar, vad den aldrig skickar och vilken modell den körs på finns på [OneUptime AI i Datasäkerhet](/docs/data-security/ai).

- **Analysera problemet**, högst upp på problemets sida, låter OneUptime AI skriva sin analys: om problemet är verkligt, vad det sätter på spel, vad åtgärden skulle förstöra och den kortaste vägen till åtgärdat (se [Datasäkerhetskontroller och problem](/docs/data-security/checks-and-issues)). Den skickar också vem som kan nå lagret - varje behörighet och ungefär när den senast användes, och de tjänster som setts använda det -, kopior av dess data i andra lager, dess säkerhetsärenden, den responsåtgärd som åtgärdar problemet, det repository och de filer som deklarerar lagret, och hur många ägare det har, aldrig vilka de är. Analysen sparas på problemet, dess bedömning i problemets **Tidslinje**. Varken det som skickades eller svaret sparas i **Projektinställningar → AI → AI-loggar**, som alla med rollen Projektmedlem eller Tittare kan läsa: den raden säger bara att anropet gjordes och vad det kostade. Alla som kan läsa problemet kan be om den, och **Förklara med AI** via API:et och MCP-servern svarar med samma analys.
- **Åtgärda med AI** ber OneUptime AI att åtgärda problemet i din infrastrukturkod – Terraform, CloudFormation, Bicep eller liknande – med den minsta ändring som får kontrollen att godkännas, och att öppna en pull request. Den kräver att arkivet som innehåller datalagrets infrastrukturkod är anslutet under **Kod**: välj det under **Arkiv** när du kan fråga i flera. Pull requesten visas under **Kod** (se [Kod](/docs/ai/ai-agent)). Rollen Säkerhetsmedlem och högre kan fråga, i ett arkiv som de får ändra under **Kod**, som det krävs för att fråga AI där: en säkerhetsroll läser och ändrar inga arkiv på egen hand, så ge också deras team **Read Code Repository** och **Edit Code Repository**. När AI inte kan arbeta nu – den är avstängd, projektet har slut på AI-krediter, de dagliga gränserna är nådda eller ingen Runner är online – säger Åtgärda med AI vad som behöver åtgärdas och startar ingenting.

OneUptime AI arbetar också på egen hand med varje nytt problem, som dina AI-regler tillåter: se [OneUptime AI i datasäkerhet](/docs/data-security/ai).

### Fråga AI

**Fråga AI** läser också Datasäkerhet. På vilken sida i Datasäkerhet som helst kan du fråga vilka datalager som innehåller kortnummer, vad du ska åtgärda först, eller vilka datalager en roll skulle kunna nå om den läckte; på ett datalagers eller ett problems sida läser den den posten först. Den svarar med tre läsverktyg, som körs med dina egna behörigheter:

| Verktyg | Vad det läser |
| --- | --- |
| `query_data_stores` | Datalagren, de mest riskfyllda först, efter känslighet, datatyp, exponering, leverantör eller namn – eller ett datalager med vad som hittades var, vem som kan nå det och dess öppna problem |
| `query_data_security_issues` | Problemen, de mest riskfyllda först, efter status, allvarlighetsgrad, datalager eller kontroll – eller ett problem med dess bevis och åtgärden för dess moln |
| `query_data_store_access` | Vem som kan nå ett datalager, eller varje datalager som ett huvudkonto kan nå |

De läser datatyper, platser och antal, aldrig ett fynds prov, maskerade eller inte. Fråga AI ändrar ingenting i Datasäkerhet.

## Stäng en exponering

Två ändringar stänger ett molndatalagers exponering, var och en via datalagrets molnanslutning med **Datasäkerhetsrespons** påslaget (se [Konfigurera Datasäkerhet](/docs/data-security/setup#låt-datasäkerhet-stänga-en-exponering)), och sex till slår på en inställning som skyddar ett datalager, bara från dess problem:

- **Blockera offentlig åtkomst**, på en S3-bucket, ett Azure-lagringskonto eller en Cloud Storage-bucket.
- **Återkalla delning**, på en RDS-ögonblicksbild, eller på de delade manuella ögonblicksbilderna av en RDS-databas, ett Aurora-kluster eller ett DocumentDB-kluster.
- **Slå på versionshantering**, **Slå på mjuk borttagning**, **Stäng av objekt-ACL:er**, **Slå på enhetlig åtkomst**, **Kräv säker överföring** och **Slå på återställning till en tidpunkt**, på de datalager som [Åtgärda härifrån](/docs/data-security/checks-and-issues#åtgärda-härifrån) listar.

En person kör en av dem från ett öppet problem som den åtgärdar, med **Åtgärda härifrån** (se [Kontroller och problem i Datasäkerhet](/docs/data-security/checks-and-issues#åtgärda-härifrån)). En playbook i Security Operations kör dem som steg i kategorin **Begränsa**, **Blockera offentlig åtkomst till datalager** och **Återkalla delning av datalager**: på varje datalager som ärendet gäller, högst 10, vart och ett ett steg som börjar med **Kräver godkännande** påslaget. Ett datalager som är markerat **Offentlig avsiktligt** blockeras aldrig. I båda fallen anger datalagrets tidslinje vad som gjordes, och datalagret kontrolleras igen direkt, så problemet löses när ändringen har fått effekt.

Playbook-mallen **Stäng en dataexponering** besvarar de ärenden som Datasäkerhet öppnar: den skickar e-post till datalagrets ägare, blockerar offentlig åtkomst och återkallar delning när en person har godkänt varje steg, och lägger till responsens checklista i ärendet som uppgifter – vem som läste data medan de var exponerade, om det är ett intrång som du måste anmäla, vilka hemligheter som ska roteras och vad som ska skrivas när ärendet stängs. Lägg till den från **Skapa från mall** bland projektets playbooks.

## API, Terraform och MCP

Allt som Datasäkerhet sparar är en post i OneUptimes API, som läses med samma behörigheter som i instrumentpanelen (se [API-referensen](/docs/api-reference/api-reference)):

| Poster | API-sökväg |
| --- | --- |
| Datalager, deras tidslinjer, deras fynd, vem som kan nå dem och varje identitet som kan det | `/data-store`, `/data-store-feed`, `/data-store-finding`, `/data-store-access`, `/data-security-identity` |
| Problem, deras tidslinjer och dataflöden | `/data-security-issue`, `/data-security-issue-feed`, `/data-security-flow` |
| Skanningar | `/data-security-scan` |
| Anpassade datatyper, kontrollinställningar, efterlevnadsinställningar och hemvistregler | `/data-security-custom-data-type`, `/data-security-check-setting`, `/data-security-compliance-setting`, `/data-security-residency-rule` |
| Projektets inställningar | `/data-security-setting` |
| Ägare, ägarregler och etikettregler | `/data-store-owner-user`, `/data-store-owner-team`, `/data-store-owner-rule`, `/data-store-label-rule` |
| Vad OneUptime AI föreslår för ett problem, och varför den agerade eller inte agerade på ett | `/data-security-ai-proposal`, `/data-security-ai-decision` |

Några svar räknas ut på begäran i stället för att lagras. Vart och ett är en `POST`:

| Sökväg | Vad den gör |
| --- | --- |
| `/data-security/overview` | Översiktens siffror: datalager efter känslighet och kategori, öppna problem efter allvarlighetsgrad, de mest riskfyllda problemen och de senaste 30 dagarna av dem |
| `/data-security/compliance` | Varje ramverks poäng och krav |
| `/data-security/resource-scope` | Datalagren för en resurs – ett Kubernetes-kluster, en Docker- eller Podman-värd, en databas, en tjänst eller en molnresurs – och vilken resurs efterlevnadsreglage de följer |
| `/data-security/resource-compliance` | En resurs ramverk: deras poäng för resursens datalager, och vad som är avstängt för den |
| `/data-security/record-of-processing` | GDPR-registret över behandling, en rad för varje datalager som innehåller personuppgifter |
| `/data-store/<id>/scan-now` | **Skanna nu**: tar prov på datalagrets innehåll nu |
| `/data-store/<id>/check-now` | **Kontrollera nu**: läser datalagrets konfiguration igen och kör dess kontroller |
| `/data-store-finding/<id>/scrub` | **Rensa** på ett telemetrifynd |
| `/data-store-finding/<id>/drop-metric-impact` | Vad **Kassera det här mätvärdet** skulle kassera för ett fynd i ett mätvärdes namn: hur många mätvärden, och de monitorer, instrumentpaneler, SLO:er och inspelningsregler som läser dem |
| `/data-store-finding/<id>/drop-metric` | **Kassera det här mätvärdet**: en pipelineregel för mätvärden som för gott kasserar de nya datapunkterna från tjänstens mätvärden med ett sådant namn. Den tar `{"confirmDataLoss": true}` |
| `/data-security-issue/<id>/explain` | **Förklara med AI**: OneUptime AI:s analys av ett problem, så som **Analysera problemet** skriver den. Den svarar med den analys som problemet sparar när inget som den bygger på har ändrats, och skriver annars en ny; `{"force": true}` skriver en ny, som **Analysera igen** |
| `/data-security-issue/<id>/analysis` | Den analys som problemet sparar, så som du får läsa den. Den frågar aldrig OneUptime AI |
| `/data-security-issue/<id>/fix-with-ai` | **Åtgärda med AI** på ett problem |
| `/data-store/<id>/response-actions` | Vilka responsåtgärder datalagret kan utföra nu, och varför inte |
| `/data-store/<id>/respond` | En responsåtgärd på datalagret, till exempel **Blockera offentlig åtkomst** eller **Slå på versionshantering**, med problemet som den kördes från |
| `/data-security-ai-proposal/<id>/approve` | **Godkänn** på en ändring som OneUptime AI föreslår, som görs med dina egna behörigheter. Tar `expectedPlanFingerprint` för förslaget som du visades, och avvisar ett som har ändrats sedan dess |
| `/data-security-ai-proposal/<id>/dismiss` | **Avfärda förslaget**, med `{"reason": "..."}`, som läggs på problemets tidslinje |
| `/data-security-ai-proposal/<id>/undo` | **Ångra** på en ändring som OneUptime AI gjorde: den tas tillbaka, och datalagret kontrolleras igen |

[Terraform-providern](/docs/terraform/index) har en resurs för varje sorts post som du skapar – datalager som du lägger till själv, anpassade datatyper, kontrollinställningar, efterlevnadsinställningar, hemvistregler, ägar- och etikettregler – uppkallad efter posten, till exempel `oneuptime_residency_rule`.

[MCP-servern](/docs/ai/mcp-server) har verktyg för att skapa, hämta, lista, uppdatera, ta bort och räkna för de här posterna: Data Store, Data Store Finding, Data Store Access Entry, Data Security Identity, Data Flow, Data Security Issue, Data Security Scan, Custom Data Type, Check Setting, Compliance Setting, Residency Rule och Data Security Setting. En AI-assistent kan då fråga vilka datalager som innehåller kortnummer, eller vad som är öppet på en bucket, med dina behörigheter.

## Nästa steg

:::cards
- [Säkerhetsärenden och playbooks (SOAR)](/docs/telemetry/security-cases): Hantera de ärenden som Datasäkerhet öppnar.
- [Etikett- och ägarregler](/docs/configuration/label-and-owner-rules): Hur regler matchar, och när de körs.
- [Utlösare för arbetsflöden](/docs/workflows/triggers): Kör ett arbetsflöde när ett problem öppnas eller ett datalager hittas.
- [Kontroller och problem i Datasäkerhet](/docs/data-security/checks-and-issues): Vad varje problem betyder, och hur du åtgärdar det.
:::
