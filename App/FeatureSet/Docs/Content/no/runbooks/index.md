# Runbooks – Oversikt

Runbooks er gjenbrukbare responsprosedyrer — ordnede lister med manuelle eller automatiserte trinn — som du knytter til hendelser, varsler eller planlagt vedlikehold. De gjør ad hoc Slack-tråder av typen "hva gjør vi nå?" om til noe en kollega kan ta opp kaldt klokken 3 om natten.

## Et raskt overblikk

- **Toppnivåfunksjon** i OneUptime-dashbordet under **Analyse & Automatisering → Runbooks**.
- **Fire trinntyper**: manuell sjekkliste, JavaScript (sandkasse) og Bash (begge kjører på en [Runbook-agent](/docs/runbooks/agents) i din egen infrastruktur), HTTP-forespørsel.
- **Tre utløsningsveier**: regler som matcher hendelser/varsler/planlagt vedlikehold, eller den manuelle knappen "Kjør runbook" på enhver hendelse.
- **Snapshot-semantikk**: når et runbook starter, kopieres trinnene inn på kjøringen. Redigering av malen senere endrer aldri en pågående kjøring.
- **Fullt revisjonsspor**: status, output, feilmelding og varighet for hvert trinn lagres på kjøringen for alltid.

## Hvorfor bruke runbooks?

Hendelseshåndtering er ofte forskjellen mellom et ettminutts hikst og et nedetid på flere timer. Runbooks hjelper deg med å:

- **Kodifisere stilltiende kunnskap** — svaret på "hva gjør vi når køen hoper seg opp?" ligger et sted teamet kan finne det.
- **Senke gjennomsnittlig gjenopprettingstid (MTTR)** — automatiserte trinn kjører på sekunder; manuelle trinn fjerner avgjørelses-lammelse.
- **Revidere responshandlinger** — hvert trinn, hver output, hvert klikk fra responderen registreres på kjøringen.
- **Sette juniorer i stand til å handle** — de kan kjøre et runbook med trygghet i stedet for å ringe en senior klokken 3.
- **Skrive postmortem fra data, ikke hukommelse** — den fryste kjøringen viser nøyaktig hva som skjedde.

## Sentrale begreper

Noen begreper går igjen i resten av runbook-dokumentasjonen. Få oversikten først:

| Begrep | Betydning |
| --- | --- |
| **Runbook** | Malen. En navngitt, gjenbrukbar prosedyre med en ordnet liste over trinn og et `isEnabled`-flagg. |
| **Trinn** | Ett element i et runbook. Har en type (Manuell / JavaScript / HTTP / Bash), en tittel, en beskrivelse og typespesifikk konfigurasjon. |
| **Runbook-regel** | Et mønster som automatisk knytter ett eller flere runbooks til hendelser, varsler eller planlagt vedlikehold når tittel eller beskrivelse matcher et regex. |
| **Kjøring** | Én avvikling av et runbook. Opprettes når en regel utløses, når noen klikker "Kjør runbook" på en hendelse, eller når noen klikker "Kjør nå" på selve runbook'et. Inneholder et snapshot av trinnene og status/output per trinn. |
| **Snapshot** | Den fryste kopien av runbook'ets trinn som lever på hver kjøring. Lar deg redigere malen senere uten å skrive om historikken. |

## Et runbooks livssyklus

1. **Skrive** — Opprett et runbook, bland manuelle, JavaScript-, HTTP- og Bash-trinn. Lagre.
2. **(Valgfritt) Legg til en regel** — I innstillingene for Hendelser, Varsler eller Planlagt vedlikehold ber du OneUptime starte dette runbook'et hver gang en hendelses tittel eller beskrivelse matcher et regex.
3. **Utløs** — Enten utløses regelen automatisk når en samsvarende hendelse opprettes, eller en responder klikker manuelt **Kjør runbook** på hendelsen.
4. **Kjør** — En ny kjøring opprettes med et snapshot av trinnene. Automatiserte trinn kjører på Runbook-workeren; kjøringen pauses ved hvert manuelt trinn til noen huker det av.
5. **Revider** — Kjøringen forblir for alltid på hendelsens **Runbooks**-fane og på runbook'ets kjøringsliste. Output, feil og tider per trinn beholdes til postmortem.

## Når du bruker hvilken trinntype

En rask beslutningsveiledning. Den lange gjennomgangen står i [Skrive et runbook](/docs/runbooks/authoring).

| Trinntype | Bruk det når… | Eksempel |
| --- | --- | --- |
| **Manuell** | Et menneske må verifisere noe, vurdere eller utføre en handling OneUptime ikke kan observere. | "Bekreft trafikk i sekundær region på load balancer-dashbordet." |
| **JavaScript** | Du trenger en liten, innesluttet beregning — spørre en konfig-tjeneste, transformere en payload, kjøre logikk før neste trinn. Kjører i sandkasse på en [Runbook-agent](/docs/runbooks/agents) i din egen infrastruktur. | Regn ut nåværende replika-etterslep og avgjør om du går videre. |
| **HTTP-forespørsel** | Du kaller en eksisterende API — ditt eget admin-endepunkt, en skyleverandør, PagerDuty, Slack. | `POST` til failover-orkestratoren din. |
| **Bash** | Du må kjøre shell-kommandoer på din egen infrastruktur — restarte en tjeneste, kjøre `kubectl`, kalle et deploy-skript. Krever en [Runbook-agent](/docs/runbooks/agents) installert i miljøet ditt. | Restart en tjeneste, `kubectl rollout restart`, kjør et recovery-skript. |

