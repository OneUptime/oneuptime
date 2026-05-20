# Workflows – Oversigt

Workflows er OneUptimes visuelle automatiseringsbygger. Træk en trigger ud på et lærred, kobl den til en kæde af handlinger — HTTP-kald, Slack-beskeder, JavaScript-snippets, betingede forgreninger, databaseopslag — og du har en automatisering, der kører, hver gang en hændelse i OneUptime (eller i den ydre verden) udløses.

Hvis runbooks er tjeklister for mennesker under en hændelse, så er workflows baggrundsjob til dit projekt — de kører uden opsyn, de reagerer på ting, og de limer OneUptime sammen med resten af din stack.

## I et hurtigt overblik

- **Top-niveau funktion** i OneUptime-dashboardet under **Workflows**.
- **Tre triggertyper**: Manuel, Tidsplan (cron), Webhook — plus en **model-event-trigger**, der udløses, når en hvilken som helst OneUptime-entitet (hændelse, alarm, monitor, statusside osv.) oprettes, opdateres eller slettes.
- **Visuelt lærred**: træk noder fra en komponentpalet, forbind output-porte til input-porte.
- **Blandet automatisering**: HTTP-anmodninger, Slack-/Discord-/Microsoft Teams-/Telegram-beskeder, brugerdefineret JavaScript, JSON-parsing, betingelser, e-mail, kald af under-workflows og CRUD-operationer på OneUptime-modeller.
- **Globale variabler**: projektomfattende hemmeligheder og konfiguration, du kan referere fra ethvert workflow uden at copy-paste.
- **Kørsler & logfiler**: hver afvikling registreres med status, tidsforbrug og output per trin.

## Hvorfor bruge workflows?

De fleste teams griber til workflows, når de vil:

- **Forbinde OneUptime med et andet system** — sende en hændelse til PagerDuty, spejle en alarm i Jira, pinge en webhook i din stack.
- **Reagere på OneUptime-events** — når en `Sev 1`-hændelse åbner, kald den vagthavende manager *og* opret en Linear-ticket *og* lås et feature flag.
- **Planlægge tilbagevendende job** — hvert femte minut: forespørg et internt API og skriv resultatet ind i et eksternt system.
- **Modtage data udefra** — en webhook fra et CI-system sætter en kæde af OneUptime-opdateringer i gang.
- **Genbruge små stumper limlogik** — ét workflow kalder et andet, så almindelige mønstre lever ét sted.

## Nøglebegreber

| Begreb | Betydning |
| --- | --- |
| **Workflow** | Lærredet. En navngiven, genbrugelig graf af triggere og komponenter med et `isEnabled`-flag. |
| **Trigger** | Den node, der starter en workflow-kørsel. Manuel, Tidsplan, Webhook eller en model-event. Hvert workflow har præcis én trigger. |
| **Komponent** | En node, der udfører arbejde — et HTTP-kald, en Slack-besked, en JavaScript-snippet, en betingelse osv. |
| **Port** | Et input- eller output-stik på en node. Komponenter har output-porte som `success` og `error`; du forbinder en port til næste nodes input-port. |
| **Kørsel / Log** | Én afvikling af et workflow. Indeholder tidsstempel, status (Running, Success, Failed, Timeout) og det opfangede output for hver node, der kørte. |
| **Global variabel** | En navngiven værdi (ofte en hemmelighed eller API-nøgle), defineret én gang på projektniveau og refereret fra ethvert workflow som `{{variable.NAME}}`. |
| **Lokal variabel** | En værdi afgrænset til en enkelt workflow-kørsel — typisk returværdien fra en tidligere node, refereret som `{{ComponentId.portName}}`. |

## Hvor workflows bor i dashboardet

| Side | Hvad du laver der |
| --- | --- |
| **Workflows** | Gennemse, oprette og søge i workflow-skabeloner. |
| **Et workflows Builder-fane** | Træk-og-slip-lærredet. Tilføj noder, forbind porte, konfigurer argumenter. |
| **Et workflows Logs-fane** | Hver kørsel af dette workflow med filtre på status og tidsinterval. Klik en kørsel for at se output per node. |
| **Et workflows Settings-fane** | Omdøb, aktivér/deaktivér, ændr beskrivelsen, administrér labels, slet. |
| **Workflows → Globale variabler** | Definér projektomfattende værdier, der refereres fra ethvert workflow. Markér en værdi som hemmelig for at skjule den i UI'et efter gem. |
| **Workflows → Kørsler & logfiler** | Projektomfattende kørselshistorik på tværs af alle workflows. |

