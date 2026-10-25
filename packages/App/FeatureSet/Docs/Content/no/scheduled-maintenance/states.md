# Vedlikeholdstilstander

Hver planlagte vedlikeholdshendelse er i én **tilstand**: hvor langt arbeidet har kommet, fra planlagt til godkjent. Tilstander bestemmer hva OneUptime gjør med hendelsen: når monitorene dens slutter å bli sjekket, hva statussidene dine viser, når påminnelsene dens stopper. Denne siden går gjennom de fire tilstandene hvert prosjekt starter med, hva som flytter en hendelse mellom dem, og hvordan du legger til egne trinn.

:::cards
- [Standardtilstandene](#standardtilstandene): Planlagt, Pågående, Avsluttet og Fullført.
- [Hva som flytter en hendelse](#hva-som-flytter-en-hendelse): Klokken, overskriften, tidslinjen, chat og API-et.
- [Egne tilstander](#egne-tilstander): Et trinn før arbeidet starter, eller en kontroll etterpå.
- [Tilstandstidslinjen](#tilstandstidslinjen): Hver tilstand en hendelse har vært i, og hvordan du retter den.
:::

## Slik fungerer det

Vedlikeholdstilstandene i et prosjekt er én ordnet liste, og hendelser beveger seg bare nedover den. Hvor en tilstand står, bestemmer hva en hendelse i den regnes som: venter på å starte, pågår eller er over.

```mermaid title="Hendelser beveger seg bare nedover listen; plasseringen bestemmer hva en tilstand regnes som"
flowchart TB
    subgraph waiting["Venter på å starte"]
        scheduled["Planlagt"]
        confirmed["Bekreftet<br/>(din egen)"]
    end
    subgraph progress["Pågår"]
        ongoing["Pågående"]
        verifying["Kontrolleres<br/>(din egen)"]
    end
    subgraph over["Over"]
        ended["Avsluttet"]
        completed["Fullført"]
    end
    scheduled --> confirmed
    confirmed -->|"ved Begynner den"| ongoing
    ongoing --> verifying
    verifying -->|"ved Slutter den"| ended
    ended --> completed
```

Modellen `ScheduledMaintenanceState` har `name`, `description`, `color` og `order`, pluss fire flagg: `isScheduledState`, `isOngoingState`, `isEndedState` og `isResolvedState`. OneUptime leser flaggene og rekkefølgen, aldri navnet, så du kan gi **Fullført** nytt navn til "Godkjent" uten at noe går i stykker.

> [!TIP]
> Listen ligger under **Planlagt vedlikehold → Innstillinger → Hendelsesstatus**. **Innstillinger** starter sammenslått i sidemenyen: utvid den først.

## Standardtilstandene

Hvert nytt prosjekt starter med fire vedlikeholdstilstander, i denne rekkefølgen:

| Tilstand      | `order` | Flagg              | Farge     | Hva den betyr                                                  |
| ------------- | ------- | ------------------ | --------- | -------------------------------------------------------------- |
| **Planlagt**  | `1`     | `isScheduledState` | `#000000` | Hver ny hendelse starter her og venter på starttidspunktet sitt. |
| **Pågående**  | `2`     | `isOngoingState`   | `#ffbf53` | Arbeidet er i gang, og monitorene til hendelsen sjekkes ikke.  |
| **Avsluttet** | `3`     | `isEndedState`     | `#4a4a4a` | Vinduet er over, og sjekkene gjenopptas.                       |
| **Fullført**  | `4`     | `isResolvedState`  | `#2ab57d` | Noen har godkjent arbeidet, og påminnelsene til eierne stopper. |

De fire flaggede tilstandene har merket **Innebygd** på innstillingssiden. Du kan gi dem nytt navn, ny farge og dra dem, men de beholder rekkefølgen sin og kan ikke slettes: **Slett** for dem forblir låst og sier hvorfor.

**Avsluttet** og **Fullført** er begge over. Forskjellen er hvem som flytter hendelsen: OneUptime flytter den til **Avsluttet** ved **Slutter den**, og en person, en chatknapp eller API-et flytter den til **Fullført** når arbeidet er kontrollert.

## Hva som flytter en hendelse

| Måte             | Hvor                                                                                        | Hva den spør om                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Klokken**      | En jobb som kjører hvert minutt                                                             | Ingenting: ved **Begynner den** flytter den en ventende hendelse til **Pågående**, og ved **Slutter den** en pågående til **Avsluttet**. |
| **Overskriften** | Hendelsens **Oversikt**: knappene **Merk som {{state}}**, og **Change state to** i menyen **⋯** | En kort dialog, **Merk planlagt vedlikehold som {{state}}**, med **Varsle statussideabonnenter** og et valgfritt notat under **Legg til et offentlig notat**. |
| **Tidslinjen**   | **Tilstandstidslinje** i sidemenyen til hendelsen                                           | En rad du legger til manuelt, med **Status for planlagt vedlikehold** og **Begynner den**.                      |
| **En rad i listen** | Menyen **⋯** på en hendelses rad i listen over hendelser: stegene **Merk som {{state}}** og **Endre tilstand** | Dialogen fra overskriften, som nevner hendelsen. En hendelse som en annen endring har flyttet i mellomtiden, blir latt være, og dialogen sier hvorfor. |
| **Masseendring** | **Merk som {{state}}** eller **Endre tilstand** på et utvalg i listen over hendelser                                     | Tilstanden, og ett offentlig notat som legges til hver hendelse. Hendelser som allerede er i tilstanden eller forbi den, hoppes over. |
| **Chat**         | Knappene på meldingene om hendelsen i Slack og Microsoft Teams                              | Den samme endringen, gjort som deg. Se [Slack](/docs/workspace-connections/slack#handle-på-hendelser-varsler-og-begivenheter-fra-slack). |
| **API-et**       | En rad opprettet på `/api/scheduled-maintenance-state-timeline`                             | Tilstanden, og om abonnentene får beskjed.                                                                      |

Knappene i overskriften er oppkalt etter tilstandene dine. Mens hendelsen venter, tilbyr den to: én som starter den, oppkalt etter den pågående tilstanden din, og én som avslutter den, oppkalt etter den avsluttede tilstanden din. Mens hendelsen pågår, bare den andre. Menyen **⋯** viser hver annen tilstand etter den nåværende.

## Hva start og avslutning gjør

En hendelse starter når den går fra en tilstand der den venter, til **Pågående**, eller rett til en egen tilstand plassert mellom **Pågående** og **Avsluttet**. Da:

- **Monitorene dens slutter å bli sjekket**, og går over til **Endre overvåkingsstatus til**, hvis den har en. En monitor du legger til hendelsen mens den pågår, går også over.
- **Statussidene dens viser den som pågående**, og abonnentene får beskjed: i tide hvis **Når hendelsen starter** er på, og manuelt slik **Varsle statussideabonnenter** i dialogen sier.
- **Eierne får beskjed**, hvis de har slått på varselet om tilstandsendring, og hendelsen vises under **Pågående hendelser**.

En hendelse avsluttes når den går fra en tilstand der den pågår, til **Avsluttet**, **Fullført** eller en egen tilstand plassert etter **Avsluttet**. Da sjekkes monitorene igjen og går tilbake til "operativ", med mindre en annen pågående hendelse fortsatt holder dem, og abonnentene får beskjed på samme måte: i tide hvis **Når hendelsen slutter** er på, og manuelt slik dialogen sier.

Å gå videre fra **Pågående** til "Kontrolleres", eller fra **Avsluttet** til **Fullført**, starter eller avslutter ingenting på nytt: hendelsen hadde allerede startet eller blitt avsluttet.

## Klokken i overskriften

Før start teller overskriften ned til den; mens hendelsen pågår, teller den hvor lenge den har pågått; når den er over, sier den hvor lang tid den tok. Når hendelsen bommer på en grense med mer enn to minutter, sier en gul melding det:

- **Start overdue**: hendelsen venter fortsatt etter **Begynner den**.
- **Overrunning**: hendelsen pågår fortsatt etter **Slutter den**.

Meldingen nevner det planlagte tidspunktet og tilstanden hendelsen ikke har nådd ennå. Rett etter en grense har jobben som flytter hendelser kanskje ikke kjørt ennå, så de neste minuttene sjekker overskriften på nytt av seg selv og viser den nye tilstanden uten å laste siden på nytt.

## Rekkefølgen håndheves

Hver tilstandsendring sjekkes mot listen, uansett hvem som gjør den: dashbordet, Slack, Microsoft Teams, API-et, Terraform, en arbeidsflyt eller OneUptime selv.

- **Bevegelser bakover avvises**, med en melding som nevner begge tilstandene: "Scheduled Maintenance cannot transition to Scheduled state from Ongoing state because Scheduled is before Ongoing in the order of scheduled maintenance states."
- **Å gå til tilstanden den allerede er i, avvises**: "Scheduled Maintenance state cannot be same as previous state."
- **Velgere tilbyr bare tilstandene etter den nåværende**, så ingen blir tilbudt en endring som ville blitt avvist.

For å rette en tilstand som ble satt ved en feil, sletter du raden dens på siden **Tilstandstidslinje** for hendelsen; hendelsen går tilbake til tilstanden i raden før.

## Egne tilstander

En tilstand du legger til, er et trinn teamet ditt går gjennom som de fire standardtilstandene ikke nevner: "Bekreftet" før arbeidet starter, "Kontrolleres" etterpå.

:::steps
### Åpne tilstandslisten

Gå til **Planlagt vedlikehold → Innstillinger → Hendelsesstatus**. Kortet **Planlagt Vedlikehold Tilstander** viser tilstandene dine i rekkefølge. Hver rad viser fargen og navnet, hva en hendelse i den regnes som (kolonnen **Teller som**), og beskrivelsen.

### Opprett tilstanden

Klikk på **Opprett Planlagt Vedlikehold Tilstand** og fyll ut **Navn**, **Beskrivelse** og **Farge**. Den nye tilstanden legges til rett over den fullførte tilstanden.

### Dra den på plass

Dra en rad i håndtaket for å flytte den; den nye rekkefølgen lagres når du slipper den. Kolonnen **Teller som** følger plassen du slipper den på.
:::

En tilstand du legger til, har ikke noe flagg, så plasseringen er det den betyr:

| Hvor du plasserer den                   | En hendelse i den                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Mellom **Planlagt** og **Pågående**     | Venter på **Begynner den**, som i **Planlagt**, og starter derfra i tide.                                        |
| Mellom **Pågående** og **Avsluttet**    | Pågår, som i **Pågående**: monitorene forblir usjekket, og den avsluttes ved **Slutter den**.                    |
| Mellom **Avsluttet** og **Fullført**    | Er over, men ikke fullført ennå: påminnelser som går til fullføring, fortsetter.                                 |
| Under **Fullført**                      | Er fullført, som i **Fullført**.                                                                                 |

Hold tilstandene dine under **Planlagt**: hver ny hendelse starter der, og en hendelse går aldri oppover listen igjen, så en tilstand over den nås aldri. Du flytter en hendelse til en egen tilstand fra menyen **⋯** i overskriften, under **Change state to**.

> [!NOTE]
> På OneUptime Cloud krever det abonnementet **Growth** eller høyere å legge til eller endre vedlikeholdstilstander. Alle abonnementer kan lese dem, bruke dem og slette en tilstand du har lagt til.

## Arkivere en status

Arkiver en status du selv har laget som teamet ditt ikke lenger skal bruke, i stedet for å slette den. Arkivering endrer ingen hendelse: En hendelse i statusen blir i den og går videre som vanlig, og statustidslinjen viser den fortsatt.

- **Arkiver** ligger i radens meny **⋯**. Den spør først og viser målingene og arbeidsflytene som er satt opp til å bruke statusen.
- **Ingen kan velge den igjen.** Hendelsens topptekst, **Endre tilstand**, Slack og Microsoft Teams utelater den, og API-et, Terraform og MCP avviser den. Du kan fortsatt filtrere hendelser på den.
- **Arkiverte statuser vises for seg**, i den sammenslåtte delen **Arkiverte statuser for planlagt vedlikehold** under tabellen. **Fjern fra arkiv** setter en tilbake slik den var.
- **De fire innebygde statusene kan ikke arkiveres**: OneUptime flytter hendelser inn i dem. Deres **Arkiver** er låst, med begrunnelsen.

## Tilstandstidslinjen

Siden **Tilstandstidslinje** for hendelsen er registeret over hver tilstand den har vært i. Kortet, **Statustidslinje**, tegner dem som en tidslinje: et bånd med hver tilstand så lang som den varte, og under det hver endring, den nyeste først. **Tabell**, i overskriften på kortet, viser dem som rader i stedet, med **Status for planlagt vedlikehold**, **Begynner den**, **Slutter den**, **Varighet**, om abonnentene skulle varsles, og hvordan varselet gikk.

I dashbordet kan rader legges til og slettes, men ikke redigeres, og en hendelse beholder alltid minst én. Gjennom API-et kan `startsAt` for en rad rettes, og hver måling som er beregnet ut fra tidslinjen, følger med. Sletter du den nyeste raden, går hendelsen tilbake til tilstanden i raden før.

> [!WARNING]
> Å slette en rad skriver om historikken til hendelsen og hver måling som er beregnet ut fra den. Bruk det til å rette en feil, ikke til å rydde.

## Feilsøking

:::details Overskriften viser Start overdue
Hendelsen venter fortsatt mer enn to minutter etter **Begynner den**, så jobben som starter hendelser, har ikke flyttet den ennå. Start den selv med knappen i overskriften: en manuell start gjør alt jobben gjør, også med monitorene.
:::

:::details En hendelse kan ikke flyttes tilbake til en tilstand den har vært i
Tilstander går bare nedover listen. Slett radene etter tilstanden du vil ha, på siden **Tilstandstidslinje** for hendelsen, den nyeste først.
:::

:::details Den fullførte tilstanden mangler blant knappene i overskriften
Knappene i overskriften starter og avslutter hendelsen. Å fullføre den ligger i menyen **⋯**, under **Change state to**.
:::

## Neste steg

:::cards
- [Planlagt vedlikehold – Oversikt](/docs/scheduled-maintenance/index): Hvor alt ligger, og hva en hendelse påvirker.
- [Opprett vedlikeholdshendelser](/docs/scheduled-maintenance/creating-events): Skjemaet, felt for felt.
- [Vedlikeholdsregler og innstillinger](/docs/scheduled-maintenance/settings): Påminn eierne til en hendelse er fullført.
- [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities): Den samme ordnede listen, for uplanlagte hendelser.
:::
