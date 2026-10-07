# Tillstånd och allvarlighetsgrader

Varje incident bär två klassificeringar: ett **tillstånd** som säger var den befinner sig i ert arbete, och en **allvarlighetsgrad** som säger hur ont det gör. I instrumentpanelen ser de lika ut — båda renderas som färgade etiketter i incidentlistan, båda är projektbundna listor du kan byta namn och färg på. De gör helt olika jobb.

Tillstånd styr beteende. Tre booleanska flaggor på tillståndsraderna avgör, tillsammans med tillståndens ordning, vilka incidenter som räknas som aktiva, vilka knappar som visas i incidentens rubrik, när SLA-klockan stannar och när incidenten faller bort från din statussida. Allvarlighetsgrader styr ingenting i sig — de är etiketter som beskriver påverkan, och som andra regler kan matcha på.

Båda listorna skapas när ditt projekt skapas, och båda redigeras under **Incidenter → Inställningar**. Den sektionen av incidenternas sidomeny är ihopfälld som standard, så fäll ut **Inställningar** innan du börjar leta.

## Tillstånd bär beteende, allvarlighetsgrader bär innebörd

Modellen `IncidentState` har `name`, `description`, `color` och `order`, plus tre booleaner: `isCreatedState`, `isAcknowledgedState` och `isResolvedState`. Allt produkten gör med tillstånd utgår från de booleanerna och från `order` — aldrig från tillståndets namn. Det är därför du kan döpa om **Löst** till "Stängd" utan att något går sönder: flaggan följer med raden.

Modellen `IncidentSeverity` har `name`, `description`, `color` och `order` och inget mer. Det finns inga flaggor. Inget i OneUptime behandlar **Kritisk incident** annorlunda än **Mindre incident** av sig självt — allvarlighetsgrad spelar roll bara där du riktar något mot den, som matchningskriteriet **Incident Allvarligheter** på en jourregel.

Några snabba regler:

- **Välj allvarlighetsgrad för att kommunicera påverkan** — den visas i incidentlistan, på incidentens **Översikt**, och den är ett obligatoriskt fält när du deklarerar en incident.
- **Välj tillstånd för att modellera er process** — de svarssteg ni faktiskt går igenom, i den ordning ni går igenom dem.
- **Koda inte in brådska i tillstånd** — ett tillstånd som heter "Kritisk" skulle inte larma någon. Allvarlighetsgrad plus en jourregel gör det.

## De färdiga tillstånden

Tre tillstånd skapas tillsammans med projektet, i den här ordningen. Skapandet är idempotent — ett tillstånd läggs bara till när det inte redan finns ett med det namnet.

| Tillstånd        | `order` | Flagga                | Färg      | Vad det betyder                                       |
| ---------------- | ------- | --------------------- | --------- | ----------------------------------------------------- |
| **Identifierad** | `1`     | `isCreatedState`      | `#fd625e` | Tillståndet nya incidenter hamnar i.                  |
| **Bekräftad**    | `2`     | `isAcknowledgedState` | `#ffbf53` | Någon har tagit sig an incidenten.                    |
| **Löst**         | `3`     | `isResolvedState`     | `#2ab57d` | Incidenten är över och räknas inte längre som aktiv.  |

Lägg märke till namnet: det första tillståndet heter **Identifierad**, även om flera beskrivningar inne i produkten fortfarande kallar det det "skapade" tillståndet. När ett dokument eller en tooltip säger "skapat tillstånd" menas det tillstånd som bär `isCreatedState` — i ett färskt projekt är det **Identifierad**.

## Vad varje tillståndsflagga faktiskt gör

