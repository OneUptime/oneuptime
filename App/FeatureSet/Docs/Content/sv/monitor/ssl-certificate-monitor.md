# SSL-certifikatmonitor

SSL-certifikatövervakning gör det möjligt att övervaka giltigheten och utgångsdatumet för SSL/TLS-certifikat på dina webbplatser och tjänster. OneUptime kontrollerar periodiskt dina certifikat och varnar dig innan de löper ut eller om problem upptäcks.

## Översikt

SSL-certifikatmonitorer ansluter till dina HTTPS-slutpunkter och inspekterar SSL/TLS-certifikatet. Detta gör det möjligt att:

- Övervaka certifikatets utgångsdatum
- Identifiera utgångna eller snart utgående certifikat
- Identifiera självsignerade certifikat
- Verifiera certifikatets giltighet
- Förhindra tjänstavbrott orsakade av utgångna certifikat

## Skapa en SSL-certifikatmonitor

1. Gå till **Monitorer** i OneUptime-instrumentpanelen
2. Klicka på **Skapa monitor**
3. Välj **SSL-certifikat** som monitortyp
4. Ange URL:en till HTTPS-slutpunkten att kontrollera
5. Konfigurera övervakningskriterier efter behov

## Konfigurationsalternativ

### URL

Ange den fullständiga HTTPS-URL:en till slutpunkten vars SSL-certifikat du vill övervaka (t.ex. `https://example.com` eller `https://example.com:8443`).

## Övervakningskriterier

Du kan konfigurera kriterier för att avgöra när din certifikatstatus anses vara online, degraderad eller offline baserat på:

### Tillgängliga kontrolltyper

| Kontrolltyp | Beskrivning |
|------------|-------------|
| Är online | Om servern är nåbar |
| Är giltigt certifikat | Om certifikatet är giltigt (inte utgånget, inte självsignerat) |
| Är självsignerat certifikat | Om certifikatet är självsignerat |
| Är utgånget certifikat | Om certifikatet har löpt ut |
| Är inte ett giltigt certifikat | Om certifikatet är ogiltigt |
| Löper ut om timmar | Antal timmar tills certifikatet löper ut |
| Löper ut om dagar | Antal dagar tills certifikatet löper ut |
| Är förfrågningstimeout | Om anslutningen fick timeout |

### Filtertyper

För **Är online**, **Är giltigt certifikat**, **Är självsignerat certifikat**, **Är utgånget certifikat**, **Är inte ett giltigt certifikat** och **Är förfrågningstimeout**:

- **Sant** – Villkoret är sant
- **Falskt** – Villkoret är falskt

För **Löper ut om timmar** och **Löper ut om dagar**:

- **Större än** – Utgångstiden är mer än det angivna värdet bort
- **Mindre än** – Utgångstiden är mindre än det angivna värdet bort
- **Större än eller lika med** – Utgångstiden är vid eller mer än det angivna värdet bort
- **Mindre än eller lika med** – Utgångstiden är vid eller mindre än det angivna värdet bort
- **Lika med** – Utgångstiden matchar exakt
- **Inte lika med** – Utgångstiden matchar inte

### Exempelkriterier

#### Markera som degraderad om certifikatet löper ut inom 30 dagar

- **Kontrollera på**: Löper ut om dagar
- **Filtertyp**: Mindre än
- **Värde**: 30

#### Markera som offline om certifikatet är utgånget

- **Kontrollera på**: Är utgånget certifikat
- **Filtertyp**: Sant

#### Varna om certifikatet är självsignerat

- **Kontrollera på**: Är självsignerat certifikat
- **Filtertyp**: Sant

#### Markera som offline om certifikatet är ogiltigt

- **Kontrollera på**: Är inte ett giltigt certifikat
- **Filtertyp**: Sant

## Bästa praxis

1. **Ange flera trösklar** – Använd degraderad status vid 30 dagar och offline vid 7 dagar före utgång för att ge dig tid att förnya
2. **Övervaka alla slutpunkter** – Om du har flera domäner eller underdomäner, skapa en monitor för var och en
3. **Inkludera icke-standardportar** – Glöm inte tjänster som kör HTTPS på icke-standardportar
4. **Övervaka efter förnyelse** – Efter att ha förnyat ett certifikat, verifiera att monitorn bekräftar att det är giltigt
