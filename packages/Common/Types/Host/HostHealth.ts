import { HostCollectorConfigStatus } from "../HostCollector/HostCollector";

/*
 * WHAT ON A HOST NEEDS SOMEONE, AND HOW BAD IT IS.
 *
 * One set of rules for every place that says it: the Hosts list (its
 * Status column and its Needs attention card), a host's own page (the
 * health pill in its hero and its Needs attention card), its Topology and
 * the server, which reads the hosts that may need attention for the list
 * (HostService.findHostsThatMayNeedAttention) by the same thresholds. They
 * all read what the host last reported (HostReadingsScan stores it on the
 * host's record), so none of them can disagree about what is wrong.
 *
 *   Critical - broken, or about to be:
 *     a host that has stopped reporting; a filesystem more than 95% full,
 *     or with more than 95% of its inodes used; memory more than 95% in
 *     use (buffers and page cache not counted).
 *   Warning - needs a look soon:
 *     a filesystem more than 85% full or with more than 85% of its inodes
 *     used; memory more than 90% in use; swap more than 80% in use; a
 *     15-minute load above twice the host's cores; a failed systemd unit
 *     (systemd itself then calls the system "degraded"); a config
 *     OneUptime sent that did not start, or a collector that reports an
 *     error; a host whose collector registered but sent no data within ten
 *     minutes.
 *
 * What is never a problem by itself: a busy CPU (a host at 100% for one
 * scrape is a host doing its work - the load says when work queues), a
 * reboot (the Host Restarted alert says so), a host whose collector is
 * still starting.
 *
 * While a host is not reporting, what it reported last is no longer the
 * truth: it is "Not reporting", nothing else. A reading older than fifteen
 * minutes - a collector that no longer sends host metrics - is not judged.
 *
 * The words are English, marked as keys of the Dashboard's locales and
 * looked up where they are drawn. React-free and server-safe: the API and
 * App tests call it.
 */

/*
 * Marks an English text as a key of the Dashboard's locales - the same
 * marker as Common/UI/Utils/TranslateTemplate's translationKey, kept here so
 * this file stays free of the UI (the Dashboard's extractor reads this file
 * as a "keys" root). It returns the text unchanged.
 */
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

export const HOST_DISK_NEAR_FULL_PERCENT: number = 85;
export const HOST_DISK_FULL_PERCENT: number = 95;
export const HOST_INODES_NEAR_FULL_PERCENT: number = 85;
export const HOST_INODES_FULL_PERCENT: number = 95;
export const HOST_MEMORY_HIGH_PERCENT: number = 90;
export const HOST_MEMORY_CRITICAL_PERCENT: number = 95;
export const HOST_SWAP_HIGH_PERCENT: number = 80;
// The 15-minute load past which work queues for the CPU: twice its cores.
export const HOST_LOAD_PER_CORE_HIGH: number = 2;

// A reading older than this, while the host still reports, is not judged.
export const HOST_READINGS_STALE_MS: number = 15 * 60 * 1000;

/*
 * How long a host may wait for its first data after its collector
 * registered (or after it was added) before "Starting" becomes "No data
 * yet": the Host connection guide's first-data grace.
 */
export const HOST_FIRST_DATA_GRACE_MS: number = 10 * 60 * 1000;

export enum HostHealthSeverity {
  Critical = "critical",
  Warning = "warning",
}

export type HostHealthTone = "positive" | "warning" | "danger" | "neutral";

/*
 * One reason or status word, as an English template and its values. A
 * count-dependent one carries its "one" form and the count; `text` is then
 * its general form.
 */
export interface HostHealthText {
  text: string;
  values?: Record<string, string> | undefined;
  plural?: { one: string; count: number } | undefined;
}

/*
 * What a finding is about: the host itself (memory, swap, load, not
 * reporting), one of its filesystems, one of its systemd units, or the
 * collector OneUptime manages on it.
 */
export type HostFindingPart =
  | "host"
  | "filesystem"
  | "systemd-unit"
  | "collector";

