# Deling & offentlige dashbord

Som standard er dashbord private for prosjektet ditt — bare innloggede teammedlemmer kan se dem. Men OneUptime lar deg også dele et dashbord offentlig, beskytte det med et passord, begrense det til visse IP-er og hoste det på ditt eget domene. Denne siden dekker alle fire.

## Private dashbord (standarden)

Et dashbord er bare tilgjengelig for innloggede medlemmer av prosjektet ditt. URL-en ser ut som `https://oneuptime.com/dashboards/<id>/view` og krever innlogging.

Innenfor prosjektet kontrollerer eiere og etiketter hvem som ser hva — se [Konfigurasjon & tillatelser](/docs/dashboards/configuration).

## Offentlige dashbord

Under **Dashbord → Innstillinger**, vri på **Offentlig dashbord**. Dashbordet har nå en andre URL som ikke krever innlogging. Del den med leverandører, partnere, kunder, eller lim den inn i en offentlig README.

Et offentlig dashbord:

- Åpnes alltid i **Vis**-modus. Offentlige besøkende kan ikke redigere eller se widget-paletten.
- Inkluderer variablene du har lagt til. Besøkende velger fra de samme nedtrekkslistene som teamet ditt bruker.
- Bruker **merkevarebyggingen** du setter i Innstillinger — sidetittel, beskrivelse, logo, favicon.

Behandle det å aktivere et offentlig dashbord som å publisere en nettside. Hver widget på det blir lesbar for alle. Se på hva som er på lerretet før du vrir på bryteren.

## Hovedpassord

For å sette et passord på et offentlig dashbord:

1. Slå på **Offentlig dashbord**.
2. Slå på **Hovedpassord**.
3. Sett passordet.

Besøkende ser en passord-prompt før dashbordet vises. Passordet lagres som en hash — vi ser aldri det faktiske passordet.

Bruk et hovedpassord når:

- Du vil dele med en partner eller kunde, men ikke vil at URL-en skal være nyttig hvis den lekker.
- Dashbordet er "semi-offentlig" — åpent nok til at du ikke vil invitere hver seer som et teammedlem, men ikke åpent nok til å legge på det åpne internett.

For sterkere beskyttelse (separate kontoer per seer, en revisjonslogg over hvem som så hva), hold dashbordet privat og inviter seere som kun-lese teammedlemmer i stedet.

## IP-tillatelsesliste

På **Scale**-planen kan du begrense et offentlig dashbord til en liste over IP-adresser eller områder. Konfigurer det under **Dashbord → Innstillinger → IP-tillatelsesliste**.

Bruk dette når:

- Dashbordet bare skal være tilgjengelig fra kontoret ditt eller VPN.
- En leverandørportal bare skal være tilgjengelig fra deres kjente IP-er.
- Du vil ha ekstra beskyttelse på toppen av et hovedpassord.

Forespørsler fra andre IP-er avvises.

## Egendefinerte domener

Standard serveres et offentlig dashbord på `oneuptime.com`. For å hoste det på ditt eget subdomene som `dashboard.acme.com`:

1. Legg til en CNAME-oppføring i DNS-en din som peker subdomenet til OneUptimes mål.
2. Under **Dashbord → Innstillinger → Egendefinerte domener**, legg til domenet.
3. Verifiser det. OneUptime sjekker DNS-oppføringen for deg.
4. Når det er verifisert, er dashbordet tilgjengelig både på det egendefinerte domenet ditt og den opprinnelige URL-en.

Egendefinerte domener er nyttige for:

- Kundevendte dashbord på din egen merkevare.
- Co-brandede partner-dashbord.
- Offentlige helsetavler med sin egen URL.

Du kan koble mer enn ett egendefinert domene til ett enkelt dashbord hvis du serverer samme innhold til flere målgrupper.

## Merkevarebygging

Under **Dashbord → Innstillinger** kan du konfigurere:

- **Sidetittel** — det som vises i nettleserfanen og øverst på siden.
- **Sidebeskrivelse** — beskrivelsen brukt av søkemotorer og sosiale forhåndsvisninger.
- **Logo** — last opp en PNG eller SVG som skal vises i headeren.
- **Favicon** — det lille ikonet i nettleserfanen.

Merkevarebygging gjelder bare når dashbordet vises offentlig. Interne seere ser alltid OneUptimes merkevarebygging.

## Innbygging

Du kan bygge inn et offentlig dashbord på ditt eget nettsted med en iframe:

```html
<iframe src="https://dashboard.acme.com/view"
        width="100%" height="800"
        frameborder="0"></iframe>
```

Hvis dashbordet har et hovedpassord, vil besøkende se passord-prompten inne i iframen.

## Delbare URL-er

Dashbordets URL inkluderer de nåværende variabelvalgene og tidsperioden som spørringsparametere. Juster nedtrekkslistene, kopier URL-en, lim den inn i chatten — personen som åpner lenken ser dashbordet med nøyaktig samme visning.

Dette er den raskeste måten å peke en lagkamerat mot "dashbordet på tidspunktet hendelsen startet." Fest tidsperioden, kopier, lim inn.

## Hvor du leser videre

- [Konfigurasjon & tillatelser](/docs/dashboards/configuration) — privatmodus tilgangskontroll.
- [Variabler & filtre](/docs/dashboards/variables) — variabler som besøkende kan interagere med.
- [Lage et dashbord](/docs/dashboards/authoring) — hva som går på lerretet.
