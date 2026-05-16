# Android-Installationsanleitung

Installieren Sie OneUptime als native App auf Ihrem Android-Gerät für das beste Überwachungserlebnis.

## Installationsmethoden

### Methode 1: Chrome-Browser (Empfohlen)

1. **OneUptime in Chrome öffnen**
   - Starten Sie Google Chrome auf Ihrem Android-Gerät
   - Navigieren Sie zur URL Ihrer OneUptime-Instanz
   - Warten Sie, bis die Seite vollständig geladen ist

2. **Installationsaufforderung**
   - Suchen Sie nach dem Banner „Zum Startbildschirm hinzufügen" am unteren Rand
   - Tippen Sie auf „Installieren" oder „Zum Startbildschirm hinzufügen"
   - Wenn die Aufforderung nicht erscheint, tippen Sie auf das Drei-Punkte-Menü (⋮) oben rechts

3. **Manuelle Installation über das Menü**
   - Tippen Sie auf das Chrome-Menü (drei Punkte)
   - Wählen Sie „Zum Startbildschirm hinzufügen" oder „App installieren"
   - Passen Sie den App-Namen nach Wunsch an
   - Tippen Sie auf „Hinzufügen" zur Bestätigung

4. **App starten**
   - Finden Sie das OneUptime-Symbol auf Ihrem Startbildschirm oder in der App-Übersicht
   - Tippen Sie darauf, um die App im Vollbildmodus zu starten

### Methode 2: Samsung Internet

1. **OneUptime öffnen**
   - Starten Sie den Samsung Internet-Browser
   - Gehen Sie zu Ihrer OneUptime-Instanz
   - Warten Sie, bis die Seite vollständig geladen ist

2. **Zum Startbildschirm hinzufügen**
   - Tippen Sie auf die Menüschaltfläche (drei Linien)
   - Wählen Sie „Seite hinzufügen zu" → „Startbildschirm"
   - Geben Sie den App-Namen ein und tippen Sie auf „Hinzufügen"

3. **Starten**
   - Finden Sie das App-Symbol auf Ihrem Startbildschirm
   - Tippen Sie darauf, um OneUptime im App-Modus zu öffnen

### Methode 3: Firefox

1. **OneUptime öffnen**
   - Starten Sie den Firefox-Browser
   - Navigieren Sie zu Ihrer OneUptime-URL
   - Warten Sie, bis die Seite vollständig geladen ist

2. **Installieren**
   - Tippen Sie auf das Drei-Punkte-Menü
   - Wählen Sie „Installieren" (falls verfügbar)
   - Oder wählen Sie „Zum Startbildschirm hinzufügen"
   - Bestätigen Sie die Installation

### Anpassungsoptionen

### App-Name
- Während der Installation können Sie den App-Namen anpassen
- Standard: „OneUptime"
- Empfohlen: Als „OneUptime" belassen oder Ihren Firmennamen hinzufügen

### Benachrichtigungseinstellungen
1. **Berechtigungen erteilen**
   - Erlauben Sie Benachrichtigungen, wenn Sie dazu aufgefordert werden
   - Gehen Sie zu Einstellungen → Apps → OneUptime → Benachrichtigungen
   - Aktivieren Sie alle Benachrichtigungskategorien für das beste Erlebnis

2. **Benachrichtigungen anpassen**
   - Konfigurieren Sie, welche Incidents Benachrichtigungen auslösen
   - Legen Sie Benachrichtigungsprioritätsstufen fest
   - Wählen Sie Ton- und Vibrationspräferenzen

## Fehlerbehebung

### Installationsprobleme

**„Zum Startbildschirm hinzufügen" erscheint nicht:**
```
1. Browser-Cache und -Cookies leeren
2. Sicherstellen, dass Sie HTTPS (sichere Verbindung) verwenden
3. 2-3 Minuten auf der Seite warten, bevor Sie nach der Aufforderung suchen
4. Prüfen, ob PWA-Anforderungen auf Ihrer OneUptime-Instanz erfüllt sind
```

