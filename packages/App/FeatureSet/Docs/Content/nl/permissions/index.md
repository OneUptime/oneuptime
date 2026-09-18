# Gebruikers, teams en machtigingen

Alles in OneUptime leeft binnen een **project**. Wie daarin wat mag, komt neer op drie dingen: de **gebruikers** erin, de **teams** waartoe die gebruikers behoren en de **machtigingen** die aan die teams zijn toegekend.

De ene regel die het meeste gedrag verklaart: **gebruikers hebben nooit rechtstreeks machtigingen.** De toegang van een gebruiker is de vereniging van de machtigingen van elk team waartoe hij in dat project behoort. Wilt u veranderen wat iemand mag, dan verandert u zijn teamlidmaatschap of de machtigingen van dat team.

**Eigenaren** zijn iets anders. Een eigenaar is degene die verantwoordelijk is voor één specifieke resource — een monitor, een incident, een dashboard. Eigenaren krijgen meldingen over hun resources, en machtigingen kunnen desgewenst worden ingeperkt tot "alleen wat van mij is".

## Het model in één oogopslag

```text
Project
  └── Team                       ← hier hangen de machtigingen
       ├── Toegestane rechten    ← elk met een bereik: Alle / Eigen / Labels
       ├── Geblokkeerde rechten  ← winnen altijd van toegestane rechten
       └── Teamleden             ← gebruikers die de uitnodiging accepteerden
```

| Begrip | Wat het is |
| --- | --- |
| Gebruiker | Eén OneUptime-account. Eén login, willekeurig veel projecten. |
| Project | De tenantgrens. Monitors, incidenten, teams en data horen bij precies één project. |
| Team | Een benoemde groep binnen een project die de machtigingen draagt. |
| Teamlid | Een gebruiker die voor een team is uitgenodigd en heeft geaccepteerd. |
| Machtiging | Eén mogelijkheid, bijv. `CreateProjectMonitor`, of een rol die er vele bundelt, bijv. `MonitorAdmin`. |
| Bereik | Hoe ver een toegestane machtiging reikt: alle resources, alleen eigen resources of alleen gelabelde. |
| Eigenaar | Een gebruiker of team dat als verantwoordelijke voor één specifieke resource is aangemerkt. |
| Label | Een markering die u op resources plaatst, gebruikt om machtigingen te beperken en om te ordenen. |

## Gebruikers

Een gebruikersaccount is globaal voor de OneUptime-installatie — dezelfde login werkt in elk project waarvoor de gebruiker is uitgenodigd.

Een gebruiker zit "in" een project zodra hij lid is van **minstens één team** erin. Er is geen aparte stap "gebruiker aan project toevoegen": iemand voor een project uitnodigen is iemand voor een team uitnodigen.

- Uitnodigingen maken een openstaand teamlid aan. De gebruiker telt pas als projectlid — en krijgt pas enige machtiging — **nadat hij de uitnodiging heeft geaccepteerd.**
- Een gebruiker uit alle teams van een project verwijderen ontneemt hem de toegang tot dat project.
- Als uw project SSO afdwingt en een gebruiker zich nog niet via de identityprovider heeft geauthenticeerd, geldt hij als niet-geautoriseerde SSO-gebruiker en ziet hij niets tot hij dat doet. Zie [SSO](/docs/identity/sso).
- Met SCIM ingesteld kan uw identityprovider gebruikers en hun teamlidmaatschappen automatisch aanmaken, bijwerken en verwijderen. Zie [SCIM](/docs/identity/scim).

Waar u het vindt: **Instellingen → Gebruikers** toont iedereen in het project met de status van de uitnodiging.

## Teams

Teams zijn de weg waarlangs machtigingen bij mensen terechtkomen. Elk nieuw project begint met drie:

| Team | Machtiging | Bewerkbaar |
| --- | --- | --- |
| Owners | `ProjectOwner` | Nee. Heeft altijd minstens één lid. |
| Admin | `ProjectAdmin` | Nee |
| Members | `ProjectMember` | Ja — dit is een startpunt, wijzig het gerust |

De teams **Owners** en **Admin** zijn bewust vergrendeld: hun machtigingen zijn niet te bewerken en de teams kunnen niet worden verwijderd of hernoemd. Dat voorkomt dat een project zichzelf per ongeluk buitensluit. Het Owners-team moet altijd minstens één lid houden.

`ProjectOwner` is het hoogste toegangsniveau: facturatie, het project verwijderen en alles wat een beheerder kan. `ProjectAdmin` dekt alles behalve facturatie en het verwijderen van het project.

Maak zoveel extra teams als u wilt — "Frontend-piket", "Support", "Alleen-lezen auditors" — en geef elk de machtigingen die het nodig heeft.

