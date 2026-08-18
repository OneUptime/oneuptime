# Incidenter – Översikt

En incident i OneUptime är posten ditt team samlas kring när något går sönder. Den bär ett nummer, en titel, en allvarlighetsgrad, ett aktuellt tillstånd, resurserna den påverkar och allt ditt team skriver ner under arbetets gång — anteckningar, rotorsak, åtgärdssteg och ett flöde som bara växer och registrerar vem som gjorde vad.

Incidenter är det som förvandlar en monitor som slår om till rött till ett samordnat svar. Att deklarera en incident larmar rätt jourrotation, lägger till ägare som aviseras vid varje ändring, startar runbooks och — om du vill det — publicerar avbrottet på din publika statussida så att kunderna slutar öppna ärenden för att fråga om ni redan vet.

Du kan deklarera en incident för hand klockan tre på natten, eller låta en monitor deklarera den åt dig i samma stund som dess kriterier slår till. Hur som helst är incidenten samma objekt, med samma livscykel och samma spårbarhet på slutet.

## I korthet

- **Toppnivåfunktion** — **Incidenter** i instrumentpanelens vänstra navigering, på `/dashboard/{projectId}/incidents`.
- **Tre färdiga tillstånd** — **Identifierad**, **Bekräftad** och **Löst** skapas i varje nytt projekt. Du kan lägga till egna; de tre färdiga kan byta namn och färg men aldrig raderas.
- **Tre färdiga allvarlighetsgrader** — **Kritisk incident**, **Stor incident** och **Mindre incident**. Allvarlighetsgrad är en etikett med en färg och en ordning — den bär inget beteende i sig.
- **Fyra vägar in** — guiden **Deklarera incident**, **Skapa från mall**, en kriterieregel på en monitor, eller `POST /api/incident`.
- **Numrerade per projekt** — varje incident får ett incidentnummer, som visas som `#42` med standardinställningen eller med ditt eget prefix, som `INC-42`.
- **Två sorters anteckningar** — privata anteckningar (interna anteckningar) för ditt team, offentliga anteckningar för statussidans prenumeranter.
- **Inställningarna bor under Incidenter, inte Projektinställningar** — tillstånd, allvarlighetsgrader, mallar, anpassade fält och regelmotorerna finns alla under **Incidenter → Inställningar** och **Incidenter → Regler**.

## Nyckelbegrepp

En handfull ord dyker upp på varenda annan sida i det här avsnittet. Ta dem först.

| Begrepp                | Vad det betyder                                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Incident**           | Själva posten — titel, beskrivning, allvarlighetsgrad, aktuellt tillstånd, berörda resurser och allt som skrivs på den under arbetet.                |
| **Incidenttillstånd**  | Var incidenten befinner sig i sin livscykel. En projektbunden rad med namn, färg och `order`, plus flaggorna som ger den innebörd.                   |
| **Incidentallvar**     | Hur illa det är. En projektbunden rad med namn, färg och `order`. Rent klassificerande — inget i produkten behandlar någon allvarlighetsgrad särskilt. |
| **Incidentnummer**     | En räknare per projekt som visas som `#42`, eller med ett prefix du konfigurerar, som `INC-42`.                                                      |
| **Berörda resurser**   | De monitorer, värdar, Kubernetes-kluster, Docker-värdar, tjänster och annan infrastruktur du kopplar till incidenten.                                |
| **Offentlig anteckning** | En uppdatering skriven för statussidans läsare och prenumeranter. Den renderas i statussidans tidslinje.                                           |
| **Privat anteckning**  | En intern anteckning (modellen `IncidentInternalNote`) för teamet som arbetar. Den når aldrig en statussida.                                         |
| **Ägare**              | En användare eller ett team som ansvarar för incidenten. Ägare aviseras när den skapas, när anteckningar publiceras och när tillståndet ändras.      |
| **Incidentflöde**      | Den växande aktivitetstidslinjen på incidentens **Översikt**, som registrerar tillståndsändringar, anteckningar, ägarändringar, regelkörningar och aviseringar. |
| **Tillståndstidslinje** | Registret över vilket tillstånd incidenten befann sig i, när och hur länge — med prenumerantaviseringsstatus för varje övergång.                    |

