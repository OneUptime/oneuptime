# Installationsguide för macOS

Installera OneUptime som en inbyggd skrivbordsapplikation på macOS för sömlös övervakning och incidenthantering.

## Installationsmetoder

### Metod 1: Safari (rekommenderas för macOS)

Safari ger utmärkt PWA-integration med inbyggda macOS-funktioner.

1. **Öppna OneUptime i Safari**

   - Starta Safari-webbläsaren
   - Navigera till URL:en för din OneUptime-instans
   - Logga in på ditt OneUptime-konto
   - Vänta tills sidan laddas helt

2. **Installera PWA**

   - Klicka på **Fil** i menyraden
   - Välj **"Lägg till i Dock"** (macOS Sonoma+)
   - Eller leta efter **installationsikonen** i adressfältet
   - Alternativt: **Fil** → **"Lägg till på startskärmen"** (äldre macOS)

3. **Anpassa installationen**

   - **Appnamn**: Ändra om du vill (standard: OneUptime)
   - **Dock**: Välj att lägga till i Dock
   - **Launchpad**: Lägg till i Launchpad för enkel åtkomst

4. **Starta appen**
   - Hitta OneUptime i Dock, Launchpad eller Program-mappen
   - Klicka för att starta i dedikerat fönster
   - Appen körs oberoende av Safari

### Metod 2: Google Chrome

Chrome erbjuder robusttt PWA-stöd med utmärkt skrivbordsintegration.

1. **Öppna OneUptime i Chrome**

   - Starta Google Chrome
   - Gå till din OneUptime-instans
   - Se till att du är inloggad
   - Låt sidan laddas helt

2. **Installera via menyn**

   - Leta efter **installationsikonen** (⊞) i adressfältet
   - Klicka på **"Installera OneUptime"**
   - Eller använd **Chrome-menyn** → **Fler verktyg** → **Skapa genväg**

3. **Installationsalternativ**

   - Markera **"Öppna som fönster"** för inbyggd appupplevelse
   - Anpassa appnamnet om det behövs
   - Klicka på **"Installera"** eller **"Skapa"**

4. **Komma åt appen**
   - Hitta OneUptime i Program-mappen
   - Eller via Spotlight-sökning
   - Fäst i Dock för snabb åtkomst

### Metod 3: Microsoft Edge

Edge ger solitt PWA-stöd med bra macOS-integration.

1. **Öppna OneUptime i Edge**

   - Starta Microsoft Edge
   - Navigera till OneUptime-URL:en
   - Slutför inloggningsprocessen

2. **Installera app**
   - Klicka på **tredubbelpunktsmenyn** → **Appar** → **Installera den här webbplatsen som en app**
   - Eller leta efter installationsprompt i adressfältet
   - Anpassa appnamnet om du vill
   - Klicka på **"Installera"**

### Anpassningsalternativ

### Dock och Launchpad

1. **Dock-position**: Dra OneUptime till önskad Dock-position
2. **Dock-storlek**: Ändra storlek på ikonen i Dock-inställningar
3. **Launchpad-organisation**: Skapa en övervakningsappmapp
4. **Märkaviseringar**: Visa incidentantal på Dock-ikonen

### Menyraden och aviseringar

1. **Aviseringscenter**

   - Systeminställningar → Aviseringar → OneUptime
   - Konfigurera varningsstilar och leverans
   - Ange prioritetsnivåer för olika incidenttyper

2. **Menyradesintegration**
   - Inbyggd menyrad för Safari PWA:er
   - Anpassade menyobjekt för vanliga åtgärder
   - Tangentbordsgenvägar för vanliga uppgifter

## Felsökning

### Installationsproblem

**"Lägg till i Dock" inte tillgängligt i Safari:**

```
Lösningar:
1. Se till att macOS Sonoma (14.0) eller senare
2. Uppdatera Safari till den senaste versionen
3. Prova alternativ: Fil → Lägg till på startskärmen
4. Rensa Safari-cache och försök igen
5. Använd Chrome eller Edge som alternativ
```

**PWA installeras inte eller kraschar:**

```
Lösningar:
1. Kontrollera macOS-versionskompatibilitet
2. Se till att det finns tillräckligt med diskutrymme (100 MB+)
3. Uppdatera webbläsaren till den senaste versionen
4. Rensa webbläsarens cache och cookies
5. Inaktivera webbläsartillägg tillfälligt
6. Starta om Mac och försök installera igen
```

