# Resurser och grupper

En resurs är en rad på din statussida — en monitor (eller en monitorgrupp) med ett namn besökarna förstår, en aktuell status och eventuellt en drifttidssiffra och ett historikdiagram. En grupp är en sektion som rymmer resurser, så att en sida med fyrtio monitorer läses som "API", "Webbapp" och "Datapipeline" i stället för som en enda oändlig lista.

Du bygger båda på en och samma skärm. Öppna en statussida och välj **Resurser** i sidomenyn (posten heter **Monitorer** i projekt som inte har monitorgrupper aktiverade). Grupper hade tidigare en egen sida; det har de inte längre, och den gamla URL:en `/groups` skickar bara vidare hit.

Får du den här delen rätt är resten av statussidan dekoration. Besökarna avgör "är det jag eller är det de?" utifrån de här raderna, så namnge dem som kunderna pratar om er produkt — **Checkout API**, inte `prod-checkout-lb-healthcheck-us-east-1`.

## Skärmen Resurser

Skärmen är tudelad. Till vänster ligger en navigator som listar varje grupp på sidan; till höger ligger innehållet i den grupp du valt.

- **Gruppnavigatorn (vänster)** — ett träd av grupper, med en sökruta (**Search groups...**) ovanför och en löpande räknare under, i stil med `3 groups · 12 resources`. När en sida har fler grupper än vad som får plats visar en knapp **Show N more of M** resten.
- **Top of page** — den första raden i navigatorn. Den rymmer resurser som inte ligger i någon grupp, och verktygstipset säger precis vad det innebär: besökarna ser dessa först, ovanför varje grupp. Har sidan inga grupper alls heter den högra rutan **All resources** i stället.
- **Resursrutan (höger)** — döpt efter gruppen du valt. I dess rubrik ligger **Edit Group**, primärknappen **Lägg till monitor** och en **More actions**-meny.

Två knappar bor i själva kortrubriken: **New Group** och en trepunktsmeny med **Import groups from CSV** och **Uppdatera**.

Kortets beskrivning ändrar sig efter hur din sida ser ut. Med grupper står det att det här är allt besökarna ser och att du ska välja en grupp till vänster för att ändra vad som ligger i den. Utan grupper puffar den för att skapa en, för att dela upp en längre sida i sektioner.

**Tomma tillstånd talar om vad du ska göra.** En tom grupp visar **No monitors here yet** med **Lägg till monitor**, **Add Multiple** och — bara när statussidan inte har några grupper alls — **Create a Group**. En sökning utan träffar visar **No resources match your search**. En tom navigator berättar att grupper delar upp en längre statussida i sektioner och att de kan ligga i varandra.

## Lägga till en monitor

Välj gruppen resursen ska hamna i (eller **Top of page** för en grupplös rad) och klicka sedan på **Lägg till monitor**. Modalen heter **Add a monitor to {group}** och har två steg: **Monitordetaljer** och **Avancerad**.

I **Monitordetaljer**:

- **Övervakning** — rullgardinsmenyn med projektets monitorer, platshållare **Välj övervakning**. Obligatoriskt.
- **Visningsnamn** — obligatoriskt. Det är texten besökarna läser, och den lagras separat från monitorns eget namn, så du kan döpa om den här utan att röra övervakningen.
- **Beskrivning** — valfri markdown som visas under raden. Bra för en mening om vad tjänsten faktiskt gör.

Har projektet monitorgrupper aktiverade står det **Add a Monitor Group instead.** i en länk under menyn — klicka på den så byts rullgardinsmenyn **Övervakning** mot en **Monitor Grupp**-meny (**Välj övervakningsgrupp**). Länken vänder sedan till **Add a Monitor instead.** så att du kan gå tillbaka. Använd en monitorgrupp när du vill att en rad på sidan ska representera flera kontroller sammanslagna.

### Lägga till flera på en gång

**Add Multiple** (som också heter **Add multiple monitors** i menyn **More actions**) öppnar **Add Multiple Monitors**. Den har samma två steg, men det första är en flerval av **Monitorer** i stället för en enkel rullgardinsmeny, och visningsalternativen du väljer i **Avancerad** gäller varje monitor du valt. Det är snabbaste sättet att fylla en ny sida.

## Visningsalternativ på en resurs

Steget **Avancerad** ser likadant ut i formuläret för en enskild resurs som i massmodalen. Allt här gäller per resurs — två rader i samma grupp kan vara olika inställda.

