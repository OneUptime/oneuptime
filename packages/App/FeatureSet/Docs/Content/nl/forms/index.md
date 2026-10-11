# Formulieren – overzicht

Een formulier is een pagina die iedereen met de link kan invullen, zonder OneUptime-account. Elke inzending maakt iets aan in uw project: een **incident**, voor probleemmeldingen, of een **geplande onderhoudsgebeurtenis**, voor wijzigings- en onderhoudsverzoeken. U bouwt de vragen van het formulier in een editor met slepen en neerzetten, bepaalt hoe de antwoorden het record worden en deelt de link met de mensen die het moeten gebruiken.

Gebruik een formulier als de mensen die een probleem opmerken, of een wijziging nodig hebben, niet degenen zijn die uw incidenten en onderhoud afhandelen: supportmedewerkers, collega's van een andere afdeling, een filiaalmanager, het operationele team van een klant. Ze openen de link, beantwoorden uw vragen en klikken op **Verzenden**. Uw team krijgt een gewoon incident of een gewone gebeurtenis, met de antwoorden in de velden en een privénotitie die vastlegt wie het heeft verzonden.

:::cards
- [Uw eerste formulier maken](#uw-eerste-formulier-maken): Van een leeg formulier naar een link die u kunt delen.
- [Een formulier bouwen](/docs/forms/building): Vragen, antwoordtypen, verborgen vragen, sjablonen en huisstijl.
- [Wat een inzending aanmaakt](/docs/forms/on-submit): Hoe de antwoorden en de instellingen een incident of een onderhoudsgebeurtenis worden.
- [Delen & beveiliging](/docs/forms/sharing-and-security): De link, de IP-toelatingslijst, snelheidslimieten en probleemoplossing.
:::

## Zo werkt een formulier

```mermaid title="Van een ingevuld formulier naar een incident of onderhoudsgebeurtenis"
flowchart TB
    submitter["Iemand met de link,<br/>zonder account"] --> page["De pagina van het formulier"]
    page -->|Verzenden| checks["Beveiliging en<br/>controle van de antwoorden"]
    checks --> submission["Inzending, bewaard<br/>bij het formulier"]
    submission --> target{"Elke inzending maakt aan"}
    target -->|Incident| incident["Incident, verborgen<br/>op statuspagina's"]
    target -->|Gepland onderhoud| event["Onderhoudsgebeurtenis,<br/>verborgen tenzij ingesteld"]
    incident --> response["Dienstbeleid en<br/>regels worden uitgevoerd"]
    incident --> note["Privénotitie: wie het verzond,<br/>overige antwoorden"]
    event --> note
```

Elke aanvraag gaat eerst langs de beveiliging van het formulier: de eigen pagina, snelheidslimieten, de IP-toelatingslijst en de captcha. Een inzending waarvan de antwoorden kloppen, wordt bewaard en maakt één record aan, ingevuld met de antwoorden, de instellingen onder **Bij verzenden** van het formulier en, bij een incident, het incidentsjabloon. Niets wat ze aanmaakt, komt op een statuspagina tot uw team dat besluit.

## In het kort

- **Een eigen product**: **Formulieren** staat in het productmenu, op `/dashboard/{projectId}/forms`. Elk formulier heeft een eigen link, zoals `https://oneuptime.com/accounts/form/<share-key>` op OneUptime Cloud.
- **Geen account nodig**: iedereen met de link kan het formulier openen en verzenden, zonder aan te melden.
- **Een editor, geen instellingenpagina**: voeg eigen vragen toe (korte antwoorden, alinea's, keuzelijsten, datums, selectievakjes en meer), de velden van wat het formulier aanmaakt (titel, beschrijving, ernst, monitoren, labels, begin en einde), uw aangepaste velden en de naam en het e-mailadres van de inzender. Sleep ze in de juiste volgorde, bekijk het formulier in het voorbeeld en sla op.
- **U bepaalt waar elke waarde vandaan komt**: de pagina **Bij verzenden** toont elk veld van het nieuwe incident of de nieuwe gebeurtenis naast de bron: een antwoord, een standaardwaarde, een instelling die altijd geldt, of het incidentsjabloon.
- **Verborgen tot iemand het publiceert**: incidenten uit een formulier worden bij het melden nooit op statuspagina's getoond of naar abonnees gestuurd; onderhoudsgebeurtenissen ook niet, tenzij het formulier dat zegt.
- **In lagen beveiligd**: een schakelaar **Accepteert inzendingen**, een optionele **IP-toelatingslijst**, het weigeren van aanvragen van andere websites, snelheidslimieten, de captcha van de instantie en groottelimieten voor elk antwoord.
- **Elke inzending bewaard**: de pagina **Inzendingen** van elk formulier, en **Formulieren → Inzendingen** voor alle formulieren, tonen de antwoorden en linken naar wat elke inzending heeft aangemaakt.
- **Uw eigen huisstijl**: upload een logo voor de bovenkant van de formulierpagina en een favicon voor het browsertabblad, in de sectie **Huisstijl** van de pagina **Bouwen**. Tot die tijd toont het formulier die van OneUptime.
- **Sjablonen voor veelvoorkomende gevallen**: sla benoemde sets antwoorden op, zoals **Storing in applicatie** of **Gepland onderhoudswerk**, en mensen kiezen er bovenaan het formulier een om het in te vullen, of openen de eigen link ervan. Elk sjabloon kan een vraag voor zijn geval ook verplicht, optioneel of verborgen maken. Eén formulier, en één bladwijzer, dient zo een heel team.
- **Verborgen vragen**: verberg een vraag die niemand zou moeten hoeven te beantwoorden, zoals de beschrijving van het incident, en laat elk sjabloon haar beantwoorden, of stellen, in de gevallen die haar nodig hebben.
- **Formulier dupliceren**: begin een formulier voor een ander team vanuit een formulier dat werkt, met de vragen, sjablonen en instellingen ervan.

## Wat een formulier kan aanmaken

Wanneer u een formulier maakt, kiest u wat **Elke inzending maakt aan**. U kunt dat later wijzigen op de pagina **Bij verzenden** van het formulier.

| Elke inzending maakt aan | Gebruiken voor | Wat er gebeurt |
| --- | --- | --- |
| **Incident** | Probleemmeldingen | Er wordt meteen een incident gemeld, zodat uw dienstbeleid en regels worden uitgevoerd en de mensen met dienst worden ingelicht. Het blijft van statuspagina's af tot iemand die het afhandelt het publiceert. |
| **Geplande onderhoud** | Wijzigings- en onderhoudsverzoeken | Er wordt een onderhoudsgebeurtenis gepland voor het tijdvak dat de inzender vraagt. Tenzij het formulier anders zegt, blijft ze van de statuspagina's af en licht ze geen abonnees in. |

Formulieren beginnen met deze twee; meer soorten records volgen.

## Voordat u begint

- **Een abonnement met formulieren.** Op OneUptime Cloud hebben formulieren het abonnement **Growth** of hoger nodig. Zie [Abonnement](#abonnement).
- **De machtiging om formulieren te maken.** **Create Form** hebben projecteigenaren en -beheerders, en de rollen waaraan u het geeft. Zie [Machtigingen](#machtigingen).
- **Voor een incidentformulier een ernst.** Elk incident heeft er een nodig: uit een vraag, uit de instellingen van het formulier of uit het incidentsjabloon. Zonder ernst wordt elke inzending geweigerd. Zie [Wat een inzending aanmaakt](/docs/forms/on-submit#how-a-submission-becomes-an-incident).

## Uw eerste formulier maken

:::steps
### Het formulier maken

Open **Formulieren** in het productmenu en klik op **Formulier aanmaken**. Geef het formulier een naam (de kop van de openbare pagina, uniek in het project), kies wat **Elke inzending maakt aan** en eventueel een beschrijving in Markdown, die bovenaan de openbare pagina staat.

### De vragen bouwen

Het formulier opent op de pagina **Bouwen** en vraagt al om een titel, een beschrijving en wie inzendt (en bij een onderhoudsformulier wanneer het onderhoud begint en eindigt). Voeg vragen toe, verwijder ze en zet ze op volgorde, en klik daarna op **Wijzigingen opslaan**. Zie [Een formulier bouwen](/docs/forms/building).

### Bepalen wat een inzending aanmaakt

Controleer onder **Bij verzenden** hoe een inzending een incident of gebeurtenis wordt, en klik op **Instellingen bewerken** om standaardwaarden te geven: een ernst, een incidentsjabloon, monitoren en labels die altijd worden toegevoegd, eigenaren die worden ingelicht. Zie [Wat een inzending aanmaakt](/docs/forms/on-submit).

### Sjablonen toevoegen als dezelfde gevallen vaak worden gemeld

Sla onder **Sjablonen** een sjabloon op voor elk geval dat vaak wordt gemeld: het formulier toont ze boven de vragen, vult zich in vanuit het gekozen sjabloon en stelt de vragen zoals dat sjabloon zegt; een vraag die een geval nodig heeft, kan in het sjabloon van dat geval verplicht zijn en in de andere verborgen. Zie [Sjablonen](/docs/forms/building#templates).

### De link delen

Kopieer onder **Delen** de link en stuur hem naar de mensen die het formulier moeten gebruiken. Zie [Delen & beveiliging](/docs/forms/sharing-and-security).
:::

> [!IMPORTANT]
> Een nieuw formulier **Accepteert inzendingen** zodra het is aangemaakt, maar niemand kan het bereiken tot u de link deelt. Richt eerst de vragen en de beveiliging in.

## De pagina's van een formulier

| Pagina | Wat erop staat |
| --- | --- |
| **Bouwen** | Naam en beschrijving van het formulier, de **Huisstijl** (logo en favicon, ingeklapt) en de editor: de vragen, het vragenpalet en **Voorbeeld**. |
| **Sjablonen** | Benoemde sets antwoorden waarmee men het formulier kan beginnen, hoe elk sjabloon de vragen stelt, het sjabloon waarmee het formulier opent en de eigen link van elk sjabloon. |
| **Bij verzenden** | Wat elke inzending aanmaakt en hoe elk veld ervan wordt ingevuld. **Instellingen bewerken** wijzigt de standaardwaarden en wat altijd geldt. |
| **Delen** | **Accepteert inzendingen**, de **Deellink**, het bericht na het verzenden en de **IP-toelatingslijst**. |
| **Inzendingen** | Elke inzending via het formulier, de nieuwste eerst, met de antwoorden en wat ze heeft aangemaakt. |
| **Formulier dupliceren** | Onder **Geavanceerd**: een kopie van het formulier, voor u benoemd, met de vragen, sjablonen, instellingen onder Bij verzenden, huisstijl, bedankbericht en IP-toelatingslijst, en een eigen link. De kopie staat eerst uit en opent in haar editor. |
| **Formulier verwijderen** | Het verwijderen van het formulier, onder **Geavanceerd**. De inzendingen worden mee verwijderd; de incidenten en gebeurtenissen die het heeft aangemaakt niet. |

De sectie **Ontwikkelaars** in het menu van het formulier bevat de pagina's voor Terraform, de API en AI-assistenten, zoals bij elke andere resource.

## Formulieren en incidentsjablonen

Een sjabloon en een formulier besparen u allebei het twee keer intypen van hetzelfde incident, maar ze dienen verschillende mensen:

| | Incidentsjabloon | Formulier |
| --- | --- | --- |
| Wie het gebruikt | Uw team, aangemeld bij OneUptime | Iedereen met de link, zonder account |
| Waar | **Maken op basis van sjabloon** in de lijst met incidenten | Een eigen pagina, op de link van het formulier |
| Wat men kan wijzigen | Elk veld van het incident, vóór het melden | Alleen de antwoorden op de vragen die u hebt gekozen |
| Wat men ziet | Uw monitoren, beleid, eigenaren en elk veld | Naam, beschrijving en vragen van het formulier, en alleen de opties die u aanbiedt |
| Statuspagina's | Wat het sjabloon en het meldformulier zeggen | Verborgen tot iemand die het afhandelt het incident publiceert |

Ze werken samen. Geef een incidentformulier op de pagina **Bij verzenden** een **Incident Sjabloon**, en elk incident dat het meldt, wordt vanuit dat sjabloon gemeld: bouw het sjabloon voor wat uw team bij het incident nodig heeft, en het formulier voor wat u de inzender wilt vragen.

## Inzendingen

De pagina **Inzendingen** van een formulier toont elke inzending via dat formulier, de nieuwste eerst, met **Verzonden op**, **Ingezonden door** (de naam en het e-mailadres die de inzender opgaf, of **Anoniem**) en **Aangemaakt**, een link naar het incident of de gebeurtenis die ze heeft aangemaakt. **Antwoorden bekijken** toont elk antwoord zoals de inzender het gaf. **Formulieren → Inzendingen** toont de inzendingen van alle formulieren in het project.

Inzendingen worden door het formulier geschreven, nooit met de hand, en kunnen niet worden bewerkt. Een inzending verwijderen haalt de antwoorden en de naam en het e-mailadres van de inzender uit de lijst; het incident of de gebeurtenis die ze heeft aangemaakt blijft, net als de privénotitie erbij, die de gegevens van de inzender en de antwoorden herhaalt. Wordt het incident of de gebeurtenis verwijderd, dan blijft de inzending, en toont de kolom **Aangemaakt** **Inmiddels verwijderd**.

> [!WARNING]
> Als u iemands persoonsgegevens verwijdert, is het verwijderen van de inzending niet genoeg: bewerk of verwijder ook de privénotitie bij het incident of de gebeurtenis die ze heeft aangemaakt.

## Machtigingen

Met formulieren kunnen mensen buiten uw team incidenten en onderhoudsgebeurtenissen in uw project aanmaken, dus worden ze beheerd door projecteigenaren en -beheerders, en door de rollen waaraan u de machtigingen **Form** geeft. Ze staan in de groep **Form** van de [Machtigingsreferentie](/docs/permissions/reference):

| Machtiging | Wat ze toestaat | Wie ze standaard heeft |
| --- | --- | --- |
| **Create Form** | Formulieren maken en dupliceren. | Project Owner, Project Admin |
| **Edit Form** | Een formulier wijzigen: de vragen, de huisstijl, de sjablonen, de instellingen onder Bij verzenden, **Accepteert inzendingen**, de link en de **IP-toelatingslijst**. | Project Owner, Project Admin |
| **Delete Form** | Een formulier verwijderen, en daarmee de inzendingen. | Project Owner, Project Admin |
| **Read Form** | Formulieren, hun vragen, instellingen en links bekijken. | De bovenstaande, plus Project Member, Viewer en de rollen voor incidenten en gepland onderhoud |
| **Read Form Submission** | De inzendingen en hun antwoorden bekijken. | Project Owner, Project Admin |
| **Delete Form Submission** | Inzendingen verwijderen. | Project Owner, Project Admin |

Inzendingen bevatten wat onbekenden hebben ingetypt (namen, e-mailadressen en antwoorden die misschien nooit in het record terechtkomen), dus alleen projecteigenaren en -beheerders zien ze, tenzij u **Read Form Submission** verleent. Wie een formulier kan lezen, kan de link zien en delen. Een formulier verzenden vraagt helemaal geen machtiging. Hoe rollen en gedetailleerde machtigingen samenwerken, leest u in [Gebruikers, teams en machtigingen](/docs/permissions/index).

## Abonnement

Op OneUptime Cloud hebben formulieren het abonnement **Growth** of hoger nodig, en de **IP-toelatingslijst** van een formulier heeft **Scale** nodig, of ze nu bij het aanmaken van het formulier wordt ingesteld of later wordt bewerkt. De links van een project onder het abonnement **Growth**, of met een onbetaald abonnement, tonen de melding dat het formulier niet beschikbaar is, en er wordt niets aangemaakt.

## Formulieren via de API

Formulieren zijn een gewone API-resource op `/api/form`, en hun inzendingen op `/api/form-submission`, die u kunt lezen en verwijderen maar niet aanmaken of bewerken. De [API-referentie](/reference) bevat de volledige vorm van aanvragen en antwoorden.

### Vragen en instellingen

De vragen van een formulier zijn de kolom `fields`, een JSON-lijst in de volgorde waarin het formulier ze stelt, en de instellingen onder Bij verzenden zijn de `targetSettings`:

```json
{
  "data": {
    "targetType": "Incident",
    "fields": [
      {
        "id": "what",
        "source": "TargetField",
        "targetField": "title",
        "label": "What is wrong?",
        "isRequired": true
      },
      {
        "id": "office",
        "source": "Question",
        "type": "Dropdown",
        "label": "Which office are you in?",
        "dropdownOptions": "Berlin\nLondon",
        "isRequired": false
      },
      {
        "id": "email",
        "source": "Submitter",
        "submitterField": "Email",
        "label": "Your Email",
        "isRequired": true
      }
    ],
    "targetSettings": {
      "incidentSeverityId": "<severity-id>",
      "labelIds": ["<label-id>"]
    }
  }
}
```

Elke vraag heeft een eigen `id` (letters, cijfers, `-` en `_`), een `source`, een `label`, en optioneel `helpText` en `isRequired`:

| `source` | Wat ze vraagt |
| --- | --- |
| `Question` | Een eigen vraag van het formulier, beantwoord volgens `type`: `Text`, `LongText`, `Markdown`, `Number`, `Dropdown`, `MultiSelectDropdown`, `Boolean`, `Date` of `DateTime`. Een keuzelijst toont haar `dropdownOptions`, één per regel. |
| `TargetField` | Een veld van wat het formulier aanmaakt, aangewezen door `targetField`: `title`, `description`, `incidentSeverityId`, `monitors`, `labels` en `impactStartedAt` voor een incident; `title`, `description`, `startsAt`, `endsAt`, `monitors`, `statusPages` en `labels` voor een onderhoudsgebeurtenis. Een veld dat door te kiezen wordt beantwoord, toont de records die het aanbiedt in `allowedOptionIds`. |
| `TargetCustomField` | Een van de aangepaste velden van het incident of de gebeurtenis, aangewezen door `customFieldId`. |
| `Submitter` | `Name` of `Email` van de inzender, aangewezen door `submitterField`. |

Een vraag met `isHidden` op `true` wordt niet op de openbare pagina getoond, is nooit verplicht en wordt alleen beantwoord vanuit het sjabloon dat een inzending noemt, tenzij dat sjabloon haar stelt. `isRequired` en `isHidden` zijn de standaard van het formulier; elk sjabloon kan een vraag op zijn eigen manier stellen.

### Sjablonen in de API

De sjablonen van een formulier zijn de kolom `templates`, een JSON-lijst in de volgorde waarin het formulier ze toont. Elk sjabloon heeft een eigen `id` (letters, cijfers, `-` en `_`), een `name` van maximaal 100 tekens, uniek binnen het formulier, en `answers` per vraag-ID, elk zoals een inzending het verstuurt: tekst, een getal, `true` of `false`, de waarde van een optie of een lijst met waarden bij meervoudige keuze. `isDefault` op `true` maakt het tot het sjabloon waarmee het formulier opent; een formulier heeft er hoogstens één, en tot 50 sjablonen.

`fieldSettings`, ook per vraag-ID, zegt hoe het sjabloon een vraag stelt: `Required`, `Optional` of `Hidden`. Een vraag die het niet noemt (of als `null` noemt), wordt gesteld zoals het formulier haar stelt, en de vragen `startsAt` en `endsAt` van een onderhoudsgebeurtenis kunnen alleen `Required` zijn:

```json
{
  "data": {
    "templates": [
      {
        "id": "outage",
        "name": "Application Outage",
        "isDefault": true,
        "answers": {
          "what": "The application is down",
          "office": "Berlin"
        },
        "fieldSettings": {
          "office": "Required",
          "email": "Optional"
        }
      }
    ]
  }
}
```

Vragen, sjablonen en instellingen worden gecontroleerd telkens wanneer ze worden opgeslagen (vanuit het dashboard, de API, Terraform of een workflow), en een lijst die een regel overtreedt, wordt geweigerd met een melding die zegt wat er mis is. `shareKey`, de sleutel in de link van het formulier, wordt door OneUptime ingesteld wanneer het formulier wordt aangemaakt, en die wijzigen is wat **Link opnieuw instellen** doet.

### Huisstijl in de API

De huisstijl van een formulier bestaat uit `logoFileId`, `logoAltText` en `faviconFileId`. Upload eerst de afbeelding met `POST /api/file` in het project van het formulier (met een API-sleutel van dat project, of aangemeld als lid ervan met de ID in de header `tenantid`), stuur daarbij de `name`, het `fileType`, zoals `image/png`, en de bytes als base64 in `file`, en stel de teruggegeven `_id` in. Een upload naar een project waarvan u geen lid bent, wordt geweigerd met "You can upload files only to a project you are a member of." Elke upload is privé: `isPublic` wordt door OneUptime ingesteld, wat de aanvraag ook zegt. Elke afbeelding wordt gecontroleerd wanneer het formulier wordt opgeslagen: ze moet in het project van het formulier zijn geüpload, en een logo moet een PNG-, JPEG-, GIF-, WebP- of SVG-afbeelding van maximaal 512 KB zijn, een favicon een van die of een ICO van maximaal 128 KB. Stel een ID in op `null` om terug te gaan naar die van OneUptime. Zie [Huisstijl](/docs/forms/building#branding).

### Inzendingen lezen

Zo toont u de inzendingen van een formulier:

```bash
curl -X POST https://oneuptime.com/api/form-submission/get-list \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": { "formId": "<form-id>" },
    "select": { "submitterName": true, "submitterEmail": true, "answers": true, "incidentId": true, "scheduledMaintenanceId": true, "createdAt": true },
    "limit": 50,
    "skip": 0
  }'
```

### Workflows

Formulieren hebben de gegenereerde workflowcomponenten: **On Create Form**, **On Update Form** enzovoort. Gebruik **On Create Incident** of **On Create Scheduled Maintenance** om te reageren op wat een formulier heeft aangemaakt.

### De eigen eindpunten van de openbare pagina

De openbare pagina praat met twee routes die geen API-sleutel nodig hebben: `GET /api/form/public/<shareKey>`, die naam, beschrijving en vragen van het formulier teruggeeft (en, als die er zijn, het logo, de alternatieve tekst van het logo en de favicon, de afbeeldingen als base64, en de sjablonen, met hun antwoorden op de vragen die de pagina stelt), en `POST /api/form/public/<shareKey>/submit`, die het formulier verzendt en in `templateId` het sjabloon noemt waarmee de inzender begon. Het zijn de eigen eindpunten van de pagina, geen API om op te bouwen: elke aanroep gaat langs de beveiliging van het formulier (zie [Delen & beveiliging](/docs/forms/sharing-and-security)), en ze veranderen mee met de pagina. Gebruik `POST /api/incident` met een API-sleutel om incidenten vanuit uw eigen code aan te maken: zie [Een incident melden](/docs/incidents/declaring-incidents).

## Waar uw incidentformulieren zijn gebleven

Formulieren vervangen de **Incident Forms** die onder **Incidenten → Instellingen → Formulieren** stonden. Elk incidentformulier is bij de upgrade overgezet, met dezelfde link en dezelfde inzendingen:

- De vragen werden die van de editor: de titel, de beschrijving tenzij die verborgen was, de ernst als de inzender die kon kiezen, elk aangepast veld dat het vroeg (in de volgorde van de aangepaste velden), en **Your Name** en **Your Email**, verplicht tenzij het formulier anonieme meldingen toestond.
- De ernst en het incidentsjabloon werden de standaardwaarden onder **Bij verzenden**.
- De schakelaar **Ingeschakeld**, het succesbericht en de **IP-toelatingslijst** zijn ongewijzigd, net als de link: oude links `/accounts/incident-form/<share-key>` openen het formulier op het nieuwe adres.
- De machtigingen **Incident Form** werden de machtigingen **Form**, voor elk team en elke API-sleutel die ze had.

De oude dashboardpagina's verwijzen door naar de nieuwe.

## Volgende stappen

:::cards
- [Een formulier bouwen](/docs/forms/building): Vragen, antwoordtypen, gekoppelde velden, aangepaste velden en het voorbeeld.
- [Wat een inzending aanmaakt](/docs/forms/on-submit): Hoe de antwoorden en de instellingen onder Bij verzenden een incident of onderhoudsgebeurtenis worden.
- [Delen & beveiliging](/docs/forms/sharing-and-security): De link, de IP-toelatingslijst, snelheidslimieten, de captcha en probleemoplossing.
- [Een incident melden](/docs/incidents/declaring-incidents): De andere manieren om incidenten te melden.
:::
