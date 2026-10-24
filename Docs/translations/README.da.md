<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <a href="/README.md">English</a>&nbsp;·
  <a href="/Docs/translations/README.zh-CN.md">简&#8288;体&#8288;中&#8288;文</a>&nbsp;·
  <a href="/Docs/translations/README.zh-TW.md">繁&#8288;體&#8288;中&#8288;文</a>&nbsp;·
  <a href="/Docs/translations/README.ja.md">日&#8288;本&#8288;語</a>&nbsp;·
  <a href="/Docs/translations/README.ko.md">한&#8288;국&#8288;어</a>&nbsp;·
  <a href="/Docs/translations/README.es.md">Español</a>&nbsp;·
  <a href="/Docs/translations/README.fr.md">Français</a>&nbsp;·
  <a href="/Docs/translations/README.de.md">Deutsch</a>&nbsp;·
  <a href="/Docs/translations/README.pt.md">Português</a>&nbsp;·
  <a href="/Docs/translations/README.it.md">Italiano</a>&nbsp;·
  <a href="/Docs/translations/README.ru.md">Русский</a>&nbsp;·
  <a href="/Docs/translations/README.hi.md">हिन्दी</a>&nbsp;·
  <a href="/Docs/translations/README.fa.md">فارسی</a>&nbsp;·
  <a href="/Docs/translations/README.nl.md">Nederlands</a>&nbsp;·
  <a href="/Docs/translations/README.da.md">Dansk</a>&nbsp;·
  <a href="/Docs/translations/README.sv.md">Svenska</a>&nbsp;·
  <a href="/Docs/translations/README.no.md">Norsk</a>
</p>

<p align="center">
  <a href="https://oneuptime.com"><picture><source media="(prefers-color-scheme: dark)" srcset="/packages/App/FeatureSet/Docs/Static/images/logo-dark.svg"><img alt="OneUptime" width="42%" src="/packages/App/FeatureSet/Docs/Static/images/logo-light.svg"></picture></a>
</p>

<p align="center">
  <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0%20%2B%20Enterprise%20%28ee%2F%29-1a73e8" alt="License"></a>
  <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
</p>

OneUptime er en open source-platform til observability. Den tjekker, at dine websteder, API'er og servere virker, indsamler de logs, metrikker og traces, dine applikationer sender, tilkalder den, der har vagt, når noget går ned, og holder dine kunder orienteret på en statusside. Det hele sker i ét produkt: værktøjet, der opdager et problem, er det samme, der tilkalder dit team.

