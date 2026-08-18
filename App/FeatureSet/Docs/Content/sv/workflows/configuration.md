# Konfiguration & säkerhet

Den här sidan täcker inställningarna och säkerhetsgränserna som är bra att känna till innan du pekar ett arbetsflöde mot riktig trafik.

## Slå på eller av ett arbetsflöde

Varje arbetsflöde har en **Enabled**-växel under **Settings**. När den är avslagen körs inte arbetsflödet — webhook-anrop, schemalagda tider och OneUptime-händelser ignoreras alla. Nya arbetsflöden startar inaktiverade.

Använd den här växeln som din "redo att köra"-grind:

1. Bygg arbetsflödet.
2. Klicka på **Run Workflow** i **Builder** med realistiska värden.
3. Kontrollera **Logs** — säkerställ att varje block gjorde det du förväntade dig.
4. Slå på **Enabled**.

Att slå av ett arbetsflöde stoppar inte körningar som redan pågår; det stoppar bara nya från att starta.

## Ägare och etiketter

- **Owners** — användare och team som listas som ägare får åtkomst till arbetsflödet och kan välja att få aviseringar när det misslyckas. Ange dem under **Settings → Owners**.
- **Labels** — taggar för att gruppera arbetsflöden. Arbetsflödeslistan låter dig filtrera på etikett, vilket gör ett hektiskt projekt mycket enklare att navigera i. Användbart när du har arbetsflöden organiserade efter team, integration eller miljö.
- **Label rules** — under **Workflows → Settings → Label Rules**, tillämpa etiketter automatiskt på nya arbetsflöden baserat på mönster i namn eller beskrivning.
- **Owner rules** — under **Workflows → Settings → Owner Rules**, tilldela ägare automatiskt till nya arbetsflöden.

## Hemligheter

Markera en global variabel som **secret** om den innehåller något känsligt. Värdet döljs från vanliga API- och UI-läsningar efter att du sparat det, och arbetsflödesloggningen tvättar bort det upplösta värdet innan körloggen sparas.

Använd hemliga variabler för:

- API-nycklar för externa tjänster.
- Autentiseringstoken.
- Signeringsnycklar för webhooks.
- Allt du inte skulle vilja att någon med skrivskyddad åtkomst kunde se.

Klistra inte in en hemlighet direkt i ett block — värden som `Authorization: Bearer eyJh...` hamnar synliga i arbetsflödet och loggarna. Använd `{{global.variables.MY_SECRET}}` istället.

## Exportera och importera arbetsflöden

Du kan flytta ett arbetsflöde mellan projekt, eller mellan en självhostad installation och OneUptime Cloud, som en JSON-fil.

- **Export** — öppna arbetsflödet och använd **Export Workflow** under **Settings**. Från arbetsflödeslistan kan du också markera flera arbetsflöden och exportera dem till en enda fil.
- **Import** — i listan **Workflows**, klicka på **Import JSON** och välj en fil exporterad från valfritt OneUptime-projekt.

Filen innehåller arbetsflödets namn, beskrivning, aktiverat tillstånd och dess graf. Den innehåller medvetet inte:

- **Webhook-hemligheten.** En ny genereras när arbetsflödet skapas, så ett importerat arbetsflöde får en annan webhook-URL. Allt som anropar den ursprungliga måste pekas om.
- **Globala variabler.** Ett block som läser `{{global.variables.MY_SECRET}}` behåller den referensen, men värdet finns inte i filen. Skapa variablerna i destinationsprojektet innan du kör det importerade arbetsflödet.
- **Ägare och etiketter.** Ditt eget projekts etikett- och ägarregler körs mot det importerade arbetsflödet, precis som om du hade skapat det för hand.

Ett importerat arbetsflöde skapas alltid **inaktiverat**, även om det var aktiverat där det exporterades från — dess graf kan peka på monitorer, jourpolicyer eller andra arbetsflöden som inte finns i destinationsprojektet. Granska det, aktivera det, testa det med **Run Workflow**, och lämna det sedan på. Att duplicera ett arbetsflöde beter sig likadant, så en kopia börjar aldrig köra parallellt med originalet innan du har redigerat den.

Eftersom grafen förs över ordagrant följer allt som skrivits direkt in i ett block med. Det är det praktiska skälet till att hålla autentiseringsuppgifter i hemliga variabler: att exportera ett arbetsflöde med en hårdkodad token ger den token till den som tar emot filen.

## Hur länge en körning kan pågå

