import CertificateInfoParser, {
  CertificateInfo,
} from "../../../../Utils/Monitors/CertificateRevocation/CertificateInfo";
import Crl, {
  CrlVerification,
  VerifiedCrl,
} from "../../../../Utils/Monitors/CertificateRevocation/Crl";
import Der from "../../../../Utils/Monitors/CertificateRevocation/Der";
import Ocsp from "../../../../Utils/Monitors/CertificateRevocation/Ocsp";
import {
  RevocationAnswer,
  SignedRevocationAnswer,
} from "../../../../Utils/Monitors/CertificateRevocation/RevocationAnswer";
import {
  CRL_URL,
  OCSP_URL,
  RevocationTestPki,
  cleanupRevocationTestPki,
  generateRevocationTestPki,
} from "./RevocationTestPki";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { X509Certificate } from "crypto";

/*
 * OCSP responses and CRLs from a real CA database (openssl ca / openssl
 * ocsp), read and verified the way the probe does. The rule under test: only
 * an answer the certificate's issuer (or a responder it authorized) signed,
 * about this exact certificate, and current, counts. Everything else is "no
 * answer" - never "revoked", which would take a healthy monitor down.
 */

let pki: RevocationTestPki;
let issuer: CertificateInfo;
let issuerCertificate: X509Certificate;
let goodLeaf: CertificateInfo;
let revokedLeaf: CertificateInfo;
let unrecordedLeaf: CertificateInfo;

beforeAll(() => {
  pki = generateRevocationTestPki();
  issuer = CertificateInfoParser.parse(pki.intermediateDer);
  issuerCertificate = new X509Certificate(pki.intermediateDer);
  goodLeaf = CertificateInfoParser.parse(pki.goodLeafDer);
  revokedLeaf = CertificateInfoParser.parse(pki.revokedLeafDer);
  unrecordedLeaf = CertificateInfoParser.parse(pki.unrecordedLeafDer);
}, 60000);

afterAll(() => {
  cleanupRevocationTestPki(pki);
});

function verifyOcsp(
  response: Buffer,
  certificate: CertificateInfo,
  now: Date = new Date(),
): RevocationAnswer {
  return Ocsp.verifyResponse({
    response: response,
    certificate: certificate,
    issuer: issuer,
    issuerCertificate: issuerCertificate,
    now: now,
  });
}

function expectSigned(answer: RevocationAnswer): SignedRevocationAnswer {
  if (!answer.isAnswer) {
    throw new Error(`Expected a signed answer, got: ${answer.problem}`);
  }

  return answer;
}

function days(count: number): number {
  return count * 24 * 60 * 60 * 1000;
}

describe("CertificateInfoParser", () => {
  test("reads the serial number the way Node does", () => {
    for (const der of [
      pki.goodLeafDer,
      pki.revokedLeafDer,
      pki.unrecordedLeafDer,
    ]) {
      expect(
        CertificateInfoParser.serialNumberHex(
          CertificateInfoParser.parse(der).serialNumber,
        ),
      ).toBe(new X509Certificate(der).serialNumber.toUpperCase());
    }
  });

  test("names the OCSP responder and the CRL the certificate lists", () => {
    expect(goodLeaf.ocspUrls).toEqual([OCSP_URL]);
    expect(goodLeaf.crlUrls).toEqual([CRL_URL]);
  });

  test("a certificate that names neither has empty lists", () => {
    const bare: CertificateInfo = CertificateInfoParser.parse(pki.bareLeafDer);

    expect(bare.ocspUrls).toEqual([]);
    expect(bare.crlUrls).toEqual([]);
  });

  test("the leaf's issuer name is the intermediate's subject, byte for byte", () => {
    expect(goodLeaf.issuerNameDer.equals(issuer.subjectNameDer)).toBe(true);
  });

  test("reads extended key usage from the certificate itself", () => {
    expect(
      CertificateInfoParser.parse(pki.responderDer).extendedKeyUsages,
    ).toEqual(["1.3.6.1.5.5.7.3.9"]);
    expect(goodLeaf.extendedKeyUsages).toEqual(["1.3.6.1.5.5.7.3.1"]);
  });

  test("refuses bytes that are not a certificate", () => {
    expect(() => {
      return CertificateInfoParser.parse(Buffer.from("not a certificate"));
    }).toThrow();
  });
});

