import BadDataException from "../Exception/BadDataException";
import ObjectID from "../ObjectID";

/*
 * ONE IMPORT OF DISCOVERED HOSTS AS NETWORK DEVICES (Network > Discovery >
 * Review Results > Import).
 *
 * The import used to run in the browser: one create per host, one after
 * another, with nothing on screen but a spinning button. A scan of 514
 * point-of-sale registers was a thousand requests (a device and a monitor per
 * host) that took minutes, showed no progress, piled every failure into one
 * long sentence, and stopped the moment the tab was closed or the page was
 * left (OneUptime issue #4812).
 *
 * It runs on the server now, as a job: the dialog asks for the hosts and how
 * they are monitored, the server records the import and a worker creates the
 * devices and monitors, writing what happened to each host as it goes. The
 * dialog - or anyone else's, or the same one reopened an hour later - reads
 * that record to draw progress, the failures with their reasons and the
 * finished summary, and asks for the failed hosts to be tried again.
 *
 * These are the shapes the server, the worker and the Dashboard share, and
 * the rules all three apply to them. React-free and database-free, so every
 * rule is tested on its own.
 */

/*
 * Where an import is.
 *
 *  - Queued: waiting for its turn. One import of a project runs at a time,
 *    so a second one waits for the first rather than racing it for the same
 *    addresses.
 *  - Running: a worker is creating its devices and monitors.
 *  - Completed: every host was dealt with. Some may have failed, each with
 *    its reason; the import as a whole still completed.
 *  - Stopped: someone stopped it. What was created is kept; the hosts it had
 *    not reached are listed as not imported, and can be tried again.
 *  - Failed: the import as a whole could not go on - its owner left the
 *    project or lost the right to create devices, the scan was deleted, a
 *    worker died more often than it may be resumed. Its message says which.
 */
export enum DiscoveryImportStatus {
  Queued = "Queued",
  Running = "Running",
  Completed = "Completed",
  Stopped = "Stopped",
  Failed = "Failed",
}

export const ALL_DISCOVERY_IMPORT_STATUSES: ReadonlyArray<DiscoveryImportStatus> =
  [
    DiscoveryImportStatus.Queued,
    DiscoveryImportStatus.Running,
    DiscoveryImportStatus.Completed,
    DiscoveryImportStatus.Stopped,
    DiscoveryImportStatus.Failed,
  ];

// The statuses of an import that has not finished yet.
export const ACTIVE_DISCOVERY_IMPORT_STATUSES: ReadonlyArray<DiscoveryImportStatus> =
  [DiscoveryImportStatus.Queued, DiscoveryImportStatus.Running];

export function isDiscoveryImportStatus(
  value: unknown,
): value is DiscoveryImportStatus {
  return (
    typeof value === "string" &&
    (ALL_DISCOVERY_IMPORT_STATUSES as ReadonlyArray<string>).includes(value)
  );
}

export function isDiscoveryImportActive(
  status: DiscoveryImportStatus | null | undefined,
): boolean {
  return Boolean(
    status &&
      (ACTIVE_DISCOVERY_IMPORT_STATUSES as ReadonlyArray<string>).includes(
        status,
      ),
  );
}

/*
 * Who hears about a problem with an imported device.
 *
 *  - None: the import creates no monitor. Every device still has a status
 *    from its probe's polls - Up or Down on its page, its site and the map -
 *    and an alert policy that covers it still gives it the policy's monitor.
 *  - MonitorTemplate: every device gets one monitor made from a template the
 *    reader picks, so the template's criteria decide what raises an
 *    incident or an alert. From a Network Device template, the same kind of
 *    monitor an alert policy or an auto import rule makes: evaluated every
 *    time the device's poll results arrive, for a device that only answers
 *    ping as much as for one walked over SNMP. From a Ping, IP, Port or NTP
 *    template (issue #5145), a monitor that checks the device's address on
 *    the template's own schedule, from the probe that polls the device
 *    (DeviceMonitorTemplateUtil).
 */
export enum DiscoveryImportAlerting {
  None = "None",
  MonitorTemplate = "MonitorTemplate",
}

