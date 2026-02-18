export default interface DomainMonitorResponse {
  isOnline: boolean;
  responseTimeInMs: number;
  failureCause: string;
  domainName: string;
  registrar?: string | undefined;
  registrarUrl?: string | undefined;
  createdDate?: string | undefined;
  updatedDate?: string | undefined;
  expiresDate?: string | undefined;
  nameServers?: Array<string> | undefined;
  dnssec?: string | undefined;
  domainStatus?: Array<string> | undefined;
  isTimeout?: boolean | undefined;
}
