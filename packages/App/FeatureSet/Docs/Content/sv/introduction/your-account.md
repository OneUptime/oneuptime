# Ditt konto

Ditt konto är hur OneUptime känner dig: e-postadressen och lösenordet du loggar in med, ditt namn, din tidszon och ditt språk, och det som skyddar din inloggning. Ett konto kan tillhöra många projekt, och de här inställningarna följer med dig in i vart och ett av dem. Hur OneUptime når dig, och när du larmas, ställer du in i varje projekt under **Användarinställningar**.

```mermaid title="Det som hör till ditt konto, och det som varje projekt sparar åt dig"
flowchart TB
    account["Ditt konto:<br/>inloggning och profil"] --> projectA["Projekt A"]
    account --> projectB["Projekt B"]
    projectA --> settingsA["Användarinställningar i A:<br/>hur du larmas"]
    projectB --> settingsB["Användarinställningar i B:<br/>hur du larmas"]
```

:::cards
- [Din profil](#din-profil): Ditt namn, din e-postadress, din tidszon, ditt språk och din bild.
- [Logga in säkert](#logga-in-säkert): Ditt lösenord, inloggningslänkar, passnycklar och tvåfaktorsautentisering.
- [Dina projekt](#dina-projekt): Byt projekt, skapa ett och acceptera inbjudningar.
- [Användarinställningar](#det-som-varje-projekt-sparar-åt-dig): Hur OneUptime når dig i varje projekt.
:::

## Användarmenyn

Klicka på din bild uppe till höger i instrumentpanelen.

| Post | Vad den gör |
| --- | --- |
| **Profil** | Öppnar **Användarprofil**: ditt namn, din e-postadress, din tidszon, ditt språk, din bild och säkerheten för din inloggning. |
| **Admin-inställningar** | Öppnar Admin Dashboard. Bara huvudadministratörer för en självhostad installation ser den. |
| **Tema** | Väljer instrumentpanelens tema: **Ljust**, **Mörkt** eller **System**, som är ljust eller mörkt beroende på hur din enhet är inställd. |
| **Logga ut** | Loggar ut dig, direkt på varje OneUptime-server. Där din administratör har ställt in det loggar den även ut dig från din identitetsleverantör. |

**Användarprofil** har en egen sidomeny. **Grundläggande** innehåller **Översikt** och **Profilbild**. **Säkerhet** och **Farozon** är hopfällda: klicka på ett avsnitts rubrik för att öppna det.

## Din profil

:::steps
### Öppna din profil

Klicka på din bild uppe till höger och välj **Profil**. Sidan **Översikt** öppnas på kortet **Grundläggande information**: ditt namn, din e-postadress, din tidszon och ditt språk.

### Redigera dina uppgifter

Klicka på **Redigera Användare** och ändra det du behöver:

- **E-post**: adressen du loggar in med. Om du ändrar den skickar OneUptime en länk till den nya adressen, och din adress ändras när du öppnar den. Tills dess loggar du in med den nuvarande, och **Avbryt ändring** stoppar ändringen. En huvudadministratörs egen adress ändras direkt. Om länken går ut skickar **Skicka länken igen** en ny. Varje gång din adress ändras mejlar OneUptime adressen du hade.
- **Fullständigt namn**: namnet som ditt team ser överallt i OneUptime.
- **Tidszon**: tidszonen som instrumentpanelen visar och läser tider i, och den som används för tiderna i aviseringar till dig.
- **Språk**: språket i instrumentpanelen i alla webbläsare du loggar in i, och i dina jourlarm. Inte valt: dina larm är på engelska och instrumentpanelen följer din webbläsare.

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
| **Passnycklar** | Logga in utan lösenord, med ditt fingeravtryck, ditt ansikte, skärmlåset eller en säkerhetsnyckel. |
| **Tvåfaktorsautentisering** | Kräv ett andra steg efter lösenordet eller en länk via e-post: en kod från en app, eller en säkerhetsnyckel. |

### Byt lösenord

:::steps
1. Öppna **Säkerhet → Lösenordshantering**.
2. Ange det nya lösenordet i **Nytt lösenord** och igen i **Bekräfta lösenord**. Det måste vara minst 15 tecken långt och inte förutsägbart, som ett vanligt lösenord eller ett upprepat mönster: några ord som inte har med varandra att göra fungerar bra. Checklistan under fältet bockar av varje del medan du skriver.
3. Klicka på **Uppdatera lösenord**.
:::

Ett nytt lösenord loggar ut alla enheter från ditt konto, och varje återställningslänk eller inloggningslänk som redan skickats slutar fungera.

Alla sidor som anger ett lösenord kräver samma sak: registreringen, återställningslänken från **Glömt lösenord?**, den här sidan och en serveradministratörs **Ange lösenord**. Ett lösenord som du angav före den här regeln fortsätter att fungera tills du ändrar det.

### Lägg till en passnyckel

:::steps
1. Öppna **Säkerhet → Passnycklar** och klicka på **Lägg till passnyckel**.
2. Ge den ett namn som du känner igen, till exempel din enhet eller din lösenordshanterare, och klicka på **Skapa passnyckel**.
3. Följ webbläsarens uppmaning för att spara passnyckeln.
:::

Nästa gång väljer du **Fler sätt att logga in** → **Logga in med en passnyckel** på inloggningssidan.

### Logga in med en länk via e-post

Du kan logga in med en länk i stället för ditt lösenord. Det finns inget att ställa in.

:::steps
1. Välj **Fler sätt att logga in** → **Skicka en inloggningslänk till mig** på inloggningssidan.
2. Ange din e-postadress och klicka på **Skicka en inloggningslänk till mig**. Sidan visar sedan **Kolla din e-post**.
3. Öppna länken i e-postmeddelandet och klicka på **Logga in**.
:::

Länken fungerar en gång, i 15 minuter, och en nyare länk ersätter den. Du kan öppna den på en annan enhet, och då är du inloggad där. Om du använder tvåfaktorsautentisering ber OneUptime fortfarande om ditt andra steg.

> [!NOTE]
> Huvudadministratörer för en självhostad installation kan stänga av inloggningslänkar med **Låt personer logga in med en länk via e-post**, under **Admin Dashboard > Inställningar > Autentisering**. Länkar som redan har skickats slutar då fungera. Så länge servern kräver SSO erbjuder inloggningssidan bara SSO.

### Slå på tvåfaktorsautentisering

Tvåfaktorsautentisering gäller när du loggar in med ditt lösenord eller en länk via e-post. Den aktiveras först när ditt andra steg fungerar, så den ber aldrig om ett steg du inte har.

:::steps
### Välj ditt andra steg

Öppna **Säkerhet → Tvåfaktorsautentisering** och klicka på **Aktivera tvåfaktorsautentisering**. Välj **Autentiseringsapp** eller **Säkerhetsnyckel** och klicka på **Fortsätt**.

### Konfigurera det

För en autentiseringsapp skannar du QR-koden med en app som 1Password, Google Authenticator eller Microsoft Authenticator, anger den sexsiffriga kod den visar och klickar på **Verifiera och slutför**. En USB- eller NFC-nyckel ger du ett namn och följer webbläsarens anvisningar. Tvåfaktorsautentisering är sedan aktiverad, och kortet visar **Aktiverad**. Från din nästa inloggning med lösenord eller en länk via e-post ber OneUptime om ditt andra steg.

### Spara dina reservkoder

Första gången du lägger till en app, en nyckel eller en passnyckel visar OneUptime **Dina reservkoder**. Varje kod loggar in dig en gång om du tappar bort din app eller nyckel. Kopiera eller ladda ned dem, kryssa i rutan som säger att du har sparat dem och klicka på **Klar**.
:::

Har du redan en app under **Autentiseringsappar** eller en nyckel under **Säkerhetsnycklar**, ber **Aktivera tvåfaktorsautentisering** dig bara att bekräfta. Så länge den är aktiverad går det inte att ta bort din sista app, nyckel eller passnyckel: lägg först till en annan, eller stäng av tvåfaktorsautentisering. Visar kortet **Konfiguration krävs**, är tvåfaktorsautentisering aktiverad utan att något är konfigurerat, ofta för att en administratör har krävt det: klicka på **Slutför konfigurationen**, annars blir du ombedd att göra det vid nästa inloggning.

### Konfigurera tvåfaktorsautentisering när du loggar in

När en administratör kräver tvåfaktorsautentisering och du inte har konfigurerat något ännu, ber din nästa inloggning med lösenord eller en länk via e-post dig att konfigurera den innan du släpps in. Välj **Autentiseringsapp** eller **Säkerhetsnyckel** och klicka på **Fortsätt**:

- **Autentiseringsapp**: skanna QR-koden, ange den sexsiffriga kod din app visar och klicka på **Verifiera och logga in**.
- **Säkerhetsnyckel**: klicka på **Registrera säkerhetsnyckel** och följ webbläsarens anvisningar. Rör vid en USB- eller NFC-nyckel, eller använd fingeravtryck, ansikte eller skärmlås på din telefon eller dator.

Har du inga reservkoder ännu visar OneUptime dem sedan en gång, och du är inloggad. **Välj ett annat sätt** går tillbaka till valet. En webbläsare som inte kan registrera en säkerhetsnyckel, till exempel på en sida utan HTTPS, erbjuder bara autentiseringsappen.

> [!TIP]
> Håller reservkoderna på att ta slut? **Generera nya koder** på samma sida ger dig en ny uppsättning, och de gamla koderna slutar fungera direkt.

### När din organisation hanterar din inloggning

På en server som kräver enkel inloggning loggar du bara in via organisationens identitetsleverantör, till exempel Okta eller Microsoft Entra ID, och OneUptime konfigurerar inget lösenord, ingen passnyckel och ingen tvåfaktorsautentisering åt dig. **Användarprofil** har då ingen del som heter **Säkerhet**, och dess **Översikt** visar din leverantör under **Enkel inloggning**. Byt lösenord och andra steg hos din identitetsleverantör. Det du konfigurerade tidigare finns kvar: det fungerar igen först om servern slutar kräva enkel inloggning, om inte en serveradministratör rensar det, och då får du ett e-postmeddelande. Huvudadministratörer behåller sina egna inställningar under **Säkerhet**.

Samma sak händer när alla projekt du tillhör kräver enkel inloggning och har **Hantera inloggning med SSO** påslaget. Ditt lösenord loggar fortfarande in dig i OneUptime, men alla projekt ber om SSO, så OneUptime konfigurerar inget nytt lösenord, ingen ny passnyckel och inget nytt andra steg åt dig:

- **Ett projekt som inte gör det**: så snart du är medlem i, eller inbjuden till, ett projekt som inte kräver SSO eller inte har **Hantera inloggning med SSO** påslaget, kommer din del **Säkerhet** tillbaka. **Översikt** visar då de projekten under **Enkel inloggning**, som skälet till att inställningarna är dina. Lämnar du det projektet förlorar du dem igen.
- **Projekt med olika leverantörer**: om alla dina projekt hanterar inloggningen, vart och ett med sin egen identitetsleverantör, visar **Översikt** varje leverantör.
- **Huvudadministratörer** behåller alltid sina egna inställningar under **Säkerhet**.
- **Det du konfigurerade tidigare** finns kvar. En serveradministratör kan rensa det, och det kan även en ägare till alla projekt du tillhör; du får ett e-postmeddelande när det sker.

### Bekräfta att det är du

Vissa ändringar ber dig först bekräfta att det är du, även om du är inloggad, så att ingen kan göra dem från en webbläsare där du har förblivit inloggad. OneUptime frågar innan du:

- ändrar din e-postadress eller ditt lösenord;
- lägger till eller tar bort en passnyckel, en säkerhetsnyckel eller en autentiseringsapp;
- får nya reservkoder medan du fortfarande har oanvända;
- stänger av tvåfaktorsautentisering;
- tar bort ditt konto.

Dialogrutan **Bekräfta att det är du** ber om ditt lösenord och, medan tvåfaktorsautentisering är aktiverad, om ditt andra steg: en kod från din autentiseringsapp, din säkerhetsnyckel eller en av dina reservkoder. Med en passnyckel klickar du i stället på **Använd en passnyckel**. Om du bara loggar in med enkel inloggning, Google eller Microsoft klickar du på **Logga in igen**: OneUptime får din identitetsleverantör att be dig logga in igen och tar sedan tillbaka dig till sidan. Därefter genomförs ändringen. Om du bara loggar in med Vercel, som inte kan bekräfta att det är du, väljer du i stället **Logga in på ett annat sätt** och loggar in med en länk som skickas till din e-post.

När du har bekräftat blir du inte tillfrågad igen på 10 minuter i den webbläsaren. Fem felaktiga försök loggar ut den webbläsaren, men låser aldrig ditt konto: logga in igen och försök en gång till. OneUptime skickar ett e-postmeddelande till dig när det händer, och varje gång en reservkod bekräftar att det är du.

På en självhostad server bekräftar huvudadministratörer på samma sätt att det är de innan de ändrar hur någon annan loggar in, tar bort någon annans konto, gör någon till huvudadministratör, ändrar serverns leverantörer för enkel inloggning eller e-postinställningar, eller skapar en master-API-nyckel eller slår på den igen. Master-API-nyckeln kan inte göra dessa ändringar.

Att logga in igen räknas bara när din identitetsleverantör säger att du loggade in efter att OneUptime skickade dig dit. Om leverantören loggar in dig med en session den redan har, utan att be om ditt lösenord, bekräftar det ingenting: logga först ut från leverantören och klicka sedan på **Logga in igen**. Där din server låter dig logga in med en länk via e-post gör **Logga in på ett annat sätt** det i stället. Vad OneUptime ber varje leverantör om, och vad en administratör kan ändra när en ny inloggning inte bekräftar något:

| Leverantör | Vad OneUptime ber om | När det inte bekräftar något |
| --- | --- | --- |
| SAML | `ForceAuthn="true"` och när du loggade in (`AuthnInstant`) | Låt leverantören följa begäran, till exempel med Honor Force Authentication i Okta. |
| OpenID Connect | `prompt=login` och `max_age=0`, och när du loggade in (`auth_time`) | Låt leverantören skicka `auth_time`. I Microsoft Entra ID lägger du till det i ID-token som ett valfritt anspråk. |
| Google | När du loggade in (`auth_time`). Google kan inte ombes att låta dig logga in igen. | Aktivera Session age claims för serverns Google-inloggningsapp, som måste vara publicerad och verifierad. |
| Microsoft | `prompt=login` och `max_age=0`, och när du loggade in (`auth_time`) | Lägg till `auth_time` i ID-token för serverns Microsoft-inloggningsapp som ett valfritt anspråk. |
| Vercel | Inget: Vercel kan inte ombes att låta dig logga in igen, och anger inte när du loggade in. | Det bekräftar aldrig. Välj **Logga in på ett annat sätt** och logga in med en länk som skickas till din e-post, eller skapa ett lösenord med **Glömt lösenord?** och bekräfta med det. |

Vad du ska ställa in i Okta, Microsoft Entra ID, Keycloak och Google Workspace står på sidan [SSO](/docs/identity/sso#logga-in-igen-för-att-bekräfta-att-det-är-du).

## Dina projekt

Du kan tillhöra hur många projekt som helst. Projektväljaren uppe till vänster i instrumentpanelen listar dem: välj ett för att byta.

- **Skapa ett projekt**: öppna projektväljaren och klicka på **Skapa nytt projekt**. På en självhostad installation kan administratören förbehålla administratörer att skapa projekt.
- **Acceptera en inbjudan**: när någon bjuder in dig visar klockan uppe till höger den väntande inbjudan och öppnar **Projektinbjudningar**. Där väljer du **Acceptera** eller **Avvisa**.
- **Lämna ett projekt**: be någon som hanterar projektets användare att ta bort dig, med **Ta bort från projekt** på projektets sida **Användare**.

## Det som varje projekt sparar åt dig

**Användarinställningar**, till höger i fältet under toppfältet, är bara dina, och varje projekt har sina egna. Öppna dem i varje projekt där du har jour. De öppnas på **Checklista för konfiguration** så länge något återstår att konfigurera, och på **Aviseringsmetoder** när inget väsentligt saknas.

| Sida | Vad den används till | Läs mer |
| --- | --- | --- |
| **Checklista för konfiguration** | Leder dig genom allt nedan och visar vad som återstår. | |
| **Aviseringsmetoder** | E-postadresserna, telefonnumren, apparna och webhookarna som OneUptime kan nå dig på. Din inloggningsadress läggs till åt dig. | |
| **Så når man mig** | Vilken metod som används, och efter hur lång tid, när en jourpolicy larmar dig. | [Eskaleringsregler](/docs/on-call/escalation-rules) |
| **Aviseringsinställningar** | Vilka uppdateringar om incidenter, larm, monitorer och mer du får, och på vilken kanal. | |
| **E-postinställningar** | Hur många e-postmeddelanden du får: ett i taget, eller samlade. | [Aviseringssammanfattning](/docs/emails/notification-rollup) |
| **Jourloggar** | Varje larm som skickats till dig, och vad som hände med det. | |
| **Inkommande telefonnummer** | Numret som en policy för inkommande samtal ringer dig på. | [Policy för inkommande samtal](/docs/on-call/incoming-call-policy) |
| **Kalenderflöde** | Dina jourpass i Google Calendar, Apple Calendar eller Outlook. | [Kalenderflöden](/docs/on-call/calendar-feeds) |

## Språk och tema

Ditt tema sparas i din webbläsare, så ställ in det igen i en annan webbläsare eller på en annan enhet. Ditt språk sparas i ditt konto så snart du väljer det, och alla webbläsare du loggar in i startar på det. De finns kvar när du loggar ut, så på en delad dator börjar nästa person med dina inställningar.

- **Språk**: instrumentpanelen startar på webbläsarens språk. Använd språkmenyn längst ned på varje sida för att byta. Ditt val sparas i ditt konto, precis som **Språk** i din profil, och OneUptime skriver dina jourlarm på det. Se [Språket i dina larm](/docs/notifications/index#språket-i-dina-larm). Den här dokumentationen har en egen språkmeny högst upp.
- **Tema**: välj **Ljust**, **Mörkt** eller **System** i användarmenyn. **System** är ljust eller mörkt beroende på hur din enhet är inställd, och växlar med den; alla webbläsare startar med det. Inloggningssidorna använder samma tema.

## Ta bort ditt konto

Öppna **Farozon → Ta bort konto**. Du kan bara ta bort ditt konto när du inte är med i något projekt: sidan listar projekten du fortfarande är med i. Lämna dem först, klicka sedan på **Ta bort konto** och bekräfta. Att ta bort ditt konto är permanent och kan inte ångras. Innan OneUptime tar bort ditt konto ber det dig bekräfta att det är du.

## Felsökning

:::details Jag fick inte e-postmeddelandet för att verifiera min adress
Loggar du in igen skickas en ny länk: titta även i skräppostmappen. Kan du inte logga in, använd **Glömt lösenord?** på inloggningssidan. Återställningslänken verifierar också din adress.
:::

:::details Registreringen skickade ett mejl om att jag redan har ett konto
Den adressen har redan ett OneUptime-konto, så registreringen skapade och ändrade ingenting. Logga in med den, eller använd **Glömt lösenord?** på inloggningssidan om du inte minns ditt lösenord. Registreringssidan säger samma sak för alla adresser, så den avslöjar inte för någon vilka adresser som har ett konto.
:::

:::details Min e-postadress har inte ändrats
Din adress ändras först när du öppnar länken som OneUptime skickade till den nya adressen. Länken fungerar i 24 timmar: när den har gått ut står det i din profil, och **Skicka länken igen** skickar en ny. Om ett annat konto redan använder adressen står det i mejlet som skickades dit, och din adress förblir som den är.
:::

:::details Jag fick ett mejl om att min e-postadress har ändrats
OneUptime mejlar adressen som ditt konto hade varje gång adressen ändras: när du öppnar länken som skickades till en ny adress, när en serveradministratör ändrar den eller när din organisations identitetsleverantör ändrar den. Om du gjorde ändringen själv behöver du inte göra något. Om inte har någon som kunde logga in på ditt konto flyttat det till en egen adress: kontakta från din gamla adress din serveradministratör eller, på OneUptime Cloud, support@oneuptime.com, som kan flytta tillbaka det. Mejlet visar bara en del av den nya adressen och har ingen länk för att ångra ändringen: en sådan länk skulle fungera för alla som läser din gamla inkorg.
:::

:::details Jag har tappat bort min autentiseringsapp
I inloggningens andra steg väljer du **Förlorat åtkomsten till din autentiseringsapp?** och anger en av dina reservkoder. Öppna sedan **Säkerhet → Tvåfaktorsautentisering** och lägg till din nya app. Utan reservkoder ber du en administratör för din OneUptime-installation att återställa tvåfaktorsautentiseringen för ditt konto.
:::

:::details Inloggningen ber mig vänta innan jag provar en annan kod
Efter fem felaktiga koder i rad väntar varje nästa kod innan den kontrolleras: en minut, sedan två, sedan fyra och så vidare, upp till en timme. OneUptime räknar felaktiga koder för ditt konto var de än anges, skickar ett e-postmeddelande till dig när väntetiderna börjar och börjar räkna om när du anger en rätt kod. Vänta och försök igen, logga in med en säkerhetsnyckel, eller välj **Förlorat åtkomsten till din autentiseringsapp?** och ange en reservkod. Om det inte var du som angav de koderna känner någon till ditt lösenord eller kan läsa din e-post, och e-postmeddelandet som OneUptime skickade till dig talar om vilket. Om någon kan läsa din e-post ändrar du först lösenordet till ditt e-postkonto och tar bort all vidarebefordran som du inte själv har ställt in: ett nytt OneUptime-lösenord räcker inte för att hindra dem från att be om en ny inloggningslänk. Återställ sedan ditt lösenord med **Glömt lösenord?** på inloggningssidan, vilket avslutar väntan och gör varje inloggningslänk som redan skickats ogiltig.
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
