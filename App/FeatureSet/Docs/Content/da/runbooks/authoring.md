# Skriv et runbook

Opret et runbook under **Runbooks → Opret runbook**, åbn det derefter og gå til **Trin**-fanen.

## Anatomi af et trin

Hvert trin har:

| Felt                           | Formål                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **Titel**                      | Kort label vist i tjeklisten i UI'en. Påkrævet.                                                               |
| **Beskrivelse**                | Valgfri kontekst til responderen. Markdown-sikker tekst.                                                      |
| **Fortsæt ved fejl**           | Hvis aktiveret stopper et fejlende trin ikke kørslen — næste trin udføres alligevel.                          |
| **Kræv godkendelse**           | Hvis aktiveret pauser runbook'et efter dette trin og venter på, at en bruger godkender, før næste trin køres. |
| **Typespecifik konfiguration** | Script, URL, agent osv. — se nedenfor.                                                                        |

Trin kører **i rækkefølge**. Omarranger dem med op/ned-pilene i trin-editoren.

## Trintyper

### Manuel

Et afkrydsningsfelt, responderen tikker af. Runbook-kørslen pauser, når den når et manuelt trin og forbliver i `WaitingForManualStep`, indtil nogen markerer den som færdig (eller springer den over).

Brug det til ting kun et menneske kan verificere: "Bekræftet at trafik er flyttet til sekundær region i load balancer-dashboardet."

### JavaScript

Et stykke JavaScript kørt i en `isolated-vm`-sandkasse. Sandkassen lever på en [Runbook-agent](/docs/runbooks/agents) i din egen infrastruktur — ikke på OneUptime Worker'en.

Konfigurer to ting på et JavaScript-trin:

- **Runbook-agent** — vælg den agent, der skal køre dette trin, fra dropdownen. Kun den valgte agent må claime jobbet.
- **Script** — det JavaScript, der skal køres.

```js
const start = Date.now();
// ... din logik ...
return { durationMs: Date.now() - start };
```

Den returnerede værdi fanges på trin-eksekveringen. `console.log`-output fanges som loglinjer. Standard execution timeout: 30 sekunder. Standard claim timeout (hvor længe Worker'en venter på, at agenten samler jobbet op): 2 minutter.

### HTTP-anmodning

Foretag et udgående HTTP-kald. Konfigurer metode (GET/POST/PUT/PATCH/DELETE/HEAD), URL, valgfrie JSON-headere og valgfrit body. Responsens status, headere og body fanges (begrænset til 50 KB i alt).

Nyttig til: at starte en PagerDuty-hændelse, poste til Slack, kalde din egen admin-API osv. HTTP-trin kører på OneUptime Worker'en direkte; ingen agent påkrævet.

### Bash

Et bash-script (`bash -c <script>`) kørt på en [Runbook-agent](/docs/runbooks/agents) i din egen infrastruktur. Bash kører aldrig på OneUptime Worker'en.

Konfigurer to ting på et Bash-trin:

- **Runbook-agent** — vælg den agent, der skal køre dette trin, fra dropdownen. Kun den valgte agent må claime jobbet.
- **Script** — bash'en der skal køres. Output (stdout + stderr) fanges op til 50 KB; processen dræbes ved timeout.

Hvis den valgte agent er offline, når runbook'et når dette trin, venter trinnet op til **claim timeout** (standard 2 minutter) og fejler så med `TimedOut`. Tilføj en agent under **Runbooks → Indstillinger → Agents**, før du regner med et Bash-trin.

## Gem og rediger

Tryk på **Gem trin** for at persistere. Igangværende kørsler af ældre versioner af runbook'et er upåvirkede — de bruger fortsat deres snapshot.

## Flere trin og fejlhåndtering

Som standard stopper et fejlende trin kørslen og markerer eksekveringen som `Failed`. Hvis du slår **Fortsæt ved fejl** til på et trin, registreres en fejl, men næste trin kører. Det er nyttigt til "prøv disse tre ting, og giv så besked"-mønstre.

## Et gennemarbejdet eksempel

Et simpelt runbook for "DB primary unreachable":

1. **JavaScript** — hent den nuværende primary host fra din config-tjeneste og log den.
2. **Manuel** — "Bekræft replikationslag på sekundær er under 5 sekunder."
3. **HTTP-anmodning** — POST til din failover-orchestrators API.
4. **Manuel** — "Verificér at skrivninger nu går til den nye primary."
5. **HTTP-anmodning** — POST til Slack med en "alt klart"-besked.

Responderen følger med, mens et automatiseret trin kører, tikker et manuelt af, ser næste automatiserede trin køre, og så videre. Hvert trins output fanges til post-mortem.