export interface HostFinding {
  // Unique within the host's findings: "host", "filesystem:/var".
  key: string;
  part: HostFindingPart;
  // The filesystem's mount point or the unit's name, as the host wrote it.
  name?: string | undefined;
  severity: HostHealthSeverity;
  // On the host's own page, beside the part's name.
  reasons: Array<HostHealthText>;
  /*
   * The same, said on one line of a list of hosts, where the part's name
   * is not beside it: "/var 96% full" rather than "96% full".
   */
  fleetReasons: Array<HostHealthText>;
}

export type HostHealthState =
  | "healthy"
  | "degraded"
  | "unhealthy"
  | "not-reporting"
  | "starting"
  | "no-data"
  // Reporting, but no reading to judge (no host metrics, or none lately).
  | "reporting";

export interface HostHealthAssessment {
  state: HostHealthState;
  severity: HostHealthSeverity | null;
  // The word the list, the hero and the Topology show.
  status: HostHealthText;
  tone: HostHealthTone;
  // What needs attention, the most urgent first. Empty when nothing does.
  findings: Array<HostFinding>;
  // Every finding's reasons on one line, for a list of hosts.
  fleetReasons: Array<HostHealthText>;
  // Whether the host is reporting now.
  isReporting: boolean;
  // Whether its readings are recent enough to judge.
  hasFreshReadings: boolean;
}

/*
 * A host as the rules read it: the Host columns, from Postgres on the server
 * or from ModelAPI in the Dashboard.
 */
export interface HostHealthRow {
  otelCollectorStatus?: string | null | undefined;
  lastSeenAt?: Date | string | null | undefined;
  createdAt?: Date | string | null | undefined;
  cpuCores?: number | string | null | undefined;
  latestCpuPercent?: number | string | null | undefined;
  latestMemoryPercent?: number | string | null | undefined;
  latestSwapPercent?: number | string | null | undefined;
  latestDiskPercent?: number | string | null | undefined;
  latestDiskMountpoint?: string | null | undefined;
  latestInodesPercent?: number | string | null | undefined;
  latestInodesMountpoint?: string | null | undefined;
  latestLoadAverage15m?: number | string | null | undefined;
  failedSystemdUnitCount?: number | string | null | undefined;
  failedSystemdUnits?: Array<string> | null | undefined;
  readingsUpdatedAt?: Date | string | null | undefined;
  collectorInstanceUid?: string | null | undefined;
  collectorRegisteredAt?: Date | string | null | undefined;
  collectorConfigStatus?: string | null | undefined;
  isCollectorHealthy?: boolean | null | undefined;
}

export interface HostHealthOptions {
  now?: Date | undefined;
}

/*
 * ---------------------------------------------------------------------------
 * Words
 * ---------------------------------------------------------------------------
 */

export const HOST_STATUS_HEALTHY: string = translationKey("Healthy");
export const HOST_STATUS_DEGRADED: string = translationKey("Degraded");
export const HOST_STATUS_UNHEALTHY: string = translationKey("Unhealthy");
export const HOST_STATUS_NOT_REPORTING: string =
  translationKey("Not reporting");
export const HOST_STATUS_STARTING: string = translationKey("Starting");
export const HOST_STATUS_NO_DATA: string = translationKey("No data yet");
export const HOST_STATUS_REPORTING: string = translationKey("Reporting");

const REASON_NOT_REPORTING: string = translationKey("Not reporting");
const REASON_NO_DATA: string = translationKey("No data yet");
const REASON_PERCENT_FULL: string = translationKey("{{percent}} full");
const REASON_MOUNT_PERCENT_FULL: string = translationKey(
  "{{mount}} {{percent}} full",
);
const REASON_INODES_USED: string = translationKey("{{percent}} of inodes used");
const REASON_MOUNT_INODES_USED: string = translationKey(
  "{{mount}}: {{percent}} of inodes used",
);
const REASON_MEMORY_USED: string = translationKey("Memory {{percent}} used");
const REASON_SWAP_USED: string = translationKey("Swap {{percent}} used");
const REASON_LOAD_ON_CORES: { one: string; other: string } = {
  one: translationKey("Load {{load}} on {{count}} core"),
  other: translationKey("Load {{load}} on {{count}} cores"),
};
const REASON_UNIT_FAILED: string = translationKey("Failed");
const REASON_FAILED_UNITS: { one: string; other: string } = {
  one: translationKey("{{count}} failed systemd unit"),
  other: translationKey("{{count}} failed systemd units"),
};
const REASON_CONFIG_FAILED: string = translationKey("Config failed");
const REASON_COLLECTOR_CONFIG_FAILED: string = translationKey(
  "Collector config failed",
);
const REASON_COLLECTOR_ERROR: string = translationKey("Collector error");

