import ProbeAttempt from "../../Probe/ProbeAttempt";
import DomainLookupMethod from "./DomainLookupMethod";

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
  probeAttempts?: Array<ProbeAttempt> | undefined;
  totalAttempts?: number | undefined;
  /*
   * Which protocol actually produced this record. With the Auto lookup
   * method the answer varies by TLD, so it is worth surfacing rather than
   * leaving the operator to guess.
   */
  lookupMethod?: DomainLookupMethod | undefined;
}
