# Monitor Secrets

Du kan bruke hemmeligheter til å lagre sensitiv informasjon som du ønsker å bruke i overvåkingssjekkene dine. Hemmeligheter krypteres og lagres sikkert.

### Legge til en hemmelighet

For å legge til en hemmelighet, gå til OneUptime Dashboard -> Project Settings -> Monitor Secrets -> Create Monitor Secret.

![Opprett hemmelighet](/docs/static/images/CreateMonitorSecret.png)

Du kan velge hvilke monitorer som har tilgang til hemmeligheten. I dette tilfellet la vi til `ApiKey`-hemmeligheten og valgte monitorer som skal ha tilgang til den.

**Merk**: Hemmeligheter krypteres og lagres sikkert. Hvis du mister hemmeligheten, må du opprette en ny hemmelighet. Du kan ikke vise eller oppdatere hemmeligheten etter at den er lagret.

### Bruke en hemmelighet

Du kan bruke hemmeligheter i følgende overvåkingstyper:

- API (i forespørselshoder, forespørselskropp og URL)
- Nettsted, IP, Port, Ping, SSL-sertifikat (i URL)
- Syntetisk monitor, egendefinert kode-monitor (i koden)
- SNMP-monitor (i community-streng, SNMPv3-autentiseringsnøkkel og priv-nøkkel)


![Bruke hemmelighet](/docs/static/images/UsingMonitorSecret.png)

For å bruke en hemmelighet, legg til `{{monitorSecrets.SECRET_NAME}}` i feltet der du ønsker å bruke hemmeligheten. For eksempel la vi i dette tilfellet til `{{monitorSecrets.ApiKey}}` i feltet for forespørselshode.

Hemmeligheter injiseres på proben før Syntetiske eller Egendefinerte kode-monitor-skript kjøres, slik at referanser som `{{monitorSecrets.ApiKey}}` løses til den dekrypterte verdien inne i det kjørende skriptet.


### Tillatelser for Monitor Secrets

Du kan velge hvilke monitorer som har tilgang til hemmeligheten. Du kan også oppdatere tillatelsene når som helst. Så hvis du ønsker å gi en ny monitor tilgang til hemmeligheten, kan du gjøre det ved å oppdatere tillatelsene.
