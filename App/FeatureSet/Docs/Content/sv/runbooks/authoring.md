# Skriva ett runbook

Skapa ett runbook under **Runbooks → Skapa runbook**, öppna det och gå till fliken **Steps**.

## Anatomin av ett steg

Varje steg har:

| Fält                          | Syfte                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Titel**                     | Kort etikett som visas i checklist-UI:t. Obligatoriskt.                                                |
| **Beskrivning**               | Valfri kontext för svararen. Markdown-säker text.                                                      |
| **Fortsätt vid fel**          | Om på stoppar ett misslyckat steg inte körningen — nästa steg körs ändå.                               |
| **Kräver godkännande**        | Om på pausar runbooket efter detta steg och väntar tills en användare godkänner innan nästa steg körs. |
| **Typspecifik konfiguration** | Skript, URL, agent, etc. — se nedan.                                                                   |

Steg körs **i ordning**. Omordna dem med upp/ned-pilarna i Steps-editorn.

## Stegtyper

### Manuell

En kryssruta som svararen bockar av. Runbook-körningen pausar när den når ett Manuellt steg och stannar i `WaitingForManualStep` tills någon markerar det som klart (eller hoppar över det).

Använd detta för saker bara en människa kan verifiera: "Bekräftade att trafik har flyttats till sekundära regionen i load balancer-dashboarden."

### JavaScript

En snutt JavaScript som körs i en `isolated-vm`-sandlåda. Sandlådan lever på en [Runbook-agent](/docs/runbooks/agents) i din egen infrastruktur — inte på OneUptime-Worker'n.

Konfigurera två saker på ett JavaScript-steg:

- **Runbook-agent** — välj agenten som ska köra detta steg från dropdownen. Bara den valda agenten får claim:a jobbet.
- **Skript** — JavaScript som ska köras.

```js
const start = Date.now();
// ... din logik ...
return { durationMs: Date.now() - start };
```

Returvärdet fångas på stegkörningen. `console.log`-utdata fångas som loggrader. Standard körnings-timeout: 30 sekunder. Standard claim-timeout (hur länge Worker'n väntar på att agenten plockar upp jobbet): 2 minuter.

### HTTP-förfrågan

Gör ett utgående HTTP-anrop. Konfigurera metod (GET/POST/PUT/PATCH/DELETE/HEAD), URL, valfria JSON-headers och valfri body. Svarsstatus, headers och body fångas (begränsat till 50KB totalt).

Användbart för: att sparka igång en PagerDuty-incident, posta till Slack, anropa din egen admin-API, osv. HTTP-steg körs direkt på OneUptime-Worker'n; ingen agent krävs.

### Bash

Ett bash-skript (`bash -c <skript>`) som körs på en [Runbook-agent](/docs/runbooks/agents) i din egen infrastruktur. Bash körs aldrig på OneUptime-Worker'n.

Konfigurera två saker på ett Bash-steg:

- **Runbook-agent** — välj agenten som ska köra detta steg från dropdownen. Bara den valda agenten får claim:a jobbet.
- **Skript** — bash:en som ska köras. Utdata (stdout + stderr) fångas upp till 50 KB; processen dödas vid timeout.

Om den valda agenten är offline när runbooket når detta steg väntar steget upp till **claim-timeouten** (standard 2 minuter) och misslyckas sedan med `TimedOut`. Lägg till en agent under **Runbooks → Settings → Agents** innan du lutar dig mot ett Bash-steg.

## Sparande och redigering

Tryck **Spara steg** för att persistera. Pågående körningar av äldre versioner av runbooket påverkas inte — de fortsätter använda sitt snapshot.

## Flera steg och felhantering

Som standard stoppar ett misslyckat steg körningen och markerar körningen som `Failed`. Om du sätter **Fortsätt vid fel** på ett steg registreras ett fel men nästa steg körs. Detta är användbart för "prova dessa tre saker, sedan notifiera"-mönster.

## Ett genomarbetat exempel

Ett enkelt runbook för "DB-primary onåbar":

1. **JavaScript** — hämta nuvarande primary-värd från din konfigurationstjänst och logga den.
2. **Manuellt** — "Bekräfta att replikationslaggen i sekundären är under 5 sekunder."
3. **HTTP-förfrågan** — POST till din failover-orchestrators API.
4. **Manuellt** — "Verifiera att skrivningar nu går till den nya primary."
5. **HTTP-förfrågan** — POST till Slack med ett "klart"-meddelande.

Svararen ser ett automatiserat steg köra, bockar av ett manuellt, ser nästa automatiserade steg köra, och så vidare. Varje stegs utdata fångas för post-mortemen.
