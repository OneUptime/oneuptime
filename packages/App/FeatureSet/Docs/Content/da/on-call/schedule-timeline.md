# Tidslinje for vagtplaner

Tidslinjen for vagtplaner viser alle vagtplaner i dit projekt i ét gitter for en uge eller en måned: én række pr. vagtplan, én kolonne pr. dag. Den besvarer "hvem har vagt i mit team, eller i hele organisationen, i denne uge?" uden at du skal åbne hver vagtplan.

Vagterne på tidslinjen er de samme, som OneUptime tilkalder folk med, brugeroverrides medregnet: tidslinjen, eskaleringsreglerne og kalenderfeedsene læser dem alle fra samme sted.

```mermaid title="Ét sæt vagter bag tidslinjen, tilkaldene og kalenderfeedsene"
flowchart TB
    subgraph setup["Hver vagtplan"]
        direction LR
        layers["Lag og rotationer"]
        overrides["Brugeroverrides"]
    end
    layers --> shifts["Hvem der har<br/>vagt, og hvornår"]
    overrides --> shifts
    shifts --> timeline["Tidslinje for<br/>vagtplaner"]
    shifts --> paging["Eskaleringsregler<br/>tilkalder dem"]
    shifts --> feeds["Kalenderfeeds"]
```

## Åbn tidslinjen

- **Vagtordning** > **Tidslinje for vagtplaner** viser alle de vagtplaner, du kan se, grupperet efter det team, der ejer dem. På **Vagtplaner** åbner **Tidslinje for vagtplaner** i menuen **⋯** samme side.
- **Teams** > et team > **Vagtplaner** viser kun de vagtplaner, teamet ejer.

Et team ejer en vagtplan, når det står på vagtplanens side **Ejere**. Vagtplaner uden et ejerteam grupperes under **Intet ejerteam**. Slå **Gruppér efter team** fra for at se alle vagtplaner i én liste, sorteret efter navn.

## Læs gitteret

| På gitteret | Hvad det betyder |
| --- | --- |
| En bjælke | En vagt: hvem der har vagt, fra hvornår til hvornår. En person har samme farve på alle vagtplaner. |
| En falmet bjælke | En vagt i fortiden. |
| En bjælke mærket **⇄** | En override: nogen dækker en vagt. Den smalle bane under den nævner den person, hvis vagt dækkes, overstreget. |
| En skraveret ravgul blok | Et hul i dækningen: ingen har vagt. En advarsel, der eskalerer til den vagtplan, tilkalder så ingen. |
| Den røde linje | Nu. |
| Linjen under en vagtplans navn | Hvem der har vagt nu, eller **Ingen på vagt nu**. |

Hold musen over en bjælke eller et hul, eller gå til den med tastaturet, for at se detaljerne.

Under gitteret viser **På vagt denne uge** (**På vagt denne måned** i månedsvisningen) alle, der har vagt i perioden. Hold musen over et navn for at se, hvor længe personen har vagt, og på hvor mange vagtplaner.

## Skift periode og tidszone

- Skift mellem **Uge** og **Måned**, flyt med pilene, og vend tilbage med **I dag**.
- Tider vises i din egen tidszone. Tidszoneknappen åbner **Vis tidslinjen i tidszone**, som viser tidslinjen i en hvilken som helst anden zone uden at ændre, hvornår nogen har vagt: hver vagtplan overdrager stadig i sin egen tidszone.
- Tidslinjen dækker 180 dage tilbage og 365 dage frem.

> [!NOTE]
> Tidligere vagter beregnes igen ud fra hver vagtplans nuværende opsætning, så de viser rotationen, som den er sat op nu, hvilket kan afvige fra, hvem der faktisk blev tilkaldt dengang. Til de timer, folk faktisk havde vagt, skal du bruge **Vagtordning** > **Rapporter** > **Brugerens vagttid**. Se [Brugerens vagttid](/docs/on-call/readiness#brugerens-vagttid).

## Find en vagtplan eller en person

- **Søg** finder navne på vagtplaner, navne på teams og de personer, der har vagt.
- Teamfilteret indsnævrer visningen til ét team eller til **Mine teams**; **Tidsplaner, jeg er på** beholder kun de vagtplaner, du er en del af.
- Klik over gitteret på **uden nogen på vagt nu** eller **med huller i dækningen denne uge** (**med huller i dækningen denne måned** i månedsvisningen) for kun at se de vagtplaner. Klik igen for at se dem alle.
- Klik på en person under gitteret, eller på en af personens bjælker, for at fremhæve alle personens vagter. **Ryd fremhævning** fjerner det igen, og **Ryd filtre** nulstiller søgningen og filtrene.

## Hvem der ser hvad

| Gælder | Regel |
| --- | --- |
| Tilladelser | De samme tilladelser og etiketbegrænsninger som **Vagtplaner** plus tilladelse til at læse vagtplanernes lag. |
| Overrides | Hvis vagt en override dækker, vises kun for dem, der må læse brugeroverrides. Alle andre ser stadig, hvem der tilkaldes. |
| Antal vagtplaner | Op til 250 vagtplaner ad gangen, sorteret efter navn. Et teams side **Vagtplaner** indsnævrer det til de vagtplaner, teamet ejer. |
| Plan | På OneUptime Cloud kræver tidslinjen planen **Growth**, ligesom vagtplaner. |

## Næste trin

:::cards
- [Vagtplaner](/docs/on-call/schedules): Opsæt, hvem der skiftes, lag og vagttimer.
- [Kalenderfeeds](/docs/on-call/calendar-feeds): Få dine vagter ind i Google Kalender, Outlook eller Apple Kalender.
- [Eskaleringsregler](/docs/on-call/escalation-rules): Bestem, hvem hvert niveau i en vagtpolitik tilkalder.
:::
