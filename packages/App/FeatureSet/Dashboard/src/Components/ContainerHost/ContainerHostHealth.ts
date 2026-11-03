import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionText,
  ResourceHealth,
  getResourceAttentionHealth,
  mergeResourceAttentionSeverity,
  sortResourceAttention,
} from "../ResourcePart/ResourceAttention";
import {
  ResourcePartStatus,
  ResourcePartTone,
} from "../ResourcePart/ResourcePartTypes";
import {
  OpenIssueRecord,
  readSeriesLabel,
  sameName,
} from "../ResourceTopology/ResourceTopologyIssues";

/*
 * WHAT ON A DOCKER OR PODMAN HOST NEEDS SOMEONE, AND HOW BAD IT IS.
 *
 * One set of rules for every page that says it - the host's Overview (its
 * health pill and Needs attention card), its Containers list, a container's
 * own page and the Topology - and for both runtimes: the two agents run the
 * same docker_stats receiver (Podman through its Docker-compatible socket),
 * so a Podman container reads exactly as a Docker one does.
 *
 * What the agent tells about each container is what it measures every 30
 * seconds while the container runs: its CPU, its memory, how many times
 * its restart policy restarted it (container.restarts.increase, which a
 * restart by hand does not move) and how long it has been up. Its rules:
 *
 *   Critical - broken:
 *     restarted more than 3 times in the last 15 minutes: it keeps
 *     crashing and its restart policy keeps bringing it back (the Container
 *     Restart Loop alert's line).
 *   Warning - needs a look soon:
 *     restarted 1 to 3 times in the last 15 minutes: it crashed and came
 *     back; using more than 85% of its memory (of its limit, or of the
 *     host's memory when it has none - the High Container Memory Usage
 *     alert's line: past its limit the kernel kills it); and a container
 *     that ran for 10 minutes or more and then stopped reporting while the
 *     host's other containers still report - a service that stopped, or was
 *     removed. The agent is a container itself, so a host whose agent works
 *     always has a container that reports.
 *
 * What is never a problem by itself: a busy CPU (a container on several
 * cores reads above 100% by design; its figure turns amber past the High
 * Container CPU Usage alert's line, and the alert says the rest), a
 * container that was just started or redeployed, and a short-lived one
 * that finished - a job, a migration, a `docker compose run` one-off: it
 * reads Not reporting, in grey, until OneUptime forgets it.
 *
 * What the agent cannot tell: a container that was already stopped when it
 * started, a health check's verdict, an exit code, and whether a container
 * that stopped reporting exited, crashed for good or was removed -
 * docker_stats reads running containers only. OneUptime forgets a
 * container 15 minutes after its last reading
 * (Docker:CleanupStaleResources), so one that stopped is listed, as Not
 * reporting, for those 15 minutes.
 *
 * The words are English, marked as keys of the Dashboard's locales and
 * looked up where they are drawn; they never name a runtime, so one set
 * serves both. React-free (no Route building: pages hand in routes), so App
 * tests can read it.
 */

// Restarts in the window past which a container is crash-looping.
export const CONTAINER_RESTART_LOOP_RESTARTS: number = 3;

// The window the restarts are counted over, as the alert counts them.
export const CONTAINER_RESTART_WINDOW_MINUTES: number = 15;

// The alerts' lines the pages colour by: past them the alerts fire.
export const CONTAINER_MEMORY_WARNING_PERCENT: number = 85;
export const CONTAINER_CPU_WARNING_PERCENT: number = 80;

/*
 * The agent reads every container every 30 seconds: six readings missed in
 * a row, while the host's other containers report, is a container that
 * stopped rather than a late batch.
 */
export const CONTAINER_NOT_REPORTING_MS: number = 3 * 60 * 1000;

/*
 * How long a container must have run before it stopped for its stopping to
 * need a look: a service runs for hours, a job or a one-off for seconds or
 * minutes.
 */
export const CONTAINER_LONG_RUNNING_MS: number = 10 * 60 * 1000;

// How long OneUptime keeps a container after its last reading.
export const CONTAINER_FORGOTTEN_AFTER_MINUTES: number = 15;

// The label Compose puts on what `docker compose run` starts.
export const CONTAINER_COMPOSE_ONEOFF_LABEL: string =
  "com.docker.compose.oneoff";

