# Tijdlijn van bereikbaarheidsschema's

De tijdlijn van bereikbaarheidsschema's toont alle bereikbaarheidsschema's van uw project in één raster per week of per maand: een rij per schema, een kolom per dag. Hij beantwoordt "wie heeft er deze week dienst in mijn team, of in de hele organisatie?" zonder elk schema te openen.

De diensten op de tijdlijn zijn dezelfde waarmee OneUptime mensen oproept, inclusief overrides van gebruikers: de tijdlijn, de escalatieregels en de agendafeeds lezen ze allemaal van dezelfde plek.

```mermaid title="Eén set diensten achter de tijdlijn, het oproepen en de agendafeeds"
flowchart TB
    subgraph setup["Elk schema"]
        direction LR
        layers["Lagen en rotaties"]
        overrides["Overrides van gebruikers"]
    end
    layers --> shifts["Wie er dienst heeft, en wanneer"]
    overrides --> shifts
    shifts --> timeline["Tijdlijn van bereikbaarheidsschema's"]
    shifts --> paging["Escalatieregels roepen hen op"]
    shifts --> feeds["Agendafeeds"]
```

## De tijdlijn openen

- **Bereikbaarheidsdienst** > **Tijdlijn van bereikbaarheidsschema's** toont elk schema dat u kunt zien, gegroepeerd per eigenaarsteam. De knop **Tijdlijnweergave** op **Bereikbaarheidsschema's** opent dezelfde pagina.
- **Teams** > een team > **Bereikbaarheidsschema's** toont alleen de schema's van dat team.

Een team is eigenaar van een schema wanneer het op de pagina **Eigenaren** van het schema staat. Schema's zonder eigenaarsteam staan gegroepeerd onder **No owner team**. Zet **Group by team** uit om alle schema's in één lijst te zien, gesorteerd op naam.

## Het raster lezen

| Op het raster | Wat het betekent |
| --- | --- |
| Een balk | Een dienst: wie er dienst heeft, van wanneer tot wanneer. Een persoon heeft in elk schema dezelfde kleur. |
| Een vervaagde balk | Een dienst in het verleden. |
| Een balk met **⇄** | Een override: iemand neemt een dienst over. De smalle baan eronder noemt de persoon wiens dienst wordt overgenomen, doorgestreept. |
| Een gearceerd amberkleurig blok | Een dekkingsgat: niemand heeft dienst. Een waarschuwing die naar dat schema escaleert, roept dan niemand op. |
| De rode lijn | Nu. |
| De regel onder de naam van een schema | Wie er nu dienst heeft, of **No one on call now**. |

Beweeg de muis over een balk of een gat, of ga er met het toetsenbord naartoe, voor de details.

Onder het raster toont **On call this week** (**On call this month** in de maandweergave) iedereen die in de periode dienst heeft. Beweeg de muis over een naam om te zien hoe lang die persoon dienst heeft, en in hoeveel schema's.

## De periode en de tijdzone wijzigen

- Wissel tussen **Week** en **Month**, blader met de pijlen en ga terug met **Today**.
- Tijden worden in uw eigen tijdzone getoond. De tijdzoneknop opent **View timeline in timezone**, dat de tijdlijn in een andere zone toont zonder te veranderen wanneer iemand dienst heeft: elk schema draagt de dienst nog steeds over in zijn eigen tijdzone.
- De tijdlijn beslaat 180 dagen terug en 365 dagen vooruit.

> [!NOTE]
> Eerdere diensten worden opnieuw berekend uit de huidige instellingen van elk schema, dus ze tonen de rotatie zoals die nu is ingesteld, wat kan verschillen van wie destijds echt is opgeroepen. Voor de uren die mensen echt dienst hadden, gebruikt u **Bereikbaarheidsdienst** > **Rapporten** > **Bereikbaarheidstijd gebruiker**.

## Een schema of een persoon vinden

- **Zoeken** vindt namen van schema's, namen van teams en de mensen die dienst hebben.
- Het teamfilter beperkt de weergave tot één team of tot **My teams**; **Schedules I'm on** houdt alleen de schema's over waar u deel van uitmaakt.
- Klik boven het raster op **with no one on call now** of **with coverage gaps this week** (**with coverage gaps this month** in de maandweergave) om alleen die schema's te zien. Klik er nogmaals op om ze allemaal te zien.
- Klik op een persoon onder het raster, of op een van diens balken, om al diens diensten te markeren. **Clear highlight** maakt dat ongedaan, en **Clear filters** zet de zoekopdracht en de filters terug.

## Wie wat ziet

| Geldt voor | Regel |
| --- | --- |
| Machtigingen | Dezelfde machtigingen en labelbeperkingen als **Bereikbaarheidsschema's**, plus de machtiging om lagen van schema's te lezen. |
| Overrides | Wiens dienst een override overneemt, ziet alleen wie overrides van gebruikers mag lezen. Alle anderen zien nog steeds wie wordt opgeroepen. |
| Aantal schema's | Tot 250 schema's tegelijk, gesorteerd op naam. De pagina **Bereikbaarheidsschema's** van een team beperkt het tot de schema's van dat team. |
| Abonnement | Op OneUptime Cloud heeft de tijdlijn het abonnement **Growth** nodig, net als bereikbaarheidsschema's. |

## Volgende stappen

:::cards
- [Bereikbaarheidsschema's](/docs/on-call/schedules): Stel in wie elkaar afwisselen, de lagen en de diensturen.
- [Agendafeeds](/docs/on-call/calendar-feeds): Zet uw diensten in Google Agenda, Outlook of Apple Agenda.
- [Escalatieregels](/docs/on-call/escalation-rules): Bepaal wie elk niveau van een bereikbaarheidsbeleid oproept.
:::
