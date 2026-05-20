# Workflow-componenten

Componenten zijn de actienodes die je achter een trigger plaatst. Elke component doet één ding — een HTTP-verzoek doen, een Slack-bericht sturen, vertakken op een voorwaarde, een JavaScript-snippet draaien — en stelt één of meer output-poorten beschikbaar waaraan de volgende node kan worden gekoppeld.

Deze pagina is een catalogus. Voor bedradingsregels en het canvas zelf, zie [Een workflow maken](/docs/workflows/authoring).

## API

Doe een uitgaand HTTP-verzoek naar een willekeurige URL.

**Argumenten**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH`, `DELETE`.
- **URL** — de request-URL. Geïnterpoleerd.
- **Request Headers** — JSON-object met headers.
- **Request Body** — JSON- of tekst-body voor `POST` / `PUT` / `PATCH`.

**Output-poorten**:

- `success` — gaat af wanneer de responsstatus 2xx is. Returnwaarden: `response-status`, `response-headers`, `response-body`.
- `error` — gaat af bij een netwerkfout of niet-2xx-respons. Returnwaarde: `error`-bericht.

Gebruik dit voor: elke REST-API van derden, je eigen admin-endpoints, lichte integraties zonder een eigen component.

## Webhook (uitgaand)

Een dunne wrapper rond de API-component voor het veelvoorkomende "fire and forget"-geval. Verstuurt een JSON-body naar een URL en stelt één `success`/`error`-paar beschikbaar.

Geef de voorkeur aan **API** als je de responsbody stroomafwaarts wilt lezen; geef de voorkeur aan **Webhook** als je alleen een ander systeem wilt notificeren.

## Slack

Post een bericht in een Slack-kanaal via de Slack-workspace-verbinding van je project.

**Argumenten**:

- **Channel name** — het kanaal waarin gepost wordt. De bot moet al lid zijn van dat kanaal.
- **Message text** — de body. Geïnterpoleerd; ondersteunt Slack mrkdwn.

Stel de workspace-verbinding eerst in via **Project Settings → Workspace Connections → Slack**. Zie [Slack Workspace Connection](/docs/workspace-connections/slack).

## Microsoft Teams

Post een bericht in een Microsoft Teams-kanaal via de Teams-verbinding van je project.

**Argumenten**:

- **Team & channel** — de bestemming.
- **Message text** — de body.

Zie [Microsoft Teams Workspace Connection](/docs/workspace-connections/microsoft-teams) voor het opzetten van de verbinding.

## Discord

Post een bericht in een Discord-kanaal via een inkomende webhook-URL die op de component is geconfigureerd.

## Telegram

Stuur een bericht naar een Telegram-chat via een bot-token en chat-ID die op de component zijn geconfigureerd.

## E-mail

Verstuur een e-mail via de SMTP-configuratie van OneUptime.

**Argumenten**:

- **To** — het ontvangende e-mailadres.
- **Subject** — geïnterpoleerd.
- **Body** — Markdown of HTML.

De e-mail wordt verzonden vanaf het geconfigureerde afzenderadres van het project (zie [SMTP](/docs/emails/smtp)).

## Custom Code

Draai een snippet JavaScript met toegang tot de variabelen van de workflow en de returnwaarden van de bovenliggende node.

**Argumenten**:

- **Code** — de JavaScript-body. De waarde van de laatste expressie (of alles wat wordt teruggegeven door `(async () => { ... })()`) wordt de returnwaarde van de component.
- **Arguments** — optionele benoemde waarden die als `args` worden meegegeven.

**Output-poorten**: `success` (returnwaarde), `error` (gevangen exception).

Gebruik dit voor: een payload transformeren tussen twee systemen, een kleine berekening doen die geen eigen component verdient, JS-specifieke logica aanroepen. Zwaardere scripting die in je eigen infrastructuur moet draaien hoort thuis in een Bash- of JavaScript-stap van een [Runbook](/docs/runbooks/index).

## JSON

Converteer tussen tekst en JSON.

- **JSON → Text** — serialiseer een JSON-object naar een string (handig om door te geven aan een `body`-argument van een uitgaande component dat tekst verwacht).
- **Text → JSON** — parseer een string naar een JSON-object. Handig wanneer een bovenliggende API zijn body als tekst teruggaf, maar je een veld moet lezen.

## Conditions

Vertak op een vergelijking. Configureer:

- **Left value** — meestal een geïnterpoleerde verwijzing zoals `{{Incident.title}}`.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — de waarde om mee te vergelijken.

**Output-poorten**: `yes` en `no`. Koppel de rest van de workflow aan de tak die bij je bedoeling past.

## Schedule (vertraging)

Pauzeer een workflow gedurende een geconfigureerde tijdsduur voordat hij doorgaat. Handig wanneer je een extern systeem even de tijd moet geven om tot rust te komen voordat je zijn status controleert.

## Log

Schrijf een regel naar het workflow-runlog. Puur een debughulpmiddel; de regel wordt vastgelegd op de run en is zichtbaar onder **Logs**. Geen extern bijeffect.

## Execute Workflow

Roep een andere workflow aan als substap. De aangeroepen workflow draait zelfstandig (fire-and-forget) — de controle keert terug naar de caller zodra de aanroep is verstuurd.

Gebruik dit om gedeelde logica uit meerdere workflows te factoreren: bouw één keer een "post-to-incident-channel"-workflow en roep die aan vanuit elke andere workflow die het kanaal moet informeren.

Een recursielimiet voorkomt dat workflows elkaar in een oneindige lus aanroepen. Zie [Configuratie en veiligheid](/docs/workflows/configuration).

## Modelcomponenten (CRUD op OneUptime-entiteiten)

Voor elke OneUptime-entiteit die workflows ondersteunt (monitors, incidenten, alerts, statuspagina's, oproepdienstbeleid, enz.), stelt het palet automatisch de volgende componenten beschikbaar — doorzoekbaar op entiteitsnaam:

- **Find One {Entity}** — haal een enkel record op via een query.
- **Find {Entity}** — haal een lijst van records op via een query (gepagineerd).
- **Create {Entity}** — voeg een nieuw record toe.
- **Update {Entity}** — werk één record bij op basis van ID.
- **Delete {Entity}** — verwijder één record op basis van ID.
- **Count {Entity}** — tel de records die matchen met een query.

Zo kan een workflow OneUptime-state lezen en schrijven zonder het platform te verlaten. Bijvoorbeeld: een webhook van je CI-tool roept **Create Incident** aan met het foutbericht van de build; of een geplande workflow voert elke vijf minuten **Find Incident** uit en stuurt een samenvatting per e-mail.

## De juiste component kiezen

Een paar vuistregels:

- Als er een speciale component bestaat voor wat je wilt doen (Slack, Email, een CRUD op een OneUptime-entiteit), gebruik die — die geeft je betere foutafhandeling en helderdere logs dan een eigen oplossing.
- Als je een externe HTTP-API moet aanroepen zonder eigen component, gebruik **API**.
- Als je data tussen twee componenten moet *vormgeven*, gebruik **Custom Code** of **JSON**.
- Als je verschillende acties moet ondernemen op basis van een waarde, gebruik **Conditions**.

## Waar verder lezen

- [Variabelen](/docs/workflows/variables) — hoe je data van de ene component naar de andere voedt.
- [Uitvoeringen en logboeken](/docs/workflows/runs-and-logs) — hoe je inspecteert wat elke component tijdens een run heeft teruggegeven.
- [Configuratie en veiligheid](/docs/workflows/configuration) — limieten, eigenaarschap en geheimen.
