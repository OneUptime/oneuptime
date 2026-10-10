# Tidslinje for vaktplaner

Tidslinjen for vaktplaner viser alle vaktplanene i prosjektet ditt i ett rutenett for en uke eller en måned: én rad per vaktplan, én kolonne per dag. Den svarer på "hvem har vakt i teamet mitt, eller i hele organisasjonen, denne uken?" uten at du må åpne hver vaktplan.

Vaktene på tidslinjen er de samme som OneUptime varsler folk med, brukeroverstyringer medregnet: tidslinjen, eskaleringsreglene og kalenderfeedene leser dem alle fra samme sted.

```mermaid title="Ett sett vakter bak tidslinjen, varslingen og kalenderfeedene"
flowchart TB
    subgraph setup["Hver vaktplan"]
        direction LR
        layers["Lag og rotasjoner"]
        overrides["Brukeroverstyringer"]
    end
    layers --> shifts["Hvem som har vakt, og når"]
    overrides --> shifts
    shifts --> timeline["Tidslinje for vaktplaner"]
    shifts --> paging["Eskaleringsregler varsler dem"]
    shifts --> feeds["Kalenderfeeder"]
```

## Åpne tidslinjen

- **Vakttjeneste** > **Tidslinje for vaktplaner** viser alle vaktplanene du kan se, gruppert etter teamet som eier dem. Knappen **Tidslinjevisning** på **Vaktplaner** åpner den samme siden.
- **Team** > et team > **Vaktplaner** viser bare vaktplanene teamet eier.

Et team eier en vaktplan når det står på vaktplanens side **Eiere**. Vaktplaner uten et eierteam grupperes under **No owner team**. Slå av **Group by team** for å se alle vaktplanene i én liste, sortert etter navn.

## Les rutenettet

| På rutenettet | Hva det betyr |
| --- | --- |
| En stolpe | En vakt: hvem som har vakt, fra når til når. En person har samme farge i alle vaktplaner. |
| En blek stolpe | En vakt i fortiden. |
| En stolpe merket **⇄** | En overstyring: noen dekker en vakt. Den smale banen under den nevner personen hvis vakt dekkes, gjennomstreket. |
| En skravert gul blokk | Et hull i dekningen: ingen har vakt. Et varsel som eskalerer til den vaktplanen, varsler da ingen. |
| Den røde streken | Nå. |
| Linjen under navnet på en vaktplan | Hvem som har vakt nå, eller **No one on call now**. |

Hold pekeren over en stolpe eller et hull, eller gå til den med tastaturet, for å se detaljene.

Under rutenettet viser **On call this week** (**On call this month** i månedsvisningen) alle som har vakt i perioden. Hold pekeren over et navn for å se hvor lenge personen har vakt, og i hvor mange vaktplaner.

## Endre periode og tidssone

- Bytt mellom **Week** og **Month**, bla med pilene, og gå tilbake med **Today**.
- Tidene vises i din egen tidssone. Tidssoneknappen åpner **View timeline in timezone**, som viser tidslinjen i en hvilken som helst annen sone uten å endre når noen har vakt: hver vaktplan overleverer fortsatt i sin egen tidssone.
- Tidslinjen dekker 180 dager bakover og 365 dager fremover.

> [!NOTE]
> Tidligere vakter beregnes på nytt ut fra hver vaktplans nåværende oppsett, så de viser rotasjonen slik den er satt opp nå, noe som kan avvike fra hvem som faktisk ble varslet den gangen. For timene folk faktisk hadde vakt, bruker du **Vakttjeneste** > **Rapporter** > **Brukerens vakttid**.

## Finn en vaktplan eller en person

- **Søk** finner navn på vaktplaner, navn på team og personene som har vakt.
- Teamfilteret snevrer visningen inn til ett team eller til **My teams**; **Schedules I'm on** beholder bare vaktplanene du er en del av.
- Klikk på **with no one on call now** eller **with coverage gaps this week** (**with coverage gaps this month** i månedsvisningen) over rutenettet for å se bare de vaktplanene. Klikk igjen for å se alle.
- Klikk på en person under rutenettet, eller på en av personens stolper, for å utheve alle vaktene til personen. **Clear highlight** opphever det, og **Clear filters** tilbakestiller søket og filtrene.

## Hvem som ser hva

| Gjelder | Regel |
| --- | --- |
| Tillatelser | De samme tillatelsene og etikettbegrensningene som **Vaktplaner**, pluss tillatelse til å lese lagene i vaktplaner. |
| Overstyringer | Hvem sin vakt en overstyring dekker, vises bare for dem som kan lese brukeroverstyringer. Alle andre ser fortsatt hvem som varsles. |
| Antall vaktplaner | Opptil 250 vaktplaner om gangen, sortert etter navn. Et teams side **Vaktplaner** snevrer det inn til vaktplanene teamet eier. |
| Plan | På OneUptime Cloud krever tidslinjen planen **Growth**, som vaktplaner. |

## Neste steg

:::cards
- [Vaktplaner](/docs/on-call/schedules): Sett opp hvem som bytter på, lag og vakttimer.
- [Kalenderfeeder](/docs/on-call/calendar-feeds): Få vaktene dine inn i Google Kalender, Outlook eller Apple Kalender.
- [Eskaleringsregler](/docs/on-call/escalation-rules): Bestem hvem hvert nivå i en vaktretningslinje varsler.
:::
