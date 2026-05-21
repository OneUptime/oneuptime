# Deling & offentlige dashboards

Som standard er dashboards private for dit projekt — kun loggede teammedlemmer kan se dem. Men OneUptime lader dig også dele et dashboard offentligt, beskytte det med en adgangskode, begrænse det til bestemte IP'er og hoste det på dit eget domæne. Denne side dækker alle fire.

## Private dashboards (standarden)

Et dashboard kan kun nås af loggede medlemmer af dit projekt. URL'en ser ud som `https://oneuptime.com/dashboards/<id>/view` og kræver et login.

Inden for projektet kontrollerer ejere og labels, hvem der ser hvad — se [Konfiguration & tilladelser](/docs/dashboards/configuration).

## Offentlige dashboards

Under **Dashboard → Settings** slår du **Public Dashboard** til. Dashboardet har nu en anden URL, der ikke kræver login. Del den med leverandører, partnere, kunder, eller indsæt den i en offentlig README.

Et offentligt dashboard:

- Åbner altid i **View**-tilstand. Offentlige besøgende kan ikke redigere eller se widget-paletten.
- Inkluderer de variabler, du har tilføjet. Besøgende vælger fra de samme dropdowns, dit team bruger.
- Bruger den **branding**, du sætter i Settings — sidens titel, beskrivelse, logo, favicon.

Behandl det at aktivere et offentligt dashboard som at publicere en webside. Hver widget på det bliver verdenslæsbar. Kig på, hvad der er på lærredet, før du slår kontakten til.

## Master-adgangskode

For at sætte en adgangskode på et offentligt dashboard:

1. Slå **Public Dashboard** til.
2. Slå **Master Password** til.
3. Sæt adgangskoden.

Besøgende ser en adgangskodeprompt, før dashboardet vises. Adgangskoden gemmes som en hash — vi ser aldrig den faktiske adgangskode.

Brug en master-adgangskode, når:

- Du vil dele med en partner eller kunde, men ikke vil have, at URL'en skal være brugbar, hvis den lækker.
- Dashboardet er "semi-offentligt" — åbent nok til, at du ikke vil invitere hver besøgende som teammedlem, men ikke åbent nok til at lægge på det åbne internet.

For stærkere gating (separate konti pr. besøgende, en revisionsspor af hvem der så hvad), så behold dashboardet privat og inviter besøgende som read-only-teammedlemmer i stedet.

## IP-tilladelsesliste

På **Scale**-planen kan du begrænse et offentligt dashboard til en liste af IP-adresser eller områder. Konfigurér det under **Dashboard → Settings → IP Whitelist**.

Brug dette, når:

- Dashboardet kun bør være tilgængeligt fra dit kontor eller VPN.
- En leverandørportal kun bør være tilgængelig fra deres kendte IP'er.
- Du vil have ekstra beskyttelse oven på en master-adgangskode.

Anmodninger fra enhver anden IP afvises.

## Brugerdefinerede domæner

Fra start serveres et offentligt dashboard på `oneuptime.com`. For at hoste det på dit eget subdomæne såsom `dashboard.acme.com`:

1. Tilføj en CNAME-record på din DNS, der peger subdomænet til OneUptimes mål.
2. Under **Dashboard → Settings → Custom Domains** tilføjer du domænet.
3. Verificér det. OneUptime tjekker DNS-recorden for dig.
4. Når det er verificeret, kan dashboardet nås både på dit brugerdefinerede domæne og den oprindelige URL.

Brugerdefinerede domæner er nyttige til:

- Kundevendte dashboards på dit eget brand.
- Co-brandede partner-dashboards.
- Offentlige sundhedssider med deres egen URL.

Du kan knytte mere end ét brugerdefineret domæne til et enkelt dashboard, hvis du serverer samme indhold til flere målgrupper.

## Branding

Under **Dashboard → Settings** kan du konfigurere:

- **Page title** — det der vises i browserfanen og i toppen af siden.
- **Page description** — den beskrivelse, der bruges af søgemaskiner og sociale previews.
- **Logo** — upload en PNG eller SVG, der vises i headeren.
- **Favicon** — det lille ikon i browserfanen.

Branding gælder kun, når dashboardet ses offentligt. Interne besøgende ser altid OneUptimes branding.

## Indlejring

Du kan indlejre et offentligt dashboard på din egen side med en iframe:

```html
<iframe src="https://dashboard.acme.com/view"
        width="100%" height="800"
        frameborder="0"></iframe>
```

Hvis dashboardet har en master-adgangskode, vil besøgende se adgangskodeprompten inde i iframen.

## Delbare URL'er

Dashboardets URL inkluderer de aktuelle variabelvalg og tidsintervallet som query-parametre. Justér dropdownene, kopiér URL'en, indsæt den i chat — personen, der åbner linket, ser dashboardet med præcis samme visning.

Dette er den hurtigste måde at pege en kollega på "dashboardet på det tidspunkt, hændelsen startede." Fastgør tidsintervallet, kopiér, indsæt.

## Læs videre

- [Konfiguration & tilladelser](/docs/dashboards/configuration) — adgangskontrol i privat tilstand.
- [Variabler & filtre](/docs/dashboards/variables) — variabler som besøgende kan interagere med.
- [Opret et dashboard](/docs/dashboards/authoring) — hvad der kommer på lærredet.