describe("Ocsp.buildRequest", () => {
  test("OpenSSL's responder understands the request and answers for the right certificate", () => {
    const good: SignedRevocationAnswer = expectSigned(
      verifyOcsp(
        pki.answerOcspRequest(Ocsp.buildRequest(goodLeaf, issuer)),
        goodLeaf,
      ),
    );
    const revoked: SignedRevocationAnswer = expectSigned(
      verifyOcsp(
        pki.answerOcspRequest(Ocsp.buildRequest(revokedLeaf, issuer)),
        revokedLeaf,
      ),
    );

    expect(good.isRevoked).toBe(false);
    expect(revoked.isRevoked).toBe(true);
  });

  test("is a single SEQUENCE with no nonce", () => {
    const request: Buffer = Ocsp.buildRequest(goodLeaf, issuer);

    expect(Der.parse(request).end).toBe(request.length);
    // OCSPRequest > TBSRequest has only the request list: no version, no extensions.
    const tbsRequest: Array<unknown> = Der.children(
      Der.children(Der.parse(request))[0]!,
    );
    expect(tbsRequest.length).toBe(1);
  });
});

describe("Ocsp.verifyResponse", () => {
  test("a good answer signed by the issuer itself (ECDSA)", () => {
    const answer: SignedRevocationAnswer = expectSigned(
      verifyOcsp(pki.ocspResponse("good", "issuer"), goodLeaf),
    );

    expect(answer.isRevoked).toBe(false);
    expect(answer.nextUpdate).toBeInstanceOf(Date);
  });

  test("a revoked answer signed by a delegated responder (RSA), with date and reason", () => {
    const answer: SignedRevocationAnswer = expectSigned(
      verifyOcsp(pki.ocspResponse("revoked", "responder"), revokedLeaf),
    );

    expect(answer.isRevoked).toBe(true);
    expect(answer.reason).toBe("Key Compromise");
    expect(answer.revokedAt).toBeInstanceOf(Date);
    expect(
      Math.abs((answer.revokedAt as Date).getTime() - Date.now()),
    ).toBeLessThan(days(1));
  });

  test("status unknown is no answer", () => {
    const answer: RevocationAnswer = verifyOcsp(
      pki.ocspResponse("unrecorded", "issuer"),
      unrecordedLeaf,
    );

    expect(answer.isAnswer).toBe(false);
    expect(answer.isAnswer ? "" : answer.problem).toContain("unknown");
  });

  test("a response signed by an unrelated CA is no answer, even one saying revoked", () => {
    const answer: RevocationAnswer = verifyOcsp(
      pki.ocspResponse("revoked", "stranger"),
      revokedLeaf,
    );

    expect(answer.isAnswer).toBe(false);
    expect(answer.isAnswer ? "" : answer.problem).toContain("not signed");
  });

  test("a certificate the issuer signed WITHOUT id-kp-OCSPSigning may not answer", () => {
    expect(
      verifyOcsp(pki.ocspResponse("revoked", "impostor"), revokedLeaf).isAnswer,
    ).toBe(false);
  });

  test("an answer about another certificate is no answer", () => {
    const answer: RevocationAnswer = verifyOcsp(
      pki.ocspResponse("revoked", "issuer"),
      goodLeaf,
    );

    expect(answer.isAnswer).toBe(false);
    expect(answer.isAnswer ? "" : answer.problem).toContain(
      "does not mention the certificate",
    );
  });

  test("a response altered after signing is no answer", () => {
    const response: Buffer = Buffer.from(pki.ocspResponse("good", "issuer"));
    // Flip a byte inside the signed data (well after the outer headers).
    const index: number = Math.floor(response.length / 3);
    response[index] = (response[index] as number) ^ 0x01;

    expect(verifyOcsp(response, goodLeaf).isAnswer).toBe(false);
  });

  test("an out-of-date answer is no answer (replayed or long-cached)", () => {
    const answer: RevocationAnswer = verifyOcsp(
      pki.ocspResponse("good", "issuer"),
      goodLeaf,
      new Date(Date.now() + days(8)),
    );

    expect(answer.isAnswer).toBe(false);
    expect(answer.isAnswer ? "" : answer.problem).toContain("out of date");
  });

  test("an answer dated in the future is no answer", () => {
    const answer: RevocationAnswer = verifyOcsp(
      pki.ocspResponse("good", "issuer"),
      goodLeaf,
      new Date(Date.now() - days(1)),
    );

    expect(answer.isAnswer).toBe(false);
    expect(answer.isAnswer ? "" : answer.problem).toContain("future");
  });

  test("a few minutes of clock difference is tolerated", () => {
    expect(
      verifyOcsp(
        pki.ocspResponse("good", "issuer"),
        goodLeaf,
        new Date(Date.now() - 2 * 60 * 1000),
      ).isAnswer,
    ).toBe(true);
  });

  test("a responder that answers 'try later' gives no answer", () => {
    // OCSPResponse { responseStatus tryLater(3) }
    const answer: RevocationAnswer = verifyOcsp(
      Buffer.from("30030a0103", "hex"),
      goodLeaf,
    );

    expect(answer.isAnswer).toBe(false);
    expect(answer.isAnswer ? "" : answer.problem).toContain("try later");
  });

  test("garbage is no answer, never an exception", () => {
    for (const body of [
      Buffer.from("<html>Service Unavailable</html>"),
      Buffer.alloc(0),
      Buffer.from("3000", "hex"),
    ]) {
      expect(verifyOcsp(body, goodLeaf).isAnswer).toBe(false);
    }
  });
});

