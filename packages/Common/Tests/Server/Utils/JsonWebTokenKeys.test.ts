import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import JsonWebTokenKeys from "../../../Server/Utils/JsonWebTokenKeys";
import TokenSigningKey from "../../../Server/Utils/TokenSigningKey";
import { JSONObject } from "../../../Types/JSON";
import { fastestRun, FastestRun } from "../../Helpers/FastestRun";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import crypto from "crypto";
import jwt from "jsonwebtoken";

jest.mock("../../../Server/Utils/Logger");

/*
 * JsonWebTokenKeys makes the KeyObject jsonwebtoken makes of a key given as
 * text - once per key, instead of on every sign and verify, where reading a
 * shared secret as a private or public key first threw every time.
 *
 * Held here: the key objects are the ones jsonwebtoken itself makes (a
 * private or public key for PEM text, a secret key for anything else) and
 * the same object for the same text; text it cannot make a key of comes
 * back as it is; a token signed with them is byte for byte the one the text
 * signs, and each verifies what the other signs; a new key text makes a new
 * key; JsonWebToken signs and verifies through them with TokenSigningKey;
 * and a verify and a sign are several times faster with them.
 */

function secretOf(keyObject: crypto.KeyObject | string): string {
  if (typeof keyObject === "string") {
    return `text:${keyObject}`;
  }

  return `${keyObject.type}:${keyObject.export().toString("hex")}`;
}

