# Delning & offentliga instrumentpaneler

Som standard är instrumentpaneler privata för ditt projekt — endast inloggade teammedlemmar kan se dem. Men OneUptime låter dig också dela en instrumentpanel offentligt, skydda den med ett lösenord, begränsa den till vissa IP:er och hosta den på din egen domän. Den här sidan täcker alla fyra.

## Privata instrumentpaneler (standard)

En instrumentpanel är endast nåbar för inloggade medlemmar i ditt projekt. URL:en ser ut som `https://oneuptime.com/dashboards/<id>/view` och kräver inloggning.

Inom projektet styr ägare och etiketter vem som ser vad — se [Konfiguration & behörigheter](/docs/dashboards/configuration).

## Offentliga instrumentpaneler

Under **Dashboard → Settings**, slå på **Public Dashboard**. Instrumentpanelen har nu en andra URL som inte kräver inloggning. Dela den med leverantörer, partners, kunder eller klistra in den i en offentlig README.

En offentlig instrumentpanel:

- Öppnas alltid i **View**-läge. Offentliga besökare kan inte redigera eller se widget-paletten.
- Inkluderar variablerna du har lagt till. Besökare väljer från samma rullgardinsmenyer som ditt team använder.
- Använder **varumärket** du ställer in i Settings — sidtitel, beskrivning, logotyp, favicon.

Behandla aktivering av en offentlig instrumentpanel som att publicera en webbsida. Varje widget på den blir världsläsbar. Titta på vad som finns på arbetsytan innan du slår på växeln.

## Huvudlösenord

För att sätta ett lösenord på en offentlig instrumentpanel:

1. Slå på **Public Dashboard**.
2. Slå på **Master Password**.
3. Ställ in lösenordet.

Besökare ser en lösenordsprompt innan instrumentpanelen visas. Lösenordet sparas som en hash — vi ser aldrig det faktiska lösenordet.

Använd ett huvudlösenord när:

- Du vill dela med en partner eller kund men inte vill att URL:en ska vara användbar om den läcker.
- Instrumentpanelen är "halvoffentlig" — öppen nog att du inte vill bjuda in varje tittare som en teammedlem, men inte öppen nog att läggas ut på det öppna internet.

För starkare grindkontroll (separata konton per tittare, en granskningslogg över vem som tittade på vad), behåll instrumentpanelen privat och bjud in tittare som teammedlemmar med endast läsbehörighet.

## IP-tillåtslista

På **Scale**-planen kan du begränsa en offentlig instrumentpanel till en lista över IP-adresser eller intervall. Konfigurera det under **Dashboard → Settings → IP Whitelist**.

Använd det när:

- Instrumentpanelen endast ska vara nåbar från ditt kontor eller VPN.
- En leverantörsportal endast ska vara nåbar från deras kända IP:er.
- Du vill ha extra skydd ovanpå ett huvudlösenord.

Förfrågningar från andra IP:er avvisas.

## Anpassade domäner

Som standard serveras en offentlig instrumentpanel på `oneuptime.com`. För att hosta den på din egen subdomän som `dashboard.acme.com`:

1. Lägg till en CNAME-post på din DNS som pekar subdomänen till OneUptimes mål.
2. Under **Dashboard → Settings → Custom Domains**, lägg till domänen.
3. Verifiera den. OneUptime kontrollerar DNS-posten åt dig.
4. När den är verifierad är instrumentpanelen nåbar på både din anpassade domän och den ursprungliga URL:en.

Anpassade domäner är användbara för:

- Kundvända instrumentpaneler med ditt eget varumärke.
- Sambrandade partnerinstrumentpaneler.
- Offentliga hälsosidor med sin egen URL.

Du kan koppla mer än en anpassad domän till en enskild instrumentpanel om du serverar samma innehåll till flera målgrupper.

## Varumärke

Under **Dashboard → Settings** kan du konfigurera:

- **Sidtitel** — vad som visas i webbläsarfliken och högst upp på sidan.
- **Sidbeskrivning** — beskrivningen som används av sökmotorer och förhandsvisningar i sociala medier.
- **Logotyp** — ladda upp en PNG eller SVG som visas i sidhuvudet.
- **Favicon** — den lilla ikonen i webbläsarfliken.

Varumärket gäller endast när instrumentpanelen visas offentligt. Interna tittare ser alltid OneUptimes varumärke.

## Inbäddning

Du kan bädda in en offentlig instrumentpanel på din egen sajt med en iframe:

```html
<iframe src="https://dashboard.acme.com/view"
        width="100%" height="800"
        frameborder="0"></iframe>
```

Om instrumentpanelen har ett huvudlösenord ser besökare lösenordsprompten inuti iframen.

## Delbara URL:er

Instrumentpanelens URL inkluderar de aktuella variabelvalen och tidsintervallet som query-parametrar. Justera rullgardinsmenyerna, kopiera URL:en, klistra in den i en chatt — personen som öppnar länken ser instrumentpanelen med exakt samma vy.

Detta är det snabbaste sättet att peka en lagkamrat på "instrumentpanelen vid den tidpunkt incidenten började." Fäst tidsintervallet, kopiera, klistra in.

## Läs vidare

- [Konfiguration & behörigheter](/docs/dashboards/configuration) — åtkomstkontroll i privat läge.
- [Variabler & filter](/docs/dashboards/variables) — variabler som besökare kan interagera med.
- [Skapa en instrumentpanel](/docs/dashboards/authoring) — vad som hamnar på arbetsytan.
