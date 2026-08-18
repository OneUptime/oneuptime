# Resurser och grupper

En resurs är en rad på din statussida — en monitor (eller en monitorgrupp) med ett namn besökarna förstår, en aktuell status och eventuellt ett drifttidstal och ett historikdiagram. En grupp är en sektion som rymmer resurser, så att en sida med fyrtio monitorer läses som "API", "Webbapp" och "Datapipeline" i stället för en enda oändlig lista.

Du bygger båda på en enda skärm. Öppna en statussida och välj **Resurser** i sidomenyn (posten heter **Monitorer** i projekt som inte har monitorgrupper aktiverade). Grupper brukade bo på en egen sida; det gör de inte längre, och den gamla URL:en `/groups` omdirigerar bara hit.

Får du den här delen rätt är resten av statussidan dekoration. Besökare bedömer "är det jag eller är det de?" utifrån de här raderna, så namnge dem som kunderna talar om din produkt — **Checkout API**, inte `prod-checkout-lb-healthcheck-us-east-1`.

## Skärmen Resurser

Skärmen är delad i två. Till vänster finns en navigator som listar varje grupp på sidan; till höger finns innehållet i den grupp du valt.

- **Gruppnavigatorn (vänster)** — ett träd av grupper, med en sökruta (**Search groups...**) ovanför och en löpande räkning under, i stil med `3 groups · 12 resources`. När en sida har fler grupper än vad som får plats visar en knapp **Show N more of M** resten.
- **Top of page** — den första raden i navigatorn. Den rymmer resurser som inte ligger i någon grupp, och dess verktygstips säger exakt vad det betyder: besökare ser dessa först, ovanför varje grupp. Om sidan inte har några grupper alls har den högra panelen rubriken **All resources** i stället.
- **Resurspanelen (höger)** — har rubriken efter den grupp du valt. Dess rubrikrad bär **Edit Group**, den primära knappen **Lägg till monitor** och en överflödsmeny **More actions**.

Två knappar bor i själva kortets rubrikrad: **New Group**, och ett tre-punktsöverflöd som rymmer **Import groups from CSV** och **Uppdatera**.

Kortets beskrivning ändras med formen på din sida. Med grupper står det att detta är allt besökarna ser och att du ska välja en grupp till vänster för att redigera vad som finns i den. Utan grupper ännu puffar den för att du ska skapa en och dela upp en längre sida i sektioner.

**Tomtillstånd talar om vad du ska göra.** En tom grupp visar **No monitors here yet** med **Lägg till monitor**, **Add Multiple** och — bara när statussidan inte har några grupper alls — **Create a Group**. En sökning som inte matchar något visar **No resources match your search**. En tom navigator säger att grupper delar upp en längre statussida i sektioner och att de kan nästlas.

## Lägga till en monitor

Välj gruppen du vill att resursen ska hamna i (eller **Top of page** för en ogrupperad rad) och klicka sedan på **Lägg till monitor**. Modalen har rubriken **Add a monitor to {group}** och har två steg: **Monitordetaljer** och **Avancerad**.

På **Monitordetaljer**:

- **Övervakning** — rullgardinsmenyn över monitorer i ditt projekt, platshållare **Välj övervakning**. Obligatorisk.
- **Visningsnamn** — obligatoriskt. Det här är texten besökarna läser, och den lagras separat från monitorns eget namn, så du kan byta namn här utan att röra övervakningen.
- **Beskrivning** — valfri markdown som visas under raden. Bra för en mening som förklarar vad tjänsten faktiskt gör.

Om ditt projekt har monitorgrupper aktiverade står det i en länk under rullgardinsmenyn **Add a Monitor Group instead.** — klicka på den så byts rullgardinsmenyn **Övervakning** mot en rullgardinsmeny **Monitor Grupp** (**Välj övervakningsgrupp**). Länken vänder då till **Add a Monitor instead.** så att du kan gå tillbaka. Använd en monitorgrupp när du vill att en rad på sidan ska representera flera kontroller ihopslagna.

### Lägga till flera på en gång

**Add Multiple** (även **Add multiple monitors** i menyn **More actions**) öppnar **Add Multiple Monitors**. Den har samma två steg, men det första är en flervalslista **Monitorer** i stället för en enkel rullgardinsmeny, och visningsalternativen du väljer på **Avancerad** gäller varje monitor du valt. Det här är snabbaste sättet att så en ny sida.

## Visningsalternativ på en resurs

Steget **Avancerad** är detsamma i formuläret för enkel tilläggning och i massmodalen. Allt här gäller per resurs — två rader i samma grupp kan konfigureras olika.