## De tre tillstånd OneUptime skapar i varje projekt

När ett projekt skapas lägger OneUptime in exakt tre incidenttillstånd, i den här ordningen:

| Tillstånd        | Ordning | Färg               | Vad det betyder                                                            |
| ---------------- | ------- | ------------------ | -------------------------------------------------------------------------- |
| **Identifierad** | 1       | Röd (`#fd625e`)    | Tillståndet en helt ny incident hamnar i. Det här är det skapade tillståndet. |
| **Bekräftad**    | 2       | Gul (`#ffbf53`)    | Någon har tagit sig an incidenten och arbetar med den.                     |
| **Löst**         | 3       | Grön (`#2ab57d`)   | Incidenten är över. Att lösa den är det som tar bort den från din statussida. |

Namnen är bara etiketter — det som faktiskt styr beteendet är tre booleaner på tillståndsraden: `isCreatedState`, `isAcknowledgedState` och `isResolvedState`. Bara ett tillstånd per projekt förväntas bära var och en av flaggorna.

Den skillnaden betyder mer än den låter:

- `isCreatedState` avgör var en ny incident börjar. Om inget tillstånd väljs uttryckligen vid skapandet letar OneUptime upp projektets skapade tillstånd och använder det.
- `isAcknowledgedState` och `isResolvedState` driver knapparna **Acknowledge** och **Lös** i incidentens rubrik, de två nyckeltalsrutorna på incidentens **Översikt** och antalsmärket **Aktiva incidenter** i sidomenyn.
- **Aktiva incidenter** definieras helt enkelt som "det aktuella tillståndet är inte det lösta tillståndet". Varje eget tillstånd du lägger till räknas därför som aktivt så länge det inte är det lösta.

**Lägg märke till namngivningen.** Det första färdiga tillståndet heter **Identifierad**, även om flera beskrivningar inne i produkten fortfarande kallar det det skapade tillståndet. Om du letar efter "Created" i ditt projekts tillståndslista är det raden som heter **Identifierad**.

Du lägger till egna tillstånd under **Incidenter → Inställningar → Incidentstatus**. Nya tillstånd hamnar sist i den ordnade listan och du kan dra för att ändra ordning. De tre flaggade tillstånden går inte att radera — OneUptime blockerar det — men du kan byta namn och färg på dem, vilket är skälet till att gränssnittet läser tillståndsnamnen dynamiskt.

Ordningen tvingas fram, den är inte kosmetisk: en incident kan inte flyttas till ett tillstånd som ligger tidigare i ordningen än dess nuvarande.

Alla detaljer finns i [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities).

## De tre allvarlighetsgrader OneUptime skapar i varje projekt

Varje nytt projekt får också tre allvarlighetsgrader:

| Allvarlighetsgrad     | Ordning | Färg                | Vad det betyder                                              |
| --------------------- | ------- | ------------------- | ------------------------------------------------------------ |
| **Kritisk incident**  | 1       | Vinröd (`#b70400`)  | Mycket stor kundpåverkan som kräver omedelbar insats.        |
| **Stor incident**     | 2       | Röd (`#fd625e`)     | Betydande påverkan, kräver oftast omedelbar insats.          |
| **Mindre incident**   | 3       | Gul (`#ffbf53`)     | Låg påverkan, hanteras vanligtvis under arbetstid.           |

De fullständiga färdiga beskrivningarna finns i [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities).

Allvarlighetsgrader har `name`, `description`, `color` och `order` och inget mer. Det finns inga flaggor, och ingen kodväg behandlar "Kritisk incident" annorlunda än någon annan rad. Allvarlighetsgrad är hur människor triagerar, och den finns tillgänglig som matchningskriterium när du skriver jourregler — men att välja en allvarlighetsgrad larmar inte i sig någon.

Redigera eller lägg till allvarlighetsgrader under **Incidenter → Inställningar → Incidentallvar**.

## En incidents liv

### 1. Den deklareras

Fyra vägar leder till samma objekt:

