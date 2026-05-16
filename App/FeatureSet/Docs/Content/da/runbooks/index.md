# Runbooks – Oversigt

Runbooks er genbrugelige svarprocedurer — ordnede lister af manuelle eller automatiserede trin — som du knytter til hændelser, alarmer eller planlagte vedligeholdelser. De forvandler ad hoc Slack-tråde af typen "hvad gør vi nu?" til noget, en kollega kan tage op fra bunden klokken 3 om natten.

## I et hurtigt overblik

- **Top-niveau funktion** i OneUptime-dashboardet under **Analyse & Automatisering → Runbooks**.
- **Fire trintyper**: manuel tjekliste, JavaScript (sandkasse) og Bash (begge kører på en [Runbook-agent](/docs/runbooks/agents) i din egen infrastruktur), HTTP-anmodning.
- **Tre udløsningsveje**: regler der matcher hændelser/alarmer/planlagt vedligehold, eller den manuelle knap "Kør runbook" på et hvilket som helst event.
- **Snapshot-semantik**: når et runbook starter, kopieres dets trin ind på kørslen. At redigere skabelonen senere ændrer aldrig en igangværende kørsel.
- **Fuldt revisionsspor**: status, output, fejlmeddelelse og varighed for hvert trin gemmes på kørslen for altid.

## Hvorfor bruge runbooks?

Hændelsesrespons er ofte forskellen mellem et minuts udfald og et nedbrud, der varer timer. Runbooks hjælper dig med at:

- **Kodificere tavs viden** — svaret på "hvad gør vi, når køen hober sig op?" ligger et sted, dit team kan finde det.
- **Sænke den gennemsnitlige gendannelsestid (MTTR)** — automatiserede trin kører på sekunder; manuelle trin fjerner beslutningslammelse.
- **Revidere responshandlinger** — hvert trin, hvert output, hvert klik fra responderen registreres på kørslen.
- **Gøre juniorer handlekraftige** — de kan køre et runbook med selvtillid frem for at ringe til en senior klokken 3.
- **Skrive postmortems ud fra data, ikke hukommelse** — den fastfrosne kørsel viser præcis, hvad der skete.

## Nøglebegreber

Et par begreber går igen i resten af runbook-dokumentationen. Få styr på dem først:

| Begreb | Betydning |
| --- | --- |
| **Runbook** | Skabelonen. En navngiven, genbrugelig procedure med en ordnet liste af trin og et `isEnabled`-flag. |
| **Trin** | Ét punkt i et runbook. Har en type (Manuel / JavaScript / HTTP / Bash), en titel, en beskrivelse og typespecifik konfiguration. |
| **Runbook-regel** | Et mønster, der automatisk knytter et eller flere runbooks til hændelser, alarmer eller planlagt vedligehold, når titel eller beskrivelse matcher et regex. |
| **Kørsel** | Én afvikling af et runbook. Oprettes, når en regel udløses, når nogen klikker "Kør runbook" på en hændelse, eller når nogen klikker "Kør nu" på selve runbook'et. Indeholder et snapshot af trinene og status/output per trin. |
| **Snapshot** | Den fastfrosne kopi af runbook'ets trin, som lever på hver kørsel. Lader dig redigere skabelonen senere uden at omskrive historikken. |

## Et runbook'ets livscyklus

1. **Skriv** — Opret et runbook, bland manuelle, JavaScript-, HTTP- og Bash-trin. Gem.
2. **(Valgfrit) Tilføj en regel** — Under indstillinger for Hændelser, Alarmer eller Planlagt vedligehold beder du OneUptime om at starte dette runbook, hver gang en hændelses titel eller beskrivelse matcher et regex.
3. **Udløs** — Enten udløses reglen automatisk, når en passende hændelse oprettes, eller en responder klikker manuelt **Kør runbook** på hændelsen.
4. **Kør** — En ny kørsel oprettes med et snapshot af trinene. Automatiserede trin kører på Runbook-workeren; kørslen sættes på pause ved hvert manuelt trin, indtil nogen tikker det af.
5. **Revider** — Kørslen bliver for altid på hændelsens **Runbooks**-fane og på runbook'ets kørselsliste. Output, fejl og tider per trin bevares til postmortem.

## Hvornår skal du bruge hver trintype

En hurtig beslutningsguide. Detaljerne findes i [Skriv et runbook](/docs/runbooks/authoring).

| Trintype | Brug det når… | Eksempel |
| --- | --- | --- |
| **Manuel** | Et menneske skal verificere noget, foretage en vurdering eller udføre en handling, OneUptime ikke kan observere. | "Bekræft trafik til sekundær region i load balancer-dashboardet." |
| **JavaScript** | Du har brug for en lille, afgrænset beregning — forespørge en konfigurationstjeneste, transformere en payload, køre logik før næste trin. Kører i sandkasse på en [Runbook-agent](/docs/runbooks/agents) i din egen infrastruktur. | Beregn nuværende replikalag og afgør, om du skal fortsætte. |
| **HTTP-anmodning** | Du kalder en eksisterende API — dit eget admin-endpoint, en cloud-udbyder, PagerDuty, Slack. | `POST` til din failover-orchestrator. |
| **Bash** | Du skal køre shell-kommandoer på din egen infrastruktur — genstarte en service, køre `kubectl`, kalde et deploy-script. Kræver en [Runbook-agent](/docs/runbooks/agents) installeret i dit miljø. | Genstart en service, `kubectl rollout restart`, kør et recovery-script. |

