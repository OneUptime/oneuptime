# Larmstatusar och allvarlighetsgrader

Varje larm har ett **tillstånd**, hur långt ditt team har kommit med det, och en **allvarlighetsgrad**, hur mycket det betyder. Tillstånd styr vad OneUptime gör: vem som fortfarande larmas, vad som räknas som aktivt, när en episod löses. Allvarlighetsgrader rangordnar larm, och regler kan matcha på dem. Den här sidan är för alla som ställer in dem, eller som undrar varför ett larm larmade någon eller inte.

:::cards
- [Standardtillstånden](#standardtillstånden): Identified, Bekräftad och Löst, och vad vart och ett av dem gör.
- [Lägga till egna tillstånd](#lägga-till-egna-tillstånd): Ett eget steg, till exempel "Under utredning".
- [Flytta ett larm genom dess tillstånd](#flytta-ett-larm-genom-dess-tillstånd): Alla sätt som ett tillstånd ändras på.
- [Allvarlighetsgrader](#standardallvarlighetsgraderna): High och Low, och hur du lägger till egna.
:::

## Så fungerar det

Ett projekts larmtillstånd är en enda ordnad lista, och larm rör sig bara nedåt i den. Var ett tillstånd står avgör vad ett larm i det räknas som: inte bekräftat ännu, bekräftat eller löst. Larmepisoder går igenom samma lista.

```mermaid title="Larm rör sig bara nedåt i listan; var ett tillstånd står avgör vad det räknas som"
flowchart TB
    subgraph open["Räknas som<br/>inte bekräftad"]
        identified["Identified"]
    end
    subgraph working["Räknas som<br/>bekräftad"]
        acknowledged["Bekräftad"]
        investigating["Under utredning<br/>(eget)"]
    end
    subgraph done["Räknas som<br/>löst"]
        resolved["Löst"]
        closed["Stängd<br/>(eget)"]
    end
    identified --> acknowledged
    acknowledged --> investigating
    investigating --> resolved
    resolved --> closed
    identified -. "hoppa över" .-> resolved
```

Modellen `AlertState` har `name`, `description`, `color` och `order`, plus tre flaggor: `isCreatedState`, `isAcknowledgedState` och `isResolvedState`. OneUptime läser flaggorna och ordningen, aldrig namnet, så du kan byta namn på **Löst** till "Stängd" utan att något går sönder. Modellen `AlertSeverity` har `name`, `description`, `color` och `order`, och inga flaggor.

> [!TIP]
> Båda listorna finns under **Larm → Inställningar**, som börjar hopfällt i sidomenyn: Fäll ut **Inställningar** för att hitta **Larmstatus** och **Larmallvar**.

## Standardtillstånden

Varje nytt projekt börjar med tre larmtillstånd, i den här ordningen:

| Tillstånd        | `order` | Flagga                | Färg      | Vad det betyder                                 |
| ---------------- | ------- | --------------------- | --------- | ----------------------------------------------- |
| **Identifierade**   | `1`     | `isCreatedState`      | `#fd625e` | Tillståndet som nya larm börjar i.              |
| **Bekräftad**    | `2`     | `isAcknowledgedState` | `#ffbf53` | Någon tar hand om det, och larmningen upphör.   |
| **Löst**         | `3`     | `isResolvedState`     | `#2ab57d` | Larmet är över och räknas inte längre som aktivt. |

De tre flaggade tillstånden har taggen **Inbyggd** på inställningssidan. Du kan byta namn på dem, ge dem en annan färg och dra dem, men de behåller sin ordning, skapat före bekräftat före löst, och de kan inte tas bort: Deras **Ta bort** förblir låst och säger varför.

## Vad varje flagga gör

| Flagga                | Vad OneUptime gör med den                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isCreatedState`      | Nya larm börjar här när ingen väljer ett annat tillstånd: varje larm som en monitor utlöser, och varje larm som skapas med **Inledande tillstånd** tomt.                           |
| `isAcknowledgedState` | **Bekräfta** flyttar ett larm hit. I det här tillståndet eller ett tillstånd efter det räknas larmet som bekräftat: Dess jourpolicyer slutar larma, och **Bekräfta** erbjuds inte längre. |
| `isResolvedState`     | **Lös** flyttar ett larm hit. I det här tillståndet eller ett tillstånd efter det räknas larmet som löst: Det lämnar **Aktiva larm**, dess påminnelser upphör, och dess episod kan lösas. |

## Lägga till egna tillstånd

Ett tillstånd som du lägger till är ett steg som ditt team går igenom och som de tre standardtillstånden inte namnger: "Under utredning", "Begränsad", "Stängd".

:::steps
### Öppna listan över tillstånd

Gå till **Larm → Inställningar → Larmstatus**. Kortet **Larm Tillstånd** listar dina tillstånd i deras ordning. Varje rad visar färg och namn, vad ett larm i det **Räknas som**, och beskrivningen.

### Skapa tillståndet

Klicka på **Skapa Larmstatus** och fyll i **Namn**, **Beskrivning** och **Färg**. Färgen är redan vald: en som inget annat tillstånd använder ännu. Det nya tillståndet läggs till precis ovanför det lösta tillståndet, så det håller larm aktiva.

### Dra det på plats

Dra en rad i dess handtag för att flytta den; den nya ordningen sparas när du släpper den. Kolumnen **Räknas som** följer med: Ovanför det bekräftade tillståndet är ett larm **Inte bekräftad**, från det och nedåt **Bekräftad**, och från det lösta tillståndet och nedåt **Löst**.
:::

Ett tillstånd som du lägger till har ingen flagga, så var det står är vad det betyder. Placera ett begränsningssteg mellan **Bekräftad** och **Löst**, och ett triagesteg ovanför **Bekräftad**. Ett tillstånd som placeras under **Löst** räknas som löst överallt.

Du flyttar ett larm till ett eget tillstånd från menyn **⋯** i larmets sidhuvud, under **Ändra tillstånd till**, som listar varje tillstånd efter det nuvarande. Dess bekräftelse har rubriken **Markera larm som {{state}}**, med tillståndets namn i.

> [!NOTE]
> På OneUptime Cloud krävs planen **Growth** eller högre för att lägga till eller ändra larmtillstånd och allvarlighetsgrader. Alla planer kan läsa dem, använda dem och ta bort ett tillstånd som du har lagt till.

## Ordningen upprätthålls

Varje tillståndsändring för ett larm kontrolleras mot listan, vem som än gör den: instrumentpanelen, Slack, Microsoft Teams, API:et, Terraform, ett arbetsflöde eller OneUptime självt.

- **Steg bakåt nekas**, med ett meddelande som nämner båda tillstånden: "Alert cannot transition to Acknowledged state from Resolved state because Acknowledged is before Resolved in the order of alert states."
- **Ett byte till tillståndet som det redan är i nekas**: "Alert state cannot be same as previous state."
- **Väljare erbjuder bara tillstånden efter det nuvarande**, så ingen erbjuds ett byte som skulle nekas.

Larmepisoder hålls till samma lista, med egna meddelanden ("Episode cannot transition to …"). Det enda steget tillbaka uppåt i listan är OneUptimes eget: en grupperingsregel som öppnar en nyligen löst episod igen. För att rätta till ett tillstånd som satts av misstag tar du bort dess rad på larmets sida **Tillståndstidslinje**; larmet går tillbaka till tillståndet i dess senaste återstående rad.

## Standardallvarlighetsgraderna

Varje nytt projekt börjar med två allvarlighetsgrader för larm, den allvarligaste först:

| Allvarlighetsgrad | `order` | Färg      | Förifylld beskrivning                                                             |
| ----------------- | ------- | --------- | --------------------------------------------------------------------------------- |
| **Hög**          | `1`     | `#b70400` | Issues causing very high impact to customers. Immediate attention is required.    |
| **Låg**           | `2`     | `#ffbf53` | Issues causing low impact to customers.                                           |

Incidenter börjar med tre allvarlighetsgrader och larm med två. När mallen i en monitorrekommendation säger **Kritisk** eller **Warning** mappar OneUptime den till din första och andra allvarlighetsgrad för larm, som i ett nytt projekt är **Hög** och **Låg**.

## Redigera allvarlighetsgrader

Gå till **Larm → Inställningar → Larmallvar**. Kortet **Larm Allvarligheter** listar dem med den allvarligaste först; dra en rad för att ändra dess rang. **Skapa Larmallvar** lägger till en sist i listan, som den minst allvarliga, med samma **Namn**, **Beskrivning** och **Färg** som ett tillstånd.

Rangen avgör vilken allvarlighetsgrad som vinner där OneUptime jämför dem: En episods allvarlighetsgrad stiger till den hos det allvarligaste larmet som ansluter till den. Allvarlighetsgrader har inga flaggor och inget borttagningslås: Vilken allvarlighetsgrad som helst kan tas bort, även de två förifyllda.

En allvarlighetsgrad larmar ingen på egen hand. För att larma efter allvarlighetsgrad lägger du till en jourregel vars **Larm Allvarligheter** matchar den: se [Larmregler och inställningar](/docs/alerts/settings). Att ändra ett larms allvarlighetsgrad skriver en post i dess flöde och matchar dess påminnelseregel på nytt.

## Arkivera en status eller allvarlighetsgrad

Arkivera en status eller allvarlighetsgrad som ditt team inte längre ska använda, i stället för att ta bort den. Arkivering ändrar inget larm. Att ta bort en status tar bort dess rader ur varje larms historik, och en allvarlighetsgrad kan inte tas bort så länge larm har den.

- **Arkivera** finns i radens meny **⋯**. Den frågar först och listar de regler, mätningar, monitorkriterier och arbetsflöden som är inställda på att använda värdet: De fortsätter att använda det tills du ändrar dem.
- **Ingen kan välja den igen.** **Ändra tillstånd**, larmets sidhuvud, Slack, Microsoft Teams, regler och monitorkriterier utelämnar den. API:et, Terraform och MCP avvisar den och anger värdet och var den kan avarkiveras.
- **Larm behåller den.** Ett larm som har den behåller den vid varje senare redigering, dess statustidslinje visar den fortfarande, och du kan fortfarande filtrera på den.
- **Arkiverade värden listas för sig**, i det hopfällda avsnittet **Arkiverade larmstatusar** eller **Arkiverade allvarlighetsgrader för larm** under tabellen, med vem som arkiverade varje värde och när. **Avarkivera** återställer ett som det var.
- **Vissa kan inte arkiveras.** Den skapade, den kvitterade och den lösta statusen, och projektets sista allvarlighetsgrad som inte är arkiverad. Deras **Arkivera** är låst, med skälet.

**Ta bort** talar först om vad den skulle göra. Så länge larm eller episoder har värdet nekas borttagningen, och dialogen listar dem. Annars listar den vad borttagningen skulle ändra och erbjuder **Arkivera i stället**.

## Flytta ett larm genom dess tillstånd

| Sätt                 | Var                                                                                       | Vad det frågar efter                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Knappar i sidhuvudet** | Larmets sidhuvud: **Bekräfta**, **Lös** och **Ändra tillstånd till** i dess meny **⋯**     | En kort bekräftelse, **Bekräfta larm**, **Lös larm** eller **Markera larm som {{state}}**, med en valfri anteckning under **Lägg till en privat anteckning**. |
| **State timeline**   | **Tillståndstidslinje** i larmets sidomeny                                                | En rad som du lägger till manuellt, med **Larmstatus** och **Börjar den**.                                                            |
| **Rad i listan** | Menyn **⋯** på ett larms rad i larmlistan: **Bekräfta**, **Lös** och **Ändra tillstånd** | Bekräftelsen från sidhuvudet, med larmets namn. Ett larm som en annan ändring har flyttat under tiden lämnas som det är, och dialogen säger varför. |
| **Massändring**      | **Bekräfta**, **Lös** eller **Ändra tillstånd** på ett urval i larmlistan                                             | Tillståndet, och en privat anteckning som läggs till på varje larm. Larm som redan är i eller efter tillståndet hoppas över.           |
| **Automatiskt**      | En monitor, en episod, en länkad incident eller din egen kod                              | **Lös larm automatiskt** i en monitors kriterier, en episods tillståndsändring, incidentreglagen på [Länkade larm](/docs/incidents/linked-alerts) eller en rad som skapas på `/api/alert-state-timeline`. |

Sidhuvudet erbjuder **Bekräfta** och **Lös** medan larmet inte är bekräftat ännu, och bara **Lös** när det är det. Ett löst larm visar ingen av dem. Den som med sin roll inte får ändra larmets tillstånd ser knapparna låsta och ingen meny med andra tillstånd: pekar du på en nämner den behörigheterna som skulle tillåta det.

## Vad bekräftelse gör

Ett larm är bekräftat från det ögonblick det flyttas till ditt bekräftade tillstånd, eller till ett tillstånd efter det, ett löst inräknat. Därefter:

- **Jouren slutar larma för det.** Dess jourpolicyer larmar inte nästa nivå.
- **Bekräfta erbjuds inte längre**, varken i sidhuvudet eller i Slack och Microsoft Teams, där en ny bekräftelse nekas med "Alert is already acknowledged." eller "Alert is already resolved." Den som svarar på sitt larmanrop efter det får larmanropet bekräftat, och larmet stannar där det är.
- **Tiden till bekräftelse sätts**, från det första sådana bytet: den första rutan i **Översikt**, och en mätning som slutar när **Larmet bekräftas**.

## Vad lösning gör

Ett larm är löst när det flyttas till ditt lösta tillstånd, eller till ett tillstånd efter det. Därefter:

- **Det lämnar Aktiva larm**, och antalet i sidomenyn.
- **Dess påminnelser upphör**, vad dess påminnelseregel än säger.
- **Dess episod kan lösas.** En episod löses av sig själv när varje larm i den är löst. Se [Larmepisoder och grupperingsregler](/docs/alerts/episodes).
- **Dess monitor kan utlösa ett nytt larm.** Ett kriterium håller ett öppet larm åt gången; när det är löst öppnar nästa matchning ett nytt.

Att gå vidare från **Löst** till ett tillstånd efter det, till exempel "Stängd", ändrar inget av detta: Larmet var redan löst.

## Tillståndstidslinjen

Larmets sida **Tillståndstidslinje** är en förteckning över varje tillstånd det har varit i. Dess kort, **Statustidslinje**, ritar dem som en tidslinje: ett band med varje tillstånd så långt som det varade, och under det varje ändring med den senaste först. **Tabell** i kortets rubrik listar dem i stället som rader, med **Larmstatus**, **Börjar den**, **Slutar den** och **Varaktighet**.

- **Visa orsak** visar rotorsaken som registrerades med den ändringen.
- **Visa loggar** visar vad OneUptime registrerade när larmet ändrades, till exempel monitorkontrollen som orsakade det.

Rader kan läggas till och tas bort, men inte redigeras, och ett larm behåller alltid minst en. Tar du bort den senaste raden sätts larmet tillbaka i tillståndet från raden före den.

> [!WARNING]
> Att ta bort en rad skriver om larmets historik och varje mätning som beräknats från den. Använd det för att rätta ett misstag, inte för att städa.

## Listan Aktiva larm

**Larm → Aktiva larm** innehåller varje larm vars tillstånd står ovanför ditt lösta tillstånd, och inget annat avgör det: inte allvarlighetsgrad, inte ålder, inte om någon har bekräftat det. Det röda märket bredvid i sidomenyn räknar samma larm.

Ett eget tillstånd ovanför **Löst** håller alltså larm kvar i listan, och ett under det tar bort dem, som lösning gör. **Aktiva episoder** fungerar på samma sätt för episoder.

## Nästa steg

:::cards
- [Larm – Översikt](/docs/alerts/index): Var larm kommer ifrån och hur ditt team arbetar med dem.
- [Larmepisoder och grupperingsregler](/docs/alerts/episodes): Hur en episods tillstånd flyttar dess larm.
- [Larmregler och inställningar](/docs/alerts/settings): Larma och påminn efter allvarlighetsgrad.
- [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities): Samma livscykel, för incidenter.
:::
