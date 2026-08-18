# Konfiguration & säkerhet

Den här sidan går igenom inställningarna och säkerhetsgränserna som är värda att känna till innan du riktar ett arbetsflöde mot riktig trafik.

## Slå på eller av ett arbetsflöde

Varje arbetsflöde har en växel **Aktiverad** under **Inställningar**. När den är av körs arbetsflödet inte — webhook-anrop, schemalagda tider och OneUptime-händelser ignoreras allihop. Nya arbetsflöden startar inaktiverade.

Använd växeln som din "redo att köra"-grind:

1. Bygg arbetsflödet.
2. Klicka på **Kör arbetsflöde** i **Byggare** med realistiska värden.
3. Kontrollera **Loggar** — se till att varje block gick dit du förväntade dig.
4. Slå på **Aktiverad**.

Att slå av ett arbetsflöde stoppar inte körningar som redan pågår; det hindrar bara nya från att starta.

## Ägare och etiketter

- **Ägare** — användare och team som står som ägare får åtkomst till arbetsflödet och kan välja att bli aviserade när det misslyckas. Ställ in dem under **Inställningar → Ägare**.
- **Etiketter** — taggar för att gruppera arbetsflöden. Arbetsflödeslistan går att filtrera på etikett, vilket gör ett fullt projekt betydligt lättare att navigera. Praktiskt när du har arbetsflöden ordnade efter team, integration eller miljö.
- **Etikettregler** — under **Arbetsflöden → Inställningar → Etikettregler** sätter du automatiskt etiketter på nya arbetsflöden utifrån mönster i namn eller beskrivning.
- **Ägarregler** — under **Arbetsflöden → Inställningar → Ägarregler** tilldelar du automatiskt ägare till nya arbetsflöden.

## Hemligheter

Markera en global variabel som **hemlighet** om den innehåller något känsligt. Värdet döljs från vanliga API- och gränssnittsläsningar efter att du sparat, och arbetsflödesloggningen tvättar bort det upplösta värdet innan körloggen sparas.

Använd hemliga variabler för:

- API-nycklar till externa tjänster.
- Autentiseringstoken.
- Signeringsnycklar för webhooks.
- Allt du inte vill att någon med enbart läsbehörighet ska se.

Klistra inte in en hemlighet rakt in i ett block — värden som `Authorization: Bearer eyJh...` blir synliga i arbetsflödet och i loggarna. Använd `{{global.variables.MY_SECRET}}` istället.

## Exportera och importera arbetsflöden

Du kan flytta ett arbetsflöde mellan projekt, eller mellan en självhostad installation och OneUptime Cloud, som en JSON-fil.

- **Export** — öppna arbetsflödet och använd **Export Workflow** under **Inställningar**. Från arbetsflödeslistan kan du också markera flera arbetsflöden och exportera dem till en enda fil.
- **Import** — i listan **Arbetsflöden**, klicka på **Import JSON** och välj en fil som exporterats från vilket OneUptime-projekt som helst.

Filen innehåller arbetsflödets namn, beskrivning, aktiverade tillstånd och dess graf. Den innehåller medvetet inte:

- **Webhookens hemliga nyckel.** En ny genereras när arbetsflödet skapas, så ett importerat arbetsflöde har en annan webhook-URL. Allt som anropar originalet måste pekas om.
- **Globala variabler.** Ett block som läser `{{global.variables.MY_SECRET}}` behåller referensen, men värdet ligger inte i filen. Skapa variablerna i målprojektet innan du kör det importerade arbetsflödet.
- **Ägare och etiketter.** Ditt projekts egna etikett- och ägarregler körs mot det importerade arbetsflödet, precis som om du hade skapat det för hand.

Ett importerat arbetsflöde skapas alltid **inaktiverat**, även om det var aktiverat där det exporterades ifrån — dess graf kan peka på monitorer, jourpolicyer eller andra arbetsflöden som inte finns i målprojektet. Granska det, aktivera det, testa det med **Kör arbetsflöde** och låt det sedan stå på. Att duplicera ett arbetsflöde fungerar likadant, så en kopia börjar aldrig utlösas vid sidan av originalet innan du hunnit redigera den.

Eftersom grafen följer med ordagrant följer allt som skrivits rakt in i ett block med den. Det är det praktiska skälet att hålla autentiseringsuppgifter i hemliga variabler: exporterar du ett arbetsflöde med en hårdkodad token lämnar du över den token till den som får filen.

