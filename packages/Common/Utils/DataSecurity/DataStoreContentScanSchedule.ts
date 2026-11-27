import { ProbeConnectionStatus } from "../../Models/DatabaseModels/Probe";
import {
  DataStoreKind,
  DataStoreKindInfo,
  DataStoreProvider,
  PROBE_SCANNABLE_DATA_STORE_KINDS,
  TELEMETRY_DATA_STORE_KINDS,
  WORKER_CLAIMED_DATA_STORE_KINDS,
  getDataStoreKindInfo,
} from "../../Types/DataSecurity/DataStoreKind";
import { ClaimDue, readClaimDue } from "../Probe/ClaimDueTime";

/*
 * WHETHER, AND WHEN, A DATA STORE'S CONTENT IS SCANNED NEXT - BY THE RULES
 * THE SERVER SCANS IT BY.
 *
 * A store's nextContentScanAt is a promise only when something will scan
 * it then (Utils/Probe/ClaimDueTime). What that is depends on how the store
 * is scanned:
 *
 * - From a probe (scanProbeId set): the probe's claim
 *   (Server/Utils/DataSecurity/DataSecurityProbeClaim,
 *   getContentScannableSql) hands it out only when its content scanning is
 *   on, it is not archived, it is a self-managed database of a kind a probe
 *   samples, it names the probe's variable that holds its connection
 *   string, the project scans content, and the probe is the project's own.
 *   Any other store the claim sets aside, a quarter of an hour at a time.
 *   A probe that is disconnected asks for nothing. What a probe reports is
 *   kept only while the same rule still holds for the store
 *   (isDataStoreContentScannableByProbe, OneUptime issue #8391).
 * - From OneUptime's workers: their claim
 *   (Server/Utils/DataSecurity/DataSecurityWorkerClaim,
 *   getWorkerContentScannableSql) hands out the stores with content
 *   scanning on, not archived, of a kind a worker samples, of a project
 *   that scans content; the scan reads the same rule again before it
 *   reads any content, and once more before it writes what it read. Their
 *   hold on a store moves its due time an hour on; a store they may not
 *   scan keeps its due time (no set-aside: measured in #8392).
 * - A service's telemetry: the project's hourly telemetry scan reads every
 *   service's last hour, unless the project's telemetry scanning is off,
 *   and leaves out the services whose store turned content scanning off
 *   (Server/Utils/DataSecurity/DataSecurityTelemetryScanRule). It has no
 *   claim, and a store archived is found again, so archiving it does not
 *   stop it.
 *
 * The project's being served (paid, not blocked) is every one of those
 * rules too, but a page in a project nobody may use is not shown, so it is
 * not here.
 *
 * Keep this in step with those rules: DataStoreContentScanSchedule's test
 * reads each rule's conditions and fails on one this does not know.
 */

export enum DataStoreContentScanner {
  Probe = "Probe",
  Workers = "Workers",
  TelemetryScan = "TelemetryScan",
}

// Why nothing will scan a store's content, whatever its due time says.
export enum DataStoreContentScanStop {
  // The store's own Scan Content switch is off.
  StoreScanOff = "StoreScanOff",
  Archived = "Archived",
  // The project's Data Security settings turn content scanning off.
  ProjectScanOff = "ProjectScanOff",
  // The project's Data Security settings turn telemetry scanning off.
  ProjectTelemetryScanOff = "ProjectTelemetryScanOff",
  // OneUptime cannot sample this kind of store.
  KindNotScannable = "KindNotScannable",
  // Scanned from a probe, which samples only the kinds it reads.
  KindNotScannableByProbe = "KindNotScannableByProbe",
  // Scanned from a probe, with no variable naming its connection string.
  NoProbeConnectionVariable = "NoProbeConnectionVariable",
  // A global probe, another project's or one deleted: never handed a store.
  ProbeNotAllowed = "ProbeNotAllowed",
  // The claim would hand it out, but its probe is not there to ask.
  ProbeDisconnected = "ProbeDisconnected",
}

/*
 * How long a store may be due before something should have scanned it. A
 * probe asks every five minutes, for two stores at a time, and a worker
 * every five minutes, for fifty: an hour leaves room for a queue, and past
 * it nothing has come.
 */
export const DATA_STORE_CONTENT_SCAN_OVERDUE_AFTER_IN_MS: number =
  60 * 60 * 1000;