describe("Crl", () => {
  function verifiedCrl(der: Buffer = pki.crlDer): VerifiedCrl {
    const verification: CrlVerification = Crl.verify({
      der: der,
      certificate: goodLeaf,
      issuerCertificate: issuerCertificate,
    });

    if (!verification.isVerified) {
      throw new Error(`CRL did not verify: ${verification.problem}`);
    }

    return verification.crl;
  }

  test("verifies the issuer's CRL (ECDSA) and lists only the revoked serial", () => {
    const crl: VerifiedCrl = verifiedCrl();

    expect(crl.entries.size).toBe(1);
    expect(
      crl.entries.has(
        CertificateInfoParser.serialNumberHex(revokedLeaf.serialNumber),
      ),
    ).toBe(true);
  });

  test("a listed certificate is revoked, with its date and reason", () => {
    const answer: SignedRevocationAnswer = expectSigned(
      Crl.lookup({
        crl: verifiedCrl(),
        certificate: revokedLeaf,
        now: new Date(),
      }),
    );

    expect(answer.isRevoked).toBe(true);
    expect(answer.reason).toBe("Key Compromise");
    expect(answer.revokedAt).toBeInstanceOf(Date);
  });

  test("an unlisted certificate is not revoked", () => {
    const answer: SignedRevocationAnswer = expectSigned(
      Crl.lookup({
        crl: verifiedCrl(),
        certificate: goodLeaf,
        now: new Date(),
      }),
    );

    expect(answer.isRevoked).toBe(false);
  });

  test("reads a CRL published as PEM", () => {
    const der: Buffer = Crl.toDer(Buffer.from(pki.crlPem));

    expect(der.equals(pki.crlDer)).toBe(true);
    expect(Crl.toDer(pki.crlDer)).toBe(pki.crlDer);
  });

  test("a CRL in the issuer's name but signed by another key is refused", () => {
    const verification: CrlVerification = Crl.verify({
      der: pki.forgedCrlDer,
      certificate: goodLeaf,
      issuerCertificate: issuerCertificate,
    });

    expect(verification.isVerified).toBe(false);
    expect(verification.isVerified ? "" : verification.problem).toContain(
      "not signed",
    );
  });

  test("a CRL altered after signing is refused", () => {
    const der: Buffer = Buffer.from(pki.crlDer);
    const index: number = Math.floor(der.length / 2);
    der[index] = (der[index] as number) ^ 0x01;

    const verification: CrlVerification = Crl.verify({
      der: der,
      certificate: goodLeaf,
      issuerCertificate: issuerCertificate,
    });

    expect(verification.isVerified).toBe(false);
  });

  test("a CRL from another issuer is refused", () => {
    // The stranger's certificate is checked as if it were the issuer.
    const verification: CrlVerification = Crl.verify({
      der: pki.crlDer,
      certificate: CertificateInfoParser.parse(pki.strangerDer),
      issuerCertificate: new X509Certificate(pki.strangerDer),
    });

    expect(verification.isVerified).toBe(false);
  });

  test("an out-of-date CRL gives no answer", () => {
    const answer: RevocationAnswer = Crl.lookup({
      crl: verifiedCrl(),
      certificate: revokedLeaf,
      now: new Date(Date.now() + days(8)),
    });

    expect(answer.isAnswer).toBe(false);
    expect(answer.isAnswer ? "" : answer.problem).toContain("out of date");
  });

  test("garbage is refused, never an exception", () => {
    for (const body of [
      Buffer.from("<html>Not Found</html>"),
      Buffer.from("3000", "hex"),
      pki.goodLeafDer,
    ]) {
      expect(
        Crl.verify({
          der: body,
          certificate: goodLeaf,
          issuerCertificate: issuerCertificate,
        }).isVerified,
      ).toBe(false);
    }
  });
});