export function isDiscoveryImportAlerting(
  value: unknown,
): value is DiscoveryImportAlerting {
  return (
    value === DiscoveryImportAlerting.None ||
    value === DiscoveryImportAlerting.MonitorTemplate
  );
}

/*
 * How often the scan's probe checks each imported device: it pings every one
 * of them, and walks the ones that answered SNMP, on this schedule. Written
 * onto each device as its Polling Interval, so it can be changed per device
 * afterwards. The same choices as everywhere a schedule is picked, from a
 * minute (a walk of a large switch takes tens of seconds) to an hour.
 */
export const DISCOVERY_IMPORT_POLLING_INTERVALS_IN_MINUTES: ReadonlyArray<number> =
  [1, 2, 5, 10, 15, 30, 60];

/*
 * The column default of NetworkDevice.pollingIntervalInMinutes, which is what
 * a discovered device was polled at before the import let anyone choose.
 */
export const DEFAULT_DISCOVERY_IMPORT_POLLING_INTERVAL_IN_MINUTES: number = 5;

/*
 * Hosts one import may carry. A host is a device create and, with a template,
 * a monitor create, each running the full pipeline (site rules, owners,
 * labels, alert policies; the plan, status and status pages for a monitor),
 * so five thousand is already a long job. A scan that found more is imported
 * in several goes, which the dialog's filters make a click each - the SNMP
 * hosts, then the ones that answered ping, or one subnet at a time.
 */
export const MAX_HOSTS_PER_DISCOVERY_IMPORT: number = 5000;

export interface DiscoveryImportSettings {
  pollingIntervalInMinutes: number;
  /*
   * Give each device that answered SNMP its vendor's health template on its
   * first poll - CPU, memory, temperature, fans - as auto import rules do.
   * Means nothing for a device that only answered ping: there is no
   * sysObjectID to match a template by.
   */
  applyVendorTemplates: boolean;
  alerting: DiscoveryImportAlerting;
  /*
   * The monitor template - a Network Device, Ping, IP, Port or NTP one - when
   * alerting is MonitorTemplate.
   */
  monitorTemplateId?: string | undefined;
}

export const DEFAULT_DISCOVERY_IMPORT_SETTINGS: DiscoveryImportSettings = {
  pollingIntervalInMinutes:
    DEFAULT_DISCOVERY_IMPORT_POLLING_INTERVAL_IN_MINUTES,
  applyVendorTemplates: true,
  alerting: DiscoveryImportAlerting.None,
};

export function isDiscoveryImportPollingInterval(value: unknown): boolean {
  return (
    typeof value === "number" &&
    DISCOVERY_IMPORT_POLLING_INTERVALS_IN_MINUTES.includes(value)
  );
}

// "1, 2, 5, 10, 15, 30 or 60": the choices as a sentence says them.
const POLLING_INTERVAL_CHOICES_TEXT: string = `${DISCOVERY_IMPORT_POLLING_INTERVALS_IN_MINUTES.slice(0, -1).join(", ")} or ${DISCOVERY_IMPORT_POLLING_INTERVALS_IN_MINUTES[DISCOVERY_IMPORT_POLLING_INTERVALS_IN_MINUTES.length - 1]}`;

export const DISCOVERY_IMPORT_POLLING_INTERVAL_REFUSAL: string = `Pick how often devices are checked: every ${POLLING_INTERVAL_CHOICES_TEXT} minutes.`;

/*
 * A polling interval as a request or a row carries it: one of the choices,
 * or null for "the device's default". Anything else is refused - a number
 * that is not a choice is a mistake, not a default.
 */
export function readDiscoveryImportPollingInterval(
  value: unknown,
): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const minutes: number =
    typeof value === "string" ? Number(value.trim()) : (value as number);

  if (!isDiscoveryImportPollingInterval(minutes)) {
    throw new BadDataException(DISCOVERY_IMPORT_POLLING_INTERVAL_REFUSAL);
  }

  return minutes;
}

