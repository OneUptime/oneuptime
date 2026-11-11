import Der, { DerElement, DerParseError, DerTag } from "./Der";
import { Oid } from "./Signature";

/*
 * What the revocation check needs from an X.509 certificate (RFC 5280) that
 * Node's X509Certificate does not hand out: the issuer and subject names as
 * the DER they were signed as, the raw serial number, the public key's bits,
 * and the OCSP responders and CRLs the certificate names.
 */
export interface CertificateInfo {
  // The serial number, in its shortest two's-complement form.
  serialNumber: Buffer;
  // The serial number INTEGER exactly as the certificate encodes it.
  serialNumberDer: Buffer;
  // The issuer and subject Name, each exactly as the certificate encodes it.
  issuerNameDer: Buffer;
  subjectNameDer: Buffer;
  // The subjectPublicKey BIT STRING's bits: what an OCSP issuerKeyHash hashes.
  subjectPublicKey: Buffer;
  // http(s) URLs of the issuer's OCSP responders (Authority Information Access).
  ocspUrls: Array<string>;
  // http(s) URLs of complete CRLs covering this certificate (CRL Distribution Points).
  crlUrls: Array<string>;
  /*
   * Extended key usage OIDs. Read here rather than from X509Certificate,
   * whose keyUsage property has meant different things across Node versions.
   */
  extendedKeyUsages: Array<string>;
}

// More than any real certificate names; the rest are ignored.
const MAX_URLS: number = 4;
const MAX_URL_LENGTH: number = 2048;

// GeneralName uniformResourceIdentifier: [6] IMPLICIT IA5String.
const GENERAL_NAME_URI_TAG: number = 0x86;

export default class CertificateInfoParser {
  public static parse(certificateDer: Buffer): CertificateInfo {
    const certificate: DerElement = Der.expectTag(
      Der.parse(certificateDer),
      DerTag.Sequence,
      "Certificate",
    );

    const tbsCertificate: DerElement = Der.expectTag(
      Der.children(certificate)[0],
      DerTag.Sequence,
      "TBSCertificate",
    );

    const fields: Array<DerElement> = Der.children(tbsCertificate);
    let index: number = 0;

    // version [0] EXPLICIT Version DEFAULT v1
    if (fields[index] && Der.isContextTag(fields[index] as DerElement, 0)) {
      index++;
    }

    const serialNumber: DerElement = Der.expectTag(
      fields[index++],
      DerTag.Integer,
      "Certificate serial number",
    );
    Der.expectTag(fields[index++], DerTag.Sequence, "Certificate signature");
    const issuer: DerElement = Der.expectTag(
      fields[index++],
      DerTag.Sequence,
      "Certificate issuer",
    );
    Der.expectTag(fields[index++], DerTag.Sequence, "Certificate validity");
    const subject: DerElement = Der.expectTag(
      fields[index++],
      DerTag.Sequence,
      "Certificate subject",
    );
    const subjectPublicKeyInfo: DerElement = Der.expectTag(
      fields[index++],
      DerTag.Sequence,
      "Certificate subject public key info",
    );

    const keyParts: Array<DerElement> = Der.children(subjectPublicKeyInfo);
    const subjectPublicKey: Buffer = Der.readBitString(
      Der.expectTag(keyParts[1], DerTag.BitString, "Subject public key"),
    );

    let ocspUrls: Array<string> = [];
    let crlUrls: Array<string> = [];
    let extendedKeyUsages: Array<string> = [];

    // issuerUniqueID [1], subjectUniqueID [2], extensions [3] EXPLICIT.
    for (const field of fields.slice(index)) {
      if (!Der.isContextTag(field, 3) || !Der.isConstructed(field)) {
        continue;
      }

      const extensions: DerElement = Der.expectTag(
        Der.children(field)[0],
        DerTag.Sequence,
        "Certificate extensions",
      );

      for (const extension of Der.children(extensions)) {
        const parts: Array<DerElement> = Der.children(extension);
        const oid: string = Der.readObjectIdentifier(
          Der.expectTag(parts[0], DerTag.ObjectIdentifier, "Extension id"),
        );
        // extnValue is last: critical BOOLEAN DEFAULT FALSE may sit between.
        const extensionValue: Buffer = Der.value(
          Der.expectTag(
            parts[parts.length - 1],
            DerTag.OctetString,
            "Extension value",
          ),
        );

        if (oid === Oid.AuthorityInfoAccess) {
          ocspUrls = CertificateInfoParser.readOcspUrls(extensionValue);
        } else if (oid === Oid.CrlDistributionPoints) {
          crlUrls = CertificateInfoParser.readCrlUrls(extensionValue);
        } else if (oid === Oid.ExtendedKeyUsage) {
          // ExtKeyUsageSyntax ::= SEQUENCE OF KeyPurposeId (OID)
          extendedKeyUsages = Der.children(
            Der.expectTag(
              Der.parse(extensionValue),
              DerTag.Sequence,
              "Extended key usage",
            ),
          ).map((purpose: DerElement) => {
            return Der.readObjectIdentifier(purpose);
          });
        }
      }
    }

    return {
      serialNumber: Der.readInteger(serialNumber),
      serialNumberDer: Der.encoded(serialNumber),
      issuerNameDer: Der.encoded(issuer),
      subjectNameDer: Der.encoded(subject),
      subjectPublicKey: subjectPublicKey,
      ocspUrls: ocspUrls,
      crlUrls: crlUrls,
      extendedKeyUsages: extendedKeyUsages,
    };
  }

