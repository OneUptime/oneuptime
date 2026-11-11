import Der, { DerElement, DerParseError, DerTag } from "./Der";
import crypto, { KeyObject } from "crypto";

// Object identifiers the revocation check reads (RFC 5280, RFC 6960).
export const Oid: {
  readonly Sha1: string;
  readonly Sha256: string;
  readonly Sha384: string;
  readonly Sha512: string;
  readonly AuthorityInfoAccess: string;
  readonly AccessMethodOcsp: string;
  readonly CrlDistributionPoints: string;
  readonly OcspBasicResponse: string;
  readonly OcspSigning: string;
  readonly ExtendedKeyUsage: string;
  readonly CrlReason: string;
  readonly InvalidityDate: string;
  readonly CertificateIssuer: string;
  readonly DeltaCrlIndicator: string;
  readonly IssuingDistributionPoint: string;
  readonly CrlNumber: string;
  readonly AuthorityKeyIdentifier: string;
  readonly FreshestCrl: string;
} = {
  Sha1: "1.3.14.3.2.26",
  Sha256: "2.16.840.1.101.3.4.2.1",
  Sha384: "2.16.840.1.101.3.4.2.2",
  Sha512: "2.16.840.1.101.3.4.2.3",
  AuthorityInfoAccess: "1.3.6.1.5.5.7.1.1",
  AccessMethodOcsp: "1.3.6.1.5.5.7.48.1",
  CrlDistributionPoints: "2.5.29.31",
  OcspBasicResponse: "1.3.6.1.5.5.7.48.1.1",
  OcspSigning: "1.3.6.1.5.5.7.3.9",
  ExtendedKeyUsage: "2.5.29.37",
  CrlReason: "2.5.29.21",
  InvalidityDate: "2.5.29.24",
  CertificateIssuer: "2.5.29.29",
  DeltaCrlIndicator: "2.5.29.27",
  IssuingDistributionPoint: "2.5.29.28",
  CrlNumber: "2.5.29.20",
  AuthorityKeyIdentifier: "2.5.29.35",
  FreshestCrl: "2.5.29.46",
};

// The digests an OCSP CertID may be hashed with, by OID.
export const DIGEST_BY_HASH_OID: Readonly<Record<string, string>> = {
  [Oid.Sha1]: "sha1",
  [Oid.Sha256]: "sha256",
  [Oid.Sha384]: "sha384",
  [Oid.Sha512]: "sha512",
};

/*
 * Signature algorithms an issuer signs OCSP responses and CRLs with, mapped
 * to the digest crypto.verify takes. null is EdDSA, which hashes on its own.
 * RSASSA-PSS is left out: its parameters would need parsing, and no public
 * CA signs revocation data with it. An unlisted algorithm gives no answer
 * rather than a wrong one.
 */
const DIGEST_BY_SIGNATURE_OID: Readonly<Record<string, string | null>> = {
  "1.2.840.113549.1.1.5": "sha1", // sha1WithRSAEncryption
  "1.2.840.113549.1.1.14": "sha224", // sha224WithRSAEncryption
  "1.2.840.113549.1.1.11": "sha256", // sha256WithRSAEncryption
  "1.2.840.113549.1.1.12": "sha384", // sha384WithRSAEncryption
  "1.2.840.113549.1.1.13": "sha512", // sha512WithRSAEncryption
  "1.2.840.10045.4.1": "sha1", // ecdsa-with-SHA1
  "1.2.840.10045.4.3.1": "sha224", // ecdsa-with-SHA224
  "1.2.840.10045.4.3.2": "sha256", // ecdsa-with-SHA256
  "1.2.840.10045.4.3.3": "sha384", // ecdsa-with-SHA384
  "1.2.840.10045.4.3.4": "sha512", // ecdsa-with-SHA512
  "1.3.101.112": null, // Ed25519
  "1.3.101.113": null, // Ed448
};

export class UnsupportedSignatureAlgorithmError extends Error {
  public constructor(oid: string) {
    super(`signed with an algorithm the probe does not support (${oid})`);
    this.name = "UnsupportedSignatureAlgorithmError";
  }
}

export default class Signature {
  // The OID of an AlgorithmIdentifier: SEQUENCE { algorithm, parameters }.
  public static readAlgorithmOid(element: DerElement | undefined): string {
    const algorithm: DerElement = Der.expectTag(
      element,
      DerTag.Sequence,
      "Algorithm identifier",
    );
    const parts: Array<DerElement> = Der.children(algorithm);

    if (parts.length === 0) {
      throw new DerParseError("Algorithm identifier is empty.");
    }

    return Der.readObjectIdentifier(parts[0] as DerElement);
  }

  public static isSupported(signatureAlgorithmOid: string): boolean {
    return signatureAlgorithmOid in DIGEST_BY_SIGNATURE_OID;
  }

  /*
   * Whether signature is key's signature over data. Throws only for an
   * algorithm that is not supported; a bad signature, or a key of the wrong
   * kind for the algorithm, is simply false.
   */
  public static verify(data: {
    signatureAlgorithmOid: string;
    signedBytes: Buffer;
    signature: Buffer;
    publicKey: KeyObject;
  }): boolean {
    if (!Signature.isSupported(data.signatureAlgorithmOid)) {
      throw new UnsupportedSignatureAlgorithmError(data.signatureAlgorithmOid);
    }

    const digest: string | null = DIGEST_BY_SIGNATURE_OID[
      data.signatureAlgorithmOid
    ] as string | null;

    try {
      return crypto.verify(
        digest,
        data.signedBytes,
        data.publicKey,
        data.signature,
      );
    } catch {
      return false;
    }
  }

  public static hash(digest: string, data: Buffer): Buffer {
    return crypto.createHash(digest).update(data).digest();
  }
}
