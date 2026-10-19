import crypto from "crypto";
import VercelSignature from "../../../../../Server/Utils/Marketplace/Vercel/VercelSignature";
import { describe, expect, it } from "@jest/globals";

/*
 * Vercel signs webhooks and drain deliveries with x-vercel-signature: the
 * HMAC-SHA1 of the raw body, in hex, keyed with the integration's client
 * secret (or a drain's own secret).
 */

const SECRET: string = "integration-client-secret";
const BODY: string = JSON.stringify([{ id: "1", message: "hello" }]);

const hmac: (body: string | Buffer, secret: string) => string = (
  body: string | Buffer,
  secret: string,
): string => {
  return crypto.createHmac("sha1", secret).update(body).digest("hex");
};

describe("VercelSignature", () => {
  it("signs a body as Vercel does: HMAC-SHA1 in hex", () => {
    expect(VercelSignature.sign(BODY, SECRET)).toBe(hmac(BODY, SECRET));
    expect(VercelSignature.sign(Buffer.from(BODY), SECRET)).toBe(
      hmac(BODY, SECRET),
    );
  });

  it("accepts the signature of the body as sent", () => {
    expect(
      VercelSignature.isValid({
        body: BODY,
        signature: hmac(BODY, SECRET),
        secret: SECRET,
      }),
    ).toBe(true);

    expect(
      VercelSignature.isValid({
        body: Buffer.from(BODY),
        signature: hmac(BODY, SECRET).toUpperCase(),
        secret: SECRET,
      }),
    ).toBe(true);
  });

  it("refuses a signature made with another secret", () => {
    expect(
      VercelSignature.isValid({
        body: BODY,
        signature: hmac(BODY, "someone-else"),
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("refuses the signature of another body, even one that parses the same", () => {
    const reformatted: string = JSON.stringify(JSON.parse(BODY), null, 2);

    expect(
      VercelSignature.isValid({
        body: reformatted,
        signature: hmac(BODY, SECRET),
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("refuses what is not a SHA-1 in hex, and a missing signature or secret", () => {
    for (const signature of [
      undefined,
      "",
      "not-hex",
      hmac(BODY, SECRET).substring(1),
      `${hmac(BODY, SECRET)}00`,
      ["array"],
    ]) {
      expect(
        VercelSignature.isValid({
          body: BODY,
          signature: signature,
          secret: SECRET,
        }),
      ).toBe(false);
    }

    expect(
      VercelSignature.isValid({
        body: BODY,
        signature: hmac(BODY, SECRET),
        secret: null,
      }),
    ).toBe(false);

    expect(
      VercelSignature.isValid({
        body: BODY,
        signature: hmac(BODY, ""),
        secret: "",
      }),
    ).toBe(false);
  });
});
