# Microsoft Teams

Koble OneUptime til Microsoft Teams for å publisere hendelser, varsler, episoder, planlagt vedlikehold, monitorer og vaktoppdateringer i kanalene og chattene dine, gi hver hendelse sin egen kanal og la responders handle fra Teams: bekrefte, løse, legge til notater, tilkalle vakten, opprette hendelser og spørre OneUptime AI.

:::cards
- [Koble til Microsoft Teams](#koble-til-microsoft-teams): Administratorsamtykke, påloggingen din og appen i hvert team.
- [Be alle om å koble til kontoen sin](#be-alle-om-å-koble-til-kontoen-sin): Send på én gang en melding til hvert medlem som ikke har koblet til kontoen sin.
- [Varslingsregler](#varslingsregler): Bestem hvilke hendelser som publiseres hvor, og hvilke som får sin egen kanal.
- [Snakke med OneUptime-boten](#snakke-med-oneuptime-boten): Kommandoer, spørsmål og skjemaer i en chat med boten.
- [Vakt-tagger](#vakt-tagger): Hold taggen til et team lik dem som har vakt, og tilkall den.
- [Handle på hendelser, varsler og begivenheter fra Microsoft Teams](#handle-på-hendelser-varsler-og-begivenheter-fra-microsoft-teams): Knappene på kortene fra OneUptime.
:::

## Slik fungerer det

```mermaid title="Fra en begivenhet i OneUptime til et kort i Microsoft Teams"
flowchart TB
    event["En hendelse, et varsel eller en begivenhet<br/>opprettes eller endres"] --> rules{"Varslingsregler<br/>der betingelsene passer"}
    rules -->|"En kanal<br/>for hver"| own["En egen kanal<br/>i teamet du velger"]
    rules -->|"Publiser i en eksisterende<br/>kanal eller chat"| existing["Kanalene og chattene dine"]
    own --> card["Et kort med knapper"]
    existing --> card
    card -->|"En responder trykker på én"| change["Endringen gjøres i OneUptime,<br/>som den responderen"]
```

Tre ting får dette til å fungere:

- **Prosjektets tilkobling**, gjort én gang: en Microsoft 365-administrator gir samtykke til OneUptime-appen for organisasjonen din.
- **OneUptime-appen i hvert team** du vil ha varsler i. Microsoft lar bare boten publisere i et team den er lagt til i.
- **Hver persons egen tilkobling**: personens Microsoft Teams-konto koblet til personens OneUptime-konto. Knapper, kommandoer og reaksjoner handler som den personen, med personens tillatelser i prosjektet.

Én Microsoft 365-organisasjon kan være koblet til mer enn ett prosjekt, for eksempel produksjon og staging. Knappen på et kort handler i prosjektet kortet ble sendt for, for eksempel prosjektet til hendelsen kortet gjelder. En melding til boten handler i prosjektet til kanalen den sendes i, for eksempel en hendelses kanal, ellers i det ene prosjektet avsenderens Microsoft Teams-konto er koblet til i. Når ingenting viser hvilket, spør boten avsenderen hvilket prosjekt personen mener, med en knapp for hvert prosjekt personen er med i, og fortsetter der når personen har valgt. I en samtale med OneUptime AI gjelder valget for oppfølgingsspørsmålene, til det går en time uten et.

## Før du begynner

- **En rolle som kan koble til prosjektet:** **Prosjekteier**, **Prosjektadministrator** eller **Prosjektmedlem**. Å avinstallere krever **Prosjekteier** eller **Prosjektadministrator**.
- **En Microsoft 365-administrator** som gir administratorsamtykke, én gang for hele organisasjonen.
- **Growth-planen på OneUptime Cloud** for varslingsregler og sammendrag. Se [Varslingsregler under Growth-planen](#varslingsregler-under-growth-planen).
- **På en selvdriftet server,** først en Teams-bot som er satt opp for den. Se [Microsoft Teams-integrasjon](/docs/self-hosted/microsoft-teams-integration).

## Koble til Microsoft Teams

:::steps
### Gi administratorsamtykke

Gå til **Prosjektinnstillinger** > **Arbeidsområde** > **Microsoft Teams**, og klikk på **Gi administratorsamtykke**. En Microsoft 365-administrator logger på og tillater OneUptime-appen for organisasjonen. Kortet sier deretter **Admin Consent Completed**. Til et workspace er koblet til, inneholder seksjonen **Arbeidsområde** i menyene Hendelser, Varsler, Planlagt vedlikehold, Monitorer og Vakttjeneste **Koble til Slack eller Teams**, som også fører hit.

### Koble til kontoen din

Klikk på **Connect with Microsoft Teams**, og logg på med jobbkontoen din. OneUptime leser teamene i organisasjonen din; **Vis team** viser dem.

### Legg til OneUptime-appen i hvert team (påkrevd)

Å koble til kontoen din er ikke nok i seg selv. Microsoft lar bare OneUptime-boten publisere i et team den er lagt til i, så gjør dette for hvert team du vil ha varsler i:

- I Microsoft Teams klikker du på "..." ved siden av **teamnavnet** (ikke kanalnavnet).
- Velg **Manage team** > **Apps** > **More apps**, finn **OneUptime**, og klikk på **Add**.

På OneUptime Cloud åpner **Åpne Teams Store** appen i Microsoft Teams Store, der **Add to a team** gjør det samme. På en selvdriftet server installerer du i stedet pakken fra **Last ned app-manifest-zip**: bare den inneholder serverens bot. Hvis et testvarsel sier at OneUptime-appen ikke er installert i teamet, er det dette trinnet som ble hoppet over.

### Koble til alle andre

Hver person kobler til sin egen Microsoft Teams-konto under **Brukerinnstillinger** > **Arbeidsområde** > **Microsoft Teams** med **Connect my account with Microsoft Teams**, for å handle på hendelser og få direktemeldinger som seg selv. Den seksjonen vises så snart prosjektet er koblet til Microsoft Teams. For å få med et helt team på én gang, se [Be alle om å koble til kontoen sin](#be-alle-om-å-koble-til-kontoen-sin).

### Legg til en varslingsregel

Gå til **Hendelser** > **Arbeidsområde** > **Microsoft Teams**. Seksjonen **Arbeidsområde** viser bare chat-workspacene prosjektet ditt har koblet til, så **Microsoft Teams** vises der så snart det er koblet til. Opprett en regel, for eksempel en som publiserer i en Teams-kanal når en hendelse opprettes, og klikk deretter på **Testregel** i raden.
:::

> [!NOTE]
> Å installere OneUptime for deg selv, eller legge den til i en chat, er en annen installasjon og lar den ikke publisere i et teams kanaler. **Private kanaler** krever at appen er lagt til i selve kanalen: åpne kanalen > "..." > **Manage channel** > **Apps** > **Add an app**. **Delte kanaler** kan ikke motta varsler: Microsoft Teams støtter ikke boter i delte kanaler.

## Be alle om å koble til kontoen sin

Ingen kan koble til Microsoft Teams-kontoen til noen andre, heller ikke en administrator: hver person logger på med sin egen. For å få med et helt team ber en **Prosjekteier** eller **Prosjektadministrator** alle på én gang under **Prosjektinnstillinger** > **Arbeidsområde** > **Microsoft Teams**. Kortet **Members' Microsoft Teams accounts** viser hvor mange medlemmer som har koblet til kontoen sin. **Ask everyone to connect** får OneUptime-boten til å sende hvert medlem som ikke har gjort det, en melding med en knapp **Connect Microsoft Teams account** som kobler til kontoen med ett klikk.

- **Hvem som får en melding.** Hvert medlem av prosjektet som ikke har koblet til Microsoft Teams-kontoen sin, er i et team OneUptime-appen er lagt til i, og som OneUptime finner der ut fra e-postadressen eller brukerhovednavnet (UPN) til vedkommende. Den som er blitt bedt om det de siste 24 timene, blir ikke bedt igjen, så ber du igjen dagen etter, får bare de som fortsatt ikke har koblet til kontoen sin, en påminnelse.
- **Hva kortet sier.** Hvor langt utsendingen har kommet mens meldingene går ut, og deretter hvem som ba om det, og hvor mange medlemmer som fikk en melding. Medlemmer OneUptime ikke fant, nevnes ved navn på kortet: legg appen til i teamet deres, eller la dem koble til kontoen sin selv under **Brukerinnstillinger** > **Arbeidsområde** > **Microsoft Teams**.
- **Hva knappen kobler til.** Microsoft Teams-kontoen til den som trykker på knappen og logger på, til vedkommendes egen OneUptime-konto. En melding som sendes videre til noen andre, kobler ingenting til medlemmet den ble sendt til.

## Varslingsregler

En varslingsregel sier hvilke hendelser som publiseres i Microsoft Teams, og hvor. Hvert produkt har sine egne regler, under **Arbeidsområde** > **Microsoft Teams** i sin meny:

| Produkt | Faner på produktets **Microsoft Teams**-side |
| --- | --- |
| **Hendelser** | **Hendelser**, **Hendelse Episoder**, **Sammendrag** |
| **Varsler** | **Varsler**, **Varsel Episoder**, **Sammendrag** |
| **Planlagt vedlikehold** | Én liste med regler |
| **Monitorer** | Én liste med regler |
| **Vakttjeneste** | Én liste med regler |

Å opprette en regel går gjennom fire trinn:

| Trinn | Hva du angir |
| --- | --- |
| **Grunnleggende** | **Regelnavn** og **Regelbeskrivelse**. |
| **Betingelser** | Hvilke hendelser regelen gjelder for, for eksempel etter alvorlighetsgrad, tilstand, etikett, monitor eller ord i tittelen. De kontrolleres når en hendelse opprettes, og på nytt ved hver oppdatering OneUptime publiserer om den, så en regel for bekreftede hendelser virker når en hendelse bekreftes. En ny regel gjelder for hver hendelse, for eksempel **Alle hendelser**. For å snevre den inn velger du **Bare hendelser som oppfyller betingelsene** og legger til betingelsene. Med to eller flere sier **Samsvarsbetingelse** om alle må passe, eller om én er nok. |
| **Mål** | Hvor den publiserer: en eksisterende kanal i et team du velger, chattene du velger, en kanal for hver hendelse (eller varsel, episode, planlagt vedlikehold, monitor eller vaktretningslinje) som opprettes i et team du velger, eller flere av disse sammen. Under steget sier **Hva denne regelen gjør** det i setninger, som regelens kort. |
| **Video Call** | Bare hendelser og varsler: start en samtale for hver. Se [Videosamtaler](/docs/workspace-connections/video-calls). |

En kanal som regelen oppretter, får navn etter posten sin: hendelse INC-42 får `inc-42`, varsel ALT-7 får `alt-7`, og i et prosjekt uten nummerprefikser får hendelse 42 `incident-42`. Tekst i **Prefiks for kanalnavn** settes foran, så `prod-` gir `prod-inc-42`, og skjemaet viser navnet mens du skriver. For en planlagt vedlikeholdshendelse tar prefikset plassen til nummerprefikset: SM-5 får `sm-5`, og `maint-` gir `maint-5`. OneUptime beholder bokstaver, tall, mellomrom, `-` og `_`, opptil de 50 tegnene Microsoft Teams tar imot. Har teamet allerede en kanal med det navnet, for eksempel et annet prosjekts eller en som ble slettet de siste 30 dagene, legger OneUptime til `-2`, `-3` og så videre.

En regel oppretter kanalen sin første gang en hendelse samsvarer med den: når hendelsen opprettes, eller senere, når en oppdatering får den til å samsvare mens den fortsatt er åpen. En regel for bekreftede hendelser oppretter kanalen når hendelsen bekreftes. Microsoft Teams viser kanalene i et team til alle i teamet, så OneUptime legger ikke til noen i en kanal én etter én: alle i teamet du velger kan åpne den, slik regelskjemaet sier under **Hvem som blir med i kanalen**. En privat hendelse, et privat varsel eller en privat episode får en privat kanal, som bare medlemmene ser; legg til folk i Microsoft Teams.

For å få med dem som har vakt, velger du vaktplanene deres under **Nevn dem som har vakt**. Når kanalen opprettes, publiserer OneUptime en melding i den rett etter postens første melding. Meldingen @nevner dem som har vakt i disse vaktplanene, slik at Microsoft Teams varsler dem. Ingen tilkalles. OneUptime finner hver person i teamet ut fra Microsoft Teams-kontoen vedkommende har koblet til OneUptime, eller ellers ut fra vedkommendes e-postadresse. Den som ikke er i teamet, kan ikke åpne kanalene i det, så i stedet står vedkommendes navn i meldingen sammen med årsaken. En privat kanal kan bare åpnes av medlemmene, så legg til de vakthavende i kanalen i Microsoft Teams.

Hver senere oppdatering av posten — en tilstandsendring, et notat, en ny eier — publiseres i kanalene dens, og i de eksisterende kanalene og chattene reglene dens nevner så lenge betingelsene deres stemmer. OneUptime kan ikke arkivere en Microsoft Teams-kanal, så kanalen til en regel blir værende når posten er over; arkiver eller slett den i Microsoft Teams.

En hendelse, et varsel, en episode eller en planlagt vedlikeholdshendelse med sin egen kanal har **Åpne i Microsoft Teams** øverst på siden sin i OneUptime, ved siden av tilstandsknappene. Den åpner kanalen i en ny fane, i Microsoft Teams-appen eller i nettleseren. En post med to egne kanaler viser begge under knappen. En post med kanaler i både Slack og Microsoft Teams har i stedet én knapp, **Åpne kanal**, som viser alle. De eksisterende kanalene og chattene reglene dine publiserer i, tilbys ikke.

Siden til posten har også kortet **Microsoft Teams-kanal**, som sier hvem som kan åpne kanalen: alle i teamet, eller for en privat kanal medlemmene, som eierne legger til i Microsoft Teams. OneUptime endrer ikke hvem som er i en Microsoft Teams-kanal. For en Slack-kanal viser kortet hvem som er i den, og legger til personer: se [Hvem som er i kanalen til en post](/docs/workspace-connections/slack#hvem-som-er-i-kanalen-til-en-post).

Kanaler og chatter holder seg lesbare: hver begivenhet publiseres én gang, og postens første tilstand står i kortet som kunngjør posten, ikke i et eget kort. En kjøring av en vaktretningslinje er ett kort som redigeres etter hvert som kjøringen eskalerer: hvem som ble tilkalt, hvor ofte og hvordan, hvem som ikke ble det og hvorfor, og hvem som bekreftet. Et nytt kort publiseres bare når noen må handle: en eskaleringsregel nådde ingen, eller kjøringen endte uten at noen bekreftet. At postens eiere eller statussidens abonnenter fikk beskjed, står i feeden dens i OneUptime.

**Prosjektinnstillinger** > **Arbeidsområde** > **Microsoft Teams** viser kanalene OneUptime ser i teamene dine, og chattene den er lagt til i, med **Send test** ved siden av hver. En chat vises så snart OneUptime-appen er lagt til i den i Microsoft Teams; **Refresh Chats** henter nye chatter og de nåværende navnene deres.

## Teste en regel

**Testregel** i en regels rad publiserer en testmelding for den regelen i kanalene den nevner, så du ser at den kommer frem. Hvis regelen oppretter en kanal for hver hendelse, oppretter testen også en og inviterer regelens folk inn i den.

I likhet med **Send test** ved siden av en kanal i **Prosjektinnstillinger** > **Arbeidsområde** > **Microsoft Teams** krever den tillatelse til å opprette varslingsregler: **Prosjekteier**, **Prosjektadministrator**, **Prosjektmedlem**, **Innstillingsadministrator**, **Innstillingsmedlem**, eller **Create Workspace Notification Rule** og **Read Workspace Notification Rule** i en egendefinert rolle. For en som bare kan se reglene, som en **Leser**, er **Testregel** låst, og verktøytipset sier hva som kreves; API-et avviser testen med "You do not have permission to send test notifications in this project." På OneUptime Cloud krever det **Growth**-planen å teste en regel, på samme måte som å legge til en.

På OneUptime Cloud krever **Send test** ved siden av en kanal eller en chat også **Growth**-planen, siden det å publisere i en kanal er det regler og sammendrag gjør. **Send test nå** på et sammendrag krever tillatelse til å opprette sammendrag (**Create Workspace Notification Summary** og **Read Workspace Notification Summary** i en egendefinert rolle) og, på OneUptime Cloud, **Growth**-planen; for alle andre er den låst, og verktøytipset sier hva som kreves. En MCP-klient som er koblet til med skrivebeskyttet tilgang, kan ikke sende noen test.

## Sammendrag

Fanen **Sammendrag** i **Hendelser** > **Arbeidsområde** > **Microsoft Teams** (og i **Varsler**) publiserer et gjentakende sammendrag i kanalene du nevner: hvor mange hendelser eller varsler det var, hvor raskt de ble bekreftet og løst, og en liste med lenker. Et nytt sammendrag sendes hver uke og dekker de siste 7 dagene. La **Send første rapport kl.** stå tomt, så sendes det første kl. 09:00 i starten av neste uke, dag eller måned; skjemaet sier når.

Et sammendrag sendes etter klokken i sin **Tidssone**, som starter med din. Det holder klokkeslettet sitt der hele året: et som er satt til 09:00 i Berlin, sendes fortsatt kl. 09:00 i Berlin etter overgangen til sommertid, og datoene i meldingen er også Berlins. Via API-et sender du `timezone` som et IANA-tidssonenavn, som `Europe/Berlin`. Et sammendrag som opprettes uten tidssone, tar tidssonen fra profilen til den som opprettet det, eller UTC når en API-nøkkel oppretter det.

Skjemaet for et sammendrag har fire trinn: **Grunnleggende informasjon** (navnet, kanalene og deres **Teamnavn**), **Tidsplan**, **Innhold** (**Hva som skal inkluderes**) og **Filtre** (hvilke hendelser eller varsler det teller).

## Varslingsregler under Growth-planen

På OneUptime Cloud hører varslingsregler og sammendrag til **Growth**-planen og høyere. Et prosjekt under den beholder reglene og sammendragene det allerede har, og de fortsetter å publisere i Microsoft Teams. Derfor viser hvert produkts **Microsoft Teams**-side (Hendelser, Varsler, Planlagt vedlikehold, Vakttjeneste, Monitorer) planmerknaden med dem under (**Varslingsregler som fortsatt er satt opp**, **Sammendrag som fortsatt er satt opp**): slett en regel, eller slå av eller slett et sammendrag. Å legge til eller endre regler og sammendrag krever **Growth**.

## Bli tilkalt i Microsoft Teams

For å bli tilkalt med direktemelding når du har vakt, legger du til Microsoft Teams som en av varselmetodene dine:

:::steps
1. Koble til din egen Microsoft Teams-konto (se [Koble til Microsoft Teams](#koble-til-microsoft-teams)).
2. Gå til **Brukerinnstillinger** > **Varselmetoder**, åpne fanen **Workspace Apps**, og klikk på **Add Microsoft Teams Account**.
3. Klikk på **Send Test Message** i raden. Meldingen kommer i chattene dine i Microsoft Teams.
:::

Å legge den til setter den straks inn i vaktreglene dine, så tilkallinger når deg i Microsoft Teams fra da av. Endre hvilke tilkallinger den får, under **Brukerinnstillinger** > **Vaktregler**.

## Lagre meldinger som notater

Reager på en melding, eller et svar, i kanalen OneUptime opprettet for en hendelse, et varsel, en episode eller en planlagt vedlikeholdsbegivenhet, så lagrer OneUptime den som et notat på den posten. Den fanger opp reaksjonen innen ett minutt og bekrefter med et svar i tråden:

| Reaksjon | Lagret som |
| --- | --- |
| 📌 eller 📍 | Et privat notat, som bare teamet ditt ser |
| 📣 eller 📢 | Et offentlig notat, vist på statussiden. Bare hendelser og planlagte vedlikeholdsbegivenheter. På en privat hendelse et privat notat, og bekreftelsen sier hvorfor. |

Notatet beholder meldingen slik Microsoft Teams viste den: formateringen, lenkene og koden, personene den nevner, ved navn, og filene og bildene som lenker til dem. Et offentlig notat utelater filene og bildene, siden de bare åpnes for teamet ditt.

Det er ordene til den som skrev meldingen: OneUptime-navnet deres når Microsoft Teams-kontoen deres er koblet til, ellers navnet Teams viser. Et privat notat plasseres på tidslinjen der meldingen ble lagt ut, uansett hvor lenge etterpå det lagres. Et offentlig notat plasseres når det lagres, altså når statussiden viser det. Tidslinjen sier hvem som lagret det. Notatet legges ikke ut igjen i kanalen, der meldingen allerede står.

Notatet lagres som deg, med dine tillatelser, og OneUptime-appen må være i teamet. Hvis Microsoft Teams-kontoen din ikke er koblet til ennå, ber OneUptime deg koble den til, i et svar som nevner deg, med en knapp som lagrer meldingen så snart du har gjort det.

## Snakke med OneUptime-boten

Send boten en melding i en personlig chat, eller nevn OneUptime med @ i en kanal eller en gruppechat: der svarer den bare når den nevnes.

| Melding | Hva boten gjør |
| --- | --- |
| `help` | Viser hva den kan gjøre. |
| `incident [title or number]` | Åpner hendelsesskjemaet med tittelen fylt ut. Nummeret til en hendelse, som `42` eller `INC-42`, viser i stedet den hendelsen: se [Håndter en hendelse fra Microsoft Teams](#håndter-en-hendelse-fra-microsoft-teams). |
| `maintenance [title]` | Åpner skjemaet for planlagt vedlikehold med tittelen fylt ut. |
| `oncall` | Viser hvem som har vakt akkurat nå i hver vaktplan du kan se, til når, og hvem som er neste. |
| `page [who] [message]` | Tilkaller personene du nevner med @, om meldingen din, eller sender et kort der du velger hvem som skal tilkalles. Se [Tilkall noen fra Microsoft Teams](#tilkall-noen-fra-microsoft-teams). |
| `ask [question]`, eller et hvilket som helst spørsmål på vanlig språk | OneUptime AI svarer om logger, traces, målinger, hendelser og monitorer, for eksempel "hvilke monitorer er nede akkurat nå?". Svar leser bare. |
| `show active incidents`, `show active alerts` | Viser det som er åpent nå. |
| `show scheduled maintenance`, `show ongoing maintenance` | Viser kommende, eller pågående, vedlikeholdsbegivenheter. |

Bortsett fra `show`-listene er dette ordene som følger etter `/oneuptime` i Slack; `create incident` og `create maintenance` virker fortsatt også. Å spørre OneUptime AI krever at din egen Microsoft Teams-konto er koblet til, og at AI er slått på for prosjektet. Hvis kontoen din ikke er koblet til, ber boten deg én gang i hver tråd eller chat om å koble den til, med en knapp **Connect Microsoft Teams account**. Se [Spør AI](/docs/ai/ask-ai).

## Startsiden din i Microsoft Teams

Skriv `home` til OneUptime-boten, så svarer den med startsiden din: et kort med det som skjer i prosjektet, slik du har lov til å se det.

- **Vakten din.** Vaktplanene du har vakt i nå, og til når, eller ellers neste vakt.
- **Det som er åpent.** De nyeste åpne hendelsene og varslene du har lov til å lese, hver med en lenke til siden sin i OneUptime.
- **Knappene.** **Declare incident** og **Page someone** svarer som `incident` og `page`, **Who's on call** som `oncall`, og **Refresh** leser kortet på nytt, på samme sted.

Når du legger til OneUptime-appen for deg selv, sender boten deg startsiden din med en gang. Startsiden og `show`-listene leser som deg, så de trenger din egen tilkoblede Microsoft Teams-konto: til den er koblet til, svarer boten med knappen **Connect Microsoft Teams account**. **Åpne OneUptime i Microsoft Teams** under **Brukerinnstillinger** > **Arbeidsområde** > **Microsoft Teams** åpner appen i Teams.

Når appen legges til i et team, sier boten hei der: hvordan man stiller den et spørsmål, og hvor man legger til en varslingsregel som publiserer i kanalene til teamet.

## Opprett hendelser og vedlikehold fra Microsoft Teams

Å skrive `incident` eller `maintenance` til OneUptime-boten åpner et skjema for personen som skrev det, i en personlig chat, en kanal eller en gruppechat. Det fylles ut som den personen: som OneUptime-kontoen personens Microsoft Teams-konto er koblet til (se [Koble til Microsoft Teams](#koble-til-microsoft-teams)), med den kontoens tillatelser i prosjektet. Den som ikke har kontoen koblet til, eller som har en OneUptime-konto som ikke lenger er medlem av prosjektet, får beskjed om hva som må gjøres i et svar som nevner personen, i stedet for skjemaet.

- **Hvem som kan bruke dem.** De som kan opprette en hendelse eller en planlagt vedlikeholdsbegivenhet i OneUptime: **Prosjekteier**, **Prosjektadministrator**, **Prosjektmedlem**, **Hendelsesadministrator** og **Hendelsesmedlem** for en hendelse (**Create Incident** i en egendefinert rolle), og **Vedlikeholdsadministrator** og **Vedlikeholdsmedlem** for en begivenhet (**Create Scheduled Maintenance**). Alle andre får beskjed om det, og får ikke noe skjema.
- **Hva et skjema tilbyr.** Hver liste — alvorlighetsgrader, monitorer, monitorstatuser, vaktpolicyer og etiketter — inneholder det personen som ba om det, kan lese, slik som den samme listen i OneUptime, og kortets "not shown"-merknader teller bare disse: med en rolle som er begrenset til noen etiketter, monitorene og vaktpolicyene som har de etikettene. En liste personen ikke kan lese i det hele tatt, utelates. Arkiverte vaktpolicyer tilbys aldri.
- **Hva et skjema kan nevne.** I en kanal eller en gruppechat kan alle som er der sende inn skjemaet, og det sendes inn som den som gjør det, med vedkommendes egne tillatelser. Hendelsen eller begivenheten opprettes med de tillatelsene og krediteres den personen. En monitor, vaktpolicy, etikett, alvorlighetsgrad eller status personen ikke kan lese, eller en fra et annet prosjekt, avvises som en prosjektet ikke har, og ingenting opprettes: boten svarer "One of the values you picked ... is not available in this project any more. Please pick it again."

**Execute On-Call Policy** på en hendelse, et varsel eller en episode fungerer på samme måte: den krever tillatelse til å kjøre en vaktpolicy (**Prosjekteier**, **Prosjektadministrator**, **Prosjektmedlem**, **Vaktadministrator** og **Vaktmedlem**, eller **Create On-Call Duty Policy Execution Log** i en egendefinert rolle) og til å lese den hendelsen, det varselet eller den episoden, og den tilbyr de aktive vaktpolicyene personen kan lese. Å se en monitor eller en vaktpolicy fra et kort leser den også som personen som trykket på knappen.

## Tilkall noen fra Microsoft Teams

I en kanal eller en gruppechat tilkaller `@OneUptime page @Nawaz Dhandala The checkout API is throwing 500s` Nawaz med en gang. OneUptime oppretter et varsel med meldingen din som tittel, og hver person du nevner med @, får en telefonsamtale, en SMS, en pushvarsling eller en e-post, slik vedkommendes egne vaktregler sier, til noen bekrefter varselet.

- **Hvem som tilkalles med en gang.** Personene du nevner med @, og dem som har vakt i vaktplanene en tagg du nevner med @, følger (se [Vakt-tagger](#vakt-tagger)), når en melding følger etter dem. OneUptime kjenner igjen en person på OneUptime-kontoen vedkommendes Microsoft Teams-konto er koblet til, eller ellers på vedkommendes e-postadresse i Microsoft Teams. Ingen utenfor prosjektet tilkalles.
- **Alt annet gir et kort.** Uten noen nevnt med @, som i en personlig chat med boten, uten melding, med en tagg som ikke følger noen vaktplan du kan se, eller med en person OneUptime ikke kjenner igjen, svarer boten med kortet **Page someone**, med det du skrev ferdig utfylt, og sier hvem den ikke kunne velge. Velg personer, et team, en vaktplan, som tilkaller den som har vakt i den nå, eller en vaktpolicy, som tilkaller gjennom eskaleringsreglene sine, og send det inn. Alle i samtalen kan sende inn kortet, som seg selv. Når det har tilkalt, fjernes kortet, så ingen tilkaller med det to ganger.
- **Hvor det vises.** Samtalen viser tilkallingen som ett kort som holdes oppdatert: hvem som ble tilkalt og hvordan, og hvem som bekreftet. Der boten ikke kan poste det, sier svaret dens hvem som ble tilkalt, med en lenke til varselet.
- **Hvem som kan tilkalle.** Alle som både kan kjøre en vaktpolicy og opprette et varsel: **Prosjekteier**, **Prosjektadministrator** og **Prosjektmedlem**, eller **Vaktmedlem** sammen med **Varselmedlem** (**Create On-Call Duty Policy Execution Log** og **Create Alert** i en egendefinert rolle). Å tilkalle personer, et team eller en vaktplan direkte, uten en vaktpolicy bak tilkallingen, krever også tilgang til alle vaktpolicyene i prosjektet. Alle andre får beskjed om det i et svar, og ingen tilkalles. På OneUptime Cloud krever tilkalling Growth-planen: under den sier OneUptime hvilken plan som kreves, og ingen tilkalles.

## Vakt-tagger

Hold en tagg i Microsoft Teams, for eksempel `@Payments on-call`, lik dem som har vakt i én eller flere vaktplaner, slik at alle i teamet kan nevne den med @ for å nå dem. OneUptime endrer medlemmene i taggen ved hver overlevering og hver overstyring, og sjekker den hvert 15. minutt.

:::steps
### Koble en tagg til en vaktplan

Åpne vaktplanen under **Vakttjeneste** > **Vaktplaner**. Klikk **Koble til tagg** i kortet **Tagger i Microsoft Teams**, velg teamet, og gi taggen et navn: teamets tagg med det navnet, eller en ny som OneUptime oppretter. Medlemmene byttes straks ut med dem som har vakt.

### Koble den også til den sekundære vaktplanen

For en tagg med både primær og sekundær vakt kobler du den samme taggen til på siden til den sekundære vaktplanen. En tagg kan følge så mange vaktplaner du vil.
:::

- **Hva kortet viser.** Hvem som er i hver tagg nå, teamet, de andre vaktplanene den følger, og om den er **Oppdatert**. En tagg inneholder bare personer fra sitt eget team: en som har vakt, men ikke er i teamet, nevnes med årsaken.
- **Ingen har vakt.** OneUptime tar alle ut av taggen til noen har vakt. En ny tagg trenger noen fra teamet som har vakt, siden Microsoft Teams ikke oppretter tagger uten medlemmer.
- **Tilkall taggen.** `@OneUptime page @Payments on-call The checkout API is down` tilkaller dem som har vakt i vaktplanene taggen følger. Se [Tilkall noen fra Microsoft Teams](#tilkall-noen-fra-microsoft-teams).
- **Hva Microsoft 365 krever.** Å endre tagger krever appens tillatelse `TeamworkTag.ReadWrite.All`, som en Microsoft 365-administrator gir med **Gi administratorsamtykke** under **Prosjektinnstillinger** > **Arbeidsområde** > **Microsoft Teams**. Hvis organisasjonen din ga samtykke før OneUptime kunne holde tagger oppdatert, gir du det igjen én gang.
- **Hvem som kan koble til en.** Rollene som kan redigere vaktplaner: **Prosjekteier**, **Prosjektadministrator**, **Prosjektmedlem**, **Vaktadministrator** og **Vaktmedlem**, eller **Edit On-Call Duty Policy Schedule** i en egendefinert rolle. På OneUptime Cloud krever det abonnementet **Growth** å koble til en.
- **Koble fra.** OneUptime slutter å endre taggen. Taggen og medlemmene blir værende i Microsoft Teams som de er.

## Håndter en hendelse fra Microsoft Teams

Kortet til en hendelse har fire knapper, **Acknowledge Incident**, **Resolve Incident**, **Add Note** og **View Incident**, og resten i menyen, knappen med tre prikker:

| Menypunkt | Hva det gjør |
| --- | --- |
| **Change Severity** | Setter alvorlighetsgraden til hendelsen. |
| **Change Incident State** | Flytter hendelsen til en senere tilstand. |
| **Assign Role** | Gir noen en rolle i hendelsen, som **Incident Commander**. En rolle for én person går over til vedkommende. |
| **Page Someone** | Tilkaller personer, et team, den som har vakt i en vaktplan nå, eller en vaktpolicy om hendelsen, til noen bekrefter den. |
| **Edit Custom Fields** | Setter de egendefinerte feltene til hendelsen, hvert fylt ut med det hendelsen har. Et felt som står tomt, tømmes. |

`incident 42`, skrevet til boten, svarer med hendelse 42, disse knappene og menyen. Skriv nummeret slik OneUptime viser det: `42`, `#42` eller `INC-42`. I den egne kanalen til en hendelse viser `incident` alene den hendelsen.

- **Hvem som kan bruke dem.** De som kan gjøre den samme endringen i OneUptime, som i Slack: se [Håndter en hendelse fra Slack](/docs/workspace-connections/slack#håndter-en-hendelse-fra-slack). Hvert punkt svarer med et kort, fylt ut slik personen som trykket på det kan se hendelsen. Alle i samtalen kan sende inn kortet, som seg selv, med sine egne tillatelser.
- **Hva som skjer.** Endringen gjøres som personen som sendte inn kortet, som i OneUptime, og feeden til hendelsen sier hva som endret seg. Boten sier det i et svar som nevner personen, og fjerner kortet, så ingen sender det inn to ganger. **Page Someone** sier hvem som ble tilkalt, eller hvorfor ingen ble det; en hendelse som allerede er løst, tilkaller ingen.
- **Der Microsoft Teams er annerledes.** Et kort kan ikke si under et felt hva som er galt: en verdi som ikke passer, nevnes i et svar, og kortet blir stående for å rettes og sendes inn på nytt. Et felt med dato og klokkeslett er en dag og et klokkeslett, i din egen tidssone. En eldre Teams-klient viser menyen som flere knapper. `incident 42` svarer i samtalen, der alle i den kan se hendelsen.
- **Kort fra før menyen.** De beholder knappen **Execute On-Call Policy**, og den virker fortsatt: **Page Someone** tilkaller også en vaktpolicy. Varsler og episoder beholder sine.

## Handle på hendelser, varsler og begivenheter fra Microsoft Teams

Knappene på OneUptimes kort handler som personen som trykker på dem, i en personlig chat, en kanal eller en gruppechat: som OneUptime-kontoen personens Microsoft Teams-konto er koblet til, med den kontoens tillatelser i prosjektet. **Acknowledge**, **Resolve**, **Change State**, **Add Note** og **Execute On-Call Policy** på en hendelse, et varsel eller en episode, og **Mark as Ongoing**, **Mark as Complete**, **Change State** og **Add Note** på en planlagt vedlikeholdsbegivenhet, gjør hver den endringen som samme handling gjør i OneUptime, og den krediteres den personen der: postens tilstandstidslinje og feed viser hvem som endret tilstanden, og notatet er personens. Et notat som lagres fra en melding med en reaksjon, publiseres på samme måte.

- **Hvem som kan bruke dem.** De som kan gjøre den samme endringen i OneUptime. Å bekrefte, løse eller endre tilstanden til en hendelse krever tillatelse til å endre tilstanden: **Prosjekteier**, **Prosjektadministrator**, **Prosjektmedlem**, **Hendelsesadministrator** og **Hendelsesmedlem**, eller **Create Incident State Timeline** i en egendefinert rolle. Et varsel, en episode eller en planlagt vedlikeholdsbegivenhet krever den samme tillatelsen for sin egen type (**Create Alert State Timeline**, for eksempel), og et notat krever tillatelse til å publisere den typen notat. I likhet med tilstandspanelet i OneUptime ber de ikke om tillatelse til å redigere selve hendelsen eller varselet. Alle andre får beskjed om det, og ingenting endres.
- **Hvilke poster.** De personen kan lese, som i OneUptime: med en rolle som er begrenset til noen etiketter, hendelsene, varslene, episodene og begivenhetene som har dem. En knapp på en hvilken som helst annen post sier hvorfor, og ingenting endres: på en hendelse personens rolle ikke når, "your access in this project does not include this incident. Ask a project admin for access to it."; på en privat hendelse personen ikke er eier av, "this incident is private, so only its owners and the project's owners and admins can see it. Ask one of them to add you as an owner."; og på en som er slettet siden, "the incident was not found. It may have been deleted." På OneUptime Cloud avvises en endring som prosjektets plan ikke omfatter, med planen den krever.
- **Hva Change State tilbyr.** Tilstandene personen kan lese som posten kan gå videre til, i prosjektets rekkefølge: ingen før tilstanden den er i, for en episode som for en hendelse, et varsel eller en planlagt vedlikeholdsbegivenhet, siden en tilstandsendring aldri flytter en post opp igjen i listen (se [Rekkefølgen er en reell begrensning, ikke en visningspreferanse](/docs/incidents/states-and-severities#rekkefølgen-er-en-reell-begrensning-ikke-en-visningspreferanse)). Når personen ikke kan lese noen, sier boten "No incident states are available to you in this project. Ask a project admin for access to them."; når posten er i den siste tilstanden den kan nå, sier den "There is no later state to move this incident to." Ingen av dem viser et tomt kort.
- **Add Note på en privat hendelse.** En privat hendelse tar ingen offentlige notater, så kortet spør ikke om notattype og legger til et privat notat. Et kort som ble sendt før den ble gjort privat, legger også til et privat notat, og sier det. Se [Private hendelser tar bare private notater](/docs/incidents/notes-owners-and-feed#private-hendelser-tar-bare-private-notater).
- **Escalate.** Et korts **Escalate** kjører vaktpolicyen for hendelsen, varselet eller episoden kortet gjelder, som personen som trykket på den, med de samme tillatelsene som **Execute On-Call Policy**. Et kort som ikke gjelder noen av dem, får til svar "This on-call policy can only be executed for an incident, an alert or an episode. Open the record you are paging about and use Execute On-Call Policy there.", og ingen tilkalles.
- **Hvor personen får svar.** I et svar i den samme samtalen, kortets tråd i en kanal, som nevner personen, så Microsoft Teams varsler dem. En knapp som trykkes for sent, sier hvem som kom først, og når, for eksempel "Incident INC-2 was already acknowledged by Simon Lee at 6:07 PM."
- **Hvis kontoen til personen ikke er koblet til.** Svaret ber personen koble den til, med en knapp **Connect Microsoft Teams account**. Knappen åpner personens egne Microsoft Teams-innstillinger i OneUptime og kobler til kontoen i ett trinn, etter innlogging i OneUptime om nødvendig. Deretter fullfører OneUptime det personen trykket på, som personen, og svarer i den samme samtalen; for en knapp som åpner et skjema, eller en kommando, ber det personen trykke på den eller skrive den igjen. Knappen virker én gang, i 30 minutter, og bare for Microsoft-kontoen som trykket på den.

## Koble fra

- **Koble fra** kobler bare fra din egen Microsoft Teams-konto, og fjerner samtidig Microsoft Teams-varselmetoden din.
- **Uninstall OneUptime from Microsoft Teams**, på **Prosjektinnstillinger** > **Arbeidsområde** > **Microsoft Teams**, kobler fra prosjektet. OneUptime slutter å publisere i Microsoft Teams, og menyene **Arbeidsområde** slutter å vise det. Varslingsreglene og sammendragene beholdes til du kobler til igjen.

> [!WARNING]
> Å avinstallere kobler også fra hvert medlems egen Microsoft Teams-konto i prosjektet, og fjerner Microsoft Teams-varselmetodene og vaktreglene som brukte dem. Et prosjekt er koblet til én Microsoft 365-organisasjon: for å flytte det til en annen må du avinstallere først.

## Feilsøking

:::details En test sier at OneUptime-appen ikke er installert i teamet
Microsoft avviste publiseringen fordi boten ikke er i det teamet. Legg appen til i teamet (se [Koble til Microsoft Teams](#koble-til-microsoft-teams)) eller, for en privat kanal, i selve kanalen. Å legge den til i ett team gjør ingenting for de andre.
:::

:::details Microsoft Teams ble ikke koblet til
Når Microsoft sender deg tilbake uten en tilkobling, sier siden du startet fra **Microsoft Teams ble ikke koblet til**, og én setning sier hvorfor: du mangler tillatelsen, lenken var brukt eller utløpt, du logget på en annen Microsoft 365-organisasjon, eller organisasjonen din har ingen team ennå. Se [Tilkoblingen ble ikke fullført](/docs/self-hosted/microsoft-teams-integration#tilkoblingen-ble-ikke-fullført) for hver setning og hva du skal gjøre.
:::

:::details Boten sier at kontoen min ikke er koblet til
Trykk på **Connect Microsoft Teams account** i svaret fra boten for å koble den til i ett trinn, eller koble den til under **Brukerinnstillinger** > **Arbeidsområde** > **Microsoft Teams** med **Connect my account with Microsoft Teams**. Uansett logger du på organisasjonen prosjektet er koblet til, som gjest hvis du er gjest der. Er du gjest og har tidligere koblet til kontoen til din egen organisasjon, kobler du den til på nytt.
:::

:::details Alle varsler mislykkes på en selvdriftet server
Teams-appen som er installert i teamene dine, må være pakken serveren din bygde, og Microsoft må kunne nå serverens bot-endepunkt. Se feilsøkingen i [Microsoft Teams-integrasjon](/docs/self-hosted/microsoft-teams-integration#feilsøking).
:::

## Neste steg

:::cards
- [Slack](/docs/workspace-connections/slack): De samme varslene og handlingene i Slack.
- [Videosamtaler](/docs/workspace-connections/video-calls): Gi hver hendelse en samtale, publisert med oppdateringene.
- [Microsoft Teams-integrasjon](/docs/self-hosted/microsoft-teams-integration): Sett opp Teams-boten på en selvdriftet server.
- [Opprette en hendelse](/docs/incidents/declaring-incidents): Alle måtene en hendelse starter på, og hva som kjører når den gjør det.
:::
