# Ditt konto

Ditt konto är hur OneUptime känner dig: e-postadressen och lösenordet du loggar in med, ditt namn och din tidszon, och det som skyddar din inloggning. Ett konto kan tillhöra många projekt, och de här inställningarna följer med dig in i vart och ett av dem. Hur OneUptime når dig, och när du larmas, ställer du in i varje projekt under **Användarinställningar**.

```mermaid title="Det som hör till ditt konto, och det som varje projekt sparar åt dig"
flowchart TB
    account["Ditt konto:<br/>inloggning och profil"] --> projectA["Projekt A"]
    account --> projectB["Projekt B"]
    projectA --> settingsA["Användarinställningar i A:<br/>hur du larmas"]
    projectB --> settingsB["Användarinställningar i B:<br/>hur du larmas"]
```

:::cards
- [Din profil](#din-profil): Ditt namn, din e-postadress, din tidszon och din bild.
- [Logga in säkert](#logga-in-säkert): Ditt lösenord, passnycklar och tvåfaktorsautentisering.
- [Dina projekt](#dina-projekt): Byt projekt, skapa ett och acceptera inbjudningar.
- [Användarinställningar](#det-som-varje-projekt-sparar-åt-dig): Hur OneUptime når dig i varje projekt.
:::

## Användarmenyn

Klicka på din bild uppe till höger i instrumentpanelen.

| Post | Vad den gör |
| --- | --- |
| **Profil** | Öppnar **Användarprofil**: ditt namn, din e-postadress, din tidszon, din bild och säkerheten för din inloggning. |
| **Admin-inställningar** | Öppnar Admin Dashboard. Bara huvudadministratörer för en självhostad installation ser den. |
| **Mörkt tema** | Växlar instrumentpanelen till dess mörka tema. I det mörka temat heter posten **Ljust tema**. |
| **Logga ut** | Loggar ut dig. |

**Användarprofil** har en egen sidomeny. **Grundläggande** innehåller **Översikt** och **Profilbild**. **Säkerhet** och **Farozon** är hopfällda: klicka på ett avsnitts rubrik för att öppna det.

## Din profil

:::steps
### Öppna din profil

Klicka på din bild uppe till höger och välj **Profil**. Sidan **Översikt** öppnas på kortet **Grundläggande information**: ditt namn, din e-postadress och din tidszon.

### Redigera dina uppgifter

Klicka på **Redigera Användare** och ändra det du behöver:

- **E-post**: adressen du loggar in med. Om du ändrar den verifierar du den nya adressen igen.
- **Fullständigt namn**: namnet som ditt team ser överallt i OneUptime.
- **Tidszon**: tidszonen som instrumentpanelen visar och läser tider i, och den som används för tiderna i aviseringar till dig.

Klicka på **Spara ändringar**.

### Lägg till en bild

Välj **Profilbild**, klicka på **Update Profile Picture** och ladda upp en bild. Den visas i din användarmeny och bredvid ditt namn i listor över personer.
:::

> [!NOTE]
> Första gången du loggar in i en webbläsare sparar OneUptime webbläsarens tidszon i din profil. Loggar du senare in där webbläsaren har en annan tidszon frågar instrumentpanelen om den ska **Uppdatera tidszon**. Stäng frågan, så frågar den inte igen för den tidszonen.

## Logga in säkert

Fäll ut **Säkerhet** i sidomenyn i **Användarprofil**. Avsnittet har tre sidor.

| Sida | Vad den används till |
| --- | --- |
| **Lösenordshantering** | Ange ett nytt lösenord. |
| **Passkeys** | Logga in utan lösenord, med ditt fingeravtryck, ditt ansikte, skärmlåset eller en säkerhetsnyckel. |
| **Two-factor authentication** | Kräv ett andra steg efter lösenordet: en kod från en app, eller en säkerhetsnyckel. |

### Byt lösenord

:::steps
1. Öppna **Säkerhet → Lösenordshantering**.
2. Ange det nya lösenordet i **Lösenord** och igen i **Bekräfta lösenord**. Det måste vara minst 6 tecken långt.
3. Klicka på **Uppdatera lösenord**.
:::

### Lägg till en passnyckel

:::steps
1. Öppna **Säkerhet → Passkeys** och klicka på **Add Passkey**.
2. Ge den ett namn som du känner igen, till exempel din enhet eller din lösenordshanterare, och klicka på **Create Passkey**.
3. Följ webbläsarens uppmaning för att spara passnyckeln.
:::

Nästa gång väljer du **Logga in med en passnyckel** på inloggningssidan.

### Slå på tvåfaktorsautentisering

Tvåfaktorsautentisering gäller när du loggar in med ditt lösenord. Lägg först till ett andra steg, och slå sedan på den.

:::steps
### Lägg till en autentiseringsapp

Öppna **Säkerhet → Two-factor authentication**. Under **Authenticator apps** lägger du till en app och ger den ett namn. Skanna QR-koden med en app som 1Password, Google Authenticator eller Microsoft Authenticator, ange den sexsiffriga koden som den visar och klicka på **Verify and finish**. Vill du hellre använda en USB- eller NFC-nyckel lägger du till den under **Security keys**.

### Spara dina reservkoder

Första gången du lägger till en app, en nyckel eller en passnyckel visar OneUptime **Your backup codes**. Varje kod loggar in dig en gång om du tappar bort din app eller nyckel. Kopiera eller ladda ned dem, kryssa i rutan som säger att du har sparat dem och klicka på **Klar**.

### Slå på den

Klicka på **Enable two-factor authentication** högst upp på sidan och bekräfta. Kortet visar nu **Aktiverad**. Från din nästa inloggning med lösenord ber OneUptime om ditt andra steg.
:::

> [!TIP]
> Håller reservkoderna på att ta slut? **Regenerate codes** på samma sida ger dig en ny uppsättning, och de gamla koderna slutar fungera direkt.

## Dina projekt

Du kan tillhöra hur många projekt som helst. Projektväljaren uppe till vänster i instrumentpanelen listar dem: välj ett för att byta.

- **Skapa ett projekt**: öppna projektväljaren och klicka på **Skapa nytt projekt**. På en självhostad installation kan administratören förbehålla administratörer att skapa projekt.
- **Acceptera en inbjudan**: när någon bjuder in dig visar klockan uppe till höger den väntande inbjudan och öppnar **Projektinbjudningar**. Där väljer du **Acceptera** eller **Reject**.
- **Lämna ett projekt**: be någon som hanterar projektets användare att ta bort dig, med **Ta bort från projekt** på projektets sida **Användare**.

## Det som varje projekt sparar åt dig

**Användarinställningar**, till höger i fältet under toppfältet, är bara dina, och varje projekt har sina egna. Öppna dem i varje projekt där du har jour.

| Sida | Vad den används till | Läs mer |
| --- | --- | --- |
| **Checklista för konfiguration** | Leder dig genom allt nedan och visar vad som återstår. | |
| **Aviseringsmetoder** | E-postadresserna, telefonnumren, apparna och webhookarna som OneUptime kan nå dig på. Din inloggningsadress läggs till åt dig. | |
| **Jourregler** | Vilken metod som används, och efter hur lång tid, när en jourpolicy larmar dig. | [Eskaleringsregler](/docs/on-call/escalation-rules) |
| **Aviseringsinställningar** | Vilka uppdateringar om incidenter, varningar, monitorer och mer du får, och på vilken kanal. | |
| **E-postinställningar** | Hur många e-postmeddelanden du får: ett i taget, eller samlade. | [Aviseringssammanfattning](/docs/emails/notification-rollup) |
| **Jourloggar** | Varje larm som skickats till dig, och vad som hände med det. | |
| **Inkommande telefonnummer** | Numret som en policy för inkommande samtal ringer dig på. | [Policy för inkommande samtal](/docs/on-call/incoming-call-policy) |
| **Kalenderflöde** | Dina jourpass i Google Calendar, Apple Calendar eller Outlook. | [Kalenderflöden](/docs/on-call/calendar-feeds) |

## Språk och tema

Båda sparas i din webbläsare, inte i ditt konto, så ställ in dem igen i en annan webbläsare eller på en annan enhet.

- **Språk**: instrumentpanelen startar på webbläsarens språk. Använd språkmenyn längst ned på varje sida för att byta. Den här dokumentationen har en egen språkmeny högst upp.
- **Tema**: välj **Mörkt tema** i användarmenyn. Instrumentpanelen startar i det ljusa temat.

## Ta bort ditt konto

Öppna **Farozon → Ta bort konto**. Du kan bara ta bort ditt konto när du inte är med i något projekt: sidan listar projekten du fortfarande är med i. Lämna dem först, klicka sedan på **Ta bort konto** och bekräfta. Att ta bort ditt konto är permanent och kan inte ångras.

## Felsökning

:::details Jag fick inte e-postmeddelandet för att verifiera min adress
Loggar du in igen skickas en ny länk: titta även i skräppostmappen. Kan du inte logga in, använd **Glömt lösenord?** på inloggningssidan. Återställningslänken verifierar också din adress.
:::

:::details Jag har tappat bort min autentiseringsapp
I inloggningens andra steg väljer du **Förlorat åtkomsten till din autentiseringsapp?** och anger en av dina reservkoder. Öppna sedan **Säkerhet → Two-factor authentication** och lägg till din nya app. Utan reservkoder ber du en administratör för din OneUptime-installation att återställa tvåfaktorsautentiseringen för ditt konto.
:::

:::details Tiderna i instrumentpanelen är en timme fel
Instrumentpanelen visar tider i den **Tidszon** som står i din profil, inte i datorns. Kontrollera den under **Användarprofil → Översikt**.
:::

## Nästa steg

:::cards
- [Startsida och kortkommandon](/docs/introduction/home): Hitta rätt i instrumentpanelen.
- [Eskaleringsregler](/docs/on-call/escalation-rules): Hur en jourpolicy larmar dig.
- [Användare, team och behörigheter](/docs/permissions/index): Vad som avgör vad du får göra i ett projekt.
- [SSO](/docs/identity/sso): Logga in via ditt företags identitetsleverantör.
:::
