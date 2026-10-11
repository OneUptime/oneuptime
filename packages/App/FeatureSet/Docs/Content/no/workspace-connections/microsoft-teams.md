# Microsoft Teams

Koble OneUptime til Microsoft Teams for å publisere hendelser, varsler, episoder, planlagt vedlikehold, monitorer og vaktoppdateringer i kanalene og chattene dine, gi hver hendelse sin egen kanal og la responders handle fra Teams: bekrefte, løse, legge til notater, tilkalle vakten, opprette hendelser og spørre OneUptime AI.

:::cards
- [Koble til Microsoft Teams](#koble-til-microsoft-teams): Administratorsamtykke, påloggingen din og appen i hvert team.
- [Varslingsregler](#varslingsregler): Bestem hvilke hendelser som publiseres hvor, og hvilke som får sin egen kanal.
- [Snakke med OneUptime-boten](#snakke-med-oneuptime-boten): Kommandoer, spørsmål og skjemaer i en chat med boten.
- [Handle på hendelser, varsler og begivenheter fra Microsoft Teams](#handle-på-hendelser-varsler-og-begivenheter-fra-microsoft-teams): Knappene på kortene fra OneUptime.
:::

## Slik fungerer det

```mermaid title="Fra en begivenhet i OneUptime til et kort i Microsoft Teams"
flowchart TB
    event["En hendelse, et varsel eller en begivenhet<br/>opprettes eller endres"] --> rules{"Varslingsregler<br/>der betingelsene passer"}
    rules -->|"Create Microsoft Teams Channel"| own["En egen kanal<br/>i teamet du velger"]
    rules -->|"Publiser i en eksisterende<br/>kanal eller chat"| existing["Kanalene og chattene dine"]
    own --> card["Et kort med knapper"]
    existing --> card
    card -->|"En responder trykker på én"| change["Endringen gjøres i OneUptime,<br/>som den responderen"]
```

Tre ting får dette til å fungere:

- **Prosjektets tilkobling**, gjort én gang: en Microsoft 365-administrator gir samtykke til OneUptime-appen for organisasjonen din.
- **OneUptime-appen i hvert team** du vil ha varsler i. Microsoft lar bare boten publisere i et team den er lagt til i.
- **Hver persons egen tilkobling**: personens Microsoft Teams-konto koblet til personens OneUptime-konto. Knapper, kommandoer og reaksjoner handler som den personen, med personens tillatelser i prosjektet.

## Før du begynner

- **En rolle som kan koble til prosjektet:** **Project Owner**, **Project Admin** eller **Project Member**. Å avinstallere krever **Project Owner** eller **Project Admin**.
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

Hver person kobler til sin egen Microsoft Teams-konto under **Brukerinnstillinger** > **Arbeidsområde** > **Microsoft Teams** med **Connect my account with Microsoft Teams**, for å handle på hendelser og få direktemeldinger som seg selv. Den seksjonen vises så snart prosjektet er koblet til Microsoft Teams.

### Legg til en varslingsregel

Gå til **Hendelser** > **Arbeidsområde** > **Microsoft Teams**. Seksjonen **Arbeidsområde** viser bare chat-workspacene prosjektet ditt har koblet til, så **Microsoft Teams** vises der så snart det er koblet til. Opprett en regel, for eksempel en som publiserer i en Teams-kanal når en hendelse opprettes, og klikk deretter på **Testregel** i raden.
:::

> [!NOTE]
> Å installere OneUptime for deg selv, eller legge den til i en chat, er en annen installasjon og lar den ikke publisere i et teams kanaler. **Private kanaler** krever at appen er lagt til i selve kanalen: åpne kanalen > "..." > **Manage channel** > **Apps** > **Add an app**. **Delte kanaler** kan ikke motta varsler: Microsoft Teams støtter ikke boter i delte kanaler.

## Varslingsregler

En varslingsregel sier hvilke hendelser som publiseres i Microsoft Teams, og hvor. Hvert produkt har sine egne regler, under **Arbeidsområde** > **Microsoft Teams** i sin meny:

| Produkt | Faner på produktets **Microsoft Teams**-side |
| --- | --- |
| **Hendelser** | **Hendelser**, **Hendelse Episoder**, **Summary** |
| **Varsler** | **Varsler**, **Varsel Episoder**, **Summary** |
| **Planlagt vedlikehold** | Én liste med regler |
| **Monitorer** | Én liste med regler |
| **Vakttjeneste** | Én liste med regler |

Å opprette en regel går gjennom fire trinn:

| Trinn | Hva du angir |
| --- | --- |
| **Grunnleggende** | **Regelnavn** og **Regelbeskrivelse**. |
| **Betingelser** | Hvilke hendelser regelen utløses for, for eksempel etter alvorlighetsgrad, tilstand, etikett, monitor eller ord i tittelen. Uten betingelser utløses den for hver hendelse. Med to eller flere sier **Samsvarsbetingelse** om alle må passe, eller om én er nok. |
| **Mål** | Hvor den publiserer: en eksisterende kanal i et team du velger, chattene du velger, en ny kanal som opprettes i et team du velger, eller flere av disse sammen. |
| **Video Call** | Bare hendelser og varsler: start en samtale for hver. Se [Videosamtaler](/docs/workspace-connections/video-calls). |

En kanal som regelen oppretter, får navnet sitt fra **New Microsoft Teams Channel Name** etterfulgt av postens nummer, som `oneuptime-incident-42`, og bare en opprettet kanal får folkene regelen inviterer. En privat hendelse, et privat varsel eller en privat episode får en privat kanal. Hver senere oppdatering av posten — en tilstandsendring, et notat, en ny eier — publiseres i kanalene og chattene dens.

**Prosjektinnstillinger** > **Arbeidsområde** > **Microsoft Teams** viser kanalene OneUptime ser i teamene dine, og chattene den er lagt til i, med **Send test** ved siden av hver. En chat vises så snart OneUptime-appen er lagt til i den i Microsoft Teams; **Refresh Chats** henter nye chatter og de nåværende navnene deres.

## Teste en regel

**Testregel** i en regels rad publiserer en testmelding for den regelen i kanalene den nevner, så du ser at den kommer frem. Hvis regelen oppretter en kanal for hver hendelse, oppretter testen også en og inviterer regelens folk inn i den.

I likhet med **Send test** ved siden av en kanal i **Prosjektinnstillinger** > **Arbeidsområde** > **Microsoft Teams** krever den tillatelse til å opprette varslingsregler: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member**, eller **Create Workspace Notification Rule** og **Read Workspace Notification Rule** i en egendefinert rolle. For en som bare kan se reglene, som en **Viewer**, er **Testregel** låst, og verktøytipset sier hva som kreves; API-et avviser testen med "You do not have permission to send test notifications in this project." På OneUptime Cloud krever det **Growth**-planen å teste en regel, på samme måte som å legge til en.

På OneUptime Cloud krever **Send test** ved siden av en kanal eller en chat også **Growth**-planen, siden det å publisere i en kanal er det regler og sammendrag gjør. **Send test nå** på et sammendrag krever tillatelse til å opprette sammendrag (**Create Workspace Notification Summary** og **Read Workspace Notification Summary** i en egendefinert rolle) og, på OneUptime Cloud, **Growth**-planen; for alle andre er den låst, og verktøytipset sier hva som kreves. En MCP-klient som er koblet til med skrivebeskyttet tilgang, kan ikke sende noen test.

## Sammendrag

Fanen **Summary** i **Hendelser** > **Arbeidsområde** > **Microsoft Teams** (og i **Varsler**) publiserer et gjentakende sammendrag i kanalene du nevner: hvor mange hendelser eller varsler det var, hvor raskt de ble bekreftet og løst, og en liste med lenker. Et nytt sammendrag sendes hver uke og dekker de siste 7 dagene. La **Send første rapport kl.** stå tomt, så sendes det første kl. 09:00 i starten av neste uke, dag eller måned; skjemaet sier når.

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
| 📣 eller 📢 | Et offentlig notat, vist på statussiden. Bare hendelser og planlagte vedlikeholdsbegivenheter. |

Notatet lagres som deg, med dine tillatelser, så din egen Microsoft Teams-konto må være koblet til, og OneUptime-appen må være i teamet.

## Snakke med OneUptime-boten

Send boten en melding i en personlig chat, eller nevn OneUptime med @ i en kanal eller en gruppechat: der svarer den bare når den nevnes.

| Melding | Hva boten gjør |
| --- | --- |
| `help` | Viser hva den kan gjøre. |
| `ask <question>`, eller et hvilket som helst spørsmål på vanlig språk | OneUptime AI svarer om logger, traces, målinger, hendelser og monitorer, for eksempel "hvilke monitorer er nede akkurat nå?". Svar leser bare. |
| `create incident [title]` | Åpner hendelsesskjemaet med tittelen fylt ut. |
| `create maintenance [title]` | Åpner skjemaet for planlagt vedlikehold med tittelen fylt ut. |
| `show active incidents`, `show active alerts` | Viser det som er åpent nå. |
| `show scheduled maintenance`, `show ongoing maintenance` | Viser kommende, eller pågående, vedlikeholdsbegivenheter. |

Å spørre OneUptime AI krever at AI er slått på for prosjektet. Se [Spør AI](/docs/ai/ask-ai).

## Opprett hendelser og vedlikehold fra Microsoft Teams

Å skrive `create incident` eller `create maintenance` til OneUptime-boten åpner et skjema for personen som skrev det, i en personlig chat, en kanal eller en gruppechat. Det fylles ut som den personen: som OneUptime-kontoen personens Microsoft Teams-konto er koblet til (se [Koble til Microsoft Teams](#koble-til-microsoft-teams)), med den kontoens tillatelser i prosjektet. Den som ikke har kontoen koblet til, eller som har en OneUptime-konto som ikke lenger er medlem av prosjektet, får beskjed om hva som må gjøres i stedet for skjemaet.

- **Hvem som kan bruke dem.** De som kan opprette en hendelse eller en planlagt vedlikeholdsbegivenhet i OneUptime: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** og **Incident Member** for en hendelse (**Create Incident** i en egendefinert rolle), og **Scheduled Maintenance Admin** og **Scheduled Maintenance Member** for en begivenhet (**Create Scheduled Maintenance**). Alle andre får beskjed om det, og får ikke noe skjema.
- **Hva et skjema tilbyr.** Hver liste — alvorlighetsgrader, monitorer, monitorstatuser, vaktpolicyer og etiketter — inneholder det personen som ba om det, kan lese, slik som den samme listen i OneUptime, og kortets "not shown"-merknader teller bare disse: med en rolle som er begrenset til noen etiketter, monitorene og vaktpolicyene som har de etikettene. En liste personen ikke kan lese i det hele tatt, utelates. Arkiverte vaktpolicyer tilbys aldri.
- **Hva et skjema kan nevne.** I en kanal eller en gruppechat kan alle som er der sende inn skjemaet, og det sendes inn som den som gjør det, med vedkommendes egne tillatelser. Hendelsen eller begivenheten opprettes med de tillatelsene og krediteres den personen. En monitor, vaktpolicy, etikett, alvorlighetsgrad eller status personen ikke kan lese, eller en fra et annet prosjekt, avvises som en prosjektet ikke har, og ingenting opprettes: boten svarer "One of the values you picked ... is not available in this project any more. Please pick it again."

**Execute On-Call Policy** på en hendelse, et varsel eller en episode fungerer på samme måte: den krever tillatelse til å kjøre en vaktpolicy (**Project Owner**, **Project Admin**, **Project Member**, **On-Call Admin** og **On-Call Member**, eller **Create On-Call Duty Policy Execution Log** i en egendefinert rolle) og til å lese den hendelsen, det varselet eller den episoden, og den tilbyr de aktive vaktpolicyene personen kan lese. Å se en monitor eller en vaktpolicy fra et kort leser den også som personen som trykket på knappen.

## Handle på hendelser, varsler og begivenheter fra Microsoft Teams

Knappene på OneUptimes kort handler som personen som trykker på dem, i en personlig chat, en kanal eller en gruppechat: som OneUptime-kontoen personens Microsoft Teams-konto er koblet til, med den kontoens tillatelser i prosjektet. **Acknowledge**, **Resolve**, **Change State**, **Add Note** og **Execute On-Call Policy** på en hendelse, et varsel eller en episode, og **Mark as Ongoing**, **Mark as Complete**, **Change State** og **Add Note** på en planlagt vedlikeholdsbegivenhet, gjør hver den endringen som samme handling gjør i OneUptime, og den krediteres den personen der: postens tilstandstidslinje og feed viser hvem som endret tilstanden, og notatet er personens. Et notat som lagres fra en melding med en reaksjon, publiseres på samme måte.

- **Hvem som kan bruke dem.** De som kan gjøre den samme endringen i OneUptime. Å bekrefte, løse eller endre tilstanden til en hendelse krever tillatelse til å endre tilstanden: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** og **Incident Member**, eller **Create Incident State Timeline** i en egendefinert rolle. Et varsel, en episode eller en planlagt vedlikeholdsbegivenhet krever den samme tillatelsen for sin egen type (**Create Alert State Timeline**, for eksempel), og et notat krever tillatelse til å publisere den typen notat. I likhet med tilstandspanelet i OneUptime ber de ikke om tillatelse til å redigere selve hendelsen eller varselet. Alle andre får beskjed om det, og ingenting endres.
- **Hvilke poster.** De personen kan lese, som i OneUptime: med en rolle som er begrenset til noen etiketter, hendelsene, varslene, episodene og begivenhetene som har dem. En knapp på en hvilken som helst annen post, eller på en fra et annet prosjekt, får til svar at posten "was not found in this project, or you do not have access to it.", og ingenting endres. På OneUptime Cloud avvises en endring som prosjektets plan ikke omfatter, med planen den krever.
- **Hva Change State tilbyr.** Tilstandene personen kan lese som posten kan gå videre til, i prosjektets rekkefølge: ingen før tilstanden den er i, for en episode som for en hendelse, et varsel eller en planlagt vedlikeholdsbegivenhet, siden en tilstandsendring aldri flytter en post opp igjen i listen (se [Rekkefølgen er en reell begrensning, ikke en visningspreferanse](/docs/incidents/states-and-severities#rekkefølgen-er-en-reell-begrensning-ikke-en-visningspreferanse)). Når personen ikke kan lese noen, sier boten "No incident states are available to you in this project. Ask a project admin for access to them."; når posten er i den siste tilstanden den kan nå, sier den "There is no later state to move this incident to." Ingen av dem viser et tomt kort.
- **Escalate.** Et korts **Escalate** kjører vaktpolicyen for hendelsen, varselet eller episoden kortet gjelder, som personen som trykket på den, med de samme tillatelsene som **Execute On-Call Policy**. Et kort som ikke gjelder noen av dem, får til svar "This on-call policy can only be executed for an incident, an alert or an episode. Open the record you are paging about and use Execute On-Call Policy there.", og ingen tilkalles.

## Koble fra

- **Disconnect** kobler bare fra din egen Microsoft Teams-konto, og fjerner samtidig Microsoft Teams-varselmetoden din.
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
Koble den til under **Brukerinnstillinger** > **Arbeidsområde** > **Microsoft Teams** med **Connect my account with Microsoft Teams**, pålogget organisasjonen prosjektet er koblet til. En gjestekonto fra en annen organisasjon er ikke den samme kontoen.
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
