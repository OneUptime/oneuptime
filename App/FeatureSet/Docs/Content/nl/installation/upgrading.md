# OneUptime upgraden

Deze handleiding beschrijft hoe u uw zelf-gehoste OneUptime-installatie veilig kunt upgraden.

## Algemene richtlijnen

- Upgrade stap voor stap door hoofdversies (bijvoorbeeld 6 → 7 → 8). Sla geen hoofdversies over.
- U kunt kleine/patch-versies overslaan (bijvoorbeeld 8.1 → 8.4) zolang u de release-opmerkingen volgt.
- Maak altijd back-ups voordat u upgradet en valideer of u deze kunt herstellen.

## Upgraden van OneUptime 12 → 13

OneUptime 13 vervangt Redis door [Valkey](https://valkey.io) als meegeleverde cache- en wachtrij-engine. Redis 7.4 verliet de BSD-licentie en de meeste oorspronkelijke Redis-bijdragers werken inmiddels aan Valkey, een fork van Redis 7.2 die hetzelfde protocol spreekt. Boven de socket is er niets veranderd, en u kunt OneUptime nog steeds naar een echte Redis of naar een beheerde Redis-compatibele dienst laten wijzen als u dat liever hebt.

Alles wat u instelt heet nu daarnaar: de instellingen zijn `VALKEY_*`, de Helm-waarden zijn `valkey:` / `externalValkey:` en de Kubernetes-objecten zijn `<release>-valkey*`. **Alle oude namen werken nog steeds**, dus een onaangeroerde `config.env` of `values.yaml` upgradet en blijft draaien. Er is geen configuratie die u moet aanpassen en er zijn geen gegevens te migreren — de cache is geen bron van waarheid, en Postgres en ClickHouse blijven onaangeraakt.

Wat u moet doen hangt af van hoe u hebt uitgerold:

- **Docker Compose:** upgrade zoals gewoonlijk, met één optie die ertoe doet — zie [Upgraden met Docker Compose](#upgraden-met-docker-compose).
- **Helm:** geen wijziging in waarden nodig, maar de cachepod wordt opnieuw aangemaakt en komt leeg terug — zie [Upgraden met Helm](#upgraden-met-helm).
- **U laat OneUptime naar een cache wijzen die u zelf beheert** (beheerde Redis, ElastiCache, Memorystore, uw eigen Valkey): lees [Als u uw eigen cache beheert](#als-u-uw-eigen-cache-beheert). Dit is de enige opstelling die uw server ongemerkt niet meer bereikt.
- **U hebt dashboards, alerts, netwerkbeleid of scripts die op de Kubernetes-objectnamen zijn gebaseerd:** die namen veranderen — zie [Upgraden met Helm](#upgraden-met-helm).

### Wat verandert en wat niet

| | Tot en met 12 | Vanaf 13 |
| --- | --- | --- |
| Engine | `redis:7.0.12` | `valkey/valkey:9.1-alpine` |
| Instellingen | `REDIS_*` | `VALKEY_*` — `REDIS_*` wordt nog gelezen |
| Compose-service | `redis` | `valkey` — luistert nog naar de hostnaam `redis` |
| Helm-waarden | `redis:`, `externalRedis:` | `valkey:`, `externalValkey:` — oude sleutels worden nog toegepast |
| Kubernetes-objecten | `<release>-redis`, `<release>-redis-master` | `<release>-valkey`, `<release>-valkey-master` |
| Gegenereerd Secret | `redis-password` in `<release>-redis` | `valkey-password` in `<release>-valkey` |
| Secret voor externe cache | `<release>-external-redis` | `<release>-external-valkey` |

De tien hernoemde instellingen zijn `VALKEY_HOST`, `VALKEY_PORT`, `VALKEY_DB`, `VALKEY_USERNAME`, `VALKEY_PASSWORD`, `VALKEY_IP_FAMILY`, `VALKEY_TLS_CA`, `VALKEY_TLS_CERT`, `VALKEY_TLS_KEY` en `VALKEY_TLS_SENTINEL_MODE`. Staat een instelling onder beide schrijfwijzen, dan geeft de applicatie de voorkeur aan de `VALKEY_*`-variant. De Helm-chart lost het conflict andersom op: een verouderde `redis:`-sleutel wint van de nieuwe standaardwaarde, zodat een waardenbestand dat u nooit hebt aangeraakt zich precies zo gedraagt als voorheen.

**De cache start één keer opnieuw op**, op beide uitrolpaden, omdat de container wordt vervangen. Hij bewaart niets op schijf (`appendonly no`, `save ""`) en komt dus koud terug: gecachete waarden zijn weg, en BullMQ-taken die wachtten, uitgesteld waren of in backoff zaten, gaan verloren. Herhaalbare taken en cron-taken registreren zichzelf opnieuw zodra de verbinding terug is. Upgrade op een rustig moment als lopende telemetrie of nieuwe pogingen van workflows voor u belangrijk zijn.

### Upgraden met Docker Compose

De gebruikelijke update volstaat:

```
git checkout release # Zorg dat u op de release-branch zit.
git pull
npm run update
```

- **Gebruik `--remove-orphans` als u Compose met de hand start.** `npm run update` en `npm run start` geven die optie al mee, en zij verwijdert de oude `redis`-container. Laat u die draaien, dan luisteren twee containers naar de hostnaam `redis` en belanden verbindingen willekeurig op de verouderde.
- **Uw `config.env` wordt niet herschreven.** `npm run update` voegt normaal elke instelling toe die het in `config.example.env` vindt en die in uw bestand ontbreekt, maar het herkent deze tien als hernoemingen en laat uw waarden — ook uw `REDIS_PASSWORD` — precies staan waar ze staan. Het toont welke het heeft behouden.
- Uw eigen sleutels hernoemen naar `VALKEY_*` is optioneel en kan zonder risico later. Stel per instelling maar één schrijfwijze in.
- **Zet u cachevariabelen in een `docker-compose.override.yml`, hernoem ze dan naar `VALKEY_*`.** Het basisbestand zet `VALKEY_HOST` nu op basis van uw `REDIS_HOST`, en de applicatie leest eerst `VALKEY_HOST`, dus een override die alleen `REDIS_HOST` zet, wint niet meer.

### Upgraden met Helm

```
helm repo update
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

- **Er hoeven geen waarden te veranderen.** `redis:` en `externalRedis:` werken nog steeds — wat u daaronder zet, wordt over de nieuwe standaardwaarden van `valkey:` / `externalValkey:` gelegd — en `helm upgrade` toont een `DEPRECATED VALUES`-melding met de gevonden oude sleutels. Hernoem ze wanneer het u uitkomt.
- **Er wordt niets geroteerd.** De chart leest het wachtwoord uit uw bestaande `<release>-redis`-Secret en neemt het mee naar `<release>-valkey` in plaats van een nieuw te genereren.
- **Beide oude Secrets blijven behouden.** `<release>-redis` en, als u uw eigen cache meebrengt, `<release>-external-redis` zijn geannoteerd met `helm.sh/resource-policy: keep` en blijven dus achter met inmiddels ongebruikte kopieën. Verwijder ze zodra de upgrade is beklonken — maar lees eerst [Terugdraaien naar 12](#terugdraaien-naar-12).
- **Objectnamen veranderen.** Werk alles bij dat op `<release>-redis` of `<release>-redis-master` is gebaseerd: Grafana-dashboards, alertregels, NetworkPolicies, ServiceMonitors, back-uptaken.
- De Service wordt ook onder de oude naam `<release>-redis-master` gepubliceerd, zodat pods die nog niet vernieuwd zijn zichzelf opnieuw verbinden in plaats van de hele uitrol lang niets op te lossen. Zet `valkey.legacyServiceAlias: false` om die te laten vervallen zodra alle workloads zijn vernieuwd.
- **Had u `persistence.enabled: true`**, dan claimt de nieuwe StatefulSet een vers volume `data-<release>-valkey-0`. Het oude `data-<release>-redis-0` heeft nooit iets bevat: verwijder het om er niet meer voor te betalen.

### Als u uw eigen cache beheert

OneUptime naar een cache laten wijzen die het zelf niet draait, wordt nog volledig ondersteund, en de server aan de andere kant mag Valkey, Redis of een beheerde Redis-compatibele dienst zijn. Wat verandert, is de naam van het blok dat hem configureert.

- Hernoem `externalRedis:` naar `externalValkey:` in uw waardenbestand. Optioneel — de oude sleutel wordt nog toegepast — maar dit is wat de chart nu documenteert.
- De chart genereert het Secret opnieuw onder de nieuwe naam, `<release>-external-valkey`. Het oude `<release>-external-redis` blijft bestaan en wordt niet meer bijgewerkt; verwijst een eigen manifest ernaar bij naam, richt het dan opnieuw.
- **`extraEnv`-overrides bereiken de cache niet meer — en dat mislukt stilzwijgend.** Wijst u met `extraEnv: [{name: REDIS_HOST, ...}]` naar een beheerde cache in plaats van met het blok `externalValkey:`, dan wint uw regel nog steeds de plek van `REDIS_HOST`, maar de applicatie leest eerst `VALKEY_HOST` — en dat zet de chart op zijn eigen cache in het cluster. Uw override staat in de podspecificatie en wordt genegeerd. Hernoem die regels naar `VALKEY_*`, of verplaats de instellingen naar `externalValkey:`, de ondersteunde manier. `helm upgrade` waarschuwt bij chart-brede `extraEnv`-regels; de lijsten `<service>.extraEnv` per service ziet het niet, dus controleer die zelf. Het Compose-equivalent is een override-bestand dat alleen `REDIS_HOST` zet.

### De upgrade controleren

- **Admin-dashboard → Health → Valkey** hoort «Connected» te tonen, met een geheugenwaarde. Dit is dezelfde bereikbaarheidscontrole die de gezondheidswaarschuwingsmails gebruiken.
- **Compose:** `docker compose ps` toont een `valkey`-service en geen `redis`-container meer.
- **Helm:** `kubectl get pods,svc -n <namespace>` toont `<release>-valkey-0` als Running en de Service `<release>-valkey-master`. `helm get notes my-oneuptime` toont de meldingen van de upgrade opnieuw.
- Voor een diepere blik rapporteert `HelmChart/Public/diagnose.sh` cachegeheugen, evicties en bereikbaarheid, en het herkent zowel de oude als de nieuwe objectnamen.

### Terugdraaien naar 12

- **Helm:** `helm rollback` werkt, omdat de chart van 12 het door haarzelf aangemaakte Secret `<release>-redis` nog op zijn plek aantreft en het wachtwoord hergebruikt. Daarom blijven de oude Secrets behouden — verwijder ze niet voordat u zeker weet dat u op 13 blijft.
- **Docker Compose:** houd de schrijfwijze `REDIS_*` in `config.env` aan tot u het zeker weet. OneUptime 12 leest alleen `REDIS_*`, dus terugdraaien met een `config.env` waarvan u de sleutels hebt hernoemd laat de cache zonder ingesteld wachtwoord starten, open op het Compose-netwerk, terwijl de applicatie zich niet kan authenticeren. Beide schrijfwijzen aanhouden met identieke waarden werkt ook.
- Terugdraaien start de cache opnieuw op, met dezelfde koudestartkosten.

### Namen die bewust Redis zijn gebleven

Dit zijn geen omissies, en geen ervan vraagt actie:

- **De API behoudt haar vorm.** `components.redis` en `summary.redis` in het instantiegezondheidsantwoord, de route `/api/admin/health/redis` en de engine-waarde `redis` in de Query Console van de admin zijn protocolsleutels, geen zichtbare tekst. Alles wat u daarop hebt geautomatiseerd blijft werken.
- **Woordenschat van het Redis-protocol:** `redis-cli`, het veld `redis_version` in `INFO`, en de opgeslagen geheugenreferentie waartegen de gezondheidsmeldingen vergelijken. Die sleutel hernoemen zou de historie van elke instantie weggooien.
- **De standaardhostnaam blijft `redis`**, voor handgeschreven manifesten en kale `docker run`-opstellingen. Hij wordt alleen gebruikt als noch `VALKEY_HOST` noch `REDIS_HOST` is gezet, wat in onze eigen Compose en Helm nooit voorkomt.
- Interne klassennamen en Postgres-kolomnamen, die niemand ziet en waarvan het hernoemen een migratie zou kosten.

## Upgraden van OneUptime 11 → 12

<!-- TODO(i18n): Translate this section. English source: en/installation/upgrading.md (added for the v12 Runner merge). -->

OneUptime 12 merges two components into one. The **Runbook Agent** (the
container you installed on your own hosts to execute runbook steps) and the
**AI Agent** (the service that worked on AI code fixes) are now a single
component: the **OneUptime Runner**, shipped as the `oneuptime/runner`
Docker image. The old `oneuptime/runbook-agent` and `oneuptime/ai-agent`
images are no longer built or published — existing tags remain pullable,
but they will never receive another update.

A Runner is one installed container that can hold several **capabilities**,
toggled per Runner in the dashboard: **Runs Runbooks** (on by default),
**Runs AI Code Fixes** (off by default), and **Runs AI Remediation Commands** (off by
default). Capability changes are adopted on the Runner's next heartbeat —
no restart needed. See [Runners](/docs/runbooks/agents) for how the
component works day to day.

What you need to do depends on how you deployed:

- **Everyone:** read [What happens automatically](#what-happens-automatically)
  and [Dashboard pages moved](#dashboard-pages-moved).
- **You installed Runbook Agents on your hosts:** redeploy them onto the new
  image — see [Redeploy your Runbook Agents](#redeploy-your-runbook-agents).
- **Docker Compose:** environment variable renames plus **one
  security-relevant step** — see [Docker Compose deployments](#docker-compose-deployments).
- **Helm:** a values-file rename that fails validation if skipped — see
  [Helm deployments](#helm-deployments).
- **API keys that were granted agent permissions directly:** re-grant them —
  see [Permissions: teams migrate, API keys do not](#permissions-teams-migrate-api-keys-do-not).

### What happens automatically

No manual database work. On first boot, v12 runs a migration that:

- Renames the Postgres tables and columns (`RunbookAgent` → `Runner`,
  `RunbookAgentJob` → `RunnerJob`, plus the owner, label, and join tables to
  match). Runner ids, keys, and job history are untouched — this is a
  rename, not a re-registration.
- Migrates every **team** permission grant from the old `…RunbookAgent…`
  permission names to the new `…Runner…` names, so team roles keep working
  without reassignment. (Direct API-key grants are the exception — see below.)

The API stays compatible too:

- Requests to `/api/runbook-agent`, `/api/runbook-agent-job`,
  `/api/runbook-agent-owner-team`, and `/api/runbook-agent-owner-user` are
  rewritten server-side onto their `/runner…` equivalents, so existing
  scripts keep working.
- The agent-facing ingest path `/runbook-agent-ingest` is still served
  alongside the new `/runner-ingest`, so **Runbook Agent containers you have
  not redeployed yet keep heartbeating and executing Bash and JavaScript
  steps** against a v12 server. Each one logs a deprecation warning on the
  server naming the agent that should be redeployed.

### Redeploy your Runbook Agents

Your existing agents keep running Bash and JavaScript steps unchanged, so
this does not block the upgrade — but do it soon after:

- **SSH and Kubernetes steps (new in v12) fail on old agents.** The server
  does not exclude old agents from claiming them: an agent still on the
  `runbook-agent` image will claim an SSH or Kubernetes job and fail it with
  `Unsupported step type` — typically mid-incident, when the runbook runs.
  Redeploy the agent **before** authoring SSH or Kubernetes steps that
  target it.
- The old image receives no further updates of any kind.

Redeploying means re-running the install command with the new image and
variable names. The agent's id and key are **unchanged** (same database
row) — swap the names, keep the values:

```bash
docker rm -f oneuptime-runbook-agent

docker run --name oneuptime-runner --restart unless-stopped \
  -e ONEUPTIME_RUNNER_ID=<agent-id> \
  -e ONEUPTIME_RUNNER_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \
  -d oneuptime/runner:release
```

(Or open the Runner in **Settings → Runners** and use **Show setup
instructions** for a pre-filled command.)

If you tuned the agent with environment variables, rename them — the old
names are **silently ignored** by the new image:

| Old (Runbook Agent)                     | New (Runner)                              |
| --------------------------------------- | ----------------------------------------- |
| `RUNBOOK_AGENT_ID`                       | `ONEUPTIME_RUNNER_ID`                     |
| `RUNBOOK_AGENT_KEY`                      | `ONEUPTIME_RUNNER_KEY`                    |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS`         | `ONEUPTIME_RUNNER_POLL_INTERVAL_MS`       |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS`    | `ONEUPTIME_RUNNER_HEARTBEAT_INTERVAL_MS`  |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS`| `ONEUPTIME_RUNNER_JOB_HEARTBEAT_INTERVAL_MS` |
| `RUNBOOK_AGENT_CONCURRENCY`              | `ONEUPTIME_RUNNER_CONCURRENCY`            |

### If you ran the standalone AI Agent

The **Settings → AI → AI Agents** page is gone and the `oneuptime/ai-agent`
image is no longer built. If you had installed an AI Agent container
yourself, replace it with a Runner:

1. Create a Runner under **Settings → Runners** and install it with the
   command from **Show setup instructions**.
2. Enable **Runs AI Code Fixes** on it. The change is picked up on the next
   heartbeat.

Old AI Agent credentials still boot the new `oneuptime/runner` image
through a legacy fallback (code fixes only, with a logged warning telling
you to create a real Runner) — treat that as a bridge during the migration,
not a destination.

### Docker Compose deployments

The compose service `ai-agent` is now `runner`. If you upgrade with the
standard `update.sh` flow, the new variables are appended to your
`config.env` automatically and the stack boots — but read the key warning
below. The renames, if you manage `config.env` or overrides by hand:

| Old                              | New                                |
| -------------------------------- | ---------------------------------- |
| `AI_AGENT_KEY`                   | `ONEUPTIME_RUNNER_KEY`             |
| `AI_AGENT_ONEUPTIME_URL`         | `ONEUPTIME_RUNNER_ONEUPTIME_URL`   |
| `AI_AGENT_PORT`                  | `ONEUPTIME_RUNNER_PORT`            |
| `DISABLE_TELEMETRY_FOR_AI_AGENT` | `DISABLE_TELEMETRY_FOR_RUNNER`     |
| `ENABLE_PROFILING_FOR_AI_AGENT`  | `ENABLE_PROFILING_FOR_RUNNER`      |

The old `AI_AGENT_*` lines can stay in `config.env`; nothing reads them
anymore.

**Important — set `ONEUPTIME_RUNNER_KEY` to a random value.** The template
merge appends it with the literal placeholder
`please-change-this-to-random-value`; your old `AI_AGENT_KEY` value is
**not** carried over. This key registers the instance-wide Runner and
authenticates the AI code-fix protocol — including minting repository
access tokens — so leaving the publicly known placeholder in place is a
security hole. Before starting v12, set it to a long random value (reusing
your old `AI_AGENT_KEY` value is fine).

**Remove the orphaned `ai-agent` container.** `npm start` runs compose with
`--remove-orphans` and cleans it up. If you run `docker compose up -d` by
hand, add `--remove-orphans` (or `docker rm -f` the old container) —
otherwise the old AI Agent keeps running and keeps claiming code-fix work
alongside the new Runner.

### Helm deployments

- Rename the `aiAgent:` block in your values overrides to `runner:`. All
  subkeys (`enabled`, `replicaCount`, `resources`, `keda`, and so on) are
  unchanged. This is a hard break: the chart schema rejects unknown keys,
  so `helm upgrade` **fails validation** while an `aiAgent:` block remains.
- Workload names change from `<release>-ai-agent` to `<release>-runner` —
  update anything keyed on the old names (dashboards, alerts, network
  policies).
- The release secret key changes from `ai-agent-key` to `runner-key`. A
  fresh key is generated on upgrade and the in-cluster Runner re-registers
  itself automatically, so there is nothing to do unless something external
  referenced the old secret value.
- Deliberately unchanged: the KEDA scaling metric is still named
  `oneuptime_ai_agent_queue_size` — do not rename it in custom scalers.

### Permissions: teams migrate, API keys do not

Twelve permissions were renamed (`CreateRunbookAgent` → `CreateRunner`,
`EditRunbookAgent` → `EditRunner`, `DeleteRunbookAgent` → `DeleteRunner`,
`ReadRunbookAgent` → `ReadRunner`, and the same four verbs for
`…RunbookAgentOwnerTeam` → `…RunnerOwnerTeam` and
`…RunbookAgentOwnerUser` → `…RunnerOwnerUser`). Grants held through
**teams** are migrated automatically. Grants attached **directly to an API
key** are not — a key that held one of these twelve permissions loses that
access after the upgrade. Re-grant the new `…Runner…` permissions on those
keys in the dashboard. The `RunbookSecret`, `RunbookCredential`, and
`RunbookExecution` permission families kept their names.

Separately, v12 closes a hole: starting a runbook execution now requires
an authenticated caller with `ProjectOwner`, `ProjectAdmin`,
`ProjectMember`, `CreateRunbookExecution`, `RunbookAdmin`, or
`RunbookMember` — advancing or cancelling one also accepts
`EditRunbookExecution`. Unauthenticated triggering no longer works, and
read-only roles (for example `RunbookViewer`) can no longer start runs —
API automation that triggers runbooks needs `CreateRunbookExecution`.

### Dashboard pages moved

There are no redirects from the old URLs — update bookmarks and internal
wiki links:

| Page                    | Old location                             | New location                              |
| ----------------------- | ---------------------------------------- | ----------------------------------------- |
| Runners (was "Agents")  | Runbooks → Settings → Agents (`…/runbooks/settings/agents`) | Settings → Runners (`…/settings/runners`) |
| Runner Credentials      | Runbooks → Settings → Credentials (`…/runbooks/settings/credentials`) | Settings → Runner Credentials (`…/settings/runner-credentials`) |
| AI Agents               | Settings → AI → AI Agents (`…/settings/ai-agents`) | Removed — Runners with the **Runs AI Code Fixes** capability replace it |

Runbook Secrets stays where it was, under Runbooks → Settings → Secrets.

### New in 12, nothing to enable by accident

v12 adds AI-composed remediation commands: the AI can propose a command
plan and hand it to a Runner for execution. Everything about it is off by
default and stays off until you opt in twice — the project-level **AI
command execution** setting and the per-Runner **Runs AI Remediation Commands**
capability must both be enabled, and only runbooks/rules you configure for
it participate. Upgrading changes nothing here.

> Tip: as with every major upgrade, back up Postgres before upgrading (a
> rollback to v11 means restoring that backup), test in staging first, and
> upgrade step-by-step — 11 → 12, do not skip from older majors.

## Upgraden van OneUptime 10 → 11

<!-- TODO(i18n): Translate this section. English source: en/installation/upgrading.md (added for v11 SSO->Enterprise change). -->

### Identity features (SSO, OIDC, SCIM) now require the Enterprise Edition

In v11, the following authentication and access-management features moved to
the **OneUptime Enterprise Edition** and are no longer part of the free,
open-source (Community) build:

- **SAML SSO** — both project login and status-page login
- **OpenID Connect (OIDC)** — both project login and status-page login
- **SCIM user provisioning** — project and status page
- **Global (instance-wide) SSO / OIDC**
- **Team compliance settings**

**What you'll see after upgrading:** if you configured any of these on a
Community Edition build, sign-in through them is disabled after the upgrade,
and the settings pages show an upgrade prompt instead of the configuration
form. Your existing provider records are **preserved in the database** —
nothing is deleted — they simply become inactive until the instance runs the
Enterprise Edition.

**Availability:**

- **Self-hosted:** requires the **Enterprise Edition** build.
- **OneUptime Cloud:** requires the **Scale** plan (or above).

**If you rely on SSO and self-host**, email
[support@oneuptime.com](mailto:support@oneuptime.com) for an Enterprise Edition
license so you can restore SSO/OIDC/SCIM. Mention that you upgraded from v10 to
v11 and we'll help you get it back online. If your team is mid-upgrade and this
is blocking sign-in, contact us before upgrading production so we can plan it
with you.

OneUptime 11 bouwt de ClickHouse-telemetrieopslag opnieuw op. Deze pagina legt uit wat er verandert, wie actie moet ondernemen en — voor installaties die historische telemetrie willen behouden — elke query die daarvoor nodig is.

### Wat verandert er in v11

Telemetrie (logs, traces, metrics, exceptions, profielen, monitor-logs, audit-logs) verhuist naar nieuwe ClickHouse-tabellen met tijdgebaseerde partitionering, compressiecodecs per kolom en de nieuwe entiteitsmodel-kolommen:

| Oude tabel            | Nieuwe tabel          |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

In elke telemetrietabel worden twee kolommen hernoemd: `serviceId` → `primaryEntityId` en `serviceType` → `primaryEntityType`. Dit is een harde hernoeming — **als u de OneUptime-analytics-API rechtstreeks bevraagt met `serviceId`-/`serviceType`-filters, werk ze dan bij naar de nieuwe namen.** Dashboards, monitors en alerts binnen OneUptime worden automatisch gemigreerd.

De overgang is **uitsluitend voorwaarts**: de nieuwe tabellen beginnen leeg, alle telemetrie die na de upgrade binnenkomt landt er direct in, en de historie vult zich vanzelf weer aan naarmate de tijd verstrijkt. De oude tabellen worden tijdens de upgrade **automatisch verwijderd** om hun schijfruimte vrij te maken — wilt u de mogelijkheid openhouden om de historie mee te nemen, hernoem ze dan **vóór** de upgrade (Stap 0 hieronder).

> **Al op 11.0.0 of 11.0.1?** Die releases behielden de oude tabellen (ze liepen leeg via de TTL, en de kopie kon "op elk moment na de upgrade" worden uitgevoerd). Elke latere update **verwijdert ze bij het opstarten**. Wilt u de historie-kopie nog uitvoeren en hebt u dat nog niet gedaan, voer dan Stap 0 hieronder uit voordat u de update toepast.

### Wie moet iets doen

- **Nieuwe installaties:** niets te doen.
- **Upgrades die geen telemetrie van vóór de upgrade in de interface nodig hebben:** niets te doen. De telemetriepagina's tonen simpelweg data vanaf het moment van de upgrade; de oude tabellen worden tijdens de upgrade verwijderd.
- **Upgrades die telemetrie van vóór de upgrade zichtbaar willen hebben:** hernoem de oude tabellen **vóór** de upgrade (Stap 0 hieronder) en voer daarna op elk gewenst moment de handmatige kopie uit.

Zoals altijd: upgrade hoofdversies stap voor stap (10 → 11, niet overslaan) en maak vóór de upgrade back-ups van Postgres en ClickHouse.

### Optioneel: telemetriehistorie meenemen

Stap 0 voert u uit **vóór de upgrade**; alles vanaf Stap 1 voert u uit **nadat de upgrade volledig is opgestart** (de nieuwe tabellen en hun materialized views moeten bestaan). Maak rechtstreeks verbinding op uw ClickHouse-host — het native protocol kent geen HTTP-timeouts, dus statements van meerdere uren zijn geen probleem:

```bash
clickhouse-client --database oneuptime
```

Goed om te weten voordat u begint:

- De kopie kan veilig draaien terwijl OneUptime live is. Nieuwe telemetrie schrijft onafhankelijk naar de nieuwe tabellen; de gekopieerde historie vult zich erachter aan.
- Reken op uren bij grote schaal (honderden GB's).
- Elk statement hieronder draagt een `insert_deduplication_token`, en de nieuwe tabellen hebben een deduplicatievenster — dus **een statement dat halverwege faalde opnieuw uitvoeren is veilig** (al ingevoegde blokken worden overgeslagen, ook in de metric-rollups), mits u het redelijk snel opnieuw uitvoert. Bij zware live-ingest verdringt het venster (de laatste 10.000 insert-blokken per tabel) uiteindelijk oude tokens.
- Het kopiëren van metrics bouwt ook automatisch de vooraf geaggregeerde dashboard-rollups opnieuw op (elke gekopieerde rij voedt de rollup-materialized-views opnieuw) — daardoor is de metric-kopie trager dan de andere; voer die als laatste uit.

#### Stap 0 — hernoem vóór de upgrade de oude tabellen

De upgrade verwijdert de oude tabellen bij het opstarten, dus haal de tabellen waaruit u wilt kopiëren eerst uit zijn bereik. Stop OneUptime (schaal het deployment naar nul) zodat niets er meer naar schrijft of ze opnieuw kan aanmaken, en hernoem dan — `RENAME TABLE` is een directe metadata-operatie, en `IF EXISTS` laat het blok tabellen overslaan die uw installatie nooit had (deployments ouder dan midden 10.0.x missen mogelijk `AuditLogV1` of sommige `…V2`-tabellen — er is dan geen historie van dat type om te kopiëren):

```sql
RENAME TABLE IF EXISTS LogItemV2 TO LogItemV2_backup;
RENAME TABLE IF EXISTS MetricItemV2 TO MetricItemV2_backup;
RENAME TABLE IF EXISTS SpanItemV2 TO SpanItemV2_backup;
RENAME TABLE IF EXISTS ExceptionItemV2 TO ExceptionItemV2_backup;
RENAME TABLE IF EXISTS ProfileItemV2 TO ProfileItemV2_backup;
RENAME TABLE IF EXISTS ProfileSampleItemV2 TO ProfileSampleItemV2_backup;
RENAME TABLE IF EXISTS MonitorLogV2 TO MonitorLogV2_backup;
RENAME TABLE IF EXISTS AuditLogV1 TO AuditLogV1_backup;
RENAME TABLE IF EXISTS MetricItemAggMV1mByHost TO MetricItemAggMV1mByHost_backup;
```

Voer daarna de upgrade uit en laat OneUptime volledig opstarten voordat u verdergaat.

> Rolt u na het hernoemen terug naar v10 (v10 maakt bij het opstarten lege tabellen met de oude namen opnieuw aan), hernoem de `_backup`-tabellen dan terug naar hun oorspronkelijke namen voordat u v10 herstart — anders landt telemetrie die tijdens de rollback binnenkomt in de opnieuw aangemaakte tabellen en wordt die bij de uiteindelijke upgrade verwijderd.

#### Stap 1 — de bronpartities oplijsten

Elke oude tabel heeft hoogstens 16 partities. Voor elke brontabel:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### Stap 2 — het kopieerstatement genereren

Kolommensets kunnen per installatie iets verschillen (oudere deployments missen mogelijk recent toegevoegde kolommen), dus genereer het statement uit uw live schema in plaats van een vast statement te plakken. Zet `src` en `dst` in de `WITH`-clausule op een van de tabelparen uit de tabel hierboven (de bron draagt het `_backup`-achtervoegsel uit Stap 0) en voer uit:

```sql
WITH 'LogItemV2_backup' AS src, 'LogItemV3' AS dst
SELECT concat(
  'INSERT INTO ', dst, ' (`', arrayStringConcat(groupArray(name), '`, `'), '`)',
  ' SELECT ', arrayStringConcat(groupArray(selectExpr), ', '),
  ' FROM ', src,
  ' WHERE _partition_id = ''{PARTITION}''',
  ' ORDER BY ', (SELECT sorting_key FROM system.tables WHERE database = currentDatabase() AND name = dst), ', _id',
  ' SETTINGS max_execution_time = 0, max_partitions_per_insert_block = 0, insert_deduplication_token = ''v3copy:', dst, ':{PARTITION}'', deduplicate_blocks_in_dependent_materialized_views = 1'
) AS copy_sql
FROM (
  SELECT name,
    multiIf(name = 'primaryEntityId', 'serviceId', name = 'primaryEntityType', 'serviceType', name) AS srcName,
    if(srcName = name, concat('`', name, '`'), concat('`', srcName, '` AS `', name, '`')) AS selectExpr,
    position
  FROM system.columns
  WHERE database = currentDatabase() AND table = dst
    AND srcName IN (SELECT name FROM system.columns WHERE database = currentDatabase() AND table = src)
  ORDER BY position
);
```

Het gegenereerde statement kopieert alleen de kolommen die beide tabellen delen (nieuwe kolommen krijgen hun standaardwaarden), hernoemt `serviceId`/`serviceType` onderweg, sorteert de rijen deterministisch zodat een herhaling identieke, dedupliceerbare blokken oplevert, en heft de limieten voor uitvoeringstijd en partitie-aantal op die een statement van deze omvang nodig heeft.

#### Stap 3 — uitvoeren, partitie voor partitie

Neem het gegenereerde statement en vervang `{PARTITION}` (komt twee keer voor — in de `WHERE` en in het token) door elk partitie-id uit Stap 1. Voer de statements één voor één uit en herhaal daarna Stappen 1–3 voor elk tabelpaar.

> Let op: is een brontabel in Stap 0 overgeslagen omdat die niet op uw installatie bestond, dan faalt Stap 1 voor dat paar met `UNKNOWN_TABLE` — sla het paar gewoon over; er is geen historie van dat type om te kopiëren.

Faalt een statement halverwege, voer dan snel **hetzelfde** statement opnieuw uit — al gecommitte blokken worden gededupliceerd. Voert u het veel later opnieuw uit, vergelijk dan eerst de rijaantallen (Stap 5).

#### Stap 4 (optioneel) — historie van de per-host metric-rollup

Gekopieerde ruwe metric-rijen bouwen de rollups op serviceniveau automatisch opnieuw op, maar niet de **per-host**-rollup (oude rijen hebben geen host-entiteitssleutel). De in Stap 0 hernoemde oude rollup-tabel is de enige bron voor deze historie; neem die mee door de nieuwe sleutel uit de hostnaam te berekenen:

```sql
INSERT INTO MetricItemAggMV1mByHostV2 (projectId, name, hostEntityKey, bucketTime, valueSumState, valueCountState, valueMinState, valueMaxState, retentionDate)
SELECT
  projectId,
  name,
  substring(lower(hex(SHA256(concat(projectId, '|host|host.name=', lower(trimBoth(hostIdentifier)))))), 1, 16) AS hostEntityKey,
  bucketTime,
  valueSumState,
  valueCountState,
  valueMinState,
  valueMaxState,
  retentionDate
FROM MetricItemAggMV1mByHost_backup
ORDER BY projectId, name, hostIdentifier, bucketTime, _id
SETTINGS max_execution_time = 0, insert_deduplication_token = 'v3copy:MetricItemAggMV1mByHostV2:all';
```

De `ORDER BY` doet ertoe: die zorgt dat een herhaling identieke insert-blokken oplevert die het deduplicatietoken kan herkennen. Zonder zou een herhaling stilletjes kunnen worden overgeslagen of dubbel geteld. (Randgeval: hostnamen met `\`, `|` of `=` — geen geldige RFC-1123-hostnaamtekens — zouden een andere sleutel berekenen dan de applicatie; negeer dit tenzij u weet dat u zulke hosts hebt.)

#### Stap 5 — verifiëren

Vergelijk de totalen per tabelpaar (de nieuwe tabel bevat ook rijen van na de upgrade, dus die hoort groter dan of gelijk aan de oude te zijn):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Stap 6 — de back-ups verwijderen

De hernoemde tabellen behouden hun retentie-TTL, dus ze lopen vanzelf leeg en krimpen — maar zodra u tevreden bent met de kopie, verwijdert u ze om de schijfruimte direct vrij te maken:

```sql
DROP TABLE IF EXISTS LogItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS SpanItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ExceptionItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileSampleItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MonitorLogV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS AuditLogV1_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemAggMV1mByHost_backup SETTINGS max_table_size_to_drop = 0;
```

(`max_table_size_to_drop = 0` heft de 50 GB-verwijderbeveiliging van de server op voor alleen dat statement.)

> Tip: test zoals bij elke grote upgrade eerst in een staging-omgeving en bevestig dat telemetrie naar de nieuwe tabellen stroomt voordat u in productie op de kopie vertrouwt.

## Upgraden van OneUptime 9 → 10

Geen wijzigingen die handmatige actie vereisen. Volg gewoon het standaard upgradeproces.

## Upgraden van OneUptime 8 → 9

De Helm-chart provisioneert niet langer een Kubernetes Ingress-resource. OneUptime wordt geleverd met een ingress gateway-container die al TLS beëindigt, statuspaginadomeinen beheert en verkeer voor het platform routeert, zodat een cluster ingress controller niet langer nodig is.

- Verwijder eventuele `oneuptimeIngress`-overschrijvingen uit uw aangepaste `values.yaml`-bestanden voordat u upgradet. Deze sleutels worden nu genegeerd en veroorzaken validatiefouten als ze aanwezig zijn.
- Zorg dat `nginx.service.type` weergeeft hoe u de gebundelde ingress gateway wilt blootstellen (bijvoorbeeld `LoadBalancer`, `NodePort` of `ClusterIP` met een externe load balancer).
- Controleer of eventuele DNS-records voor statuspagina's of primaire hosts nog steeds verwijzen naar de Service of load balancer die de OneUptime ingress gateway beheert.
- Bevestig na de upgrade dat TLS-certificaten blijven verlengen via de ingebedde gateway en dat statuspaginadomeinen correct worden omgezet.

## Upgraden van OneUptime 7 → 8

Als u op Kubernetes draait, zijn er belangrijke ingrijpende wijzigingen:

- We gebruiken de Bitnami-charts voor Postgres, Redis en ClickHouse niet langer vanwege [Bitnami-licentiewijzigingen](https://github.com/bitnami/charts/issues/35164)
- Deze wijzigingen zijn niet achterwaarts compatibel. U moet de nieuwe structuur in de Helm-chart `values.yaml` volgen.
- Maak een back-up van uw gegevens (Postgres, ClickHouse en alle permanente volumes) voordat u upgradet.

> Tip: Test de upgrade eerst in een stagingomgeving. Bevestig dat uw workloads gezond zijn en gegevens intact zijn voordat u productie upgradet.
