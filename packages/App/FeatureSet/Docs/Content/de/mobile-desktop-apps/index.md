# Apps – Übersicht

OneUptime hat eine App für Ihr Telefon und eine für Ihren Computer. **OneUptime On-Call**, für iPhone, iPad und Android, alarmiert Sie, wenn Sie Bereitschaft haben, und Sie bestätigen und lösen Vorfälle, wo immer Sie sind. Unter Windows, macOS und Linux installieren Sie das OneUptime-Dashboard aus Ihrem Browser als Desktop-App mit einem eigenen Fenster. Beide funktionieren mit OneUptime Cloud und mit einem OneUptime, das Sie selbst betreiben.

:::cards
- [Eine App wählen](#eine-app-wählen): Wofür welche App da ist, nebeneinander.
- [Wie die Apps OneUptime erreichen](#wie-die-apps-oneuptime-erreichen): Welchen Weg Anmeldung und Bereitschaftsalarme nehmen.
- [Die mobile App holen](#die-mobile-app-holen): Aus dem App Store, von Google Play oder von GitHub.
- [Die Desktop-App holen](#die-desktop-app-holen): Das Dashboard aus Edge, Chrome oder Safari installieren.
:::

## Eine App wählen

|  | Mobile App | Desktop-App |
| --- | --- | --- |
| Was sie ist | OneUptime On-Call, eine native App für iPhone, iPad und Android | Das OneUptime-Dashboard, aus Ihrem Browser installiert |
| Woher Sie sie bekommen | Aus dem App Store, von Google Play oder als APK von GitHub | Von Ihrem eigenen OneUptime: Es gibt nichts herunterzuladen |
| Bereitschaftsalarme | Push-Benachrichtigungen, die den Stummmodus und „Nicht stören“ durchbrechen können | Browser-Benachrichtigungen, sobald Sie den Browser registrieren |
| Was Sie tun können | Vorfälle, Warnungen, Sicherheitsfälle, Monitore und wer Bereitschaft hat; bestätigen, lösen, Playbook-Schritte genehmigen und Notizen hinzufügen | Alles, was das Dashboard kann |
| Updates | Aus dem Store, oder indem Sie ein neueres APK installieren | Bei jedem Öffnen lädt sie das Dashboard von Ihrem OneUptime |
| Läuft auf | iOS 16.4 oder neuer, Android 7.0 oder neuer | Windows, macOS und Linux, mit Edge oder Chrome, oder Safari ab macOS Sonoma 14 |

Sie können beide nutzen: Lassen Sie die Desktop-App bei der Arbeit offen, und lassen Sie sich nachts vom Telefon wecken.

## Wie die Apps OneUptime erreichen

```mermaid title="Wie Bereitschaftsalarme Ihr Telefon und Ihren Computer erreichen"
flowchart TB
    OneUptime["Ihr OneUptime: Cloud<br/>oder selbst gehostet"]
    Expo["Expo-Push-Dienst,<br/>dann Apple oder Google"]
    WebPush["Der Push-Dienst<br/>Ihres Browsers"]
    Phone["OneUptime On-Call<br/>auf Ihrem Telefon"]
    Desktop["Die Desktop-App<br/>auf Ihrem Computer"]
    OneUptime -->|"an ein Telefon"| Expo
    OneUptime -->|"an einen registrierten<br/>Browser"| WebPush
    Expo -->|"Push-Benachrichtigung"| Phone
    WebPush -->|"Benachrichtigung"| Desktop
```

Die mobile App meldet sich bei Ihrem OneUptime an und registriert das Telefon in jedem Projekt, dem Sie angehören. Von da an schickt OneUptime die Push-Benachrichtigungen des Telefons, darunter die Bereitschaftsalarme, über den Push-Dienst von Expo, der sie Apple oder Google zur Zustellung übergibt. Ein selbst gehostetes OneUptime schickt sie standardmäßig über das Push-Relay von OneUptime und braucht deshalb kein eigenes Konto bei Apple, Google oder Expo: siehe [Push-Benachrichtigungen](/docs/self-hosted/push-notifications).

Die Desktop-App ist das Dashboard selbst, in einem eigenen Fenster. Sie zeigt Benachrichtigungen, sobald Sie ihren Browser für Push-Benachrichtigungen registrieren: Wie das geht, zeigen die Seiten zu Windows, macOS und Linux.

## Bevor Sie beginnen

- Ein Konto in einem OneUptime-Projekt. Damit Sie alarmiert werden, müssen Sie außerdem Bereitschaft haben: siehe [Eskalationsregeln](/docs/on-call/escalation-rules).
- Die Adresse Ihres OneUptime. Bei OneUptime Cloud ist es `https://oneuptime.com`; ein selbst gehostetes OneUptime hat seine eigene, etwa `https://oneuptime.example.com`.
- Ihr OneUptime über HTTPS. Die mobile App verbindet sich nicht über einfaches HTTP, und Browser zeigen Benachrichtigungen – und Edge und Chrome installieren Apps – nur für HTTPS-Seiten.

## Die mobile App holen

:::steps
### OneUptime On-Call installieren
Holen Sie die App auf einem iPhone oder iPad aus dem [App Store](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391), oder auf Android von [Google Play](https://play.google.com/store/apps/details?id=com.oneuptime.oncall). Für ein Android-Telefon ohne Google Play installieren Sie stattdessen das [APK](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk). Dieselben Links finden Sie im Dashboard unter **Projekteinstellungen → Benachrichtigungen → Mobile Apps**.

### Mit Ihrem OneUptime verbinden
Öffnen Sie die App, behalten Sie `https://oneuptime.com` für OneUptime Cloud oder geben Sie die Adresse Ihres eigenen OneUptime ein, und melden Sie sich mit Ihrem Passwort, einem Passkey oder Single Sign-On an.

### Benachrichtigungen erlauben
Erlauben Sie sie, wenn das Telefon fragt. Die App registriert das Telefon in jedem Ihrer Projekte, und Ihre Bereitschaftsalarme erreichen es von da an.
:::

Jeder Schritt im Detail, mit dem, was Sie danach prüfen: [Android-Installation](/docs/mobile-desktop-apps/android-installation) und [iOS-Installation](/docs/mobile-desktop-apps/ios-installation).

## Die Desktop-App holen

:::steps
### Ihr Dashboard öffnen
Melden Sie sich in Microsoft Edge oder Google Chrome bei Ihrem OneUptime an, oder auf einem Mac in Safari.

### Es installieren
Klicken Sie in Edge oder Chrome auf das Installationssymbol rechts in der Adressleiste. Wählen Sie in Safari **Ablage → Zum Dock hinzufügen**.

### Es wie jede andere App öffnen
Es öffnet sich in einem eigenen Fenster, aus dem Startmenü, dem Dock oder Ihrem App-Starter.
:::

Jeder Browser Schritt für Schritt: [Windows-Installation](/docs/mobile-desktop-apps/windows-installation), [macOS-Installation](/docs/mobile-desktop-apps/macos-installation) und [Linux-Installation](/docs/mobile-desktop-apps/linux-installation).

## Nächste Schritte

:::cards
- [Android-Installation](/docs/mobile-desktop-apps/android-installation): Die App auf Android installieren, sich anmelden und prüfen, dass Alarme ankommen.
- [iOS-Installation](/docs/mobile-desktop-apps/ios-installation): Die App auf einem iPhone oder iPad installieren und kritische Warnungen einschalten.
- [Windows-Installation](/docs/mobile-desktop-apps/windows-installation): Das Dashboard aus Edge oder Chrome installieren.
- [macOS-Installation](/docs/mobile-desktop-apps/macos-installation): Das Dashboard aus Safari, Chrome oder Edge zum Dock hinzufügen.
- [Linux-Installation](/docs/mobile-desktop-apps/linux-installation): Das Dashboard aus Chrome, Chromium oder Edge installieren.
- [FAQ & Fehlerbehebung](/docs/mobile-desktop-apps/faq-troubleshooting): Antworten, Lösungen und was zu tun ist, wenn ein Telefon keine Alarme mehr bekommt.
:::
