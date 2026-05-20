# Deling & offentlige dashbord

De fleste dashbord er private for prosjektet ditt — bare innloggede medlemmer av prosjektet kan se dem. Men OneUptime lar deg også publisere et dashbord på en offentlig URL, eventuelt beskytte det med et passord, begrense det etter IP og hoste det på et egendefinert domene. Denne siden dekker alle fire.

## Private dashbord (standarden)

Som standard er et dashbord tilgjengelig kun for innloggede brukere som er prosjektmedlemmer. URL-en ser ut som `https://oneuptime.com/dashboards/<id>/view`. Direkte tilgang krever autentisering og den passende lese-tillatelsen på dashbordet.

Innenfor prosjektet kontrollerer eierskap og etiketter hvem som ser hva — se [Konfigurasjon & tillatelser](/docs/dashboards/configuration).

## Offentlige dashbord

Under **Dashbord → Innstillinger**, slå på **Public Dashboard**. Dashbordet har nå en annen URL som ikke krever innlogging. Del den med leverandører, partnere, kunder, eller lim den inn i en offentlig README.

Et offentlig dashbord:

- Rendres kun i **Vis**-modus. Offentlige besøkende kan ikke redigere, endre tidsperiode-URL-er til side, eller se widget-paletten.
- Inkluderer variablene du har definert — besøkende kan velge fra nedtrekksmenyer akkurat som interne brukere.
- Bærer **merkevarebyggingen** du konfigurerer under Innstillinger: sidetittel, sidebeskrivelse, logofil, favicon. Dette er det som vises i nettleserfanen og på sosiale forhåndsvisninger.

Behandle å aktivere **Public Dashboard** som å publisere en nettside. Hver widget på dashbordet er nå verden-lesbar. Revider hva som er på lerretet før du slår på bryteren.

## Masterpassord

For å porte et offentlig dashbord med et passord i stedet for å gjøre det helt åpent:

1. Aktiver **Public Dashboard**.
2. Aktiver **Master Password**.
3. Sett passordet.

Besøkende treffer en passordprompt før dashbordet rendres. Passordet hashes i hvile; bare hashen lagres.

Bruk et masterpassord når:

- Du vil dele med en partner eller kunde, men ikke vil at URL-en skal være gyldig hvis den lekker.
- Dashbordet er "semi-offentlig" — åpent nok til at du ikke vil ha OneUptime-kontoer for hver seer, men ikke åpent nok til å legge på det åpne internett.

For høyere-verdi-portering (per-seer-kontoer, revisjonsspor for hvem som så hva), hold dashbordet privat og inviter seere til prosjektet som skrivebeskyttede medlemmer.

## IP-tillatelsesliste

På **Scale**-planen kan du begrense et offentlig dashbord til en liste over kilde-IP-er eller CIDR-områder. Konfigurer listen under **Dashbord → Innstillinger → IP Whitelist**.

Bruk en IP-tillatelsesliste når:

- Dashbordet skal kun være tilgjengelig fra kontoret ditt eller VPN.
- En leverandørportal skal kun være tilgjengelig fra deres publiserte egress-IP-er.
- Du ønsker forsvar i dybden på toppen av et masterpassord.

Forespørsler fra enhver annen IP mottar en 403.

## Egendefinerte domener

Rett ut av boksen serveres et offentlig dashbord på `oneuptime.com`. For å hoste det på ditt eget subdomene (f.eks. `dashboard.acme.com`):

1. Legg til en CNAME-post på DNS-en din som peker subdomenet til OneUptimes publiserte mål.
2. Under **Dashbord → Innstillinger → Egendefinerte domener**, legg til domenet.
3. Verifiser DNS-posten (OneUptime sjekker den for deg).
4. Når den er verifisert, er dashbordet tilgjengelig både på OneUptime-URL-en og ditt egendefinerte domene.

Egendefinerte domener er nyttige for:

- Kundevendte dashbord på din merkevare.
- Co-brandede partner-dashbord.
- SEO på en offentlig helse-side.

Du kan knytte flere egendefinerte domener til ett dashbord hvis du serverer samme innhold til flere målgrupper.

## Merkevarebygging for offentlige dashbord

Under **Dashbord → Innstillinger**, konfigurer:

- **Sidetittel** — `<title>`-taggen og overskriften besøkende ser.
- **Sidebeskrivelse** — meta-beskrivelsen brukt av søkemotorer og sosiale forhåndsvisninger.
- **Logofil** — last opp en PNG/SVG; vises i dashbord-toppen.
- **Favicon** — lastes opp; vises i nettleserfanen.

Merkevarebygging gjelder kun for offentlig-modus-rendering. Interne seere ser alltid OneUptime-merkevarebyggingen.

## Innbygging

Du kan bygge inn et offentlig dashbord i en `<iframe>` på din egen side:

```html
<iframe src="https://dashboard.acme.com/view"
        width="100%" height="800"
        frameborder="0"></iframe>
```

Hvis du bygger inn et dashbord beskyttet av et masterpassord, ser den besøkende fortsatt passordprompten inne i iframen.

## Delbare URL-er med variabeltilstand

Dashbord-URL-en koder de nåværende variabelvalgene og tidsperioden som query-parametere. Juster nedtrekksmenyene, kopier URL-en og lim den inn i chat — mottakeren ser dashbordet med nøyaktig samme visning, inkludert tidsperioden du så på.

Dette er den raskeste måten å peke en lagkamerat på "dashbordet på det tidspunktet hendelsen startet" — fest tidsperioden, kopier, lim inn.

## Les videre

- [Konfigurasjon & tillatelser](/docs/dashboards/configuration) — tilgangskontroll i privat modus.
- [Variabler & filtre](/docs/dashboards/variables) — variabler offentlige besøkende kan interagere med.
- [Opprette et dashbord](/docs/dashboards/authoring) — hva som havner på lerretet i utgangspunktet.
