# SLO:er för begäranden och latens

Ett SLO för begäranden mäter vad dina användare får av en tjänst: andelen av dess begäranden som lyckas, eller som besvaras tillräckligt snabbt. OneUptime räknar dem utifrån de spår som dina tjänster redan skickar, så det finns ingen monitor att ställa in: välj tjänsterna och ett mål, så mäter OneUptime dem var 5:e minut.

:::cards
- [Skapa ett SLO för begäranden](#skapa-ett-slo-för-begäranden): Tjänsterna, en latensgräns och ett mål.
- [Så räknas begäranden](#så-räknas-begäranden): Vilka spans som räknas, och när.
- [Releasekontroller](/docs/slo/release-checks): Rulla tillbaka en release som förbrukar felbudgeten.
:::

## Lyckade begäranden och latens för begäranden

| Vad det mäter | En begäran är dålig när | Dess felbudget räknar |
| --- | --- | --- |
| **Lyckade begäranden** | Statusen för dess span är `Error`. Ett span utan status räknas som bra, så som OpenTelemetry menar det. | Misslyckade begäranden |
| **Latens för begäranden** | Den tog längre tid än SLO:ets **Latensgräns (ms)**, oavsett status. | Långsamma begäranden |

SLI:n är andelen bra begäranden i efterlevnadsfönstret, och felbudgeten är de dåliga begäranden som målet tillåter: vid 99,9 % en av 1 000. Ett latens-SLO räknar en begäran som misslyckades snabbt som bra, så mät en viktig tjänst på båda sätten: ett SLO för att den fungerar och ett för att den är snabb.

## Så fungerar det

```mermaid title="Från spår till statusen för ett SLO för begäranden"
flowchart TB
    services["SLO:ets tjänster"] --> spans["Deras ingångsspans,<br/>från spår"]
    spans --> steps["Bra och totalt antal begäranden,<br/>räknade i steg om 5 minuter"]
    steps --> sli["SLI: andel bra begäranden<br/>i efterlevnadsfönstret"]
    sli --> budget["Återstående felbudget,<br/>i begäranden"]
    budget --> status["Status: Felfri, I riskzonen<br/>eller Budget förbrukad"]
    steps --> burn["Förbrukningstakt över<br/>varje regels fönster"]
    burn --> rules["Larm och incidenter<br/>till ditt jourteam"]
```

En begäran är ett ingångsspan för en av SLO:ets tjänster: det span där en begäran eller ett meddelande kommer in i tjänsten, så som listan [Spår](/docs/telemetry/traces-explorer#spår-och-spans) visar dem som standard. En begäran som passerar två av SLO:ets tjänster räknas en gång i var och en av dem.

Därifrån fungerar ett SLO för begäranden som alla andra. Dess status, regler för förbrukningstakt, felbudgetpolicy, ägare och aviseringar är desamma, men felbudgeten räknas i begäranden i stället för i minuter.

## Innan du börjar

- Tjänsterna skickar spår till OneUptime: se [OpenTelemetry](/docs/telemetry/open-telemetry). Var och en finns i [tjänstekatalogen](/docs/telemetry/services) under sitt `service.name`.
- En roll som får skapa SLO:er: Project Owner, Project Admin eller en anpassad roll med behörigheten Create Service Level Objective.

## Skapa ett SLO för begäranden

:::steps
### Öppna SLO:er

Öppna **SLOs** från menyn **Produkter** i det övre fältet och klicka på **Skapa Service Level Objective**.

### Välj vad SLO:et mäter

Under **Vad den mäter** väljer du **Lyckade begäranden** eller **Latens för begäranden**, och sedan under **Tjänster** de tjänster vars begäranden det ska räkna. För **Latens för begäranden** anger du också **Latensgräns (ms)**: en begäran som besvaras inom gränsen räknas som tillräckligt snabb, till exempel `300`. Klicka på **Nästa**.

### Ge det ett namn och ett mål

Ange ett **Namn**, till exempel ”Checkout requests”, och ett **Mål (%)**: den andel av begärandena som måste vara bra. Klicka på **Skapa Service Level Objective**.

### Se de första siffrorna komma in

Den första utvärderingen, inom 5 minuter, räknar begärandena från de senaste 6 timmarna, så SLO:et har siffror direkt. Utvärderingarna efter den räknar även äldre begäranden, tills hela efterlevnadsfönstret är täckt.
:::

För att senare ändra vad ett SLO mäter, dess tjänster eller dess gräns öppnar du dess **Inställningar** och klickar på **Redigera vad den mäter**.

## Så räknas begäranden

OneUptime räknar varje SLO:s bra begäranden och totala antal begäranden i steg om 5 minuter och sparar antalen, så att SLO:et läser sitt fönster ur sina egna antal i stället för ur varje span varje gång:

- Ett steg räknas 2 minuter efter att det har tagit slut, så att spans som kommer in sent kommer med, och nästa utvärdering räknar om de två senaste stegen för spans som kommer in ännu senare.
- Ett nytt SLO börjar med de senaste 6 timmarna. Varje utvärdering därefter räknar upp till ett dygns äldre begäranden, de nyaste först, tills fönstret är täckt.
- Bara begäranden som fortfarande ligger inom din [lagringstid för telemetri](/docs/telemetry/data-retention#hur-länge-telemetri-sparas) kan räknas. Räknade steg sparas i 400 dagar, längre än något efterlevnadsfönster, så ett fönster som är längre än lagringstiden fylls i takt med att SLO:et blir äldre.
- Att ändra vad SLO:et mäter, dess tjänster eller dess latensgräns gör att dess begäranden räknas om från början. Ett längre efterlevnadsfönster fylls genom att räkna längre bakåt.

Så länge antalen bara täcker en del av efterlevnadsfönstret säger **Översikt** det med indikatorn **Fönstret är 23 % fyllt**, och rutan **Felbudget kvar** upprepar det under sin siffra. Båda försvinner när antalen täcker hela fönstret.

## Felbudgeten i begäranden

Budgeten är de dåliga begäranden som målet tillåter bland de begäranden som har räknats i fönstret, så den växer med trafiken: vid 99,9 % tillåter ett fönster med 2 000 000 begäranden 2 000 misslyckade. I **Översikt**:

- **Felbudget kvar** visar hur många dåliga begäranden som återstår av hur många, eller hur många begäranden SLO:et ligger över budgeten.
- **Budgetens räckvidd** visar hur länge budgeten räcker med den aktuella förbrukningstakten, så länge trafiken förblir som den var.
- Sammanfattningen räknar SLO:ets tjänster, och ett latens-SLO visar sin gräns under sitt mål.

Larm för förbrukningstakt, aviseringar och flödet anger också budgeten i begäranden. Metriken `oneuptime.slo.error.budget.remaining.seconds` skickas inte för ett SLO för begäranden; visa `oneuptime.slo.error.budget.remaining.percent` i ett diagram i stället.

Ett SLO för begäranden får samma regler **Fast burn**, **Slow burn** och **Slow leak** som alla nya SLO:er. Under en lugn timme med en handfull begäranden kan ett enda fel ge en snabb förbrukning, så en regel kan bortse från fönster med för få begäranden: ange regelns `minimumSampleCount` via API:et, så hoppar regeln över ett långt fönster med färre begäranden än så.

## Felsökning

:::details SLO:et visar Waiting for requests
Ingen av dess tjänster har besvarat en begäran i fönstret ännu. Kontrollera att tjänsterna skickar spår till OneUptime och att deras spans innehåller ingångsspans: en tjänst vars spans alla är interna har inga begäranden att räkna.
:::

:::details SLI:n ändrades efter att jag ändrade tjänsterna
Att ändra vad SLO:et mäter, dess tjänster eller dess latensgräns gör att dess begäranden räknas om, med början i de senaste 6 timmarna, så SLI:n och budgeten börjar om därifrån. Indikatorn **Fönstret är 23 % fyllt** visar hur stor del av fönstret som har räknats hittills.
:::

## Nästa steg

:::cards
- [Releasekontroller](/docs/slo/release-checks): Låt Argo Rollouts, Flagger eller en pipeline rulla tillbaka en release som förbrukar budgeten.
- [Larm och incidenter för förbrukningstakt](/docs/slo/burn-rate-alerts): Larma ditt team när budgeten förbrukas för snabbt.
- [Felbudgetpolicy](/docs/slo/error-budget-policy): Kom överens om vad teamet gör medan budgeten tar slut.
:::
