# Vanliga frågor och felsökning

Svar på vanliga frågor om OneUptimes mobil- och skrivbordsappar, och lösningar på det som oftast går fel: inloggningen, aviseringar som inte kommer fram och en telefon som måste registreras igen.

:::cards
- [Frågor om mobilappen](#frågor-om-mobilappen): Enheter, projekt, egen drift och säkerhet.
- [Frågor om skrivbordsappen](#frågor-om-skrivbordsappen): Vad skrivbordsappen är, och vad den inte kan.
- [När en telefon måste registreras igen](#när-en-telefon-måste-registreras-igen): Varför en telefon slutar få larm, och hur den kommer tillbaka.
- [Felsökning](#felsökning): Problem med inloggning, aviseringar och installation.
:::

## Frågor om mobilappen

:::details Är appen gratis?
Ja. OneUptime On-Call är gratis i App Store, på Google Play och som APK på GitHub. Du loggar in med ditt OneUptime-konto.
:::

:::details Vilka telefoner och surfplattor fungerar den på?
iPhone och iPad med iOS eller iPadOS 16.4 eller senare, och Android-telefoner och -surfplattor med Android 7.0 eller senare.
:::

:::details Fungerar den med ett OneUptime i egen drift?
Ja. Ange `https://`-adressen till ditt OneUptime när appen startar, eller tryck på **Change Server** på inloggningsskärmen. Som standard skickar din server larm till telefoner genom OneUptimes push-relä, så den behöver inget konto hos Apple, Google eller Expo: se [Push-aviseringar](/docs/self-hosted/push-notifications).
:::

:::details Kan jag använda den med flera projekt?
Ja. Appen registrerar telefonen i varje projekt du är medlem i, så att varje projekt kan larma dig. Den visar ett projekt i taget: tryck på projektets namn högst upp på en skärm för att byta.
:::

:::details Kan jag logga in på mer än en telefon?
Ja. Varje telefon eller surfplatta är en egen push-enhet, med egna jourregler och en egen inställning för kritiska varningar.
:::

:::details Vad kan jag göra i appen?
- **Home**: vad som behöver uppmärksamhet i projektet: aktiva incidenter och varningar, öppna säkerhetsärenden om din roll låter dig se dem, monitorer med problem och grupperade händelser.
- **Monitors**: alla monitorer, filtrerade efter hälsa, med sina detaljer.
- **Inbox**: incidenter och varningar, och episoderna som grupperar dem. Öppna en för att använda **Acknowledge**, **Resolve** eller **Add Note**. Låter din roll dig se projektets säkerhetsärenden visar **Security** de öppna: öppna ett för att använda **Approve** eller **Reject** på ett playbook-steg som väntar på godkännande, ta ärendet med **Assign to me** eller använda **Close case**.
- **On-Call**: om du har jour och till när, vem mer som har det, larmen som skickats till dig, och **Cover for me**, som lämnar över dina larm till en kollega en stund.
- **Settings**: dina projekt och enkel inloggning, utseendet, kritiska varningar och larmljudet, **Biometrics Login**, ditt jourkalenderflöde och **Log Out**.

Allt annat finns i instrumentpanelen.
:::

:::details Kan jag bekräfta ett larm från aviseringen?
Nej. Tryck på aviseringen: appen öppnar incidenten, varningen, episoden eller säkerhetsärendet den gäller, i rätt projekt, och där bekräftar du. Är appen låst eller du utloggad öppnar den larmet så snart du är inne.
:::

:::details Är min inloggning säker på telefonen?
Appen pratar med ditt OneUptime bara över HTTPS. Din inloggning sparas i appens egen lagring på telefonen, och **Log Out** raderar den och loggar också ut sessionen på servern. Slå på **Biometrics Login** så att appen frågar efter ditt ansikte, ditt fingeravtryck eller din lösenkod varje gång den startar.
:::

:::details Fungerar appen offline?
Nej. Utan anslutning visar den **No internet connection** högst upp på skärmen och fortsätter så snart anslutningen är tillbaka.
:::

## Frågor om skrivbordsappen

:::details Vad är skrivbordsappen?
OneUptime-instrumentpanelen, installerad från din webbläsare som en app: ett eget fönster, en ikon på Start-menyn, i Dock eller i din appstartare, och aviseringar. Den gör allt som instrumentpanelen gör, eftersom den är instrumentpanelen.
:::

:::details Varför finns den inte i någon appbutik?
Det behövs inte. Appen hämtar instrumentpanelen från ditt OneUptime varje gång den öppnas, så den är alltid den version som ditt OneUptime kör, på Windows, macOS och Linux likadant, utan något att uppdatera.
:::

:::details Kan den väcka mig som telefonen?
Nej. Webbläsare kan inte åsidosätta Stör ej eller ett Fokus, så en skrivbordsavisering är bara så hög som datorn tillåter. Använd mobilappen med kritiska varningar för larm som måste väcka dig.
:::

:::details Fungerar den offline?
Nej. Den behöver en anslutning till ditt OneUptime, precis som instrumentpanelen i en webbläsarflik.
:::

## När en telefon måste registreras igen

OneUptime skickar en telefons larm genom Expo, som lämnar dem vidare till Apple eller Google. När Expo säger att telefonen inte längre kan nås slutar OneUptime skicka till den, tills appen registrerar den igen.

```mermaid title="Så slutar en telefon få larm, och så kommer den tillbaka"
flowchart TB
    Registered["Telefonen är registrerad,<br/>och larmen når den"]
    Gone["Expo anmäler den borta:<br/>en push avvisas,<br/>eller dess kvitto<br/>säger det ungefär<br/>15 minuter senare"]
    Marked["OneUptime markerar den<br/>Tar inte emot aviseringar<br/>och slutar skicka;<br/>dess regler finns kvar"]
    Open["Du öppnar appen<br/>medan du är inloggad"]
    Renewed["Appen registrerar<br/>sig igen, förnyar sin<br/>push-token, och<br/>larmen når den igen"]
    Registered --> Gone --> Marked --> Open --> Renewed
```

Expo anmäler en telefon borta när appen har tagits bort från den, eller när dess push-token inte längre är giltig. Telefonen tas inte bort: **Användarinställningar → Aviseringsmetoder** visar den på fliken **Push Notifications** som **Tar inte emot aviseringar**, och jourtidslinjen för ett larm som inte nådde den säger varför. Dina andra telefoner och aviseringsmetoder larmas som vanligt.

Appen registrerar telefonen varje gång den startar, när du loggar in och när du går tillbaka till den, högst en gång var femte minut. Registreringen ber Expo om push-token igen, vilket förnyar den, och telefonen får larm igen med de regler den hade.

| Vad som hände | Vad du gör | Vad OneUptime gör |
| --- | --- | --- |
| Appen är fortfarande installerad | Öppna den medan du är inloggad | Telefonen får aviseringar igen, med sina regler |
| Du installerade om appen på en iPhone eller iPad | Installera den och logga in | Oftast kommer samma post tillbaka, med sina regler |
| Du installerade om appen på Android | Installera den, logga in och ta bort den gamla posten | En ny post med standardreglerna; den gamla förblir markerad |
| En ny telefon, konfigurerad från en säkerhetskopia av den gamla | Öppna appen på den nya telefonen | Är den gamla telefonens post markerad tar den nya över den, med sina regler; annars får den nya telefonen en egen post |
| En ny telefon, konfigurerad från början | Logga in och ta bort den gamla posten | En ny post med standardreglerna |
| Du loggade ut ur appen | Logga in igen | Utloggningen tog bort telefonen och dess regler; den kommer tillbaka med standardreglerna |

En webbläsare kan också sluta få aviseringar när dess push-prenumeration löper ut. Instrumentpanelen förnyar den när den kan; förblir webbläsaren markerad registrerar du den igen med **Registrera enhet** i den webbläsaren.

## Felsökning

### Inloggning

:::details ”Could not connect to the server”
Appen nådde inte `https://<your-oneuptime>/api/status`. Kontrollera adressen, inklusive `https://`: appen ansluter inte över vanlig HTTP. Ligger ditt OneUptime i ett privat nätverk ansluter du först telefonen till det, till exempel via ditt VPN. Öppnad i telefonens webbläsare visar adressen `{"status":"ok"}` när telefonen når OneUptime.
:::

:::details ”No SSO configuration found for the email”
Inget av de projekt som e-postadressen är medlem i har konfigurerat enkel inloggning, eller så har e-postadressen inget konto på det här OneUptime. Kontrollera e-postadressen, eller logga in med ditt lösenord. Leverantörer som din administratör har konfigurerat för hela installationen visas före e-postfältet.
:::

:::details En säkerhetsnyckel är din enda andra faktor
Appen kan inte använda en säkerhetsnyckel. Logga in med en av dina reservkoder, eller lägg till en autentiseringsapp på ditt konto i instrumentpanelen: se [Slå på tvåfaktorsautentisering](/docs/introduction/your-account#slå-på-tvåfaktorsautentisering).
:::

:::details Inloggning med passkey misslyckas
Passkeys kräver att adressen till ditt OneUptime börjar med `https://`, och en passkey som du har lagt till för det här OneUptime: se [Lägg till en passkey](/docs/introduction/your-account#lägg-till-en-passnyckel). Tryck på **Change Server** på inloggningsskärmen för att använda en annan server.
:::

### Aviseringar

:::details Inga aviseringar på telefonen
- Kontrollera att telefonen tillåter aviseringar från OneUptime On-Call, och att Stör ej eller ett Fokus inte håller tillbaka dem.
- Kontrollera under **Användarinställningar → Aviseringsmetoder**, på fliken **Push Notifications**, att telefonen finns i listan, och skicka en **Testavisering** till den.
- Är den markerad som **Tar inte emot aviseringar**, öppnar du appen medan du är inloggad: se [När en telefon måste registreras igen](#när-en-telefon-måste-registreras-igen).
- Kontrollera dina jourregler under **Användarinställningar → Jourregler**: de avgör vilka larm som når vilken metod.
- På ett OneUptime i egen drift kontrollerar du att servern når sitt push-relä: se [Push-aviseringar](/docs/self-hosted/push-notifications#nätverksåtkomst).
:::

:::details Larm kommer för sent på Android
Ställ in appens batterianvändning på **Obegränsad** i Androids inställningar för OneUptime On-Call, och håll appen utanför alla listor för batterisparande: se [Undvik att larm kommer fram för sent](/docs/mobile-desktop-apps/android-installation#undvik-att-larm-kommer-fram-för-sent).
:::

:::details Kritiska varningar ringer inte igenom tyst läge
Öppna **Settings** i appen: raden under **Critical On-Call Alerts** säger vad som saknas på den telefonen. Kontrollera sedan under **Användarinställningar → Jourregler** att jourregeln som skickade larmet är satt till **Kritisk varning**, inte **Normal**. Varje telefon har sitt eget reglage.
:::

### Skrivbordsapp

:::details Ingen installationsikon i adressfältet
Installera från en sida i instrumentpanelen efter inloggningen, över `https://`, i Edge eller Chrome, eller i Safari på macOS Sonoma 14 eller senare. Visas ikonen inte installerar även webbläsarens meny appen: se [Windows-installation](/docs/mobile-desktop-apps/windows-installation#installera-appen).
:::

:::details Inga skrivbordsaviseringar
Registrera webbläsaren under **Användarinställningar → Aviseringsmetoder**, på fliken **Push Notifications**, med **Registrera enhet**, tillåt aviseringar när du tillfrågas, och kontrollera datorns egna aviseringsinställningar. Ett OneUptime i egen drift behöver sina VAPID-nycklar för webbläsaraviseringar.
:::

## Få hjälp

Om något här inte stämmer med det du ser, [öppna ett issue på GitHub](https://github.com/OneUptime/oneuptime/issues) med din apps version, längst ner på dess skärm **Settings**, och plattformen du använder.

## Nästa steg

:::cards
- [Appar – Översikt](/docs/mobile-desktop-apps/index): Vilken app du ska använda, och hur apparna når OneUptime.
- [Android-installation](/docs/mobile-desktop-apps/android-installation): Installera och konfigurera appen på Android.
- [iOS-installation](/docs/mobile-desktop-apps/ios-installation): Installera och konfigurera appen på en iPhone eller iPad.
- [Push-aviseringar](/docs/self-hosted/push-notifications): Så skickar ett OneUptime i egen drift larm, och Expos fel.
:::