Waar u het vindt: **Instellingen → Teams**. Open een team om bij **Members**, **Permissions** en **Block Permissions** te komen.

## Machtigingen

Een machtiging is één mogelijkheid. Er zijn twee manieren om ze uit te delen, allebei op het tabblad **Permissions** van het team.

### Rollen

Een rol bundelt een heel productgebied op een van drie niveaus:

- **Admin** — volledige controle over dat gebied, inclusief de configuratie ervan (ernstniveaus, statussen, sjablonen).
- **Member** — het dagelijkse werk: resources aanmaken, bewerken en verwijderen, maar het gebied niet herconfigureren.
- **Viewer** — alleen lezen.

`MonitorAdmin`, `IncidentMember`, `StatusPageViewer` enzovoort. Rollen zijn bijna altijd wat u wilt — ze blijven kloppen naarmate OneUptime functies toevoegt, omdat een nieuwe monitorgerelateerde tabel bij de bestaande monitorrollen wordt gevoegd in plaats van een nieuwe toekenning van u te vragen.

Alle {{PERMISSION_ROLE_COUNT}} rollen staan in de [Machtigingsreferentie](/docs/permissions/reference).

### Granulaire machtigingen

Elke afzonderlijke mogelijkheid is ook los toe te kennen — `CreateProjectMonitor`, `ReadProjectIncident`, `DeleteProjectStatusPage` en nog {{PERMISSION_TOTAL_COUNT}} andere. Gebruik deze wanneer een rol te breed is en u precies één ding wilt toekennen.

Het zijn ook de sleutels die u gebruikt bij het aanmaken van API-sleutels, en die de API en de Terraform-provider verwachten.

De volledige lijst staat in de [Machtigingsreferentie](/docs/permissions/reference).

### Toestaan en blokkeren

Elk team heeft twee lijsten:

- **Permissions** (toestaan) — wat dit team mag doen.
- **Block Permissions** — wat dit team nooit mag doen, ongeacht enige toestemming.

**Blokkeren wint altijd.** Een blokkade zonder labels haalt die mogelijkheid volledig weg bij het team. Een blokkade met labels haalt hem alleen weg voor resources met die labels — handig voor "dit team mag monitors bewerken, behalve de monitors met het label Production".

Een machtiging kan niet in beide lijsten tegelijk beperkingslabels dragen; OneUptime weigert de tweede met een uitleg.

Omdat de toegang van een gebruiker de vereniging over al zijn teams is, heft een blokkade in het ene team **geen** toestemming in een ander team op. Blokkades beperken het team waarop ze zijn ingesteld. Heeft iemand meer toegang dan u verwacht, controleer dan alle teams waar die persoon lid van is.

## Bereik: hoe ver een toegestane machtiging reikt

Elke toegestane machtiging krijgt een bereik, dat u kiest bij het toevoegen:

| Bereik | Betekenis |
| --- | --- |
| Alle resources in het project | De standaard. De machtiging geldt voor elke passende resource. |
| Eigendom van dit team of zijn leden | De machtiging geldt alleen voor resources waarbij dit team, of de handelende gebruiker, als eigenaar staat vermeld. |
| Beperken met labels (geavanceerd) | De machtiging geldt alleen voor resources met minstens één van de gekozen labels. |

**Eigen** is de eenvoudigste manier om een model van "je zorgt voor je eigen diensten" te bouwen: geef een team `MonitorAdmin` met bereik Eigen en maak dat team vervolgens eigenaar van de monitors waarvoor het verantwoordelijk is. Het perkt alleen resources in die daadwerkelijk eigenaren kunnen hebben — monitors, incidenten, dashboards, services en dergelijke. Projectconfiguratie (incidentstatussen, labels, de teams zelf) heeft geen eigenaar, dus daar gedraagt een rol met bereik Eigen zich gewoon normaal.

**Labels** is de handmatiger variant van hetzelfde idee: markeer resources en ken vervolgens machtigingen toe die tot die markeringen beperkt zijn.

Sommige rollen zijn per definitie projectbreed en bieden helemaal geen bereik, omdat ze inperken niets zou betekenen — "Billing Admin, maar alleen voor de facturatie die van mij is" beschrijft niets:

{{PERMISSION_SCOPE_EXEMPT_ROLES}}

## Eigenaren

Een eigenaar is een gebruiker of team dat aan één specifieke resource is gekoppeld. De meeste resources die iets voorstellen dat u beheert — monitors, incidenten, waarschuwingen, gepland onderhoud, piketregelingen, dashboards, services, statuspagina's, workflows, runbooks en SLO's — hebben een tabblad **Owners**.

Eigenaren doen twee dingen:

1. **Melden.** Eigenaren zijn degenen die OneUptime waarschuwt wanneer er iets met de resource gebeurt — een monitor valt uit, er wordt een incident aangemaakt, een SLO begint zijn foutbudget op te maken.
2. **Toegang, als u daarom vraagt.** Eigendom is waartegen het bereik Eigen wordt opgelost. Een gebruiker past als hij persoonlijk eigenaar is, of als een van zijn teams eigenaar is.

Eigendom op zich verleent niets. Eigenaar van een monitor zijn geeft geen bewerkrecht, tenzij een van uw teams ook een monitormachtiging heeft. Eigendom perkt toegang in; het verruimt die nooit.

## Labels

Labels zijn projectbrede markeringen die u aan resources hangt. Ze dienen twee doelen: filteren en groeperen in het dashboard, en het beperken van machtigingen zoals hierboven beschreven.

Aan een labelbeperking is voldaan als de resource **minstens één** van de labels van de machtiging draagt. Een resource zonder labels voldoet aan geen enkele labelbeperkte machtiging.

Waar u het vindt: **Instellingen → Labels**.

## API-sleutels

API-sleutels krijgen machtigingen rechtstreeks op de sleutel zelf — ze horen niet bij teams en worden niet beïnvloed door teamlidmaatschap.

- Ken dezelfde granulaire machtigingen en rollen toe die u aan een team zou geven.
- Sleutels ondersteunen **geblokkeerde machtigingen** en **labelbeperkingen**, net als teams.
- Sleutels ondersteunen het bereik Eigen **niet**. Eigendom wordt tegen een gebruiker opgelost en een sleutel is geen gebruiker; geef sleutels dus expliciet de toegang die ze nodig hebben.

Geef elke integratie een eigen sleutel met de smalste set machtigingen die werkt, zodat u er één kunt intrekken zonder de andere te verstoren.

Waar u het vindt: **Instellingen → API-sleutels**. Zie ook de [API-referentie](/docs/api-reference/api-reference).

## Hoe OneUptime bepaalt of een verzoek is toegestaan

Voor een ingelogde gebruiker, op volgorde:

1. Zoek de teams waartoe de gebruiker in dit project behoort, waarbij alleen geaccepteerde uitnodigingen meetellen.
2. Verzamel elke machtigingsregel van die teams — toestaan en blokkeren, elk met labels en bereik.
3. Controleer eerst de blokkadelijst. Een passende blokkade zonder labels wijst het verzoek meteen af.
4. Controleer de toestaanlijst. Het verzoek heeft minstens één machtiging nodig die de doeltabel voor deze bewerking accepteert.
5. Pas het bereik toe. Toekenningen met bereik Eigen beperken de query tot resources in eigendom; die met labels beperken tot passende labels. Is een andere toekenning voor dezelfde bewerking breder, dan wint de bredere.
6. Pas labelblokkades toe. Een blokkade met labels wijst het verzoek af als de doelresource er één draagt.

Elke ingelogde gebruiker heeft daarnaast een kleine set automatische machtigingen voor zaken als het lezen van zijn eigen profiel en zijn eigen meldingsregels. Dat zijn geen beheerdersrechten en ze ontsluiten niemand anders' gegevens.

Opgeloste machtigingen worden per gebruiker en project gecachet en vernieuwd wanneer teamlidmaatschap of teammachtigingen wijzigen. Ziet een gebruiker een wijziging niet meteen, laat hem dan herladen.

## Recepten

**Een team dat alleen meekijkt.** Maak het team en voeg de rol `Viewer` toe, of de `*Viewer`-rollen per gebied voor precies de gebieden die het mag zien.

**Piketengineers die hun eigen diensten beheren.** Geef het team `MonitorAdmin`, `IncidentMember` en `OnCallMember` met bereik **Eigen** en voeg het team toe als eigenaar van de monitors die het draait.

**Externen uit de productie houden.** Geef het team de nodige rollen met bereik **Alle** en voeg daarna een **geblokkeerde machtiging** toe voor de gevoelige mogelijkheden, beperkt tot het label `Production`.

**Een CI-pijplijn die alleen deploys meldt.** Maak een API-sleutel met precies de granulaire machtigingen die nodig zijn — geen rollen.

**Iemand die de facturatie niet mag zien.** Voeg hem niet toe aan het Owners-team. `ProjectAdmin` sluit facturatie al uit.

## Verder

- [Machtigingsreferentie](/docs/permissions/reference) — elke rol en elke granulaire machtiging, gegenereerd uit de OneUptime-broncode.
- [SSO](/docs/identity/sso) en [SCIM](/docs/identity/scim) — authenticatie en automatische gebruikersinrichting.
- [API-referentie](/docs/api-reference/api-reference) — machtigingen gebruiken vanaf de API.