Varje körningsförsök har en tidsfrist i realtid. Körmotorn kontrollerar den före och efter varje komponent och markerar en försenad körning som **Timeout** så snart kontrollen återgår. Komponenter som utför nätverks- eller skriptarbete behöver också sina egna timeouts, eftersom körmotorn inte kan tvinga fram ett avbrott i godtycklig komponentkod.

AI-komponenten härleder sin timeout för leverantörsförfrågan från den återstående arbetsflödestiden och begränsar den till 60 sekunder, vilket lämnar en liten marginal för loggning och upprensning.

## Gräns för att anropa andra arbetsflöden

Komponenten **Execute Workflow** låter ett arbetsflöde anropa ett annat. För att förhindra oavsiktliga loopar där arbetsflöde A anropar B som anropar A igen finns det ett tak för hur djup kedjan kan bli. En körning som går förbi gränsen avslutas med ett tydligt fel.

Om du har ett verkligt behov av en lång kedja (som ett jobb som bearbetar ett objekt per körning) är det oftast enklare att loopa inuti ett enda arbetsflöde med **Custom Code**.

## Webhook-säkerhet

Webhook-utlösare ger dig en unik URL. Alla som känner till URL:en kan anropa den. För att skydda mot oavsiktliga eller oönskade anropare:

- Behandla URL:en som ett lösenord. Dela den inte offentligt och checka inte in den i ett publikt repo.
- För känsliga arbetsflöden, be det anropande systemet skicka en delad token som en header (som `X-Webhook-Token`) och kontrollera den med ett **Conditions**-block innan du gör något viktigt. Spara den förväntade token som en hemlig variabel.
- För mycket känsliga arbetsflöden, föredra en OneUptime-händelseutlösare och ett manuellt importsteg istället för en publik webhook.

## Utgående nätverksåtkomst

API- och andra HTTP-block gör sina förfrågningar från OneUptime. Om du självhostar, säkerställ att din installation kan nå de tjänster du anropar. Om du använder OneUptime Cloud finns våra utgående IP-intervall listade i [IP-adresser](/docs/configuration/ip-addresses) så att du kan tillåta dem på andra sidan.

## AI-komponenter

**Generate Text with AI** skickar en förfrågan genom OneUptimes konfigurerade LLM-gateway. Den använder projektets standard-LLM-leverantör, eller installationens globala leverantör när projektet inte har en egen. Konfigurera leverantörer under **Project Settings → AI → LLM Providers**; lägg aldrig en leverantörs API-nyckel eller en godtycklig modellendpoint direkt i arbetsflödet.

AI-komponenten har en uttrycklig utgångsgräns:

- OneUptime skickar en fast komponentsäkerhetsinstruktion plus de upplösta **System Instructions**, **Prompt** och serialiserad **Context** till den konfigurerade leverantören. Context bifogas efter en uttrycklig markör i slutet av användarmeddelandet; den fasta instruktionen säger att allt efter den markören förblir opålitlig data även om den innehåller taggar eller instruktioner.
- Den bifogar inte automatiskt utlösarens payload, arbetsflödeshistorik, andra komponenters output, projektposter, telemetri eller hemligheter. Data lämnar bara när du refererar till den i en av dessa tre inmatningar.
- Den skickar inga verktygsdefinitioner eller leverantörsspecifika kapacitetsfält. Modellen kan inte fråga OneUptime, göra HTTP-förfrågningar eller ändra projektdata genom den här komponenten. Den konfigurerade leverantören/modellen förblir en administratörs förtroendegräns, så installationer som kräver strikt offline-generering bör välja en modell utan inbyggd leverantörsstyrd hämtning.
- Leverantörsspecifika extraparametrar begränsas till en tillåtlista av rena genereringsinställningar. De kan inte ersätta arbetsflödesmeddelandena, lägga till verktyg eller leverantörsspecifik webbsökning/datakällor, aktivera icke-textmodaliteter, begära flera alternativ, aktivera streaming, behålla förfrågan genom leverantörens lagringsflaggor, eller höja den här komponentens output-tokengräns. Okända framtida kapacitetsfält tas bort som standard.
- System Instructions, Prompt, Context och det genererade Response-värdet redigeras bort från den här AI-komponentens egna argument- och returvärdesposter i den automatiska arbetsflödeskörloggen. De förblir tillgängliga för efterföljande komponenter medan körningen pågår. Om du sätter in ett av dem i en annan komponent gäller den komponentens loggningspolicy och den kan spara det upplösta värdet; behandla återanvändning som en uttrycklig delning. Leverantörs-/modellnamn, tokenräkning, LLM Log ID och säkra felmeddelanden förblir synliga för drift och fakturering. Rå felinformation från leverantören exkluderas från arbetsflödesloggar, LLM-loggar, applikationsloggar och spårningar eftersom en leverantör kan eka tillbaka förfrågans innehåll.

