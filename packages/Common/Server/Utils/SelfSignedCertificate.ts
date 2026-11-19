import crypto from "crypto";

/*
 * A NEW RSA KEY AND A SELF-SIGNED X.509 CERTIFICATE FOR IT (#9603).
 *
 * A SAML identity provider checks the requests a service provider signs
 * against a certificate an admin uploads to it: Okta's Signature
 * Certificate, an AD FS relying party trust's signature certificate,
 * Keycloak's client signing key. OneUptime makes its own, once per
 * installation (InstanceSamlSigningKeyService), and serves it for download.
 * Nothing checks who issued it - identity providers pin the certificate
 * itself - so it is self-signed, and long-lived, so nobody has to give
 * every identity provider a new one every year.
 *
 * Node makes the key, signs, and reads certificates (X509Certificate), but
 * does not write one, so the certificate is written here in DER (ITU-T
 * X.690), as RFC 5280 lays it out: a version 3 certificate with a random
 * serial number, the common name as both issuer and subject, a validity
 * window, the key, and an sha256WithRSAEncryption signature over the rest.
 * No extensions: none is needed to check a signature with the key.
 */

export interface SelfSignedKeyPair {
  // The RSA private key, PKCS#8 PEM.
  privateKey: string;
  // The self-signed X.509 certificate of its public key, PEM.
  certificate: string;
}

export interface SelfSignedCertificateOptions {
  commonName: string;
  // When the certificate starts to be valid. Now, by default.
  notBefore?: Date | undefined;
  // For how long it is valid.
  validForDays: number;
  // RSA modulus length in bits. 2048 by default.
  modulusLength?: number | undefined;
}

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

// DER tags (X.690, 8.1.2).
const TAG_INTEGER: number = 0x02;
const TAG_BIT_STRING: number = 0x03;
const TAG_NULL: number = 0x05;
const TAG_OBJECT_IDENTIFIER: number = 0x06;
const TAG_UTF8_STRING: number = 0x0c;
const TAG_SEQUENCE: number = 0x30;
const TAG_SET: number = 0x31;
const TAG_UTC_TIME: number = 0x17;
const TAG_GENERALIZED_TIME: number = 0x18;
const TAG_CONTEXT_EXPLICIT_0: number = 0xa0;

// Object identifiers.
const OID_COMMON_NAME: string = "2.5.4.3";
const OID_SHA256_WITH_RSA_ENCRYPTION: string = "1.2.840.113549.1.1.11";

export default class SelfSignedCertificate {
  /*
   * A new RSA key, and a certificate for it signed with it. The key is made
   * off the event loop: an RSA key takes a moment to find.
   */
  public static async create(
    options: SelfSignedCertificateOptions,
  ): Promise<SelfSignedKeyPair> {
    const { privateKey, publicKey } = await new Promise<{
      privateKey: crypto.KeyObject;
      publicKey: crypto.KeyObject;
    }>(
      (
        resolve: (keys: {
          privateKey: crypto.KeyObject;
          publicKey: crypto.KeyObject;
        }) => void,
        reject: (error: Error) => void,
      ): void => {
        crypto.generateKeyPair(
          "rsa",
          {
            modulusLength: options.modulusLength || 2048,
            publicExponent: 0x10001,
          },
          (
            error: Error | null,
            generatedPublicKey: crypto.KeyObject,
            generatedPrivateKey: crypto.KeyObject,
          ): void => {
            if (error) {
              reject(error);
              return;
            }

            resolve({
              privateKey: generatedPrivateKey,
              publicKey: generatedPublicKey,
            });
          },
        );
      },
    );

    return {
      privateKey: privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
      certificate: SelfSignedCertificate.certify({
        privateKey,
        publicKey,
        commonName: options.commonName,
        notBefore: options.notBefore || new Date(),
        validForDays: options.validForDays,
      }),
    };
  }

  /*
   * The certificate of `publicKey`, signed with `privateKey` (its own, for a
   * self-signed certificate), as PEM.
   */
  public static certify(data: {
    privateKey: crypto.KeyObject;
    publicKey: crypto.KeyObject;
    commonName: string;
    notBefore: Date;
    validForDays: number;
  }): string {
    const name: Buffer = SelfSignedCertificate.distinguishedName(
      data.commonName,
    );

    const signatureAlgorithm: Buffer = SelfSignedCertificate.sequence(
      SelfSignedCertificate.objectIdentifier(OID_SHA256_WITH_RSA_ENCRYPTION),
      Buffer.from([TAG_NULL, 0x00]),
    );

    const notAfter: Date = new Date(
      data.notBefore.getTime() + data.validForDays * DAY_IN_MS,
    );

    const toBeSigned: Buffer = SelfSignedCertificate.sequence(
      // version: v3, written as 2 (RFC 5280, 4.1.2.1).
      SelfSignedCertificate.element(
        TAG_CONTEXT_EXPLICIT_0,
        SelfSignedCertificate.integer(Buffer.from([0x02])),
      ),
      SelfSignedCertificate.integer(SelfSignedCertificate.serialNumber()),
      signatureAlgorithm,
      // issuer
      name,
      SelfSignedCertificate.sequence(
        SelfSignedCertificate.time(data.notBefore),
        SelfSignedCertificate.time(notAfter),
      ),
      // subject
      name,
      // subjectPublicKeyInfo, as Node writes it.
      data.publicKey.export({ type: "spki", format: "der" }),
    );

    const signature: Buffer = crypto.sign(
      "sha256",
      toBeSigned,
      data.privateKey,
    );

    const certificate: Buffer = SelfSignedCertificate.sequence(
      toBeSigned,
      signatureAlgorithm,
      SelfSignedCertificate.element(
        TAG_BIT_STRING,
        // No unused bits in the last byte.
        Buffer.concat([Buffer.from([0x00]), signature]),
      ),
    );

    return SelfSignedCertificate.toPem(certificate);
  }

