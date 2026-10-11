# Formularer – overblik

En formular er en side, som alle med dens link kan udfylde, uden en OneUptime-konto. Hver indsendelse opretter noget i dit projekt: en **hændelse**, til fejlrapporter, eller en **planlagt vedligeholdelsesbegivenhed**, til ændrings- og vedligeholdelsesanmodninger. Du bygger formularens spørgsmål i en træk-og-slip-editor, bestemmer, hvordan svarene bliver til posten, og deler linket med dem, der skal bruge den.

Brug en formular, når de mennesker, der opdager et problem eller har brug for en ændring, ikke er dem, der håndterer dine hændelser og din vedligeholdelse: supportmedarbejdere, kolleger i en anden afdeling, en butikschef, en kundes driftsteam. De åbner linket, besvarer dine spørgsmål og trykker på **Indsend**. Dit team får en almindelig hændelse eller begivenhed med svarene i dens felter og en privat note, der registrerer, hvem der sendte den.

:::cards
- [Opret din første formular](#opret-din-første-formular): Fra en tom formular til et link, du kan dele.
- [Byg en formular](/docs/forms/building): Spørgsmål, svartyper, skjulte spørgsmål, skabeloner og branding.
- [Hvad en indsendelse opretter](/docs/forms/on-submit): Hvordan svarene og indstillingerne bliver til en hændelse eller en vedligeholdelsesbegivenhed.
- [Deling & sikkerhed](/docs/forms/sharing-and-security): Linket, IP-tilladelseslisten, hastighedsgrænser og fejlfinding.
:::

## Sådan fungerer en formular

```mermaid title="Fra en udfyldt formular til en hændelse eller en vedligeholdelsesbegivenhed"
flowchart TB
    submitter["Nogen med linket,<br/>uden konto"] --> page["Formularens side"]
    page -->|Indsend| checks["Beskyttelse og<br/>kontrol af svar"]
    checks --> submission["Indsendelse, gemt<br/>med formularen"]
    submission --> target{"Hver indsendelse opretter"}
    target -->|Hændelse| incident["Hændelse, skjult<br/>på statussider"]
    target -->|Planlagt vedligeholdelse| event["Vedligeholdelsesbegivenhed,<br/>skjult medmindre angivet"]
    incident --> response["Vagtpolitikker og<br/>regler kører"]
    incident --> note["Privat note: hvem der sendte,<br/>øvrige svar"]
    event --> note
```

Hver anmodning går først gennem formularens beskyttelse: dens egen side, hastighedsgrænser, IP-tilladelseslisten og captcha. En indsendelse, hvis svar passer, gemmes og opretter én post, udfyldt fra svarene, formularens indstillinger under **Ved indsendelse** og, for en hændelse, dens hændelsesskabelon. Intet af det, den opretter, når en statusside, før dit team beslutter det.

## Kort fortalt

- **Et produkt for sig**: **Formularer** ligger i produktmenuen på `/dashboard/{projectId}/forms`. Hver formular har sit eget link, for eksempel `https://oneuptime.com/accounts/form/<share-key>` på OneUptime Cloud.
- **Ingen konto nødvendig**: alle med linket kan åbne formularen og indsende den uden at logge ind.
- **En editor, ikke en indstillingsside**: tilføj dine egne spørgsmål (korte svar, afsnit, rullelister, datoer, afkrydsningsfelter og mere), felterne for det, formularen opretter (titel, beskrivelse, alvorsgrad, monitorer, etiketter, start og slut), dine brugerdefinerede felter samt indsenderens navn og e-mail. Træk dem i rækkefølge, forhåndsvis formularen, og gem.
- **Du bestemmer, hvor hver værdi kommer fra**: siden **Ved indsendelse** viser hvert felt i den nye hændelse eller begivenhed ved siden af dets kilde: et svar, en standardværdi, en indstilling, der altid gælder, eller hændelsesskabelonen.
- **Skjult, indtil nogen offentliggør det**: hændelser fra en formular vises aldrig på statussider eller sendes til abonnenter, når de oprettes; vedligeholdelsesbegivenheder heller ikke, medmindre formularen siger det.
- **Beskyttet i lag**: en kontakt **Modtager indsendelser**, en valgfri **IP-tilladelsesliste**, afvisning af anmodninger fra andre websteder, hastighedsgrænser, instansens captcha og størrelsesgrænser for hvert svar.
- **Hver indsendelse gemmes**: hver formulars side **Indsendelser**, og **Formularer → Indsendelser** for dem alle, viser svarene og linker til det, hver indsendelse oprettede.
- **Din egen branding**: upload et logo til toppen af formularens side og et favicon til browserfanen i sektionen **Branding** på siden **Byg**. Indtil da viser formularen OneUptimes.
- **Skabeloner til almindelige tilfælde**: gem navngivne sæt af svar, for eksempel **Applikationsnedbrud** eller **Planlagt vedligeholdelsesarbejde**, og folk vælger en øverst i formularen for at udfylde den eller åbner dens eget link. Hver skabelon kan også gøre et spørgsmål påkrævet, valgfrit eller skjult for sit tilfælde. Én formular, og ét bogmærke, dækker et helt team.
- **Skjulte spørgsmål**: skjul et spørgsmål, som ingen burde skulle besvare, for eksempel hændelsens beskrivelse, og lad hver skabelon besvare det i stedet, eller stille det, i de tilfælde, der har brug for det.
- **Duplikér formular**: start en formular til et andet team ud fra en, der virker, med dens spørgsmål, skabeloner og indstillinger.

## Hvad en formular kan oprette

Når du opretter en formular, vælger du, hvad **Hver indsendelse opretter**. Du kan ændre det senere på formularens side **Ved indsendelse**.

| Hver indsendelse opretter | Bruges til | Hvad der sker |
| --- | --- | --- |
| **Hændelse** | Fejlrapporter | En hændelse oprettes med det samme, så dine vagtpolitikker og regler kører, og de vagthavende får besked. Den holdes væk fra statussider, indtil en, der håndterer den, offentliggør den. |
| **Planlagt vedligeholdelse** | Ændrings- og vedligeholdelsesanmodninger | En vedligeholdelsesbegivenhed planlægges for det tidsrum, indsenderen beder om. Medmindre formularen siger andet, holdes den væk fra sine statussider og giver ingen abonnenter besked. |

Formularer starter med disse to, og flere slags poster følger.

## Før du begynder

- **En plan, der omfatter formularer.** På OneUptime Cloud kræver formularer planen **Growth** eller højere. Se [Plan](#plan).
- **Tilladelse til at oprette formularer.** **Create Form** har projektejere og -administratorer samt de roller, du giver den til. Se [Tilladelser](#tilladelser).
- **For en hændelsesformular, en alvorsgrad.** Hver hændelse har brug for én: fra et spørgsmål, fra formularens indstillinger eller fra dens hændelsesskabelon. Uden den afvises hver indsendelse. Se [Hvad en indsendelse opretter](/docs/forms/on-submit#how-a-submission-becomes-an-incident).

## Opret din første formular

:::steps
### Opret formularen

Åbn **Formularer** fra produktmenuen, og klik på **Opret formular**. Giv formularen et navn (overskriften på dens offentlige side, entydigt i projektet), vælg, hvad **Hver indsendelse opretter**, og eventuelt en beskrivelse i Markdown, som vises øverst på den offentlige side.

### Byg dens spørgsmål

Formularen åbner på sin side **Byg** og spørger allerede om en titel, en beskrivelse og hvem der indsender (og, for en vedligeholdelsesformular, hvornår vedligeholdelsen starter og slutter). Tilføj, fjern og omarranger spørgsmål, og klik derefter på **Gem ændringer**. Se [Byg en formular](/docs/forms/building).

### Bestem, hvad en indsendelse opretter

Under **Ved indsendelse** tjekker du, hvordan en indsendelse bliver til en hændelse eller begivenhed, og klikker på **Rediger indstillinger** for at give standardværdier: en alvorsgrad, en hændelsesskabelon, monitorer og etiketter, der altid vedhæftes, ejere, der skal have besked. Se [Hvad en indsendelse opretter](/docs/forms/on-submit).

### Tilføj skabeloner, hvis folk rapporterer de samme tilfælde

Under **Skabeloner** gemmer du en skabelon for hvert tilfælde, der ofte rapporteres: formularen viser dem over sine spørgsmål, udfylder sig selv fra den valgte og stiller spørgsmålene, som den skabelon siger; et spørgsmål, som ét tilfælde har brug for, kan være påkrævet i dets skabelon og skjult i de andre. Se [Skabeloner](/docs/forms/building#templates).

### Del linket

Under **Del** kopierer du linket og sender det til dem, der skal bruge formularen. Se [Deling & sikkerhed](/docs/forms/sharing-and-security).
:::

> [!IMPORTANT]
> En ny formular **Modtager indsendelser**, så snart den er oprettet, men ingen kan nå den, før du deler dens link. Sæt først dens spørgsmål og beskyttelse op.

## En formulars sider

| Side | Hvad den indeholder |
| --- | --- |
| **Byg** | Formularens navn og beskrivelse, dens **Branding** (logo og favicon, foldet sammen) og editoren: dens spørgsmål, spørgsmålspaletten og **Forhåndsvisning**. |
| **Skabeloner** | Navngivne sæt af svar, man kan starte formularen fra, hvordan hver stiller spørgsmålene, den formularen åbner med, og hver skabelons eget link. |
| **Ved indsendelse** | Hvad hver indsendelse opretter, og hvordan hvert felt i den udfyldes. **Rediger indstillinger** ændrer standardværdierne og det, der altid gælder. |
| **Del** | **Modtager indsendelser**, **Delingslink**, beskeden efter indsendelse og **IP-tilladelsesliste**. |
| **Indsendelser** | Hver indsendelse via formularen, nyeste først, med dens svar og det, den oprettede. |
| **Duplikér formular** | Under **Avanceret**: en kopi af formularen, navngivet for dig, med dens spørgsmål, skabeloner, indstillinger under Ved indsendelse, branding, takkebesked og IP-tilladelsesliste og sit eget link. Kopien starter slået fra og åbner i sin editor. |
| **Slet formular** | Sletning af formularen, under **Avanceret**. Dens indsendelser slettes med den; de hændelser og begivenheder, den oprettede, gør ikke. |

Sektionen **Udvikler** i formularens menu indeholder dens sider for Terraform, API og AI-assistenter, ligesom for alle andre ressourcer.

## Formularer og hændelsesskabeloner

En skabelon og en formular sparer dig begge for at skrive den samme hændelse to gange, men de tjener forskellige mennesker:

| | Hændelsesskabelon | Formular |
| --- | --- | --- |
| Hvem bruger den | Dit team, logget ind i OneUptime | Alle med linket, uden konto |
| Hvor | **Opret fra skabelon** på listen over hændelser | En side for sig, på formularens link |
| Hvad man kan ændre | Hvert felt i hændelsen, før den oprettes | Kun svarene på de spørgsmål, du har valgt |
| Hvad man ser | Dine monitorer, politikker, ejere og hvert felt | Formularens navn, beskrivelse og spørgsmål, og kun de valgmuligheder, du tilbyder |
| Statussider | Det, skabelonen og oprettelsesformularen siger | Skjult, indtil en, der håndterer den, offentliggør hændelsen |

De arbejder sammen. Giv en hændelsesformular en **Hændelse Skabelon** på dens side **Ved indsendelse**, og hver hændelse, den opretter, oprettes ud fra den skabelon: byg skabelonen til det, dit team har brug for på hændelsen, og formularen til det, du vil spørge indsenderen om.

## Indsendelser

En formulars side **Indsendelser** viser hver indsendelse via den, nyeste først, med **Indsendt den**, **Indsendt af** (det navn og den e-mail, indsenderen angav, eller **Anonym**) og **Oprettet**, et link til den hændelse eller begivenhed, den oprettede. **Vis svar** viser hvert svar, som indsenderen gav det. **Formularer → Indsendelser** viser indsendelserne for alle projektets formularer.

Indsendelser skrives af formularen, aldrig manuelt, og kan ikke redigeres. Når du sletter en, fjernes dens svar samt indsenderens navn og e-mail fra listen; den hændelse eller begivenhed, den oprettede, bliver, og det gør den private note på den også, som gentager indsenderens oplysninger og svarene. Når hændelsen eller begivenheden slettes, bliver dens indsendelse, og dens kolonne **Oprettet** viser **Siden slettet**.

> [!WARNING]
> Når du fjerner en persons personoplysninger, er det ikke nok at slette indsendelsen: rediger eller slet også den private note på den hændelse eller begivenhed, den oprettede.

## Tilladelser

Formularer lader folk uden for dit team oprette hændelser og vedligeholdelsesbegivenheder i dit projekt, så de styres af projektejere og -administratorer samt af de roller, du giver tilladelserne **Form**. De står i gruppen **Form** i [Tilladelsesreference](/docs/permissions/reference):

| Tilladelse | Hvad den tillader | Hvem har den som standard |
| --- | --- | --- |
| **Create Form** | Oprette formularer og duplikere dem. | Project Owner, Project Admin |
| **Edit Form** | Ændre en formular: dens spørgsmål, branding, skabeloner, indstillinger under Ved indsendelse, **Modtager indsendelser**, dens link og **IP-tilladelsesliste**. | Project Owner, Project Admin |
| **Delete Form** | Slette en formular og dermed dens indsendelser. | Project Owner, Project Admin |
| **Read Form** | Se formularer, deres spørgsmål, indstillinger og links. | De ovennævnte plus Project Member, Viewer og rollerne for hændelser og planlagt vedligeholdelse |
| **Read Form Submission** | Se indsendelserne og deres svar. | Project Owner, Project Admin |
| **Delete Form Submission** | Slette indsendelser. | Project Owner, Project Admin |

Indsendelser indeholder det, fremmede har skrevet (navne, e-mailadresser og svar, der måske aldrig når posten), så kun projektejere og -administratorer ser dem, medmindre du giver **Read Form Submission**. Alle, der kan læse en formular, kan se og dele dens link. Det kræver ingen tilladelse at indsende en formular. Hvordan roller og detaljerede tilladelser spiller sammen, kan du læse om i [Brugere, teams og tilladelser](/docs/permissions/index).

## Plan

På OneUptime Cloud kræver formularer planen **Growth** eller højere, og en formulars **IP-tilladelsesliste** kræver **Scale**, uanset om den angives, når formularen oprettes, eller redigeres senere. Links for et projekt under planen **Growth**, eller hvis abonnement ikke er betalt, viser beskeden om, at formularen ikke er tilgængelig, og intet oprettes.

## Formularer via API'et

Formularer er en almindelig API-ressource på `/api/form`, og deres indsendelser på `/api/form-submission`, som du kan læse og slette, men ikke oprette eller redigere. [API-referencen](/reference) har de fulde former for anmodninger og svar.

### Spørgsmål og indstillinger

En formulars spørgsmål er dens kolonne `fields`, en JSON-liste i den rækkefølge, formularen stiller dem, og dens indstillinger under Ved indsendelse er dens `targetSettings`:

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

Hvert spørgsmål har sit eget `id` (bogstaver, cifre, `-` og `_`), en `source`, en `label` og eventuelt `helpText` og `isRequired`:

| `source` | Hvad det spørger om |
| --- | --- |
| `Question` | Et af formularens egne spørgsmål, besvaret efter `type`: `Text`, `LongText`, `Markdown`, `Number`, `Dropdown`, `MultiSelectDropdown`, `Boolean`, `Date` eller `DateTime`. En rulleliste viser sine `dropdownOptions`, én pr. linje. |
| `TargetField` | Et felt i det, formularen opretter, angivet med `targetField`: `title`, `description`, `incidentSeverityId`, `monitors`, `labels` og `impactStartedAt` for en hændelse; `title`, `description`, `startsAt`, `endsAt`, `monitors`, `statusPages` og `labels` for en vedligeholdelsesbegivenhed. Et felt, der besvares ved at vælge, viser de poster, det tilbyder, i `allowedOptionIds`. |
| `TargetCustomField` | Et af hændelsens eller begivenhedens brugerdefinerede felter, angivet med `customFieldId`. |
| `Submitter` | Indsenderens `Name` eller `Email`, angivet med `submitterField`. |

Et spørgsmål med `isHidden` sat til `true` vises ikke på den offentlige side, er aldrig påkrævet og besvares kun fra den skabelon, en indsendelse angiver, medmindre den skabelon stiller det. `isRequired` og `isHidden` er formularens standard; hver skabelon kan stille et spørgsmål på sin egen måde.

### Skabeloner i API'et

En formulars skabeloner er dens kolonne `templates`, en JSON-liste i den rækkefølge, formularen viser dem. Hver skabelon har sit eget `id` (bogstaver, cifre, `-` og `_`), et `name` på op til 100 tegn, entydigt i formularen, og `answers` efter spørgsmåls-id, hver som en indsendelse sender det: tekst, et tal, `true` eller `false`, en valgmuligheds værdi eller en liste af værdier til flere valg. `isDefault` sat til `true` gør den til den skabelon, formularen åbner med; en formular har højst én og op til 50 skabeloner.

`fieldSettings`, også efter spørgsmåls-id, angiver, hvordan skabelonen stiller et spørgsmål: `Required`, `Optional` eller `Hidden`. Et spørgsmål, den ikke nævner (eller nævner som `null`), stilles, som formularen stiller det, og en vedligeholdelsesbegivenheds spørgsmål `startsAt` og `endsAt` kan kun være `Required`:

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

Spørgsmål, skabeloner og indstillinger kontrolleres, hver gang de gemmes (fra dashboardet, API'et, Terraform eller et workflow), og en liste, der bryder en regel, afvises med en besked, der nævner, hvad der er galt. `shareKey`, nøglen i formularens link, angives af OneUptime, når formularen oprettes, og at ændre den er det, **Nulstil link** gør.

### Branding i API'et

En formulars branding er dens `logoFileId`, `logoAltText` og `faviconFileId`. Upload først billedet med `POST /api/file` i formularens projekt (med en API-nøgle til det projekt, eller logget ind som medlem af det med dets id i headeren `tenantid`), send dets `name`, dets `fileType`, for eksempel `image/png`, og bytes som base64 i `file`, og angiv det `_id`, der returneres. En upload til et projekt, du ikke er medlem af, afvises med "You can upload files only to a project you are a member of." Hver upload er privat: `isPublic` angives af OneUptime, uanset hvad anmodningen siger. Hvert billede kontrolleres, når formularen gemmes: det skal være uploadet i formularens projekt, og et logo skal være et PNG-, JPEG-, GIF-, WebP- eller SVG-billede på højst 512 KB, et favicon et af dem eller en ICO på højst 128 KB. Sæt et id til `null` for at gå tilbage til OneUptimes. Se [Branding](/docs/forms/building#branding).

### Læs indsendelser

Sådan viser du en formulars indsendelser:

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

Formularer har de genererede workflow-komponenter: **On Create Form**, **On Update Form** og så videre. Brug **On Create Incident** eller **On Create Scheduled Maintenance** for at reagere på det, en formular har oprettet.

### Den offentlige sides egne endepunkter

Den offentlige side taler med to ruter, der ikke kræver en API-nøgle: `GET /api/form/public/<shareKey>`, som returnerer formularens navn, beskrivelse og spørgsmål (og, når den har dem, dens logo, logoets alternative tekst og dens favicon, billederne som base64, samt dens skabeloner med deres svar på de spørgsmål, siden stiller), og `POST /api/form/public/<shareKey>/submit`, som indsender den og i `templateId` angiver den skabelon, indsenderen startede fra. Det er sidens egne endepunkter, ikke et API at bygge videre på: hvert kald går gennem formularens beskyttelse (se [Deling & sikkerhed](/docs/forms/sharing-and-security)), og de ændrer sig med siden. Brug `POST /api/incident` med en API-nøgle for at oprette hændelser fra din egen kode: se [Opret en hændelse](/docs/incidents/declaring-incidents).

## Hvor dine hændelsesformularer blev af

Formularer erstatter **Incident Forms**, som lå under **Hændelser → Indstillinger → Formularer**. Hver hændelsesformular blev flyttet med ved opgraderingen, med det samme link og de samme indsendelser:

- Dens spørgsmål blev til editorens: titlen, beskrivelsen medmindre den var skjult, alvorsgraden, når indsenderen kunne vælge den, hvert brugerdefineret felt, den spurgte om (i de brugerdefinerede felters rækkefølge), og **Your Name** og **Your Email**, påkrævede medmindre formularen tillod anonyme rapporter.
- Dens alvorsgrad og hændelsesskabelon blev til dens standardværdier under **Ved indsendelse**.
- Dens kontakt **Aktiveret**, dens succesbesked og dens **IP-tilladelsesliste** er uændrede, og det er dens link også: gamle links `/accounts/incident-form/<share-key>` åbner formularen på dens nye adresse.
- Tilladelserne **Incident Form** blev til tilladelserne **Form** for hvert team og hver API-nøgle, der havde dem.

De gamle dashboardsider viderestiller til de nye.

## Næste trin

:::cards
- [Byg en formular](/docs/forms/building): Spørgsmål, svartyper, tilknyttede felter, brugerdefinerede felter og forhåndsvisningen.
- [Hvad en indsendelse opretter](/docs/forms/on-submit): Hvordan svarene og indstillingerne under Ved indsendelse bliver til en hændelse eller en vedligeholdelsesbegivenhed.
- [Deling & sikkerhed](/docs/forms/sharing-and-security): Linket, IP-tilladelseslisten, hastighedsgrænser, captcha og fejlfinding.
- [Opret en hændelse](/docs/incidents/declaring-incidents): De andre måder at oprette hændelser på.
:::