| Flagga                | Syfte                                                                                                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isCreatedState`      | Tillståndet en incident får när ingen valt något. Om inget tillstånd i projektet bär den här flaggan misslyckas skapandet av en incident med ett fel som säger att du ska lägga till ett skapat incidenttillstånd i inställningarna. |
| `isAcknowledgedState` | Markerar projektets bekräftade tillstånd: det som **Acknowledge** flyttar en incident till och som bekräftad-rutan är uppkallad efter. En incident i det, i ett tillstånd efter det eller löst är bekräftad — **Acknowledge** erbjuds inte längre för den, jouren slutar larma för den och dess SLA markeras som besvarad. |
| `isResolvedState`     | Markerar projektets lösta tillstånd: det som **Lös** flyttar en incident till och som nyckeltalsrutan för löst visar. En incident i det, eller i ett tillstånd efter det, är löst — den lämnar **Aktiva incidenter** och en statussidas aktiva del, och dess SLA markeras som löst. |

Bara ett tillstånd per projekt förväntas bära var och en av flaggorna — uppslagningarna hämtar en enda rad. De tre flaggade tillstånden kan byta namn, färg och ordning, men inställningssidan vägrar radera dem och visar ett fel som namnger det skapade, det bekräftade och det lösta tillståndet.

Eftersom gränssnittet läser tillståndsnamnen dynamiskt ändrar ett namnbyte vad du ser överallt — nyckeltalsrutorna, rubrikerna i bekräftelsedialogerna och etiketten i incidentlistan följer alla namnet du gav raden.

## Lägga till egna tillstånd

Gå till **Incidenter → Inställningar → Incidentstatus**. Sidan är en ordnad lista sorterad på stigande `order`, och ett nytt tillstånd läggs till precis ovanför det lösta tillståndet. Dra en rad för att ändra dess plats.

**Fält på ett tillstånd:**

- **Namn** — obligatoriskt, minst två tecken. Platshållaren föreslår något i stil med "Investigating".
- **Beskrivning** — valfri fritext som förklarar när en incident ligger i det här tillståndet.
- **Färg** — obligatorisk. Väljs i färgväljaren; lagras som ett hexvärde i stil med `#fd625e`.

Du kan inte sätta de tre flaggorna från det här formuläret — de tillhör de färdiga raderna. Ett tillstånd du lägger till är därför ett oflaggat tillstånd, vilket får två konsekvenser värda att planera för:

- **Ovanför det lösta tillståndet håller det incidenten aktiv.** **Aktiva incidenter** rymmer incidenterna vars aktuella tillstånd ligger ovanför det lösta tillståndet, så ett tillstånd du lägger till där håller kvar incidenten i den aktiva listan och i räknaren i sidomenyn. Ett tillstånd du drar ned under det lösta tillståndet räknas som löst överallt — i de aktiva listorna, på statussidor, i påminnelser och i SLA:t — och att flytta en incident dit från **Löst** är ingen andra lösning.
- **Dess övergångsknapp är generisk.** I stället för **Acknowledge** eller **Lös** heter bekräftelsedialogen **Markera incident som `<tillståndsnamn>`** med en skicka-knapp **Markera som `<tillståndsnamn>`**.

En vanlig form är att skjuta in ett triage- eller begränsningssteg mellan det bekräftade och det lösta tillståndet — dra till exempel in ett nytt tillstånd "Begränsad" så att det hamnar efter **Bekräftad** och före **Löst**.

## Ordningen är ett verkligt villkor, inte en visningsinställning

Kolumnen `order` tillämpas när en tillståndsändring skrivs, inte bara när listan ritas upp:

- **Övergångar bakåt avvisas.** Att flytta en incident till ett tillstånd som ligger tidigare i ordningen än dess aktuella tillstånd misslyckas med ett fel som namnger båda tillstånden.
- **Att välja om det aktuella tillståndet avvisas.** Att sätta en incident till tillståndet den redan är i misslyckas med "Incident state cannot be same as previous state."
- **En backdaterad rad kan inte dubblera sin granne.** Att skjuta in en tidslinjerad vars tillstånd matchar raden som följer efter den nekas också.
- **Rubrikknapparna följer de flaggade tillståndens plats i ordningen.** **Acknowledge** och **Lös** erbjuds utifrån var det aktuella tillståndet ligger i den ordningssorterade listan. Ett eget tillstånd placerat *efter* det lösta tillståndet visar aldrig någon **Lös**-knapp, eftersom det inte finns något kvar att flytta framåt till.

Så när du lägger till ett tillstånd, placera det där en incident verkligen skulle passera igenom det. Att ordna det fel ser inte bara konstigt ut — det gör övergångar omöjliga.

## De färdiga allvarlighetsgraderna

Tre allvarlighetsgrader skapas tillsammans med projektet, i den här ordningen:

- **Kritisk incident** (`order` 1, `#b70400`) — problem som orsakar mycket stor påverkan på kunder och kräver omedelbar insats. Ett totalt avbrott eller ett dataintrång.
- **Stor incident** (`order` 2, `#fd625e`) — betydande påverkan, kräver oftast omedelbar insats, ibland med en tillfällig lösning som begränsar skadan. Ett viktigt delsystem som fallerar.
- **Mindre incident** (`order` 3, `#ffbf53`) — låg påverkan, hanteras vanligtvis under arbetstid, och de flesta kunder märker det knappast. En liten sänkning av applikationens prestanda.

