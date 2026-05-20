# Delen en publieke dashboards

De meeste dashboards zijn privé voor je project — alleen ingelogde leden van het project kunnen ze zien. Maar OneUptime laat je ook een dashboard publiceren op een openbare URL, optioneel beveiligen met een wachtwoord, beperken op IP en hosten op een custom domain. Deze pagina behandelt alle vier.

## Privé-dashboards (de standaard)

Standaard is een dashboard alleen bereikbaar voor ingelogde gebruikers die projectlid zijn. De URL ziet eruit als `https://oneuptime.com/dashboards/<id>/view`. Directe toegang vereist authenticatie en de juiste leesrechten op het dashboard.

Binnen het project bepalen eigenaarschap en labels wie wat ziet — zie [Configuratie en machtigingen](/docs/dashboards/configuration).

## Publieke dashboards

Onder **Dashboard → Settings** zet je **Public Dashboard** aan. Het dashboard krijgt nu een tweede URL die geen login vereist. Deel die met leveranciers, partners, klanten, of plak hem in een openbare README.

Een publiek dashboard:

- Rendert alleen in **View**-modus. Publieke bezoekers kunnen niet bewerken, tijdsbereik-URL's daargelaten, en zien het widget-palet niet.
- Bevat de variabelen die je hebt gedefinieerd — bezoekers kunnen net als interne gebruikers uit dropdowns kiezen.
- Draagt de **branding** die je onder Settings configureert: paginatitel, paginabeschrijving, logobestand, favicon. Deze worden getoond in het browsertabblad en op social previews.

Behandel het inschakelen van **Public Dashboard** als het publiceren van een webpagina. Elke widget op het dashboard is nu wereldwijd leesbaar. Audit wat op het canvas staat voordat je de schakelaar omzet.

## Master-wachtwoord

Om een publiek dashboard te beveiligen met een wachtwoord in plaats van het volledig open te zetten:

1. Zet **Public Dashboard** aan.
2. Zet **Master Password** aan.
3. Stel het wachtwoord in.

Bezoekers krijgen een wachtwoord-prompt voordat het dashboard rendert. Het wachtwoord wordt gehasht opgeslagen; alleen de hash wordt bewaard.

Gebruik een master-wachtwoord wanneer:

- Je wilt delen met een partner of klant, maar niet wilt dat de URL geldig is als die uitlekt.
- Het dashboard "semi-publiek" is — open genoeg dat je niet voor elke kijker OneUptime-accounts wilt aanmaken, maar niet zo open dat je het op het open internet wilt zetten.

Voor zwaardere beveiliging (accounts per kijker, audit-spoor van wie wat zag) houd je het dashboard privé en nodig je kijkers uit als read-only leden van het project.

## IP-allowlist

Op het **Scale**-abonnement kun je een publiek dashboard beperken tot een lijst van bron-IP's of CIDR-bereiken. Configureer de lijst onder **Dashboard → Settings → IP Whitelist**.

Gebruik een IP-allowlist wanneer:

- Het dashboard alleen bereikbaar zou moeten zijn vanuit je kantoor of VPN.
- Een leverancierportaal alleen bereikbaar zou moeten zijn vanuit hun gepubliceerde egress-IP's.
- Je defense-in-depth wilt bovenop een master-wachtwoord.

Verzoeken vanaf elk ander IP krijgen een 403.

## Custom domains

Out of the box wordt een publiek dashboard geserveerd op `oneuptime.com`. Om het op je eigen subdomein te hosten (bijvoorbeeld `dashboard.acme.com`):

1. Voeg een CNAME-record toe op je DNS dat naar het gepubliceerde target van OneUptime wijst.
2. Voeg onder **Dashboard → Settings → Custom Domains** het domein toe.
3. Verifieer het DNS-record (OneUptime controleert het voor je).
4. Zodra geverifieerd, is het dashboard bereikbaar op zowel de OneUptime-URL als je custom domain.

Custom domains zijn handig voor:

- Klantgerichte dashboards op je merk.
- Co-branded partner-dashboards.
- SEO op een publieke gezondheidspagina.

Je kunt meerdere custom domains aan één dashboard koppelen als je dezelfde content aan meerdere doelgroepen serveert.

## Branding voor publieke dashboards

Onder **Dashboard → Settings** configureer je:

- **Page title** — de `<title>`-tag en de heading die bezoekers zien.
- **Page description** — de meta-description die door zoekmachines en social previews wordt gebruikt.
- **Logo file** — upload een PNG/SVG; getoond in de dashboard-header.
- **Favicon** — geüpload; getoond in het browsertabblad.

Branding geldt alleen voor het renderen in publieke modus. Interne kijkers zien altijd de OneUptime-branding.

## Embedden

Je kunt een publiek dashboard embedden in een `<iframe>` op je eigen site:

```html
<iframe src="https://dashboard.acme.com/view"
        width="100%" height="800"
        frameborder="0"></iframe>
```

Als je een dashboard embedt dat met een master-wachtwoord is beveiligd, ziet de bezoeker de wachtwoord-prompt nog steeds binnen de iframe.

## Deelbare URL's met variabele-state

De dashboard-URL codeert de huidige variabele-selecties en het tijdsbereik als query-parameters. Pas de dropdowns aan, kopieer de URL en plak hem in chat — de ontvanger ziet het dashboard met exact dezelfde weergave, inclusief het tijdsbereik waar je naar keek.

Dit is de snelste manier om een teamgenoot te wijzen op "het dashboard op het moment dat het incident begon" — pin het tijdsbereik vast, kopieer, plak.

## Waar verder lezen

- [Configuratie en machtigingen](/docs/dashboards/configuration) — toegangscontrole in privé-modus.
- [Variabelen en filters](/docs/dashboards/variables) — variabelen waarmee publieke bezoekers kunnen interacteren.
- [Een dashboard maken](/docs/dashboards/authoring) — wat er om te beginnen op het canvas komt.