/*
 * ---------------------------------------------------------------------------
 * Reading the row
 * ---------------------------------------------------------------------------
 */

export function toHostNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number: number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function toHostDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const date: Date = value instanceof Date ? value : new Date(String(value));
  return isNaN(date.getTime()) ? null : date;
}

// A percent as a reason writes it: whole, with its sign ("96%").
export function formatHostPercent(percent: number): string {
  return `${Math.round(percent)}%`;
}

// A load as a reason writes it: one decimal ("9.6").
export function formatHostLoad(load: number): string {
  return (Math.round(load * 10) / 10).toFixed(1);
}

export function isHostReporting(row: HostHealthRow): boolean {
  const status: string = (row.otelCollectorStatus || "").toLowerCase();
  return status === "connected" || status === "active";
}

/*
 * Whether the readings are recent enough to judge: written within the last
 * fifteen minutes. A host whose readings were never written has none.
 */
export function hasFreshHostReadings(
  row: HostHealthRow,
  now: Date = new Date(),
): boolean {
  const updatedAt: Date | null = toHostDate(row.readingsUpdatedAt);
  if (!updatedAt) {
    return false;
  }
  return now.getTime() - updatedAt.getTime() <= HOST_READINGS_STALE_MS;
}

const SEVERITY_ORDER: Record<HostHealthSeverity, number> = {
  [HostHealthSeverity.Critical]: 0,
  [HostHealthSeverity.Warning]: 1,
};

// The order findings of one severity are listed in.
const PART_ORDER: Record<HostFindingPart, number> = {
  host: 0,
  filesystem: 1,
  collector: 2,
  "systemd-unit": 3,
};

function worst(severities: Array<HostHealthSeverity>): HostHealthSeverity {
  return severities.includes(HostHealthSeverity.Critical)
    ? HostHealthSeverity.Critical
    : HostHealthSeverity.Warning;
}