/*
 * The settings an import was asked for, checked: a request body, or a
 * stored row, read into the shape the worker trusts. Missing values take
 * their defaults; a value that is there but wrong is refused with a sentence
 * that says what is wrong, never quietly replaced - an import of five
 * hundred devices at the wrong interval is not a small mistake.
 */
export function readDiscoveryImportSettings(
  value: unknown,
): DiscoveryImportSettings {
  const record: Record<string, unknown> =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const settings: DiscoveryImportSettings = {
    ...DEFAULT_DISCOVERY_IMPORT_SETTINGS,
  };

  const interval: number | null = readDiscoveryImportPollingInterval(
    record["pollingIntervalInMinutes"],
  );

  if (interval !== null) {
    settings.pollingIntervalInMinutes = interval;
  }

  const applyVendorTemplates: unknown = record["applyVendorTemplates"];

  if (applyVendorTemplates !== undefined && applyVendorTemplates !== null) {
    if (typeof applyVendorTemplates !== "boolean") {
      throw new BadDataException(
        "Whether to apply each SNMP device's vendor template must be true or false.",
      );
    }

    settings.applyVendorTemplates = applyVendorTemplates;
  }

  const alerting: unknown = record["alerting"];

  if (alerting !== undefined && alerting !== null) {
    if (!isDiscoveryImportAlerting(alerting)) {
      throw new BadDataException(
        "Choose whether the import creates a monitor for each device.",
      );
    }

    settings.alerting = alerting;
  }

  if (settings.alerting === DiscoveryImportAlerting.MonitorTemplate) {
    const monitorTemplateId: unknown = record["monitorTemplateId"];

    if (
      typeof monitorTemplateId !== "string" ||
      !ObjectID.isValidUUID(monitorTemplateId.trim())
    ) {
      throw new BadDataException(
        "Pick the monitor template each imported device is monitored with.",
      );
    }

    settings.monitorTemplateId = monitorTemplateId.trim();
  }

  return settings;
}

/*
 * What happened to one host's DEVICE.
 *
 *  - Pending: not reached yet.
 *  - Created: this import created it.
 *  - AlreadyAdded: a device at this address was already there - created by
 *    another import, an auto import rule or a person since the scan was
 *    reviewed. Nothing was created twice; its monitor is still seen to.
 *  - Failed: the create was refused; `deviceError` says why.
 *  - NotReached: the import was stopped before it got here.
 */
export enum DiscoveryImportDeviceOutcome {
  Pending = "Pending",
  Created = "Created",
  AlreadyAdded = "AlreadyAdded",
  Failed = "Failed",
  NotReached = "NotReached",
}

/*
 * What happened to one host's MONITOR.
 *
 *  - NotRequested: the import creates no monitors.
 *  - Pending: not reached yet.
 *  - Created: this import created it from the template.
 *  - AlreadyThere: the device already had a monitor from this template - an
 *    alert policy's, or an earlier import's. Nothing was created twice.
 *  - Failed: the create was refused; `monitorError` says why. The device is
 *    imported all the same.
 *  - Skipped: there was nothing to create it for - the device was not
 *    imported, or it takes its status from a monitor bound to it, which a
 *    Network Device monitor cannot read. `monitorError` says which.
 */
export enum DiscoveryImportMonitorOutcome {
  NotRequested = "NotRequested",
  Pending = "Pending",
  Created = "Created",
  AlreadyThere = "AlreadyThere",
  Failed = "Failed",
  Skipped = "Skipped",
}

/*
 * The import's OWN reasons for a host it did not finish, as each host's
 * result carries them (deviceError / monitorError).
 *
 * The progress view lists the hosts that ended the same way under one
 * heading - "491 hosts were not reached", then the reason - so each reason
 * is worded to read right under a heading for one host or for hundreds. The
 * Dashboard has a translation of each (DiscoveryImportProgressModel's
 * DISCOVERY_IMPORT_TRANSLATED_REASONS, held to this list by a test); a
 * reason the server words itself - a plan's limit, a refused permission -
 * reads as written.
 */
// A host the import never got to, because someone stopped it.
export const DISCOVERY_IMPORT_STOPPED_REASON: string =
  "The import was stopped.";
