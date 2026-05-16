# API-monitor

API-övervakning gör det möjligt att övervaka tillgängligheten, prestandan och korrektheten hos dina HTTP/REST API:er. OneUptime skickar periodiska HTTP-förfrågningar till dina API-slutpunkter och utvärderar svaren baserat på dina konfigurerade kriterier.

## Översikt

API-monitorer gör HTTP-förfrågningar till dina slutpunkter och kontrollerar svaren. Detta gör det möjligt att:

- Övervaka API-drifttid och tillgänglighet
- Spåra svarstider och prestanda
- Verifiera HTTP-statuskoder och svarsinnehåll
- Validera svarshuvuden
- Testa olika HTTP-metoder (GET, POST, PUT, DELETE etc.)
- Skicka anpassade förfrågningshuvuden och innehåll

## Skapa en API-monitor

1. Gå till **Monitorer** i OneUptime-instrumentpanelen
2. Klicka på **Skapa monitor**
3. Välj **API** som monitortyp
4. Ange API-URL:en och konfigurera förfrågningsinställningarna
5. Konfigurera övervakningskriterier efter behov

## Konfigurationsalternativ

### API-URL

Ange den fullständiga URL:en till den API-slutpunkt du vill övervaka (t.ex. `https://api.example.com/v1/health`).

### Dynamiska URL-platshållare

Vid övervakning av API:er bakom CDN:er eller cacheproxyer kan monitorn få ett cachat svar istället för att träffa ursprungsservern. För att undvika detta vid varje kontroll kan du använda dynamiska URL-platshållare som ersätts med ett unikt värde vid varje övervakningsförfrågan.

#### Platshållare som stöds

| Platshållare | Beskrivning | Exempelvärde |
|-------------|-------------|--------------|
| `{{timestamp}}` | Ersätts med aktuell Unix-tidsstämpel (sekunder) | `1719500000` |
| `{{random}}` | Ersätts med en slumpmässig unik sträng | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### Exempel

Konfigurera din monitor-URL med en platshållare:

```
https://api.example.com/health?cb={{timestamp}}
```

Vid varje övervakningskontroll blir URL:en:

```
https://api.example.com/health?cb=1719500000
https://api.example.com/health?cb=1719500005
...
```

Du kan också använda `{{random}}` för en unik sträng vid varje förfrågan:

```
https://api.example.com/health?nocache={{random}}
```

### API-förfrågningstyp

Välj HTTP-metod för förfrågan:

- **GET** (standard)
- **POST**
- **PUT**
- **DELETE**
- **PATCH**
- **HEAD**

### Avancerade alternativ

#### Förfrågningshuvuden

Lägg till anpassade HTTP-huvuden i förfrågan. Detta är användbart för autentiseringstokens, specificering av innehållstyp och andra API-specifika huvuden.

Du kan använda [Monitorhemligheter](/docs/monitor/monitor-secrets) i huvudvärden för att säkert lagra känsliga data som API-nycklar.

#### Förfrågningsinnehåll (JSON)

För POST-, PUT- och PATCH-förfrågningar kan du ange ett JSON-förfrågningsinnehåll. Du kan också använda [Monitorhemligheter](/docs/monitor/monitor-secrets) i förfrågningsinnehållet.

#### Följ inte omdirigeringar

Som standard följer OneUptime HTTP-omdirigeringar (301, 302 etc.). Aktivera det här alternativet om du vill övervaka omdirigeringssvaret i sig snarare än den slutliga destinationen.

## Övervakningskriterier

Du kan konfigurera kriterier för att avgöra när ditt API anses vara online, degraderat eller offline baserat på:

- **Svarsstatuskod** – Kontrollera om HTTP-statuskoden matchar förväntade värden (t.ex. 200, 201)
- **Svarstid** – Övervaka om svarstiden överstiger ett tröskelvärde
- **Svarsinnehåll** – Kontrollera om svarsinnehållet innehåller eller matchar specifikt innehåll
- **Svarshuvuden** – Verifiera att specifika svarshuvuden finns eller matchar förväntade värden
- **JavaScript-uttryck** – Skriv anpassade uttryck för att utvärdera svaret. Se [JavaScript-uttryck](/docs/monitor/javascript-expression) för detaljer.
