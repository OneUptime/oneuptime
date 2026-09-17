# IP-adreslijst voor OneUptime.com

Als u OneUptime.com gebruikt en onze IP-adressen om beveiligingsredenen op een acceptatielijst wilt plaatsen, kunt u de onderstaande instructies volgen.

Voeg de volgende IP-adressen toe aan uw firewall om oneuptime.com toegang te geven tot uw resources.

{{IP_WHITELIST}}

Deze IP-adressen kunnen veranderen; wij informeren u van tevoren als dit het geval is.

## IP-adressen programmatisch ophalen

U kunt de lijst met egress-IP-adressen van de probe ook programmatisch ophalen via het volgende API-eindpunt:

```
GET https://oneuptime.com/ip-whitelist
```

Dit retourneert een JSON-response:

```json
{
  "ipWhitelist": ["<list of IPs>"]
}
```

U kunt dit eindpunt gebruiken om uw firewall-acceptatielijst automatisch bijgewerkt te houden.
