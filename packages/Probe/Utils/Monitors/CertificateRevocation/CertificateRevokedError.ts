/*
 * Thrown by a Website or API check whose server presented a certificate its
 * issuer has revoked. It goes down the same path as Node's own TLS errors
 * (CERT_HAS_EXPIRED and the rest): the attempt fails, is retried, and the
 * monitor ends up offline with this message as its failure cause.
 */
export default class CertificateRevokedError extends Error {
  public readonly code: string = "CERT_REVOKED";

  public constructor(message: string) {
    super(message);
    this.name = "CertificateRevokedError";
  }
}
