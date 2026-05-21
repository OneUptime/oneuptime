# Configuratie en veiligheid

Deze pagina behandelt de instellingen en veiligheidslimieten die de moeite waard zijn om te kennen voordat je een workflow op echt verkeer richt.

## Een workflow aan- of uitzetten

Elke workflow heeft een schakelaar **Enabled** in **Settings**. Wanneer die uitstaat draait de workflow niet — webhook-aanroepen, geplande tijden en OneUptime-events worden allemaal genegeerd. Nieuwe workflows starten uitgeschakeld.

Gebruik deze schakelaar als je "klaar om te gaan"-poort:

1. Bouw de workflow.
2. Klik op **Run Manually** met een realistische payload.
3. Controleer de **Logs** — zorg dat elk blok ging waar je verwachtte.
4. Zet **Enabled** aan.

Een workflow uitzetten stopt geen runs die al bezig zijn; het voorkomt alleen dat nieuwe starten.

## Eigenaren en labels

- **Owners** — gebruikers en teams die als eigenaar zijn opgenomen, krijgen toegang tot de workflow en kunnen zich aanmelden voor notificaties wanneer hij faalt. Stel ze in onder **Settings → Owners**.
- **Labels** — tags om workflows te groeperen. De workflowlijst laat je filteren op label, wat een druk project een stuk makkelijker te navigeren maakt. Handig wanneer je workflows hebt georganiseerd per team, integratie of omgeving.
- **Label rules** — onder **Workflows → Settings → Label Rules** worden labels automatisch toegepast op nieuwe workflows op basis van naam- of beschrijvingspatronen.
- **Owner rules** — onder **Workflows → Settings → Owner Rules** worden automatisch eigenaren toegewezen aan nieuwe workflows.

## Geheimen

Markeer een globale variabele als **secret** als hij iets gevoeligs bevat. De waarde wordt versleuteld, na opslaan verborgen in de UI en verborgen in de run-logs (weergegeven als `[REDACTED]`).

Gebruik secret-variabelen voor:

- API-sleutels voor externe services.
- Authenticatietokens.
- Webhook-signing-sleutels.
- Alles wat je niet wilt dat iemand met alleen-leesrechten ziet.

Plak een geheim niet direct in een blok — waarden zoals `Authorization: Bearer eyJh...` belanden zichtbaar in de workflow en de logs. Gebruik in plaats daarvan `{{variable.MY_SECRET}}`.

## Hoe lang een run mag duren

Elke run heeft een maximale lengte. Als een run niet op tijd klaar is, wordt hij gemarkeerd als **Timeout** en wordt het blok dat bezig is geannuleerd. De standaard is ruim — lang genoeg voor normale HTTP-aanroepen en ketens van blokken.

Individuele blokken hebben hun eigen tijdslimieten daarbinnen — een API-blok geeft bijvoorbeeld op aan een hangende uitgaande aanvraag ruim voordat de hele run dat doet.

## Limiet op het aanroepen van andere workflows

Met de **Execute Workflow**-component kan de ene workflow de andere aanroepen. Om te voorkomen dat workflow A per ongeluk B aanroept die A weer aanroept, is er een limiet op hoe diep de keten kan gaan. Een run die deze limiet overschrijdt eindigt met een duidelijke foutmelding.

Als je echt een lange keten nodig hebt (bijvoorbeeld een taak die per run één item verwerkt), is het meestal eenvoudiger om binnen één workflow te loopen met **Custom Code**.

## Webhook-beveiliging

Webhook-triggers geven je een unieke URL. Iedereen die de URL kent kan hem aanroepen. Om je te beschermen tegen onbedoelde of ongewenste aanroepers:

- Behandel de URL als een wachtwoord. Deel hem niet publiekelijk en commit hem niet naar een publieke repo.
- Voor gevoelige workflows kun je het aanroepende systeem vragen een gedeeld token als header te sturen (zoals `X-Webhook-Token`) en die controleren met een **Conditions**-blok voordat je iets belangrijks doet. Sla het verwachte token op als secret-variabele.
- Voor zeer gevoelige workflows geef je de voorkeur aan een OneUptime event-trigger en een handmatige importstap in plaats van een publieke webhook.

## Uitgaande netwerktoegang

API- en andere HTTP-blokken doen hun aanvragen vanuit OneUptime. Bij self-hosting zorg je dat je installatie de services kan bereiken die je aanroept. Bij OneUptime Cloud staan onze uitgaande IP-ranges vermeld in [IP Addresses](/docs/configuration/ip-addresses) zodat je ze aan de andere kant kunt toestaan.

## Machtigingen

Workflows respecteren de role-based access control van je project. De relevante machtigingen:

- **Create / Read / Edit / Delete Workflow** — de basismachtigingen op de workflow zelf.
- **Run Workflow** — nodig om op **Run Manually** te klikken of een workflow via de API te triggeren.
- **Read Workflow Log** — nodig om runs te bekijken.
- **Read / Create / Edit / Delete Workflow Variable** — controle over de lijst met globale variabelen.

De meeste engineers zouden create/edit/read op workflows moeten hebben, maar niet op variabelen. Bewaar bewerkrechten op variabelen voor de mensen die de geheimen van je project beheren.

## Plan-limieten

OneUptime Cloud beperkt het aantal runs per maand op kleinere plannen. Je huidige limiet staat onder **Project Settings → Billing**. Wanneer je hem bereikt, worden nieuwe triggers afgewezen tot de volgende factureringscyclus. Self-hosted installaties hebben deze limiet niet.

## Wanneer workflows niet de juiste tool zijn

Een paar gevallen waarin je beter naar iets anders kunt grijpen:

- **Zware berekeningen of grote datasets** — workflows zijn bedoeld voor licht lijmwerk, niet voor cijfers kraken. Voer zwaar werk uit op je eigen infrastructuur en laat een workflow het aansturen.
- **Langlopende processen die uren duren** — één run hoort snel klaar te zijn. Als je "doe A, wacht twee uur, doe B" nodig hebt, gebruik dan een externe scheduler die een webhook terugstuurt naar OneUptime wanneer het tijd is.
- **Stap-voor-stap incidentrespons met mensen in de loop** — daar zijn [Runbooks](/docs/runbooks/index) voor. Workflows zijn voor onbeheerde automatisering.

## Waar verder lezen

- [Workflows – Overzicht](/docs/workflows/index) — het grote plaatje.
- [Componenten](/docs/workflows/components) — blok-per-blok referentie.
- [Runbooks](/docs/runbooks/index) — wanneer je beter een runbook gebruikt.
