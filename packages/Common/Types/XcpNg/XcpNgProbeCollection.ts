import XcpNgCollectionErrorCode from "./XcpNgCollectionError";
import XcpNgConnectionType from "./XcpNgConnectionType";
import XcpNgXapiAccountKind from "./XcpNgXapiAccount";
import { JSONArray } from "../JSON";
import { VMwarePresentedCertificate } from "../VMware/VMwareProbeCollection";

/*
 * What the server and a probe say to each other about reading XCP-ng
 * connections (#10996, #10999), over the probe-ingest routes:
 *
 *   POST /probe/xcp-ng/work         { runningXcpNgConnectionIds }
 *                                   -> XcpNgProbeWorkResponse
 *   POST /probe/xcp-ng/collection   XcpNgCollectionReport (gzip)
 *   POST /probe/xcp-ng/test         XcpNgConnectionTestReport
 *
 * The conversation is a vCenter's (VMwareProbeCollection), shape for shape:
 * a probe asks for work every ten seconds; the answer holds the connections
 * due for a collection - claimed for this probe, so no other probe and no
 * second tick reads them too - and the connection tests a person started.
 * Secrets travel only in that answer, only to the probe the connection (or
 * the test) names, over the probe's own authenticated HTTPS channel; the
 * probe keeps them in memory only, never logs them, and never sends them
 * anywhere but the address they were saved for.
 */

export const XCP_NG_PROBE_WORK_POLL_INTERVAL_IN_SECONDS: number = 10;

// The most connections one probe reads at the same time.
export const XCP_NG_PROBE_COLLECTION_CONCURRENCY: number = 4;

// The most connection tests one work answer hands a probe.
export const XCP_NG_PROBE_TEST_BATCH_SIZE: number = 5;

/*
 * The largest collection a probe uploads, measured as the JSON of its
 * metrics before compression. The server's gzip body limit is 50 MiB; this
 * leaves room for the rest of the report.
 */
export const XCP_NG_COLLECTION_MAX_PAYLOAD_BYTES: number = 48 * 1024 * 1024;

// The most XAPI messages one collection hands the server.
export const XCP_NG_MAX_MESSAGES_PER_COLLECTION: number = 200;

/*
 * The certificate an address presented when it was not trusted - enough for
 * a person to compare it with the real one and decide to trust it. The
 * shape a vCenter's is: the probe's TLS check is the same one.
 */
export type XcpNgPresentedCertificate = VMwarePresentedCertificate;

/*
 * One host of a pool read through XAPI, as the pool itself reports it: its
 * management address, and the SHA-256 fingerprint of the certificate it
 * serves its API with (XAPI's Certificate record of type "host"). Read over
 * the connection to the master, whose certificate a person trusted, and
 * used to reach every other host - each pinned to the certificate the pool
 * vouched for - and to follow the master when it moves.
 */
export interface XcpNgXapiPoolHost {
  uuid: string;
  name: string;
  // host.address: the IP or name XAPI is reached at.
  address: string;
  // "AB:CD:..." - empty when the pool lists no certificate for the host.
  certificateFingerprint: string;
  isMaster: boolean;
}

/*
 * Where an XAPI connection's message reading stands: the newest message
 * time read (in the pool master's clock, ISO) and the messages of that very
 * second already delivered, so the next read neither loses one written in
 * the same second nor delivers one twice - and a probe restart does
 * neither, since the server keeps it.
 */
export interface XcpNgMessageWatermark {
  readUntil: string;
  uuidsAtReadUntil: Array<string>;
}

// One connection a probe was handed to read now.
export interface XcpNgCollectionJob {
  xcpNgConnectionId: string;
  // The connection's name in OneUptime, for the probe's own log lines only.
  connectionName: string;
  connectionType: XcpNgConnectionType;
  // https://host[:port], normalized (XcpNgConnectionAddress).
  address: string;
  /*
   * The SHA-256 fingerprint ("AB:CD:...") of the one certificate a person
   * trusted at the address. Absent: its certificate must be signed by an
   * authority the probe's machine trusts, for this host name.
   */
  trustedCertificateFingerprint?: string | undefined;
  collectionIntervalInMinutes: number;
  /*
   * XcpNgConnection.collectionSettingsVersion when the job was handed out.
   * The probe reports it back; a report for older settings never
   * overwrites the status of newer ones.
   */
  settingsVersion: number;

  // Xen Orchestra: the OpenMetrics plugin's secret, and the API token.
  openMetricsSecret?: string | undefined;
  apiToken?: string | undefined;

  // XAPI: the account, and what the last collection learned of the pool.
  username?: string | undefined;
  password?: string | undefined;
  /*
   * The pool the last collection read: a host that answers for another one
   * (a host ejected from the pool is its own pool's master, and takes the
   * same password) is never read in its place.
   */
  xapiPoolId?: string | undefined;
  // The master the last collection reached, tried first.
  xapiMasterAddress?: string | undefined;
  xapiPoolHosts?: Array<XcpNgXapiPoolHost> | undefined;
  // Absent: the first collection; messages are read from then on.
  messageWatermark?: XcpNgMessageWatermark | undefined;
}

