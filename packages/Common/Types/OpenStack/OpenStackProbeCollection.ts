import OpenStackCollectionErrorCode from "./OpenStackCollectionError";
import { OpenStackServiceType } from "./OpenStackResourceKind";
import { JSONArray } from "../JSON";

/*
 * What the server and a probe say to each other about collecting clouds, over the
 * probe-ingest routes:
 *
 *   POST /probe/openstack/work         { runningOpenStackCloudIds }
 *                                      -> OpenStackProbeWorkResponse
 *   POST /probe/openstack/collection   OpenStackCollectionReport
 *   POST /probe/openstack/test         OpenStackConnectionTestReport
 *
 * The same conversation as VMware's. A probe asks for work every ten seconds, and
 * the answer holds the clouds due for a collection (claimed for this probe, so no
 * other probe and no second tick collects them too) and the connection tests a
 * person started. Credentials travel only in that answer, only to the probe the
 * cloud or test names, over the probe's own authenticated HTTPS channel, and the
 * probe keeps them in memory only.
 */

export const OPENSTACK_PROBE_WORK_POLL_INTERVAL_IN_SECONDS: number = 10;

// The most clouds one probe collects at the same time.
export const OPENSTACK_PROBE_COLLECTION_CONCURRENCY: number = 4;

// The most connection tests one work answer hands a probe.
export const OPENSTACK_PROBE_TEST_BATCH_SIZE: number = 5;

/*
 * The largest collection a probe uploads, measured as the JSON of its metrics
 * before compression. The server's gzip body limit is 50 MiB, and this leaves room
 * for the rest of the report.
 */
export const OPENSTACK_COLLECTION_MAX_PAYLOAD_BYTES: number = 48 * 1024 * 1024;

/*
 * Which of an OpenStack catalog's three URLs to use for a service. Most probes sit
 * where `public` answers, and one in the control plane's own network may want
 * `internal`.
 */
export type OpenStackEndpointInterface = "public" | "internal" | "admin";

export const OPENSTACK_ENDPOINT_INTERFACES: ReadonlyArray<OpenStackEndpointInterface> =
  ["public", "internal", "admin"];

export const DEFAULT_OPENSTACK_ENDPOINT_INTERFACE: OpenStackEndpointInterface =
  "public";

/*
 * What a probe logs in with. An application credential comes first, because it can
 * be limited to reading and can expire.
 */
export interface OpenStackApplicationCredential {
  kind: "applicationCredential";
  id: string;
  secret: string;
}

export interface OpenStackPasswordCredential {
  kind: "password";
  username: string;
  userDomainName: string;
  password: string;
  projectName: string;
  projectDomainName: string;
}

export type OpenStackCredential =
  | OpenStackApplicationCredential
  | OpenStackPasswordCredential;

/*
 * What is read beyond the agent's defaults. Both are off unless someone asks: ports
 * because an unscoped list of them can saturate Neutron (openstack-exporter issue
 * 540), and project limits because they cost a call per project per collection.
 */
export interface OpenStackCollectionOptions {
  /*
   * Read ports, scoped and paged. The lists narrow it: with neither, every port
   * in the region, one page at a time. Leave both empty only on a cloud whose port
   * count you know to be small.
   */
  collectPorts?: boolean | undefined;
  portNetworkIds?: Array<string> | undefined;
  portProjectIds?: Array<string> | undefined;
  // Quotas and limits per project.
  collectProjectLimits?: boolean | undefined;
}

// One cloud a probe was handed to collect now.
export interface OpenStackCollectionJob {
  openStackCloudId: string;
  // The cloud's name in OneUptime, for the probe's own log lines only.
  cloudName: string;
  // https://host[:port][/path], normalized (OpenStackAuthUrl.normalize).
  authUrl: string;
  credential: OpenStackCredential;
  // The regions to read. One Keystone can serve many, and each is read on its own.
  regions: Array<string>;
  endpointInterface: OpenStackEndpointInterface;
  /*
   * The SHA-256 fingerprints ("AB:CD:...") of the certificates a person trusted for
   * this cloud. More than one, because each service can have a host and a
   * certificate of its own, unlike a vCenter. Empty: every certificate must be
   * signed by an authority the probe's machine trusts, for its host name.
   */
  trustedCertificateFingerprints: Array<string>;
  collectionIntervalInMinutes: number;
  /*
   * OpenStackCloud.collectionSettingsVersion when the job was handed out. The probe
   * reports it back, and a report for older settings never overwrites the status of
   * newer ones.
   */
  settingsVersion: number;
  options?: OpenStackCollectionOptions | undefined;
}

// One connection test a person started from the dashboard.
export interface OpenStackConnectionTestJob {
  openStackCloudConnectionTestId: string;
  authUrl: string;
  credential: OpenStackCredential;
  // The regions to check. Empty: every region the catalog names.
  regions: Array<string>;
  endpointInterface: OpenStackEndpointInterface;
  trustedCertificateFingerprints: Array<string>;
}

export interface OpenStackProbeWorkResponse {
  collections: Array<OpenStackCollectionJob>;
  tests: Array<OpenStackConnectionTestJob>;
}

/*
 * The certificate an API presented when it was not trusted: enough for a person to
 * compare it with the API's own and decide to trust it.
 */
