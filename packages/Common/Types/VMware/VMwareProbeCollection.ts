import VMwareCollectionErrorCode from "./VMwareCollectionError";
import { JSONArray } from "../JSON";

/*
 * What the server and a probe say to each other about collecting vCenters,
 * over the probe-ingest routes:
 *
 *   POST /probe/vmware/work         { runningVMwareVCenterIds }
 *                                   -> VMwareProbeWorkResponse
 *   POST /probe/vmware/collection   VMwareCollectionReport
 *   POST /probe/vmware/test         VMwareConnectionTestReport
 *
 * A probe asks for work every ten seconds. The answer holds the
 * vCenters due for a collection (claimed for this probe, so no other probe
 * and no second tick collects them too) and the connection tests a person
 * started from the dashboard. Credentials travel only in that answer, only to
 * the probe the vCenter (or the test) names, over the probe's own
 * authenticated HTTPS channel; the probe keeps them in memory only.
 */

// The capability a probe declares on its requests when it can collect vCenters.
export const VMWARE_COLLECTION_PROBE_CAPABILITY: string = "vmwareCollection";

/*
 * How often a probe asks for work. A collection interval is at least a
 * minute, so this bounds how late one starts, and how long a person waits
 * for a connection test to be picked up.
 */
export const VMWARE_PROBE_WORK_POLL_INTERVAL_IN_SECONDS: number = 10;

// The most vCenters one probe collects at the same time.
export const VMWARE_PROBE_COLLECTION_CONCURRENCY: number = 4;

// The most connection tests one work answer hands a probe.
export const VMWARE_PROBE_TEST_BATCH_SIZE: number = 5;

/*
 * The largest collection a probe uploads, measured as the JSON of its
 * metrics before compression. The server's gzip body limit is 50 MiB; this
 * leaves room for the rest of the report.
 */
export const VMWARE_COLLECTION_MAX_PAYLOAD_BYTES: number = 48 * 1024 * 1024;

// One vCenter a probe was handed to collect now.
export interface VMwareCollectionJob {
  vmwareVCenterId: string;
  // The vCenter's name in OneUptime, for the probe's own log lines only.
  vcenterName: string;
  // https://host[:port], normalized (normalizeVCenterAddress).
  vcenterUrl: string;
  username: string;
  password: string;
  /*
   * The SHA-256 fingerprint ("AB:CD:...") of the one certificate a person
   * trusted for this vCenter. Absent: vCenter's certificate must be signed by
   * an authority the probe's machine trusts, for this host name.
   */
  trustedCertificateFingerprint?: string | undefined;
  collectionIntervalInMinutes: number;
  /*
   * VMwareVCenter.collectionSettingsVersion when the job was handed out. The
   * probe reports it back; a report for older settings never overwrites the
   * status of newer ones.
   */
  settingsVersion: number;
}

// One connection test a person started from the dashboard.
export interface VMwareConnectionTestJob {
  vmwareVCenterConnectionTestId: string;
  vcenterUrl: string;
  username: string;
  password: string;
  trustedCertificateFingerprint?: string | undefined;
}

export interface VMwareProbeWorkResponse {
  collections: Array<VMwareCollectionJob>;
  tests: Array<VMwareConnectionTestJob>;
}

/*
 * The certificate vCenter presented when it was not trusted - enough for a
 * person to compare it with vCenter's own and decide to trust it.
 */
export interface VMwarePresentedCertificate {
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
}

// What one collection (or test) found, for the dashboard to show.
export interface VMwareCollectionSummary {
  // About vCenter itself, from its ServiceContent.about.
  productName?: string | undefined; // "VMware vCenter Server"
  fullName?: string | undefined; // "VMware vCenter Server 8.0.2 build-22617221"
  version?: string | undefined; // "8.0.2"
  build?: string | undefined;
  // "VirtualCenter" for vCenter Server, "HostAgent" for a standalone ESXi host.
  apiType?: string | undefined;
  apiVersion?: string | undefined;
  instanceUuid?: string | undefined;
  datacenterCount: number;
  clusterCount: number;
  hostCount: number;
  vmCount: number;
  poweredOnVmCount: number;
  templateCount: number;
  datastoreCount: number;
  resourcePoolCount: number;
  // How many OpenTelemetry resources and datapoints the collection produced.
  resourceCount?: number | undefined;
  datapointCount?: number | undefined;
  /*
   * Parts that were left out without failing the collection - a performance
   * counter this vCenter does not have, vSAN not being enabled - in words.
   */
  warnings: Array<string>;
}

interface VMwareProbeReportBase {
  // Succeeded or Failed (VMwareCollectionStatus).
  status: "Succeeded" | "Failed";
  errorCode?: VMwareCollectionErrorCode | undefined;
  errorMessage?: string | undefined;
  presentedCertificate?: VMwarePresentedCertificate | undefined;
  summary?: VMwareCollectionSummary | undefined;
  durationInMs: number;
}

// What a probe posts after collecting a vCenter.
export interface VMwareCollectionReport extends VMwareProbeReportBase {
  vmwareVCenterId: string;
  // The job's settingsVersion, echoed.
  settingsVersion: number;
  // ISO date of when the collection started.
  collectedAt: string;
  /*
   * The collection as OTLP/JSON resourceMetrics - the shape the vcenter
   * receiver of the VMware agent sends - present when it succeeded. The
   * server stamps vmware.vcenter.name on every resource itself.
   */
  resourceMetrics?: JSONArray | undefined;
}

// What a probe posts after a connection test.
export interface VMwareConnectionTestReport extends VMwareProbeReportBase {
  vmwareVCenterConnectionTestId: string;
}
