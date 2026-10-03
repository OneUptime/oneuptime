# SSO (Single Sign-On)

OneUptime unterstützt SAML 2.0-basiertes Single Sign-On (SSO) für die Enterprise-Authentifizierung. SSO ermöglicht Ihren Teammitgliedern, sich bei OneUptime mit den Anmeldedaten Ihrer Organisation anzumelden und bietet zentralisiertes Zugriffsmanagement und erhöhte Sicherheit.

> **Edition:** SSO, einschließlich „Require SSO for login“, ist Teil jeder OneUptime-Edition: Selbst gehostete Installationen erhalten es in der Community Edition, ohne dass eine Lizenz nötig ist. In OneUptime Cloud ist es ab dem **Scale**-Plan verfügbar. Unter [Enterprise Edition](/docs/self-hosted/enterprise) sehen Sie, was jede Edition enthält.

## Übersicht

Die SSO-Integration bietet folgende Vorteile:

- **Zentralisierte Authentifizierung**: Benutzer melden sich mit ihren vorhandenen Unternehmensanmeldedaten an
- **Erhöhte Sicherheit**: Multi-Faktor-Authentifizierung und Sicherheitsrichtlinien Ihres IdP nutzen
- **Vereinfachte Benutzerverwaltung**: Zugriff aus Ihrem vorhandenen Identitätsverwaltungssystem verwalten
- **Reduzierte Passwortmüdigkeit**: Benutzer müssen sich kein separates OneUptime-Passwort merken

## SSO einrichten

1. **Zu Projekteinstellungen navigieren**

   - Gehen Sie zu Ihrem OneUptime-Projekt
   - Navigieren Sie zu **Projekteinstellungen** > **Sicherheit** > **SSO**

2. **SSO-Konfiguration erstellen**

   - Klicken Sie auf **SSO erstellen**
   - Geben Sie einen **Namen** für die SSO-Konfiguration ein (z. B. "Keycloak SAML" oder "Okta SAML")
   - Geben Sie die **Anmelde-URL** von Ihrem Identity Provider ein
   - Geben Sie den **Aussteller** (Entity ID) von Ihrem Identity Provider ein
   - Fügen Sie das **Öffentliche Zertifikat** von Ihrem Identity Provider ein
   - Im Schritt **Anmeldung** beginnt **Teams** mit dem Mitglieder-Team Ihres Projekts: Personen, die sich zum ersten Mal anmelden, treten diesen Teams bei
   - Alles andere wird unter **Erweitert** ausgefüllt: die **Signaturmethode** (`RSA-SHA256`), die **Digest-Methode** (`SHA256`) und eine Beschreibung („Sign in with“ und der Name). Ändern Sie sie nur, wenn Ihr Identity Provider es erfordert

3. **OneUptime SSO-Metadaten abrufen**
   - Nach dem Speichern öffnet sich der Dialog **SSO-Konfiguration**. Über die Schaltfläche **SSO-Konfiguration anzeigen** können Sie ihn erneut öffnen
   - Kopieren Sie den **Bezeichner (Entity ID)** — dieser wird in Ihrer IdP-Konfiguration benötigt
   - Kopieren Sie die **Antwort-URL (Assertion Consumer Service URL)** — diese wird in Ihrer IdP-Konfiguration benötigt
   - Ein neuer Anbieter ist zunächst deaktiviert. Sobald Ihr IdP diese beiden Werte kennt, bearbeiten Sie den Anbieter und schalten Sie **Aktiviert** ein

## Keycloak SAML-Konfiguration

Keycloak ist eine beliebte Open-Source-Identitäts- und Zugriffsmanagementlösung.

### Schritt 1: OneUptime SSO konfigurieren