// The labels Compose (and podman-compose) put on what they create.
export const CONTAINER_COMPOSE_PROJECT_LABELS: ReadonlyArray<string> = [
  "com.docker.compose.project",
  "io.podman.compose.project",
];
export const CONTAINER_COMPOSE_SERVICE_LABELS: ReadonlyArray<string> = [
  "com.docker.compose.service",
  "io.podman.compose.service",
];

// One container as the host's pages read it: its row and latest readings.
export interface ContainerHostContainer {
  // Its name, as `docker ps` shows it: the key the pages link by.
  name: string;
  // Its id as the agent reports it (64 characters; logs are filed under it).
  containerId: string | null;
  image: string | null;
  // Latest readings in the last 5 minutes; null when none arrived.
  cpuPercent: number | null;
  memoryBytes: number | null;
  memoryPercent: number | null;
  networkRxBytes: number | null;
  networkTxBytes: number | null;
  /*
   * Restarts its restart policy made in the last 15 minutes; null when the
   * agent sends no count (an agent older than the count).
   */
  restarts: number | null;
  // When its current run started, from its uptime; null when unknown.
  startedAt: Date | null;
  // When the agent last sent a reading of it.
  lastReadingAt: Date | null;
  // The labels the agent copies (Compose project and service, ...).
  labels: JSONObject | null;
}

export type ContainerHostState =
  | "running"
  | "restart-loop"
  | "stopped"
  | "not-reporting";

export interface ContainerHostAssessment {
  state: ContainerHostState;
  severity: ResourceAttentionSeverity | null;
  // Its state in a word, coloured by how it is doing.
  status: ResourcePartStatus;
  // Why it needs attention, most urgent first; empty when it does not.
  reasons: Array<ResourceAttentionText>;
}

/*
 * ---------------------------------------------------------------------------
 * Words
 * ---------------------------------------------------------------------------
 */
export const CONTAINER_KIND: string = translationKey("Container");

// How a container's page names its own row: NeedsAttentionCard's current.
export const THIS_CONTAINER_LABEL: string = translationKey("This container");

export const CONTAINER_STATUS_RUNNING: string = translationKey("Running");
export const CONTAINER_STATUS_RESTART_LOOP: string =
  translationKey("Restart loop");
export const CONTAINER_STATUS_STOPPED: string =
  translationKey("Stopped reporting");
export const CONTAINER_STATUS_NOT_REPORTING: string =
  translationKey("Not reporting");

const STATUS_RESTART_LOOP_DESCRIPTION: string = translationKey(
  "Its restart policy restarted it more than 3 times in the last 15 minutes: it keeps crashing.",
);
const STATUS_STOPPED_DESCRIPTION: string = translationKey(
  "It ran for 10 minutes or more, and no reading of it has arrived for more than 3 minutes while the host's other containers report: it stopped, or was removed.",
);
const STATUS_NOT_REPORTING_DESCRIPTION: string = translationKey(
  "No reading of it has arrived for more than 3 minutes. A job or a one-off that finished reads so until OneUptime forgets it, 15 minutes after its last reading.",
);

const REASON_STOPPED: string = translationKey("Stopped reporting");
const REASON_RESTARTS: { one: string; other: string } = {
  one: translationKey("{{count}} restart in 15 minutes"),
  other: translationKey("{{count}} restarts in 15 minutes"),
};
const REASON_MEMORY: string = translationKey("Memory {{percent}} used");

/*
 * ---------------------------------------------------------------------------
 * Readings
 * ---------------------------------------------------------------------------
 */

