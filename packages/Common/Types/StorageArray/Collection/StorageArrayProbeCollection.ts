import { JSONArray } from "../../JSON";
import { VMwarePresentedCertificate } from "../../VMware/VMwareProbeCollection";
import StorageArrayCollectionErrorCode from "./StorageArrayCollectionErrorCode";

/*
 * STORAGE ARRAYS COLLECTED BY A PROBE: what the server and a probe say to
 * each other (#11004).
 *
 * Some storage platforms have no metrics endpoint an agent could scrape: a
 * Dell PowerMax is read through Unisphere for PowerMax's REST API, which
 * manages many arrays at once. Their arrays are collected the way VMware's
 * agentless collection reads a vCenter: a person saves the management
 * server's address and a read-only account in OneUptime (a
 * StorageArrayConnection, the account encrypted and write-only), picks a
 * probe that can reach it, and every few minutes that probe reads every
 * array behind it and sends their metrics in the platform's shape. One
 * connection adds every array behind it to Storage Arrays.
 *
 * Over the probe-ingest routes:
 *
 *   POST /probe/storage-array/work        { runningStorageArrayConnectionIds }
 *                                         -> StorageArrayProbeWorkResponse
 *   POST /probe/storage-array/collection  StorageArrayCollectionReport (gzip)
 *   POST /probe/storage-array/test        StorageArrayConnectionTestReport
 *
 * A probe asks for work every ten seconds. The answer holds the connections
 * due for a collection (claimed for this probe, so no other probe and no
 * second tick collects them too) and the connection tests a person started
 * from the dashboard. Credentials travel only in that answer, only to the
 * probe the connection (or the test) names, over the probe's own
 * authenticated HTTPS channel; the probe keeps them in memory only.
 *
 * The conversation is the platform's `storage.system` on every job: a
 * probe reads each platform with its own poller (packages/Probe/Utils/
 * StorageArray), so the next platform that needs one (PowerStore's hosts,
 * PowerScale's events, Unity XT) adds a poller and changes nothing here.
 */

// How often a probe asks for work.
export const STORAGE_ARRAY_PROBE_WORK_POLL_INTERVAL_IN_SECONDS: number = 10;

/*
 * The most connections one probe collects at the same time. A Unisphere
 * answers a few requests at once per user, and a probe often runs other
 * monitors beside.
 */
export const STORAGE_ARRAY_PROBE_COLLECTION_CONCURRENCY: number = 2;

// The most connection tests one work answer hands a probe.
export const STORAGE_ARRAY_PROBE_TEST_BATCH_SIZE: number = 5;

/*
 * The largest collection a probe uploads, measured as the JSON of its
 * metrics before compression. The server's gzip body limit is 50 MiB; this
 * leaves room for the rest of the report.
 */
export const STORAGE_ARRAY_COLLECTION_MAX_PAYLOAD_BYTES: number =
  48 * 1024 * 1024;

// One connection a probe was handed to collect now.
export interface StorageArrayCollectionJob {
  storageArrayConnectionId: string;
  // The connection's name in OneUptime, for the probe's own log lines only.
  connectionName: string;
  // The platform its arrays are, which picks the probe's poller.
  storageSystem: string;
  // https://host[:port], normalized (StorageArrayConnectionAddress).
  address: string;
  username: string;
  password: string;
  /*
   * The SHA-256 fingerprint ("AB:CD:...") of the one certificate a person
   * trusted for this server. Absent: its certificate must be signed by an
   * authority the probe's machine trusts, for this host name.
   */
  trustedCertificateFingerprint?: string | undefined;
  collectionIntervalInMinutes: number;
  /*
   * StorageArrayConnection.collectionSettingsVersion when the job was
   * handed out. The probe reports it back; a report for older settings
   * never overwrites the status of newer ones.
   */
  settingsVersion: number;
}

// One connection test a person started from the dashboard.
export interface StorageArrayConnectionTestJob {
  storageArrayConnectionTestId: string;
  storageSystem: string;
  address: string;
  username: string;
  password: string;
  trustedCertificateFingerprint?: string | undefined;
}

export interface StorageArrayProbeWorkResponse {
  collections: Array<StorageArrayCollectionJob>;
  tests: Array<StorageArrayConnectionTestJob>;
}

/*
 * The certificate the server presented when it was not trusted: the same
 * shape, checks and "Trust this certificate" as VMware's.
 */
export type StorageArrayPresentedCertificate = VMwarePresentedCertificate;

// What one array behind the server is, and what a collection found on it.
export interface StorageArrayCollectionArraySummary {
  // The array's own identifier: a PowerMax's Symmetrix ID, 000197900123.
  id: string;
  model?: string | undefined;
  // Its operating system's version: a PowerMax's microcode, 6079.275.0.
  osVersion?: string | undefined;
  /*
   * Whether the server manages the array itself. A Unisphere also sees the
   * arrays it replicates with, through their links; those are collected by
   * their own site's server, never twice.
   */
  isLocal: boolean;
  // Whether its metrics were sent (local, and read without error).
  isCollected: boolean;
  /*
   * Whether the server collects its performance (Unisphere's diagnostic
   * registration); null when the account could not tell.
   */
  isPerformanceCollected?: boolean | null | undefined;
  // Whether real-time collection is on, and for how many objects.
  isRealtimeCollected?: boolean | null | undefined;
  realtimeObjects?: Array<string> | undefined;
  // How many objects of each kind it listed (StorageArrayResource kinds).
  counts: Record<string, number>;
  // What could not be read on this array, in words.
  warnings: Array<string>;
}

// What one collection (or test) found, for the dashboard to show.
export interface StorageArrayCollectionSummary {
  // About the management server: "Unisphere for PowerMax", "10.1.0.468".
  serverProductName?: string | undefined;
  serverVersion?: string | undefined;
  // The REST API version the probe spoke: "101".
  apiVersion?: string | undefined;
  arrays: Array<StorageArrayCollectionArraySummary>;
  // How many OpenTelemetry resources and datapoints the collection produced.
  resourceCount?: number | undefined;
  datapointCount?: number | undefined;
  /*
   * What was left out without failing the collection - a role missing for
   * performance, a category the server does not have - in words.
   */
  warnings: Array<string>;
}

interface StorageArrayProbeReportBase {
  // Succeeded or Failed (StorageArrayCollectionStatus).
  status: "Succeeded" | "Failed";
  errorCode?: StorageArrayCollectionErrorCode | undefined;
  errorMessage?: string | undefined;
  presentedCertificate?: StorageArrayPresentedCertificate | undefined;
  summary?: StorageArrayCollectionSummary | undefined;
  durationInMs: number;
}

// What a probe posts after collecting a connection.
export interface StorageArrayCollectionReport extends StorageArrayProbeReportBase {
  storageArrayConnectionId: string;
  // The job's settingsVersion, echoed.
  settingsVersion: number;
  // ISO date of when the collection started.
  collectedAt: string;
  /*
   * The collection as OTLP/JSON resourceMetrics, one resource per array,
   * present when it succeeded. Each resource carries the array's
   * identifier (the platform's identity attribute); the server stamps
   * `storage.system` from the connection and `storage.array.name` from
   * the array's row in OneUptime (StorageArrayProbeMetrics).
   */
  resourceMetrics?: JSONArray | undefined;
}

// What a probe posts after a connection test.
export interface StorageArrayConnectionTestReport extends StorageArrayProbeReportBase {
  storageArrayConnectionTestId: string;
}
