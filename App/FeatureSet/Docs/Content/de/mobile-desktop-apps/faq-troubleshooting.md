# Häufig gestellte Fragen und Fehlerbehebung

Häufig gestellte Fragen und Lösungen für OneUptime Mobile- und Desktop-Apps (PWA).

## Allgemeine FAQ

### Was ist eine Progressive Web App (PWA)?

Eine Progressive Web App ist eine Webanwendung, die moderne Web-Technologien nutzt, um app-ähnliche Erfahrungen zu ermöglichen. PWAs können direkt aus Browsern ohne App-Stores installiert werden, funktionieren offline, senden Push-Benachrichtigungen und integrieren sich in das Betriebssystem Ihres Geräts.

### Warum verwendet OneUptime keine traditionellen App-Stores?

OneUptime nutzt PWA-Technologie, weil sie mehrere Vorteile bietet:
- **Sofortige Updates**: Kein Warten auf App-Store-Genehmigung oder manuelle Updates
- **Plattformübergreifend**: Eine einzige Codebasis funktioniert auf allen Geräten
- **Keine Download-Größenbeschränkungen**: Vollständige Funktionen ohne Größenbeschränkungen
- **Direkte Distribution**: Direkt von Ihrer OneUptime-Instanz installieren
- **Immer aktuell**: Benutzer haben immer die neueste Version
- **Sicherheit**: Gleiche Sicherheitsvorteile wie Webanwendungen


### Wie viel Speicher verwendet die OneUptime PWA?

- **Erstinstallation**: 10-20 MB
- **Cache-Wachstum**: 50-100 MB bei regelmäßiger Nutzung
- **Maximaler Cache**: Typischerweise von Browsern auf 200 MB begrenzt
- **Automatische Bereinigung**: Browser verwalten den Speicher automatisch

### Unterstützt die OneUptime PWA Push-Benachrichtigungen?

Ja, die OneUptime PWA unterstützt umfangreiche Push-Benachrichtigungen:
- **Incident-Benachrichtigungen**: Echtzeit-Incident-Benachrichtigungen
- **Status-Updates**: Benachrichtigungen über Monitor-Statusänderungen
- **Benutzerdefinierte Auslöser**: Benachrichtigungsregeln konfigurieren
- **Reichhaltiger Inhalt**: Bilder, Aktionen und detaillierte Informationen
- **Badge-Updates**: Anzahl ungelesener Nachrichten auf dem App-Symbol

## Installations-FAQ

### Warum sehe ich die Schaltfläche „Installieren" nicht?

Häufige Gründe und Lösungen:
1. **Browser-Kompatibilität**: Chrome, Edge oder Safari verwenden
2. **HTTPS erforderlich**: Sicherstellen, dass die OneUptime-Instanz HTTPS verwendet
3. **PWA-Anforderungen**: Server muss PWA-Manifest-Anforderungen erfüllen
4. **Cache-Probleme**: Browser-Cache leeren und Seite neu laden
5. **Bereits installiert**: App ist möglicherweise bereits installiert
6. **Wartezeit**: Manche Browser benötigen 30+ Sekunden auf der Seite

### Kann ich auf mehreren Geräten installieren?

Ja! Sie können die OneUptime PWA installieren auf:
- Unbegrenzte Geräte pro Benutzer
- Mehrere Browser auf demselben Gerät
- Verschiedene Betriebssysteme
- Gemeinsam genutzte Geräte (mit separaten Konten)

### Wie aktualisiere ich die installierte App?

Die OneUptime PWA aktualisiert sich automatisch:
- **Automatische Updates**: App aktualisiert sich, wenn Sie sie online besuchen
- **Hintergrund-Updates**: Updates werden im Hintergrund heruntergeladen
- **Sofortige Verfügbarkeit**: Neue Funktionen sofort verfügbar
- **Kein Benutzereingriff**: Im Gegensatz zu Store-Apps sind keine manuellen Updates nötig

### Kann ich den App-Namen während der Installation anpassen?

