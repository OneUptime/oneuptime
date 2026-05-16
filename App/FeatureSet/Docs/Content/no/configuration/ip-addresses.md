# IP-adresse-hviteliste for OneUptime.com

Hvis du bruker OneUptime.com og ønsker å hvitelistere IP-adressene våre av sikkerhetsgrunner, kan du gjøre det ved å følge instruksjonene nedenfor.

Hvitelistér følgende IP-adresser i brannmuren din for å tillate at oneuptime.com når ressursene dine.

{{IP_WHITELIST}}

Disse IP-adressene kan endres, og vi vil varsle deg i god tid hvis dette skjer.

## Hent IP-adresser programmatisk

Du kan også hente listen over utgående IP-adresser for prober programmatisk via følgende API-endepunkt:

```
GET https://oneuptime.com/ip-whitelist
```

Dette returnerer et JSON-svar:

```json
{
  "ipWhitelist": ["<list of IPs>"]
}
```

Du kan bruke dette endepunktet til å holde brannmurens hviteliste oppdatert automatisk.
