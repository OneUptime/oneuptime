# Portmonitor

Portövervakning gör det möjligt att övervaka tillgängligheten för specifika TCP- eller UDP-portar på en värd. OneUptime försöker periodiskt ansluta till den angivna porten och kontrollerar om den är öppen och svarar.

## Översikt

Portmonitorer testar om en specifik nätverksport accepterar anslutningar. Detta gör det möjligt att:

- Övervaka tjänsttillgänglighet på specifika portar
- Spåra port-svarstider
- Verifiera att tjänster som databaser, e-postservrar och applikationsservrar körs
- Identifiera tjänstavbrott innan de påverkar användare

## Skapa en portmonitor

1. Gå till **Monitorer** i OneUptime-instrumentpanelen
2. Klicka på **Skapa monitor**
3. Välj **Port** som monitortyp
4. Ange värdnamnet eller IP-adressen och portnumret
5. Konfigurera övervakningskriterier efter behov

## Konfigurationsalternativ

### Värdnamn eller IP-adress

Ange värdnamnet eller IP-adressen för målvärden (t.ex. `example.com` eller `192.168.1.1`).

### Port

Ange portnumret att övervaka (1–65535). Vanliga exempel:

| Port | Tjänst |
|------|--------|
| 22 | SSH |
| 25 | SMTP |
| 80 | HTTP |
| 443 | HTTPS |
| 3306 | MySQL |
| 5432 | PostgreSQL |
| 6379 | Redis |
| 27017 | MongoDB |

## Övervakningskriterier

Du kan konfigurera kriterier för att avgöra när din port anses vara online, degraderad eller offline baserat på:

### Tillgängliga kontrolltyper

| Kontrolltyp | Beskrivning |
|------------|-------------|
| Är online | Om porten är öppen och accepterar anslutningar |
| Svarstid (i ms) | Tid att etablera en anslutning i millisekunder |
| Är förfrågningstimeout | Om anslutningsförsöket fick timeout |

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

#### Markera som offline om porten är stängd

- **Kontrollera på**: Är online
- **Filtertyp**: Falskt

#### Varna om anslutningstiden överstiger 500 ms

- **Kontrollera på**: Svarstid (i ms)
- **Filtertyp**: Större än
- **Värde**: 500

#### Markera som degraderad om anslutningen är långsam

- **Kontrollera på**: Svarstid (i ms)
- **Filtertyp**: Större än
- **Värde**: 200