export interface OpenStackPresentedCertificate {
  // SHA-256 of the DER certificate, "AB:CD:..." (32 bytes).
  fingerprint256: string;
  subject: string;
  issuer: string;
  // ISO dates.
  validFrom?: string | undefined;
  validTo?: string | undefined;
  subjectAltName?: string | undefined;
  isSelfSigned: boolean;
  // What the TLS verification said, e.g. "self-signed certificate in chain".
  verificationError?: string | undefined;
  /*
   * Which API showed it. A cloud can have a host per service, so it may be one
   * service's alone.
   */
  host?: string | undefined;
  port?: number | undefined;
}

/*
 * What happened to one service in one region in one collection.
 *
 *   Succeeded    every read answered.
 *   Partial      some reads answered, and another failed.
 *   Failed       nothing it asked for came back.
 *   Refused      it answered, and refused every read: the credential's level.
 *   NotDeployed  it is not in this region's catalog.
 *   BackingOff   it failed recently, so it was not asked this time.
 *   NotDue       it is read less often than the collection runs (identity, image).
 */
export type OpenStackServiceOutcome =
  | "Succeeded"
  | "Partial"
  | "Failed"
  | "Refused"
  | "NotDeployed"
  | "BackingOff"
  | "NotDue";

export interface OpenStackServiceSummary {
  service: OpenStackServiceType;
  regionName: string;
  outcome: OpenStackServiceOutcome;
  errorCode?: OpenStackCollectionErrorCode | undefined;
  errorMessage?: string | undefined;
  // ISO date of when it is asked again, when it is backing off.
  backingOffUntil?: string | undefined;
  durationInMs: number;
  requestCount: number;
}

export type OpenStackInstanceReadMode = "Full" | "Incremental";

// What one collection found, for the dashboard to show.
export interface OpenStackCollectionSummary {
  credentialKind: OpenStackCredential["kind"];
  // The project the credential is scoped to, and its roles there.
  projectName?: string | undefined;
  roleNames?: Array<string> | undefined;
  // The compute microversion agreed with Nova, per region.
  computeMicroversions?: Record<string, string> | undefined;
  instanceReadModes?: Record<string, OpenStackInstanceReadMode> | undefined;
  regionNames: Array<string>;
  services: Array<OpenStackServiceSummary>;
  hypervisorCount: number;
  instanceCount: number;
  networkCount: number;
  volumeCount: number;
  projectCount: number;
  // How many OpenTelemetry resources and datapoints the collection produced.
  resourceCount?: number | undefined;
  datapointCount?: number | undefined;
  // How many API calls it made: the load a person can be told about.
  requestCount?: number | undefined;
  /*
   * Parts that were left out without failing the collection, in words: what a
   * credential cannot read, a list cut short by Keystone's list_limit.
   */
  warnings: Array<string>;
}

/*
 * What one read of the connection test found. These are the words the agent's
 * troubleshoot.sh uses, because the trap is the same: Neutron and Cinder answer a
 * plain reader with a 200 and only its own project, which looks like it worked.
 */
export type OpenStackReadAccess =
  | "ReadsEverything"
  | "OwnProjectOnly"
  | "Refused"
  | "NotDeployed"
  | "Failing";

export interface OpenStackAccessRead {
  regionName: string;
  service: OpenStackServiceType;
  read: string;
  access: OpenStackReadAccess;
  // What this rests on, such as "2 projects in 14 rows" or "HTTP 403".
  reason?: string | undefined;
  // Which pages and alerts go without it, for a read the credential cannot do.
  goesWithout?: string | undefined;
  // The exact line or step that opens it.
  fix?: string | undefined;
}

// What the answers add up to: the three levels the docs give.
export type OpenStackAccessLevel =
  | "FullView"
  | "InfrastructureOnly"
  | "ProjectView"
  | "Other";

export interface OpenStackConnectionTestSummary {
  credentialKind: OpenStackCredential["kind"];
  projectName?: string | undefined;
  roleNames: Array<string>;
  // Limited by access rules: it cannot write.
  hasAccessRules: boolean;
  // Created --unrestricted: it can make more credentials.
  isUnrestricted: boolean;
  // A plain admin credential: it works, and it can write.
  canProbablyWrite: boolean;
  // Every region the catalog names, whichever were asked about.
  regionsInCatalog: Array<string>;
  // The services in the catalog per region, by the type OneUptime reads them as.
  servicesByRegion: Record<string, Array<OpenStackServiceType>>;
  accessLevel: OpenStackAccessLevel;
  reads: Array<OpenStackAccessRead>;
  warnings: Array<string>;
}

interface OpenStackProbeReportBase {
  errorCode?: OpenStackCollectionErrorCode | undefined;
  errorMessage?: string | undefined;
  presentedCertificate?: OpenStackPresentedCertificate | undefined;
  durationInMs: number;
}

// What a probe posts after collecting a cloud.
export interface OpenStackCollectionReport extends OpenStackProbeReportBase {
  openStackCloudId: string;
  // The job's settingsVersion, echoed.
  settingsVersion: number;
  // ISO date of when the collection started.
  collectedAt: string;
  status: "Succeeded" | "PartiallySucceeded" | "Failed";
  summary?: OpenStackCollectionSummary | undefined;
  /*
   * The collection as OTLP/JSON resourceMetrics: the series the agent's collector
   * sends. Unlike VMware's it comes with a failure too, because `up` reading 0 is
   * what says a failing cloud is failing. The server stamps openstack.cloud.name on
   * every resource itself.
   */
  resourceMetrics?: JSONArray | undefined;
}

// What a probe posts after a connection test.
export interface OpenStackConnectionTestReport extends OpenStackProbeReportBase {
  openStackCloudConnectionTestId: string;
  status: "Succeeded" | "Failed";
  summary?: OpenStackConnectionTestSummary | undefined;
}
