# Eingehende Anrufrichtlinie (Twilio-Integration)

Eingehende Anrufrichtlinien ermöglichen externen Anrufern, Ihre Bereitschaftsingenieure zu erreichen, indem sie eine dedizierte Telefonnummer wählen. Wenn jemand anruft, leitet OneUptime den Anruf durch Ihre konfigurierten Eskalationsregeln weiter, bis ein Ingenieur antwortet.

## Voraussetzungen

- Ein Twilio-Konto — Erstellen Sie eines unter [https://www.twilio.com](https://www.twilio.com)
- Ihre Twilio Account-SID und Auth-Token
- Zugriff auf Ihre selbst gehostete OneUptime-Instanz

## Übersicht

Die Funktion Eingehende Anrufrichtlinie funktioniert so:

1. Eingehende Anrufe auf einer Twilio-Telefonnummer empfangen
2. Eine anpassbare Begrüßungsnachricht abspielen
3. Den Anruf durch Eskalationsregeln weiterleiten (Teams, Zeitpläne oder Benutzer)
4. Den Anrufer mit dem ersten verfügbaren Bereitschaftsingenieur verbinden
5. Zur nächsten Regel eskalieren, wenn niemand antwortet

Da Sie OneUptime selbst hosten, müssen Sie Ihr eigenes Twilio-Konto konfigurieren. Dies gibt Ihnen volle Kontrolle über Ihre Telefonnummern und Abrechnung.

## Schritt 1: Twilio-Konto erstellen

1. Gehen Sie zu [https://www.twilio.com](https://www.twilio.com) und registrieren Sie sich
2. Schließen Sie den Verifizierungsprozess ab
3. Notieren Sie Ihre **Account-SID** und Ihr **Auth-Token** aus dem Twilio-Console-Dashboard

## Schritt 2: Anruf-/SMS-Konfiguration in OneUptime einrichten

1. Melden Sie sich bei Ihrem OneUptime-Dashboard an
2. Gehen Sie zu **Projekteinstellungen** > **Anruf & SMS** > **Benutzerdefinierte Anruf-/SMS-Konfiguration**
3. Klicken Sie auf **Benutzerdefinierte Anruf-/SMS-Konfiguration erstellen**
4. Füllen Sie die folgenden Felder aus:
   - **Name**: Ein verständlicher Name (z. B. "Production Twilio Config")
   - **Beschreibung**: Optionale Beschreibung
   - **Twilio Account-SID**: Ihre Twilio Account-SID (beginnt mit `AC`)
   - **Twilio Auth-Token**: Ihr Twilio Auth-Token
   - **Twilio Primäre Telefonnummer**: Eine Telefonnummer aus Ihrem Twilio-Konto für ausgehende Anrufe
5. Klicken Sie auf **Speichern**

## Schritt 3: Eingehende Anrufrichtlinie erstellen

1. Gehen Sie zu **Bereitschaft** > **Eingehende Anrufrichtlinien**
2. Klicken Sie auf **Eingehende Anrufrichtlinie erstellen**
3. Füllen Sie die folgenden Felder aus:
   - **Name**: Ein verständlicher Name (z. B. "Support-Hotline")
   - **Beschreibung**: Optionale Beschreibung
4. Klicken Sie auf **Speichern**

## Schritt 4: Twilio-Konfiguration mit der Richtlinie verknüpfen

1. Öffnen Sie Ihre neu erstellte Eingehende Anrufrichtlinie
2. Klicken Sie in der Karte **Telefonnummern-Routing** auf **Twilio-Konfiguration auswählen**
3. Wählen Sie die in Schritt 2 erstellte Konfiguration

## Schritt 5: Telefonnummer konfigurieren

Sie haben zwei Optionen:

### Option A: Vorhandene Twilio-Telefonnummer verwenden

1. Klicken Sie auf **Vorhandene Nummer verwenden**
2. OneUptime ruft alle Telefonnummern aus Ihrem Twilio-Konto ab
3. Wählen Sie die gewünschte Telefonnummer
4. Klicken Sie auf **Diese verwenden**

### Option B: Neue Telefonnummer kaufen

1. Klicken Sie auf **Neue Nummer kaufen**
2. Wählen Sie ein **Land** aus der Dropdown-Liste
3. Geben Sie optional eine **Vorwahl** ein
4. Klicken Sie auf **Suchen**, um verfügbare Nummern zu finden
5. Wählen Sie eine Telefonnummer aus den Ergebnissen
6. Klicken Sie auf **Kaufen**

## Schritt 6: Eskalationsregeln konfigurieren

Eskalationsregeln bestimmen, wie Anrufe weitergeleitet werden:

1. Öffnen Sie Ihre Eingehende Anrufrichtlinie
2. Gehen Sie zum Tab **Eskalationsregeln**
3. Klicken Sie auf **Eskalationsregel hinzufügen**
4. Konfigurieren Sie die Regel:
   - **Reihenfolge**: Die Prioritätsreihenfolge (niedrigere Zahlen werden zuerst versucht)
   - **Eskalieren nach (Sekunden)**: Wartezeit vor der Eskalation
   - **Bereitschaftsplan**: Einen Plan auswählen, um den gerade Bereitschafthabenden zu erreichen
   - **Teams**: Bestimmte Teams auswählen
   - **Benutzer**: Bestimmte Benutzer auswählen

## Schritt 7: Sprachnachrichten konfigurieren (optional)

Passen Sie die Nachrichten an, die Anrufer hören:

1. Öffnen Sie Ihre Eingehende Anrufrichtlinie
2. Gehen Sie zu **Einstellungen**
3. Konfigurieren Sie:
   - **Begrüßungsnachricht**: Wird bei der Annahme des Anrufs abgespielt
   - **Keine-Antwort-Nachricht**: Wird abgespielt, wenn alle Eskalationsregeln fehlschlagen
   - **Niemand-verfügbar-Nachricht**: Wird abgespielt, wenn niemand in Bereitschaft ist

## Anrufprotokolle anzeigen

1. Gehen Sie zu **Bereitschaft** > **Eingehende Anrufrichtlinien**
2. Klicken Sie auf Ihre Richtlinie
3. Gehen Sie zum Tab **Anrufprotokolle**

## Fehlerbehebung

### Anrufe werden nicht empfangen

- Überprüfen Sie, ob die Twilio-Konfiguration korrekt mit der Richtlinie verknüpft ist
- Stellen Sie sicher, dass Ihre OneUptime-Instanz vom Internet erreichbar ist
- Überprüfen Sie die Twilio Account-SID und das Auth-Token

### Anrufe verbinden sich nicht mit Ingenieuren

- Überprüfen Sie, ob Benutzer verifizierte Telefonnummern in ihren Benachrichtigungseinstellungen haben
- Prüfen Sie, ob Eskalationsregeln korrekt konfiguriert sind
- Stellen Sie sicher, dass Bereitschaftspläne für den aktuellen Zeitraum Benutzer zugewiesen haben

## Support

Bei Problemen:

1. Überprüfen Sie die Twilio-Konsole auf Fehlerprotokolle
2. Überprüfen Sie die OneUptime-Server-Logs
3. Kontaktieren Sie den Support unter [hello@oneuptime.com](mailto:hello@oneuptime.com)
