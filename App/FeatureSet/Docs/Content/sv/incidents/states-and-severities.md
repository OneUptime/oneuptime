# Tillstånd och allvarlighetsgrader

Varje incident bär två klassificeringar: ett **tillstånd** som säger var den befinner sig i ert arbete, och en **allvarlighetsgrad** som säger hur ont det gör. I instrumentpanelen ser de lika ut — båda renderas som färgade piller i incidentlistan, båda är projektbundna listor du kan byta namn och färg på. De gör helt olika jobb.

Tillstånd driver beteende. Tre booleska flaggor på tillståndsraderna avgör vilka incidenter som räknas som aktiva, vilka knappar som visas i incidentens sidhuvud, när SLA-klockan stannar och när incidenten faller bort från din statussida. Allvarlighetsgrader driver ingenting i sig — de är etiketter som beskriver påverkan, och som andra regler kan matcha på.

Båda listorna fylls i när ditt projekt skapas, och båda redigeras under **Incidenter → Inställningar**. Den sektionen av incidenternas sidomeny är ihopfälld som standard, så fäll ut **Inställningar** innan du börjar leta.

## Tillstånd bär beteende, allvarlighetsgrader bär innebörd

Modellen `IncidentState` har `name`, `description`, `color` och `order`, plus tre booleska värden: `isCreatedState`, `isAcknowledgedState` och `isResolvedState`. Allt produkten gör med tillstånd utgår från de booleska värdena och från `order` — aldrig från tillståndets namn. Det är därför du kan byta namn på **Löst** till "Stängd" utan att något går sönder: flaggan följer med raden.

Modellen `IncidentSeverity` har `name`, `description`, `color` och `order` och inget annat. Det finns inga flaggor. Inget i OneUptime behandlar **Critical Incident** annorlunda än **Minor Incident** av sig själv — allvarlighetsgrad spelar roll bara där du riktar något mot den, som matchningskriteriet **Incident Allvarligheter** på en jourregel.

Några snabba regler:

- **Välj allvarlighetsgrad för att kommunicera påverkan** — den visas i incidentlistan, på incidentens **Översikt**, och den är ett obligatoriskt fält när du deklarerar en incident.
- **Välj tillstånd för att modellera din process** — de steg i arbetet ni faktiskt går igenom, i den ordning ni går igenom dem.
- **Koda inte in brådska i tillstånd** — ett tillstånd som heter "Kritisk" larmar ingen. Allvarlighetsgrad plus en jourregel gör det.

## De förskapade tillstånden

Tre tillstånd skapas tillsammans med projektet, i den här ordningen. Skapandet är idempotent — ett tillstånd läggs bara till när det inte redan finns ett med det namnet.

| Tillstånd        | `order` | Flagga                | Färg      | Vad det betyder                                       |
| ---------------- | ------- | --------------------- | --------- | ------------------------------------------------------ |
| **Identified**   | `1`     | `isCreatedState`      | `#fd625e` | Tillståndet nya incidenter hamnar i.                  |
| **Bekräftad**    | `2`     | `isAcknowledgedState` | `#ffbf53` | Någon har tagit sig an incidenten.                    |
| **Löst**         | `3`     | `isResolvedState`     | `#2ab57d` | Incidenten är över och slutar räknas som aktiv.       |

Notera namnet: det första tillståndet är **Identified**, även om flera beskrivningar inne i produkten fortfarande kallar det det "skapade" tillståndet. När en dokumentationssida eller ett verktygstips säger "skapat tillstånd" menas det tillstånd som bär `isCreatedState` — i ett nytt projekt är det **Identified**.

## Vad varje tillståndsflagga faktiskt gör