// A host the import never got to, because the import itself failed.
export const DISCOVERY_IMPORT_UNFINISHED_REASON: string =
  "The import stopped before it finished.";
// A device that takes its status from a monitor bound to it.
export const DISCOVERY_IMPORT_MONITOR_BACKED_REASON: string =
  "A device that takes its status from a monitor bound to it gets no Network Device monitor: it would have nothing to read.";
// A host whose device was not imported, so its monitor was not made either.
export const DISCOVERY_IMPORT_NO_DEVICE_NO_MONITOR_REASON: string =
  "The device was not imported, so it has no monitor.";

export const DISCOVERY_IMPORT_OWN_REASONS: ReadonlyArray<string> = [
  DISCOVERY_IMPORT_STOPPED_REASON,
  DISCOVERY_IMPORT_UNFINISHED_REASON,
  DISCOVERY_IMPORT_MONITOR_BACKED_REASON,
  DISCOVERY_IMPORT_NO_DEVICE_NO_MONITOR_REASON,
];

export interface DiscoveryImportHostResult {
  ipAddress: string;
  // The name the device was given, or will be given.
  name: string;
  // The host answered ping but not SNMP.
  isPingOnly: boolean;
  device: DiscoveryImportDeviceOutcome;
  deviceId?: string | undefined;
  deviceError?: string | undefined;
  monitor: DiscoveryImportMonitorOutcome;
  monitorId?: string | undefined;
  monitorError?: string | undefined;
}

/*
 * The counts the progress bars and the summary are drawn from, worked out
 * from the results so they can never disagree with the list under them.
 * Devices and monitors are counted apart, because they are separate work
 * with separate ways to fail: a device can be imported while its monitor is
 * refused by the plan's limit.
 */
export interface DiscoveryImportProgress {
  hosts: number;
  // Hosts whose device and monitor are both settled.
  hostsDone: number;
  devicesCreated: number;
  devicesAlreadyAdded: number;
  devicesFailed: number;
  devicesNotReached: number;
  // Hosts the import creates a monitor for: every host, with a template.
  monitorsRequested: number;
  monitorsCreated: number;
  monitorsAlreadyThere: number;
  monitorsFailed: number;
  monitorsSkipped: number;
}

export function isDeviceOutcomeSettled(
  outcome: DiscoveryImportDeviceOutcome,
): boolean {
  return outcome !== DiscoveryImportDeviceOutcome.Pending;
}

export function isMonitorOutcomeSettled(
  outcome: DiscoveryImportMonitorOutcome,
): boolean {
  return outcome !== DiscoveryImportMonitorOutcome.Pending;
}

export function isHostResultSettled(
  result: DiscoveryImportHostResult,
): boolean {
  return (
    isDeviceOutcomeSettled(result.device) &&
    isMonitorOutcomeSettled(result.monitor)
  );
}

export function emptyDiscoveryImportProgress(): DiscoveryImportProgress {
  return {
    hosts: 0,
    hostsDone: 0,
    devicesCreated: 0,
    devicesAlreadyAdded: 0,
    devicesFailed: 0,
    devicesNotReached: 0,
    monitorsRequested: 0,
    monitorsCreated: 0,
    monitorsAlreadyThere: 0,
    monitorsFailed: 0,
    monitorsSkipped: 0,
  };
}

