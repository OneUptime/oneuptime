# Advarselstilstande og alvorsgrader

Hver advarsel har en **tilstand**, hvor dit team er med den, og en **alvorsgrad**, hvor meget den betyder. Tilstande styrer, hvad OneUptime gør: hvem der stadig tilkaldes, hvad der tæller som aktivt, hvornår en episode løses. Alvorsgrader rangerer advarsler, og regler kan matche på dem. Denne side er for alle, der sætter dem op, eller som undrer sig over, hvorfor en advarsel tilkaldte eller ikke tilkaldte.

:::cards
- [De forudoprettede tilstande](#de-forudoprettede-tilstande): Identified, Bekræftet og Løst, og hvad hver af dem gør.
- [Tilføj dine egne tilstande](#tilføj-dine-egne-tilstande): Et trin, der er dit eget, som "Under undersøgelse".
- [Flyt en advarsel gennem dens tilstande](#flyt-en-advarsel-gennem-dens-tilstande): Alle måder, en tilstand skifter på.
- [Alvorsgrader](#de-forudoprettede-alvorsgrader): High og Low, og tilføj dine egne.
:::

## Sådan fungerer det

Et projekts advarselstilstande er én ordnet liste, og advarsler bevæger sig kun nedad i den. Hvor en tilstand står, afgør, hvad en advarsel i den tæller som: endnu ikke bekræftet, bekræftet eller løst. Advarselsepisoder går gennem den samme liste.

```mermaid title="Advarsler går kun nedad i listen; hvor en tilstand står, afgør hvad den tæller som"
flowchart TB
    subgraph open["Tæller som<br/>ikke bekræftet"]
        identified["Identified"]
    end
    subgraph working["Tæller som<br/>bekræftet"]
        acknowledged["Bekræftet"]
        investigating["Under undersøgelse<br/>(egen)"]
    end
    subgraph done["Tæller som<br/>løst"]
        resolved["Løst"]
        closed["Lukket<br/>(egen)"]
    end
    identified --> acknowledged
    acknowledged --> investigating
    investigating --> resolved
    resolved --> closed
    identified -. "spring over" .-> resolved
```

Modellen `AlertState` har `name`, `description`, `color` og `order` plus tre flag: `isCreatedState`, `isAcknowledgedState` og `isResolvedState`. OneUptime læser flagene og rækkefølgen, aldrig navnet, så du kan omdøbe **Løst** til "Lukket", uden at noget går i stykker. Modellen `AlertSeverity` har `name`, `description`, `color` og `order` og ingen flag.

> [!TIP]
> Begge lister ligger under **Advarsler → Indstillinger**, som er foldet sammen i sidemenuen fra start: Fold **Indstillinger** ud for at finde **Advarselsstatus** og **Advarselsalvor**.

## De forudoprettede tilstande

Hvert nyt projekt starter med tre advarselstilstande i denne rækkefølge:

| Tilstand         | `order` | Flag                  | Farve     | Hvad den betyder                                  |
| ---------------- | ------- | --------------------- | --------- | ------------------------------------------------- |
| **Identified**   | `1`     | `isCreatedState`      | `#fd625e` | Den tilstand, nye advarsler starter i.            |
| **Bekræftet**    | `2`     | `isAcknowledgedState` | `#ffbf53` | Nogen tager sig af den, og tilkaldelsen stopper.  |
| **Løst**         | `3`     | `isResolvedState`     | `#2ab57d` | Advarslen er overstået og tæller ikke længere som aktiv. |

De tre tilstande med flag har mærket **Indbygget** på indstillingssiden. Du kan omdøbe dem, give dem nye farver og trække dem, men de beholder deres rækkefølge, oprettet før bekræftet før løst, og de kan ikke slettes: Deres **Slet** forbliver låst og siger hvorfor.

## Hvad hvert flag gør

| Flag                  | Hvad OneUptime gør med det                                                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isCreatedState`      | Nye advarsler starter her, når ingen vælger en anden tilstand: hver advarsel, en monitor udløser, og hver advarsel, der oprettes med **Indledende tilstand** tom.                 |
| `isAcknowledgedState` | **Bekræft** flytter en advarsel hertil. I denne tilstand eller enhver tilstand efter den tæller advarslen som bekræftet: Dens vagtpolitikker stopper med at tilkalde, og **Bekræft** tilbydes ikke længere. |
| `isResolvedState`     | **Løs** flytter en advarsel hertil. I denne tilstand eller enhver tilstand efter den tæller advarslen som løst: Den forlader **Aktive advarsler**, dens påmindelser stopper, og dens episode kan blive løst. |

## Tilføj dine egne tilstande

En tilstand, du tilføjer, er et trin, dit team går igennem, som de tre forudoprettede ikke navngiver: "Under undersøgelse", "Afbødet", "Lukket".

:::steps
### Åbn listen over tilstande

Gå til **Advarsler → Indstillinger → Advarselsstatus**. Kortet **Advarsel Tilstande** viser dine tilstande i deres rækkefølge. Hver række viser sin farve og sit navn, hvad en advarsel i den **Tæller som**, og sin beskrivelse.

### Opret tilstanden

Klik på **Opret Advarselsstatus**, og udfyld **Navn**, **Beskrivelse** og **Farve**. Farven er allerede valgt: en, som ingen anden tilstand bruger endnu. Den nye tilstand tilføjes lige over den løste tilstand, så den holder advarsler aktive.

### Træk den på plads

Træk en række i dens greb for at flytte den; den nye rækkefølge gemmes, når du slipper den. Kolonnen **Tæller som** følger med: Over den bekræftede tilstand er en advarsel **Ikke bekræftet**, fra den og nedad **Bekræftet**, og fra den løste tilstand og nedad **Løst**.
:::

En tilstand, du tilføjer, har intet flag, så dens plads er dens betydning. Sæt et afbødningstrin mellem **Bekræftet** og **Løst** og et triagetrin over **Bekræftet**. En tilstand under **Løst** tæller som løst overalt.

Du flytter en advarsel til en af dine egne tilstande fra menuen **⋯** i advarslens hoved, under **Skift tilstand til**, som viser hver tilstand efter den nuværende. Dens bekræftelse har titlen **Markér advarsel som {{state}}**, med tilstandens navn i.

> [!NOTE]
> På OneUptime Cloud kræver det planen **Growth** eller højere at tilføje eller ændre advarselstilstande og alvorsgrader. Alle planer kan læse dem, bruge dem og slette en tilstand, du har tilføjet.

## Rækkefølgen håndhæves

Hvert tilstandsskift for en advarsel kontrolleres mod listen, uanset hvem der foretager det: dashboardet, Slack, Microsoft Teams, API'et, Terraform, et workflow eller OneUptime selv.

- **Skift baglæns afvises** med en besked, der nævner begge tilstande: "Alert cannot transition to Acknowledged state from Resolved state because Acknowledged is before Resolved in the order of alert states."
- **Et skift til den tilstand, den allerede er i, afvises**: "Alert state cannot be same as previous state."
- **Vælgere tilbyder kun tilstandene efter den nuværende**, så ingen bliver tilbudt et skift, der ville blive afvist.

Advarselsepisoder holdes til den samme liste med deres egne beskeder ("Episode cannot transition to …"). Det eneste skift tilbage op ad listen er OneUptimes eget: en grupperingsregel, der genåbner en nyligt løst episode. For at rette en tilstand, der er sat ved en fejl, sletter du dens række på advarslens side **Tilstandstidslinje**; advarslen går tilbage til tilstanden i sin seneste tilbageværende række.

## De forudoprettede alvorsgrader

Hvert nyt projekt starter med to advarselsalvorsgrader, den mest alvorlige først:

| Alvorsgrad | `order` | Farve     | Forudoprettet beskrivelse                                                         |
| ---------- | ------- | --------- | --------------------------------------------------------------------------------- |
| **High**   | `1`     | `#b70400` | Issues causing very high impact to customers. Immediate attention is required.    |
| **Low**    | `2`     | `#ffbf53` | Issues causing low impact to customers.                                           |

Hændelser starter med tre alvorsgrader og advarsler med to. Når skabelonen i en monitoranbefaling siger **Kritisk** eller **Warning**, oversætter OneUptime det til din første og anden advarselsalvorsgrad, som i et nyt projekt er **High** og **Low**.

## Rediger alvorsgrader

Gå til **Advarsler → Indstillinger → Advarselsalvor**. Kortet **Advarsel Alvorligheder** viser dem med den mest alvorlige først; træk en række for at ændre dens rang. **Opret Advarselsalvor** tilføjer en sidst i listen, som den mindst alvorlige, med de samme **Navn**, **Beskrivelse** og **Farve** som en tilstand.

Rangen afgør, hvilken alvorsgrad der vinder, hvor OneUptime sammenligner dem: En episodes alvorsgrad stiger til den mest alvorlige advarsel, der slutter sig til den. Alvorsgrader har ingen flag og ingen slettelås: Enhver alvorsgrad kan slettes, også de to forudoprettede.

En alvorsgrad tilkalder ingen af sig selv. For at tilkalde efter alvorsgrad tilføjer du en vagtregel, hvis **Advarsel Alvorligheder** matcher den: se [Advarselsregler og indstillinger](/docs/alerts/settings). Ændrer du en advarsels alvorsgrad, skrives en post i dens feed, og dens påmindelsesregel matches igen.

## Arkivér en status eller alvorsgrad

Arkivér en status eller alvorsgrad, som dit team ikke længere skal bruge, i stedet for at slette den. Arkivering ændrer ingen advarsel. Sletning af en status fjerner dens rækker fra hver advarsels historik, og en alvorsgrad kan ikke slettes, så længe advarsler har den.

- **Arkiver** findes i rækkens menu **⋯**. Den spørger først og viser de regler, målinger, monitorkriterier og arbejdsgange, der er sat op til at bruge værdien: De bliver ved med at bruge den, indtil du ændrer dem.
- **Ingen kan vælge den igen.** **Skift tilstand**, advarslens overskrift, Slack, Microsoft Teams, regler og monitorkriterier udelader den. API'et, Terraform og MCP afviser den og nævner værdien og hvor den kan fjernes fra arkivet.
- **Advarsler beholder den.** En advarsel, der har den, beholder den ved enhver senere redigering, dens tidslinje over statusser viser den stadig, og du kan stadig filtrere efter den.
- **Arkiverede værdier vises for sig**, i den sammenfoldede sektion **Arkiverede advarselsstatusser** eller **Arkiverede advarselsalvorsgrader** under tabellen, med hvem der arkiverede hver enkelt og hvornår. **Fjern fra arkiv** sætter en tilbage, som den var.
- **Nogle kan ikke arkiveres.** Den oprettede, den kvitterede og den løste status samt projektets sidste alvorsgrad, der ikke er arkiveret. Deres **Arkiver** er låst, med begrundelsen.

**Slet** fortæller først, hvad den ville gøre. Så længe advarsler eller episoder har værdien, afvises sletningen, og dialogen viser dem. Ellers viser den, hvad sletningen ville ændre, og tilbyder **Arkivér i stedet**.

## Flyt en advarsel gennem dens tilstande

| Måde                 | Hvor                                                                                      | Hvad den spørger om                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Knapper i hovedet** | Advarslens hoved: **Bekræft**, **Løs** og **Skift tilstand til** i dens menu **⋯**          | En kort bekræftelse, **Bekræft advarsel**, **Løs advarsel** eller **Markér advarsel som {{state}}**, med en valgfri note under **Tilføj en privat note**. |
| **State timeline**   | **Tilstandstidslinje** i advarslens sidemenu                                              | En række, du tilføjer i hånden, med **Advarselsstatus** og **Begynder den**.                                                          |
| **Masseskift**       | **Skift tilstand** på et udvalg i listen over advarsler                                   | Tilstanden og én privat note, der føjes til hver advarsel. Advarsler, der allerede er i eller efter tilstanden, springes over.        |
| **Automatisk**       | En monitor, en episode, en tilknyttet hændelse eller din egen kode                        | **Løs advarsel automatisk** i en monitors kriterier, en episodes tilstandsskift, hændelseskontakterne på [Tilknyttede advarsler](/docs/incidents/linked-alerts) eller en række oprettet på `/api/alert-state-timeline`. |

Hovedet tilbyder **Bekræft** og **Løs**, så længe advarslen endnu ikke er bekræftet, og kun **Løs**, når den er det. En løst advarsel viser ingen af dem. Den, hvis rolle ikke må ændre advarslens tilstand, ser knapperne låst og ingen menu med andre tilstande: peger man på en, nævner den de tilladelser, der ville give lov.

## Hvad bekræftelse gør

En advarsel er bekræftet fra det øjeblik, den flytter til din bekræftede tilstand eller til en tilstand efter den, også en løst. Derefter:

- **Vagten stopper med at tilkalde for den.** Dens vagtpolitikker tilkalder ikke det næste niveau.
- **Bekræft tilbydes ikke længere**, hverken i hovedet eller i Slack og Microsoft Teams, hvor en ny bekræftelse afvises med "Alert is already acknowledged." eller "Alert is already resolved." Den, der svarer på sin tilkaldelse derefter, får tilkaldelsen bekræftet, og advarslen bliver, hvor den er.
- **Tiden til bekræftelse fastsættes** fra det første sådanne skift: **Oversigt**s første felt og en måling, der slutter, når **Advarslen bliver bekræftet**.

## Hvad løsning gør

En advarsel er løst, når den flytter til din løste tilstand eller til en tilstand efter den. Derefter:

- **Den forlader Aktive advarsler** og sidemenuens optælling.
- **Dens påmindelser stopper**, uanset hvad dens påmindelsesregel siger.
- **Dens episode kan blive løst.** En episode løses af sig selv, når hver advarsel i den er løst. Se [Advarselsepisoder og grupperingsregler](/docs/alerts/episodes).
- **Dens monitor kan udløse en ny advarsel.** Et kriterium holder én åben advarsel ad gangen; når den er løst, åbner det næste match en ny.

At gå videre fra **Løst** til en tilstand efter den, for eksempel "Lukket", ændrer intet af dette: Advarslen var allerede løst.

## Tilstandstidslinjen

Advarslens side **Tilstandstidslinje** er en optegnelse over hver tilstand, den har været i. Dens kort, **Statustidslinje**, tegner dem som en tidslinje: et bånd med hver tilstand så lang, som den varede, og under det hvert skift med det nyeste først. **Tabel** i kortets overskrift viser dem i stedet som rækker, med **Advarselsstatus**, **Begynder den**, **Slutter den** og **Varighed**.

- **Vis årsag** viser den grundårsag, der blev registreret med det skift.
- **Vis logge** viser, hvad OneUptime registrerede, da advarslen skiftede, for eksempel den monitorkontrol, der forårsagede det.

Rækker kan tilføjes og slettes, men ikke redigeres, og en advarsel beholder altid mindst én. Sletter du den seneste række, sættes advarslen tilbage i tilstanden fra rækken før den.

> [!WARNING]
> At slette en række omskriver advarslens historik og hver måling, der er beregnet ud fra den. Brug det til at rette en fejl, ikke til at rydde op.

## Listen Aktive advarsler

**Advarsler → Aktive advarsler** rummer hver advarsel, hvis tilstand står over din løste tilstand, og intet andet afgør det: hverken alvorsgrad, alder eller om nogen har bekræftet den. Det røde mærke ved siden af i sidemenuen tæller de samme advarsler.

En af dine egne tilstande over **Løst** holder altså advarsler i listen, og en under den tager dem ud, som løsning gør. **Aktive episoder** fungerer på samme måde for episoder.

## Næste skridt

:::cards
- [Advarsler – Oversigt](/docs/alerts/index): Hvor advarsler kommer fra, og hvordan dit team arbejder med dem.
- [Advarselsepisoder og grupperingsregler](/docs/alerts/episodes): Hvordan en episodes tilstand flytter dens advarsler.
- [Advarselsregler og indstillinger](/docs/alerts/settings): Tilkald og påmind efter alvorsgrad.
- [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities): Den samme livscyklus for hændelser.
:::
