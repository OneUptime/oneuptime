# Installationsguide för Windows

Installera OneUptime som en skrivbordsapplikation på Windows för heltäckande övervakning och incidenthantering.


## Installationsmetoder

### Metod 1: Microsoft Edge (rekommenderas)

Edge ger den bästa Windows PWA-integrationen med inbyggda funktioner.

1. **Öppna OneUptime i Edge**
   - Starta Microsoft Edge-webbläsaren
   - Navigera till URL:en för din OneUptime-instans
   - Logga in på ditt OneUptime-konto
   - Vänta tills sidan laddas helt

2. **Installera app**
   - Leta efter **installationsikonen** (⊞) i adressfältet
   - Klicka på knappen **"Installera OneUptime"**
   - Eller klicka på **tredubbelpunktsmenyn** → **Appar** → **Installera den här webbplatsen som en app**

3. **Anpassa installationen**
   - **Appnamn**: Ändra om du vill (standard: OneUptime)
   - **Start-menyn**: Välj om du vill lägga till i Start-menyn
   - **Aktivitetsfältet**: Alternativ för att fästa i aktivitetsfältet
   - **Skrivbord**: Skapa skrivbordsgenväg

4. **Slutför installationen**
   - Klicka på **"Installera"** för att avsluta
   - OneUptime öppnas i ett eget fönster
   - Hitta det i Start-menyn under installerade appar

### Metod 2: Google Chrome

Chrome erbjuder utmärkt PWA-stöd med rik skrivbordsintegration.

1. **Öppna OneUptime i Chrome**
   - Starta Google Chrome
   - Gå till din OneUptime-instans
   - Se till att du är inloggad
   - Låt sidan laddas helt

2. **Installera via adressfältet**
   - Leta efter **installationsikonen** (⊞) i adressfältet
   - Klicka på **"Installera OneUptime"**
   - Eller använd menyn: **tre punkter** → **Fler verktyg** → **Skapa genväg**

3. **Installationsalternativ**
   - Markera **"Öppna som fönster"** för app-liknande upplevelse
   - Anpassa appnamnet om du vill
   - Klicka på **"Installera"** eller **"Skapa"**

4. **Starta appen**
   - Hitta OneUptime i Windows Start-meny
   - Eller starta från skrivbordsgenvägen
   - Appen öppnas i ett dedikerat fönster

### Metod 3: Firefox

Firefox stöder PWA-installation med grundläggande skrivbordsintegration.

1. **Öppna OneUptime i Firefox**
   - Starta Firefox-webbläsaren
   - Navigera till OneUptime-URL:en
   - Slutför inloggningsprocessen

2. **Installera PWA**
   - Leta efter **installationsprompt** eller banner
   - Eller klicka på **menyn** → **Installera**
   - Om tillgängligt, klicka på motsvarigheten till **"Lägg till på startskärmen"**


### Startkonfiguration
1. **Automatisk start**: Konfigurera OneUptime att starta med Windows
   - Högerklicka på aktivitetsfältet → Aktivitetshanteraren → Start
   - Aktivera OneUptime om du vill
2. **Standardstorlek**: Ange önskad fönsterstorlek och position

### Aviseringsinställningar
1. **Windows-aviseringar**
   - Inställningar → System → Aviseringar och åtgärder
   - Hitta OneUptime och konfigurera varningsinställningar
   - Aktivera banneraviseringar för incidenter

2. **Fokusassistent**
   - Konfigurera inställningar för Stör ej
   - Tillåt OneUptime kritiska aviseringar
   - Ange prioritetsnivåer för olika varningstyper

## Avancerade installationsalternativ


## Felsökning

### Installationsproblem

**Installationsknapp visas inte:**
```
Lösningar:
1. Se till att du använder Edge eller Chrome (rekommenderade webbläsare)
2. Verifiera HTTPS-anslutning till OneUptime-instansen
3. Rensa webbläsarens cache och cookies
4. Uppdatera webbläsaren till den senaste versionen
5. Kontrollera om PWA-kraven uppfylls på servern
6. Inaktivera webbläsartillägg tillfälligt
```

**Installationen misslyckas eller kraschar:**
```
Lösningar:
1. Kör webbläsaren som administratör
2. Kontrollera Windows User Account Control (UAC)-inställningar
3. Se till att det finns tillräckligt med diskutrymme (minst 100 MB)
4. Inaktivera antivirusprogram tillfälligt
5. Rensa webbläsardata helt
6. Starta om Windows och försök igen
```

**Appen visas inte i Start-menyn:**
```
Lösningar:
1. Sök efter "OneUptime" i Windows-sökning
2. Kontrollera om den installerats under ett annat namn
3. Titta i avsnittet "Nyligen tillagda" appar
4. Installera om och se till att "Lägg till i Start-menyn" är markerat
5. Skapa manuell genväg vid behov
```

### Aviseringsproblem

**Windows-aviseringar fungerar inte:**
```
Lösningar:
1. Windows Inställningar → System → Aviseringar och åtgärder
2. Aktivera aviseringar för OneUptime
3. Kontrollera inställningar för Fokusassistent
4. Se till att aviserings behörigheter finns i OneUptime
5. Testa med enkel avisering först
```

## Avinstallation

### Fullständig borttagning
1. **Windows-inställningsmetod**
   - Inställningar → Appar → Appar och funktioner
   - Sök efter "OneUptime"
   - Klicka och välj "Avinstallera"

2. **Webbläsarmetod**
   - Öppna Edge/Chrome
   - Gå till edge://apps/ eller chrome://apps/
   - Hitta OneUptime
   - Klicka på alternativ → Avinstallera

3. **Start-menymetod**
   - Högerklicka på OneUptime i Start-menyn
   - Välj "Avinstallera"
   - Bekräfta borttagningen


## Uppdateringar och underhåll

### Automatiska uppdateringar
- OneUptime PWA uppdateras automatiskt när du är online
- Ingen manuell åtgärd krävs
- Uppdateringar tillämpas omedelbart vid omstart
- Kritiska korrigeringar driftsätts direkt