1. Melden Sie sich bei Ihrem OneUptime-Dashboard an
2. Navigieren Sie zu **Projekteinstellungen** > **Sicherheit** > **SSO**
3. Klicken Sie auf **SSO erstellen** und füllen Sie Folgendes aus:
   - **Name**: Ein beschreibender Name (z. B. `my-project-oneuptime`)
   - **Anmelde-URL**: `https://<your-keycloak-domain>/auth/realms/<your-realm>/protocol/saml`
   - **Aussteller**: `https://<your-keycloak-domain>/auth/realms/<your-realm>`
   - **Zertifikat**: Siehe Schritt 2 unten
   - **Signaturmethode** und **Digest-Methode**: bereits unter **Erweitert** gesetzt (`RSA-SHA256` und `SHA256`)
4. Konfiguration speichern

### Schritt 4: Keycloak-Client-Einstellungen konfigurieren

1. **Signing keys config** deaktivieren (unter dem Tab „Schlüssel")
2. **Name-ID-Format** auf `email` setzen
3. Stellen Sie sicher, dass die Option **Name-ID-Format erzwingen** aktiviert ist

### Fehlerbehebung Keycloak

- **Anmeldung schlägt mit Signaturenfehler fehl**: Sicherstellen, dass das Zertifikat korrekt kopiert ist, einschließlich der `BEGIN CERTIFICATE`- und `END CERTIFICATE`-Zeilen
- **Name-ID-Fehler**: Überprüfen, ob **Name-ID-Format** in Keycloak auf `email` gesetzt ist

---

## Microsoft Entra ID (ehemals Azure AD) SAML-Konfiguration

Microsoft Entra ID ist Microsofts cloudbasierter Identitäts- und Zugriffsmanagementdienst.

### Schritt 3: SAML SSO in Entra ID konfigurieren

1. Gehen Sie in Ihrer neuen Unternehmensanwendung zu **Single Sign-On**
2. Wählen Sie **SAML** als Single-Sign-On-Methode
3. In **Grundlegende SAML-Konfiguration** klicken Sie auf **Bearbeiten** und setzen Sie:
   - **Bezeichner (Entity ID)**: Den **Bezeichner (Entity ID)** aus der OneUptime **SSO-Konfiguration anzeigen** einfügen
   - **Antwort-URL (Assertion Consumer Service URL)**: Die **Antwort-URL** aus der OneUptime **SSO-Konfiguration anzeigen** einfügen
4. Klicken Sie auf **Speichern**

### Fehlerbehebung Microsoft Entra ID

- **AADSTS700016-Fehler**: Der Bezeichner (Entity ID) in Entra ID stimmt nicht mit OneUptime überein
- **Zertifikatsfehler**: Stellen Sie sicher, dass Sie das **Base64**-Zertifikat heruntergeladen haben
- **Benutzer nicht zugewiesen**: Benutzer müssen der Unternehmensanwendung explizit zugewiesen sein

---

## Okta SAML-Konfiguration

Okta ist eine weit verbreitete Identitätsplattform mit robusten SAML SSO-Fähigkeiten.

### Schritt 2: SAML-Anwendung in Okta erstellen

1. Melden Sie sich bei Ihrer Okta Admin Console an
2. Navigieren Sie zu **Anwendungen** > **Anwendungen**
3. Klicken Sie auf **App-Integration erstellen**
4. Wählen Sie **SAML 2.0** und klicken Sie auf **Weiter**
5. Geben Sie "OneUptime" als **App-Name** ein und klicken Sie auf **Weiter**
6. Im Abschnitt **SAML-Einstellungen** konfigurieren Sie:
   - **Single Sign-On URL**: Die **Antwort-URL (Assertion Consumer Service URL)** aus der OneUptime **SSO-Konfiguration anzeigen** einfügen
   - **Audience URI (SP Entity ID)**: Den **Bezeichner (Entity ID)** aus der OneUptime **SSO-Konfiguration anzeigen** einfügen
   - **Name-ID-Format**: `EmailAddress` auswählen
   - **Anwendungsbenutzername**: `Email` auswählen

### Fehlerbehebung Okta

- **404 oder ungültige SSO-URL**: Sicherstellen, dass die **Single Sign-On URL** in Okta exakt mit der **Antwort-URL** aus OneUptime übereinstimmt
- **Audience Mismatch**: Sicherstellen, dass die **Audience URI** in Okta exakt mit dem **Bezeichner (Entity ID)** aus OneUptime übereinstimmt
- **Benutzer nicht zugewiesen**: Benutzer müssen der Okta-Anwendung zugewiesen sein

---

## Andere Identity Provider

OneUptime's SSO-Implementierung verwendet das SAML 2.0-Protokoll und sollte mit jedem kompatiblen Identity Provider funktionieren. Die allgemeinen Konfigurationsschritte sind:

1. In OneUptime eine SSO-Konfiguration erstellen und den **Bezeichner (Entity ID)** und die **Antwort-URL** notieren
2. In Ihrem Identity Provider eine SAML-Anwendung erstellen mit:
   - **Assertion Consumer Service URL / Antwort-URL**: Aus der OneUptime SSO-Konfiguration
   - **Entity ID / Audience URI**: Aus der OneUptime SSO-Konfiguration
   - **Name-ID-Format**: E-Mail-Adresse
3. Von Ihrem Identity Provider folgendes in OneUptime einfügen:
   - **Anmelde-URL** (SSO-Endpunkt)
   - **Aussteller** (Entity ID des IdP)
   - **Öffentliches Zertifikat** (X.509-Signierzertifikat)
4. **Signaturmethode** (`RSA-SHA256`) und **Digest-Methode** (`SHA256`) sind bereits unter **Erweitert** gesetzt; ändern Sie sie nur, wenn Ihr Identity Provider anders signiert

## OpenID Connect (OIDC)

Ein Projekt kann sich auch über einen OpenID-Connect-Anbieter anmelden, etwa Google Workspace, Okta, Microsoft Entra ID, Auth0 oder Keycloak.

1. Registrieren Sie bei Ihrem Identity Provider eine App (einen OIDC-Client) und kopieren Sie deren **Aussteller-URL**, **Client-ID** und **Client-Secret**.
2. Navigieren Sie in OneUptime zu **Projekteinstellungen** > **Sicherheit** > **OIDC** und klicken Sie auf **OIDC erstellen**.
3. Geben Sie einen **Namen** (was Personen auf der Anmeldeseite sehen), die **Aussteller-URL**, die **Client-ID** und das **Client-Secret** ein. Sie können stattdessen auch die Discovery-URL des Anbieters in **Aussteller-URL** einfügen.
4. Im Schritt **Anmeldung** ist unter **Teams** bereits das Mitglieder-Team Ihres Projekts ausgewählt: Wer sich zum ersten Mal anmeldet, wird diesen Teams hinzugefügt. Alles andere wird unter **Erweitert** ausgefüllt: die **Discovery-URL** (der Aussteller gefolgt von `/.well-known/openid-configuration`), die **Geltungsbereiche** (`openid email profile`), die Claim-Namen `email` und `name` sowie eine Beschreibung („Sign in with“ und der Name). Ändern Sie sie nur, wenn Ihr Anbieter es erfordert.
5. Speichern Sie. Der Dialog **OIDC-Konfiguration** öffnet sich mit der **Weiterleitungs-URI**: Tragen Sie sie bei den zulässigen Weiterleitungs-URIs Ihrer App ein. Ein neuer Anbieter ist zunächst deaktiviert; bearbeiten Sie ihn danach und schalten Sie **Aktiviert** ein.
6. Melden Sie sich über den Link auf der Karte **OpenID Connect (OIDC) testen** mit dem Anbieter an, bevor Sie SSO für das Projekt verpflichtend machen.

## Hinweise zu SSO und Rollen

OneUptime unterstützt derzeit keine Zuordnung von SAML-Rollen aus Ihrem Identity Provider. Die rollenbasierte Zugriffssteuerung muss separat innerhalb von OneUptime's **Projekteinstellungen** > **SSO** konfiguriert werden.
