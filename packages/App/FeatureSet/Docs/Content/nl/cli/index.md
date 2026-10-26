# CLI – Overzicht

De OneUptime-CLI, `oneuptime`, beheert je OneUptime-project vanuit een terminal of een script. Hij toont, leest, maakt, wijzigt, verwijdert en telt monitoren, incidenten, waarschuwingen, statuspagina's en de andere records die de OneUptime-API aanbiedt, met een API-sleutel van je project.

:::cards
- [Hoe de CLI werkt](#hoe-de-cli-werkt): Eén opdracht, één API-verzoek, één antwoord.
- [De CLI installeren](#de-cli-installeren): Eén npm-opdracht, en welke versie je kiest.
- [Je eerste opdrachten uitvoeren](#je-eerste-opdrachten-uitvoeren): Sla je API-sleutel op en toon dan je incidenten.
- [De opdrachten in één oogopslag](#de-opdrachten-in-één-oogopslag): Elke opdracht, en de pagina die hem uitlegt.
:::

## Hoe de CLI werkt

Elke opdracht stuurt één verzoek naar de REST API van OneUptime en drukt het antwoord af. De CLI haalt de API-sleutel en het adres van je OneUptime uit vlaggen, omgevingsvariabelen of een context die `oneuptime login` heeft opgeslagen. De sleutel bepaalt wat een opdracht mag lezen en wijzigen, precies zoals bij de API.

```mermaid title="Eén opdracht, één verzoek"
flowchart TB
    T["Je terminal<br/>of een CI-job"] -->|"oneuptime incident list"| C["oneuptime-CLI"]
    K["De API-sleutel en URL:<br/>vlaggen, omgeving<br/>of een opgeslagen context"] --> C
    C -->|"POST /api/incident/get-list"| A["REST API van OneUptime"]
    A -->|"de records die de<br/>sleutel mag lezen,<br/>als JSON"| C
    C -->|"een tabel in een terminal,<br/>JSON in een pipe"| T
```

De opdrachten voor records komen met de CLI mee: elk soort record dat de OneUptime-API voor tools openstelt, heeft er een, dezelfde records waarvoor de [MCP-server](/docs/ai/mcp-server) tools heeft. Voer `oneuptime resources` uit om ze te tonen.

## Voordat je begint

- **Node.js en npm**, een actuele LTS-release, om de CLI te installeren.
- **Een API-sleutel van je project.** Maak er een aan in **Projectinstellingen → Geavanceerd → API-sleutels** met **API-sleutel aanmaken**: zie [Een API-sleutel aanmaken](/docs/api-reference/api-reference#een-api-sleutel-aanmaken).
- **Op OneUptime Cloud het Growth-abonnement of hoger.** De API-sleutels van een project werken alleen daarop: zie [API-sleutels en SCIM onder hun abonnement](/docs/api-reference/api-reference#api-sleutels-en-scim-onder-hun-abonnement).

## De CLI installeren

Installeer het pakket `@oneuptime/cli` vanuit npm. Het voegt de opdracht `oneuptime` toe, en `--version` drukt de geïnstalleerde versie af:

```bash
npm install -g @oneuptime/cli
oneuptime --version
```

De CLI verschijnt samen met OneUptime en heeft hetzelfde versienummer. Op een zelf gehoste OneUptime installeer je de CLI van de versie van je OneUptime, zodat de opdrachten passen bij de records die je server heeft:

```bash
npm install -g @oneuptime/cli@<your-oneuptime-version>
```

> [!WARNING]
> CLI-versies van vóór 14.0.64 stoppen zodra ze starten, met een fout als `Cannot find module 'Common/Models/DatabaseModels/Index'`. Installeer 14.0.64 of later met `npm install -g @oneuptime/cli@latest`. Is je zelf gehoste OneUptime ouder dan 14.0.64, [werk OneUptime dan eerst bij](/docs/installation/upgrading#hoe-u-upgradet) en installeer daarna de CLI van de versie waarnaar je hebt bijgewerkt.

## Je eerste opdrachten uitvoeren

:::steps
### Je API-sleutel opslaan

Log in met de sleutel en het adres van je OneUptime. De CLI slaat ze op als een context met de naam `default` en gebruikt die vanaf nu:

```bash
oneuptime login <your-api-key> https://oneuptime.com
```

Hij antwoordt `Logged in successfully. Context "default" is now active.` Gebruik op een zelf gehoste OneUptime het adres daarvan in plaats van `https://oneuptime.com`.

### Je incidenten tonen

```bash
oneuptime incident list
```

De tien nieuwste incidenten verschijnen als tabel. `login` slaat de sleutel op zonder hem te controleren, dus dit is de eerste opdracht die laat zien dat de sleutel werkt: wordt hij geweigerd, zie dan [Problemen oplossen](/docs/cli/authentication#problemen-oplossen).

### Zien wat je nog meer kunt beheren

```bash
oneuptime resources
```

De lijst toont elk soort record waarmee je kunt werken, en de opdracht ervan, zoals `monitor`, `status-page` of `on-call-policy`.
:::

## De opdrachten in één oogopslag

| Opdracht | Wat hij doet | Meer lezen |
| --- | --- | --- |
| `oneuptime login <api-key> <instance-url>` | Slaat een API-sleutel en een adres op als context | [Authenticatie](/docs/cli/authentication#inloggen) |
| `oneuptime context list`, `use`, `current`, `delete` | Toont, wisselt, laat zien en verwijdert opgeslagen contexten | [Authenticatie](/docs/cli/authentication#contexten) |
| `oneuptime whoami` | Toont de URL en API-sleutel die de volgende opdracht gebruikt | [Authenticatie](/docs/cli/authentication#controleren-wat-de-cli-gaat-gebruiken) |
| `oneuptime deploy` | Legt een deploy, of een andere wijziging, vast voor grafieken en OneUptime AI | [Deploys en wijzigingen](/docs/telemetry/change-events) |
| `oneuptime <resource> list`, `get`, `create`, `update`, `delete`, `count` | Werkt met één soort record | [Bewerkingen op bronnen](/docs/cli/resource-operations) |
| `oneuptime resources` | Toont de soorten records, met hun opdrachten | [Opdrachtreferentie](/docs/cli/command-reference#oneuptime-resources) |
| `oneuptime version` | Drukt de versie van de CLI af | [Opdrachtreferentie](/docs/cli/command-reference#oneuptime-version) |
| `oneuptime help [command]` | Toont de hulp van een opdracht | [Hulp krijgen](#hulp-krijgen) |

## Globale opties

Deze opties werken met elke opdracht, ervoor of erna:

| Optie | Wat hij doet |
| --- | --- |
| `--api-key <key>` | De API-sleutel voor deze opdracht, in plaats van de opgeslagen |
| `--url <url>` | Het adres van je OneUptime voor deze opdracht |
| `--context <name>` | Een opgeslagen context voor deze opdracht, in plaats van de huidige |
| `-o, --output <format>` | `table`, `json` of `wide`: zie [Uitvoerformaten](/docs/cli/output-formats) |
| `--no-color` | Drukt af zonder kleuren |
| `-V, --version` | Drukt de versie van de CLI af |
| `-h, --help` | Toont de hulp van de opdracht |

## Hulp krijgen

Elke opdracht heeft zijn eigen hulp, met zijn argumenten, opties en standaardwaarden:

```bash
oneuptime --help
oneuptime help incident
oneuptime incident list --help
```

## Volgende stappen

:::cards
- [Authenticatie](/docs/cli/authentication): Contexten voor elke omgeving, en welke sleutel een opdracht gebruikt.
- [Bewerkingen op bronnen](/docs/cli/resource-operations): Records tonen, lezen, maken, wijzigen, verwijderen en tellen.
- [Uitvoerformaten](/docs/cli/output-formats): Tabellen voor mensen, JSON voor scripts.
- [Scripting en CI/CD](/docs/cli/scripting): Exitcodes, jq en pipelines.
- [Opdrachtreferentie](/docs/cli/command-reference): Elke opdracht, optie en standaardwaarde.
:::