Behandla varje refererad variabel som data du medvetet skickar till leverantören. Sätt i synnerhet inte in en hemlig global variabel i prompten eller kontexten om inte just det avslöjandet krävs och leverantören är godkänd att ta emot det. En självhostad lokal leverantör som Ollama kan hålla förfrågan inom din egen infrastruktur; en hostad leverantör tar emot förfrågan under den leverantörens villkor för databehandling.

Varje anrop registreras under **Project Settings → AI → AI Logs**, inklusive leverantör, modell, status, tokens, kostnad och faktureringsinformation. Förhandsgranskningar av prompt och svar samt rå felinformation från leverantören sparas inte i AI-loggen. Anrop genom en kostnadsbelagd global leverantör förbrukar projektets AI-kreditsaldo. Workflow AI räknas också mot projektets dagliga budget för autonoma AI-tokens; när budgeten är förbrukad tar komponenten sin **Error**-väg utan att kontakta modellen. Project AI måste vara aktiverat. På OneUptime Cloud måste prenumerationen vara betald och Growth-planen (eller en plan som inkluderar Growth-funktioner) krävs; självhostade installationer med fakturering avstängd har inte denna plangräns.

Inbyggda gränser håller obevakade anrop ändliga: System Instructions, Prompt och serialiserad Context begränsas till 50 000 tecken sammanlagt; Temperature måste vara mellan `0` och `1`; Maximum Output Tokens måste vara mellan `1` och `4096` (standard `1024`); och leverantörsförfrågan görs ett försök och timar ut efter högst 60 sekunder. Högst tre workflow AI-anrop körs samtidigt per projekt; ytterligare anrop tar **Error**-vägen och kan köras om av en senare arbetsflödeskörning. Alla fel kring validering, konfiguration, åtkomst, budget, saldo, samtidighet, leverantör och timeout tar **Error**-vägen och fyller i **Error**-outputen. Koppla den vägen innan du aktiverar ett arbetsflöde i produktion.

## Behörigheter

Arbetsflöden respekterar ditt projekts rollbaserade åtkomstkontroll. De relevanta behörigheterna:

- **Create / Read / Edit / Delete Workflow** — grundbehörigheterna på själva arbetsflödet.
- **Run Workflow** — behövs för att köra ett arbetsflöde för hand eller utlösa ett via API.
- **Read Workflow Log** — behövs för att se körningar.
- **Read / Create / Edit / Delete Workflow Variable** — kontroll över listan med globala variabler.

De flesta ingenjörer bör ha create/edit/read på arbetsflöden men inte på variabler. Spara redigeringsåtkomst för variabler till de som förvaltar ditt projekts hemligheter.

## Plangränser

OneUptime Cloud begränsar antalet körningar per månad på mindre planer. Din aktuella gräns visas under **Project Settings → Billing**. När du når den avvisas nya utlösningar fram till nästa faktureringscykel. Självhostade installationer har inte denna gräns.

## När arbetsflöden inte är rätt verktyg

Några fall där du bör välja något annat:

- **Tung beräkning eller stora datamängder** — arbetsflöden är designade för lätt sammankopplingsarbete, inte tung beräkning. Kör tungt arbete i din egen infrastruktur och låt ett arbetsflöde starta det.
- **Långvarig aktiv beräkning** — ett enskilt körningsförsök är tänkt att slutföras snabbt. För en passiv fördröjning som "gör A, vänta två timmar, gör B", använd komponenten **Sleep**; den sparar körningen och återupptar den senare utan att uppta en worker.
- **Steg-för-steg-incidenthantering med människor i loopen** — det är vad [Runbooks](/docs/runbooks/index) är till för. Arbetsflöden är för obevakad automation.

## Läs vidare

- [Översikt över arbetsflöden](/docs/workflows/index) — helhetsbilden.
- [Arbetsflödeskomponenter](/docs/workflows/components) — referens block för block.
- [Runbooks – Översikt](/docs/runbooks/index) — när du ska använda en runbook istället.