| Flagga                | Syfte                                                                                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isCreatedState`      | Tillståndet en incident får när ingen valt ett. Om inget tillstånd i projektet bär den här flaggan misslyckas skapandet av en incident med ett fel som säger att du ska lägga till ett skapat incidenttillstånd från inställningarna. |
| `isAcknowledgedState` | Driver knappen **Acknowledge** och statistikrutan "<tillståndsnamn> in" på incidentens **Översikt**. Vid en tillståndsändring till det här tillståndet markeras incidentens SLA som besvarad.       |
| `isResolvedState`     | Driver knappen **Lös** och statistikrutan för löst, definierar listan **Aktiva incidenter** och är det som tar bort incidenten från en statussidas aktiva sektion. Markerar SLA:t som löst.         |

Bara ett tillstånd per projekt förväntas bära vardera flaggan — uppslagningarna hämtar en enda rad. De tre flaggade tillstånden kan byta namn, färg och ordning, men inställningssidan vägrar radera dem och visar ett fel som namnger det skapade, det bekräftade och det lösta tillståndet.

Eftersom gränssnittet läser tillståndsnamn dynamiskt ändrar ett namnbyte vad du ser överallt — statistikrutorna, bekräftelsemodalernas rubriker och pillret i incidentlistan följer alla namnet du gav raden.

## Lägga till egna tillstånd

Gå till **Incidenter → Inställningar → Incidentstatus**. Sidan är en ordnad lista sorterad på `order` stigande, och nya tillstånd läggs till sist. Dra en rad för att ändra dess position.

**Fält på ett tillstånd:**

- **Namn** — obligatoriskt, minst två tecken. Platshållaren föreslår något i stil med "Investigating".
- **Beskrivning** — valfri fritext som förklarar när en incident ligger i det här tillståndet.
- **Färg** — obligatorisk. Vald från färgväljaren; lagras som ett hexvärde som `#fd625e`.

Du kan inte sätta de tre flaggorna från det här formuläret — de tillhör de förskapade raderna. Ett tillstånd du lägger till är därför ett oflaggat tillstånd, vilket har två konsekvenser värda att planera för:

- **Det räknas som aktivt.** **Aktiva incidenter** definieras som "aktuellt tillstånd är inte det lösta tillståndet", så allt du lägger till utom det lösta tillståndet håller kvar incidenten i den aktiva listan och i räknaren i sidomenyn.
- **Dess övergångsknapp är generisk.** I stället för **Acknowledge** eller **Lös** har bekräftelsemodalen rubriken **Mark Incident as `<state name>`** med skicka-knappen **Mark as `<state name>`**.

En vanlig form är att skjuta in ett triage- eller mitigeringssteg mellan det bekräftade och det lösta tillståndet — till exempel dra ett nytt tillstånd "Mitigerad" så att det ligger efter **Bekräftad** och före **Löst**.

## Ordningen är en verklig begränsning, inte en visningspreferens

Kolumnen `order` tillämpas när en tillståndsändring skrivs, inte bara när listan ritas upp:

- **Bakåtövergångar avvisas.** Att flytta en incident till ett tillstånd som ligger tidigare i ordningen än dess nuvarande misslyckas med ett fel som namnger båda tillstånden.
- **Att välja om det aktuella tillståndet avvisas.** Att sätta en incident till det tillstånd den redan är i misslyckas med "Incident state cannot be same as previous state."
- **En backdaterad rad kan inte dubblera sin granne.** Att skjuta in en tidslinjerad vars tillstånd matchar raden som följer efter den avvisas också.
- **Sidhuvudets knappar följer de flaggade tillståndens position i ordningen.** **Acknowledge** och **Lös** erbjuds utifrån var det aktuella tillståndet ligger i den ordningssorterade listan. Ett eget tillstånd placerat *efter* det lösta tillståndet visar aldrig en **Lös**-knapp, eftersom det inte finns något kvar att gå framåt till.

Så när du lägger till ett tillstånd, placera det där en incident verkligen skulle passera igenom. Att ordna det fel ser inte bara konstigt ut — det gör övergångar omöjliga.

## De förskapade allvarlighetsgraderna

Tre allvarlighetsgrader skapas tillsammans med projektet, i den här ordningen:

- **Critical Incident** (`order` 1, `#b70400`) — problem som orsakar mycket stor påverkan på kunder och kräver omedelbart gensvar. Ett fullständigt avbrott eller ett dataintrång.
- **Major Incident** (`order` 2, `#fd625e`) — betydande påverkan, kräver oftast omedelbart gensvar, ibland med en workaround som begränsar skadan. Ett viktigt delsystem som fallerar.
- **Minor Incident** (`order` 3, `#ffbf53`) — låg påverkan, hanteras vanligtvis inom kontorstid, och de flesta kunder märker det troligen inte. En liten nedgång i applikationens prestanda.

Allvarlighetsgrad är obligatorisk när du deklarerar en incident, och den är obligatorisk på varje incidentspecifikation i en monitors kriterier, så varje incident — manuell eller automatisk — kommer med en. Se [Deklarera en incident](/docs/incidents/declaring-incidents) för deklarationsflödet och [Incident- och varningsmallar](/docs/monitor/incident-alert-templating) för den monitordrivna vägen.

