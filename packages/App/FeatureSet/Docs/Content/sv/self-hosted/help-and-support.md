# Hjälp och support

Rikta den hjälp som OneUptime erbjuder mot ditt eget team: supportadressen, chatten och hjälpsidan som folk ser, vart **Ge feedback** går, vad enkel inloggning säger till den som behöver en inbjudan, och uppmaningarna att hämta mobilappen. Var och en kan stå kvar på OneUptimes standard, peka på en egen adress eller länk, eller döljas.

:::cards
- [Ändra vart hjälpen går](#ändra-vart-hjälpen-går): En sida i Admin Dashboard.
- [Vad varje inställning ändrar](#vad-varje-inställning-ändrar): Varje plats, dess standard och dess val.
- [Ge feedback](#ge-feedback): Vart det som folk skriver skickas.
- [Inloggningsmeddelandet](#inloggningsmeddelandet): Vem man ska be om en inbjudan.
- [Ange dem i din konfiguration](#ange-dem-i-din-konfiguration): Helm-värden eller `config.env`, för en ny server.
:::

## Ändra vart hjälpen går

:::steps
### Öppna Hjälp och support
Öppna **Inställningar** i Admin Dashboard och sedan **Hjälp och support** i sidomenyn.

### Ändra en plats
Välj **Ändra** bredvid den, välj **Standard**, en egen adress eller länk, eller **Dölj den**, och välj sedan **Spara**. **Begär demo** och **Rapportera en bugg eller begär en funktion** är reglage som sparas så snart du slår om dem.

### Kontrollera vad folk ser
Hjälpmenyn och inloggningsskärmen förhandsgranskas bredvid sina inställningar. Folk ser en ändring nästa gång de öppnar en sida.
:::

Tills du ändrar en plats visar den det som OneUptime alltid har visat, så en server där sidan aldrig öppnas ser ut precis som förut.

## Vad varje inställning ändrar

| Inställning | Var folk ser den | Standard | Egen |
| --- | --- | --- | --- |
| **Support-e-post** | Hjälp › **Support-e-post**, **Kontakta support** på sidan ”Sidan hittades inte”, kontomejl, och adressen som en felskärm ber folk skicka ett supportpaket till | `support@oneuptime.com` | En e-postadress |
| **Chatt** | Hjälp › **Chatta på Slack**, och chattlänken högst upp i API-referensen | OneUptimes community på Slack | En länk. En länk till Slack eller Microsoft Teams behåller sitt namn; alla andra heter **Chatta med support** |
| **Begär demo** | Hjälp › **Begär demo** | Visas | Endast dold |
| **Ge feedback** | Hjälp › **Ge feedback**, och **Ge feedback** i Sök | Den här serverns administratörer | En e-postadress, eller en egen sida |
| **Hjälp och support** | **Hjälp och support** i sidfoten, **Kontakt** på inloggningssidorna, och **Support** högst upp i API-referensen | `https://oneuptime.com/support` | En länk |
| **Rapportera en bugg eller begär en funktion** | Längst ned i produktmenyn, det offentliga GitHub-ärende som erbjuds efter feedback, och GitHub-länkarna i dokumentationen och API-referensen | Visas | Endast dold |
| **Hämta mobilappen** | **Så når man mig**, jourkonfigurationen, en ny medlems första steg på Hem, och **Mobilappar** i **Projektinställningar** | App Store och Google Play | En egen sida, till exempel företagsportalen i din enhetshantering |
| **Meddelande till personer som behöver en inbjudan** | Skärmarna för enkel inloggning som säger ”You need to be invited.” och ”No project access.” | OneUptimes mening | Dina egna ord |

Alla inställningar utom meddelandet kan också döljas. En länk börjar med `https://`, `http://` eller `mailto:`. Alla andra sorters länkar, `javascript:` bland dem, nekas av sidan och en gång till av servern.

Admin Dashboards egen hjälpmeny, sidfot och produktmeny behåller OneUptimes länkar: de är till för den här serverns administratörer, som får hjälp med servern från OneUptime.

### Kontomejl

På en självhostad server avslutas kontomejl, till exempel en inbjudan eller en ändrad e-postadress, med att hänvisa folk till den här serverns administratör, aldrig till OneUptimes support. Med en egen supportadress nämner de den, som en länk: ”Behöver du hjälp? Skriv till it-help@example.com.” Med standard, eller dold, lyder de som de alltid har gjort.

### Dokumentationen och API-referensen

Dokumentationen och API-referensen som den här servern visar följer samma inställningar. När **Rapportera en bugg eller begär en funktion** är dold länkar ingen sida till GitHub, och **Var den här sidan till hjälp?** frågas bara där svaret sparas eller skickas. API-referensens övre fält visar den chatt och den hjälpsida du har valt, eller ingen av dem när de är dolda.

### Vem som kan läsa dina länkar

Supportadressen och länken **Hjälp och support** visas också på inloggningssidorna, så alla som kan öppna de sidorna kan läsa dem. En chattlänk och mobilappens sida skickas bara till personer som är inloggade: en chattlänk är ofta en inbjudan till din arbetsyta. Av samma skäl visar dokumentationen och API-referensen, som vem som helst kan läsa, en egen chattlänk bara för den som är inloggad på den här servern.

## Ge feedback

| Val | Vad som händer |
| --- | --- |
| **Standard** | Som det alltid har gjort: skickas med e-post till den **Admin-notifierings-e-post** som har angetts under **Inställningar** › **E-post**, eller sparas för den här serverns administratörer under **Återkoppling** när ingen finns. På OneUptime Cloud går det till OneUptime-teamet. |
| **En e-postadress** | Skickas dit med e-post via den här serverns e-postinställningar, med personens namn och e-postadress, så att ditt team kan svara. Personen får en kopia. |
| **En egen sida** | **Ge feedback** öppnar den i en ny flik, till exempel formuläret i din helpdesk. Ingenting skickas från OneUptime. |
| **Dölj ”Ge feedback”** | **Ge feedback** erbjuds ingenstans. |

Så länge servern inte kan skicka e-post döljer ett val av e-postadress **Ge feedback** i stället för att ta emot ett meddelande som inte kan nå ditt team, och inställningssidan säger det. Konfigurera e-post under **Inställningar** › **E-post**, så kommer **Ge feedback** tillbaka av sig självt.

Frågorna som OneUptime ställer, till exempel hur lätt en guidad installation var, är inte **Ge feedback**: svaren på dem stannar under **Återkoppling**, där **Fråga hur det gick** stänger av dem.

## Inloggningsmeddelandet

Serverns egen enkla inloggning avvisar två sorters personer: den som saknar konto, när leverantören inte skapar något (”You need to be invited.”), och den vars konto inte finns i något projekt (”No project access.”). Båda behöver en inbjudan, så båda skärmarna visar ditt meddelande, med vem man ska fråga och hur man når dem:

```text
Ask the IT service desk to invite you to OneUptime:
it-help@example.com or https://help.example.com/oneuptime
```

- Meddelandet är vanlig text på upp till 1000 tecken och får inte innehålla `<` eller `>`.
- Varje rad är ett stycke, och länkar och e-postadresser i det blir länkar.
- Skärmens rubrik förblir som den är, och mobilappen visar samma ord.

## Uppmaningarna om mobilappen

Med en egen sida pekar varje uppmaning att hämta mobilappen dit: en QR-kod för din sida, namngiven efter dess adress, och stegen anger fortfarande den här serverns adress som appen ska ansluta till. När den är dold finns det ingen uppmaning alls:

- **Hämta mobilappen** försvinner från en ny medlems första steg på Hem, som ändå blir klara när personen kan nås och ett testlarm har nått hen.
- **Så når man mig** och jourkonfigurationen erbjuder bara webbläsare.
- **Mobilappar** försvinner från **Projektinställningar**.
- Överallt där OneUptime räknar upp sätten att nå någon, till exempel i de guidade installationerna, på Hem, i ett teams efterlevnadsregler och i Fråga AI, nämns appen inte längre bland dem.

## Ange dem i din konfiguration

En server som installeras med Helm eller Docker Compose kan starta med de här inställningarna redan gjorda. Ange dem i Helm-chartets `helpAndSupport`-värden, eller i `config.env` för Docker Compose:

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

| Helm-värde | `config.env` | Vad den tar |
| --- | --- | --- |
| `supportEmail` | `HELP_AND_SUPPORT_SUPPORT_EMAIL` | En e-postadress, eller `hidden` |
| `chat` | `HELP_AND_SUPPORT_CHAT` | En länk, eller `hidden` |
| `requestDemo` | `HELP_AND_SUPPORT_REQUEST_DEMO` | `shown` eller `hidden` |
| `giveFeedback` | `HELP_AND_SUPPORT_GIVE_FEEDBACK` | En e-postadress, en länk, eller `hidden` |
| `helpLink` | `HELP_AND_SUPPORT_HELP_LINK` | En länk, eller `hidden` |
| `gitHub` | `HELP_AND_SUPPORT_GITHUB` | `shown` eller `hidden` |
| `mobileApp` | `HELP_AND_SUPPORT_MOBILE_APP` | En länk, eller `hidden` |
| `inviteMessage` | `HELP_AND_SUPPORT_INVITE_MESSAGE` | Ren text |

- De läses när servern startar, bara så länge ingenting har sparats under **Hjälp och support**. Därefter är det sidan som har inställningarna: en ändring som görs där behålls, och en omstart återställer den aldrig.
- Ett värde som ändras i konfigurationen senare tillämpas inte, och serverns logg säger det. Ändra det på sidan.
- Varje värde kontrolleras på samma sätt som sidan kontrollerar det. Ett värde som skulle nekas, till exempel en `javascript:`-länk, utelämnas, och sidan och serverns logg säger varför. De andra anges ändå.
- Lämna ett värde tomt för att behålla OneUptimes standard. `true` och `false` fungerar också för de två reglagen.
- Sidan markerar varje inställning som kom från din konfiguration, tills du ändrar den.

## Nästa steg

:::cards
- [Global SSO](/docs/identity/global-sso): Serverns egen enkla inloggning.
- [Sessionslängd](/docs/self-hosted/session-length): Hur länge personer förblir inloggade.
:::