- **För hand** — klicka på **Deklarera incident** i incidentlistan. Det öppnar guiden **Deklarera ny incident**, fem steg lång: **Incidentdetaljer**, **Berörda resurser**, **Incidentroller**, **Jour**, **Mer**.
- **Från en mall** — klicka på **Skapa från mall** och välj en sparad **Incidentmall**. Mallar förifyller titel, beskrivning, allvarlighetsgrad, inledande tillstånd, resurser, jourpolicyer, ägare och etiketter.
- **Från en monitor** — en kriterieregel på en monitor med växeln "deklarera en incident" påslagen skapar incidenten automatiskt i samma stund som filtren matchar. Titlar och beskrivningar där stöder mallning med `{{variable}}`.
- **Via API:et** — `POST /api/incident` med en API-nyckel. Servern fyller i `declaredAt`, det skapade tillståndet och incidentnumret åt dig.

Se [Deklarera en incident](/docs/incidents/declaring-incidents) för genomgången fält för fält.

### 2. Rätt personer får veta

När incidenten skapas kör OneUptime den automatisering du konfigurerat: etikettregler, jourregler, ägarregler och runbook-regler. Alla jourtjänstpolicyer som är kopplade till incidenten — manuellt, från en mall eller inflätade av en matchande jourregel — körs parallellt.

Ägare aviseras via e-post, SMS, samtal, push och WhatsApp, i den mån varje användares egna aviseringsinställningar tillåter det. Om en incident inte har några ägare alls går aviseringen i stället till projektets ägare i stället för att försvinna.

Om incidenten syns på en statussida och prenumerantaviseringar är påslagna får prenumeranterna också veta. Aviseringar drivs av cron-jobb som körs varje minut, så räkna med upp till ungefär en minuts fördröjning snarare än ett omedelbart utskick.

### 3. Ditt team arbetar med den

De som svarar bekräftar incidenten, kopplar på berörda resurser, kör runbooks, tilldelar incidentroller och skriver ner saker efter hand som de lär sig dem — privata anteckningar för teamet, offentliga anteckningar för kunderna, plus sidorna **Rotorsak** och **Åtgärd** när bilden klarnar. Allt de gör hamnar i **Incident Flöde** på sidan **Översikt**.

### 4. Den löses

Att klicka på **Lös** flyttar incidenten till det lösta tillståndet, stämplar tillståndstidslinjen, stoppar varaktighetsklockan och tar bort incidenten från den aktiva delen av varje statussida där den visades. Inget annat behöver ändras för att det ska hända — det är flaggan för löst tillstånd som statussidans fråga tittar på.

Därefter kan du skriva en efteranalys och, om du vill, publicera den på statussidan.

## Var incidenter bor i instrumentpanelen

Öppna **Incidenter** i den vänstra navigeringen. Sidomenyn är indelad i sektioner:

| Sektion            | Vad du gör där                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Översikt**       | **Alla incidenter** och **Aktiva incidenter** — den senare bär ett rött märke med antalet incidenter som inte är i det lösta tillståndet.                              |
| **Episoder**       | Incidentepisoder, en separat grupperingsfunktion med egna sidor.                                                                                                        |
| **AI**             | **Utredning** och **Åtgärd** — inställningar för automatisk utredning och automatisk åtgärd.                                                                            |
| **Arbetsyta**      | Kopplingarna till **Slack** och **Microsoft Teams** för incidenter.                                                                                                     |
| **Regler**         | Regelmotorerna: **Grupperingsregler**, **Jourregler**, **Ägarregler**, **Runbook-regler**, **Sekretessregler**, **Etikettregler**, **SLA-regler**, **Reminder Rules**.  |
| **Inställningar**  | **Incidentstatus**, **Incidentallvar**, **Incidentmallar**, **Anteckningsmallar**, **Postmortem-mallar**, **Anpassade fält**, **Incidentroller**, **Fler inställningar**. |

**Regler** och **Inställningar** är ihopfällda som standard — fäll ut dem för att hitta sidorna som resten av den här dokumentationen hänvisar till. Incidentkonfigurationen ligger inte under Projektinställningar; allt bor här.

Själva incidentlistan visar **Incidentnummer**, **Titel**, **Tillstånd**, **Allvarlighetsgrad**, **Berörda resurser**, **Deklarerad**, **Varaktighet**, **Etiketter** och **Ägare**, med massåtgärden **Ändra tillstånd** för att stänga flera på en gång.