## Redigera allvarlighetsgrader

Gå till **Incidenter → Inställningar → Incidentallvar**. Samma form som tillståndssidan — en ordnad lista sorterad på `order`, dra för att ändra ordning, nya allvarlighetsgrader läggs till sist, med **Namn**, **Beskrivning** och **Färg** i formuläret.

Två skillnader mot tillstånd:

- **Det finns inget raderingsskydd.** Vilken allvarlighetsgrad som helst kan raderas, inklusive de tre förskapade.
- **Det finns inga flaggor att ärva.** En ny allvarlighetsgrad beter sig precis som de förskapade — den är en etikett med en färg och en position.

**En notering om platshållarna.** Formuläret för allvarlighetsgrad återanvänder tillståndsformulärets exempeltext ord för ord, så ledtexterna talar om incidenttillstånd i stället för allvarlighetsgrader. Ignorera dem och skriv dina egna namn och beskrivningar för allvarlighetsgrader.

Där allvarlighetsgrad gör mer än att beskriva: under **Incidenter → Regler → Jourregler** är en regels fält **Incident Allvarligheter** ett matchningskriterium. Att lista **Critical Incident** där är hur "larma databasteamet för allt kritiskt" uttrycks — jourpolicyn bor på regeln, inte på allvarlighetsgraden.

## Flytta en incident genom dess tillstånd

Det finns fyra sätt en incident byter tillstånd:

- **Sidhuvudets knappar.** Öppna en incident. Om dess aktuella tillstånd ligger före det bekräftade tillståndet får du **Acknowledge** och **Lös**; om det ligger mellan de två får du **Lös**. Var och en öppnar en bekräftelsemodal — **Acknowledge Incident** eller **Resolve Incident** — som också erbjuder **Välj anteckningsmall**, **Offentlig anteckning** och **Meddela statussideprenumeranter**.
- **Tillståndstidslinjen.** Lägg till en rad för hand från incidentens sida **Tillståndstidslinje** med **Incidentstatus**, **Börjar den** och **Meddela statussideprenumeranter**.
- **Massändring.** Incidentlistan har massåtgärden **Ändra tillstånd** för att flytta flera incidenter på en gång.
- **Automatiskt.** Ett monitorkriterium med **Lös incident automatiskt** aktiverat löser sin incident när kriteriet inte längre uppfylls, och API:et kan uppdatera tillståndet via `/api/incident-state-timeline`.

Var och en av dessa skriver en tidslinjerad. En tillståndsändring gör också ett par saker du inte behöver be om: den postar en post i incidentflödet, tilldelar en Incident Commander om incidenten inte redan har en, och uppdaterar SLA-klockan. Att återöppna en löst incident startar en ny SLA-post från återöppningstillfället.

## Tillståndstidslinjen

Incidentens sida **Tillståndstidslinje** i incidentens sidomeny är spårbarheten över varje tillstånd incidenten har befunnit sig i. Kortet på den sidan har rubriken **Statustidslinje**, och det är sorterat med nyast först.

**Kolumner:**

- **Incidentstatus** — ett färgat piller med tillståndets namn och färg.
- **Börjar den** — när incidenten gick in i det här tillståndet.
- **Slutar den** — när den lämnade det. Det aktuella tillståndet visar `Currently Active`.
- **Varaktighet** — tid tillbringad i tillståndet, räknat till nu för det aktuella.
- **Prenumerantaviseringsstatus** — om statussideaviseringen för den här ändringen skickades, hoppades över eller fortfarande väntar, med en länk **mer information**, och — när utskicket misslyckades — en **Retry**-åtgärd.

**Radåtgärder:**

- **Visa orsak** — öppnar en **Rotorsak**-modal som renderar den markdown som registrerades med den tillståndsändringen.
- **Visa loggar** — öppnar en modal som förklarar varför statusen ändrades, med en visare för **Incidenttillståndslogg**.

Tidslinjerader kan skapas och raderas, men inte redigeras. Att radera fel rad skriver om incidentens historia, så behandla det som ett korrigeringsverktyg snarare än en städvana.

## Listan Aktiva incidenter

**Incidenter → Aktiva incidenter** är listan du håller ögonen på under ett pass. Dess definition är exakt ett villkor: incidentens aktuella tillstånd är ett tillstånd där `isResolvedState` är falskt. Inget annat vägs in — inte allvarlighetsgrad, inte ålder, inte om någon har bekräftat den.

