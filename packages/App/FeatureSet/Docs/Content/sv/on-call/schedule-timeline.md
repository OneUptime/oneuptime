# Tidslinje för jourscheman

Tidslinjen för jourscheman visar alla jourscheman i ditt projekt i ett rutnät för en vecka eller en månad: en rad per schema, en kolumn per dag. Den svarar på "vem har jour i mitt team, eller i hela organisationen, den här veckan?" utan att du behöver öppna varje schema.

Passen på tidslinjen är samma pass som OneUptime larmar personer med, användaråsidosättningar inräknade: tidslinjen, eskaleringsreglerna och kalenderflödena läser dem alla från samma ställe.

```mermaid title="En uppsättning pass bakom tidslinjen, larmen och kalenderflödena"
flowchart TB
    subgraph setup["Varje schema"]
        direction LR
        layers["Lager och rotationer"]
        overrides["Användaråsidosättningar"]
    end
    layers --> shifts["Vem som har<br/>jour, och när"]
    overrides --> shifts
    shifts --> timeline["Tidslinje för<br/>jourscheman"]
    shifts --> paging["Eskaleringsregler<br/>larmar dem"]
    shifts --> feeds["Kalenderflöden"]
```

## Öppna tidslinjen

- **Jourtjänst** > **Tidslinje för jourscheman** visar alla scheman du kan se, grupperade efter det team som äger dem. Knappen **Tidslinjevy** på **Jourscheman** öppnar samma sida.
- **Team** > ett team > **Jourscheman** visar bara de scheman som teamet äger.

Ett team äger ett schema när det finns på schemats sida **Ägare**. Scheman utan ett ägande team grupperas under **Inget ägarteam**. Stäng av **Gruppera efter team** för att se alla scheman i en lista, sorterad efter namn.

## Läs rutnätet

| I rutnätet | Vad det betyder |
| --- | --- |
| En stapel | Ett pass: vem som har jour, från när till när. En person har samma färg i alla scheman. |
| En blekt stapel | Ett pass i det förflutna. |
| En stapel märkt **⇄** | En åsidosättning: någon täcker upp för ett pass. Den smala banan under den nämner personen vars pass täcks, överstruken. |
| Ett skrafferat bärnstensfärgat block | En täckningslucka: ingen har jour. Ett larm som eskalerar till det schemat larmar då ingen. |
| Den röda linjen | Nu. |
| Raden under ett schemas namn | Vem som har jour nu, eller **Ingen har jour nu**. |

Håll pekaren över en stapel eller en lucka, eller gå till den med tangentbordet, för att se detaljerna.

Under rutnätet visar **Jour den här veckan** (**Jour den här månaden** i månadsvyn) alla som har jour under perioden. Håll pekaren över ett namn för att se hur länge personen har jour, och i hur många scheman.

## Ändra period och tidszon

- Växla mellan **Vecka** och **Månad**, bläddra med pilarna och gå tillbaka med **Idag**.
- Tider visas i din egen tidszon. Tidszonsknappen öppnar **Visa tidslinjen i tidszon**, som visar tidslinjen i vilken annan zon som helst utan att ändra när någon har jour: varje schema lämnar fortfarande över i sin egen tidszon.
- Tidslinjen täcker 180 dagar bakåt och 365 dagar framåt.

> [!NOTE]
> Tidigare pass räknas om utifrån varje schemas nuvarande inställningar, så de visar rotationen som den är inställd nu, vilket kan skilja sig från vem som faktiskt larmades då. För de timmar personer faktiskt hade jour använder du **Jourtjänst** > **Rapporter** > **Användarens jourtid**. Se [Användarens jourtid](/docs/on-call/readiness#användarens-jourtid).

## Hitta ett schema eller en person

- **Sök** hittar schemanamn, teamnamn och de personer som har jour.
- Teamfiltret begränsar vyn till ett team eller till **Mina team**; **Scheman jag ingår i** behåller bara de scheman du ingår i.
- Klicka på **utan jour just nu** eller **med luckor i täckningen den här veckan** (**med luckor i täckningen den här månaden** i månadsvyn) ovanför rutnätet för att bara se de schemana. Klicka igen för att se alla.
- Klicka på en person under rutnätet, eller på en av personens staplar, för att markera alla personens pass. **Ta bort markering** tar bort markeringen, och **Rensa filter** återställer sökningen och filtren.

## Vem som ser vad

| Gäller | Regel |
| --- | --- |
| Behörigheter | Samma behörigheter och etikettbegränsningar som **Jourscheman**, plus behörighet att läsa schemalager. |
| Åsidosättningar | Vems pass en åsidosättning täcker visas bara för dem som får läsa användaråsidosättningar. Alla andra ser fortfarande vem som larmas. |
| Antal scheman | Upp till 250 scheman åt gången, sorterade efter namn. Ett teams sida **Jourscheman** begränsar det till de scheman som teamet äger. |
| Plan | På OneUptime Cloud kräver tidslinjen planen **Growth**, liksom jourscheman. |

## Nästa steg

:::cards
- [Jourscheman](/docs/on-call/schedules): Ställ in vilka som turas om, lager och jourtider.
- [Kalenderflöden](/docs/on-call/calendar-feeds): Lägg in dina pass i Google Kalender, Outlook eller Apple Kalender.
- [Eskaleringsregler](/docs/on-call/escalation-rules): Bestäm vem varje nivå i en jourpolicy larmar.
:::
