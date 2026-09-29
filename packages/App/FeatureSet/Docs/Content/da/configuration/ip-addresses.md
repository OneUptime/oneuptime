# IP-adresse-hvidliste for OneUptime.com

Hvis du bruger OneUptime.com og ønsker at hvidliste vores IP-adresser af sikkerhedsmæssige årsager, kan du gøre det ved at følge instruktionerne nedenfor.

Hvidlist følgende IP-adresser i din firewall for at give oneuptime.com adgang til dine ressourcer.

{{IP_WHITELIST}}

Disse IP-adresser kan ændre sig; vi giver dig besked i god tid, hvis det sker.

## Hent IP-adresser programmatisk

Du kan også hente listen over probe-udgående IP-adresser programmatisk via følgende API-endpoint:

```
GET https://oneuptime.com/ip-whitelist
```

Dette returnerer et JSON-svar:

```json
{
  "ipWhitelist": ["<list of IPs>"]
}
```

Du kan bruge dette endpoint til automatisk at holde din firewall-hvidliste opdateret.