  // DER as PEM: base64 in lines of 64, between its BEGIN and END lines.
  public static toPem(der: Buffer): string {
    const base64: string = der.toString("base64");
    const lines: Array<string> = [];

    for (let index: number = 0; index < base64.length; index += 64) {
      lines.push(base64.substring(index, index + 64));
    }

    return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
  }

  /*
   * 16 random bytes, a positive number whose first byte is never 0: a
   * serial number DER writes with no padding (RFC 5280, 4.1.2.2: at most
   * 20 bytes, positive).
   */
  private static serialNumber(): Buffer {
    const serial: Buffer = crypto.randomBytes(16);

    serial[0] = (serial[0]! & 0x7f) | 0x40;

    return serial;
  }

  // A Name of one common name (RFC 5280, 4.1.2.4), in UTF-8.
  private static distinguishedName(commonName: string): Buffer {
    return SelfSignedCertificate.sequence(
      SelfSignedCertificate.element(
        TAG_SET,
        SelfSignedCertificate.sequence(
          SelfSignedCertificate.objectIdentifier(OID_COMMON_NAME),
          SelfSignedCertificate.element(
            TAG_UTF8_STRING,
            Buffer.from(commonName, "utf8"),
          ),
        ),
      ),
    );
  }

  /*
   * A time as RFC 5280, 4.1.2.5 has it written: UTCTime (YYMMDDHHMMSSZ)
   * through 2049, GeneralizedTime (YYYYMMDDHHMMSSZ) from 2050, to the
   * second, in UTC.
   */
  private static time(date: Date): Buffer {
    const pad: (value: number, width?: number) => string = (
      value: number,
      width: number = 2,
    ): string => {
      return String(value).padStart(width, "0");
    };

    const year: number = date.getUTCFullYear();

    const rest: string = `${pad(date.getUTCMonth() + 1)}${pad(
      date.getUTCDate(),
    )}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(
      date.getUTCSeconds(),
    )}Z`;

    if (year >= 1950 && year < 2050) {
      return SelfSignedCertificate.element(
        TAG_UTC_TIME,
        Buffer.from(`${pad(year % 100)}${rest}`, "ascii"),
      );
    }

    return SelfSignedCertificate.element(
      TAG_GENERALIZED_TIME,
      Buffer.from(`${pad(year, 4)}${rest}`, "ascii"),
    );
  }

  // An OBJECT IDENTIFIER from its dotted form (X.690, 8.19).
  private static objectIdentifier(dotted: string): Buffer {
    const arcs: Array<number> = dotted.split(".").map(Number);
    const bytes: Array<number> = [arcs[0]! * 40 + arcs[1]!];

    for (const arc of arcs.slice(2)) {
      const encoded: Array<number> = [arc & 0x7f];
      let rest: number = Math.floor(arc / 128);

      while (rest > 0) {
        encoded.unshift((rest & 0x7f) | 0x80);
        rest = Math.floor(rest / 128);
      }

      bytes.push(...encoded);
    }

    return SelfSignedCertificate.element(
      TAG_OBJECT_IDENTIFIER,
      Buffer.from(bytes),
    );
  }

  /*
   * A non-negative INTEGER from its big-endian bytes, in DER's shortest
   * form: no leading zero byte unless the next byte would read as negative.
   */
  private static integer(bytes: Buffer): Buffer {
    let value: Buffer = bytes;

    while (value.length > 1 && value[0] === 0x00 && value[1]! < 0x80) {
      value = value.subarray(1);
    }

    if (value[0]! >= 0x80) {
      value = Buffer.concat([Buffer.from([0x00]), value]);
    }

    return SelfSignedCertificate.element(TAG_INTEGER, value);
  }

  private static sequence(...elements: Array<Buffer>): Buffer {
    return SelfSignedCertificate.element(TAG_SEQUENCE, Buffer.concat(elements));
  }

  // One element: its tag, its length (X.690, 8.1.3, definite form), its content.
  private static element(tag: number, content: Buffer): Buffer {
    return Buffer.concat([
      Buffer.from([tag]),
      SelfSignedCertificate.encodedLength(content.length),
      content,
    ]);
  }

  private static encodedLength(length: number): Buffer {
    if (length < 0x80) {
      return Buffer.from([length]);
    }

    const bytes: Array<number> = [];
    let rest: number = length;

    while (rest > 0) {
      bytes.unshift(rest & 0xff);
      rest = Math.floor(rest / 256);
    }

    return Buffer.from([0x80 | bytes.length, ...bytes]);
  }
}
