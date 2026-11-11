import CertificateInfoParser, { CertificateInfo } from "./CertificateInfo";
import Der, { DerElement, DerParseError, DerTag } from "./Der";
import RevocationAnswerUtil, {
  CRL_REASON_REMOVE_FROM_CRL,
  RevocationAnswer,
} from "./RevocationAnswer";
import Signature, {
  Oid,
  UnsupportedSignatureAlgorithmError,
} from "./Signature";
import { X509Certificate } from "crypto";

/*
 * Certificate revocation lists (RFC 5280 section 5): the issuer's signed list
 * of every certificate it has revoked. Since 2023 a public CA must publish
 * CRLs while OCSP is optional, and Let's Encrypt and Google Trust Services no
 * longer run OCSP at all, so a CRL is often the only place to ask.
 *
 * A CRL is read once, checked (issued by this certificate's issuer, signed
 * with its key, complete, current) and then kept: the serial numbers it lists
 * go in a map, so looking up one certificate is cheap however many monitors
 * share the issuer. Details of an entry are read only when a serial matches.
 */

const CRL_ENTRY_EXTENSIONS_UNDERSTOOD: ReadonlySet<string> = new Set<string>([
  Oid.CrlReason,
  Oid.InvalidityDate,
]);

const CRL_EXTENSIONS_UNDERSTOOD: ReadonlySet<string> = new Set<string>([
  Oid.CrlNumber,
  Oid.AuthorityKeyIdentifier,
  Oid.IssuingDistributionPoint,
  Oid.FreshestCrl,
]);

export interface VerifiedCrl {
  thisUpdate: Date;
  nextUpdate?: Date | undefined;
  // Why this CRL cannot say a certificate is NOT revoked, if it cannot.
  incompleteBecause?: string | undefined;
  // Serial number (hex) -> where its entry starts in der.
  entries: Map<string, number>;
  der: Buffer;
}

export type CrlVerification =
  | { isVerified: true; crl: VerifiedCrl }
  | { isVerified: false; problem: string };

export default class Crl {
  // Some servers publish the CRL as PEM rather than DER.
  public static toDer(body: Buffer): Buffer {
    const head: string = body.subarray(0, 1024).toString("latin1");

    if (!head.includes("-----BEGIN X509 CRL-----")) {
      return body;
    }

    const text: string = body.toString("latin1");
    const start: number =
      text.indexOf("-----BEGIN X509 CRL-----") +
      "-----BEGIN X509 CRL-----".length;
    const end: number = text.indexOf("-----END X509 CRL-----", start);

    if (end < 0) {
      return body;
    }

    return Buffer.from(text.slice(start, end), "base64");
  }

  /*
   * Reads and checks a CRL fetched for a certificate issued by issuer. It is
   * verified against the issuer's key, so the result can be reused for every
   * other certificate the same issuer signed.
   */
  public static verify(data: {
    der: Buffer;
    certificate: CertificateInfo;
    issuerCertificate: X509Certificate;
  }): CrlVerification {
    try {
      return Crl.read(data);
    } catch (error) {
      if (error instanceof UnsupportedSignatureAlgorithmError) {
        return { isVerified: false, problem: `is ${error.message}` };
      }

      if (error instanceof DerParseError) {
        return {
          isVerified: false,
          problem: `could not be read (${error.message})`,
        };
      }

      throw error;
    }
  }

  // What a verified CRL says about one certificate, now.
  public static lookup(data: {
    crl: VerifiedCrl;
    certificate: CertificateInfo;
    now: Date;
  }): RevocationAnswer {
    try {
      return Crl.lookupEntry(data);
    } catch (error) {
      if (error instanceof DerParseError) {
        return RevocationAnswerUtil.noAnswer(
          `could not be read (${error.message})`,
        );
      }

      throw error;
    }
  }