export interface DataStoreContentScanFacts {
  store: {
    kind?: string | null | undefined;
    provider?: string | null | undefined;
    projectId?: { toString: () => string } | string | null | undefined;
    isContentScanEnabled?: boolean | null | undefined;
    isArchived?: boolean | null | undefined;
    scanProbeId?: { toString: () => string } | string | null | undefined;
    probeConnectionVariable?: string | null | undefined;
    nextContentScanAt?: unknown;
  };
  /*
   * The store's scan probe as the reader read it. Null when the project has
   * no such probe - a global one, another project's, or one deleted, none
   * of which the claim hands a store - and undefined when nothing is known
   * of it (a reader who may not read probes): then nothing is said of it,
   * rather than a guess.
   */
  scanProbe?:
    | {
        isGlobalProbe?: boolean | null | undefined;
        projectId?: { toString: () => string } | string | null | undefined;
        connectionStatus?: string | null | undefined;
      }
    | null
    | undefined;
  /*
   * The project's Data Security settings, or null when there are none yet
   * or the reader may not read them: then they are the defaults, every
   * scan on, as the server reads a project with none.
   */
  projectSetting?:
    | {
        isContentScanEnabled?: boolean | null | undefined;
        isTelemetryScanEnabled?: boolean | null | undefined;
      }
    | null
    | undefined;
}

// What the server scans a store's content with.
export function getDataStoreContentScanner(store: {
  kind?: string | null | undefined;
  scanProbeId?: unknown;
}): DataStoreContentScanner {
  if (
    store.kind &&
    TELEMETRY_DATA_STORE_KINDS.includes(store.kind as DataStoreKind)
  ) {
    return DataStoreContentScanner.TelemetryScan;
  }

  return store.scanProbeId
    ? DataStoreContentScanner.Probe
    : DataStoreContentScanner.Workers;
}

function idOf(
  value: { toString: () => string } | string | null | undefined,
): string {
  return value ? value.toString() : "";
}

// Why nothing will scan this store's content now, or null when something will.
export function getDataStoreContentScanStop(
  facts: DataStoreContentScanFacts,
): DataStoreContentScanStop | null {
  const store: DataStoreContentScanFacts["store"] = facts.store;
  const scanner: DataStoreContentScanner = getDataStoreContentScanner(store);

  if (scanner === DataStoreContentScanner.TelemetryScan) {
    // Its own switch first, as for every store.
    if (store.isContentScanEnabled === false) {
      return DataStoreContentScanStop.StoreScanOff;
    }

    return facts.projectSetting?.isTelemetryScanEnabled === false
      ? DataStoreContentScanStop.ProjectTelemetryScanOff
      : null;
  }

  if (store.isContentScanEnabled === false) {
    return DataStoreContentScanStop.StoreScanOff;
  }

  if (store.isArchived === true) {
    return DataStoreContentScanStop.Archived;
  }

  const kind: DataStoreKind | undefined = store.kind as
    | DataStoreKind
    | undefined;
  const info: DataStoreKindInfo | undefined = getDataStoreKindInfo(store.kind);

  if (scanner === DataStoreContentScanner.Probe) {
    // A kind nothing samples, a probe no more than a worker (#11140).
    if (!info?.contentScannable) {
      return DataStoreContentScanStop.KindNotScannable;
    }

    if (
      store.provider !== DataStoreProvider.SelfManaged ||
      !kind ||
      !PROBE_SCANNABLE_DATA_STORE_KINDS.includes(kind)
    ) {
      return DataStoreContentScanStop.KindNotScannableByProbe;
    }

    if (!store.probeConnectionVariable) {
      return DataStoreContentScanStop.NoProbeConnectionVariable;
    }
  } else if (
    !kind ||
    !WORKER_CLAIMED_DATA_STORE_KINDS.includes(kind) ||
    !info?.contentScannable
  ) {
    return DataStoreContentScanStop.KindNotScannable;
  }

  if (facts.projectSetting?.isContentScanEnabled === false) {
    return DataStoreContentScanStop.ProjectScanOff;
  }

  if (scanner === DataStoreContentScanner.Probe && facts.scanProbe === null) {
    return DataStoreContentScanStop.ProbeNotAllowed;
  }

  if (scanner === DataStoreContentScanner.Probe && facts.scanProbe) {
    const probeProjectId: string = idOf(facts.scanProbe.projectId);
    const storeProjectId: string = idOf(store.projectId);

    // Never a global probe, even an instance's own: it never reads a store.
    if (
      facts.scanProbe.isGlobalProbe === true ||
      (probeProjectId && storeProjectId && probeProjectId !== storeProjectId)
    ) {
      return DataStoreContentScanStop.ProbeNotAllowed;
    }

    if (
      facts.scanProbe.connectionStatus === ProbeConnectionStatus.Disconnected
    ) {
      return DataStoreContentScanStop.ProbeDisconnected;
    }
  }

  return null;
}

export type DataStoreNextContentScan =
  | {
      scanner: DataStoreContentScanner.Probe | DataStoreContentScanner.Workers;
      // When the claim hands it out next, and whether that is a promise.
      due: ClaimDue<DataStoreContentScanStop>;
    }
  | {
      // Every hour with the project's telemetry scan: no due time of its own.
      scanner: DataStoreContentScanner.TelemetryScan;
      stop: DataStoreContentScanStop | null;
    };

