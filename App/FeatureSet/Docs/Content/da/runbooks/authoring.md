# Skriv et runbook

Opret et runbook under **Runbooks → Opret runbook**, åbn det og gå til fanen **Trin**.

## Anatomien af et trin

Hvert trin har:

| Felt | Formål |
| --- | --- |
| **Titel** | Kort betegnelse i tjekliste-UI'en. Påkrævet. |
| **Beskrivelse** | Valgfri kontekst til responderen. Markdown-tekst. |
| **Fortsæt ved fejl** | Hvis aktiv, stopper et fejlet trin ikke kørslen — det næste trin kører alligevel. |
| **Typespecifik konfiguration** | Script, URL osv. — se nedenfor. |

Trin kører **i rækkefølge**. Omarranger dem med op/ned-pilene i trin-editoren.

## Trintyper

### Manuel

En boks, responderen tikker af. Kørslen sættes på pause ved et manuelt trin og forbliver i `WaitingForManualStep`, indtil nogen markerer det som færdigt (eller springer det over).

Brug det til ting, kun et menneske kan verificere: "Trafikken er flyttet til sekundær region ifølge load balancer-dashboardet — bekræftet."

### JavaScript

Et JavaScript-uddrag, der køres i en `isolated-vm`-sandkasse (intet filsystem, intet netværk medmindre du selv medbringer en API) — men sandkassen lever på en [Runbook-agent](/docs/runbooks/agents) i din egen infrastruktur, ikke på OneUptime-Worker'en. Konfigurer et **Agent Tag** på trinet, der peger på den/de agent(er), der skal udføre det. Er ingen agent med det tag online, venter trinet indtil **claim timeout** (standard 2 minutter) og fejler så.

```js
const start = Date.now();
// ... din logik ...
return { durationMs: Date.now() - start };
```

Den returnerede værdi gemmes på trin-kørslen. `console.log`-output fanges som logrækker. Standardtimeout: 30 sekunder.

### HTTP-anmodning

Et udgående HTTP-kald. Konfigurér metode (GET/POST/PUT/PATCH/DELETE/HEAD), URL, valgfri JSON-headers og valgfri body. Status, headers og body i svaret gemmes (begrænset til 50 KB i alt).

Nyttigt til: åbne en PagerDuty-hændelse, poste på Slack, kalde din egen admin-API osv.

### Bash

Et bash-script, der kører på en [Runbook-agent](/docs/runbooks/agents) — en lille proces, du installerer på en vært i din egen infrastruktur. Bash-trin udføres aldrig på OneUptime-Worker'en.

Konfigurér to ting på et Bash-trin:

- **Agent Tag** — det tag, der identificerer hvilke(n) agent(er) der skal udføre dette trin. Enhver sund agent i projektet, der bærer det tag, vil claime og køre jobbet.
- **Script** — det bash, der skal køres. Output (stdout + stderr) fanges op til 50 KB; processen dræbes ved timeout.

Er ingen agent med det valgte tag online, når runbook'et når dette trin, venter trinnet indtil **claim timeout** (standard 2 minutter) og fejler så. Tilføj en agent under **Runbooks → Agents**, før du regner med et Bash-trin.

## Gem og redigér

Tryk **Gem trin** for at gemme. Igangværende kørsler af ældre versioner af runbook'et er upåvirket — de fortsætter med deres snapshot.

## Flere trin og fejlhåndtering

Som standard stopper et fejlet trin kørslen og markerer kørslen `Failed`. Slår du **Fortsæt ved fejl** til på et trin, registreres fejlen, men næste trin kører alligevel. Nyttigt til mønstre som "prøv disse tre ting, og giv så besked".

## Et gennemarbejdet eksempel

Et simpelt runbook for "Primær DB uopnåelig":

1. **JavaScript** — hent aktuel primær host fra konfigurationstjenesten og log den.
2. **Manuel** — "Replikationslag på sekundær under 5 sekunder — bekræftet."
3. **HTTP-anmodning** — POST til din failover-orchestrators API.
4. **Manuel** — "Skrivninger går til den nye primary — bekræftet."
5. **HTTP-anmodning** — POST til Slack med "alt klart"-besked.

Responderen ser et automatiseret trin køre, tikker et manuelt af, ser det næste køre osv. Hvert trins output gemmes til postmortem.