Du kan bruge [OneUptime Cloud](https://oneuptime.com) eller køre OneUptime på dine egne servere.

<p align="center">
  <img alt="OneUptime under en hændelse: tidslinjen, hvem der har vagt, statussiden og OneUptime AI's undersøgelse" width="100%" src="/packages/Home/Static/img/readme/hero-command-center.png">
</p>

## Hvad den gør

- **[Overvågning](https://oneuptime.com/docs/da/monitor/create-monitor)**: Tjek websteder, API'er, porte, DNS og certifikater fra sonder over hele verden eller inde fra dit eget netværk. OneUptime holder også øje med servere, Kubernetes, Docker, VMware, databaser og netværksudstyr.
- **[Hændelser og vagt](https://oneuptime.com/docs/da/incidents/index)**: Arbejd med hver hændelse på én tidslinje. Tilkald den, der har vagt, via opkald, SMS, e-mail, push, Slack eller Microsoft Teams, og eskalér, indtil nogen reagerer.
- **[Statussider](https://oneuptime.com/docs/da/status-pages/index)**: Hold kunderne orienteret på offentlige eller private statussider, og annoncér planlagt vedligeholdelse der.
- **[Logs, metrikker og traces](https://oneuptime.com/docs/da/telemetry/open-telemetry)**: Send dem med OpenTelemetry, søg i dem, og byg dashboards. Undtagelser, profiler, Real User Monitoring og sikkerhedshændelser ligger samme sted.
- **[Arbejdsgange og runbooks](https://oneuptime.com/docs/da/workflows/index)**: Automatisér rutinearbejde, og forbind Jira, ServiceNow og de andre værktøjer, dit team allerede bruger.
- **[OneUptime AI](https://oneuptime.com/docs/da/ai/ai-sre)**: Undersøger nye hændelser og advarsler og lægger en årsagsanalyse med kilder op. Når du slår rettelser til, kan den åbne en pull request med en rettelse, som dit team gennemgår.
- **[API, CLI og Terraform](https://oneuptime.com/docs/da/api-reference/api-reference)**: Automatisér OneUptime fra dine scripts og din CI, og administrér monitorer, statussider og vagter som kode.

Alt andet står i [dokumentationen](https://oneuptime.com/docs/da/introduction/getting-started).

## Kom i gang

### OneUptime Cloud

[Tilmeld dig](https://oneuptime.com/accounts/register), og opret et projekt. Gratisplanen kræver ikke noget kreditkort.

### Host selv med Docker Compose

Du skal bruge en Linux-server med mindst 8 GB hukommelse samt Docker, Docker Compose, Git og Node.js.

Før trin 3 sætter du `HOST` i `config.env` til det domænenavn eller den IP-adresse, folk skal bruge for at nå OneUptime, uden `http://`. Behold kun `localhost` for at prøve OneUptime på din egen computer.

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config, with a random value for every secret
cp config.example.env config.env
while grep -q "please-change-this-to-random-value" config.env; do
  sed -i "0,/please-change-this-to-random-value/{s/please-change-this-to-random-value/$(openssl rand -hex 32)/}" config.env
done

# 3. Start everything
npm start
```

Når `npm start` skriver **OneUptime is up!**, så åbn `http://localhost` eller serverens adresse, og tilmeld dig. Den første konto bliver instansens administrator.

[Docker Compose-vejledningen](https://oneuptime.com/docs/da/installation/docker-compose) dækker serverstørrelser, HTTPS, backup og opdateringer.

### Kubernetes med Helm

Til produktion i stor skala eller høj tilgængelighed installerer du Helm-chartet. Sæt `host` til det domænenavn eller den IP-adresse, folk skal bruge for at nå OneUptime:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime --set host=oneuptime.example.com
```

[Chartets README](/HelmChart/Public/oneuptime/README.md) dækker lagring, HTTPS, databaser og opgraderinger.

## Community og Enterprise

- **Community Edition**: Gratis og open source, med alt ovenfor, inklusive single sign-on med SAML og OIDC.
- **Enterprise Edition**: Tilføjer SCIM-provisionering, auditlogs, team-compliance og dashboards for instansens sundhed, med prioriteret support. Brug i produktion kræver en licens: [kontakt salg](mailto:sales@oneuptime.com).

Dokumentationen [sammenligner de to udgaver](https://oneuptime.com/docs/da/self-hosted/enterprise).

## Få hjælp

- Stil spørgsmål i [OneUptime-fællesskabet på Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA).
- Rapportér fejl, og ønsk funktioner i [GitHub-issues](https://github.com/OneUptime/oneuptime/issues).
- Rapportér en sikkerhedssårbarhed fortroligt, som [SECURITY.md](/.github/SECURITY.md) forklarer.
- Skriv til [support@oneuptime.com](mailto:support@oneuptime.com) om alt andet.

## Bidrag

Fejlrettelser, funktioner, dokumentation og tests er alle velkomne. [Vejledningen til lokal udvikling](https://oneuptime.com/docs/da/installation/local-development) viser, hvordan du kører OneUptime fra kildekoden, og [retningslinjerne for bidrag](/.github/CONTRIBUTING.md) forklarer, hvordan pull requests og licenser fungerer. Issues med etiketten [good first issue](https://github.com/OneUptime/oneuptime/labels/good%20first%20issue) er et godt sted at begynde.

Hvis OneUptime er nyttigt for dig, så giv dette repository en stjerne, eller [sponsorér projektet](https://github.com/sponsors/OneUptime).

## Licens

OneUptime er open source under [Apache License 2.0](/LICENSE), bortset fra mappen [`ee/`](/ee). Den mappe indeholder Enterprise Edition og er licenseret under [OneUptime Enterprise License](/ee/LICENSE). Community Edition-imaget indeholder ingen kode fra `ee/`. Filen [`LICENSE`](/LICENSE) i repositoriets rod fastlægger denne opdeling.
