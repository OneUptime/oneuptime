import crypto from "crypto";

/*
 * THE KEY OBJECT JSONWEBTOKEN MAKES OF A KEY, MADE ONCE.
 *
 * jsonwebtoken turns a key given as text into a KeyObject on every sign and
 * every verify: it reads the text as a private key (to sign) or a public key
 * (to verify), which throws for a shared secret, and then makes a secret key
 * of it. OneUptime signs and verifies with a shared secret
 * (TokenSigningKey), so every request with a session cookie paid for a
 * failed key parse and a thrown error: about 32 microseconds a verify and 23
 * a sign, against 8 and 6 with the key object at hand.
 *
 * These make the same KeyObject, the same way, once per key text, so a token
 * is signed and checked exactly as before (JsonWebTokenKeys.test.ts). Text
 * jsonwebtoken cannot make a key of - an empty key - is handed back as it is,
 * for jsonwebtoken to refuse with its own error.
 */

type KeyOf = (key: string) => crypto.KeyObject;

interface CachedKey {
  text: string;
  keyObject: crypto.KeyObject | null;
}

function makeKey(text: string, asymmetric: KeyOf): crypto.KeyObject | null {
  if (!text) {
    return null;
  }

  try {
    return asymmetric(text);
  } catch {
    // Not an asymmetric key: a shared secret, as jsonwebtoken reads it next.
  }

  try {
    return crypto.createSecretKey(Buffer.from(text));
  } catch {
    return null;
  }
}

export default class JsonWebTokenKeys {
  private static signingKey: CachedKey | null = null;
  private static verifyingKey: CachedKey | null = null;

  // What jsonwebtoken's sign makes of `key`: a private key, else a secret.
  public static forSigning(key: string): crypto.KeyObject | string {
    let cached: CachedKey | null = JsonWebTokenKeys.signingKey;

    if (!cached || cached.text !== key) {
      cached = {
        text: key,
        keyObject: makeKey(key, (text: string): crypto.KeyObject => {
          return crypto.createPrivateKey(text);
        }),
      };
      JsonWebTokenKeys.signingKey = cached;
    }

    return cached.keyObject || key;
  }

  // What jsonwebtoken's verify makes of `key`: a public key, else a secret.
  public static forVerifying(key: string): crypto.KeyObject | string {
    let cached: CachedKey | null = JsonWebTokenKeys.verifyingKey;

    if (!cached || cached.text !== key) {
      cached = {
        text: key,
        keyObject: makeKey(key, (text: string): crypto.KeyObject => {
          return crypto.createPublicKey(text);
        }),
      };
      JsonWebTokenKeys.verifyingKey = cached;
    }

    return cached.keyObject || key;
  }
}
