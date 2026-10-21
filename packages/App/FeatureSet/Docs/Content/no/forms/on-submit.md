# Hva en innsending oppretter

Hver innsending via et skjema oppretter én post i prosjektet ditt: en **hendelse** eller en **planlagt vedlikeholdsbegivenhet**. Et skjemas side **Ved innsending** viser hvilken, og hvordan hvert felt på den nye posten fylles ut — fra et svar, fra en standardverdi, fra en innstilling som alltid gjelder, eller fra hendelsesmalen. **Rediger innstillinger** endrer standardverdiene og det som alltid gjelder.

:::cards
- [Slik blir en innsending til en hendelse](#slik-blir-en-innsending-til-en-hendelse): Hvert felt på den nye hendelsen, og hvor verdien kommer fra.
- [Slik blir en innsending til en planlagt vedlikeholdsbegivenhet](#slik-blir-en-innsending-til-en-planlagt-vedlikeholdsbegivenhet): Det samme, for en forespørsel om vedlikehold.
- [Innstillingene Ved innsending](#innstillingene-ved-innsending): Standardverdier, hva som alltid knyttes til, eiere og publisering.
- [Det private notatet](#det-private-notatet): Hvem som sendte det, og svarene som ikke står i noe felt.
:::

## Hva som skjer ved innsending

```mermaid title="Fra en innsending til en hendelse eller en vedlikeholdsbegivenhet"
flowchart TB
    submit["Send inn"] --> checks["Beskyttelser og<br/>sjekk av svarene"]
    checks --> fields["Hvert felt: svaret,<br/>ellers innstillingene Ved innsending,<br/>ellers hendelsesmalen"]
    fields --> record["Hendelsen eller<br/>vedlikeholdsbegivenheten"]
    record --> note["Et privat notat: hvem som sendte det,<br/>og de andre svarene"]
    record --> runs["Regler, vaktpolicyer<br/>og arbeidsflyter kjører"]
```

En innsending som ikke består en sjekk, oppretter ingenting. Se [Hva som beskytter et skjema](/docs/forms/sharing-and-security#hva-som-beskytter-et-skjema).

## Hva hver innsending oppretter

Kortet **Hva hver innsending oppretter** inneholder valget du tok da du opprettet skjemaet:

- **Hendelse** — hver innsending oppretter en hendelse, så vaktteamet ditt får beskjed med en gang. Bruk det for problemrapporter.
- **Planlagt vedlikehold** — hver innsending planlegger en vedlikeholdsbegivenhet. Bruk det for endrings- og vedlikeholdsforespørsler.

Å velge det andre ber deg bekrefte, fordi skjemaet endres med det:

- Tittelen, beskrivelsen, monitorene og etikettene forblir koblet: begge typer poster har dem.
- Hvert annet koblet spørsmål — en alvorlighetsgrad, et valg av statusside, et egendefinert felt av den gamle typen — blir et av skjemaets egne spørsmål, med samme ordlyd, der svaret vises i det private notatet.
- Innstillingene Ved innsending starter på nytt, siden innstillingene for en hendelse og for en begivenhet er forskjellige.
- Et skjema som nå oppretter vedlikeholdsbegivenheter, spør når vedlikeholdet starter og slutter.

Spørsmålene lagres med en gang, sammen med endringen. Sjekk dem på siden **Bygg**.

## Slik blir en innsending til en hendelse

Kortet viser hvert felt på den nye hendelsen og hvor verdien kommer fra:

| Felt | Kommer fra |
| --- | --- |
| **Tittel** | Svaret på spørsmålet **Tittel**. Når skjemaet ikke spør om det, eller det står tomt: **Standardtittel**, ellers skjemaets navn. |
| **Beskrivelse** | Svaret på spørsmålet **Beskrivelse**. Når det ikke spørres om eller står tomt, hendelsesmalens beskrivelse, hvis skjemaet har en mal. |
| **Alvorlighetsgrad** | Innsenderens valg, når skjemaet spør om det. Ellers skjemaets innstilling **Alvorlighetsgrad**, ellers hendelsesmalens alvorlighetsgrad. |
| **Monitorer** | Monitorene innsenderen valgte, sammen med de innstillingene alltid knytter til. Uten noen av delene, hendelsesmalens. |
| **Etiketter** | Etikettene innsenderen valgte, sammen med de innstillingene alltid legger til. Uten noen av delene, hendelsesmalens. |
| **Påvirkning startet** | Svaret på **Påvirkning startet**, når skjemaet spør om det. |
| **Hendelse Mal** | Skjemaets innstilling **Hendelse Mal**. Den fyller ut alt svarene og innstillingene lar stå uangitt. |
| **Vaktretningslinjer** | Policyene innstillingene nevner, kjørt for hver hendelse skjemaet oppretter. Uten noen, hendelsesmalens. |
| **Eiere** | Personene og teamene innstillingene nevner, sammen med malens eiere. De får beskjed om hver hendelse. |
| **Egendefinerte felt** | Svaret på hvert spørsmål om et egendefinert felt — med mindre feltet kopierer verdien sin fra et egendefinert monitorfelt og hendelsens monitorer har en; malen fyller ut resten. |
| **Statussider** | Vises aldri på statussider, og abonnenter får ikke beskjed, før noen i teamet ditt publiserer den. |
| **Andre svar** | Vises i et privat notat på hendelsen, med hvem som sendte inn. |

> [!IMPORTANT]
> **Ingen alvorlighetsgrad, ingen hendelse.** En hendelse trenger en alvorlighetsgrad. Når skjemaet ikke spør om en, og innstillingene ikke nevner noen — eller den de nevnte, ble slettet — og malen heller ikke angir noen, advarer raden **Alvorlighetsgrad** deg, og hver innsending avvises med "Dette skjemaet kan ikke opprette en hendelse fordi det ikke har noen alvorlighetsgrad. Gi beskjed til teamet som delte det." Velg en alvorlighetsgrad i **Rediger innstillinger**, eller en mal som angir en.

### Hendelsesmalen

Velg en **Hendelse Mal** i innstillingene, så opprettes hver hendelse skjemaet oppretter, ut fra den, på samme måte som serveren bruker en mal overalt — se [Slik brukes en mal](/docs/incidents/settings#slik-brukes-en-mal). Svarene og skjemaets innstillinger kommer først, og malen fyller ut alt annet: den innledende tilstanden, beskrivelsen, alvorlighetsgraden, de berørte ressursene, vaktpolicyene, eierne, etikettene, verdiene i egendefinerte felt og en endring av monitorstatus.

> [!WARNING]
> **Pass på monitorene.** Å opprette en hendelse på en monitor via et skjema påvirker monitoren nøyaktig som å opprette en hendelse på den manuelt: den aktive overvåkingen av monitoren settes på pause til hendelsen er løst, og en mals **Endre overvåkingsstatus til** endrer monitorens status med en gang — på hver statusside som viser monitoren, selv mens selve hendelsen er skjult. Med et skjema kan alle med lenken gjøre dette. Knytt bare monitorer til via et skjema når hver innsending skal sette dem på pause.

### Slik ser hendelsen ut

En hendelse som er opprettet via et skjema, er en vanlig hendelse med noen få egne innstillinger:

- **Skjult fra statussider.** **Synlig på statussiden** er slått av, og det samme er **Varsle statussideabonnenter**. Til en responder publiserer den, når ingenting om hendelsen en statusside eller en abonnent — bortsett fra en mals endring av monitorstatus, ovenfor.
- **Opprettet av ingen.** Innsenderen er ikke en OneUptime-bruker, så ingen bruker registreres som den som opprettet hendelsen.
- **Eierne får beskjed.** Eierne innstillingene og malen nevner, legges til så snart hendelsens Slack- og Microsoft Teams-kanaler finnes, og får varsel — hendelsens varsel **Hendelse opprettet** venter til de er eierne, så det går til dem i stedet for til prosjektets eiere.
- **Et privat notat registrerer innsendingen** — se [Det private notatet](#det-private-notatet).

Alt som kjører for en ny hendelse, kjører også for disse: personvern-, eier-, etikett-, vakt- og runbook-regler, vaktpolicyer og arbeidsflyter med **On Create Incident**. Vaktregler matcher et skjemas hendelser som alle andre — også på tittelen og beskrivelsen, som innsenderen skrev.

:::steps
#### Les det innsenderen skrev

Tittelen og beskrivelsen vises på statussider når hendelsen er publisert.

#### Publiser hendelsen

Slå på **Synlig på statussiden** fra hendelsens side **Innstillinger**.

#### Gi abonnentene beskjed, hvis de skal vite det

Fordi hendelsen ble opprettet med **Varsle statussideabonnenter** slått av, sender publisering ikke varselet "hendelse opprettet". For å gi abonnentene beskjed publiserer du et offentlig notat med **Varsle statussideabonnenter** krysset av — se [Publiser et offentlig notat](/docs/incidents/notes-owners-and-feed#publiser-et-offentlig-notat).
:::

## Slik blir en innsending til en planlagt vedlikeholdsbegivenhet

| Felt | Kommer fra |
| --- | --- |
| **Tittel** | Svaret på spørsmålet **Tittel**. Når skjemaet ikke spør om det, eller det står tomt: **Standardtittel**, ellers skjemaets navn. |
| **Beskrivelse** | Svaret på spørsmålet **Beskrivelse**. |
| **Begynner den**, **Slutter den** | Svarene på **Begynner den** og **Slutter den**, som hvert vedlikeholdsskjema spør om og krever. Slutten må være etter starten. |
| **Monitorer** | Monitorene innsenderen valgte, sammen med de innstillingene alltid knytter til. |
| **Statussider** | Statussidene innsenderen valgte, sammen med de innstillingene nevner. |
| **Etiketter** | Etikettene innsenderen valgte, sammen med de innstillingene alltid legger til. |
| **Eiere** | Personene og teamene innstillingene nevner. De eier hver begivenhet skjemaet planlegger. |
| **Vis på statussider** | **Nei** med mindre innstillingene slår det på. |
| **Varsle abonnenter** | **Nei** med mindre innstillingene slår det på. |
| **Egendefinerte felt** | Svaret på hvert spørsmål om et egendefinert felt — med mindre feltet kopierer verdien sin fra et egendefinert monitorfelt og begivenhetens monitorer har en. |
| **Andre svar** | Vises i et privat notat på begivenheten, med hvem som sendte inn. |

Begivenheten starter i prosjektets tilstand **Scheduled** og går videre som alle andre: den blir pågående når den starter, og avsluttes når den slutter.

En innsending er noens forespørsel, og en forespørsel gjennomgås før den publiseres. Så med mindre du endrer det, holdes begivenheten borte fra statussidene sine til noen i teamet ditt viser den, og abonnentene får ikke beskjed når den opprettes, starter eller slutter. **Vis på statussider** og **Varsle abonnenter**, i innstillingenes trinn **Publisering**, endrer det for hver begivenhet skjemaet planlegger — slå dem bare på når du stoler på alle med lenken.

## Innstillingene Ved innsending

**Rediger innstillinger** åpner innstillingene i trinn: **Neste** går videre, og **Lagre endringer** er på siste trinn. Hvert trinn er allerede fylt ut, så trinnlisten ved siden av skjemaet åpner hvilket som helst av dem, også det siste: endre en innstilling på trinnet, åpne deretter siste trinn og lagre.

| Trinn | Hendelsesskjema | Vedlikeholdsskjema |
| --- | --- | --- |
| **Standardverdier** | **Standardtittel**, **Alvorlighetsgrad**, **Hendelse Mal** | **Standardtittel** |
| **Knytt alltid til** | **Monitorer**, **Etiketter**, **Vaktretningslinjer** | **Monitorer**, **Statussider**, **Etiketter** |
| **Eiere** | **Eiere** | **Eiere** |
| **Publisering** | — | **Vis på statussider**, **Varsle abonnenter** |

**Eiere** er én velger for personer og team: **Legg til eier** åpner én søkeliste med begge, og hvert valg vises som en brikke du kan fjerne. Alt innstillingene nevner, må høre til skjemaets prosjekt, og eiere må være medlemmer av det. En post som slettes etter at den ble valgt, hoppes over når en innsending opprettes, og resten gjelder fortsatt.

## Det private notatet

Hver innsending legger igjen et privat notat på det den opprettet:

> Submitted through the form **Report a Problem** by Ada Lovelace (<ada@example.com>).
>
> **Which office are you in?**\
> Berlin

Det nevner skjemaet og innsenderen — "Submitted anonymously through the form **Report a Problem**." når skjemaet ikke spurte hvem det er — og sier deretter, når innsendingen startet fra en av skjemaets maler, hvilken: "Started from the template **Application Outage**." — og viser så svarene på skjemaets egne spørsmål, hvert under spørsmålet sitt, i skjemaets rekkefølge. Svarene på koblede spørsmål står allerede på posten: tittelen, alvorlighetsgraden, de egendefinerte feltene. Siden notatet er privat, når det aldri en statusside, men det publiseres i postens Slack- og Microsoft Teams-kanaler som alle andre notater.

Adressen er en lenke som skriver til nøyaktig den adressen — i dashbordet, i Slack og i e-posten til eierne.

## Skjulte spørsmål og maler

Et [skjult spørsmål](/docs/forms/building#skjulte-spørsmål) besvares fra [malen](/docs/forms/building#maler) innsendingen startet fra — aldri fra forespørselen — og svaret går nøyaktig dit et skrevet svar ville gått: en skjult **Beskrivelse** blir hendelsens beskrivelse, et skjult egendefinert felt verdien, et skjult av skjemaets egne spørsmål en linje i det private notatet. En innsending som ikke startet fra noen mal, lar skjulte spørsmål stå ubesvart, og feltene fylles ut fra innstillingene Ved innsending, som for alle spørsmål som står tomme. En mal som slettes mens noen hadde skjemaet åpent, stopper ikke innsendingen: den opprettes slik personen svarte, uten malens skjulte svar.

En mal kan stille skjemaets spørsmål [på sin egen måte](/docs/forms/building#slik-spør-en-mal-om-hvert-spørsmål), og serveren holder innsendingen opp mot spørsmålene slik malen den nevner stiller dem. Et spørsmål malen skjuler, besvares fra malen, som et skjult spørsmål, selv når skjemaet stiller det; et malen stiller, leses fra forespørselen, selv når skjemaet skjuler det; og et malen krever, må besvares, ellers avvises innsendingen og ingenting opprettes.

Svarene en mal fylte ut på siden, er innsenderens så snart innsendingen skjer: serveren tar svarene forespørselen sender for spørsmålene siden stiller, uansett hva malen sa.

## Tekst en innsender skriver

En innsending går rett til steder der tekst kan virke på egen hånd — Slack- og Microsoft Teams-kanaler, nettleseren til hver responder, eiernes e-poster — og ingen leser den først. Så før posten opprettes:

| Hva innsenderen skriver | Hva som lagres |
| --- | --- |
| En omtale, som \<!channel\>, \<!here\> eller \<@U0123ABC\>, i tittelen, beskrivelsen eller et hvilket som helst tekstsvar | **Omtaler varsler ingen.** Alt Slack leser som en omtale, får et usynlig tegn etter åpningsparentesen. Det leses likt overalt, men ingen chatteverktøy reagerer på det. |
| Et bilde, i beskrivelsen eller et svar av typen **Formatert tekst** | **Bilder blir lenker.** Hvert bilde blir en lenke til samme adresse, så ingenting lastes inn fra der innsenderen valgte før en responder klikker på det. |
| En kodeblokk der språket er `mermaid`, uansett skrivemåte | **Diagrammer blir kode.** Den lagres som ren kode, så den viser teksten sin i stedet for å tegne et diagram. |
| Bildesyntaks eller en diagramblokk i tittelen | **Tittelen er ren tekst.** De får også det usynlige tegnet, så uansett hvor tittelen havner — en episode, en chatmelding, en notatmal — laster den ingenting og tegner ingenting. De usynlige tegnene teller med i tittelens grense. |

Alt annet — lenker, resten av Markdown, valg i nedtrekkslister, tall, datoer, en avkrysset boks — lagres slik innsenderen ga det, og innsendingen beholder innsenderens navn og e-post slik de ble skrevet.

## Neste steg

:::cards
- [Bygg et skjema](/docs/forms/building): Spørsmålene som fyller disse feltene, skjulte spørsmål og maler.
- [Hendelsesinnstillinger og automatisering](/docs/incidents/settings): Hendelsesmaler og egendefinerte felt.
- [Hendelsesnotater, eiere og feed](/docs/incidents/notes-owners-and-feed): Private notater, offentlige notater og eiere.
- [Deling og sikkerhet](/docs/forms/sharing-and-security): Hvem som kan sende inn, og hvor ofte.
:::
