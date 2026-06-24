# Monitor för inkommande e-post

Monitor för inkommande e-post gör det möjligt att skapa och lösa varningar baserat på e-postmeddelanden som skickas till unika monitorspecifika e-postadresser. Detta är användbart för integration med äldre system, tredjepartsvarningsverktyg eller vilken tjänst som helst som kan skicka e-postmeddelanden.

## Hur det fungerar

1. När du skapar en monitor för inkommande e-post genererar OneUptime en unik e-postadress för den monitorn
2. Alla e-postmeddelanden som skickas till den adressen tas emot och utvärderas mot dina konfigurerade kriterier
3. Baserat på kriterierna kan OneUptime skapa nya varningar eller lösa befintliga

Detta är ett kraftfullt sätt att integrera e-postbaserade varningssystem med OneUptimes incidenthanteringsarbetsflöde.

## Skapa en monitor för inkommande e-post

1. Navigera till **Monitorer** i din OneUptime-instrumentpanel
2. Klicka på **Skapa monitor**
3. Välj **Inkommande e-post** som monitortyp
4. Konfigurera monitorinställningarna:
   - **Namn:** Ett beskrivande namn för din monitor
   - **Beskrivning:** Vad den här monitorn är till för
5. Konfigurera dina **Kriterier för varningsskapande** (villkor som skapar varningar)
6. Konfigurera dina **Kriterier för varningslösning** (villkor som löser varningar)
7. Klicka på **Skapa**

Efter skapandet ser du den unika e-postadressen för den här monitorn på monitorns detaljsida.

## Format för e-postadress

Varje monitor för inkommande e-post får en unik e-postadress i formatet:

```
monitor-{secret-key}@{inbound-domain}
```

Till exempel: `monitor-abc123def456@inbound.yourdomain.com`

Du kan kopiera den här adressen från monitorns detaljsida och konfigurera dina externa system att skicka e-postmeddelanden till den.

## Tillgängliga kriterief ält

Du kan skapa kriterier baserat på följande e-postfält:

| Fält                | Beskrivning                                               |
| ------------------- | --------------------------------------------------------- |
| **E-postämne**      | Ämnesraden i det inkommande e-postmeddelandet             |
| **E-post från**     | Avsändarens e-postadress                                  |
| **E-postinnehåll**  | Det textinnehåll i e-postmeddelandets kropp               |
| **E-post till**     | Mottagarens e-postadress                                  |
| **E-post mottagen** | Tidsbaserade kriterier för när e-postmeddelanden tas emot |

## Tillgängliga filtertyper

### Strängfilter (ämne, från, innehåll, till)

| Filter              | Beskrivning                               | Exempel                               |
| ------------------- | ----------------------------------------- | ------------------------------------- |
| **Innehåller**      | Fältet innehåller den angivna texten      | Ämne innehåller "CRITICAL"            |
| **Innehåller inte** | Fältet innehåller inte den angivna texten | Ämne innehåller inte "TEST"           |
| **Lika med**        | Fältet matchar exakt den angivna texten   | Från är lika med "alerts@service.com" |
| **Inte lika med**   | Fältet matchar inte den angivna texten    | Ämne inte lika med "OK"               |
| **Börjar med**      | Fältet börjar med den angivna texten      | Ämne börjar med "[ALERT]"             |
| **Slutar med**      | Fältet slutar med den angivna texten      | Ämne slutar med "- Production"        |
| **Är tomt**         | Fältet är tomt eller blankt               | Innehåll är tomt                      |
| **Är inte tomt**    | Fältet har innehåll                       | Ämne är inte tomt                     |

### Tidsbaserade filter (E-post mottagen)

| Filter                         | Beskrivning                                   | Exempel                              |
| ------------------------------ | --------------------------------------------- | ------------------------------------ |
| **Mottagen inom minuter**      | E-post togs emot inom X minuter               | E-post mottagen inom 30 minuter      |
| **Inte mottagen inom minuter** | Inget e-postmeddelande mottogs inom X minuter | E-post inte mottagen inom 60 minuter |

## Exempelkonfigurationer

### Exempel 1: Skapa varning på kritiska e-postmeddelanden

**Kriterier för varningsskapande:**

- E-postämne **Innehåller** "CRITICAL"
- ELLER E-postämne **Innehåller** "ALERT"
- ELLER E-postämne **Innehåller** "ERROR"

**Kriterier för varningslösning:**

- E-postämne **Innehåller** "RESOLVED"
- ELLER E-postämne **Innehåller** "OK"
- ELLER E-postämne **Innehåller** "RECOVERED"

### Exempel 2: Övervaka specifik avsändare

**Kriterier för varningsskapande:**

- E-post från **Lika med** "monitoring@legacy-system.com"
- OCH E-postämne **Innehåller** "Failed"

**Kriterier för varningslösning:**

- E-post från **Lika med** "monitoring@legacy-system.com"
- OCH E-postämne **Innehåller** "Success"

