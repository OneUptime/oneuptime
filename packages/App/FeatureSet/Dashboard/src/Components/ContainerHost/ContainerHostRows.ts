import {
  CONTAINER_CPU_WARNING_PERCENT,
  CONTAINER_MEMORY_WARNING_PERCENT,
  CONTAINER_RESTART_LOOP_RESTARTS,
  ContainerHostAssessment,
  ContainerHostContainer,
  ContainerHostState,
  assessContainer,
  getContainerComposeProject,
  getContainerComposeService,
} from "./ContainerHostHealth";
import { ContainerHostReadings } from "./ContainerHostReadings";

/*
 * A Docker or Podman host's Containers list, row by row: each container's
 * state by the host's rules (ContainerHostHealth) with why, its readings
 * coloured at its alerts' lines, its restarts and when its current run
 * started. React-free, so App tests can read it.
 *
 * A container that stopped reporting has no readings that say what it uses
 * now - its last ones are minutes old - so its CPU, memory and network read
 * as missing, and it has no current run to say the start of.
 */

// The tones a reading's cell takes: ResourceTable's ResourceColumnTone.
export type ContainerHostCellTone = "danger" | "warning";

// The words and colours of a row's Status cell (ResourceStatusCell).
export interface ContainerHostStatusCell {
  // Its English word: what the list sorts and filters by.
  status: string;
  statusTone: "positive" | "warning" | "danger" | "neutral";
  statusText: { text: string };
  statusReasons: ContainerHostAssessment["reasons"];
}

export interface ContainerHostRow {
  containerName: string;
  containerImage: string | null;
  // "" when Compose did not create it.
  composeProject: string;
  composeService: string;
  cpuPercent: number | null;
  memoryUsage: number | null;
  memoryPercent: number | null;
  networkRx: number | null;
  networkTx: number | null;
  // Restarts in the last 15 minutes; null when the agent sends no count.
  restarts: number | null;
  // When its current run started; null when it is not running or unknown.
  startedAtMs: number | null;
  state: ContainerHostState;
  // The most urgent first: what the Status column sorts by.
  statusRank: number;
  status: ContainerHostStatusCell;
  cpuTone: ContainerHostCellTone | undefined;
  memoryTone: ContainerHostCellTone | undefined;
  restartsTone: ContainerHostCellTone | undefined;
}

/*
 * How urgent each state is, for the Status column's sort: a restart loop
 * first, a service that stopped, a running container that needs a look,
 * one that is fine, then a job that finished.
 */
export function getContainerStatusRank(
  assessment: Pick<ContainerHostAssessment, "state" | "severity">,
): number {
  switch (assessment.state) {
    case "restart-loop":
      return 0;
    case "stopped":
      return 1;
    case "running":
      return assessment.severity ? 2 : 3;
    case "not-reporting":
      return assessment.severity ? 2 : 4;
  }
  return 4;
}

export function getContainerCpuTone(
  cpuPercent: number | null,
): ContainerHostCellTone | undefined {
  return cpuPercent !== null && cpuPercent > CONTAINER_CPU_WARNING_PERCENT
    ? "warning"
    : undefined;
}

export function getContainerMemoryTone(
  memoryPercent: number | null,
): ContainerHostCellTone | undefined {
  return memoryPercent !== null &&
    memoryPercent > CONTAINER_MEMORY_WARNING_PERCENT
    ? "warning"
    : undefined;
}

export function getContainerRestartsTone(
  restarts: number | null,
): ContainerHostCellTone | undefined {
  if (restarts === null || restarts <= 0) {
    return undefined;
  }
  return restarts > CONTAINER_RESTART_LOOP_RESTARTS ? "danger" : "warning";
}

export function getContainerHostRow(
  container: ContainerHostContainer,
  hostLatestReadingAt: Date | null,
): ContainerHostRow {
  const assessment: ContainerHostAssessment = assessContainer(
    container,
    hostLatestReadingAt,
  );
  const isRunning: boolean =
    assessment.state === "running" || assessment.state === "restart-loop";

  const cpuPercent: number | null = isRunning ? container.cpuPercent : null;
  const memoryPercent: number | null = isRunning
    ? container.memoryPercent
    : null;
  const restarts: number | null =
    container.restarts === null
      ? null
      : Math.max(0, Math.round(container.restarts));

  return {
    containerName: container.name,
    containerImage: container.image,
    composeProject: getContainerComposeProject(container),
    composeService: getContainerComposeService(container),
    cpuPercent: cpuPercent,
    memoryUsage: isRunning ? container.memoryBytes : null,
    memoryPercent: memoryPercent,
    networkRx: isRunning ? container.networkRxBytes : null,
    networkTx: isRunning ? container.networkTxBytes : null,
    restarts: restarts,
    startedAtMs:
      isRunning && container.startedAt ? container.startedAt.getTime() : null,
    state: assessment.state,
    statusRank: getContainerStatusRank(assessment),
    status: {
      status: assessment.status.label,
      statusTone: assessment.status.tone,
      statusText: { text: assessment.status.label },
      statusReasons: assessment.reasons,
    },
    cpuTone: getContainerCpuTone(cpuPercent),
    memoryTone: getContainerMemoryTone(memoryPercent),
    restartsTone: getContainerRestartsTone(restarts),
  };
}

// Every container of the host, in the order the readings hold them.
export function getContainerHostRows(
  readings: Pick<ContainerHostReadings, "containers" | "hostLatestReadingAt">,
): Array<ContainerHostRow> {
  return readings.containers.map(
    (container: ContainerHostContainer): ContainerHostRow => {
      return getContainerHostRow(container, readings.hostLatestReadingAt);
    },
  );
}
