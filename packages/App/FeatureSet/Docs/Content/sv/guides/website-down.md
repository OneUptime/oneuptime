# Få veta när din webbplats eller ditt API går ner

När du har gått igenom den här guiden kontrollerar OneUptime din webbplats eller ditt API var 5:e minut, öppnar en incident när svaret uteblir eller är ett fel och meddelar dig, och ett testlarm som du har bekräftat visar att meddelandet når fram till dig. Guiden följer den guidade konfigurationen **Veta när min webbplats eller mitt API ligger nere** och tar ungefär 5 minuter.

```mermaid title="Det här har du när du är klar"
flowchart TB
    probes["OneUptimes sonder"] -->|"var 5:e minut"| site["Din webbplats<br/>eller ditt API"]
    site -->|"inget svar eller ett fel"| incident["En incident"]
    incident --> you["Du och de personer<br/>som du väljer"]
```

## Det här behöver du

- Ett OneUptime-projekt där du får skapa monitorer: det får en ägare, en administratör eller en medlem göra. För att skapa ett konto och ett projekt följer du den första delen av [Snabbstart](/docs/introduction/quickstart#skapa-ett-projekt).
- Adressen som ska kontrolleras, till exempel `https://example.com`. För ett API väljer du en endpoint som svarar på en vanlig `GET` utan nyckel, till exempel en hälsokontroll: ett svar som `401` räknas som nere.

:::tabs
@tab OneUptime Cloud
Sonder i flera regioner kontrollerar adressen, så den måste gå att nå från internet, och en incident öppnas bara när alla finner den nere. Free-planen har 10 aktiva monitorer. De faktureras efter användning, så projektet behöver först en betalningsmetod: utan en säger det första steget det, med **Lägg till betalningsmetod**.
@tab Egenvärdad
Adressen kontrolleras från din servers egen sond, så den måste gå att nå därifrån. För att du ska få e-post måste servern kunna skicka e-post: serverns huvudadministratör konfigurerar det på `/admin/setup`, som sidan [Guide för självhosting](/docs/installation/self-hosting-guide) visar.
:::

## Steg

:::steps
### Öppna den guidade konfigurationen

![Hem frågar ”Vad vill du göra först?”, med ”Veta när min webbplats eller mitt API ligger nere” ikryssat](screen:home-goal-website)

I ett nytt projekt börjar sidan **Hem** med frågan **Vad vill du göra först?**: kryssa i **Veta när min webbplats eller mitt API ligger nere** och klicka på **Fortsätt**. Klicka sedan på **Skapa din första monitor** i checklistan **Välkommen till OneUptime 👋**. Om checklistan inte visar det steget trycker du på `Ctrl+K` (`Cmd+K` på en Mac), skriver `website down` och väljer **Veta när min webbplats eller mitt API ligger nere**. **Monitorer** erbjuder den också: **Guidad installation** i den tomma listan och under **Så fungerar det**, och en rad på **Skapa monitor** när du väljer **Webbplats** eller **API**.

### Ange adressen

![Steget ”Vad ska vi kontrollera?”, med ”Börja kontrollera” markerad](screen:website-down-address)

Under **Vad ska vi kontrollera?** säger steget från hur många platser adressen kontrolleras. Skriv den i **Adress till webbplats eller API**. För en API-endpoint kryssar du i **Det här är en API-endpoint**. Klicka på **Börja kontrollera**: sonderna kontrollerar adressen direkt, och en mening talar om vad de hittade. Klicka på **Fortsätt**.

Om en kollegas monitor redan kontrollerar adressen, eller en monitor som API:t, Terraform eller en import har skapat, säger steget det innan något skapas. Klicka på **Öppna monitorn** för att se vem den larmar, eller på **Skapa min egen monitor** för att fortsätta med en egen. Det nämner bara en monitor som du får öppna.

### Välj vem som får veta

![Steget ”Vem ska få veta?”, med ”Spara och fortsätt” markerad](screen:website-down-who)

Under **Vem ska få veta?** beror det du ser på projektet:

- Om projektet ännu inte har någon jourpolicy eller jourregel finns du redan i **Vem som larmas**. Klicka på **Lägg till teammedlemmar** för att lägga till personer som redan finns i projektet, och klicka sedan på **Spara och fortsätt**. Då skapas **Standardjourpolicy**, som larmar dem vid varje ny incident och varje nytt larm i projektet. Varje person larmas som deras **Så når man mig** säger: länken öppnar ditt i en ny flik.
- Om projektet har en jourpolicy eller jourregel avgör projektets egna regler vem som larmas: klicka på **Fortsätt**.
- Är du medlem, och får alltså inte konfigurera larmning, får du veta att du kommer att få e-post som monitorns ägare: klicka på **Fortsätt**.

### Skicka ett test till dig själv

![Steget ”Skicka ett test”, med ”Skicka ett testlarm till mig” markerad](screen:website-down-test)

Under **Skicka ett test** klickar du på **Skicka ett testlarm till mig**. Välj en **Allvarlighetsgrad**: raden under säger att testet når dig som ditt **Så når man mig** säger för den allvarlighetsgraden. Klicka på **Skicka testlarm**. Testet når dig på samma sätt som ett riktigt larm skulle göra, och varje meddelande är märkt TEST. Ingen incident skapas.

### Bekräfta testlarmet

Öppna länken i e-postmeddelandet och bekräfta larmet där. Ett verifierat telefonnummer fungerar också, när sms och samtal är påslagna i projektet: öppna länken i sms:et, eller tryck på 1 under samtalet. Klicka sedan på **Klar** i dialogrutan och därefter på **Fortsätt**.

### Visa den för kunderna

Om projektet har en statussida och du får lägga till monitorer på den följer ett steg till. Under **Visa den för kunderna?** väljer du sidan i **Statussida** och klickar på **Lägg till på statussida**, eller så klickar du på **Inte nu**. Ett projekt utan statussida hoppar över det: sammanfattningen erbjuder i stället **Visa den på en statussida**, med din monitor redan ikryssad.
:::

## Kontrollera att det fungerade

![Sammanfattningen, läst från posterna: ”Kontrollerad”, ”När den går ner”, ”Vem som får veta” och ”Testat”](screen:website-down-summary)

- Konfigurationen avslutas med sin sammanfattning, som bygger på det som faktiskt har sparats: **Kontrollerad**, **När den går ner**, **Vem som får veta** och **Testat**, och **Statussida** så snart en sida visar monitorn.
- Under **Nästa steg** öppnar **Bli larmad via SMS eller telefonsamtal** den guidade installationen **Larma rätt person när något går sönder**, som lägger till din telefon.
- Klicka på **Öppna monitorn** och sedan på **Visa kedjan** på monitorns kort **När den går ner**: där visas kedjan från monitorn till de personer som den når, och när inget skulle stoppa kedjan står det **Inget stoppar kedjan.**
- På sidan **Hem** markerar checklistan **Skapa din första monitor** som klar så snart den första kontrollen har kommit in. Om det var det sista steget försvinner checklistan.

För att konfigurera ytterligare en adress senare öppnar du konfigurationen igen och klickar på **Kontrollera en annan adress**.

## Vad som kan gå fel

:::details Den första kontrollen kommer aldrig tillbaka
En mening som säger att ingen plats kontrollerar adressen betyder att monitorn saknar sond; en mening som hela tiden säger att kontrollen pågår betyder att dess sond inte är ansluten. Öppna **Monitorer → Inställningar → Sonder** för att se varje sonds status. På en egenvärdad server kontrollerar huvudadministratören serverns sond på `/admin/setup`. Öppna sedan monitorn, lägg till en ansluten sond i den och öppna konfigurationen igen.
:::

:::details Webbplatsen fungerar, men monitorn säger att den ligger nere
Monitorn räknar inget svar, eller ett svar utanför 200 till 399, som nere. En brandvägg som blockerar sonderna ser ut som inget svar: på OneUptime Cloud tillåter du adresserna på sidan [IP-adresser](/docs/configuration/ip-addresses); på en egenvärdad server tillåter du maskinen som sonden körs på. Om du vill ändra regeln, se [Webbplatsövervakning](/docs/monitor/website-monitor) eller [API-övervakning](/docs/monitor/api-monitor).
:::

:::details Testlarmet går inte att bekräfta
Inget meddelande har kommit fram som larmet kan bekräftas från, vilket på en egenvärdad server oftast betyder att servern inte kan skicka e-post än: steget säger det, och serverns huvudadministratör ser **Ställ in e-post**. Ställ in e-posten och klicka sedan på **Skicka ett test till**, eller klicka på **Hoppa över testet** och kom tillbaka senare. Efter ett test stänger du dialogrutan med **Klar** och klickar på **Jag fick inget**: där står vad du ska kontrollera.
:::

## Nästa steg

:::cards
- [Bli larmad via samtal, SMS eller push](/docs/guides/paging): Bli larmad på telefonen, och larma nästa person om ingen svarar.
- [Publicera en statussida](/docs/guides/status-page): Visa monitorn för dina kunder, på din egen domän.
- [Kriterier och statusar](/docs/monitor/criteria-and-statuses): Bestäm exakt när en monitor räknas som nere.
:::
