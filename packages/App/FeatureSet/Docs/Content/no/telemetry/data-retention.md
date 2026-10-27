# Dataoppbevaring

OneUptime oppbevarer loggene, sporene, målingene og profilene dine i et antall dager og sletter dem deretter: 15 dager, med mindre du endrer det. Denne siden viser hvordan det tallet beregnes, hvordan du endrer det for hele prosjektet, og hvordan du oppbevarer noe telemetri lenger eller kortere enn resten.

:::cards
- [Hvor lenge telemetri oppbevares](#hvor-lenge-telemetri-oppbevares): Rekkefølgen OneUptime leser innstillingene i.
- [Endre prosjektets oppbevaring](#endre-prosjektets-oppbevaring): Ett tall for all telemetrien din.
- [Oppbevar noe telemetri lenger eller kortere](#oppbevar-noe-telemetri-lenger-eller-kortere): Etter type, alvorlighetsgrad, status eller tjeneste.
- [Hva oppbevaring koster](#hva-oppbevaring-koster): Fakturering på OneUptime Cloud, disk ved selvhosting.
:::

## Hvor lenge telemetri oppbevares

Hver loggpost, hvert span, hvert målepunkt og hver profilprøve får oppbevaringen sin når den kommer inn. OneUptime beregner hvor mange dager den skal oppbevares, stempler datoen den utløper, og sletter den etter den datoen. Den mest spesifikke innstillingen vinner:

```mermaid title="Hvilken innstilling avgjør hvor lenge en post oppbevares"
flowchart TB
    arrive["En loggpost, et span<br/>eller et målepunkt<br/>kommer inn"] --> resource{"Satt på tjenesten<br/>eller ressursen?"}
    resource -->|"Nei"| byType{"Satt på prosjektet<br/>for denne typen?"}
    byType -->|"Nei"| projectDefault["Prosjektets standard:<br/>15 dager, med mindre<br/>den endres"]
    resource -->|"Ja"| stamped["Stemplet med utløp:<br/>ankomst pluss<br/>dagene"]
    byType -->|"Ja"| stamped
    projectDefault --> stamped
    stamped --> deleted["Slettet etter<br/>den datoen"]
```

I sin helhet leser OneUptime disse innstillingene i denne rekkefølgen, og den første som er satt, avgjør:

| Rekkefølge | Innstilling | Hvor den settes |
| --- | --- | --- |
| 1 | Dager for én loggalvorlighetsgrad eller span-status, for én tjeneste eller ressurs | **Oppbevaring etter telemetritype**, under **Flere innstillinger** på siden **Innstillinger** for den |
| 2 | Dager for én type telemetri, for én tjeneste eller ressurs | Det samme kortet |
| 3 | Dager for alt fra én tjeneste eller ressurs | **Oppbevaring av telemetridata**, under **Flere innstillinger** på den samme siden |
| 4 | Dager for én loggalvorlighetsgrad eller span-status, for prosjektet | **Oppbevaring etter telemetritype**, under **Flere innstillinger** på **Dataoppbevaring** |
| 5 | Dager for én type telemetri, for prosjektet | Det samme kortet |
| 6 | Dager for alt annet | **Standard oppbevaring (dager)**, på **Dataoppbevaring** |

- **Innstilling 1 til 5 er overstyringer av oppbevaringen.** De er en del av [Enterprise Edition](/docs/self-hosted/enterprise), og av Scale-abonnementet på OneUptime Cloud. Uten dem oppbevares hver post etter prosjektets standard.
- **En endring gjelder for ny telemetri.** En post beholder datoen den ble stemplet med: en kortere oppbevaring sletter den ikke tidligere, og en lengre oppbevarer den ikke lenger. Nye poster følger en endring innen omtrent fem minutter.
- **Unntak følger det de ble funnet i.** Et unntak oppbevares like lenge som spanet eller loggposten det kom fra. Session Replays har sin egen oppbevaring: se [Andre data med egen oppbevaring](#andre-data-med-egen-oppbevaring).

## Før du begynner

- **En rolle som endrer prosjektet.** Project Owner eller Project Admin endrer prosjektets oppbevaring. Oppbevaringen for en tjeneste eller ressurs krever rollen som endrer de andre innstillingene dens.
- **For overstyringer, Enterprise Edition eller Scale-abonnementet.** En selvhostet installasjon trenger en Enterprise-lisens, og et OneUptime Cloud-prosjekt Scale-abonnementet eller høyere. Prosjektets standard oppbevaring finnes i alle utgaver og abonnementer.

## Endre prosjektets oppbevaring

:::steps
### Åpne dataoppbevaring

Gå til **Prosjektinnstillinger → Telemetri og APM → Dataoppbevaring**. **Telemetri og APM** starter sammenslått i sidemenyen: klikk på den for å åpne den. Kortet **Oppbevaring av telemetridata** viser **Standard oppbevaring (dager)**.

### Angi antall dager

Klikk på **Edit Retention Settings**, skriv inn antall dager, minst 1, og klikk på **Lagre endringer**.
:::

Det nye tallet gjelder for hver post som kommer inn fra da av og ikke har en egen overstyring.

## Oppbevar noe telemetri lenger eller kortere

Overstyringer oppbevarer det du trenger lenger og resten kortere: feillogger i et kvartal, for eksempel, og debuglogger i noen få dager.

### For hele prosjektet

Under standarden, sammenfoldet under **Flere innstillinger**, setter kortet **Oppbevaring etter telemetritype** dager for hver type telemetri. Klikk på **Edit Overrides**, fyll ut feltene du trenger, og la resten stå tomme:

| Type | Felt |
| --- | --- |
| Logger | **Logs default (days)**, og ett felt for hver loggalvorlighetsgrad |
| Spor | **Traces default (days)**, og ett felt for hver span-status: Feil, OK og Ikke angitt |
| Målinger | **Metrics default (days)** |
| Profiler | **Profiles default (days)** |

Et felt som står tomt, faller tilbake på neste innstilling i rekkefølgen over, så en alvorlighetsgrad uten egne dager oppbevarer loggene sine etter standarden for logger.

### For én tjeneste eller ressurs

Åpne siden **Innstillinger** for tjenesten eller ressursen, og deretter **Flere innstillinger**. Kortet **Oppbevaring av telemetridata** der inneholder **Behold telemetridata i (dager)**, ett tall for alt den sender, og kortet **Oppbevaring etter telemetritype** har de samme feltene som prosjektets. La et felt stå tomt for å bruke prosjektets innstillinger.

Tjenester, verter, Kubernetes-klynger, Docker- og Podman-verter, Docker Swarm-, Proxmox- og Ceph-klynger, lagringssystemer, vCentere, databaser, serverløse funksjoner, skyressurser, RUM-applikasjoner og IoT-flåter har alle disse kortene. Se [Tjenestekatalogen](/docs/telemetry/services#endre-en-tjeneste) for siden **Innstillinger** for en tjeneste.

### Når abonnementet eller lisensen ikke lenger omfatter overstyringer

- **På en selvhostet installasjon** slutter overstyringer å gjelde når Enterprise-prøveperioden eller utsettelsesperioden slutter uten lisens. Ny telemetri oppbevares etter prosjektets standard, kortene blir skrivebeskyttet, og ingenting du har satt, slettes: aktiver en lisens, så gjelder de igjen. Se [Enterprise Edition](/docs/self-hosted/enterprise#når-en-lisens-utløper-eller-mangler).
- **På OneUptime Cloud** fortsetter en overstyring som en prøveperiode etterlot, å gjelde under Scale-abonnementet. Siden viser den under oppgraderingskortet, med en knapp **Fjern overstyring** som virker på alle abonnementer. Å sette en overstyring på nytt krever Scale-abonnementet.

## Andre data med egen oppbevaring

| Data | Oppbevares i | Hvor det endres |
| --- | --- | --- |
| Session Replays | 7 dager, med mindre det endres | Replay-policyen til RUM-applikasjonen: se [Administrere applikasjoner](/docs/rum/applications#oppbevaring-av-øktavspillinger). |
| Overvåkingslogger, én rad per sjekk | 1 dag, med mindre det endres | På en selvhostet installasjon, **Loggoppbevaring for overvåking (dager)** i Admin Dashboard |
| Overvåkingsmålinger, og målingene SLO-er registrerer | 30 dager, med mindre det endres | På en selvhostet installasjon, **Metrikkoppbevaring for overvåking (dager)** i Admin Dashboard |

## Hva oppbevaring koster

- **På OneUptime Cloud** faktureres telemetri per inntatt GB, og prisen per GB omfatter 15 dagers oppbevaring. Lengre oppbevaring koster forholdsmessig mer: 30 dager koster dobbelt så mye per GB som 15. Kortere oppbevaring koster forholdsmessig mindre, men oppbevaring under 7 dager faktureres som 7 dager. **Prosjektinnstillinger → Fakturering og fakturaer → Brukshistorikk** viser dag for dag hvor mye hver tjeneste sendte, og hvor lenge det oppbevares.
- **Ved selvhosting** ligger telemetrien i ClickHouse, og oppbevaringen ganger diskbruken. Se [Dimensjonering](/docs/installation/sizing#oppbevaring-og-hvordan-den-påvirker-lagringen).

Telemetri du ikke trenger, koster ingenting hvis den aldri lagres: [Drop-filtre og scrub-regler](/docs/telemetry/drop-filters-and-scrub-rules) forkaster den når den kommer inn.

## Feilsøking

:::details Jeg senket oppbevaringen, men gamle data er der fortsatt
En post beholder utløpsdatoen den ble stemplet med da den kom inn. Poster som ble lagret før endringen, slettes på sine egne datoer, og bare nye poster følger den nye oppbevaringen.
:::

:::details Overstyringskortene viser en oppfordring til å oppgradere
Overstyringer av oppbevaringen krever Enterprise Edition på en selvhostet installasjon, og Scale-abonnementet på OneUptime Cloud. Inntil da oppbevares alt etter prosjektets standard.
:::

:::details Diskplassen kommer tilbake en dag etter at data utløper
Utløpte poster slutter å vises i søk, grafer og lister så snart de utløper. På disken slettes logger og målinger ved første midnatt etter det, så plassen deres kommer tilbake opptil en dag senere.
:::

## Neste steg

:::cards
- [Inntaksnøkler](/docs/telemetry/ingestion-keys): Send telemetri til prosjektet ditt.
- [Drop-filtre og scrub-regler](/docs/telemetry/drop-filters-and-scrub-rules): Behold bare telemetrien du trenger.
- [Tjenestekatalog](/docs/telemetry/services): Sett en tjenestes egen oppbevaring.
- [Enterprise Edition](/docs/self-hosted/enterprise): Hva overstyringer av oppbevaringen følger med.
:::
