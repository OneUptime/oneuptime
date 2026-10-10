# Hviteliste for telefonnumre

På OneUptime Cloud kommer SMS-er og telefonanrop for vakter fra numrene nedenfor. Legg dem til i telefonens liste over tillatte numre, så et varsel aldri blir blokkert, dempet eller sortert som søppel.

## Numre for OneUptime Cloud

| Nummer | Land |
| --- | --- |
| +13022917020 | USA (US) |
| +447427817020 | Storbritannia (UK) |

## Tillat numrene på telefonen

:::steps
1. Lagre begge numrene i telefonens kontakter som én kontakt, for eksempel "OneUptime".
2. Bruker du Ikke forstyrr, Fokus eller en annen stillemodus, tillater du anrop og meldinger fra den kontakten.
3. Er en app for anropsfiltrering eller søppelfiltrering, eller operatørens søppelbeskyttelse, slått på, markerer du begge numrene som klarert der også.
:::

> [!TIP]
> Når du legger til eller verifiserer telefonnummeret ditt under **Brukerinnstillinger** > **Varselmetoder**, får du en kode fra disse numrene, så det er en rask måte å sjekke at de kommer gjennom.

## Når varsler kommer fra andre numre

Varslene dine kommer fra andre numre enn dem ovenfor når:

- **Prosjektet ditt bruker sin egen Twilio-konto.** Når et prosjekt har en Twilio-konfigurasjon som er angitt som prosjektstandard (**Prosjektinnstillinger** > **Varsler** > **Varselinnstillinger** > **Twilio-konfigurasjon**), går SMS-er og anrop til prosjektets medlemmer gjennom den kontoen, fra telefonnumrene dens. Legg de numrene på hvitelisten i stedet.
- **Du bruker en selvdriftet installasjon.** SMS-er og anrop kommer fra Twilio-numrene administratoren din har konfigurert: prosjektets standard-Twilio-konfigurasjon eller den for hele installasjonen under **Admin Dashboard** > **Innstillinger** > **Call and SMS**. Spør administratoren hvilke numre du skal legge på hvitelisten.

## Neste steg

:::cards
- [Eskaleringsregler](/docs/on-call/escalation-rules): Hvordan hver person et nivå varsler, nås, og i hvilken rekkefølge.
- [Vaktplaner](/docs/on-call/schedules): Bestem hvem som har vakt, og når.
- [Twilio-integrasjon for SMS og tale](/docs/self-hosted/twilio-integration): Bruk din egen Twilio-konto og dine egne numre på en selvdriftet installasjon.
:::
