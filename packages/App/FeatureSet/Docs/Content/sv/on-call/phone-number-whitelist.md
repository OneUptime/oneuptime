# Vitlista för telefonnummer

På OneUptime Cloud kommer SMS och telefonsamtal för jour från numren nedan. Lägg till dem i telefonens lista över tillåtna nummer, så att ett larm aldrig blockeras, tystas eller sorteras som skräp.

## Nummer för OneUptime Cloud

| Nummer | Land |
| --- | --- |
| +13022917020 | USA (US) |
| +447427817020 | Storbritannien (UK) |

## Tillåt numren på din telefon

:::steps
1. Spara båda numren i telefonens kontakter som en kontakt, till exempel "OneUptime".
2. Om du använder Stör ej, Fokus eller ett annat tyst läge tillåter du samtal och meddelanden från den kontakten.
3. Om en app för samtalsfiltrering eller skräpfiltrering, eller operatörens skräpskydd, är påslagen markerar du båda numren som betrodda där också.
:::

> [!TIP]
> När du lägger till eller verifierar ditt telefonnummer under **Användarinställningar** > **Aviseringsmetoder** får du en kod från de här numren, så det är ett snabbt sätt att kontrollera att de kommer fram.

## När larm kommer från andra nummer

Dina larm kommer från andra nummer än de ovan när:

- **Ditt projekt använder sitt eget Twilio-konto.** När ett projekt har en Twilio-konfiguration som är angiven som projektstandard (**Projektinställningar** > **Aviseringar** > **Aviseringsinställningar** > **Twilio-konfiguration**) går SMS och samtal till projektets medlemmar via det kontot, från dess telefonnummer. Vitlista de numren i stället.
- **Du använder en egen installation.** SMS och samtal kommer från de Twilio-nummer som din administratör har konfigurerat: projektets standard-Twilio-konfiguration, eller den för hela installationen under **Admin Dashboard** > **Inställningar** > **Call and SMS**. Fråga din administratör vilka nummer du ska vitlista.

## Nästa steg

:::cards
- [Eskaleringsregler](/docs/on-call/escalation-rules): Hur varje person som en nivå larmar nås, och i vilken ordning.
- [Jourscheman](/docs/on-call/schedules): Bestäm vem som har jour, och när.
- [Twilio-integration för SMS och röst](/docs/self-hosted/twilio-integration): Använd ditt eget Twilio-konto och dina egna nummer på en egen installation.
:::
