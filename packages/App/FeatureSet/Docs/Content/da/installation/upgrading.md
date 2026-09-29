# Opgradering af OneUptime

Denne guide beskriver, hvordan du sikkert opgraderer din selvhostede OneUptime-installation.

## Generel vejledning

- Opgrader trin for trin på tværs af større versioner (f.eks. 6 → 7 → 8). Spring ikke større versioner over.
- Du kan springe mindre/patch-versioner over (f.eks. 8.1 → 8.4), så længe du følger udgivelsesnoterne.
- Tag altid sikkerhedskopier inden opgradering, og valider, at du kan gendanne dem.

<!-- TODO(i18n): Translate this section. English source: en/installation/upgrading.md (added for the Community/Enterprise image split). -->

## Community and Enterprise Edition images

OneUptime now ships the app as two images. The **Community Edition** is open
source under the Apache License 2.0. The **Enterprise Edition** adds the
enterprise modules from the repository's `ee/` directory: SAML SSO, OIDC, SCIM,
team compliance, audit logs and the enterprise Health dashboards in the Admin
Dashboard. Before this change both editions ran the same code, and
`IS_ENTERPRISE_EDITION` decided which features were switched on. Now the image
decides, and the Community image does not contain the `ee/` directory.

The [Enterprise Edition](/docs/self-hosted/enterprise) page has the full
feature comparison, licensing details and what happens when you switch
editions.

### What to do before you upgrade

- **Community Edition without SSO, OIDC or SCIM:** nothing. Upgrade as usual.
- **Helm with `image.type: enterprise-edition`:** nothing. The chart already
  pulls the `enterprise-` images, which now contain the enterprise modules.
- **Docker Compose with `IS_ENTERPRISE_EDITION=true`:** switch to the
  Enterprise image when you upgrade by setting `APP_TAG=enterprise-release`
  (or `enterprise-<version>`) in `config.env`. `APP_TAG=release` is the
  Community image, and `IS_ENTERPRISE_EDITION=true` no longer switches anything
  on. `npm run update` makes this change for you while
  `IS_ENTERPRISE_EDITION=true` (`release` becomes `enterprise-release`, a
  pinned `13.0.7` becomes `enterprise-13.0.7`) and prints what it changed.
  The App now **refuses to start** when `IS_ENTERPRISE_EDITION=true` is set on
  the Community image, instead of silently no longer enforcing "Require SSO",
  SSO, SCIM and audit logging. The error says what to set:
  `APP_TAG=enterprise-<version>` to keep the Enterprise Edition, or
  `IS_ENTERPRISE_EDITION=false` to run the Community Edition.