Posten i sidomenyn bär ett rött räknarmärke som använder samma fråga, så märket och listan är alltid överens. När det inte finns något att se säger sidan det.

Den praktiska konsekvensen: varje eget tillstånd du lägger till håller kvar incidenter i den här listan. Det är oftast vad du vill — "Mitigerad" är inte "klar" — men det betyder att märket bara nollställs när incidenter faktiskt når det lösta tillståndet.

## Berätta för statussidans prenumeranter om en tillståndsändring

En tillståndsändring kan mejla dina statussideprenumeranter, men den passerar flera grindar. Att förstå dem sparar mycket "varför blev ingen aviserad"-felsökning.

Avisering begärs per tidslinjerad med **Meddela statussideprenumeranter** (`shouldStatusPageSubscribersBeNotified`), kryssrutan i modalen för tillståndsändring och i det manuella tidslinjeformuläret. När den är av lagras raden med status överhoppad och en förklaring. När den är på köas raden och ett bakgrundsjobb plockar upp den — jobbet körs varje minut, så leveransen är snabb men inte omedelbar.

**Den köade raden hoppas sedan över när något av det här gäller:**

- **Det nya tillståndet är det skapade tillståndet.** Prenumeranterna fick redan veta när incidenten deklarerades, så den första tidslinjeraden skickar medvetet inte ett andra meddelande.
- **Incidenten har inga monitorer kopplade.** Utan resurser finns det ingen statussida att mappa incidenten till.
- **Incidenten är inte synlig på statussidan** (`isVisibleOnStatusPage` är av).
- **Statussidan har incidenter avstängda** (`showIncidentsOnStatusPage` är av). Den här gäller per statussida — andra sidor som visar samma monitor aviseras ändå.

**En sak till som ändrar utfallet.** Om du skriver en **Offentlig anteckning** i modalen för tillståndsändring markeras tidslinjeraden som redan aviserad i stället för köad. Anteckningen själv är det som når prenumeranterna, så de får ett meddelande i stället för två. Händelsetypen bakom det rena tillståndsändringsmeddelandet är `Subscriber Incident State Changed`.

För vem som tar emot dessa och hur mallarna väljs, se [Prenumeranter och meddelanden](/docs/status-pages/subscribers).

## Hålla en incident borta från statussidan

Tre separata saker avgör om en incident alls syns på den offentliga sidan, och alla tre måste vara sanna:

- **Visa incidenter** (`showIncidentsOnStatusPage`) på själva statussidan.
- **Synlig på statussidan** (`isVisibleOnStatusPage`) på incidenten — en växel på incidentens sida **Inställningar**. Den är sann som standard och finns inte i deklarationsguiden; ett monitorkriterium kan sätta den med **Visa incident på statussida**.
- **Det aktuella tillståndet är inte det lösta tillståndet.** Det är det här som tar bort en incident från den aktiva sektionen: statussidans fråga hämtar incidenter vars aktuella tillstånd är vilket olöst tillstånd som helst. Du arkiverar eller stänger ingenting — du löser den, och den flyttar in i historiken.

**Privata incidenter syns aldrig.** Att slå på **Privat incident** döljer incidenten från varje statussida, oavsett växlarna ovan, och begränsar den till dess ägare plus projektadministratörer och projektägare.

Hur mycket löst historik sidan behåller är en statussideinställning, inte en incidentinställning. Se [Statussidans resurser och grupper](/docs/status-pages/resources-and-groups) för hur monitorerna på sidan avgör vilka incidenter som alls visas.

## Läs vidare

- [Incidenter – Översikt](/docs/incidents/index) — hur incidentområdet hänger ihop.
- [Deklarera en incident](/docs/incidents/declaring-incidents) — deklarationsguiden, mallar och API:et.
- [Incidentanteckningar, ägare och flöde](/docs/incidents/notes-owners-and-feed) — offentliga anteckningar, privata anteckningar och aktivitetsflödet.
- [Incidentinställningar och automatisering](/docs/incidents/settings) — mallar, anpassade fält, regler och arbetsflödesutlösare.
- [Prenumeranter och meddelanden](/docs/status-pages/subscribers) — vem som får de e-postmeddelanden en tillståndsändring skickar.
- [Statussidor – Översikt](/docs/status-pages/index) — vad en statussida visar och för vem.
- [Översikt över arbetsflöden](/docs/workflows/index) — reagera på tillståndsändringar med automation.