  // A serial number as uppercase hex, the way people and Node print it.
  public static serialNumberHex(serialNumber: Buffer): string {
    return serialNumber.toString("hex").toUpperCase();
  }

  /*
   * AuthorityInfoAccessSyntax ::= SEQUENCE OF AccessDescription
   * AccessDescription ::= SEQUENCE { accessMethod OID, accessLocation GeneralName }
   */
  private static readOcspUrls(extensionValue: Buffer): Array<string> {
    const urls: Array<string> = [];
    const accessDescriptions: DerElement = Der.expectTag(
      Der.parse(extensionValue),
      DerTag.Sequence,
      "Authority information access",
    );

    for (const accessDescription of Der.children(accessDescriptions)) {
      const parts: Array<DerElement> = Der.children(accessDescription);
      const method: DerElement | undefined = parts[0];
      const location: DerElement | undefined = parts[1];

      if (
        method &&
        location &&
        location.tag === GENERAL_NAME_URI_TAG &&
        Der.readObjectIdentifier(method) === Oid.AccessMethodOcsp
      ) {
        CertificateInfoParser.addUrl(urls, Der.readText(location));
      }
    }

    return urls;
  }

  /*
   * CRLDistributionPoints ::= SEQUENCE OF DistributionPoint
   * DistributionPoint ::= SEQUENCE {
   *   distributionPoint [0] DistributionPointName OPTIONAL,
   *   reasons [1] ReasonFlags OPTIONAL,
   *   cRLIssuer [2] GeneralNames OPTIONAL }
   * DistributionPointName ::= CHOICE { fullName [0] GeneralNames, ... }
   *
   * Only points that list a complete CRL from the certificate's own issuer
   * are kept: one limited to some reasons, or published by another issuer,
   * could not say that a certificate is NOT revoked.
   */
  private static readCrlUrls(extensionValue: Buffer): Array<string> {
    const urls: Array<string> = [];
    const distributionPoints: DerElement = Der.expectTag(
      Der.parse(extensionValue),
      DerTag.Sequence,
      "CRL distribution points",
    );

    for (const distributionPoint of Der.children(distributionPoints)) {
      let fullName: DerElement | undefined = undefined;
      let isPartial: boolean = false;

      for (const part of Der.children(distributionPoint)) {
        if (Der.isContextTag(part, 0) && Der.isConstructed(part)) {
          const name: DerElement | undefined = Der.children(part)[0];

          if (name && Der.isContextTag(name, 0) && Der.isConstructed(name)) {
            fullName = name;
          }
        } else if (Der.isContextTag(part, 1) || Der.isContextTag(part, 2)) {
          isPartial = true;
        }
      }

      if (!fullName || isPartial) {
        continue;
      }

      for (const generalName of Der.children(fullName)) {
        if (generalName.tag === GENERAL_NAME_URI_TAG) {
          CertificateInfoParser.addUrl(urls, Der.readText(generalName));
        }
      }
    }

    return urls;
  }

  // Keeps http(s) URLs only: an ldap:// or file:// location is skipped.
  private static addUrl(urls: Array<string>, candidate: string): void {
    const url: string = candidate.trim();

    if (urls.length >= MAX_URLS || url.length > MAX_URL_LENGTH) {
      return;
    }

    const lowerUrl: string = url.toLowerCase();

    if (!lowerUrl.startsWith("http://") && !lowerUrl.startsWith("https://")) {
      return;
    }

    if (!urls.includes(url)) {
      urls.push(url);
    }
  }
}

export { DerParseError };
