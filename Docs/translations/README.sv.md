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

OneUptime är en observerbarhetsplattform med öppen källkod. Den kontrollerar att dina webbplatser, API:er och servrar fungerar, samlar in loggarna, mätvärdena och spåren som dina appar skickar, larmar den som har jour när något går sönder och håller dina kunder informerade på en statussida. Allt sker i en och samma produkt: verktyget som upptäcker ett problem är samma verktyg som larmar ditt team.

Du kan använda [OneUptime Cloud](https://oneuptime.com) eller köra OneUptime på dina egna servrar.

<p align="center">
  <img alt="OneUptime under en incident: tidslinjen, vem som har jour, statussidan och OneUptime AI:s utredning" width="100%" src="/packages/Home/Static/img/readme/hero-command-center.png">
</p>

## Vad den gör

- **[Övervakning](https://oneuptime.com/docs/sv/monitor/create-monitor)**: Kontrollera webbplatser, API:er, portar, DNS och certifikat från sonder runt om i världen eller inifrån ditt eget nätverk. OneUptime håller också koll på servrar, Kubernetes, Docker, VMware, databaser och nätverksenheter.
- **[Incidenter och jour](https://oneuptime.com/docs/sv/incidents/index)**: Arbeta med varje incident på en enda tidslinje. Larma den som har jour via samtal, sms, e-post, push, Slack eller Microsoft Teams, och eskalera tills någon svarar.
- **[Statussidor](https://oneuptime.com/docs/sv/status-pages/index)**: Håll kunderna informerade på offentliga eller privata statussidor, och meddela schemalagt underhåll där.
- **[Loggar, mätvärden och spår](https://oneuptime.com/docs/sv/telemetry/open-telemetry)**: Skicka dem med OpenTelemetry, sök i dem och bygg instrumentpaneler. Undantag, profiler, Real User Monitoring och säkerhetshändelser finns på samma ställe.
- **[Arbetsflöden och runbooks](https://oneuptime.com/docs/sv/workflows/index)**: Automatisera rutinarbete, och koppla Jira, ServiceNow och de andra verktyg som ditt team redan använder.
- **[OneUptime AI](https://oneuptime.com/docs/sv/ai/ai-sre)**: Utreder nya incidenter och varningar och publicerar en orsaksanalys med källor. När du slår på åtgärder kan den öppna en pull-förfrågan med en åtgärd som ditt team granskar.
- **[API, CLI och Terraform](https://oneuptime.com/docs/sv/api-reference/api-reference)**: Automatisera OneUptime från dina skript och din CI, och hantera monitorer, statussidor och jour som kod.

Allt annat finns i [dokumentationen](https://oneuptime.com/docs/sv/introduction/getting-started).

## Kom igång

### OneUptime Cloud

[Registrera dig](https://oneuptime.com/accounts/register) och skapa ett projekt. Gratisplanen kräver inget kreditkort.

### Drifta själv med Docker Compose

Du behöver en Linux-server med minst 8 GB minne, och Docker, Docker Compose, Git och Node.js.

Före steg 3 sätter du `HOST` i `config.env` till det domännamn eller den IP-adress som folk ska använda för att nå OneUptime, utan `http://`. Behåll `localhost` bara för att prova OneUptime på din egen dator.

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

När `npm start` skriver ut **OneUptime is up!** öppnar du `http://localhost` eller serverns adress och registrerar dig. Det första kontot blir instansens administratör.

[Guiden för Docker Compose](https://oneuptime.com/docs/sv/installation/docker-compose) tar upp serverstorlekar, HTTPS, säkerhetskopior och uppdateringar.

### Kubernetes med Helm

För produktion i stor skala, eller hög tillgänglighet, installerar du Helm-chartet. Sätt `host` till det domännamn eller den IP-adress som folk ska nå OneUptime på:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime --set host=oneuptime.example.com
```

[Chartets README](/HelmChart/Public/oneuptime/README.md) tar upp lagring, HTTPS, databaser och uppgraderingar.

## Community och Enterprise

- **Community Edition**: Gratis och öppen källkod, med allt ovan, inklusive enkel inloggning med SAML och OIDC.
- **Enterprise Edition**: Lägger till SCIM-etablering, granskningsloggar, team-compliance och dashboards för instansens hälsa, med prioriterad support. Användning i produktion kräver en licens: [kontakta försäljning](mailto:sales@oneuptime.com).

Dokumentationen [jämför de två utgåvorna](https://oneuptime.com/docs/sv/self-hosted/enterprise).

## Få hjälp

- Ställ frågor i [OneUptime-communityn på Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA).
- Rapportera buggar och önska funktioner i [GitHub-issues](https://github.com/OneUptime/oneuptime/issues).
- Rapportera en säkerhetssårbarhet privat, så som [SECURITY.md](/.github/SECURITY.md) förklarar.
- Mejla [support@oneuptime.com](mailto:support@oneuptime.com) om allt annat.

## Bidra

Buggfixar, funktioner, dokumentation och tester är alla välkomna. [Guiden för lokal utveckling](https://oneuptime.com/docs/sv/installation/local-development) visar hur du kör OneUptime från källkoden, och [riktlinjerna för bidrag](/.github/CONTRIBUTING.md) förklarar hur pull-förfrågningar och licensiering fungerar. Issues med etiketten [good first issue](https://github.com/OneUptime/oneuptime/labels/good%20first%20issue) är ett bra ställe att börja på.

Om OneUptime är användbart för dig, ge det här repositoryt en stjärna eller [sponsra projektet](https://github.com/sponsors/OneUptime).

## Licens

OneUptime är öppen källkod under [Apache License 2.0](/LICENSE), med undantag för katalogen [`ee/`](/ee). Den katalogen innehåller Enterprise Edition och är licensierad under [OneUptime Enterprise License](/ee/LICENSE). Imagen för Community Edition innehåller ingen kod från `ee/`. Filen [`LICENSE`](/LICENSE) i repositoriets rotkatalog fastställer denna uppdelning.