  private static read(data: {
    der: Buffer;
    certificate: CertificateInfo;
    issuerCertificate: X509Certificate;
  }): CrlVerification {
    /*
     * CertificateList ::= SEQUENCE {
     *   tbsCertList TBSCertList,
     *   signatureAlgorithm AlgorithmIdentifier,
     *   signatureValue BIT STRING }
     */
    const certificateList: DerElement = Der.expectTag(
      Der.parse(data.der),
      DerTag.Sequence,
      "CRL",
    );
    const listParts: Array<DerElement> = Der.children(certificateList);
    const tbsCertList: DerElement = Der.expectTag(
      listParts[0],
      DerTag.Sequence,
      "TBSCertList",
    );
    const signatureAlgorithmOid: string = Signature.readAlgorithmOid(
      listParts[1],
    );
    const signature: Buffer = Der.readBitString(
      Der.expectTag(listParts[2], DerTag.BitString, "CRL signature"),
    );

    /*
     * TBSCertList ::= SEQUENCE {
     *   version Version OPTIONAL,
     *   signature AlgorithmIdentifier,
     *   issuer Name,
     *   thisUpdate Time,
     *   nextUpdate Time OPTIONAL,
     *   revokedCertificates SEQUENCE OF SEQUENCE { ... } OPTIONAL,
     *   crlExtensions [0] EXPLICIT Extensions OPTIONAL }
     */
    const fields: Array<DerElement> = Der.children(tbsCertList);
    let index: number = 0;

    if (fields[index] && (fields[index] as DerElement).tag === DerTag.Integer) {
      index++;
    }

    const innerSignatureAlgorithmOid: string = Signature.readAlgorithmOid(
      fields[index++],
    );
    const issuerName: DerElement = Der.expectTag(
      fields[index++],
      DerTag.Sequence,
      "CRL issuer",
    );
    const thisUpdate: Date = Der.readTime(fields[index++] as DerElement);
    let nextUpdate: Date | undefined = undefined;

    if (Der.isTime(fields[index])) {
      nextUpdate = Der.readTime(fields[index++] as DerElement);
    }

    let revokedCertificates: DerElement | undefined = undefined;
    if (
      fields[index] &&
      (fields[index] as DerElement).tag === DerTag.Sequence
    ) {
      revokedCertificates = fields[index++];
    }

    let crlExtensions: DerElement | undefined = undefined;
    if (fields[index] && Der.isContextTag(fields[index] as DerElement, 0)) {
      crlExtensions = Der.children(fields[index++] as DerElement)[0];
    }

    if (!Der.encoded(issuerName).equals(data.certificate.issuerNameDer)) {
      return {
        isVerified: false,
        problem: "was published by another issuer than the certificate's",
      };
    }

    if (signatureAlgorithmOid !== innerSignatureAlgorithmOid) {
      return {
        isVerified: false,
        problem: "names two different signature algorithms",
      };
    }

    const isSignedByIssuer: boolean = Signature.verify({
      signatureAlgorithmOid: signatureAlgorithmOid,
      signedBytes: Der.encoded(tbsCertList),
      signature: signature,
      publicKey: data.issuerCertificate.publicKey,
    });

    if (!isSignedByIssuer) {
      return {
        isVerified: false,
        problem: "is not signed by the certificate's issuer",
      };
    }

    const incompleteBecause: string | undefined = crlExtensions
      ? Crl.readIncompleteness(crlExtensions)
      : undefined;

    const entries: Map<string, number> = new Map<string, number>();

    if (revokedCertificates) {
      Der.forEachChild(revokedCertificates, (entry: DerElement) => {
        // SEQUENCE { userCertificate INTEGER, revocationDate Time, crlEntryExtensions OPTIONAL }
        const serialNumber: DerElement = Der.readElement(
          entry.buffer,
          entry.valueStart,
          entry.end,
        );
        const key: string = CertificateInfoParser.serialNumberHex(
          Der.readInteger(serialNumber),
        );

        if (!entries.has(key)) {
          entries.set(key, entry.start);
        }
      });
    }

    return {
      isVerified: true,
      crl: {
        thisUpdate: thisUpdate,
        nextUpdate: nextUpdate,
        incompleteBecause: incompleteBecause,
        entries: entries,
        der: data.der,
      },
    };
  }

