# SCIM (System for Cross-domain Identity Management)

OneUptime unterstützt das SCIM v2.0-Protokoll für die automatisierte Benutzerbereitstellung und -entbereitstellung. SCIM ermöglicht Identity Providern (IdPs) wie Azure AD, Okta und anderen Enterprise-Identitätssystemen, den Benutzerzugriff auf OneUptime-Projekte und Status-Seiten automatisch zu verwalten.

## Übersicht

Die SCIM-Integration bietet folgende Vorteile:

- **Automatische Benutzerbereitstellung**: Benutzer in OneUptime automatisch erstellen, wenn sie im IdP zugewiesen werden
- **Automatische Benutzerentbereitstellung**: Benutzer aus OneUptime automatisch entfernen, wenn sie im IdP nicht mehr zugewiesen sind
- **Benutzerattributsynchronisierung**: Benutzerinformationen zwischen Ihrem IdP und OneUptime synchronisieren
- **Zentralisierte Zugriffsverwaltung**: OneUptime-Zugriff aus Ihrem vorhandenen Identitätsverwaltungssystem verwalten

## SCIM für Projekte

Projekt-SCIM ermöglicht Identity Providern, Teammitglieder innerhalb von OneUptime-Projekten zu verwalten.

### Projekt-SCIM einrichten

1. **Zu Projekteinstellungen navigieren**
   - Gehen Sie zu Ihrem OneUptime-Projekt
   - Navigieren Sie zu **Projekteinstellungen** > **Team** > **SCIM**

2. **SCIM-Einstellungen konfigurieren**
   - Aktivieren Sie **Benutzer automatisch bereitstellen**, um Benutzer automatisch hinzuzufügen, wenn sie im IdP zugewiesen werden
   - Aktivieren Sie **Benutzer automatisch entbereitstellen**, um Benutzer automatisch zu entfernen, wenn sie im IdP nicht mehr zugewiesen sind
   - Wählen Sie die **Standard-Teams**, denen neue Benutzer hinzugefügt werden sollen
   - Kopieren Sie die **SCIM-Basis-URL** und das **Bearer-Token** für Ihre IdP-Konfiguration

3. **Ihren Identity Provider konfigurieren**
   - Verwenden Sie die SCIM-Basis-URL: `https://oneuptime.com/scim/v2/{scimId}`
   - Bearer-Token-Authentifizierung mit dem bereitgestellten Token konfigurieren
   - Benutzerattribute zuordnen (E-Mail ist erforderlich)

### Projekt-SCIM-Endpunkte

- **Service Provider Config**: `GET /scim/v2/{scimId}/ServiceProviderConfig`
- **Schemas**: `GET /scim/v2/{scimId}/Schemas`
- **Resource Types**: `GET /scim/v2/{scimId}/ResourceTypes`
- **Benutzer auflisten**: `GET /scim/v2/{scimId}/Users`
- **Benutzer abrufen**: `GET /scim/v2/{scimId}/Users/{userId}`
- **Benutzer erstellen**: `POST /scim/v2/{scimId}/Users`
- **Benutzer aktualisieren**: `PUT /scim/v2/{scimId}/Users/{userId}` oder `PATCH /scim/v2/{scimId}/Users/{userId}`
- **Benutzer löschen**: `DELETE /scim/v2/{scimId}/Users/{userId}`
- **Gruppen auflisten**: `GET /scim/v2/{scimId}/Groups`
- **Gruppe abrufen**: `GET /scim/v2/{scimId}/Groups/{groupId}`
- **Gruppe erstellen**: `POST /scim/v2/{scimId}/Groups`
- **Gruppe aktualisieren**: `PUT /scim/v2/{scimId}/Groups/{groupId}` oder `PATCH /scim/v2/{scimId}/Groups/{groupId}`
- **Gruppe löschen**: `DELETE /scim/v2/{scimId}/Groups/{groupId}`

## SCIM für Status-Seiten

Status-Seiten-SCIM ermöglicht Identity Providern, Abonnenten privater Status-Seiten zu verwalten.

### Status-Seiten-SCIM einrichten

1. **Zu Status-Seiten-Einstellungen navigieren**
   - Gehen Sie zu Ihrer OneUptime Status-Seite
   - Navigieren Sie zu **Status-Seiten-Einstellungen** > **Private Benutzer** > **SCIM**

2. **SCIM-Einstellungen konfigurieren**
   - Aktivieren Sie **Benutzer automatisch bereitstellen** und **Benutzer automatisch entbereitstellen**
   - Kopieren Sie die **SCIM-Basis-URL** und das **Bearer-Token** für Ihre IdP-Konfiguration

3. **Ihren Identity Provider konfigurieren**
   - Verwenden Sie die SCIM-Basis-URL: `https://oneuptime.com/status-page-scim/v2/{scimId}`

