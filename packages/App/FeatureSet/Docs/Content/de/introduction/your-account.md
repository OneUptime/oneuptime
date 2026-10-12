# Ihr Konto

Über Ihr Konto kennt OneUptime Sie: die E-Mail-Adresse und das Passwort, mit denen Sie sich anmelden, Ihren Namen und Ihre Zeitzone und das, was Ihre Anmeldung schützt. Ein Konto kann zu vielen Projekten gehören, und diese Einstellungen begleiten Sie in jedes davon. Wie OneUptime Sie erreicht und wann es Sie alarmiert, legen Sie in jedem Projekt unter **Benutzereinstellungen** fest.

```mermaid title="Was zu Ihrem Konto gehört und was jedes Projekt für Sie speichert"
flowchart TB
    account["Ihr Konto:<br/>Anmeldung und Profil"] --> projectA["Projekt A"]
    account --> projectB["Projekt B"]
    projectA --> settingsA["Benutzereinstellungen in A:<br/>wie Sie alarmiert werden"]
    projectB --> settingsB["Benutzereinstellungen in B:<br/>wie Sie alarmiert werden"]
```

:::cards
- [Ihr Profil](#ihr-profil): Ihr Name, Ihre E-Mail-Adresse, Zeitzone und Ihr Bild.
- [Sicher anmelden](#sicher-anmelden): Ihr Passwort, Passkeys und die Zwei-Faktor-Authentifizierung.
- [Ihre Projekte](#ihre-projekte): Projekte wechseln, eines anlegen und Einladungen annehmen.
- [Benutzereinstellungen](#was-jedes-projekt-für-sie-speichert): Wie OneUptime Sie in jedem Projekt erreicht.
:::

## Das Benutzermenü

Klicken Sie oben rechts im Dashboard auf Ihr Bild.

| Eintrag | Was er tut |
| --- | --- |
| **Profil** | Öffnet **Benutzerprofil**: Ihren Namen, Ihre E-Mail-Adresse, Zeitzone, Ihr Bild und die Sicherheit Ihrer Anmeldung. |
| **Admin-Einstellungen** | Öffnet das Admin-Dashboard. Nur Master-Admins einer selbst gehosteten Installation sehen ihn. |
| **Dunkles Design** | Schaltet das Dashboard auf sein dunkles Design um. Im dunklen Design heißt der Eintrag **Helles Design**. |
| **Abmelden** | Meldet Sie ab. |

**Benutzerprofil** hat ein eigenes Seitenmenü. **Grundlegend** enthält **Übersicht** und **Profilbild**. **Sicherheit** und **Gefahrenzone** sind zugeklappt: Klicken Sie auf den Titel eines Abschnitts, um ihn zu öffnen.

## Ihr Profil

:::steps
### Ihr Profil öffnen

Klicken Sie oben rechts auf Ihr Bild und wählen Sie **Profil**. Die Seite **Übersicht** öffnet sich mit der Karte **Grundinformationen**: Ihrem Namen, Ihrer E-Mail-Adresse und Ihrer Zeitzone.

### Ihre Angaben bearbeiten

Klicken Sie auf **Benutzer bearbeiten** und ändern Sie, was Sie brauchen:

- **E-Mail**: die Adresse, mit der Sie sich anmelden. Wenn Sie sie ändern, bestätigen Sie die neue Adresse erneut.
- **Vollständiger Name**: der Name, den Ihr Team überall in OneUptime sieht.
- **Zeitzone**: die Zeitzone, in der das Dashboard Zeiten anzeigt und liest, und die für die Zeiten in Benachrichtigungen an Sie verwendet wird.

Klicken Sie auf **Änderungen speichern**.

### Ein Bild hinzufügen

Wählen Sie **Profilbild**, klicken Sie auf **Profilbild aktualisieren** und laden Sie ein Bild hoch. Es erscheint in Ihrem Benutzermenü und neben Ihrem Namen in Personenlisten.
:::

> [!NOTE]
> Wenn Sie sich zum ersten Mal in einem Browser anmelden, speichert OneUptime die Zeitzone dieses Browsers in Ihrem Profil. Melden Sie sich später dort an, wo der Browser eine andere Zeitzone hat, fragt das Dashboard, ob es die **Zeitzone aktualisieren** soll. Schließen Sie die Frage, und für diese Zeitzone fragt es nicht erneut.

## Sicher anmelden

Klappen Sie **Sicherheit** im Seitenmenü von **Benutzerprofil** auf. Der Abschnitt hat drei Seiten.

| Seite | Wofür sie da ist |
| --- | --- |
| **Passwortverwaltung** | Ein neues Passwort festlegen. |
| **Passkeys** | Ohne Passwort anmelden, mit Fingerabdruck, Gesicht, Bildschirmsperre oder einem Sicherheitsschlüssel. |
| **Zwei-Faktor-Authentifizierung** | Nach dem Passwort einen zweiten Schritt verlangen: einen Code aus einer App oder einen Sicherheitsschlüssel. |

### Ihr Passwort ändern

:::steps
1. Öffnen Sie **Sicherheit → Passwortverwaltung**.
2. Geben Sie das neue Passwort unter **Passwort** und erneut unter **Passwort bestätigen** ein. Es muss mindestens 6 Zeichen lang sein.
3. Klicken Sie auf **Passwort aktualisieren**.
:::

### Einen Passkey hinzufügen

:::steps
1. Öffnen Sie **Sicherheit → Passkeys** und klicken Sie auf **Passkey hinzufügen**.
2. Geben Sie ihm einen Namen, den Sie wiedererkennen, etwa Ihr Gerät oder Ihren Passwort-Manager, und klicken Sie auf **Passkey erstellen**.
3. Folgen Sie der Aufforderung Ihres Browsers, um den Passkey zu speichern.
:::

Wählen Sie beim nächsten Mal auf der Anmeldeseite **Mit einem Passkey anmelden**.

### Die Zwei-Faktor-Authentifizierung einschalten

Die Zwei-Faktor-Authentifizierung gilt, wenn Sie sich mit Ihrem Passwort anmelden. Fügen Sie zuerst einen zweiten Schritt hinzu, und schalten Sie sie dann ein.

:::steps
### Eine Authenticator-App hinzufügen

Öffnen Sie **Sicherheit → Zwei-Faktor-Authentifizierung**. Fügen Sie unter **Authenticator-Apps** eine App hinzu und geben Sie ihr einen Namen. Scannen Sie den QR-Code mit einer App wie 1Password, Google Authenticator oder Microsoft Authenticator, geben Sie den sechsstelligen Code ein, den sie zeigt, und klicken Sie auf **Verifizieren und abschließen**. Um stattdessen einen USB- oder NFC-Schlüssel zu nutzen, fügen Sie ihn unter **Sicherheitsschlüssel** hinzu.

### Ihre Backup-Codes sichern

Wenn Sie zum ersten Mal eine App, einen Schlüssel oder einen Passkey hinzufügen, zeigt OneUptime **Ihre Backup-Codes**. Jeder Code meldet Sie einmal an, falls Sie Ihre App oder Ihren Schlüssel verlieren. Kopieren oder laden Sie sie herunter, setzen Sie den Haken, dass Sie sie gesichert haben, und klicken Sie auf **Fertig**.

### Sie einschalten

Klicken Sie oben auf der Seite auf **Zwei-Faktor-Authentifizierung aktivieren** und bestätigen Sie. Die Karte zeigt nun **Aktiviert**. Ab Ihrer nächsten Anmeldung mit Passwort fragt OneUptime nach Ihrem zweiten Schritt.
:::

> [!TIP]
> Gehen Ihnen die Backup-Codes aus? **Codes neu erzeugen** auf derselben Seite gibt Ihnen einen neuen Satz, und die alten Codes funktionieren sofort nicht mehr.

## Ihre Projekte

Sie können zu beliebig vielen Projekten gehören. Die Projektauswahl oben links im Dashboard listet sie auf: Wählen Sie eines, um zu wechseln.

- **Ein Projekt anlegen**: Öffnen Sie die Projektauswahl und klicken Sie auf **Neues Projekt erstellen**. In einer selbst gehosteten Installation kann der Admin das Anlegen von Projekten auf Admins beschränken.
- **Eine Einladung annehmen**: Lädt Sie jemand ein, zeigt die Glocke oben rechts die offene Einladung und öffnet **Projekteinladungen**. Dort können Sie sie **Annehmen** oder **Ablehnen**.
- **Ein Projekt verlassen**: Bitten Sie jemanden, der die Benutzer des Projekts verwaltet, Sie mit **Aus Projekt entfernen** auf der Seite **Benutzer** zu entfernen.

## Was jedes Projekt für Sie speichert

**Benutzereinstellungen**, rechts in der Leiste unter der oberen Leiste, gehört nur Ihnen, und jedes Projekt hat seine eigenen. Öffnen Sie sie in jedem Projekt, in dem Sie Bereitschaft haben.

| Seite | Wofür sie da ist | Mehr dazu |
| --- | --- | --- |
| **Einrichtungs-Checkliste** | Führt Sie durch alles Weitere und zeigt, was noch zu tun ist. | |
| **Benachrichtigungsmethoden** | Die E-Mail-Adressen, Telefonnummern, Apps und Webhooks, über die OneUptime Sie erreichen kann. Ihre Anmelde-E-Mail wird für Sie hinzugefügt. | |
| **Bereitschaftsregeln** | Welche Methode genutzt wird, und nach wie langer Zeit, wenn eine Bereitschaftsrichtlinie Sie alarmiert. | [Eskalationsregeln](/docs/on-call/escalation-rules) |
| **Benachrichtigungseinstellungen** | Welche Neuigkeiten zu Vorfällen, Warnungen, Monitoren und mehr Sie erhalten, und auf welchem Kanal. | |
| **E-Mail-Einstellungen** | Wie viele E-Mails Sie erhalten: einzeln oder zusammengefasst. | [Benachrichtigungs-Zusammenfassung](/docs/emails/notification-rollup) |
| **Bereitschaftsprotokolle** | Jede Alarmierung an Sie und was aus ihr wurde. | |
| **Eingehende Telefonnummern** | Die Nummer, unter der eine Richtlinie für eingehende Anrufe Sie anruft. | [Richtlinie für eingehende Anrufe](/docs/on-call/incoming-call-policy) |
| **Kalender-Feed** | Ihre Bereitschaftsdienste in Google Calendar, Apple Calendar oder Outlook. | [Kalender-Feeds](/docs/on-call/calendar-feeds) |

## Sprache und Design

Beides wird in Ihrem Browser gespeichert, nicht in Ihrem Konto; stellen Sie es also in einem anderen Browser oder auf einem anderen Gerät erneut ein.

- **Sprache**: Das Dashboard startet in der Sprache Ihres Browsers. Um sie zu ändern, nutzen Sie das Sprachmenü unten auf jeder Seite. Diese Dokumentation hat oben ein eigenes Sprachmenü.
- **Design**: Wählen Sie **Dunkles Design** im Benutzermenü. Das Dashboard startet im hellen Design.

## Ihr Konto löschen

Öffnen Sie **Gefahrenzone → Konto löschen**. Sie können Ihr Konto erst löschen, wenn Sie in keinem Projekt mehr sind: Die Seite listet die Projekte auf, in denen Sie noch sind. Verlassen Sie sie zuerst, klicken Sie dann auf **Konto löschen** und bestätigen Sie. Das Löschen Ihres Kontos ist endgültig und lässt sich nicht rückgängig machen.

## Fehlerbehebung

:::details Ich habe die E-Mail zur Bestätigung meiner Adresse nicht erhalten
Wenn Sie sich erneut anmelden, wird ein neuer Link gesendet: Prüfen Sie auch Ihren Spam-Ordner. Können Sie sich nicht anmelden, nutzen Sie **Passwort vergessen?** auf der Anmeldeseite. Der Link zum Zurücksetzen bestätigt Ihre Adresse ebenfalls.
:::

:::details Ich habe meine Authenticator-App verloren
Wählen Sie beim zweiten Schritt der Anmeldung **Keinen Zugriff mehr auf Ihre Authenticator-App?** und geben Sie einen Ihrer Backup-Codes ein. Öffnen Sie dann **Sicherheit → Zwei-Faktor-Authentifizierung** und fügen Sie Ihre neue App hinzu. Ohne Backup-Codes bitten Sie einen Administrator Ihrer OneUptime-Installation, die Zwei-Faktor-Authentifizierung Ihres Kontos zurückzusetzen.
:::

:::details Die Zeiten im Dashboard weichen um eine Stunde ab
Das Dashboard zeigt Zeiten in der **Zeitzone** aus Ihrem Profil, nicht in der Ihres Computers. Prüfen Sie sie unter **Benutzerprofil → Übersicht**.
:::

## Nächste Schritte

:::cards
- [Startseite & Tastenkürzel](/docs/introduction/home): Sich im Dashboard zurechtfinden.
- [Eskalationsregeln](/docs/on-call/escalation-rules): Wie eine Bereitschaftsrichtlinie Sie alarmiert.
- [Benutzer, Teams & Berechtigungen](/docs/permissions/index): Was bestimmt, was Sie in einem Projekt tun dürfen.
- [SSO](/docs/identity/sso): Sich über den Identitätsanbieter Ihres Unternehmens anmelden.
:::
