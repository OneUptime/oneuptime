import {
  HOST_DISK_FULL_PERCENT,
  HOST_DISK_NEAR_FULL_PERCENT,
  HOST_MEMORY_CRITICAL_PERCENT,
  HOST_MEMORY_HIGH_PERCENT,
  HostHealthAssessment,
  HostHealthRow,
  HostHealthText,
  HostHealthTone,
  assessHost,
  toHostDate,
  toHostNumber,
} from "Common/Types/Host/HostHealth";

/*
 * WHAT A HOST'S ROW AND HERO SAY, FROM WHAT IT LAST REPORTED.
 *
 * The Hosts list's Status, CPU, Memory and Disk cells and the uptime in a
 * host's hero, worked out from the host's record (HostReadingsScan stores
 * the readings, HostHealth judges them), so the list, its Needs attention
 * card and the host's page say one thing. React-free: App tests read it.
 *
 * A bar is coloured by the line HostHealth draws for it - amber where the
 * host needs a look, red where it is critical - so a red Memory cell is a
 * host the Needs attention card lists. CPU has no such line (a busy CPU is
 * a host at work; the load says when work queues), so a very busy one is
 * amber, never red. A host that is not reporting, or whose readings are
 * too old to judge, shows no numbers rather than old ones.
 */

export type HostUsageKind = "cpu" | "memory" | "disk";

// CPU's bar turns amber past this: busy, and worth a glance.
export const HOST_CPU_BUSY_PERCENT: number = 90;

export interface HostUsage {
  // Null when there is no fresh reading: the cell shows a dash.
  percent: number | null;
  tone: HostHealthTone;
}

export function getHostUsageTone(
  kind: HostUsageKind,
  percent: number,
): HostHealthTone {
  switch (kind) {
    case "cpu":
      return percent > HOST_CPU_BUSY_PERCENT ? "warning" : "positive";
    case "memory":
      if (percent > HOST_MEMORY_CRITICAL_PERCENT) {
        return "danger";
      }
      return percent > HOST_MEMORY_HIGH_PERCENT ? "warning" : "positive";
    case "disk":
      if (percent > HOST_DISK_FULL_PERCENT) {
        return "danger";
      }
      return percent > HOST_DISK_NEAR_FULL_PERCENT ? "warning" : "positive";
  }
}

const USAGE_COLUMN: Record<HostUsageKind, keyof HostHealthRow> = {
  cpu: "latestCpuPercent",
  memory: "latestMemoryPercent",
  disk: "latestDiskPercent",
};

export function getHostUsage(data: {
  row: HostHealthRow;
  kind: HostUsageKind;
  now: Date;
}): HostUsage {
  const assessment: HostHealthAssessment = assessHost(data.row, {
    now: data.now,
  });
  const value: number | null = toHostNumber(data.row[USAGE_COLUMN[data.kind]]);

  if (
    !assessment.isReporting ||
    !assessment.hasFreshReadings ||
    value === null
  ) {
    return { percent: null, tone: "neutral" };
  }

  const percent: number = Math.min(100, Math.max(0, value));
  return { percent: percent, tone: getHostUsageTone(data.kind, percent) };
}

// A percent as a cell writes it: whole from 10, one decimal below ("4.2%").
export function formatHostUsagePercent(percent: number): string {
  return percent >= 10 || percent === 0
    ? `${Math.round(percent)}%`
    : `${percent.toFixed(1)}%`;
}

export interface HostStatusFacts {
  // The word the Status cell's badge says, an English key.
  status: HostHealthText;
  tone: HostHealthTone;
  // The most telling reason, under the badge, when something needs a look.
  firstReason: HostHealthText | null;
  // How many more reasons the row has.
  moreReasons: number;
  // A host whose collector is still starting: its badge pulses.
  isStarting: boolean;
  /*
   * A host that stopped reporting: when it last did, said under its badge
   * in place of a reason that would only repeat "Not reporting".
   */
  lastReportedAt: Date | null;
}

export function getHostStatusFacts(data: {
  row: HostHealthRow;
  now: Date;
}): HostStatusFacts {
  const assessment: HostHealthAssessment = assessHost(data.row, {
    now: data.now,
  });

  // A reason that is the badge's own word says nothing more.
  const reasons: Array<HostHealthText> = assessment.fleetReasons.filter(
    (reason: HostHealthText): boolean => {
      return Boolean(reason.values) || reason.text !== assessment.status.text;
    },
  );

  return {
    status: assessment.status,
    tone: assessment.tone,
    firstReason: reasons[0] || null,
    moreReasons: Math.max(0, reasons.length - 1),
    isStarting: assessment.state === "starting",
    lastReportedAt:
      assessment.state === "not-reporting"
        ? toHostDate(data.row.lastSeenAt)
        : null,
  };
}

/*
 * How long the host has been up, in seconds, while it reports and has told
 * when it started; null otherwise (a host that stopped reporting is not
 * "up").
 */
export function getHostUptimeSeconds(data: {
  row: HostHealthRow & { bootedAt?: Date | string | null | undefined };
  now: Date;
}): number | null {
  const assessment: HostHealthAssessment = assessHost(data.row, {
    now: data.now,
  });
  const bootedAt: Date | null = toHostDate(data.row.bootedAt);

  if (!assessment.isReporting || !bootedAt) {
    return null;
  }

  const seconds: number = Math.floor(
    (data.now.getTime() - bootedAt.getTime()) / 1000,
  );
  return seconds >= 0 ? seconds : null;
}

// Bytes as the host pages write them: 1024-based, 16 GiB.
export function formatHostBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
    return "—";
  }
  const units: Array<string> = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let value: number = bytes;
  let index: number = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[index]}`;
}
