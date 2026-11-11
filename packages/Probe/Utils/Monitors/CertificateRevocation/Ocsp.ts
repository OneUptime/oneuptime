import CertificateInfoParser, { CertificateInfo } from "./CertificateInfo";
import Der, { DerElement, DerParseError, DerTag } from "./Der";
import RevocationAnswerUtil, { RevocationAnswer } from "./RevocationAnswer";
import Signature, {
  DIGEST_BY_HASH_OID,
  Oid,
  UnsupportedSignatureAlgorithmError,
} from "./Signature";
import { X509Certificate } from "crypto";

/*
 * OCSP (RFC 6960): asking the issuer whether one certificate is revoked, and
 * checking that the answer really is the issuer's.
 *
 * An OCSP response travels over plain HTTP, or is handed over by the very
 * server whose certificate is in question (stapling), so it is believed only
 * when it is signed by the issuer itself or by a responder certificate the
 * issuer signed for that purpose (id-kp-OCSPSigning), when it names this exact
 * certificate, and when it is current. Anything else is no answer at all,
 * never "revoked".
 */

// OCSPResponseStatus, for the problem text.
const RESPONSE_STATUS_NAMES: Readonly<Record<number, string>> = {
  1: "malformed request",
  2: "internal error",
  3: "try later",
  5: "signature required",
  6: "unauthorized",
};

// AlgorithmIdentifier for SHA-1, the CertID hash every responder accepts (RFC 5019).
const SHA1_ALGORITHM_IDENTIFIER: Buffer = Buffer.from(
  "300906052b0e03021a0500",
  "hex",
);

export interface OcspVerifyInput {
  response: Buffer;
  certificate: CertificateInfo;
  issuer: CertificateInfo;
  issuerCertificate: X509Certificate;
  now: Date;
}

export default class Ocsp {
  /*
   * OCSPRequest ::= SEQUENCE { tbsRequest TBSRequest }
   * TBSRequest  ::= SEQUENCE { requestList SEQUENCE OF Request }
   * Request     ::= SEQUENCE { reqCert CertID }
   * CertID      ::= SEQUENCE { hashAlgorithm, issuerNameHash, issuerKeyHash, serialNumber }
   *
   * No nonce: responders behind a CDN ignore it, and leaving it out lets them
   * answer from cache. Freshness comes from thisUpdate / nextUpdate instead.
   */
  public static buildRequest(
    certificate: CertificateInfo,
    issuer: CertificateInfo,
  ): Buffer {
    const certId: Buffer = Der.encodeSequence([
      SHA1_ALGORITHM_IDENTIFIER,
      Der.encodeOctetString(Signature.hash("sha1", certificate.issuerNameDer)),
      Der.encodeOctetString(Signature.hash("sha1", issuer.subjectPublicKey)),
      certificate.serialNumberDer,
    ]);

    const request: Buffer = Der.encodeSequence([certId]);
    const requestList: Buffer = Der.encodeSequence([request]);
    const tbsRequest: Buffer = Der.encodeSequence([requestList]);

    return Der.encodeSequence([tbsRequest]);
  }

  public static verifyResponse(input: OcspVerifyInput): RevocationAnswer {
    try {
      return Ocsp.readResponse(input);
    } catch (error) {
      if (error instanceof UnsupportedSignatureAlgorithmError) {
        return RevocationAnswerUtil.noAnswer(`is ${error.message}`);
      }

      if (error instanceof DerParseError) {
        return RevocationAnswerUtil.noAnswer(
          `could not be read (${error.message})`,
        );
      }

      throw error;
    }
  }