## Et workflows livscyklus

1. **Skriv** — Opret et workflow, læg en trigger på lærredet, træk de komponenter ind, du har brug for, forbind dem, og konfigurer hver enkelt.
2. **Aktivér** — Workflows leveres deaktiveret. Vip kontakten i Settings, når du er sikker på, at koblingerne er rigtige.
3. **Udløs** — Manuel: klik **Run Manually** med en valgfri JSON-payload. Tidsplan: cron udløses. Webhook: et eksternt system sender `POST` til workflow-URL'en. Model-event: nogen (eller et andet workflow) opretter/opdaterer/sletter en monitor, hændelse, alarm osv.
4. **Eksekvér** — Workflow Workeren går grafen igennem i rækkefølge. Hver komponent læser sine argumenter (literal-værdier eller interpolerede variabler), gør sit job, skriver sin returværdi og vælger en output-port. Næste node udløses.
5. **Revider** — Kørslen dukker op i **Logs**. Status, samlet varighed, output per komponent og eventuelle fejl bevares i projektets levetid.

## Et gennemarbejdet eksempel

Mål: når en hændelse oprettes med `Sev 1` i titlen, skal der posteres i en Slack-kanal, og der skal åbnes en ticket i dit interne admin-værktøj.

**1. Opret et workflow** ved navn "Sev 1 fan-out."

**2. Læg en trigger.** Vælg **Incident → On Create**-triggeren fra paletten. Triggeren eksponerer den nye hændelse som returværdi.

**3. Læg en Conditional-komponent.** Forbind triggerens output-port til dens input. Sæt betingelsen: `{{Incident.title}}` *contains* `Sev 1`.

**4. Fra Conditional'ens `yes`-port lægger du en Slack-komponent.** Kanal: `#incident-room`. Beskedtekst: `Sev 1 declared: {{Incident.title}} — {{Incident.dashboardUrl}}`.

**5. Fra samme `yes`-port (parallelt) lægger du en API-komponent.** `POST` til `https://admin.internal/incidents`. Body: et lille JSON-objekt bygget ud fra hændelsen.

**6. Aktivér workflowet.** Åbn en hændelse med titlen "Sev 1 — checkout 500s" i en anden fane. Inden for få sekunder lander Slack-beskeden, og en ny kørsel dukker op under **Logs** med hver nodes output opfanget.

## Hvordan workflows passer ind i resten af OneUptime

- **Monitorer** opdager problemer; **hændelser/alarmer** registrerer dem; **workflows** reagerer på dem — sender beskeder, åbner tickets, sætter automatisering i gang.
- **Runbooks** er svarprocedurer for mennesker (med valgfrie script-trin). Workflows er ubemandet baggrundsautomatisering. De supplerer hinanden — et runbook-trin kan `POST`e til en webhook-trigger på et workflow.
- **Workspace-forbindelser** (Slack, Microsoft Teams) er typiske destinationer for workflow-notifikationer.
- **Dashboards** er læseorienterede visninger; workflows er skriveholdet — de opdaterer OneUptime-tilstand, kalder eksterne API'er og flytter data rundt.

## Læs videre

- [Opret et workflow](/docs/workflows/authoring) — bygge et workflow på lærredet, konfigurere noder, forbinde porte.
- [Workflow-triggere](/docs/workflows/triggers) — Manuel, Tidsplan, Webhook og model-event-triggere i detaljer.
- [Workflow-komponenter](/docs/workflows/components) — kataloget over handlinger, og hvordan hver enkelt konfigureres.
- [Workflow-variabler](/docs/workflows/variables) — globale variabler, lokale variabler og hvordan interpolation virker.
- [Workflow-kørsler & logfiler](/docs/workflows/runs-and-logs) — læs kørselshistorik, fejlfind kørsler, der mislykkes.
- [Workflow-konfiguration & sikkerhed](/docs/workflows/configuration) — aktivere/deaktivere, ejerskab, labels, hemmeligheder, rekursionsgrænser.
