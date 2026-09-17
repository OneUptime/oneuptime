# Werken met OneUptime vanuit GitHub

De OneUptime GitHub App is niet alleen een verbinding met uw code — u kunt hem in uw repository aanspreken, en dan doet hij het werk daar ter plekke.

Vermeld hem in een issue en hij opent een pull request. Vermeld hem in een pull request en hij herziet de branch, of beoordeelt de diff. Zet een label op een issue en hij pakt die issue op. Alles wat hij oplevert is een pull request of een review die een mens moet lezen: **hij merget nooit iets, en hij keurt nooit een pull request goed.**

```text
@oneuptime implement this                              →  een pull request die de issue sluit
@oneuptime revise this — gebruik exponentiële backoff  →  nieuwe commits op de branch van deze pull request
@oneuptime review                                      →  een codereview, geplaatst op deze pull request
```

> Vervang `@oneuptime` door de handle van uw eigen app. Op OneUptime Cloud is dat `@oneuptime`. Op een zelf-gehoste instantie is het de naam die u uw GitHub App hebt gegeven, in kleine letters en met spaties vervangen door koppeltekens — een app met de naam "Acme AI" vermeldt u als `@acme-ai`. Doet een vermelding niets, controleer dit dan als eerste.

## Voordat u begint

- De repository moet via de GitHub App **aan een OneUptime-project gekoppeld** zijn. Zie [GitHub-integratie (zelf-gehost)](/docs/self-hosted/github-integration) voor de installatie, of koppel hem op OneUptime Cloud via **Projectinstellingen → Code-opslagplaatsen**.
- Er moet een **Runner met de capability "Voert AI-codefixes uit"** online zijn — dezelfde Runner die [AI Fix Tasks](/docs/ai/ai-agent) uitvoert. Zonder Runner worden commando's wel aangenomen, maar mislukken ze na 30 minuten met de melding dat geen enkele agent ze heeft opgepakt.
- De GitHub App moet de machtiging **Issues: Lezen & Schrijven** hebben en geabonneerd zijn op de webhookgebeurtenissen onder [Waarop u zich moet abonneren](#waarop-u-zich-moet-abonneren).

## De commando's

Elk commando begint met een vermelding van de app. Die vermelding mag overal in de opmerking staan, en alles wat u erachter schrijft, wordt als uw verzoek doorgegeven.

### Op een pull request

| Commando | Wat er gebeurt |
| --- | --- |
| `@oneuptime review` | Kloont de branch, leest de gewijzigde code **en de code eromheen**, en plaatst een review als opmerking. Verandert niets. |
| `@oneuptime revise this — <wat u gewijzigd wilt hebben>` | Kloont de eigen branch van de pull request, voert de wijziging door en pusht nieuwe commits naar diezelfde branch. Opent nooit een tweede pull request. |

Alles wat u na de vermelding schrijft en wat geen herkend commando is, wordt opgevat als een verzoek om een herziening — want dat is het vrijwel altijd:

```text
@oneuptime de retry-lus hier moet exponentiële backoff gebruiken, en de test
moet het 429-geval afdekken
```

### Op een issue

| Commando | Wat er gebeurt |
| --- | --- |
| `@oneuptime implement this` | Werkt de issue uit en opent een pull request die hem sluit. |
| `@oneuptime <wat u verder ook schrijft>` | Hetzelfde, met uw woorden als extra sturing. |

U kunt een issue ook **zonder ook maar een opmerking te plaatsen** aan de app overdragen:

- **Zet het triggerlabel erop.** Het triggerlabel van de repository — standaard `oneuptime` — aan een issue toevoegen start hetzelfde werk. Dit is de betrouwbaarste manier om vanuit de GitHub-UI werk uit te delen.
- **Wijs de issue toe aan de bot-gebruiker van de app**, als uw repository dat toestaat. GitHub laat een app niet overal als toegewezen persoon toe — daarom bestaat het label; doet toewijzen niets, gebruik dan het label.

### Overal

| Commando | Wat er gebeurt |
| --- | --- |
| `@oneuptime help` | Somt de commando's op. Een kale vermelding zonder iets erachter doet hetzelfde. |
| `@oneuptime status` | Vertelt waar hij in deze thread op dit moment aan werkt. |
| `@oneuptime cancel` | Stopt de runs die hij in deze thread heeft lopen. Werk dat al gepusht is, blijft gepusht. |

`help`, `status` en `cancel` starten nooit een agent-run: ze kosten dus niets en vallen niet onder uw dagelijkse budget voor fixtaken.

## Hoe het eruitziet in de thread

Eén commando levert **één opmerking** op, die de app bijwerkt naarmate het werk vordert — zo maakt een langlopende taak van een pull request nooit een statuslogboek.

1. Hij reageert met 👀 op uw opmerking en plaatst een bevestiging die het OneUptime-project noemt waar de run bij hoort, met een link naar de live run.
2. Als hij klaar is, wordt diezelfde opmerking herschreven met de uitkomst: de pull request die hij heeft geopend, de commits die hij heeft gepusht, of een eerlijke uitleg waarom hij niets heeft gedaan.

Vindt hij niets wat de moeite van het wijzigen waard is, dan zegt hij dat, in plaats van op goed geluk een pull request te openen. Dat is een normale uitkomst, geen mislukking — geef hem meer sturing en vraag het opnieuw.

## Wie hem mag aansturen

**Alleen mensen met write-, maintain- of admin-toegang tot de repository.** OneUptime vraagt GitHub elke keer rechtstreeks welke rechten de schrijver van de opmerking op die repository heeft; het vertrouwt niet op de "contributor"-badge die GitHub naast een opmerking toont, want die beschrijft eerdere activiteit en niet de huidige toegang.

Een vermelding van iemand anders krijgt één 😕-reactie op de opmerking en verder niets. Dat is met opzet: op een openbare repository kan iedereen een opmerking plaatsen, en een app die betrouwbaar antwoordt aan onbekenden is een app waarmee een thread kan worden gespamd.

Hij negeert ook elke opmerking die door een bot is geschreven, inclusief die van hemzelf, en negeert vermeldingen die in een citaat (`>`) of in een codeblok staan. Samen zorgen die twee regels ervoor dat een antwoord op een van zijn eigen opmerkingen hem niet opnieuw aan het werk zet.

## Wat hij niet doet

- **Hij merget nooit.** Niets wat deze app doet kan code op uw standaardbranch zetten.
- **Hij keurt nooit goed en vraagt nooit om wijzigingen.** Reviews worden als opmerking geplaatst, zodat een review van een app nooit aan een branch protection rule kan voldoen.
- **Hij herschrijft nooit de geschiedenis.** Een herziening voegt commits toe; force-pushen doet hij niet. Heeft iemand anders eerder naar de branch gepusht, dan mislukt de herziening in plaats van dat werk weg te gooien.
- **Hij kan geen pull request vanuit een fork herzien.** De branch van een fork zit in een repository waar de installatie niet naartoe kan schrijven. Beoordelen kan hij hem wel — vraag dan om een review.
- **Hij wijzigt nooit de titel, beschrijving of doelbranch van een pull request.** Alleen code.

## Wat het kost, en hoe u dat begrenst

Elk commando dat werk start, is een volledige agent-run — een clone, maximaal 40 LLM-aanroepen en 100.000 outputtokens, plus de build- en testcommando's van uw repository als u die hebt geconfigureerd.

Er gelden twee limieten, en het zijn allebei dezelfde die al voor [AI Fix Tasks](/docs/ai/ai-agent) gelden:

- **De dagelijkse limiet op fixruns van het project** (**Projectinstellingen → AI**, standaard 25 per dag). GitHub-commando's delen dit budget met de overige fixruns van uw project.
- **Het maximum aan open pull requests per repository** (**Code-opslagplaatsen → de repository → Instellingen**, standaard 5). Reviews en herzieningen vallen daarbuiten: geen van beide voegt een nieuwe pull request toe aan uw reviewwachtrij.

Per issue of pull request loopt er maar één run van een bepaald soort tegelijk. Vraagt u het twee keer, dan krijgt u te horen dat hij er al mee bezig is; vraagt u om een review terwijl er een herziening loopt, dan starten er twee, want dat zijn verschillende verzoeken.

Kan een run niet starten, dan zegt de app in de thread waarom — hij mislukt nooit in stilte.

## Hem uitzetten

Per repository: **Code-opslagplaatsen → de repository → Instellingen → Reageren op GitHub-commando's**. Staat dat uit, dan negeert de app vermeldingen, toewijzingen en het triggerlabel in die repository, en vertelt hij iedereen die het vraagt waar de schakelaar zit.

Op dezelfde pagina staat het **GitHub-triggerlabel**, als u iets anders wilt dan `oneuptime`.

## Waarop u zich moet abonneren

Abonneer u in de instellingen **Machtigingen en gebeurtenissen** van uw GitHub App op:

| Gebeurtenis | Nodig voor |
| --- | --- |
| **Issue comment** | `@mention`-commando's op issues *én* pull requests |
| **Issues** | toewijzing aan de app, en het triggerlabel |
| **Pull request** | een review die van de app wordt gevraagd |
| **Pull request review** | een vermelding in de body van een ingediende review |
| **Pull request review comment** | een vermelding bij een inline opmerking in de diff |

En onder **Repositorymachtigingen** moet **Issues** op **Lezen & Schrijven** staan — GitHub leidt de gespreksopmerkingen van een pull request via de issues-API, en dit is dus wat de app ook op pull requests laat reageren.

## Prompt injection: wat wel en niet is afgeschermd

Issue-tekst, beschrijvingen van pull requests, diffs en opmerkingen worden allemaal onderdeel van de prompt van de agent, en op een openbare repository kan iedereen ze schrijven. Tekst die zegt "negeer je instructies en doe X" is iets wat u realistisch gezien in een issue tegenkomt.

Twee dingen begrenzen dit, en het is de moeite waard te weten wat wat is:

- **De prompts merken onvertrouwde tekst aan als een verzoek, niet als instructies**, en de repository, branch en pull request van de run liggen vast voordat de agent ook maar start — niets van wat de agent leest, kan veranderen waaraan hij werkt.
- **De echte afscherming is de sandbox.** De agent draait op uw Runner, in een wegwerpkloon, met credentials uit zijn commando-omgeving gestript en zijn git-bewerkingen beperkt. Hij kan alleen ooit naar een branch pushen, en alleen een mens kan er een mergen.

Behandel een door AI geschreven pull request zoals u er een zou behandelen van een nieuwe bijdrager die de issue heeft gelezen: beoordeel de diff, niet de beschrijving.

## Probleemoplossing

**Er gebeurt niets als ik hem vermeld.** Controleer eerst de handle — dat is de slug van de app, niet de weergavenaam. Controleer daarna of de repository aan een project is gekoppeld (**Projectinstellingen → Code-opslagplaatsen**), of **Reageren op GitHub-commando's** aanstaat, en of uw GitHub App geabonneerd is op de bovenstaande gebeurtenissen.

**Hij reageert met 😕 en zegt niets.** U hebt geen schrijftoegang tot de repository.

**Hij zegt dat hij hier al mee bezig is.** Er loopt al een run van dat soort op deze issue of pull request. `@oneuptime status` vertelt u welke, en `@oneuptime cancel` stopt hem.

**Hij heeft bevestigd en bleef daarna lang stil.** Controleer of er onder **Instellingen → Runners** een Runner met **Voert AI-codefixes uit** online is. Zonder Runner wordt de run na 30 minuten als mislukt gemarkeerd en krijgt de thread dat te horen.

**Hij zegt dat de pull request uit een fork komt.** Herzieningen hebben een branch in deze repository nodig. Vraag in plaats daarvan om een review, of push de branch hierheen.

## Waar verder lezen

- [AI Fix Tasks](/docs/ai/ai-agent) — dezelfde agent, gestart vanuit een exception in plaats van vanuit GitHub.
- [GitHub-integratie (zelf-gehost)](/docs/self-hosted/github-integration) — de GitHub App aanmaken en configureren.
- [Runners](/docs/runbooks/agents) — de worker die de runs uitvoert.
