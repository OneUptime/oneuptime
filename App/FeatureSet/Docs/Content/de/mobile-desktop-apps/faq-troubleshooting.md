# FAQ und Fehlerbehebung

Häufig gestellte Fragen und Lösungen für die mobilen und Desktop-Apps von OneUptime.

## Wie verteilt OneUptime seine Apps?

- **Mobile (iOS und Android):** OneUptime stellt eine native App namens **OneUptime On-Call** bereit. Sie wird im [Apple App Store](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391) und auf [Google Play](https://play.google.com/store/apps/details?id=com.oneuptime.oncall) veröffentlicht. Ein signierter [APK-Download](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk) ist zudem für Android-Geräte ohne Google Play verfügbar.
- **Desktop (Windows, macOS, Linux):** Das OneUptime-Web-Dashboard ist eine Progressive Web App (PWA). Sie können es direkt aus einem Chromium-basierten Browser oder aus Safari als Desktop-Anwendung installieren — ohne dass ein Store-Konto erforderlich ist.

## FAQ zur mobilen App

### Welche Geräte werden unterstützt?

- **iOS:** iPhone oder iPad mit iOS 15.0 oder neuer.
- **Android:** Telefone und Tablets mit Android 8.0 (Oreo) oder neuer.

### Ist die App kostenlos?

Ja. Die OneUptime On-Call-App kann kostenlos installiert werden. Sie melden sich mit Ihrem bestehenden OneUptime-Konto an.

### Kann ich die App mit einer selbst gehosteten OneUptime-Instanz verwenden?

Ja. Beim ersten Start fragt die App nach einer **Server-URL**. Geben Sie die URL Ihrer selbst gehosteten Instanz ein (zum Beispiel `https://oneuptime.example.com`). Die App überprüft, ob der Server erreichbar ist, bevor sie Ihnen die Anmeldung erlaubt.

Für Push-Benachrichtigungen auf selbst gehosteten Instanzen folgen Sie der Anleitung [Push Notifications](/docs/self-hosted/push-notifications).

### Wie werden Updates bereitgestellt?

- **iOS:** Über den App Store. Aktivieren Sie automatische Updates unter **Einstellungen → App Store**, oder aktualisieren Sie manuell über Ihr App-Store-Profil.
- **Android (Google Play):** Automatische Updates sind standardmäßig aktiviert.
- **Android (APK-Sideloading):** Laden Sie die neueste APK über den obigen GitHub-Releases-Link herunter und installieren Sie sie.

### Warum erhalte ich keine Push-Benachrichtigungen?

Mobile Pushes verwenden APNs (iOS) und FCM (Android) via Expo Push. Überprüfen Sie Folgendes:

1. Benachrichtigungen sind auf Betriebssystemebene für **OneUptime On-Call** aktiviert.
2. Die Akkuoptimierung ist deaktiviert und Hintergrundaktivität ist zugelassen (Android).
3. „Nicht stören" oder Fokus-Modi sind ausgeschaltet, oder die App steht auf der Ausnahmeliste.
4. Sie sind angemeldet — das Push-Token wird erst nach der Anmeldung beim Server registriert.
5. **Nur selbst gehostet:** Push-Benachrichtigungen sind auf Ihrer OneUptime-Instanz konfiguriert. Siehe die Anleitung [Push Notifications](/docs/self-hosted/push-notifications).

### Sind die Daten auf meinem Telefon sicher?

- Der gesamte API-Verkehr verwendet HTTPS.
- Zugriffs- und Aktualisierungstoken werden im sicheren Schlüsselspeicher des Geräts abgelegt (Keychain auf iOS, Keystore auf Android).
- Sie können die Entsperrung über Face ID / Touch ID / Fingerabdruck im **Einstellungen**-Bildschirm innerhalb der App erzwingen.

### Kann ich die App auf mehreren Geräten installieren?

Ja. Melden Sie sich mit demselben OneUptime-Konto auf so vielen Geräten an, wie Sie benötigen. Jedes Gerät erhält seine eigenen Push-Benachrichtigungen.

### Wie deinstalliere ich die App?

- **iOS:** Symbol gedrückt halten → **App entfernen** → **App löschen**.
- **Android:** Symbol gedrückt halten → **Deinstallieren**, oder **Einstellungen → Apps → OneUptime On-Call → Deinstallieren**.

Ihr OneUptime-Konto und Ihre Daten werden auf dem Server gespeichert und nicht entfernt, wenn Sie die App deinstallieren.

## FAQ zur Desktop-App (PWA)

### Was ist eine Progressive Web App (PWA)?

Eine Progressive Web App ist eine Webanwendung, die wie eine native Desktop-App installiert werden kann. Nach der Installation läuft sie in einem eigenen Fenster, hat ein eigenes Symbol in Ihrem Launcher und kann Desktop-Benachrichtigungen zustellen — ohne den Umweg über den Windows Store, den Mac App Store oder einen anderen Vertriebskanal.

### Warum verwendet die Desktop-App PWA-Technologie?

- **Sofortige Updates** — die App bleibt mit Ihrer OneUptime-Instanz synchron, sobald Sie ein Deployment durchführen.
- **Kein Store-Konto erforderlich** — Installation direkt aus jedem modernen Browser.
- **Eine Codebasis** — dasselbe Dashboard läuft unter Windows, macOS und Linux.

### Warum erscheint die Schaltfläche „Installieren" nicht?

1. Verwenden Sie einen Chromium-basierten Browser (Chrome, Edge, Brave, Arc) oder Safari (macOS Sonoma oder neuer).
2. Vergewissern Sie sich, dass Ihre OneUptime-Instanz über HTTPS mit einem gültigen Zertifikat bereitgestellt wird.
3. Leeren Sie den Browser-Cache und laden Sie die Seite neu.
4. Die App ist möglicherweise bereits installiert — sehen Sie unter Programme / Startmenü nach.

### Wie aktualisiere ich die Desktop-App?

Die PWA wird automatisch aktualisiert, sobald Sie sie online öffnen. Um ein Update zu erzwingen, aktualisieren Sie das Fenster mit **Strg+R** (Windows/Linux) oder **Cmd+R** (macOS).

### Wie deinstalliere ich die Desktop-PWA?

- **Windows:** **Einstellungen → Apps → OneUptime → Deinstallieren**, oder klicken Sie mit der rechten Maustaste auf den Eintrag im Startmenü.
- **macOS:** Ziehen Sie die App aus dem Ordner **Programme** in den Papierkorb, oder klicken Sie mit der rechten Maustaste auf das Dock-Symbol und wählen Sie **Entfernen**.
- **Linux:** Verwenden Sie die Deinstallationsoption Ihres Anwendungsstarters oder entfernen Sie die entsprechende `.desktop`-Datei.

## Fehlerbehebung

### Probleme mit der mobilen App

**App lässt sich nicht anmelden / „Netzwerkfehler":**
- Vergewissern Sie sich, dass die **Server-URL** korrekt und von Ihrem Telefon aus erreichbar ist.
- Prüfen Sie, ob Ihr Telefon mit dem Internet verbunden ist.
- Bei selbst gehosteten Instanzen hinter einem VPN stellen Sie sicher, dass das VPN aktiv ist.

**Push-Benachrichtigungen verzögert oder fehlend (Android):**
- Deaktivieren Sie die Akkuoptimierung: **Einstellungen → Apps → OneUptime On-Call → Akku → Unbeschränkt**.
- Deaktivieren Sie den Datensparmodus für die App.
- Schalten Sie auf Samsung-Geräten unter **Gerätewartung → Akku → Begrenzungen für Hintergrundaktivität** die Begrenzung für OneUptime On-Call aus.

**Push-Benachrichtigungen verzögert oder fehlend (iOS):**
- Vermeiden Sie es, die App per „Sofort beenden" zu beenden — iOS kann die Hintergrundzustellung pausieren.
- Deaktivieren Sie den Stromsparmodus, während Sie im Bereitschaftsdienst sind.
- Fügen Sie OneUptime On-Call zur Erlaubnisliste eines aktiven Fokus-Modus hinzu.

**Face ID / Touch ID / Fingerabdruck funktioniert nicht:**
- Stellen Sie sicher, dass Biometrie in den Einstellungen Ihres Betriebssystems eingerichtet ist.
- Aktivieren Sie die biometrische Entsperrung erneut im **Einstellungen**-Bildschirm innerhalb der OneUptime On-Call-App.

### Probleme mit der Desktop-App (PWA)

**Schaltfläche „Installieren" fehlt:**
- Verwenden Sie einen unterstützten Browser (Chromium-basiert oder Safari auf macOS Sonoma oder neuer).
- Stellen Sie sicher, dass die OneUptime-Instanz über HTTPS bereitgestellt wird.
- Warten Sie, bis die Seite vollständig geladen ist, und prüfen Sie dann die Adressleiste auf das Installationssymbol.

**Desktop-Benachrichtigungen erscheinen nicht:**
- Erlauben Sie Benachrichtigungen, wenn der Browser danach fragt.
- Überprüfen Sie die Benachrichtigungseinstellungen Ihres Betriebssystems (Windows Benachrichtigungsassistent, macOS Mitteilungen, Linux Benachrichtigungs-Daemon).
- Stellen Sie bei selbst gehosteten Instanzen sicher, dass die Konfiguration für [Push Notifications](/docs/self-hosted/push-notifications) vollständig ist.

**App zeigt nicht die neuesten Daten an:**
- Aktualisieren Sie mit **Strg+R** / **Cmd+R**.
- Schließen Sie das Fenster und öffnen Sie es erneut.
- Überprüfen Sie Ihre Netzwerkverbindung.

## Support

Wenn Sie weiterhin Hilfe benötigen:

- Mobile: Lesen Sie die Installationsanleitungen für [iOS](./ios-installation.md) oder [Android](./android-installation.md).
- Desktop: Lesen Sie die Installationsanleitungen für [Windows](./windows-installation.md), [macOS](./macos-installation.md) oder [Linux](./linux-installation.md).
- Eröffnen Sie ein Issue im [OneUptime-GitHub-Repository](https://github.com/OneUptime/oneuptime).
- Kontaktieren Sie den Support über Ihr OneUptime-Dashboard.
