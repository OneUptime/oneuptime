# Hjælp og support

Ret den hjælp, OneUptime tilbyder, mod dit eget team: supportadressen, chatten og hjælpesiden, folk ser, hvor **Giv feedback** sendes hen, hvad single sign-on siger til nogen, der har brug for en invitation, og opfordringerne til at hente mobilappen. Hver af dem kan blive ved OneUptimes egen, pege på en adresse eller et link, du selv har, eller skjules.

:::cards
- [Skift, hvor hjælpen fører hen](#skift-hvor-hjælpen-fører-hen): Én side i Admin Dashboard.
- [Hvad hver indstilling ændrer](#hvad-hver-indstilling-ændrer): Hvert sted, dets standard og dets valg.
- [Giv feedback](#giv-feedback): Hvor det, folk skriver, sendes hen.
- [Login-beskeden](#login-beskeden): Hvem man skal bede om en invitation.
- [Angiv dem i din konfiguration](#angiv-dem-i-din-konfiguration): Helm-værdier eller `config.env`, til en ny server.
:::

## Skift, hvor hjælpen fører hen

:::steps
### Åbn Hjælp og support
Åbn **Indstillinger** i Admin Dashboard, og derefter **Hjælp og support** i sidemenuen.

### Skift et sted
Vælg **Skift** ud for det, vælg **Standard**, en adresse eller et link, du selv har, eller **Skjul den**, og vælg derefter **Gem**. **Anmod om demo** og **Rapportér en fejl eller anmod om en funktion** er kontakter, der gemmes, så snart du slår dem til eller fra.

### Tjek, hvad folk ser
Hjælpemenuen og login-skærmen vises som forhåndsvisning ved siden af deres indstillinger. Folk ser en ændring, næste gang de åbner en side.
:::

Indtil du skifter et sted, viser det det, OneUptime altid har vist, så en server, der aldrig åbner siden, ser præcis ud som før.

## Hvad hver indstilling ændrer

| Indstilling | Hvor folk ser den | Standard | Egen |
| --- | --- | --- | --- |
| **Support-e-mail** | Hjælp › **Support-e-mail**, **Kontakt support** på siden, der ikke blev fundet, konto-e-mails, og den adresse, en fejlskærm beder folk sende en supportpakke til | `support@oneuptime.com` | En e-mailadresse |
| **Chat** | Hjælp › **Chat på Slack**, og chatlinket øverst i API-referencen | OneUptimes community på Slack | Et link. Et Slack- eller Microsoft Teams-link beholder sit navn; alle andre hedder **Chat med support** |
| **Anmod om demo** | Hjælp › **Anmod om demo** | Vist | Kun skjult |
| **Giv feedback** | Hjælp › **Giv feedback** og **Giv feedback** i Søg | Denne servers administratorer | En e-mailadresse eller din egen side |
| **Hjælp og support** | **Hjælp og support** i sidefoden, **Kontakt** på login-siderne og **Support** øverst i API-referencen | `https://oneuptime.com/support` | Et link |
| **Rapportér en fejl eller anmod om en funktion** | Bunden af produktmenuen, det offentlige GitHub-issue, der tilbydes efter feedback, og GitHub-linkene i dokumentationen og API-referencen | Vist | Kun skjult |
| **Hent mobilappen** | **Sådan når man mig**, vagtopsætningen, et nyt medlems første skridt på Hjem og **Mobilapps** i **Projektindstillinger** | App Store og Google Play | Din egen side, f.eks. virksomhedsportalen i dit system til enhedsadministration |
| **Besked til folk, der har brug for en invitation** | De single sign-on-skærme, der siger »You need to be invited.« og »No project access.« | OneUptimes sætning | Dine egne ord |

Alle indstillinger undtagen beskeden kan også skjules. Et link begynder med `https://`, `http://` eller `mailto:`. Alle andre slags links, heriblandt `javascript:`, afvises af siden og igen af serveren.

Admin Dashboards egen hjælpemenu, sidefod og produktmenu beholder OneUptimes links: de er til denne servers administratorer, som får hjælp til serveren fra OneUptime.

### Konto-e-mails

På en selvhostet server slutter konto-e-mails, f.eks. en invitation eller en ændret e-mailadresse, med at henvise folk til denne servers administrator, aldrig til OneUptimes support. Med en supportadresse, du selv har, nævner de den som et link: »Brug for hjælp? Skriv til it-help@example.com.« På standarden, eller skjult, lyder de, som de altid har gjort.

### Dokumentationen og API-referencen

Den dokumentation og API-reference, denne server viser, følger de samme indstillinger. Med **Rapportér en fejl eller anmod om en funktion** skjult linker ingen side til GitHub, og **Var denne side nyttig?** stilles kun der, hvor svaret gemmes eller sendes. API-referencens topbjælke viser den chat og den hjælpeside, du har valgt, eller ingen af dem, når de er skjult.

### Hvem kan læse dine links

Supportadressen og linket **Hjælp og support** vises også på login-siderne, så alle, der kan åbne de sider, kan læse dem. Et chatlink og mobilappens side sendes kun til folk, der er logget ind: et chatlink er ofte en invitation til dit arbejdsområde. Af samme grund viser dokumentationen og API-referencen, som alle kan læse, kun et chatlink, du selv har, til en, der er logget ind på denne server.

## Giv feedback

| Valg | Hvad der sker |
| --- | --- |
| **Standard** | Som det altid har været: sendt med e-mail til den **Admin-notifikations-e-mail**, der er angivet under **Indstillinger** › **E-mails**, eller gemt til denne servers administratorer under **Feedback**, når der ikke er nogen. På OneUptime Cloud går det til OneUptime-teamet. |
| **En e-mailadresse** | Sendt dertil med e-mail via denne servers e-mailindstillinger, med personens navn og e-mailadresse, så dit team kan svare. Personen får en kopi. |
| **Din egen side** | **Giv feedback** åbner den i en ny fane, f.eks. din helpdesks formular. Intet sendes fra OneUptime. |
| **Skjul »Giv feedback«** | **Giv feedback** tilbydes ingen steder. |

Så længe serveren ikke kan sende e-mail, skjuler valget af en e-mailadresse **Giv feedback** i stedet for at tage imod en besked, der ikke kan nå dit team, og siden med indstillingerne siger det. Konfigurer e-mail under **Indstillinger** › **E-mails**, så kommer **Giv feedback** tilbage af sig selv.

De spørgsmål, OneUptime stiller, f.eks. hvor let en guidet opsætning var, er ikke **Giv feedback**: svarene bliver under **Feedback**, hvor **Spørg, hvordan det gik** slår dem fra.

## Login-beskeden

Serverens egen single sign-on afviser to slags personer: en person uden konto, når udbyderen ikke opretter nogen (»You need to be invited.«), og en person, hvis konto ikke er i noget projekt (»No project access.«). Begge har brug for en invitation, så begge skærme viser din besked med, hvem de skal spørge, og hvordan de når vedkommende:

```text
Ask the IT service desk to invite you to OneUptime:
it-help@example.com or https://help.example.com/oneuptime
```

- Beskeden er almindelig tekst på op til 1000 tegn og må ikke indeholde `<` eller `>`.
- Hver linje er et afsnit, og links og e-mailadresser i den bliver til links.
- Skærmens titel forbliver, som den er, og mobilappen viser de samme ord.

## Opfordringerne til mobilappen

Med din egen side peger hver opfordring til at hente mobilappen derhen: én QR-kode til din side, navngivet efter dens adresse, og trinnene nævner stadig denne servers adresse, som appen skal forbinde til. Skjult er der slet ingen opfordring:

- **Hent mobilappen** forsvinder fra et nyt medlems første skridt på Hjem, som stadig bliver færdige, når personen kan nås, og et testkald har nået vedkommende.
- **Sådan når man mig** og vagtopsætningen tilbyder kun browsere.
- **Mobilapps** forsvinder fra **Projektindstillinger**.
- Overalt, hvor OneUptime nævner måderne at nå en person på, f.eks. i de guidede opsætninger, på Hjem, i et teams overholdelsesregler og i Spørg AI, nævner det ikke længere appen blandt dem.

## Angiv dem i din konfiguration

En server, der er installeret med Helm eller Docker Compose, kan starte med disse indstillinger allerede på plads. Angiv dem i Helm-chartets `helpAndSupport`-værdier, eller i `config.env` til Docker Compose:

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

| Helm-værdi | `config.env` | Hvad den tager |
| --- | --- | --- |
| `supportEmail` | `HELP_AND_SUPPORT_SUPPORT_EMAIL` | En e-mailadresse, eller `hidden` |
| `chat` | `HELP_AND_SUPPORT_CHAT` | Et link, eller `hidden` |
| `requestDemo` | `HELP_AND_SUPPORT_REQUEST_DEMO` | `shown` eller `hidden` |
| `giveFeedback` | `HELP_AND_SUPPORT_GIVE_FEEDBACK` | En e-mailadresse, et link, eller `hidden` |
| `helpLink` | `HELP_AND_SUPPORT_HELP_LINK` | Et link, eller `hidden` |
| `gitHub` | `HELP_AND_SUPPORT_GITHUB` | `shown` eller `hidden` |
| `mobileApp` | `HELP_AND_SUPPORT_MOBILE_APP` | Et link, eller `hidden` |
| `inviteMessage` | `HELP_AND_SUPPORT_INVITE_MESSAGE` | Ren tekst |

- De læses, når serveren starter, men kun så længe intet er gemt under **Hjælp og support**. Derefter er det siden, der har indstillingerne: en ændring, der laves der, bevares, og en genstart sætter den aldrig tilbage.
- En værdi, der senere ændres i konfigurationen, anvendes ikke, og serverens log siger det. Ændr den på siden.
- Hver værdi kontrolleres, som siden kontrollerer den. En værdi, der ville blive afvist, f.eks. et `javascript:`-link, udelades, og siden og serverens log siger hvorfor. De andre angives stadig.
- Lad en værdi stå tom for at beholde OneUptimes standard. `true` og `false` virker også til de to kontakter.
- Siden markerer hver indstilling, der kom fra din konfiguration, indtil du ændrer den.

## Næste trin

:::cards
- [Global SSO](/docs/identity/global-sso): Serverens egen single sign-on.
- [Sessionslængde](/docs/self-hosted/session-length): Hvor længe folk forbliver logget ind.
:::
