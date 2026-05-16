# Push-Benachrichtigungen

Native Push-Benachrichtigungen (iOS/Android) werden von **Expo Push** betrieben und erfordern **keine serverseitige Konfiguration** für selbst gehostete Instanzen.

## Funktionsweise

Die OneUptime Mobile-App registriert einen Expo Push-Token beim Backend. Wenn das Backend eine Benachrichtigung senden muss, sendet es einen POST-Request an die öffentliche Expo Push API, die die Nachricht im Namen der App an Apple APNs oder Google FCM weiterleitet.

Web-Push-Benachrichtigungen verwenden weiterhin VAPID-Schlüssel und das Web Push-Protokoll.

## Self-Hosted-Einrichtung

Es ist keine Push-Benachrichtigungskonfiguration erforderlich. Das Mobile-App-Binär handhabt die gesamte Plattformregistrierung automatisch über Expos Push-Infrastruktur.

## Fehlerbehebung

### Push-Benachrichtigungen kommen nicht an

- Stellen Sie sicher, dass die Mobile-App mit EAS Build erstellt wurde (Expo Go unterstützt keine Push-Benachrichtigungen)
- Überprüfen Sie, ob das Gerät in der Tabelle `UserPush` in Ihrer Datenbank registriert ist
- Prüfen Sie OneUptime-Server-Logs auf Expo Push API-Fehler
- Bestätigen Sie, dass das Gerät eine aktive Internetverbindung hat und Benachrichtigungsberechtigungen aktiviert sind

### „DeviceNotRegistered"-Fehler in den Logs

Der Expo Push-Token ist nicht mehr gültig. Dies bedeutet normalerweise, dass die App deinstalliert wurde oder der Benutzer Benachrichtigungsberechtigungen widerrufen hat. Der Token wird automatisch bereinigt.

## Support

Bei Problemen mit Push-Benachrichtigungen:

1. Prüfen Sie den Abschnitt zur Fehlerbehebung oben
2. Überprüfen Sie die OneUptime-Logs auf detaillierte Fehlermeldungen
3. Kontaktieren Sie uns unter [hello@oneuptime.com](mailto:hello@oneuptime.com)
