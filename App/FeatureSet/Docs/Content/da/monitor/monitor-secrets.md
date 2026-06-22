# Monitor Secrets

Du kan bruge hemmeligheder til at gemme følsomme oplysninger, som du vil bruge i dine overvågningsskjek. Hemmeligheder er krypteret og opbevares sikkert.

### Tilføjelse af en hemmelighed

For at tilføje en hemmelighed skal du gå til OneUptime Dashboard -> Projektindstillinger -> Monitor Secrets -> Opret Monitor Secret.

![Opret hemmelighed](/docs/static/images/CreateMonitorSecret.png)

Du kan vælge, hvilke monitorer der har adgang til hemmeligheden. I dette tilfælde har vi tilføjet `ApiKey`-hemmelighed og valgt monitorer til at have adgang til den.

**Bemærk venligst**: Hemmeligheder er krypteret og opbevares sikkert. Hvis du mister hemmeligheden, skal du oprette en ny hemmelighed. Du kan ikke se eller opdatere hemmeligheden, efter den er gemt.

### Brug af en hemmelighed

Du kan bruge hemmeligheder i følgende monitortyper:

- API (i anmodningsheadere, anmodningsindhold og URL)
- Website, IP, Port, Ping, SSL Certificate (i URL)
- Synthetic Monitor, Custom Code Monitor (i koden)
- SNMP Monitor (i community-streng, SNMPv3-autentificeringsnøgle og priv-nøgle)

![Brug hemmelighed](/docs/static/images/UsingMonitorSecret.png)

For at bruge en hemmelighed skal du tilføje `{{monitorSecrets.SECRET_NAME}}` i det felt, hvor du vil bruge hemmeligheden. For eksempel har vi i dette tilfælde tilføjet `{{monitorSecrets.ApiKey}}` i feltet Anmodningsheader.

Hemmeligheder injiceres på proben, inden Synthetic eller Custom Code-monitorscripts eksekveres, så referencer som `{{monitorSecrets.ApiKey}}` løses til den dekrypterede værdi inde i det kørende script.

### Monitor Secret-tilladelser

Du kan vælge, hvilke monitorer der har adgang til hemmeligheden. Du kan også opdatere tilladelserne til enhver tid. Så hvis du vil tilføje en ny monitor til at have adgang til hemmeligheden, kan du gøre det ved at opdatere tilladelserne.
