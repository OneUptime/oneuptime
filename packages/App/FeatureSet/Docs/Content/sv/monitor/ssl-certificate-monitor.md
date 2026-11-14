# Övervakning av SSL-certifikat

En SSL-certifikatmonitor kontrollerar de TLS-certifikat som dina webbplatser och tjänster visar upp, på samma sätt som en webbläsare, och varnar dig innan de går ut. Den tar också monitorn offline när ett certifikat inte längre är giltigt: utgånget, återkallat av sin utfärdare, självsignerat, utfärdat för ett annat värdnamn eller från en utfärdare som webbläsare inte litar på.

:::cards
- [Skapa monitorn](#skapa-en-ssl-certifikatmonitor): Sex steg i instrumentpanelen.
- [Standardkriterier](#standardkriterier): En varning om utgång 14 dagar i förväg, utan inställningar.
- [Övervakningskriterier](#övervakningskriterier): Giltighet, utgång, återkallelse och självsignerade certifikat.
- [Felsökning](#felsökning): Självsignerade och interna certifikat, samt kontroll av återkallelse.
:::

## Så fungerar det

Vid varje kontroll öppnar en sond en TLS-anslutning till värden och porten i URL:en, port `443` om inte URL:en anger en annan, och verifierar certifikatet som en webbläsare skulle göra: en betrodd utfärdare, ett värdnamn som stämmer och en giltighetsperiod som omfattar i dag. Om certifikatet inte klarar verifieringen läser sonden det ändå, så dess utgångsdatum, utfärdare och fingeravtryck registreras i vilket fall som helst. En anslutning som misslyckas, når tidsgränsen eller visar upp ett ogiltigt certifikat görs om, upp till det antal återförsök du tillåter. Sedan kör OneUptime resultatet genom monitorns kriterier.

Ett certifikat som klarar de kontrollerna kontrolleras också för återkallelse, som en webbläsare gör. Sonden läser OCSP-svaret som servern skickar med sitt certifikat, om det finns ett, frågar sedan utfärdarens OCSP-responder som certifikatet anger och läser, bara om den inte ger något svar, utfärdarens lista över återkallade certifikat (CRL). Den litar bara på ett aktuellt svar som är signerat av utfärdaren eller av en responder som utfärdaren har auktoriserat, och den kontrollerar serverns eget certifikat, inte mellanliggande certifikat. Ett återkallat certifikat är inte giltigt. När inget signerat svar går att få är återkallelsestatusen okänd, och precis som i en webbläsare behandlas certifikatet inte som återkallat.

Ett svar sparas till utfärdarens nästa uppdatering, i högst en timme, och en uppslagning som misslyckades görs om efter 5 minuter. Ett nytt certifikat kontrolleras alltså direkt, och ett certifikat som återkallas medan det används upptäcks inom en timme.

```mermaid title="Så bedömer standardkriterierna ett certifikat"
flowchart TB
    connect["TLS-handskakning,<br/>verifierad som i en webbläsare"] --> valid{"Giltigt certifikat?"}
    valid -->|"Nej, eller inget svar"| offline["Offline,<br/>incident deklarerad"]
    valid -->|"Ja"| soon{"Går ut om<br/>14 dagar eller mindre?"}
    soon -->|"Ja"| alert["Larm,<br/>status oförändrad"]
    soon -->|"Nej"| ok["Fungerar"]
```

En sond som har förlorat sin egen nätverksanslutning rapporterar inget resultat, så den kan inte markera ditt certifikat som ogiltigt.

## Innan du börjar

- **En roll som kan skapa monitorer**: Project Owner, Project Admin, Project Member, Monitor Admin eller Monitor Member, eller en anpassad roll med behörigheten Create Monitor.
- **En sond som når värden och porten.** Projektets standardsonder väljs för varje ny monitor. En tjänst i ett privat nätverk behöver en [anpassad sond](/docs/probe/custom-probe) i det nätverket.

## Skapa en SSL-certifikatmonitor

:::steps
### Börja en ny monitor

Gå till **Monitorer** och klicka på **Skapa monitor**. Välj **SSL-certifikat** under **Monitortyp**.

### Namnge den

Ange ett **Namn**, som `example.com certificate`, och klicka sedan på **Nästa**.

### Ange URL:en

Ange webbplatsen vars certifikat ska kontrolleras i **Webbplats-URL**, som `https://example.com`. För en tjänst på en annan port tar du med porten: `https://example.com:8443`.

### Testa den

Klicka på **Testa monitor**, välj en sond under **Välj sond** och klicka på **Kör test**. **Resultat av övervakningstest** visar certifikatet som sonden fick, med dess utfärdare och utgångsdatum.

### Gå igenom kriterierna

**Kriterier** börjar med [standardkriterierna](#standardkriterier): offline när certifikatet inte är giltigt, ett larm när det går ut om 14 dagar eller mindre. Ändra dem vid behov och klicka sedan på **Nästa**.

### Välj sonder och skapa

Behåll eller ändra **Sonder** och **Övervakningsintervall** (det börjar på **Var 5:e minut**; för SSL-certifikatmonitorer erbjuds 5 minuter eller längre) och klicka sedan på **Skapa monitor**. Monitorns sida öppnas.
:::

## Konfigurationsalternativ

| Fält | Standard | Vad du anger |
| --- | --- | --- |
| **Webbplats-URL** | Inget | Webbplatsen vars certifikat kontrolleras, som `https://example.com` eller `https://example.com:8443`. Bara värden och porten används; sökvägen ignoreras. |
| **Begärandetimeout (sekunder)** (under **Fler fält**) | `60` | Hur länge det väntas på TLS-handskakningen vid varje försök. Maximum är 60 sekunder. |
| **Återförsök vid misslyckande** (under **Fler fält**) | Sondens standard, oftast `3` | Hur många gånger ett misslyckat försök görs om. Maximum är 3. |

**Återförsök vid misslyckande** räknar återförsök _efter_ det första försöket, så `0` kör kontrollen en gång och `2` kör den upp till tre gånger. Lämnas fältet tomt används sondens standard: 3, om inte sondens `PROBE_MONITOR_RETRY_LIMIT` säger något annat. Anslutningsfel, misslyckade certifikatverifieringar och timeouter görs alla om, med en paus på en sekund mellan försöken.

## Övervakningskriterier

Kriterier avgör när certifikatet räknas som i ordning, försämrat eller trasigt, och om det deklarerar en incident eller skapar ett larm. Varje kriterium kontrollerar ett eller flera filter:

| Filter | Villkor | Vad det kontrollerar |
| --- | --- | --- |
| **Är giltigt certifikat** | **Sant**, **Falskt** | Certifikatet klarar en webbläsares kontroller: en betrodd utfärdare, ett värdnamn som stämmer, en giltighetsperiod som omfattar i dag och ingen återkallelse från utfärdaren. **Falskt** när slutpunkten inte svarade. |
| **Är inte ett giltigt certifikat** | **Sant**, **Falskt** | Motsatsen till **Är giltigt certifikat**: **Sant** när certifikatet inte klarar de kontrollerna eller inte kunde kontrolleras. |
| **Är utgånget certifikat** | **Sant**, **Falskt** | Certifikatets utgångsdatum har passerat. |
| **Är återkallat certifikat** | **Sant**, **Falskt** | Certifikatets utfärdare har återkallat det. **Falskt** när utfärdaren säger att det inte är återkallat, och när det inte gick att kontrollera. |
| **Är självsignerat certifikat** | **Sant**, **Falskt** | Certifikatet, eller ett i dess kedja, är självsignerat. |
| **Dagar till utgång** | **Större än**, **Mindre än**, **Större än eller lika med**, **Mindre än eller lika med** | Dagar tills certifikatet går ut. |
| **Timmar till utgång** | **Större än**, **Mindre än**, **Större än eller lika med**, **Mindre än eller lika med** | Timmar tills certifikatet går ut. |

**Dagar till utgång** räknar hela dagar: ett certifikat som går ut om 14 dagar och 20 timmar har 14 dagar kvar. **Timmar till utgång** räknar hela timmar på samma sätt.

Med två eller fler filter avgör **Matchningsvillkor** om **Alla** måste matcha eller om **Valfri** av dem räcker. Ett kriteriums **Åtgärder** avgör vad det gör: ändrar monitorns status, skapar ett larm, deklarerar en incident eller flera av dessa.

### Standardkriterier

En ny SSL-certifikatmonitor börjar med tre kriterier, så den varnar dig innan ett certifikat går ut utan några inställningar alls:

1. **Certifikatet är inte giltigt** — certifikatet har gått ut, har återkallats av sin utfärdare, är självsignerat, utfärdat för ett annat värdnamn eller av en utfärdare som inte är betrodd, eller kunde inte kontrolleras eftersom slutpunkten inte svarade. Monitorn markeras som **Offline** och en incident med namnet "_monitor name_ certificate is not valid" skapas. Dess grundorsak säger vilket av dessa fall det var, och för ett återkallat certifikat när och varför utfärdaren återkallade det. Incidenten löser sig själv när certifikatet är giltigt igen.
2. **Certifikatet går snart ut** — certifikatet är giltigt men går ut om 14 dagar eller mindre. Ett **larm** med namnet "_monitor name_ certificate expires soon" skapas.
3. **Certifikatet är giltigt** — monitorn markeras som **Fungerar**.

Varningen "går snart ut" är ett larm, inte en incident: det visas inte på dina statussidor, det kallar inte in någon om du inte lägger till en jourpolicy på det, och det ändrar inte monitorns status. Det använder projektets andra larmallvarlighetsgrad, **Låg** i ett nytt projekt. När det förnyade certifikatet plockas upp är monitorn tillbaka på "Certifikatet är giltigt", och larmet löser sig själv.

Kriterier kontrolleras uppifrån och ned, och det första som matchar avgör vad som händer. Därför ligger "går snart ut" ovanför "är giltigt": ett certifikat som håller på att gå ut är fortfarande giltigt, så det skulle matcha båda.

För att bli varnad tidigare ändrar du värdet för filtret **Dagar till utgång** i kriteriet "går snart ut", till exempel till `30`. För att i stället kalla in någon öppnar du kriteriets **Åtgärder**: slå på **När filter matchar, deklarera en incident.**, eller behåll larmet och lägg till en jourpolicy på det under **Jourpolicyer**.

:::details Lägg till varningen på en monitor som skapades innan den fanns
Monitorer som skapades innan OneUptime lade till den här varningen har inget kriterium "går snart ut". Så här lägger du till det:

1. Öppna **Konfiguration → Kriterier** på monitorn och klicka på **Redigera kriterier**.
2. Klicka på **Lägg till kriterier**. Sätt dess filter till **Är giltigt certifikat** / **Sant**, klicka på **Lägg till filter** och sätt det andra till **Dagar till utgång** / **Mindre än eller lika med** / `14`. Låt **Matchningsvillkor** stå på **Alla** (det visas under filtren så snart det finns två).
3. Slå på **När filter matchar, skapa ett larm.** under **Åtgärder** och låt **När filter matchar, ändra övervakarstatus.** vara avstängt, så att det skapar ett larm och inte ändrar monitorns status.
4. Dra det nya kriteriet ovanför kriteriet som markerar monitorn som online och spara sedan.
:::

### Exempelkriterier

| Mål | Filter | Villkor | Värde |
| --- | --- | --- | --- |
| Varna en månad i förväg | **Dagar till utgång** | **Mindre än eller lika med** | `30` |
| Kalla in någon den sista dagen | **Timmar till utgång** | **Mindre än** | `24` |
| Offline först när certifikatet har gått ut | **Är utgånget certifikat** | **Sant** | — |
| Flagga ett självsignerat certifikat | **Är självsignerat certifikat** | **Sant** | — |
| Kalla in säkerhetsteamet när utfärdaren återkallar certifikatet | **Är återkallat certifikat** | **Sant** | — |

Ett kriterium om utgång måste ligga ovanför kriteriet som markerar certifikatet som giltigt: ett certifikat som snart går ut är fortfarande giltigt, och det första kriteriet som matchar vinner. På samma sätt är ett återkallat certifikat inte heller giltigt, så ett kriterium med **Är återkallat certifikat** måste ligga ovanför kriteriet "inte giltigt".

## Bästa praxis

1. **Ge dig själv tid att förnya** — Standardvarningen kommer 14 dagar före utgång, vilket passar certifikat som förnyar sig själva. Om förnyelsen tar längre tid för dig (ett certifikat du köper, eller en ändringsprocess), höj den till 30 dagar.
2. **Övervaka varje slutpunkt** — Om du har flera domäner eller underdomäner skapar du en monitor för var och en. Var och en kan ha sitt eget certifikat.
3. **Ta med andra portar** — Tjänster som levererar TLS på en annan port än `443`, som `8443`, har också certifikat. Ange porten i URL:en.
4. **Kontrollera efter förnyelse** — När du har förnyat ett certifikat kontrollerar du monitorns nästa resultat: utgångsdatumet den visar ska vara det nya.

## Felsökning

:::details Certifikatet är i ordning i min webbläsare, men monitorn säger att det inte är giltigt
Incidentens grundorsak säger varför. En vanlig orsak är en server som skickar sitt certifikat utan mellanliggande certifikat: webbläsare fyller ofta i luckan själva, sonden gör det inte. Konfigurera servern att skicka hela kedjan. En annan är en URL vars värdnamn inte finns på certifikatet.
:::

:::details Jag övervakar en intern tjänst med ett självsignerat certifikat
Ett självsignerat certifikat är aldrig giltigt, så standardkriterierna håller monitorn offline. **Är självsignerat certifikat**, **Är utgånget certifikat** och **Dagar till utgång** fungerar fortfarande för det, så bygg kriterierna på dem. På **Konfiguration → Kriterier**:

1. Klicka på **Lägg till filter** i kriteriet "inte giltigt", sätt det nya filtret till **Är självsignerat certifikat** / **Falskt** och sätt **Matchningsvillkor** till **Alla**. Kriteriet tar fortfarande monitorn offline när slutpunkten inte svarar, eller när certifikatet är fel på något annat sätt.
2. Lägg till ett kriterium med **Är utgånget certifikat** / **Sant** som markerar monitorn som **Offline** och deklarerar en incident, och dra det högst upp.
3. Ersätt **Är giltigt certifikat** / **Sant** med **Är utgånget certifikat** / **Falskt** i kriteriet "går snart ut", så att varningen även täcker det självsignerade certifikatet.

Så länge certifikatet är aktuellt matchar inget kriterium, och monitorn visar sin standardstatus, **Fungerar**.
:::

:::details Monitorn är offline med "could not be checked because the endpoint is not reachable"
Sonden kunde inte öppna en TLS-anslutning till värden och porten. Kontrollera porten i URL:en, och att en brandvägg släpper igenom sonderna. En värd i ett privat nätverk behöver en [anpassad sond](/docs/probe/custom-probe).
:::

:::details Certifikatets återkallelsestatus kunde inte kontrolleras
När sonden inte kan få ett signerat svar från certifikatets utfärdare visar monitorns sammanfattning **Återkallelsestatus** som **Kunde inte kontrolleras**, och **Problem med återkallelsekontrollen** under **Visa fler detaljer** säger varför: certifikatet anger ingen OCSP-responder eller CRL, utfärdaren svarade inte i tid, eller dess svar kunde inte verifieras. Precis som i en webbläsare behandlas ett sådant certifikat inte som återkallat, och sonden frågar igen efter 5 minuter.

En [anpassad sond](/docs/probe/custom-probe) utan internetåtkomst kan inte nå någon utfärdare. Den kontrollerar ändå certifikat: den väntar några sekunder på varje responder den inte når, ungefär en gång var 5:e minut. Sätt `PROBE_CERTIFICATE_REVOCATION_CHECK_ENABLED` till `false` på sonden och starta om den för att få den att sluta fråga.
:::

## Nästa steg

:::cards
- [Webbplatsövervakning](/docs/monitor/website-monitor): Kontrollera att själva webbplatsen svarar.
- [Domänövervakning](/docs/monitor/domain-monitor): Bli varnad innan domänens registrering går ut.
- [Eskaleringsregler](/docs/on-call/escalation-rules): Bestäm vem som kallas in av larmen och incidenterna.
- [Incidenter – Översikt](/docs/incidents/index): Vad som händer när monitorn har deklarerat en.
:::
