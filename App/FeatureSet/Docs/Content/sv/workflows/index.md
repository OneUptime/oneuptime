# Översikt över arbetsflöden

Arbetsflöden är OneUptimes visuella automatiseringsbyggare. Dra en utlösare till en arbetsyta, koppla den till en kedja av åtgärder — HTTP-anrop, Slack-meddelanden, JavaScript-snuttar, villkorliga förgreningar, databasuppslagningar — och du har automation som körs så snart en händelse i OneUptime (eller i omvärlden) inträffar.

Om runbooks är checklistor för människor under en incident, så är arbetsflöden bakgrundsjobb för ditt projekt — de körs obevakat, de reagerar på saker, och de limmar samman OneUptime med resten av din stack.

## I korthet

- **Toppnivåfunktion** i OneUptime-dashboarden under **Workflows**.
- **Tre triggertyper**: Manuell, Schemalagd (cron), Webhook — plus en **modellhändelse-utlösare** som triggas när någon OneUptime-entitet (incident, larm, monitor, statussida, etc.) skapas, uppdateras eller tas bort.
- **Visuell arbetsyta**: dra noder från en komponentpalett, koppla utgångsportar till ingångsportar.
- **Blandad automation**: HTTP-förfrågningar, Slack / Discord / Microsoft Teams / Telegram-meddelanden, anpassad JavaScript, JSON-parsning, villkor, e-post, anrop till underordnade arbetsflöden och CRUD-operationer på OneUptime-modeller.
- **Globala variabler**: projektomfattande hemligheter och konfiguration som du refererar till från vilket arbetsflöde som helst utan att kopiera och klistra in.
- **Körningar & loggar**: varje körning registreras med status, tidsåtgång och utdata per steg.

## Varför använda arbetsflöden?

De flesta team griper efter arbetsflöden när de vill:

- **Koppla in OneUptime mot ett annat system** — posta en incident till PagerDuty, spegla ett larm till Jira, pinga en webhook i din stack.
- **Reagera på OneUptime-händelser** — när en `Sev 1`-incident öppnas, paga jourchefen *och* skapa ett Linear-ärende *och* lås en feature flag.
- **Schemalägga återkommande jobb** — var femte minut, fråga ett internt API och skriv resultatet till ett externt system.
- **Ta emot data från utanför OneUptime** — en webhook från ett CI-system sparkar igång en kedja av OneUptime-uppdateringar.
- **Återanvända små stycken limlogik** — ett arbetsflöde anropar ett annat, så vanliga mönster bor på ett enda ställe.

## Nyckelbegrepp

| Term | Betydelse |
| --- | --- |
| **Arbetsflöde** | Arbetsytan. En namngiven, återanvändbar graf av utlösare och komponenter med en `isEnabled`-flagga. |
| **Utlösare** | Noden som startar en arbetsflödeskörning. Manuell, Schemalagd, Webhook eller en modellhändelse. Varje arbetsflöde har exakt en utlösare. |
| **Komponent** | En nod som utför arbete — ett HTTP-anrop, ett Slack-meddelande, en JavaScript-snutt, ett villkor, etc. |
| **Port** | En in- eller utgångskontakt på en nod. Komponenter har utgångsportar som `success` och `error`; du kopplar en port till nästa nods ingångsport. |
| **Körning / logg** | En körning av ett arbetsflöde. Innehåller tidsstämpel, status (Running, Success, Failed, Timeout) och den fångade utdatan från varje nod som kördes. |
| **Global variabel** | Ett namngivet värde (ofta en hemlighet eller API-nyckel) som definieras en gång på projektnivå och refereras från vilket arbetsflöde som helst som `{{variable.NAME}}`. |
| **Lokal variabel** | Ett värde som är begränsat till en enskild arbetsflödeskörning — vanligtvis returvärdet från en tidigare nod, refererat som `{{ComponentId.portName}}`. |

## Var arbetsflöden bor i dashboarden

| Sida | Vad du gör där |
| --- | --- |
| **Workflows** | Bläddra, skapa och sök arbetsflödesmallar. |
| **Ett arbetsflödes Builder-flik** | Drag-och-släpp-arbetsytan. Lägg till noder, koppla portar, konfigurera argument. |
| **Ett arbetsflödes Logs-flik** | Varje körning av detta arbetsflöde med filter för status och tidsintervall. Klicka på en körning för att se utdata per nod. |
| **Ett arbetsflödes Settings-flik** | Byt namn, aktivera/inaktivera, ändra beskrivning, hantera etiketter, ta bort. |
| **Workflows → Global Variables** | Definiera projektomfattande värden som refereras från vilket arbetsflöde som helst. Markera ett värde som hemligt för att dölja det från användargränssnittet efter att det sparats. |
| **Workflows → Runs & Logs** | Projektomfattande körningshistorik över alla arbetsflöden. |

