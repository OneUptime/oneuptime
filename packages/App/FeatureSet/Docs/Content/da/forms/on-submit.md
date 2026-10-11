# Hvad en indsendelse opretter

Hver indsendelse via en formular opretter én post i dit projekt: en **hændelse** eller en **planlagt vedligeholdelsesbegivenhed**. En formulars side **Ved indsendelse** viser hvilken, og hvordan hvert felt på den nye post udfyldes — fra et svar, fra en standardværdi, fra en indstilling, der altid gælder, eller fra hændelsesskabelonen. **Rediger indstillinger** ændrer standardværdierne og det, der altid gælder.

:::cards
- [Sådan bliver en indsendelse til en hændelse](#sådan-bliver-en-indsendelse-til-en-hændelse): Hvert felt på den nye hændelse, og hvor dets værdi kommer fra.
- [Sådan bliver en indsendelse til en planlagt vedligeholdelsesbegivenhed](#sådan-bliver-en-indsendelse-til-en-planlagt-vedligeholdelsesbegivenhed): Det samme, for en anmodning om vedligeholdelse.
- [Indstillingerne Ved indsendelse](#indstillingerne-ved-indsendelse): Standardværdier, hvad der altid tilknyttes, ejere og offentliggørelse.
- [Den private note](#den-private-note): Hvem der sendte den, og de svar, intet felt indeholder.
:::

## Hvad der sker ved indsendelse

```mermaid title="Fra en indsendelse til en hændelse eller en vedligeholdelsesbegivenhed"
flowchart TB
    submit["Indsend"] --> checks["Beskyttelser og<br/>tjek af svarene"]
    checks --> fields["Hvert felt: svaret,<br/>ellers indstillingerne Ved indsendelse,<br/>ellers hændelsesskabelonen"]
    fields --> record["Hændelsen eller<br/>vedligeholdelsesbegivenheden"]
    record --> note["En privat note: hvem der sendte den,<br/>og de andre svar"]
    record --> runs["Regler, vagtpolitikker<br/>og arbejdsgange kører"]
```

En indsendelse, der ikke består et tjek, opretter intet. Se [Hvad der beskytter en formular](/docs/forms/sharing-and-security#hvad-der-beskytter-en-formular).

## Hvad hver indsendelse opretter

Kortet **Hvad hver indsendelse opretter** indeholder det valg, du traf, da du oprettede formularen:

- **Hændelse** — hver indsendelse opretter en hændelse, så dit vagthold får besked med det samme. Brug det til problemrapporter.
- **Planlagt vedligeholdelse** — hver indsendelse planlægger en vedligeholdelsesbegivenhed. Brug det til anmodninger om ændringer og vedligeholdelse.

At vælge den anden beder dig bekræfte, fordi formularen ændrer sig med den:

- Titlen, beskrivelsen, monitorerne og etiketterne forbliver knyttet: begge slags poster har dem.
- Hvert andet tilknyttet spørgsmål — en alvorlighed, et valg af statusside, et brugerdefineret felt af den gamle slags — bliver et af formularens egne spørgsmål, med samme ordlyd, hvis svar vises i den private note.
- Indstillingerne Ved indsendelse starter forfra, da en hændelses og en begivenheds indstillinger er forskellige.
- En formular, der nu opretter vedligeholdelsesbegivenheder, spørger, hvornår vedligeholdelsen starter og slutter.

Spørgsmålene gemmes med det samme, sammen med ændringen. Tjek dem på siden **Byg**.

## Sådan bliver en indsendelse til en hændelse

Kortet viser hvert felt på den nye hændelse, og hvor dets værdi kommer fra:

| Felt | Kommer fra |
| --- | --- |
| **Titel** | Svaret på spørgsmålet **Titel**. Når formularen ikke spørger om det, eller det efterlades tomt: **Standardtitel**, eller ellers formularens navn. |
| **Beskrivelse** | Svaret på spørgsmålet **Beskrivelse**. Når det ikke spørges om eller efterlades tomt, hændelsesskabelonens beskrivelse, hvis formularen har en skabelon. |
| **Alvorlighed** | Indsenderens valg, når formularen spørger om det. Ellers formularens indstilling **Alvorlighed**, eller ellers hændelsesskabelonens alvorlighed. |
| **Monitorer** | De monitorer, indsenderen valgte, sammen med dem, indstillingerne altid tilknytter. Uden nogen af delene, hændelsesskabelonens. |
| **Etiketter** | De etiketter, indsenderen valgte, sammen med dem, indstillingerne altid tilføjer. Uden nogen af delene, hændelsesskabelonens. |
| **Påvirkning startede** | Svaret på **Påvirkning startede**, når formularen spørger om det. |
| **Hændelse Skabelon** | Formularens indstilling **Hændelse Skabelon**. Den udfylder alt, hvad svarene og indstillingerne lader stå uangivet. |
| **Vagtpolitikker** | De politikker, indstillingerne nævner, kørt for hver hændelse, formularen opretter. Uden nogen, hændelsesskabelonens. |
| **Ejere** | De personer og teams, indstillingerne nævner, sammen med skabelonens ejere. De får besked om hver hændelse. |
| **Brugerdefinerede felter** | Hvert spørgsmål om et brugerdefineret felt får sit svar — medmindre feltet kopierer sin værdi fra et brugerdefineret monitorfelt, og hændelsens monitorer har en; skabelonen udfylder resten. |
| **Statussider** | Vises aldrig på statussider, og abonnenter får ikke besked, før nogen på dit team offentliggør den. |
| **Øvrige svar** | Vises i en privat note på hændelsen, med hvem der indsendte. |

> [!IMPORTANT]
> **Ingen alvorlighed, ingen hændelse.** En hændelse skal have en alvorlighed. Når formularen ikke spørger om en, og dens indstillinger ikke nævner nogen — eller den nævnte blev slettet — og dens skabelon heller ikke angiver nogen, advarer rækken **Alvorlighed** dig, og hver indsendelse afvises med "Denne formular kan ikke oprette en hændelse, fordi den ikke har nogen alvorlighed. Giv besked til det team, der delte den." Vælg en alvorlighed i **Rediger indstillinger**, eller en skabelon, der angiver en.

### Hændelsesskabelonen

Vælg en **Hændelse Skabelon** i indstillingerne, så oprettes hver hændelse, formularen opretter, ud fra den, på samme måde som serveren anvender en skabelon overalt — se [Sådan anvendes en skabelon](/docs/incidents/settings#sådan-anvendes-en-skabelon). Svarene og formularens indstillinger kommer først, og skabelonen udfylder alt andet: den indledende tilstand, beskrivelsen, alvorligheden, de berørte ressourcer, vagtpolitikkerne, ejerne, etiketterne, værdierne i brugerdefinerede felter og en ændring af monitorstatus.

> [!WARNING]
> **Pas på monitorerne.** At oprette en hændelse på en monitor via en formular påvirker monitoren præcis som at oprette en hændelse på den manuelt: den aktive overvågning af monitoren sættes på pause, indtil hændelsen er løst, og en skabelons **Skift overvågningsstatus til** ændrer monitorens status med det samme — på hver statusside, der viser monitoren, selv mens selve hændelsen er skjult. Med en formular kan alle med linket gøre dette. Tilknyt kun monitorer via en formular, når hver indsendelse skal sætte dem på pause.

### Sådan ser hændelsen ud

En hændelse, der er oprettet via en formular, er en almindelig hændelse med nogle få egne indstillinger:

- **Skjult fra statussider.** **Synlig på statussiden** er slået fra, og det samme er **Underret statussideabonnenter**. Indtil en responder offentliggør den, når intet om hændelsen en statusside eller en abonnent — bortset fra en skabelons ændring af monitorstatus, ovenfor.
- **Oprettet af ingen.** Indsenderen er ikke en OneUptime-bruger, så ingen bruger registreres som den, der oprettede hændelsen.
- **Dens ejere får besked.** De ejere, indstillingerne og skabelonen nævner, tilføjes, så snart hændelsens Slack- og Microsoft Teams-kanaler findes, og får besked — hændelsens notifikation **Hændelse oprettet** venter, til de er dens ejere, så den går til dem i stedet for til projektets ejere.
- **En privat note registrerer indsendelsen** — se [Den private note](#den-private-note).

Alt, der kører for en ny hændelse, kører også for disse: privatlivs-, ejer-, etiket-, vagt- og runbook-regler, vagtpolitikker og arbejdsgange med **On Create Incident**. Vagtregler matcher en formulars hændelser som alle andre — også på deres titel og beskrivelse, som indsenderen skrev.

:::steps
#### Læs, hvad indsenderen skrev

Titlen og beskrivelsen vises på statussider, når hændelsen er offentliggjort.

#### Offentliggør hændelsen

Slå **Synlig på statussiden** til fra hændelsens side **Indstillinger**.

#### Giv abonnenterne besked, hvis de skal vide det

Fordi hændelsen blev oprettet med **Underret statussideabonnenter** slået fra, sender det ikke notifikationen "hændelse oprettet" at offentliggøre den. For at give abonnenterne besked skal du slå en offentlig note op med **Underret statussideabonnenter** markeret — se [Slå en offentlig note op](/docs/incidents/notes-owners-and-feed#slå-en-offentlig-note-op).
:::

## Sådan bliver en indsendelse til en planlagt vedligeholdelsesbegivenhed

| Felt | Kommer fra |
| --- | --- |
| **Titel** | Svaret på spørgsmålet **Titel**. Når formularen ikke spørger om det, eller det efterlades tomt: **Standardtitel**, eller ellers formularens navn. |
| **Beskrivelse** | Svaret på spørgsmålet **Beskrivelse**. |
| **Begynder den**, **Slutter den** | Svarene på **Begynder den** og **Slutter den**, som hver vedligeholdelsesformular spørger om og kræver. Slutningen skal ligge efter starten. |
| **Monitorer** | De monitorer, indsenderen valgte, sammen med dem, indstillingerne altid tilknytter. |
| **Statussider** | De statussider, indsenderen valgte, sammen med dem, indstillingerne nævner. |
| **Etiketter** | De etiketter, indsenderen valgte, sammen med dem, indstillingerne altid tilføjer. |
| **Ejere** | De personer og teams, indstillingerne nævner. De ejer hver begivenhed, formularen planlægger. |
| **Vis på statussider** | **Nej**, medmindre indstillingerne slår det til. |
| **Underret abonnenter** | **Nej**, medmindre indstillingerne slår det til. |
| **Brugerdefinerede felter** | Hvert spørgsmål om et brugerdefineret felt får sit svar — medmindre feltet kopierer sin værdi fra et brugerdefineret monitorfelt, og begivenhedens monitorer har en. |
| **Øvrige svar** | Vises i en privat note på begivenheden, med hvem der indsendte. |

Begivenheden starter i dit projekts tilstand **Scheduled** og går videre som enhver anden: den bliver igangværende, når den starter, og slutter, når den slutter.

En indsendelse er nogens anmodning, og en anmodning gennemgås, før den offentliggøres. Så medmindre du ændrer det, holdes begivenheden væk fra sine statussider, indtil nogen på dit team viser den, og dens abonnenter får ikke besked, når den oprettes, starter eller slutter. **Vis på statussider** og **Underret abonnenter**, i indstillingernes trin **Offentliggørelse**, ændrer det for hver begivenhed, formularen planlægger — slå dem kun til, når du stoler på alle med linket.

## Indstillingerne Ved indsendelse

**Rediger indstillinger** åbner indstillingerne i trin: **Næste** går videre, og **Gem ændringer** er på sidste trin. Hvert trin er allerede udfyldt, så trinlisten ved siden af formularen åbner ethvert af dem, også det sidste: ændr en indstilling på dens trin, åbn derefter sidste trin, og gem.

| Trin | Hændelsesformular | Vedligeholdelsesformular |
| --- | --- | --- |
| **Standardværdier** | **Standardtitel**, **Alvorlighed**, **Hændelse Skabelon** | **Standardtitel** |
| **Knyt altid til** | **Monitorer**, **Etiketter**, **Vagtpolitikker** | **Monitorer**, **Statussider**, **Etiketter** |
| **Ejere** | **Ejere** | **Ejere** |
| **Offentliggørelse** | — | **Vis på statussider**, **Underret abonnenter** |

**Ejere** er én vælger for personer og teams: **Tilføj ejer** åbner én søgeliste med begge, og hvert valg vises som en chip, du kan fjerne. Alt, hvad indstillingerne nævner, skal høre til formularens projekt, og ejere skal være medlemmer af det. En post, der slettes, efter at den blev valgt, springes over, når en indsendelse oprettes, og resten gælder stadig.

## Den private note

Hver indsendelse efterlader en privat note på det, den oprettede:

> Submitted through the form **Report a Problem** by Ada Lovelace (<ada@example.com>).
>
> **Which office are you in?**\
> Berlin

Den nævner formularen og indsenderen — "Submitted anonymously through the form **Report a Problem**." når formularen ikke spurgte, hvem det er — og siger derefter, når indsendelsen startede fra en af formularens skabeloner, hvilken: "Started from the template **Application Outage**." — og viser så svarene på formularens egne spørgsmål, hvert under sit spørgsmål, i formularens rækkefølge. Svarene på tilknyttede spørgsmål er allerede på posten: dens titel, dens alvorlighed, dens brugerdefinerede felter. Da noten er privat, når den aldrig en statusside, men den slås op i postens Slack- og Microsoft Teams-kanaler som enhver anden note.

Adressen er et link, der skriver til præcis den adresse — i dashboardet, i Slack og i e-mailen til ejerne.

## Skjulte spørgsmål og skabeloner

Et [skjult spørgsmål](/docs/forms/building#skjulte-spørgsmål) besvares fra den [skabelon](/docs/forms/building#skabeloner), indsendelsen startede fra — aldrig fra anmodningen — og dets svar går præcis derhen, hvor et indtastet svar ville gå: en skjult **Beskrivelse** bliver hændelsens beskrivelse, et skjult brugerdefineret felt dets værdi, et skjult af formularens egne spørgsmål en linje i den private note. En indsendelse, der ikke startede fra nogen skabelon, lader skjulte spørgsmål være ubesvarede, og deres felter udfyldes fra indstillingerne Ved indsendelse, som for ethvert spørgsmål, der efterlades tomt. En skabelon, der slettes, mens nogen havde formularen åben, stopper ikke vedkommendes indsendelse: den oprettes, som vedkommende svarede, uden skabelonens skjulte svar.

En skabelon kan stille formularens spørgsmål [på sin egen måde](/docs/forms/building#sådan-spørger-en-skabelon-om-hvert-spørgsmål), og serveren holder indsendelsen op mod spørgsmålene, som den skabelon, den nævner, stiller dem. Et spørgsmål, skabelonen skjuler, besvares fra skabelonen, som et skjult spørgsmål, selv når formularen stiller det; et, skabelonen stiller, læses fra anmodningen, selv når formularen skjuler det; og et, skabelonen kræver, skal besvares, ellers afvises indsendelsen, og intet oprettes.

De svar, en skabelon udfyldte på siden, er indsenderens, så snart der indsendes: serveren tager de svar, anmodningen sender for de spørgsmål, siden stiller, uanset hvad skabelonen sagde.

## Tekst, en indsender skriver

En indsendelse går direkte til steder, hvor tekst kan handle af sig selv — Slack- og Microsoft Teams-kanaler, hver responders browser, ejernes e-mails — og ingen læser den først. Så før posten oprettes:

| Hvad indsenderen skriver | Hvad der gemmes |
| --- | --- |
| En omtale, som \<!channel\>, \<!here\> eller \<@U0123ABC\>, i titlen, beskrivelsen eller ethvert tekstsvar | **Omtaler giver ingen besked.** Alt, hvad Slack læser som en omtale, får et usynligt tegn efter sin åbningsparentes. Det læses ens overalt, men intet chatværktøj reagerer på det. |
| Et billede, i beskrivelsen eller et svar af typen **Formateret tekst** | **Billeder bliver til links.** Hvert billede bliver et link til samme adresse, så intet indlæses, fra hvor indsenderen valgte, før en responder klikker på det. |
| En kodeblok, hvis sprog er `mermaid`, uanset stavemåde | **Diagrammer bliver til kode.** Den gemmes som almindelig kode, så den viser sin tekst i stedet for at tegne et diagram. |
| Billedsyntaks eller en diagramblok i titlen | **Titlen er ren tekst.** De får også det usynlige tegn, så uanset hvor titlen ender — en episode, en chatbesked, en noteskabelon — indlæser den intet og tegner intet. De usynlige tegn tæller med i titlens grænse. |

Alt andet — links, resten af Markdown, valg i rullelister, tal, datoer, en afkrydset boks — gemmes, som indsenderen gav det, og indsendelsen beholder indsenderens navn og e-mail, som de blev indtastet.

## Næste trin

:::cards
- [Byg en formular](/docs/forms/building): De spørgsmål, der fylder disse felter, skjulte spørgsmål og skabeloner.
- [Hændelsesindstillinger og automatisering](/docs/incidents/settings): Hændelsesskabeloner og brugerdefinerede felter.
- [Hændelsesnoter, ejere og feed](/docs/incidents/notes-owners-and-feed): Private noter, offentlige noter og ejere.
- [Deling & sikkerhed](/docs/forms/sharing-and-security): Hvem der kan indsende, og hvor ofte.
:::