- **Community image with SSO, OIDC or SCIM already configured:** SSO sign-in
  and SCIM provisioning stop with this upgrade, and "Require SSO for login" is
  no longer enforced. Switch to the Enterprise image to keep them. Otherwise,
  read [Switching from Enterprise to Community](/docs/self-hosted/enterprise#switching-from-enterprise-to-community)
  before you upgrade. It explains how users sign in afterwards and who to
  remove first. To run the Community Edition, also set
  `IS_ENTERPRISE_EDITION=false`.

Your configuration is never deleted, and no migration is needed to switch
editions in either direction.

### Licensing after the upgrade

The Enterprise Edition now checks its license:

- **An install with a license key** keeps working. It checks the license with
  OneUptime when it starts and once a day. If the license expires, everything
  keeps working for a 30-day grace period, and after that the same happens as
  for an install with no license.
- **An install with no license**, for example one that ran the Enterprise
  Edition on `IS_ENTERPRISE_EDITION=true` alone, gets a 14-day trial from the
  first start of this release. **If you use SSO, OIDC, SCIM or audit logging,
  activate a license before the trial ends.** After the trial, SSO and OIDC
  sign-in stop, "Require SSO for login" is no longer enforced (users sign in
  with their password), SCIM provisioning stops and audit logging stops
  recording. Enterprise configuration also becomes read-only and the
  enterprise Health dashboards are locked. Everything resumes, without a
  restart, as soon as you activate a license. The trial is for evaluation:
  production use of the Enterprise Edition requires a OneUptime Enterprise
  subscription. See
  [When a license expires or is missing](/docs/self-hosted/enterprise#when-a-license-expires-or-is-missing).
- **Air-gapped installs** can activate with a signed license token instead of
  a key. See [Offline activation](/docs/self-hosted/enterprise#offline-activation-air-gapped-installs).

### OneUptime Cloud customers

Nothing changes for you. OneUptime Cloud runs the Enterprise Edition, and your
plan still decides which features you get: SSO, OIDC, SCIM and team
compliance on the Scale plan and above, and audit logs on the Enterprise plan.
Projects on the Scale plan now see the SSO, OIDC, SCIM and team compliance
settings that used to show an upgrade prompt.

### API and endpoint changes

- `GET /api/global-config/license` returns the license key, the license token,
  the instance list, the instance ID and version details only to master
  admins. Other callers get the edition and the license status.
- Self-hosted installs no longer serve the license-server endpoints under
  `/api/enterprise-license/`. Only oneuptime.com uses them.
- The SSO, OIDC and SCIM endpoints keep their exact paths on the Enterprise
  Edition, so identity provider configuration does not change. On the
  Community Edition they return `404`. On the Enterprise Edition they refuse
  requests while the license is lapsed (after the trial or grace period), and
  answer again as soon as a license is activated.

## Opgradering fra OneUptime 13 → 14

OneUptime 14 deler applikationen i to udgaver, og det image, du henter, afgør hvilken der kører. **Community Edition** (Apache-2.0, tagsene `release` og `<version>`) indeholder ikke repositoryets `ee/`-mappe: SAML SSO, OpenID Connect, SCIM-provisionering, compliance-indstillinger for teams, revisionslogge, **Health**-dashboardene i administrationen og **Query Console** findes slet ikke i det image. **Enterprise Edition** (tagsene `enterprise-release` og `enterprise-<version>`) indeholder dem og kontrollerer en Enterprise-licens under drift, hvilket OneUptime 13 aldrig gjorde.

[Community and Enterprise Edition images](#community-and-enterprise-edition-images) ovenfor er referencen for denne ændring: hvad hver udgave indeholder, hvad der skal sættes på hver installationsform, og hvad licensen gør. Dette afsnit handler om selve opgraderingen. Opgrader fra 13 — er du stadig på 12, tag 12 → 13 først.

Intet bliver slettet i nogen af udgaverne. Din SSO-, OIDC- og SCIM-konfiguration, dine indstillinger for "Require SSO for login" og de revisionslogge, der allerede er registreret, forbliver i databasen. Community Edition leverer og håndhæver dem blot ikke, og et skift af udgave kræver ingen migrering i nogen retning.

### Det, du skal gøre

1. **Beslut, hvilken udgave denne installation kører.** Bruger du SAML SSO, OpenID Connect, SCIM-provisionering, compliance-indstillinger for teams eller revisionslogge, eller vil du have **Health**-dashboardene i administrationen, er det Enterprise Edition. Ellers er der intet at beslutte: Community Edition er det, du allerede har.
2. **Sæt udgaven i din values-fil med Helm:** `image.type: enterprise-edition` (standarden er `community-edition`). Lad `image.tag` være — charten sætter selv præfikset `enterprise-` på, så `image.tag: release` henter `oneuptime/app:enterprise-release`. Værdien er ikke ny: kører du allerede `enterprise-edition`, er der intet at ændre, for det tag, du i forvejen henter, indeholder nu `ee/`.
3. **Sæt `APP_TAG=enterprise-release` med Docker Compose** (eller `enterprise-<version>` for at fastlåse en version) i `config.env`. `APP_TAG=release` er Community-imaget. Det er dette punkt, der stopper en 13-installation: på 13 var en Compose-Enterprise-installation `APP_TAG=release` plus `IS_ENTERPRISE_EDITION=true`, og den kombination **nægter nu at starte** i stedet for at komme op som Community Edition uden længere at håndhæve din SSO-konfiguration. `npm run update` omskriver `APP_TAG` for dig, så længe `IS_ENTERPRISE_EDITION=true` (`release` bliver `enterprise-release`, et fastlåst `13.0.8` bliver `enterprise-13.0.8`), og skriver, hvad den ændrede. Henter du images manuelt, skal du selv sætte `APP_TAG` først.
4. **Aktivér en licens på Enterprise Edition.** En installation uden licens får en prøveperiode på 14 dage, regnet fra dens første start af Enterprise Edition — ved en opgradering er det dagen, du opgraderer, ikke dagen, du installerede OneUptime. En master-administrator aktiverer fra udgavemærket i administrationens header; installationer uden internetadgang aktiverer med et signeret token. Se [Licensing](/docs/self-hosted/enterprise#licensing).
5. **Skal denne installation køre Community Edition, mens SSO-tvang er konfigureret, så gennemgå adgangene før opgraderingen.** "Require SSO for login" håndhæves ikke længere, login med adgangskode accepteres igen, og enhver, der stadig har en konto og adgang til dens mailboks, kan sætte en adgangskode via "Glemt adgangskode" — også personer, som din identitetsudbyder har fjernet, for SCIM-deprovisionering stopper også. Fjern de brugere først: [Switching from Enterprise to Community](/docs/self-hosted/enterprise#switching-from-enterprise-to-community).
6. **Overvåger du IPv6-adresser med Ping-, Port- eller SSL-monitorer, så gem disse monitorer igen efter opgraderingen.** Destinationer gemt før 14 kan være lagret afkortet — se nedenfor.

### Udgaver: hvad ændrede sig, og hvad gjorde ikke

| | Til og med 13 | Fra 14 |
| --- | --- | --- |
| Enterprise-kode | i alle images; `IS_ENTERPRISE_EDITION=true` slog den til | i `ee/`, og kun i `enterprise-`-imagene |
| Valg i Helm | `image.type` | `image.type` — uændret, men imagene er nu reelt forskellige |
| Valg i Compose | `IS_ENTERPRISE_EDITION=true` | `APP_TAG=enterprise-release` |
| Enterprise-licens | blev aldrig kontrolleret under drift | kontrolleres ved opstart og en gang om dagen |
| SSO-, OIDC- og SCIM-endpoints | samme stier i begge udgaver | samme stier på Enterprise; `404` på Community |
| Din Enterprise-konfiguration | gemt, håndhævet | gemt i begge, håndhævet på Enterprise |

Der kører én migrering: en nullable kolonne `enterpriseEditionFirstSeenAt` på tabellen `GlobalConfig`, som kun har én række, så den er øjeblikkelig. Der er ingen ClickHouse-migrering, intet fjernes, og et skift af udgave kræver ingen migrering i nogen retning.

### Licensforløbet på Enterprise Edition

- **En installation uden licens** kører en prøveperiode på 14 dage, regnet fra den første start af Enterprise Edition. Alle Enterprise-funktioner virker i den periode, og udgavemærket advarer, før den slutter. Prøveperioden er til evaluering: produktionsbrug af Enterprise Edition kræver et abonnement under OneUptime Enterprise License.
- **En licens, der udløber**, får 30 dages henstand fra udløbsdatoen, og i den periode virker alle Enterprise-funktioner, mens udgavemærket advarer.
- **Efter prøveperioden eller efter den henstand**, og indtil en licens aktiveres: login via SSO og OIDC afvises, "Require SSO for login" håndhæves ikke længere (brugerne logger ind med deres adgangskode), din identitetsudbyders SCIM-forespørgsler afvises, og revisionslogningen registrerer ikke længere noget. Enterprise-konfigurationen bliver skrivebeskyttet — du kan stadig se og slette den, deaktivere en SSO- eller OIDC-udbyder og nulstille et SCIM-bearer-token, altså præcis det, en hændelse kræver — og Health-dashboardene og Query Console er låst.
- **Intet slettes, og kerneovervågningen påvirkes aldrig.** Monitorer, alarmer, hændelser, vagtplaner, statussider og telemetri ligger uden for licensen, og login med adgangskode er fortsat muligt for alle brugere, også master-administratorer. Aktiveres en licens, genoprettes SSO-login, SSO-tvang, SCIM-provisionering og revisionslogning med den konfiguration, du allerede har — uden genstart.
- **En licensnøgle, du allerede har, accepteres** som en "unverified" licens: udløbsdato og pladsgrænse kommer fra det, licensserveren allerede har oplyst denne installation, og efter det udløb gælder samme henstand på 30 dage. Licenser, der udstedes fra nu af, er signerede og kontrolleres af applikationen selv. Denne opgradering kræver ingen ny nøgle.
- **En nøgle, som denne installation aldrig har fået registreret en udløbsdato for**, virker prøveperioden ud i stedet for at stoppe. Licensserveren skriver nøglen og udløbsdatoen hver for sig, så en installation kan have en nøgle, den aldrig har fået oplyst en udløbsdato for. Den installation behandles præcis som en uden licens: alle Enterprise-funktioner virker i prøveperioden på 14 dage, regnet fra den første start af Enterprise Edition, og efter prøveperioden sker det samme som ovenfor. Pladsgrænsen håndhæves ikke, så længe licensen er i den tilstand, fordi den licensoplysning, installationen har, allerede er ufuldstændig. Aktiverer en master-administrator licensen igen fra udgavemærket, eller henter den daglige licenssynkronisering udløbsdatoen fra oneuptime.com, er alt genoprettet uden genstart.

Den fulde tilstandstabel står i [When a license expires or is missing](/docs/self-hosted/enterprise#when-a-license-expires-or-is-missing).

### Docker Compose: vælg image-tagget

```
git checkout release # Sørg for, at du er på release-branchen.
git pull
npm run update
```

- **`npm run update` flytter `APP_TAG`, så længe `IS_ENTERPRISE_EDITION=true`**, til Enterprise-imaget for samme udgivelse, og skriver, hvad den ændrede. Dine kommentarer og citationstegn bevares, et `APP_TAG`, der allerede er et `enterprise-`-tag, røres ikke, og en anden kørsel ændrer intet.
- **Henter du imagene manuelt, springes det over**, og applikationen afslutter så ved opstart med en fejl, der nøjagtigt siger, hvad der skal sættes: `APP_TAG=enterprise-<version>` for at beholde Enterprise Edition, eller `IS_ENTERPRISE_EDITION=false` for at køre Community Edition.
- **Vil du bevidst over på Community Edition**, sæt `APP_TAG=release` og `IS_ENTERPRISE_EDITION=false`. Læs punkt 5 først, hvis denne installation håndhæver SSO.
- Ellers skal der intet ændres i `config.env` for denne udgivelse.

### Helm: vælg image-typen

```
helm repo update
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

- **En installation, der allerede kører `image.type: enterprise-edition`, skal ikke ændre nogen værdier.** Charten har længe sat præfikset på tagget; det nye er, at `enterprise-`-imagene indeholder `ee/`. Fra denne udgivelse gælder licensen for dem efter forløbet ovenfor.
- **`image.tag: release` er standarden**, så en chart, der står på det flydende tag, går over til 14 ved næste opgradering uden nogen ændring af værdier. Har den installation SSO, OIDC eller SCIM konfigureret på `community-edition`, sæt da `image.type: enterprise-edition` i samme opgradering.
- **`IS_ENTERPRISE_EDITION` sættes stadig af charten**, udledt af `image.type`, så de to aldrig kan være i modstrid. Den styrer intet. At tvinge den til `true` via `extraEnv` på et Community-image får kun applikationen til at nægte at starte. Sæt aldrig `ONEUPTIME_EDITION` via charten.
- **Chartens prober respekterer igen `probes.<key>.allowPrivateNetworkMonitors`** ([#3879](https://github.com/OneUptime/oneuptime/issues/3879)). Intet ændrer sig, hvis du ikke sætter værdien — den er stadig `false` — og den gælder monitorer fra **alle projekter** på instansen, fordi chartens prober er globale prober. Loopback, link-local og `169.254.169.254` er blokeret uanset værdien.

### Andre ændringer i 14

- **OTLP-indtag bekræfter først en batch, når køen har accepteret den.** 13 svarede `200` først og lagde i kø bagefter, så en batch, køen afviste, gik tabt i stilhed. 14 svarer `503` med `Telemetry queue unavailable. Please retry.`, og gRPC-endpointet returnerer `UNAVAILABLE`; begge kan forsøges igen, og eksportører forsøger igen. Det gælder logge, metrikker, traces og profiler. Der skal intet gøres, men eksportørernes genforsøg og modtryk i køen bliver nu synlige, hvor data før forsvandt — værd at vide, hvis du dimensionerer indtagskapacitet.
- **Health-dashboardene og Query Console i administrationen kræver Enterprise Edition**, ligesom health-alarmerne for PostgreSQL og Valkey. På 13 fulgte de med `IS_ENTERPRISE_EDITION=true` alene, så for en Community-installation, der brugte dem, er det et synligt tab. ClickHouse-kapacitetsvisningen med oprydning, migreringsstatus, globale prober og support-bundtet findes i begge udgaver.
- **HTTPS-monitorer, der rammer en IP-adresse gennem en probes proxy, virker igen.** Proben sendte IP'en som TLS-servernavn; en IP er ikke et gyldigt servernavn, og Node afviser det blankt, så en monitor på `https://<privat IP>` fra en global probe med `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS` fejlede i handshaket. Proben udelader nu servernavnet ved et IP-mål og kontrollerer certifikatet mod selve IP'en. Mål med værtsnavn er uændrede.
- **`oneuptime`-CLI'en oplyser sin rigtige version** ved `--version` i stedet for en pladsholder.
- Hvilke endpoints er flyttet eller strammet, herunder `GET /api/global-config/license` og licensserver-endpointene, som selv-hostede installationer ikke længere udstiller, står ovenfor under [API and endpoint changes](#api-and-endpoint-changes).

### IPv6-monitorer: Ping, Port og SSL

En Ping- eller Port-destination, der blev indsat med mellemrum omkring — netop hvad man får, når man kopierer en adresse fra et looking glass eller en routerkonfiguration — blev gemt afkortet: `2001:518:2800:9::2 ` blev værten `2001` med port `518`. Begge halvdele er lovlige, så intet fejlede, og der blev ikke vist nogen fejl; monitoren overvågede blot en vært, ingen havde tastet. IPv4-adresser var aldrig berørt, fordi der ikke er noget kolon at dele ved. 14 retter fortolkningen og retter samtidig, at IPv6-Ping-monitorer på macOS- og FreeBSD-prober fejlede øjeblikkeligt og permanent (og blev meldt som reelle nedbrud), og at IPv6-SSL-monitorer fejlede med `ENOTFOUND`.

Der findes ingen migrering for destinationer, der allerede er gemt, så **åbn hver IPv6-monitor for Ping, Port og SSL efter opgraderingen og gem den igen**, og kontrollér den viste destination. Forvent, at monitorer, der fejlede permanent på macOS- eller FreeBSD-prober, begynder at melde sandheden — det kan lukke hændelser eller åbne nye.

### Kontrollér udgave og licens

- **Udgavemærket i administrationens header** oplyser den kørende udgave og på Enterprise Edition også licensstatussen.
- **Compose:** `docker compose images` viser de kørende tags — på Enterprise Edition bærer hvert OneUptime-image præfikset `enterprise-`.
- **Helm:** `kubectl get pods -n <namespace> -o jsonpath='{..image}'` skriver de images, podsene kører; samme præfiksregel gælder.
- SSO-, OIDC- og SCIM-endpointene adskiller de to tilfælde: `404` betyder, at imaget ikke indeholder `ee/` (Community Edition), mens `402` eller `403` betyder, at Enterprise Edition kører med en licens, der kræver opmærksomhed.

### Tilbagerulning til 13

- Begge udgaver og begge udgivelser læser samme data, og den eneste skemaændring er en nullable kolonne, som 13 ignorerer, så at rulle imagene tilbage kræver intet databasearbejde.
- **Docker Compose:** sæt `APP_TAG` tilbage til det 13-tag, du kørte (`13.0.8` eller `enterprise-13.0.8`), og kør `npm run update`. På 13 er det `IS_ENTERPRISE_EDITION=true`, der slår Enterprise-funktionerne til, så sæt den tilbage, hvis du havde den.
- **Helm:** `helm rollback my-oneuptime`, eller fastlås `image.tag` til `13.0.8`.
- At køre 14 rører ikke din Enterprise-konfiguration, så en tilbagerulning finder den, som den var.

> Tip: aktivér licensen på Enterprise Edition den dag, du opgraderer, frem for ved prøveperiodens slutning. Det er aktiveringen, der holder single sign-on håndhævet, og prøveperioden regnes fra denne opgradering, ikke fra datoen for din oprindelige installation.

## Opgradering fra OneUptime 12 → 13

OneUptime 13 erstatter Redis med [Valkey](https://valkey.io) som den medfølgende cache- og kømotor. Redis 7.4 forlod BSD-licensen, og størstedelen af de oprindelige Redis-bidragydere arbejder nu på Valkey, en fork af Redis 7.2, der taler den samme protokol. Intet over socket-niveau er ændret, og du kan stadig pege OneUptime på et rigtigt Redis eller en hostet Redis-kompatibel tjeneste, hvis du foretrækker det.

Alt, hvad du konfigurerer, er nu opkaldt efter det: indstillingerne hedder `VALKEY_*`, Helm-værdierne er `valkey:` / `externalValkey:`, og Kubernetes-objekterne er `<release>-valkey*`. **Alle de gamle navne virker fortsat**, så en urørt `config.env` eller `values.yaml` kan opgraderes og kører videre. Der er ingen konfiguration, du er nødt til at rette, og ingen data at migrere — cachen er ikke en kilde til sandhed, og Postgres og ClickHouse er uberørte.

Hvad du skal gøre, afhænger af, hvordan du har installeret:

- **Docker Compose:** opgrader som sædvanligt, med ét flag der betyder noget — se [Opgradering med Docker Compose](#opgradering-med-docker-compose).
- **Helm:** ingen ændring af værdier, men cache-poden genskabes og kommer tom tilbage — se [Opgradering med Helm](#opgradering-med-helm).
- **Du peger OneUptime på en cache, du selv driver** (hostet Redis, ElastiCache, Memorystore, dit eget Valkey): læs [Hvis du driver din egen cache](#hvis-du-driver-din-egen-cache). Det er den ene opsætning, der uden varsel kan holde op med at nå din server.
- **Du har dashboards, alarmer, netværkspolitikker eller scripts, der bygger på Kubernetes-objektnavnene:** de navne ændrer sig — se [Opgradering med Helm](#opgradering-med-helm).

### Hvad der ændrede sig, og hvad der ikke gjorde

| | Til og med 12 | Fra 13 |
| --- | --- | --- |
| Motor | `redis:7.0.12` | `valkey/valkey:9.1-alpine` |
| Indstillinger | `REDIS_*` | `VALKEY_*` — `REDIS_*` læses stadig |
| Compose-tjeneste | `redis` | `valkey` — svarer stadig på værtsnavnet `redis` |
| Helm-værdier | `redis:`, `externalRedis:` | `valkey:`, `externalValkey:` — de gamle nøgler gælder stadig |
| Kubernetes-objekter | `<release>-redis`, `<release>-redis-master` | `<release>-valkey`, `<release>-valkey-master` |
| Genereret Secret | `redis-password` i `<release>-redis` | `valkey-password` i `<release>-valkey` |
| Secret til ekstern cache | `<release>-external-redis` | `<release>-external-valkey` |

De ti omdøbte indstillinger er `VALKEY_HOST`, `VALKEY_PORT`, `VALKEY_DB`, `VALKEY_USERNAME`, `VALKEY_PASSWORD`, `VALKEY_IP_FAMILY`, `VALKEY_TLS_CA`, `VALKEY_TLS_CERT`, `VALKEY_TLS_KEY` og `VALKEY_TLS_SENTINEL_MODE`. Findes en indstilling under begge stavemåder, foretrækker applikationen `VALKEY_*`-varianten. Helm-chartet afgør konflikten omvendt: en gammel `redis:`-nøgle vinder over den nye standardværdi, så en værdifil, du aldrig har rørt, opfører sig præcis som før.

**Cachen genstarter én gang**, på begge installationsveje, fordi containeren udskiftes. Den gemmer intet på disken (`appendonly no`, `save ""`), så den kommer kold tilbage: cachede værdier er væk, og BullMQ-job, der ventede, var udskudt eller i backoff, går tabt. Gentagne job og cron-job registrerer sig selv igen ved genforbindelse. Opgrader på et roligt tidspunkt, hvis igangværende telemetri eller genforsøg i workflows betyder noget for dig.

### Opgradering med Docker Compose

Den sædvanlige opdatering er nok:

```
git checkout release # Sørg for, at du er på release-branchen.
git pull
npm run update
```

- **Brug `--remove-orphans`, hvis du kører Compose i hånden.** `npm run update` og `npm run start` sender den allerede med, og det er den, der fjerner den gamle `redis`-container. Lader du den køre videre, svarer to containere på værtsnavnet `redis`, og forbindelserne rammer den forældede tilfældigt.
- **Din `config.env` bliver ikke skrevet om.** `npm run update` tilføjer normalt enhver indstilling, den finder i `config.example.env`, og som mangler i din fil, men den genkender disse ti som omdøbninger og lader dine værdier — inklusive din `REDIS_PASSWORD` — blive præcis, hvor de er. Den skriver ud, hvilke den beholdt.
- At omdøbe dine egne nøgler til `VALKEY_*` er valgfrit og kan roligt gøres senere. Sæt kun én stavemåde pr. indstilling.
- **Sætter du cache-variabler i en `docker-compose.override.yml`, så omdøb dem til `VALKEY_*`.** Basisfilen sætter nu `VALKEY_HOST` ud fra din `REDIS_HOST`, og applikationen læser `VALKEY_HOST` først, så en override, der kun sætter `REDIS_HOST`, vinder ikke længere.

### Opgradering med Helm

```
helm repo update
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

- **Der skal ikke ændres værdier.** `redis:` og `externalRedis:` virker fortsat — det, du sætter under dem, lægges oven på de nye standardværdier fra `valkey:` / `externalValkey:` — og `helm upgrade` skriver en `DEPRECATED VALUES`-besked med de gamle nøgler, den fandt. Omdøb dem, når det passer dig.
- **Intet roteres.** Chartet læser adgangskoden fra din eksisterende `<release>-redis`-Secret og fører den videre til `<release>-valkey` i stedet for at generere en ny.
- **Begge gamle Secrets bevares.** `<release>-redis` og — hvis du selv medbringer en cache — `<release>-external-redis` er annoteret med `helm.sh/resource-policy: keep`, så de bliver liggende med nu ubrugte kopier. Slet dem, når opgraderingen har sat sig, men læs først [Rulle tilbage til 12](#rulle-tilbage-til-12).
- **Objektnavnene ændrer sig.** Opdater alt, der bygger på `<release>-redis` eller `<release>-redis-master`: Grafana-dashboards, alarmregler, NetworkPolicies, ServiceMonitors, backupjob.
- Servicen udstilles også under sit gamle navn, `<release>-redis-master`, så pods, der endnu ikke er rullet, forbinder sig selv igen i stedet for slet ikke at kunne slå noget op, mens udrulningen står på. Sæt `valkey.legacyServiceAlias: false` for at fjerne den, når alle workloads er rullet.
- **Havde du `persistence.enabled: true`**, beder det nye StatefulSet om et frisk volumen, `data-<release>-valkey-0`. Det gamle `data-<release>-redis-0` har aldrig indeholdt noget — slet det, så du ikke betaler for det.

### Hvis du driver din egen cache

At pege OneUptime på en cache, den ikke selv kører, er fortsat fuldt understøttet, og serveren i den anden ende må gerne være Valkey, Redis eller en hostet Redis-kompatibel tjeneste. Det, der ændrer sig, er navnet på den blok, der konfigurerer den.

- Omdøb `externalRedis:` til `externalValkey:` i din værdifil. Valgfrit — den gamle nøgle gælder stadig — men det er, hvad chartet dokumenterer nu.
- Chartet genskaber den Secret under det nye navn, `<release>-external-valkey`. Den gamle `<release>-external-redis` bevares og opdateres ikke længere, så hvis nogen af dine egne manifester henviser til den ved navn, så peg dem om.
- **`extraEnv`-overrides når ikke længere cachen — og det fejler i stilhed.** Peger du på en hostet cache med `extraEnv: [{name: REDIS_HOST, ...}]` i stedet for blokken `externalValkey:`, vinder din post stadig pladsen `REDIS_HOST`, men applikationen læser `VALKEY_HOST` først — og den sætter chartet til sin egen cache i klyngen. Din override står i pod-specifikationen og ignoreres. Omdøb posterne til `VALKEY_*`, eller flyt indstillingerne ind i `externalValkey:`, som er den understøttede vej. `helm upgrade` advarer om `extraEnv`-poster på chart-niveau; det kan ikke se listerne `<service>.extraEnv` for de enkelte tjenester, så dem må du selv tjekke. Modstykket i Compose er en override-fil, der kun sætter `REDIS_HOST`.

### Kontrollér opgraderingen

- **Admin-dashboard → Health → Valkey** bør vise «Connected» sammen med et hukommelsestal. Det er den samme tilgængelighedskontrol, som e-mailadvarslerne om sundhed bruger.
- **Compose:** `docker compose ps` viser en `valkey`-tjeneste og ingen `redis`-container.
- **Helm:** `kubectl get pods,svc -n <namespace>` viser `<release>-valkey-0` som Running og servicen `<release>-valkey-master`. `helm get notes my-oneuptime` gentager de beskeder, opgraderingen skrev.
- Vil du grave dybere, rapporterer `HelmChart/Public/diagnose.sh` cachehukommelse, evictions og forbindelse, og den forstår både de gamle og de nye objektnavne.

### Rulle tilbage til 12

- **Helm:** `helm rollback` virker, fordi chartet til 12 finder den `<release>-redis`-Secret, det selv oprettede, stadig på plads og genbruger adgangskoden. Det er derfor, de gamle Secrets bevares — slet dem ikke, før du er sikker på, at du bliver på 13.
- **Docker Compose:** behold stavemåden `REDIS_*` i `config.env`, indtil du er sikker. OneUptime 12 læser kun `REDIS_*`, så en tilbagerulning med en `config.env`, hvor du har omdøbt nøglerne, efterlader cachen uden konfigureret adgangskode, åben på Compose-netværket, mens applikationen ikke kan logge på. At beholde begge stavemåder med samme værdier virker også.
- En tilbagerulning genstarter cachen igen, med samme omkostning ved kold start.

### Navne, der bevidst forblev Redis

Det er ikke forglemmelser, og ingen af dem kræver handling:

- **API'et bevarer sin form.** `components.redis` og `summary.redis` i instansens sundhedssvar, ruten `/api/admin/health/redis` og motorværdien `redis` i administrationens forespørgselskonsol er protokolnøgler, ikke visningstekst. Alt, du har scriptet mod dem, virker fortsat.
- **Ordforråd fra Redis-protokollen:** `redis-cli`, feltet `redis_version` i `INFO` og den gemte hukommelsesreference, som sundhedsnotifikationerne sammenligner med. At omdøbe den nøgle ville kaste hver instans' historik væk.
- **Standardværtsnavnet er stadig `redis`**, af hensyn til håndskrevne manifester og rene `docker run`-opsætninger. Det bruges kun, når hverken `VALKEY_HOST` eller `REDIS_HOST` er sat, hvilket aldrig sker i vores eget Compose eller Helm.
- Interne klassenavne og Postgres-kolonnenavne, som ingen ser, og hvis omdøbning ville koste en migrering.

## Opgradering fra OneUptime 11 → 12

<!-- TODO(i18n): Translate this section. English source: en/installation/upgrading.md (added for the v12 Runner merge). -->

OneUptime 12 merges two components into one. The **Runbook Agent** (the
container you installed on your own hosts to execute runbook steps) and the
**AI Agent** (the service that worked on AI code fixes) are now a single
component: the **OneUptime Runner**, shipped as the `oneuptime/runner`
Docker image. The old `oneuptime/runbook-agent` and `oneuptime/ai-agent`
images are no longer built or published — existing tags remain pullable,
but they will never receive another update.

A Runner is one installed container that can hold several **capabilities**,
toggled per Runner in the dashboard: **Kører runbooks** (on by default),
**Kører AI-koderettelser** (off by default), and **Kører AI-afhjælpningskommandoer** (off by
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

(Or open the Runner in **Indstillinger → Runbook-agenter** and use **Vis
opsætningsvejledning** for a pre-filled command.)

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

The **Indstillinger → AI → AI-agenter** page is gone and the `oneuptime/ai-agent`
image is no longer built. If you had installed an AI Agent container
yourself, replace it with a Runner:

1. Create a Runner under **Indstillinger → Runbook-agenter** and install it with the
   command from **Vis opsætningsvejledning**.
2. Enable **Kører AI-koderettelser** on it. The change is picked up on the next
   heartbeat.

Old AI Agent credentials still boot the new `oneuptime/runner` image
through a legacy fallback (code fixes only, with a logged warning telling
you to create a real Runner) — treat that as a bridge during the migration,
not a destination.

### Docker Compose deployments

The compose service `ai-agent` is now `runner`. If you upgrade with the
standard `npm run update` flow, the new variables are appended to your
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
| Runners (was "Agents")  | Runbooks → Indstillinger → Agenter (`…/runbooks/settings/agents`) | Indstillinger → Runbook-agenter (`…/settings/runners`) |
| Runner Credentials      | Runbooks → Indstillinger → Loginoplysninger (`…/runbooks/settings/credentials`) | Indstillinger → Runner Credentials (`…/settings/runner-credentials`) |
| AI Agents               | Indstillinger → AI → AI-agenter (`…/settings/ai-agents`) | Removed — Runners with the **Kører AI-koderettelser** capability replace it |

Runbook Secrets stays where it was, under Runbooks → Indstillinger → Hemmeligheder.

### New in 12, nothing to enable by accident

v12 adds AI-composed remediation commands: the AI can propose a command
plan and hand it to a Runner for execution. Everything about it is off by
default and stays off until you opt in twice — the project-level **AI
command execution** setting and the per-Runner **Kører AI-afhjælpningskommandoer**
capability must both be enabled, and only runbooks/rules you configure for
it participate. Upgrading changes nothing here.

> Tip: as with every major upgrade, back up Postgres before upgrading (a
> rollback to v11 means restoring that backup), test in staging first, and
> upgrade step-by-step — 11 → 12, do not skip from older majors.

## Opgradering fra OneUptime 10 → 11

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
Community Edition build, the settings pages show an upgrade prompt instead of
the configuration form, and the configuration can no longer be changed. Until
the Community and Enterprise images were split, providers you had already
configured could keep signing users in on a Community build, because it still
contained the sign-in code. The Community image no longer contains any SSO,
OIDC or SCIM code, so sign-in through them stops once you upgrade to it — see
[Community and Enterprise Edition images](#community-and-enterprise-edition-images).
Your existing provider records are **preserved in the database** — nothing is
deleted — and they work again as soon as the instance runs the Enterprise
Edition.

**Availability:**

- **Self-hosted:** requires the **Enterprise Edition** build.
- **OneUptime Cloud:** requires the **Scale** plan (or above).

**If you rely on SSO and self-host**, email
[support@oneuptime.com](mailto:support@oneuptime.com) for an Enterprise Edition
license so you can restore SSO/OIDC/SCIM. Mention that you upgraded from v10 to
v11 and we'll help you get it back online. If your team is mid-upgrade and this
is blocking sign-in, contact us before upgrading production so we can plan it
with you.

OneUptime 11 genopbygger ClickHouse-telemetrilageret. Denne side forklarer, hvad der ændres, hvem der skal handle, og — for installationer der vil bevare historisk telemetri — hver eneste forespørgsel, der skal til.

### Hvad ændres i v11

Telemetri (logs, traces, metrikker, exceptions, profiler, monitor-logs, audit-logs) flyttes til nye ClickHouse-tabeller med tidsbaseret partitionering, komprimeringscodecs pr. kolonne og de nye entitetsmodel-kolonner:

| Gammel tabel          | Ny tabel              |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

To kolonner omdøbes i alle telemetritabeller: `serviceId` → `primaryEntityId` og `serviceType` → `primaryEntityType`. Det er en hård omdøbning — **hvis du forespørger OneUptimes analytics-API direkte med `serviceId`-/`serviceType`-filtre, skal du opdatere dem til de nye navne.** Dashboards, monitors og alerts inde i OneUptime migreres automatisk.

Skiftet er **kun fremadrettet**: de nye tabeller starter tomme, al telemetri der indtages efter opgraderingen lander straks i dem, og historikken fyldes naturligt op med tiden. De gamle tabeller **slettes automatisk** under opgraderingen for at frigive deres diskplads — vil du beholde muligheden for at tage historikken med, så omdøb dem **før** opgraderingen (Trin 0 nedenfor).

> **Allerede på 11.0.0 eller 11.0.1?** Disse udgivelser beholdt de gamle tabeller (de tømtes via TTL, og kopien kunne køres "når som helst efter opgraderingen"). Enhver senere opdatering **sletter dem ved opstart**. Hvis du stadig vil lave historik-kopien og ikke har gjort det endnu, så udfør Trin 0 nedenfor, før du anvender opdateringen.

### Hvem skal gøre noget

- **Nyinstallationer:** intet at gøre.
- **Opgraderinger der ikke behøver telemetri fra før opgraderingen i brugerfladen:** intet at gøre. Telemetrisiderne viser blot data fra opgraderingstidspunktet og frem; de gamle tabeller slettes under opgraderingen.
- **Opgraderinger der vil kunne se telemetri fra før opgraderingen:** omdøb de gamle tabeller **før** opgraderingen (Trin 0 nedenfor), og kør derefter den manuelle kopi når som helst bagefter.

Som altid: opgradér hovedversioner trin for trin (10 → 11, spring ikke over), og tag backup af Postgres og ClickHouse før opgraderingen.

### Valgfrit: tag telemetrihistorikken med

Trin 0 udføres **før opgraderingen**; alt fra Trin 1 og frem udføres, **efter at opgraderingen er startet helt op** (de nye tabeller og deres materialized views skal eksistere). Forbind direkte på din ClickHouse-host — den native protokol har ingen HTTP-timeouts, så statements der tager flere timer er uproblematiske:

```bash
clickhouse-client --database oneuptime
```

Godt at vide, før du går i gang:

- Kopien kan køres sikkert, mens OneUptime er live. Ny telemetri skrives uafhængigt til de nye tabeller; den kopierede historik fylder op bagved.
- Forvent timer ved stor skala (hundredvis af GB).
- Hvert statement nedenfor bærer et `insert_deduplication_token`, og de nye tabeller leveres med et deduplikeringsvindue — så **det er sikkert at genkøre et statement, der fejlede undervejs** (allerede indsatte blokke springes over, også i metrik-rollups), forudsat at du genkører det rimelig hurtigt. Under kraftig live-indtagelse fortrænger vinduet (de seneste 10.000 insert-blokke pr. tabel) til sidst gamle tokens.
- Kopiering af metrikker genopbygger også automatisk de præaggregerede dashboard-rollups (hver kopieret række fodrer rollup-materialized-views igen) — det gør metrik-kopien langsommere end de andre; kør den til sidst.

#### Trin 0 — omdøb de gamle tabeller før opgraderingen

Opgraderingen sletter de gamle tabeller ved opstart, så flyt først dem, du vil kopiere fra, uden for dens rækkevidde. Stop OneUptime (skaler deploymentet ned) så intet skriver til dem eller kan genskabe dem, og omdøb derefter — `RENAME TABLE` er en øjeblikkelig metadata-operation, og `IF EXISTS` lader blokken springe tabeller over, som din installation aldrig har haft (deployments ældre end midt i 10.0.x mangler muligvis `AuditLogV1` eller nogle `…V2`-tabeller — så findes der ingen historik af den type at kopiere):

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

Opgradér derefter, og lad OneUptime starte helt op, før du fortsætter.

> Ruller du tilbage til v10 efter omdøbningen (v10 genskaber tomme tabeller med de gamle navne ved opstart), så omdøb `_backup`-tabellerne tilbage til deres oprindelige navne, før du genstarter v10 — ellers lander telemetri indtaget under tilbagerulningen i de genskabte tabeller og slettes ved den senere opgradering.

#### Trin 1 — list kildepartitionerne

Hver gammel tabel har højst 16 partitioner. For hver kildetabel:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### Trin 2 — generér kopi-statementet

Kolonnesættene kan variere en smule mellem installationer (ældre deployments kan mangle nyligt tilføjede kolonner), så generér statementet ud fra dit live-skema i stedet for at indsætte et fast. Sæt `src` og `dst` i `WITH`-klausulen til et af tabelparrene fra tabellen ovenfor (kilden bærer `_backup`-suffikset fra Trin 0), og kør:

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

Det genererede statement kopierer kun de kolonner, begge tabeller deler (nye kolonner får deres standardværdier), omdøber `serviceId`/`serviceType` undervejs, sorterer rækkerne deterministisk, så en genkørsel producerer identiske, deduplikerbare blokke, og ophæver de grænser for køretid og partitionsantal, som et statement af denne størrelse kræver.

#### Trin 3 — kør det, én partition ad gangen

Tag det genererede statement og erstat `{PARTITION}` (det optræder to gange — i `WHERE` og i tokenet) med hvert partitions-id fra Trin 1. Kør statements ét ad gangen, og gentag derefter Trin 1–3 for hvert tabelpar.

> Bemærk: blev en kildetabel sprunget over i Trin 0, fordi den ikke fandtes på din installation, fejler Trin 1 med `UNKNOWN_TABLE` for det par — spring blot parret over; der findes ingen historik af den type at kopiere.

Fejler et statement undervejs, så genkør hurtigt **det samme** statement — allerede committede blokke deduplikeres. Genkører du meget senere, så sammenlign først rækkeantallene (Trin 5).

#### Trin 4 (valgfrit) — historik for metrik-rollup pr. host

Kopierede rå metrikrækker genopbygger automatisk rollups på serviceniveau, men ikke **pr.-host**-rollupen (gamle rækker har ingen host-entitetsnøgle). Den gamle rollup-tabel, der blev omdøbt i Trin 0, er den eneste kilde til denne historik; tag den med ved at beregne den nye nøgle ud fra hostnavnet:

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

`ORDER BY` betyder noget: den sikrer, at en genkørsel producerer identiske insert-blokke, som deduplikeringstokenet kan genkende. Uden den kunne en genkørsel blive sprunget lydløst over eller talt dobbelt. (Kanttilfælde: hostnavne med `\`, `|` eller `=` — ikke gyldige RFC-1123-hostnavnstegn — ville beregne en anden nøgle end applikationen; ignorér det, medmindre du ved, at du har sådanne hosts.)

#### Trin 5 — verificér

Sammenlign totalerne pr. tabelpar (den nye tabel indeholder også rækker fra efter opgraderingen, så den bør være større end eller lig den gamle):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Trin 6 — slet backupperne

De omdøbte tabeller beholder deres retentions-TTL, så de tømmes og skrumper af sig selv — men så snart du er tilfreds med kopien, kan du slette dem og frigive disken med det samme:

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

(`max_table_size_to_drop = 0` ophæver serverens 50 GB-sletbeskyttelse for netop det statement.)

> Tip: test som ved enhver større opgradering først i et staging-miljø, og bekræft at telemetri strømmer ind i de nye tabeller, før du stoler på kopien i produktion.

## Opgradering fra OneUptime 9 → 10

Ingen ændringer, der kræver manuel handling. Følg blot den almindelige opgraderingsproces.

## Opgradering fra OneUptime 8 → 9

Helm-chartet klargører ikke længere en Kubernetes Ingress-ressource. OneUptime leverer en ingress gateway-container, der allerede afslutter TLS, administrerer statusside-domæner og dirigerer trafik til platformen, så en klynge-ingress-controller er ikke længere nødvendig.

- Fjern eventuelle `oneuptimeIngress`-tilsidesættelser fra dine brugerdefinerede `values.yaml`-filer inden opgradering. Disse nøgler ignoreres nu og vil forårsage valideringsfejl, hvis de efterlades.
- Sørg for, at `nginx.service.type` afspejler, hvordan du vil eksponere den medfølgende ingress gateway (f.eks. `LoadBalancer`, `NodePort` eller `ClusterIP` med en ekstern load balancer).
- Bekræft, at eventuelle DNS-poster til statussider eller primære hosts stadig peger på den service eller load balancer, der er foran OneUptime-ingress-gatewayen.
- Efter opgraderingen skal du bekræfte, at TLS-certifikater fortsat fornyes via den indlejrede gateway, og at statusside-domæner løses korrekt.

## Opgradering fra OneUptime 7 → 8

Hvis du kører på Kubernetes, er der vigtige ændringer der bryder bagudkompatibilitet:

- Vi bruger ikke længere Bitnami-charts til Postgres, Redis og ClickHouse på grund af [Bitnami-licensændringer](https://github.com/bitnami/charts/issues/35164)
- Disse ændringer er ikke bagudkompatible. Du skal følge den nye struktur i Helm-chartets `values.yaml`.
- Sikkerhedskopier dine data (Postgres, ClickHouse og alle persistente volumes) inden opgradering.

> Tip: Test opgraderingen i et staging-miljø først. Bekræft, at dine arbejdsbelastninger er sunde og dataene intakte, inden du opgraderer produktionen.
