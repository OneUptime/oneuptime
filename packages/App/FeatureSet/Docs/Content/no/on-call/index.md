# Vakt – Oversikt

Vakt er hvordan OneUptime får en person til å ta tak i et problem, når som helst på døgnet. Når en hendelse, et varsel eller en episode trenger noen, tilkaller vaktpolicyene folk nivå for nivå til noen bekrefter, og hver person nås slik de selv har valgt: en push-varsling, en SMS, et anrop, en e-post eller en chatmelding. Denne siden viser hvordan delene henger sammen, og hvor hver del ligger. Hvert ord som brukes om vakt, er forklart med en setning eller to i [Ordliste](/docs/introduction/glossary#vaktpolicy).

> [!TIP]
> Ny her? Følg guiden først: [Bli varslet via telefon, SMS eller push](/docs/guides/paging).

:::cards
- [Slik når en tilkalling noen](#slik-når-en-tilkalling-noen): Fra en ny hendelse til personen som svarer.
- [Byggesteinene](#byggesteinene): Policyer, eskaleringsregler, vaktplaner, overstyringer og personlige regler.
- [Sett opp vakt](#sett-opp-vakt): Fra ingenting til et team som tilkalles, i fem steg.
- [Hvor vakt ligger](#hvor-vakt-ligger): Menyen Vakt, seksjon for seksjon.
:::

## Slik når en tilkalling noen

```mermaid title="Fra en ny hendelse til personen som svarer"
flowchart TB
    record["Hendelse, varsel<br/>eller episode"] --> policy["Vaktpolicyene"]
    policy --> level["Neste<br/>eskaleringsregel"]
    level --> people["Den som har vakt,<br/>team og personer"]
    people --> rules["Deres personlige<br/>vaktregler"]
    rules --> ack{"Bekreftet<br/>i tide?"}
    ack -->|"Ja"| stop["Tilkallingen stopper"]
    ack -->|"Nei"| level
```

1. En ny hendelse, et nytt varsel eller en ny episode kjører vaktpolicyene sine med en gang: dem som er valgt på den, og dem vaktreglene legger til. Hver policy kjører for seg. En vaktregel satt til **Bare i arbeidstiden** lar policyene den legger til, vente til arbeidstiden begynner.
2. Den første eskaleringsregelen i en policy tilkaller med en gang: den som har vakt i vaktplanene dens akkurat nå, hvert medlem av teamene dens og personene den nevner.
3. Er en av dem borte, sender en brukeroverstyring tilkallingen til personen som dekker for dem, eller hopper over dem.
4. Hver person nås gjennom sine personlige vaktregler: hvilken av metodene deres som prøves, og etter hvor lang tid. En tilkalling uten regel når dem likevel på metodene de har verifisert.
5. Bekrefter ingen før ventetiden til regelen er ute, tilkaller neste regel. Etter den siste starter policyen på nytt hvis den gjentas, og ellers stopper den.

Å bekrefte eller løse hendelsen, varselet eller episoden stopper alle policyer som fortsatt tilkaller for den. OneUptime fører kjørende policyer et steg videre hvert minutt og registrerer hver kjøring, regel for regel, i **Utførelseslogger**.

Første gang en tilkalling når noen, registrerer OneUptime det på hendelsen, varselet eller episoden som `First Paged At`. En måling kan telle derfra: **Tid til bekreftelse etter tilkalling** måler hvor lang tid folk brukte på å svare etter at de ble tilkalt, ikke hvor lenge hendelsen, varselet eller episoden ventet før noen ble tilkalt. Se [Tid til bekreftelse etter tilkalling](/docs/incidents/settings#tid-til-bekreftelse-etter-tilkalling).

> [!NOTE]
> En hendelse, et varsel eller en episode som opprettes allerede bekreftet eller løst, kjører ingen av policyene sine, og feeden sier det. Se [Opprettet allerede bekreftet eller løst](/docs/alerts/index#opprettet-allerede-bekreftet-eller-løst).

## Byggesteinene

Se [Ordliste](/docs/introduction/glossary) for ordene som brukes på tvers av OneUptime.

| Del | Hva den avgjør | Les mer |
| --- | --- | --- |
| Vaktpolicy | Hvem som tilkalles om en hendelse eller et varsel, nivå for nivå | [Vaktpolicyer](/docs/on-call/policies) |
| Eskaleringsregel | Ett nivå i en policy: hvem det tilkaller, og hvor lenge det venter på en bekreftelse | [Eskaleringsregler](/docs/on-call/escalation-rules) |
| Vaktplan | Hvem som har vakt til enhver tid, etter hvert som folk bytter på | [Vaktplaner](/docs/on-call/schedules) |
| Brukeroverstyring | Hvem som dekker for noen mens de er borte | [Brukeroverstyringer](/docs/on-call/user-overrides) |
| Slik når man meg | Hvordan én person nås: hvilken metode, og etter hvor lang tid | [Slik når man meg](/docs/notifications/on-call-rules) |
| Policy for innkommende anrop | Et telefonnummer som ringer til den som har vakt | [Policy for innkommende anrop](/docs/on-call/incoming-call-policy) |

Policyer, eskaleringsregler, vaktplaner og overstyringer hører til prosjektet, under **Vakt**. Varslingsmetoder og personlige vaktregler hører til hver person, under **Brukerinnstillinger**: en administrator kan se oppsettet til noen, men bare personen selv kan verifisere telefonen eller e-posten sin. Se [Slik når OneUptime deg](/docs/notifications/index).

## Sett opp vakt

:::steps
### Bygg en vaktplan

Åpne **Vakt** fra menyen **Produkter**, og gå til **Vaktplaner**. Klikk på **Opprett vaktplan**, gi den et navn, og velg personene under **Hvem bytter på å ha vakt?** i den rekkefølgen de bytter på. Se [Vaktplaner](/docs/on-call/schedules).

### Opprett en policy

Gå til **Vaktpolicyer**, og klikk på **Opprett vaktpolicy**. Velg vaktplanen under **Hvem varsles først?**. Den blir den første eskaleringsregelen i policyen, **Level 1**, som venter 30 minutter på en bekreftelse.

### Legg til de neste nivåene

Klikk på **Legg til eskaleringsregel** på siden **Eskaleringsregler** for policyen, for hvert nivå etter det første: neste person i samme vaktplans rotasjon, en teamleder, en leder. Se [Eskaleringsregler](/docs/on-call/escalation-rules).

### Kjør policyen automatisk

Den første policyen i et prosjekt kan gjøre dette allerede når den opprettes: la **Utløs den ved hver nye hendelse og hvert nye varsel** være slått på. En senere policy får det samme spørsmålet, slått av fra start. For å kjøre en policy for bare noen hendelser eller varsler, for eksempel hver kritiske, går du til **Hendelser → Regler → Vaktregler** eller **Varsler → Regler → Vaktregler** og legger til en regel som passer på dem. Se [Hva som kjører en policy](/docs/on-call/policies#hva-som-kjører-en-policy).

### Sjekk at alle kan nås

Åpne **Vakt → Beredskap**. Alle policyene dine kan tilkalle, står oppført som **Klar**, **Må settes opp** eller **Utilgjengelig**, med det som mangler. Se [Beredskap og rapporter](/docs/on-call/readiness).
:::

> [!NOTE]
> I OneUptime Cloud er vaktpolicyer og eskaleringsregler med i alle abonnementer. Vaktplaner, brukeroverstyringer, utførelseslogger og rapporten om vakttid krever abonnementet **Growth**.

## Hvor vakt ligger

Åpne **Vakt** fra menyen **Produkter** i topplinjen. Den åpner på **Vaktpolicyer**, på `/dashboard/{projectId}/on-call-duty/policies`, og sidemenyen inneholder resten:

| Seksjon | Sider |
| --- | --- |
| **Policyer** | **Vaktpolicyer**, **Beredskap**: hvem policyene dine faktisk kan nå, og **Policyer for innkommende anrop**: et telefonnummer som ringer til den som har vakt |
| **Tidsplaner** | **Vaktplaner**, **Tidslinje for vaktplaner**, **Brukeroverstyringer**: hvem som dekker for noen mens de er borte, og **Kalenderfeeder** |
| **Avansert** | **Utførelseslogger** og **Arkiverte policyer** |
| **Rapporter** | **Brukerens vakttid**: hvor lenge hver person hadde vakt |
| **Arbeidsområde** | **Slack**, **Microsoft Teams** og **Mattermost**: regler som legger ut vakthendelser i en kanal |
| **Innstillinger** | **Egendefinerte felt**, **Etikettregler** og **Eierregler** |
| **Utvikler** | **Terraform**, **API**, **CLI** og **AI-assistenter**: vakt satt opp fra kode |

**Policyer** og **Tidsplaner** er åpne; de andre seksjonene starter sammenslått, og en seksjon åpner seg selv når du er på en av sidene i den. **Arbeidsområde** viser chatverktøyene prosjektet har koblet til, eller **Koble til et arbeidsområde** når det ikke har noen.

Når du har vakt for en policy, viser klokken øverst til høyre det. Klikk på den for å åpne **Mine vaktpolicyer**: alle policyer du har vakt for, i alle prosjektene dine, og om du er nevnt direkte, i et team eller i en vaktplan.

## Feilsøking

:::details Ingen ble tilkalt for en ny hendelse
Åpne siden **Vaktutførelser** for hendelsen. Er den tom, hadde hendelsen ingen vaktpolicy: ingen ble valgt på den, og ingen vaktregel passet. En kjøring med **Utførelse fullført - ingen varslet** gikk gjennom alle eskaleringsregler uten å finne noen: som regel en vaktplan der ingen har vakt. Se [Utførelseslogger](/docs/on-call/policies#utførelseslogger). En kjøring med **Venter** venter på arbeidstiden for en vaktregel satt til **Bare i arbeidstiden** og tilkaller ingen før den begynner.
:::

:::details Noen ble tilkalt på feil kanal, eller ikke i det hele tatt
Åpne **Vakt → Beredskap**, og klikk på **Dekning** i raden til personen. Den viser metodene de har verifisert, og hver alvorlighetsgrad de ikke har noen regel for. Bare de selv kan rette det, under **Brukerinnstillinger**: send dem en påminnelse om oppsettet fra den samme siden. Se [Beredskap og rapporter](/docs/on-call/readiness). På OneUptime Cloud kan en telefon som blokkerer ukjente oppringere, dempe et varsel: legg [OneUptimes numre](/docs/on-call/phone-number-whitelist) til i tillatelseslisten.
:::

:::details En person på ferie blir fortsatt tilkalt
Legg til en brukeroverstyring med personen under **Hvem er borte?**. En under **Vakt → Tidsplaner → Brukeroverstyringer** gjelder for alle policyer; en på en policys egen side **Brukeroverstyringer** gjelder bare for den policyen. Se [Brukeroverstyringer](/docs/on-call/user-overrides).
:::

## Neste steg

:::cards
- [Vaktpolicyer](/docs/on-call/policies): Opprett en policy, bestem hva som kjører den, og les hva den gjorde.
- [Eskaleringsregler](/docs/on-call/escalation-rules): Tilkall folk nivå for nivå til noen svarer.
- [Vaktplaner](/docs/on-call/schedules): Rotasjoner, lag og overleveringer.
- [Slik når OneUptime deg](/docs/notifications/index): Metodene og reglene som avgjør hvordan hver person nås.
:::
