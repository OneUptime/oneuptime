# Global SSO (Instansomfattende Single Sign-On)

Global SSO lar en OneUptime **instansadministrator** (master-admin) konfigurere én enkelt SAML 2.0- eller OpenID Connect (OIDC)-identitetsleverandør **én gang på instansnivå** og koble den til hvilket som helst prosjekt på serveren. Det er den instansomfattende motparten til SSO per prosjekt: i stedet for at hver prosjekteier konfigurerer sin egen identitetsleverandør, setter en master-admin opp én som kan betjene hele instansen.

Global SSO er en funksjon i **OneUptime Enterprise Edition** og er kun tilgjengelig på instanser som kjører Enterprise Edition-bygget.

## Global SSO vs. prosjekt-SSO

| | Prosjekt-SSO | Global SSO |
|---|---|---|
| Konfigurert av | Prosjekteier/-admin (Prosjektinnstillinger) | Instansens master-admin (Admin Dashboard) |
| Omfang | Et enkelt prosjekt | Hele instansen — koblbar til hvilket som helst prosjekt |
| Resultat av innlogging | Tilgang til det ene prosjektet | Tilgang til alle prosjekter brukeren kan nå |

## Konfigurere Global SSO

1. **Åpne Admin Dashboard**
   - Logg inn som master-admin og åpne **Admin** > **Innstillinger** > **Global SSO** (for SAML) eller **Global OIDC** (for OpenID Connect).

2. **Opprett en leverandør**
   - Klikk **Opprett Global SSO**.
   - For SAML: skriv inn et **Navn**, **Sign On URL** og **Issuer** fra identitetsleverandøren din, og lim inn **Offentlig sertifikat**. Velg metodene for **Signatur** og **Sammendrag** (la standardverdiene stå — `RSA-SHA256` / `SHA256` — hvis du er usikker).
   - For OIDC: skriv inn **Discovery URL**, **Issuer**, **Client ID**, **Client Secret**, **Scopes** (må inkludere `openid`) og kravnavnene for **email** / **name**.

3. **Kopier OneUptime-URL-ene inn i identitetsleverandøren din**
   - Åpne leverandøren (klikk på raden dens i listen) for å vise kortet **Identity Provider URLs**.
   - For SAML, kopier **ACS URL (Reply URL)** og **Issuer (Entity ID)** inn i IdP-en din (Okta, Azure AD, OneLogin, JumpCloud med flere).
   - For OIDC, kopier **Redirect URI** inn i listen over tillatte omdirigeringer i IdP-en din.

4. **Test leverandøren**
   - Bruk lenken **Test this SSO provider** på leverandørens side for å kjøre en fullstendig innlogging gjennom identitetsleverandøren din. Leverandøren må være **aktivert** for at lenken skal fungere. Å aktivere en global leverandør legger bare til et «Logg inn med SSO»-alternativ på innloggingssiden — det tvinger aldri frem SSO eller utestenger noen, så det er trygt å aktivere, teste og deaktivere igjen ved behov.

## Hvordan brukere logger inn

Hvordan en global leverandør oppfører seg avhenger av om du knytter noen prosjekter til den:

- **Ingen prosjekter knyttet til (standard-alle / invitasjon-først):** Brukere kan logge inn med leverandøren og nå **ethvert prosjekt de allerede er medlem av**. Nye brukere opprettes **ikke** automatisk — en bruker må først inviteres til et prosjekt. Bruk dette for bedriftsomfattende SSO der medlemskap administreres et annet sted.

- **Prosjekter knyttet til (automatisk klargjøring):** Åpne leverandøren og bruk tabellen **Attached Projects** for å knytte til ett eller flere prosjekter, hvert med et sett standardteam. Brukere som logger inn blir **automatisk klargjort** inn i disse prosjektene og lagt til i standardteamene ved første innlogging. Legg til ett prosjekt + team om gangen for å bygge listen; for å endre en tilknytning, slett den og legg den til på nytt.

Hvis du vil forhindre all automatisk kontoopprettelse selv når prosjekter er knyttet til, aktiver **Disable Sign Up with SSO** på leverandøren — brukere må da inviteres før de kan logge inn.

## Håndheve SSO

Å konfigurere en global leverandør tvinger ingen til å bruke den; passordinnlogging fungerer fortsatt. For å kreve SSO, bruk kontrollene **Require SSO for Login**:

- **Per prosjekt:** et prosjekt kan kreve SSO, og eventuelt kreve en *bestemt* leverandør (prosjekt eller global).
- **Instansomfattende:** **Admin** > **Innstillinger** > **Autentisering** har en **Require SSO for Login**-bryter som tvinger frem SSO for alle brukere på tvers av instansen. Master-admins forblir unntatt slik at de ikke kan bli utestengt.

## Relatert

- [SSO (prosjekt-SSO)](/docs/identity/sso)
- [SCIM](/docs/identity/scim)