## Hur länge en körning får ta

Varje exekveringsförsök har en deadline i klocktid. Körmotorn kontrollerar den före och efter varje komponent och markerar en försenad körning som **Timeout** så snart kontrollen lämnas tillbaka. Komponenter som gör nätverks- eller skriptarbete behöver också egna timeouts, eftersom körmotorn inte kan avbryta godtycklig komponentkod med tvång.

AI-komponenten härleder sin timeout för leverantörsförfrågan ur den återstående arbetsflödestiden och begränsar den till 60 sekunder, med en liten marginal kvar för loggning och uppstädning.

## Gräns för att anropa andra arbetsflöden

Komponenten **Execute Workflow** låter ett arbetsflöde anropa ett annat. För att förhindra oavsiktliga loopar där arbetsflöde A anropar B som anropar A igen finns ett tak för hur djup kedjan får bli. En körning som går förbi gränsen avslutas med ett tydligt fel.

Har du ett verkligt behov av en lång kedja (som ett jobb som behandlar ett objekt per körning) är det oftast enklare att loopa inuti ett enda arbetsflöde med **Custom Code**.

## Webhook-säkerhet

Webhook-utlösare ger dig en unik URL. Vem som helst som känner till URL:en kan anropa den. Så här skyddar du dig mot oavsiktliga eller oönskade anropare:

- Behandla URL:en som ett lösenord. Dela den inte offentligt och checka inte in den i ett publikt repo.
- För känsliga arbetsflöden, be det anropande systemet skicka en delad token som header (som `X-Webhook-Token`) och kontrollera den med ett **Conditions**-block innan något viktigt händer. Spara den förväntade token som en hemlig variabel.
- För mycket känsliga arbetsflöden, välj hellre en OneUptime-händelseutlösare och ett manuellt importsteg än en publik webhook.

## Utgående nätverksåtkomst

API-block och andra HTTP-block gör sina förfrågningar från OneUptime. Självhostar du, se till att din installation når tjänsterna du anropar. Använder du OneUptime Cloud finns våra utgående IP-intervall listade i [IP-adresser](/docs/configuration/ip-addresses) så att du kan tillåta dem på andra sidan.

## AI-komponenter

**Generate Text with AI** skickar en förfrågan genom OneUptimes konfigurerade LLM-gateway. Den använder projektets standard-LLM-leverantör, eller installationens globala leverantör när projektet saknar en. Konfigurera leverantörer under **Projektinställningar → AI → LLM-leverantörer**; lägg aldrig en leverantörs API-nyckel eller en godtycklig modellendpoint i själva arbetsflödet.

AI-komponenten har en uttrycklig gräns för vad som lämnar systemet:

- OneUptime skickar en fast komponentsäkerhetsinstruktion plus de upplösta **System Instructions**, **Prompt** och serialiserad **Context** till den konfigurerade leverantören. Context läggs till efter en uttrycklig markör i slutet av användarmeddelandet; den fasta instruktionen säger att allt efter den markören förblir opålitlig data även när det innehåller taggar eller instruktioner.
- Den bifogar inte automatiskt utlösarens payload, arbetsflödets historik, andra komponenters output, projektposter, telemetri eller hemligheter. Data lämnar systemet bara när du refererar till den i något av de tre fälten.
- Den skickar inga verktygsdefinitioner eller leverantörsspecifika kapacitetsfält. Modellen kan inte fråga OneUptime, göra HTTP-förfrågningar eller ändra projektdata genom den här komponenten. Den konfigurerade leverantören/modellen förblir en förtroendegräns som administratören ansvarar för, så installationer som kräver strikt offline-generering bör välja en modell utan inbyggd leverantörsstyrd informationshämtning.
- Ytterligare parametrar på leverantörsnivå är begränsade till en tillåtelselista med finjusteringsfält som bara rör generering. De kan inte ersätta arbetsflödets meddelanden, lägga till verktyg eller leverantörsstyrd webbsökning och datakällor, aktivera andra modaliteter än text, begära flera alternativ, aktivera strömning, behålla förfrågan via leverantörens lagringsflaggor eller höja den här komponentens tak för output-token. Okända framtida kapacitetsfält kastas som standard.
- System Instructions, Prompt, Context och genererade Response-värden redigeras bort ur den här AI-komponentens egna argument- och returvärdesposter i den automatiska exekveringsloggen. De finns kvar för efterföljande komponenter medan körningen pågår. Lägger du in något av dem i en annan komponent gäller den komponentens loggningspolicy, och den kan spara det upplösta värdet; behandla återanvändning som ett medvetet röjande. Leverantörs- och modellnamn, antal token, LLM Log ID och ofarliga felmeddelanden förblir synliga för drift och fakturering. Råa felkroppar från leverantören utesluts från arbetsflödesloggar, LLM-loggar, applikationsloggar och spårningar, eftersom en leverantör kan eka tillbaka innehållet i förfrågan.

