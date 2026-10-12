# Hotunderrättelser (STIX/TAXII)

Ett threat intel-flöde hämtar in kända skadliga IP-adresser, domäner, URL:er, e-postadresser och filhashar i OneUptime och talar om för dig när dina [säkerhetshändelser](/docs/telemetry/security-events) nämner någon av dem. Varje flöde prenumererar på en TAXII 2.1-samling med STIX 2.1-indikatorer: din egen MISP-, OpenCTI- eller OpenTAXII-server, eller en leverantörs samling. OneUptime levererar inget eget flödesinnehåll: du tar med samlingarna, precis som du tar med Sigma-reglerna.

:::cards
- [Prenumerera på ett flöde](#prenumerera-på-ett-flöde): En TAXII-server, en samling och hur inloggningen sker.
- [Vad som tas in](#vad-som-tas-in): Indikatormönstren som OneUptime behåller, och hur länge.
- [Så hittas träffar](#så-hittas-träffar): Märkta när händelser kommer in, och matchade varje minut.
- [Hotnivåer](#hotnivåer): Hur en indikators confidence blir en allvarlighetsgrad.
:::

## Så fungerar det

```mermaid title="Från en TAXII-samling till ett larm"
flowchart TB
    taxii["TAXII 2.1-samling"] -->|"Hämtas med flödets<br/>intervall"| indicators["Indikatorer: IP:er,<br/>domäner, URL:er,<br/>e-post, hashar"]
    events["Nya<br/>säkerhetshändelser"] --> tag["Märkta vid<br/>ankomst med<br/>threat.*-attribut"]
    indicators --> tag
    indicators --> match["Matchade varje<br/>minut mot nya<br/>händelser"]
    match --> act["Ett larm, en eventuell<br/>incident och ett fynd"]
```

## Innan du börjar

- En TAXII 2.1-server som publicerar STIX 2.1-objekt av typen `indicator`, och ID:t för samlingen som ska hämtas. Ett flöde loggar in anonymt, med en bearer-token eller med HTTP Basic-autentisering.
- Servrar som kräver ett TLS-klientcertifikat (mutual TLS), till exempel CISA AIS, stöds inte. MITRE:s offentliga ATT&CK-server publicerar tekniker och grupper i stället för indikatorer, så ett flöde som pekar på den förblir tomt.
- En roll som kan skapa flöden: Project Owner, Project Admin, Security Admin eller Security Member. Security Viewer kan läsa flöden och indikatorer. Se [Roller](/docs/permissions/reference#roller).

## Prenumerera på ett flöde

:::steps
### Gå till Threat Intel

Öppna **Produkter → Security Events → Threat Intel**.

### Skapa flödet

Klicka på **Skapa Threat Intel Feed** och fyll i dess fyra steg: **Grundläggande information**, **TAXII Server**, **Autentisering** och **Vid träff**. Fälten finns i tabellen nedan.

### Kontrollera den första hämtningen

Inom en minut eller två visar flödets rad **Last Polled**, och **Last Poll Summary** berättar vad hämtningen fick med sig. Indikatorerna visas i tabellen **Indicators** under flödena.
:::

| Fält | Vad du anger |
| --- | --- |
| **TAXII API Root URL** | Serverns TAXII 2.1-API-rot, till exempel `https://taxii.example.com/api1/`. Samlingarna adresseras under den. |
| **Collection ID** | Samlingen som publicerar indikatorerna. |
| **Poll Interval (Minutes)** | Hur ofta nya objekt hämtas: 1 till 1440 minuter, 60 som standard. |
| **Minimum Confidence** | Indikatorer med lägre STIX-`confidence` hoppas över: 0 till 100, och 0 behåller allt. Indikatorer utan confidence släpps alltid igenom. |
| **API Token** | En bearer-token, för en samling som kräver en. |
| **Basic Auth Username** och **Basic Auth Password** | För en samling som använder HTTP Basic-autentisering. Lämna båda och token tomma för en offentlig samling. |
| **Create Alert on Match** | På som standard: varje indikator som träffar öppnar ett larm. |
| **Varningsallvar** | Allvarlighetsgraden för varje larm som det här flödet öppnar. Lämna den tom för att använda varje indikators hotnivå. |
| **Create Incident on Match** | Av som standard. Incidenter driver joureskalering, SLA:er och statussidor, och larm räcker oftast för indikatorträffar. |
| **Incidentallvar** | Som **Varningsallvar**, för incidenter. |
| **Write Detection Finding on Match** | På som standard: varje träff skriver ett fynd i händelseflödet. |

Tokens och lösenord krypteras och visas aldrig igen efter att du har sparat dem. För att ändra dem väljer du **Update Credentials** i flödets rad och sedan **API Token (Bearer)**, **Basic Auth** eller **Anonymous (clear stored credentials)**: ditt val ersätter flödets inloggning, så att spara en token rensar ett sparat lösenord, och tvärtom.

### Så hämtas ett flöde

Varje hämtning ber om objekten som lagts till sedan den föregående, via TAXII-markören `added_after`, och läser upp till 10 sidor med 500 objekt. En stor samling synkroniseras därför över flera hämtningar: **Last Poll Summary** säger till när fler sidor återstår. För att bli klar med en stor första synkronisering snabbare sänker du **Poll Interval (Minutes)**, ända ner till 1, tills den har kommit ikapp.

Hämtningarna presenterar sig med användaragenten `OneUptime/<version> (+https://oneuptime.com)`. Om leverantörens brandvägg svarar `403`, be dem att tillåta den: många brandväggar blockerar begäranden som ser ut som ett namnlöst skript.

Ett inaktiverat flöde varken hämtas eller matchas. Indikatorerna som det redan har fortsätter att märka nya händelser tills de löper ut.

## Vad som tas in

OneUptime behåller STIX-objekt av typen `indicator` vars mönster är ren likhet på någon av de här typerna:

| Typ | Exempelmönster |
| --- | --- |
| IPv4-adress (`ipv4-addr`) | `[ipv4-addr:value = '198.51.100.7']` |
| IPv6-adress (`ipv6-addr`) | `[ipv6-addr:value = '2001:db8::7']` |
| Domännamn (`domain-name`) | `[domain-name:value = 'evil.example']` |
| URL (`url`) | `[url:value = 'http://evil.example/payload']` |
| E-postadress (`email-addr`) | `[email-addr:value = 'billing@evil.example']` |
| Filhash, SHA-256 (`file-hash-sha256`) | `[file:hashes.'SHA-256' = 'e3b0…b855']` |
| Filhash, SHA-1 (`file-hash-sha1`) | `[file:hashes.'SHA-1' = 'da39…0709']` |
| Filhash, MD5 (`file-hash-md5`) | `[file:hashes.MD5 = 'd41d…427e']` |

Jämförelser som är sammanfogade med `OR`, inom en `[...]` eller över flera, går bra, och varje värde blir en egen indikator:

```text
[domain-name:value = 'evil.example' OR domain-name:value = 'evil2.example']
[ipv4-addr:value = '198.51.100.7'] OR [url:value = 'http://evil.example/x']
```

Alla andra mönster, med `AND`, `FOLLOWEDBY`, `NOT`, `LIKE`, `MATCHES`, en tidsbestämning som `WITHIN` eller en annan objekttyp, hoppas över i sin helhet och räknas som ej stödda i **Last Poll Summary**. Att översätta bara en del av ett `AND`-mönster skulle träffa mycket mer än vad flödets författare avsåg.

### Hur länge en indikator är aktiv

- En indikator träffar från sin `valid_from` till sin `valid_until`. Utan `valid_until` är den aktiv i 365 dagar från `valid_from`, och en ny hämtning förlänger inte det.
- En återkallad indikator, eller en som uppdaterats med en `valid_until` i det förflutna, slutar träffa så snart uppdateringen har hämtats. Detsamma gäller ett värde som leverantören tar bort från ett uppdaterat mönster.
- Värden lagras med gemener och träffar oavsett versaler och gemener.

Tabellen **Indicators** listar indikatorerna som de är lagrade, med en **Status** som är **Aktiv**, **Utgången** eller **Revoked**. En indikator som hämtats på nytt kan visas två gånger en stund, och en utgången eller återkallad rad ligger kvar i listan tills lagringsrensningen tar bort den, upp till ungefär en månad efter att den löpt ut. Matchningen kontrollerar alltid giltighet och återkallelse, så en sådan rad träffar aldrig.

## Så hittas träffar

### Märkta när händelser kommer in

Varje inkommande säkerhetshändelse, från intags-API:et eller en anslutning, kontrolleras mot dina aktiva indikatorer innan den lagras. När en av dess observables (IP-adresserna, värdarna, domänerna, hasharna och användarna som hämtats från händelsen) är lika med en indikators värde, stämplas händelsen med de här attributen:

| Attribut | Värde |
| --- | --- |
| `threat.matched` | Alltid `"true"` på en märkt händelse |
| `threat.indicator_id` | STIX-indikatorns ID |
| `threat.indicator_type` | Indikatorns typ, till exempel `ipv4-addr` eller `file-hash-sha256` |
| `threat.indicator_value` | Värdet som träffade, med gemener |
| `threat.feed` / `threat.feed_id` | Flödet som indikatorn kom från |
| `threat.confidence` | Indikatorns STIX-confidence |
| `threat.match_count` | Hur många av händelsens observables som träffade en indikator |

När flera indikatorer träffar en händelse är det den med högst confidence som fyller i de här värdena. De är vanliga attribut, så du kan söka på dem under **Händelser**, filtrera monitorer för säkerhetshändelser med dem och använda dem i detektionsregler:

```yaml title="threat-intel-logon.yml"
title: High-confidence indicator in a successful logon
level: critical
detection:
  selection:
    threat.matched: 'true'
    threat.confidence|gte: 80
    className: Authentication
    statusName: Success
  condition: selection
```

Märkningen känner bara till indikatorerna som finns när en händelse kommer in: händelser märks aldrig om senare.

### Matchade varje minut

Varje minut matchas varje aktiverat flödes aktiva indikatorer mot händelserna vars händelsetid infaller efter flödets föregående kontroll. Det fångar underrättelser som kom in efter att en händelse märktes.

- Den första kontrollen täcker de senaste 15 minuterna. Efter ett avbrott tar nästa kontroll igen högst de senaste 24 timmarna.
- Varje fönster kontrolleras en gång. Underrättelser som kommer in efter att deras fönster har kontrollerats gäller bara senare händelser.
- En händelse som kommer sent, med en tid från före den föregående kontrollen, märks fortfarande när den kommer in, men matchas inte.
- Varje kontroll matchar högst 100 indikatorvärden per flöde: de som förekommer i flest händelser.

### Vad en träff gör

- Ett larm med titeln `[Threat Intel] <feed name> — <indicator value>`, ett per flöde och värde så länge det är öppet. När det har lösts öppnar nästa träff ett nytt. Larm löses inte automatiskt.
- En incident, bara med **Create Incident on Match**, deduplicerad på samma sätt.
- Ett Threat Intel-fynd, med **Write Detection Finding on Match**: en händelse `Detection Finding` (OCSF-klass 2004) från produkten `OneUptime Threat Intel`, med indikatorns hotnivå som allvarlighetsgrad och de här attributen:

| Attribut | Värde |
| --- | --- |
| `oneuptime.threat.feed_id` / `oneuptime.threat.feed_name` | Flödet |
| `oneuptime.threat.indicator_id` | STIX-indikatorns ID |
| `oneuptime.threat.indicator_type` / `oneuptime.threat.indicator_value` | Det som träffade |
| `oneuptime.threat.confidence` | Indikatorns confidence |
| `oneuptime.threat.match_count` | Hur många händelser som ligger bakom det här fyndet |

Fynd matchas aldrig själva, så en träff kan inte utlösa en annan.

## Hotnivåer

Indikatorer har ingen Sigma-nivå: deras STIX-`confidence` ger i stället en hotnivå.

| Indikatorns confidence | Hotnivå |
| --- | --- |
| 90 till 100 | Critical |
| 70 till 89 | High |
| 40 till 69 | Medium |
| 1 till 39 | Low |
| Utan poäng (0 eller saknas) | Medium |

En indikator utan poäng räknas som Medium: någon valde ändå att lägga den i ett flöde. Hotnivån är fyndets allvarlighetsgrad och väljer larmets allvarlighetsgrad bland projektets allvarlighetsgrader, i den här ordningen:

1. Flödets **Varningsallvar** (eller **Incidentallvar**), när den är angiven: den gäller varje träff från flödet.
2. Din allvarlighetsgrad som är uppkallad efter hotnivån, till exempel High, oavsett versaler och gemener.
3. Efter rang: Critical och High får din allvarligaste allvarlighetsgrad, Medium och Low din minst allvarliga.

Hotnivån hör till varje indikator, inte till flödet, så ett flöde kan öppna ett Critical-larm och ett Low-larm under samma minut. **Minimum Confidence** filtrerar på samma tal: ett minimum på 70 behåller bara High- och Critical-indikatorer, plus de utan poäng, som alltid släpps igenom.

## Håll koll på ett flödes träffar

Åtgärden **Skapa monitor** i ett flödes rad öppnar en ny monitor för säkerhetshändelser som räknar flödets fynd: händelseklassen `Detection Finding`, filtrerad på flödets ID i `oneuptime.threat.feed_id` (aldrig dess namn, som ett namnbyte skulle ändra), över den senaste timmen. Använd den för en plötslig våg av träffar, eller för ett flitigt flöde som tystnar.

## Lagring och fakturering

Indikatorer är konfiguration, inte telemetri, och faktureras inte som intagna data. Fynden som en träff skriver är vanliga säkerhetshändelser, som faktureras och lagras som resten: se [Säkerhetshändelser](/docs/telemetry/security-events#lagring-och-fakturering).

## Felsökning

:::details Last Error är satt efter en hämtning
`401` eller `403`: autentiseringsuppgifterna är fel eller saknas; ersätt dem med **Update Credentials**. En `403` kan också vara leverantörens brandvägg som blockerar användaragenten. `404`: kontrollera **TAXII API Root URL**, som oftast slutar med en sökväg som `/api1/`, och **Collection ID**. Felet försvinner vid nästa lyckade hämtning.
:::

:::details Flödet hämtas, men inga indikatorer visas
Läs **Last Poll Summary**. Inga objekt hämtade: samlingen är tom eller publicerar inga indikatorer. Mönster som inte stöds: leverantören använder mönsterfunktioner som den här sidan anger som överhoppade. Under minsta confidence: sänk **Minimum Confidence**. Redan inaktiva: leverantören skickade indikatorer som redan var återkallade eller utgångna.
:::

:::details Det finns indikatorer, men ingenting träffar
Matchningen jämför en indikators värde med en händelses observables, inte med varje fält: öppna en händelse som du väntade dig skulle träffa under **Händelser** och kontrollera att dess observables innehåller värdet. Bara indikatorer med statusen **Aktiv** träffar. Kontrollera **Last Match Error** på flödet.
:::

:::details En träff öppnade inget larm
**Create Alert on Match** är avstängt, eller ett larm för samma flöde och värde är fortfarande öppet, och senare träffar slås ihop med det. Ett projekt behöver minst en larmallvarlighetsgrad för att ett flöde ska kunna öppna larm.
:::

## Nästa steg

:::cards
- [Säkerhetshändelser](/docs/telemetry/security-events): Skicka händelser, sök i dem och skriv detektionsregler.
- [Google SecOps](/docs/integrations/google-secops): Hämta in Chronicles detektioner och händelser.
- [Behörighetsreferens](/docs/permissions/reference): Security-rollerna, och vad var och en kan göra.
:::
