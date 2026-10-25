# Vedligeholdelsestilstande

Hver planlagt vedligeholdelsesbegivenhed er i én **tilstand**: hvor langt arbejdet er nået, fra planlagt til godkendt. Tilstande bestemmer, hvad OneUptime gør med begivenheden: hvornår dens monitorer holder op med at blive kontrolleret, hvad dine statussider viser, hvornår dens påmindelser stopper. Denne side gennemgår de fire tilstande, hvert projekt starter med, hvad der flytter en begivenhed mellem dem, og hvordan du tilføjer dine egne trin.

:::cards
- [Standardtilstandene](#standardtilstandene): Planlagt, Igangværende, Afsluttet og Fuldført.
- [Hvad der flytter en begivenhed](#hvad-der-flytter-en-begivenhed): Uret, headeren, tidslinjen, chat og API'et.
- [Dine egne tilstande](#dine-egne-tilstande): Et trin, før arbejdet starter, eller en kontrol bagefter.
- [Tilstandstidslinjen](#tilstandstidslinjen): Hver tilstand, en begivenhed har været i, og hvordan du retter den.
:::

## Sådan fungerer det

Et projekts vedligeholdelsestilstande er én ordnet liste, og begivenheder bevæger sig kun nedad i den. Hvor en tilstand står, bestemmer, hvad en begivenhed i den tæller som: venter på at starte, igangværende eller overstået.

```mermaid title="Begivenheder bevæger sig kun ned ad listen; en tilstands plads bestemmer, hvad den tæller som"
flowchart TB
    subgraph waiting["Venter på at starte"]
        scheduled["Planlagt"]
        confirmed["Bekræftet<br/>(din egen)"]
    end
    subgraph progress["I gang"]
        ongoing["Igangværende"]
        verifying["Kontrolleres<br/>(din egen)"]
    end
    subgraph over["Overstået"]
        ended["Afsluttet"]
        completed["Fuldført"]
    end
    scheduled --> confirmed
    confirmed -->|"dens Begynder den"| ongoing
    ongoing --> verifying
    verifying -->|"dens Slutter den"| ended
    ended --> completed
```

Modellen `ScheduledMaintenanceState` har `name`, `description`, `color` og `order` samt fire flag: `isScheduledState`, `isOngoingState`, `isEndedState` og `isResolvedState`. OneUptime læser flagene og rækkefølgen, aldrig navnet, så du kan omdøbe **Fuldført** til "Godkendt", uden at noget går i stykker.

> [!TIP]
> Listen findes under **Planlagt vedligeholdelse → Indstillinger → Begivenhedsstatus**. **Indstillinger** starter foldet sammen i sidemenuen: fold den ud først.

## Standardtilstandene

Hvert nyt projekt starter med fire vedligeholdelsestilstande, i denne rækkefølge:

| Tilstand      | `order` | Flag               | Farve     | Hvad den betyder                                               |
| ------------- | ------- | ------------------ | --------- | -------------------------------------------------------------- |
| **Planlagt**  | `1`     | `isScheduledState` | `#000000` | Hver ny begivenhed starter her og venter på sit starttidspunkt. |
| **Igangværende** | `2`  | `isOngoingState`   | `#ffbf53` | Arbejdet er i gang, og begivenhedens monitorer kontrolleres ikke. |
| **Afsluttet** | `3`     | `isEndedState`     | `#4a4a4a` | Vinduet er ovre, og kontrollerne genoptages.                   |
| **Fuldført**  | `4`     | `isResolvedState`  | `#2ab57d` | Nogen har godkendt arbejdet, og påmindelserne til ejerne stopper. |

De fire markerede tilstande bærer mærket **Indbygget** på indstillingssiden. Du kan omdøbe dem, give dem en anden farve og trække i dem, men de beholder deres rækkefølge og kan ikke slettes: deres **Slet** forbliver låst og siger hvorfor.

**Afsluttet** og **Fuldført** er begge overstået. Forskellen er, hvem der flytter begivenheden: OneUptime flytter den til **Afsluttet** ved dens **Slutter den**, og en person, en chatknap eller API'et flytter den til **Fuldført**, når arbejdet er kontrolleret.

## Hvad der flytter en begivenhed

| Måde             | Hvor                                                                                        | Hvad den spørger om                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Uret**         | Et job, der kører hvert minut                                                               | Intet: ved **Begynder den** flytter det en ventende begivenhed til **Igangværende**, og ved **Slutter den** en igangværende til **Afsluttet**. |
| **Headeren**     | Begivenhedens **Oversigt**: knapperne **Markér som {{state}}** og **Skift tilstand til** i dens menu **⋯** | En kort dialog, **Markér planlagt vedligeholdelse som {{state}}**, med **Underret statussideabonnenter** og en valgfri note under **Tilføj en offentlig note**. |
| **Tidslinjen**   | **Tilstandstidslinje** i begivenhedens sidemenu                                             | En række, du tilføjer manuelt, med **Status for planlagt vedligeholdelse** og **Begynder den**.                 |
| **En række i listen** | Menuen **⋯** på en begivenheds række i listen over begivenheder: skridtene **Markér som {{state}}** og **Skift tilstand** | Headerens dialog, der nævner begivenheden. En begivenhed, som en anden ændring har flyttet imens, lades urørt, og dialogen siger hvorfor. |
| **Masseændring** | **Markér som {{state}}** eller **Skift tilstand** på et udvalg i listen over begivenheder                                  | Tilstanden og én offentlig note, der tilføjes til hver begivenhed. Begivenheder, der allerede er i tilstanden eller længere, springes over. |
| **Chat**         | Knapperne på begivenhedens beskeder i Slack og Microsoft Teams                              | Den samme ændring, udført som dig. Se [Slack](/docs/workspace-connections/slack#handl-på-hændelser-advarsler-og-begivenheder-fra-slack). |
| **API'et**       | En række oprettet på `/api/scheduled-maintenance-state-timeline`                            | Tilstanden, og om abonnenterne får besked.                                                                      |

Headerens knapper er opkaldt efter dine tilstande. Mens begivenheden venter, tilbyder den to: én, der starter den, opkaldt efter din igangværende tilstand, og én, der afslutter den, opkaldt efter din afsluttede tilstand. Mens begivenheden står på, kun den anden. Menuen **⋯** viser hver anden tilstand efter den nuværende. Den, hvis rolle ikke må ændre begivenhedens tilstand, ser knapperne låst og ingen menu med andre tilstande: peger man på en, nævner den de tilladelser, der ville give lov.

## Hvad start og afslutning gør

En begivenhed starter, når den går fra en tilstand, hvor den venter, til **Igangværende**, eller direkte til en af dine egne tilstande mellem **Igangværende** og **Afsluttet**. Så:

- **Dens monitorer holder op med at blive kontrolleret** og skifter til dens **Skift overvågningsstatus til**, hvis den har en. En monitor, du føjer til begivenheden, mens den står på, skifter også.
- **Dens statussider viser den som igangværende**, og dens abonnenter får besked: til tiden, hvis **Når begivenheden starter** er slået til, og manuelt, som **Underret statussideabonnenter** i dialogen siger.
- **Dens ejere får besked**, hvis de har slået notifikationen om tilstandsskift til, og begivenheden vises under **Igangværende hændelser**.

En begivenhed slutter, når den går fra en tilstand, hvor den står på, til **Afsluttet**, **Fuldført** eller en af dine egne tilstande efter **Afsluttet**. Så kontrolleres dens monitorer igen og vender tilbage til "operationel", medmindre en anden igangværende begivenhed stadig holder dem, og dens abonnenter får besked på samme måde: til tiden, hvis **Når begivenheden slutter** er slået til, og manuelt, som dialogen siger.

At gå videre fra **Igangværende** til "Kontrolleres" eller fra **Afsluttet** til **Fuldført** starter eller afslutter intet igen: begivenheden var allerede startet eller afsluttet.

## Uret i headeren

Før starten tæller headeren ned til den; mens begivenheden står på, tæller den, hvor længe den har varet; når den er overstået, siger den, hvor lang tid den tog. Når begivenheden overskrider en grænse med mere end to minutter, siger en ravgul besked det:

- **Start forsinket**: begivenheden venter stadig efter sit **Begynder den**.
- **Overskrider tiden**: begivenheden står stadig på efter sit **Slutter den**.

Beskeden nævner det planlagte tidspunkt og den tilstand, begivenheden endnu ikke har nået. Lige efter en grænse har jobbet, der flytter begivenheder, måske endnu ikke kørt, så de næste par minutter tjekker headeren selv igen og viser den nye tilstand uden genindlæsning.

## Rækkefølgen håndhæves

Hvert tilstandsskift kontrolleres mod listen, uanset hvem der foretager det: dashboardet, Slack, Microsoft Teams, API'et, Terraform, et workflow eller OneUptime selv.

- **Skridt tilbage afvises**, med en besked, der nævner begge tilstande: "Scheduled Maintenance cannot transition to Scheduled state from Ongoing state because Scheduled is before Ongoing in the order of scheduled maintenance states."
- **At skifte til den tilstand, den allerede er i, afvises**: "Scheduled Maintenance state cannot be same as previous state."
- **Vælgere tilbyder kun tilstandene efter den nuværende**, så ingen får tilbudt et skift, der ville blive afvist.

For at rette en tilstand, der er sat ved en fejl, sletter du dens række på begivenhedens side **Tilstandstidslinje**; begivenheden går tilbage til tilstanden i rækken før.

## Dine egne tilstande

En tilstand, du tilføjer, er et trin, dit team gennemgår, og som de fire standardtilstande ikke nævner: "Bekræftet", før arbejdet starter, "Kontrolleres" bagefter.

:::steps
### Åbn tilstandslisten

Gå til **Planlagt vedligeholdelse → Indstillinger → Begivenhedsstatus**. Kortet **Planlagt Vedligeholdelse Tilstande** viser dine tilstande i deres rækkefølge. Hver række viser sin farve og sit navn, hvad en begivenhed i den tæller som (kolonnen **Tæller som**) og sin beskrivelse.

### Opret tilstanden

Klik på **Opret Planlagt Vedligeholdelse Tilstand**, og udfyld dens **Navn**, **Beskrivelse** og **Farve**. Den nye tilstand tilføjes lige over den fuldførte tilstand.

### Træk den på plads

Træk en række i dens håndtag for at flytte den; den nye rækkefølge gemmes, når du slipper den. Kolonnen **Tæller som** følger den plads, du slipper den på.
:::

En tilstand, du tilføjer, har intet flag, så dens plads er det, den betyder:

| Hvor du placerer den                    | En begivenhed i den                                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Mellem **Planlagt** og **Igangværende** | Venter på sit **Begynder den**, som i **Planlagt**, og starter derfra til tiden.                                 |
| Mellem **Igangværende** og **Afsluttet** | Står på, som i **Igangværende**: dens monitorer forbliver ukontrollerede, og den slutter ved sit **Slutter den**. |
| Mellem **Afsluttet** og **Fuldført**    | Er overstået, men endnu ikke fuldført: påmindelser, der løber indtil fuldførelse, fortsætter.                   |
| Under **Fuldført**                      | Er fuldført, som i **Fuldført**.                                                                                 |

Hold dine tilstande under **Planlagt**: hver ny begivenhed starter der, og en begivenhed bevæger sig aldrig op ad listen igen, så en tilstand over den nås aldrig. Du flytter en begivenhed til en af dine egne tilstande fra menuen **⋯** i dens header, under **Skift tilstand til**.

> [!NOTE]
> På OneUptime Cloud kræver det abonnementet **Growth** eller højere at tilføje eller ændre vedligeholdelsestilstande. Alle abonnementer kan læse dem, bruge dem og slette en tilstand, du har tilføjet.

## Arkivér en status

Arkivér en status, du selv har oprettet, som dit team ikke længere skal bruge, i stedet for at slette den. Arkivering ændrer ingen begivenhed: En begivenhed i statussen bliver i den og fortsætter som normalt, og dens tidslinje over statusser viser den stadig.

- **Arkiver** findes i rækkens menu **⋯**. Den spørger først og viser de målinger og arbejdsgange, der er sat op til at bruge statussen.
- **Ingen kan vælge den igen.** Begivenhedens overskrift, **Skift tilstand**, Slack og Microsoft Teams udelader den, og API'et, Terraform og MCP afviser den. Du kan stadig filtrere begivenheder efter den.
- **Arkiverede statusser vises for sig**, i den sammenfoldede sektion **Arkiverede statusser for planlagt vedligeholdelse** under tabellen. **Fjern fra arkiv** sætter en tilbage, som den var.
- **De fire indbyggede statusser kan ikke arkiveres**: OneUptime flytter begivenheder ind i dem. Deres **Arkiver** er låst, med begrundelsen.

## Tilstandstidslinjen

Begivenhedens side **Tilstandstidslinje** er registreringen af hver tilstand, den har været i. Dens kort, **Statustidslinje**, tegner dem som en tidslinje: et bånd med hver tilstand så lang, som den varede, og nedenunder hvert skift, det nyeste først. **Tabel**, i kortets header, viser dem i stedet som rækker, med **Status for planlagt vedligeholdelse**, **Begynder den**, **Slutter den**, **Varighed**, om abonnenterne skulle have besked, og hvordan deres notifikation gik.

I dashboardet kan rækker tilføjes og slettes, men ikke redigeres, og en begivenhed beholder altid mindst én. Via API'et kan en rækkes `startsAt` rettes, og hver måling, der er beregnet ud fra tidslinjen, følger med. Sletter du den nyeste række, går begivenheden tilbage til tilstanden i rækken før.

> [!WARNING]
> At slette en række omskriver begivenhedens historik og hver måling, der er beregnet ud fra den. Brug det til at rette en fejl, ikke til at rydde op.

## Fejlfinding

:::details Headeren viser Start overdue
Begivenheden venter stadig mere end to minutter efter sit **Begynder den**, så jobbet, der starter begivenheder, har endnu ikke flyttet den. Start den selv med knappen i headeren: en manuel start gør alt, hvad jobbet gør, også for dens monitorer.
:::

:::details En begivenhed kan ikke flyttes tilbage til en tilstand, den har været i
Tilstande bevæger sig kun ned ad listen. Slet rækkerne efter den ønskede tilstand på begivenhedens side **Tilstandstidslinje**, den nyeste først.
:::

:::details Den fuldførte tilstand mangler blandt headerens knapper
Headerens knapper starter og afslutter begivenheden. At fuldføre den findes i menuen **⋯**, under **Skift tilstand til**.
:::

## Næste skridt

:::cards
- [Planlagt vedligeholdelse – Oversigt](/docs/scheduled-maintenance/index): Hvor alt findes, og hvad en begivenhed påvirker.
- [Opret vedligeholdelsesbegivenheder](/docs/scheduled-maintenance/creating-events): Formularen, felt for felt.
- [Vedligeholdelsesregler og indstillinger](/docs/scheduled-maintenance/settings): Påmind ejere, indtil en begivenhed er fuldført.
- [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities): Den samme ordnede liste, for hændelser.
:::
