# Global SSO (Instansövergripande Single Sign-On)

Global SSO låter en OneUptime **instansadministratör** (master admin) konfigurera en enda SAML 2.0- eller OpenID Connect (OIDC)-identitetsleverantör **en gång på instansnivå** och ansluta den till valfritt projekt på servern. Det är den instansövergripande motsvarigheten till SSO per projekt: istället för att varje projektägare konfigurerar sin egen identitetsleverantör, sätter en master admin upp en som kan betjäna hela instansen.

Global SSO är en funktion i **OneUptime Enterprise Edition** och är endast tillgänglig på instanser som kör Enterprise Edition-bygget.

## Global SSO jämfört med Project SSO

|                         | Project SSO                                       | Global SSO                                             |
| ----------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| Konfigureras av         | Projektägare/administratör (Projektinställningar) | Instansens master admin (Admin Dashboard)              |
| Omfattning              | Ett enskilt projekt                               | Hela instansen — anslutningsbar till valfritt projekt  |
| Resultat vid inloggning | Åtkomst till det enda projektet                   | Åtkomst till alla projekt användaren har tillgång till |

## Konfigurera Global SSO

1. **Öppna Admin Dashboard**

   - Logga in som master admin och öppna **Admin** > **Settings** > **Global SSO** (för SAML) eller **Global OIDC** (för OpenID Connect).

2. **Skapa en leverantör**

   - Klicka på **Create Global SSO**.
   - För SAML: ange ett **Name**, **Sign On URL** och **Issuer** från din identitetsleverantör, och klistra in **Public Certificate**. Välj **Signature**- och **Digest**-metoderna (behåll standardvärdena — `RSA-SHA256` / `SHA256` — om du är osäker).
   - För OIDC: ange **Discovery URL**, **Issuer**, **Client ID**, **Client Secret**, **Scopes** (måste inkludera `openid`), och claim-namnen för **email** / **name**.

3. **Kopiera OneUptime-URL:erna till din identitetsleverantör**

   - Öppna leverantören (klicka på dess rad i listan) för att visa kortet **Identity Provider URLs**.
   - För SAML, kopiera **ACS URL (Reply URL)** och **Issuer (Entity ID)** till din IdP (Okta, Azure AD, OneLogin, JumpCloud med flera).
   - För OIDC, kopiera **Redirect URI** till din IdP:s lista över tillåtna omdirigeringar.

4. **Testa leverantören**
   - Använd länken **Test this SSO provider** på leverantörens sida för att köra en heltäckande inloggning genom din identitetsleverantör. Leverantören måste vara **aktiverad** för att länken ska fungera. Att aktivera en global leverantör lägger endast till ett "Sign in with SSO"-alternativ på inloggningssidan — det tvingar aldrig fram SSO eller låser ute någon, så det är säkert att aktivera, testa och inaktivera igen vid behov.

## Hur användare loggar in

Hur en global leverantör beter sig beror på om du ansluter några projekt till den:

- **Inga projekt anslutna (default-all / invite-first):** Användare kan logga in med leverantören och nå **alla projekt de redan är medlemmar i**. Nya användare skapas **inte** automatiskt — en användare måste först bjudas in till ett projekt. Använd detta för företagsövergripande SSO där medlemskap hanteras på annat håll.

- **Projekt anslutna (auto-provisionering):** Öppna leverantören och använd tabellen **Attached Projects** för att ansluta ett eller flera projekt, vart och ett med en uppsättning standardteam. Användare som loggar in **auto-provisioneras** in i dessa projekt och läggs till i standardteamen vid första inloggningen. Lägg till ett projekt + team i taget för att bygga listan; för att ändra en anslutning, radera den och lägg till den igen.

Om du vill förhindra all automatisk kontoskapande även när projekt är anslutna, aktivera **Disable Sign Up with SSO** på leverantören — användare måste då bjudas in innan de kan logga in.

## Tvinga fram SSO

Att konfigurera en global leverantör tvingar ingen att använda den; lösenordsinloggning fungerar fortfarande. För att kräva SSO, använd kontrollerna **Require SSO for Login**:

- **Per projekt:** ett projekt kan kräva SSO, och valfritt kräva en _specifik_ leverantör (projekt eller global).
- **Instansövergripande:** **Admin** > **Settings** > **Authentication** har en växel **Require SSO for Login** som tvingar fram SSO för varje användare i hela instansen. Master admins förblir undantagna så att de inte kan låsas ute.

## Relaterat

- [SSO (Project SSO)](/docs/identity/sso)
- [SCIM](/docs/identity/scim)