## Ett arbetsflödes livscykel

1. **Skapa** — Skapa ett arbetsflöde, släpp en utlösare på arbetsytan, dra in de komponenter du behöver, koppla dem och konfigurera var och en.
2. **Aktivera** — Arbetsflöden levereras inaktiverade. Slå på växeln i Settings när du är säker på att kopplingen är rätt.
3. **Trigga** — Manuell: klicka på **Run Manually** med en valfri JSON-payload. Schemalagd: cron triggas. Webhook: ett externt system gör en `POST` till arbetsflödets URL. Modellhändelse: någon (eller ett annat arbetsflöde) skapar/uppdaterar/tar bort en monitor, incident, ett larm, etc.
4. **Körs** — Workflow Worker går igenom grafen i tur och ordning. Varje komponent läser sina argument (bokstavliga värden eller interpolerade variabler), gör sitt jobb, skriver sitt returvärde och väljer en utgångsport. Nästa nod triggas.
5. **Granska** — Körningen dyker upp i **Logs**. Status, total tidsåtgång, utdata per komponent och eventuella fel sparas under projektets livstid.

## Ett genomarbetat exempel

Mål: när en incident skapas med `Sev 1` i titeln, posta i en Slack-kanal och öppna ett ärende i ditt interna admin-verktyg.

**1. Skapa ett arbetsflöde** med namnet "Sev 1 fan-out."

**2. Släpp en utlösare.** Välj **Incident → On Create**-utlösaren från paletten. Utlösaren exponerar den nya incidenten som ett returvärde.

**3. Släpp en Conditional-komponent.** Koppla utlösarens utgångsport till dess ingång. Sätt villkoret: `{{Incident.title}}` *contains* `Sev 1`.

**4. Från Conditionals `yes`-port, släpp en Slack-komponent.** Kanal: `#incident-room`. Meddelandetext: `Sev 1 declared: {{Incident.title}} — {{Incident.dashboardUrl}}`.

**5. Från samma `yes`-port (parallellt), släpp en API-komponent.** `POST` till `https://admin.internal/incidents`. Body: ett litet JSON-objekt byggt från incidenten.

**6. Aktivera arbetsflödet.** Öppna en incident med titeln "Sev 1 — checkout 500s" i en annan flik. Inom några sekunder anländer Slack-meddelandet, och en ny körning dyker upp under **Logs** med varje nods utdata fångad.

## Hur arbetsflöden passar in med resten av OneUptime

- **Monitorer** upptäcker problem; **incidenter/larm** registrerar dem; **arbetsflöden** reagerar på dem — postar meddelanden, öppnar ärenden, sparkar igång automation.
- **Runbooks** är svarsprocedurer för människor (med valfria skriptsteg). Arbetsflöden är obevakad bakgrundsautomation. De kompletterar varandra — ett runbook-steg kan göra en `POST` till ett arbetsflödes webhook-utlösare.
- **Workspace-anslutningar** (Slack, Microsoft Teams) är de typiska destinationerna för arbetsflödesnotifieringar.
- **Instrumentpaneler** är skrivskyddade vyer; arbetsflöden är skrivsidan — de uppdaterar OneUptime-tillstånd, anropar externa API:er och flyttar runt data.

## Var läsa vidare

- [Skapa ett arbetsflöde](/docs/workflows/authoring) — bygga ett arbetsflöde på arbetsytan, konfigurera noder, koppla portar.
- [Utlösare](/docs/workflows/triggers) — Manuell, Schemalagd, Webhook och modellhändelse-utlösare i detalj.
- [Komponenter](/docs/workflows/components) — katalogen över åtgärder och hur du konfigurerar var och en.
- [Variabler](/docs/workflows/variables) — globala variabler, lokala variabler och hur interpolering fungerar.
- [Körningar & loggar](/docs/workflows/runs-and-logs) — läs körningshistorik, felsök misslyckanden.
- [Konfiguration & säkerhet](/docs/workflows/configuration) — aktivera/inaktivera, ägarskap, etiketter, hemligheter, rekursionsgränser.