function sortFindings(findings: Array<HostFinding>): Array<HostFinding> {
  return [...findings].sort((a: HostFinding, b: HostFinding): number => {
    const severity: number =
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (severity !== 0) {
      return severity;
    }
    const part: number = PART_ORDER[a.part] - PART_ORDER[b.part];
    if (part !== 0) {
      return part;
    }
    return (a.name || "").localeCompare(b.name || "", undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
}

function bandOf(
  percent: number | null,
  warningAbove: number,
  criticalAbove: number,
): HostHealthSeverity | null {
  if (percent === null) {
    return null;
  }
  if (percent > criticalAbove) {
    return HostHealthSeverity.Critical;
  }
  if (percent > warningAbove) {
    return HostHealthSeverity.Warning;
  }
  return null;
}

/*
 * The host's own findings - memory, swap, load - as one, its worst
 * severity, each reason in turn; then its filesystems, its collector and
 * its failed units, each on its own.
 */
function readingFindings(row: HostHealthRow): Array<HostFinding> {
  const findings: Array<HostFinding> = [];

  const hostSeverities: Array<HostHealthSeverity> = [];
  const hostReasons: Array<HostHealthText> = [];

  const memory: number | null = toHostNumber(row.latestMemoryPercent);
  const memorySeverity: HostHealthSeverity | null = bandOf(
    memory,
    HOST_MEMORY_HIGH_PERCENT,
    HOST_MEMORY_CRITICAL_PERCENT,
  );
  if (memorySeverity && memory !== null) {
    hostSeverities.push(memorySeverity);
    hostReasons.push({
      text: REASON_MEMORY_USED,
      values: { percent: formatHostPercent(memory) },
    });
  }

  const swap: number | null = toHostNumber(row.latestSwapPercent);
  if (swap !== null && swap > HOST_SWAP_HIGH_PERCENT) {
    hostSeverities.push(HostHealthSeverity.Warning);
    hostReasons.push({
      text: REASON_SWAP_USED,
      values: { percent: formatHostPercent(swap) },
    });
  }

  const load: number | null = toHostNumber(row.latestLoadAverage15m);
  const cores: number | null = toHostNumber(row.cpuCores);
  if (
    load !== null &&
    cores !== null &&
    cores > 0 &&
    load > cores * HOST_LOAD_PER_CORE_HIGH
  ) {
    hostSeverities.push(HostHealthSeverity.Warning);
    hostReasons.push({
      text: REASON_LOAD_ON_CORES.other,
      values: { load: formatHostLoad(load) },
      plural: { one: REASON_LOAD_ON_CORES.one, count: Math.round(cores) },
    });
  }

  if (hostReasons.length > 0) {
    findings.push({
      key: "host",
      part: "host",
      severity: worst(hostSeverities),
      reasons: hostReasons,
      fleetReasons: hostReasons,
    });
  }

  /*
   * The fullest filesystem and the one using the most inodes: one finding
   * per mount, both reasons on it when it is the same one.
   */
  const byMount: Map<string, HostFinding> = new Map<string, HostFinding>();
  const addToMount: (
    mount: string,
    severity: HostHealthSeverity,
    reason: HostHealthText,
    fleetReason: HostHealthText,
  ) => void = (
    mount: string,
    severity: HostHealthSeverity,
    reason: HostHealthText,
    fleetReason: HostHealthText,
  ): void => {
    const existing: HostFinding | undefined = byMount.get(mount);
    if (existing) {
      existing.severity = worst([existing.severity, severity]);
      existing.reasons.push(reason);
      existing.fleetReasons.push(fleetReason);
      return;
    }
    byMount.set(mount, {
      key: `filesystem:${mount}`,
      part: "filesystem",
      name: mount,
      severity: severity,
      reasons: [reason],
      fleetReasons: [fleetReason],
    });
  };

  const disk: number | null = toHostNumber(row.latestDiskPercent);
  const diskSeverity: HostHealthSeverity | null = bandOf(
    disk,
    HOST_DISK_NEAR_FULL_PERCENT,
    HOST_DISK_FULL_PERCENT,
  );
  if (diskSeverity && disk !== null) {
    const mount: string = row.latestDiskMountpoint || "";
    addToMount(
      mount,
      diskSeverity,
      {
        text: REASON_PERCENT_FULL,
        values: { percent: formatHostPercent(disk) },
      },
      {
        text: mount ? REASON_MOUNT_PERCENT_FULL : REASON_PERCENT_FULL,
        values: mount
          ? { mount: mount, percent: formatHostPercent(disk) }
          : { percent: formatHostPercent(disk) },
      },
    );
  }

  const inodes: number | null = toHostNumber(row.latestInodesPercent);
  const inodesSeverity: HostHealthSeverity | null = bandOf(
    inodes,
    HOST_INODES_NEAR_FULL_PERCENT,
    HOST_INODES_FULL_PERCENT,
  );
  if (inodesSeverity && inodes !== null) {
    const mount: string = row.latestInodesMountpoint || "";
    addToMount(
      mount,
      inodesSeverity,
      {
        text: REASON_INODES_USED,
        values: { percent: formatHostPercent(inodes) },
      },
      {
        text: mount ? REASON_MOUNT_INODES_USED : REASON_INODES_USED,
        values: mount
          ? { mount: mount, percent: formatHostPercent(inodes) }
          : { percent: formatHostPercent(inodes) },
      },
    );
  }

  findings.push(...byMount.values());

  return findings;
}

/*
 * The collector OneUptime manages on the host: a config it sent that did
 * not start (the host still runs the last one that did), or a collector
 * that reports an error.
 */
function collectorFinding(row: HostHealthRow): HostFinding | null {
  if (!row.collectorInstanceUid) {
    return null;
  }
  if (row.collectorConfigStatus === HostCollectorConfigStatus.Failed) {
    return {
      key: "collector",
      part: "collector",
      severity: HostHealthSeverity.Warning,
      reasons: [{ text: REASON_CONFIG_FAILED }],
      fleetReasons: [{ text: REASON_COLLECTOR_CONFIG_FAILED }],
    };
  }
  if (
    row.collectorConfigStatus === HostCollectorConfigStatus.Applied &&
    row.isCollectorHealthy === false
  ) {
    return {
      key: "collector",
      part: "collector",
      severity: HostHealthSeverity.Warning,
      reasons: [{ text: REASON_COLLECTOR_ERROR }],
      fleetReasons: [{ text: REASON_COLLECTOR_ERROR }],
    };
  }
  return null;
}

/*
 * The failed systemd units: one finding per unit the host's record names,
 * and on a list of hosts one reason that counts them all.
 */
function unitFindings(row: HostHealthRow): Array<HostFinding> {
  const count: number = Math.max(
    0,
    Math.round(toHostNumber(row.failedSystemdUnitCount) ?? 0),
  );
  if (count === 0) {
    return [];
  }
  const names: Array<string> = (row.failedSystemdUnits || []).filter(
    (name: string): boolean => {
      return typeof name === "string" && name.trim().length > 0;
    },
  );
  const fleetReason: HostHealthText = {
    text: REASON_FAILED_UNITS.other,
    plural: { one: REASON_FAILED_UNITS.one, count: count },
  };

  if (names.length === 0) {
    return [
      {
        key: "systemd-units",
        part: "systemd-unit",
        severity: HostHealthSeverity.Warning,
        reasons: [fleetReason],
        fleetReasons: [fleetReason],
      },
    ];
  }

  return names.map((name: string, index: number): HostFinding => {
    return {
      key: `systemd-unit:${name}`,
      part: "systemd-unit",
      name: name,
      severity: HostHealthSeverity.Warning,
      reasons: [{ text: REASON_UNIT_FAILED }],
      // The first unit's finding carries the host's count for the list.
      fleetReasons: index === 0 ? [fleetReason] : [],
    };
  });
}

/*
 * A host that has never reported: still starting for ten minutes after its
 * collector registered (or it was added), then waiting for data.
 */
function isWithinFirstDataGrace(row: HostHealthRow, now: Date): boolean {
  const since: Date | null =
    toHostDate(row.collectorRegisteredAt) || toHostDate(row.createdAt);
  if (!since) {
    return true;
  }
  return now.getTime() - since.getTime() <= HOST_FIRST_DATA_GRACE_MS;
}

function flattenFleetReasons(
  findings: Array<HostFinding>,
): Array<HostHealthText> {
  const reasons: Array<HostHealthText> = [];
  for (const finding of findings) {
    reasons.push(...finding.fleetReasons);
  }
  return reasons;
}

export function assessHost(
  row: HostHealthRow,
  options: HostHealthOptions = {},
): HostHealthAssessment {
  const now: Date = options.now || new Date();
  const isReporting: boolean = isHostReporting(row);
  const hasFreshReadings: boolean = hasFreshHostReadings(row, now);

  if (!isReporting) {
    // Never heard from: starting, then waiting for its first data.
    if (!toHostDate(row.lastSeenAt)) {
      if (isWithinFirstDataGrace(row, now)) {
        return {
          state: "starting",
          severity: null,
          status: { text: HOST_STATUS_STARTING },
          tone: "neutral",
          findings: [],
          fleetReasons: [],
          isReporting: false,
          hasFreshReadings: false,
        };
      }
      const noData: HostFinding = {
        key: "host",
        part: "host",
        severity: HostHealthSeverity.Warning,
        reasons: [{ text: REASON_NO_DATA }],
        fleetReasons: [{ text: REASON_NO_DATA }],
      };
      return {
        state: "no-data",
        severity: HostHealthSeverity.Warning,
        status: { text: HOST_STATUS_NO_DATA },
        tone: "warning",
        findings: [noData],
        fleetReasons: noData.fleetReasons,
        isReporting: false,
        hasFreshReadings: false,
      };
    }

    // Its last readings are no longer the truth: not reporting, nothing else.
    const notReporting: HostFinding = {
      key: "host",
      part: "host",
      severity: HostHealthSeverity.Critical,
      reasons: [{ text: REASON_NOT_REPORTING }],
      fleetReasons: [{ text: REASON_NOT_REPORTING }],
    };
    return {
      state: "not-reporting",
      severity: HostHealthSeverity.Critical,
      status: { text: HOST_STATUS_NOT_REPORTING },
      tone: "danger",
      findings: [notReporting],
      fleetReasons: notReporting.fleetReasons,
      isReporting: false,
      hasFreshReadings: false,
    };
  }

  const findings: Array<HostFinding> = [];
  if (hasFreshReadings) {
    findings.push(...readingFindings(row));
    findings.push(...unitFindings(row));
  }
  const collector: HostFinding | null = collectorFinding(row);
  if (collector) {
    findings.push(collector);
  }

  const sorted: Array<HostFinding> = sortFindings(findings);
  const severity: HostHealthSeverity | null =
    sorted.length > 0
      ? worst(
          sorted.map((finding: HostFinding): HostHealthSeverity => {
            return finding.severity;
          }),
        )
      : null;

  if (severity === HostHealthSeverity.Critical) {
    return {
      state: "unhealthy",
      severity: severity,
      status: { text: HOST_STATUS_UNHEALTHY },
      tone: "danger",
      findings: sorted,
      fleetReasons: flattenFleetReasons(sorted),
      isReporting: true,
      hasFreshReadings: hasFreshReadings,
    };
  }

  if (severity === HostHealthSeverity.Warning) {
    return {
      state: "degraded",
      severity: severity,
      status: { text: HOST_STATUS_DEGRADED },
      tone: "warning",
      findings: sorted,
      fleetReasons: flattenFleetReasons(sorted),
      isReporting: true,
      hasFreshReadings: hasFreshReadings,
    };
  }

  /*
   * Reporting, with nothing to judge: its collector sends no host metrics,
   * or none lately. "Healthy" would be a guess.
   */
  if (!hasFreshReadings) {
    return {
      state: "reporting",
      severity: null,
      status: { text: HOST_STATUS_REPORTING },
      tone: "neutral",
      findings: [],
      fleetReasons: [],
      isReporting: true,
      hasFreshReadings: false,
    };
  }

  return {
    state: "healthy",
    severity: null,
    status: { text: HOST_STATUS_HEALTHY },
    tone: "positive",
    findings: [],
    fleetReasons: [],
    isReporting: true,
    hasFreshReadings: true,
  };
}

/*
 * The order hosts are listed in by how urgently they need someone: the
 * critical first, then the ones to look at, each by how many reasons they
 * have, then by name as people number them (web-2 before web-10).
 */
export function compareHostsByUrgency(
  a: { assessment: HostHealthAssessment; name: string },
  b: { assessment: HostHealthAssessment; name: string },
): number {
  const rank: (assessment: HostHealthAssessment) => number = (
    assessment: HostHealthAssessment,
  ): number => {
    if (assessment.severity === HostHealthSeverity.Critical) {
      return 0;
    }
    if (assessment.severity === HostHealthSeverity.Warning) {
      return 1;
    }
    return 2;
  };
  const severity: number = rank(a.assessment) - rank(b.assessment);
  if (severity !== 0) {
    return severity;
  }
  const reasons: number =
    b.assessment.fleetReasons.length - a.assessment.fleetReasons.length;
  if (reasons !== 0) {
    return reasons;
  }
  return a.name.localeCompare(b.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}
