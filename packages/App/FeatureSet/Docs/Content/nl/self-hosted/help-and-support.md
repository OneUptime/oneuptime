# Hulp en ondersteuning

Richt de hulp die OneUptime biedt op uw eigen team: het supportadres, de chat en de hulppagina die mensen zien, waar **Feedback geven** naartoe gaat, wat single sign-on zegt tegen iemand die een uitnodiging nodig heeft, en de verwijzingen naar de mobiele app. Elk ervan kan bij die van OneUptime blijven, naar een adres of link van u wijzen, of worden verborgen.

:::cards
- [Wijzigen waar hulp naartoe gaat](#wijzigen-waar-hulp-naartoe-gaat): Eén pagina in het Admin Dashboard.
- [Wat elke instelling verandert](#wat-elke-instelling-verandert): Elke plaats, de standaard en de keuzes.
- [Feedback geven](#feedback-geven): Waar wat mensen schrijven naartoe wordt gestuurd.
- [Het aanmeldbericht](#het-aanmeldbericht): Aan wie mensen een uitnodiging vragen.
- [Instellen vanuit uw configuratie](#instellen-vanuit-uw-configuratie): Helm-waarden of `config.env`, voor een nieuwe server.
:::

## Wijzigen waar hulp naartoe gaat

:::steps
### Hulp en ondersteuning openen
Open in het Admin Dashboard **Instellingen** en daarna **Hulp en ondersteuning** in het zijmenu.

### Een plaats wijzigen
Selecteer **Wijzigen** ernaast, kies **Standaard**, een eigen adres of link, of **Verbergen**, en selecteer daarna **Opslaan**. **Demo aanvragen** en **Een bug melden of een functie aanvragen** zijn schakelaars, die worden opgeslagen zodra u ze omzet.

### Controleren wat mensen zien
Het hulpmenu en het aanmeldscherm worden naast hun instellingen als voorbeeld getoond. Mensen zien een wijziging de volgende keer dat ze een pagina openen.
:::

Zolang u een plaats niet wijzigt, toont die wat OneUptime altijd heeft getoond, dus een server die de pagina nooit opent, ziet er precies zo uit als voorheen.

## Wat elke instelling verandert

| Instelling | Waar mensen het zien | Standaard | Eigen |
| --- | --- | --- | --- |
| **Support-e-mail** | Hulp › **Support-e-mail**, **Contact opnemen met support** op de pagina die niet is gevonden, accountmails, en het adres waarnaar een foutscherm mensen vraagt een ondersteuningsbundel te sturen | `support@oneuptime.com` | Een e-mailadres |
| **Chat** | Hulp › **Chat op Slack**, en de chatlink bovenaan de API-referentie | De community van OneUptime op Slack | Een link. Een link naar Slack of Microsoft Teams houdt zijn naam; elke andere heet **Chat met support** |
| **Demo aanvragen** | Hulp › **Demo aanvragen** | Zichtbaar | Alleen verborgen |
| **Feedback geven** | Hulp › **Feedback geven**, en **Feedback geven** in Zoeken | De beheerders van deze server | Een e-mailadres, of een eigen pagina |
| **Hulp en ondersteuning** | **Hulp en ondersteuning** in de voettekst, **Contact** op de aanmeldpagina's, en **Ondersteuning** bovenaan de API-referentie | `https://oneuptime.com/support` | Een link |
| **Een bug melden of een functie aanvragen** | De onderkant van het productmenu, het openbare GitHub-issue dat na feedback wordt aangeboden, en de GitHub-links van de documentatie en de API-referentie | Zichtbaar | Alleen verborgen |
| **Download de mobiele app** | **Hoe ik bereikbaar ben**, de inrichting van oproepen, de eerste stappen van een nieuw lid op Start, en **Mobiele apps** in **Projectinstellingen** | De App Store en Google Play | Een eigen pagina, zoals het bedrijfsportaal van uw apparaatbeheer |
| **Bericht voor mensen die een uitnodiging nodig hebben** | De single sign-on-schermen die „You need to be invited.” en „No project access.” zeggen | De zin van OneUptime | Uw eigen woorden |

Elke instelling behalve het bericht kan ook worden verborgen. Een link begint met `https://`, `http://` of `mailto:`. Elke andere soort link, waaronder `javascript:`, wordt door de pagina en opnieuw door de server geweigerd.

Het eigen hulpmenu, de voettekst en het productmenu van het Admin Dashboard houden de links van OneUptime: die zijn voor de beheerders van deze server, die bij OneUptime hulp krijgen met de server.

### Accountmails

Op een zelf gehoste server verwijzen accountmails, zoals een uitnodiging of een gewijzigd e-mailadres, mensen aan het eind naar de beheerder van deze server, nooit naar de support van OneUptime. Met een eigen supportadres noemen ze dat, als link: „Hulp nodig? Schrijf naar it-help@example.com.” Op de standaard, of verborgen, luiden ze zoals altijd.

### De documentatie en de API-referentie

De documentatie en de API-referentie die deze server aanbiedt, volgen dezelfde instellingen. Met **Een bug melden of een functie aanvragen** verborgen linkt geen enkele pagina naar GitHub, en **Was deze pagina nuttig?** wordt alleen gevraagd waar het antwoord wordt bewaard of verstuurd. De bovenbalk van de API-referentie toont de chat en de hulppagina die u hebt gekozen, of geen van beide als ze verborgen zijn.

### Wie uw links kan lezen

Het supportadres en de link **Hulp en ondersteuning** staan ook op de aanmeldpagina's, dus iedereen die die pagina's kan openen, kan ze lezen. Een chatlink en de pagina van de mobiele app worden alleen gestuurd naar mensen die zijn aangemeld: een chatlink is vaak een uitnodiging voor uw werkruimte. Om dezelfde reden tonen de documentatie en de API-referentie, die iedereen kan lezen, een eigen chatlink alleen aan iemand die bij deze server is aangemeld.

## Feedback geven

| Keuze | Wat er gebeurt |
| --- | --- |
| **Standaard** | Zoals altijd: gemaild naar de **Admin-meldings-e-mail** die is ingesteld in **Instellingen** › **E-mails**, of bewaard voor de beheerders van deze server in **Feedback** als die er niet is. Op OneUptime Cloud gaat het naar het OneUptime-team. |
| **Een e-mailadres** | Daarheen gemaild via de e-mailinstellingen van deze server, met de naam en het e-mailadres van de persoon, zodat uw team kan antwoorden. De persoon krijgt een kopie. |
| **Een eigen pagina** | **Feedback geven** opent die in een nieuw tabblad, zoals het formulier van uw helpdesk. Er wordt niets vanuit OneUptime verstuurd. |
| **‘Feedback geven’ verbergen** | **Feedback geven** wordt nergens aangeboden. |

Zolang de server geen e-mail kan versturen, verbergt het kiezen van een e-mailadres **Feedback geven** in plaats van een bericht aan te nemen dat uw team niet kan bereiken, en de instellingenpagina zegt dat ook. Stel e-mail in onder **Instellingen** › **E-mails**, en **Feedback geven** komt vanzelf terug.

De vragen die OneUptime stelt, zoals hoe makkelijk een begeleide installatie was, zijn geen **Feedback geven**: hun antwoorden blijven in **Feedback**, waar **Vragen hoe het ging** ze uitzet.

## Het aanmeldbericht

De eigen single sign-on van de server weigert twee soorten mensen: iemand zonder account, terwijl de provider er geen aanmaakt („You need to be invited.”), en iemand van wie het account in geen enkel project zit („No project access.”). Beiden hebben een uitnodiging nodig, dus beide schermen tonen uw bericht, met aan wie ze het moeten vragen en hoe ze die bereiken:

```text
Ask the IT service desk to invite you to OneUptime:
it-help@example.com or https://help.example.com/oneuptime
```

- Het bericht is platte tekst van maximaal 1000 tekens en mag geen `<` of `>` bevatten.
- Elke regel is een alinea, en links en e-mailadressen erin worden links.
- De titel van het scherm blijft zoals hij is, en de mobiele app toont dezelfde woorden.

## De verwijzingen naar de mobiele app

Met een eigen pagina wijst elke verwijzing naar de mobiele app daarheen: één QR-code voor uw pagina, genoemd naar het adres, en de stappen noemen nog steeds het adres van deze server, waarmee de app verbinding maakt. Verborgen is er helemaal geen verwijzing:

- **Download de mobiele app** verdwijnt uit de eerste stappen van een nieuw lid op Start, die nog steeds worden afgerond zodra de persoon bereikbaar is en een testoproep die persoon heeft bereikt.
- **Hoe ik bereikbaar ben** en de inrichting van oproepen bieden alleen browsers aan.
- **Mobiele apps** verdwijnt uit **Projectinstellingen**.
- Overal waar OneUptime de manieren opsomt om iemand te bereiken, zoals in de begeleide installaties, op Start, in de compliance-regels van een team en in AI vragen, noemt het de app niet meer.

## Instellen vanuit uw configuratie

Een server die met Helm of Docker Compose is geïnstalleerd, kan starten met deze instellingen al gemaakt. Stel ze in met de `helpAndSupport`-waarden van de Helm-chart, of in `config.env` voor Docker Compose:

```yaml
helpAndSupport:
  supportEmail: it-help@example.com
  chat: https://example.slack.com/archives/C024BE91L
  requestDemo: hidden
  gitHub: hidden
  inviteMessage: |
    Ask the IT service desk to invite you to OneUptime:
    it-help@example.com
```

| Helm-waarde | `config.env` | Wat het aanneemt |
| --- | --- | --- |
| `supportEmail` | `HELP_AND_SUPPORT_SUPPORT_EMAIL` | Een e-mailadres, of `hidden` |
| `chat` | `HELP_AND_SUPPORT_CHAT` | Een link, of `hidden` |
| `requestDemo` | `HELP_AND_SUPPORT_REQUEST_DEMO` | `shown` of `hidden` |
| `giveFeedback` | `HELP_AND_SUPPORT_GIVE_FEEDBACK` | Een e-mailadres, een link, of `hidden` |
| `helpLink` | `HELP_AND_SUPPORT_HELP_LINK` | Een link, of `hidden` |
| `gitHub` | `HELP_AND_SUPPORT_GITHUB` | `shown` of `hidden` |
| `mobileApp` | `HELP_AND_SUPPORT_MOBILE_APP` | Een link, of `hidden` |
| `inviteMessage` | `HELP_AND_SUPPORT_INVITE_MESSAGE` | Platte tekst |

- Ze worden gelezen wanneer de server start, alleen zolang er nog niets is opgeslagen op **Hulp en ondersteuning**. Vanaf dan bewaart de pagina de instellingen: een wijziging die u daar maakt, blijft staan, en een herstart zet die nooit terug.
- Een waarde die later in de configuratie wordt gewijzigd, wordt niet toegepast, en het log van de server meldt dat. Wijzig hem op de pagina.
- Elke waarde wordt gecontroleerd zoals de pagina die controleert. Een waarde die zou worden geweigerd, zoals een `javascript:`-link, wordt weggelaten, en de pagina en het log van de server zeggen waarom. De andere worden toch ingesteld.
- Laat een waarde leeg om de standaard van OneUptime te houden. `true` en `false` werken ook voor de twee schakelaars.
- De pagina markeert elke instelling die uit uw configuratie kwam, totdat u die wijzigt.

## Volgende stappen

:::cards
- [Globale SSO](/docs/identity/global-sso): De eigen single sign-on van de server.
- [Sessieduur](/docs/self-hosted/session-length): Hoe lang mensen aangemeld blijven.
:::