Allvarlighetsgrad krävs när du deklarerar en incident, och den krävs på varje incidentspecifikation i en monitors kriterier, så varje incident — manuell eller automatisk — kommer med en. Se [Deklarera en incident](/docs/incidents/declaring-incidents) för deklarationsflödet och [Incident- och varningsmallar](/docs/monitor/incident-alert-templating) för den monitordrivna vägen.

## Redigera allvarlighetsgrader

Gå till **Incidenter → Inställningar → Incidentallvar**. Samma form som tillståndssidan — en ordnad lista sorterad på `order`, dra för att ändra ordning, nya allvarlighetsgrader läggs till sist, med **Namn**, **Beskrivning** och **Färg** i formuläret.

Två skillnader mot tillstånd:

- **Det finns inget raderingsskydd.** Vilken allvarlighetsgrad som helst kan raderas, inklusive de tre färdiga.
- **Det finns inga flaggor att ärva.** En ny allvarlighetsgrad beter sig exakt som de färdiga — den är en etikett med en färg och en plats.

**En not om platshållarna.** Allvarlighetsformuläret återanvänder tillståndsformulärets exempeltext ord för ord, så tipsen pratar om incidenttillstånd i stället för allvarlighetsgrader. Strunta i dem och skriv dina egna namn och beskrivningar.

Där allvarlighetsgrad gör mer än att beskriva: under **Incidenter → Regler → Jourregler** är en regels fält **Incident Allvarligheter** ett matchningskriterium. Att lista **Kritisk incident** där är hur "larma databasteamet för allt kritiskt" uttrycks — jourpolicyn bor på regeln, inte på allvarlighetsgraden.

## Flytta en incident genom sina tillstånd

Det finns fyra sätt en incident byter tillstånd:

- **Rubrikknapparna.** Öppna en incident. Om dess aktuella tillstånd ligger före det bekräftade tillståndet får du **Bekräfta** och **Lös**; ligger det mellan de två får du **Lös**. Var och en öppnar en kort bekräftelse — **Bekräfta incident** eller **Lös incident** — med **Meddela statussideprenumeranter** och, hopfällda under **Lägg till en offentlig anteckning**, det valfria fältet **Offentlig anteckning** och väljaren **Välj anteckningsmall** (när projektet har anteckningsmallar). Att bekräfta stoppar också all joureskalering för incidenten.
- **Tillståndstidslinjen.** Lägg till en rad för hand från incidentens sida **Tillståndstidslinje** med **Incidentstatus**, **Börjar den** och **Meddela statussideprenumeranter**.
- **Massändring.** Incidentlistan har massåtgärden **Ändra tillstånd** för att flytta flera incidenter samtidigt.
- **Automatiskt.** Ett monitorkriterium med **Lös incident automatiskt** påslaget löser sin incident när kriteriet inte längre uppfylls, och API:et kan uppdatera tillståndet genom `/api/incident-state-timeline`.

Var och en av dem skriver en tidslinjerad. En tillståndsändring gör dessutom några saker du inte behöver be om: den lägger en post i incidentflödet, tilldelar en Incidentansvarig om incidenten inte redan har en, och uppdaterar SLA-klockan. Att återöppna en löst incident startar en ny SLA-post från återöppningstillfället.

## Vad det gör att bekräfta en incident

En incident är bekräftad från det ögonblick den flyttas till ert bekräftade tillstånd, till ett tillstånd efter det — ett **Undersöks**-tillstånd ni har placerat under **Bekräftad**, till exempel — eller till ett löst tillstånd, på vilket av de fyra sätten ovan som helst. Sidan med tillståndsinställningar visar vilka tillstånd det är. När den är bekräftad:

- **Acknowledge erbjuds inte längre.** Varken i incidentens rubrik, i mobilappen (knappen och svepet), i Slack eller Microsoft Teams eller genom `acknowledge_incident` i OneUptimes MCP-server. Att bekräfta den ändå — från ett jourlarm, Slack eller Teams — avvisas med "Incident is already acknowledged." (eller "Incident is already resolved.") i stället för att flytta tillbaka den uppåt i listan.
- **Jouren slutar larma för den.** Den som bekräftar sitt larm efter att en kollega har bekräftat incidenten, eller flyttat den vidare, får sitt larm bekräftat, och incidenten stannar där den är.
- **SLA:n markeras som besvarad** vid den första sådana förflyttningen; att gå vidare till senare tillstånd behåller den tiden.
- **Tiden till bekräftelse räknas till den första förflyttningen** — nyckeltalsrutan på incidentens **Översikt**, mätvärdet **Time to Acknowledge**, en mätning som slutar när incidenten bekräftas och MTTA i sammanfattningar i Slack och Microsoft Teams. En incident som flyttas direkt från **Identifierad** till **Undersöks** bekräftades då; en som löses direkt bekräftades när den löstes.
- **Ett Bekräftad-filter** — på en instrumentpanels widget med incidentlistor, till exempel — visar incidenterna i ert bekräftade tillstånd och i alla tillstånd efter det, så länge de inte är lösta.

