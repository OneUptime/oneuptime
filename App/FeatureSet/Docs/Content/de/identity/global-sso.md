# Global SSO (Instanzweites Single Sign-On)

Global SSO ermöglicht es einem OneUptime-**Instanzadministrator** (Master-Admin), einen einzigen SAML 2.0- oder OpenID Connect (OIDC)-Identity Provider **einmal auf Instanzebene** zu konfigurieren und ihn mit jedem Projekt auf dem Server zu verbinden. Es ist das instanzweite Gegenstück zum projektbezogenen SSO: Anstatt dass jeder Projektinhaber seinen eigenen Identity Provider konfiguriert, richtet ein Master-Admin einen ein, der die gesamte Instanz bedienen kann.

Global SSO ist eine Funktion der **OneUptime Enterprise Edition** und ist nur auf Instanzen verfügbar, die mit dem Enterprise-Edition-Build betrieben werden.

## Global SSO vs. Projekt-SSO

| | Projekt-SSO | Global SSO |
|---|---|---|
| Konfiguriert von | Projektinhaber/-administrator (Projekteinstellungen) | Instanz-Master-Admin (Admin-Dashboard) |
| Geltungsbereich | Ein einzelnes Projekt | Die gesamte Instanz — mit jedem Projekt verbindbar |
| Anmeldeergebnis | Zugriff auf dieses eine Projekt | Zugriff auf jedes Projekt, das der Benutzer erreichen kann |

## Global SSO einrichten

1. **Admin-Dashboard öffnen**
   - Melden Sie sich als Master-Admin an und öffnen Sie **Admin** > **Einstellungen** > **Global SSO** (für SAML) oder **Global OIDC** (für OpenID Connect).

2. **Einen Provider erstellen**
   - Klicken Sie auf **Global SSO erstellen**.
   - Für SAML: Geben Sie einen **Namen**, die **Sign On URL** und den **Issuer** von Ihrem Identity Provider ein und fügen Sie das **öffentliche Zertifikat** ein. Wählen Sie die **Signatur**- und **Digest**-Methoden (belassen Sie die Standardwerte — `RSA-SHA256` / `SHA256` —, wenn Sie unsicher sind).
   - Für OIDC: Geben Sie die **Discovery URL**, den **Issuer**, die **Client ID**, das **Client Secret**, die **Scopes** (müssen `openid` enthalten) sowie die Namen der **E-Mail**-/**Name**-Claims ein.

3. **Die OneUptime-URLs in Ihren Identity Provider kopieren**
   - Öffnen Sie den Provider (klicken Sie auf seine Zeile in der Liste), um die Karte **Identity Provider URLs** anzuzeigen.
   - Kopieren Sie für SAML die **ACS URL (Reply URL)** und den **Issuer (Entity ID)** in Ihren IdP (Okta, Azure AD, OneLogin, JumpCloud und weitere).
   - Kopieren Sie für OIDC die **Redirect URI** in die Liste der zulässigen Weiterleitungen Ihres IdP.

4. **Den Provider testen**
   - Verwenden Sie den Link **Diesen SSO-Provider testen** auf der Provider-Seite, um eine End-to-End-Anmeldung über Ihren Identity Provider durchzuführen. Der Provider muss **aktiviert** sein, damit der Link funktioniert. Das Aktivieren eines globalen Providers fügt lediglich die Option „Mit SSO anmelden" auf der Anmeldeseite hinzu — es erzwingt niemals SSO und sperrt niemanden aus, sodass es sicher ist, den Provider zu aktivieren, zu testen und bei Bedarf wieder zu deaktivieren.

## Wie sich Benutzer anmelden

Wie sich ein globaler Provider verhält, hängt davon ab, ob Sie ihm Projekte zuweisen:

- **Keine Projekte zugewiesen (Standard-alle / Einladung zuerst):** Benutzer können sich mit dem Provider anmelden und **jedes Projekt erreichen, in dem sie bereits Mitglied sind**. Neue Benutzer werden **nicht** automatisch erstellt — ein Benutzer muss zuerst in ein Projekt eingeladen werden. Verwenden Sie dies für unternehmensweites SSO, bei dem Mitgliedschaften an anderer Stelle verwaltet werden.

- **Projekte zugewiesen (automatische Bereitstellung):** Öffnen Sie den Provider und verwenden Sie die Tabelle **Zugewiesene Projekte**, um ein oder mehrere Projekte zuzuweisen, jeweils mit einer Reihe von Standard-Teams. Benutzer, die sich anmelden, werden bei der ersten Anmeldung **automatisch bereitgestellt** in diese Projekte aufgenommen und den Standard-Teams hinzugefügt. Fügen Sie jeweils ein Projekt + Teams hinzu, um die Liste aufzubauen; um eine Zuweisung zu ändern, löschen Sie sie und fügen Sie sie erneut hinzu.

Wenn Sie jegliche automatische Kontoerstellung verhindern möchten, auch wenn Projekte zugewiesen sind, aktivieren Sie **Registrierung mit SSO deaktivieren** für den Provider — Benutzer müssen dann eingeladen werden, bevor sie sich anmelden können.

## SSO erzwingen

Das Konfigurieren eines globalen Providers zwingt niemanden zu seiner Verwendung; die Anmeldung mit Passwort funktioniert weiterhin. Um SSO zu erfordern, verwenden Sie die Steuerelemente **SSO für die Anmeldung erfordern**:

- **Pro Projekt:** Ein Projekt kann SSO erfordern und optional einen *bestimmten* Provider (projektbezogen oder global) erfordern.
- **Instanzweit:** Unter **Admin** > **Einstellungen** > **Authentifizierung** gibt es einen Schalter **SSO für die Anmeldung erfordern**, der SSO für jeden Benutzer in der gesamten Instanz erzwingt. Master-Admins bleiben ausgenommen, damit sie nicht ausgesperrt werden können.

## Verwandt

- [SSO (Projekt-SSO)](/docs/identity/sso)
- [SCIM](/docs/identity/scim)