| Fält                                                       | Syfte                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Verktygstips** (`displayTooltip`)                        | Extra text som visas bredvid resursen på din statussida. Använd den för omfattning: "Kunder i US och EU". |
| **Visa aktuell resursstatus** (`showCurrentStatus`)        | På som standard. Visar livestatusen — i drift, försämrad, nere — bredvid raden.                       |
| **Visa upptid %** (`showUptimePercent`)                    | Av som standard. Visar en drifttidsprocent bredvid resursen.                                           |
| **Välj precision för drifttid** (`uptimePercentPrecision`) | Dyker upp först när **Visa upptid %** är på. Obligatorisk, standard är en decimal.                     |
| **Visa statushistorikdiagram** (`showStatusHistoryChart`)  | På som standard. Visar stapeldiagrammet över drifttidshistorik dag för dag för resursen.               |

**Visningsnamn** (`displayName`) och **Beskrivning** (`displayDescription`) från det första steget är också enbart visning — de ändrar aldrig själva monitorn.

## Drifttidsprocent och historikdiagram

Både **Visa upptid %** och **Visa statushistorikdiagram** beror på en inställning som bor någon annanstans. Fönstret de täcker är **Visa upptidshistorik (i dagar)** under **Statussidor → din sida → Avancerad → Avancerade inställningar**, i kortet **Inställningar för drifttidshistorik**. Det tar emot 1 till 90 dagar och är 90 som standard.

Så ordningsföljden är: slå på växlarna per resurs, sätt sedan fönstret en gång för hela sidan.

**Precision är en bedömningsfråga.** Rullgardinsmenyn **Välj precision för drifttid** erbjuder `99% (No Decimal)`, `99.9% (One Decimal)`, `99.99% (Two Decimal)` och `99.999% (Three Decimal)`. Fler decimaler ser precisa ut och bjuder in till diskussion om den tredje; om du publicerar ett SLA på tre nior, matcha det och inte mer.

Grupper har sina egna kopior av dessa växlar — se nedan — så en grupp kan visa en upprullad procent medan de enskilda monitorerna inuti den håller tyst, eller tvärtom.

Färgerna på historikdiagrammets staplar, och vilka monitorstatusar som räknas som "nere", sätts på varumärkesskärmen **Översiktssida**, som täcks i [Statussidans varumärke och domäner](/docs/status-pages/branding-and-domains).

## Grupper

Klicka på **New Group** för att öppna **Create New Status Page Group**. Formuläret har tre steg: **Gruppdetaljer**, **Layout** och **Avancerad**.

**Gruppdetaljer**:

- **Gruppnamn** (`name`) — obligatoriskt. Det här är sektionsrubriken besökarna ser.
- **Gruppbeskrivning** (`description`) — valfri markdown, visas under rubriken.
- **Parent Group** (`parentStatusPageGroupId`) — valfri. Låt den stå på **No parent group (top level)** för att hålla gruppen på toppnivån.
- **Expandera på statussidan som standard** (`isExpandedByDefault`) — om sektionen börjar öppen eller ihopfälld för besökare.

**Avancerad** speglar resursväxlarna på gruppnivå:

- **Visa aktuell gruppstatus** (`showCurrentStatus`) — på som standard. Visar en status bredvid gruppens rubrik.
- **Visa upptid %** (`showUptimePercent`) — av som standard, med **Välj precision för drifttid** som dyker upp när den är på.

Redigering fungerar på samma sätt: **Edit Group** i panelens rubrikrad, eller **Edit group** i navigatorns radmeny, öppnar **Edit Status Page Group** med en knapp **Spara ändringar**.

Panelens rubrikrad visar chips för de inställningar som är på just nu — **Grid**, **Collapsed by default**, **Uptime %** — så att du kan se hur en grupp är konfigurerad utan att öppna formuläret.

### Hantera en grupp

Navigatorns meny per rad rymmer **Edit group**, **Move up**, **Move down**, **Visa ID** och **Delete group**. Panelens överflöd **More actions** har motsvarigheterna i längre form — **Edit this group**, **Add a sub group**, **Move group up**, **Move group down**, **Show group ID**, **Uppdatera** och **Delete this group**. En grupp som sparas utan namn renderas som **Untitled group**, vilket är ett bra tecken på att du menade att skriva något.

## Nästla grupper

Grupper går att nästla: sätt **Parent Group** på barnet, eller använd navigatorns åtgärd **Add a sub group inside this group**. Formulärets egen hjälptext beskriver formen den är byggd för — något i stil med Corporate Units › Region › Market — och noterar att varje nivå visar den upprullade statusen och drifttiden för allt under den.

När en grupp har barn visar resurspanelen en chip-rad **Sub groups** som länkar rakt in i varje barn, så att du kan vandra hierarkin utan att gå tillbaka till navigatorn.

Nästling gör nytta på stora sidor: en hostingleverantör med regioner inuti produkter, eller en detaljhandlare med marknader inuti affärsområden. På en sida med tolv monitorer är en platt nivå vänligare.

## Listlayout kontra rutnätslayout

