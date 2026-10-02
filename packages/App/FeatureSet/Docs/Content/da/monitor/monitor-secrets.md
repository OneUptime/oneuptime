# Monitor Secrets

Du kan bruge hemmeligheder til at gemme følsomme oplysninger, som du vil bruge i dine overvågningsskjek. Hemmeligheder er krypteret og opbevares sikkert.

### Tilføjelse af en hemmelighed

For at tilføje en hemmelighed skal du gå til OneUptime Dashboard -> Overvågninger -> Indstillinger -> Hemmeligheder -> Opret Monitor Secret.

![Opret hemmelighed](/docs/static/images/CreateMonitorSecret.png)

Giv hemmeligheden et navn og en værdi, og vælg derefter i trinnet **Adgang**, hvilke overvågninger der må bruge den. I dette eksempel har vi tilføjet en `ApiKey`-hemmelighed.

**Bemærk venligst**: Hemmeligheder er krypteret og opbevares sikkert. Værdien vises aldrig igen, efter den er gemt — hverken i tabellen, i redigeringsformularen eller via API'et. Mister du værdien, skal du hente den fra kilden igen og indtaste den på ny. Brug knappen **Opdater hemmelig værdi** på rækken for at rotere en hemmelighed; du behøver ikke slette og oprette den igen.

### Vælg, hvilke overvågninger der må bruge en hemmelighed

Hver hemmelighed har én af tre adgangsindstillinger:

- **Alle overvågninger**: alle overvågninger i projektet må bruge hemmeligheden, også overvågninger, du opretter senere. Brug denne til legitimationsoplysninger, som mange overvågninger deler.
- **Bestemte overvågninger**: kun de overvågninger, du vælger, må bruge hemmeligheden. Det er standardindstillingen, og hemmeligheder, der blev oprettet, før disse indstillinger fandtes, fungerer på denne måde.
- **Overvågninger med etiketter**: overvågninger, der har mindst én af de valgte etiketter, må bruge hemmeligheden. Tilføjer du en af etiketterne til en overvågning, får den adgang, og fjerner du etiketten, mister den adgangen, næste gang overvågningen kører.

Du kan ændre indstillingen når som helst med **Rediger** i hemmelighedens række. Kun listen for den valgte indstilling bevares: skifter du til **Alle overvågninger**, tømmes hemmelighedens overvågnings- og etiketliste, og skifter du mellem **Bestemte overvågninger** og **Overvågninger med etiketter**, tømmes den liste, du skifter væk fra.

En hemmelighed er aldrig tilgængelig for overvågninger i et andet projekt.

Alle, der kan redigere en overvågning med adgang til en hemmelighed, kan sende hemmeligheden til enhver destination, som overvågningen forbinder til. Med **Alle overvågninger** er det alle, der kan oprette eller redigere overvågninger i projektet. Med **Overvågninger med etiketter** omfatter det også alle, der kan tilføje en af etiketterne til en overvågning.

I API'et er adgangsindstillingen feltet `monitorAccess`: `All Monitors`, `Specific Monitors` eller `Monitors With Labels`. Felterne `monitors` og `labels` indeholder listerne. En hemmelighed, der oprettes uden `monitorAccess`, får `Specific Monitors`.

### Brug af en hemmelighed

Du kan bruge hemmeligheder i følgende monitortyper:

- API (i anmodningsheadere, anmodningsindhold og URL)
- Website, IP, Port, Ping, SSL Certificate (i URL)
- Synthetic Monitor, Custom Code Monitor (i koden)
- SNMP Monitor (i community-streng, SNMPv3-autentificeringsnøgle og priv-nøgle)

![Brug hemmelighed](/docs/static/images/UsingMonitorSecret.png)

For at bruge en hemmelighed skal du tilføje `{{monitorSecrets.SECRET_NAME}}` i det felt, hvor du vil bruge hemmeligheden. For eksempel har vi i dette tilfælde tilføjet `{{monitorSecrets.ApiKey}}` i feltet Anmodningsheader.

Hemmeligheder injiceres på proben, inden Synthetic eller Custom Code-monitorscripts eksekveres, så referencer som `{{monitorSecrets.ApiKey}}` løses til den dekrypterede værdi inde i det kørende script.

Hvis en overvågning henviser til en hemmelighed, den ikke må bruge, efterlades henvisningen uændret og erstattes ikke af værdien.

Når du tester en overvågning, før du gemmer den, indsættes kun hemmeligheder med **Alle overvågninger**, fordi en ny overvågning ikke står på nogen liste og endnu ikke har etiketter. Når overvågningen er gemt, bruger test alle de hemmeligheder, overvågningen må bruge.
