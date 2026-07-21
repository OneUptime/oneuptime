/*
 * Every field is optional AND explicitly undefined-able: a certificate need
 * not carry any given subject field, and under exactOptionalPropertyTypes the
 * probe cannot assign a "may be absent" value into a bare optional property.
 */
export default interface SslMonitorResponse {
  isSelfSigned?: boolean | undefined;
  createdAt?: Date | undefined;
  expiresAt?: Date | undefined;
  commonName?: string | undefined;
  organizationalUnit?: string | undefined;
  organization?: string | undefined;
  locality?: string | undefined;
  state?: string | undefined;
  country?: string | undefined;
  serialNumber?: string | undefined;
  fingerprint?: string | undefined;
  fingerprint256?: string | undefined;
}
