# Monitor Secrets

Du kan bruke hemmeligheter til å lagre sensitiv informasjon som du ønsker å bruke i overvåkingssjekkene dine. Hemmeligheter krypteres og lagres sikkert.

### Legge til en hemmelighet

For å legge til en hemmelighet, gå til OneUptime Dashboard -> Overvåkere -> Innstillinger -> Hemmeligheter -> Create Monitor Secret.

![Opprett hemmelighet](/docs/static/images/CreateMonitorSecret.png)

Gi hemmeligheten et navn og en verdi, og velg deretter i trinnet **Tilgang** hvilke overvåkere som kan bruke den. I dette eksemplet har vi lagt til en `ApiKey`-hemmelighet.

**Merk**: Hemmeligheter krypteres og lagres sikkert. Verdien vises aldri igjen etter at den er lagret — verken i tabellen, i redigeringsskjemaet eller via API-et. Mister du verdien, må du hente den fra kilden og sette den på nytt. Bruk knappen **Oppdater hemmelig verdi** på raden for å rotere en hemmelighet; du trenger ikke slette og opprette den på nytt.

### Velg hvilke overvåkere som kan bruke en hemmelighet

Hver hemmelighet har ett av tre tilgangsvalg:

- **Alle overvåkere**: alle overvåkere i prosjektet kan bruke hemmeligheten, også overvåkere du oppretter senere. Bruk dette for påloggingsinformasjon som mange overvåkere deler.
- **Bestemte overvåkere**: bare overvåkerne du velger, kan bruke hemmeligheten. Dette er standardvalget, og hemmeligheter som ble opprettet før disse valgene fantes, fungerer slik.
- **Overvåkere med etiketter**: overvåkere som har minst én av etikettene du velger, kan bruke hemmeligheten. Legger du til en av etikettene på en overvåker, får den tilgang, og fjerner du etiketten, mister den tilgangen neste gang overvåkeren kjører.

Du kan endre valget når som helst med **Rediger** på hemmelighetens rad. Bare listen for det valgte alternativet beholdes: bytter du til **Alle overvåkere**, tømmes hemmelighetens overvåker- og etikettliste, og bytter du mellom **Bestemte overvåkere** og **Overvåkere med etiketter**, tømmes listen du bytter bort fra.

En hemmelighet er aldri tilgjengelig for overvåkere i et annet prosjekt.

Alle som kan redigere en overvåker med tilgang til en hemmelighet, kan sende hemmeligheten til et hvilket som helst mål overvåkeren kobler til. Med **Alle overvåkere** er det alle som kan opprette eller redigere overvåkere i prosjektet. Med **Overvåkere med etiketter** gjelder det også alle som kan legge til en av etikettene på en overvåker.

I API-et er tilgangsvalget feltet `monitorAccess`: `All Monitors`, `Specific Monitors` eller `Monitors With Labels`. Feltene `monitors` og `labels` inneholder listene. En hemmelighet som opprettes uten `monitorAccess`, får `Specific Monitors`.

### Bruke en hemmelighet

Du kan bruke hemmeligheter i følgende overvåkingstyper:

- API (i forespørselshoder, forespørselskropp og URL)
- Nettsted, IP, Port, Ping, SSL-sertifikat (i URL)
- Syntetisk monitor, egendefinert kode-monitor (i koden)
- SNMP-monitor (i community-streng, SNMPv3-autentiseringsnøkkel og priv-nøkkel)

![Bruke hemmelighet](/docs/static/images/UsingMonitorSecret.png)

For å bruke en hemmelighet, legg til `{{monitorSecrets.SECRET_NAME}}` i feltet der du ønsker å bruke hemmeligheten. For eksempel la vi i dette tilfellet til `{{monitorSecrets.ApiKey}}` i feltet for forespørselshode.

Hemmeligheter injiseres på proben før Syntetiske eller Egendefinerte kode-monitor-skript kjøres, slik at referanser som `{{monitorSecrets.ApiKey}}` løses til den dekrypterte verdien inne i det kjørende skriptet.

Hvis en overvåker refererer til en hemmelighet den ikke kan bruke, blir referansen stående som den er og erstattes ikke med verdien.

Når du tester en overvåker før du lagrer den, fylles bare hemmeligheter med **Alle overvåkere** inn, fordi en ny overvåker ikke står på noen liste og ikke har etiketter ennå. Etter at overvåkeren er lagret, bruker tester alle hemmelighetene overvåkeren kan bruke.
