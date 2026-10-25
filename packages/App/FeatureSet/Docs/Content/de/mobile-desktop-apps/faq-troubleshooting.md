# FAQ & Fehlerbehebung

Antworten auf häufige Fragen zu den mobilen und Desktop-Apps von OneUptime, und Lösungen für das, was am häufigsten schiefgeht: die Anmeldung, Benachrichtigungen, die nicht ankommen, und ein Telefon, das sich neu registrieren muss.

:::cards
- [Fragen zur mobilen App](#fragen-zur-mobilen-app): Geräte, Projekte, Selbsthosting und Sicherheit.
- [Fragen zur Desktop-App](#fragen-zur-desktop-app): Was die Desktop-App ist, und was sie nicht kann.
- [Wenn sich ein Telefon neu registrieren muss](#wenn-sich-ein-telefon-neu-registrieren-muss): Warum ein Telefon keine Alarme mehr bekommt, und wie es zurückkommt.
- [Fehlerbehebung](#fehlerbehebung): Probleme mit Anmeldung, Benachrichtigungen und Installation.
:::

## Fragen zur mobilen App

:::details Ist die App kostenlos?
Ja. OneUptime On-Call ist kostenlos im App Store, bei Google Play und als APK auf GitHub. Sie melden sich mit Ihrem OneUptime-Konto an.
:::

:::details Auf welchen Telefonen und Tablets läuft sie?
Auf iPhones und iPads mit iOS bzw. iPadOS 16.4 oder neuer, und auf Android-Telefonen und -Tablets mit Android 7.0 oder neuer.
:::

:::details Funktioniert sie mit einem selbst gehosteten OneUptime?
Ja. Geben Sie beim Start der App die `https://`-Adresse Ihres OneUptime ein, oder tippen Sie auf dem Anmeldebildschirm auf **Change Server**. Standardmäßig schickt Ihr Server Alarme über das Push-Relay von OneUptime an Telefone und braucht deshalb kein Konto bei Apple, Google oder Expo: siehe [Push-Benachrichtigungen](/docs/self-hosted/push-notifications).
:::

:::details Kann ich sie mit mehreren Projekten nutzen?
Ja. Die App registriert das Telefon in jedem Projekt, dem Sie angehören, sodass jedes Projekt Sie alarmieren kann. Sie zeigt jeweils ein Projekt: Tippen Sie oben auf einem Bildschirm auf den Namen des Projekts, um zu wechseln.
:::

:::details Kann ich mich auf mehr als einem Telefon anmelden?
Ja. Jedes Telefon und jedes Tablet ist ein eigenes Push-Gerät, mit eigenen Bereitschaftsregeln und einer eigenen Einstellung für kritische Warnungen.
:::

:::details Was kann ich in der App tun?
- **Home**: was im Projekt Aufmerksamkeit braucht: aktive Vorfälle und Warnungen, offene Sicherheitsfälle, wenn Ihre Rolle Ihnen Zugriff darauf gibt, Monitore mit Problemen und gruppierte Ereignisse.
- **Monitors**: alle Monitore, nach Zustand gefiltert, mit ihren Details.
- **Inbox**: Vorfälle und Warnungen, und die Episoden, die sie gruppieren. Öffnen Sie einen Eintrag, um **Acknowledge**, **Resolve** oder **Add Note** zu wählen. Gibt Ihre Rolle Ihnen Zugriff auf die Sicherheitsfälle des Projekts, listet **Security** die offenen: Öffnen Sie einen, um einen Playbook-Schritt, der auf Genehmigung wartet, mit **Approve** oder **Reject** zu entscheiden, den Fall mit **Assign to me** zu übernehmen oder **Close case** zu wählen.
- **On-Call**: ob Sie Bereitschaft haben und bis wann, wer sonst, die Alarme, die an Sie gingen, und **Cover for me**, das Ihre Alarme für eine Weile an eine Kollegin oder einen Kollegen übergibt.
- **Settings**: Ihre Projekte und Single Sign-On, das Aussehen, kritische Warnungen und der Alarmton, **Biometrics Login**, Ihr Bereitschafts-Kalenderfeed und **Log Out**.

Alles andere finden Sie im Dashboard.
:::

:::details Kann ich einen Alarm direkt in der Benachrichtigung bestätigen?
Nein. Tippen Sie auf die Benachrichtigung: Die App öffnet den Vorfall, die Warnung, die Episode oder den Sicherheitsfall, um den es geht, im richtigen Projekt, und dort bestätigen Sie. Ist die App gesperrt oder sind Sie abgemeldet, öffnet sie den Alarm, sobald Sie drin sind.
:::

:::details Ist meine Anmeldung auf dem Telefon sicher?
Die App spricht mit Ihrem OneUptime nur über HTTPS. Ihre Anmeldung liegt im eigenen Speicher der App auf dem Telefon, und **Log Out** löscht sie und meldet die Sitzung auch auf dem Server ab. Schalten Sie **Biometrics Login** ein, damit die App bei jedem Start nach Gesicht, Fingerabdruck oder Code fragt.
:::

:::details Funktioniert die App offline?
Nein. Ohne Verbindung zeigt sie oben auf dem Bildschirm **No internet connection** und macht weiter, sobald die Verbindung zurück ist.
:::

## Fragen zur Desktop-App

:::details Was ist die Desktop-App?
Das OneUptime-Dashboard, aus Ihrem Browser als App installiert: ein eigenes Fenster, ein Symbol im Startmenü, im Dock oder in Ihrem App-Starter, und Benachrichtigungen. Sie kann alles, was das Dashboard kann, weil sie das Dashboard ist.
:::

:::details Warum ist sie in keinem App Store?
Das braucht sie nicht. Die App lädt das Dashboard bei jedem Öffnen von Ihrem OneUptime, sie ist also immer die Version, die Ihr OneUptime ausführt, unter Windows, macOS und Linux gleichermaßen, ohne dass Sie etwas aktualisieren müssen.
:::

:::details Kann sie mich wecken wie das Telefon?
Nein. Browser können „Nicht stören“ oder einen Fokus nicht übergehen, eine Desktop-Benachrichtigung ist also nur so laut, wie der Computer es zulässt. Für Alarme, die Sie wecken müssen, nutzen Sie die mobile App mit kritischen Warnungen.
:::

:::details Funktioniert sie offline?
Nein. Sie braucht eine Verbindung zu Ihrem OneUptime, wie das Dashboard in einem Browser-Tab.
:::

## Wenn sich ein Telefon neu registrieren muss

OneUptime schickt die Alarme eines Telefons über Expo, das sie Apple oder Google übergibt. Meldet Expo, dass das Telefon nicht mehr erreichbar ist, schickt OneUptime ihm nichts mehr, bis die App es neu registriert.

```mermaid title="Wie ein Telefon keine Alarme mehr bekommt, und wie es zurückkommt"
flowchart TB
    Registered["Das Telefon ist registriert,<br/>und Alarme erreichen es"]
    Gone["Expo meldet es als<br/>weg: Ein Push wird<br/>abgelehnt, oder seine<br/>Quittung sagt es etwa<br/>15 Minuten später"]
    Marked["OneUptime markiert<br/>es mit Keine<br/>Benachrichtigungen<br/>und sendet nicht mehr;<br/>seine Regeln bleiben"]
    Open["Sie öffnen die App,<br/>während Sie<br/>angemeldet sind"]
    Renewed["Die App registriert<br/>sich neu, erneuert ihr<br/>Push-Token, und Alarme<br/>erreichen es wieder"]
    Registered --> Gone --> Marked --> Open --> Renewed
```

Expo meldet ein Telefon als weg, wenn die App davon entfernt wurde oder sein Push-Token nicht mehr gilt. Das Telefon wird nicht gelöscht: **Benutzereinstellungen → Benachrichtigungsmethoden** zeigt es auf dem Tab **Push Notifications** als **Keine Benachrichtigungen**, und die Bereitschafts-Zeitleiste eines Alarms, der es nicht erreicht hat, sagt, warum. Ihre anderen Telefone und Benachrichtigungsmethoden werden wie gewohnt alarmiert.

Die App registriert das Telefon bei jedem Start, wenn Sie sich anmelden, und wenn Sie zu ihr zurückkehren, höchstens alle fünf Minuten einmal. Beim Registrieren fragt sie Expo erneut nach dem Push-Token, was es erneuert, und das Telefon bekommt wieder Alarme, mit den Regeln, die es hatte.

| Was passiert ist | Was zu tun ist | Was OneUptime tut |
| --- | --- | --- |
| Die App ist noch installiert | Öffnen Sie sie, während Sie angemeldet sind | Das Telefon bekommt wieder Benachrichtigungen, mit seinen Regeln |
| Sie haben die App auf einem iPhone oder iPad neu installiert | Installieren Sie sie und melden Sie sich an | Meist kommt derselbe Eintrag zurück, mit seinen Regeln |
| Sie haben die App auf Android neu installiert | Installieren Sie sie, melden Sie sich an und löschen Sie den alten Eintrag | Ein neuer Eintrag mit den Standardregeln; der alte bleibt markiert |
| Ein neues Telefon, aus einem Backup des alten eingerichtet | Öffnen Sie die App auf dem neuen Telefon | Ist der Eintrag des alten Telefons markiert, übernimmt ihn das neue, mit seinen Regeln; sonst bekommt das neue Telefon einen eigenen Eintrag |
| Ein neues Telefon, neu eingerichtet | Melden Sie sich an und löschen Sie den alten Eintrag | Ein neuer Eintrag mit den Standardregeln |
| Sie haben sich in der App abgemeldet | Melden Sie sich wieder an | Das Abmelden hat das Telefon und seine Regeln entfernt; es kommt mit den Standardregeln zurück |

Auch ein Browser kann aufhören, Benachrichtigungen zu bekommen, wenn sein Push-Abonnement abläuft. Das Dashboard erneuert es, wenn es kann; bleibt der Browser markiert, registrieren Sie ihn in diesem Browser mit **Gerät registrieren** neu.

## Fehlerbehebung

### Anmelden

:::details „Could not connect to the server“
Die App konnte `https://<your-oneuptime>/api/status` nicht erreichen. Prüfen Sie die Adresse, einschließlich `https://`: Die App verbindet sich nicht über einfaches HTTP. Liegt Ihr OneUptime in einem privaten Netz, verbinden Sie das Telefon zuerst damit, zum Beispiel über Ihr VPN. Öffnen Sie diese Adresse im Browser des Telefons, zeigt sie `{"status":"ok"}`, wenn das Telefon OneUptime erreicht.
:::

:::details „No SSO configuration found for the email“
Keines der Projekte, denen diese E-Mail-Adresse angehört, hat Single Sign-On eingerichtet, oder die Adresse hat kein Konto auf diesem OneUptime. Prüfen Sie die E-Mail-Adresse, oder melden Sie sich mit Ihrem Passwort an. Anbieter, die Ihr Administrator für die ganze Installation eingerichtet hat, stehen vor dem E-Mail-Feld.
:::

:::details Ein Sicherheitsschlüssel ist Ihr einziger zweiter Faktor
Die App kann keinen Sicherheitsschlüssel verwenden. Melden Sie sich mit einem Ihrer Backup-Codes an, oder fügen Sie Ihrem Konto im Dashboard eine Authenticator-App hinzu: siehe [Die Zwei-Faktor-Authentifizierung einschalten](/docs/introduction/your-account#die-zwei-faktor-authentifizierung-einschalten).
:::

:::details Die Anmeldung mit Passkey schlägt fehl
Passkeys brauchen eine Adresse Ihres OneUptime, die mit `https://` beginnt, und einen Passkey, den Sie für dieses OneUptime hinzugefügt haben: siehe [Einen Passkey hinzufügen](/docs/introduction/your-account#einen-passkey-hinzufügen). Um einen anderen Server zu nutzen, tippen Sie auf dem Anmeldebildschirm auf **Change Server**.
:::

### Benachrichtigungen

:::details Keine Benachrichtigungen auf dem Telefon
- Prüfen Sie, dass das Telefon Benachrichtigungen von OneUptime On-Call erlaubt und dass „Nicht stören“ oder ein Fokus sie nicht zurückhält.
- Prüfen Sie unter **Benutzereinstellungen → Benachrichtigungsmethoden** auf dem Tab **Push Notifications**, dass das Telefon aufgeführt ist, und senden Sie ihm eine **Testbenachrichtigung**.
- Ist es mit **Keine Benachrichtigungen** markiert, öffnen Sie die App, während Sie angemeldet sind: siehe [Wenn sich ein Telefon neu registrieren muss](#wenn-sich-ein-telefon-neu-registrieren-muss).
- Prüfen Sie Ihre Bereitschaftsregeln unter **Benutzereinstellungen → Bereitschaftsregeln**: Sie entscheiden, welche Alarme welche Methode erreichen.
- Prüfen Sie bei einem selbst gehosteten OneUptime, dass der Server sein Push-Relay erreicht: siehe [Push-Benachrichtigungen](/docs/self-hosted/push-notifications#netzwerkzugriff).
:::

:::details Alarme kommen auf Android verspätet an
Stellen Sie die Akkunutzung der App in den Android-Einstellungen für OneUptime On-Call auf **Nicht eingeschränkt**, und nehmen Sie die App von jeder Energiesparliste aus: siehe [Verhindern, dass Alarme verspätet ankommen](/docs/mobile-desktop-apps/android-installation#verhindern-dass-alarme-verspätet-ankommen).
:::

:::details Kritische Warnungen durchbrechen den Stummmodus nicht
Öffnen Sie in der App **Settings**: Die Zeile unter **Critical On-Call Alerts** sagt, was auf diesem Telefon fehlt. Prüfen Sie dann unter **Benutzereinstellungen → Bereitschaftsregeln**, dass die Bereitschaftsregel, die den Alarm geschickt hat, auf **Kritische Warnung** steht, nicht auf **Normal**. Jedes Telefon hat seinen eigenen Schalter.
:::

### Desktop-App

:::details Kein Installationssymbol in der Adressleiste
Installieren Sie von einer Dashboard-Seite aus, nach der Anmeldung, über `https://`, in Edge oder Chrome, oder in Safari ab macOS Sonoma 14. Erscheint das Symbol nicht, installiert auch das Menü des Browsers die App: siehe [Windows-Installation](/docs/mobile-desktop-apps/windows-installation#die-app-installieren).
:::

:::details Keine Desktop-Benachrichtigungen
Registrieren Sie den Browser unter **Benutzereinstellungen → Benachrichtigungsmethoden** auf dem Tab **Push Notifications** mit **Gerät registrieren**, erlauben Sie Benachrichtigungen, wenn danach gefragt wird, und prüfen Sie die Benachrichtigungseinstellungen des Computers selbst. Ein selbst gehostetes OneUptime braucht seine VAPID-Schlüssel für Browser-Benachrichtigungen.
:::

## Hilfe bekommen

Passt hier etwas nicht zu dem, was Sie sehen, [eröffnen Sie ein Issue auf GitHub](https://github.com/OneUptime/oneuptime/issues), mit der Version Ihrer App, unten auf ihrem Bildschirm **Settings**, und der Plattform, die Sie nutzen.

## Nächste Schritte

:::cards
- [Apps – Übersicht](/docs/mobile-desktop-apps/index): Welche App Sie nutzen, und wie die Apps OneUptime erreichen.
- [Android-Installation](/docs/mobile-desktop-apps/android-installation): Die App auf Android installieren und einrichten.
- [iOS-Installation](/docs/mobile-desktop-apps/ios-installation): Die App auf einem iPhone oder iPad installieren und einrichten.
- [Push-Benachrichtigungen](/docs/self-hosted/push-notifications): Wie ein selbst gehostetes OneUptime Alarme schickt, und die Fehler von Expo.
:::
