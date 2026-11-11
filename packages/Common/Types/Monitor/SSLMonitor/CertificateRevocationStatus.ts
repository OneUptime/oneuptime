/*
 * Whether the issuer of a certificate has revoked it, as the probe found out
 * from the issuer itself: an OCSP response or a certificate revocation list
 * (CRL) the issuer signed.
 *
 * A certificate can pass every check a TLS library makes - a trusted issuer,
 * a matching host name, dates that include today - and still be one its
 * issuer has withdrawn. Node (OpenSSL) never asks the issuer, so before the
 * probe asked, a revoked certificate read as valid while browsers refused it
 * with SEC_ERROR_REVOKED_CERTIFICATE / NET::ERR_CERT_REVOKED.
 *
 * The values are English, like CheckOn's, because they are shown as they are.
 */
enum CertificateRevocationStatus {
  // The issuer's signed answer says the certificate is not revoked.
  NotRevoked = "Not Revoked",

  // The issuer's signed answer says the certificate is revoked.
  Revoked = "Revoked",

  /*
   * No signed answer could be had: the certificate names no OCSP responder
   * and no CRL, none answered in time, or what came back could not be
   * verified. Like a browser, the probe does not treat this as revoked.
   */
  Unknown = "Unknown",
}

export default CertificateRevocationStatus;