Varningar och episoder följer samma regel med era varningstillstånd.

## Vad det gör att lösa en incident

En incident löses när den flyttas från ett tillstånd ovanför ert lösta tillstånd till det lösta tillståndet eller till ett tillstånd efter det — på vilket av de fyra sätten ovan som helst. Varje lösning:

- **Lämnar tillbaka de monitorer incidenten håller.** En incident som deklareras öppen håller sina monitorer: den satte dem i sin **Change Monitor Status to**-status, om den anger en, och pausade, om den deklarerades för hand, deras övervakning. En redigering medan den är öppen — nya monitorer eller en ändrad status — gör att den håller dem också. Lösningen återupptar deras övervakning och återställer dem till i drift, om inte en annan öppen incident fortfarande ligger på dem, och därefter håller incidenten ingenting. En incident som deklarerades redan löst lämnar alltså inget tillbaka, och inte heller en andra lösning efter en återöppning: en status som monitorerna fått under tiden — från sina prober, från underhåll eller satt för hand — står kvar.
- **Markerar SLA:t som löst** och skriver, när OneUptime AI:s utkast till efteranalys är påslagna, ett utkast till efteranalys.

Att gå vidare från **Löst** till ett tillstånd efter det — **Stängd**, till exempel — är ingen andra lösning: inget av detta körs igen, och inget nytt SLA startar. En incident som deklarerades innan OneUptime började registrera detta lämnar tillbaka sina monitorer vid nästa lösning, som förut.

## Tillståndstidslinjen

Incidentens sida **Tillståndstidslinje** i incidentens sidomeny är revisionsspåret över varje tillstånd incidenten har befunnit sig i. Kortet på den sidan heter **Statustidslinje**, och det sorteras med nyast först.

**Kolumner:**

- **Incidentstatus** — en färgad etikett med tillståndets namn och färg.
- **Börjar den** — när incidenten gick in i det här tillståndet.
- **Slutar den** — när den lämnade det. Det aktuella tillståndet visar `Currently Active`.
- **Varaktighet** — tid tillbringad i tillståndet, räknad fram till nu för det aktuella.
- **Prenumerantaviseringsstatus** — om statussideaviseringen för den här ändringen skickades, hoppades över eller fortfarande väntar, med en länk **mer information**, och — när utskicket misslyckades — en **Retry**-åtgärd.

**Radåtgärder:**

- **Visa orsak** — öppnar en **Rotorsak**-dialog som renderar den Markdown som registrerades med den tillståndsändringen.
- **Visa loggar** — öppnar en dialog som förklarar varför statusen ändrades, med en visare för **Incidenttillståndslogg**.

Tidslinjerader kan skapas och raderas, men inte redigeras. Att radera fel rad skriver om incidentens historik, så behandla det som ett korrigeringsverktyg snarare än en städvana.

## Listan Aktiva incidenter

**Incidenter → Aktiva incidenter** är listan du håller ögonen på under ett pass. Dess definition är exakt ett villkor: incidentens aktuella tillstånd ligger ovanför ert lösta tillstånd — det första tillståndet i ordningen med flaggan `isResolvedState`. Inget annat vägs in — inte allvarlighetsgrad, inte ålder, inte om någon har bekräftat den.

Posten i sidomenyn bär ett rött antalsmärke som använder samma fråga, så märket och listan är alltid överens. När det inte finns något att se säger sidan det.

Den praktiska följden: ett eget tillstånd du lägger till ovanför det lösta tillståndet håller kvar incidenter i den här listan — "Begränsad" är inte "klar" — och ett du placerar efter det tar bort dem, precis som det lösta tillståndet gör. Varningar och episoder följer samma regel med sina egna tillstånd, och räknarna i sidomenyn, påminnelser, statussidor och mobilappen läser den alla.

## Berätta för statussidans prenumeranter om en tillståndsändring

En tillståndsändring kan mejla din statussidas prenumeranter, men den passerar flera grindar. Att förstå dem sparar en hel del felsökning av typen "varför fick ingen någon avisering".

Avisering begärs per tidslinjerad med **Meddela statussideprenumeranter** (`shouldStatusPageSubscribersBeNotified`), kryssrutan i dialogen för tillståndsändring och i det manuella tidslinjeformuläret. När den är av lagras raden med status överhoppad och en förklaring. När den är på köas raden och ett bakgrundsjobb plockar upp den — jobbet körs varje minut, så leveransen är snabb men inte omedelbar.

