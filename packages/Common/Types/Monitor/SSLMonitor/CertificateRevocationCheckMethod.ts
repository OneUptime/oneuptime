/*
 * Where the probe got the answer to "has the issuer revoked this
 * certificate?". English values, shown as they are.
 */
enum CertificateRevocationCheckMethod {
  /*
   * The OCSP response the server sent with its certificate in the TLS
   * handshake ("OCSP stapling"), signed by the issuer. Checking it costs no
   * extra request.
   */
  StapledOcsp = "Stapled OCSP",

  // The issuer's OCSP responder, named in the certificate.
  Ocsp = "OCSP",

  // The issuer's certificate revocation list, named in the certificate.
  Crl = "CRL",
}

export default CertificateRevocationCheckMethod;