### Exempel 3: Hjärtslags-monitor (inget e-postmeddelande = varning)

**Kriterier för varningsskapande:**

- E-post mottagen **Inte mottagen inom minuter** med värde `60`

Detta skapar en varning om inget e-postmeddelande tas emot på 60 minuter – användbart för att övervaka schemalagda jobb eller batchprocesser som bör skicka slutförandemeddelanden.

**Kriterier för varningslösning:**

- E-post mottagen **Mottagen inom minuter** med värde `5`

Detta löser varningen när ett e-postmeddelande tas emot.

## Användningsfall

### Integration med äldre system

Många äldre system stöder bara e-postbaserade varningar. Använd monitor för inkommande e-post för att:

- Konvertera e-postmeddelanden till OneUptime-incidenter
- Automatiskt lösa incidenter när återhämtningsmeddelanden anländer
- Centralisera varningar från flera äldre system

### Tredjepartstjänstövervakning

Integrera med tjänster som skickar e-postmeddelanden:

- Molnleverantörsvarningar (AWS, GCP, Azure)
- Säkerhetsskanningsverktyg
- Aviseringar om säkerhetskopieringsslutförande
- Varningar om SSL-certifikatutgång

### Övervakning av schemalagda jobb

Övervaka batchjobb och schemalagda uppgifter:

- Skapa varningar om slutförandemeddelanden inte tas emot i tid
- Spåra jobbfel via felmeddelanden
- Övervaka slutföranden av datapipelines

### Aggregering av varningar från flera leverantörer

Konsolidera varningar från flera övervakningsverktyg:

- Ta emot varningar från Nagios, Zabbix eller andra verktyg via e-post
- Förena incidenthantering i OneUptime
- Bibehåll en enda källa för alla varningar

## Mallvariabler

När du konfigurerar incidentmallar kan du använda dessa variabler från inkommande e-postmeddelanden:

| Variabel              | Beskrivning                              |
| --------------------- | ---------------------------------------- |
| `{{emailSubject}}`    | Ämnet för det mottagna e-postmeddelandet |
| `{{emailFrom}}`       | Avsändarens e-postadress                 |
| `{{emailTo}}`         | Mottagarens e-postadress                 |
| `{{emailBody}}`       | Textinnehållet i e-postmeddelandet       |
| `{{emailReceivedAt}}` | När e-postmeddelandet togs emot          |

## Monitoröversiktsvy

Monitoröversikten visar:

- **Senaste e-post mottagen:** När det senaste e-postmeddelandet togs emot
- **Från:** Avsändaren av det senaste e-postmeddelandet
- **Ämne:** Ämnesraden för det senaste e-postmeddelandet
- **E-posthuvuden:** Fullständiga huvuden för det senaste e-postmeddelandet (expanderbart)
- **E-postinnehåll:** Innehållet i det senaste e-postmeddelandet (expanderbart)

## Konfiguration för egeninstallation

Om du egeninstallerar OneUptime behöver du konfigurera en inkommande e-postleverantör. För närvarande stöds:

- **SendGrid Inbound Parse** – Se [SendGrid Integration för inkommande e-post](/docs/self-hosted/sendgrid-inbound-email) för konfigurationsinstruktioner

## Saker att tänka på

- **E-postadresssäkerhet:** Monitorns e-postadress innehåller en hemlig nyckel. Behandla den som ett lösenord och dela den inte offentligt.
- **E-poststorlek:** Mycket stora e-postmeddelanden (med stora bilagor) kan trunkeras eller avvisas av e-postleverantören.
- **Bearbetningstid:** E-postmeddelanden bearbetas asynkront. Det kan dröja några sekunder mellan att skicka ett e-postmeddelande och att en varning skapas.
- **Skiftlägesokänslighet:** Alla strängijämförelser (Innehåller, Lika med etc.) är skiftlägesokänsliga.
- **Klartext:** Kriterier för e-postinnehåll använder textversionen av e-postmeddelandet. HTML-formatering tas bort.

## Felsökning

### E-postmeddelanden tas inte emot

1. Verifiera att e-postadressen är korrekt (kontrollera om det finns stavfel)
2. Kontrollera om e-postmeddelandet blockeras av skräppostfilter
3. Verifiera att din inkommande e-postleverantör är korrekt konfigurerad
4. Kontrollera OneUptime-loggarna efter eventuella felmeddelanden

### Varningar skapas inte

1. Verifiera att dina kriterier matchar e-postinnehållet
2. Kontrollera att monitorn inte är inaktiverad
3. Granska utvärderingsloggarna i monitorns detaljer
4. Testa med exakta strängmatchningar innan du använder mönstermatchning

### Varningar löses inte

1. Verifiera att dina lösningskriterier matchar återhämtningsmeddelandet
2. Se till att det finns en aktiv varning att lösa
3. Kontrollera att lösningsmeddelandet skickas till samma monitoradress
