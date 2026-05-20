# Deling & offentlige dashboards

De fleste dashboards er private for dit projekt — kun loggede medlemmer af projektet kan se dem. Men OneUptime lader dig også publicere et dashboard på en offentlig URL, eventuelt beskytte det med en adgangskode, begrænse det via IP og hoste det på et brugerdefineret domæne. Denne side dækker alle fire.

## Private dashboards (standard)

Som standard er et dashboard kun tilgængeligt for loggede brugere, som er projektmedlemmer. URL'en ser ud som `https://oneuptime.com/dashboards/<id>/view`. Direkte adgang kræver godkendelse og den passende læse-tilladelse på dashboardet.

Inde i projektet styrer ejerskab og labels, hvem der ser hvad — se [Dashboard-konfiguration & tilladelser](/docs/dashboards/configuration).

## Offentlige dashboards

Under **Dashboard → Settings** vipper du **Public Dashboard** til. Dashboardet har nu en anden URL, som ikke kræver login. Del den med leverandører, partnere, kunder, eller indsæt den i en offentlig README.

Et offentligt dashboard:

- Rendres kun i **View**-tilstand. Offentlige besøgende kan ikke redigere, ændre tidsinterval-URL'er undtaget, eller se widget-paletten.
- Indeholder de variabler, du har defineret — besøgende kan vælge fra drop-downs præcis som interne brugere.
- Bærer den **branding**, du konfigurerer under Settings: sidetitel, sidebeskrivelse, logo-fil, favicon. Det er, hvad der dukker op i browser-fanen og i sociale previews.

Behandl at aktivere **Public Dashboard** som at publicere en webside. Hver widget på dashboardet er nu læsbart for alle. Revidér hvad der er på lærredet, før du vipper kontakten.

## Master-adgangskode

For at port-sikre et offentligt dashboard med en adgangskode i stedet for at gøre det fuldt åbent:

1. Aktivér **Public Dashboard**.
2. Aktivér **Master Password**.
3. Sæt adgangskoden.

Besøgende rammer en adgangskodeprompt, før dashboardet rendres. Adgangskoden hashes at rest; kun hashen gemmes.

Brug en master-adgangskode, når:

- Du vil dele med en partner eller kunde, men ikke vil have, at URL'en er gyldig, hvis den lækker.
- Dashboardet er "semi-offentligt" — åbent nok til at du ikke vil have OneUptime-konti for hver seer, men ikke åbent nok til at lægge på det åbne internet.

For mere højværdig port-sikring (per-seer-konti, audit-spor over hvem der så hvad), så hold dashboardet privat, og invitér seere til projektet som read-only-medlemmer.

## IP-allowlist

På **Scale**-planen kan du begrænse et offentligt dashboard til en liste af kilde-IP'er eller CIDR-ranges. Konfigurér listen under **Dashboard → Settings → IP Whitelist**.

Brug en IP-allowlist, når:

- Dashboardet kun bør være tilgængeligt fra dit kontor eller VPN.
- En leverandørportal kun bør være tilgængelig fra deres publicerede egress-IP'er.
- Du vil have defense-in-depth oven på en master-adgangskode.

Anmodninger fra enhver anden IP modtager en 403.

## Brugerdefinerede domæner

Ud af boksen serveres et offentligt dashboard på `oneuptime.com`. For at hoste det på dit eget subdomæne (f.eks. `dashboard.acme.com`):

1. Tilføj en CNAME-record på din DNS, der peger subdomænet til OneUptimes publicerede target.
2. Under **Dashboard → Settings → Custom Domains** tilføjer du domænet.
3. Verificér DNS-recorden (OneUptime tjekker den for dig).
4. Når den er verificeret, er dashboardet tilgængeligt på både OneUptime-URL'en og dit brugerdefinerede domæne.

Brugerdefinerede domæner er nyttige til:

- Kundevendte dashboards på dit brand.
- Co-brandede partner-dashboards.
- SEO på en offentlig sundhedsside.

Du kan knytte flere brugerdefinerede domæner til ét dashboard, hvis du serverer samme indhold til flere målgrupper.

## Branding til offentlige dashboards

Under **Dashboard → Settings** konfigurerer du:

- **Sidetitel** — `<title>`-taggen og overskriften, besøgende ser.
- **Sidebeskrivelse** — meta-beskrivelsen brugt af søgemaskiner og sociale previews.
- **Logo-fil** — upload en PNG/SVG; vises i dashboardets header.
- **Favicon** — uploadet; vises i browser-fanen.

Branding gælder kun for offentlig-tilstandsrendering. Interne seere ser altid OneUptime-brandingen.

## Indlejring

Du kan indlejre et offentligt dashboard i en `<iframe>` på dit eget websted:

```html
<iframe src="https://dashboard.acme.com/view"
        width="100%" height="800"
        frameborder="0"></iframe>
```

Hvis du indlejrer et dashboard beskyttet af en master-adgangskode, ser den besøgende stadig adgangskodeprompten inde i iframen.

## Delbare URL'er med variabel-tilstand

Dashboardets URL koder de nuværende variabel-valg og tidsintervallet som query-parametre. Justér drop-downs, kopiér URL'en, og indsæt den i chat — modtageren ser dashboardet med præcis samme visning, inklusive det tidsinterval, du kiggede på.

Det er den hurtigste måde at pege en kollega på "dashboardet på det tidspunkt, hændelsen startede" — fasthold tidsintervallet, kopiér, indsæt.

## Læs videre

- [Dashboard-konfiguration & tilladelser](/docs/dashboards/configuration) — adgangskontrol i privat tilstand.
- [Dashboard-variabler & filtre](/docs/dashboards/variables) — variabler, som offentlige besøgende kan interagere med.
- [Opret et dashboard](/docs/dashboards/authoring) — hvad der i første omgang kommer på lærredet.
