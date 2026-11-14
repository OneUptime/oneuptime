import { formatReaderFigure } from "Common/Types/DateLanguage";
import { formatDurationCompactInLanguage } from "Common/Utils/Slo/SloDuration";
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

/*
 * The load tile's bar (its 1-minute load as a share of the cores) turns
 * amber past this: more work than cores, so work queues, as the tile's (i)
 * says. Never red: the rules never call load critical (HostHealth lists a
 * 15-minute load above twice the cores as one to look at), so a red bar
 * would say more than the host's Needs attention does.
 */
export const HOST_LOAD_QUEUING_PERCENT: number = 100;

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

/*
 * A percent as a cell writes it: whole from 10, one decimal below ("4.2%"),
 * in the reader's digits and percent sign ("۴٫۲٪" in Persian, "4,2 %" in
 * German; issue #7106).
 */
export function formatHostUsagePercent(percent: number): string {
  return formatReaderFigure(percent, {
    decimals: percent >= 10 || percent === 0 ? 0 : 1,
    isPercent: true,
  });
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
 * Whether a host's hero says "Starting" in place of its connection: a host
 * OneUptime installed the collector on (Add Host), within its first ten
 * minutes and still waiting for its first metrics - what its row in the
 * Hosts list and the "This host is starting" card under the hero say. A
 * host whose collector was set up by hand reads "Disconnected" until it
 * reports, as its connection card ("Connect this host") explains.
 */
export function isHostStarting(data: {
  row: HostHealthRow;
  now: Date;
}): boolean {
  if (!data.row.collectorInstanceUid) {
    return false;
  }

  return assessHost(data.row, { now: data.now }).state === "starting";
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

/*
 * How long a host has been up, as its hero's chip says it: "Up 12d 4h",
 * "Up 41d" - the largest unit and the one right below it, in `language`
 * ("41 Tg." in German, "۴۱ روز" in Persian). Never a day count with
 * seconds beside it: a host booted 41 days and a second ago read "41d 1s",
 * noise next to a day count that changed every second.
 */
export function formatHostUptime(
  seconds: number,
  language?: string | undefined,
): string {
  return formatDurationCompactInLanguage(seconds, language, {
    adjacentUnitsOnly: true,
  });
}

/*
 * Bytes as the host pages write them: 1024-based, "16 GiB", one decimal
 * under ten from KiB up ("8.0 GiB"). A count of bytes is a whole number,
 * so plain bytes keep none: "0 B", "512 B", never "0.0 B" (issue #7417).
 * Every host page - the Overview, the process list and a process's page -
 * writes its sizes with this one.
 */
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
  // The number in the reader's digits, the unit as written: "۱۶ GiB".
  return `${formatReaderFigure(value, {
    decimals: index > 0 && value < 10 ? 1 : 0,
  })} ${units[index]}`;
}
