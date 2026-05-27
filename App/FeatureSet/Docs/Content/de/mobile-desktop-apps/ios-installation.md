# iOS-Installationsanleitung

Installieren Sie die native iOS-App **OneUptime On-Call** aus dem Apple App Store auf Ihrem iPhone oder iPad.

## Voraussetzungen

- iPhone oder iPad mit **iOS 15.0 oder neuer**
- Ein aktives OneUptime-Konto (oder die URL Ihrer selbst gehosteten OneUptime-Instanz)
- Internetverbindung für die Anmeldung und den Empfang von Push-Benachrichtigungen

## Installation aus dem App Store

1. **Öffnen Sie den App Store** auf Ihrem iPhone oder iPad.
2. Tippen Sie auf den Tab **Suchen** und suchen Sie nach **„OneUptime On-Call"**, oder öffnen Sie diesen Link auf Ihrem Gerät:
   [https://apps.apple.com/us/app/oneuptime-on-call/id6759615391](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391)
3. Tippen Sie auf **Laden** und authentifizieren Sie sich anschließend mit Face ID, Touch ID oder Ihrem Apple-ID-Passwort.
4. Sobald die Installation abgeschlossen ist, tippen Sie auf **Öffnen** oder starten Sie **OneUptime On-Call** von Ihrem Home-Bildschirm aus.

## Erster Start und Anmeldung

1. **Server-URL**
   - Wenn Sie OneUptime Cloud verwenden, belassen Sie den Standardwert `https://oneuptime.com`.
   - Wenn Sie selbst hosten, geben Sie die URL Ihrer OneUptime-Instanz ein (z. B. `https://oneuptime.example.com`).
   - Die App überprüft, ob der Server erreichbar ist, bevor sie fortfährt.
2. **Anmelden**
   - Geben Sie die E-Mail-Adresse und das Passwort Ihres OneUptime-Kontos ein.
   - Optional können Sie **Face ID** oder **Touch ID** aktivieren, um spätere Starts schneller zu entsperren.
3. **Benachrichtigungen erlauben**
   - Wenn Sie dazu aufgefordert werden, tippen Sie auf **Erlauben**, damit die App Bereitschaftsbenachrichtigungen, Vorfallswarnungen und Bestätigungen zustellen kann.

## Push-Benachrichtigungen

Push-Benachrichtigungen werden über den Apple Push Notification service (APNs) via Expo Push zugestellt. So stellen Sie sicher, dass Sie Benachrichtigungen zuverlässig erreichen:

1. Gehen Sie zu **Einstellungen → Mitteilungen → OneUptime On-Call**.
2. Aktivieren Sie **Mitteilungen erlauben**, **Töne**, **Kennzeichen** sowie die Zustellung über **Sperrbildschirm / Banner / Mitteilungszentrale**.
3. Stellen Sie **Mitteilungsgruppierung** auf **Automatisch**.
4. Wenn Sie im Bereitschaftsdienst sind, deaktivieren Sie den **Stromsparmodus** während Ihrer Schicht und vermeiden Sie das Beenden der App per „Sofort beenden" — iOS kann die Hintergrundzustellung verzögern, wenn die App zwangsweise geschlossen wird.
5. Fügen Sie **OneUptime On-Call** allen **Fokus**-Modi hinzu, in denen Sie weiterhin Benachrichtigungen erhalten möchten.

## Updates

Die App wird über den App Store aktualisiert:

- Öffnen Sie den **App Store**, tippen Sie auf Ihr Profilbild, scrollen Sie zu **OneUptime On-Call** und tippen Sie auf **Aktualisieren**.
- Oder aktivieren Sie **Einstellungen → App Store → App-Updates**, um Updates automatisch zu installieren.

## Deinstallation

1. **Halten Sie das Symbol von OneUptime On-Call** auf Ihrem Home-Bildschirm gedrückt.
2. Tippen Sie auf **App entfernen → App löschen**.
3. Bestätigen Sie, indem Sie auf **Löschen** tippen.

Ihr OneUptime-Konto und Ihre Bereitschaftspläne werden serverseitig gespeichert und nicht entfernt, wenn Sie die App deinstallieren.

## Fehlerbehebung

**Der App Store sagt, dass die App „in Ihrer Region nicht verfügbar" ist:**
- Die App wird im globalen App Store veröffentlicht. Wenn sie in Ihrer Region nicht erscheint, wenden Sie sich an den [Support](mailto:support@oneuptime.com).

**„Netzwerkfehler" bei der Anmeldung:**
- Überprüfen Sie, ob die **Server-URL** korrekt und von Ihrem Gerät aus erreichbar ist.
- Wenn Sie sich in einem Unternehmensnetzwerk oder über ein VPN verbinden, stellen Sie sicher, dass die OneUptime-Instanz erreichbar ist.
- Vergewissern Sie sich, dass der Server über HTTPS mit einem gültigen Zertifikat bereitgestellt wird.

**Keine Push-Benachrichtigungen erhalten:**
- Öffnen Sie **Einstellungen → Mitteilungen → OneUptime On-Call** und vergewissern Sie sich, dass Mitteilungen erlaubt sind.
- Deaktivieren Sie **Nicht stören** oder fügen Sie OneUptime On-Call zur Erlaubnisliste Ihres aktiven Fokus-Modus hinzu.
- Melden Sie sich ab und wieder an, um das beim Server registrierte Push-Token zu aktualisieren.
- Selbst gehostete Benutzer: Vergewissern Sie sich, dass Push-Benachrichtigungen auf Ihrer OneUptime-Instanz konfiguriert sind (siehe die Anleitung [Push Notifications](/docs/self-hosted/push-notifications) für selbst gehostete Instanzen).

**Face ID / Touch ID funktioniert nicht:**
- Stellen Sie sicher, dass Biometrie unter **Einstellungen → Face ID & Code** oder **Einstellungen → Touch ID & Code** eingerichtet ist.
- Aktivieren Sie die biometrische Entsperrung erneut im **Einstellungen**-Bildschirm innerhalb der OneUptime On-Call-App.

**Die App stürzt beim Start ab:**
- Aktualisieren Sie auf die neueste Version aus dem App Store.
- Starten Sie Ihr Gerät neu.
- Wenn das Problem weiterhin besteht, löschen Sie die App und installieren Sie sie erneut, und melden Sie sich dann wieder an.

## Support

Wenn Sie weiterhin Hilfe benötigen, wenden Sie sich über Ihr OneUptime-Dashboard an uns oder eröffnen Sie ein Issue in unserem [GitHub-Repository](https://github.com/OneUptime/oneuptime).