**Appen visas inte i Program:**

```
Lösningar:
1. Kontrollera Launchpad för OneUptime-ikonen
2. Sök med Spotlight (⌘+Space)
3. Titta i webbläsarens PWA-hanteringsavsnitt
4. Prova att installera om med en annan webbläsare
5. Kontrollera om den installerats under ett annat namn
```

### Aviseringsproblem

**macOS-aviseringar fungerar inte:**

```
Lösningar:
1. Systeminställningar → Aviseringar → OneUptime
2. Aktivera "Tillåt aviseringar"
3. Ange lämplig varningsstil (banners/varningar)
4. Kontrollera inställningar för Stör ej
5. Verifiera OneUptime-aviseringsinställningar
6. Bevilja aviserings behörigheter när du uppmanas
```

## Avinstallation

### Fullständig borttagning

1. **Program-mapp-metod**

   - Öppna Program-mappen
   - Hitta OneUptime
   - Dra till papperskorgen eller högerklicka → Flytta till papperskorgen

2. **Dock-metod**

   - Högerklicka på OneUptime i Dock
   - Välj "Alternativ" → "Ta bort från Dock"
   - Ta sedan bort från Program-mappen

3. **Webbläsarens PWA-hantering**
   - **Chrome**: chrome://apps/ → Hitta OneUptime → Ta bort
   - **Edge**: edge://apps/ → Hitta OneUptime → Avinstallera
   - **Safari**: Ingen dedikerad hanteringssida

### Ren avinstallation

Ta bort all associerad data:

```bash
# Rensa Safari PWA-data (allmänna webbplatsdata)
rm -rf ~/Library/Safari/Databases
rm -rf ~/Library/Caches/com.apple.Safari

# Rensa Chrome PWA-data
rm -rf ~/Library/Application\ Support/Google/Chrome/Default/Web\ Applications

# Rensa Edge PWA-data
rm -rf ~/Library/Application\ Support/Microsoft\ Edge/Default/Web\ Applications
```

## Uppdateringar och underhåll

### Automatiska uppdateringar

- OneUptime PWA uppdateras automatiskt när du är online
- Inga App Store-uppdateringar krävs
- Nya funktioner tillgängliga omedelbart
- Kritiska uppdateringar tillämpas direkt

### Underhållsschema

Regelbundet underhåll för optimal prestanda:

**Veckovis:**

- Starta om OneUptime-appen
- Rensa webbläsarcache om du upplever problem
- Kontrollera om det finns macOS-uppdateringar

**Månadsvis:**

- Granska lagringsanvändning och rensa vid behov
- Uppdatera webbläsare om de inte uppdateras automatiskt
- Verifiera att aviseringsinställningar fortfarande fungerar

## Integration med macOS-funktioner

### Integration med Genvägar-appen

Skapa anpassade genvägar för OneUptime:

1. Öppna **Genvägar**-appen
2. Skapa **Ny genväg**
3. Lägg till åtgärden **"Öppna app"**
4. Välj **OneUptime**
5. Lägg till i Siri för röstaktivering

### Terminal-integration

Hantera OneUptime via Terminal:

```bash
# Skapa alias för snabb OneUptime-start
echo 'alias oneuptime="open -a \"OneUptime\""' >> ~/.zshrc

# Funktion för att kontrollera om OneUptime körs
oneuptime_status() {
    if pgrep -f "OneUptime" > /dev/null; then
        echo "OneUptime is running"
    else
        echo "OneUptime is not running"
    fi
}
```

## Säkerhet och sekretess

### macOS-säkerhetsfunktioner

1. **Gatekeeper**: Se till att PWA-installationer är från betrodda källor
2. **System Integrity Protection**: Skyddar systemfiler
3. **FileVault**: Kryptera disk för dataskydd
4. **Nyckelring**: Säker lagring av autentiseringsuppgifter

### Bästa praxis

1. **Regelbundna uppdateringar**: Håll macOS och webbläsare uppdaterade
2. **Stark autentisering**: Använd Touch ID/Face ID när det är tillgängligt
3. **Nätverkssäkerhet**: Använd VPN för fjärrövervakning
4. **Datasäkerhetskopiering**: Regelbundna Time Machine-säkerhetskopior inkluderar PWA-data
5. **Behörighetsgranskning**: Granska beviljade behörigheter regelbundet
