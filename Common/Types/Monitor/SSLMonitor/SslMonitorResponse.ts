export default interface SslMonitorResponse {
  isSelfSigned?: boolean;
  createdAt?: Date;
  expiresAt?: Date;
  commonName?: string;
  organizationalUnit?: string;
  organization?: string;
  locality?: string;
  state?: string;
  country?: string;
  serialNumber?: string;
  fingerprint?: string;
  fingerprint256?: string;
}