**Den köade raden hoppas sedan över när något av det här gäller:**

- **Det nya tillståndet är det skapade tillståndet.** Prenumeranterna fick redan veta när incidenten deklarerades, så den första tidslinjeraden skickar medvetet inte ett andra meddelande.
- **Incidenten har inga monitorer kopplade.** Utan resurser finns det ingen statussida att koppla incidenten till.
- **Incidenten är inte synlig på statussidan** (`isVisibleOnStatusPage` är av).
- **Statussidan har incidenter avslaget** (`showIncidentsOnStatusPage` är av). Det här gäller per statussida — andra sidor som visar samma monitor aviseras ändå.

**En sak till som ändrar utfallet.** Om du skriver in en **Offentlig anteckning** i dialogen för tillståndsändring markeras tidslinjeraden som redan aviserad i stället för att köas. Det är anteckningen själv som når prenumeranterna, så de får ett meddelande i stället för två. Det meddelandet nämner det nya tillståndet i varje kanal, så som tillståndsändringsmeddelandet skulle ha gjort: till exempel `[Resolved Incident] <title>` i e-postens ämnesrad och `**Status:** Resolved` i Slack och Microsoft Teams. Anteckningen kräver behörighet att skapa offentliga anteckningar: utan den erbjuder dialogen inte anteckningen, och en tillståndsändring som skickas med en anteckning avvisas, så tillståndet förblir oförändrat. Händelsetypen bakom det rena tillståndsändringsmeddelandet är `Subscriber Incident State Changed`.

Larm, larmepisoder och incidentepisoder erbjuder i stället en privat anteckning vid ett tillståndsbyte (**Lägg till en privat anteckning**), och den fungerar på samma sätt: anteckningen kräver sin egen behörighet (**Create Alert Internal Note**, **Create Alert Episode Internal Note** eller **Create Incident Episode Internal Note** i en egen roll; de inbyggda larm-, incident- och projektrollerna har dem), och ett tillståndsbyte som någon utan den skickar med en privat anteckning avvisas helt, så tillståndet förblir oförändrat.

För vilka som tar emot dem och hur mallarna väljs, se [Prenumeranter och meddelanden](/docs/status-pages/subscribers).

## Hålla en incident borta från statussidan

Tre skilda saker avgör om en incident över huvud taget syns på den publika sidan, och alla tre måste vara sanna:

- **Visa incidenter** (`showIncidentsOnStatusPage`) på statussidan själv.
- **Synlig på statussidan** (`isVisibleOnStatusPage`) på incidenten — en växel på incidentens sida **Inställningar**. Den är sann som standard och finns inte i deklarationsguiden; ett monitorkriterium kan sätta den med **Visa incident på statussida**.
- **Det aktuella tillståndet ligger ovanför det lösta tillståndet.** Det är det som tar bort en incident från den aktiva delen: statussidans fråga hämtar incidenter vars aktuella tillstånd ligger ovanför ert lösta tillstånd, så det lösta tillståndet och varje tillstånd efter det tar bort incidenten. Du arkiverar eller stänger inget — du löser den, och den flyttar in i historiken.

**Privata incidenter dyker aldrig upp.** Att slå på **Privat incident** döljer incidenten från varje statussida, oavsett växlarna ovan, och begränsar den till dess ägare plus projektadministratörer och projektägare.

Hur mycket löst historik sidan behåller är en statussideinställning, inte en incidentinställning. Se [Statussidans resurser och grupper](/docs/status-pages/resources-and-groups) för hur monitorerna på sidan avgör vilka incidenter som visas alls.

## Läs vidare

- [Incidenter – Översikt](/docs/incidents/index) — hur incidentfunktionen hänger ihop.
- [Deklarera en incident](/docs/incidents/declaring-incidents) — deklarationsguiden, mallarna och API:et.
- [Incidentanteckningar, ägare och flöde](/docs/incidents/notes-owners-and-feed) — offentliga anteckningar, privata anteckningar och aktivitetsflödet.
- [Incidentinställningar och automatisering](/docs/incidents/settings) — mallar, anpassade fält, regler och arbetsflödesutlösare.
- [Prenumeranter och meddelanden](/docs/status-pages/subscribers) — vilka som får mejlen en tillståndsändring skickar.
- [Statussidor – Översikt](/docs/status-pages/index) — vad en statussida visar och för vem.
- [Översikt över arbetsflöden](/docs/workflows/index) — att reagera på tillståndsändringar med automation.
