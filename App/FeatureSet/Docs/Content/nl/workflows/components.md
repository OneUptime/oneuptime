# Componenten

Componenten zijn de bouwstenen die je achter de trigger toevoegt. Elke component doet één ding — een bericht versturen, een API aanroepen, een voorwaarde controleren — en koppelt aan wat erna komt.

Deze pagina is de catalogus. Voor hoe je componenten over het canvas sleept, neerzet en verbindt, zie [Een workflow maken](/docs/workflows/authoring).

## API

Doe een HTTP-verzoek naar elke URL.

**Settings**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH` of `DELETE`.
- **URL** — het adres dat je wilt aanroepen.
- **Headers** — eventuele headers om mee te sturen.
- **Body** — de request body voor `POST` / `PUT` / `PATCH`.

**Outputs**:

- **Success** — gaat af wanneer de aanroep werkte (2xx-respons). Geeft de status, headers en body door.
- **Error** — gaat af bij een netwerkfout of een respons die geen 2xx is. Geeft het foutbericht door.

Gebruik dit voor: elke externe API, je eigen admin-endpoints of elke integratie die geen eigen component heeft.

## Webhook (uitgaand)

Een eenvoudigere versie van de API-component voor "fire and forget"-gevallen. Post een JSON-body naar een URL.

Gebruik **API** als je de respons moet lezen. Gebruik **Webhook** als je alleen maar een notificatie wilt versturen en verder gaan.

## Slack

Post een bericht in een Slack-kanaal.

**Settings**:

- **Channel** — de kanaalnaam. De bot moet al lid zijn van dat kanaal.
- **Message** — de te versturen tekst. Ondersteunt Slack-opmaak.

Koppel Slack eerst aan je project onder **Project Settings → Workspace Connections → Slack**. Zie [Slack Workspace Connection](/docs/workspace-connections/slack).

## Microsoft Teams

Post een bericht in een Microsoft Teams-kanaal.

**Settings**:

- **Team and channel** — waar je wilt posten.
- **Message** — de te versturen tekst.

Zie [Microsoft Teams Workspace Connection](/docs/workspace-connections/microsoft-teams) voor het opzetten.

## Discord

Post een bericht in een Discord-kanaal via een inkomende webhook-URL.

## Telegram

Verstuur een bericht naar een Telegram-chat met een bottoken en chat-ID.

## Email

Verstuur een e-mail via OneUptime.

**Settings**:

- **To** — het e-mailadres van de ontvanger.
- **Subject** — de onderwerpregel.
- **Body** — het bericht in Markdown of HTML.

De e-mail wordt verstuurd vanaf de geconfigureerde afzender van je project — zie [SMTP](/docs/emails/smtp).

## Custom Code

Voer een klein stukje JavaScript uit wanneer je iets nodig hebt wat de andere blokken niet kunnen.

**Settings**:

- **Code** — je JavaScript. De laatste waarde (of wat je vanuit een async functie returnt) wordt de output van het blok.
- **Arguments** — benoemde waarden die je kunt meegeven.

**Outputs**: success (jouw returnwaarde) en error (een exception).

Gebruik dit voor: data omvormen tussen twee systemen, een kleine berekening, alles wat geen eigen blok verdient. Voor zwaardere scripts kun je een [Runbook](/docs/runbooks/index) gebruiken.

## JSON

Converteer tussen tekst en JSON.

- **JSON → Text** — zet een JSON-object om in een string. Handig wanneer het volgende blok tekst verwacht.
- **Text → JSON** — parseer een string naar een JSON-object. Handig wanneer iets als tekst is binnengekomen en je een veld wilt lezen.

## Conditions

Vertak op basis van een vergelijking.

**Settings**:

- **Left value** — meestal een waarde uit een eerder blok.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — waarmee je vergelijkt.

**Outputs**: **Yes** en **No**. Verbind de volgende blokken met de tak die je wilt.

## Delay

Pauzeer de workflow voor een bepaalde tijd voordat je verder gaat. Handig wanneer je een ander systeem even moet laten bijkomen.

## Log

Schrijf een regel naar het run-log. Geen extern effect — het verschijnt alleen in de logs van de workflow zodat jij het kunt lezen. Handig voor debuggen.

## Execute Workflow

Roep een andere workflow aan vanuit deze. De aangeroepen workflow draait op zichzelf — jouw workflow gaat verder zonder erop te wachten dat hij klaar is.

Gebruik dit om gemeenschappelijke logica te delen. Bouw één keer een "post to incident channel"-workflow en roep die aan vanuit elke andere workflow die het kanaal moet aanstoten.

Er is een veiligheidsgrens zodat workflows elkaar niet in een lus kunnen blijven aanroepen. Zie [Configuratie en veiligheid](/docs/workflows/configuration).

## OneUptime-datacomponenten

Voor elk soort record in OneUptime (monitors, incidenten, alerts, statuspagina's, oncall-policies en nog veel meer) heeft het palet deze componenten — zoek op de naam van het type:

- **Find One** — haal één record op via ID of filter.
- **Find** — haal een lijst met records op.
- **Create** — voeg een nieuw record toe.
- **Update** — wijzig één record.
- **Delete** — verwijder één record.
- **Count** — tel records die aan een filter voldoen.

Zo kan een workflow OneUptime-data lezen en wijzigen. Bijvoorbeeld: een webhook vanuit je CI-tool kan **Create Incident** gebruiken om een incident te openen met de faaldetails.

## Welke component moet ik gebruiken?

Een paar vuistregels:

- Als er een speciaal blok is voor wat je wilt (Slack, Email, een OneUptime-record), gebruik dat — je krijgt netter foutafhandeling en duidelijkere logs.
- Voor elke andere externe API gebruik je **API**.
- Voor het omvormen van data tussen blokken gebruik je **Custom Code** of **JSON**.
- Om verschillende acties op basis van een waarde te nemen, gebruik je **Conditions**.

## Waar verder lezen

- [Variabelen](/docs/workflows/variables) — data tussen blokken doorgeven.
- [Uitvoeringen en logboeken](/docs/workflows/runs-and-logs) — controleren wat elk blok bij een run heeft gedaan.
- [Configuratie en veiligheid](/docs/workflows/configuration) — limieten, eigenaren en geheimen.