## Vad varje sida på en incident visar

Öppna en incident så får du en vänstermeny, grupperad så här:

- **Översikt** — kortet **Incidentdetaljer** (titel, allvarlighetsgrad, etiketter, incidentnummer, deklarerad den, deklarerad av, jourpolicyer), ett kort med **Berörda resurser** och **Incident Flöde**. Ovanför dem nyckeltalsrutor för tid till bekräftelse, tid till lösning och total **Varaktighet**.
- **Tillståndstidslinje** — varje tillstånd incidenten har befunnit sig i, med **Börjar den**, **Slutar den**, **Varaktighet** och prenumerantaviseringsstatus för varje övergång. **Visa orsak** och **Visa loggar** förklarar varför varje ändring skedde.
- **SLA** — SLA-uppföljning för den här incidenten.
- **Beskrivning**, **Rotorsak**, **Åtgärd** — tre Markdown-sidor. Beskrivningen är den som visas på din statussida.
- **Runbooks** — runbook-körningar kopplade till den här incidenten.
- **Efteranalys** — redogörelsen, som du kan välja att publicera på statussidan.
- **Roller**, **Jourexekveringar**, **Ägare** — vilka som är på den, vilka policyer som körde och vem som aviseras.
- **Aviseringsloggar**, **AI-loggar**, **Granskningsloggar** — vad som skickades och vad som ändrades.
- **Privata anteckningar** och **Offentliga anteckningar** — under sektionen **Anteckningar** i sidomenyn.
- **Anpassade fält**, **Inställningar**, **Ta bort incident** — under **Avancerad**. Sidan **Inställningar** rymmer **Synlig på statussidan**, **Privat incident** och kortet **Reminders**.

[Incidentanteckningar, ägare och flöde](/docs/incidents/notes-owners-and-feed) går igenom samarbetssidorna på djupet.

## Hur incidenter hänger ihop med resten av OneUptime

- **Monitorer upptäcker problemet; incidenter registrerar det.** En kriterieregel på en monitor kan deklarera en incident automatiskt och förifylla titel, allvarlighetsgrad, jourpolicyer, ägare, etiketter och åtgärdsanteckningar. Se [Incident- och varningsmallar](/docs/monitor/incident-alert-templating) för variablerna som finns där.
- **Jourpolicyer sköter larmningen.** Koppla på policyer i steget **Jour** i deklarationsguiden, på en mall, eller via **Incidenter → Regler → Jourregler**. Varje matchande regel utlöses — mängden som körs är unionen av alla träffar plus allt som kopplats på direkt, avdubblettad.
- **Runbooks talar om för folk vad de ska göra.** Runbook-regler kopplar på en procedur automatiskt när en matchande incident skapas, och de som svarar kan starta en för hand från incidenten. Se [Runbooks – Översikt](/docs/runbooks/index).
- **Statussidor berättar för kunderna.** En incident visas i en statussidas aktiva lista när sidan har incidenter påslaget, incidenten är markerad som synlig på statussidan och dess aktuella tillstånd inte är det lösta. Privata incidenter döljs alltid från varje statussida. Se [Statussidor – Översikt](/docs/status-pages/index).
- **Arbetsflöden automatiserar runt den.** Utlösarna **On Create Incident**, **On Update Incident** och **On Delete Incident** låter dig bygga kodfri automation ovanpå incidentens livscykel. Se [Översikt över arbetsflöden](/docs/workflows/index).

## Läs vidare

- [Deklarera en incident](/docs/incidents/declaring-incidents) — guiden, mallarna, monitorkriterierna och API:et.
- [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities) — tillståndsflaggorna, egna tillstånd och klassificering av allvarlighetsgrad.
- [Incidentanteckningar, ägare och flöde](/docs/incidents/notes-owners-and-feed) — offentliga och privata anteckningar, ägare och aktivitetsflödet.
- [Incidentinställningar och automatisering](/docs/incidents/settings) — mallar, anpassade fält, nummerprefix och regelmotorerna.
- [Statussidor – Översikt](/docs/status-pages/index) — hur incidenter når dina kunder.
- [Prenumeranter och meddelanden](/docs/status-pages/subscribers) — vem som aviseras när en incident rör på sig.
