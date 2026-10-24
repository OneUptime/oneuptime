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

OneUptime is een opensource-observabilityplatform. Het controleert of uw websites, API's en servers werken, verzamelt de logs, metrics en traces die uw applicaties versturen, roept degene op die bereikbaarheidsdienst heeft wanneer er iets kapotgaat, en informeert uw klanten op een statuspagina. Alles gebeurt in één product: de tool die een probleem opmerkt, is dezelfde die uw team oproept.

U kunt [OneUptime Cloud](https://oneuptime.com) gebruiken of OneUptime op uw eigen servers draaien.

<p align="center">
  <img alt="OneUptime tijdens een incident: de tijdlijn, wie bereikbaarheidsdienst heeft, de statuspagina en het onderzoek van OneUptime AI" width="100%" src="/packages/Home/Static/img/readme/hero-command-center.png">
</p>

## Wat het doet

- **[Monitoring](https://oneuptime.com/docs/nl/monitor/create-monitor)**: Websites, API's, poorten, DNS en certificaten controleren vanaf sondes over de hele wereld of vanuit uw eigen netwerk. OneUptime bewaakt ook servers, Kubernetes, Docker, VMware, databases en netwerkapparaten.
- **[Incidenten en bereikbaarheid](https://oneuptime.com/docs/nl/incidents/index)**: Elk incident op één tijdlijn afhandelen. Degene met bereikbaarheidsdienst oproepen per telefoon, sms, e-mail, push, Slack of Microsoft Teams, en escaleren tot iemand reageert.
- **[Statuspagina's](https://oneuptime.com/docs/nl/status-pages/index)**: Klanten op de hoogte houden op openbare of privé-statuspagina's, en daar gepland onderhoud aankondigen.
- **[Logs, metrics en traces](https://oneuptime.com/docs/nl/telemetry/open-telemetry)**: Ze versturen met OpenTelemetry, erin zoeken en dashboards bouwen. Exceptions, profielen, Real User Monitoring en beveiligingsgebeurtenissen staan op dezelfde plek.
- **[Workflows en runbooks](https://oneuptime.com/docs/nl/workflows/index)**: Routinewerk automatiseren, en Jira, ServiceNow en de andere tools koppelen die uw team al gebruikt.
- **[OneUptime AI](https://oneuptime.com/docs/nl/ai/ai-sre)**: Onderzoekt nieuwe incidenten en waarschuwingen en plaatst een oorzaakanalyse met bronvermelding. Als u herstellen aanzet, kan het een pull request met een fix openen die uw team beoordeelt.
- **[API, CLI en Terraform](https://oneuptime.com/docs/nl/api-reference/api-reference)**: OneUptime automatiseren vanuit uw scripts en uw CI, en monitoren, statuspagina's en bereikbaarheid als code beheren.

Al het andere staat in de [documentatie](https://oneuptime.com/docs/nl/introduction/getting-started).

## Aan de slag

### OneUptime Cloud

[Meld u aan](https://oneuptime.com/accounts/register) en maak een project aan. Voor het gratis abonnement is geen creditcard nodig.

### Zelf hosten met Docker Compose

U hebt een Linux-server nodig met minstens 8 GB geheugen, en Docker, Docker Compose, Git en Node.js.

Zet vóór stap 3 `HOST` in `config.env` op de domeinnaam of het IP-adres waarmee mensen OneUptime bereiken, zonder `http://`. Houd `localhost` alleen aan om OneUptime op uw eigen computer uit te proberen.

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

Wanneer `npm start` **OneUptime is up!** toont, opent u `http://localhost` of het adres van uw server en registreert u zich. Het eerste account wordt de beheerder van de instantie.

De [Docker Compose-handleiding](https://oneuptime.com/docs/nl/installation/docker-compose) behandelt servergroottes, HTTPS, back-ups en updates.

### Kubernetes met Helm

Voor productie op grote schaal, of hoge beschikbaarheid, installeert u de Helm-chart. Zet `host` op de domeinnaam of het IP-adres waarop mensen OneUptime bereiken:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime --set host=oneuptime.example.com
```

De [README van de chart](/HelmChart/Public/oneuptime/README.md) behandelt opslag, HTTPS, databases en upgrades.

## Community en Enterprise

- **Community Edition**: Gratis en open source, met alles hierboven, inclusief single sign-on met SAML en OIDC.
- **Enterprise Edition**: Voegt SCIM-provisioning, auditlogs, teamcompliance en dashboards voor de gezondheid van de instantie toe, met prioritaire ondersteuning. Productiegebruik vereist een licentie: [neem contact op met sales](mailto:sales@oneuptime.com).

De documentatie [vergelijkt de twee edities](https://oneuptime.com/docs/nl/self-hosted/enterprise).

## Hulp krijgen

- Stel vragen in de [OneUptime-community op Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA).
- Meld bugs en vraag functies aan in de [GitHub-issues](https://github.com/OneUptime/oneuptime/issues).
- Meld een beveiligingslek vertrouwelijk, zoals [SECURITY.md](/.github/SECURITY.md) uitlegt.
- Mail voor al het andere naar [support@oneuptime.com](mailto:support@oneuptime.com).

## Bijdragen

Bugfixes, functies, documentatie en tests zijn allemaal welkom. De [handleiding voor lokale ontwikkeling](https://oneuptime.com/docs/nl/installation/local-development) laat zien hoe u OneUptime vanuit de broncode draait, en de [richtlijnen voor bijdragen](/.github/CONTRIBUTING.md) leggen uit hoe pull requests en licenties werken. Issues met het label [good first issue](https://github.com/OneUptime/oneuptime/labels/good%20first%20issue) zijn een goed begin.

Als OneUptime u helpt, geef deze repository dan een ster of [sponsor het project](https://github.com/sponsors/OneUptime).

## Licentie

OneUptime is open source onder de [Apache License 2.0](/LICENSE), met uitzondering van de map [`ee/`](/ee). Die map bevat de Enterprise Edition en valt onder de [OneUptime Enterprise License](/ee/LICENSE). De image van de Community Edition bevat geen code uit `ee/`. Het bestand [`LICENSE`](/LICENSE) in de hoofdmap van de repository legt deze verdeling vast.