  private static readResponse(input: OcspVerifyInput): RevocationAnswer {
    /*
     * OCSPResponse ::= SEQUENCE {
     *   responseStatus ENUMERATED,
     *   responseBytes [0] EXPLICIT SEQUENCE { responseType OID, response OCTET STRING } OPTIONAL }
     */
    const ocspResponse: DerElement = Der.expectTag(
      Der.parse(input.response),
      DerTag.Sequence,
      "OCSP response",
    );
    const responseParts: Array<DerElement> = Der.children(ocspResponse);
    const responseStatus: number = Der.readSmallNumber(
      responseParts[0] as DerElement,
      DerTag.Enumerated,
    );

    if (responseStatus !== 0) {
      return RevocationAnswerUtil.noAnswer(
        `answered "${RESPONSE_STATUS_NAMES[responseStatus] || `status ${responseStatus}`}"`,
      );
    }

    const responseBytesWrapper: DerElement | undefined = responseParts[1];

    if (!responseBytesWrapper || !Der.isContextTag(responseBytesWrapper, 0)) {
      return RevocationAnswerUtil.noAnswer("answered without a response");
    }

    const responseBytes: Array<DerElement> = Der.children(
      Der.expectTag(
        Der.children(responseBytesWrapper)[0],
        DerTag.Sequence,
        "OCSP response bytes",
      ),
    );

    if (
      Der.readObjectIdentifier(responseBytes[0] as DerElement) !==
      Oid.OcspBasicResponse
    ) {
      return RevocationAnswerUtil.noAnswer(
        "answered with a response type the probe does not read",
      );
    }

    /*
     * BasicOCSPResponse ::= SEQUENCE {
     *   tbsResponseData ResponseData,
     *   signatureAlgorithm AlgorithmIdentifier,
     *   signature BIT STRING,
     *   certs [0] EXPLICIT SEQUENCE OF Certificate OPTIONAL }
     */
    const basicResponse: DerElement = Der.expectTag(
      Der.parse(
        Der.value(
          Der.expectTag(
            responseBytes[1],
            DerTag.OctetString,
            "OCSP basic response",
          ),
        ),
      ),
      DerTag.Sequence,
      "OCSP basic response",
    );
    const basicParts: Array<DerElement> = Der.children(basicResponse);
    const responseData: DerElement = Der.expectTag(
      basicParts[0],
      DerTag.Sequence,
      "OCSP response data",
    );
    const signatureAlgorithmOid: string = Signature.readAlgorithmOid(
      basicParts[1],
    );
    const signature: Buffer = Der.readBitString(
      Der.expectTag(basicParts[2], DerTag.BitString, "OCSP signature"),
    );

    const includedCertificates: Array<Buffer> = [];
    const certsWrapper: DerElement | undefined = basicParts[3];

    if (certsWrapper && Der.isContextTag(certsWrapper, 0)) {
      const certs: DerElement = Der.expectTag(
        Der.children(certsWrapper)[0],
        DerTag.Sequence,
        "OCSP response certificates",
      );

      for (const certificate of Der.children(certs)) {
        includedCertificates.push(Der.encoded(certificate));
      }
    }

    const isSignedByIssuerOrDelegate: boolean = Ocsp.isAuthorizedSignature({
      signatureAlgorithmOid: signatureAlgorithmOid,
      signedBytes: Der.encoded(responseData),
      signature: signature,
      issuerCertificate: input.issuerCertificate,
      includedCertificates: includedCertificates,
      now: input.now,
    });

    if (!isSignedByIssuerOrDelegate) {
      return RevocationAnswerUtil.noAnswer(
        "is not signed by the certificate's issuer or by a responder the issuer authorized",
      );
    }

    /*
     * ResponseData ::= SEQUENCE {
     *   version [0] EXPLICIT Version DEFAULT v1,
     *   responderID ResponderID,
     *   producedAt GeneralizedTime,
     *   responses SEQUENCE OF SingleResponse,
     *   responseExtensions [1] EXPLICIT Extensions OPTIONAL }
     */
    const dataParts: Array<DerElement> = Der.children(responseData);
    let index: number = 0;

    if (
      dataParts[index] &&
      Der.isContextTag(dataParts[index] as DerElement, 0)
    ) {
      const version: number = Der.readSmallNumber(
        Der.children(dataParts[index] as DerElement)[0] as DerElement,
        DerTag.Integer,
      );

      if (version !== 0) {
        return RevocationAnswerUtil.noAnswer(
          `answered with OCSP version ${version + 1}, which the probe does not read`,
        );
      }

      index++;
    }

    index++; // responderID: the signature check above already decided who signed.
    index++; // producedAt

    const responses: DerElement = Der.expectTag(
      dataParts[index],
      DerTag.Sequence,
      "OCSP responses",
    );

    for (const singleResponse of Der.children(responses)) {
      const answer: RevocationAnswer | null = Ocsp.readSingleResponse({
        singleResponse: singleResponse,
        certificate: input.certificate,
        issuer: input.issuer,
        now: input.now,
      });

      if (answer) {
        return answer;
      }
    }

    return RevocationAnswerUtil.noAnswer(
      "does not mention the certificate that was asked about",
    );
  }

