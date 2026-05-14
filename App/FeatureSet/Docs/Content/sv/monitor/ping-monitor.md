# Ping-monitor

Ping-övervakning gör det möjligt att övervaka tillgängligheten och svarstiden för vilken värd eller IP-adress som helst. OneUptime skickar periodiska ping-förfrågningar till ditt mål och kontrollerar om det svarar korrekt.

## Översikt

Ping-monitorer testar grundläggande nätverksanslutning genom att skicka ICMP-ping-förfrågningar till en värd. Detta gör det möjligt att:

- Övervaka värd-drifttid och tillgänglighet
- Spåra nätverkslatens och svarstider
- Identifiera anslutningsproblem innan de påverkar dina tjänster
- Verifiera att servrar och nätverksenheter är nåbara

## Skapa en ping-monitor

1. Gå till **Monitorer** i OneUptime-instrumentpanelen
2. Klicka på **Skapa monitor**
3. Välj **Ping** som monitortyp
4. Ange värdnamnet eller IP-adressen du vill övervaka
5. Konfigurera övervakningskriterier efter behov

## Konfigurationsalternativ

### Ping-värdnamn eller IP-adress

Ange värdnamnet eller IP-adressen för målet du vill övervaka (t.ex. `example.com` eller `192.168.1.1`). Både värdnamn och IP-adresser accepteras.

## Övervakningskriterier

Du kan konfigurera kriterier för att avgöra när din värd anses vara online, degraderad eller offline baserat på:

### Tillgängliga kontrolltyper

| Kontrolltyp | Beskrivning |
|------------|-------------|
| Är online | Om värden svarar på ping-förfrågningar |
| Svarstid (i ms) | Tur-och-returtiden för ping-förfrågan i millisekunder |
| Är förfrågningstimeout | Om ping-förfrågan fick timeout |

### Filtertyper

För **Är online** och **Är förfrågningstimeout**:

- **Sant** – Villkoret är sant
- **Falskt** – Villkoret är falskt

För **Svarstid**:

- **Större än** – Svarstiden överstiger ett tröskelvärde
- **Mindre än** – Svarstiden understiger ett tröskelvärde
- **Större än eller lika med** – Svarstiden är vid eller över ett tröskelvärde
- **Mindre än eller lika med** – Svarstiden är vid eller under ett tröskelvärde
- **Lika med** – Svarstiden matchar exakt
- **Inte lika med** – Svarstiden matchar inte
- **Utvärdera över tid** – Utvärdera med aggregering (Medel, Summa, Maximum, Minimum, Alla värden, Valfritt värde) under ett tidsfönster

### Exempelkriterier

#### Markera som offline om värden är onåbar

- **Kontrollera på**: Är online
- **Filtertyp**: Falskt

#### Varna om svarstiden överstiger 200 ms

- **Kontrollera på**: Svarstid (i ms)
- **Filtertyp**: Större än
- **Värde**: 200
