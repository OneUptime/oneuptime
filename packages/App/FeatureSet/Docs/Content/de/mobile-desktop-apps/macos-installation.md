# macOS-Installationsanleitung

Installieren Sie OneUptime als native Desktop-Anwendung auf macOS für nahtloses Monitoring und Incident-Management.

## Installationsmethoden

### Methode 1: Safari (Empfohlen für macOS)

Safari bietet exzellente PWA-Integration mit nativen macOS-Funktionen.

1. **OneUptime in Safari öffnen**

   - Safari-Browser starten
   - Zur URL Ihrer OneUptime-Instanz navigieren
   - Bei Ihrem OneUptime-Konto anmelden
   - Auf vollständiges Laden der Seite warten

2. **PWA installieren**

   - Auf **Ablage** in der Menüleiste klicken
   - **„Zum Dock hinzufügen"** auswählen (macOS Sonoma+)
   - Oder nach dem **Installations-Symbol** in der Adressleiste suchen
   - Alternativ: **Ablage** → **„Zum Home-Bildschirm hinzufügen"** (älteres macOS)

3. **Installation anpassen**

   - **App-Name**: Bei Wunsch ändern (Standard: OneUptime)
   - **Dock**: Zum Dock hinzufügen wählen
   - **Launchpad**: Für einfachen Zugriff zum Launchpad hinzufügen

4. **App starten**
   - OneUptime im Dock, Launchpad oder im Anwendungsordner finden
   - Klicken, um in einem eigenen Fenster zu starten
   - App läuft unabhängig vom Safari-Browser

### Methode 2: Google Chrome

Chrome bietet robuste PWA-Unterstützung mit exzellenter Desktop-Integration.

1. **OneUptime in Chrome öffnen**

   - Google Chrome starten
   - Zur OneUptime-Instanz gehen
   - Angemeldet sein
   - Vollständiges Laden der Seite abwarten

2. **Über Menü installieren**

   - Nach **Installations-Symbol** (⊞) in der Adressleiste suchen
   - Auf **„OneUptime installieren"** klicken
   - Oder **Chrome-Menü** → **Weitere Tools** → **Verknüpfung erstellen** verwenden

3. **Installationsoptionen**

   - **„Als Fenster öffnen"** für natives App-Erlebnis aktivieren
   - App-Namen bei Bedarf anpassen
   - Auf **„Installieren"** oder **„Erstellen"** klicken

4. **App aufrufen**
   - OneUptime im Anwendungsordner finden
   - Oder über Spotlight-Suche aufrufen
   - Für schnellen Zugriff ans Dock anheften

### Methode 3: Microsoft Edge

Edge bietet solide PWA-Unterstützung mit guter macOS-Integration.

1. **OneUptime in Edge öffnen**

   - Microsoft Edge starten
   - Zur OneUptime-URL navigieren
   - Anmeldeprozess abschließen

2. **App installieren**
   - Auf **Drei-Punkte-Menü** → **Apps** → **Diese Website als App installieren** klicken
   - Oder nach Installationsaufforderung in der Adressleiste suchen
   - App-Namen nach Wunsch anpassen
   - Auf **„Installieren"** klicken

### Anpassungsoptionen

### Dock und Launchpad

1. **Dock-Position**: OneUptime an bevorzugte Dock-Position ziehen
2. **Dock-Größe**: Symbol in den Dock-Einstellungen skalieren
3. **Launchpad-Organisation**: Monitoring-App-Ordner erstellen
4. **Badge-Benachrichtigungen**: Incident-Anzahl auf dem Dock-Symbol anzeigen

### Menüleiste und Benachrichtigungen

1. **Benachrichtigungszentrum**

   - Systemeinstellungen → Benachrichtigungen → OneUptime
   - Benachrichtigungsstile und -lieferung konfigurieren
   - Prioritätsstufen für verschiedene Incident-Typen festlegen

2. **Menüleisten-Integration**
   - Native Menüleiste für Safari PWAs
   - Benutzerdefinierte Menüelemente für häufige Aktionen
   - Tastaturkürzel für häufige Aufgaben

## Fehlerbehebung

### Installationsprobleme

**„Zum Dock hinzufügen" in Safari nicht verfügbar:**

```
Lösungen:
1. macOS Sonoma (14.0) oder höher sicherstellen
2. Safari auf neueste Version aktualisieren
3. Alternative versuchen: Ablage → Zum Home-Bildschirm hinzufügen
4. Safari-Cache leeren und erneut versuchen
5. Chrome oder Edge als Alternative verwenden
```

**PWA installiert sich nicht oder stürzt ab:**

```
Lösungen:
1. macOS-Versionskompatibilität prüfen
2. Ausreichend Speicherplatz sicherstellen (100 MB+)
3. Browser auf neueste Version aktualisieren
4. Browser-Cache und -Cookies leeren
5. Browser-Erweiterungen vorübergehend deaktivieren
6. Mac neu starten und Installation erneut versuchen
```