export function getDataStoreNextContentScan(
  facts: DataStoreContentScanFacts,
  now: Date,
): DataStoreNextContentScan {
  const scanner: DataStoreContentScanner = getDataStoreContentScanner(
    facts.store,
  );
  const stop: DataStoreContentScanStop | null =
    getDataStoreContentScanStop(facts);

  if (scanner === DataStoreContentScanner.TelemetryScan) {
    return { scanner: scanner, stop: stop };
  }

  return {
    scanner: scanner,
    due: readClaimDue<DataStoreContentScanStop>({
      stop: stop,
      dueAt: facts.store.nextContentScanAt,
      now: now,
      overdueAfterInMs: DATA_STORE_CONTENT_SCAN_OVERDUE_AFTER_IN_MS,
    }),
  };
}

/*
 * WHAT SCAN NOW DOES FOR A STORE, BY THE SAME RULES.
 *
 * Scan Now makes a store due now and, for one OneUptime's workers scan,
 * queues its scan: it scans only what the claim would hand out. It is
 * refused, with the reason, for a store nothing will scan (the stop), and
 * for a service's telemetry, which the hourly telemetry scan reads and
 * Scan Now never does (stop null). An archived store is refused like any
 * other: no claim hands one out, and the workers' scan reads the claim's
 * rule before it reads anything. The server's route
 * (DATA_SECURITY_API_ROUTES.scanNow) and the store's Overview, which turns
 * the button off, read this one rule.
 */
export interface DataStoreScanNowRefusal {
  // Why nothing will scan the store, or null for a service's telemetry.
  stop: DataStoreContentScanStop | null;
}

export function getDataStoreScanNowRefusal(
  facts: DataStoreContentScanFacts,
): DataStoreScanNowRefusal | null {
  const stop: DataStoreContentScanStop | null =
    getDataStoreContentScanStop(facts);

  if (
    getDataStoreContentScanner(facts.store) ===
    DataStoreContentScanner.TelemetryScan
  ) {
    return { stop: stop };
  }

  return stop ? { stop: stop } : null;
}

/*
 * Why, in English, for the server's answers: the sentences the Overview
 * shows in the reader's language (StoreNextContentScan, whose test holds
 * the two to each other).
 */
export const DATA_STORE_CONTENT_SCAN_STOP_SENTENCES: Readonly<
  Record<
    Exclude<
      DataStoreContentScanStop,
      DataStoreContentScanStop.ProbeDisconnected
    >,
    string
  >
> = {
  [DataStoreContentScanStop.StoreScanOff]:
    "Content scanning is off for this store. Turn it on in its Settings.",
  [DataStoreContentScanStop.Archived]:
    "A store that is no longer found is not scanned. It is scanned again once it is found.",
  [DataStoreContentScanStop.ProjectScanOff]:
    "Content scanning is off for this project. Turn it on in Data Security's Settings.",
  [DataStoreContentScanStop.ProjectTelemetryScanOff]:
    "Telemetry scanning is off for this project. Turn it on in Data Security's Settings.",
  [DataStoreContentScanStop.KindNotScannable]:
    "OneUptime cannot sample this kind of store's content yet.",
  [DataStoreContentScanStop.KindNotScannableByProbe]:
    "A probe scans only stores you run: PostgreSQL, MySQL, SQL Server, Elasticsearch and OpenSearch. Scan this store from OneUptime's workers in its Settings.",
  [DataStoreContentScanStop.NoProbeConnectionVariable]:
    "Name the probe's environment variable that holds the connection string, in its Settings.",
  [DataStoreContentScanStop.ProbeNotAllowed]:
    "Only a probe of this project's own scans a store. Pick one in its Settings.",
};

export const TELEMETRY_SCAN_NOW_REFUSAL_SENTENCE: string =
  "A service's telemetry is scanned every hour, with the project's telemetry scan.";

export function getDataStoreContentScanStopSentence(
  stop: DataStoreContentScanStop,
  probeName?: string | null | undefined,
): string {
  if (stop === DataStoreContentScanStop.ProbeDisconnected) {
    return `Nothing scans this store while ${probeName || "its probe"} is disconnected.`;
  }

  return DATA_STORE_CONTENT_SCAN_STOP_SENTENCES[stop];
}

// Why Scan Now scans nothing, in English, or null when it scans.
export function getDataStoreScanNowRefusalSentence(
  facts: DataStoreContentScanFacts,
  probeName?: string | null | undefined,
): string | null {
  const refusal: DataStoreScanNowRefusal | null =
    getDataStoreScanNowRefusal(facts);

  if (!refusal) {
    return null;
  }

  return refusal.stop
    ? getDataStoreContentScanStopSentence(refusal.stop, probeName)
    : TELEMETRY_SCAN_NOW_REFUSAL_SENTENCE;
}
