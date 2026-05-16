# Website Monitor

Website-monitoring stelt u in staat de beschikbaarheid, prestaties en response van elke website of webpagina te bewaken. OneUptime verstuurt periodiek HTTP-verzoeken naar de URL van uw website en controleert of deze correct reageert.

## Overzicht

Website-monitors controleren uw webpagina's door HTTP-verzoeken te doen en de responses te evalueren. Hiermee kunt u:

- Website-uptime en beschikbaarheid bewaken
- Responstijden en prestaties bijhouden
- HTTP-statuscodes verifiëren
- Responsheaders controleren
- Uitval detecteren voordat uw gebruikers dat doen

## Een Website Monitor aanmaken

1. Ga naar **Monitors** in het OneUptime-dashboard
2. Klik op **Monitor aanmaken**
3. Selecteer **Website** als het monitortype
4. Voer de website-URL in die u wilt bewaken
5. Configureer monitoringcriteria naar wens

## Configuratie-opties

### Website-URL

Voer de volledige URL in van de website die u wilt bewaken, inclusief het protocol (bijv. `https://example.com`).

### Dynamische URL-plaatshouders

Bij het bewaken van URL's achter CDN's of caching-proxy's ontvangt de monitor mogelijk een gecachte response in plaats van de originele server. Om de cache bij elke controle te doorbreken, kunt u dynamische URL-plaatshouders gebruiken die bij elk monitoringverzoek worden vervangen door een unieke waarde.

#### Ondersteunde plaatshouders

| Plaatshouder | Beschrijving | Voorbeeldwaarde |
|-------------|-------------|---------------|
| `{{timestamp}}` | Vervangen door de huidige Unix-tijdstempel (seconden) | `1719500000` |
| `{{random}}` | Vervangen door een willekeurige unieke tekenreeks | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### Voorbeeld

Configureer uw monitor-URL met een plaatshouder:

```
https://example.com/health?cb={{timestamp}}
```

Bij elke monitoringcontrole wordt de URL:

```
https://example.com/health?cb=1719500000
https://example.com/health?cb=1719500005
...
```

U kunt ook `{{random}}` gebruiken voor een unieke tekenreeks bij elk verzoek:

```
https://example.com/health?nocache={{random}}
```

### Geavanceerde opties

#### Omleidingen niet volgen

Standaard volgt OneUptime HTTP-omleidingen (301, 302, enz.). Schakel deze optie in als u de omleidingsresponse zelf wilt bewaken in plaats van de uiteindelijke bestemming.

## Monitoringcriteria

U kunt criteria configureren om te bepalen wanneer uw website als online, gedegradeerd of offline wordt beschouwd op basis van:

- **Responsstatuscode** - Controleer of de HTTP-statuscode overeenkomt met verwachte waarden (bijv. 200, 301)
- **Responstijd** - Bewaken of de responstijd een drempelwaarde overschrijdt
- **Responslichaam** - Controleer of het responslichaam specifieke inhoud bevat of overeenkomt
- **Responsheaders** - Verifieer of specifieke responsheaders aanwezig zijn of verwachte waarden hebben
