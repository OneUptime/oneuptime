# Global SSO (Instansdækkende Single Sign-On)

Global SSO giver en OneUptime **instansadministrator** (master-administrator) mulighed for at konfigurere en enkelt SAML 2.0- eller OpenID Connect (OIDC)-identitetsudbyder **én gang på instansniveau** og forbinde den til ethvert projekt på serveren. Det er instansdækkende sidestykke til SSO pr. projekt: i stedet for at hver projektejer konfigurerer sin egen identitetsudbyder, opsætter en master-administrator én, der kan betjene hele instansen.

Global SSO er en **OneUptime Enterprise Edition**-funktion og er kun tilgængelig på instanser, der kører Enterprise Edition-builden.

## Global SSO vs. Projekt-SSO

|                   | Projekt-SSO                                      | Global SSO                                         |
| ----------------- | ------------------------------------------------ | -------------------------------------------------- |
| Konfigureret af   | Projektejer/administrator (Projektindstillinger) | Instansens master-administrator (Admin Dashboard)  |
| Omfang            | Et enkelt projekt                                | Hele instansen — kan forbindes til ethvert projekt |
| Resultat af login | Adgang til det ene projekt                       | Adgang til alle projekter, brugeren kan nå         |

## Opsætning af Global SSO

1. **Åbn Admin Dashboard**

   - Log ind som master-administrator og åbn **Admin** > **Indstillinger** > **Global SSO** (for SAML) eller **Global OIDC** (for OpenID Connect).

2. **Opret en udbyder**

   - Klik på **Opret Global SSO**.
   - For SAML: indtast et **Navn**, **Sign On URL** og **Udsteder** (Issuer) fra din identitetsudbyder, og indsæt det **Offentlige certifikat**. Vælg metoderne for **Signatur** og **Digest** (behold standardværdierne — `RSA-SHA256` / `SHA256` — hvis du er i tvivl).
   - For OIDC: indtast **Discovery URL**, **Issuer**, **Client ID**, **Client Secret**, **Scopes** (skal indeholde `openid`) og claim-navnene for **email** / **name**.

3. **Kopiér OneUptime-URL'erne ind i din identitetsudbyder**

   - Åbn udbyderen (klik på dens række i listen) for at vise kortet **Identity Provider URLs**.
   - For SAML skal du kopiere **ACS URL (Reply URL)** og **Issuer (Entity ID)** ind i din IdP (Okta, Azure AD, OneLogin, JumpCloud med flere).
   - For OIDC skal du kopiere **Redirect URI** ind i din IdP's liste over tilladte omdirigeringer.

4. **Test udbyderen**
   - Brug linket **Test this SSO provider** på udbyderens side til at køre et komplet login gennem din identitetsudbyder. Udbyderen skal være **aktiveret**, for at linket virker. Aktivering af en global udbyder tilføjer kun en "Sign in with SSO"-mulighed på loginsiden — den tvinger aldrig SSO igennem og låser ingen ude, så det er sikkert at aktivere, teste og deaktivere igen efter behov.

## Sådan logger brugere ind

Hvordan en global udbyder opfører sig, afhænger af, om du tilknytter projekter til den:

- **Ingen projekter tilknyttet (default-all / invite-first):** Brugere kan logge ind med udbyderen og nå **ethvert projekt, de allerede er medlem af**. Nye brugere oprettes **ikke** automatisk — en bruger skal først inviteres til et projekt. Brug dette til virksomhedsdækkende SSO, hvor medlemskaber administreres et andet sted.

- **Projekter tilknyttet (automatisk klargøring):** Åbn udbyderen og brug tabellen **Attached Projects** til at tilknytte et eller flere projekter, hver med et sæt standardteams. Brugere, der logger ind, **klargøres automatisk** i disse projekter og tilføjes til standardteamene ved første login. Tilføj ét projekt + teams ad gangen for at opbygge listen; for at ændre en tilknytning skal du slette den og tilføje den igen.

Hvis du vil forhindre enhver automatisk oprettelse af konti, selv når projekter er tilknyttet, skal du aktivere **Disable Sign Up with SSO** på udbyderen — brugere skal derefter inviteres, før de kan logge ind.

## Håndhævelse af SSO

Konfiguration af en global udbyder tvinger ikke nogen til at bruge den; login med adgangskode fungerer stadig. For at kræve SSO skal du bruge kontrollerne **Require SSO for Login**:

- **Pr. projekt:** et projekt kan kræve SSO og eventuelt kræve en _specifik_ udbyder (projekt eller global).
- **Instansdækkende:** **Admin** > **Indstillinger** > **Autentificering** har en **Require SSO for Login**-kontakt, der tvinger SSO igennem for alle brugere på tværs af instansen. Master-administratorer forbliver undtaget, så de ikke kan blive låst ude.

## Relateret

- [SSO (Projekt-SSO)](/docs/identity/sso)
- [SCIM](/docs/identity/scim)