  /*
   * A CRL can only say a certificate is NOT revoked when it is a complete,
   * direct list for end-entity certificates. A delta CRL, one limited to some
   * reasons or to CA certificates, an indirect CRL, or one with a critical
   * extension this code does not understand (RFC 5280 says not to use it)
   * cannot.
   */
  private static readIncompleteness(
    crlExtensions: DerElement,
  ): string | undefined {
    for (const extension of Der.children(
      Der.expectTag(crlExtensions, DerTag.Sequence, "CRL extensions"),
    )) {
      const parts: Array<DerElement> = Der.children(extension);
      const oid: string = Der.readObjectIdentifier(parts[0] as DerElement);
      const isCritical: boolean =
        parts.length === 3 && Der.readBoolean(parts[1] as DerElement);

      if (oid === Oid.DeltaCrlIndicator) {
        return "is a delta CRL";
      }

      if (oid === Oid.IssuingDistributionPoint) {
        /*
         * IssuingDistributionPoint ::= SEQUENCE {
         *   distributionPoint [0], onlyContainsUserCerts [1] BOOLEAN,
         *   onlyContainsCACerts [2] BOOLEAN, onlySomeReasons [3],
         *   indirectCRL [4] BOOLEAN, onlyContainsAttributeCerts [5] BOOLEAN }
         */
        const issuingDistributionPoint: DerElement = Der.expectTag(
          Der.parse(Der.value(parts[parts.length - 1] as DerElement)),
          DerTag.Sequence,
          "Issuing distribution point",
        );

        for (const field of Der.children(issuingDistributionPoint)) {
          const isTrue: boolean =
            !Der.isConstructed(field) && Der.value(field)[0] !== 0x00;

          if (Der.isContextTag(field, 2) && isTrue) {
            return "only lists CA certificates";
          }

          if (Der.isContextTag(field, 3)) {
            return "only lists some revocation reasons";
          }

          if (Der.isContextTag(field, 4) && isTrue) {
            return "is an indirect CRL";
          }

          if (Der.isContextTag(field, 5) && isTrue) {
            return "only lists attribute certificates";
          }
        }

        continue;
      }

      if (isCritical && !CRL_EXTENSIONS_UNDERSTOOD.has(oid)) {
        return `has a critical extension the probe does not understand (${oid})`;
      }
    }

    return undefined;
  }

  private static lookupEntry(data: {
    crl: VerifiedCrl;
    certificate: CertificateInfo;
    now: Date;
  }): RevocationAnswer {
    const notCurrent: string | null = RevocationAnswerUtil.checkCurrent({
      thisUpdate: data.crl.thisUpdate,
      nextUpdate: data.crl.nextUpdate,
      now: data.now,
    });

    if (notCurrent) {
      return RevocationAnswerUtil.noAnswer(notCurrent);
    }

    if (data.crl.incompleteBecause) {
      return RevocationAnswerUtil.noAnswer(data.crl.incompleteBecause);
    }

    const entryStart: number | undefined = data.crl.entries.get(
      CertificateInfoParser.serialNumberHex(data.certificate.serialNumber),
    );

    if (entryStart === undefined) {
      return {
        isAnswer: true,
        isRevoked: false,
        nextUpdate: data.crl.nextUpdate,
      };
    }

    const entry: DerElement = Der.readElement(data.crl.der, entryStart);
    const entryParts: Array<DerElement> = Der.children(entry);
    const revokedAt: Date = Der.readTime(entryParts[1] as DerElement);
    let reasonCode: number | undefined = undefined;

    const entryExtensions: DerElement | undefined = entryParts[2];

    if (entryExtensions) {
      for (const extension of Der.children(
        Der.expectTag(entryExtensions, DerTag.Sequence, "CRL entry extensions"),
      )) {
        const parts: Array<DerElement> = Der.children(extension);
        const oid: string = Der.readObjectIdentifier(parts[0] as DerElement);
        const isCritical: boolean =
          parts.length === 3 && Der.readBoolean(parts[1] as DerElement);

        if (oid === Oid.CrlReason) {
          reasonCode = Der.readSmallNumber(
            Der.parse(Der.value(parts[parts.length - 1] as DerElement)),
            DerTag.Enumerated,
          );
        } else if (isCritical && !CRL_ENTRY_EXTENSIONS_UNDERSTOOD.has(oid)) {
          return RevocationAnswerUtil.noAnswer(
            `lists the certificate with a critical extension the probe does not understand (${oid})`,
          );
        }
      }
    }

    // Only a delta CRL (refused above) should carry this; it un-revokes.
    if (reasonCode === CRL_REASON_REMOVE_FROM_CRL) {
      return {
        isAnswer: true,
        isRevoked: false,
        nextUpdate: data.crl.nextUpdate,
      };
    }

    return {
      isAnswer: true,
      isRevoked: true,
      revokedAt: revokedAt,
      reason: RevocationAnswerUtil.reasonName(reasonCode),
      nextUpdate: data.crl.nextUpdate,
    };
  }
}