export function summarizeDiscoveryImportResults(
  results: ReadonlyArray<DiscoveryImportHostResult>,
): DiscoveryImportProgress {
  const progress: DiscoveryImportProgress = emptyDiscoveryImportProgress();

  for (const result of results) {
    progress.hosts++;

    if (isHostResultSettled(result)) {
      progress.hostsDone++;
    }

    switch (result.device) {
      case DiscoveryImportDeviceOutcome.Created:
        progress.devicesCreated++;
        break;
      case DiscoveryImportDeviceOutcome.AlreadyAdded:
        progress.devicesAlreadyAdded++;
        break;
      case DiscoveryImportDeviceOutcome.Failed:
        progress.devicesFailed++;
        break;
      case DiscoveryImportDeviceOutcome.NotReached:
        progress.devicesNotReached++;
        break;
      default:
        break;
    }

    if (result.monitor === DiscoveryImportMonitorOutcome.NotRequested) {
      continue;
    }

    progress.monitorsRequested++;

    switch (result.monitor) {
      case DiscoveryImportMonitorOutcome.Created:
        progress.monitorsCreated++;
        break;
      case DiscoveryImportMonitorOutcome.AlreadyThere:
        progress.monitorsAlreadyThere++;
        break;
      case DiscoveryImportMonitorOutcome.Failed:
        progress.monitorsFailed++;
        break;
      case DiscoveryImportMonitorOutcome.Skipped:
        progress.monitorsSkipped++;
        break;
      default:
        break;
    }
  }

  return progress;
}

// Devices dealt with, of the hosts: what the device bar shows.
export function countSettledDevices(progress: DiscoveryImportProgress): number {
  return (
    progress.devicesCreated +
    progress.devicesAlreadyAdded +
    progress.devicesFailed +
    progress.devicesNotReached
  );
}

// Monitors dealt with, of those asked for: what the monitor bar shows.
export function countSettledMonitors(
  progress: DiscoveryImportProgress,
): number {
  return (
    progress.monitorsCreated +
    progress.monitorsAlreadyThere +
    progress.monitorsFailed +
    progress.monitorsSkipped
  );
}

/*
 * Whether a host is worth trying again: its device was refused or never
 * reached, or the device is there and its monitor was refused. A host whose
 * monitor was skipped because its device takes its status from a bound
 * monitor is not: trying again would skip it again. Trying again never
 * creates anything twice - a device already at the address is found, not
 * re-created, and a monitor already made from the template is found too.
 */
export function isHostResultRetryable(
  result: DiscoveryImportHostResult,
): boolean {
  if (
    result.device === DiscoveryImportDeviceOutcome.Failed ||
    result.device === DiscoveryImportDeviceOutcome.NotReached
  ) {
    return true;
  }

  return result.monitor === DiscoveryImportMonitorOutcome.Failed;
}

export function getRetryableHostResults(
  results: ReadonlyArray<DiscoveryImportHostResult>,
): Array<DiscoveryImportHostResult> {
  return results.filter(isHostResultRetryable);
}

/*
 * One import, as the API hands it to the Dashboard: what the progress view,
 * the scan list's banner and the finished summary are drawn from.
 */
export interface DiscoveryImportView {
  id: string;
  scanId: string;
  status: DiscoveryImportStatus;
  settings: DiscoveryImportSettings;
  // The template's name when the import began, so the summary can say it.
  monitorTemplateName?: string | undefined;
  progress: DiscoveryImportProgress;
  createdAt: string;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  createdByUserName?: string | undefined;
  // The person looking started it.
  isMine: boolean;
  // Why the import as a whole failed, when it did.
  error?: string | undefined;
  // The import this one tries again, when it is a retry.
  retryOfImportId?: string | undefined;
  // Someone asked it to stop, and it has not reached the next host yet.
  isStopRequested?: boolean | undefined;
  /*
   * Per host: the failures (and hosts not reached) by default, every host
   * when the caller asks for them all. `hasMoreResults` is true when the
   * list was cut short.
   */
  results?: Array<DiscoveryImportHostResult> | undefined;
  hasMoreResults?: boolean | undefined;
}

// How many results a view carries when it does not carry them all.
export const DISCOVERY_IMPORT_VIEW_RESULT_LIMIT: number = 500;

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

export function readDiscoveryImportProgress(
  value: unknown,
): DiscoveryImportProgress {
  const record: Record<string, unknown> =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const progress: DiscoveryImportProgress = emptyDiscoveryImportProgress();

  for (const key of Object.keys(progress) as Array<
    keyof DiscoveryImportProgress
  >) {
    progress[key] = readCount(record[key]);
  }

  return progress;
}

const DEVICE_OUTCOMES: ReadonlyArray<string> = Object.values(
  DiscoveryImportDeviceOutcome,
);
const MONITOR_OUTCOMES: ReadonlyArray<string> = Object.values(
  DiscoveryImportMonitorOutcome,
);

function readOptionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/*
 * One stored or received result, checked: a row a newer server wrote with
 * an outcome this build does not know is read as still pending rather than
 * drawn as something it is not.
 */
export function readDiscoveryImportHostResult(
  value: unknown,
): DiscoveryImportHostResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const ipAddress: string =
    typeof record["ipAddress"] === "string" ? record["ipAddress"] : "";

  if (!ipAddress) {
    return null;
  }

  const result: DiscoveryImportHostResult = {
    ipAddress: ipAddress,
    name:
      typeof record["name"] === "string" && record["name"]
        ? record["name"]
        : ipAddress,
    isPingOnly: record["isPingOnly"] === true,
    device: DEVICE_OUTCOMES.includes(String(record["device"]))
      ? (record["device"] as DiscoveryImportDeviceOutcome)
      : DiscoveryImportDeviceOutcome.Pending,
    monitor: MONITOR_OUTCOMES.includes(String(record["monitor"]))
      ? (record["monitor"] as DiscoveryImportMonitorOutcome)
      : DiscoveryImportMonitorOutcome.Pending,
  };

  const deviceId: string | undefined = readOptionalText(record["deviceId"]);
  const deviceError: string | undefined = readOptionalText(
    record["deviceError"],
  );
  const monitorId: string | undefined = readOptionalText(record["monitorId"]);
  const monitorError: string | undefined = readOptionalText(
    record["monitorError"],
  );

  if (deviceId) {
    result.deviceId = deviceId;
  }

  if (deviceError) {
    result.deviceError = deviceError;
  }

  if (monitorId) {
    result.monitorId = monitorId;
  }

  if (monitorError) {
    result.monitorError = monitorError;
  }

  return result;
}

export function readDiscoveryImportHostResults(
  value: unknown,
): Array<DiscoveryImportHostResult> {
  if (!Array.isArray(value)) {
    return [];
  }

  const results: Array<DiscoveryImportHostResult> = [];

  for (const item of value) {
    const result: DiscoveryImportHostResult | null =
      readDiscoveryImportHostResult(item);

    if (result) {
      results.push(result);
    }
  }

  return results;
}

/*
 * An import as the server described it, checked: one whose status this
 * build does not know is dropped rather than drawn half-known.
 */
export function readDiscoveryImportView(
  value: unknown,
): DiscoveryImportView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;

  if (
    typeof record["id"] !== "string" ||
    typeof record["scanId"] !== "string" ||
    !isDiscoveryImportStatus(record["status"])
  ) {
    return null;
  }

  let settings: DiscoveryImportSettings;

  try {
    settings = readDiscoveryImportSettings(record["settings"]);
  } catch {
    settings = { ...DEFAULT_DISCOVERY_IMPORT_SETTINGS };
  }

  const view: DiscoveryImportView = {
    id: record["id"],
    scanId: record["scanId"],
    status: record["status"],
    settings: settings,
    progress: readDiscoveryImportProgress(record["progress"]),
    createdAt:
      typeof record["createdAt"] === "string" ? record["createdAt"] : "",
    isMine: record["isMine"] === true,
  };

  const optionalTexts: Array<
    keyof Pick<
      DiscoveryImportView,
      | "monitorTemplateName"
      | "startedAt"
      | "completedAt"
      | "createdByUserName"
      | "error"
      | "retryOfImportId"
    >
  > = [
    "monitorTemplateName",
    "startedAt",
    "completedAt",
    "createdByUserName",
    "error",
    "retryOfImportId",
  ];

  for (const key of optionalTexts) {
    const text: string | undefined = readOptionalText(record[key]);

    if (text) {
      view[key] = text;
    }
  }

  if (record["isStopRequested"] === true) {
    view.isStopRequested = true;
  }

  if (Array.isArray(record["results"])) {
    view.results = readDiscoveryImportHostResults(record["results"]);
  }

  if (record["hasMoreResults"] === true) {
    view.hasMoreResults = true;
  }

  return view;
}