Steget **Layout** sätter **Visningsläge** (`viewMode`) för gruppen, och det ändrar hur gruppen renderas publikt.

| Om du vill…                                                              | Välj                       |
| ------------------------------------------------------------------------ | -------------------------- |
| Visa en enkel vertikal lista över tjänster, en per rad                   | **List** (standard)        |
| Visa samma tjänst över flera regioner eller tenants som en matris        | **Grid**                   |

Välj **Grid** så dyker fyra fält till upp:

- **Etikett för radaxel** — namnet på raddimensionen, platshållare `Service`.
- **Värden för radaxel** — själva raderna, tillagda en i taget med **Add Row** (platshållare `e.g. Auth`).
- **Etikett för kolumnaxel** — kolumndimensionen, platshållare `Region`.
- **Värden för kolumnaxel** — tillagda med **Add Column** (platshållare `e.g. US-East`).

Varje monitor i en rutnätsgrupp placeras sedan i en cell, så massmodalen frågar efter raden och kolumnen tillsammans med monitorerna, med dina egna axeletiketter.

**Sätt upp axlarna innan du lägger till monitorer.** En rutnätsgrupp utan rader eller kolumner visar en gulbrun notis som säger att det inte finns någonstans att placera en monitor förrän axlarna finns, med en knapp **Set up the grid** — och knappen **Lägg till monitor** dras tillbaka tills du gjort det.

## Ordna det besökarna ser

Ordningen är uttrycklig, inte alfabetisk, och den sätts på tre ställen:

- **Resurser inuti en grupp** — dra en rad. Panelen säger det: **Drag a row to change the order visitors see**.
- **Grupper i förhållande till varandra** — **Move up** / **Move down** i navigatorns radmeny, eller **Move group up** / **Move group down** i panelens överflöd.
- **Ogrupperade resurser** — de bor i **Top of page** och renderas alltid ovanför varje grupp, så lägg det alla kollar först där.

**Två fall där dragning är avstängd.** Att filtrera panelen med rutan **Search in {group}...** stänger av omordning — panelen säger `N of M shown · drag to reorder is off while filtering`, så rensa sökningen först. Och rutnätsgrupper stöder aldrig dragordning, eftersom positionen kommer från rad- och kolumnaxlarna i stället.

Lägg tjänsten som folk frågar mest om högst upp. Besökare som kommit till sidan under ett avbrott slutar oftast läsa efter första skärmen.

## Importera grupper från CSV

Att bygga en djup hierarki för hand är tröttsamt. Tre-punktsöverflödet i kortets rubrikrad har **Import groups from CSV**, som öppnar modalen **Import Groups from CSV**.

Flödet är: **Download CSV Template** för att få `status-page-groups-template.csv`, fyll i den, **Choose CSV File**, sedan **Preview Import** för att kontrollera vad som kommer att skapas innan något skrivs. Resultatet delas upp i **Groups Imported** och **Some Groups Could Not Be Imported**, så att en dålig rad inte tyst försvinner.

Bara `name` är obligatoriskt. De accepterade kolumnerna är:

| Kolumn                   | Vad den sätter                                        |
| ------------------------ | ----------------------------------------------------- |
| `name`                   | Gruppnamnet. Obligatoriskt.                           |
| `parentName`             | Namnet på gruppen den här nästlas inuti.              |
| `description`            | Gruppbeskrivningen.                                   |
| `isExpandedByDefault`    | Om sektionen börjar öppen för besökare.               |
| `showCurrentStatus`      | Om en status visas bredvid gruppens rubrik.           |
| `showUptimePercent`      | Om en drifttidsprocent visas bredvid gruppen.         |
| `uptimePercentPrecision` | Hur många decimaler den procenten använder.           |
| `viewMode`               | `List` eller `Grid`.                                  |
| `rowAxisLabel`           | Namn på raddimensionen för en rutnätsgrupp.           |
| `rowAxisValues`          | Radvärdena för en rutnätsgrupp.                       |
| `columnAxisLabel`        | Namn på kolumndimensionen för en rutnätsgrupp.        |
| `columnAxisValues`       | Kolumnvärdena för en rutnätsgrupp.                    |

Importen skapar grupper, inte resurser — lägg till monitorer efteråt med **Lägg till monitor** eller **Add Multiple**.

## Läs vidare

- [Statussidor – Översikt](/docs/status-pages/index) — vad en statussida är och hur delarna hänger ihop.
- [Statussidans varumärke och domäner](/docs/status-pages/branding-and-domains) — logotyp, favicon, diagramfärger och att lägga sidan på din egen domän.
- [Prenumeranter och meddelanden](/docs/status-pages/subscribers) — vem som får veta när de här resurserna ändras.
- [Offentligt API](/docs/status-pages/public-api) — läsa statussidedata programmatiskt.
- [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities) — vad som får en incident att visas på, och försvinna från, sidan.
