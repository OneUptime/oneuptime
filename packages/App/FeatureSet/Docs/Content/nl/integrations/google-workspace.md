# Google Workspace

Importeer de auditlogboeken van [Google Workspace](https://workspace.google.com) in de beveiligingsgebeurtenissen van OneUptime: aanmeldingen en wat Google erover signaleerde, wijzigingen van beheerders, apps die toegang tot gegevens kregen, single sign-on, de eigen beveiligingsinstellingen van accounts en, als je wilt, bestanden die buiten de organisatie zijn gedeeld of in Google Drive zijn gedownload. Daar doorzoek je ze naast je logs, traces en metrics, correleer je ze met elke andere bron en roep je de dienst op voor wat ertoe doet. OneUptime leest ze met een serviceaccount dat optreedt als een van je beheerders, en verandert niets in Google Workspace.

:::cards
- [De verbinding instellen](#de-verbinding-instellen): Een serviceaccount, domeinbrede delegatie en het formulier van de verbinding.
- [Wat er wordt geïmporteerd](#wat-er-wordt-geïmporteerd): Welke activiteiten, en hoe elke activiteit een beveiligingsgebeurtenis wordt.
- [Hoe pollen werkt](#hoe-pollen-werkt): Het venster dat elke poll leest, en waarom het 2 uur met het vorige overlapt.
- [Problemen oplossen](#problemen-oplossen): Wat elke fout betekent en wat je moet wijzigen.
:::

## Hoe het werkt

```mermaid title="Van een Google Workspace-activiteit naar een beveiligingsgebeurtenis"
flowchart TB
    gws["Google Workspace<br/>legt een activiteit<br/>vast"] --> poll["OneUptime pollt<br/>volgens het interval<br/>van de verbinding"]
    poll --> token["Het serviceaccount<br/>treedt op als<br/>je beheerder"]
    token --> list["Het toont de<br/>activiteiten van<br/>elk logboek sinds<br/>de vorige keer"]
    list --> event["Elke gebeurtenis<br/>wordt opgeslagen als<br/>OCSF-gebeurtenis<br/>van haar soort"]
```

Elke minuut pollt OneUptime elke ingeschakelde verbinding waarvan het pollinterval is verstreken. Een poll meldt zich aan als je serviceaccount namens de beheerder die je opgeeft, en toont de activiteiten van elk auditlogboek sinds de vorige poll ([Activities: list](https://developers.google.com/admin-sdk/reports/reference/rest/v1/activities/list)): beheer, aanmeldingen, OAuth-tokens, SAML, accountbeveiliging en, als de optie **Drive-activiteit** aanstaat, Drive. Elke gebeurtenis van een activiteit wordt opgeslagen als een [OCSF](https://schema.ocsf.io/)-gebeurtenis: een aanmelding als een gebeurtenis Authentication, een toegewezen beheerdersrol als een gebeurtenis User Access Management, een aanmelding die Google signaleerde als een Detection Finding.

## Voordat je begint

- In OneUptime de rol Project Owner, Project Admin of Security Admin. Security Member en Security Viewer zien verbindingen en hun runhistorie, maar kunnen ze niet wijzigen.
- Een superbeheerder van Google Workspace, om domeinbrede delegatie toe te staan, en een beheerder als wie het serviceaccount optreedt, met het privilege Reports. Een superbeheerder heeft het.
- Een Google Cloud-project waarin je een serviceaccount kunt maken en de Admin SDK API kunt inschakelen.
- Voor Drive-activiteit: een editie met het auditlogboek van Drive, zoals Business Standard, Business Plus, Enterprise of Education.
- Uitgaand HTTPS van de OneUptime-app en -workers naar `oauth2.googleapis.com` en `admin.googleapis.com`.

## De verbinding instellen

De verbinding meldt zich aan met de sleutel van een serviceaccount en [domeinbrede delegatie](https://developers.google.com/identity/protocols/oauth2/service-account#delegatingauthority), met één alleen-lezenbereik: `https://www.googleapis.com/auth/admin.reports.audit.readonly`.

:::steps
### Een serviceaccount en een sleutel maken

1. Kies in de [Google Cloud-console](https://console.cloud.google.com) een project, open **APIs & Services → Library**, zoek **Admin SDK API** en selecteer **Enable**.
2. Open **IAM & Admin → Service accounts → Create service account**, noem het `oneuptime-security-events` en selecteer **Done**. Het heeft geen rol in het project nodig.
3. Open het serviceaccount en kopieer zijn **Unique ID**, de client-ID die de delegatie noemt. Selecteer op het tabblad **Keys** **Add key → Create new key → JSON**, en bewaar het bestand: dat is de sleutel.

### Domeinbrede delegatie toestaan

1. Open in de [Google Beheerdersconsole](https://admin.google.com), als superbeheerder, **Security → Access and data control → API controls → Manage domain-wide delegation** en selecteer **Add new**.
2. Voer de **Unique ID** van het serviceaccount in als **Client ID**, en `https://www.googleapis.com/auth/admin.reports.audit.readonly` als **OAuth scope**. Selecteer **Authorize**. Google kan er een paar minuten over doen om het toe te passen.
3. Om playbooks gebruikers te laten opschorten, de opschorting te laten opheffen en af te laten melden (zie [Inperking](/docs/telemetry/security-cases#inperking)), voeg je `https://www.googleapis.com/auth/admin.directory.user` en `https://www.googleapis.com/auth/admin.directory.user.security` toe aan de scopes van dezelfde client, gescheiden door komma's. De beheerder namens wie de verbinding werkt, moet die gebruikers dan beheren.

### De verbinding toevoegen in OneUptime

Open **Producten → Security Events → Verbindingen** (`/dashboard/{projectId}/security-events/connections`), klik op **Verbinding toevoegen**, kies **Google Workspace** onder **Identiteit** en klik op **Volgende**. Vul het **Administrator email** in, klik op **Volgende** en plak de inhoud van het sleutelbestand in **JSON van het serviceaccount**. Zet in de stap **Opvragen** **Drive-activiteit** aan om ook Drive te lezen.

### Testen voordat je opslaat

Klik op **Deze instellingen testen** onder **Testen voor het opslaan**. De test meldt zich aan en leest de aanmeldings- en beheerlogboeken met de waarden uit het formulier, en slaat niets op, dus een ontbrekende delegatie komt aan het licht voordat de verbinding bestaat. Klik daarna op **Volgende**, geef de verbinding een **Naam** en maak haar aan.
:::

| Instelling | Wat je invult |
| --- | --- |
| **Administrator email** | Het adres van de beheerder als wie het serviceaccount optreedt, zoals `admin@example.com`. Die moet het privilege Reports hebben. |
| **Drive-activiteit** | Optioneel, standaard uit. Aan leest elke poll ook het delen en de downloads in Drive. |
| **JSON van het serviceaccount** | Het volledige sleutelbestand, met `client_email` en `private_key`. Het wordt versleuteld, nooit door de API teruggegeven en nooit meer getoond. Vervang het met **Inloggegevens bijwerken** op de verbinding. |

De stap **Opvragen** heeft ook een optionele **Beschrijving**, het **Opvraaginterval (minuten)**, een geheel getal van `1` tot `1440` dat begint op `5`, en **Ingeschakeld**, dat aan begint.

## Wat er wordt geïmporteerd

Elke gebeurtenis heeft leverancier `Google` en product `Google Workspace`. Een activiteit met meerdere gebeurtenissen wordt een beveiligingsgebeurtenis per gebeurtenis, en elke gebeurtenis houdt de velden van de activiteit en haar eigen velden, als `event.name`, `event.type` en `parameters.<name>`, zodat een regel ze leest onder de namen van Google.

| Logboek | Gebeurtenissen | OCSF-klasse | Ernst |
| --- | --- | --- | --- |
| Aanmeldingen (`login`) | `login_success`, `login_failure` met de reden, `login_challenge`. Een afmelding wordt gelezen maar niet geïmporteerd. | Authentication (`3002`) | Informational; Low voor een mislukte aanmelding; Medium als Google haar als `is_suspicious` markeert |
| Detecties van Google (`login`) | `suspicious_login` en zijn varianten, `gov_attack_warning`, `account_disabled_hijacked` en de andere accounts die Google uitschakelde | Detection Finding (`2004`) | Medium; High voor een door een overheid gesteunde aanval, een gekaapt account of een uitgelekt wachtwoord |
| Beheer (`admin`) | Beheerdersrechten en -rollen toegekend of ingetrokken, domeinbrede delegatie, gebruikers gemaakt, verwijderd of opgeschort, verificatie in twee stappen uitgezet, groepsleden, instellingen | User Access Management (`3005`), Account Change (`3001`), Group Management (`3006`), Entity Management (`3004`) | Medium voor toegekende macht; Low voor een verwijderde gebruiker of uitgezette verificatie in twee stappen |
| OAuth-tokens (`token`) | Een app die toegang kreeg tot iemands gegevens, met haar bereiken, of die die toegang kwijtraakte | Authorize Session (`3003`) | Informational |
| SAML (`saml`) | Single sign-on bij een app | Authentication (`3002`) | Low voor een mislukte aanmelding |
| Accountbeveiliging (`user_accounts`) | Wijzigingen aan verificatie in twee stappen, wachtwoord en herstel | Account Change (`3001`) | Low als het het account verzwakt |
| Drive (`drive`), met de optie aan | `change_user_access`, `change_document_visibility`, `change_document_access_scope`, `change_acl_editors`, `download` | File Hosting Activity (`6006`) | Low voor een bestand dat buiten het domein van de eigenaar is gedeeld of voor een link is opengezet |

De regels in de bibliotheek voor Google Workspace lezen ze zoals ze hier worden geïmporteerd, zoals die voor een aanmelding die Google signaleerde, toegekende beheerdersrechten en een bestand dat in Drive openbaar is gemaakt.

## Hoe pollen werkt

- **Activiteiten worden gelezen op het moment waarop ze plaatsvonden.** De Reports API heeft geen ander tijdstip om ze op te tonen, en Google documenteert dat zijn logboeken minuten tot uren te laat binnenkomen.
- **De eerste poll kijkt 24 uur terug**, zodat een nieuwe verbinding meteen haar recente activiteiten toont.
- **Elke volgende poll begint 120 minuten voor de opgeslagen cursor**, dus een activiteit die Google tot 2 uur te laat leesbaar maakt, wordt bij de volgende poll gelezen, en duplicaten worden binnen het project op de ID van elke gebeurtenis weggelaten. Een activiteit die later binnenkomt, leest het pollen niet: importeer haar tijdsbereik vanuit **Diagnose**.
- **Een poll leest hooguit 24 uur voorbij de cursor.** Een verbinding waarvan de cursor achterliep, haalt de achterstand in met een reeks vensters van 24 uur.
- **Drive wordt per gebeurtenis gelezen**, omdat Drive elk bestand vastlegt dat iemand opent. Als Google het logboek van Drive weigert, waarschuwt de run, en worden de andere logboeken nog steeds geïmporteerd.
- **Een mislukte run verandert niets.** Na een netwerkfout, of een foutstatus van Google, blijven de cursor en de vensterlengte zoals ze waren, en leest de volgende poll hetzelfde venster opnieuw. De enige uitzondering is een verzoek dat een time-out kreeg: de cursor blijft staan, maar het volgende venster is half zo lang, omdat een venster dat te zwaar is om op tijd te beantwoorden bij elke poging een time-out zou krijgen.

### Wanneer een venster meer bevat dan één poll kan lezen

Elk logboek heeft een eigen budget, in pagina's van 1.000 activiteiten: 10 voor aanmeldingen, elk 5 voor beheer, OAuth-tokens en SAML, 3 voor accountbeveiliging, en 4 voor elke Drive-gebeurtenis. Een poll stopt na 4 minuten. Als een budget een logboek stopt voor het einde van zijn venster, is de run **Gedeeltelijk**, en noemt de waarschuwing het logboek en het budget. Google toont de nieuwste activiteiten eerst, dus OneUptime verkort het venster in plaats van de cursor voorbij activiteiten te zetten die het nooit bereikte:

1. **Verkleinen.** De volgende poll leest een venster dat half zo lang is, vanaf hetzelfde beginpunt, en blijft halveren tot een venster volledig wordt gelezen, tot één minuut. De waarschuwing van de run zegt het: `This window holds more records than one poll can read; the next poll reads a {n} minute window from the same starting point.` Activiteiten die al uit het langere venster zijn geïmporteerd, worden als duplicaten overgeslagen.
2. **Weer groeien.** Nadat een venster volledig is gelezen, gaat de cursor naar het einde ervan, en is het volgende venster weer twee keer zo lang, tot 24 uur.
3. **Voorbij één minuut gaan.** Als zelfs één minuut meer bevat dan een poll kan lezen, gaat het pollen eraan voorbij, zodat nieuwere activiteiten blijven binnenkomen. De run blijft **Gedeeltelijk**, en **Laatste fout** luidt `More records were created in the one minute from {cursor} to {end} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.` Importeer die minuut met **Import this time range** om terug te halen wat één run kan lezen.

Het **Opvraaginterval (minuten)** wijzigen verandert hier niets aan: het bepaalt hoe vaak een poll begint, niet waar zijn venster begint.

### Uitvoeren, bekijken en importeren op verzoek

Klik op **Diagnose** bij een verbinding om haar recente runs te zien en er met de hand mee te werken. Iedereen die de verbinding kan wijzigen, kan deze acties starten; iedereen die haar kan zien, kan de historie lezen.

- **Nu uitvoeren** start meteen een poll, met de gewone cursor, ook als de verbinding niet **Ingeschakeld** is.
- **Preview audit events** leest een tijdsbereik van maximaal 7 dagen en importeert niets.
- **Import this time range** importeert een bereik van maximaal 7 dagen, nadat je bevestigt, zonder de cursor te verplaatsen. Al geïmporteerde activiteiten worden overgeslagen. Google bewaart 6 maanden auditlogboeken.
- **Copy diagnostics** bij een run kopieert het rapport ervan voor support. Het bevat nooit referenties.

## Verbinding testen

**Verbinding testen** op de rij van een verbinding, en **Deze instellingen testen** in het formulier, draaien in het API-proces, niet in een achtergrondworker, zodat een test ook antwoordt wanneer de workers het probleem zijn. Hij voert deze controles uit, in volgorde:

| Controle | Wat ze controleert |
| --- | --- |
| **Configuratie** | Het adres van de beheerder en de sleutel zijn goed gevormd. Er wordt niets benaderd als dit mislukt. |
| **Authenticate with Google** | Google laat het serviceaccount optreden als de beheerder: de domeinbrede delegatie is ingesteld. |
| **Read the audit logs** | De aanmeldings- en beheerlogboeken van de afgelopen 24 uur kunnen worden gelezen. |
| **Read Drive activity** | Alleen met de optie aan: het logboek van Drive kan worden gelezen. |
| **Activities available to import** | Hoeveel aanmeldings- en beheeractiviteiten de afgelopen 24 uur bevatten, elk maximaal 1.000, dus `1000+` betekent meer. Geen enkele is een waarschuwing. |
| **Background workers**, **Poll scheduler**, **Security event storage** | De kant van OneUptime zelf: een proces neemt de jobs van de Worker-wachtrij af, de poll-job draait elke minuut en de opslag van beveiligingsgebeurtenissen antwoordt. |
| **Scheduled polling** | Voor een opgeslagen verbinding: pollen staat aan, geen run zit vast in afwachting van een worker en polls draaien op tijd. |

Elk verzoek in een test heeft een deadline van 20 seconden. Een test importeert nooit iets en verplaatst nooit de cursor, en elke mislukte controle zegt wat je moet wijzigen.

## Problemen oplossen

De **Laatste fout** van de verbinding bewaart de volledige foutmelding, met referenties gemaskeerd. Wanneer een verbinding een fout heeft, selecteer je **Fout bekijken** in haar kolom **Acties** om hem te lezen, en **Fout kopiëren** in het dialoogvenster om hem te kopiëren. Elke melding begint met `Google Workspace`, noemt daarna het verzoek dat mislukte, en citeert de eigen reden van Google.

:::details Laatste fout zegt `token request failed`
- `unauthorized_client`: het serviceaccount heeft geen domeinbrede delegatie voor het bereik. Voeg zijn **Unique ID** toe met `https://www.googleapis.com/auth/admin.reports.audit.readonly` onder **Manage domain-wide delegation**.
- `invalid_grant` met `Invalid email or User ID`: het **Administrator email** is geen gebruiker van deze Google Workspace.
- `invalid_grant` met `Invalid JWT Signature`: de sleutel is verwijderd of uitgeschakeld. Maak een nieuwe sleutel en sla die op met **Inloggegevens bijwerken**.
:::

:::details Laatste fout zegt `activities request failed (HTTP 403)`
- Reden `SERVICE_DISABLED` of `accessNotConfigured`: de Admin SDK API staat uit in het project van het serviceaccount. Schakel hem in en test over een paar minuten opnieuw.
- Reden `forbidden`: de beheerder mist het privilege Reports. Wijs het toe onder **Account → Admin roles** in de Google Beheerdersconsole, of geef een superbeheerder op.
:::

:::details Drive-activiteit wordt niet gelezen
Het logboek van Drive vraagt een editie die het heeft, en een beheerder met het privilege Reports. Elke run waarschuwt `Drive activity was not read`, en de andere logboeken worden nog steeds geïmporteerd. Zet **Drive-activiteit** uit als je editie geen Drive-logboek heeft.
:::

:::details Laatste fout zegt `did not complete`
Het verzoek kreeg geen antwoord: een time-out, een naam die niet wordt omgezet of een geweigerd adres. Controleer of de OneUptime-app en -workers `oauth2.googleapis.com` en `admin.googleapis.com` kunnen bereiken, via elke proxy die je gebruikt.
:::

:::details De test slaagt, maar Last Polled is Never
De poll-job heeft nog nooit gedraaid. Lees de controles **Background workers** en **Poll scheduler**. Op een zelf gehoste installatie is de gebruikelijke oorzaak `DISABLE_QUEUE_WORKERS=true` op de app, zonder aparte worker-deployment die de jobs afneemt: zet het op `false`, of draai de worker-deployment (Helm: `worker.enabled: true`, dat standaard `false` is).
:::

## Volgende stappen

:::cards
- [Beveiligingsgebeurtenissen](/docs/telemetry/security-events): Zoeken, correleren en waarschuwen op wat je importeert.
- [Microsoft Entra ID](/docs/integrations/microsoft-entra-id): Importeer de aanmeldingen en directorywijzigingen van Microsoft.
- [Google SecOps](/docs/integrations/google-secops): Haal ook de detecties van Google SecOps binnen.
- [Overzicht van integraties](/docs/integrations/index): De andere tools die je kunt koppelen.
:::
