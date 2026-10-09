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
| OneUptime → Standard-Relay | `https://oneuptime.com/api/notification/push-relay/send`, `https://oneuptime.com/api/notification/push-relay/receipts` | HTTPS / TCP 443 | Mobile Push-Nachrichten ohne `EXPO_ACCESS_TOKEN`. |
| OneUptime → Expo | `https://exp.host/--/api/v2/push/send`, `https://exp.host/--/api/v2/push/getReceipts` | HTTPS / TCP 443 | Direkte mobile Zustellung mit `EXPO_ACCESS_TOKEN`. |
| OneUptime → Browser-Pushdienst | HTTPS-Endpunkt im Push-Abonnement des Browsers | HTTPS / normalerweise TCP 443 | Web-Push. |
| Mobile App oder Browser → OneUptime | Ihr OneUptime-Hostname | HTTPS / TCP 443 | Anmeldung, Geräteregistrierung und Öffnen von Benachrichtigungslinks. |

Wenn Sie `PUSH_NOTIFICATION_RELAY_URL` ändern, erlauben Sie dessen Hostnamen und konfigurierten Port. Ein eigenes Relay muss OneUptimes Relay-API implementieren. Standardwerte und Auswahl der Zustellungsart stehen in der [OneUptime-Konfiguration](https://github.com/OneUptime/oneuptime/blob/master/config.example.env) und im [Pushdienst](https://github.com/OneUptime/oneuptime/blob/master/packages/Common/Server/Services/PushNotificationService.ts); den direkten Endpunkt beschreibt [Expo](https://docs.expo.dev/push-notifications/sending-notifications/). Zustellbestätigungen liest OneUptime beim Relay unter derselben Adresse mit `/receipts` statt `/send`. Ein Relay ohne diese Route stellt Push-Nachrichten weiterhin zu; ein Gerät, dessen App entfernt wurde, fällt dann erst auf, wenn ein späterer Push an es abgelehnt wird.

Erlauben Sie für Web-Push die tatsächlichen Endpunkt-Hosts der verwendeten Browser. OneUptime akzeptiert `fcm.googleapis.com`, `android.googleapis.com`, `push.services.mozilla.com`, `notify.windows.com` und `push.apple.com` einschließlich Subdomains, etwa `updates.push.services.mozilla.com` und `web.push.apple.com`. Das [Browser-Abonnement](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription) bestimmt das Ziel. Nur Expo oder das Relay freizugeben reicht für Web-Push nicht aus.

Erlauben Sie DNS und ausgehendes TLS vom benachrichtigenden OneUptime-Prozess. Dessen Zertifikatsspeicher muss dem Zielzertifikat vertrauen; Proxys müssen API-Anfragen ohne interaktive Anmeldung durchlassen. Pushanbieter rufen keinen Webhook auf OneUptime auf. Der Server kann privat bleiben, wenn Geräte ihn per VPN oder einer anderen privaten Verbindung erreichen. Ohne Zugriff auf das Relay beziehungsweise externe Pushdienste ist keine Zustellung möglich.

Geräte benötigen eigenen Internetzugriff: iOS verwendet APNs, typischerweise TCP 5223 mit TCP 443 als Ausweichport; aktuelle Zielnetze nennt [Apple](https://support.apple.com/en-us/102266). Android benötigt FCM auf TCP 5228–5230 und 443; aktuelle Hosts und Firewall-Regeln nennt [Google](https://firebase.google.com/docs/cloud-messaging/network-configuration). Diese Geräteports müssen nicht eingehend auf OneUptime geöffnet werden. Der mobile Serverversand verwendet das Relay oder Expo, nicht direkt APNs/FCM.

Prüfen Sie DNS und HTTPS aus dem sendenden Container oder Pod zum Ziel der gewählten Zustellungsart. Senden Sie dann unter **User Settings > Notification Methods > Push** eine Testnachricht und bestätigen Sie den Empfang auf einem registrierten Gerät. Testen Sie Web-Push für jeden Browser separat. Prüfen Sie Relay-, Expo- oder Web-Push-Fehler in OneUptimes Protokollen; erfolgreiche API-Annahme allein bestätigt keine Geräte-Zustellung. Bei mobilen Push-Nachrichten liest OneUptime außerdem etwa 15 Minuten nach jedem Push die Zustellbestätigung von Expo: Ein Push, der das Gerät nie erreicht hat, erscheint dann im Push-Protokoll und, bei einer On-Call-Benachrichtigung, in der On-Call-Zeitleiste als nicht zugestellt.

## Fehlerbehebung

### Push-Benachrichtigungen kommen nicht an

- Stellen Sie sicher, dass die Mobile-App mit EAS Build erstellt wurde (Expo Go unterstützt keine Push-Benachrichtigungen)
- Überprüfen Sie, ob das Gerät in der Tabelle `UserPush` in Ihrer Datenbank registriert ist
- Prüfen Sie OneUptime-Server-Logs auf Expo Push API-Fehler
- Bestätigen Sie, dass das Gerät eine aktive Internetverbindung hat und Benachrichtigungsberechtigungen aktiviert sind
- Prüfen Sie **User Settings > Notification Methods > Push**: Ein als **Keine Benachrichtigungen** markiertes Gerät empfängt keine Benachrichtigungen mehr und muss erneut registriert werden (siehe unten)

### Als „nicht zugestellt" markierte Push-Nachrichten

Dass Expo einen Push annimmt, heißt nicht, dass er das Gerät erreicht hat: Apple oder Google können ihn noch ablehnen. OneUptime liest die Zustellbestätigung jeder mobilen Push-Nachricht etwa 15 Minuten nach dem Senden, über das Push-Relay, wenn `EXPO_ACCESS_TOKEN` nicht gesetzt ist. Meldet die Bestätigung einen Fehler, wechseln das Push-Protokoll und die On-Call-Zeitleiste der Benachrichtigung von gesendet zu **Push notification not delivered**, mit dem Fehlercode von Expo:

- `DeviceNotRegistered`: Die mobile App wurde vom Gerät entfernt, oder ihr Push-Token ist nicht mehr gültig. Siehe nächster Abschnitt.
- `MessageRateExceeded`: An das Gerät wurden in kurzer Zeit zu viele Benachrichtigungen gesendet. Spätere Push-Nachrichten an das Gerät werden wie gewohnt gesendet.
- `MessageTooBig`: Die Benachrichtigung war größer, als Pushdienste annehmen. OneUptime kürzt Benachrichtigungen passend, daher sollte das nicht vorkommen; melden Sie es bitte, falls doch.
- `InvalidCredentials` oder `MismatchSenderId`: Die Push-Zugangsdaten des Expo-Projekts, das den Push gesendet hat, sind ungültig. Prüfen Sie mit `EXPO_ACCESS_TOKEN` die Push-Zugangsdaten Ihres Expo-Projekts; wenden Sie sich beim Standard-Relay an den OneUptime-Support.

Lehnt Expo einen Push sofort ab, nennt das Push-Protokoll den Grund sofort. Über das Push-Relay funktioniert das ebenfalls: Das Relay gibt den Fehlercode von Expo weiter, statt mit einem Serverfehler zu antworten.

### „DeviceNotRegistered"-Fehler in den Logs

Expo meldet `DeviceNotRegistered`, wenn die mobile App vom Gerät entfernt wurde oder das Push-Token des Geräts nicht mehr gültig ist. Meist steht das in der Zustellbestätigung eines Pushs, die OneUptime etwa 15 Minuten nach dem Senden liest; manchmal lehnt Expo den Push auch sofort ab. In beiden Fällen sendet OneUptime nicht mehr an dieses Gerät. Es wird als nicht mehr empfangend markiert statt gelöscht, sodass seine Benachrichtigungsregeln erhalten bleiben, und das Push-Protokoll sowie die On-Call-Zeitleiste der nicht angekommenen Benachrichtigung nennen den Grund. **User Settings > Notification Methods > Push** zeigt es als **Keine Benachrichtigungen** an. Die anderen Geräte und Benachrichtigungsmethoden seines Besitzers werden weiterhin benachrichtigt.

Um das Gerät zurückzuholen, öffnen Sie darauf die mobile App, während Sie angemeldet sind. Die App registriert sich erneut, wodurch ihr Push-Token bei Expo erneuert wird, und das Gerät empfängt wieder Benachrichtigungen, mit seinen Regeln. Wurde die App entfernt, installieren Sie sie erneut und melden Sie sich an. Eine Bestätigung für einen Push, der gesendet wurde, bevor sich die App erneut registriert hat, markiert das Gerät nicht. Wird eine aktuelle mobile App auf einem neuen Telefon aus einer Sicherung des alten eingerichtet, teilt sie OneUptime ihr bisheriges Push-Token mit; empfängt das Gerät des alten Telefons keine Benachrichtigungen mehr, übernimmt das neue Telefon es mit seinen Regeln.

Über das Push-Relay (ohne `EXPO_ACCESS_TOKEN`) funktioniert das genauso: Das Relay meldet `DeviceNotRegistered`, wenn es einen Push sendet, und liest die Zustellbestätigungen, nach denen Ihre Instanz fragt.

## Support

Bei Problemen mit Push-Benachrichtigungen:

1. Prüfen Sie den Abschnitt zur Fehlerbehebung oben
2. Überprüfen Sie die OneUptime-Logs auf detaillierte Fehlermeldungen
3. Kontaktieren Sie uns unter [hello@oneuptime.com](mailto:hello@oneuptime.com)
