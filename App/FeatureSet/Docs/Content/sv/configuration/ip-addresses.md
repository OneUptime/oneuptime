# Vitlista för IP-adresser för OneUptime.com

Om du använder OneUptime.com och vill vitlista våra IP-adresser av säkerhetsskäl kan du göra det genom att följa instruktionerna nedan.

Vänligen vitlista följande IP-adresser i din brandvägg för att tillåta oneuptime.com att nå dina resurser.

{{IP_WHITELIST}}

Dessa IP-adresser kan ändras; vi meddelar dig i förväg om detta sker.

## Hämta IP-adresser programmatiskt

Du kan också hämta listan över utgångs-IP-adresser för sonder programmatiskt via följande API-slutpunkt:

```
GET https://oneuptime.com/ip-whitelist
```

Detta returnerar ett JSON-svar:

```json
{
  "ipWhitelist": ["<list of IPs>"]
}
```

Du kan använda denna slutpunkt för att hålla din brandväggsv vitlista uppdaterad automatiskt.
