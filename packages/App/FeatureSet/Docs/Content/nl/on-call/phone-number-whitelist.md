# Telefoonnummer-whitelist

Op OneUptime Cloud komen sms'jes en telefoonoproepen voor bereikbaarheidsdiensten van de nummers hieronder. Zet ze op de lijst met toegestane nummers van uw telefoon, zodat een oproep nooit wordt geblokkeerd, gedempt of als spam wordt aangemerkt.

## Nummers van OneUptime Cloud

| Nummer | Land |
| --- | --- |
| +13022917020 | Verenigde Staten (US) |
| +447427817020 | Verenigd Koninkrijk (UK) |

## De nummers toestaan op uw telefoon

:::steps
1. Sla beide nummers op in de contacten van uw telefoon als één contact, bijvoorbeeld "OneUptime".
2. Gebruikt u Niet storen, Focus of een andere stille modus, sta dan oproepen en berichten van dat contact toe.
3. Staat er een app voor het filteren van oproepen of spam aan, of de spambeveiliging van uw provider, markeer beide nummers daar dan ook als vertrouwd.
:::

> [!TIP]
> Wanneer u uw telefoonnummer toevoegt of verifieert onder **Gebruikersinstellingen** > **Meldingsmethoden**, krijgt u een code van deze nummers, dus zo controleert u snel of ze doorkomen.

## Wanneer oproepen van andere nummers komen

Uw oproepen komen van andere nummers dan die hierboven wanneer:

- **Uw project zijn eigen Twilio-account gebruikt.** Wanneer een project een Twilio-configuratie heeft die als projectstandaard is ingesteld (**Projectinstellingen** > **Meldingen** > **Meldingsinstellingen** > **Twilio-configuratie**), gaan sms'jes en oproepen naar de leden van het project via dat account, vanaf de telefoonnummers ervan. Zet die nummers dan op de whitelist.
- **U een zelfgehoste installatie gebruikt.** Sms'jes en oproepen komen van de Twilio-nummers die uw beheerder heeft ingesteld: de standaard-Twilio-configuratie van het project, of die voor de hele installatie onder **Admin Dashboard** > **Instellingen** > **Call and SMS**. Vraag uw beheerder welke nummers u op de whitelist moet zetten.

## Volgende stappen

:::cards
- [Escalatieregels](/docs/on-call/escalation-rules): Hoe iedere persoon die een niveau oproept wordt bereikt, en in welke volgorde.
- [Bereikbaarheidsschema's](/docs/on-call/schedules): Bepaal wie er dienst heeft, en wanneer.
- [Twilio-integratie voor sms en spraak](/docs/self-hosted/twilio-integration): Gebruik uw eigen Twilio-account en -nummers op een zelfgehoste installatie.
:::
