# IP-monitor

IP-övervakning gör det möjligt att övervaka tillgängligheten och svarstiden för valfri IPv4- eller IPv6-adress. OneUptime testar periodiskt anslutningen till mål-IP-adressen och rapporterar dess status.

## Översikt

IP-monitorer verifierar att en specifik IP-adress är nåbar och svarar. Detta gör det möjligt att:

- Övervaka IPv4- och IPv6-adresstillgänglighet
- Spåra svarstider och latens
- Identifiera nätverksanslutningsproblem
- Verifiera att infrastrukturslutpunkter är nåbara

## Skapa en IP-monitor

1. Gå till **Övervakare** i OneUptime-instrumentpanelen
2. Klicka på **Skapa monitor**
3. Välj **IP** som monitortyp
4. Ange den IP-adress du vill övervaka
5. Konfigurera övervakningskriterier efter behov

## Konfigurationsalternativ

### IP-adress

Ange den IPv4- eller IPv6-adress du vill övervaka (t.ex. `192.168.1.1` eller `2001:db8::1`). Värdet måste vara i ett giltigt IP-adressformat.

## Övervakningskriterier

Du kan konfigurera kriterier för att avgöra när din IP-adress anses vara online, degraderad eller offline baserat på:

### Tillgängliga kontrolltyper

| Kontrolltyp            | Beskrivning                                                  |
| ---------------------- | ------------------------------------------------------------ |
| Är online              | Om IP-adressen är nåbar                                      |
| Svarstid (i ms)        | Svarstid i millisekunder                                     |
| Paketförlust (i %)     | Andel ICMP echo-förfrågningar utan svar                      |
| Jitter (i ms)          | Standardavvikelse för rundturstider över de skickade paketen |
| Är förfrågningstimeout | Om förfrågan fick timeout                                    |

### Filtertyper

För **Är online** och **Är förfrågningstimeout**:

- **Sant** – Villkoret är sant
- **Falskt** – Villkoret är falskt

För **Svarstid**, **Paketförlust** och **Jitter**:

- **Större än** – Svarstiden överstiger ett tröskelvärde
- **Mindre än** – Svarstiden understiger ett tröskelvärde
- **Större än eller lika med** – Svarstiden är vid eller över ett tröskelvärde
- **Mindre än eller lika med** – Svarstiden är vid eller under ett tröskelvärde

**Utvärdera detta kriterium över en tidsperiod** är en kryssruta i kriterieformuläret, inte ett filtervillkor. Slå på den för att jämföra en aggregering – vald under **Utvärdera** (Medel, Summa, Maximum, Minimum, Alla värden, Valfritt värde) över fönstret som anges i **För de senaste (i minuter)** – i stället för värdet från den senaste kontrollen.

### Exempelkriterier

#### Markera som offline om IP är onåbar

- **Kontrollera på**: Är online
- **Filtertyp**: Falskt

#### Varna om latens överstiger 100 ms

- **Kontrollera på**: Svarstid (i ms)
- **Filtertyp**: Större än
- **Värde**: 100
