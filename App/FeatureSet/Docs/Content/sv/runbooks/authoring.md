# Skriva ett runbook

Skapa ett runbook under **Runbooks → Skapa runbook**, öppna det och gå till fliken **Steg**.

## Anatomi av ett steg

Varje steg har:

| Fält | Syfte |
| --- | --- |
| **Titel** | Kort etikett i checklist-gränssnittet. Obligatorisk. |
| **Beskrivning** | Frivillig kontext för respondern. Markdown-text. |
| **Fortsätt vid fel** | Om på, stoppar inte ett misslyckat steg körningen — nästa steg körs ändå. |
| **Typspecifik konfiguration** | Skript, URL osv. — se nedan. |

Steg körs **i ordning**. Omordna med upp-/nedpilarna i steg-editorn.

## Stegtyper

### Manuell

En ruta som respondern bockar av. Körningen pausas vid ett manuellt steg och stannar i `WaitingForManualStep` tills någon markerar det som klart (eller hoppar över).

Använd för sådant bara en människa kan verifiera: "Trafik flyttad till sekundär region enligt load balancer-dashboarden — bekräftat."

### JavaScript

Ett JavaScript-utdrag som körs i en `isolated-vm`-sandlåda (inget filsystem, inget nätverk om du inte själv bär med dig ett API) — men sandlådan lever på en [Runbook-agent](/docs/runbooks/agents) i din egen infrastruktur, inte på OneUptime-Worker'n. Konfigurera en **Agent Tag** på steget som pekar på agenten/agenterna som ska köra det. Om ingen agent med den taggen är online väntar steget tills **claim timeout** (standard 2 minuter) och misslyckas sedan.

```js
const start = Date.now();
// ... din logik ...
return { durationMs: Date.now() - start };
```

Returvärdet sparas på steg-körningen. `console.log`-utdata fångas som loggrader. Standardtimeout: 30 sekunder.

### HTTP-begäran

Ett utgående HTTP-anrop. Konfigurera metod (GET/POST/PUT/PATCH/DELETE/HEAD), URL, valfria JSON-headers och valfri body. Status, headers och body i svaret sparas (totalt högst 50 KB).

Användbart för: öppna en PagerDuty-incident, posta på Slack, anropa ditt eget admin-API osv.

### Bash

Ett bash-skript som körs på en [Runbook-agent](/docs/runbooks/agents) — en liten process du installerar på en värd i din egen infrastruktur. Bash-steg körs aldrig på OneUptime-Worker'n.

Konfigurera två saker på ett Bash-steg:

- **Agent Tag** — taggen som identifierar vilken eller vilka agent(er) som ska köra detta steg. Vilken som helst frisk agent i projektet som bär taggen kommer att claim:a och köra jobbet.
- **Skript** — det bash som ska köras. Utdata (stdout + stderr) fångas upp till 50 KB; processen dödas vid timeout.

Om ingen agent med vald tag är online när runbooket når detta steg, väntar steget till **claim timeout** (standard 2 minuter) och misslyckas sedan. Lägg till en agent under **Runbooks → Agents** innan du förlitar dig på ett Bash-steg.

## Spara och redigera

Tryck **Spara steg** för att spara. Pågående körningar av äldre versioner av runbooken påverkas inte — de fortsätter med sin snapshot.

## Flera steg och felhantering

Som standard stoppar ett misslyckat steg körningen och markerar den `Failed`. Slår du på **Fortsätt vid fel** på ett steg registreras felet, men nästa steg körs ändå. Användbart för mönstren "prova de här tre sakerna, meddela sedan".

## Ett genomarbetat exempel

Ett enkelt runbook för "Primär DB onåbar":

1. **JavaScript** — hämta nuvarande primärvärd från konfig-tjänsten och logga den.
2. **Manuell** — "Replikationsfördröjning på sekundär under 5 sekunder — bekräftat."
3. **HTTP-begäran** — POST till failover-orkestratorns API.
4. **Manuell** — "Skrivningar går till nya primary — bekräftat."
5. **HTTP-begäran** — POST till Slack med "allt klart"-meddelande.

Respondern ser ett automatiserat steg köra, kryssar i ett manuellt, ser nästa automatiserade osv. Varje stegs utdata sparas till postmortem.
