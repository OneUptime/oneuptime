# Telefonnummer-whitelist

På OneUptime Cloud kommer SMS'er og telefonopkald til vagter fra numrene nedenfor. Føj dem til din telefons liste over tilladte numre, så et tilkald aldrig bliver blokeret, gjort lydløst eller sorteret som spam.

## OneUptime Cloud-numre

| Nummer | Land |
| --- | --- |
| +13022917020 | USA (US) |
| +447427817020 | Storbritannien (UK) |

## Tillad numrene på din telefon

:::steps
1. Gem begge numre i telefonens kontakter som én kontakt, fx "OneUptime".
2. Bruger du Forstyr ikke, Fokus eller en anden lydløs tilstand, så tillad opkald og beskeder fra den kontakt.
3. Er en app til opkaldsfiltrering eller spamfiltrering, eller dit teleselskabs spambeskyttelse, slået til, så markér også begge numre som betroede dér.
:::

> [!TIP]
> Når du tilføjer eller bekræfter dit telefonnummer under **Brugerindstillinger** > **Notifikationsmetoder**, får du en kode fra disse numre, så det er en hurtig måde at tjekke, at de kommer igennem.

## Når tilkald kommer fra andre numre

Dine tilkald kommer fra andre numre end dem ovenfor, når:

- **Dit projekt bruger sin egen Twilio-konto.** Når et projekt har en Twilio-konfiguration, der er angivet som projektstandard (**Projektindstillinger** > **Notifikationer** > **Notifikationsindstillinger** > **Twilio-konfiguration**), går SMS'er og opkald til projektets medlemmer gennem den konto, fra dens telefonnumre. Whitelist de numre i stedet.
- **Du bruger en selvhostet installation.** SMS'er og opkald kommer fra de Twilio-numre, din administrator har konfigureret: projektets standard-Twilio-konfiguration eller den for hele installationen under **Admin Dashboard** > **Indstillinger** > **Call and SMS**. Spørg din administrator, hvilke numre du skal whiteliste.

## Næste trin

:::cards
- [Eskaleringsregler](/docs/on-call/escalation-rules): Hvordan hver person, et niveau tilkalder, nås, og i hvilken rækkefølge.
- [Vagtplaner](/docs/on-call/schedules): Bestem, hvem der har vagt, og hvornår.
- [Twilio-integration til SMS og tale](/docs/self-hosted/twilio-integration): Brug din egen Twilio-konto og dine egne numre på en selvhostet installation.
:::
