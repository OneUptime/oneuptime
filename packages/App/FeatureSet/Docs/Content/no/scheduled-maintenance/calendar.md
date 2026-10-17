# Vedlikeholdskalender

Vedlikeholdskalenderen viser det planlagte vedlikeholdet ditt etter dato: som en kalender i dashbordet, i teamets egne kalenderapper via en hemmelig lenke og i kalenderne til dem som følger statussidene dine. Denne siden forklarer kalendervisningen, teamets kalenderlenke, kalenderen til en statusside og hva hver kalenderhendelse inneholder.

:::cards
- [Kalendervisningen](#kalendervisningen): Hver hendelse på en måned, en uke eller en dag, i fargen til tilstanden sin.
- [Teamets kalenderlenke](#teamets-kalenderlenke): Hver hendelse i prosjektet i Google Kalender, Outlook eller Apple Kalender.
- [Kalenderen til en statusside](#kalenderen-til-en-statusside): Det en statusside viser, i kalenderne til de besøkende.
- [Hva en kalenderhendelse inneholder](#hva-en-kalenderhendelse-inneholder): Tittelen, tidsrommet, tilstanden og en lenke tilbake.
:::

```mermaid title="Én liste med hendelser, tre kalendere"
flowchart TB
    events["Planlagte<br/>vedlikeholdshendelser"] --> view["Kalendervisningen<br/>i dashbordet"]
    events --> team["Teamets lenke<br/>hver hendelse"]
    events --> page["Statussidens lenke<br/>det siden viser"]
    team --> apps["Kalenderapper"]
    page --> apps
```

## Kalendervisningen

Åpne **Planlagt vedlikehold → Alle hendelser**. Lengst til høyre i filterlinjen bytter **Liste** og **Kalender** mellom tabellen over hendelser og en kalender med dem. Nettleseren husker valget, så siden åpner med kalenderen neste gang.

- Kalenderen åpner på denne måneden, med dagen i dag markert. **Måned**, **Uke** og **Dag** endrer hvor mye den viser; bla med pilene, og gå tilbake med **I dag**. Tidene står i din egen tidssone.
- Hver hendelse er en blokk i fargen til tilstanden sin, og fargene til tilstandene er navngitt under kalenderen. Klikk på en hendelse for å åpne den.
- Filtrene over kalenderen virker som på listen: velg en tilstand, en etikett eller en eier for å se bare de hendelsene.
- En dag som ennå ikke har kommet, viser et **+** når du peker på uken dens. Det åpner **Opprett planlagt vedlikeholdshendelse** med **Begynner den** på den dagen, i den timen skjemaet ville valgt i dag. Du ser det bare hvis du kan opprette hendelser.
- En visning viser opptil 500 hendelser. En travlere måned sier ifra: snevre den inn med filtrene, eller se på en uke.

## Teamets kalenderlenke

**Abonner på kalender**, under kalenderen eller i listens **⋯**-meny, åpner prosjektets kalenderlenke: én hemmelig iCalendar-lenke (`.ics`) som legger hver planlagte vedlikeholdshendelse i prosjektet inn i Google Kalender, Outlook, Apple Kalender eller hvilken som helst app som abonnerer på en kalender via en URL.

:::steps
### Publiser lenken

Klikk på **Publiser lenke**. Et prosjekt har én lenke for hele teamet, så dette trengs bare én gang.

### Legg den til i kalenderappen din

**Google Kalender** åpner Google Kalender, som spør om kalenderen skal legges til. **Apple Kalender / Outlook** åpner lenken i kalenderappen på datamaskinen eller telefonen din. **Kopier lenke** kopierer den til en hvilken som helst annen app.

### Sjekk at det virker

Panelet **Status** sier når en kalenderapp sist leste lenken, og hvilken. En ny lenke viser **Venter på første synkronisering** til en app leser den.
:::

Lenken ser slik ut:

```text
https://<your host>/api/scheduled-maintenance-calendar/project/<token>/maintenance.ics
```

> [!WARNING]
> Alle som har lenken, ser hver planlagte vedlikeholdshendelse i prosjektet uten å logge inn. Behandle den som et passord, og generer den på nytt hvis den blir delt ved en feil.

### Hvem som kan se lenken

Lenken viser hver hendelse i prosjektet, så dialogen viser den bare til personer som kan lese hver hendelse. Den som har en rolle som begrenser dem til noen hendelser, etter etikett eller til hendelsene de eier, får i stedet vite hvorfor.

| Handling | Hvem som kan gjøre det |
| --- | --- |
| Kopiere lenken | Alle som kan lese hver planlagte vedlikeholdshendelse i prosjektet |
| **Publiser lenke** | Alle som også kan opprette planlagte vedlikeholdshendelser |
| **Generer lenke på nytt**, **Deaktiver lenke** | Alle som også kan redigere planlagte vedlikeholdshendelser |

### Administrer lenken

**Generer lenke på nytt** og **Deaktiver lenke** ligger i menyen **⋯** øverst i dialogen.

| Handling | Hva som skjer |
| --- | --- |
| **Generer lenke på nytt** | Lager en ny lenke. I 30 dager leverer den gamle en tom kalender, så appene som har den, tømmer kopien sin; deretter finnes den ikke. Abonner på nytt med den nye lenken. |
| **Deaktiver lenke** | Beholder lenken, men den leverer en tom kalender frem til **Aktiver lenke**. |

Kalenderen inneholder hver hendelse fra 90 dager tilbake til ett år frem, opptil 1 000 hendelser.

## Kalenderen til en statusside

De som følger en statusside, kan legge det planlagte vedlikeholdet inn i sin egen kalender. På statussidens side for planlagte hendelser tilbyr **Abonner på kalender** Google Kalender, kalenderappen på enheten deres eller lenken til å kopiere. Lenken er sidens adresse etterfulgt av `/maintenance.ics`, for eksempel `https://status.example.com/maintenance.ics`.

- **Hva den inneholder.** Nøyaktig det siden viser: hendelsene i sidens historikkvindu, hver hendelse som ennå ikke har startet, og hver som pågår, så lenge **Synlig på statussiden** er slått på. Det hver hendelse berører, navngis slik siden navngir ressursene sine, aldri med monitorenes egne navn.
- **En privat side.** En kalenderapp kan ikke logge inn, så en privat side tilbyr ingen **Abonner på kalender**, og lenken leverer en tom kalender som sier at siden er privat.
- **Én hendelse.** **Legg til i kalender** på en hendelses side legger bare til den hendelsen: Google Kalender åpnes med den utfylt, eller den lastes ned som en fil som enhetens kalenderapp åpner. Det virker også på en privat side for en besøkende som har logget inn, og tilbys ikke når hendelsen er over.

## Hva en kalenderhendelse inneholder

Hver kalender, teamets og en statussides, skriver en hendelse på samme måte.

| Del | Hva den inneholder |
| --- | --- |
| Tittel | Hendelsens tittel |
| Start og slutt | Det planlagte tidsrommet i UTC; kalenderappen viser det i din egen tidssone |
| Beskrivelse | Beskrivelsen som ren tekst, tilstanden, hva den berører og en lenke til hendelsen; teamets lenke navngir også statussidene |
| Status | Avlyst når hendelsen ble avlyst: fullført uten noen gang å ha pågått |
| Ledig eller opptatt | Ledig, så et vedlikeholdsvindu aldri blokkerer tilgjengeligheten din |
| Kategorier | Etikettene; kalenderen til en statusside viser dem bare når siden viser etiketter |

En hendelse som redigeres i OneUptime, oppdateres på stedet i hver kalender som har den, og en som slettes eller tas av en statusside, forsvinner fra kalenderen ved neste oppdatering.

## Hvor ofte kalendere oppdateres

Kalenderapper leser en abonnert lenke etter sin egen tidsplan. Google Kalender gjør det med noen timers mellomrom, noen ganger bare én gang om dagen; Apple Kalender og Outlook som regel hver time. OneUptime tar vare på en kalender i høyst fem minutter, så ventetiden du ser, er kalenderappens. Stegene for hver app står på [Kalenderfeeder](/docs/on-call/calendar-feeds#abonner-i-kalenderappen-din), som fungerer på samme måte for vakter.

## Feilsøking

:::details Kalenderappen viser ikke lenger nye hendelser
Lenken er generert på nytt eller deaktivert: åpne **Abonner på kalender** for å se statusen. En lenke som er generert på nytt, må abonneres på igjen med den nye lenken; en deaktivert lenke kommer tilbake med **Aktiver lenke**.
:::

:::details Google Kalender kan ikke legge til lenken
Google Kalender leser lenken fra Googles servere, så OneUptime-serveren må kunne nås fra internett. Se [Kalenderfeeder](/docs/on-call/calendar-feeds#feilsøking) for en server du drifter selv.
:::

:::details En hendelse mangler i kalenderen til en statusside
Sidens kalender inneholder det siden viser. Sjekk at hendelsen navngir siden, at **Synlig på statussiden** er slått på i **Innstillinger**, og at den startet innenfor sidens historikkvindu.
:::

## Neste steg

:::cards
- [Opprett vedlikeholdshendelser](/docs/scheduled-maintenance/creating-events): Skjemaet, felt for felt, og hva som skjer etterpå.
- [Abonnenter og kunngjøringer](/docs/status-pages/subscribers#planlagte-vedlikeholdshendelser): Hva abonnentene til en statusside får vite om vedlikehold.
- [Kalenderfeeder](/docs/on-call/calendar-feeds): Samme slags lenke for vakter.
:::
