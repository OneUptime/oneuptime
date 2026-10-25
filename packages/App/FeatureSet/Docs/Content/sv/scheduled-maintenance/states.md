# Underhållsstatusar

Varje schemalagd underhållshändelse är i ett **tillstånd**: hur långt arbetet har kommit, från planerat till godkänt. Tillstånd avgör vad OneUptime gör med händelsen: när dess monitorer slutar kontrolleras, vad dina statussidor visar, när dess påminnelser upphör. Den här sidan går igenom de fyra tillstånd som varje projekt börjar med, vad som flyttar en händelse mellan dem och hur du lägger till egna steg.

:::cards
- [Standardtillstånden](#standardtillstånden): Schemalagd, Pågående, Avslutad och Slutförd.
- [Vad som flyttar en händelse](#vad-som-flyttar-en-händelse): Klockan, sidhuvudet, tidslinjen, chatt och API:et.
- [Egna tillstånd](#egna-tillstånd): Ett steg innan arbetet börjar, eller en kontroll efteråt.
- [Tillståndstidslinjen](#tillståndstidslinjen): Varje tillstånd en händelse har varit i, och hur du rättar det.
:::

## Så fungerar det

Ett projekts underhållstillstånd är en ordnad lista, och händelser rör sig bara nedåt i den. Var ett tillstånd står avgör vad en händelse i det räknas som: väntar på att börja, pågår eller är över.

```mermaid title="Händelser rör sig bara nedåt i listan; platsen avgör vad ett tillstånd räknas som"
flowchart TB
    subgraph waiting["Väntar på att börja"]
        scheduled["Schemalagd"]
        confirmed["Bekräftad<br/>(ditt eget)"]
    end
    subgraph progress["Pågår"]
        ongoing["Pågående"]
        verifying["Kontrolleras<br/>(ditt eget)"]
    end
    subgraph over["Över"]
        ended["Avslutad"]
        completed["Slutförd"]
    end
    scheduled --> confirmed
    confirmed -->|"vid Börjar den"| ongoing
    ongoing --> verifying
    verifying -->|"vid Slutar den"| ended
    ended --> completed
```

Modellen `ScheduledMaintenanceState` har `name`, `description`, `color` och `order`, plus fyra flaggor: `isScheduledState`, `isOngoingState`, `isEndedState` och `isResolvedState`. OneUptime läser flaggorna och ordningen, aldrig namnet, så du kan byta namn på **Slutförd** till "Godkänd" utan att något går sönder.

> [!TIP]
> Listan finns under **Schemalagt underhåll → Inställningar → Händelsestatus**. **Inställningar** börjar hopfällt i sidomenyn: fäll ut det först.

## Standardtillstånden

Varje nytt projekt börjar med fyra underhållstillstånd, i den här ordningen:

| Tillstånd      | `order` | Flagga             | Färg      | Vad det betyder                                                |
| -------------- | ------- | ------------------ | --------- | -------------------------------------------------------------- |
| **Schemalagd** | `1`     | `isScheduledState` | `#000000` | Varje ny händelse börjar här och väntar på sin starttid.       |
| **Pågående**   | `2`     | `isOngoingState`   | `#ffbf53` | Arbetet pågår, och händelsens monitorer kontrolleras inte.     |
| **Avslutad**   | `3`     | `isEndedState`     | `#4a4a4a` | Fönstret är över, och kontrollerna återupptas.                 |
| **Slutförd**   | `4`     | `isResolvedState`  | `#2ab57d` | Någon har godkänt arbetet, och påminnelserna till ägarna upphör. |

De fyra flaggade tillstånden har märket **Inbyggd** på inställningssidan. Du kan byta namn på dem, ge dem en ny färg och dra dem, men de behåller sin ordning och kan inte tas bort: deras **Ta bort** förblir låst och säger varför.

**Avslutad** och **Slutförd** är båda över. Skillnaden är vem som flyttar händelsen: OneUptime flyttar den till **Avslutad** vid dess **Slutar den**, och en person, en chattknapp eller API:et flyttar den till **Slutförd** när arbetet är kontrollerat.

## Vad som flyttar en händelse

| Sätt             | Var                                                                                         | Vad det frågar efter                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Klockan**      | Ett jobb som körs varje minut                                                               | Ingenting: vid **Börjar den** flyttar det en väntande händelse till **Pågående**, och vid **Slutar den** en pågående till **Avslutad**. |
| **Sidhuvudet**   | Händelsens **Översikt**: knapparna **Markera som {{state}}**, och **Ändra tillstånd till** i dess meny **⋯** | En kort dialog, **Markera schemalagt underhåll som {{state}}**, med **Meddela statussideprenumeranter** och en valfri anteckning under **Lägg till en offentlig anteckning**. |
| **Tidslinjen**   | **Tillståndstidslinje** i händelsens sidomeny                                               | En rad som du lägger till manuellt, med **Status för schemalagt underhåll** och **Börjar den**.                 |
| **Massändring**  | **Ändra tillstånd** på ett urval i listan över händelser                                    | Tillståndet, och en offentlig anteckning som läggs till varje händelse. Händelser som redan är i tillståndet eller förbi det hoppas över. |
| **Chatt**        | Knapparna på händelsens meddelanden i Slack och Microsoft Teams                             | Samma ändring, gjord som du. Se [Slack](/docs/workspace-connections/slack#agera-på-incidenter-larm-och-händelser-från-slack). |
| **API:et**       | En rad skapad på `/api/scheduled-maintenance-state-timeline`                                | Tillståndet, och om prenumeranterna får veta.                                                                   |

Sidhuvudets knappar är namngivna efter dina tillstånd. Medan händelsen väntar erbjuder det två: en som startar den, namngiven efter ditt pågående tillstånd, och en som avslutar den, namngiven efter ditt avslutade tillstånd. Medan händelsen pågår, bara den andra. Menyn **⋯** listar varje annat tillstånd efter det nuvarande. Den som med sin roll inte får ändra händelsens tillstånd ser knapparna låsta och ingen meny med andra tillstånd: pekar du på en nämner den behörigheterna som skulle tillåta det.

## Vad start och avslut gör

En händelse börjar när den går från ett tillstånd där den väntar till **Pågående**, eller direkt till ett eget tillstånd placerat mellan **Pågående** och **Avslutad**. Då:

- **Dess monitorer slutar kontrolleras**, och går över till dess **Ändra övervakningsstatus till**, om den har en. En monitor som du lägger till händelsen medan den pågår går också över.
- **Dess statussidor visar den som pågående**, och dess prenumeranter får veta: i tid om **När händelsen börjar** är på, och manuellt som dialogens **Meddela statussideprenumeranter** säger.
- **Dess ägare får veta**, om de har slagit på aviseringen om tillståndsändringar, och händelsen visas under **Pågående händelser**.

En händelse avslutas när den går från ett tillstånd där den pågår till **Avslutad**, **Slutförd** eller ett eget tillstånd placerat efter **Avslutad**. Då kontrolleras dess monitorer igen och går tillbaka till "i drift", om inte en annan pågående händelse fortfarande håller dem, och dess prenumeranter får veta på samma sätt: i tid om **När händelsen slutar** är på, och manuellt som dialogen säger.

Att gå vidare från **Pågående** till "Kontrolleras", eller från **Avslutad** till **Slutförd**, startar eller avslutar ingenting igen: händelsen hade redan börjat, eller avslutats.

## Sidhuvudets klocka

Före starten räknar sidhuvudet ned till den; medan händelsen pågår räknar det hur länge den har pågått; när den är över säger det hur lång tid den tog. När händelsen missar en gräns med mer än två minuter säger ett gult meddelande det:

- **Start försenad**: händelsen väntar fortfarande efter sitt **Börjar den**.
- **Drar över tiden**: händelsen pågår fortfarande efter sitt **Slutar den**.

Meddelandet nämner den planerade tiden och det tillstånd händelsen ännu inte har nått. Direkt efter en gräns har jobbet som flyttar händelser kanske inte körts ännu, så de närmaste minuterna kontrollerar sidhuvudet igen av sig självt och visar det nya tillståndet utan att sidan laddas om.

## Ordningen upprätthålls

Varje tillståndsändring kontrolleras mot listan, vem som än gör den: instrumentpanelen, Slack, Microsoft Teams, API:et, Terraform, ett arbetsflöde eller OneUptime självt.

- **Steg bakåt nekas**, med ett meddelande som nämner båda tillstånden: "Scheduled Maintenance cannot transition to Scheduled state from Ongoing state because Scheduled is before Ongoing in the order of scheduled maintenance states."
- **Att gå till det tillstånd den redan är i nekas**: "Scheduled Maintenance state cannot be same as previous state."
- **Väljare erbjuder bara tillstånden efter det nuvarande**, så ingen erbjuds en ändring som skulle nekas.

För att rätta ett tillstånd som sattes av misstag tar du bort dess rad på händelsens sida **Tillståndstidslinje**; händelsen går tillbaka till tillståndet i raden före.

## Egna tillstånd

Ett tillstånd som du lägger till är ett steg som ditt team går igenom och som de fyra standardtillstånden inte nämner: "Bekräftad" innan arbetet börjar, "Kontrolleras" efteråt.

:::steps
### Öppna tillståndslistan

Gå till **Schemalagt underhåll → Inställningar → Händelsestatus**. Kortet **Schemalagd Underhåll Tillstånd** listar dina tillstånd i ordning. Varje rad visar sin färg och sitt namn, vad en händelse i det räknas som (kolumnen **Räknas som**) och sin beskrivning.

### Skapa tillståndet

Klicka på **Skapa Schemalagd Underhåll Tillstånd** och fyll i dess **Namn**, **Beskrivning** och **Färg**. Det nya tillståndet läggs till precis ovanför det slutförda tillståndet.

### Dra det på plats

Dra en rad i dess handtag för att flytta den; den nya ordningen sparas när du släpper den. Kolumnen **Räknas som** följer platsen där du släpper den.
:::

Ett tillstånd som du lägger till har ingen flagga, så dess plats är det som det betyder:

| Var du placerar det                     | En händelse i det                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Mellan **Schemalagd** och **Pågående**  | Väntar på sitt **Börjar den**, som i **Schemalagd**, och börjar därifrån i tid.                                  |
| Mellan **Pågående** och **Avslutad**    | Pågår, som i **Pågående**: dess monitorer förblir okontrollerade, och den avslutas vid sitt **Slutar den**.       |
| Mellan **Avslutad** och **Slutförd**    | Är över, men inte slutförd ännu: påminnelser som löper till slutförande fortsätter.                              |
| Under **Slutförd**                      | Är slutförd, som i **Slutförd**.                                                                                 |

Håll dina tillstånd under **Schemalagd**: varje ny händelse börjar där, och en händelse går aldrig uppåt i listan igen, så ett tillstånd ovanför det nås aldrig. Du flyttar en händelse till ett eget tillstånd från menyn **⋯** i dess sidhuvud, under **Ändra tillstånd till**.

> [!NOTE]
> På OneUptime Cloud krävs abonnemanget **Growth** eller högre för att lägga till eller ändra underhållstillstånd. Alla abonnemang kan läsa dem, använda dem och ta bort ett tillstånd du har lagt till.

## Arkivera en status

Arkivera en egen status som ditt team inte längre ska använda, i stället för att ta bort den. Arkivering ändrar ingen händelse: En händelse i statusen stannar i den och går vidare som vanligt, och dess statustidslinje visar den fortfarande.

- **Arkivera** finns i radens meny **⋯**. Den frågar först och listar de mätningar och arbetsflöden som är inställda på att använda statusen.
- **Ingen kan välja den igen.** Händelsens sidhuvud, **Ändra tillstånd**, Slack och Microsoft Teams utelämnar den, och API:et, Terraform och MCP avvisar den. Du kan fortfarande filtrera händelser på den.
- **Arkiverade statusar listas för sig**, i det hopfällda avsnittet **Arkiverade statusar för schemalagt underhåll** under tabellen. **Avarkivera** återställer en som den var.
- **De fyra inbyggda statusarna kan inte arkiveras**: OneUptime flyttar händelser till dem. Deras **Arkivera** är låst, med skälet.

## Tillståndstidslinjen

Händelsens sida **Tillståndstidslinje** är registret över varje tillstånd den har varit i. Dess kort, **Statustidslinje**, ritar dem som en tidslinje: ett band med varje tillstånd så långt som det varade, och under det varje ändring, den senaste först. **Tabell**, i kortets sidhuvud, listar dem som rader i stället, med **Status för schemalagt underhåll**, **Börjar den**, **Slutar den**, **Varaktighet**, om prenumeranterna skulle meddelas och hur deras avisering gick.

I instrumentpanelen kan rader läggas till och tas bort, men inte redigeras, och en händelse behåller alltid minst en. Via API:et kan en rads `startsAt` rättas, och varje mätning som har beräknats utifrån tidslinjen följer med. Tar du bort den senaste raden går händelsen tillbaka till tillståndet i raden före.

> [!WARNING]
> Att ta bort en rad skriver om händelsens historik och varje mätning som har beräknats utifrån den. Använd det för att rätta ett misstag, inte för att städa.

## Felsökning

:::details Sidhuvudet visar Start overdue
Händelsen väntar fortfarande mer än två minuter efter sitt **Börjar den**, så jobbet som startar händelser har inte flyttat den ännu. Starta den själv med knappen i sidhuvudet: en manuell start gör allt jobbet gör, även för dess monitorer.
:::

:::details En händelse kan inte flyttas tillbaka till ett tillstånd den har varit i
Tillstånd rör sig bara nedåt i listan. Ta bort raderna efter det tillstånd du vill ha på händelsens sida **Tillståndstidslinje**, den senaste först.
:::

:::details Det slutförda tillståndet saknas bland sidhuvudets knappar
Sidhuvudets knappar startar och avslutar händelsen. Att slutföra den finns i menyn **⋯**, under **Ändra tillstånd till**.
:::

## Nästa steg

:::cards
- [Schemalagt underhåll – Översikt](/docs/scheduled-maintenance/index): Var allt finns, och vad en händelse påverkar.
- [Skapa underhållshändelser](/docs/scheduled-maintenance/creating-events): Formuläret, fält för fält.
- [Underhållsregler och inställningar](/docs/scheduled-maintenance/settings): Påminn ägarna tills en händelse är slutförd.
- [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities): Samma ordnade lista, för incidenter.
:::