// One connection test a person started from the dashboard.
export interface XcpNgConnectionTestJob {
  xcpNgConnectionTestId: string;
  connectionType: XcpNgConnectionType;
  address: string;
  trustedCertificateFingerprint?: string | undefined;
  openMetricsSecret?: string | undefined;
  apiToken?: string | undefined;
  username?: string | undefined;
  password?: string | undefined;
}

export interface XcpNgProbeWorkResponse {
  collections: Array<XcpNgCollectionJob>;
  tests: Array<XcpNgConnectionTestJob>;
}

// One pool a collection or a test saw, with how much of it.
export interface XcpNgPoolSummary {
  // The pool's XAPI UUID, lower case.
  poolId: string;
  // Its name in Xen Orchestra or XAPI; absent when it has none.
  poolName?: string | undefined;
  hostCount: number;
  runningHostCount: number;
  vmCount: number;
  runningVmCount: number;
  storageRepositoryCount: number;
}

/*
 * What Xen Orchestra says of the API token, read with the token itself: how
 * long it lives, and what it may do. Never the token, nor any other token
 * of its user.
 */
export interface XcpNgApiTokenSummary {
  // ISO; absent when Xen Orchestra did not say.
  expiresAt?: string | undefined;
  // The Xen Orchestra user the token belongs to (its name or e-mail).
  userName?: string | undefined;
  // Every privilege it holds reads, and its user is not an administrator.
  isReadOnly?: boolean | undefined;
  canReadAlarms?: boolean | undefined;
  canReadBackupLogs?: boolean | undefined;
  /*
   * Why the token was not usable, while the metrics still came through the
   * plugin's secret: TokenRejected, TokenNotReadOnly, TokenCannotReadAlarms.
   */
  errorCode?: XcpNgCollectionErrorCode | undefined;
  errorMessage?: string | undefined;
}

// The account an XAPI connection holds, as XAPI says of its session.
export interface XcpNgXapiAccountSummary {
  kind: XcpNgXapiAccountKind;
  // root, or the Active Directory user's name.
  name: string;
  // The account's XAPI roles (Active Directory users only).
  roles: Array<string>;
}

// What one collection (or test) found, for the dashboard to show.
export interface XcpNgCollectionSummary {
  connectionType: XcpNgConnectionType;
  pools: Array<XcpNgPoolSummary>;
  // Xen Orchestra
  apiToken?: XcpNgApiTokenSummary | undefined;
  // XAPI: the pool master reached, and what it runs.
  masterAddress?: string | undefined;
  masterHostName?: string | undefined;
  // "XCP-ng 8.3.0"
  productName?: string | undefined;
  productVersion?: string | undefined;
  xapiVersion?: string | undefined;
  account?: XcpNgXapiAccountSummary | undefined;
  // How many OpenTelemetry resources and datapoints the collection made.
  resourceCount?: number | undefined;
  datapointCount?: number | undefined;
  /*
   * Parts that were left out without failing the collection - a host that
   * did not answer, a pool read by another connection - in words.
   */
  warnings: Array<string>;
}

/*
 * One XAPI message (message.get_since): what XAPI tells a pool's operators
 * - a VM that crashed, a host HA lost, a storage repository that failed to
 * plug, a threshold ALARM. Lands on the pool's feed (#10999), in the shape
 * #10997 turns into alerts.
 */
export interface XcpNgPoolMessage {
  uuid: string;
  poolId: string;
  // VM_CRASHED, HA_HOST_FAILED, ALARM ...
  name: string;
  // 1 is the most severe, 5 the least.
  priority: number;
  // VM, Host, SR, Pool, VDI ...
  objectClass: string;
  objectUuid: string;
  // ISO, in the pool master's clock.
  timestamp: string;
  body: string;
}

interface XcpNgProbeReportBase {
  // Succeeded or Failed (XcpNgCollectionStatus).
  status: "Succeeded" | "Failed";
  errorCode?: XcpNgCollectionErrorCode | undefined;
  errorMessage?: string | undefined;
  presentedCertificate?: XcpNgPresentedCertificate | undefined;
  summary?: XcpNgCollectionSummary | undefined;
  durationInMs: number;
}

// What a probe posts after reading a connection.
export interface XcpNgCollectionReport extends XcpNgProbeReportBase {
  xcpNgConnectionId: string;
  // The job's settingsVersion, echoed.
  settingsVersion: number;
  // ISO date of when the collection started.
  collectedAt: string;
  /*
   * The collection as OTLP/JSON resourceMetrics - one resource per pool,
   * exactly as the XCP-ng Agent's collector sends it - present when it
   * succeeded. The server stamps xen_orchestra.name itself, and keeps only
   * the pools this connection reads.
   */
  resourceMetrics?: JSONArray | undefined;
  // XAPI: what the next collection starts from.
  xapiPoolId?: string | undefined;
  xapiMasterAddress?: string | undefined;
  xapiPoolHosts?: Array<XcpNgXapiPoolHost> | undefined;
  messages?: Array<XcpNgPoolMessage> | undefined;
  messageWatermark?: XcpNgMessageWatermark | undefined;
}

// What a probe posts after a connection test.
export interface XcpNgConnectionTestReport extends XcpNgProbeReportBase {
  xcpNgConnectionTestId: string;
}