  /*
   * SingleResponse ::= SEQUENCE {
   *   certID CertID,
   *   certStatus CHOICE { good [0] NULL, revoked [1] RevokedInfo, unknown [2] NULL },
   *   thisUpdate GeneralizedTime,
   *   nextUpdate [0] EXPLICIT GeneralizedTime OPTIONAL,
   *   singleExtensions [1] EXPLICIT Extensions OPTIONAL }
   *
   * null when it is about some other certificate.
   */
  private static readSingleResponse(data: {
    singleResponse: DerElement;
    certificate: CertificateInfo;
    issuer: CertificateInfo;
    now: Date;
  }): RevocationAnswer | null {
    const parts: Array<DerElement> = Der.children(data.singleResponse);

    if (
      !Ocsp.isSameCertId(
        Der.expectTag(parts[0], DerTag.Sequence, "OCSP CertID"),
        data.certificate,
        data.issuer,
      )
    ) {
      return null;
    }

    const certStatus: DerElement | undefined = parts[1];

    if (!certStatus) {
      throw new DerParseError("OCSP certificate status is missing.");
    }

    const thisUpdate: Date = Der.readTime(parts[2] as DerElement);
    let nextUpdate: Date | undefined = undefined;

    const nextUpdateWrapper: DerElement | undefined = parts[3];
    if (nextUpdateWrapper && Der.isContextTag(nextUpdateWrapper, 0)) {
      nextUpdate = Der.readTime(
        Der.children(nextUpdateWrapper)[0] as DerElement,
      );
    }

    const notCurrent: string | null = RevocationAnswerUtil.checkCurrent({
      thisUpdate: thisUpdate,
      nextUpdate: nextUpdate,
      now: data.now,
    });

    if (notCurrent) {
      return RevocationAnswerUtil.noAnswer(notCurrent);
    }

    if (Der.isContextTag(certStatus, 0)) {
      return { isAnswer: true, isRevoked: false, nextUpdate: nextUpdate };
    }

    if (Der.isContextTag(certStatus, 1) && Der.isConstructed(certStatus)) {
      /*
       * RevokedInfo ::= SEQUENCE {
       *   revocationTime GeneralizedTime,
       *   revocationReason [0] EXPLICIT CRLReason OPTIONAL }
       */
      const revokedInfo: Array<DerElement> = Der.children(certStatus);
      const revokedAt: Date = Der.readTime(revokedInfo[0] as DerElement);
      let reasonCode: number | undefined = undefined;

      const reasonWrapper: DerElement | undefined = revokedInfo[1];
      if (reasonWrapper && Der.isContextTag(reasonWrapper, 0)) {
        reasonCode = Der.readSmallNumber(
          Der.children(reasonWrapper)[0] as DerElement,
          DerTag.Enumerated,
        );
      }

      return {
        isAnswer: true,
        isRevoked: true,
        revokedAt: revokedAt,
        reason: RevocationAnswerUtil.reasonName(reasonCode),
        nextUpdate: nextUpdate,
      };
    }

    if (Der.isContextTag(certStatus, 2)) {
      return RevocationAnswerUtil.noAnswer(
        "does not know the certificate (status unknown)",
      );
    }

    throw new DerParseError("Unrecognised OCSP certificate status.");
  }

  /*
   * Whether a CertID names this certificate. The responder may hash with
   * another algorithm than the request did, so the hashes are recomputed with
   * whatever it used.
   */
  private static isSameCertId(
    certId: DerElement,
    certificate: CertificateInfo,
    issuer: CertificateInfo,
  ): boolean {
    const parts: Array<DerElement> = Der.children(certId);
    const digest: string | undefined =
      DIGEST_BY_HASH_OID[Signature.readAlgorithmOid(parts[0])];

    if (!digest) {
      return false;
    }

    const serialNumber: Buffer = Der.readInteger(
      Der.expectTag(parts[3], DerTag.Integer, "OCSP CertID serial number"),
    );

    if (!serialNumber.equals(certificate.serialNumber)) {
      return false;
    }

    const issuerNameHash: Buffer = Der.value(
      Der.expectTag(parts[1], DerTag.OctetString, "OCSP issuerNameHash"),
    );
    const issuerKeyHash: Buffer = Der.value(
      Der.expectTag(parts[2], DerTag.OctetString, "OCSP issuerKeyHash"),
    );

    return (
      issuerNameHash.equals(
        Signature.hash(digest, certificate.issuerNameDer),
      ) && issuerKeyHash.equals(Signature.hash(digest, issuer.subjectPublicKey))
    );
  }

  /*
   * RFC 6960 section 4.2.2.2: the response must be signed by the issuer, or
   * by a responder certificate that the issuer signed, that carries
   * id-kp-OCSPSigning, and that is valid now.
   */
  private static isAuthorizedSignature(data: {
    signatureAlgorithmOid: string;
    signedBytes: Buffer;
    signature: Buffer;
    issuerCertificate: X509Certificate;
    includedCertificates: Array<Buffer>;
    now: Date;
  }): boolean {
    if (
      Signature.verify({
        signatureAlgorithmOid: data.signatureAlgorithmOid,
        signedBytes: data.signedBytes,
        signature: data.signature,
        publicKey: data.issuerCertificate.publicKey,
      })
    ) {
      return true;
    }

    for (const certificateDer of data.includedCertificates) {
      let responder: X509Certificate;
      let extendedKeyUsages: Array<string>;

      try {
        responder = new X509Certificate(certificateDer);
        extendedKeyUsages =
          CertificateInfoParser.parse(certificateDer).extendedKeyUsages;
      } catch {
        continue;
      }

      if (
        !extendedKeyUsages.includes(Oid.OcspSigning) ||
        !responder.checkIssued(data.issuerCertificate) ||
        !responder.verify(data.issuerCertificate.publicKey) ||
        responder.validFromDate.getTime() > data.now.getTime() ||
        responder.validToDate.getTime() < data.now.getTime()
      ) {
        continue;
      }

      if (
        Signature.verify({
          signatureAlgorithmOid: data.signatureAlgorithmOid,
          signedBytes: data.signedBytes,
          signature: data.signature,
          publicKey: responder.publicKey,
        })
      ) {
        return true;
      }
    }

    return false;
  }
}
