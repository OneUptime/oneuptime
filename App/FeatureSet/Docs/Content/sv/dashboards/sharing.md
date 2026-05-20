# Delning & offentliga instrumentpaneler

De flesta instrumentpaneler är privata för ditt projekt — bara inloggade medlemmar i projektet kan se dem. Men OneUptime låter dig också publicera en instrumentpanel på en offentlig URL, valfritt skydda den med ett lösenord, begränsa den efter IP och hosta den på en anpassad domän. Den här sidan täcker alla fyra.

## Privata instrumentpaneler (standard)

Som standard är en instrumentpanel nåbar endast för inloggade användare som är projektmedlemmar. URL:en ser ut som `https://oneuptime.com/dashboards/<id>/view`. Direktåtkomst kräver autentisering och rätt läsbehörighet på instrumentpanelen.

Inom projektet styr ägarskap och etiketter vem som ser vad — se [Konfiguration & behörigheter](/docs/dashboards/configuration).

## Offentliga instrumentpaneler

Under **Dashboard → Settings**, slå på **Public Dashboard**. Instrumentpanelen har nu en andra URL som inte kräver inloggning. Dela den med leverantörer, partners, kunder eller klistra in den i en offentlig README.

En offentlig instrumentpanel:

- Renderas endast i **View**-läge. Offentliga besökare kan inte redigera, ändra tidsintervalls-URL:er åsido, eller se widget-paletten.
- Inkluderar de variabler du har definierat — besökare kan välja från rullgardinsmenyer precis som interna användare.
- Bär med sig den **varumärkning** du konfigurerar under Settings: sidtitel, sidbeskrivning, logotypfil, favicon. Det här är vad som dyker upp i webbläsarens flik och i sociala förhandsvisningar.

Behandla aktivering av **Public Dashboard** som att publicera en webbsida. Varje widget på instrumentpanelen är nu världs-läsbar. Granska vad som finns på arbetsytan innan du slår på växeln.

## Masterlösenord

För att grinda en offentlig instrumentpanel med ett lösenord istället för att göra den helt öppen:

1. Aktivera **Public Dashboard**.
2. Aktivera **Master Password**.
3. Sätt lösenordet.

Besökare möts av en lösenordsprompt innan instrumentpanelen renderas. Lösenordet hashas i vila; bara hashen lagras.

Använd ett masterlösenord när:

- Du vill dela med en partner eller kund men inte vill att URL:en ska vara giltig om den läcker.
- Instrumentpanelen är "semi-offentlig" — öppen nog att du inte vill ha OneUptime-konton för varje tittare, men inte öppen nog att läggas på det öppna internet.

För högvärdesgrindning (per-tittare-konton, granskningsspår över vem som såg vad), håll instrumentpanelen privat och bjud in tittare till projektet som endast-läs-medlemmar.

## IP-tillåtslista

På **Scale**-planen kan du begränsa en offentlig instrumentpanel till en lista över käll-IP:er eller CIDR-omfång. Konfigurera listan under **Dashboard → Settings → IP Whitelist**.

Använd en IP-tillåtslista när:

- Instrumentpanelen ska bara vara nåbar från ditt kontor eller VPN.
- En leverantörsportal ska bara vara nåbar från deras publicerade utgående IP:er.
- Du vill ha försvar i djupled ovanpå ett masterlösenord.

Förfrågningar från någon annan IP får en 403.

## Anpassade domäner

Standard är att en offentlig instrumentpanel serveras på `oneuptime.com`. För att hosta den på din egen subdomän (t.ex. `dashboard.acme.com`):

1. Lägg till en CNAME-post på din DNS som pekar subdomänen till OneUptimes publicerade mål.
2. Under **Dashboard → Settings → Custom Domains**, lägg till domänen.
3. Verifiera DNS-posten (OneUptime kontrollerar den åt dig).
4. När den är verifierad är instrumentpanelen nåbar på både OneUptime-URL:en och din anpassade domän.

Anpassade domäner är användbara för:

- Kundvända instrumentpaneler på ditt varumärke.
- Sambrandade partnerinstrumentpaneler.
- SEO på en offentlig hälsosida.

Du kan koppla flera anpassade domäner till en instrumentpanel om du serverar samma innehåll till flera målgrupper.

## Varumärkning för offentliga instrumentpaneler

Under **Dashboard → Settings**, konfigurera:

- **Sidtitel** — `<title>`-taggen och rubriken som besökare ser.
- **Sidbeskrivning** — metabeskrivningen som används av sökmotorer och sociala förhandsvisningar.
- **Logotypfil** — ladda upp en PNG/SVG; visas i instrumentpanelens sidhuvud.
- **Favicon** — uppladdad; visas i webbläsarens flik.

Varumärkning gäller endast offentlig-lägesrendering. Interna tittare ser alltid OneUptimes varumärkning.

## Inbäddning

Du kan bädda in en offentlig instrumentpanel i en `<iframe>` på din egen webbplats:

```html
<iframe src="https://dashboard.acme.com/view"
        width="100%" height="800"
        frameborder="0"></iframe>
```

Om du bäddar in en instrumentpanel som skyddas av ett masterlösenord ser besökaren fortfarande lösenordsprompten inuti iframen.

## Delbara URL:er med variabeltillstånd

Instrumentpanelens URL kodar de aktuella variabelvalen och tidsintervallet som query-parametrar. Justera rullgardinsmenyerna, kopiera URL:en och klistra in den i chatten — mottagaren ser instrumentpanelen med exakt samma vy, inklusive tidsintervallet du tittade på.

Det här är det snabbaste sättet att peka en kollega mot "instrumentpanelen vid den tid då incidenten började" — pinna tidsintervallet, kopiera, klistra in.

## Var läsa vidare

- [Konfiguration & behörigheter](/docs/dashboards/configuration) — åtkomstkontroll i privat läge.
- [Variabler & filter](/docs/dashboards/variables) — variabler som offentliga besökare kan interagera med.
- [Skapa en instrumentpanel](/docs/dashboards/authoring) — vad som hamnar på arbetsytan från början.
