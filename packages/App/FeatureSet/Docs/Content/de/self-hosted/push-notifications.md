# Push-Benachrichtigungen

Native Push-Benachrichtigungen (iOS/Android) verwenden **Expo Push**. Selbst gehostete Instanzen nutzen standardmäßig OneUptimes Push-Relay und benötigen ausgehenden Netzwerkzugriff darauf.

## Funktionsweise

Die mobile OneUptime-App registriert einen Expo Push Token beim Backend. Das Backend sendet über OneUptimes Push-Relay oder direkt an Expo, wenn `EXPO_ACCESS_TOKEN` gesetzt ist. Expo leitet die Nachrichten zur Zustellung an Apple APNs oder Google FCM weiter.

Web-Push-Benachrichtigungen verwenden weiterhin VAPID-Schlüssel und das Web Push-Protokoll.

## Self-Hosted-Einrichtung

Für die offizielle mobile App mit dem Standard-Relay sind keine Expo-Zugangsdaten auf dem Server nötig. Für direkte Zustellung setzen Sie `EXPO_ACCESS_TOKEN` mit Zugangsdaten des Expo-Projekts Ihrer App. Web-Push benötigt `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` und `VAPID_SUBJECT`.

## Netzwerkzugriff

| Richtung | Ziel | Protokoll / Port | Erforderlich für |
| --- | --- | --- | --- |
| OneUptime → Standard-Relay | `https://oneuptime.com/api/notification/push-relay/send` | HTTPS / TCP 443 | Mobile Push-Nachrichten ohne `EXPO_ACCESS_TOKEN`. |
| OneUptime → Expo | `https://exp.host/--/api/v2/push/send` | HTTPS / TCP 443 | Direkte mobile Zustellung mit `EXPO_ACCESS_TOKEN`. |
| OneUptime → Browser-Pushdienst | HTTPS-Endpunkt im Push-Abonnement des Browsers | HTTPS / normalerweise TCP 443 | Web-Push. |
| Mobile App oder Browser → OneUptime | Ihr OneUptime-Hostname | HTTPS / TCP 443 | Anmeldung, Geräteregistrierung und Öffnen von Benachrichtigungslinks. |

Wenn Sie `PUSH_NOTIFICATION_RELAY_URL` ändern, erlauben Sie dessen Hostnamen und konfigurierten Port. Ein eigenes Relay muss OneUptimes Relay-API implementieren. Standardwerte und Auswahl der Zustellungsart stehen in der [OneUptime-Konfiguration](https://github.com/OneUptime/oneuptime/blob/master/config.example.env) und im [Pushdienst](https://github.com/OneUptime/oneuptime/blob/master/Common/Server/Services/PushNotificationService.ts); den direkten Endpunkt beschreibt [Expo](https://docs.expo.dev/push-notifications/sending-notifications/).

Erlauben Sie für Web-Push die tatsächlichen Endpunkt-Hosts der verwendeten Browser. OneUptime akzeptiert `fcm.googleapis.com`, `android.googleapis.com`, `push.services.mozilla.com`, `notify.windows.com` und `push.apple.com` einschließlich Subdomains, etwa `updates.push.services.mozilla.com` und `web.push.apple.com`. Das [Browser-Abonnement](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription) bestimmt das Ziel. Nur Expo oder das Relay freizugeben reicht für Web-Push nicht aus.

Erlauben Sie DNS und ausgehendes TLS vom benachrichtigenden OneUptime-Prozess. Dessen Zertifikatsspeicher muss dem Zielzertifikat vertrauen; Proxys müssen API-Anfragen ohne interaktive Anmeldung durchlassen. Pushanbieter rufen keinen Webhook auf OneUptime auf. Der Server kann privat bleiben, wenn Geräte ihn per VPN oder einer anderen privaten Verbindung erreichen. Ohne Zugriff auf das Relay beziehungsweise externe Pushdienste ist keine Zustellung möglich.

Geräte benötigen eigenen Internetzugriff: iOS verwendet APNs, typischerweise TCP 5223 mit TCP 443 als Ausweichport; aktuelle Zielnetze nennt [Apple](https://support.apple.com/en-us/102266). Android benötigt FCM auf TCP 5228–5230 und 443; aktuelle Hosts und Firewall-Regeln nennt [Google](https://firebase.google.com/docs/cloud-messaging/network-configuration). Diese Geräteports müssen nicht eingehend auf OneUptime geöffnet werden. Der mobile Serverversand verwendet das Relay oder Expo, nicht direkt APNs/FCM.

Prüfen Sie DNS und HTTPS aus dem sendenden Container oder Pod zum Ziel der gewählten Zustellungsart. Senden Sie dann unter **User Settings > Notification Methods > Push** eine Testnachricht und bestätigen Sie den Empfang auf einem registrierten Gerät. Testen Sie Web-Push für jeden Browser separat. Prüfen Sie Relay-, Expo- oder Web-Push-Fehler in OneUptimes Protokollen; erfolgreiche API-Annahme allein bestätigt keine Geräte-Zustellung.

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
