# Telemetriforbrug

Se, hvor meget telemetri hvert projekt, og hver tjeneste eller ressource i det, sender: protokoller, metrikker, spor, undtagelser, profiler, sessionsafspilninger og sikkerhedshændelser. Forbrug tælles på alle OneUptime-installationer, med eller uden fakturering, så du kan finde det, der fylder dit lager, uden at forespørge ClickHouse.

:::cards
- [Sådan tælles forbrug](#sådan-tælles-forbrug): Én gang om dagen, for hver ressource og hvert signal.
- [Se et projekts forbrug](#se-et-projekts-forbrug): Projektindstillinger → Telemetri og APM → Forbrug.
- [Følg forbruget, efterhånden som det ankommer](#følg-forbruget-efterhånden-som-det-ankommer): Hvert 5. minut, som en metrik.
- [Se alle projekters forbrug](#se-alle-projekters-forbrug): Admin Dashboard, for instansadministratoren.
- [Hvor længe forbrug opbevares](#hvor-længe-forbrug-opbevares): 120 dage, medmindre du ændrer det.
:::

## Sådan tælles forbrug

Én gang om dagen, efter at en dag er slut i UTC, tæller OneUptime, hvad hver ressource i hvert projekt sendte den dag, for hvert signal, og gemmer optællingen som én række pr. ressource, signal og dag.

```mermaid title="Fra telemetri til forbrugssiderne"
flowchart TB
    telemetry["Telemetri ankommer<br/>og gemmes"] --> count["UTC-dagen slutter:<br/>den tælles"]
    count --> rows["Én række pr. ressource,<br/>signal og dag"]
    rows --> project["Projektindstillinger:<br/>Forbrug"]
    rows --> admin["Admin Dashboard:<br/>Telemetriforbrug"]
    rows --> cleanup["Slettes efter<br/>120 dage"]
```

- **En dag tælles, når den er slut.** Hver dag tælles senest omkring kl. 08:00 UTC dagen efter, så dagens forbrug vises i morgen. En dag, der ikke kunne tælles, forsøges igen i en uge.
- **Størrelsen er den lagrede størrelse.** Hvert signal tælles som størrelsen af de rækker, det gemmes i, før komprimering. Sessionsafspilninger tælles som de bytes, optagerne uploadede.
- **Undtagelser vises for sig.** De undtagelser, der registreres på spans og i protokoller, har deres egen total, kolonne og del af diagrammet, **Spor** tæller spans, og **Protokoller** tæller protokolposter. De har ikke deres egen række: hver række for spor eller protokoller angiver, hvor meget af den der var undtagelser. En dag, der blev talt, før undtagelser blev vist for sig, har dem stadig med i **Spor**, som før.
- **Profiler omfatter deres samples.**
- **OneUptimes egen telemetri tælles ikke.** Målinger fra monitorer, advarsler, hændelser og SLO'er, målinger fra Dataobservabilitet og budgetmetrikkerne for sessionsafspilninger skrives af OneUptime selv.
- **På OneUptime Cloud er det disse rækker, telemetri faktureres ud fra.** På en installation uden fakturering tælles forbrug uden omkostninger, og der opkræves intet for det, heller ikke hvis fakturering slås til senere.
- **Undtagelser faktureres med det, de blev fundet i.** På OneUptime Cloud faktureres en undtagelse, der findes i et span, med **Spor**, og en, der findes i en protokolpost, med **Protokoller**. Protokoller og spor koster det samme pr. GB, så hver undtagelse faktureres én gang, til samme pris, og et projekt, der kun sender protokoller, faktureres aldrig for spor. En dag, der blev talt, før undtagelser fundet i protokoller flyttede til **Protokoller**, har dem stadig i **Spor**.
- **Et budget tælles adskilt fra forbruget.** Et [indtagelsesbudget](/docs/telemetry/ingestion-budgets) tæller telemetri, efterhånden som den ankommer, dekomprimeret, så det kan stoppe en dags telemetri samme dag. Mens et er angivet, åbner denne side med dagens budgetter. Undtagelser har ikke deres eget budget: de tælles med i budgettet for de spor eller protokoller, de ankommer i.

## Før du begynder

- **En rolle, der læser projektets telemetri.** Projektejer, Projektadministrator, Projektmedlem, Seer, Telemetriadministrator, Telemetrimedlem eller Telemetriseer, eller en af faktureringsrollerne. Rollen skal omfatte hele projektet: en rolle, der er begrænset til nogle etiketter, viser ikke forbrug.
- **Telemetri i projektet.** Forbrug tælles for den telemetri, projektets [indtagelsesnøgler](/docs/telemetry/ingestion-keys) sender.

## Se et projekts forbrug

:::steps
### Åbn Forbrug

Gå til **Projektindstillinger → Telemetri og APM → Forbrug**. **Telemetri og APM** starter sammenklappet i sidemenuen: klik på den for at åbne den.

### Vælg en periode

Siden åbner på **Seneste 30 dage**. Vælg **Seneste 7 dage** eller **Seneste 90 dage** i feltet øverst til højre på kortet **Telemetriforbrug**. En periode slutter med i går, den nyeste dag, der er talt.

### Find det, der er vokset

Kortet **Forbrug pr. ressource** viser hver tjeneste og ressource, der har sendt noget i perioden, de største først. Klik på en kolonnes titel for at sortere efter den, og på en ressources navn for at åbne dens side.
:::

Siden har tre kort:

| Kort | Hvad det viser |
| --- | --- |
| **Telemetriforbrug** | Periodens **Total**, en total for hvert signal og et diagram over hver dag med signalerne stablet. |
| **Forbrug pr. ressource** | Hver **Ressource** med dens type, en kolonne for hvert signal, **Total** og **Opbevaring** for dens telemetri. |
| **Telemetri-forbrugshistorik** | Én række pr. produkt, ressource og dag, med filtre for **Produkt**, **Dag** og **Tjeneste**. En række for **Spor** rummer spans og de undtagelser, der findes i dem, og en række for **Protokoller** protokolposter og de undtagelser, der findes i dem, sådan som de faktureres. Hver angiver under **Indtaget data (i GB)**, hvor meget af den der var undtagelser. |

Telemetri, der ikke angav en tjeneste, vises som **Ukendt tjeneste**. En ressource, der er slettet siden, eller hvis type din rolle ikke læser, vises med sin type og begyndelsen af sit ID.

## Hvem ser hvad

| Rolle | Ser |
| --- | --- |
| Projektejer, Projektadministrator, Faktureringsadministrator, Faktureringsmedlem, Faktureringsseer, Manage Billing | Hvor meget hver ressource sendte, og hvor længe det opbevares, og på OneUptime Cloud hvad det kostede |
| Projektmedlem, Seer, Telemetriadministrator, Telemetrimedlem, Telemetriseer | Hvor meget hver ressource sendte, og hvor længe det opbevares |

Hvad forbruget kostede, vises kun på OneUptime Cloud: en installation uden fakturering opkræver intet for det. Se [Fakturering og forbrug](/docs/configuration/billing#brugshistorik) for priserne.

## Følg forbruget, efterhånden som det ankommer

Forbrugsrækkerne kommer dagen efter. For at se i et diagram inden for minutter, hvad hver tjeneste sender, og få en advarsel, når den sender mere, kan en Projektejer eller Projektadministrator udgive projektets forbrug som en metrik:

:::steps
### Slå det til

Gå til **Projektindstillinger → Telemetri og APM → Forbrug**, åbn **Yderligere indstillinger** nederst på siden, og slå **Udgiv forbrug som metrikker** til på kortet **Forbrug som metrikker**. Det gemmes, så snart du slår det til.

### Vis det i et diagram

Hvert 5. minut skriver OneUptime det, hver tjeneste og ressource har sendt af hvert signal i de 5 minutter, som metrikken `oneuptime.telemetry.usage.bytes`, i bytes (`By`). Vis summen i [Metrikudforsker](/docs/telemetry/metrics-explorer), eller få advarsler om den med en [metrik-monitor](/docs/monitor/metrics-monitor).
:::

Hvert punkt har disse attributter:

| Attribut | Værdi |
| --- | --- |
| `projectId` | Projektets ID. |
| `signal` | `logs`, `traces`, `metrics` eller `profiles`. |
| `resourceType` | Ressourcens type: `OpenTelemetry` for en tjeneste, `Host` for en vært og så videre. |
| `resourceId` | Tjenestens eller ressourcens ID. |
| `resourceName` | Dens navn, da punktet blev skrevet. |

- **Talt, efterhånden som det ankommer.** Hvert punkt er ressourcens andel af det, der ankom, dekomprimeret, som indtagelsesbudgetter tæller det, så det kan vise mere end forbrugsrækkerne, som tæller det, der blev gemt.
- **Sendt over OpenTelemetry.** De protokoller, spor, metrikker og profiler, der sendes over OTLP, tælles. Sikkerhedshændelser, sessionsafspilninger og protokollerne fra Fluent Bit, Fluentd eller syslog gør ikke.
- **Hvert punkt tilhører sin ressource.** Den, der må læse en tjenestes eller en ressources telemetri, læser dens punkter: en rolle, der er begrænset til nogle mærkater, ser kun deres.
- **De koster intet.** Disse punkter tælles ikke mod noget budget eller som forbrug, og de opbevares lige så længe som monitormetrikker: 30 dage, medmindre instansadministratoren ændrer det. Metriknavne, der starter med `oneuptime.telemetry.usage.`, er reserveret til dem: metrikker, som dine applikationer sender under sådan et navn, kasseres.
- **Slået fra som standard.** Mens det er slået fra, skrives der intet, og de punkter, der allerede er skrevet, beholdes, til de udløber.

## Se alle projekters forbrug

På en selvhostet installation ser instansadministratoren alle projekters forbrug i Admin Dashboard:

:::steps
### Åbn Telemetriforbrug

Åbn menuen i Admin Dashboard, og klik på **Telemetriforbrug**. Listen viser hvert projekt, der har sendt noget i perioden, de største først, med en kolonne for hvert signal og **Total**.

### Find de største projekter

Vælg en periode øverst til højre på kortet, og klik på en kolonnes titel for at sortere efter den: **Total**, et signal eller **Projekt** for navnet.

### Åbn et projekt

Klik på et projekts navn. Dets side **Telemetriforbrug** under **Projekter** i Admin Dashboard viser dets forbrug pr. dag, signal og ressource, som dets medlemmer ser det.
:::

## Hvor længe forbrug opbevares

Forbrug opbevares i 120 dage, medmindre du ændrer det, med fakturering slået til eller fra. Det er, hvor længe forbrugsoptællingerne opbevares, ikke selve telemetrien: se [Dataopbevaring](/docs/telemetry/data-retention) for den.

:::steps
### Åbn Dataopbevaring

Gå til **Indstillinger → Server → Dataopbevaring** i Admin Dashboard.

### Angiv antallet af dage

Klik på **Rediger opbevaring af telemetriforbrug** på kortet **Opbevaring af telemetriforbrug**, indtast **Opbevaring af telemetriforbrug (dage)** fra 30 til 1095, og klik på **Gem ændringer**. Lad feltet stå tomt for 120 dage.
:::

Forbrug, der er ældre end det, slettes én gang om dagen. Opbevaringen er aldrig kortere end 30 dage: en dag, der er talt, slettes aldrig for så at blive talt igen.

## Læs forbruget med API'et

`GET /api/telemetry-usage/project` svarer med ét projekts forbrug over en periode af UTC-dage, som siden viser det. Kald det med en [API-nøgle](/docs/permissions/index#api-nøgler), der har en af rollerne ovenfor:

```bash
curl 'https://oneuptime.com/api/telemetry-usage/project?startDay=2026-10-01&endDay=2026-10-31' \
  -H "ApiKey: $ONEUPTIME_API_KEY"
```

`startDay` og `endDay` er dage skrevet `YYYY-MM-DD`, begge medregnet, og en periode kan være op til 1095 dage lang. Svaret indeholder totalerne, hver dag pr. signal og hver ressource pr. signal, i GB, med omkostningen kun der, hvor fakturering er slået til, og nøglen kan læse fakturering. Undtagelser ligger under `Exceptions`, adskilt fra `Traces` og `Logs`, og en dag, der blev talt, før undtagelser blev vist for sig, har dem med i `Traces`.

## Fejlfinding

:::details Siden Forbrug viser Intet telemetriforbrug endnu
En dag tælles, når den er slut i UTC, senest omkring kl. 08:00 UTC dagen efter: et projekt, der begyndte at sende i dag, viser sin første dag i morgen. Kontrollér, at projektet modtager telemetri i explorerne.
:::

:::details Tallene er større end min ClickHouse-disk
Forbrug er størrelsen af rækkerne før komprimering. ClickHouse komprimerer det, den gemmer, så den disk, den bruger, er flere gange mindre.
:::

:::details En ressource vises med sin type og et ID
Ressourcen er slettet, siden den sendte telemetrien, eller din rolle læser ikke den type ressource. Dens forbrug tælles stadig.
:::

:::details Spor faldt den dag, Undtagelser dukkede op
Undtagelser blev tidligere talt med i **Spor**. Fra den første dag, der blev talt med undtagelser for sig, tæller **Spor** spans, og **Undtagelser** tæller undtagelserne. Tilsammen er de det, **Spor** var, og det, spor faktureres for.
:::

:::details Protokoller koster mere og Spor mindre fra en bestemt dag
Undtagelser fundet i protokolposter blev tidligere faktureret med **Spor**. Fra den første dag, der blev talt efter ændringen, faktureres de med **Protokoller**, det produkt, der fandt dem. Protokoller og spor koster det samme pr. GB, så tilsammen koster de to det samme som før.
:::

## Næste skridt

:::cards
- [Drop-filtre og scrub-regler](/docs/telemetry/drop-filters-and-scrub-rules): Hold op med at gemme den telemetri, du ikke har brug for.
- [Dataopbevaring](/docs/telemetry/data-retention): Opbevar telemetri så længe som nødvendigt, og ikke længere.
- [Fakturering og forbrug](/docs/configuration/billing): Hvad telemetri koster på OneUptime Cloud.
- [Indtagelsesnøgler](/docs/telemetry/ingestion-keys): Send telemetri til dit projekt.
- [Indtagelsesbudgetter](/docs/telemetry/ingestion-budgets): Begræns, hvor meget af hvert signal et projekt sender på en dag.
:::
