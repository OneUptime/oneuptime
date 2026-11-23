# SSO

Mit Single Sign-On (SSO) melden sich die Personen in Ihrem Projekt über den Identitätsanbieter (IdP) Ihrer Organisation bei OneUptime an, per SAML 2.0 oder OpenID Connect. Zugriff, Passwörter und Multi-Faktor-Authentifizierung verwalten Sie an einer Stelle, und Sie können SSO für alle im Projekt verlangen.

> [!NOTE]
> **Edition:** SSO, einschließlich "Require SSO to sign in", ist Teil jeder OneUptime-Edition: Selbst gehostete Installationen erhalten es in der Community Edition, ohne dass eine Lizenz nötig ist. Auf OneUptime Cloud ist es ab dem Plan **Scale** verfügbar. Was jede Edition enthält, sehen Sie unter [Enterprise Edition](/docs/self-hosted/enterprise).

:::cards
- [SAML-Anbieter einrichten](#sso-einrichten): In OneUptime anlegen und Ihrem IdP zwei URLs geben.
- [Anleitungen für Identitätsanbieter](#anleitungen-für-identitätsanbieter): Keycloak, Microsoft Entra ID und Okta, Schritt für Schritt.
- [OpenID Connect](#openid-connect-oidc): Stattdessen über eine OIDC-App anmelden.
- [SSO verlangen](#sso-für-ihr-projekt-verlangen): SSO zum einzigen Weg ins Projekt machen.
:::

## So funktioniert die SAML-Anmeldung

Ein SAML-Anbieter verbindet ein Projekt mit einer Anwendung in Ihrem Identitätsanbieter. Wer sich anmeldet, wählt das Projekt auf der OneUptime-Seite **Mit SSO anmelden**, meldet sich bei Ihrem IdP an und kommt angemeldet zurück.

```mermaid title="SAML-Anmeldung, Schritt für Schritt"
sequenceDiagram
    actor U as Person
    participant O as OneUptime
    participant I as Identitätsanbieter
    U->>O: Mit SSO anmelden,<br/>Projekt wählen
    O->>I: SAML-Anfrage an<br/>die Anmelde-URL
    I->>U: Anmeldeseite
    U->>I: Zugangsdaten und MFA
    I->>O: Signierte Assertion<br/>an die Antwort-URL
    Note over O: Prüft Signatur und Aussteller,<br/>liest die E-Mail<br/>aus der Name ID
    O->>U: Im Projekt angemeldet
```

OneUptime liest nur wenige Dinge aus der Assertion, die Ihr IdP sendet:

| Aus der Assertion | Was OneUptime damit macht |
| --- | --- |
| Signatur | Prüft sie gegen das **Öffentliches Zertifikat** des Anbieters. Die Antwort muss signiert und darf nicht verschlüsselt sein. |
| Issuer | Muss genau dem **Aussteller** des Anbieters entsprechen. |
| Audience | Muss die **Kennung (Entity ID)** des Anbieters sein. Eine Antwort, die Ihr IdP für eine andere Anwendung erstellt hat, wird abgelehnt. |
| Recipient und Destination | Müssen die **Antwort-URL** des Anbieters sein, die Adresse, an die die Antwort gesendet wurde. |
| `NotBefore` und `NotOnOrAfter` | Die Antwort wird nur angenommen, solange diese es erlauben, und höchstens 10 Minuten nach ihrer Ausstellung, mit 3 Minuten Spielraum für Uhren, die voneinander abweichen. |
| Name ID | Die E-Mail-Adresse der Person. Sie muss eine gültige E-Mail-Adresse sein. |
| Namensattribute | Der Name der Person, wenn OneUptime ihr Konto anlegt: ein Anzeigename (`displayName` oder `http://schemas.microsoft.com/identity/claims/displayname`) oder ein Vor- und Nachname (`firstName` und `lastName` oder die Claims `givenname` und `surname`, die Microsoft Entra ID standardmäßig sendet). Optional. |
| `http://schemas.microsoft.com/identity/claims/objectidentifier` | Die Objekt-ID der Person, die Microsoft Entra ID standardmäßig sendet. Die erste Anmeldung über den Anbieter verknüpft das Konto mit ihr, und eine spätere Anmeldung, die die E-Mail-Adresse des Kontos mit einer anderen Objekt-ID nennt, wird abgelehnt. Optional. |

Jede Antwort gilt für genau eine Anmeldung. Wird sie erneut gesendet, etwa weil Sie nach der Anmeldung im Browser zurückgehen, wird sie abgelehnt: Melden Sie sich erneut an.

Wer sich zum ersten Mal anmeldet, kommt in die **Teams** des Anbieters, und diese bestimmen, was die Person tun darf: siehe [Rollen und Teams für SSO-Benutzer](#rollen-und-teams-für-sso-benutzer).

> [!NOTE]
> Auf OneUptime Cloud meldet OneUptime jemanden, der sich zum ersten Mal mit einem SAML- oder OIDC-Anbieter des Projekts anmeldet, nicht sofort an, sondern schickt ihm einen Link per E-Mail. Die Person öffnet ihn, bestätigt, dass das Single Sign-On des Projekts sie anmelden darf, und setzt die Anmeldung fort. Der Link gilt 24 Stunden. Das geschieht einmal pro Projekt und erneut, wenn jemand das Projekt verlässt und zurückkommt. Jemand, den Sie einladen und dessen Anmeldung von SSO verwaltet wird, erhält keine solche E-Mail, ob er bereits ein OneUptime-Konto hat oder nicht: Wählt er auf der Seite, die seine Einladung öffnet, einen der Anbieter des Projekts, wird er sofort angemeldet, denn der Link seiner Einladung hat bereits bewiesen, dass das Postfach ihm gehört. Selbst gehostete Installationen melden Personen sofort an. Jede Anmeldung, die nicht direkt durchgeht, erhält auf OneUptime Cloud diese selbe Antwort, ob die Adresse ein Konto hat oder nicht: Wer noch kein Konto hat, erhält die E-Mail ebenfalls, und das Konto wird angelegt, wenn die Person bestätigt, während ein gesperrtes Konto oder ein OneUptime-Administrator keine E-Mail erhält. Eine selbst gehostete Installation weist diese beiden stattdessen mit einer einzigen Meldung ab.

Auf OneUptime Cloud belegt jemand, der über SSO in das Projekt kommt, einen Platz, genau wie jemand, den Sie einladen. Enthält Ihr Plan eine feste Anzahl an Plätzen und sind alle belegt, können neue Personen erst über SSO beitreten, wenn ein Platz frei wird.

## SSO einrichten

Sie brauchen die Berechtigung, SSO-Anbieter hinzuzufügen – **Projektinhaber**, **Projektadministrator** oder **Create Project SSO** – und auf OneUptime Cloud den Plan **Scale**. Für die Seite Ihres Identitätsanbieters siehe die [Anleitungen für Identitätsanbieter](#anleitungen-für-identitätsanbieter).

:::steps
1. **Projekteinstellungen öffnen**

   - Öffnen Sie Ihr OneUptime-Projekt
   - Gehen Sie zu **Projekteinstellungen** > **Sicherheit** > **SSO**

2. **SSO-Konfiguration erstellen**

   - Klicken Sie auf **SAML-Anbieter hinzufügen**
   - Geben Sie einen **Name** für die SSO-Konfiguration ein (z. B. "Keycloak SAML" oder "Okta SAML")
   - Geben Sie die **Anmelde-URL** Ihres Identitätsanbieters ein
   - Geben Sie den **Aussteller** (Entity ID) Ihres Identitätsanbieters ein
   - Fügen Sie das **Öffentliches Zertifikat** Ihres Identitätsanbieters ein
   - Im Schritt **Anmeldung** beginnt **Teams** mit dem Mitglieder-Team Ihres Projekts: Wer sich zum ersten Mal anmeldet, kommt in diese Teams. Angenommen werden nur Teams, in die Sie selbst jemanden einladen könnten: Ein Team, das mehr Zugriff gibt, als Sie haben, wird unter **Teams** genannt
   - Alles Weitere ist unter **Weitere Felder** ausgefüllt: die **Signaturmethode** (`RSA-SHA256`), die **Digest-Methode** (`SHA256`) und eine Beschreibung ("Sign in with" und der Name). Ändern Sie sie nur, wenn Ihr Identitätsanbieter es verlangt

3. **SSO-Metadaten von OneUptime holen**
   - Beim Speichern öffnet sich der Dialog **SSO-Konfiguration**. Mit der Schaltfläche **SSO-Konfiguration anzeigen** öffnen Sie ihn erneut
   - Kopieren Sie die **Kennung (Entity ID)**, etwa `https://oneuptime.com/<project-id>/<provider-id>` – Sie brauchen sie in der Konfiguration Ihres IdP
   - Kopieren Sie die **Antwort-URL (Assertion Consumer Service URL)**, etwa `https://oneuptime.com/identity/idp-login/<project-id>/<provider-id>` – Sie brauchen sie in der Konfiguration Ihres IdP
   - Ein neuer Anbieter ist zunächst ausgeschaltet. Sobald Ihr IdP diese beiden Werte hat, bearbeiten Sie den Anbieter und schalten **Aktiviert** ein

4. **Den Anbieter testen**
   - Öffnen Sie den Link in der Karte **SSO-Anmeldelink** und wählen Sie auf der Seite, die sich öffnet, den Anbieter. Sie werden zur Anmeldeseite Ihres Identitätsanbieters geleitet und kommen angemeldet zu OneUptime zurück
   - Sobald das klappt, können Sie für das Projekt [SSO verlangen](#sso-für-ihr-projekt-verlangen)
:::

## Anleitungen für Identitätsanbieter

Wählen Sie Ihren Identitätsanbieter. Jede Anleitung holt die Werte des IdP, legt den Anbieter in OneUptime an und gibt dem IdP dann die **Kennung (Entity ID)** und die **Antwort-URL** von OneUptime.

:::tabs
@tab Keycloak
Keycloak ist eine verbreitete Open-Source-Lösung für Identitäts- und Zugriffsverwaltung. Sie brauchen eine laufende Keycloak-Instanz mit einem Realm sowie Administratorzugriff auf Keycloak und OneUptime.

:::steps
1. **Die Werte Ihres Realms sammeln**

   - **Anmelde-URL**: `https://<your-keycloak-domain>/auth/realms/<your-realm>/protocol/saml`
   - **Aussteller**: `https://<your-keycloak-domain>/auth/realms/<your-realm>`
   - **Zertifikat**: das Signaturzertifikat des Realms. Öffnen Sie `https://<your-keycloak-domain>/auth/realms/<your-realm>/protocol/saml/descriptor` und kopieren Sie den Wert `X509Certificate`, oder öffnen Sie **Realm settings** > **Keys** und klicken Sie beim RS256-Schlüssel auf **Certificate**

   Keycloak 17 und neuer liefern diese URLs ohne das Präfix `/auth` aus. Setzen Sie das Zertifikat zwischen eigene Zeilen, etwa so:

   ```text
   -----BEGIN CERTIFICATE-----
   MIICnzCCAYcCBgFyPZ8QFzANBgkqhkiG.......
   -----END CERTIFICATE-----
   ```

2. **Den Anbieter in OneUptime anlegen**

   Gehen Sie zu **Projekteinstellungen** > **Sicherheit** > **SSO**, klicken Sie auf **SAML-Anbieter hinzufügen** und füllen Sie aus:
   - **Name**: ein aussagekräftiger Name (z. B. `my-project-oneuptime`)
   - **Anmelde-URL** und **Aussteller**: die Werte oben
   - **Öffentliches Zertifikat**: das Zertifikat, zwischen seinen eigenen Zeilen `BEGIN CERTIFICATE` und `END CERTIFICATE`
   - **Signaturmethode** und **Digest-Methode**: bereits unter **Weitere Felder** gesetzt (`RSA-SHA256` und `SHA256`)

   Speichern Sie und kopieren Sie die **Kennung (Entity ID)** und die **Antwort-URL (Assertion Consumer Service URL)** aus dem Dialog, der sich öffnet.

3. **Den Keycloak-Client anlegen**

   Öffnen Sie in Keycloak in Ihrem Realm **Clients** und legen Sie einen Client an oder bearbeiten Sie einen vorhandenen:
   - **Client Protocol** (Client-Typ): `saml`
   - **Client ID**: die **Kennung (Entity ID)** aus OneUptime
   - **Root URL** und **Valid Redirect URIs**: Ihre OneUptime-URL
   - **Assertion Consumer Service POST Binding URL**: die **Antwort-URL (Assertion Consumer Service URL)** aus OneUptime

4. **Die Client-Einstellungen anpassen**

   - Setzen Sie **Name ID Format** auf `email` und schalten Sie **Force Name ID Format** ein, damit Keycloak die E-Mail immer als Name ID sendet
   - Schalten Sie auf dem Tab **Keys** des Clients **Client signature required** (unter **Signing keys config**) aus: OneUptime signiert seine Anmeldeanfragen nicht

5. **Den Anbieter einschalten und testen**

   Bearbeiten Sie den Anbieter in OneUptime und schalten Sie **Aktiviert** ein, öffnen Sie dann den Link in der Karte **SSO-Anmeldelink** und wählen Sie den Anbieter. Sie sollten zur Keycloak-Anmeldeseite und zurück zu OneUptime geleitet werden.
:::
@tab Microsoft Entra ID
Microsoft Entra ID (früher Azure AD / Active Directory) ist der Cloud-Identitätsdienst von Microsoft. Sie brauchen einen Tenant, der Unternehmensanwendungen mit SAML-SSO unterstützt, sowie Administratorzugriff auf Entra ID und OneUptime. Führt der Microsoft-Entra-Anwendungskatalog OneUptime auf, fügen Sie die App auf OneUptime Cloud von dort hinzu: Sie bringt die Claims, die OneUptime liest, und die Muster der URLs von OneUptime schon mit.

:::steps
1. **Eine Unternehmensanwendung in Entra ID anlegen**

   - Melden Sie sich im [Microsoft Entra admin center](https://entra.microsoft.com) an
   - Gehen Sie zu **Identity** > **Applications** > **Enterprise applications** und klicken Sie auf **+ New application**
   - Aus dem Katalog: Suchen Sie nach OneUptime, wählen Sie es aus und klicken Sie auf **Create**
   - Andernfalls: Klicken Sie auf **+ Create your own application**, geben Sie einen Namen ein (z. B. "OneUptime"), wählen Sie **Integrate any other application you don't find in the gallery (Non-gallery)** und klicken Sie auf **Create**

2. **Die SAML-Werte von Entra ID kopieren**

   - Gehen Sie in der Anwendung zu **Single sign-on** und wählen Sie **SAML**
   - Laden Sie unter **SAML Certificates** das **Certificate (Base64)** herunter, öffnen Sie die Datei in einem Texteditor und kopieren Sie ihren Inhalt
   - Kopieren Sie unter **Set up OneUptime** die **Login URL** und den **Microsoft Entra Identifier** (**Azure AD Identifier** in älteren Tenants)

3. **Den Anbieter in OneUptime anlegen**

   Gehen Sie zu **Projekteinstellungen** > **Sicherheit** > **SSO**, klicken Sie auf **SAML-Anbieter hinzufügen** und füllen Sie aus:
   - **Name**: ein aussagekräftiger Name (z. B. `Azure AD SAML`)
   - **Anmelde-URL**: die **Login URL**
   - **Aussteller**: den **Microsoft Entra Identifier**
   - **Öffentliches Zertifikat**: das Base64-Zertifikat, einschließlich der Zeilen `BEGIN CERTIFICATE` und `END CERTIFICATE`
   - **Signaturmethode** und **Digest-Methode**: bereits unter **Weitere Felder** gesetzt (`RSA-SHA256` und `SHA256`)

   Speichern Sie und kopieren Sie die **Kennung (Entity ID)** und die **Antwort-URL (Assertion Consumer Service URL)** aus dem Dialog, der sich öffnet.

4. **Entra ID die URLs von OneUptime geben**

   Klicken Sie unter **Basic SAML Configuration** auf **Edit** und setzen Sie:
   - **Identifier (Entity ID)**: die **Kennung (Entity ID)** aus OneUptime
   - **Reply URL (Assertion Consumer Service URL)**: die **Antwort-URL** aus OneUptime

   Klicken Sie auf **Save**.

5. **Die E-Mail als Name ID senden**

   Klicken Sie unter **Attributes & Claims** auf **Edit**. Bei der Anwendung aus dem Katalog ist das schon eingerichtet: Prüfen Sie es.
   - Setzen Sie **Unique User Identifier (Name ID)** auf die E-Mail-Adresse des Benutzers: `user.mail`, oder `user.userprincipalname`, wo das die E-Mail-Adresse ist
   - Setzen Sie das **Name identifier format** auf `Email address`
   - Behalten Sie die Standard-Claims von Entra ID: Neue Konten erhalten den Namen der Person aus `givenname` und `surname`, und das Konto wird mit der Objekt-ID der Person verknüpft, `objectidentifier`. Fügen Sie optional einen Claim namens `http://schemas.microsoft.com/identity/claims/displayname` mit dem Quellattribut `user.displayname` hinzu, damit neue Konten stattdessen den Anzeigenamen erhalten. Die übrigen Claims ignoriert OneUptime

6. **Benutzer und Gruppen zuweisen**

   Klicken Sie unter **Users and groups** der Anwendung auf **+ Add user/group**, wählen Sie die Benutzer und Gruppen, die SSO-Zugriff erhalten sollen, und klicken Sie auf **Assign**.

7. **Den Anbieter einschalten und testen**

   Bearbeiten Sie den Anbieter in OneUptime und schalten Sie **Aktiviert** ein, öffnen Sie dann den Link in der Karte **SSO-Anmeldelink** und wählen Sie den Anbieter. Sie sollten zur Microsoft-Anmeldeseite und zurück zu OneUptime geleitet werden.
:::
@tab Okta
Okta ist eine weit verbreitete Identitätsplattform mit SAML-SSO. Sie brauchen eine Okta-Organisation mit Administratorzugriff sowie Administratorzugriff auf OneUptime. Führt das Okta Integration Network OneUptime auf, fügen Sie die App auf OneUptime Cloud von dort hinzu: Sie meldet Personen über die OneUptime-Seite **Mit SSO anmelden** und über ihr Okta-Dashboard an, gibt ihnen bei der ersten Anmeldung ein Konto und fragt statt nach den URLs von OneUptime nach zwei IDs.

:::steps
1. **OneUptime zu Okta hinzufügen**

   - Gehen Sie in der Okta Admin Console zu **Applications** > **Applications**
   - Aus dem Okta Integration Network: Klicken Sie auf **Browse App Catalog**, suchen Sie nach OneUptime und klicken Sie auf **Add Integration**. Okta fragt nach der **OneUptime Project ID** und der **OneUptime SSO Provider ID**, bevor OneUptime sie zeigen kann: Geben Sie vorerst in beide `0` ein; Sie ersetzen sie in Schritt 4. Klicken Sie auf **Done** und machen Sie mit Schritt 2 weiter
   - Andernfalls: Klicken Sie auf **Create App Integration**, wählen Sie **SAML 2.0** und klicken Sie auf **Next**, geben Sie "OneUptime" als **App name** ein und klicken Sie auf **Next**
   - Okta fragt nach den URLs von OneUptime, bevor es seine eigenen zeigt. Geben Sie vorerst Ihre OneUptime-Adresse (zum Beispiel `https://oneuptime.com`) als **Single sign-on URL** und als **Audience URI (SP Entity ID)** ein: Beide ersetzen Sie in Schritt 4
   - Setzen Sie **Name ID format** auf `EmailAddress` und **Application username** auf `Email`
   - Klicken Sie auf **Next**, wählen Sie **I'm an Okta customer adding an internal app** und klicken Sie auf **Finish**

2. **Die SAML-Werte von Okta kopieren**

   Suchen Sie auf dem Tab **Sign On** der Anwendung unter **SAML Signing Certificates** das aktive Zertifikat:
   - Klicken Sie auf **Actions** > **View IdP metadata** und kopieren Sie die **Anmelde-URL** (Identity Provider Single Sign-On URL) und den **Aussteller** (Identity Provider Issuer)
   - Klicken Sie auf **Actions** > **Download certificate**, öffnen Sie die Datei `.cert` in einem Texteditor und kopieren Sie ihren Inhalt

3. **Den Anbieter in OneUptime anlegen**

   Gehen Sie zu **Projekteinstellungen** > **Sicherheit** > **SSO**, klicken Sie auf **SAML-Anbieter hinzufügen** und füllen Sie aus:
   - **Name**: ein aussagekräftiger Name (z. B. `Okta SAML`)
   - **Anmelde-URL** und **Aussteller**: die Werte von Okta
   - **Öffentliches Zertifikat**: das Zertifikat, einschließlich der Zeilen `BEGIN CERTIFICATE` und `END CERTIFICATE`
   - **Signaturmethode** und **Digest-Methode**: bereits unter **Weitere Felder** gesetzt (`RSA-SHA256` und `SHA256`)

   Speichern Sie und kopieren Sie die **Kennung (Entity ID)** und die **Antwort-URL (Assertion Consumer Service URL)** aus dem Dialog, der sich öffnet.

4. **Okta die URLs von OneUptime geben**

   Klicken Sie bei der Anwendung aus dem Okta Integration Network auf dem Tab **General** unter **App Settings** auf **Edit** und setzen Sie:
   - **OneUptime Project ID** und **OneUptime SSO Provider ID**: die beiden IDs in der **Kennung (Entity ID)** aus OneUptime, `https://oneuptime.com/<project-id>/<provider-id>`

   Klicken Sie auf **Save** und prüfen Sie auf dem Tab **Sign On**, dass **Application username format** auf `Email` steht.

   Klicken Sie bei Ihrer eigenen Anwendung auf dem Tab **General** unter **SAML Settings** auf **Edit** und dann auf **Next** und setzen Sie:
   - **Single sign-on URL**: die **Antwort-URL (Assertion Consumer Service URL)** aus OneUptime
   - **Audience URI (SP Entity ID)**: die **Kennung (Entity ID)** aus OneUptime

   Fügen Sie optional die Attribute Statements `firstName` mit dem Wert `user.firstName` und `lastName` mit dem Wert `user.lastName` hinzu, damit neue Konten den Namen der Person erhalten. Klicken Sie auf **Next** und dann auf **Finish**.

5. **Personen zuweisen**

   Klicken Sie auf dem Tab **Assignments** auf **Assign** > **Assign to People** oder **Assign to Groups**, wählen Sie, wer SSO-Zugriff erhält, klicken Sie jeweils auf **Assign** und dann auf **Done**.

6. **Den Anbieter einschalten und testen**

   Bearbeiten Sie den Anbieter in OneUptime und schalten Sie **Aktiviert** ein, öffnen Sie dann den Link in der Karte **SSO-Anmeldelink** und wählen Sie den Anbieter. Sie sollten zur Okta-Anmeldeseite und zurück zu OneUptime geleitet werden.
:::
@tab Andere
Das SSO von OneUptime nutzt SAML 2.0 und funktioniert mit jedem konformen Identitätsanbieter:

:::steps
1. Holen Sie die **Anmelde-URL** (seinen SSO-Endpunkt), den **Aussteller** (seine Entity ID) und das **Öffentliches Zertifikat** (sein X.509-Signaturzertifikat) Ihres Identitätsanbieters. Zeigt Ihr IdP sie erst, wenn eine Anwendung existiert, legen Sie die Anwendung mit Ihrer OneUptime-Adresse als vorläufigen URLs an.
2. Legen Sie in OneUptime den Anbieter mit diesen Werten an und kopieren Sie die **Kennung (Entity ID)** und die **Antwort-URL (Assertion Consumer Service URL)** aus dem Dialog **SSO-Konfiguration** (oder über **SSO-Konfiguration anzeigen**).
3. Setzen Sie in der SAML-Anwendung Ihres Identitätsanbieters die **Assertion Consumer Service URL / Reply URL** und die **Entity ID / Audience URI** auf die Werte von OneUptime und das **Name ID Format** auf die E-Mail-Adresse.
4. **Signaturmethode** (`RSA-SHA256`) und **Digest-Methode** (`SHA256`) sind bereits unter **Weitere Felder** gesetzt; ändern Sie sie nur, wenn Ihr Identitätsanbieter anders signiert
5. Schalten Sie für den Anbieter **Aktiviert** ein und testen Sie ihn mit dem Link in der Karte **SSO-Anmeldelink**.
:::
:::

## OpenID Connect (OIDC)

Ein Projekt kann sich auch über einen OpenID-Connect-Anbieter anmelden, etwa Google Workspace, Okta, Microsoft Entra ID, Auth0 oder Keycloak. Sie brauchen die Berechtigung, OIDC-Anbieter hinzuzufügen (**Projektinhaber**, **Projektadministrator** oder **Create Project OIDC**), und auf OneUptime Cloud den Plan **Scale**.

:::steps
1. Registrieren Sie bei Ihrem Identitätsanbieter eine App (einen OIDC-Client), die den Authorization Code Flow mit PKCE nutzen darf, und kopieren Sie ihre **Aussteller-URL**, **Client-ID** und **Client-Secret**.
2. Gehen Sie in OneUptime zu **Projekteinstellungen** > **Sicherheit** > **SSO**. Klicken Sie unter den SAML-Anbietern auf **OIDC-Anbieter hinzufügen**.
3. Geben Sie einen **Name** (das, was Personen auf der Anmeldeseite sehen), die **Aussteller-URL**, die **Client-ID** und das **Client-Secret** ein. Sie können stattdessen auch die Discovery-URL des Anbieters in **Aussteller-URL** einfügen.
4. Im Schritt **Anmeldung** beginnt **Teams** mit dem Mitglieder-Team Ihres Projekts: Wer sich zum ersten Mal anmeldet, kommt in diese Teams. Alles Weitere ist unter **Weitere Felder** ausgefüllt: die **Discovery-URL** (der Aussteller, gefolgt von `/.well-known/openid-configuration`), die **Geltungsbereiche** (`openid email profile`), die Claim-Namen `email` und `name` sowie eine Beschreibung ("Sign in with" und der Name). Ändern Sie sie nur, wenn Ihr Anbieter es verlangt. Angenommen werden nur Teams, in die Sie selbst jemanden einladen könnten: Ein Team, das mehr Zugriff gibt, als Sie haben, wird unter **Teams** genannt.
5. Speichern Sie. Der Dialog **OIDC-Konfiguration** öffnet sich mit der **Weiterleitungs-URI**: Fügen Sie sie den erlaubten Weiterleitungs-URIs Ihrer App hinzu. Ein neuer Anbieter ist zunächst ausgeschaltet; bearbeiten Sie ihn deshalb danach und schalten Sie **Aktiviert** ein.
6. Öffnen Sie den Link in der Karte **SSO-Anmeldelink** und wählen Sie den Anbieter, um sich darüber anzumelden, bevor Sie für das Projekt SSO verlangen.
:::

## Auch beim Identitätsanbieter abmelden

Wer sich von OneUptime abmeldet, bleibt beim Identitätsanbieter angemeldet. An einem gemeinsam genutzten Computer, etwa einem NOC-Bildschirm oder einem Kiosk, kommt die nächste Person, die auf der Anmeldeseite den Anbieter wählt, deshalb als die Person hinein, die gegangen ist. Schalten Sie bei einem SAML- oder OIDC-Anbieter **Auch beim Identitätsanbieter abmelden** unter **Weitere Felder** ein, damit eine Abmeldung von OneUptime auch die Sitzung beim Anbieter beendet. Die Einstellung ist standardmäßig aus: Auf einem persönlichen Laptop würde sie die Person auch bei jeder anderen App abmelden, die den Anbieter nutzt. Sie gilt für Personen, die sich nach dem Einschalten in einem Browser anmelden; die mobile App meldet nur von OneUptime ab.

:::tabs
@tab SAML
Tragen Sie die Abmelde-URL Ihres Identitätsanbieters als **Abmelde-URL** des Anbieters unter **Weitere Felder** ein: Ohne sie lässt sich der Schalter nicht einschalten. Geben Sie Ihrem Identitätsanbieter dann die **Single-Logout-URL** aus dem Dialog **SSO-Konfiguration** und das Zertifikat, mit dem OneUptime seine Abmeldeanfragen signiert, über **Signaturzertifikat herunterladen** im selben Dialog.

| Identitätsanbieter | Abmelde-URL | Wohin die Single-Logout-URL und das Zertifikat gehören |
| --- | --- | --- |
| Okta | **Identity Provider Single Logout URL**, unter **View SAML setup instructions** auf dem Tab **Sign On** | Bearbeiten Sie auf dem Tab **General** die **SAML Settings**, klicken Sie auf **Show Advanced Settings** und wählen Sie **Allow application to initiate Single Logout**. Setzen Sie **Single Logout URL** auf die Single-Logout-URL und **SP Issuer** auf die Kennung (Entity ID), und laden Sie das Zertifikat als **Signature Certificate** hoch. |
| Microsoft Entra ID | **Logout URL**, unter **Set up OneUptime** | Setzen Sie in **Basic SAML Configuration** die **Logout Url (Optional)** auf die Single-Logout-URL. Entra ID braucht kein Zertifikat. |
| Keycloak | Der SAML-Endpunkt des Realms, derselbe wie die Anmelde-URL | Setzen Sie auf dem Tab **Advanced** des Clients die **Logout Service Redirect Binding URL** auf die Single-Logout-URL. Lassen Sie **Front channel logout** eingeschaltet. Keycloak braucht kein Zertifikat, solange **Client signature required** aus ist, wie oben eingerichtet. |

Nach einer Abmeldung dort schickt der Identitätsanbieter den Browser zur Single-Logout-URL zurück, die die Anmeldeseite öffnet oder meldet, dass der Identitätsanbieter die Abmeldung nicht bestätigt hat. Meldet sich die Person beim Identitätsanbieter oder bei einer anderen App ab, die ihn nutzt, meldet ein Identitätsanbieter, der seinen Apps Abmeldeanfragen schickt, wie Keycloak und Microsoft Entra ID, sie auch von OneUptime ab. OneUptime nimmt nur eine Anfrage an, die der Identitätsanbieter signiert hat.
@tab OpenID Connect
Der Browser geht zur Abmeldung des Anbieters, sobald OneUptime ihn abgemeldet hat, und der Anbieter schickt ihn zur Anmeldeseite von OneUptime zurück. Registrieren Sie diese Seite bei Ihrem Anbieter: Der Dialog **OIDC-Konfiguration** zeigt sie als Weiterleitungs-URI nach der Abmeldung, die Anbieter Post-Logout-Redirect-URI nennen. Ein Anbieter, dessen Discovery-Dokument keinen `end_session_endpoint` nennt, wie Google, kann sie nicht einschalten.

| Identitätsanbieter | Wo die Weiterleitungs-URI nach der Abmeldung registriert wird |
| --- | --- |
| Okta | Klicken Sie auf dem Tab **General** der App-Integration in **General Settings** auf **Edit** und fügen Sie sie zu **Sign-out redirect URIs** hinzu. |
| Microsoft Entra ID | Fügen Sie sie in der App-Registrierung unter **Authentication** zu den **Redirect URIs** der Plattform **Web** hinzu. Die **Front-channel logout URL** ist eine andere Einstellung, die OneUptime nicht nutzt. |
| Auth0 | Fügen Sie sie in den **Settings** der Anwendung zu **Allowed Logout URLs** hinzu. Ein Tenant, der vor dem 14. November 2023 angelegt wurde, braucht außerdem **RP-Initiated Logout End Session Endpoint Discovery** in seinen **Advanced**-Einstellungen eingeschaltet, damit sein Discovery-Dokument einen `end_session_endpoint` nennt. |
| Keycloak | Fügen Sie sie in den Einstellungen des Clients zu **Valid post logout redirect URIs** hinzu (Keycloak 19 und neuer). |

Ein Anbieter, bei dem sie nicht registriert ist, zeigt nach einer Abmeldung von OneUptime seine eigene Fehlerseite, statt die Person zurückzuschicken; von OneUptime ist sie trotzdem abgemeldet.
:::

## Erneut anmelden, um zu bestätigen, dass Sie es sind

Bevor jemand ändert, wie er sich anmeldet, oder sein Konto löscht, bittet OneUptime ihn, [zu bestätigen, dass er es ist](/docs/introduction/your-account#bestätigen-dass-sie-es-sind). Wer sich nur über Ihren Identitätsanbieter anmeldet, ohne Passwort oder Passkey in OneUptime, bestätigt mit **Erneut anmelden**: OneUptime schickt die Person zum Anbieter und bittet ihn, sie sich erneut anmelden zu lassen. Das zählt nur, wenn der Anbieter sagt, dass sie sich zu diesem Zeitpunkt oder danach angemeldet hat, mit einer Minute Spielraum für die beiden Uhren. Ein Anbieter, der sie mit einer bestehenden Sitzung sofort wieder anmeldet oder nicht mitteilt, wann sie sich angemeldet hat, bestätigt nichts, und die Person erfährt, dass sie Sie bitten soll, das zu ändern.

:::tabs
@tab SAML
OneUptime sendet `ForceAuthn="true"` und liest aus dem `AuthnInstant` der Assertion, wann sich die Person angemeldet hat.

| Identitätsanbieter | Was einzustellen ist |
| --- | --- |
| Okta | Bearbeiten Sie auf dem Tab **General** die **SAML Settings**, klicken Sie auf **Show Advanced Settings** und setzen Sie **Honor Force Authentication** auf **Yes**. Steht es auf **No**, ignoriert Okta die Anfrage. OneUptime erinnert Sie neben einem Okta-Anbieter daran. |
| Microsoft Entra ID | Nichts: Entra ID folgt der Anfrage, und sein `AuthnInstant` ist der Zeitpunkt, zu dem sich die Person angemeldet hat. |
| Keycloak | Nichts: Keycloak folgt der Anfrage, Keycloak 26.8.2 und älter kann sie aber überspringen, wenn die Anmeldung auf der Anmeldeseite von Keycloak neu gestartet wird, was 26.8.3 und 27.0.0 beheben. Sein `AuthnInstant` ist der Zeitpunkt seiner Antwort, nicht der Anmeldung der Person, daher kann OneUptime nicht prüfen, ob Keycloak sie erneut gefragt hat, und sagt das neben dem Anbieter. Binden Sie Keycloak über OpenID Connect an, damit OneUptime selbst prüft. |
| Google Workspace | Nichts einzustellen. Google sagt nicht, ob es der Anfrage folgt. Sein `AuthnInstant` ist die letzte Anmeldung der Person bei Google, daher meldet sich, wer noch bei Google angemeldet ist, zuerst bei Google ab. |
@tab OpenID Connect
OneUptime sendet `prompt=login` und `max_age=0`, an Microsoft Entra ID nur `prompt=login`, und liest aus dem `auth_time` des ID-Tokens, wann sich die Person angemeldet hat.

| Identitätsanbieter | Was einzustellen ist |
| --- | --- |
| Okta | Nichts: Okta folgt beidem und sendet immer `auth_time`. |
| Microsoft Entra ID | Klicken Sie in der **Token configuration** der App-Registrierung auf **Add optional claim**, wählen Sie **ID** und fügen Sie `auth_time` hinzu: Entra ID sendet es nur als optionalen Claim. Es folgt `prompt=login`. OneUptime sendet ihm kein `max_age`: Microsoft dokumentiert es nicht, und laut Berichten antwortet Entra ID darauf mit einem bereits abgelaufenen ID-Token. |
| Keycloak | Behalten Sie den Client-Scope `basic` am Client: Er enthält `auth_time`. Keycloak 25 und neuer geben jedem Client diesen Scope. |
| Google Workspace | Schalten Sie **Session age claims** für den OAuth-Client unter **Google Auth Platform** > **Settings** > **Advanced Settings** ein; die App muss veröffentlicht und verifiziert sein. Google folgt keiner der beiden Anfragen, daher fragt OneUptime es stattdessen nach `auth_time`, und wer noch bei Google angemeldet ist, meldet sich zuerst bei Google ab. |
:::

## Rollen und Teams für SSO-Benutzer

OneUptime übernimmt keine Rollen oder Gruppen aus Ihrem Identitätsanbieter. Was jemand tun darf, ergibt sich aus den Teams, in denen die Person ist: Ein Anbieter fügt Neue seinen **Teams** hinzu, und Teams und ihre Berechtigungen verwalten Sie in OneUptime, wie es [Benutzer, Teams & Berechtigungen](/docs/permissions/index) beschreibt. Um die Teammitgliedschaft mit Ihrem Identitätsanbieter abzugleichen, verwenden Sie [SCIM](/docs/identity/scim). Jedes Team, dem jemand bei der Anmeldung beitritt, wird auf der Seite **Audit-Protokolle** dieses Teams als Änderung der Person erfasst, die sich angemeldet hat.

Die Teams eines Anbieters bestimmen, was Personen tun dürfen, die sich mit ihm anmelden. Deshalb wird ein Anbieter nur mit Teams gespeichert, in die die speichernde Person jemanden einladen könnte. Jedes Speichern prüft sie erneut: Einen Anbieter, dessen Teams mehr Zugriff geben, als Sie haben, kann nur jemand ändern, dessen Zugriff sie abdeckt, etwa ein Projektinhaber. Anbieter, die vor dieser Prüfung gespeichert wurden, melden Personen weiter in ihren Teams an. Wer einen Anbieter bearbeiten darf, kann ihn weiterhin ausschalten, sodass er sich sofort stoppen lässt.

## Domänen

**Mit SSO anmelden** fragt nach einer E-Mail-Adresse und bietet die Anbieter an, die die Domain dieser Adresse bedienen. Es liest kein Konto: Eine Adresse mit einem Konto in Ihrem Projekt und eine ganz ohne Konto erhalten dieselbe Antwort, die Seite verrät also nicht, wer ein Konto hat. Damit ein Anbieter dort angeboten wird, nennt er die Domänen, die er bedient:

1. Fügen Sie Ihre Domain unter **Projekteinstellungen** > **Erweitert** > **Domänen** hinzu, klicken Sie in ihrer Zeile auf **Domain verifizieren** und tragen Sie den angezeigten TXT-Eintrag in das DNS der Domain ein. Sobald der Eintrag gefunden wird, ist die Domain verifiziert.
2. Bearbeiten Sie den Anbieter und wählen Sie die Domain im Schritt **Anmeldung** unter **Domänen** aus. Nur die verifizierten Domänen des Projekts werden aufgeführt.

**Mit SSO anmelden** bietet den Anbieter dann jeder Adresse in dieser Domain an, egal wer sie eingibt. Die Domain muss genau übereinstimmen: `acme.com` umfasst nicht `eu.acme.com`, fügen Sie also jede Domain hinzu, mit der sich Personen anmelden.

Anbieter, die eingerichtet wurden, bevor es Domänen gab, haben beim Upgrade von OneUptime die verifizierten Domänen ihres Projekts erhalten: jede Domäne, die das Projekt verifiziert hatte, außer einer, die auch ein anderes Projekt verifiziert hatte. Wählen Sie eine solche Domäne selbst aus, wenn sie Ihre ist. Eine Domäne, die hinzugefügt, aber nie verifiziert wurde, hat kein Anbieter erhalten.

Ein Anbieter, der keine verifizierte Domäne nennt, wird dort niemandem angeboten. Seine Spalte **Domänen** zeigt **Keine verifizierte Domäne**, und ein Hinweis über Ihren Anbietern nennt ihn und sagt, was zu tun ist. Solange das Projekt keine verifizierte Domäne hat, öffnet **Eine Domäne verifizieren** im Hinweis die Seite **Domänen**.

Wer eine E-Mail-Adresse auf einer anderen Domäne hat, etwa ein externer Mitarbeiter, findet dort ebenfalls keinen Anbieter. Teilen Sie den SSO-Anmeldelink Ihres Projekts mit dieser Person: Kopieren Sie ihn aus der Karte **SSO-Anmeldelink** unter Ihren Anbietern. Er listet die Anbieter des Projekts auf und fragt nach keiner E-Mail-Adresse, verrät also nicht, wer ein Konto hat. Eine Anmeldung, die bei Ihrem Identitätsanbieter beginnt, funktioniert ebenfalls, egal auf welcher Domäne.

## SSO für Ihr Projekt verlangen

Ein eingerichteter Anbieter hält niemanden davon ab, sich mit einem Passwort anzumelden. Um SSO zum einzigen Weg ins Projekt zu machen, verwenden Sie den Schalter **SSO für die Anmeldung erzwingen** unter **Projekteinstellungen** > **Sicherheit** > **SSO**, unterhalb Ihrer Anbieter:

:::steps
1. Testen Sie zuerst Ihren Anbieter mit dem Link in der Karte **SSO-Anmeldelink**.
2. Schalten Sie **SSO für die Anmeldung erzwingen** ein. OneUptime fragt nach, bevor etwas gespeichert wird: Von da an muss sich jeder im Projekt, Sie eingeschlossen, mit SSO anmelden, um es zu öffnen, und wer mit einem Passwort angemeldet ist, ist aus dem Projekt ausgesperrt, bis er sich mit SSO anmeldet.
3. Klicken Sie zur Bestätigung auf **SSO erzwingen**. Der Schalter speichert sofort; eine eigene Schaltfläche zum Speichern gibt es nicht.
:::

Um **SSO für die Anmeldung erzwingen** einzuschalten, braucht das Projekt einen Anbieter, der Personen in es anmeldet: einen eigenen SAML- oder OIDC-Anbieter, der eingeschaltet ist, oder einen globalen Anbieter, der eingeschaltet ist und Personen in das Projekt anmeldet. Ohne einen solchen lehnt OneUptime ab und sagt, dass Sie zuerst einen Anbieter für das Projekt einschalten und testen sollen. Wählen Sie einen Anbieter, den das Projekt verlangt, muss es einer davon sein, und dasselbe wird gefragt, wenn Sie später einen anderen Anbieter verlangen.

Ein Speichern, das **SSO für die Anmeldung erzwingen** als eingeschaltet sendet, obwohl es schon eingeschaltet ist, oder den Anbieter nennt, den das Projekt bereits verlangt, wird genauso geprüft – die API, Terraform und andere Werkzeuge senden oft bei jedem Speichern alle Einstellungen. Solange das Projekt also keinen Anbieter hat, der Personen anmeldet, oder der verlangte Anbieter seitdem ausgeschaltet wurde, wird ein solches Speichern mit denselben Worten abgelehnt, egal was es sonst ändert: Schalten Sie zuerst einen Anbieter ein, verlangen Sie einen anderen oder schalten Sie **SSO für die Anmeldung erzwingen** aus.

Für ein neues Projekt gilt dieselbe Regel. Es hat noch keinen eigenen Anbieter, daher braucht das Anlegen mit bereits eingeschaltetem **SSO für die Anmeldung erzwingen** – das kann nur ein Master-Admin – einen globalen Anbieter, der eingeschaltet ist und Personen in jedes Projekt anmeldet; ohne ihn wird es mit denselben Worten abgelehnt. Legen Sie das Projekt an, richten Sie seinen Anbieter ein und testen Sie ihn, und schalten Sie dann den Schalter ein.

Solange der ganze Server SSO verlangt (**Admin** > **Einstellungen** > **Single Sign-On** > **SSO für die Anmeldung erfordern**), braucht das Anlegen jedes Projekts ebenfalls einen solchen globalen Anbieter, sonst könnte niemand, auch nicht die Person, die es anlegt, das Projekt öffnen. Ohne ihn wird das Anlegen eines Projekts abgelehnt, und die Meldung bittet darum, dass ein Server-Admin einen einschaltet. Master-Admins können weiterhin Projekte anlegen.

Das Ausschalten von **SSO für die Anmeldung erzwingen** speichert, sobald Sie den Schalter umlegen, und lässt Mitglieder sofort wieder mit ihrem Passwort hinein – es sei denn, jemand schaltet ihn im selben Moment wieder ein; dann kann ein App-Server bis zu einer Minute brauchen, um nachzuziehen. Ändern können ihn Projektinhaber, Projektadministratoren und Mitglieder mit der Berechtigung **Edit Project**; alle anderen sehen den Schalter gesperrt, zusammen mit der Berechtigung, die sie bräuchten.

> [!NOTE]
> Auf OneUptime Cloud braucht das Verlangen von SSO den Plan **Scale**; das Ausschalten funktioniert in jedem Plan. Unterhalb von Scale zeigt **Projekteinstellungen** > **Sicherheit** > **SSO** das Upgrade-Angebot des Plans; ein Projekt, das nach einer Scale-Testphase noch SSO verlangt, findet dort unter dem Angebot auch **SSO für die Anmeldung erzwingen**, damit es ausgeschaltet werden kann. Wieder einschalten erfordert **Scale**.

### Die Anmeldung Ihrer Mitglieder mit SSO verwalten

Das Verlangen von SSO hält die Daten Ihres Projekts hinter Ihrem Identitätsanbieter, doch Ihre Mitglieder können in OneUptime weiterhin ein Passwort, Passkeys und die Zwei-Faktor-Authentifizierung einrichten, wonach Ihr Projekt nie fragt. Solange **SSO für die Anmeldung erzwingen** eingeschaltet ist, verhindert das ein zweiter Schalter darunter, **Anmeldung mit SSO verwalten**.

Die Anmeldung einer Person wird von SSO verwaltet, wenn jedes Projekt, zu dem sie gehört, einschließlich jedes Projekts, zu dem sie eingeladen ist, SSO verlangt und **Anmeldung mit SSO verwalten** eingeschaltet hat. Sie kann dann kein Passwort, keinen Passkey, keinen Sicherheitsschlüssel, keine Authenticator-App, keine Backup-Codes und keine Zwei-Faktor-Authentifizierung einrichten, **Passwort vergessen?** schickt ihr keinen Link, und ihr **Benutzerprofil** nennt ihren Identitätsanbieter, statt diese Einstellungen anzubieten. An der Anmeldung selbst ändert sich nichts: Mit ihrem Passwort meldet sie sich weiterhin bei OneUptime an, und Ihr Projekt verlangt wie bisher SSO.

Die Regel wird jedes Mal geprüft, daher gilt:

- **Jemand in einem Projekt, das die Anmeldung nicht verwaltet**: Sobald die Person Mitglied eines Projekts ist oder zu einem Projekt eingeladen wird, das kein SSO verlangt oder **Anmeldung mit SSO verwalten** nicht eingeschaltet hat, erhält sie ihre Einstellungen zurück, und ihr **Benutzerprofil** nennt dieses Projekt als Grund. Verlässt sie es, wird ihre Anmeldung wieder verwaltet. Ein Konto kann zu vielen Organisationen gehören, daher entscheidet eine Organisation nie über die Projekte einer anderen.
- **Projekte mit unterschiedlichen Anbietern**: Wer in zwei Projekten ist, die beide die Anmeldung verwalten, jedes mit seinem eigenen Identitätsanbieter, wird verwaltet, und sein Profil nennt beide Anbieter.
- **Master-Admins** behalten immer ihre eigenen Einstellungen.
- **Was Personen vorher eingerichtet haben**, bleibt gespeichert und wird von Ihrem Projekt nicht genutzt, bis es gelöscht wird: von den Projektinhabern Ihres Projekts (siehe unten) oder von einem Server-Admin auf der Seite **Authentifizierung** der Person im Admin Dashboard mit **Anmeldeeinstellungen löschen**.

**Anmeldung mit SSO verwalten** speichert, sobald Sie den Schalter umlegen, löscht nichts, und das Ausschalten gibt allen ihre Einstellungen sofort zurück. Wer **SSO für die Anmeldung erzwingen** ändern kann, kann auch diesen Schalter ändern, in denselben Plänen. Ist **SSO für die Anmeldung erzwingen** ausgeschaltet, ist er ausgeblendet und ändert nichts.

### Löschen, was Ihre Mitglieder vorher gespeichert haben

Solange **Anmeldung mit SSO verwalten** eingeschaltet ist, sehen die Projektinhaber Ihres Projekts darunter, wie viele seiner Mitglieder noch ein Passwort oder eine Zwei-Faktor-Authentifizierung in OneUptime gespeichert haben. **Anmeldeeinstellungen löschen** löscht nach einer Rückfrage ihre Passwörter samt allen Links zum Zurücksetzen oder Anmelden, ihre Passkeys, Sicherheitsschlüssel, Authenticator-Apps und Backup-Codes, schaltet die Zwei-Faktor-Authentifizierung aus und beendet die Sitzungen, in denen sie sich ohne SSO angemeldet haben. Das lässt sich nicht rückgängig machen.

Ein Konto kann zu vielen Organisationen gehören, daher können Sie nur die Einstellungen der Personen löschen, für die Ihre Organisation zuständig ist. Ihre Organisation sind die Projekte, die Ihnen gehören: Die Einstellungen einer Person werden nur gelöscht, wenn jedes Projekt, zu dem sie gehört, einschließlich jedes Projekts, zu dem sie eingeladen ist, eines ist, dessen **Projektinhaber** Sie sind, und **Anmeldung mit SSO verwalten** eingeschaltet hat. Alle anderen behalten ihre Einstellungen:

- wer Mitglied eines Projekts ist oder zu einem Projekt eingeladen ist, das Ihnen nicht gehört oder das die Anmeldung nicht mit SSO verwaltet;
- wer zu Ihrem Projekt nur eingeladen ist und ihm noch nicht beigetreten ist;
- Master-Admins und Sie selbst: Ihre eigenen ändern Sie in Ihrem **Benutzerprofil**.

Um eine einzelne Person zu löschen, öffnen Sie **Benutzer**: In der Zeile jeder Person, deren Einstellungen Sie löschen dürfen, steht **Anmeldeeinstellungen gespeichert**, und **Anmeldeeinstellungen löschen** in ihrem Menü löscht nur die Einstellungen dieser Person, nach derselben Regel und nach einer Rückfrage, die auflistet, was entfernt wird.

Jede Person, deren Einstellungen gelöscht wurden, erhält eine E-Mail darüber, was entfernt wurde und dass sie sich jetzt mit SSO anmeldet, und die Audit-Protokolle Ihrer Projekte verzeichnen das Löschen unter Ihrem Namen. Löschen kann nur ein **Projektinhaber**, der im Dashboard angemeldet ist, nie mit einem API-Schlüssel.

## Einen Anbieter ausschalten oder löschen

| Was Sie ändern | Personen, die sich mit dem Anbieter angemeldet haben |
| --- | --- |
| Ausschalten oder löschen | Melden sich bei ihrer nächsten Anfrage erneut mit SSO an, wo SSO verlangt wird |
| Ein neues Zertifikat oder Client-Secret, andere URLs, ein neuer Name oder andere Teams | Bleiben angemeldet |
| Einschalten | Können sich sofort damit anmelden |

Einen SAML- oder OIDC-Anbieter auszuschalten oder zu löschen beendet die Anmeldungen, die er erteilt hat. In einem Projekt, das SSO verlangt – selbst oder weil der ganze Server es tut:

- Wer sich damit angemeldet hat, muss sich bei der nächsten Anfrage erneut mit SSO anmelden, und die geöffneten Seiten erhalten sofort keine Live-Updates mehr.
- Ein MCP-Client, den jemand nach einer Anmeldung damit verbunden hat, funktioniert im Projekt nicht mehr. Verbinden Sie ihn nach einer Anmeldung mit SSO erneut.
- Den Anbieter wieder einzuschalten bringt diese Anmeldungen nicht zurück: Die Personen melden sich erneut damit an.

Alles andere an einem Anbieter zu ändern, lässt alle angemeldet: ein neues Zertifikat oder Client-Secret, andere URLs, ein neuer Name oder andere Teams. Ihre Anmeldungen wurden geprüft, als sie erfolgten, und die nächste Anmeldung verwendet die neuen Einstellungen.

Solange das Projekt SSO verlangt, hält OneUptime einen Weg hinein offen: Sie können den letzten Anbieter, mit dem sich Personen im Projekt anmelden können – globale Anbieter, die Personen in das Projekt anmelden, mitgezählt –, oder den Anbieter, den das Projekt verlangt, weder ausschalten noch löschen. Schalten Sie zuerst **SSO für die Anmeldung erzwingen** aus.

Einen Anbieter einzuschalten lässt Personen sofort damit anmelden.

Wenn der ganze Server SSO verlangt (**Admin** > **Einstellungen** > **Single Sign-On** > **SSO für die Anmeldung erfordern**), behält jedes Projekt auf dieselbe Weise einen Weg hinein, auch eines, das selbst kein SSO verlangt: Schalten Sie zuerst einen anderen Anbieter dafür ein.

Für globale Anbieter gilt dieselbe Regel: Eine Änderung an einem globalen Anbieter oder an seinen zugewiesenen Projekten, die ein Projekt, das SSO verlangt, ohne Anbieter ließe, wird abgelehnt und nennt das Projekt. Siehe [Globales SSO](/docs/identity/global-sso#einen-anbieter-ausschalten-oder-löschen).

Wo weder das Projekt noch der Server SSO verlangt, stoppt das Ausschalten eines Anbieters neue Anmeldungen damit. Wer schon angemeldet ist, bleibt angemeldet, so wie Personen, die sich mit einem Passwort angemeldet haben.

## Anbieter unterhalb des Plans Scale

Ein SAML- oder OIDC-Anbieter, den ein Projekt noch hat, meldet weiter Personen an, nachdem eine Scale-Testphase endet oder der Plan herabgestuft wird. Deshalb listet die Seite **SSO** unterhalb von Scale die Anbieter des Projekts unter dem Upgrade-Angebot auf (**Noch eingerichtete SAML-Anbieter**, **Noch eingerichtete OIDC-Anbieter**):

- **Ausschalten** stoppt einen Anbieter sofort. OneUptime fragt vorher nach.
- **Löschen** entfernt ihn.

Einen Anbieter hinzuzufügen, zu ändern oder wieder einzuschalten erfordert **Scale**. Wer was tun darf, ist dasselbe wie mit Scale: Zum Ausschalten eines Anbieters braucht man die Berechtigung, ihn zu bearbeiten, zum Löschen die Berechtigung, ihn zu löschen.

Solange das Projekt noch SSO verlangt, zeigt seine Seite **SSO** auch **SSO für die Anmeldung erzwingen**: Schalten Sie es aus, bevor Sie den letzten Anbieter ausschalten. Bis dahin lässt sich der letzte Anbieter, mit dem sich Personen anmelden können, weder ausschalten noch löschen, damit niemand aus dem Projekt ausgesperrt wird.

Die Seite **Single Sign-On** einer Statusseite listet deren eigene Anbieter auf dieselbe Weise auf, auf ihren Tabs **SAML** und **OIDC**. Solange die Statusseite noch SSO verlangt, zeigen beide Tabs auch **SSO für die Anmeldung erzwingen**: Schalten Sie es aus, bevor Sie ihre Anbieter ausschalten, sonst können sich ihre privaten Benutzer überhaupt nicht mehr anmelden.

## Fehlerbehebung

:::details "SSO Config not found"
Der Anbieter ist ausgeschaltet, oder der Link gehört zu einem Anbieter, den es nicht mehr gibt. Ein neuer Anbieter ist zunächst ausgeschaltet: Bearbeiten Sie ihn und schalten Sie **Aktiviert** ein.
:::

:::details "No teams added."
Die Person ist noch nicht im Projekt, und der Anbieter hat keine **Teams**, in die sie kommen könnte. Bearbeiten Sie den Anbieter und wählen Sie mindestens ein Team, etwa das Mitglieder-Team Ihres Projekts.
:::

:::details "Issuer URL does not match"
Der Issuer in der Assertion Ihres IdP ist nicht der **Aussteller** des Anbieters. Kopieren Sie ihn erneut aus Ihrem IdP – die Realm-URL von Keycloak, den **Microsoft Entra Identifier** oder den Identity Provider Issuer von Okta –, damit beide genau übereinstimmen.
:::

:::details "SAML Audience does not match"
Die Audience der Antwort ist nicht die **Kennung (Entity ID)** dieses Anbieters; Ihr IdP hat sie für eine andere Anwendung erstellt. Setzen Sie in Ihrem IdP die Entity ID der Anwendung auf die **Kennung (Entity ID)** aus **SSO-Konfiguration anzeigen** – die **Client ID** in Keycloak, die **Identifier (Entity ID)** in Entra ID, die **Audience URI (SP Entity ID)** in Okta. Ein IdP, der mit der Adresse von OneUptime allein als Entity ID eingerichtet wurde, etwa `https://oneuptime.com`, funktioniert weiter.
:::

:::details "SAML Recipient does not match"
Der Recipient der Antwort ist nicht die **Antwort-URL** dieses Anbieters; die Antwort wurde für eine andere Adresse gesendet. Setzen Sie in Ihrem IdP die Antwort-URL der Anwendung auf die **Antwort-URL (Assertion Consumer Service URL)** aus **SSO-Konfiguration anzeigen** – die **Assertion Consumer Service POST Binding URL** in Keycloak, die **Reply URL (Assertion Consumer Service URL)** in Entra ID, die **Single sign-on URL** in Okta. "SAML Destination does not match" hat dieselbe Ursache und dieselbe Lösung.
:::

:::details "SAML response has expired"
Die Antwort hat OneUptime später erreicht, als Ihr IdP erlaubt, oder mehr als 10 Minuten nach ihrer Ausstellung: Melden Sie sich erneut an. Passiert das immer wieder, geht die Uhr Ihres IdP oder des OneUptime-Servers falsch; OneUptime erlaubt, dass sie 3 Minuten auseinanderliegen. "SAML response is not valid yet" ist dasselbe Problem in umgekehrter Richtung.
:::

:::details "SAML response was already used"
Jede Antwort Ihres IdP gilt für genau eine Anmeldung. Wenn Sie nach der Anmeldung im Browser zurückgehen oder die Seite neu laden, über die Ihr IdP Sie weitergeleitet hat, wird dieselbe Antwort erneut gesendet: Melden Sie sich erneut an, über OneUptime oder über Ihren IdP.
:::

:::details "This account is linked to someone else."
Microsoft Entra ID hat jemanden mit der E-Mail-Adresse eines Kontos angemeldet, das über diesen Anbieter mit einer anderen Objekt-ID verknüpft ist: Die Adresse gehört in Entra ID jetzt einer anderen Person, oder das Entra-ID-Konto der Person wurde neu angelegt. OneUptime lehnt die Anmeldung ab, damit niemand, der die Adresse als Nächstes erhält, das Konto nutzen kann. Gehört das Konto dieser Person, entfernen Sie sie aus dem Projekt und fügen Sie sie wieder hinzu: Bei ihrer nächsten Anmeldung wird das Konto mit ihrer neuen Objekt-ID verknüpft.
:::

:::details Die Anmeldung scheitert mit einem Signatur- oder Zertifikatsfehler
Fügen Sie das aktuelle Signaturzertifikat des IdP in **Öffentliches Zertifikat** ein, einschließlich der Zeilen `BEGIN CERTIFICATE` und `END CERTIFICATE`. Laden Sie für Entra ID das Zertifikat im Format **Base64** herunter, nicht das Rohformat; für Okta das aktive Signaturzertifikat; für Keycloak das Zertifikat des richtigen Realms.
:::

:::details "Encrypted SAML Responses are not supported"
OneUptime entschlüsselt keine Assertions. Schalten Sie die Verschlüsselung der Assertions für die Anwendung in Ihrem IdP aus, damit er eine unverschlüsselte, signierte Assertion sendet.
:::

:::details "SAML response did not include a valid email address"
OneUptime liest die E-Mail-Adresse aus der Name ID. Setzen Sie die Name ID auf die E-Mail des Benutzers: **Name ID Format** `email` mit **Force Name ID Format** in Keycloak, den **Unique User Identifier (Name ID)** in Entra ID, oder **Name ID format** `EmailAddress` und **Application username** `Email` in Okta. Die Adresse muss zum OneUptime-Konto der Person passen.
:::

:::details Entra ID: AADSTS700016
Die **Identifier (Entity ID)** in Entra ID stimmt nicht mit der von OneUptime überein. Kopieren Sie sie erneut über **SSO-Konfiguration anzeigen**; beide Werte müssen identisch sein.
:::

:::details Okta: 404 oder eine abweichende Audience
Die **Single sign-on URL** in Okta muss genau die **Antwort-URL** von OneUptime sein und die **Audience URI** genau die **Kennung (Entity ID)** von OneUptime. Prüfen Sie, dass beide die vorläufigen Werte ersetzt haben.
:::

:::details Der Benutzer ist der Anwendung nicht zugewiesen
Entra ID und Okta melden nur Personen an, die der Anwendung zugewiesen sind. Weisen Sie den Benutzer oder eine Gruppe zu, in der er ist.
:::

:::details Keycloak: Weiterleitungsschleife
Prüfen Sie, dass **Valid Redirect URIs** und **Assertion Consumer Service POST Binding URL** wie oben gesetzt sind, am Client im richtigen Realm.
:::

## Nächste Schritte

:::cards
- [Globales SSO](/docs/identity/global-sso): Ein Identitätsanbieter für jedes Projekt einer selbst gehosteten Instanz.
- [SCIM](/docs/identity/scim): Ihren Identitätsanbieter Personen automatisch hinzufügen und entfernen lassen.
- [Benutzer, Teams & Berechtigungen](/docs/permissions/index): Was die Teams, in die Neue kommen, ihnen erlauben.
:::
