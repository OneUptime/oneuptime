# OneUptime AI i Datasikkerhet

OneUptime AI arbeider med det Datasikkerhet har funnet, uten å se dataene dine. Den får navn, former, antall og konfigurasjon, aldri en verdi fra dataene dine, en maskert prøve, en post eller en tilkoblingsstreng. Hver funksjon kjører på prosjektets egen modell, også en selvhostet, og hver side, kontroll, skanning og integrasjon i Datasikkerhet virker med AI slått av.

:::cards
- [Hva OneUptime AI ser](#hva-oneuptime-ai-ser): Hva hver funksjon sender, og hva den aldri sender.
- [Se det selv](#se-det-selv): De nøyaktige inndataene et av problemene dine ville sendt.
- [Din egen modell](#din-egen-modell): Hver funksjon på prosjektets leverandør, Ollama, vLLM eller et hvilket som helst OpenAI-kompatibelt endepunkt.
- [Slik måles det](#slik-måles-det): Hver funksjon på faste tilfeller, før hver utgivelse.
:::

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

**Forklar med AI** og **Spør AI** leser også først teamets [AI-kontekst](/docs/ai/ai-context), når den finnes: notatene teamet ditt har skrevet for OneUptime AI om systemene deres. **Analyse av nye problemer** leser den også.

### Tekst systemene dine skrev, er data

Et datalagers navn, sky-ID-en, taggene, bevisene en sky svarte med og nøkkelen til et attributt kommer fra skyene og koden din, så alle som kan gi en bucket navn eller tagge en ressurs, skriver med på det OneUptime AI leser. OneUptime AI får hver instruksjon i en egen melding, og den teksten i en andre melding, som data:

- hver tekst holdes til en lengde og settes på én linje, og det som ligner en hemmelighet, en e-postadresse eller en IP-adresse, utelates;
- tekst som leses som instruksjoner til en AI, som «ignore previous instructions», merkes, og OneUptime AI får beskjed om aldri å følge den;
- et strukturert svar, som feltforslagenes, leses strengt: objektet det ble bedt om, eller ikke noe svar.

### Hva som lagres

Raden for hvert kall i **Prosjektinnstillinger → KI → AI-logger** sier hvilken funksjon som kalte hvilken modell, med tokenene og kostnaden. Den beholder aldri hva som ble sendt eller svart: alle med rollen Prosjektmedlem eller Leser leser AI-loggene, og postene i Datasikkerhet er for eierne deres og sikkerhetsrollene. OneUptimes egen telemetri registrerer heller aldri hva Forklar med AI eller feltforslagene sendte, selv der serverens operatør registrerer hva andre AI-kall sender.

Når et kall mislykkes, beholder Forklar med AI og feltforslagene ikke et ord av leverandørens feil, som kan sitere det som ble sendt. Kodeagenten bak Fiks med AI og chatten i Spør AI beholder fortsatt leverandørfeilen fra et mislykket kall i raden sin.

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
