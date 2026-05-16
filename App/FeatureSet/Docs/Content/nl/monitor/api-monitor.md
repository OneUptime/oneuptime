# API Monitor

API-monitoring stelt u in staat de beschikbaarheid, prestaties en correctheid van uw HTTP/REST API's te bewaken. OneUptime verstuurt periodiek HTTP-verzoeken naar uw API-eindpunten en evalueert de responses op basis van uw geconfigureerde criteria.

## Overzicht

API-monitors versturen HTTP-verzoeken naar uw eindpunten en controleren de responses. Hiermee kunt u:

- API-uptime en beschikbaarheid bewaken
- Responstijden en prestaties bijhouden
- HTTP-statuscodes en responslichamen verifiëren
- Responsheaders valideren
- Verschillende HTTP-methoden testen (GET, POST, PUT, DELETE, enz.)
- Aangepaste verzoekheaders en -lichamen versturen

## Een API Monitor aanmaken

1. Ga naar **Monitors** in het OneUptime-dashboard
2. Klik op **Monitor aanmaken**
3. Selecteer **API** als het monitortype
4. Voer de API-URL in en configureer de verzoeksinstellingen
5. Configureer monitoringcriteria naar wens

## Configuratie-opties

### API-URL

Voer de volledige URL in van het API-eindpunt dat u wilt bewaken (bijv. `https://api.example.com/v1/health`).

### Dynamische URL-plaatshouders

Bij het bewaken van API's achter CDN's of caching-proxy's ontvangt de monitor mogelijk een gecachte response in plaats van de originele server. Om de cache bij elke controle te doorbreken, kunt u dynamische URL-plaatshouders gebruiken die bij elk monitoringverzoek worden vervangen door een unieke waarde.

#### Ondersteunde plaatshouders

| Plaatshouder | Beschrijving | Voorbeeldwaarde |
|-------------|-------------|---------------|
| `{{timestamp}}` | Vervangen door de huidige Unix-tijdstempel (seconden) | `1719500000` |
| `{{random}}` | Vervangen door een willekeurige unieke tekenreeks | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### Voorbeeld

Configureer uw monitor-URL met een plaatshouder:

```
https://api.example.com/health?cb={{timestamp}}
```

Bij elke monitoringcontrole wordt de URL:

```
https://api.example.com/health?cb=1719500000
https://api.example.com/health?cb=1719500005
...
```

U kunt ook `{{random}}` gebruiken voor een unieke tekenreeks bij elk verzoek:

```
https://api.example.com/health?nocache={{random}}
```

### API-verzoektype

Selecteer de HTTP-methode voor het verzoek:

- **GET** (standaard)
- **POST**
- **PUT**
- **DELETE**
- **PATCH**
- **HEAD**

### Geavanceerde opties

#### Verzoekheaders

Voeg aangepaste HTTP-headers toe aan het verzoek. Dit is nuttig voor authenticatietokens, inhoudstype-specificaties en andere API-specifieke headers.

U kunt [Monitor Secrets](/docs/monitor/monitor-secrets) gebruiken in headerwaarden om gevoelige gegevens zoals API-sleutels veilig op te slaan.

#### Verzoeklichaam (JSON)

Voor POST-, PUT- en PATCH-verzoeken kunt u een JSON-verzoeklichaam opgeven. U kunt ook [Monitor Secrets](/docs/monitor/monitor-secrets) gebruiken in het verzoeklichaam.

#### Omleidingen niet volgen

Standaard volgt OneUptime HTTP-omleidingen (301, 302, enz.). Schakel deze optie in als u de omleidingsresponse zelf wilt bewaken in plaats van de uiteindelijke bestemming.

## Monitoringcriteria

U kunt criteria configureren om te bepalen wanneer uw API als online, gedegradeerd of offline wordt beschouwd op basis van:

- **Responsstatuscode** - Controleer of de HTTP-statuscode overeenkomt met verwachte waarden (bijv. 200, 201)
- **Responstijd** - Bewaken of de responstijd een drempelwaarde overschrijdt
- **Responslichaam** - Controleer of het responslichaam specifieke inhoud bevat of overeenkomt
- **Responsheaders** - Verifieer of specifieke responsheaders aanwezig zijn of verwachte waarden hebben
- **JavaScript-expressie** - Schrijf aangepaste expressies om de response te evalueren. Zie [JavaScript-expressies](/docs/monitor/javascript-expression) voor details.
