# Arbetsflödeskonfiguration & säkerhet

Det här behöver du veta innan du riktar ett arbetsflöde mot riktig trafik: hur du slår på det säkert, vem som får göra vad, hur hemligheter och URL:er förblir privata, vad ett arbetsflödes steg får ändra och de gränser som varje körning arbetar inom.

:::cards
- [Gå live](#slå-på-eller-av-ett-arbetsflöde): Testa med Kör arbetsflöde och låt sedan arbetsflödet vara påslaget.
- [Behörigheter](#behörigheter): Arbetsflödesrollerna och de enskilda behörigheterna bakom dem.
- [Vad steg får göra](#vad-arbetsflödessteg-får-göra): Steg agerar som Project Admin i arbetsflödets projekt.
- [Gränser](#plangränser): Körningar per plan, körtid och anrop mellan arbetsflöden.
:::

## Slå på eller av ett arbetsflöde

Varje arbetsflöde har en brytare, **Aktiverad**, högst upp i sin **Byggare** och på sin sida **Översikt**. När den är avslagen körs inte arbetsflödet — webhook-anrop, inkommande e-post, schemalagda tider och OneUptime-händelser ignoreras alla, och det gör även **Kör arbetsflöde** och **Run just this step**. Nya arbetsflöden börjar inaktiverade.

Använd den här brytaren som din ”redo att köra”-spärr:

:::steps
1. Bygg arbetsflödet.
2. Klicka på **Kör arbetsflöde** i **Byggare** med realistiska värden. Ett inaktiverat arbetsflöde kan inte köras ens manuellt, så Byggare ber dig först att slå på det: klicka på **Slå på och kör**.
3. Öppna körningen och kontrollera att varje block gick dit du förväntade dig. Se [Körningar](/docs/workflows/runs-and-logs).
4. Låt **Aktiverad** vara påslagen om det är klart. Är det inte det slår du av det tills det är klart: medan det är påslaget aktiveras dess utlösare av riktiga händelser.
:::

Att slå av ett arbetsflöde hindrar nya körningar från att starta. En körning som redan pågår gör klart, men en körning som väntar vid ett **Sleep**-block avbryts när den vaknar.

## Arkivera ett arbetsflöde

Arkivera ett arbetsflöde som du inte längre behöver men vill behålla. Ett arkiverat arbetsflöde:

- **Körs aldrig**, från någon utlösare. Manuella körningar och **Run just this step**, webhook-anrop, scheman, OneUptime-händelser, inkommande e-post och andra arbetsflödens **Execute Workflow**-steg avvisas alla. Ett webhook-anrop till ett arkiverat arbetsflöde får ett fel som säger att arbetsflödet är arkiverat.
- **Stoppar körningar som väntar.** En körning som sover i ett **Sleep**-steg avbryts när den vaknar, och en körning som stod i kö men ännu inte hade startat slutar med "Workflow was archived before this run started, so it did not run."
- **Försvinner från listan över arbetsflöden.** Du hittar det under **Arbetsflöden → Avancerad → Arkiverad**.
- **Behåller allt.** Dess steg, variabler, ägare, etiketter och körningshistorik förblir som de var.

För att arkivera ett arbetsflöde öppnar du det, går till **Inställningar** och klickar på **Arkivera**. För att arkivera flera markerar du dem i listan **Arbetsflöden** och väljer **Arkivera**.

För att få tillbaka ett arbetsflöde öppnar du **Arbetsflöden → Avancerad → Arkiverad**, markerar det och väljer **Avarkivera**, eller så öppnar du det och klickar på **Avarkivera** i banderollen högst upp på dess sidor.

Arkivering och brytaren **Aktiverad** är två skilda saker. Arkivering rör inte brytaren, så ett arbetsflöde som var påslaget körs igen så snart det avarkiveras, och ett som var avslaget förblir avslaget. Sidan **Arkiverad** visar i sin kolumn **When Unarchived** vilket som är vilket.

Ett exporterat arbetsflöde tar aldrig med sitt arkiverade läge, så en importerad kopia är aldrig arkiverad.

## Ägare och etiketter

| Vad               | Var                                                | Vad det gör                                                                                                                                               |
| ----------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ägare**         | Arbetsflödets sida **Ägare**                       | Användarna och teamen som ansvarar för arbetsflödet. En roll som är begränsad till det dess team äger når de arbetsflöden som det teamet äger.             |
| **Etiketter**     | Arbetsflödets sida **Översikt**                    | Märkningar för att gruppera arbetsflöden efter team, integration eller miljö. Filtrera listan **Arbetsflöden** på etikett och begränsa en roll till vissa etiketter. |
| **Etikettregler** | **Arbetsflöden → Inställningar → Etikettregler**   | Sätt etiketter på nya arbetsflöden automatiskt, utifrån mönster i deras namn eller beskrivning.                                                           |
| **Ägarregler**    | **Arbetsflöden → Inställningar → Ägarregler**      | Tilldela ägare till nya arbetsflöden automatiskt.                                                                                                         |

Se [Etikett- och ägarregler](/docs/configuration/label-and-owner-rules) för hur reglerna matchar.

## Hemligheter

Markera en variabel som **hemlig** om den innehåller något känsligt: dess värde rensas då bort från körningsloggar och stegspår. Ingen variabels värde kan läsas tillbaka när det har sparats, hemligt eller inte, varken i instrumentpanelen eller via API:t, och när en variabel väl är hemlig förblir den hemlig.

Använd hemliga variabler för:

- API-nycklar till externa tjänster.
- Autentiseringstoken.
- Signeringsnycklar för webhooks.
- Allt som du inte vill att någon med bara läsåtkomst ska se.

Klistra inte in en hemlighet direkt i ett block — värden som `Authorization: Bearer eyJh...` blir synliga i arbetsflödet och i loggarna. Använd `{{global.variables.MY_SECRET}}` i stället.

Om hemligheten är en OAuth-åtkomsttoken som går ut gör du variabeln till en [OAuth 2.0-variabel](/docs/workflows/variables#oauth-20-variabler-token-som-förnyar-sig-själva). OneUptime hämtar då token från din identitetsleverantör och förnyar den varje gång ett arbetsflöde är på väg att använda en utgången token. OAuth 2.0-variabler är alltid hemliga, och deras autentiseringsuppgifter är krypterade i databasen.

## Exportera och importera arbetsflöden

Du kan flytta ett arbetsflöde mellan projekt, eller mellan en självhostad installation och OneUptime Cloud, som en JSON-fil.

:::tabs
@tab Exportera
Öppna arbetsflödet, gå till **Inställningar** och klicka på **Exportera Arbetsflöde**. För att lägga flera arbetsflöden i en fil markerar du dem i listan **Arbetsflöden** och väljer **Exportera JSON**.
@tab Importera
Klicka på **Import JSON** i listan **Arbetsflöden** och välj en fil som exporterats från valfritt OneUptime-projekt. Ett arbetsflöde vars namn projektet redan har importeras med "(Imported)" efter namnet.
:::

Filen innehåller arbetsflödets namn, beskrivning, aktiveringsläge och graf. Den innehåller medvetet inte:

- **Webhookens hemliga nyckel.** En ny genereras när arbetsflödet skapas, så ett importerat arbetsflöde har en annan webhook-URL — kopiera den från det nya arbetsflödets Webhook-utlösare. Allt som anropade originalet måste pekas om.
- **Adressen för inkommande e-post.** Ett importerat arbetsflöde med en Incoming Email-utlösare får en egen adress — kopiera den från det nya arbetsflödets utlösare. Allt som skickade e-post till originalet måste få den nya adressen.
- **Globala variabler.** Ett block som läser `{{global.variables.MY_SECRET}}` behåller den referensen, men värdet finns inte i filen. Skapa variablerna i målprojektet innan du kör det importerade arbetsflödet.
- **Ägare och etiketter.** Ditt projekts egna etikett- och ägarregler körs mot det importerade arbetsflödet, precis som om du hade skapat det manuellt.

Ett importerat arbetsflöde skapas alltid **inaktiverat**, även om det var aktiverat där det exporterades från — dess graf kan peka på monitorer, jourpolicyer eller andra arbetsflöden som inte finns i målprojektet. Granska det, aktivera det, testa det med **Kör arbetsflöde** och låt det sedan vara påslaget. Att duplicera ett arbetsflöde fungerar på samma sätt, så att en kopia aldrig börjar köras sida vid sida med originalet innan du har redigerat den.

Eftersom grafen följer med oförändrad följer allt som skrivits direkt i ett block också med. Det är det praktiska skälet till att hålla autentiseringsuppgifter i hemliga variabler: exporterar du ett arbetsflöde med en hårdkodad token ger du den token till den som får filen.

## Webhook-säkerhet

Webhook-utlösare ger dig en unik URL. Alla som känner till URL:en kan anropa den. Så skyddar du dig mot oavsiktliga eller oönskade anropare:

- Behandla URL:en som ett lösenord. Dela den inte offentligt och checka inte in den i ett offentligt repo. Webhook-utlösaren döljer URL:ens hemliga nyckel tills du klickar på **Visa**, och **Kopiera URL** kopierar URL:en utan att visa den.
- Om URL:en läcker klickar du på Webhook-utlösaren i **Byggare** och sedan på **Återställ URL**. Arbetsflödet får en ny URL och den gamla slutar fungera direkt.
- Om utlösaren säger att dess URL slutar med arbetsflödets ID återställer du den. Arbetsflöden som skapades innan webhook-URL:er fick en egen hemlig nyckel använder i stället arbetsflödets ID, och det kan alla som kan öppna arbetsflödet se.
- För känsliga arbetsflöden ber du det anropande systemet att skicka en delad token som header (som `X-Webhook-Token`) och kontrollerar den med ett **If / Else**-block innan något viktigt händer. Spara den förväntade token som en hemlig variabel.
- För mycket känsliga arbetsflöden är en utlösare för OneUptime-händelser och ett manuellt importsteg att föredra framför en offentlig webhook.

Bara personer som kan redigera arbetsflödet — **Project Owner**, **Project Admin**, **Workflow Admin** eller **Edit Workflow** — kan se eller återställa dess webhook-URL. Alla som har URL:en kan starta arbetsflödet varifrån som helst, utan att logga in, så alla andra ser en notering om vem de kan fråga i stället. Det gäller även en **Workflow Member**, som kör arbetsflödet manuellt från **Byggare**.

## Säkerhet för inkommande e-post

Incoming Email-utlösaren ger arbetsflödet en egen adress, och alla som känner till adressen kan skicka e-post till den. Delen före `@` är arbetsflödets hemliga nyckel, så behandla adressen som ett lösenord:

- Publicera den inte och lägg den inte i ett offentligt repo. Utlösaren döljer nyckeln tills du klickar på **Visa**, och **Kopiera adress** kopierar adressen utan att visa den.
- Om adressen läcker klickar du på Incoming Email-utlösaren i **Byggare** och sedan på **Återställ adress**. Arbetsflödet får en ny adress, och e-post till den gamla ignoreras från och med då.
- Vem som helst kan sätta vilken avsändare som helst på ett e-postmeddelande, så **From** bevisar inte vem som skickade det. Innan ett arbetsflöde gör något viktigt kontrollerar du något som bara den riktiga avsändaren vet — en token i ämnet eller i en header — med ett **If / Else**-block. Spara den förväntade token som en hemlig variabel.
- Nyckeln döljs i allt som körningen tar emot — **To**, **CC**, headers och innehållet — eftersom körningens logg är synlig för alla som kan läsa arbetsflödets körningar.

Bara personer som kan redigera arbetsflödet — **Project Owner**, **Project Admin**, **Workflow Admin** eller **Edit Workflow** — kan se eller återställa dess adress. Alla andra ser en notering om vem de kan fråga.

## Utgående nätverksåtkomst

API-block och andra HTTP-block gör sina förfrågningar från OneUptime, och IRC-blocket ansluter från OneUptime till IRC-serverns port. Om du kör självhostat måste du se till att din installation kan nå tjänsterna du anropar. Om du använder OneUptime Cloud finns våra utgående IP-intervall i [IP-adresser](/docs/configuration/ip-addresses), så att du kan tillåta dem i andra änden.

Vilka adresser ett block får nå beror på blocket:

| Block                                                          | Loopback, link-local, molnmetadata                                           | Privata nätverksadresser                                                                                                                          |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API**-block och förfrågningar från **Run Custom JavaScript** | Avvisas, om inte den exakta värden står i `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` | Avvisas, om inte en administratör för en självhostad installation tillåter dem med `ALLOW_PRIVATE_NETWORK_WEBHOOKS` eller `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` |
| **Send Email**, **IRC** och OAuth 2.0-token-URL:er             | Avvisas                                                                      | Avvisas i OneUptime Cloud. Tillåts på en självhostad installation, om inte `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` är `true`                       |
| Slack, Microsoft Teams, Discord och Telegram                   | Avvisas                                                                      | Avvisas: vart och ett skickar bara till sin egen tjänsts adresser                                                                                 |

Se [Åtkomst till privata nätverk](/docs/self-hosted/private-network-access) för hur en administratör för en självhostad installation öppnar för dem.

## AI-komponenter

**Generate Text with AI** skickar en förfrågan till en LLM: projektets standard-LLM-leverantör, eller installationens globala leverantör när projektet inte har någon. Konfigurera leverantörer under **Projektinställningar → AI → LLM-leverantörer**, och lägg aldrig en leverantörs API-nyckel eller en egen slutpunkt i ett arbetsflöde.

Vad leverantören tar emot, och vad modellen kan göra med det:

- **Bara det du lägger i blocket.** OneUptime skickar en fast säkerhetsinstruktion och sedan blockets **System Instructions**, **Prompt** och **Context**, med deras referenser ifyllda. **Context** kommer sist, efter en markör, och säkerhetsinstruktionen talar om för modellen att allt efter markören är opålitliga data, även text som ser ut som instruktioner.
- **Inget annat.** Utlösarens data, arbetsflödets historik, andra blocks utdata, projektposter, telemetri och hemligheter bifogas aldrig. De lämnar bara OneUptime när du hänvisar till dem i någon av de tre inställningarna.
- **Text, och inga verktyg.** Modellen kan inte fråga OneUptime, göra HTTP-förfrågningar eller ändra data. En leverantörs ytterligare parametrar släpper bara igenom en lista över tillåtna fält som enbart justerar genereringen: de kan inte ersätta meddelandena, lägga till verktyg, webbsökning eller andra datakällor, be om något annat än text eller om flera svar, strömma, låta leverantören behålla förfrågan eller höja blockets gräns för utdata. Fält som OneUptime inte känner till släpps.
- **Modellen är din administratörs val.** Om genereringen måste hållas frånkopplad väljer du en modell som inte hämtar något på egen hand hos leverantören.

Vad som loggas:

- Körningens logg döljer blockets **System Instructions**, **Prompt**, **Context** och **Response**. Senare block kan fortfarande använda dem under körningen, och ett block som du infogar något av dem i loggar det enligt sina egna regler, så att infoga ett är ett val att visa det.
- Leverantören, modellen, antalet token, **LLM Log ID** och ett säkert felmeddelande förblir synliga, för drift och fakturering. En leverantörs råa fel hålls utanför alla loggar, eftersom en leverantör kan upprepa förfrågan i det.
- Varje anrop listas under **Projektinställningar → AI → AI-loggar** med leverantör, modell, status, token, kostnad och fakturering, utan prompten, svaret eller det råa felet.

Vad blocket kräver, och vad det kostar:

- **Aktivera AI** måste vara påslaget under **Projektinställningar → AI → AI Features**. I OneUptime Cloud behöver projektet också planen Growth eller högre och ett betalt abonnemang. Självhostade installationer utan fakturering har inget plankrav.
- Anrop via en global leverantör med kostnad använder projektets AI-krediter.
- Varje anrop räknas mot [projektets egna dagliga AI-gränser](/docs/ai/ai-sre#the-projects-own-daily-limits), när en projektägare anger dem. När en gräns är nådd tar blocket **Error** utan att kontakta modellen, fram till midnatt UTC.

| Gräns                                                         | Värde                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **System Instructions**, **Prompt** och **Context** tillsammans | 50 000 tecken                                                          |
| **Temperature**                                               | Från `0` till `1`                                                        |
| **Maximum Output Tokens**                                     | Från `1` till `4096`, `1024` som standard                                |
| En förfrågan                                                  | Görs en gång, i högst 60 sekunder                                        |
| Anrop samtidigt                                               | 3 per projekt. Fler tar **Error**, och en senare körning kan försöka igen. |

Fel i validering, konfiguration, åtkomst, gränser, krediter, samtidighet, leverantör och tidsgräns tar alla vägen **Error**, med orsaken i **Error**. Koppla den vägen innan arbetsflödet går live.

> [!WARNING]
> Varje värde du hänvisar till är data som du skickar till leverantören. Lägg inte en hemlig variabel i prompten eller kontexten om inte leverantören är godkänd för att ta emot den. En självhostad lokal leverantör som Ollama håller förfrågningarna inom din egen infrastruktur; en hostad leverantör tar emot dem enligt sina egna villkor för databehandling.

## Behörigheter

Arbetsflöden följer projektets rollbaserade åtkomstkontroll. De tre arbetsflödesrollerna:

- **Workflow Admin** — bygger arbetsflöden: skapar, ändrar, kör och tar bort dem, och hanterar variablerna de använder.
- **Workflow Member** — använder dem: öppnar arbetsflöden och deras körningar, och kör ett arbetsflöde manuellt med **Kör arbetsflöde**. En medlem kan inte skapa, ändra eller ta bort ett arbetsflöde, eller köra ett av dess steg för sig.
- **Workflow Viewer** — läser arbetsflöden och deras körningar.

**Project Owner** och **Project Admin** kan göra allt som en Workflow Admin kan. **Project Member** kan skapa och ta bort arbetsflöden, men inte ändra eller köra dem.

De enskilda behörigheterna, för ett team eller en API-nyckel som behöver exakt en sak:

- **Create / Read / Edit / Delete Workflow** — de grundläggande behörigheterna på själva arbetsflödet. Att ändra ett arbetsflöde, inklusive att slå på eller av och arkivera det, kräver **Edit Workflow**; **Delete Workflow** tar bara bort.
- **Edit Workflow** — är också det som krävs för att köra ett steg för sig med **Run just this step**, och för att se eller återställa ett arbetsflödes webhook-URL och adress för inkommande e-post. Att köra ett helt arbetsflöde manuellt kräver **Edit Workflow**, **Workflow Admin** eller **Workflow Member**.
- **Read Workflow Log** — krävs för att se körningar.
- **Create / Read / Edit / Delete Workflow Variables** — hantering av globala variabler och arbetsflödesvariabler.

En manuell körning når bara arbetsflöden som du kan öppna: en roll som är begränsad till vissa etiketter, eller till arbetsflödena som ditt team äger, kör bara dem. Den som inte kan köra ett arbetsflöde ser **Kör arbetsflöde** nedtonad, med orsaken i verktygstipset.

Ge dem som bygger automatisering **Workflow Admin**, och dem som bara startar den **Workflow Member**. Spara redigeringsåtkomst till variabler för dem som hanterar projektets hemligheter. Se [Användare, team och behörigheter](/docs/permissions/index) för hur roller tilldelas.

## Vad arbetsflödessteg får göra

De steg som läser och ändrar OneUptime-poster — komponenterna Find, Create, Update och Delete, och utlösarna On Create, On Update och On Delete — agerar som en **Project Admin** i arbetsflödets projekt. Vem som än byggde arbetsflödet möter ett steg samma kontroller som en Project Admin möter i instrumentpanelen och API:t:

- **Bara arbetsflödets eget projekt.** Ett steg läser och skriver posterna i det projekt som arbetsflödet tillhör och inget annat, och en Update flyttar aldrig en post till ett annat projekt.
- **Bara det en Project Admin får göra.** Ett steg kan bara bevilja de team- och API-nyckelbehörigheter som en Project Admin själv har, så det kan inte dela ut **Project Owner**-, fakturerings- eller projektborttagningsbehörigheter, och det kan inte lägga till någon i ett team vars behörigheter går utöver en Project Admins, som ägarteamet. Ett steg kan inte läsa vem som skapade en probe eller en AI-agent, vilket bara projektägare ser.
- **Inte läsning av runbook-autentiseringsuppgifter.** En Project Admin får läsa runbook-autentiseringsuppgifter, men det lånas inte ut till ett steg. Där en ändring kräver den läsningen — att låta OneUptime AI köra sina kommandon utan att fråga, att slå på **Kör AI-åtgärdskommandon** för en Runner, att tilldela en SSH-autentiseringsuppgift till en Runner som kör OneUptime AI:s kommandon, eller att namnge en runbook-autentiseringsuppgift, som i en runbooks steg — frågas det i stället om personen som senast sparade arbetsflödets steg, och steget avvisas om inte den personen får läsa runbook-autentiseringsuppgifter (**Read Runbook Credential**, eller en Project Owner eller Project Admin). OneUptime registrerar den personen när någon skapar arbetsflödet och varje gång någon sparar dess steg; att byta namn på arbetsflödet, ändra dess etiketter eller slå på eller av det behåller vem som senast sparade dess steg. Sparas dess steg med en API-nyckel registreras ingen, så arbetsflödets steg kan inte göra de här ändringarna förrän en person sparar dem.
- **Bara det din plan omfattar.** I OneUptime Cloud avvisas ett steg som skapar eller ändrar något som din plan inte omfattar, med den plan som krävs, precis som i instrumentpanelen. Självhostade installationer utan fakturering har inga plangränser.
- **Inget som OneUptime håller för sig själv.** Det här avvisas för alla, arbetsflöden inräknade:
  - att redigera eller ta bort en flödespost (flödena för incidenter, larm, episoder, monitorer, jourpolicyer och schemalagt underhåll);
  - att skriva en aviseringslogg (loggarna för SMS, samtal, e-post, WhatsApp, Telegram, push, webhooks och arbetsytemeddelanden);
  - värden som OneUptime sätter när saker händer: om en anpassad domäns CNAME är verifierad, ett teams skyddsbrytare (**Is Team Editable**, **Is Team Deleteable**, **Is Permissions Editable**, **Should Have At Least One Member**), vilken incidentroll som är den primära och om den kan tas bort, om en ägare eller medlem har aviserats, påminnelsetider och antal, vem som har jour i ett schema nu och härnäst, en jourkörnings förlopp, en SLO:s aktuella burn rate och error budget, en monitor som pausats av en incident eller ett underhåll, en privat statussideanvändares token för lösenordsåterställning och senaste inloggning, de uppgifter en tjänst rapporterar om sig själv (version, runtime, moln), och en detekteringsregels eller ett hotflödes senaste körning;
  - att deklarera en incident från en mall genom att skicka `createdIncidentTemplateId` till **Create One Incident** — välj i stället mallen under stegets inställning **Incident Template**: steget deklarerar då incidenten från den, som Project Admin, och registrerar mallen;
  - att ändra vilken post en post tillhör efter att den har skapats, som den monitor en ägarrad gäller eller den incident en anteckning står på.
- **Som ingen person.** En post som ett arbetsflöde skapar namnger ingen skapare, och granskningsloggen anger arbetsflödet, med dess namn vid den tidpunkten, som den som gjorde ändringen.

När en kontroll avvisar ett steg tar steget sin utgång **Error** utan att göra den avvisade ändringen, och körningens logg nämner steget och orsaken i klartext, till exempel *"Create One Team Permission" was refused. Workflow steps can do only what a Project Admin of this project can do: …*. Läs den under arbetsflödets [Körningar](/docs/workflows/runs-and-logs). Ett Create Many-steg skapar sina poster en i taget och stannar vid den första som avvisas: posterna det skapade före den behålls.

Steg som pratar med andra system — API, Email, Slack, Microsoft Teams, Discord, Telegram, IRC, Custom Code och Generate Text with AI — läser eller ändrar inte OneUptime-poster, så inget av detta ändrar något för dem.

## Plangränser

I OneUptime Cloud kräver arbetsflöden planen Growth eller högre, och varje plan tillåter ett antal körningar under 30 dagar:

| Plan       | Körningar de senaste 30 dagarna |
| ---------- | ------------------------------- |
| Growth     | 500                             |
| Scale      | 2 000                           |
| Enterprise | Ingen praktisk gräns            |

Fönstret är rullande: varje körning som projektet registrerar, manuellt eller från en utlösare, räknas i 30 dagar. På planerna Growth och Scale visar sidan **Arbetsflöden** ett kort, **Arbetsflödeskörningar**, med hur många projektet har använt. När gränsen är nådd registreras nya körningar med statusen **Execution Exceeded Current Plan** och utförs inte, och detsamma händer medan abonnemanget är obetalt. Självhostade installationer utan fakturering har ingen gräns.

## Hur länge en körning får ta

| Gräns                                                             | Standard       | Inställning vid självhosting    |
| ----------------------------------------------------------------- | -------------- | ------------------------------- |
| En körning, från starten eller från att den vaknar efter en **Sleep** | 2 minuter  | `WORKFLOW_TIMEOUT_IN_MS`        |
| Ett **Run Custom JavaScript**-block                               | 5 sekunder     | `WORKFLOW_SCRIPT_TIMEOUT_IN_MS` |
| Ett **Sleep**-block                                               | Högst 30 dagar | —                               |

Körmotorn kontrollerar tidsfristen före och efter varje block och markerar en körning som har dragit över tiden som **Timeout** så snart kontrollen återkommer. Den kan inte avbryta ett block mitt i, så block som väntar på nätverket har egna tidsgränser: en förfrågan från Generate Text with AI ger upp efter högst 60 sekunder, och en OAuth 2.0-tokenförfrågan efter 20. Väntan vid ett **Sleep**-block räknas inte mot en körnings tid: körningen läggs åt sidan och får 2 nya minuter när den vaknar.

## Gräns för att anropa andra arbetsflöden

Komponenten **Execute Workflow** låter ett arbetsflöde starta ett annat. För att förhindra loopar där arbetsflöde A startar B, som startar A igen, avvisas en kedja av arbetsflöden som startar varandra när den skulle gå tillbaka till ett arbetsflöde som redan finns i den, eller gå djupare än 10 arbetsflöden. Blocket **Execute Workflow** tar då sin utgång **Error**, och felet visar kedjan.

Om du verkligen behöver en lång kedja (som ett jobb som bearbetar ett element per körning) är det oftast enklare att loopa inne i ett enda arbetsflöde med **Run Custom JavaScript**.

## När arbetsflöden inte är rätt verktyg

Några fall där du bör välja något annat:

- **Tunga beräkningar eller stora datamängder** — arbetsflöden är gjorda för lätt sammanlänkningsarbete, inte sifferknäckning. Kör tungt arbete i din egen infrastruktur och låt ett arbetsflöde sätta i gång det.
- **Långvarig aktiv beräkning** — en körning har 2 minuter som standard. För en passiv paus som ”gör A, vänta två timmar, gör B” använder du komponenten **Sleep**; den lägger körningen åt sidan och återupptar den senare utan att uppta en worker.
- **Incidenthantering steg för steg med människor inblandade** — det är vad [Runbooks](/docs/runbooks/index) är till för. Arbetsflöden är till för automatisering utan tillsyn.

## Nästa steg

:::cards
- [Översikt över arbetsflöden](/docs/workflows/index): Den stora bilden, och ett första arbetsflöde från början till slut.
- [Komponenter](/docs/workflows/components): Vad varje block behöver, returnerar och får nå.
- [Runbooks](/docs/runbooks/index): När människor behöver fatta besluten längs vägen.
:::
