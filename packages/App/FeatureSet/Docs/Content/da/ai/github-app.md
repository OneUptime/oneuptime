# Arbejd med OneUptime fra GitHub

OneUptime GitHub App er ikke kun en forbindelse til din kode — du kan tale med den inde i dit repository, og så udfører den arbejdet der.

Nævn den i et issue, og den åbner en pull request. Nævn den i en pull request, og den reviderer grenen eller gennemgår diffen. Sæt en label på et issue, og den tager issuet op. Alt, hvad den producerer, er en pull request eller et review, som et menneske skal læse: **den merger aldrig noget, og den godkender aldrig en pull request.**

```text
@oneuptime implement this                          →  en pull request, der lukker issuet
@oneuptime revise this — use exponential backoff   →  nye commits på pull requestens gren
@oneuptime review                                  →  et kodereview postet på denne pull request
```

> Udskift `@oneuptime` med din egen apps slug. På OneUptime Cloud er den `@oneuptime`. På en selvhostet instans er det det navn, du gav din GitHub App, med små bogstaver og mellemrum lavet om til bindestreger — en app, der hedder "Acme AI", nævnes som `@acme-ai`. Hvis omtaler ikke gør noget, er det det første, du skal tjekke.

## Før du går i gang

- Repositoryet skal være **forbundet til et OneUptime-projekt** gennem GitHub Appen. Se [GitHub-integration (selvhostet)](/docs/self-hosted/github-integration) for opsætningen, eller forbind det fra **Projektindstillinger → Kode-repositorier** på OneUptime Cloud.
- En **Runbook-agent med egenskaben "Kører AI-koderettelser"** skal være online — den samme agent, der udfører [AI-rettelsesopgaver](/docs/ai/ai-agent). Uden en bliver kommandoer taget imod og fejler så efter 30 minutter med en besked om, at ingen agent tog dem op.
- GitHub Appen skal have tilladelsen **Issues: Læs og skriv** og abonnere på de webhook-hændelser, der står under [Hvad du skal abonnere på](#hvad-du-skal-abonnere-på).

## Kommandoerne

Alle kommandoer begynder med en omtale af appen. Omtalen må stå hvor som helst i kommentaren, og alt, hvad du skriver efter den, gives videre som din anmodning.

### På en pull request

| Kommando | Hvad der sker |
| --- | --- |
| `@oneuptime review` | Kloner grenen, læser den ændrede kode **og koden omkring den** og poster et review som en kommentar. Ændrer ingenting. |
| `@oneuptime revise this — <what you want changed>` | Kloner pull requestens egen gren, laver ændringen og pusher nye commits til den samme gren. Åbner aldrig endnu en pull request. |

Alt, hvad du skriver efter omtalen, og som ikke er en genkendt kommando, behandles som en anmodning om en revision, for det er næsten altid det, det er:

```text
@oneuptime the retry loop here should back off exponentially, and the test
should cover the 429 case
```

### På et issue

| Kommando | Hvad der sker |
| --- | --- |
| `@oneuptime implement this` | Arbejder med issuet og åbner en pull request, der lukker det. |
| `@oneuptime <anything else>` | Det samme, men med dine ord som ekstra retning. |

Du kan også overdrage et issue til appen **helt uden at kommentere**:

- **Sæt triggerlabelen på.** Sætter du repositoryets triggerlabel — `oneuptime` som standard — på et issue, sætter det det samme arbejde i gang. Det er den mest pålidelige måde at uddelegere arbejde på fra GitHubs brugerflade.
- **Tildel issuet til appens bot-bruger**, hvor dit repository tillader det. GitHub lader ikke en app være ansvarlig alle steder, og det er derfor, labelen findes; gør en tildeling ingenting, så brug labelen.

### Alle steder

| Kommando | Hvad der sker |
| --- | --- |
| `@oneuptime help` | Viser kommandoerne. En bar omtale uden noget efter gør det samme. |
| `@oneuptime status` | Fortæller, hvad den er i gang med lige nu i denne tråd. |
| `@oneuptime cancel` | Stopper de kørsler, den har i gang i denne tråd. Arbejde, der allerede er pushet, bliver liggende. |

`help`, `status` og `cancel` starter aldrig en agent-kørsel, så de koster ingenting og tæller ikke med i dit daglige budget for rettelsesopgaver.

## Sådan ser det ud i tråden

Én kommando giver **én kommentar**, som appen redigerer, efterhånden som arbejdet skrider frem — så en langvarig opgave laver aldrig en pull request om til en statuslog.

1. Den reagerer 👀 på din kommentar og poster en kvittering, der nævner det OneUptime-projekt, kørslen hører til, og linker til den igangværende kørsel.
2. Når den er færdig, bliver den samme kommentar skrevet om med resultatet: den pull request, den åbnede, de commits, den pushede, eller en ærlig forklaring på, hvorfor den ikke gjorde noget.

Finder den ikke noget, der er værd at ændre, siger den det i stedet for at åbne en spekulativ pull request. Det er et normalt udfald, ikke en fejl — giv den mere retning, og spørg igen.

## Hvem må give den kommandoer

**Kun folk med write-, maintain- eller admin-adgang til repositoryet.** OneUptime spørger hver eneste gang GitHub direkte om, hvilke rettigheder kommentarens forfatter har på netop det repository; den stoler ikke på det "contributor"-mærkat, GitHub viser ved siden af en kommentar, for det beskriver tidligere aktivitet frem for nuværende adgang.

En omtale fra alle andre får én 😕-reaktion på kommentaren og ellers ingenting. Det er med vilje: på et offentligt repository kan hvem som helst kommentere, og en app, der pålideligt svarer fremmede, er en app, der kan bruges til at spamme en tråd.

Den ignorerer også alle kommentarer skrevet af en bot, sine egne inklusive, og den ignorerer omtaler, der står inde i et citat (`>`) eller en kodeblok. Tilsammen er det de to regler, der forhindrer, at et svar på en af dens egne kommentarer sætter den i gang igen.

## Hvad den ikke gør

- **Den merger aldrig.** Intet af det, denne app gør, kan lægge kode på din standardgren.
- **Den godkender aldrig og beder aldrig om ændringer.** Reviews postes som kommentarer, så et review fra en app kan aldrig opfylde en regel for grenbeskyttelse.
- **Den skriver aldrig historik om.** En revision tilføjer commits; den force-pusher ikke. Har en anden pushet til grenen først, fejler revisionen i stedet for at kassere deres arbejde.
- **Den kan ikke revidere en pull request fra en fork.** En forks gren ligger i et repository, som installationen ikke kan skrive til. Den kan stadig gennemgå den — bed om et review i stedet.
- **Den ændrer aldrig en pull requests titel, beskrivelse eller målgren.** Kun kode.

## Hvad det koster, og hvordan du sætter grænser

Enhver kommando, der sætter arbejde i gang, er en fuld agent-kørsel — en klon, op til 40 LLM-kald og 100.000 output-tokens plus dit repositorys build- og testkommandoer, hvis du har konfigureret dem.

To grænser gælder, og det er begge dem, der i forvejen styrer [AI-rettelsesopgaver](/docs/ai/ai-agent):

- **Projektets daglige grænse for rettelseskørsler** (**Projektindstillinger → AI**, 25 pr. dag som standard). GitHub-kommandoer deler dette budget med resten af projektets rettelseskørsler.
- **Loftet over åbne pull requests pr. repository** (**Kode-repositorier → repositoryet → Indstillinger**, 5 som standard). Reviews og revisioner er undtaget: ingen af dem lægger en ny pull request i din reviewkø.

Der kan kun være én kørsel af en given slags i gang ad gangen pr. issue eller pull request. Spørger du to gange, får du at vide, at den allerede er i gang; beder du om et review, mens en revision kører, starter begge, for det er to forskellige anmodninger.

Kan en kørsel ikke startes, siger appen hvorfor i tråden — den fejler aldrig i stilhed.

## Sådan slår du det fra

Pr. repository: **Kode-repositorier → repositoryet → Indstillinger → Svar på GitHub-kommandoer**. Er den slået fra, ignorerer appen omtaler, tildelinger og triggerlabelen i det repository og fortæller den, der spørger, hvor kontakten sidder.

Den samme side rummer **GitHub-triggerlabel**, hvis du vil have noget andet end `oneuptime`.

## Hvad du skal abonnere på

Under **Tilladelser og hændelser** i din GitHub Apps indstillinger skal du abonnere på:

| Hændelse | Nødvendig for |
| --- | --- |
| **Issue comment** | `@mention`-kommandoer på issues *og* pull requests |
| **Issues** | tildeling til appen og triggerlabelen |
| **Pull request** | et review anmodet fra appen |
| **Pull request review** | en omtale i teksten på et indsendt review |
| **Pull request review comment** | en omtale på en inline-kommentar i diffen |

Og under **Repository-tilladelser** skal **Issues** stå til **Læs og skriv** — GitHub leverer kommentarer i pull request-samtaler gennem issues-API'et, og det er dét, der også lader appen kommentere på pull requests.

## Prompt injection: hvad der er beskyttet, og hvad der ikke er

Issue-tekst, beskrivelser af pull requests, diffs og kommentarer bliver alle sammen en del af agentens prompt, og på et offentligt repository kan hvem som helst skrive dem. Tekst i stil med "ignorér dine instruktioner og gør X" er noget, man realistisk kan finde i et issue.

To ting sætter grænser for det, og det er værd at vide, hvad der er hvad:

- **Prompterne markerer tekst, der ikke kan stoles på, som en anmodning og ikke som instruktioner**, og kørslens repository, gren og pull request ligger fast, før agenten overhovedet går i gang — intet af det, agenten læser, kan ændre, hvad den arbejder på.
- **Den egentlige indeslutning er sandkassen.** Agenten kører på din Runbook-agent, i en klon, der smides væk, med credentials fjernet fra sit kommandomiljø og sine git-operationer begrænset. Den kan aldrig andet end at pushe til en gren, og kun et menneske kan merge en.

Behandl en AI-skrevet pull request, som du ville behandle en fra en ny bidragyder, der har læst issuet: gennemgå diffen, ikke beskrivelsen.

## Fejlfinding

**Der sker ingenting, når jeg nævner den.** Tjek først navnet, du nævner — det er appens slug, ikke dens visningsnavn. Tjek derefter, at repositoryet er forbundet til et projekt (**Projektindstillinger → Kode-repositorier**), at **Svar på GitHub-kommandoer** er slået til, og at din GitHub App abonnerer på hændelserne ovenfor.

**Den reagerer 😕 og siger ikke noget.** Du har ikke skriveadgang til repositoryet.

**Den siger, at den allerede er i gang med det her.** En kørsel af den slags er allerede i gang på dette issue eller denne pull request. `@oneuptime status` fortæller dig hvad, og `@oneuptime cancel` stopper den.

**Den kvitterede og blev så tavs i lang tid.** Tjek, at en Runbook-agent med **Kører AI-koderettelser** er online under **Indstillinger → Runbook-agenter**. Uden en bliver kørslen fejlet efter 30 minutter, og tråden får besked.

**Den siger, at pull requesten kommer fra en fork.** Revisioner kræver en gren i dette repository. Bed om et review i stedet, eller push grenen hertil.

## Læs videre

- [AI-rettelsesopgaver](/docs/ai/ai-agent) — den samme agent, udløst af en undtagelse i stedet for fra GitHub.
- [GitHub-integration (selvhostet)](/docs/self-hosted/github-integration) — sådan opretter og konfigurerer du GitHub Appen.
- [Runbook-agenter](/docs/runbooks/agents) — den arbejder, der udfører kørslerne.
