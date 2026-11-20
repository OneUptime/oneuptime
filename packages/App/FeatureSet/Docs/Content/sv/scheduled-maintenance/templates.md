# Mallar och återkommande händelser

En mall för schemalagt underhåll sparar en händelse som du ofta planerar: dess titel och beskrivning, de monitorer den pausar, de statussidor den visas på och vem som får veta. Använd en för att fylla i formuläret med ett klick, eller gör den återkommande, så att OneUptime schemalägger händelsen åt dig varje vecka, varje månad eller med vilket intervall du vill.

:::cards
- [Skapa en mall](#skapa-en-mall): Formulärets steg, med ett namn först och ett schema sist.
- [Använd en mall](#använd-en-mall): Fyll i en ny händelse från den.
- [Återkommande händelser](#återkommande-händelser): Låt OneUptime schemalägga händelsen av sig själv.
- [Ändra eller stoppa en mall](#ändra-eller-stoppa-en-mall): Redigera den, pausa dess schema eller ta bort den.
:::

## Så fungerar det

En mall är en utgångspunkt. En händelse som har skapats från den är en kopia med egna värden: ändrar du mallen senare ändras bara de händelser som skapas efter det.

```mermaid title="Två sätt som en mall blir en händelse på"
flowchart TB
    template["En mall i<br/>Underhållsmallar"] --> byhand["Skapa från mall<br/>fyller i formuläret"]
    template --> schedule["Återkommande<br/>händelse på<br/>kontrolleras varje minut"]
    byhand --> event["En ny händelse<br/>i Schemalagd"]
    schedule --> event
```

## Innan du börjar

- **Ditt abonnemang.** På OneUptime Cloud kräver mallar abonnemanget **Growth** eller högre.
- **Din roll.** För att skapa en mall krävs **Projektägare**, **Projektadministratör**, **Projektmedlem**, **Underhållsadministratör** eller **Underhållsmedlem**, eller en anpassad roll som får skapa mallar för schemalagt underhåll.

## Skapa en mall

:::steps
### Öppna mallarna

Gå till **Schemalagt underhåll → Inställningar → Underhållsmallar**. **Inställningar** börjar hopfällt i sidomenyn: fäll ut det först. Klicka på **Skapa Mall för schemalagt underhåll**.

### Namnge mallen

Under **Mallinformation** ger du den ett **Mallnamn** och en **Mallbeskrivning**, så att ditt team vet när den ska användas. Båda är obligatoriska.

### Beskriv händelsen

Under **Underhållsdetaljer** fyller du i den **Titel** och den **Beskrivning** som varje händelse från den börjar med. **Ägare** och **Etiketter** väntar under **Fler fält**.

### Välj vad den påverkar

Under **Berörda resurser** väljer du **Monitorer**, **Ändra övervakningsstatus till** för dem, eventuella **Andra påverkade resurser**, statussidorna under **Visa händelse på dessa statussidor** och **Aviseringar till prenumeranter**.

### Bestäm om den återkommer

Under **Återkommande** låter du **Återkommande händelse** vara avstängd för en mall som du använder manuellt, eller slår på den, väljer hur ofta den återkommer och dess **Tidszon** och anger den första händelsens tider under **Första händelsen**. Klicka på **Nästa** för att gå igenom granskningen och skapa sedan mallen.
:::

En mall frågar efter **Ändra övervakningsstatus till** även när den inte nämner några monitorer: statusen gäller också de monitorer du lägger till när du schemalägger en händelse från den. Under **Andra påverkade resurser** tar en mall värdar, Kubernetes-kluster, Docker-värdar, Podman-värdar och tjänster.

## Vad en mall fyller i

| Del av händelsen                                  | Skapa från mall                      | En återkommande händelse        |
| ------------------------------------------------- | ------------------------------------ | ------------------------------- |
| **Titel** och **Beskrivning**                     | Ifyllda, och du kan ändra dem        | Kopierade                       |
| **Monitorer** och **Ändra övervakningsstatus till** | Ifyllda                            | Kopierade                       |
| **Andra påverkade resurser**                      | Ifyllda                              | Kopierade                       |
| Statussidorna och **Aviseringar till prenumeranter** | Ifyllda                           | Kopierade                       |
| **Ägare** och **Etiketter**                       | Ifyllda                              | Kopierade                       |
| **Börjar den** och **Slutar den**                 | Nästa hela timme, i en timme         | Beräknade utifrån schemat       |

## Använd en mall

:::steps
### Välj mallen

På **Schemalagt underhåll → Alla underhållshändelser** klickar du på **Skapa från mall** och väljer en mall under **Välj mall för schemalagt underhåll**.

### Kontrollera formuläret

Klicka på **Skapa från mall**. Formuläret öppnas med mallens svar redan ifyllda. Ställ in fönstret och ändra det som den här händelsen behöver.

### Skapa händelsen

Gå igenom stegen med **Nästa** och klicka sedan på **Skapa underhållshändelse** i granskningen.
:::

När projektet ännu inte har någon mall säger **Skapa från mall** det och länkar till **Underhållsmallar**.

## Återkommande händelser

En återkommande mall skapar händelsen enligt ett schema. Du anger hur ofta den återkommer, vilken tidszon den håller sig till och när den första händelsen skapas, när den börjar och när den slutar; varje senare händelse är den första flyttad hela intervall framåt i den tidszonens kalender, på samma tider på dygnet.

| Fält                                                     | Vad det betyder                                                                                    |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Återkommande händelse**                                | Slår på schemat.                                                                                   |
| **Hur ofta vill du att den här händelsen ska upprepas?** | Ett tal och en enhet: timmar, dagar, veckor, månader eller år.                                     |
| **Tidszon**                              | Tidszonen som händelserna behåller sin tid på dygnet i. En ny mall börjar med din.                  |
| **Första händelsen schemalagd**                          | När OneUptime skapar den första händelsen, och alltså när dess prenumeranter får veta att den är schemalagd. |
| **Första händelsen börjar**                              | När den första händelsen börjar.                                                                   |
| **Första händelsen slutar**                              | När den första händelsen slutar.                                                                   |

De tre första finns i steget **Återkommande**. Den första händelsens tider finns i steget **Första händelsen**, som visas när **Återkommande händelse** är påslagen.

Till exempel ett veckofönster där den första händelsen skapas en måndag för lördagen därefter:

| Händelse     | Skapad             | Börjar             | Slutar             |
| ------------ | ------------------ | ------------------ | ------------------ |
| Den första   | `2030-06-03 09:00` | `2030-06-08 02:00` | `2030-06-08 04:00` |
| Den andra    | `2030-06-10 09:00` | `2030-06-15 02:00` | `2030-06-15 04:00` |

Varje händelse behåller den första händelsens tider på dygnet i mallens tidszon, även när klockan ställs om för sommartid: ett fönster från 02:00 till 04:00 i Berlin ligger där från 02:00 till 04:00 både på sommaren och på vintern. Några dagar blir så här:

- **En dag som månaden inte har.** En månatlig händelse den 29:e, 30:e eller 31:a infaller på den sista dagen i en kortare månad, till exempel 30 april eller 28 februari, och åter på sin egen dag de månader som har den. En årlig händelse den 29 februari infaller den 28 februari andra år.
- **Natten då klockan ställs fram.** En tid som inte finns den natten, till exempel 02:30 när 02:00 hoppar till 03:00, flyttas fram med hoppet, till 03:30. En händelse vars start därmed hamnar efter dess slut behåller den första händelsens längd.
- **Natten då klockan ställs tillbaka.** En tid som inträffar två gånger den natten, till exempel 01:30 i New York, är den första av de två.
- **Med några timmars mellanrum.** Timmar räknas allteftersom de går, så en mall som återkommer med några timmars mellanrum flyttas en timme på klockan när den ställs om.
- **En tidszon utan sommartid.** En tidszon som inte längre ställer om klockan, till exempel British Columbias (America/Vancouver) sedan november 2026, behåller samma förskjutning, så inget flyttas.

En mall som skapades innan mallar hade en tidszon visar **UTC**, den tidszon som dess händelser beräknades i fram till dess. Välj den tidszon som dess tider var avsedda i, så behåller varje händelse från dess nästa händelse den första händelsens tid på dygnet där.

Sätt **Första händelsen schemalagd** så långt före starten som du vill att dina kunder ska få höra om arbetet. Alla tre tiderna måste ligga i framtiden när du skapar mallen, händelsen måste skapas innan den börjar och slutar, och den måste börja innan den slutar; formuläret säger vilken regel en tid bryter mot.

Ett jobb kontrollerar de återkommande mallarna varje minut. När en malls nästa tid kommer skapar det händelsen och flyttar den tiden framåt till schemats nästa händelse. Malllistan visar den tiden i sin kolumn **Återkommande händelse**, och **Nej** för en mall som inte återkommer. En händelse som har skapats från schemat är som vilken annan som helst: dess regler körs, dess ägare läggs till och dess prenumeranter får veta att den är schemalagd.

## Ändra eller stoppa en mall

Öppna en mall från listan för att se dess sida:

- **Malldetaljer för schemalagt underhåll** visar vad nya händelser börjar med. Dess **Redigera** går igenom **Mallinformation**, **Underhållsdetaljer**, **Statussidor** och **Återkommande**, och därefter **Första händelsen** för en mall som återkommer.
- **Berörda resurser** rymmer dess **Monitorer**, deras **Ändra övervakningsstatus till** och dess **Andra påverkade resurser**, med en egen **Redigera**.
- **Ägare** listar de personer och team som äger varje händelse som schemaläggs från den.

Ändringar gäller de händelser som skapas efter att du har sparat dem; händelser som redan har skapats behåller sina egna värden. För att stoppa ett schema stänger du av **Återkommande händelse** under **Redigera**, eller tar bort mallen. En mall som är avstängd behåller sitt schema: slår du på den igen fortsätter den vid schemats nästa tid och hoppar över tiderna då den var avstängd. Tar du bort en mall finns de händelser den har skapat kvar.

## Felsökning

:::details När en återkommande mall skapas står det att en tid ska ligga i framtiden
Alla tre första tiderna måste ligga efter nu när du skapar den. Flytta fram dem: schemat fortsätter sedan från den första händelsen.
:::

:::details En återkommande mall skapade ingen händelse
Kontrollera att **Återkommande händelse** fortfarande är på, och titta på tiden i listans kolumn **Återkommande händelse**: händelsen skapas då, inte vid sin start. Jobbet körs varje minut, så ge det en minut.
:::

:::details Händelser från en återkommande mall kommer en timme för tidigt eller för sent efter att klockan ställts om
Öppna mallen och kontrollera dess **Tidszon**: dess händelser behåller den första händelsens tid på dygnet i den tidszonen. En mall som skapades innan mallar hade en tidszon visar **UTC**: välj den tidszon som dess tider var avsedda i. Händelser som redan har skapats behåller sina tider.
:::

:::details En händelse från en mall saknar en resurs som jag valde
En mall tar värdar, Kubernetes-kluster, Docker-värdar, Podman-värdar och tjänster under **Andra påverkade resurser**. Lägg till andra slags resurser på själva händelsen, med **Redigera** på dess kort **Berörda resurser**.
:::

## Nästa steg

:::cards
- [Skapa underhållshändelser](/docs/scheduled-maintenance/creating-events): Formuläret som en mall fyller i.
- [Underhållsstatusar](/docs/scheduled-maintenance/states): Hur varje händelse går vidare när den har skapats.
- [Underhållsregler och inställningar](/docs/scheduled-maintenance/settings): Ge varje ny händelse ägare och etiketter automatiskt.
- [Schemalagt underhåll – Översikt](/docs/scheduled-maintenance/index): Var mallar passar in i resten av underhållet.
:::
