# OneUptime AI i Datasikkerhet

OneUptime AI arbeider med det Datasikkerhet har funnet, uten å se dataene dine. Den får navn, former, antall og konfigurasjon, aldri en verdi fra dataene dine, en maskert prøve, en post eller en tilkoblingsstreng. Hver funksjon kjører på prosjektets egen modell, også en selvhostet, og hver side, kontroll, skanning og integrasjon i Datasikkerhet virker med AI slått av.

:::cards
- [På egen hånd](#på-egen-hånd): Hva den gjør med hvert nytt problem, hva som venter på deg, og AI-reglene.
- [Hva OneUptime AI ser](#hva-oneuptime-ai-ser): Hva hver funksjon sender, og hva den aldri sender.
- [Se det selv](#se-det-selv): De nøyaktige inndataene et av problemene dine ville sendt.
- [Din egen modell](#din-egen-modell): Hver funksjon på prosjektets leverandør, Ollama, vLLM eller et hvilket som helst OpenAI-kompatibelt endepunkt.
- [Slik måles det](#slik-måles-det): Hver funksjon på faste tilfeller, før hver utgivelse.
:::

## På egen hånd

Med **Jobb med nye problemer** slått på under **Datasikkerhet → KI**, slik det er for nye prosjekter, jobber OneUptime AI på egen hånd med hvert nytt kritisk eller høyt problem. Den skriver problemets analyse, slik **Forklar med AI** gjør og ut fra det den sender, og legger den på problemets **Tidslinje**. For et telemetriproblem foreslår den rensingsreglene som skjuler dataene i ny telemetri. Et forslag venter på den siden under **Venter på deg**, de mest risikable først, med hva som endres, hvorfor, hvordan det bevises og hvordan det angres. **Godkjenn** gjør endringen med dine egne tillatelser: en rensingsregel krever tillatelse til å lage rensingsregler for logger, rensingsregler for spor eller pipelineregler for målinger. **Avvis forslaget** sier nei, med en begrunnelse som legges på problemets tidslinje. Problemets egen kontroll avgjør om en endring virket: datalageret kontrolleres på nytt, og problemet løses når ingen av dataene er igjen.

OneUptime AI foreslår også eiere for datalagre som ikke har noen, ut fra det som allerede peker på dem: datalagerets skytagger, tjenestene som bruker det, og eierne deres, kodeeierne til filen som deklarerer det, hvem som endret det ifølge skyens endringslogg, og hvem som la det til i OneUptime. Den nevner bare teamene og personene i ditt eget prosjekt, sier hvor sikker den er, og sier hvor bevisene er uenige. Forslaget for et sensitivt datalager kommer med problemet **Ingen eier dette sensitive datalageret**, og andre nye datalagre får sitt én gang om dagen og når en skytilkobling leses for første gang. Når eierne av tre eller flere datalagre hviler på samme tagg eller samme begynnelse av navnet, foreslår den også eierregelen som holder det neste lignende datalageret med en eier, og sier hvor mange datalagre regelen ville samsvare med. Forslagene venter under **Eiere til gjennomgang**, på denne siden og under **Datalagre**: **Godkjenn** legger til eierne med dine egne tillatelser, og de får beskjed som enhver eier; **Endre og godkjenn** velger andre eiere først; **Angre** tar tilbake nøyaktig de eierne som ble lagt til, og regelen med dem. Å legge til en eier endrer hvem som får beskjed, så det venter alltid på deg, uansett hva en KI-regel sier.

Som standard spør OneUptime AI før hver endring, unntatt en som bare skjuler data, kan angres og er bevist trygg, og den sletter aldri data eller varsler noen uten å spørre. En endring den gjorde uten å spørre, står under **Gjort av AI**, med **Angre**. **Hvorfor AI ikke handlet** viser problemene den så på og lot være, og hvorfor. Hvert forslag, hver godkjenning, avvisning og angring står på problemets og datalagerets **Tidslinje**. Med bryteren av, eller KI av for prosjektet, fungerer datasikkerhet som alltid, og **Forklar med AI** og **Fiks med AI** virker fortsatt når du trykker på dem.

På siden til et problem viser kortet **OneUptime AI** over **Slik fikser du det** analysen og det som ble foreslått for problemet, med de samme knappene. **Oversikt** i datasikkerhet sier hvor mange lekkasjer OneUptime AI begrenset denne uken, og hvor mange forslag som venter på deg. **Oversikt** teller uke for uke hva som kom ut av endringene: se [Hvor godt OneUptime AI gjør det](/docs/ai/ai-sre#hvor-godt-oneuptime-ai-gjør-det).

### AI-regler

Under **AI-regler** på **Datasikkerhet → KI** sier en regel hvilke problemer OneUptime AI jobber med - etter kontroll eller kontrollgruppe, alvorlighetsgrad, og datalagerets sensitivitet, type, leverandør, miljø, etiketter, datakategorier og tjeneste - og for hver type arbeid, **Analyser**, **Begrens**, **Rettelse** og **Vurder**, om den er **Av**, **Foreslå** (den foreslår og venter på deg) eller **Uten å spørre**. Når flere regler passer til et problem, kjører en type arbeid hvis én av dem slår den på, og **Foreslå** går foran **Uten å spørre**. Hvert forslag sier hvilken regel som avgjorde det. Uten regel gjelder prosjektets standarder: analyser kritiske og høye problemer, og foreslå alt annet.

AI-regler hører til hele prosjektet, som AI-reglene for hendelser og varsler: prosjekteiere og prosjektadministratorer endrer dem, og det gjør alle som har fått tillatelsene for AI-regler. Sikkerhetsrollene ser hva OneUptime AI foreslo og gjorde, men ikke reglene.

## Hva OneUptime AI ser

Ingen funksjon sender noen gang en modell:

- en verdi fra dataene dine;
- en maskert prøve, som `j***@e******.com`: en maskert e-postadresse bærer fortsatt et domene, og et maskert kort de fire siste sifrene;
- en post fra telemetrien din: en logglinje, et span eller en økt;
- en tilkoblingsstreng, en nøkkel eller en annen hemmelighet.

Datasikkerhet leser dataene dine selv, i sine egne skanninger, og beholder ingenting av dem. Det den sender OneUptime AI, bygges ett sted, ut fra en liste over hva som kan sendes, og en test feiler når en funksjon sender en modell noe annet.

| Funksjon | Hva den sender | Kjører av seg selv |
| --- | --- | --- |
| **Forklar med AI** | Problemets tittel, alvorlighetsgrad og bevis, hvorfor kontrollen er viktig, og rettingen for datalagerets sky; datalagerets navn, type, region og sky-ID, sensitiviteten og navnene på datatypene; for et problem i telemetrien, hvor hver type data ble funnet: attributtet, loggteksten eller prompten den står i | Nei: en person ber om den, på siden til et problem |
| **Analyse av nye problemer** | Problemets tittel, alvorlighetsgrad og bevis, hvorfor kontrollen er viktig, og rettingen for datalagerets sky; datalagerets navn, type, region og sky-ID, sensitiviteten og navnene på datatypene; for et problem i telemetrien, hvor hver type data ble funnet: attributtet, loggteksten eller prompten den står i | Ja: et nytt kritisk eller høyt problem starter den, mens **Jobb med nye problemer** er slått på |
| **Fiks med AI** | Det Forklar med AI sender, som en forespørsel til kodeagenten, som deretter leser kodelagerets egen kode for å gjøre endringen | Nei: en person ber om den, i et kodelager vedkommende kan endre under **Kode** |
| **Forslag for felt som ingen detektor plasserte** | Typen datalager og datatypene AI kan nevne; navnet på hvert felt, navnene på feltene ved siden av og formene på verdiene, hver bokstav som `a` eller `A` og hvert siffer som `9`; hvor mange verdier som ble lest, og hvor lange de er | Ja: innholdsskanningen av et datalager starter dem |
| **Spør AI** | Datalagrene, problemene og tilgangene personen har lov til å lese i Datasikkerhet; hva som ble funnet hvor, hver datatype etter plassering, med antall og sikkerhet | Nei: en person stiller et spørsmål |
| **Eiere for datalagre** | Datalagerets navn, type, leverandør, miljø og sensitivitet, og navnene på datatypene; hva som peker på en eier: skytaggene, tjenestene som bruker det, kodeeierne til filen som deklarerer det, og endringene som er gjort i det; teamene som bevisene nevner, ved navn, og personene de nevner, bare som nummererte kandidater, aldri ved navn eller e-postadresse | Ja: Et datalager uten eiere starter den, én gang om dagen for nye datalagre og når en skytilkobling leses for første gang, mens **Jobb med nye problemer** er slått på |

**Forklar med AI** og **Spør AI** leser også først teamets [AI-kontekst](/docs/ai/ai-context), når den finnes: notatene teamet ditt har skrevet for OneUptime AI om systemene deres. **Analyse av nye problemer** leser den også.

### Tekst systemene dine skrev, er data

Et datalagers navn, sky-ID-en, taggene, bevisene en sky svarte med og nøkkelen til et attributt kommer fra skyene og koden din, så alle som kan gi en bucket navn eller tagge en ressurs, skriver med på det OneUptime AI leser. OneUptime AI får hver instruksjon i en egen melding, og den teksten i en andre melding, som data:

- hver tekst holdes til en lengde og settes på én linje, og det som ligner en hemmelighet, en e-postadresse eller en IP-adresse, utelates;
- tekst som leses som instruksjoner til en AI, som «ignore previous instructions», merkes, og OneUptime AI får beskjed om aldri å følge den;
- et strukturert svar, som feltforslagenes, leses strengt: objektet det ble bedt om, eller ikke noe svar.

### Hva som lagres

Raden for hvert kall i **Prosjektinnstillinger → KI → AI-logger** sier hvilken funksjon som kalte hvilken modell, med tokenene og kostnaden. Den beholder aldri hva som ble sendt eller svart: alle med rollen Prosjektmedlem eller Leser leser AI-loggene, og postene i Datasikkerhet er for eierne deres og sikkerhetsrollene. OneUptimes egen telemetri registrerer heller aldri hva Forklar med AI eller feltforslagene sendte, selv der serverens operatør registrerer hva andre AI-kall sender.

Når et kall mislykkes, beholder Forklar med AI og feltforslagene ikke et ord av leverandørens feil, som kan sitere det som ble sendt. Kodeagenten bak Fiks med AI og chatten i Spør AI beholder fortsatt leverandørfeilen fra et mislykket kall i raden sin.

Eierforslagene tar vare på det samme som Forklar med AI: Radene for kallene deres nevner funksjonen, modellen, tokenene og kostnaden, aldri hva som ble sendt eller svart, og ikke et ord av feilen i et mislykket kall.

## Se det selv

**Datasikkerhet → Innstillinger → OneUptime AI** viser alt dette for prosjektet ditt:

- **Hva OneUptime AI ser**: hver funksjon, hva den sender og aldri sender, hva som starter den, modellen den kjører på, og hva som lagres av den. Modellen nevnes for alle som har lov til å lese prosjektets LLM-leverandører.
- **Vis et eksempel**: de nøyaktige inndataene **Forklar med AI** ville sendt for det mest risikable åpne problemet ditt, slik den ville sendt dem, med det **Fiks med AI** ville bedt om. Prosjektets AI-kontekst, som kommer først, vises med lengden sin. Den viser bare et problem du har lov til å lese.

**Prosjektinnstillinger → KI → LLM-leverandører** lenker til den, for dem som velger modellen.

## Din egen modell

Hver AI-funksjon i Datasikkerhet kjører på modellen prosjektet ditt valgte:

- **Forklar med AI** og feltforslagene kjører på leverandøren en AI-regel velger for jobben, ellers på prosjektets standard-LLM-leverandør, ellers på serverens egen.
- Kodeagenten i **Fiks med AI** kjører på leverandøren en AI-regel velger, ellers på en av prosjektets egne leverandører, ellers på serverens egen.
- **Spør AI** kjører på leverandøren som er valgt i chatten, ellers på prosjektets standard.

En selvhostet modell kjører dem alle: Ollama, vLLM eller et hvilket som helst OpenAI-kompatibelt endepunkt du legger til under **Prosjektinnstillinger → KI → LLM-leverandører**. På en server uten nettverkstilgang er vLLM-en som følger med Helm-chartet, serverens egen leverandør, så ingenting forlater serveren.

### Med AI slått av

Med **Aktiver AI** slått av under **Prosjektinnstillinger → KI → AI-funksjoner** sender OneUptime AI ingenting, og Datasikkerhet fortsetter å virke som før: hver side, kontroll, skanning og integrasjon. Ingen AI-knapp vises på et problem, og det spørres ikke om noe felt etter en skanning.

## Slik måles det

Hver AI-funksjon i Datasikkerhet måles på et fast sett med oppdiktede tilfeller, bygget slik funksjonen bygger inndataene sine og vurdert ut fra hva et riktig svar sier: en forklaring som nevner rettingen og ikke gjentar noe et datalagers navn ba den si, riktig datatype for hvert felt, en retting som endrer det kontrollen trenger og ingenting annet, og et svar ut fra det Spør AI leste. Tilfellene kjøres mot en fastlåst modell hver natt, ved hver endring av en AI-prompt i Datasikkerhet og før hver utgivelse, som krever at hver funksjon når terskelen sin.

Eierforslagene vurderes på om de nevner eieren bevisene peker på, velger ingen når de ikke peker på noen, og er usikre der bevisene er uenige.

For å måle din egen modell på de samme tilfellene kjører du evalueringen fra en utsjekk av OneUptime, med nøkkelen til modellen din, hvis den trenger en, i `AI_EVAL_LLM_API_KEY`:

```bash
npm run ai-data-security-eval -- --llm-type=Ollama --model=llama3.1:70b --base-url=http://localhost:11434
```

## Neste steg

:::cards
- [Integrasjoner for Datasikkerhet](/docs/data-security/integrations): Hva Forklar med AI og Fiks med AI gjør på et problem.
- [LLM-leverandører](/docs/ai/llm-provider): Legg til din egen modell, også en selvhostet.
- [Sensitive datatyper](/docs/data-security/data-types): Hvordan felt som ingen detektor kunne plassere, får forslag.
- [Kontroller og problemer i Datasikkerhet](/docs/data-security/checks-and-issues): Hva hvert problem betyr, og hvordan du fikser det.
:::
