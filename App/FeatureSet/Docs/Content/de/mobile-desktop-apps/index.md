# OneUptime Mobile- und Desktop-Apps

OneUptime bietet zwei Möglichkeiten, die Plattform außerhalb Ihres Browsers zu nutzen:

- **Native Mobile-Apps** für iOS und Android, veröffentlicht im **Apple App Store** und auf **Google Play**. Diese liefern Bereitschaftsbenachrichtigungen, Vorfallswarnungen und Bestätigungsaktionen direkt auf Ihr Telefon.
- **Installierbare Desktop-Apps** für Windows, macOS und Linux, ausgeliefert als Progressive Web App (PWA), die direkt aus Ihrem Browser installiert wird. Diese geben dem OneUptime-Dashboard ein eigenes Fenster, ein eigenes Symbol und eine eigene Benachrichtigungsoberfläche auf Ihrem Computer.

## Mobile (Native Apps)

Die **OneUptime On-Call**-App ist eine native Anwendung, die mit React Native entwickelt wurde. Sie wird über die offiziellen Stores verteilt, sodass Sie automatische Updates, Push-Benachrichtigungen und biometrische Entsperrung erhalten.

- **iOS** — [Im App Store herunterladen](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391). Erfordert iOS 15.0 oder neuer. Siehe die [iOS-Installationsanleitung](./ios-installation.md).
- **Android** — [Bei Google Play erhalten](https://play.google.com/store/apps/details?id=com.oneuptime.oncall). Erfordert Android 8.0 oder neuer. Für Geräte ohne Google Play ist auch ein direkter [APK-Download](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk) verfügbar. Siehe die [Android-Installationsanleitung](./android-installation.md).

## Desktop (Progressive Web App)

Das Web-Dashboard von OneUptime ist eine Progressive Web App, sodass Sie es aus einem modernen Browser als Desktop-Anwendung installieren können, ohne einen Store nutzen zu müssen.

- [Windows-Installation](./windows-installation.md)
- [macOS-Installation](./macos-installation.md)
- [Linux-Installation](./linux-installation.md)

### Erste Schritte auf dem Desktop

1. Öffnen Sie Ihre OneUptime-Instanz in einem Chromium-basierten Browser (Chrome, Edge) oder in Safari.
2. Suchen Sie in der Adressleiste nach der Schaltfläche **Installieren** oder unter **Datei → Zum Dock hinzufügen / Apps → Diese Seite als App installieren**.
3. Starten Sie die installierte App über Ihr Startmenü, Launchpad oder Ihren Anwendungsstarter.

### Fehlerbehebung auf dem Desktop

**Installationsoption wird nicht angezeigt:**

- Stellen Sie sicher, dass Sie einen unterstützten Browser verwenden.
- Vergewissern Sie sich, dass Ihre OneUptime-Instanz über HTTPS bereitgestellt wird.
- Laden Sie die Seite neu oder leeren Sie den Browser-Cache.

**Push-Benachrichtigungen funktionieren nicht:**

- Erteilen Sie die Benachrichtigungsberechtigungen, wenn der Browser danach fragt.
- Überprüfen Sie die Benachrichtigungseinstellungen Ihres Betriebssystems für den Browser.
- Selbst gehostete Benutzer: Vergewissern Sie sich, dass Push-Benachrichtigungen auf Ihrer OneUptime-Instanz konfiguriert sind.

## Support

- Mobile-spezifische Probleme: Lesen Sie die Installationsanleitungen für [iOS](./ios-installation.md) oder [Android](./android-installation.md).
- Desktop-spezifische Probleme: Lesen Sie die Installationsanleitungen für [Windows](./windows-installation.md), [macOS](./macos-installation.md) oder [Linux](./linux-installation.md).
- Allgemeine Fragen: Siehe die Seite [FAQ und Fehlerbehebung](./faq-troubleshooting.md).
- Melden Sie Fehler oder reichen Sie Funktionswünsche in unserem [GitHub-Repository](https://github.com/OneUptime/oneuptime) ein.