Du kan blande alle fire i ett runbook — runbookens styrke er å flette menneskelig verifikasjon med automatisering.

## Hvor runbooks bor i dashbordet

| Side | Hva du gjør der |
| --- | --- |
| **Analyse & Automatisering → Runbooks** | Bla, opprette og redigere runbook-maler. |
| **Trinn-fanen på et runbook** | Skrive og omorganisere trinnlisten. |
| **Kjøringer-fanen på et runbook** | Se hver kjøring av dette runbook'et med statusfiltre. |
| **"Kjør nå"-knappen på et runbook** | Starte en ad hoc-kjøring som ikke er knyttet til en hendelse. |
| **Hendelser / Varsler / Planlagt vedlikehold → Innstillinger → Runbook-regler** | Opprette automatiske utløsningsregler per entitetstype. |
| **En hendelse / varsel / vedlikeholdshendelse → Runbooks-fane** | Se kjøringer knyttet til den hendelsen og klikke **Kjør runbook** for en manuell kjøring. |

## Vanlige bruksmønstre

Noen mønstre der team ofte griper til runbooks:

- **Database-failover** — Fang gjeldende tilstand med JavaScript, be vakthavende DBA bekrefte replikaens helse (Manuelt), kall orkestrator-API-et (HTTP), kryss av "DNS oppdatert" (Manuelt), legg ut "alt klart" på Slack (HTTP).
- **Tømme cache** — Ett HTTP-trinn pluss et Manuelt "bekreft at cache-treffraten henter seg inn på dashbordet".
- **Kundepåvirkende hendelse** — Manuelt: "Legg ut oppdatering på statussiden." HTTP: "Varsle CS-teamet i #customer-incidents." JavaScript: "Hent liste over berørte kontoer fra intern API."
- **Pre-flight for planlagt vedlikehold** — JavaScript: snapshot av gjeldende metrikker. Manuelt: "Bekreft endringsvindu med interessenter." HTTP: aktiver vedlikeholdsmodus på load balanceren.
- **Always-on hygiene-regel** — En regel med tomt tittelmønster som fanger systemtilstand ved hver hendelse — gull verdt for postmortem.

## Et gjennomarbeidet eksempel

Anta at du vil at hver hendelse med "db-primary" i tittelen automatisk skal starte et fem-trinns DB-failover-runbook.

**1. Opprett runbook'et.** Under **Runbooks → Opprett runbook** kaller du det "DB primary failover" og legger til disse trinnene:

| # | Type | Tittel |
| --- | --- | --- |
| 1 | JavaScript | Fang replika-etterslep før failover |
| 2 | Manuelt | Bekreft replikaens helse i DBA-dashbordet |
| 3 | HTTP | `POST` til failover-orkestrator |
| 4 | Manuelt | Bekreft at skrivinger går til ny primary |
| 5 | HTTP | Legg ut "alt klart" i Slack `#db-incidents` |

**2. Legg til en regel.** Under **Hendelser → Innstillinger → Runbook-regler** oppretter du:

```
Tittelmønster:  ^db-primary
Runbooks:       [DB primary failover]
```

**3. Utløsning.** En monitorvarsling åpner hendelsen `INC-4821 · db-primary connection timeout`. Regelen matcher, en kjøring opprettes, og:

- Trinn 1 (JavaScript) kjører umiddelbart på workeren — verdien `return { lagMs: 412 }` fanges.
- Trinn 2 (Manuelt) pauser kjøringen. Vakten ser et "Venter på deg"-merke på hendelsessiden, sjekker dashbordet og huker av trinnet.
- Trinn 3 (HTTP) går så snart trinn 2 er huket av — respons-body på `POST` fanges.
- Trinn 4 (Manuelt) pauser igjen.
- Trinn 5 (HTTP) kjører, og kjøringen avsluttes.

**4. Revider.** Kjøringen blir værende på hendelsens **Runbooks**-fane. Hvert trinns output er ett klikk unna. Når du skriver postmortem neste uke, slipper du å spørre "hva returnerte det skriptet?" — det står der.

## Hvordan runbooks passer inn i resten av OneUptime

- **Monitorer** åpner hendelser og varsler; **runbook-regler** gjør om de hendelsene til runbook-kjøringer. Sammen danner de en lukket sløyfe: oppdage → utløse → respondere → registrere.
- **Workspace-koblinger** (Slack, Microsoft Teams) er et naturlig mål for HTTP-trinn — legge ut statusoppdateringer, varsle kanaler.
- **Statussider** oppdateres ofte som et manuelt trinn i et kundepåvirkende runbook.
- **Vaktplaner** avgjør hvem som tilkalles; runbooks avgjør hva personen gjør når hun er våken.

## Les videre

- [Skrive et runbook](/docs/runbooks/authoring) — opprette runbooks, de fire trinntypene og hva hver gjør.
- [Runbook-regler](/docs/runbooks/rules) — knytte runbooks automatisk til hendelser, varsler og planlagt vedlikehold.
- [Kjøre et runbook](/docs/runbooks/running) — manuelle utløsere, kjøringsvisningen og hvordan manuelle trinn spiller sammen med automatiserte.
- [Runbook-agenter](/docs/runbooks/agents) — installer agentene som kjører Bash-trinn i din egen infrastruktur.
- [Konfigurasjon & sikkerhet](/docs/runbooks/configuration) — output-grenser, rettigheter, herding-merknader.
