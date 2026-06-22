# Global SSO (Single Sign-On a livello di istanza)

Global SSO consente a un **amministratore di istanza** di OneUptime (master admin) di configurare un singolo provider di identità SAML 2.0 o OpenID Connect (OIDC) **una sola volta a livello di istanza** e di collegarlo a qualsiasi progetto sul server. È la controparte a livello di istanza dell'SSO per singolo progetto: invece di far configurare a ogni proprietario di progetto il proprio provider di identità, un master admin ne configura uno che può servire l'intera istanza.

Global SSO è una funzionalità della **OneUptime Enterprise Edition** ed è disponibile solo sulle istanze che eseguono la build Enterprise Edition.

## Global SSO vs. SSO di Progetto

|                        | SSO di Progetto                                         | Global SSO                                              |
| ---------------------- | ------------------------------------------------------- | ------------------------------------------------------- |
| Configurato da         | Proprietario/admin del progetto (Impostazioni Progetto) | Master admin dell'istanza (Admin Dashboard)             |
| Ambito                 | Un singolo progetto                                     | L'intera istanza — collegabile a qualsiasi progetto     |
| Risultato dell'accesso | Accesso a quell'unico progetto                          | Accesso a tutti i progetti che l'utente può raggiungere |

## Configurazione di Global SSO

1. **Apri l'Admin Dashboard**

   - Accedi come master admin e apri **Admin** > **Settings** > **Global SSO** (per SAML) o **Global OIDC** (per OpenID Connect).

2. **Crea un provider**

   - Clicca su **Create Global SSO**.
   - Per SAML: inserisci un **Name**, il **Sign On URL** e l'**Issuer** dal tuo provider di identità, e incolla il **Public Certificate**. Scegli i metodi **Signature** e **Digest** (lascia i valori predefiniti — `RSA-SHA256` / `SHA256` — se hai dubbi).
   - Per OIDC: inserisci il **Discovery URL**, l'**Issuer**, il **Client ID**, il **Client Secret**, gli **Scopes** (devono includere `openid`) e i nomi delle attestazioni **email** / **name**.

3. **Copia gli URL di OneUptime nel tuo provider di identità**

   - Apri il provider (clicca sulla sua riga nell'elenco) per visualizzare la scheda **Identity Provider URLs**.
   - Per SAML, copia l'**ACS URL (Reply URL)** e l'**Issuer (Entity ID)** nel tuo IdP (Okta, Azure AD, OneLogin, JumpCloud e altri).
   - Per OIDC, copia il **Redirect URI** nell'elenco dei redirect consentiti del tuo IdP.

4. **Verifica il provider**
   - Usa il link **Test this SSO provider** nella pagina del provider per eseguire un accesso end-to-end attraverso il tuo provider di identità. Il provider deve essere **abilitato** affinché il link funzioni. Abilitare un provider globale aggiunge solo un'opzione "Sign in with SSO" nella pagina di login — non forza mai l'SSO né blocca l'accesso a nessuno, quindi è sicuro abilitarlo, testarlo e disabilitarlo di nuovo se necessario.

## Come Accedono gli Utenti

Il comportamento di un provider globale dipende dal fatto che tu vi colleghi o meno dei progetti:

- **Nessun progetto collegato (default-all / invito prioritario):** Gli utenti possono accedere con il provider e raggiungere **qualsiasi progetto di cui sono già membri**. I nuovi utenti **non** vengono creati automaticamente — un utente deve prima essere invitato a un progetto. Usa questa modalità per un SSO a livello aziendale in cui le appartenenze sono gestite altrove.

- **Progetti collegati (provisioning automatico):** Apri il provider e usa la tabella **Attached Projects** per collegare uno o più progetti, ciascuno con un insieme di team predefiniti. Gli utenti che accedono vengono **provisionati automaticamente** in quei progetti e aggiunti ai team predefiniti al primo accesso. Aggiungi un progetto + team alla volta per costruire l'elenco; per modificare un collegamento, eliminalo e aggiungilo di nuovo.

Se vuoi impedire qualsiasi creazione automatica di account anche quando i progetti sono collegati, abilita **Disable Sign Up with SSO** sul provider — gli utenti dovranno quindi essere invitati prima di poter accedere.

## Imposizione dell'SSO

Configurare un provider globale non obbliga nessuno a usarlo; l'accesso con password continua a funzionare. Per richiedere l'SSO, usa i controlli **Require SSO for Login**:

- **Per progetto:** un progetto può richiedere l'SSO e, facoltativamente, richiedere un provider _specifico_ (di progetto o globale).
- **A livello di istanza:** **Admin** > **Settings** > **Authentication** dispone di un interruttore **Require SSO for Login** che forza l'SSO per ogni utente dell'intera istanza. I master admin restano esenti per non rischiare di rimanere bloccati fuori.

## Correlati

- [SSO (SSO di Progetto)](/docs/identity/sso)
- [SCIM](/docs/identity/scim)
