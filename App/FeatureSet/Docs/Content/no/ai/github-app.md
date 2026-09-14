# Arbeide med OneUptime fra GitHub

OneUptime GitHub App er ikke bare en tilkobling til koden din — du kan snakke med den i repositoriet ditt, og den gjør jobben der.

Nevn den i en sak, og den åpner en pull request. Nevn den i en pull request, og den reviderer grenen eller gjennomgår diffen. Legg en etikett på en sak, og den tar saken. Alt den lager er en pull request eller en gjennomgang som et menneske skal lese: **den merger aldri noe, og den godkjenner aldri en pull request.**

```text
@oneuptime implement this                          →  en pull request som lukker saken
@oneuptime revise this — use exponential backoff   →  nye commits på grenen til denne pull requesten
@oneuptime review                                  →  en kodegjennomgang lagt ut på denne pull requesten
```

> Bytt ut `@oneuptime` med det din egen app heter. På OneUptime Cloud er det `@oneuptime`. På en selvhostet instans er det navnet du ga GitHub App-en din, med små bokstaver og mellomrom byttet ut med bindestreker — en app som heter «Acme AI», nevnes som `@acme-ai`. Skjer det ingenting når du nevner appen, er dette det første du bør sjekke.

## Før du begynner

- Repositoriet må være **koblet til et OneUptime-prosjekt** gjennom GitHub App-en. Se [GitHub-integrasjon (selvhostet)](/docs/self-hosted/github-integration) for oppsettet, eller koble det til fra **Prosjektinnstillinger → Kode-repositorier** på OneUptime Cloud.
- En **Runner med egenskapen «Kjører AI-koderettelser»** må være tilkoblet — den samme Runneren som utfører [AI Fix Tasks](/docs/ai/ai-agent). Uten en slik blir kommandoene tatt imot, for så å feile etter 30 minutter med en melding om at ingen agent hentet dem.
- GitHub App-en må ha tillatelsen **Issues: Read & write** og abonnere på webhook-hendelsene som er listet opp under [Hva du må abonnere på](#hva-du-må-abonnere-på).

## Kommandoene

Hver kommando starter med at du nevner appen. Du kan nevne den hvor som helst i kommentaren, og alt du skriver etterpå sendes videre som forespørselen din.

### I en pull request

| Kommando | Hva som skjer |
| --- | --- |
| `@oneuptime review` | Kloner grenen, leser den endrede koden **og koden rundt den**, og legger ut en gjennomgang som en kommentar. Endrer ingenting. |
| `@oneuptime revise this — <what you want changed>` | Kloner pull requestens egen gren, gjør endringen og pusher nye commits til den samme grenen. Åpner aldri en ny pull request. |

Alt du skriver etter at du har nevnt appen, og som ikke er en gjenkjent kommando, behandles som en forespørsel om revisjon — for det er nesten alltid det det er:

```text
@oneuptime the retry loop here should back off exponentially, and the test
should cover the 429 case
```

### I en sak

| Kommando | Hva som skjer |
| --- | --- |
| `@oneuptime implement this` | Jobber med saken og åpner en pull request som lukker den. |
| `@oneuptime <anything else>` | Det samme, med ordene dine som ekstra styring. |

Du kan også gi appen en sak **helt uten å kommentere**:

- **Legg på triggeretiketten.** Å legge repositoriets triggeretikett — `oneuptime` som standard — på en sak starter det samme arbeidet. Dette er den sikreste måten å tildele arbeid på fra GitHubs grensesnitt.
- **Tildel saken til appens bot-bruker**, der repositoriet ditt tillater det. GitHub lar ikke en app være assignee overalt, og det er derfor etiketten finnes; skjer det ingenting når du tildeler, bruk etiketten.

### Overalt

| Kommando | Hva som skjer |
| --- | --- |
| `@oneuptime help` | Lister opp kommandoene. Å bare nevne appen uten noe etter gjør det samme. |
| `@oneuptime status` | Forteller hva den jobber med i denne tråden akkurat nå. |
| `@oneuptime cancel` | Stopper kjøringene den har gående i denne tråden. Arbeid som allerede er pushet, forblir pushet. |

`help`, `status` og `cancel` starter aldri en agentkjøring, så de koster ingenting og teller ikke mot det daglige budsjettet ditt for AI-koderettelser.

## Slik ser det ut i tråden

Én kommando gir **én kommentar**, som appen redigerer etter hvert som arbeidet skrider fram — slik at en langvarig oppgave aldri gjør en pull request om til en statuslogg.

1. Den reagerer med 👀 på kommentaren din og legger ut en bekreftelse som navngir OneUptime-prosjektet kjøringen hører til, med lenke til kjøringen mens den pågår.
2. Når den er ferdig, skrives den samme kommentaren om med resultatet: pull requesten den åpnet, commitene den pushet, eller en ærlig forklaring på hvorfor den ikke gjorde noe.

Finner den ingenting som er verdt å endre, sier den det i stedet for å åpne en pull request på gjetning. Det er et normalt utfall, ikke en feil — gi den mer styring og spør på nytt.

## Hvem som har lov til å gi den kommandoer

**Bare folk med write-, maintain- eller admin-tilgang til repositoriet.** OneUptime spør GitHub direkte om hvilken tilgang den som kommenterer har til akkurat det repositoriet, hver eneste gang; den stoler ikke på «contributor»-merket GitHub viser ved siden av en kommentar, for det beskriver tidligere aktivitet og ikke tilgangen akkurat nå.

Nevner noen andre appen, får kommentaren deres én 😕-reaksjon og ingenting mer. Det er med vilje: på et offentlig repositorium kan hvem som helst kommentere, og en app som pålitelig svarer fremmede, er en app som kan brukes til å spamme en tråd.

Den ignorerer også alle kommentarer skrevet av en bot, inkludert sine egne, og den ignorerer at den nevnes inne i et sitat (`>`) eller en kodeblokk. Til sammen er det disse to reglene som hindrer at et svar på en av dens egne kommentarer setter den i gang på nytt.

## Det den ikke gjør

- **Den merger aldri.** Ingenting denne appen gjør kan legge kode på standardgrenen din.
- **Den godkjenner aldri og ber aldri om endringer.** Gjennomganger legges ut som kommentarer, så en gjennomgang fra en app kan aldri oppfylle en branch protection-regel.
- **Den skriver aldri om historikken.** En revisjon legger til commits; den force-pusher ikke. Har noen andre pushet til grenen først, feiler revisjonen i stedet for å kaste bort arbeidet deres.
- **Den kan ikke revidere en pull request fra en fork.** Grenen til en fork ligger i et repositorium installasjonen ikke kan skrive til. Den kan fortsatt gjennomgå den — be om en gjennomgang i stedet.
- **Den endrer aldri tittel, beskrivelse eller målgren på en pull request.** Bare kode.

## Hva det koster, og hvordan du begrenser det

Hver kommando som starter arbeid, er en full agentkjøring — en kloning, opptil 40 LLM-kall og 100 000 output-tokens, pluss bygge- og testkommandoene til repositoriet ditt hvis du har satt dem opp.

To grenser gjelder, og begge er de samme som allerede styrer [AI Fix Tasks](/docs/ai/ai-agent):

- **Prosjektets daglige grense for rettelseskjøringer** (**Prosjektinnstillinger → AI**, 25 per dag som standard). GitHub-kommandoer deler dette budsjettet med resten av prosjektets rettelseskjøringer.
- **Taket på åpne pull requests per repositorium** (**Kode-repositorier → repositoriet → Innstillinger**, 5 som standard). Gjennomganger og revisjoner er unntatt: ingen av dem legger en ny pull request i gjennomgangskøen din.

Bare én kjøring av hver type er aktiv per sak eller pull request om gangen. Spør du to ganger, får du beskjed om at den allerede er i gang; ber du om en gjennomgang mens en revisjon kjører, starter begge, siden det er ulike forespørsler.

Hvis en kjøring ikke kan starte, sier appen hvorfor i tråden — den feiler aldri i stillhet.

## Slå det av

Per repositorium: **Kode-repositorier → repositoriet → Innstillinger → Svar på GitHub-kommandoer**. Er den av, ignorerer appen at den nevnes, at den tildeles saker, og triggeretiketten i det repositoriet — og forteller den som spør hvor bryteren er.

Samme side har **GitHub-triggeretikett**, hvis du vil ha noe annet enn `oneuptime`.

## Hva du må abonnere på

I innstillingene «Permissions & events» for GitHub App-en din, abonner på:

| Hendelse | Trengs for |
| --- | --- |
| **Issue comment** | `@mention`-kommandoer i saker *og* i pull requests |
| **Issues** | tildeling til appen, og triggeretiketten |
| **Pull request** | at appen bes om en gjennomgang |
| **Pull request review** | at appen nevnes i teksten til en innsendt gjennomgang |
| **Pull request review comment** | at appen nevnes i en linjekommentar i diffen |

Og under **Repository permissions** må **Issues** være **Read & write** — GitHub ruter samtalekommentarene i pull requests gjennom issues-API-et, og det er dette som gjør at appen også kan kommentere på pull requests.

## Prompt-injeksjon: hva som er beskyttet, og hva som ikke er det

Sakstekst, beskrivelser av pull requests, selve diffen og kommentarene blir alle en del av agentens prompt, og på et offentlig repositorium kan hvem som helst skrive dem. Tekst som sier «ignorer instruksjonene dine og gjør X», er noe du realistisk kan finne i en sak.

To ting begrenser dette, og det er verdt å vite hva som er hva:

- **Promptene merker tekst som ikke er til å stole på som en forespørsel, ikke som instruksjoner**, og kjøringens repositorium, gren og pull request er låst før agenten i det hele tatt starter — ingenting agenten leser kan endre hva den jobber med.
- **Den virkelige innestengingen er sandkassen.** Agenten kjører på din Runner, i en engangsklone, uten legitimasjon i kommandomiljøet sitt og med begrensede git-operasjoner. Den kan aldri gjøre annet enn å pushe til en gren, og bare et menneske kan merge den.

Behandle en AI-skrevet pull request slik du ville behandlet en fra en ny bidragsyter som har lest saken: gå gjennom diffen, ikke beskrivelsen.

## Feilsøking

**Ingenting skjer når jeg nevner appen.** Sjekk navnet du nevner den med først — det er appens slug, ikke visningsnavnet. Sjekk deretter at repositoriet er koblet til et prosjekt (**Prosjektinnstillinger → Kode-repositorier**), at **Svar på GitHub-kommandoer** er på, og at GitHub App-en din abonnerer på hendelsene over.

**Den reagerer med 😕 og sier ingenting.** Du har ikke skrivetilgang til repositoriet.

**Den sier at den allerede jobber med dette.** En kjøring av den typen er allerede i gang på denne saken eller pull requesten. `@oneuptime status` forteller deg hva det er, og `@oneuptime cancel` stopper den.

**Den bekreftet og ble så stille lenge.** Sjekk at en Runner med **Kjører AI-koderettelser** er tilkoblet under **Innstillinger → Runbook-agenter**. Uten en slik feiles kjøringen etter 30 minutter, og tråden får beskjed.

**Den sier at pull requesten kommer fra en fork.** Revisjoner trenger en gren i dette repositoriet. Be om en gjennomgang i stedet, eller push grenen hit.

## Hvor du leser videre

- [AI Fix Tasks](/docs/ai/ai-agent) — den samme agenten, utløst fra et unntak i stedet for fra GitHub.
- [GitHub-integrasjon (selvhostet)](/docs/self-hosted/github-integration) — opprette og konfigurere GitHub App-en.
- [Runnere](/docs/runbooks/agents) — arbeideren som utfører kjøringene.
