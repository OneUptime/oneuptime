# Startside og genveje

Hjem er den første side, du ser i et projekt. Den viser med et blik, om noget har brug for dig lige nu, og fører et nyt projekt gennem den første opsætning. Denne side forklarer, hvad Hjem viser, hvordan du finder ethvert produkt, enhver side og handling i dashboardet, og de tastaturgenveje, der sparer dig for ture gennem menuerne.

:::cards
- [Hvad Hjem viser](#hvad-hjem-viser): Om noget er galt, hvad der har brug for dig, hvad projektet rummer, og alle produkter.
- [Find rundt](#find-rundt): Menuen Produkter og bjælkerne øverst på hver side.
- [Søg](#søg-efter-en-side-en-indstilling-eller-en-handling): Find enhver side, indstilling eller handling ved at skrive dens navn.
- [Tastaturgenveje](#tastaturgenveje): Gå til Hjem, Overvågninger eller Hændelser med to taster.
:::

## Hvad Hjem viser

Åbn **Hjem** i bjælken øverst, eller tryk `g` og derefter `h` hvor som helst. Hjem er oversigten over dit projekt. Fra top til bund viser den:

1. Et søgefelt med **Erklær hændelse** og **Opret** ved siden af.
2. Én linje, der siger, om noget er galt, over fem tal, der tæller det, der kræver opmærksomhed.
3. **Velkommen til OneUptime 👋**, en tjekliste til et nyt projekt, indtil den er gennemført.
4. **Kræver opmærksomhed**, hvert problem, der er åbent lige nu, ved navn.
5. **Dit projekt**, hvad projektet består af, og **Kommende vedligeholdelse**, når der er planlagt noget.
6. **Udforsk OneUptime**, alle produkter, én kategori ad gangen.

### Søg og opret

Søgefeltet åbner søgningen, ligesom `Mod` + `K`: skriv navnet på en side, monitor, hændelse, advarsel, statusside eller vagtpolitik. Se [Søg](#søg-efter-en-side-en-indstilling-eller-en-handling). **Erklær hændelse** åbner formularen, hvor du erklærer en hændelse. **Opret** tilbyder **Opret monitor**, **Planlæg vedligeholdelse** og **Opret meddelelse**. Hver af dem vises kun for dem, der må bruge den.

### Overskriften

Linjen øverst nævner det mest presserende, der er åbent, i en tilsvarende farve:

| Når | Hjem siger |
| --- | --- |
| En hændelse er åben | Hvor mange hændelser der er aktive, med rødt |
| Ingen hændelse er åben, men der er åbne advarsler, monitorer, der ikke er i drift, eller SLO'er i fare | Hvor mange problemer der kræver opmærksomhed, med ravgult |
| Intet er galt, og en vedligeholdelse er i gang | Hvor mange vedligeholdelser der er i gang |
| Monitorer kører, og intet er åbent | **Alle systemer er i drift** |
| Projektet har ingen monitorer endnu | **Der overvåges ikke noget endnu** |

Ved siden af siger Hjem, hvornår den sidst læste projektet, og **Opdater** læser det igen. Når du vender tilbage til en fane med Hjem efter et minut eller mere, opdaterer den sig selv.

Så længe intet overvåges endnu, slutter linjen med knappen **Opret din første overvågning**, som åbner formularen, der opretter en monitor. Kun personer, der har lov til at oprette monitorer, ser den.

### De fem tal

Hvert tal tæller noget, siger, om det kræver din opmærksomhed, og åbner listen bag det.

| Tal | Hvad det tæller | Når tallet er nul |
| --- | --- | --- |
| **Aktive hændelser** | Hændelser, der ikke er løst | **Alt er i orden** |
| **Aktive advarsler** | Advarsler, der ikke er løst | **Alt er i orden** |
| **Ikke-operationelle monitorer** | Monitorer, hvis status ikke er en driftsstatus. Arkiverede monitorer tæller ikke med. | **Alle i drift** |
| **Igangværende vedligeholdelse** | Planlagte vedligeholdelser, der er i gang | **Ingen i gang** |
| **SLO'er i fare** | Aktive SLO'er, der er i fare eller har brugt deres fejlbudget op | **Budgetterne er sunde** |

Et tal over nul viser **Kræver opmærksomhed**, eller **I gang** og **Budgettet bruges op** for vedligeholdelse og SLO'er. Et projekt uden monitorer ser **Ingen monitorer endnu**, og et uden SLO'er ser **Ingen SLO'er endnu**: et tomt projekt er ikke det samme som et sundt. De to åbner så listerne **Monitorer** og **SLOs**, hvor du opretter en.

### Velkomsttjeklisten

Tjeklisten fører dig gennem de fire ting, et projekt har brug for, før det er nyttigt. Hvert trin åbner den side, hvor du gør det, og krydser sig selv af, når projektet har det, trinnet beder om.

| Trin | Gennemført, når | Åbner |
| --- | --- | --- |
| **Opret din første overvågning** | Projektet har en monitor. | Formularen **Opret monitor**, eller listen **Monitorer** for den, der ikke må oprette monitorer. |
| **Udgiv en statusside** | Projektet har en statusside. | **Statussider** |
| **Inviter dit team** | Andre end dig er i projektet eller inviteret til det. | **Brugere** |
| **Opsæt en vagtpolitik** | Projektet har en vagtpolitik. | **Vagtordning** |

Under trinene viser **Sådan virker OneUptime** de fire kerneprodukter i den rækkefølge, et problem bevæger sig gennem dem: **Monitorer**, **Hændelser og advarsler**, **Vagtordning** og **Statussider**. Klik på et for at åbne det.

```mermaid title="Hvornår velkomsttjeklisten forsvinder"
flowchart TB
    open["Hjem åbner"] --> dismissed{"Lukket i denne<br/>browser?"}
    dismissed -->|"Nej"| done{"Alle fire trin<br/>gennemført?"}
    dismissed -->|"Ja"| hidden["Ingen tjekliste"]
    done -->|"Ja"| hidden
    done -->|"Nej"| shown["Tjeklisten med de<br/>resterende trin"]
```

Tjeklisten forsvinder, når alle fire trin er gennemført. Klik på **Luk** for at skjule den før. Det huskes i denne browser for dette projekt; alt, hvad trinene åbner, ligger stadig i menuen **Produkter**.

### Kræver opmærksomhed

**Kræver opmærksomhed** viser ved navn det, tallene tæller: de åbne hændelser, de åbne advarsler, de monitorer, der ikke er i drift, SLO'erne i fare og de igangværende vedligeholdelser, det mest presserende først. Hver række viser sin alvor eller status, siger, hvornår en hændelse eller advarsel begyndte, og hvornår vedligeholdelsen slutter, og åbner posten. Hver slags viser op til fem, med **Vis alle** for resten. Når intet er åbent, står der **Intet kræver din opmærksomhed**.

### Dit projekt

**Dit projekt** tæller projektets **Monitorer**, **Statussider**, **Vagtpolitikker**, **SLOs**, **Tjenester**, **Dashboards** og **Arbejdsgange**, uden de arkiverede. Hver række åbner sin liste. En slags, som projektet ikke har nogen af, viser **Konfigurer** i stedet for et tal.

**Kommende vedligeholdelse** viser de næste tre planlagte vedligeholdelsesvinduer, det tidligste først. Den udelades, når intet er planlagt.

### Udforsk OneUptime

**Udforsk OneUptime** viser produkterne i menuen **Produkter** én kategori ad gangen, begyndende med det grundlæggende. Hvert produkt siger, hvad det er til, og åbnes, når du klikker på det.

### Hjems sidemenu

Hjem har ikke selv en sidemenu: siden viser allerede alt, hvad menuen ville vise. Listerne, den åbner, deler en sidemenu, som viser hver liste med dens antal og fører tilbage til Hjem fra **Oversigt**:

| Afsnit | Sider |
| --- | --- |
| **Hjem** | **Oversigt** |
| **Hændelser** | **Aktive hændelser** og **Aktive episoder** |
| **Advarsler** | **Aktive advarsler** og **Aktive episoder** |
| **Monitorer** | **Ikke operationel** |
| **Planlagte begivenheder** | **Igangværende** |

En episode samler relaterede hændelser eller advarsler, så du arbejder med dem som én. Se [Grundbegreber](/docs/introduction/core-concepts#hændelser-og-advarsler).

## Find rundt

Alt i OneUptime ligger under **Produkter** i topbjælken. Menuen viser sine grupper som rækkerne i én liste og åbner altid med den første af dem, det grundlæggende, foldet ud: Overvågninger, Hændelser, Advarsler, Vagtordning, Statussider, Planlagt vedligeholdelse og SLOs. Hver anden gruppe (Observabilitet, AI, Kode, Ressourcer, Infrastruktur, Dashboards og automatisering og Indstillinger) er foldet sammen til en række i den samme liste. Hver række nævner gruppens produkter og siger, hvor mange der er. Klik på en række for at folde den ud eller sammen, eller gå til den med piletasterne og tryk på **Enter**.

- **Søgning finder alt.** Skriv i menuens søgefelt for at finde ethvert produkt på navn, på hvad det gør, eller på et velkendt ord som `k8s` eller `RUM`. Søgningen kigger også i de sammenfoldede grupper.
- **Du starter, hvor du er.** Gruppen for den side, du er på, folder sig selv ud, og de produkter, du har åbnet for nylig, står øverst.
- **Dine valg bliver.** Menuen husker i din browser, hvilke af de andre grupper du har foldet ud eller sammen. Det grundlæggende er foldet ud igen, hver gang du åbner menuen, også selvom du foldede det sammen.
- **På en telefon** viser menuknappen produkterne på samme måde: det grundlæggende foldet ud øverst og hver anden gruppe som én række, der åbner med et tryk.

### Bjælkerne øverst

To bjælker løber hen over toppen af hver side.

| Hvor | Hvad der er |
| --- | --- |
| Øverst til venstre | Projektvælgeren: skift til et andet af dine projekter, eller opret et nyt. |
| Øverst til højre | **Søg** og **Spørg AI**, notifikationsklokken med det, der kræver dig nu (aktive hændelser og advarsler, de vagtpolitikker, du har vagt i, ventende invitationer), **Hjælp**, og dit billede, som åbner menuen for din [konto](/docs/introduction/your-account). |
| Under dem | **Hjem** og **Produkter** til venstre, **Brugerindstillinger** til højre: hvordan OneUptime kontakter dig i dette projekt. |

**Hjælp** åbner denne dokumentation (**Dokumentation**) og listen **Keyboard shortcuts** og tilbyder support via e-mail og på Slack. På en smal skærm, som på en telefon, er **Søg**, **Spørg AI** og **Hjælp** udeladt for at spare plads; klokken og dit billede bliver.

### Sider og lister

Over hver sides titel viser et spor som *Projekt › Docker › Indstillinger › Ejerregler*, hvor siden ligger. Hvert trin før det sidste åbner sin side.

- **Lister holder sig selv opdaterede.** Når en hændelse eller advarsel oprettes, kvitteres eller løses et sted, viser listerne over hændelser, advarsler og episoder det inden for få sekunder, uden at du skal genindlæse. Mens du er midt i noget på en liste, for eksempel med rækker markeret eller en dialog åben, venter den og indhenter det, når du er færdig.
- **På en telefon foldes filterchipsene væk** bag **Filter**, så listen starter længere oppe. De chips, du har sat, bliver i syne sammen med **Ryd alt**. Tryk på **Filter** for at se alle chips, og igen for at folde dem væk.

## Søg efter en side, en indstilling eller en handling

Tryk på **Cmd+K** (Mac) eller **Ctrl+K** (Windows og Linux), eller klik på søgeikonet i topbjælken, og begynd at skrive. Søgningen finder:

- **Hver side i menuerne**, under det navn, menuen giver den: API-nøgler, Farezone, Vagtplaner, Hændelsesalvor, dine egne Notifikationsmetoder. Hvert resultat siger, hvor det ligger, for eksempel *Projektindstillinger › Avanceret*, så sider med samme navn (Brugerdefinerede felter under Hændelser, Advarsler og Monitorer) er lette at skelne.
- **Indstillingerne på en side**, under det navn, deres kort eller kontakt viser: *Kræv SSO til login* finder SSO, og *Notifikationskanaler* finder Notifikationsindstillinger. Skriv navnet på engelsk eller på dit eget sprog.
- **Handlinger**, efter hvad du vil gøre: Erklær hændelse, Opret monitor eller Delete Project, som åbner Farezone. En handling, der ændrer noget, tilbydes kun til dem, der må udføre den.
- **Dine monitorer, hændelser, advarsler, statussider og vagtpolitikker**, efter navn.

Søgningen læser det, du skriver, som du mener det:

- Store og små bogstaver, accenter, mellemrum og bindestreger er ligegyldige: *on-call*, *on call* og *oncall* finder de samme sider, og ordene kan stå i vilkårlig rækkefølge.
- Den kender andre ord for mange sider, på engelsk: *pager* eller *escalation* for Vagtpolitikker, *rota* for Vagtplaner, *2fa* for totrinsgodkendelse, *delete project* for Farezone.
- Tilføj produktets navn for at indsnævre en søgning: *incident custom fields* finder siden Brugerdefinerede felter under Hændelser.
- En lille tastefejl, som *incidnet*, finder stadig det, du mente, når intet passer præcist.

Med et tomt søgefelt viser søgningen de sider, du har åbnet for nylig, handlingerne og produkterne.

## Tastaturgenveje

Tryk på `?` hvor som helst i dashboardet for at se alle genveje, eller åbn **Hjælp** og vælg **Keyboard shortcuts**. På en Mac er `Mod` Command-tasten; på Windows og Linux er det Ctrl.

| Taster | Hvad de gør |
| --- | --- |
| `Mod` + `K` | Åbn kommandopaletten: søg efter enhver side, indstilling eller handling. |
| `Mod` + `I` | Spørg AI om det, du kigger på. |
| `/` | Søg i listen på denne side. |
| `?` | Vis tastaturgenvejene. |
| `Esc` | Luk en dialog eller et panel. |

### Gå til et produkt

Tryk på `g` og derefter et bogstav for at gå direkte til et produkt. Tryk bogstavet inden for halvanden sekund efter `g`.

| Taster | Går til |
| --- | --- |
| `g` derefter `h` | Hjem |
| `g` derefter `m` | Overvågninger |
| `g` derefter `i` | Hændelser |
| `g` derefter `a` | Advarsler |
| `g` derefter `o` | Vagtordning |
| `g` derefter `s` | Statussider |
| `g` derefter `e` | Planlagt vedligeholdelse |
| `g` derefter `d` | Dashboards |
| `g` derefter `l` | Protokoller |
| `g` derefter `t` | Spor |

Genvejene står ikke i vejen. `?`, `/` og `g` gør intet, mens du skriver i et felt, og intet navigerer væk, mens en dialog er åben, så et forkert tastetryk ikke kan koste dig en halvt udfyldt formular. Ethvert andet produkt er én søgning væk med `Mod` + `K`.

## Næste trin

:::cards
- [Hurtigstart](/docs/introduction/quickstart): Gå velkomsttjeklisten igennem, trin for trin.
- [Din konto](/docs/introduction/your-account): Din profil, sikkerheden ved dit login, sprog og tema.
- [Spørg AI](/docs/ai/ask-ai): Hvad Ask AI kan svare på og gøre for dig.
- [Grundbegreber](/docs/introduction/core-concepts): Hvad monitorer, hændelser, advarsler og vagter er.
:::
