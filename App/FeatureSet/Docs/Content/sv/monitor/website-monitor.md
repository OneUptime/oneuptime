# Webbplatsmonitor

Webbplatsövervakning gör det möjligt att övervaka tillgängligheten, prestandan och svaret från valfri webbplats eller webbsida. OneUptime skickar periodiska HTTP-förfrågningar till din webbplats-URL och kontrollerar om den svarar korrekt.

## Översikt

Webbplatsmonitorer kontrollerar dina webbsidor genom att göra HTTP-förfrågningar och utvärdera svaren. Detta gör det möjligt att:

- Övervaka webbplatsens drifttid och tillgänglighet
- Spåra svarstider och prestanda
- Verifiera HTTP-statuskoder
- Kontrollera svarshuvuden
- Identifiera driftstopp innan dina användare gör det

## Skapa en webbplatsmonitor

1. Gå till **Monitorer** i OneUptime-instrumentpanelen
2. Klicka på **Skapa monitor**
3. Välj **Webbplats** som monitortyp
4. Ange webbplatsens URL du vill övervaka
5. Konfigurera övervakningskriterier efter behov

## Konfigurationsalternativ

### Webbplats-URL

Ange den fullständiga URL:en till webbplatsen du vill övervaka, inklusive protokollet (t.ex. `https://example.com`).

### Dynamiska URL-platshållare

Vid övervakning av URL:er bakom CDN:er eller cacheproxyer kan monitorn få ett cachat svar istället för att träffa ursprungsservern. För att undvika detta vid varje kontroll kan du använda dynamiska URL-platshållare som ersätts med ett unikt värde vid varje övervakningsförfrågan.

#### Platshållare som stöds

| Platshållare | Beskrivning | Exempelvärde |
|-------------|-------------|--------------|
| `{{timestamp}}` | Ersätts med aktuell Unix-tidsstämpel (sekunder) | `1719500000` |
| `{{random}}` | Ersätts med en slumpmässig unik sträng | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### Exempel

Konfigurera din monitor-URL med en platshållare:

```
https://example.com/health?cb={{timestamp}}
```

Vid varje övervakningskontroll blir URL:en:

```
https://example.com/health?cb=1719500000
https://example.com/health?cb=1719500005
...
```

Du kan också använda `{{random}}` för en unik sträng vid varje förfrågan:

```
https://example.com/health?nocache={{random}}
```

### Avancerade alternativ

#### Följ inte omdirigeringar

Som standard följer OneUptime HTTP-omdirigeringar (301, 302 etc.). Aktivera det här alternativet om du vill övervaka omdirigeringssvaret i sig snarare än den slutliga destinationen.

## Övervakningskriterier

Du kan konfigurera kriterier för att avgöra när din webbplats anses vara online, degraderad eller offline baserat på:

- **Svarsstatuskod** – Kontrollera om HTTP-statuskoden matchar förväntade värden (t.ex. 200, 301)
- **Svarstid** – Övervaka om svarstiden överstiger ett tröskelvärde
- **Svarsinnehåll** – Kontrollera om svarsinnehållet innehåller eller matchar specifikt innehåll
- **Svarshuvuden** – Verifiera att specifika svarshuvuden finns eller matchar förväntade värden
