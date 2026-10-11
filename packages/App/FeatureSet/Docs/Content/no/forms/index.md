# Skjemaer – oversikt

Et skjema er en side som alle med lenken kan fylle ut, uten en OneUptime-konto. Hver innsending oppretter noe i prosjektet ditt: en **hendelse**, for feilrapporter, eller en **planlagt vedlikeholdshendelse**, for endrings- og vedlikeholdsforespørsler. Du bygger skjemaets spørsmål i et dra-og-slipp-verktøy, bestemmer hvordan svarene blir til posten, og deler lenken med dem som skal bruke det.

Bruk et skjema når de som oppdager et problem, eller trenger en endring, ikke er de som håndterer hendelsene og vedlikeholdet ditt: brukerstøtte, kolleger i en annen avdeling, en butikksjef, driftsteamet til en kunde. De åpner lenken, svarer på spørsmålene dine og trykker på **Send inn**. Teamet ditt får en vanlig hendelse eller vedlikeholdshendelse, med svarene i feltene og et privat notat som viser hvem som sendte den.

:::cards
- [Opprett ditt første skjema](#opprett-ditt-første-skjema): Fra et tomt skjema til en lenke du kan dele.
- [Bygg et skjema](/docs/forms/building): Spørsmål, svartyper, skjulte spørsmål, maler og merkevare.
- [Hva en innsending oppretter](/docs/forms/on-submit): Hvordan svarene og innstillingene blir til en hendelse eller en vedlikeholdshendelse.
- [Deling og sikkerhet](/docs/forms/sharing-and-security): Lenken, IP-tillatelseslisten, hastighetsgrenser og feilsøking.
:::

## Slik fungerer et skjema

```mermaid title="Fra et utfylt skjema til en hendelse eller en vedlikeholdshendelse"
flowchart TB
    submitter["Noen med lenken,<br/>uten konto"] --> page["Skjemaets side"]
    page -->|Send inn| checks["Beskyttelse og<br/>kontroll av svar"]
    checks --> submission["Innsending, lagret<br/>med skjemaet"]
    submission --> target{"Hver innsending oppretter"}
    target -->|Hendelse| incident["Hendelse, skjult<br/>på statussider"]
    target -->|Planlagt vedlikehold| event["Vedlikeholdshendelse,<br/>skjult med mindre angitt"]
    incident --> response["Vaktpolicyer og<br/>regler kjører"]
    incident --> note["Privat notat: hvem som sendte,<br/>øvrige svar"]
    event --> note
```

Hver forespørsel går først gjennom skjemaets beskyttelse: skjemaets egen side, hastighetsgrenser, IP-tillatelseslisten og captcha. En innsending der svarene stemmer, lagres og oppretter én post, fylt ut fra svarene, skjemaets innstillinger under **Ved innsending** og, for en hendelse, hendelsesmalen. Ingenting den oppretter, når en statusside før teamet ditt bestemmer det.

## Kort fortalt

- **Et eget produkt**: **Skjemaer** ligger i produktmenyen, på `/dashboard/{projectId}/forms`. Hvert skjema har sin egen lenke, for eksempel `https://oneuptime.com/accounts/form/<share-key>` på OneUptime Cloud.
- **Ingen konto nødvendig**: alle med lenken kan åpne skjemaet og sende det inn uten å logge på.
- **Et byggeverktøy, ikke en innstillingsside**: legg til egne spørsmål (korte svar, avsnitt, nedtrekkslister, datoer, avkrysningsbokser og mer), feltene i det skjemaet oppretter (tittel, beskrivelse, alvorlighetsgrad, monitorer, etiketter, start og slutt), dine egendefinerte felt og navnet og e-posten til innsenderen. Dra dem i rekkefølge, forhåndsvis skjemaet og lagre.
- **Du bestemmer hvor hver verdi kommer fra**: siden **Ved innsending** viser hvert felt i den nye hendelsen ved siden av kilden: et svar, en standardverdi, en innstilling som alltid gjelder, eller hendelsesmalen.
- **Skjult til noen publiserer det**: hendelser fra et skjema vises aldri på statussider eller sendes til abonnenter når de opprettes; vedlikeholdshendelser heller ikke, med mindre skjemaet sier det.
- **Beskyttet i lag**: en bryter **Tar imot innsendinger**, en valgfri **IP-tillatelsesliste**, avvisning av forespørsler fra andre nettsteder, hastighetsgrenser, instansens captcha og størrelsesgrenser for hvert svar.
- **Hver innsending lagres**: siden **Innsendinger** for hvert skjema, og **Skjemaer → Innsendinger** for alle, viser svarene og lenker til det hver innsending opprettet.
- **Din egen merkevare**: last opp en logo øverst på skjemaets side og et favikon for nettleserfanen, i delen **Merkevare** på siden **Bygg**. Inntil da viser skjemaet OneUptimes.
- **Maler for vanlige tilfeller**: lagre navngitte sett med svar, for eksempel **Applikasjonsutfall** eller **Planlagt vedlikeholdsarbeid**, og folk velger en øverst i skjemaet for å fylle det ut, eller åpner malens egen lenke. Hver mal kan også gjøre et spørsmål obligatorisk, valgfritt eller skjult for sitt tilfelle. Ett skjema, og ett bokmerke, dekker et helt team.
- **Skjulte spørsmål**: skjul et spørsmål ingen burde måtte svare på, for eksempel hendelsens beskrivelse, og la hver mal svare på det i stedet, eller stille det, i tilfellene som trenger det.
- **Dupliser skjema**: start et skjema for et annet team ut fra et som virker, med spørsmålene, malene og innstillingene.

## Hva et skjema kan opprette

Når du oppretter et skjema, velger du hva **Hver innsending oppretter**. Du kan endre det senere på skjemaets side **Ved innsending**.

| Hver innsending oppretter | Brukes til | Hva som skjer |
| --- | --- | --- |
| **Hendelse** | Feilrapporter | En hendelse opprettes med en gang, så vaktpolicyene og reglene dine kjører og de som har vakt, får beskjed. Den holdes borte fra statussider til en som håndterer den, publiserer den. |
| **Planlagt vedlikehold** | Endrings- og vedlikeholdsforespørsler | En vedlikeholdshendelse planlegges for tidsrommet innsenderen ber om. Med mindre skjemaet sier noe annet, holdes den borte fra statussidene og varsler ingen abonnenter. |

Skjemaer starter med disse to, og flere typer poster kommer.

## Før du begynner

- **En plan som omfatter skjemaer.** På OneUptime Cloud krever skjemaer planen **Growth** eller høyere. Se [Plan](#plan).
- **Tillatelse til å opprette skjemaer.** **Create Form** har prosjekteiere og -administratorer, og rollene du gir den til. Se [Tillatelser](#tillatelser).
- **For et hendelsesskjema, en alvorlighetsgrad.** Hver hendelse trenger en: fra et spørsmål, fra skjemaets innstillinger eller fra hendelsesmalen. Uten den avvises hver innsending. Se [Hva en innsending oppretter](/docs/forms/on-submit#how-a-submission-becomes-an-incident).

## Opprett ditt første skjema

:::steps
### Opprett skjemaet

Åpne **Skjemaer** fra produktmenyen, og klikk på **Opprett skjema**. Gi skjemaet et navn (overskriften på den offentlige siden, unikt i prosjektet), velg hva **Hver innsending oppretter**, og eventuelt en beskrivelse i Markdown, som vises øverst på den offentlige siden.

### Bygg spørsmålene

Skjemaet åpner på siden **Bygg** og spør allerede om en tittel, en beskrivelse og hvem som sender inn (og, for et vedlikeholdsskjema, når vedlikeholdet starter og slutter). Legg til, fjern og flytt spørsmål, og klikk deretter på **Lagre endringer**. Se [Bygg et skjema](/docs/forms/building).

### Bestem hva en innsending oppretter

Under **Ved innsending** sjekker du hvordan en innsending blir til en hendelse, og klikker på **Rediger innstillinger** for å gi standardverdier: en alvorlighetsgrad, en hendelsesmal, monitorer og etiketter som alltid legges ved, eiere som skal få beskjed. Se [Hva en innsending oppretter](/docs/forms/on-submit).

### Legg til maler hvis folk rapporterer de samme tilfellene

Under **Maler** lagrer du en mal for hvert tilfelle som ofte rapporteres: skjemaet viser dem over spørsmålene, fyller seg ut fra den valgte og stiller spørsmålene slik den malen sier; et spørsmål som ett tilfelle trenger, kan være obligatorisk i malen for det og skjult i de andre. Se [Maler](/docs/forms/building#templates).

### Del lenken

Under **Del** kopierer du lenken og sender den til dem som skal bruke skjemaet. Se [Deling og sikkerhet](/docs/forms/sharing-and-security).
:::

> [!IMPORTANT]
> Et nytt skjema **Tar imot innsendinger** så snart det er opprettet, men ingen kan nå det før du deler lenken. Sett opp spørsmålene og beskyttelsen først.

## Skjemaets sider

| Side | Hva den inneholder |
| --- | --- |
| **Bygg** | Skjemaets navn og beskrivelse, **Merkevare** (logo og favikon, slått sammen) og byggeverktøyet: spørsmålene, spørsmålspaletten og **Forhåndsvisning**. |
| **Maler** | Navngitte sett med svar man kan starte skjemaet fra, hvordan hver mal stiller spørsmålene, malen skjemaet åpner med, og hver mals egen lenke. |
| **Ved innsending** | Hva hver innsending oppretter, og hvordan hvert felt fylles ut. **Rediger innstillinger** endrer standardverdiene og det som alltid gjelder. |
| **Del** | **Tar imot innsendinger**, **Delingslenke**, meldingen som vises etter innsending, og **IP-tillatelsesliste**. |
| **Innsendinger** | Hver innsending gjennom skjemaet, nyeste først, med svarene og det den opprettet. |
| **Dupliser skjema** | Under **Avansert**: en kopi av skjemaet, navngitt for deg, med spørsmålene, malene, innstillingene under Ved innsending, merkevaren, takkemeldingen og IP-tillatelseslisten, og en egen lenke. Kopien starter avslått og åpner i byggeverktøyet. |
| **Slett skjema** | Sletting av skjemaet, under **Avansert**. Innsendingene slettes sammen med det; hendelsene det opprettet, gjør ikke det. |

Delen **Utvikler** i skjemaets meny inneholder sidene for Terraform, API og AI-assistenter, som for alle andre ressurser.

## Skjemaer og hendelsesmaler

En mal og et skjema sparer deg begge for å skrive den samme hendelsen to ganger, men de tjener ulike folk:

| | Hendelsesmal | Skjema |
| --- | --- | --- |
| Hvem bruker det | Teamet ditt, pålogget i OneUptime | Alle med lenken, uten konto |
| Hvor | **Opprett fra mal** i hendelseslisten | En egen side, på skjemaets lenke |
| Hva man kan endre | Hvert felt i hendelsen, før den opprettes | Bare svarene på spørsmålene du har valgt |
| Hva man ser | Monitorene, policyene, eierne og hvert felt | Skjemaets navn, beskrivelse og spørsmål, og bare alternativene du tilbyr |
| Statussider | Det malen og opprettingsskjemaet sier | Skjult til en som håndterer hendelsen, publiserer den |

De virker sammen. Gi et hendelsesskjema en **Hendelse Mal** på siden **Ved innsending**, så opprettes hver hendelse det oppretter, fra den malen: bygg malen for det teamet ditt trenger på hendelsen, og skjemaet for det du vil spørre innsenderen om.

## Innsendinger

Siden **Innsendinger** for et skjema viser hver innsending gjennom det, nyeste først, med **Sendt inn**, **Sendt inn av** (navnet og e-posten innsenderen oppga, eller **Anonym**) og **Opprettet**, en lenke til hendelsen den opprettet. **Vis svar** viser hvert svar slik innsenderen ga det. **Skjemaer → Innsendinger** viser innsendingene for alle skjemaene i prosjektet.

Innsendinger skrives av skjemaet, aldri for hånd, og kan ikke redigeres. Sletter du en, fjernes svarene og innsenderens navn og e-post fra listen; hendelsen den opprettet, blir værende, og det gjør også det private notatet på den, som gjentar innsenderens opplysninger og svarene. Når hendelsen slettes, blir innsendingen værende, og kolonnen **Opprettet** viser **Slettet i ettertid**.

> [!WARNING]
> Når du fjerner noens personopplysninger, er det ikke nok å slette innsendingen: rediger eller slett også det private notatet på hendelsen den opprettet.

## Tillatelser

Skjemaer lar folk utenfor teamet ditt opprette hendelser og vedlikeholdshendelser i prosjektet ditt, så de styres av prosjekteiere og -administratorer, og av rollene du gir tillatelsene **Form**. De står i gruppen **Form** i [Tillatelsesreferanse](/docs/permissions/reference):

| Tillatelse | Hva den tillater | Hvem har den som standard |
| --- | --- | --- |
| **Create Form** | Opprette skjemaer og duplisere dem. | Project Owner, Project Admin |
| **Edit Form** | Endre et skjema: spørsmålene, merkevaren, malene, innstillingene under Ved innsending, **Tar imot innsendinger**, lenken og **IP-tillatelsesliste**. | Project Owner, Project Admin |
| **Delete Form** | Slette et skjema, og dermed innsendingene. | Project Owner, Project Admin |
| **Read Form** | Se skjemaer, spørsmålene, innstillingene og lenkene deres. | De over, pluss Project Member, Viewer og rollene for hendelser og planlagt vedlikehold |
| **Read Form Submission** | Se innsendingene og svarene. | Project Owner, Project Admin |
| **Delete Form Submission** | Slette innsendinger. | Project Owner, Project Admin |

Innsendinger inneholder det fremmede har skrevet (navn, e-postadresser og svar som kanskje aldri havner i posten), så bare prosjekteiere og -administratorer ser dem, med mindre du gir **Read Form Submission**. Alle som kan lese et skjema, kan se og dele lenken. Det krever ingen tillatelse å sende inn et skjema. Hvordan roller og detaljerte tillatelser spiller sammen, finner du i [Brukere, team og tillatelser](/docs/permissions/index).

## Plan

På OneUptime Cloud krever skjemaer planen **Growth** eller høyere, og et skjemas **IP-tillatelsesliste** krever **Scale**, enten den angis når skjemaet opprettes eller redigeres senere. Lenkene til et prosjekt under planen **Growth**, eller med et ubetalt abonnement, viser meldingen om at skjemaet ikke er tilgjengelig, og ingenting opprettes.

## Skjemaer via API-et

Skjemaer er en vanlig API-ressurs på `/api/form`, og innsendingene på `/api/form-submission`, som du kan lese og slette, men ikke opprette eller redigere. [API-referansen](/reference) har de fullstendige formene på forespørsler og svar.

### Spørsmål og innstillinger

Et skjemas spørsmål er kolonnen `fields`, en JSON-liste i den rekkefølgen skjemaet stiller dem, og innstillingene under Ved innsending er `targetSettings`:

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

Hvert spørsmål har sin egen `id` (bokstaver, sifre, `-` og `_`), en `source`, en `label` og eventuelt `helpText` og `isRequired`:

| `source` | Hva det spør om |
| --- | --- |
| `Question` | Et av skjemaets egne spørsmål, besvart etter `type`: `Text`, `LongText`, `Markdown`, `Number`, `Dropdown`, `MultiSelectDropdown`, `Boolean`, `Date` eller `DateTime`. En nedtrekksliste viser `dropdownOptions`, ett per linje. |
| `TargetField` | Et felt i det skjemaet oppretter, angitt med `targetField`: `title`, `description`, `incidentSeverityId`, `monitors`, `labels` og `impactStartedAt` for en hendelse; `title`, `description`, `startsAt`, `endsAt`, `monitors`, `statusPages` og `labels` for en vedlikeholdshendelse. Et felt som besvares ved å velge, viser postene det tilbyr i `allowedOptionIds`. |
| `TargetCustomField` | Et av hendelsens egendefinerte felt, angitt med `customFieldId`. |
| `Submitter` | Innsenderens `Name` eller `Email`, angitt med `submitterField`. |

Et spørsmål med `isHidden` satt til `true` vises ikke på den offentlige siden, er aldri obligatorisk og besvares bare fra malen en innsending oppgir, med mindre den malen stiller det. `isRequired` og `isHidden` er skjemaets standard; hver mal kan stille et spørsmål på sin egen måte.

### Maler i API-et

Et skjemas maler er kolonnen `templates`, en JSON-liste i den rekkefølgen skjemaet viser dem. Hver mal har sin egen `id` (bokstaver, sifre, `-` og `_`), et `name` på opptil 100 tegn, unikt i skjemaet, og `answers` etter spørsmåls-ID, hvert slik en innsending sender det: tekst, et tall, `true` eller `false`, verdien til et alternativ eller en liste med verdier for flervalg. `isDefault` satt til `true` gjør den til malen skjemaet åpner med; et skjema har høyst én, og opptil 50 maler.

`fieldSettings`, også etter spørsmåls-ID, sier hvordan malen stiller et spørsmål: `Required`, `Optional` eller `Hidden`. Et spørsmål den ikke nevner (eller nevner som `null`), stilles slik skjemaet stiller det, og spørsmålene `startsAt` og `endsAt` for en vedlikeholdshendelse kan bare være `Required`:

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

Spørsmål, maler og innstillinger kontrolleres hver gang de lagres (fra dashbordet, API-et, Terraform eller en arbeidsflyt), og en liste som bryter en regel, avvises med en melding som sier hva som er galt. `shareKey`, nøkkelen i skjemaets lenke, angis av OneUptime når skjemaet opprettes, og å endre den er det **Tilbakestill lenke** gjør.

### Merkevare i API-et

Et skjemas merkevare er `logoFileId`, `logoAltText` og `faviconFileId`. Last først opp bildet med `POST /api/file` i skjemaets prosjekt (med en API-nøkkel for det prosjektet, eller pålogget som medlem av det med ID-en i headeren `tenantid`), send `name`, `fileType`, for eksempel `image/png`, og bytene som base64 i `file`, og angi `_id` som returneres. En opplasting til et prosjekt du ikke er medlem av, avvises med "You can upload files only to a project you are a member of." Hver opplasting er privat: `isPublic` angis av OneUptime, uansett hva forespørselen sier. Hvert bilde kontrolleres når skjemaet lagres: det må være lastet opp i skjemaets prosjekt, og en logo må være et PNG-, JPEG-, GIF-, WebP- eller SVG-bilde på høyst 512 KB, et favikon et av dem eller en ICO på høyst 128 KB. Sett en ID til `null` for å gå tilbake til OneUptimes. Se [Merkevare](/docs/forms/building#branding).

### Lese innsendinger

Slik viser du innsendingene til et skjema:

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

### Arbeidsflyter

Skjemaer har de genererte arbeidsflytkomponentene: **On Create Form**, **On Update Form** og så videre. Bruk **On Create Incident** eller **On Create Scheduled Maintenance** for å handle på det et skjema har opprettet.

### Den offentlige sidens egne endepunkter

Den offentlige siden snakker med to ruter som ikke krever en API-nøkkel: `GET /api/form/public/<shareKey>`, som returnerer skjemaets navn, beskrivelse og spørsmål (og, når det har dem, logoen, logoens alternative tekst og favikonet, bildene som base64, og malene, med svarene deres på spørsmålene siden stiller), og `POST /api/form/public/<shareKey>/submit`, som sender det inn og i `templateId` oppgir malen innsenderen startet fra. Det er sidens egne endepunkter, ikke et API å bygge videre på: hvert kall går gjennom skjemaets beskyttelse (se [Deling og sikkerhet](/docs/forms/sharing-and-security)), og de endres sammen med siden. Bruk `POST /api/incident` med en API-nøkkel for å opprette hendelser fra din egen kode: se [Opprette en hendelse](/docs/incidents/declaring-incidents).

## Hvor hendelsesskjemaene dine ble av

Skjemaer erstatter **Incident Forms**, som lå under **Hendelser → Innstillinger → Skjemaer**. Hvert hendelsesskjema ble flyttet over ved oppgraderingen, med den samme lenken og de samme innsendingene:

- Spørsmålene ble byggeverktøyets: tittelen, beskrivelsen med mindre den var skjult, alvorlighetsgraden når innsenderen kunne velge den, hvert egendefinert felt det spurte om (i rekkefølgen til de egendefinerte feltene), og **Your Name** og **Your Email**, obligatoriske med mindre skjemaet tillot anonyme rapporter.
- Alvorlighetsgraden og hendelsesmalen ble standardverdiene under **Ved innsending**.
- Bryteren **Aktivert**, suksessmeldingen og **IP-tillatelsesliste** er uendret, og det er lenken også: gamle lenker `/accounts/incident-form/<share-key>` åpner skjemaet på den nye adressen.
- Tillatelsene **Incident Form** ble til tillatelsene **Form**, for hvert team og hver API-nøkkel som hadde dem.

De gamle dashbordsidene videresender til de nye.

## Neste steg

:::cards
- [Bygg et skjema](/docs/forms/building): Spørsmål, svartyper, tilknyttede felt, egendefinerte felt og forhåndsvisningen.
- [Hva en innsending oppretter](/docs/forms/on-submit): Hvordan svarene og innstillingene under Ved innsending blir til en hendelse eller en vedlikeholdshendelse.
- [Deling og sikkerhet](/docs/forms/sharing-and-security): Lenken, IP-tillatelseslisten, hastighetsgrenser, captcha og feilsøking.
- [Opprette en hendelse](/docs/incidents/declaring-incidents): De andre måtene å opprette hendelser på.
:::
