import {
  StorageArrayCollectionJob,
  StorageArrayCollectionReport,
  StorageArrayConnectionTestJob,
  StorageArrayConnectionTestReport,
} from "Common/Types/StorageArray/Collection/StorageArrayProbeCollection";

/*
 * ONE STORAGE PLATFORM'S POLLER (#11004): how a probe reads the arrays
 * behind a management server, for a platform no agent reads - a Dell
 * PowerMax, through Unisphere for PowerMax's REST API.
 *
 * A poller is three things, and nothing in it is the probe's own: it is
 * handed a job with the server's address and account, talks to the server
 * through the transport it is given (StorageArrayTransport: SSRF-checked,
 * pinned, TLS verified before the first byte), and answers a report. So
 * the same poller could run in an agent later.
 *
 *   - test: log in, read what the account can see, leave - for "Test
 *     connection", before anything is saved;
 *   - collect: read every array, and write its metrics in its platform's
 *     shape (StorageArrayPlatform), one OTLP resource per array.
 *
 * Every failure is answered as a report with a code and a sentence: a
 * poller never throws to its caller, and never puts the password in a
 * report or a log line.
 *
 * A new platform is its poller in Utils/StorageArray/<Vendor>/<Product>
 * and one line in StorageArrayPollers.
 */
export interface StorageArrayPoller {
  storageSystem: string;
  collect: (
    job: StorageArrayCollectionJob,
  ) => Promise<StorageArrayCollectionReport>;
  test: (
    job: StorageArrayConnectionTestJob,
  ) => Promise<StorageArrayConnectionTestReport>;
}
