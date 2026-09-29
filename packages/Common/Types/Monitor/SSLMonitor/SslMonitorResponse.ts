/*
 * Every field is optional AND explicitly undefined-able: a certificate need
 * not carry any given subject field, and under exactOptionalPropertyTypes the
 * probe cannot assign a "may be absent" value into a bare optional property.
 */
export default interface SslMonitorResponse {
  /*
   * Whether the certificate chain passed strict TLS validation (the check
   * a browser performs). This is the ONE field that answers "is this
   * certificate trustworthy", and it is recorded explicitly rather than
   * inferred.
   *
   * It exists because isSelfSigned used to be the only signal that
   * validation had failed, which forced every distinct failure - expired,
   * hostname mismatch, untrusted CA, incomplete chain - to be reported as
   * "self signed". Criteria that asked "is this certificate valid" then had
   * to reconstruct the verdict from !isSelfSigned, and a monitor watching a
   * host with a wrong-hostname certificate read as healthy.
   */
  isValidCertificate?: boolean | undefined;

  /*
   * Why strict validation failed, straight from Node's TLS stack:
   * certificateValidationErrorCode is the stable machine-readable code
   * ("CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID", ...) that criteria
   * and tests key off, and certificateValidationError is the human-readable
   * message shown to whoever gets paged. Both are empty when the
   * certificate is valid.
   */
  certificateValidationError?: string | undefined;
  certificateValidationErrorCode?: string | undefined;

  /*
   * True ONLY for a genuinely self-signed chain, i.e. Node reported
   * DEPTH_ZERO_SELF_SIGNED_CERT / SELF_SIGNED_CERT_IN_CHAIN, or the leaf's
   * issuer equals its subject. Any other validation failure leaves this
   * false and is described by certificateValidationErrorCode instead.
   */
  isSelfSigned?: boolean | undefined;

  createdAt?: Date | undefined;
  expiresAt?: Date | undefined;
  commonName?: string | undefined;
  organizationalUnit?: string | undefined;
  organization?: string | undefined;
  locality?: string | undefined;
  state?: string | undefined;
  country?: string | undefined;

  // Who signed the certificate. Without it the product cannot name the CA.
  issuer?: string | undefined;

  serialNumber?: string | undefined;
  fingerprint?: string | undefined;
  fingerprint256?: string | undefined;

  /*
   * How long the successful TLS handshake took. Recorded so SSL monitors
   * produce a ResponseTime metric like every other probe monitor type.
   */
  responseTimeInMs?: number | undefined;
}