## Identity Provider-Konfiguration

### Microsoft Entra ID (ehemals Azure AD)

#### Voraussetzungen

- Microsoft Entra ID-Mandant mit Premium P1- oder P2-Lizenz (für automatische Bereitstellung erforderlich)
- OneUptime-Konto mit Scale-Plan oder höher
- Admin-Zugriff auf Microsoft Entra ID und OneUptime

#### Schritt 1: SCIM-Konfiguration von OneUptime erhalten

1. Melden Sie sich bei Ihrem OneUptime-Dashboard an
2. Navigieren Sie zu **Projekteinstellungen** > **Team** > **SCIM**
3. Klicken Sie auf **SCIM-Konfiguration erstellen**
4. Kopieren Sie die **SCIM-Basis-URL** und das **Bearer-Token**

#### Schritt 2: Enterprise-Anwendung in Microsoft Entra ID erstellen

1. Melden Sie sich beim [Microsoft Entra Admin Center](https://entra.microsoft.com) an
2. Navigieren Sie zu **Identität** > **Anwendungen** > **Unternehmensanwendungen**
3. Klicken Sie auf **+ Neue Anwendung**
4. Klicken Sie auf **+ Eigene Anwendung erstellen**
5. Geben Sie einen Namen ein (z. B. "OneUptime")
6. Wählen Sie **Beliebige andere Anwendung integrieren, die Sie nicht in der Galerie finden**
7. Klicken Sie auf **Erstellen**

#### Schritt 3: SCIM-Bereitstellung konfigurieren

1. Gehen Sie in Ihrer OneUptime-Unternehmensanwendung zu **Bereitstellung**
2. Setzen Sie den **Bereitstellungsmodus** auf **Automatisch**
3. Unter **Admin-Anmeldeinformationen**:
   - **Mandanten-URL**: SCIM-Basis-URL aus OneUptime eingeben
   - **Geheimes Token**: Bearer-Token aus OneUptime eingeben
4. Klicken Sie auf **Verbindung testen**
5. Klicken Sie auf **Speichern**

### Okta

#### Voraussetzungen

- Okta-Mandant mit Bereitstellungsfähigkeiten
- OneUptime-Konto mit Scale-Plan oder höher
- Admin-Zugriff auf Okta und OneUptime

#### Schritt 4: SCIM-Verbindung konfigurieren

1. Gehen Sie zum Tab **Bereitstellung**
2. Klicken Sie auf **Integration** in der linken Seitenleiste
3. Klicken Sie auf **API-Integration konfigurieren**
4. Aktivieren Sie **API-Integration aktivieren**
5. Konfigurieren Sie:
   - **SCIM-Connector-Basis-URL**: SCIM-Basis-URL aus OneUptime eingeben
   - **Eindeutiges Bezeichnerfeld für Benutzer**: `userName` eingeben
   - **Authentifizierungsmodus**: **HTTP-Header** auswählen
   - **Autorisierung**: `Bearer {your-bearer-token}` eingeben
6. Klicken Sie auf **API-Anmeldeinformationen testen**
7. Klicken Sie auf **Speichern**

## Häufig gestellte Fragen

### Was passiert, wenn ein Benutzer entbereitgestellt wird?

Wenn ein Benutzer entbereitgestellt wird (entweder durch DELETE-Anfrage oder durch Setzen von `active: false`), wird er aus den in den SCIM-Einstellungen konfigurierten Teams entfernt. Das Benutzerkonto selbst bleibt in OneUptime erhalten, verliert aber den Zugriff auf das Projekt.

### Kann ich SCIM ohne SSO verwenden?

Ja, SCIM und SSO sind unabhängige Funktionen. Sie können SCIM für die Benutzerbereitstellung verwenden und gleichzeitig Benutzern erlauben, sich mit ihren OneUptime-Passwörtern oder einer anderen Authentifizierungsmethode anzumelden.

### Wie gehe ich mit Benutzern um, die bereits in OneUptime existieren?

Wenn SCIM versucht, einen Benutzer zu erstellen, der bereits existiert (Abgleich per E-Mail), fügt OneUptime diesen einfach zu den konfigurierten Standard-Teams hinzu, anstatt einen doppelten Benutzer zu erstellen.

### Was ist der Unterschied zwischen Standard-Teams und Push-Gruppen?

- **Standard-Teams**: Alle über SCIM bereitgestellten Benutzer werden denselben vordefinierten Teams hinzugefügt
- **Push-Gruppen**: Die Teammitgliedschaft wird von Ihrem Identity Provider verwaltet, sodass verschiedene Benutzer basierend auf der IdP-Gruppenmitgliedschaft in verschiedenen Teams sein können