Ja, während der Installation können Sie:
- Den App-Namen ändern (Standard: „OneUptime")
- Ihren Organisationsnamen hinzufügen
- Eine benutzerdefinierte Namenskonvention verwenden
- Die Symbol-Bezeichnung ändern (plattformabhängig)

### Wie deinstalliere ich die OneUptime PWA?

Die Deinstallation variiert je nach Plattform:

**Android:**
- App-Symbol lang gedrückt halten → Deinstallieren
- Einstellungen → Apps → OneUptime → Deinstallieren

**iOS:**
- App-Symbol lang gedrückt halten → App entfernen → App löschen

**Windows:**
- Einstellungen → Apps → OneUptime → Deinstallieren
- Rechtsklick auf Start-Menü-Eintrag → Deinstallieren

**macOS:**
- Aus Anwendungen in den Papierkorb ziehen
- Rechtsklick auf Dock-Symbol → Entfernen

**Linux:**
- Aus Anwendungsstarter entfernen
- .desktop-Datei löschen


## Benachrichtigungs-FAQ

### Warum erhalte ich keine Benachrichtigungen?

Häufige Benachrichtigungsprobleme und Lösungen:

**Berechtigungen prüfen:**
```
1. Browser-Benachrichtigungsberechtigungen aktiviert
2. Betriebssystem-Benachrichtigungsberechtigungen
3. OneUptime-Benachrichtigungseinstellungen konfiguriert
4. Modus „Nicht stören" deaktiviert
```

**Plattformspezifisch:**
- **Android**: Akku-Optimierungseinstellungen prüfen
- **iOS**: Benachrichtigungseinstellungen in der Einstellungs-App überprüfen
- **Windows**: Fokus-Assistent-Einstellungen prüfen
- **macOS**: Benachrichtigungszentrum-Berechtigungen überprüfen
- **Linux**: Benachrichtigungs-Daemon-Status prüfen

### Kann ich Benachrichtigungstöne anpassen?

Optionen zur Benachrichtigungsanpassung:
- **Systemtöne**: Betriebssystem-Benachrichtigungstöne verwenden
- **Browser-Einstellungen**: In den Browser-Benachrichtigungseinstellungen konfigurieren
- **OneUptime-Einstellungen**: Benachrichtigungspräferenzen im Dashboard festlegen
- **Prioritätsstufen**: Verschiedene Töne für unterschiedliche Schweregrade konfigurieren

### Wie deaktiviere ich Benachrichtigungen vorübergehend?

Vorübergehende Deaktivierung von Benachrichtigungen:
- **Nicht stören**: System-DND-Modus aktivieren
- **Browser-Einstellungen**: Website-Benachrichtigungen vorübergehend deaktivieren
- **OneUptime-Dashboard**: Benachrichtigungen in den Einstellungen pausieren
- **Fokusmodi**: Betriebssystem-Fokus-/Konzentrationsmodi verwenden

## Sicherheits-FAQ

### Ist die OneUptime PWA sicher?

Sicherheitsfunktionen und Überlegungen:
- **HTTPS-Verschlüsselung**: Alle Daten werden sicher übertragen
- **Same-Origin-Policy**: Browser-Sicherheitsbeschränkungen gelten
- **Sandbox-Umgebung**: Läuft in der Browser-Sicherheitssandbox
- **Regelmäßige Updates**: Sicherheitspatches werden automatisch angewendet
- **Kein Root-Zugriff**: Eingeschränkter Systemzugriff im Vergleich zu nativen Apps


*Hinweis: Sensible Daten werden verschlüsselt und entsprechen Browser-Sicherheitsstandards.*

### Kann ich die OneUptime PWA in Unternehmensnetzwerken verwenden?

Überlegungen für Unternehmensnetzwerke:
- **Firewall-Regeln**: HTTPS-Zugriff (Port 443) sicherstellen
- **Proxy-Konfiguration**: Browser-Proxy-Einstellungen konfigurieren
- **Zertifikatsvertrauen**: Unternehmenszertifikate installieren, falls nötig
- **VPN-Zugriff**: VPN für Remote-Zugriff verwenden
- **Sicherheitsrichtlinien**: IT-Sicherheitsanforderungen einhalten

## Fehlerbehebung

### Installationsprobleme

**Problem**: Installationsschaltfläche erscheint nicht
```
Lösungen:
1. 30+ Sekunden auf der OneUptime-Seite warten
2. Seite aktualisieren und erneut warten
3. Browser-Cache und -Cookies leeren
4. Anderen Browser versuchen (Chrome/Edge empfohlen)
5. HTTPS-Verbindung überprüfen (auf Schloss-Symbol achten)
6. Prüfen, ob bereits installiert
```

**Problem**: Installation schlägt fehl oder stürzt ab
```
Lösungen:
1. Ausreichend Speicherplatz sicherstellen (100 MB+)
2. Andere Browser-Tabs und Anwendungen schließen
3. Browser auf neueste Version aktualisieren
4. Browser-Erweiterungen vorübergehend deaktivieren
5. Installation im privaten/Inkognito-Modus versuchen
6. Browser neu starten und erneut versuchen
```

**Problem**: App installiert, erscheint aber nicht
```
Lösungen:
1. Alle App-Starter-Orte prüfen
2. Im Gerät nach „OneUptime" suchen
3. Im PWA-Verwaltungsbereich des Browsers suchen
4. 1-2 Minuten warten, bis das System aktualisiert
5. Gerät neu starten und erneut prüfen
```

**Problem**: App stürzt häufig ab
```
Lösungen:
1. Browser auf neueste Version aktualisieren
2. Alle Browser-Daten für OneUptime löschen
3. Browser-Erweiterungen deaktivieren
4. Verfügbaren Speicherplatz prüfen
5. Betriebssystem neu starten
6. OneUptime PWA neu installieren
```

**Problem**: Push-Benachrichtigungen funktionieren nicht
```
Lösungen:
1. Benachrichtigungsberechtigungen im Browser prüfen
2. System-Benachrichtigungseinstellungen überprüfen
3. Zunächst eine einfache Benachrichtigung testen
4. Benachrichtigungsdaten löschen und Berechtigungen neu erteilen
5. Einstellungen für „Nicht stören"/Fokusmodus prüfen
6. OneUptime-Benachrichtigungskonfiguration überprüfen
```

**Problem**: App synchronisiert keine aktuellen Daten
```
Lösungen:
1. Nach unten ziehen zum Aktualisieren (mobil)
2. Strg+F5 (Windows/Linux) oder Cmd+R (Mac) drücken
3. App schließen und erneut öffnen
4. App-Cache leeren und neu laden
5. Netzwerkverbindung prüfen
```

### Plattformspezifische Probleme

**Android-Probleme:**
```
Problem: App erscheint nicht in der App-Übersicht
Lösung: Bereich „Zuletzt hinzugefügte Apps" prüfen, in der App-Übersicht suchen

Problem: Benachrichtigungen werden verzögert
Lösung: Akku-Optimierung für Browser-App deaktivieren

Problem: App stürzt beim Start ab
Lösung: Chrome-App-Daten löschen, Gerät neu starten
```

**iOS-Probleme:**
```
Problem: Kann nicht zum Startbildschirm hinzufügen
Lösung: Safari-Browser verwenden, iOS 11.3+ sicherstellen

Problem: App-Symbol fehlt
Lösung: Alle Startbildschirmseiten und App-Bibliothek prüfen

Problem: Face ID funktioniert nicht
Lösung: Face ID für Safari in den Einstellungen aktivieren
```

**Windows-Probleme:**
```
Problem: App erscheint nicht im Startmenü
Lösung: Nach App-Name suchen, Liste installierter Apps prüfen

Problem: Benachrichtigungen werden nicht angezeigt
Lösung: Windows-Benachrichtigungseinstellungen prüfen, für Browser aktivieren

Problem: Fenstergrößenprobleme
Lösung: Manuell in der Größe anpassen, App merkt sich die Abmessungen
```

**macOS-Probleme:**
```
Problem: Installation über Safari nicht möglich
Lösung: Auf macOS Sonoma+ aktualisieren, Datei → Zum Dock hinzufügen verwenden

Problem: App nicht im Anwendungsordner
Lösung: Launchpad prüfen, Spotlight-Suche verwenden

Problem: Benachrichtigungen funktionieren nicht
Lösung: Systemeinstellungen → Benachrichtigungen prüfen
```

**Linux-Probleme:**
```
Problem: PWA-Installationsoption fehlt
Lösung: Chrome/Chromium verwenden, Desktop-Umgebungsunterstützung sicherstellen

Problem: Symbol erscheint nicht im Starter
Lösung: Desktop-Datenbank aktualisieren, .desktop-Datei prüfen

Problem: Audio-Benachrichtigungen funktionieren nicht
Lösung: PulseAudio prüfen, Browser-Audio-Berechtigungen überprüfen
```

### Fehlermeldungen

**„Diese Website kann nicht installiert werden"**
```
Ursachen:
- OneUptime-Instanz erfüllt PWA-Anforderungen nicht
- Fehlendes oder ungültiges Web-App-Manifest
- HTTPS nicht korrekt konfiguriert
- Browser unterstützt keine PWA-Installation

Lösungen:
- Administrator kontaktieren, um PWA-Einrichtung zu überprüfen
- Anderen Browser versuchen
- Browser-Konsole für detaillierte Fehler prüfen
```
