import SelfSignedCertificate, {
  SelfSignedKeyPair,
} from "../../../Server/Utils/SelfSignedCertificate";
import { beforeAll, describe, expect, test } from "@jest/globals";
import crypto from "crypto";

/*
 * ---------------------------------------------------------------------------
 * A NEW RSA KEY, AND A SELF-SIGNED X.509 CERTIFICATE FOR IT (#9603).
 *
 * Identity providers check OneUptime's signed SAML sign-out requests against
 * a certificate an admin gives them. Node writes no certificates, so
 * SelfSignedCertificate writes one in DER: these read it back with Node's
 * own X.509 parser (OpenSSL), which refuses anything malformed, and check
 * what an identity provider relies on - that it is the key's own, signed by
 * it, valid from when it says until when it says.
 * ---------------------------------------------------------------------------
 */

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

let made: SelfSignedKeyPair;
let certificate: crypto.X509Certificate;

const NOT_BEFORE: Date = new Date("2026-11-18T12:00:00.000Z");

beforeAll(async () => {
  made = await SelfSignedCertificate.create({
    commonName: "OneUptime SAML Service Provider",
    notBefore: NOT_BEFORE,
    validForDays: 20 * 365,
  });

  certificate = new crypto.X509Certificate(made.certificate);
});

describe("SelfSignedCertificate.create", () => {
  test("makes a PKCS#8 RSA private key of 2048 bits", () => {
    expect(made.privateKey).toMatch(
      /^-----BEGIN PRIVATE KEY-----\n[\s\S]+\n-----END PRIVATE KEY-----\n$/,
    );

    const key: crypto.KeyObject = crypto.createPrivateKey(made.privateKey);

    expect(key.asymmetricKeyType).toBe("rsa");
    expect(key.asymmetricKeyDetails?.modulusLength).toBe(2048);
    expect(key.asymmetricKeyDetails?.publicExponent).toBe(BigInt(65537));
  });

  test("makes a certificate PEM in lines of 64, between its BEGIN and END lines", () => {
    const lines: Array<string> = made.certificate.trimEnd().split("\n");

    expect(lines[0]).toBe("-----BEGIN CERTIFICATE-----");
    expect(lines[lines.length - 1]).toBe("-----END CERTIFICATE-----");

    for (const line of lines.slice(1, -2)) {
      expect(line).toHaveLength(64);
    }
  });

  test("is a certificate of the key's own public key", () => {
    expect(
      certificate.checkPrivateKey(crypto.createPrivateKey(made.privateKey)),
    ).toBe(true);
  });

  test("is signed by its own key, as a self-signed certificate is", () => {
    expect(certificate.verify(certificate.publicKey)).toBe(true);

    const stranger: crypto.KeyObject = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
    }).publicKey;

    expect(certificate.verify(stranger)).toBe(false);
  });

  test("names the common name as its subject and its issuer", () => {
    expect(certificate.subject).toBe("CN=OneUptime SAML Service Provider");
    expect(certificate.issuer).toBe("CN=OneUptime SAML Service Provider");
  });

  test("is valid from the time asked, for the days asked, to the second", () => {
    expect(new Date(certificate.validFrom).getTime()).toBe(
      NOT_BEFORE.getTime(),
    );
    expect(new Date(certificate.validTo).getTime()).toBe(
      NOT_BEFORE.getTime() + 20 * 365 * DAY_IN_MS,
    );
  });

  test("is a version 3 certificate signed with sha256WithRSAEncryption, so identity providers that refuse SHA-1 take it", () => {
    // tbsCertificate's version, [0] EXPLICIT INTEGER 2.
    expect(
      certificate.raw.includes(Buffer.from([0xa0, 0x03, 0x02, 0x01, 0x02])),
    ).toBe(true);
    // sha256WithRSAEncryption, 1.2.840.113549.1.1.11.
    expect(
      certificate.raw.includes(
        Buffer.from([
          0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b,
        ]),
      ),
    ).toBe(true);
  });

  test("has a positive serial number, different every time", async () => {
    const other: SelfSignedKeyPair = await SelfSignedCertificate.create({
      commonName: "OneUptime SAML Service Provider",
      validForDays: 1,
    });

    const serial: string = certificate.serialNumber;

    expect(serial).toMatch(/^[0-9A-F]{32}$/);
    // The first byte's high bit is clear: a positive DER INTEGER.
    expect(parseInt(serial.substring(0, 2), 16)).toBeLessThan(0x80);
    expect(new crypto.X509Certificate(other.certificate).serialNumber).not.toBe(
      serial,
    );
  });

  test("makes a new key every time", async () => {
    const other: SelfSignedKeyPair = await SelfSignedCertificate.create({
      commonName: "OneUptime SAML Service Provider",
      validForDays: 1,
    });

    expect(other.privateKey).not.toBe(made.privateKey);
  });

  test("signs what the key signs, as an identity provider checks it against the certificate", () => {
    const message: Buffer = Buffer.from(
      "SAMLRequest=abc&SigAlg=http%3A%2F%2Fwww.w3.org%2F2001%2F04%2Fxmldsig-more%23rsa-sha256",
    );

    const signature: Buffer = crypto.sign(
      "sha256",
      message,
      crypto.createPrivateKey(made.privateKey),
    );

    expect(
      crypto.verify(
        "sha256",
        message,
        crypto.createPublicKey(made.certificate),
        signature,
      ),
    ).toBe(true);
  });
});

describe("SelfSignedCertificate.certify", () => {
  const keys: () => {
    privateKey: crypto.KeyObject;
    publicKey: crypto.KeyObject;
  } = (): { privateKey: crypto.KeyObject; publicKey: crypto.KeyObject } => {
    return {
      privateKey: crypto.createPrivateKey(made.privateKey),
      publicKey: crypto.createPublicKey(made.privateKey),
    };
  };

  test("writes times through 2049 as UTCTime and from 2050 as GeneralizedTime, as RFC 5280 has them", () => {
    const pem: string = SelfSignedCertificate.certify({
      ...keys(),
      commonName: "Across the boundary",
      notBefore: new Date("2049-12-31T23:59:59.000Z"),
      validForDays: 2,
    });

    const crossing: crypto.X509Certificate = new crypto.X509Certificate(pem);

    expect(new Date(crossing.validFrom).toISOString()).toBe(
      "2049-12-31T23:59:59.000Z",
    );
    expect(new Date(crossing.validTo).toISOString()).toBe(
      "2050-01-02T23:59:59.000Z",
    );

    // UTCTime "491231235959Z", GeneralizedTime "20500102235959Z".
    expect(
      crossing.raw.includes(Buffer.from("\x17\x0d491231235959Z", "latin1")),
    ).toBe(true);
    expect(
      crossing.raw.includes(Buffer.from("\x18\x0f20500102235959Z", "latin1")),
    ).toBe(true);
  });

  test("writes a common name in UTF-8, whatever its script", () => {
    const pem: string = SelfSignedCertificate.certify({
      ...keys(),
      commonName: "OneUptime – Überwachung 監視",
      notBefore: NOT_BEFORE,
      validForDays: 1,
    });

    expect(new crypto.X509Certificate(pem).subject).toBe(
      "CN=OneUptime – Überwachung 監視",
    );
  });

  test("writes a long common name, whose length takes more than one byte", () => {
    const commonName: string = "A".repeat(300);

    const pem: string = SelfSignedCertificate.certify({
      ...keys(),
      commonName,
      notBefore: NOT_BEFORE,
      validForDays: 1,
    });

    expect(new crypto.X509Certificate(pem).subject).toBe(`CN=${commonName}`);
  });
});
