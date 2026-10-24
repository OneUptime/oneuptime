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

OneUptime er en observerbarhetsplattform med åpen kildekode. Den sjekker at nettstedene, API-ene og serverne dine virker, samler inn loggene, metrikkene og sporene appene dine sender, varsler den som har vakt når noe går i stykker, og holder kundene dine oppdatert på en statusside. Alt skjer i ett produkt: verktøyet som oppdager et problem, er det samme som varsler teamet ditt.

Du kan bruke [OneUptime Cloud](https://oneuptime.com) eller kjøre OneUptime på dine egne servere.

<p align="center">
  <img alt="OneUptime under en hendelse: tidslinjen, hvem som har vakt, statussiden og undersøkelsen fra OneUptime AI" width="100%" src="/packages/Home/Static/img/readme/hero-command-center.png">
</p>

## Hva den gjør

- **[Overvåking](https://oneuptime.com/docs/no/monitor/create-monitor)**: Sjekk nettsteder, API-er, porter, DNS og sertifikater fra sonder over hele verden eller fra innsiden av ditt eget nettverk. OneUptime følger også med på servere, Kubernetes, Docker, VMware, databaser og nettverksenheter.
- **[Hendelser og vakt](https://oneuptime.com/docs/no/incidents/index)**: Jobb med hver hendelse på én tidslinje. Varsle den som har vakt via telefon, SMS, e-post, push, Slack eller Microsoft Teams, og eskaler til noen svarer.
- **[Statussider](https://oneuptime.com/docs/no/status-pages/index)**: Hold kundene oppdatert på offentlige eller private statussider, og kunngjør planlagt vedlikehold der.
- **[Logger, metrikker og spor](https://oneuptime.com/docs/no/telemetry/open-telemetry)**: Send dem med OpenTelemetry, søk i dem og bygg dashbord. Unntak, profiler, Real User Monitoring og sikkerhetshendelser ligger på samme sted.
- **[Arbeidsflyter og runbooks](https://oneuptime.com/docs/no/workflows/index)**: Automatiser rutinearbeid, og koble til Jira, ServiceNow og de andre verktøyene teamet ditt allerede bruker.
- **[OneUptime AI](https://oneuptime.com/docs/no/ai/ai-sre)**: Undersøker nye hendelser og varsler og legger ut en årsaksanalyse med kilder. Når du slår på retting, kan den åpne en pull-forespørsel med en rettelse som teamet ditt går gjennom.
- **[API, CLI og Terraform](https://oneuptime.com/docs/no/api-reference/api-reference)**: Automatiser OneUptime fra skriptene dine og CI-en din, og administrer monitorer, statussider og vakt som kode.

Alt annet står i [dokumentasjonen](https://oneuptime.com/docs/no/introduction/getting-started).

## Kom i gang

### OneUptime Cloud

[Registrer deg](https://oneuptime.com/accounts/register) og opprett et prosjekt. Gratisplanen krever ikke kredittkort.

### Drift selv med Docker Compose

Du trenger en Linux-server med minst 8 GB minne, og Docker, Docker Compose, Git og Node.js.

Før trinn 3 setter du `HOST` i `config.env` til domenenavnet eller IP-adressen folk skal bruke for å nå OneUptime, uten `http://`. Behold `localhost` bare for å prøve OneUptime på din egen datamaskin.

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config
cp config.example.env config.env

# 3. Start everything
npm start
```

`npm start` sjekker serveren, gir hver hemmelighet i `config.env` sin egen tilfeldige verdi og starter OneUptime. Når `npm start` skriver ut **OneUptime is up!**, åpner du `http://localhost` eller adressen til serveren din og registrerer deg. Den første kontoen blir administratoren for instansen.

[Veiledningen for Docker Compose](https://oneuptime.com/docs/no/installation/docker-compose) dekker serverstørrelser, HTTPS, sikkerhetskopier og oppdateringer.

### Kubernetes med Helm

For produksjon i stor skala, eller høy tilgjengelighet, installerer du Helm-chartet. Sett `host` til domenenavnet eller IP-adressen folk skal nå OneUptime på:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime --set host=oneuptime.example.com
```

[Chartets README](/HelmChart/Public/oneuptime/README.md) dekker lagring, HTTPS, databaser og oppgraderinger.

## Community og Enterprise

- **Community Edition**: Gratis og åpen kildekode, med alt ovenfor, inkludert enkel pålogging med SAML og OIDC.
- **Enterprise Edition**: Legger til SCIM-klargjøring, revisjonslogger, team-compliance og dashbord for instansens helse, med prioritert support. Bruk i produksjon krever en lisens: [kontakt salg](mailto:sales@oneuptime.com).

Dokumentasjonen [sammenligner de to utgavene](https://oneuptime.com/docs/no/self-hosted/enterprise).

## Få hjelp

- Still spørsmål i [OneUptime-fellesskapet på Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA).
- Rapporter feil og be om funksjoner i [GitHub-issues](https://github.com/OneUptime/oneuptime/issues).
- Rapporter en sikkerhetssårbarhet privat, slik [SECURITY.md](/.github/SECURITY.md) forklarer.
- Skriv til [support@oneuptime.com](mailto:support@oneuptime.com) om alt annet.

## Bidra

Feilrettinger, funksjoner, dokumentasjon og tester er alle velkomne. [Veiledningen for lokal utvikling](https://oneuptime.com/docs/no/installation/local-development) viser hvordan du kjører OneUptime fra kildekoden, og [retningslinjene for bidrag](/.github/CONTRIBUTING.md) forklarer hvordan pull-forespørsler og lisensiering fungerer. Issues med etiketten [good first issue](https://github.com/OneUptime/oneuptime/labels/good%20first%20issue) er et godt sted å begynne.

Hvis OneUptime er nyttig for deg, gi dette repositoriet en stjerne eller [spons prosjektet](https://github.com/sponsors/OneUptime).

## Lisens

OneUptime er åpen kildekode under [Apache License 2.0](/LICENSE), med unntak av mappen [`ee/`](/ee). Den mappen inneholder Enterprise Edition og er lisensiert under [OneUptime Enterprise License](/ee/LICENSE). Community Edition-imaget inneholder ingen kode fra `ee/`. Filen [`LICENSE`](/LICENSE) i roten av repositoriet fastsetter denne inndelingen.
