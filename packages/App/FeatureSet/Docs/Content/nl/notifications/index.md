# Hoe OneUptime je bereikt

OneUptime bereikt je op twee manieren. Het roept je op wanneer er tijdens je dienst een incident of waarschuwing afgaat, en het houdt je op de hoogte van wat van jou is: een notitie bij je incident, een monitor waarvan de status veranderde, je volgende dienst. Beide komen aan op de adressen die je bijhoudt in **Gebruikersinstellingen**, project voor project. Deze pagina legt uit hoe de onderdelen samenhangen, waar ze staan en waarmee je begint.

:::cards
- [Drie pagina's, drie vragen](#drie-paginas-drie-vragen): Methoden, bereikbaarheidsregels en meldingsinstellingen, en wat elk ervan bepaalt.
- [Waar je ze vindt](#waar-je-ze-vindt): De pagina's van de gebruikersinstellingen, sectie voor sectie.
- [Waarmee je begint](#waarmee-je-begint): De methoden, regels en instellingen die een nieuw lid krijgt.
- [Als geen regel past](#als-geen-regel-past): Hoe een oproep je toch bereikt, en wie het te horen krijgt.
:::

## Hoe het werkt

```mermaid title="Twee manieren waarop OneUptime je bereikt, via dezelfde methoden"
flowchart TB
    page["Een incident of<br/>waarschuwing roept je<br/>op tijdens je dienst"] --> rules["Je bereikbaarheidsregels"]
    owned["Er gebeurt iets met<br/>een item van jou"] --> settings["Je meldingsinstellingen"]
    rules --> methods["Je geverifieerde<br/>methoden: e-mail,<br/>telefoon, push, chat"]
    settings --> methods
```

- Een bereikbaarheidsbeleid roept je op wanneer een van zijn escalatieregels jou noemt, een team waar je in zit, of een rooster waarin je dienst hebt. Je bereikbaarheidsregels bepalen dan welke van je methoden OneUptime probeert, en na hoe lang.
- Wanneer er iets gebeurt met een item van jou, of met je diensten, bepalen je meldingsinstellingen via welke kanalen het nieuws gaat.
- In beide gevallen gebruikt OneUptime alleen methoden die je hebt geverifieerd, in het project waar de oproep of het nieuws vandaan komt.

## Drie pagina's, drie vragen

| Pagina | Wat erop staat | De vraag die ze beantwoordt |
| --- | --- | --- |
| **Meldingsmethoden** | Je e-mailadressen, telefoonnummers, WhatsApp-nummers, Telegram-, Slack- en Microsoft Teams-accounts, pushapparaten en webhooks | Waar kan OneUptime me bereiken? |
| **Bereikbaarheidsregels** | Voor elk soort oproep en elke ernst: welke methode wordt geprobeerd en na hoe lang | Hoe word ik opgeroepen als ik dienst heb? |
| **Meldingsinstellingen** | Voor elke gebeurtenis rond een item van jou of rond je diensten: welke kanalen worden gebruikt | Waarover hoor ik verder nog, en waar? |

Ze zijn met opzet gescheiden. Alle kanalen aanzetten in **Meldingsinstellingen** roept je nooit op, en een methode die je niet hebt geverifieerd wordt nooit gebruikt, wat je regels ook zeggen.

> [!IMPORTANT]
> Methoden, regels en instellingen horen bij één project. Stel ze in elk project in waarin je werkt: **Gebruikersinstellingen** toont altijd het project waarin je zit.

## Waar je ze vindt

Open **Gebruikersinstellingen**, rechts in de balk onder de bovenste balk. Het zijmenu bevat alles over hoe OneUptime je bereikt:

| Sectie | Pagina's |
| --- | --- |
| **Aan de slag** | **Instellingschecklist**: wat er nog in te stellen is, in de volgorde die telt |
| **Waarschuwingen & meldingen** | **Meldingsmethoden**, **Bereikbaarheidsregels**, **Meldingsinstellingen** en **E-mailvoorkeuren**, waar je bepaalt hoeveel e-mails je nieuws oplevert |
| **Bereikbaarheidslogboeken** | **Bereikbaarheidslogboeken**: elke keer dat je in dit project werd opgeroepen, en wat er werd verzonden |
| **Beleid inkomend gesprek** | **Inkomende telefoonnummers**: het nummer waarop een beleid voor inkomende gesprekken je belt |
| **Agenda** | **Agendafeed**: je diensten in je agenda-app, en herinneringen voordat ze beginnen |
| **Profiel** | **Aangepaste velden**: gegevens die je project aan zijn leden vraagt |
| **Werkruimte** | **Slack** en **Microsoft Teams**: je eigen account, in elke werkruimte die het project heeft gekoppeld |

**Aan de slag** en **Waarschuwingen & meldingen** zijn open; de andere secties beginnen ingeklapt, en een sectie gaat vanzelf open wanneer je op een van haar pagina's bent. **Werkruimte** verschijnt alleen als het project Slack of Microsoft Teams heeft gekoppeld.

Projecteigenaren en -beheerders kunnen je instellingen ook bekijken: onder **Gebruikers** openen ze jouw rij en de sectie **Bereikbaarheid** daarvan, met **Gereedheid**, **Meldingsmethoden** en **Bereikbaarheidsregels**. Ze kunnen daar een methode voor je toevoegen, maar de code gaat naar de methode zelf, dus alleen jij kunt hem verifiëren.

## Waarmee je begint

Wanneer je lid wordt van een project met een geverifieerd aanmeld-e-mailadres, stelt OneUptime je zo in dat een oproep je altijd kan bereiken:

1. Je aanmeld-e-mailadres wordt toegevoegd als geverifieerde e-mailmethode.
2. Voor elke ernst, op elk van de vier tabbladen van **Bereikbaarheidsregels**, stuurt een regel je een e-mail zodra je wordt opgeroepen.
3. Een reeks nieuws over wat van jou is, en over je diensten, staat aan per e-mail. Zie [Meldingsinstellingen](/docs/notifications/notification-settings#wat-er-aanstaat-voor-een-nieuw-lid).

Elke methode die je later verifieert, krijgt dezelfde regels: een regel voor elke ernst, verstuurd zodra je wordt opgeroepen. Een telefoonnummer voor sms verifiëren betekent dus dat elke oproep je ook een sms stuurt. Wil je sms alleen voor kritieke oproepen, verwijder dan de sms-regels van de andere ernstniveaus. Zie [Persoonlijke bereikbaarheidsregels](/docs/notifications/on-call-rules#de-regels-waarmee-je-begint).

## De instellingschecklist

**Gebruikersinstellingen → Instellingschecklist** opent **Your setup checklist**: alles wat OneUptime nodig heeft om je te bereiken, in de volgorde die telt. Een stap linkt naar de pagina waar je hem uitvoert, en **Opnieuw controleren** leest alles opnieuw in.

| Sectie | Wat ze controleert |
| --- | --- |
| **So we can reach you** | Je hebt een methode, elke toegevoegde methode is geverifieerd, en minstens één ervan zit op een kanaal dat het project heeft aangezet |
| **How you want to be paged** | Elke ernst heeft een regel, op elk van de vier tabbladen van **Bereikbaarheidsregels** |
| **Staying informed** | Je hoort wanneer een dienst begint, en achter elk kanaal dat je in **Meldingsinstellingen** hebt aangezet, staat een geverifieerde methode |
| **Nice to have** | Een nummer voor inkomende gesprekken, je Slack- en Microsoft Teams-accounts, een agendalink en je profielvelden |

**Staying informed** noemt push alleen voor een update die je op geen andere manier bereikt: elke update die een nieuw lid via push krijgt, komt ook per e-mail.

**Nice to have** telt niet mee in de voortgangsbalk, en een stap die alleen iemand anders kan oplossen evenmin. De regel bovenaan vat het samen:

| Kop | Wat die betekent |
| --- | --- |
| **Alles is klaar** | Oproepen bereiken je, en er hoeft niets meer te gebeuren |
| **Er moeten nog een paar dingen worden ingesteld** | Een ernst heeft geen regel, of een stap is nog niet gedaan |
| **Nog niets kan je bereiken** | Geen van je methoden is bruikbaar: geen enkele is geverifieerd, of elke geverifieerde zit op een kanaal dat dit project heeft uitgezet |
| **Je bent ingesteld en hebt nu geen dienst** | Alles is klaar voor de dag dat een beleid je noemt |

## Als geen regel past

Een oproep kan je bereiken voor een soort en een ernst waarvoor je geen regel hebt: bijvoorbeeld een ernst die is toegevoegd nadat je lid werd. OneUptime roept je toch op, via wat je hebt geverifieerd:

1. Elke gratis methode die je hebt: pushapparaten, e-mailadressen, Slack en Microsoft Teams.
2. Heb je die niet, dan één betaalde methode, in deze volgorde: sms, een telefoongesprek, WhatsApp, Telegram. Het is de eerste die je hebt geverifieerd, op een kanaal dat het project heeft aangezet.
3. Heb je die ook niet, dan een webhook.

Je krijgt daarover een e-mail, en de eigenaren van het bereikbaarheidsbeleid ook, of die van het project als het beleid er geen heeft. Is er helemaal niets geverifieerd, dan kan de oproep niet worden afgeleverd, en zegt de e-mail dat. Deze e-mails worden tegengehouden zolang er oproepen blijven komen, zodat een storm van oproepen geen storm van e-mails wordt. Hoe je de ontbrekende regel toevoegt, staat bij [Persoonlijke bereikbaarheidsregels](/docs/notifications/on-call-rules#als-een-ernst-geen-regel-heeft).

## Probleemoplossing

:::details Ik had dienst, maar niets bereikte me
Open **Gebruikersinstellingen → Bereikbaarheidslogboeken**. Geen rij voor het incident betekent dat het bereikbaarheidsbeleid je nooit heeft opgeroepen: controleer de escalatieregels ervan en wie er dienst had. Bij een rij met de status **Fout** zegt **Statusbericht bekijken** waarom, bijvoorbeeld een kanaal dat het project heeft uitgezet. Controleer daarna of je methoden geverifieerd zijn en of **Your setup checklist** onder **So we can reach you** niets meer openstaand heeft.
:::

:::details Ik krijg e-mails over items waar ik nooit om heb gevraagd
Je bent eigenaar van het item, direct of via een team, of het item heeft geen eigenaren en jij bent projecteigenaar. Zet de gebeurtenis uit onder **Gebruikersinstellingen → Meldingsinstellingen**, of beperk de hoeveelheid onder **Gebruikersinstellingen → E-mailvoorkeuren**.
:::

:::details Ik heb een telefoonnummer toegevoegd, maar het staat niet in mijn regels
Een nummer komt in je regels zodra het geverifieerd is. Klik op **Verifiëren** in de rij ervan en voer de code in. Heeft de kaart ervan geen knop om toe te voegen, dan heeft het project dat kanaal uitgezet. Zie [Meldingsmethoden](/docs/notifications/notification-methods#een-kanaal-aanzetten-voor-je-project).
:::

## Volgende stappen

:::cards
- [Meldingsmethoden](/docs/notifications/notification-methods): Voeg de adressen toe waarop OneUptime je mag bereiken, en verifieer ze.
- [Persoonlijke bereikbaarheidsregels](/docs/notifications/on-call-rules): Bepaal welke methode elke oproep probeert, en wanneer.
- [Meldingsinstellingen](/docs/notifications/notification-settings): Kies het nieuws waarover je hoort, en via welke kanalen.
- [Escalatieregels](/docs/on-call/escalation-rules): Hoe een bereikbaarheidsbeleid niveau voor niveau bepaalt wie wordt opgeroepen.
:::
