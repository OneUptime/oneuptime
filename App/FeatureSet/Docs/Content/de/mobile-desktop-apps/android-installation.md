# Android-Installationsanleitung

Installieren Sie die native Android-App **OneUptime On-Call** aus dem Google Play Store, oder installieren Sie die APK direkt auf Geräten ohne Google Play per Sideloading.

## Voraussetzungen

- Android-Telefon oder -Tablet mit **Android 8.0 (Oreo) oder neuer**
- Ein aktives OneUptime-Konto (oder die URL Ihrer selbst gehosteten OneUptime-Instanz)
- Internetverbindung für die Anmeldung und den Empfang von Push-Benachrichtigungen

## Option 1: Installation aus Google Play (empfohlen)

1. Öffnen Sie den **Google Play Store** auf Ihrem Gerät.
2. Suchen Sie nach **„OneUptime On-Call"**, oder öffnen Sie diesen Link auf Ihrem Gerät:
   [https://play.google.com/store/apps/details?id=com.oneuptime.oncall](https://play.google.com/store/apps/details?id=com.oneuptime.oncall)
3. Tippen Sie auf **Installieren**.
4. Sobald die Installation abgeschlossen ist, tippen Sie auf **Öffnen** oder starten Sie **OneUptime On-Call** über Ihre App-Übersicht.

## Option 2: APK direkt installieren

Für Geräte ohne Google Play (zum Beispiel GrapheneOS, /e/OS oder Huawei-Geräte) installieren Sie die offizielle APK aus den GitHub-Releases:

1. Öffnen Sie auf Ihrem Android-Gerät diesen Link:
   [https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk)
2. Wenn Sie dazu aufgefordert werden, erlauben Sie Ihrem Browser, unbekannte Apps zu installieren:
   **Einstellungen → Apps → \[Ihr Browser\] → Unbekannte Apps installieren → Aus dieser Quelle zulassen**.
3. Öffnen Sie die heruntergeladene APK und tippen Sie auf **Installieren**.
4. Starten Sie **OneUptime On-Call** über Ihre App-Übersicht.

Die APK wird von OneUptime aus derselben Quelle wie die Play-Store-Veröffentlichung erstellt und signiert. App-Updates erfolgen beim Sideloading nicht automatisch — laden Sie die neueste APK über den obigen Link herunter, wenn eine neue Version veröffentlicht wird.

## Erster Start und Anmeldung

1. **Server-URL**
   - Wenn Sie OneUptime Cloud verwenden, belassen Sie den Standardwert `https://oneuptime.com`.
   - Wenn Sie selbst hosten, geben Sie die URL Ihrer OneUptime-Instanz ein (z. B. `https://oneuptime.example.com`).
   - Die App überprüft, ob der Server erreichbar ist, bevor sie fortfährt.
2. **Anmelden**
   - Geben Sie die E-Mail-Adresse und das Passwort Ihres OneUptime-Kontos ein.
   - Optional können Sie die **biometrische Entsperrung** (Fingerabdruck) aktivieren, um spätere Starts schneller zu entsperren.
3. **Benachrichtigungen erlauben**
   - Wenn Sie dazu aufgefordert werden, tippen Sie auf **Erlauben**, damit die App Bereitschaftsbenachrichtigungen, Vorfallswarnungen und Bestätigungen zustellen kann.

## Push-Benachrichtigungen

Push-Benachrichtigungen werden über Firebase Cloud Messaging (FCM) via Expo Push zugestellt. So stellen Sie sicher, dass Sie während des Bereitschaftsdienstes zuverlässig erreicht werden:

1. Öffnen Sie **Einstellungen → Apps → OneUptime On-Call → Benachrichtigungen** und bestätigen Sie, dass alle Kategorien aktiviert sind.
2. Öffnen Sie **Einstellungen → Apps → OneUptime On-Call → Akku** und wählen Sie **Unbeschränkt** (oder deaktivieren Sie die Akkuoptimierung), damit das Betriebssystem Hintergrund-Pushes nicht verzögert.
3. Erlauben Sie der App, im Hintergrund zu laufen, und deaktivieren Sie alle „Datensparmodus"-Einschränkungen für sie.
4. Wenn Sie Samsung-Geräte verwenden, schalten Sie zusätzlich **Einstellungen → Gerätewartung → Akku → Begrenzungen für Hintergrundaktivität** für OneUptime On-Call aus.
5. Fügen Sie OneUptime On-Call zu allen Ausnahmelisten für **Do Not Disturb** (Nicht stören) hinzu, damit Benachrichtigungen während Ihrer Bereitschaftsschicht weiterhin klingeln.

## Updates

**Google Play:**
- Updates werden automatisch installiert. Um ein Update manuell auszulösen, öffnen Sie **Play Store → Profil → Apps und Gerät verwalten → Verfügbare Updates → OneUptime On-Call → Aktualisieren**.

**APK-Sideloading:**
- Laden Sie die neueste APK über den obigen GitHub-Releases-Link erneut herunter und installieren Sie sie über die bestehende App — Ihre Daten, Server-URL und Anmeldung bleiben erhalten.

## Deinstallation

1. **Halten Sie das Symbol von OneUptime On-Call** gedrückt und tippen Sie dann auf **Deinstallieren**.
2. Oder öffnen Sie **Einstellungen → Apps → OneUptime On-Call → Deinstallieren**.
3. Bestätigen Sie, um die App zu entfernen.

Ihr OneUptime-Konto und Ihre Bereitschaftspläne werden serverseitig gespeichert und nicht entfernt, wenn Sie die App deinstallieren.

## Fehlerbehebung

**„Netzwerkfehler" bei der Anmeldung:**
- Überprüfen Sie, ob die **Server-URL** korrekt und von Ihrem Gerät aus erreichbar ist.
- Wenn Sie sich in einem Unternehmensnetzwerk oder über ein VPN verbinden, stellen Sie sicher, dass die OneUptime-Instanz erreichbar ist.
- Vergewissern Sie sich, dass der Server über HTTPS mit einem gültigen Zertifikat bereitgestellt wird.

**Keine Push-Benachrichtigungen erhalten:**
- Vergewissern Sie sich, dass Benachrichtigungen unter **Einstellungen → Apps → OneUptime On-Call → Benachrichtigungen** aktiviert sind.
- Deaktivieren Sie die Akkuoptimierung für OneUptime On-Call (siehe Push-Benachrichtigungen oben).
- Stellen Sie sicher, dass Do Not Disturb (Nicht stören) ausgeschaltet ist oder dass OneUptime On-Call auf der Ausnahmeliste steht.
- Melden Sie sich ab und wieder an, um das beim Server registrierte Push-Token zu aktualisieren.
- Selbst gehostete Benutzer: Vergewissern Sie sich, dass Push-Benachrichtigungen auf Ihrer OneUptime-Instanz konfiguriert sind (siehe die Anleitung [Push Notifications](/docs/self-hosted/push-notifications) für selbst gehostete Instanzen).

**Biometrische Entsperrung funktioniert nicht:**
- Registrieren Sie einen Fingerabdruck unter **Einstellungen → Sicherheit → Fingerabdruck**.
- Aktivieren Sie die biometrische Entsperrung erneut im **Einstellungen**-Bildschirm innerhalb der OneUptime On-Call-App.

**APK-Installation blockiert:**
- Sie müssen dem Browser die Berechtigung erteilen, unbekannte Apps zu installieren (siehe Option 2 oben).
- Einige Mobilfunkanbieter oder Geräteprofile in Unternehmen blockieren das Sideloading vollständig; verwenden Sie in diesem Fall stattdessen die Google-Play-Version.

**Die App stürzt beim Start ab:**
- Aktualisieren Sie auf die neueste Version aus Google Play oder die neueste APK.
- Starten Sie Ihr Gerät neu.
- Wenn das Problem weiterhin besteht, deinstallieren Sie die App, installieren Sie sie erneut und melden Sie sich dann wieder an.

## Support

Wenn Sie weiterhin Hilfe benötigen, wenden Sie sich über Ihr OneUptime-Dashboard an uns oder eröffnen Sie ein Issue in unserem [GitHub-Repository](https://github.com/OneUptime/oneuptime).
