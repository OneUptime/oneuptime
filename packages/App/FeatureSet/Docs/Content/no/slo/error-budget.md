# Feilbudsjetter

Feilbudsjettet er nedetiden målet til et SLO tillater. Et mål på 99,9 % betyr ikke «gå aldri ned»: det betyr «du kan være nede i opptil 43 minutter på 30 dager, så bruk dem klokt». Denne siden forklarer hvordan OneUptime teller budsjettet, hvor lenge det varer, hvordan det kommer tilbake, og hvem som får høre om det.

:::cards
- [Hvordan budsjettet beregnes](#hvordan-budsjettet-beregnes): Formelen og budsjettet for vanlige mål.
- [Rekkevidden til budsjettet](#rekkevidden-til-budsjettet): Hvor lenge budsjettet varer i dagens tempo.
- [Hvordan budsjettet kommer tilbake](#hvordan-budsjettet-kommer-tilbake): Rullerende vinduer og kalendermåneder.
- [Beskjed til eiere](#beskjed-til-eiere): Hvem som får høre om det når budsjettet blir knapt.
:::

## Hvordan budsjettet beregnes

Det samlede budsjettet er den delen av vinduet som målet ditt ikke lover:

```text
total budget = (100% − target) × window length
```

| Mål | Vindu på 7 dager | Vindu på 28 dager | Vindu på 30 dager | Vindu på 90 dager |
| --- | --- | --- | --- | --- |
| 99 % | 1 t, 40 min, 48 sek | 6 t, 43 min, 12 sek | 7 t, 12 min | 21 t, 36 min |
| 99,5 % | 50 min, 24 sek | 3 t, 21 min, 36 sek | 3 t, 36 min | 10 t, 48 min |
| 99,9 % | 10 min, 5 sek | 40 min, 19 sek | 43 min, 12 sek | 2 t, 9 min, 36 sek |
| 99,95 % | 5 min, 2 sek | 20 min, 10 sek | 21 min, 36 sek | 1 t, 4 min, 48 sek |
| 99,99 % | 1 min, 0 sek | 4 min, 2 sek | 4 min, 19 sek | 12 min, 58 sek |

Siden **Innstillinger** til SLO-et viser budsjettet målet tillater ved siden av målet, for eksempel «43 min, 12 sek nedetid per vindu på 30 dager».

### Budsjettet til et SLO med flere monitorer

I modusen **En hvilken som helst monitor nede** er budsjettet `(100% − target) × window`, uansett hvor mange monitorer SLO-et måler: vinduet er én tidslinje.

I modusen **Gjennomsnitt av monitorsekunder** telles budsjettet i monitorsekunder, summert på tvers av monitorene, så det vokser med antallet monitorer: et SLO med tre monitorer på 99,9 % over 30 dager har rundt 129 minutter budsjett i stedet for 43. Prosentene (SLI, gjenværende budsjett, forbruksrate) betyr det samme; bare varighetene endrer seg.

### Budsjettet for en kalendermåned

Et SLO med kalendermåned har hele månedens budsjett fra første dag: et SLO på 99,9 % i en måned med 31 dager har alle sine 44 min, 38 sek den 1. Budsjettet beregnes ikke forholdsmessig etter hvor mye av måneden som har gått, så et brudd på ett minutt om morgenen den 1. bruker ett minutt av månedens budsjett.

## Gjenværende budsjett

Etter hvert som nedetiden øker, viser **Oversikt** det gjenværende budsjettet i flisen **Feilbudsjett igjen**:

- som en prosentandel av totalen, som også bestemmer statusen til SLO-et og fyller stolpen. Stolpen har et merke ved risikoterskelen til SLO-et;
- som en varighet, for eksempel "31 min, 4 sek igjen av 43 min, 12 sek".

Når budsjettet er brukt opp, viser flisen **Ikke noe budsjett igjen**. Når nedetiden overskrider det, viser flisen **Budsjettet er overskredet** og overskridelsen som tid, for eksempel "4 d, 23 min over budsjett · 5 min, 47 sek tillatt": SLO-et har brukt alle 5 minutter og 47 sekunder av budsjettet sitt, og 4 dager og 23 minutter til. Stolpen blir stående tom og rød.

Gjenværende budsjett lagres som et tall med fortegn for beregninger og historikkdiagrammer, så der vises et overskredet budsjett som en negativ prosentandel. En svært negativ prosentandel betyr at overskridelsen er stor sammenlignet med budsjettet; det er ikke andelen av tiden tjenesten var nede.

Hvilke sekunder som teller som nedetid, bestemmes av nedetidsstatusene til SLO-et og, for et SLO med flere monitorer, av modusen for flere monitorer, begge under **Innstillinger** → **Beregning av nedetid**. Se [SLO-er – Oversikt](/docs/slo/introduction).

## Rekkevidden til budsjettet

Flisen **Budsjettets rekkevidde** i **Oversikt** svarer på «hvis dette fortsetter, når går vi tom?». Den deler gjenværende budsjett på forbruksraten de siste 60 minuttene:

```text
runway = budget left ÷ (burn rate × (100% − target))
```

| Flisen viser | Hva det betyr |
| --- | --- |
| En varighet, som **~2 d, 5 t** | I dagens tempo går budsjettet tomt om omtrent så lang tid. Gul, og rød ved én dag eller mindre. **Under 1 min** betyr mindre enn ett minutt. |
| **Ikke noe forbruk** | Det er ikke brukt noe budsjett de siste 60 minuttene. |
| **Bærekraftig** | Bare rullerende vinduer: rekkevidden er minst ett helt vindu, så budsjettet brukes ikke raskere enn gammel nedetid faller ut av vinduet. I dette tempoet går det ikke tomt. |
| **Rekker til tilbakestilling** | Bare kalendermåneder: budsjettet nullstilles ved starten av neste måned før det går tomt. |
| **Overskredet** | Budsjettet er allerede brukt opp. Flisen sier hvor mye det er overskredet med. |

For SLO-er med kalendermåned sier flisen også når budsjettet nullstilles.

Rekkevidden er en lineær framskrivning. I et rullerende vindu gir gammel nedetid som faller ut av vinduet, budsjett tilbake, noe framskrivningen ser bort fra: les den som den minste tiden du har igjen. Den vises ikke før den første evalueringen, og heller ikke for SLO-er i modusen **Gjennomsnitt av monitorsekunder**, der budsjettet telles i monitorsekunder og ikke i klokketid.

## Forbruket av feilbudsjettet

Diagrammet **Nedbrenning av feilbudsjett** i **Oversikt** viser gjenværende budsjett, i prosent, over det gjeldende samsvarsvinduet:

- En linje ved 0 % markerer hvor budsjettet er brukt opp, og en stiplet linje markerer risikoterskelen til SLO-et.
- Når SLO-et har en feilbudsjettpolicy, markerer en linje med etikett også terskelen for hvert nivå: se [Feilbudsjettpolicy](/docs/slo/error-budget-policy).
- For SLO-er med kalendermåned faller en svak linje jevnt fra et fullt budsjett ved starten av måneden til et tomt ved nullstillingen. Under den linjen bruker måneden budsjettet for fort.
- Et punkt registreres ved hver evaluering, hvert 5. minutt, så diagrammet til et nytt SLO er tomt til den første evalueringen.
- Dra over diagrammet for å zoome inn på en del av vinduet. Dobbeltklikk, eller klikk på **Tilbakestill zoom**, for å se hele vinduet igjen.

**Åpne målinger** åpner siden **Målinger** til SLO-et, der fanen **Feilbudsjettets historikk** går opptil 400 dager tilbake. Se [SLO-metrikker og -dashbord](/docs/slo/metrics).

## Hvordan budsjettet kommer tilbake

Hvordan budsjettet kommer tilbake, avhenger av vindustypen til SLO-et:

:::tabs
@tab Rolling
Et rullerende vindu ser alltid like langt tilbake fra nå, så nedetid faller etter hvert ut av det: et brudd slutter å telle nøyaktig ett vindu etter at det skjedde. Et brudd på 30 minutter 1. juni faller ut av regnestykket for et SLO på 30 dager 1. juli, og budsjettet kommer gradvis tilbake, etter hvert som hvert sekund med nedetid forlater vinduet, ikke alt på én gang.

Så gjenoppretting må fortjenes, den kan ikke planlegges. Fortsetter små brudd å komme, faller gammel nedetid ut mens ny kommer inn, og budsjettet står stille i stedet for å hente seg inn.
@tab Calendar Month
Et SLO med kalendermåned nullstilles ved midnatt den første i hver måned, i sin tidssone. Hele budsjettet kommer tilbake på én gang, og den forrige måneden lukkes. Ingenting overføres fra én måned til den neste, i noen retning: en dårlig måned skader ikke den neste, og en god måned gir den ikke ekstra slakk.
:::

### Unge SLO-er

Et SLO med rullerende vindu som er yngre enn vinduet sitt, måles over dataene som finnes så langt, og det samlede budsjettet vokser med dem: et SLO på 30 dager som ble opprettet for en uke siden, har foreløpig et budsjett for 7 dager. Til vinduet er fullt, viser **Oversikt** hvor fullt det er, med en indikator **Vinduet er 23 % fylt** og samme merknad i flisen **Feilbudsjett igjen**. Regn med at tallene roer seg etter hvert som vinduet fylles.

## Statusendringer og risikoterskelen

Gjenværende budsjett bestemmer statusen til SLO-et:

| Status | Når |
| --- | --- |
| **Feilfri** | Det er mer budsjett igjen enn risikoterskelen. |
| **I faresonen** | Gjenværende budsjett ligger på risikoterskelen eller under: 20 % som standard. |
| **Budsjett oppbrukt** | Gjenværende budsjett er null eller lavere. |

Angi risikoterskelen under **Innstillinger** → **Mål**.

Rullerende vinduer henter seg inn ett sekund om gangen, så et SLO nær en grense kunne hoppe fram og tilbake mellom to statuser. For at hver statusendring skal bety noe, forlater et SLO en status bare når det tydelig har passert grensen:

```mermaid title="Hvordan statusen følger gjenværende budsjett"
stateDiagram-v2
    state "Feilfri" as Healthy
    state "At Risk" as AtRisk
    state "Budget Exhausted" as Exhausted
    Healthy --> AtRisk: på eller under terskelen
    AtRisk --> Healthy: 5 poeng over terskelen
    AtRisk --> Exhausted: på eller under 0 %
    Healthy --> Exhausted: på eller under 0 %
    Exhausted --> AtRisk: 2 % budsjett tilbake
```

Med standardterskelen på 20 % blir et truet SLO feilfritt igjen ved 25 % gjenværende budsjett, og et SLO med oppbrukt budsjett blir truet igjen ved 2 %. Hver statusendring vises i **Feed** til SLO-et, med SLI-en, budsjettet og forbruksraten som forklarer den.

En status sier hvor mye budsjett som er igjen, ikke hva teamet ditt gjør med det. For å skrive det ned for hvert nivå av gjenværende budsjett, for eksempel ved risikoterskelen eller når budsjettet er brukt opp, gir du SLO-et en [feilbudsjettpolicy](/docs/slo/error-budget-policy).

## Beskjed til eiere

Når et SLO går over til **I faresonen** eller **Budsjett oppbrukt**, gir OneUptime eierne beskjed:

- Eierne er brukerne og teammedlemmene på siden **Eiere** til SLO-et som fortsatt er medlemmer av prosjektet. Et SLO uten eiere gir i stedet prosjekteierne beskjed.
- Hver eier får en e-post som standard, og beskjeden på alle andre kanaler vedkommende slår på for **SLO-status endret** under **Brukerinnstillinger** → **Varselinnstillinger** → **Overvåking**.
- Emnet i e-posten nevner statusen og SLO-et, for eksempel `[SLO At Risk] API Availability`.

For at et SLO nær en grense ikke skal varsle hele tiden, får eierne høyst én beskjed i timen. En overgang til **Budsjett oppbrukt** sendes alltid, også innenfor den timen.

> [!TIP]
> Beskjeder til eiere forteller de som har ansvaret for et SLO, at budsjettet er i trøbbel. For å tilkalle vaktteamet ditt via eskaleringspolicyer bruker du [Forbruksratevarsler og -hendelser](/docs/slo/burn-rate-alerts). En forbruksrateregel kan også legge til eierne av SLO-et på hvert varsel og hver hendelse den oppretter.

## Neste steg

:::cards
- [Forbruksratevarsler og -hendelser](/docs/slo/burn-rate-alerts): Varsle teamet ditt når budsjettet brennes for fort.
- [Feilbudsjettpolicy](/docs/slo/error-budget-policy): Skriv ned hva teamet gjør mens budsjettet tømmes.
- [SLO-metrikker og -dashbord](/docs/slo/metrics): Vis budsjettet over tid i et diagram.
- [SLO-er – Oversikt](/docs/slo/introduction): Mål, vinduer og nedetidsstatuser.
:::