Du kan blande alle fire i ét runbook — runbooks' styrke er at flette menneskelig verifikation med automatisering.

## Hvor runbooks bor i dashboardet

| Side | Hvad du laver der |
| --- | --- |
| **Analyse & Automatisering → Runbooks** | Gennemse, oprette og redigere runbook-skabeloner. |
| **Trin-fanen på et runbook** | Skrive og omarrangere triplisten. |
| **Kørsler-fanen på et runbook** | Se hver kørsel af runbook'et med statusfiltre. |
| **"Kør nu"-knappen på et runbook** | Starte en ad hoc-kørsel, der ikke er knyttet til en hændelse. |
| **Hændelser / Alarmer / Planlagt vedligehold → Indstillinger → Runbook-regler** | Oprette de automatiske udløsningsregler per entitetstype. |
| **En hændelse / alarm / vedligeholdshændelse → Runbooks-fanen** | Se kørsler knyttet til den hændelse og klikke **Kør runbook** for en manuel kørsel. |

## Almindelige anvendelser

Nogle mønstre, hvor teams bruger runbooks:

- **Database-failover** — Fang aktuel tilstand med JavaScript, bed den vagthavende DBA om at bekræfte replikaens sundhed (Manuel), kald orchestrator-API'en (HTTP), tik "DNS opdateret" af (Manuel), post "alt klart" på Slack (HTTP).
- **Cache-tømning** — Et enkelt HTTP-trin plus et Manuelt "bekræft at cache-hitraten retter sig på dashboardet".
- **Kundepåvirkende hændelse** — Manuel: "Læg opdatering på statussiden." HTTP: "Underret CS-teamet i #customer-incidents." JavaScript: "Hent liste over berørte kunder fra intern API."
- **Pre-flight for planlagt vedligehold** — JavaScript: snapshot af aktuelle metrics. Manuel: "Bekræft ændringsvindue med interessenter." HTTP: aktiver vedligeholdsstilstand på load balanceren.
- **Always-on hygiejneregel** — En regel med tomt titelmønster, der fanger systemtilstanden ved hver hændelse — guld værd til postmortems.

## Et gennemarbejdet eksempel

Antag, at du vil have hver hændelse med "db-primary" i titlen til automatisk at starte et fem-trins DB-failover-runbook.

**1. Opret runbook'et.** Under **Runbooks → Opret runbook** kalder du det "DB primary failover" og tilføjer disse trin:

| # | Type | Titel |
| --- | --- | --- |
| 1 | JavaScript | Fang replikalag før failover |
| 2 | Manuel | Bekræft replikaens sundhed i DBA-dashboardet |
| 3 | HTTP | `POST` til failover-orchestrator |
| 4 | Manuel | Verificér at skrivninger går til den nye primary |
| 5 | HTTP | Post "alt klart" i Slack `#db-incidents` |

**2. Tilføj en regel.** Under **Hændelser → Indstillinger → Runbook-regler** opretter du:

```
Titelmønster:  ^db-primary
Runbooks:      [DB primary failover]
```

**3. Udløsning.** En monitoralarm åbner hændelsen `INC-4821 · db-primary connection timeout`. Reglen matcher, en kørsel oprettes, og:

- Trin 1 (JavaScript) kører straks på workeren — dets `return { lagMs: 412 }`-værdi fanges.
- Trin 2 (Manuel) sætter kørslen på pause. Vagten ser en "Venter på dig"-mærkat på hændelsessiden, kigger i dashboardet og tikker trinnet af.
- Trin 3 (HTTP) går så snart trin 2 er tikket af — `POST`-respons-bodyen fanges.
- Trin 4 (Manuel) pauser igen.
- Trin 5 (HTTP) kører, og kørslen slutter.

**4. Revider.** Kørslen forbliver på hændelsens **Runbooks**-fane. Output for hvert trin er ét klik væk. Når du skriver postmortem næste uge, skal du ikke spørge "hvad returnerede det script?" — det står der.

## Hvordan runbooks passer ind i resten af OneUptime

- **Monitorer** åbner hændelser og alarmer; **runbook-regler** omsætter de events til runbook-kørsler. Tilsammen danner de en lukket sløjfe: opdag → udløs → reagér → registrer.
- **Workspace-forbindelser** (Slack, Microsoft Teams) er et naturligt mål for HTTP-trin — slå statusopdateringer op, underret kanaler.
- **Statussider** opdateres ofte som et manuelt trin i et kundepåvirkende runbook.
- **Vagtplaner** afgør, hvem der bliver tilkaldt; runbooks afgør, hvad personen så gør.

## Læs videre

- [Skriv et runbook](/docs/runbooks/authoring) — oprette runbooks, de fire trintyper og hvad hver gør.
- [Runbook-regler](/docs/runbooks/rules) — knytte runbooks automatisk til hændelser, alarmer og planlagt vedligehold.
- [Kør et runbook](/docs/runbooks/running) — manuelle udløsere, kørselsvisningen og hvordan manuelle trin spiller sammen med automatiserede.
- [Runbook-agenter](/docs/runbooks/agents) — installer de agenter, der kører Bash-trin i din egen infrastruktur.
- [Konfiguration & sikkerhed](/docs/runbooks/configuration) — output-grænser, rettigheder, hærdningsnoter.