// A reason's percent: one decimal at most, so 85.4 never reads as 85.
export function formatContainerReasonPercent(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

/*
 * The newest reading of any container on the host: while the agent works
 * it is a few seconds old (the agent reports on itself too), and it is what
 * a container that stopped is measured against - not the clock, so a host
 * whose agent stopped does not read as every container stopping.
 */
export function getContainerHostLatestReadingAt(
  containers: Array<Pick<ContainerHostContainer, "lastReadingAt">>,
): Date | null {
  let latest: Date | null = null;
  for (const container of containers) {
    if (
      container.lastReadingAt &&
      (!latest || container.lastReadingAt.getTime() > latest.getTime())
    ) {
      latest = container.lastReadingAt;
    }
  }
  return latest;
}

// Whether a container stopped reporting while the host's others report.
export function isContainerNotReporting(
  lastReadingAt: Date | null | undefined,
  hostLatestReadingAt: Date | null | undefined,
): boolean {
  if (!hostLatestReadingAt) {
    return false;
  }
  if (!lastReadingAt) {
    return true;
  }
  return (
    hostLatestReadingAt.getTime() - lastReadingAt.getTime() >
    CONTAINER_NOT_REPORTING_MS
  );
}

export function readContainerLabel(
  labels: JSONObject | null | undefined,
  keys: ReadonlyArray<string>,
): string {
  for (const key of keys) {
    const value: unknown = labels?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

// The Compose project a container belongs to; "" when none.
export function getContainerComposeProject(
  container: Pick<ContainerHostContainer, "labels">,
): string {
  return readContainerLabel(container.labels, CONTAINER_COMPOSE_PROJECT_LABELS);
}

// The Compose service a container runs; "" when none.
export function getContainerComposeService(
  container: Pick<ContainerHostContainer, "labels">,
): string {
  return readContainerLabel(container.labels, CONTAINER_COMPOSE_SERVICE_LABELS);
}

// Whether `docker compose run` started it: a one-off that is meant to end.
export function isContainerOneOff(
  container: Pick<ContainerHostContainer, "labels">,
): boolean {
  const value: unknown = container.labels?.[CONTAINER_COMPOSE_ONEOFF_LABEL];
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

/*
 * Whether a container that stopped reporting was a service that stopped - it
 * had run for 10 minutes or more - rather than a job that finished. Unknown
 * when its start is: then it is not flagged, as a guess would be.
 */
export function isContainerLongRunning(
  container: Pick<
    ContainerHostContainer,
    "startedAt" | "lastReadingAt" | "labels"
  >,
): boolean {
  if (isContainerOneOff(container)) {
    return false;
  }
  if (!container.startedAt || !container.lastReadingAt) {
    return false;
  }
  return (
    container.lastReadingAt.getTime() - container.startedAt.getTime() >=
    CONTAINER_LONG_RUNNING_MS
  );
}

function restartsReason(count: number): ResourceAttentionText {
  return {
    text: REASON_RESTARTS.other,
    values: { count: String(count) },
    plural: { one: REASON_RESTARTS.one, count: count },
  };
}

// Its restarts in the window as a whole number; 0 when the agent sends none.
export function getContainerRestarts(
  container: Pick<ContainerHostContainer, "restarts">,
): number {
  return container.restarts !== null && Number.isFinite(container.restarts)
    ? Math.max(0, Math.round(container.restarts))
    : 0;
}

/*
 * ---------------------------------------------------------------------------
 * The rules
 * ---------------------------------------------------------------------------
 */
export function assessContainer(
  container: ContainerHostContainer,
  hostLatestReadingAt: Date | null,
): ContainerHostAssessment {
  const notReporting: boolean = isContainerNotReporting(
    container.lastReadingAt,
    hostLatestReadingAt,
  );
  const restarts: number = getContainerRestarts(container);
  const isLooping: boolean = restarts > CONTAINER_RESTART_LOOP_RESTARTS;

  const reasons: Array<ResourceAttentionText> = [];
  const severities: Array<ResourceAttentionSeverity> = [];

  const stopped: boolean = notReporting && isContainerLongRunning(container);

  if (stopped) {
    reasons.push({ text: REASON_STOPPED });
    severities.push(ResourceAttentionSeverity.Warning);
  }

  if (restarts > 0) {
    reasons.push(restartsReason(restarts));
    severities.push(
      isLooping
        ? ResourceAttentionSeverity.Critical
        : ResourceAttentionSeverity.Warning,
    );
  }

  // A stopped container's last memory reading is not what it uses now.
  if (
    !notReporting &&
    container.memoryPercent !== null &&
    container.memoryPercent > CONTAINER_MEMORY_WARNING_PERCENT
  ) {
    reasons.push({
      text: REASON_MEMORY,
      values: {
        percent: formatContainerReasonPercent(container.memoryPercent),
      },
    });
    severities.push(ResourceAttentionSeverity.Warning);
  }

  // The most urgent reason first: a restart loop before the stop it caused.
  if (isLooping) {
    reasons.sort(
      (a: ResourceAttentionText, b: ResourceAttentionText): number => {
        return (
          Number(b.text === REASON_RESTARTS.other) -
          Number(a.text === REASON_RESTARTS.other)
        );
      },
    );
  }

  const severity: ResourceAttentionSeverity | null =
    mergeResourceAttentionSeverity(severities);

  if (isLooping) {
    return {
      state: "restart-loop",
      severity: severity,
      status: {
        label: CONTAINER_STATUS_RESTART_LOOP,
        tone: "danger",
        description: STATUS_RESTART_LOOP_DESCRIPTION,
      },
      reasons: reasons,
    };
  }

  if (stopped) {
    return {
      state: "stopped",
      severity: severity,
      status: {
        label: CONTAINER_STATUS_STOPPED,
        tone: "warning",
        description: STATUS_STOPPED_DESCRIPTION,
      },
      reasons: reasons,
    };
  }

  if (notReporting) {
    /*
     * A job that finished: grey, and a problem only if it restarted on its
     * way out (a reason above).
     */
    return {
      state: "not-reporting",
      severity: severity,
      status: {
        label: CONTAINER_STATUS_NOT_REPORTING,
        tone:
          severity === ResourceAttentionSeverity.Warning
            ? "warning"
            : "neutral",
        description: STATUS_NOT_REPORTING_DESCRIPTION,
      },
      reasons: reasons,
    };
  }

  const tone: ResourcePartTone =
    severity === ResourceAttentionSeverity.Warning ? "warning" : "positive";

  return {
    state: "running",
    severity: severity,
    status: { label: CONTAINER_STATUS_RUNNING, tone: tone },
    reasons: reasons,
  };
}

// The key a container's attention row and its page share.
export function getContainerAttentionKey(name: string): string {
  return `container:${name}`;
}

/*
 * Every container that needs attention, the most urgent first: the rows of
 * the host's Needs attention card, and - handed only its own container - a
 * container's page.
 */
export function getContainerHostAttentionItems(data: {
  containers: Array<ContainerHostContainer>;
  /*
   * The host's newest reading; worked out from `containers` when left out.
   * A container's page hands in the host's, read with all its containers.
   */
  hostLatestReadingAt?: Date | null | undefined;
  getContainerRoute?: ((name: string) => Route | undefined) | undefined;
}): Array<ResourceAttentionItem> {
  const hostLatestReadingAt: Date | null =
    data.hostLatestReadingAt !== undefined
      ? data.hostLatestReadingAt
      : getContainerHostLatestReadingAt(data.containers);

  const items: Array<ResourceAttentionItem> = [];

  for (const container of data.containers) {
    const assessment: ContainerHostAssessment = assessContainer(
      container,
      hostLatestReadingAt,
    );
    if (!assessment.severity) {
      continue;
    }
    const isQuiet: boolean =
      assessment.state === "stopped" || assessment.state === "not-reporting";
    items.push({
      key: getContainerAttentionKey(container.name),
      kind: CONTAINER_KIND,
      icon: IconProp.Cube,
      name: container.name,
      detail: container.image || undefined,
      severity: assessment.severity,
      reasons: assessment.reasons,
      lastReportAt:
        isQuiet && container.lastReadingAt
          ? container.lastReadingAt
          : undefined,
      route: data.getContainerRoute
        ? data.getContainerRoute(container.name)
        : undefined,
    });
  }

  return sortResourceAttention(items, [CONTAINER_KIND]);
}

// The host's health from what needs attention on it.
export function getContainerHostHealth(
  items: Array<ResourceAttentionItem>,
): ResourceHealth {
  return getResourceAttentionHealth(items);
}

/*
 * ---------------------------------------------------------------------------
 * Open incidents and alerts
 * ---------------------------------------------------------------------------
 */

/*
 * Whether an open incident or alert of the host is about this container:
 * the container alerts group by its name, which the record's series labels
 * carry (container.name, or resource.container.name).
 */
export function isContainerIssueAbout(
  record: Pick<OpenIssueRecord, "seriesLabels">,
  containerName: string,
): boolean {
  const name: string | null = readSeriesLabel(
    record.seriesLabels,
    "container.name",
  );
  return Boolean(name && containerName && sameName(name, containerName));
}