**App erscheint nicht in Anwendungen:**

```
Lösungen:
1. Launchpad nach OneUptime-Symbol durchsuchen
2. Mit Spotlight suchen (⌘+Leertaste)
3. Im PWA-Verwaltungsbereich des Browsers suchen
4. Mit anderem Browser neu installieren versuchen
5. Prüfen, ob unter anderem Namen installiert
```

### Benachrichtigungsprobleme

**macOS-Benachrichtigungen funktionieren nicht:**

```
Lösungen:
1. Systemeinstellungen → Benachrichtigungen → OneUptime
2. „Benachrichtigungen erlauben" aktivieren
3. Geeigneten Benachrichtigungsstil einstellen (Banner/Hinweise)
4. „Nicht stören"-Einstellungen prüfen
5. OneUptime-Benachrichtigungseinstellungen überprüfen
6. Benachrichtigungsberechtigungen bei Aufforderung erteilen
```

## Deinstallation

### Vollständige Entfernung

1. **Methode über Anwendungsordner**

   - Anwendungsordner öffnen
   - OneUptime finden
   - In den Papierkorb ziehen oder rechtsklicken → In Papierkorb legen

2. **Dock-Methode**

   - Rechtsklick auf OneUptime im Dock
   - „Optionen" → „Aus Dock entfernen" wählen
   - Dann aus dem Anwendungsordner löschen

3. **Browser-PWA-Verwaltung**
   - **Chrome**: chrome://apps/ → OneUptime finden → Entfernen
   - **Edge**: edge://apps/ → OneUptime finden → Deinstallieren
   - **Safari**: Keine dedizierte Verwaltungsseite

### Saubere Deinstallation

Alle zugehörigen Daten entfernen:

```bash
# Safari-PWA-Daten löschen (allgemeine Website-Daten)
rm -rf ~/Library/Safari/Databases
rm -rf ~/Library/Caches/com.apple.Safari

# Chrome-PWA-Daten löschen
rm -rf ~/Library/Application\ Support/Google/Chrome/Default/Web\ Applications

# Edge-PWA-Daten löschen
rm -rf ~/Library/Application\ Support/Microsoft\ Edge/Default/Web\ Applications
```

## Updates und Wartung

### Automatische Updates

- OneUptime PWA aktualisiert sich automatisch bei Online-Verbindung
- Keine App-Store-Updates erforderlich
- Neue Funktionen sofort verfügbar
- Kritische Updates werden sofort angewendet

### Wartungsplan

Regelmäßige Wartung für optimale Leistung:

**Wöchentlich:**

- OneUptime-App neu starten
- Browser-Cache bei Problemen leeren
- Auf macOS-Updates prüfen

**Monatlich:**

- Speichernutzung prüfen und bei Bedarf bereinigen
- Browser aktualisieren, falls keine automatischen Updates
- Prüfen, ob Benachrichtigungseinstellungen noch funktionieren

## Integration mit macOS-Funktionen

### Kurzbefehle-App-Integration

Benutzerdefinierte Kurzbefehle für OneUptime erstellen:

1. **Kurzbefehle**-App öffnen
2. **Neuen Kurzbefehl** erstellen
3. **„App öffnen"**-Aktion hinzufügen
4. **OneUptime** auswählen
5. Siri für Sprachaktivierung hinzufügen

### Terminal-Integration

OneUptime über Terminal verwalten:

```bash
# Alias für schnellen OneUptime-Start erstellen
echo 'alias oneuptime="open -a \"OneUptime\""' >> ~/.zshrc

# Funktion zum Prüfen, ob OneUptime läuft
oneuptime_status() {
    if pgrep -f "OneUptime" > /dev/null; then
        echo "OneUptime is running"
    else
        echo "OneUptime is not running"
    fi
}
```

## Sicherheit und Datenschutz

### macOS-Sicherheitsfunktionen

1. **Gatekeeper**: Sicherstellen, dass PWA-Installationen aus vertrauenswürdigen Quellen stammen
2. **System Integrity Protection**: Schützt Systemdateien
3. **FileVault**: Festplatte für Datenschutz verschlüsseln
4. **Schlüsselbund**: Sichere Anmeldedatenspeicherung

### Best Practices

1. **Regelmäßige Updates**: macOS und Browser aktuell halten
2. **Starke Authentifizierung**: Touch ID/Face ID verwenden, wenn verfügbar
3. **Netzwerksicherheit**: VPN für Remote-Monitoring-Zugriff verwenden
4. **Datensicherung**: Regelmäßige Time Machine-Backups schließen PWA-Daten ein
5. **Berechtigungsüberprüfung**: Erteilte Berechtigungen regelmäßig überprüfen