describe("JsonWebTokenKeys", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a shared secret becomes the secret key jsonwebtoken makes of it", () => {
    const secret: string = crypto.randomBytes(32).toString("hex");

    for (const keyObject of [
      JsonWebTokenKeys.forSigning(secret),
      JsonWebTokenKeys.forVerifying(secret),
    ]) {
      expect(typeof keyObject).toBe("object");
      expect((keyObject as crypto.KeyObject).type).toBe("secret");
      expect(secretOf(keyObject)).toBe(
        secretOf(crypto.createSecretKey(Buffer.from(secret))),
      );
    }
  });

  test("the same key text gives the same key object, and a new one a new one", () => {
    const first: string = crypto.randomBytes(32).toString("hex");
    const second: string = crypto.randomBytes(32).toString("hex");

    expect(JsonWebTokenKeys.forSigning(first)).toBe(
      JsonWebTokenKeys.forSigning(first),
    );
    expect(JsonWebTokenKeys.forVerifying(first)).toBe(
      JsonWebTokenKeys.forVerifying(first),
    );

    const firstKey: crypto.KeyObject | string =
      JsonWebTokenKeys.forSigning(first);
    const secondKey: crypto.KeyObject | string =
      JsonWebTokenKeys.forSigning(second);

    expect(secondKey).not.toBe(firstKey);
    expect(secretOf(secondKey)).toBe(
      secretOf(crypto.createSecretKey(Buffer.from(second))),
    );
    // Back to the first text: its own key again.
    expect(secretOf(JsonWebTokenKeys.forSigning(first))).toBe(
      secretOf(firstKey),
    );
  });

  test("PEM text becomes the private or public key jsonwebtoken reads it as", () => {
    const pair: crypto.KeyPairSyncResult<string, string> =
      crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });

    const signing: crypto.KeyObject = JsonWebTokenKeys.forSigning(
      pair.privateKey,
    ) as crypto.KeyObject;
    const verifying: crypto.KeyObject = JsonWebTokenKeys.forVerifying(
      pair.publicKey,
    ) as crypto.KeyObject;

    expect(signing.type).toBe("private");
    expect(verifying.type).toBe("public");

    const token: string = jwt.sign({ a: 1 }, pair.privateKey, {
      algorithm: "RS256",
    });

    expect(
      (jwt.verify(token, verifying as unknown as jwt.Secret) as JSONObject)[
        "a"
      ],
    ).toBe(1);
  });

  test("text no key can be made of comes back as it is, for jsonwebtoken to refuse", () => {
    expect(JsonWebTokenKeys.forSigning("")).toBe("");
    expect(JsonWebTokenKeys.forVerifying("")).toBe("");
    expect(() => {
      jwt.sign({ a: 1 }, JsonWebTokenKeys.forSigning("") as jwt.Secret);
    }).toThrow("secretOrPrivateKey must have a value");
  });

  test("a token signed with the key object is the one the text signs, and each verifies the other's", () => {
    const secret: string = crypto.randomBytes(32).toString("hex");
    const payload: JSONObject = {
      userId: "b02ec151-fa14-4ea7-92d4-d00f9c6d6582",
      purpose: "user-session",
      iat: 1793107103,
      exp: 1793108003,
    };

    const withText: string = jwt.sign(payload, secret);
    const withKey: string = jwt.sign(
      payload,
      JsonWebTokenKeys.forSigning(secret) as jwt.Secret,
    );

    expect(withKey).toBe(withText);

    const verifyKey: jwt.Secret = JsonWebTokenKeys.forVerifying(
      secret,
    ) as jwt.Secret;

    expect(
      jwt.verify(withText, verifyKey, { ignoreExpiration: true }),
    ).toEqual(payload);
    expect(jwt.verify(withKey, secret, { ignoreExpiration: true })).toEqual(
      payload,
    );

    // A token signed with another secret is refused either way.
    const forged: string = jwt.sign(payload, `${secret}x`);

    expect(() => {
      jwt.verify(forged, verifyKey, { ignoreExpiration: true });
    }).toThrow("invalid signature");
    expect(() => {
      jwt.verify(forged, secret, { ignoreExpiration: true });
    }).toThrow("invalid signature");

    // So is an unsigned one, as with the text.
    const unsigned: string = jwt.sign(payload, "", { algorithm: "none" });

    expect(() => {
      jwt.verify(unsigned, verifyKey, { ignoreExpiration: true });
    }).toThrow("jwt signature is required");
  });

  test("JsonWebToken signs and verifies with TokenSigningKey through them", () => {
    const signing: ReturnType<typeof jest.spyOn> = jest.spyOn(
      JsonWebTokenKeys,
      "forSigning",
    );
    const verifying: ReturnType<typeof jest.spyOn> = jest.spyOn(
      JsonWebTokenKeys,
      "forVerifying",
    );

    const token: string = JSONWebToken.signJsonPayload({ hello: "world" }, 60);
    const decoded: JSONObject = JSONWebToken.decodeJsonPayload(token);

    expect(decoded["hello"]).toBe("world");
    expect(signing).toHaveBeenCalledWith(TokenSigningKey.get());
    expect(verifying).toHaveBeenCalledWith(TokenSigningKey.get());

    // And the token is what the text of TokenSigningKey verifies.
    expect(
      (jwt.verify(token, TokenSigningKey.get()) as JSONObject)["hello"],
    ).toBe("world");
  });

  test("a verify and a sign are several times faster with the key object", () => {
    const secret: string = crypto.randomBytes(32).toString("hex");
    const token: string = jwt.sign({ a: 1 }, secret);
    const calls: number = 2000;

    function verifyWith(key: jwt.Secret): number {
      let verified: number = 0;

      for (let index: number = 0; index < calls; index++) {
        if (jwt.verify(token, key)) {
          verified++;
        }
      }

      return verified;
    }

    const withText: FastestRun<number> = fastestRun({
      run: (): number => {
        return verifyWith(secret);
      },
      limitInMs: 0,
    });
    const withKey: FastestRun<number> = fastestRun({
      run: (): number => {
        return verifyWith(JsonWebTokenKeys.forVerifying(secret) as jwt.Secret);
      },
      limitInMs: 0,
    });

    expect(withKey.result).toBe(withText.result);
    // Measured about four times faster; two leaves room for a busy runner.
    expect(withKey.inMs * 2).toBeLessThan(withText.inMs);

    const signText: FastestRun<number> = fastestRun({
      run: (): number => {
        for (let index: number = 0; index < calls; index++) {
          jwt.sign({ a: index }, secret);
        }

        return calls;
      },
      limitInMs: 0,
    });
    const signKey: FastestRun<number> = fastestRun({
      run: (): number => {
        for (let index: number = 0; index < calls; index++) {
          jwt.sign(
            { a: index },
            JsonWebTokenKeys.forSigning(secret) as jwt.Secret,
          );
        }

        return calls;
      },
      limitInMs: 0,
    });

    expect(signKey.inMs * 2).toBeLessThan(signText.inMs);
  });
});
