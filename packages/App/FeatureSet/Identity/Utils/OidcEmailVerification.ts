/*
 * ---------------------------------------------------------------------------
 * AN OPENID CONNECT SIGN-IN NEVER USES AN ADDRESS ITS PROVIDER SAYS IT HAS
 * NOT VERIFIED (GHSA-8gwc-w386-fh6w).
 *
 * OneUptime finds the account an OpenID Connect sign-in is for by the email
 * address the provider sends, and makes one with it where sign-up is open:
 * the server's own providers (API/GlobalOIDC.ts) and a project's
 * (API/OIDC.ts), on the web and in the mobile app. So the address is the
 * account. A provider may let its users put an address on their account
 * without proving they read its mail - Keycloak with Verify Email off lets
 * a user change it in the account console, Auth0 takes one at sign-up,
 * Cognito and authentik let a user change theirs - and says so with the
 * standard claim email_verified: false (OpenID Connect Core 5.1).
 * Taken as it came, that address signed its taker in to the account that
 * has it, administrators' included, or made an account with it, marked
 * verified, that the address's owner would later find and use while the
 * taker still signed in to it.
 *
 * So an ID token whose provider says it has not verified the address -
 * email_verified false, or a value that says neither true nor false - signs
 * nobody in, whoever the address is: not an existing account, an
 * administrator's or anyone's, and not a new one. It is decided from the
 * provider's answer alone, before any account is read, made, provisioned or
 * emailed, so the answer is the same whether an account has the address
 * (./OidcEmailVerificationGate). The person is told to have the address
 * verified at their identity provider, and the attempt is in the audit
 * logs of the account at the address, as a wrong password would be.
 *
 * A provider that says nothing of it signs in as before: Microsoft Entra ID
 * sends no email_verified in its ID tokens, and leaves out of `email` an
 * address on a domain its tenant has not verified instead; AD FS sends none
 * either. Requiring a true would lock every such provider's people out. And
 * the claim speaks of `email` only, so a provider set up to read the address
 * from another claim (upn, preferred_username) is taken as it always was.
 *
 * What OneUptime cannot see it cannot refuse: a provider that lets its
 * users change their address and still calls it verified (authentik before
 * 2025.10 did, by default) must not be trusted with sign-in by address.
 *
 * The verification is read from the claims the address came from: the ID
 * token's, or the userinfo endpoint's when the address came from there
 * (Utils/OIDC.exchangeCodeAndValidate).
 *
 * A status page's, a dashboard's and a form's OpenID Connect sign-ins
 * (StatusPageOIDC, DashboardOIDC, FormOIDC) make a private user of
 * everyone their provider signs in, and every private user of one sees
 * what the others see: an address taken there reaches nothing its taker's
 * own does not, so those sign-ins are left as they are.
 * ---------------------------------------------------------------------------
 */

// The standard claims (OpenID Connect Core 5.1).
export const STANDARD_EMAIL_CLAIM: string = "email";
export const EMAIL_VERIFIED_CLAIM: string = "email_verified";

// What an OpenID Connect provider says of the address it sent.
export enum ProviderEmailVerification {
  // email_verified: true - or "true", as Google and Cognito have sent it.
  Verified = "verified",
  // email_verified: false, or "false".
  Unverified = "unverified",
  // Something that is neither: OneUptime cannot tell, so it is not taken as verified.
  Unreadable = "unreadable",
  // No email_verified, or an address read from another claim, which it does not speak of.
  NotStated = "not-stated",
}

// What a sign-in it refuses tells the person.
export const PROVIDER_EMAIL_NOT_VERIFIED_TITLE: string =
  "Your identity provider did not confirm your email address.";

export const PROVIDER_EMAIL_NOT_VERIFIED_MESSAGE: string =
  "OneUptime signs you in with the email address your identity provider sends, once your identity provider says it has verified it. Verify your email address with your identity provider, or ask your administrator to mark it verified there, then sign in again.";

// The same, as the reason code on the mobile app's deep link.
export const PROVIDER_EMAIL_NOT_VERIFIED_ERROR: string =
  "provider_email_not_verified";

const TRUE_WORDS: ReadonlyArray<string> = ["true", "1"];
const FALSE_WORDS: ReadonlyArray<string> = ["false", "0"];

export default class OidcEmailVerification {
  /*
   * What the provider says of the address: the email_verified value that
   * came with it, read when the address is the standard `email` claim. A
   * boolean, as the specification has it, or a string or a number some
   * providers send instead; nothing at all, or null, says nothing.
   */
  public static read(data: {
    emailClaimName: string;
    emailVerified: unknown;
  }): ProviderEmailVerification {
    if (data.emailClaimName !== STANDARD_EMAIL_CLAIM) {
      return ProviderEmailVerification.NotStated;
    }

    const value: unknown = data.emailVerified;

    if (value === undefined || value === null) {
      return ProviderEmailVerification.NotStated;
    }

    if (value === true || value === 1) {
      return ProviderEmailVerification.Verified;
    }

    if (value === false || value === 0) {
      return ProviderEmailVerification.Unverified;
    }

    if (typeof value === "string") {
      const word: string = value.trim().toLowerCase();

      if (TRUE_WORDS.includes(word)) {
        return ProviderEmailVerification.Verified;
      }

      if (FALSE_WORDS.includes(word)) {
        return ProviderEmailVerification.Unverified;
      }
    }

    return ProviderEmailVerification.Unreadable;
  }

  /*
   * Whether the address may not sign anyone in: the provider says it has
   * not verified it, or says something OneUptime cannot read.
   */
  public static refusesSignIn(
    verification: ProviderEmailVerification,
  ): boolean {
    return (
      verification === ProviderEmailVerification.Unverified ||
      verification === ProviderEmailVerification.Unreadable
    );
  }
}
