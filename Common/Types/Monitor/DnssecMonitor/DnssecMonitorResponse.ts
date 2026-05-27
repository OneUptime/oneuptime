import ProbeAttempt from "../../Probe/ProbeAttempt";

export interface DnssecKeyRecord {
  flags: number;
  algorithm: number;
  keyTag?: number | undefined;
}

export interface DnssecDsRecord {
  keyTag: number;
  algorithm: number;
  digestType: number;
  digest: string;
}

export interface DnssecRrsigRecord {
  typeCovered: string;
  algorithm: number;
  signerName: string;
  keyTag: number;
  inception?: string | undefined;
  expiration?: string | undefined;
}

export interface DnssecResolverCheck {
  resolver: string;
  adFlag: boolean;
  servfailWhenValidating: boolean;
  error?: string | undefined;
}

export interface DnssecNameserverCheck {
  nameServer: string;
  soaSerial?: string | undefined;
  rrsigExpiration?: string | undefined;
  error?: string | undefined;
}

export default interface DnssecMonitorResponse {
  isOnline: boolean;
  responseTimeInMs: number;
  failureCause: string;
  domainName: string;
  isTimeout?: boolean | undefined;

  // Zone signed?
  isZoneSigned: boolean;

  // DNSKEY presence
  dnskeys: Array<DnssecKeyRecord>;

  // DS at parent
  parentDsRecords: Array<DnssecDsRecord>;
  isParentDsPresent: boolean;

  // RRSIG over the A record (zone apex by default)
  rrsigs: Array<DnssecRrsigRecord>;
  earliestSignatureExpiration?: string | undefined;
  daysUntilSignatureExpiry?: number | undefined;

  // Resolver consensus (AD flag + CD-bit SERVFAIL test)
  resolverChecks: Array<DnssecResolverCheck>;
  resolverConsensusAd: boolean;

  // Primary/secondary nameserver consistency
  nameserverChecks: Array<DnssecNameserverCheck>;
  isNameserverConsistent: boolean;

  // Overall chain validity (DNSKEY exists, DS exists, RRSIG valid, AD across resolvers)
  isChainValid: boolean;

  probeAttempts?: Array<ProbeAttempt> | undefined;
  totalAttempts?: number | undefined;
}