Behandla varje refererad variabel som data du medvetet skickar till leverantören. Lägg i synnerhet inte en hemlig global variabel i prompten eller kontexten om inte det röjandet krävs och leverantören är godkänd att ta emot det. En självhostad lokal leverantör som Ollama kan hålla förfrågan inom er egen infrastruktur; en molndriven leverantör tar emot förfrågan under den leverantörens villkor för databehandling.

Varje anrop registreras i **Projektinställningar → AI → AI-loggar**, med leverantör, modell, status, token, kostnad och faktureringsinformation. Förhandsvisningar av prompt och svar samt råa feldetaljer från leverantören sparas inte i AI-loggen. Anrop genom en kostnadsbelagd global leverantör förbrukar projektets AI-kreditsaldo. Workflow AI räknas också mot projektets dagliga budget för autonoma AI-token; när budgeten är slut tar komponenten sin **Error**-väg utan att kontakta modellen. Projektets AI måste vara aktiverat. På OneUptime Cloud måste prenumerationen vara betald och Growth-planen (eller en plan som inkluderar Growth-funktioner) krävs; självhostade installationer med fakturering avstängd har ingen sådan plangräns.

Inbyggda gränser håller obevakade anrop ändliga: System Instructions, Prompt och serialiserad Context begränsas tillsammans till 50 000 tecken; Temperature måste ligga mellan `0` och `1`; Maximum Output Tokens måste ligga mellan `1` och `4096` (standard `1024`); och leverantörsförfrågan görs ett försök och timar ut efter högst 60 sekunder. Högst tre workflow AI-anrop körs samtidigt per projekt; ytterligare anrop tar **Error**-vägen och kan göras om av en senare arbetsflödeskörning. Fel i validering, konfiguration, åtkomst, budget, saldo, samtidighet, leverantör och timeout tar alla **Error**-vägen och fyller i utgången **Error**. Koppla den vägen innan du aktiverar ett arbetsflöde i produktion.

## Behörigheter

Arbetsflöden respekterar ditt projekts rollbaserade åtkomstkontroll. De behörigheter det gäller:

- **Create / Read / Edit / Delete Workflow** — grundbehörigheterna på själva arbetsflödet.
- **Run Workflow** — krävs för att köra ett arbetsflöde för hand eller utlösa ett via API.
- **Read Workflow Log** — krävs för att se körningar.
- **Read / Create / Edit / Delete Workflow Variable** — kontroll över listan med globala variabler.

De flesta ingenjörer bör ha skapa/redigera/läsa på arbetsflöden men inte på variabler. Spara redigeringsåtkomsten till variabler åt dem som hanterar projektets hemligheter.

## Plangränser

OneUptime Cloud begränsar antalet körningar per månad på mindre planer. Din aktuella gräns visas under **Projektinställningar → Fakturering**. När du når den avvisas nya utlösningar fram till nästa faktureringscykel. Självhostade installationer har ingen sådan gräns.

## När arbetsflöden inte är rätt verktyg

Några fall där du bör ta till något annat:

- **Tunga beräkningar eller stora datamängder** — arbetsflöden är gjorda för lätt limarbete, inte sifferknådning. Kör det tunga i din egen infrastruktur och låt ett arbetsflöde sparka igång det.
- **Långvarig aktiv beräkning** — ett enskilt exekveringsförsök är tänkt att bli klart snabbt. För en passiv fördröjning som "gör A, vänta två timmar, gör B", använd komponenten **Sleep**; den sparar körningen och återupptar den senare utan att uppta en worker.
- **Stegvis incidenthantering med människor i loopen** — det är vad [Runbooks](/docs/runbooks/index) är till för. Arbetsflöden är till för obevakad automation.

## Läs vidare

- [Översikt över arbetsflöden](/docs/workflows/index) — helhetsbilden.
- [Arbetsflödeskomponenter](/docs/workflows/components) — block-för-block-referens.
- [Runbooks](/docs/runbooks/index) — när du ska använda ett runbook istället.
