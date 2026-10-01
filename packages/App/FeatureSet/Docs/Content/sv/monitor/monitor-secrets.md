# Monitorhemligheter

Du kan använda hemligheter för att lagra känslig information som du vill använda i dina övervakningskontroller. Hemligheter krypteras och lagras säkert.

### Lägga till en hemlighet

För att lägga till en hemlighet, gå till OneUptime-instrumentpanelen -> Övervakare -> Inställningar -> Hemligheter -> Create Monitor Secret.

![Create Secret](/docs/static/images/CreateMonitorSecret.png)

Ge hemligheten ett namn och ett värde och välj sedan i steget **Åtkomst** vilka övervakare som kan använda den. I det här exemplet har vi lagt till en `ApiKey`-hemlighet.

**Observera**: Hemligheter krypteras och lagras säkert. Värdet visas aldrig igen efter att det sparats — varken i tabellen, i redigeringsformuläret eller via API:et. Om du tappar bort värdet måste du hämta det från källan och ange det på nytt. Använd knappen **Uppdatera hemligt värde** på raden för att rotera en hemlighet; du behöver inte ta bort den och skapa den igen.

### Välja vilka övervakare som kan använda en hemlighet

Varje hemlighet har ett av tre åtkomstalternativ:

- **Alla övervakare**: alla övervakare i projektet kan använda hemligheten, även övervakare som du skapar senare. Använd det för autentiseringsuppgifter som många övervakare delar.
- **Specifika övervakare**: endast de övervakare som du väljer kan använda hemligheten. Det är standardvalet, och hemligheter som skapades innan de här alternativen fanns fungerar på det här sättet.
- **Övervakare med etiketter**: övervakare som har minst en av de etiketter som du väljer kan använda hemligheten. Om du lägger till en av etiketterna på en övervakare får den åtkomst, och om du tar bort etiketten förlorar den åtkomsten nästa gång övervakaren körs.

Du kan ändra alternativet när som helst med **Redigera** på hemlighetens rad. Endast listan för det valda alternativet behålls: byter du till **Alla övervakare** töms hemlighetens övervakar- och etikettlista, och byter du mellan **Specifika övervakare** och **Övervakare med etiketter** töms listan som du byter bort från.

En hemlighet är aldrig tillgänglig för övervakare i ett annat projekt.

Den som kan redigera en övervakare med åtkomst till en hemlighet kan skicka hemligheten till vilket mål som helst som övervakaren ansluter till. Med **Alla övervakare** gäller det alla som kan skapa eller redigera övervakare i projektet. Med **Övervakare med etiketter** gäller det också alla som kan lägga till en av etiketterna på en övervakare.

I API:et är åtkomstalternativet fältet `monitorAccess`: `All Monitors`, `Specific Monitors` eller `Monitors With Labels`. Fälten `monitors` och `labels` innehåller listorna. En hemlighet som skapas utan `monitorAccess` får `Specific Monitors`.

### Använda en hemlighet

Du kan använda hemligheter i följande monitortyper:

- API (i förfrågningshuvuden, förfrågningsinnehåll och URL)
- Webbplats, IP, Port, Ping, SSL-certifikat (i URL)
- Syntetisk monitor, Anpassad kodmonitor (i koden)
- SNMP-monitor (i community string, SNMPv3-autentiseringsnyckel och priv-nyckel)

![Using Secret](/docs/static/images/UsingMonitorSecret.png)

För att använda en hemlighet, lägg till `{{monitorSecrets.SECRET_NAME}}` i fältet där du vill använda hemligheten. I det här fallet lade vi till `{{monitorSecrets.ApiKey}}` i fältet för förfrågningshuvudet.

Hemligheter injiceras i sonden innan Syntetiska eller Anpassade kodmonitorskript exekveras, så referenser som `{{monitorSecrets.ApiKey}}` löser upp till det dekrypterade värdet inuti det körande skriptet.

Om en övervakare hänvisar till en hemlighet som den inte får använda lämnas hänvisningen som den är och ersätts inte med värdet.

När du testar en övervakare innan du sparar den fylls endast hemligheter med **Alla övervakare** i, eftersom en ny övervakare inte finns i någon lista och inte har några etiketter ännu. När övervakaren har sparats använder tester alla hemligheter som övervakaren får använda.
