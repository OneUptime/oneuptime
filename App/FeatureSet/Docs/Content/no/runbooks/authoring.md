# Skrive et runbook

Opprett et runbook under **Runbooks → Opprett runbook**, åpne det og gå til fanen **Trinn**.

## Anatomien til et trinn

Hvert trinn har:

| Felt                            | Hensikt                                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Tittel**                      | Kort betegnelse i sjekkliste-UI-en. Påkrevd.                                                                |
| **Beskrivelse**                 | Valgfri kontekst til responderen. Markdown-tekst.                                                           |
| **Fortsett ved feil**           | Hvis på, stopper et feilet trinn ikke kjøringen — neste trinn kjører likevel.                               |
| **Krev godkjenning**            | Hvis på, pauser runbook'et etter dette trinnet og venter på at en bruker godkjenner før neste trinn kjøres. |
| **Typespesifikk konfigurasjon** | Skript, URL, agent osv. — se nedenfor.                                                                      |

Trinn kjører **i rekkefølge**. Omorganiser med pilene opp/ned i trinn-editoren.

## Trinntyper

### Manuell

En boks responderen huker av. Kjøringen pauses ved et manuelt trinn og blir værende i `WaitingForManualStep` til noen markerer det som fullført (eller hopper over).

Bruk det for noe bare et menneske kan verifisere: "Trafikken er flyttet til sekundær region ifølge load balancer-dashbordet — bekreftet."

### JavaScript

En JavaScript-snutt som kjøres i en `isolated-vm`-sandkasse. Sandkassen lever på en [Runbook-agent](/docs/runbooks/agents) i din egen infrastruktur — ikke på OneUptime-Worker'en.

Konfigurer to ting på et JavaScript-trinn:

- **Runbook-agent** — velg agenten som skal kjøre dette trinnet, fra nedtrekksmenyen. Bare den valgte agenten kan claime jobben.
- **Skript** — JavaScript-koden som skal kjøres.

```js
const start = Date.now();
// ... din logikk ...
return { durationMs: Date.now() - start };
```

Returverdien lagres på trinn-kjøringen. `console.log`-output fanges som loglinjer. Standard execution timeout: 30 sekunder. Standard claim timeout (hvor lenge Worker'en venter på at agenten plukker opp jobben): 2 minutter.

### HTTP-forespørsel

Et utgående HTTP-kall. Konfigurer metode (GET/POST/PUT/PATCH/DELETE/HEAD), URL, valgfrie JSON-headere og valgfri body. Status, headere og body på svaret lagres (totalt opp til 50 KB).

Nyttig for: åpne en PagerDuty-hendelse, poste på Slack, kalle din egen admin-API osv. HTTP-trinn kjører direkte på OneUptime-Worker'en; ingen agent påkrevd.

### Bash

Et bash-skript (`bash -c <skript>`) som kjøres på en [Runbook-agent](/docs/runbooks/agents) i din egen infrastruktur. Bash kjøres aldri på OneUptime-Worker'en.

Konfigurer to ting på et Bash-trinn:

- **Runbook-agent** — velg agenten som skal kjøre dette trinnet, fra nedtrekksmenyen. Bare den valgte agenten kan claime jobben.
- **Skript** — bash'en som skal kjøres. Output (stdout + stderr) fanges opp til 50 KB; prosessen drepes ved timeout.

Hvis den valgte agenten er offline når runbook'et når dette trinnet, venter trinnet opp til **claim timeout** (standard 2 minutter) og feiler så med `TimedOut`. Legg til en agent under **Runbooks → Innstillinger → Agents** før du baserer deg på et Bash-trinn.

## Lagre og redigere

Trykk **Lagre trinn** for å lagre. Pågående kjøringer av eldre versjoner av runbook'et er upåvirket — de fortsetter med sitt snapshot.

## Flere trinn og feilhåndtering

Som standard stopper et feilet trinn kjøringen og markerer den `Failed`. Slår du på **Fortsett ved feil** på et trinn, registreres feilen, men neste trinn kjører likevel. Nyttig for mønstre som "prøv disse tre tingene, gi så beskjed".

## Et gjennomarbeidet eksempel

Et enkelt runbook for "Primær DB ikke nåbar":

1. **JavaScript** — hent nåværende primærvert fra konfig-tjenesten og logg den.
2. **Manuelt** — "Replikasjonsetterslep på sekundær under 5 sekunder — bekreftet."
3. **HTTP-forespørsel** — POST til API-en på failover-orkestratoren din.
4. **Manuelt** — "Skrivinger går til den nye primaryen — bekreftet."
5. **HTTP-forespørsel** — POST til Slack med "alt klart"-melding.

Responderen ser et automatisert trinn kjøre, huker av et manuelt, ser neste automatiserte, og så videre. Hvert trinns output lagres til postmortem.
