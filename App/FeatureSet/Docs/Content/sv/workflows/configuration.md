# Konfiguration & säkerhet

Den här sidan samlar de inställningar och säkerhetsgränser som är värda att känna till innan du riktar ett arbetsflöde mot produktionstrafik.

## Aktivera / inaktivera

Varje arbetsflöde har en **isEnabled**-flagga i **Settings**. Inaktiverade arbetsflöden triggas aldrig — modellhändelser, webhooks och schemalagda körningar ignoreras. Nya arbetsflöden levereras inaktiverade.

Behandla detta som din "redo för produktion"-omkopplare:

1. Bygg arbetsflödet.
2. Klicka på **Run Manually** med en representativ payload.
3. Kontrollera **Logs** — bekräfta att varje nod tog den port du förväntade dig.
4. Slå på **isEnabled**.

Att inaktivera ett arbetsflöde påverkar inte körningar som redan är på gång; det förhindrar bara att nya skapas.

## Ägarskap och etiketter

- **Ägare** — användare och team listade som ägare får behörighetsbaserad åtkomst och (valfritt) notifieringar när arbetsflödet misslyckas. Konfigurera under **Settings → Owners**.
- **Etiketter** — många-till-många-taggar för att organisera arbetsflöden. Filtrera arbetsflödeslistan efter etikett. Användbart när ett projekt har dussintals arbetsflöden organiserade efter team, integration eller miljö.
- **Etikettregler** — under **Workflows → Settings → Label Rules**, applicera etiketter automatiskt på nya arbetsflöden baserat på regex-matchningar på namn eller beskrivning.
- **Ägarregler** — under **Workflows → Settings → Owner Rules**, tilldela ägare automatiskt till nya arbetsflöden.

## Hemligheter

Globala variabler kan markeras som **hemliga**. Värdet är krypterat i vila, skrivskyddat i användargränssnittet efter att det sparats och redigeras bort från körningsloggar (ersätts med `[REDACTED]`).

Använd hemliga variabler för:

- API-nycklar för utgående integrationer.
- Bearer-tokens.
- Webhook-signeringsnycklar.
- Vilket som helst värde som en angripare med läsbehörighet till ett arbetsflöde inte ska se.

Klistra inte in en hemlighet direkt i en komponents argument — referenser som `Authorization: Bearer eyJh...` dyker upp i arbetsflödets JSON och i körningsloggarna i klartext. Referera till `{{variable.MY_SECRET}}` istället.

## Körningstimeout

Varje körning har en maximal varaktighet. Om en körning inte har avslutats inom timeouten markeras den som `Timeout` och eventuella pågående komponenter avbryts. Standardvärdet är generöst (minuter, inte sekunder) — se workerns miljökonfiguration för det exakta värdet i din installation.

De flesta komponenter har sina egna per-anrops-timeouts inuti körningstimeouten — t.ex. ger API-komponenten upp på en hängande utgående förfrågan långt innan hela körningen gör det.

## Rekursionsgräns

Komponenten **Execute Workflow** låter ett arbetsflöde anropa ett annat. För att förhindra fenande loopar där A anropar B anropar A i oändlighet, spårar workern anropskedjan och stoppar en kedja som överskrider ett fast djup (vanligtvis ett litet tal som 5). Den avslutande körningen markeras som `Error` med ett tydligt meddelande om rekursionsgränsen.

Om du har ett legitimt behov av en lång kedja (t.ex. en rekursiv mappgenomgång som bearbetar en nivå per körning), refaktorisera till ett enskilt arbetsflöde som itererar internt via **Custom Code** — det mönstret är inte föremål för kedjegränsen.

## Webhook-säkerhet

Webhook-utlösare exponerar en unik HTTPS-URL. Vem som helst som lär sig URL:en kan träffa den. För att försvara dig mot oavsiktliga eller fientliga anropare:

- Behandla URL:en som en delad hemlighet. Klistra inte in den i offentlig chatt eller committa den till en offentlig repo.
- För högvärdesarbetsflöden, be det anropande systemet inkludera en delad hemlighet som en header (t.ex. `X-Webhook-Token`) och validera den i en **Conditions**-nod innan du gör något destruktivt. Definiera den förväntade token som en hemlig global variabel.
- För mycket högvärdesarbetsflöden, föredra en modellhändelse-utlösare och ett manuellt importsteg istället för en offentlig webhook.

## Utgående nätverks-egress

API och andra HTTP-stilskomponenter skickar förfrågningar från OneUptime Workflow Workerns nätverk. Om du self-hostar OneUptime är workerns utgående nätverk din ensak — se till att den kan nå de tredjeparts-API:er du anropar. Om du använder OneUptime Cloud publiceras vårt IP-egress-omfång i [IP Addresses](/docs/configuration/ip-addresses) så att du kan tillåtslista på den mottagande sidan.

## Behörigheter

Arbetsflöden är förstklassiga resurser som omfattas av projektnivå rollbaserad åtkomstkontroll:

- `CreateWorkflow`, `ReadWorkflow`, `EditWorkflow`, `DeleteWorkflow` — de fyra CRUD-behörigheterna på arbetsflödesmallar.
- `RunWorkflow` — behövs för att klicka på **Run Manually** eller för att skicka iväg ett arbetsflöde via API.
- `ReadWorkflowLog` — behövs för att se sidan **Runs & Logs**.
- `ReadWorkflowVariable`, `CreateWorkflowVariable`, `EditWorkflowVariable`, `DeleteWorkflowVariable` — kontroll över listan med globala variabler.

De flesta ingenjörer bör ha create/edit/read på arbetsflöden men inte på variabler. Reservera redigeringsåtkomst till variabler för de personer som hanterar ditt projekts hemligheter.

## Kvoter

OneUptime Cloud sätter ett tak på antalet körningar per månad per projekt på mindre planer. Taket visas på **Project Settings → Billing**. När du når det avvisas nya utlösare (och registreras med en "quota exceeded"-anledning på det berörda arbetsflödet) tills nästa faktureringscykel. Self-hostade installationer är inte föremål för en kvot.

## Vad arbetsflöden *inte* är bra på

Några mönster där du bör gripa efter ett annat verktyg:

- **Långkörande beräkningar** — arbetsflöden är inriktade på lim mellan system, inte att mala stora datamängder. Kör tungt arbete i din egen infrastruktur och använd ett arbetsflöde för att sparka igång det.
- **Tillståndsbärande arbetsflöden som sträcker sig över minuter/timmar** — en enskild körning är menad att avslutas snabbt. Om du behöver "gör sak A, vänta sedan två timmar, gör sak B," modellera väntan som en extern schemaläggare som postar tillbaka till en webhook-utlösare.
- **Steg-för-steg-incidentrespons med mänskliga kontrollpunkter** — det är vad [Runbooks](/docs/runbooks/index) är till för. Använd ett arbetsflöde om det inte finns någon människa i loopen; använd en runbook om det gör det.

## Var läsa vidare

- [Översikt över arbetsflöden](/docs/workflows/index) — den begreppsmässiga kartan.
- [Komponenter](/docs/workflows/components) — argumentdetaljer för varje åtgärd.
- [Runbooks](/docs/runbooks/index) — när du ska använda en runbook istället.