| Fält                                                     | Syfte                                                                                                     |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Verktygstips** (`displayTooltip`)                      | Extra text som visas bredvid resursen på din statussida. Använd den för omfattning: "Kunder i USA och EU". |
| **Visa aktuell resursstatus** (`showCurrentStatus`)      | På som standard. Visar den aktuella statusen — i drift, degraderad, nere — bredvid raden.                  |
| **Visa upptid %** (`showUptimePercent`)                  | Av som standard. Visar en drifttidsprocent bredvid resursen.                                              |
| **Välj precision för drifttid** (`uptimePercentPrecision`) | Dyker upp först när **Visa upptid %** är på. Obligatorisk, standard är en decimal.                       |
| **Visa statushistorikdiagram** (`showStatusHistoryChart`) | På som standard. Visar stapeldiagrammet med drifttid dag för dag för resursen.                            |

**Visningsnamn** (`displayName`) och **Beskrivning** (`displayDescription`) från det första steget är också rent visuella — de ändrar aldrig monitorn i sig.

## Drifttidsprocent och historikdiagram

Både **Visa upptid %** och **Visa statushistorikdiagram** vilar på en inställning som bor någon annanstans. Fönstret de täcker är **Visa upptidshistorik (i dagar)** under **Statussidor → din sida → Avancerad → Avancerade inställningar**, i kortet **Inställningar för drifttidshistorik**. Det tar 1 till 90 dagar och är 90 som standard.

Ordningen är alltså: slå på växlarna per resurs, och sätt sedan fönstret en gång för hela sidan.

**Precisionen är en avvägning.** Rullgardinsmenyn **Välj precision för drifttid** erbjuder `99% (No Decimal)`, `99.9% (One Decimal)`, `99.99% (Two Decimal)` och `99.999% (Three Decimal)`. Fler decimaler ser exakta ut och bjuder in till diskussion om den tredje; publicerar ni ett SLA på tre nior, matcha det och inte mer.

Grupper har egna kopior av de här växlarna — se nedan — så en grupp kan visa en summerad procent medan de enskilda monitorerna inuti håller tyst, eller tvärtom.

Färgerna på historikdiagrammets staplar, och vilka monitorstatusar som räknas som "nere", sätts på varumärkesskärmen **Översiktssida** och behandlas i [Statussidans varumärke och domäner](/docs/status-pages/branding-and-domains).

## Grupper

Klicka på **New Group** för att öppna **Create New Status Page Group**. Formuläret har tre steg: **Gruppdetaljer**, **Layout** och **Avancerad**.

**Gruppdetaljer**:

- **Gruppnamn** (`name`) — obligatoriskt. Det här är sektionsrubriken besökarna ser.
- **Gruppbeskrivning** (`description`) — valfri markdown, visas under rubriken.
- **Parent Group** (`parentStatusPageGroupId`) — valfri. Lämna den på **No parent group (top level)** för att hålla gruppen på översta nivån.
- **Expandera på statussidan som standard** (`isExpandedByDefault`) — om sektionen börjar öppen eller ihopfälld för besökarna.

**Avancerad** speglar resursväxlarna på gruppnivå:

- **Visa aktuell gruppstatus** (`showCurrentStatus`) — på som standard. Visar en status bredvid gruppens rubrik.
- **Visa upptid %** (`showUptimePercent`) — av som standard, med **Välj precision för drifttid** som dyker upp när den slås på.

Redigering fungerar likadant: **Edit Group** i rutans rubrik, eller **Edit group** i navigatorns radmeny, öppnar **Edit Status Page Group** med en knapp **Spara ändringar**.

Rutans rubrik visar etiketter för de inställningar som är påslagna — **Grid**, **Collapsed by default**, **Uptime %** — så att du ser hur en grupp är inställd utan att öppna formuläret.

### Hantera en grupp

Navigatorns radmeny rymmer **Edit group**, **Move up**, **Move down**, **Visa ID** och **Delete group**. Rutans **More actions**-meny har de längre motsvarigheterna — **Edit this group**, **Add a sub group**, **Move group up**, **Move group down**, **Show group ID**, **Uppdatera** och **Delete this group**. En grupp som sparats utan namn renderas som **Untitled group**, vilket är ett bra tecken på att du tänkte skriva något.

## Nästlade grupper

Grupper kan ligga i varandra: sätt **Parent Group** på barnet, eller använd navigatorns åtgärd **Add a sub group inside this group**. Formulärets egen hjälptext beskriver formen den är byggd för — något i stil med affärsområde › region › marknad — och nämner att varje nivå visar den summerade statusen och drifttiden för allt under sig.

När en grupp har barn visar resursrutan en rad **Sub groups**-etiketter som länkar rakt in i varje barn, så att du kan vandra genom hierarkin utan att gå tillbaka till navigatorn.

Nästling gör verklig nytta på stora sidor: en hostingleverantör med regioner inuti produkter, eller en handlare med marknader inuti affärsområden. På en sida med tolv monitorer är en enda platt nivå vänligare.

## Listlayout kontra rutnätslayout

Steget **Layout** sätter **Visningsläge** (`viewMode`) för gruppen, och det ändrar hur gruppen renderas publikt.

