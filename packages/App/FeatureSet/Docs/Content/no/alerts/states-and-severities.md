# Varseltilstander og alvorlighetsgrader

Hvert varsel har en **tilstand**, hvor langt teamet ditt har kommet med det, og en **alvorlighetsgrad**, hvor mye det betyr. Tilstander styrer hva OneUptime gjør: hvem som fortsatt tilkalles, hva som teller som aktivt, når en episode løses. Alvorlighetsgrader rangerer varsler, og regler kan samsvare på dem. Denne siden er for alle som setter dem opp, eller som lurer på hvorfor et varsel tilkalte eller ikke tilkalte noen.

:::cards
- [De forhåndsopprettede tilstandene](#de-forhåndsopprettede-tilstandene): Identified, Bekreftet og Løst, og hva hver av dem gjør.
- [Legg til egne tilstander](#legg-til-egne-tilstander): Et trinn som er ditt eget, som "Under undersøkelse".
- [Flytt et varsel gjennom tilstandene](#flytt-et-varsel-gjennom-tilstandene): Alle måter en tilstand endres på.
- [Alvorlighetsgrader](#de-forhåndsopprettede-alvorlighetsgradene): High og Low, og legg til egne.
:::

## Slik fungerer det

Varseltilstandene i et prosjekt er én ordnet liste, og varsler beveger seg bare nedover i den. Hvor en tilstand står, avgjør hva et varsel i den teller som: ikke bekreftet ennå, bekreftet eller løst. Varselepisoder går gjennom den samme listen.

```mermaid title="Varsler går bare nedover i listen; hvor en tilstand står, avgjør hva den teller som"
flowchart TB
    subgraph open["Teller som<br/>ikke bekreftet"]
        identified["Identified"]
    end
    subgraph working["Teller som<br/>bekreftet"]
        acknowledged["Bekreftet"]
        investigating["Under undersøkelse<br/>(egen)"]
    end
    subgraph done["Teller som<br/>løst"]
        resolved["Løst"]
        closed["Lukket<br/>(egen)"]
    end
    identified --> acknowledged
    acknowledged --> investigating
    investigating --> resolved
    resolved --> closed
    identified -. "hopp over" .-> resolved
```

Modellen `AlertState` har `name`, `description`, `color` og `order` pluss tre flagg: `isCreatedState`, `isAcknowledgedState` og `isResolvedState`. OneUptime leser flaggene og rekkefølgen, aldri navnet, så du kan gi **Løst** nytt navn til "Lukket" uten at noe går i stykker. Modellen `AlertSeverity` har `name`, `description`, `color` og `order` og ingen flagg.

> [!TIP]
> Begge listene ligger under **Varsler → Innstillinger**, som starter sammenfoldet i sidemenyen: Fold ut **Innstillinger** for å finne **Varselsstatus** og **Varselsalvor**.

## De forhåndsopprettede tilstandene

Hvert nytt prosjekt starter med tre varseltilstander, i denne rekkefølgen:

| Tilstand         | `order` | Flagg                 | Farge     | Hva den betyr                                     |
| ---------------- | ------- | --------------------- | --------- | ------------------------------------------------- |
| **Identified**   | `1`     | `isCreatedState`      | `#fd625e` | Tilstanden nye varsler starter i.                 |
| **Bekreftet**    | `2`     | `isAcknowledgedState` | `#ffbf53` | Noen tar seg av det, og tilkallingen stopper.     |
| **Løst**         | `3`     | `isResolvedState`     | `#2ab57d` | Varselet er over og teller ikke lenger som aktivt. |

De tre tilstandene med flagg har merket **Innebygd** på innstillingssiden. Du kan gi dem nytt navn, ny farge og dra dem, men de beholder rekkefølgen, opprettet før bekreftet før løst, og de kan ikke slettes: **Slett** forblir låst og forteller hvorfor.

## Hva hvert flagg gjør

| Flagg                 | Hva OneUptime gjør med det                                                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isCreatedState`      | Nye varsler starter her når ingen velger en annen tilstand: hvert varsel en monitor utløser, og hvert varsel som opprettes med **Innledende tilstand** tom.                      |
| `isAcknowledgedState` | **Bekreft** flytter et varsel hit. I denne tilstanden eller en tilstand etter den teller varselet som bekreftet: Vaktpolicyene slutter å tilkalle, og **Bekreft** tilbys ikke lenger. |
| `isResolvedState`     | **Løs** flytter et varsel hit. I denne tilstanden eller en tilstand etter den teller varselet som løst: Det forlater **Aktive varsler**, påminnelsene stopper, og episoden kan løses. |

## Legg til egne tilstander

En tilstand du legger til, er et trinn teamet ditt går gjennom som de tre forhåndsopprettede ikke navngir: "Under undersøkelse", "Begrenset", "Lukket".

:::steps
### Åpne listen over tilstander

Gå til **Varsler → Innstillinger → Varselsstatus**. Kortet **Varsel Tilstander** viser tilstandene dine i rekkefølge. Hver rad viser farge og navn, hva et varsel i den **Teller som**, og beskrivelsen.

### Opprett tilstanden

Klikk på **Opprett Varselsstatus**, og fyll ut **Navn**, **Beskrivelse** og **Farge**. Fargen er allerede valgt: en som ingen annen tilstand bruker ennå. Den nye tilstanden legges til rett over løst-tilstanden, så den holder varsler aktive.

### Dra den på plass

Dra en rad etter håndtaket for å flytte den; den nye rekkefølgen lagres når du slipper. Kolonnen **Teller som** følger med: Over bekreftet-tilstanden er et varsel **Ikke bekreftet**, fra den og nedover **Bekreftet**, og fra løst-tilstanden og nedover **Løst**.
:::

En tilstand du legger til, har ikke noe flagg, så plassen er betydningen. Sett et begrensningstrinn mellom **Bekreftet** og **Løst** og et triagetrinn over **Bekreftet**. En tilstand under **Løst** teller som løst overalt.

Du flytter et varsel til en egen tilstand fra menyen **⋯** i toppen av varselet, under **Change state to**, som viser hver tilstand etter den nåværende. Bekreftelsen har tittelen **Merk varsel som {{state}}**, med navnet på tilstanden i.

> [!NOTE]
> På OneUptime Cloud krever det planen **Growth** eller høyere å legge til eller endre varseltilstander og alvorlighetsgrader. Alle planer kan lese dem, bruke dem og slette en tilstand du har lagt til.

## Rekkefølgen håndheves

Hver tilstandsendring for et varsel kontrolleres mot listen, uansett hvem som gjør den: dashbordet, Slack, Microsoft Teams, API-et, Terraform, en arbeidsflyt eller OneUptime selv.

- **Endringer bakover avvises** med en melding som nevner begge tilstandene: "Alert cannot transition to Acknowledged state from Resolved state because Acknowledged is before Resolved in the order of alert states."
- **En endring til tilstanden det allerede er i, avvises**: "Alert state cannot be same as previous state."
- **Velgere tilbyr bare tilstandene etter den nåværende**, så ingen blir tilbudt en endring som ville blitt avvist.

Varselepisoder holdes til den samme listen, med egne meldinger ("Episode cannot transition to …"). Den eneste endringen tilbake opp i listen er OneUptimes egen: en grupperingsregel som gjenåpner en nylig løst episode. For å rette en tilstand som er satt ved en feil, sletter du raden på varselets side **Tilstandstidslinje**; varselet går tilbake til tilstanden i den nyeste gjenværende raden.

## De forhåndsopprettede alvorlighetsgradene

Hvert nytt prosjekt starter med to alvorlighetsgrader for varsler, den mest alvorlige først:

| Alvorlighetsgrad | `order` | Farge     | Forhåndsopprettet beskrivelse                                                     |
| ---------------- | ------- | --------- | --------------------------------------------------------------------------------- |
| **High**         | `1`     | `#b70400` | Issues causing very high impact to customers. Immediate attention is required.    |
| **Low**          | `2`     | `#ffbf53` | Issues causing low impact to customers.                                           |

Hendelser starter med tre alvorlighetsgrader og varsler med to. Når malen i en monitoranbefaling sier **Kritisk** eller **Warning**, knytter OneUptime det til din første og andre alvorlighetsgrad for varsler, som i et nytt prosjekt er **High** og **Low**.

## Rediger alvorlighetsgrader

Gå til **Varsler → Innstillinger → Varselsalvor**. Kortet **Varsel Alvorligheter** viser dem med den mest alvorlige først; dra en rad for å endre rangen. **Opprett Varselsalvor** legger til en sist i listen, som den minst alvorlige, med de samme **Navn**, **Beskrivelse** og **Farge** som en tilstand.

Rangen avgjør hvilken alvorlighetsgrad som vinner der OneUptime sammenligner dem: En episodes alvorlighetsgrad stiger til det mest alvorlige varselet som blir med i den. Alvorlighetsgrader har ingen flagg og ingen slettelås: Enhver alvorlighetsgrad kan slettes, også de to forhåndsopprettede.

En alvorlighetsgrad tilkaller ingen på egen hånd. For å tilkalle etter alvorlighetsgrad legger du til en vaktregel der **Varsel Alvorligheter** samsvarer med den: se [Varselregler og innstillinger](/docs/alerts/settings). Endrer du et varsels alvorlighetsgrad, skrives en oppføring i feeden, og påminnelsesregelen samsvares på nytt.

## Arkivere en status eller alvorlighetsgrad

Arkiver en status eller alvorlighetsgrad som teamet ditt ikke lenger skal bruke, i stedet for å slette den. Arkivering endrer ingen varsler. Sletting av en status fjerner radene dens fra hvert varsels historikk, og en alvorlighetsgrad kan ikke slettes så lenge varsler har den.

- **Arkiver** ligger i radens meny **⋯**. Den spør først og viser reglene, målingene, monitorkriteriene og arbeidsflytene som er satt opp til å bruke verdien: De fortsetter å bruke den til du endrer dem.
- **Ingen kan velge den igjen.** **Endre tilstand**, varselets topptekst, Slack, Microsoft Teams, regler og monitorkriterier utelater den. API-et, Terraform og MCP avviser den og nevner verdien og hvor den kan fjernes fra arkivet.
- **Varsler beholder den.** Et varsel som har den, beholder den ved hver senere redigering, statustidslinjen viser den fortsatt, og du kan fortsatt filtrere på den.
- **Arkiverte verdier vises for seg**, i den sammenslåtte delen **Arkiverte varselsstatuser** eller **Arkiverte alvorlighetsgrader for varsler** under tabellen, med hvem som arkiverte hver enkelt og når. **Fjern fra arkiv** setter en tilbake slik den var.
- **Noen kan ikke arkiveres.** Den opprettede, den bekreftede og den løste statusen, og prosjektets siste alvorlighetsgrad som ikke er arkivert. Deres **Arkiver** er låst, med begrunnelsen.

**Slett** forteller først hva den ville gjøre. Så lenge varsler eller episoder har verdien, avvises slettingen, og dialogen viser dem. Ellers viser den hva slettingen ville endre, og tilbyr **Arkiver i stedet**.

## Flytt et varsel gjennom tilstandene

| Måte                 | Hvor                                                                                      | Hva det spørres om                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Knapper i toppen** | Toppen av varselet: **Bekreft**, **Løs** og **Change state to** i menyen **⋯**            | En kort bekreftelse, **Bekreft varsel**, **Løs varsel** eller **Merk varsel som {{state}}**, med et valgfritt notat under **Legg til et privat notat**. |
| **State timeline**   | **Tilstandstidslinje** i varselets sidemeny                                               | En rad du legger til manuelt, med **Varselstatus** og **Begynner den**.                                                               |
| **Rad i listen** | Menyen **⋯** på et varsels rad i varsellisten: **Bekreft**, **Løs** og **Endre tilstand** | Bekreftelsen fra toppen, som nevner varselet. Et varsel som en annen endring har flyttet i mellomtiden, blir latt være, og dialogen sier hvorfor. |
| **Masseendring**     | **Bekreft**, **Løs** eller **Endre tilstand** på et utvalg i varsellisten                                            | Tilstanden og ett privat notat som legges til hvert varsel. Varsler som allerede er i eller etter tilstanden, hoppes over.            |
| **Automatisk**       | En monitor, en episode, en tilknyttet hendelse eller din egen kode                        | **Løs varsel automatisk** i kriteriene til en monitor, en episodes tilstandsendring, hendelsesbryterne på [Koblede varsler](/docs/incidents/linked-alerts) eller en rad som opprettes på `/api/alert-state-timeline`. |

Toppen tilbyr **Bekreft** og **Løs** så lenge varselet ikke er bekreftet ennå, og bare **Løs** når det er det. Et løst varsel viser ingen av dem.

## Hva bekreftelse gjør

Et varsel er bekreftet fra det øyeblikket det flyttes til bekreftet-tilstanden din eller til en tilstand etter den, også en løst. Deretter:

- **Vakten slutter å tilkalle for det.** Vaktpolicyene tilkaller ikke neste nivå.
- **Bekreft tilbys ikke lenger**, verken i toppen eller i Slack og Microsoft Teams, der en ny bekreftelse avvises med "Alert is already acknowledged." eller "Alert is already resolved." Den som svarer på tilkallingen sin etter det, får tilkallingen bekreftet, og varselet blir der det er.
- **Tiden til bekreftelse fastsettes** fra den første slike endringen: den første ruten i **Oversikt** og en måling som slutter når **Varselet blir bekreftet**.

## Hva løsning gjør

Et varsel er løst når det flyttes til løst-tilstanden din eller til en tilstand etter den. Deretter:

- **Det forlater Aktive varsler** og tellingen i sidemenyen.
- **Påminnelsene stopper**, uansett hva påminnelsesregelen sier.
- **Episoden kan løses.** En episode løses av seg selv når hvert varsel i den er løst. Se [Varselepisoder og grupperingsregler](/docs/alerts/episodes).
- **Monitoren kan utløse et nytt varsel.** Et kriterium holder ett åpent varsel om gangen; når det er løst, åpner neste samsvar et nytt.

Å gå videre fra **Løst** til en tilstand etter den, for eksempel "Lukket", endrer ingenting av dette: Varselet var allerede løst.

## Tilstandstidslinjen

Varselets side **Tilstandstidslinje** er en oversikt over hver tilstand det har vært i. Kortet, **Statustidslinje**, tegner dem som en tidslinje: et bånd med hver tilstand så lang som den varte, og under det hver endring med den nyeste først. **Tabell** i kortets topptekst viser dem i stedet som rader, med **Varselstatus**, **Begynner den**, **Slutter den** og **Varighet**.

- **Vis årsak** viser rotårsaken som ble registrert med den endringen.
- **Vis logger** viser hva OneUptime registrerte da varselet endret seg, for eksempel monitorsjekken som forårsaket det.

Rader kan legges til og slettes, men ikke redigeres, og et varsel beholder alltid minst én. Sletter du den nyeste raden, settes varselet tilbake i tilstanden fra raden før.

> [!WARNING]
> Å slette en rad skriver om varselets historikk og hver måling som er beregnet ut fra den. Bruk det til å rette en feil, ikke til å rydde.

## Listen Aktive varsler

**Varsler → Aktive varsler** inneholder hvert varsel der tilstanden står over løst-tilstanden din, og ingenting annet avgjør det: verken alvorlighetsgrad, alder eller om noen har bekreftet det. Det røde merket ved siden av i sidemenyen teller de samme varslene.

En egen tilstand over **Løst** holder altså varsler i listen, og en under den tar dem ut, slik løsning gjør. **Aktive episoder** fungerer på samme måte for episoder.

## Neste steg

:::cards
- [Varsler – Oversikt](/docs/alerts/index): Hvor varsler kommer fra, og hvordan teamet ditt jobber med dem.
- [Varselepisoder og grupperingsregler](/docs/alerts/episodes): Hvordan en episodes tilstand flytter varslene.
- [Varselregler og innstillinger](/docs/alerts/settings): Tilkall og minn på etter alvorlighetsgrad.
- [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities): Den samme livssyklusen for hendelser.
:::
