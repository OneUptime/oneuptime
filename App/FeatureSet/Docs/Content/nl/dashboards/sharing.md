# Delen en publieke dashboards

Standaard zijn dashboards privé voor je project — alleen ingelogde teamleden kunnen ze zien. Maar OneUptime laat je een dashboard ook publiek delen, beveiligen met een wachtwoord, beperken tot bepaalde IP's en hosten op je eigen domein. Deze pagina behandelt alle vier.

## Privé-dashboards (de standaard)

Een dashboard is alleen bereikbaar voor ingelogde leden van je project. De URL ziet eruit als `https://oneuptime.com/dashboards/<id>/view` en vereist een login.

Binnen het project regelen eigenaren en labels wie wat ziet — zie [Configuratie en machtigingen](/docs/dashboards/configuration).

## Publieke dashboards

Onder **Dashboard → Settings** zet je **Public Dashboard** aan. Het dashboard heeft nu een tweede URL die geen login vereist. Deel hem met leveranciers, partners, klanten of plak hem in een openbare README.

Een publiek dashboard:

- Opent altijd in **View**-modus. Publieke bezoekers kunnen niet bewerken of het widget-palet zien.
- Bevat de variabelen die je hebt toegevoegd. Bezoekers kiezen uit dezelfde dropdowns die je team gebruikt.
- Gebruikt de **branding** die je in Settings hebt ingesteld — paginatitel, beschrijving, logo, favicon.

Behandel het inschakelen van een publiek dashboard als het publiceren van een webpagina. Elke widget die erop staat wordt wereldwijd leesbaar. Bekijk wat er op het canvas staat voordat je de schakelaar omzet.

## Master-wachtwoord

Om een wachtwoord op een publiek dashboard te zetten:

1. Zet **Public Dashboard** aan.
2. Zet **Master Password** aan.
3. Stel het wachtwoord in.

Bezoekers zien een wachtwoordprompt voordat het dashboard verschijnt. Het wachtwoord wordt opgeslagen als een hash — we zien het echte wachtwoord nooit.

Gebruik een master-wachtwoord wanneer:

- Je wilt delen met een partner of klant maar niet wilt dat de URL nuttig is als hij lekt.
- Het dashboard "semi-publiek" is — open genoeg dat je niet elke kijker als teamlid wilt uitnodigen, maar niet open genoeg om op het open internet te zetten.

Voor strengere afscherming (aparte accounts per kijker, een audit trail van wie wat heeft bekeken), houd het dashboard privé en nodig kijkers uit als alleen-lezen teamleden.

## IP-allowlist

Op het **Scale**-plan kun je een publiek dashboard beperken tot een lijst met IP-adressen of -ranges. Configureer dit onder **Dashboard → Settings → IP Whitelist**.

Gebruik dit wanneer:

- Het dashboard alleen bereikbaar moet zijn vanaf je kantoor of VPN.
- Een leveranciersportaal alleen bereikbaar moet zijn vanaf hun bekende IP's.
- Je extra bescherming wilt bovenop een master-wachtwoord.

Verzoeken vanaf elk ander IP worden afgewezen.

## Custom domains

Standaard wordt een publiek dashboard geserveerd op `oneuptime.com`. Om hem te hosten op je eigen subdomein zoals `dashboard.acme.com`:

1. Voeg een CNAME-record toe op je DNS dat het subdomein laat verwijzen naar OneUptime's target.
2. Voeg het domein toe onder **Dashboard → Settings → Custom Domains**.
3. Verifieer het. OneUptime controleert het DNS-record voor je.
4. Eenmaal geverifieerd is het dashboard bereikbaar op zowel je custom domain als de originele URL.

Custom domains zijn handig voor:

- Klantgerichte dashboards op je eigen merk.
- Co-branded partner-dashboards.
- Publieke gezondheidspagina's met hun eigen URL.

Je kunt meer dan één custom domain aan één dashboard koppelen als je dezelfde content voor meerdere doelgroepen serveert.

## Branding

Onder **Dashboard → Settings** kun je configureren:

- **Page title** — wat er in de browsertab en bovenaan de pagina verschijnt.
- **Page description** — de beschrijving die zoekmachines en social previews gebruiken.
- **Logo** — upload een PNG of SVG om in de header te tonen.
- **Favicon** — het kleine icoontje in de browsertab.

Branding geldt alleen wanneer het dashboard publiek wordt bekeken. Interne kijkers zien altijd OneUptime's branding.

## Embedden

Je kunt een publiek dashboard in je eigen site embedden met een iframe:

```html
<iframe
  src="https://dashboard.acme.com/view"
  width="100%"
  height="800"
  frameborder="0"
></iframe>
```

Als het dashboard een master-wachtwoord heeft, zien bezoekers de wachtwoordprompt binnenin de iframe.

## Deelbare URL's

De dashboard-URL bevat de huidige variabele-selecties en het tijdsbereik als query-parameters. Pas de dropdowns aan, kopieer de URL, plak hem in de chat — wie de link opent ziet het dashboard met exact dezelfde view.

Dit is de snelste manier om een teamgenoot naar "het dashboard op het tijdstip waarop het incident begon" te wijzen. Pin het tijdsbereik, kopieer, plak.

## Waar verder lezen

- [Configuratie en machtigingen](/docs/dashboards/configuration) — toegangscontrole in privé-modus.
- [Variabelen en filters](/docs/dashboards/variables) — variabelen waar bezoekers mee kunnen interageren.
- [Een dashboard maken](/docs/dashboards/authoring) — wat er op het canvas komt.
