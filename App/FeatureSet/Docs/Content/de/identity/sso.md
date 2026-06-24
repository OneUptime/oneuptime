# SSO (Single Sign-On)

OneUptime unterstützt SAML 2.0-basiertes Single Sign-On (SSO) für die Enterprise-Authentifizierung. SSO ermöglicht Ihren Teammitgliedern, sich bei OneUptime mit den Anmeldedaten Ihrer Organisation anzumelden und bietet zentralisiertes Zugriffsmanagement und erhöhte Sicherheit.

## Übersicht

Die SSO-Integration bietet folgende Vorteile:

- **Zentralisierte Authentifizierung**: Benutzer melden sich mit ihren vorhandenen Unternehmensanmeldedaten an
- **Erhöhte Sicherheit**: Multi-Faktor-Authentifizierung und Sicherheitsrichtlinien Ihres IdP nutzen
- **Vereinfachte Benutzerverwaltung**: Zugriff aus Ihrem vorhandenen Identitätsverwaltungssystem verwalten
- **Reduzierte Passwortmüdigkeit**: Benutzer müssen sich kein separates OneUptime-Passwort merken

## SSO einrichten

1. **Zu Projekteinstellungen navigieren**

   - Gehen Sie zu Ihrem OneUptime-Projekt
   - Navigieren Sie zu **Projekteinstellungen** > **Authentifizierung** > **SSO**

2. **SSO-Konfiguration erstellen**

   - Klicken Sie auf **SSO erstellen**
   - Geben Sie einen **Namen** für die SSO-Konfiguration ein (z. B. "Keycloak SAML" oder "Okta SAML")
   - Geben Sie die **Sign-On-URL** von Ihrem Identity Provider ein
   - Geben Sie den **Aussteller** (Entity ID) von Ihrem Identity Provider ein
   - Fügen Sie das **öffentliche Zertifikat** von Ihrem Identity Provider ein
   - Wählen Sie den **Signaturalgorithmus** (z. B. `RSA-SHA-256`)
   - Wählen Sie den **Digest-Algorithmus** (z. B. `SHA256`)

3. **OneUptime SSO-Metadaten abrufen**
   - Klicken Sie nach dem Speichern auf die Schaltfläche **SSO-Konfiguration anzeigen**
   - Kopieren Sie den **Bezeichner (Entity ID)** — dieser wird in Ihrer IdP-Konfiguration benötigt
   - Kopieren Sie die **Antwort-URL (Assertion Consumer Service URL)** — diese wird in Ihrer IdP-Konfiguration benötigt

## Keycloak SAML-Konfiguration

Keycloak ist eine beliebte Open-Source-Identitäts- und Zugriffsmanagementlösung.

### Schritt 1: OneUptime SSO konfigurieren

1. Melden Sie sich bei Ihrem OneUptime-Dashboard an
2. Navigieren Sie zu **Projekteinstellungen** > **Authentifizierung** > **SSO**
3. Klicken Sie auf **SSO erstellen** und füllen Sie Folgendes aus:
   - **Name**: Ein beschreibender Name (z. B. `my-project-oneuptime`)
   - **Sign-On-URL**: `https://<your-keycloak-domain>/auth/realms/<your-realm>/protocol/saml`
   - **Aussteller**: `https://<your-keycloak-domain>/auth/realms/<your-realm>`
   - **Zertifikat**: Siehe Schritt 2 unten
   - **Signaturalgorithmus**: `RSA-SHA-256`
   - **Digest-Algorithmus**: `SHA256`
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
   - **Anwendungsbenutzername**: `E-Mail` auswählen

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
   - **Sign-On-URL** (SSO-Endpunkt)
   - **Aussteller** (Entity ID des IdP)
   - **Öffentliches Zertifikat** (X.509-Signierzertifikat)
4. **Signaturalgorithmus** auf `RSA-SHA-256` und **Digest-Algorithmus** auf `SHA256` setzen

## Hinweise zu SSO und Rollen

OneUptime unterstützt derzeit keine Zuordnung von SAML-Rollen aus Ihrem Identity Provider. Die rollenbasierte Zugriffssteuerung muss separat innerhalb von OneUptime's **Projekteinstellungen** > **SSO** konfiguriert werden.
