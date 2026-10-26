# Slik når OneUptime deg

OneUptime når deg på to måter. Det tilkaller deg når en hendelse eller et varsel utløses mens du har vakt, og det holder deg oppdatert om det du eier: et notat på hendelsen din, en overvåking som endret status, den neste vakten din. Begge deler kommer til adressene du har i **Brukerinnstillinger**, prosjekt for prosjekt. Denne siden forklarer hvordan delene henger sammen, hvor de er, og hva du starter med.

:::cards
- [Tre sider, tre spørsmål](#tre-sider-tre-spørsmål): Metoder, vaktregler og varselinnstillinger, og hva hver av dem avgjør.
- [Hvor du finner dem](#hvor-du-finner-dem): Sidene i brukerinnstillingene, seksjon for seksjon.
- [Dette starter du med](#dette-starter-du-med): Metodene, reglene og innstillingene et nytt medlem får.
- [Når ingen regel passer](#når-ingen-regel-passer): Hvordan en tilkalling likevel når deg, og hvem som får beskjed.
:::

## Slik fungerer det

```mermaid title="To måter OneUptime når deg på, gjennom de samme metodene"
flowchart TB
    page["En hendelse eller et<br/>varsel tilkaller deg<br/>på vakt"] --> rules["Vaktreglene dine"]
    owned["Noe skjer med<br/>noe du eier"] --> settings["Varselinnstillingene<br/>dine"]
    rules --> methods["De verifiserte metodene<br/>dine: e-post, telefon,<br/>push, chat"]
    settings --> methods
```

- En vaktpolicy tilkaller deg når en av eskaleringsreglene dens nevner deg, et team du er med i, eller en vaktplan der du har vakt. Vaktreglene dine avgjør da hvilke av metodene dine OneUptime prøver, og etter hvor lang tid.
- Når noe skjer med noe du eier, eller med vaktene dine, avgjør varselinnstillingene dine hvilke kanaler oppdateringen går gjennom.
- I begge tilfeller bruker OneUptime bare metoder du har verifisert, i prosjektet tilkallingen eller oppdateringen kommer fra.

## Tre sider, tre spørsmål

| Side | Hva den inneholder | Spørsmålet den svarer på |
| --- | --- | --- |
| **Varselmetoder** | E-postadressene, telefonnumrene og WhatsApp-numrene dine, Telegram-, Slack- og Microsoft Teams-kontoene dine, push-enheter og webhooks | Hvor kan OneUptime nå meg? |
| **Vaktregler** | For hver type tilkalling og hver alvorlighetsgrad: hvilken metode som prøves, og etter hvor lang tid | Hvordan blir jeg tilkalt mens jeg har vakt? |
| **Varselinnstillinger** | For hver hendelse om noe du eier, eller om vaktene dine: hvilke kanaler som brukes | Hva annet får jeg vite om, og hvor? |

De er atskilt med vilje. Å slå på alle kanaler i **Varselinnstillinger** tilkaller deg aldri, og en metode du ikke har verifisert blir aldri brukt, uansett hva reglene dine sier.

> [!IMPORTANT]
> Metoder, regler og innstillinger hører til ett prosjekt. Sett dem opp i hvert prosjekt du jobber i: **Brukerinnstillinger** viser alltid prosjektet du er i.

## Hvor du finner dem

Åpne **Brukerinnstillinger**, til høyre i linjen under topplinjen. Sidemenyen samler alt om hvordan OneUptime når deg:

| Seksjon | Sider |
| --- | --- |
| **Kom i gang** | **Oppsettsjekkliste**: hva som gjenstår å sette opp, i den rekkefølgen som teller |
| **Varsler og notifikasjoner** | **Varselmetoder**, **Vaktregler**, **Varselinnstillinger** og **E-postinnstillinger**, der du bestemmer hvor mange e-poster oppdateringene dine blir til |
| **Vaktlogger** | **Vaktlogger**: hver gang du ble tilkalt i dette prosjektet, og hva som ble sendt |
| **Retningslinjer for innkommende anrop** | **Innkommende telefonnumre**: nummeret en policy for innkommende anrop ringer deg på |
| **Kalender** | **Kalenderfeed**: vaktene dine i kalenderappen din, og påminnelser før de starter |
| **Profil** | **Egendefinerte felt**: opplysninger prosjektet ditt ber medlemmene om |
| **Arbeidsområde** | **Slack** og **Microsoft Teams**: din egen konto, i hvert arbeidsområde prosjektet har koblet til |

**Kom i gang** og **Varsler og notifikasjoner** er åpne; de andre seksjonene starter sammenslått, og en seksjon åpner seg selv når du er på en av sidene dens. **Arbeidsområde** vises bare når prosjektet har koblet til Slack eller Microsoft Teams.

Prosjekteiere og administratorer kan også se oppsettet ditt: Under **Brukere** åpner de raden din og seksjonen **Vakt** i den, med **Beredskap**, **Varselmetoder** og **Vaktregler**. De kan legge til en metode for deg der, men koden går til selve metoden, så bare du kan verifisere den.

## Dette starter du med

Når du blir medlem av et prosjekt med en verifisert påloggings-e-post, setter OneUptime deg opp slik at en tilkalling alltid kan nå deg:

1. Påloggings-e-posten din legges til som en verifisert e-postmetode.
2. For hver alvorlighetsgrad, på hver av de fire fanene i **Vaktregler**, sender en regel deg en e-post så snart du blir tilkalt.
3. En rekke oppdateringer om det du eier, og om vaktene dine, er slått på via e-post. Se [Varselinnstillinger](/docs/notifications/notification-settings#hva-som-er-slått-på-for-et-nytt-medlem).

Hver metode du verifiserer senere, får de samme reglene: en regel for hver alvorlighetsgrad, sendt så snart du blir tilkalt. Å verifisere et telefonnummer for SMS betyr altså at hver tilkalling også sender deg en SMS. Vil du bare ha SMS ved kritiske tilkallinger, sletter du SMS-reglene for de andre alvorlighetsgradene. Se [Personlige vaktregler](/docs/notifications/on-call-rules#reglene-du-starter-med).

## Oppsettsjekklisten

**Brukerinnstillinger → Oppsettsjekkliste** åpner **Your setup checklist**: alt OneUptime trenger for å nå deg, i den rekkefølgen som teller. Et steg lenker til siden der det gjøres, og **Kontroller på nytt** leser alt på nytt.

| Seksjon | Hva den sjekker |
| --- | --- |
| **So we can reach you** | Du har en metode, hver metode du har lagt til er verifisert, og minst én av dem er på en kanal prosjektet har slått på |
| **How you want to be paged** | Hver alvorlighetsgrad har en regel, på hver av de fire fanene i **Vaktregler** |
| **Staying informed** | Du får vite når en vakt starter, og bak hver kanal du har slått på i **Varselinnstillinger**, står en verifisert metode |
| **Nice to have** | Et nummer for innkommende anrop, Slack- og Microsoft Teams-kontoene dine, en kalenderlenke og profilfeltene dine |

**Nice to have** teller ikke med i fremdriftslinjen, og det gjør heller ikke et steg som bare noen andre kan fikse. Linjen øverst oppsummerer:

| Overskrift | Hva den betyr |
| --- | --- |
| **Alt er klart** | Tilkallinger når deg, og det er ingenting igjen å gjøre |
| **Noen ting må fortsatt settes opp** | En alvorlighetsgrad har ingen regel, eller et steg er ikke gjort ennå |
| **Ingenting kan nå deg ennå** | Ingen av metodene dine kan brukes: ingen er verifisert, eller hver verifisert metode er på en kanal dette prosjektet har slått av |
| **Du er satt opp og har ikke vakt akkurat nå** | Alt er klart for dagen en policy nevner deg |

## Når ingen regel passer

En tilkalling kan nå deg for en type og en alvorlighetsgrad du ikke har noen regel for, for eksempel en alvorlighetsgrad som ble lagt til etter at du ble medlem. OneUptime tilkaller deg likevel, via det du har verifisert:

1. Hver gratis metode du har: push-enheter, e-postadresser, Slack og Microsoft Teams.
2. Har du ingen av dem, én betalt metode, i denne rekkefølgen: SMS, et telefonanrop, WhatsApp, Telegram. Det er den første du har verifisert, på en kanal prosjektet har slått på.
3. Har du heller ingen av dem, en webhook.

Du får en e-post om det, og det gjør også eierne av vaktpolicyen, eller prosjektets eiere hvis policyen ikke har noen. Er ingenting verifisert, kan tilkallingen ikke leveres, og e-posten sier det i stedet. Disse e-postene holdes tilbake mens tilkallingene fortsetter å komme, slik at en storm av tilkallinger ikke blir en storm av e-poster. Hvordan du legger til den manglende regelen, står under [Personlige vaktregler](/docs/notifications/on-call-rules#når-en-alvorlighetsgrad-ikke-har-noen-regel).

## Feilsøking

:::details Jeg hadde vakt, men ingenting nådde meg
Åpne **Brukerinnstillinger → Vaktlogger**. Ingen rad for hendelsen betyr at vaktpolicyen dens aldri tilkalte deg: sjekk eskaleringsreglene dens, og hvem som hadde vakt. For en rad med status **Feil** forteller **Vis statusmelding** hvorfor, for eksempel en kanal prosjektet har slått av. Sjekk deretter at metodene dine er verifisert, og at **Your setup checklist** ikke har noe utestående under **So we can reach you**.
:::

:::details Jeg får e-poster om ting jeg aldri har bedt om
Du eier tingen, direkte eller gjennom et team, eller tingen har ingen eiere og du er prosjekteier. Slå av hendelsen under **Brukerinnstillinger → Varselinnstillinger**, eller skru ned mengden under **Brukerinnstillinger → E-postinnstillinger**.
:::

:::details Jeg la til et telefonnummer, men det er ikke i reglene mine
Et nummer kommer med i reglene dine når det er verifisert. Klikk **Verifiser** i raden dets, og skriv inn koden. Har kortet dets ingen legg-til-knapp, har prosjektet slått av den kanalen. Se [Varselmetoder](/docs/notifications/notification-methods#slå-på-en-kanal-for-prosjektet).
:::

## Neste steg

:::cards
- [Varselmetoder](/docs/notifications/notification-methods): Legg til og verifiser adressene OneUptime kan nå deg på.
- [Personlige vaktregler](/docs/notifications/on-call-rules): Bestem hvilken metode hver tilkalling prøver, og når.
- [Varselinnstillinger](/docs/notifications/notification-settings): Velg oppdateringene du får vite om, og via hvilke kanaler.
- [Eskaleringsregler](/docs/on-call/escalation-rules): Hvordan en vaktpolicy avgjør hvem som tilkalles, nivå for nivå.
:::