**Installation schlägt fehl:**
```
1. Speicherplatz freigeben (mindestens 50 MB benötigt)
2. Browser auf die neueste Version aktualisieren
3. Browser neu starten und es erneut versuchen
4. Anderen Browser versuchen (Chrome empfohlen)
```

**App-Symbol erscheint nicht:**
```
1. Startbildschirm und App-Übersicht prüfen
2. Im Bereich „Zuletzt hinzugefügte Apps" suchen
3. In der App-Übersicht nach „OneUptime" suchen
4. Falls nötig, neu installieren
```

### Benachrichtigungsprobleme

**Keine Benachrichtigungen erhalten:**
```
1. Benachrichtigungsberechtigungen prüfen:
   - Einstellungen → Apps → OneUptime → Berechtigungen → Benachrichtigungen
2. Sicherstellen, dass Benachrichtigungen im OneUptime-Dashboard aktiviert sind
3. Einstellungen für „Nicht stören" prüfen
4. Sicherstellen, dass Akku-Optimierung OneUptime nicht blockiert
```

**Benachrichtigungen werden verzögert:**
```
1. Akku-Optimierung für OneUptime deaktivieren:
   - Einstellungen → Apps → OneUptime → Akku → Akkunutzung optimieren
2. Hintergrundaktivität erlauben
3. Datenspar-Einstellungen prüfen
```

## Deinstallation

### App entfernen
1. **Drücken und halten** Sie das OneUptime-Symbol auf dem Startbildschirm
2. Wählen Sie **„Deinstallieren"** oder ziehen Sie es in den Papierkorb
3. Entfernung bestätigen

### Alternative Methode
1. Gehen Sie zu **Einstellungen → Apps**
2. Finden Sie **„OneUptime"**
3. Tippen Sie auf **„Deinstallieren"**
4. Entfernung bestätigen

### Daten löschen
- Die Deinstallation entfernt alle gecachten Daten
- Ihre OneUptime-Kontodaten bleiben sicher auf dem Server
- Bei der Neuinstallation ist eine neue Anmeldung erforderlich

## Erweiterte Konfiguration

### Entwickleroptionen
Für fortgeschrittene Benutzer, die die PWA inspizieren möchten:
1. Entwickleroptionen in Android aktivieren
2. Computer mit ADB verbinden
3. Chrome DevTools für Remote-Debugging verwenden

### Netzwerkkonfiguration
- VPN konfigurieren, falls auf eine interne OneUptime-Instanz zugegriffen wird
- Proxy-Einstellungen konfigurieren, falls von Ihrer Organisation erforderlich
- Sicherstellen, dass die Firewall PWA-Ressourcen erlaubt

## Updates

OneUptime PWA aktualisiert sich automatisch:
- **Automatische Updates**: App aktualisiert sich, wenn Sie sie online besuchen
- **Keine manuellen Updates**: Im Gegensatz zu Store-Apps ist kein Benutzereingriff erforderlich
- **Sofortige Updates**: Neue Funktionen sind sofort verfügbar
- **Rollback-sicher**: Fehlerhafte Updates können schnell rückgängig gemacht werden

## Best Practices

### Für optimale Leistung
1. **Erster Start**: Immer online für die Ersteinrichtung
2. **Regelmäßige Nutzung**: App regelmäßig öffnen, um den Cache aktuell zu halten
3. **Speicherverwaltung**: Ausreichend freien Speicherplatz bereithalten
4. **Netzwerk**: WLAN für die Erstinstallation und größere Updates verwenden

### Sicherheitsempfehlungen
1. **Nur HTTPS**: Nur von sicheren OneUptime-Instanzen installieren
2. **Offizielle URLs**: Sicherstellen, dass Sie von der offiziellen OneUptime-URL Ihrer Organisation installieren
3. **Berechtigungen**: Nur notwendige Berechtigungen erteilen
4. **Updates**: Android-Betriebssystem und Browser aktuell halten
