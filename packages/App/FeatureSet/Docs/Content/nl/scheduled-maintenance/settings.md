# Onderhoudsregels en instellingen

De configuratie van onderhoud staat in **Geplande onderhoud**, niet in de **Projectinstellingen**: de regels die op elke nieuwe gebeurtenis werken, en de instellingen die elke gebeurtenis in het project vormgeven. Deze pagina is de naslag voor elk ervan, en voor wie ze mag wijzigen.

:::cards
- [De regels die een nieuwe gebeurtenis doorloopt](#de-regels-die-een-nieuwe-gebeurtenis-doorloopt): Op volgorde, en wat elke regel doet.
- [Herinneringsregels](#herinneringsregels): Eigenaren herinneren tot een gebeurtenis voltooid is.
- [Instellingen](#instellingen): Notitiesjablonen, aangepaste velden, metingen en nummering.
- [Wie ze mag wijzigen](#wie-ze-mag-wijzigen): De onderhoudsrollen, en de abonnementen.
:::

## Waar de onderhoudsinstellingen staan

Open **Geplande onderhoud** via het menu **Producten** in de bovenste balk. De secties **Regels** en **Instellingen** van het zijmenu zijn eerst ingeklapt, dus klap ze eerst uit. Elke pagina hier geldt voor het hele project, op een adres dat begint met `/dashboard/{projectId}/scheduled-maintenance-events/settings/`.

| Regelpagina        | Wat ze doet                                                         |
| ------------------ | ------------------------------------------------------------------- |
| **Eigenaarsregels** | Voegt eigenaren toe aan passende gebeurtenissen.                   |
| **Runbook-regels** | Start runbooks voor passende gebeurtenissen.                        |
| **Labelregels**    | Voegt labels toe aan passende gebeurtenissen.                       |
| **Reminder Rules** | Herinnert eigenaren met een interval tot een gebeurtenis voltooid is. |

De sectie **Instellingen** bevat **Status gebeurtenis**, behandeld in [Onderhoudsstatussen](/docs/scheduled-maintenance/states), **Gebeurtenis-sjablonen**, behandeld in [Sjablonen en terugkerende gebeurtenissen](/docs/scheduled-maintenance/templates), en daarna **Notitie-sjablonen**, **Aangepaste velden**, **Metingen**, **Agenda-instellingen** en **Nummering**. **Agenda-instellingen** wordt behandeld in [Onderhoudsagenda](/docs/scheduled-maintenance/calendar#externe-agendas), de rest hieronder.

De sectie **Werkruimte** bevat de Slack- en Microsoft Teams-regels die gebeurtenissen in kanalen plaatsen. Zie [Slack](/docs/workspace-connections/slack#meldingsregels) en [Microsoft Teams](/docs/workspace-connections/microsoft-teams#meldingsregels).

## De regels die een nieuwe gebeurtenis doorloopt

```mermaid title="De regels die een nieuwe gebeurtenis doorloopt, op volgorde"
flowchart TB
    created["Een nieuwe gebeurtenis"] --> owners["Eigenaarsregels<br/>voegen eigenaren toe"]
    owners --> labels["Labelregels<br/>voegen labels toe"]
    labels --> runbooks["Runbook-regels<br/>starten runbooks"]
    runbooks --> reminders["Herinneringsregels<br/>plannen herinneringen"]
```

De regels verschillen in hoe ze meerdere treffers afhandelen:

- **Eigenaarsregels**, **Labelregels** en **Runbook-regels** werken allemaal wanneer ze passen. Eigenaren en labels die meerdere regels toevoegen, worden één keer toegevoegd.
- **Reminder Rules** worden van boven naar beneden in hun lijst gecontroleerd, en de eerste die past wint. Sleep een regel om zijn plaats te wijzigen; een nieuwe regel komt onderaan.

Een nieuwe regel begint ingeschakeld; zet **Ingeschakeld** uit in het bewerkformulier om haar te pauzeren, en de lijst toont voor elke regel een groen **Ingeschakeld** of een rood **Uitgeschakeld**. Eigenaars-, label- en runbook-regels werken op gebeurtenissen die worden gemaakt nadat je ze opslaat. Om een eigenaars- of labelregel toe te passen op gebeurtenissen die je al hebt, gebruik je **Nu uitvoeren**: zie [Regels uitvoeren op bestaande resources](/docs/configuration/run-rules-now).

## Eigenaars- en labelregels

**Eigenaarsregels** voegen eigenaar-gebruikers en -teams toe aan nieuwe gebeurtenissen die passen, en **Labelregels** voegen labels toe. Er een maken kost twee stappen: **Overeenkomst**, de voorwaarden, en daarna **Eigenaren** of **Labels**, wat de regel toevoegt.

| Voorwaarde                                                      | Past op                                                                    |
| --------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Monitoren**, **Gebeurtenislabels**, **Monitorlabels**         | Gebeurtenissen met een van de monitoren of labels die je kiest.            |
| **Gebeurtenistitel**, **Gebeurtenisbeschrijving**, **Monitornaam**, **Monitorbeschrijving** | Een patroon, als reguliere expressie, zonder op hoofdletters te letten. |

Een regel past alleen als elke voorwaarde die je invult klopt; een lege voorwaarde wordt overgeslagen.

- **Een regel kan overnemen.** Ingeklapt onder **Eigenaren overnemen** of **Labels overnemen** geven zes schakelaars de eigenaren of labels door van de monitoren, hosts, Kubernetes-clusters, Docker-hosts, Podman-hosts en services van de gebeurtenis.
- **Een nieuwe regel moet iets toevoegen**: kies minstens één eigenaar of label, of zet een schakelaar aan.
- **Eigenaren op de hoogte stellen**, onder **Meer velden** van een eigenaarsregel, bepaalt of de toegevoegde personen bericht krijgen.

[Label- en eigenaarsregels](/docs/configuration/label-and-owner-rules) behandelt het formulier stap voor stap, voor elk soort resource.

## Runbook-regels

**Runbook-regels** starten een runbook wanneer een nieuwe gebeurtenis past, zoals een checklist vóór elke database-upgrade. Ze passen op dezelfde dingen als eigenaars- en labelregels; gebeurtenissen hebben geen ernstniveau, dus runbook-regels voor onderhoud bieden er geen aan. De uitvoering wordt aan de gebeurtenis gekoppeld, op haar pagina **Runbooks**. Zie [Runbook-regels](/docs/runbooks/rules).

## Herinneringsregels

**Geplande onderhoud → Regels → Reminder Rules** herinnert de eigenaren van een gebeurtenis tot het werk is goedgekeurd. Elke gebeurtenis krijgt de eerste regel die bij haar past, van boven naar beneden in de lijst.

:::steps
### Kiezen voor welke gebeurtenissen

Klik op **Scheduled Maintenance Reminder Rule aanmaken**. Laat onder **Overeenkomst** de keuze **Alle geplande onderhoudsevenementen** staan om aan elke gebeurtenis te herinneren, of kies **Alleen geplande onderhoudsevenementen die aan de voorwaarden voldoen** en dan de **Labels** waarvoor ze geldt.

### Het interval instellen

Stel onder **Herinneringen** het **Herinneringsinterval (minuten)** in, hoe vaak de eigenaren worden herinnerd, en kies onder **Eigenaren herinneren** wanneer. De **Naam** volgt beide, zoals 'Elke 30 minuten herinneren terwijl het bezig is', totdat je zelf een naam typt, en een **Beschrijving** wacht onder **Meer velden**. Maak daarna de regel aan.
:::

| Antwoord | Wanneer de eigenaren worden herinnerd |
| --- | --- |
| **Terwijl het bezig is** | Vanaf het begin van de gebeurtenis tot het einde ervan. Een nieuwe regel begint met dit antwoord. |
| **Voordat het begint** | Vanaf het moment dat de gebeurtenis gepland is tot het begin ervan. |
| **Voordat het begint en terwijl het bezig is** | Vanaf het moment dat de gebeurtenis gepland is tot het einde ervan. |

Een regel die via de API of Terraform is opgeslagen en wacht tot de gebeurtenis begint en stopt zodra die begint, stuurt nooit een herinnering: de lijst markeert hem met **Herinnert nooit**, en het formulier vraagt je een antwoord te kiezen.

Eigenaren krijgen elke herinnering als **Maintenance reminder**, die voor elk nieuw lid per e-mail aanstaat. Een herinneringsregel opslaan, wijzigen of verwijderen koppelt elke gebeurtenis die nog niet voltooid is opnieuw aan een regel. Om de herinneringen voor één gebeurtenis te stoppen, zet je **Herinneringen sturen** uit op haar pagina **Instellingen**; dat slaat op zodra je omschakelt.

Deze herinneringen zijn voor je team. De herinneringen die de abonnees van je statuspagina's krijgen voordat een gebeurtenis begint, stel je in op de gebeurtenis zelf, onder **Herinneringen vóór de gebeurtenis**.

## Instellingen

### Notitiesjablonen

**Geplande onderhoud → Instellingen → Notitie-sjablonen** bevat kant-en-klare tekst voor onderhoudsupdates. De kaart **Openbare of privénotitiesjablonen voor geplande onderhoudsevenementen** toont ze; **Gepland Onderhoud Notitie Sjabloon aanmaken** vraagt om een **Sjabloonnaam**, een **Sjabloonbeschrijving** en de **Notitie**. Een sjabloon wordt aangeboden wanneer iemand een openbare of privénotitie bij een gebeurtenis schrijft en wanneer iemand haar status wijzigt, en de tekst kan vóór het plaatsen worden bewerkt. Anders dan notitiesjablonen voor incidenten vullen notitiesjablonen voor onderhoud geen variabelen in.

### Aangepaste velden

**Geplande onderhoud → Instellingen → Aangepaste velden** voegt eigen velden toe aan elke gebeurtenis, zoals een wijzigingsticket of een klantniveau. Vul ze in op de pagina **Aangepaste velden** van een gebeurtenis, of via de API als `customFields`. Een veld kan zijn waarde kopiëren uit een aangepast veld van een monitor in plaats van getypt te worden: zie [Velden gekopieerd van een monitor](/docs/incidents/settings#velden-die-uit-een-monitor-worden-gekopieerd), wat voor gebeurtenissen net zo werkt.

### Metingen

**Geplande onderhoud → Instellingen → Metingen** meet hoe lang dingen duren bij elke gebeurtenis. Kies **Vertraagde start**, van de geplande start tot de echte start, **Uitloop**, van het geplande einde tot het echte einde, of **Duur van het onderhoud**, van de start tot het einde; of twee eigen momenten met **Iets anders**. Elke meting wordt getoond op de pagina van de gebeurtenis en in een grafiek gezet als `oneuptime.scheduled-maintenance.measurement.<key>`. Zie [Metingen](/docs/incidents/settings#metingen), wat voor gebeurtenissen net zo werkt.

### Nummering

**Geplande onderhoud → Instellingen → Nummering** bepaalt de tekst vóór de nummers van gebeurtenissen: `SM-` in een nieuw project, of `#` zonder voorvoegsel. **Bijwerken** vraagt om het **Nummerprefix van geplande onderhoud** en toont het nummer als voorbeeld terwijl je typt. Alleen gebeurtenissen die daarna worden gemaakt, krijgen het nieuwe voorvoegsel; bestaande houden hun nummers. De regels voor een voorvoegsel staan in [Nummervoorvoegsels](/docs/incidents/settings#nummervoorvoegsels).

De kaart **Volgend nummer** eronder stelt het nummer in dat de volgende gebeurtenis krijgt, om de nummers van een andere tool voort te zetten: **Bijwerken** opent **Volgend nummer van gepland onderhoud**, dat hoger moet zijn dan het hoogste tot nu toe. Zie [Volgende nummers](/docs/incidents/settings#volgende-nummers).

> [!NOTE]
> In OneUptime Cloud vragen aangepaste velden het abonnement **Growth** of hoger, net als het toevoegen en wijzigen van onderhoudsstatussen en sjablonen.

## Workflows

Elk onderhoudsmodel heeft workflowtriggers en -acties, naar het model genoemd: **On Create Scheduled Maintenance Event**, **On Update Scheduled Maintenance Event**, **On Create or Update Scheduled Maintenance Event** en **On Delete Scheduled Maintenance Event**, hetzelfde voor **Scheduled Maintenance State Timeline** en de andere, en acties zoals **Create One Scheduled Maintenance Event** en **Update One Scheduled Maintenance Event**. Definities van aangepaste velden en meetwaarden zijn de uitzonderingen: ze hebben geen workflowstappen. Zie [Workflows – Overzicht](/docs/workflows/index).

## Wie ze mag wijzigen

| Rol                               | Wat ze mag                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Onderhoudskijker**  | Leest gebeurtenissen en wijzigt niets.                                                               |
| **Onderhoudslid**  | Maakt, wijzigt en verwijdert gebeurtenissen met hun notities, statustijdlijnen en eigenaren, en beide soorten sjablonen. |
| **Onderhoudsbeheerder**   | Alles wat een lid doet, en maakt, wijzigt en verwijdert daarnaast onderhoudsstatussen.               |

Regels, aangepaste velden en metingen vragen **Projecteigenaar** of **Projectbeheerder**, of een aangepaste rol met de eigen machtiging van die pagina, zoals **Create Scheduled Maintenance Owner Rule**. Runbook-regels accepteren ook **Runbookbeheerder**. **Projectlid** werkt met gebeurtenissen en sjablonen, net als **Onderhoudslid**. Zie [Gebruikers, teams en machtigingen](/docs/permissions/index).

## Probleemoplossing

:::details Een eigenaarsregel heeft niemand aan een nieuwe gebeurtenis toegevoegd
Open de regel en controleer haar voorwaarden: elke voorwaarde die je hebt ingevuld, moet kloppen. Een titelpatroon is een reguliere expressie, dus `db upgrade` past niet op 'DB-Upgrade'; schrijf `db.upgrade`. Een regel werkt bovendien alleen op gebeurtenissen die na het opslaan worden gemaakt: gebruik **Nu uitvoeren** voor de gebeurtenissen die je al hebt.
:::

:::details Eigenaren kregen geen herinnering
Controleer of een herinneringsregel past op de labels van de gebeurtenis, of **Herinneringen sturen** bij de gebeurtenis aanstaat en of **Maintenance reminder** aanstaat in de meldingsinstellingen van de eigenaren. Een regel met **Terwijl het bezig is** stuurt niets voordat de gebeurtenis begint.
:::

## Volgende stappen

:::cards
- [Onderhoudsstatussen](/docs/scheduled-maintenance/states): De pagina Status gebeurtenis, en wat elke status doet.
- [Sjablonen en terugkerende gebeurtenissen](/docs/scheduled-maintenance/templates): De pagina Gebeurtenis-sjablonen, in detail.
- [Label- en eigenaarsregels](/docs/configuration/label-and-owner-rules): Het regelformulier, stap voor stap.
- [Meldingsinstellingen](/docs/notifications/notification-settings): Hoe elke eigenaar kiest wat hem bereikt.
:::
