/*
 * SIGNING IN WITH A SECURITY KEY SAYS NOTHING ABOUT WHO HAS ONE (#9822).
 *
 * A security key - a USB or NFC key, or a phone's or computer's own
 * fingerprint, face or screen lock - is the second step of a sign-in with a
 * password or an emailed link. Unlike a passkey it is not discoverable: the
 * browser's prompt can only find it when the server names the key's
 * credential id, so the options for the prompt are made for one account.
 *
 * They used to come from an anonymous route that took an email address
 * alone (POST /api/user-webauthn/generate-authentication-options): "No
 * security key is available for this account." for an address with no
 * account or no key, and the options, naming the account's keys, for one
 * with a key. So anyone could learn which addresses had an account and which
 * accounts used a security key, and could overwrite the challenge a person
 * signing in was about to sign.
 *
 * The options now come from the sign-in itself: POST
 * /identity/security-key-sign-in-options carries the email and password
 * again (or the sign-in link's token), as every second step does, and passes
 * every check /login makes. An address with no account, an account with no
 * password yet and a wrong password are refused alike, with the words and
 * after the work of a wrong password (#9745), so asking without the password
 * says nothing about the address. Only somebody who has proved the account
 * is told whether it has a key, and only their sign-in writes its
 * challenge. Passkeys need none of this: they are discoverable, and their
 * sign-in takes no address at all.
 */

// Under the identity server's address (IDENTITY_URL).
export const SECURITY_KEY_SIGN_IN_OPTIONS_ROUTE: string =
  "/security-key-sign-in-options";