| Om du vill…                                                          | Välj                     |
| -------------------------------------------------------------------- | ------------------------ |
| Visa en enkel lodrät lista över tjänster, en per rad                 | **List** (standard)      |
| Visa samma tjänst över flera regioner eller tenants som en matris    | **Grid**                 |

Väljer du **Grid** dyker fyra fält till upp:

- **Etikett för radaxel** — namnet på raddimensionen, platshållare `Service`.
- **Värden för radaxel** — själva raderna, tillagda en i taget med **Add Row** (platshållare `e.g. Auth`).
- **Etikett för kolumnaxel** — kolumndimensionen, platshållare `Region`.
- **Värden för kolumnaxel** — läggs till med **Add Column** (platshållare `e.g. US-East`).

Varje monitor i en rutnätsgrupp placeras sedan i en cell, så massmodalen frågar efter rad och kolumn vid sidan av monitorerna, med dina egna axeletiketter.

**Sätt upp axlarna innan du lägger till monitorer.** En rutnätsgrupp utan rader eller kolumner visar en gul notis om att det inte finns någonstans att lägga en monitor förrän axlarna finns, med en knapp **Set up the grid** — och knappen **Lägg till monitor** dras undan tills du gjort det.

## Ordna det besökarna ser

Ordningen är uttalad, inte alfabetisk, och den sätts på tre ställen:

- **Resurser inuti en grupp** — dra en rad. Rutan säger det själv: **Drag a row to change the order visitors see**.
- **Grupper i förhållande till varandra** — **Move up** / **Move down** i navigatorns radmeny, eller **Move group up** / **Move group down** i rutans meny.
- **Grupplösa resurser** — de bor i **Top of page** och renderas alltid ovanför varje grupp, så lägg det alla kollar först där.

**Två fall där dragning är avstängd.** Att filtrera rutan med rutan **Search in {group}...** stänger av omordning — rutan säger `N of M shown · drag to reorder is off while filtering`, så rensa sökningen först. Och rutnätsgrupper stöder aldrig dragordning, eftersom positionen kommer från rad- och kolumnaxlarna i stället.

Sätt den tjänst folk frågar mest om högst upp. Besökare som kom till sidan under ett avbrott slutar oftast läsa efter första skärmen.

## Importera grupper från CSV

Att bygga en djup hierarki för hand är tröttsamt. Trepunktsmenyn i kortrubriken har **Import groups from CSV**, som öppnar modalen **Import Groups from CSV**.

Flödet är: **Download CSV Template** för att hämta `status-page-groups-template.csv`, fyll i den, **Choose CSV File**, och sedan **Preview Import** för att se vad som kommer att skapas innan något skrivs. Därefter listar en **Import results**-tabell varje rad som **Created**, **Failed** eller **Skipped** tillsammans med orsaken, så att en trasig rad inte försvinner i tysthet.

Bara `name` är obligatoriskt. De godtagna kolumnerna är:

| Kolumn                   | Vad den sätter                                        |
| ------------------------ | ----------------------------------------------------- |
| `name`                   | Gruppens namn. Obligatoriskt.                         |
| `parentName`             | Namnet på gruppen som den här ligger i.               |
| `description`            | Gruppbeskrivningen.                                   |
| `isExpandedByDefault`    | Om sektionen börjar öppen för besökarna.              |
| `showCurrentStatus`      | Om en status visas bredvid gruppens rubrik.           |
| `showUptimePercent`      | Om en drifttidsprocent visas bredvid gruppen.         |
| `uptimePercentPrecision` | Hur många decimaler den procentsatsen använder.       |
| `viewMode`               | `List` eller `Grid`.                                  |
| `rowAxisLabel`           | Namn på raddimensionen för en rutnätsgrupp.           |
| `rowAxisValues`          | Radvärdena för en rutnätsgrupp.                       |
| `columnAxisLabel`        | Namn på kolumndimensionen för en rutnätsgrupp.        |
| `columnAxisValues`       | Kolumnvärdena för en rutnätsgrupp.                    |

Importen skapar grupper, inte resurser — lägg till monitorer efteråt med **Lägg till monitor** eller **Add Multiple**.

## Läs vidare

- [Statussidor – Översikt](/docs/status-pages/index) — vad en statussida är och hur delarna hänger ihop.
- [Statussidans varumärke och domäner](/docs/status-pages/branding-and-domains) — logotyp, favicon, diagramfärger och att lägga sidan på er egen domän.
- [Prenumeranter och meddelanden](/docs/status-pages/subscribers) — vilka som får veta när de här resurserna ändrar sig.
- [Offentligt API](/docs/status-pages/public-api) — att läsa statussidans data programmatiskt.
- [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities) — vad som får en incident att dyka upp på, och försvinna från, sidan.
