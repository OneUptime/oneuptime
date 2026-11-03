/*
 * What each number on the Docker Swarm cluster pages means, in plain words.
 *
 * DOCKER_SWARM_METRIC_DESCRIPTIONS is shown in the (i) tooltip beside a
 * tile, chip, summary field or table header. DOCKER_SWARM_INSIGHTS_CHART_
 * DESCRIPTIONS is the line of text under each Insights chart title.
 *
 * Each text describes what the page actually shows, which is not always
 * what the title suggests:
 *
 *  - Counts come from the agent's inventory snapshot (the Swarm API walked
 *    on one manager every 5 minutes by default), not from metrics and not
 *    from any time range. The pages read only the newest snapshot's rows
 *    (keepLatestDockerSwarmSnapshot), so a removed node, service or task is
 *    gone at the next snapshot; the cleanup deletes its row 15 minutes
 *    after its last one.
 *  - The Clusters list reads the counts cached on the cluster row
 *    (nodeCount, serviceCount, taskCount and their ready / running parts),
 *    which ingest rewrites from each inventory batch. They are the latest
 *    snapshot itself, so unlike the overview (which counts inventory rows)
 *    a removed resource leaves them at the next snapshot, not after pruning.
 *  - A Stack row's state is the literal "<N> services" and its serviceCount
 *    the same N: how many services carry that com.docker.stack.namespace
 *    label, whatever their replica health.
 *  - The Volumes count lists the volumes of whichever node runs the
 *    inventory poller (normally one manager; more if the compose file is
 *    run on several nodes).
 *  - Only Task rows get CPU/memory (OtelMetricsIngestService mirrors
 *    docker_stats onto kind "Task" only), so the Nodes and Services lists
 *    have no usage columns; a node's tasks' readings add up on its row of
 *    the Overview's Nodes card.
 *  - docker_stats only sees the containers of the node it runs on, so a
 *    task on a node without the agent has no CPU/memory reading.
 *  - Every page hides readings older than 15 minutes
 *    (DOCKER_SWARM_READINGS_STALE_MS), a task's page too.
 *  - States, reasons and colours are the swarm's rules (DockerSwarmHealth),
 *    the same on the Overview, the lists, the part pages and the Topology.
 *  - Task CPU is a percent of one core, 100% being one full core: docker_stats
 *    reports a percent (declared with the unit "1", which ingest reads as
 *    "%" - ContainerStatsPercentUnit) and the row mirrors it as it is. It
 *    used to be multiplied by 100 a second time, and these texts named no
 *    scale until it was not.
 *
 * Change the fetch, change the words.
 */

import { translationKey } from "Common/UI/Utils/TranslateTemplate";

export type DockerSwarmMetric =
  | "managers"
  | "clusterHealth"
  | "inventoryCounts"
  | "nodeStatus"
  | "managerStatus"
  | "availability"
  | "serviceStatus"
  | "serviceStatusColumn"
  | "serviceUpdate"
  | "recentFailedTasks"
  | "lastTaskError"
  | "replicas"
  | "taskStatus"
  | "taskDesiredState"
  | "taskCpu"
  | "taskMemory"
  | "taskCpuColumn"
  | "taskMemoryColumn"
  | "stackServices"
  | "stackStatusColumn"
  | "clusterListNodes"
  | "clusterListServices"
  | "clusterListTasks";

export const DOCKER_SWARM_METRIC_DESCRIPTIONS: Record<
  DockerSwarmMetric,
  string
> = {
  managers: translationKey(
    "Nodes acting as swarm managers: they keep the swarm's state and decide which node runs each task, and they can run tasks too. Every other node is a worker.",
  ),
  clusterHealth: translationKey(
    "Unhealthy while something in the swarm is broken - a node down, a manager the others cannot reach, a service none of whose replicas run - and Degraded while something needs a look. Needs attention lists what and why. Unknown while the agent does not report.",
  ),
  inventoryCounts: translationKey(
    "The swarm's nodes, managers, services, tasks and stacks at the agent's latest inventory snapshot, taken from a manager every 5 minutes by default. Each count opens its list.",
  ),
  nodeStatus: translationKey(
    "The node's state as the swarm's managers see it: Ready, Down or Disconnected, and Unreachable for a manager the others cannot reach. A ready node that takes no new tasks reads Drained or Paused, which is not a problem by itself.",
  ),
  managerStatus: translationKey(
    "A manager's standing in the swarm, as docker node ls shows it: the Leader, Reachable, or Unreachable when the other managers cannot reach it. The swarm keeps working while more than half of its managers are reachable.",
  ),
  availability: translationKey(
    "Whether Swarm places tasks on the node: Active, Paused (it keeps its tasks and takes no new ones) or Drained (its tasks are moved to other nodes, as before maintenance).",
  ),
  serviceStatus: translationKey(
    "Running tasks out of the tasks this service wants, such as 2 of 3 running, from the latest inventory snapshot. Red when none run, amber when some are missing and no rolling update explains it, grey when it is scaled to zero or a job that ran to completion.",
  ),
  serviceStatusColumn: translationKey(
    "Each service's running tasks out of the tasks it wants, by the swarm's rules, and why it needs a look: a paused or rolled-back update, or tasks that keep failing. From the latest inventory snapshot.",
  ),
  serviceUpdate: translationKey(
    "How the service's last rolling update went, as Docker reports it: Updating, Completed, Update paused (Swarm stopped it after a task failed), Rolling back or Rolled back.",
  ),
  recentFailedTasks: translationKey(
    "Tasks of this service that failed or were rejected in the last hour. Swarm replaces each one, so a service that keeps crashing can still read all its replicas running; three or more needs a look.",
  ),
  lastTaskError: translationKey(
    "The error of the newest task that failed or was rejected in the last hour, as docker service ps shows it in its ERROR column.",
  ),
  replicas: translationKey(
    "Copies of the service running now, out of the copies it should be running - 2/3 means one is missing. A global service wants one copy on every eligible node.",
  ),
  taskStatus: translationKey(
    "The task's state as Swarm reports it: Running; Starting or Pending while Swarm places it; Pending in amber when no node can run it, Failed or Rejected, each with Docker's error. Amber too while it uses more than 85% of its memory limit.",
  ),
  taskDesiredState: translationKey(
    "The state Swarm wants the task in, as docker service ps shows it: running for a task it keeps running, shutdown for one it replaced.",
  ),
  taskCpu: translationKey(
    "CPU used by this task's container at the last reading the OneUptime agent sent (it reads every 30 seconds); 100% is one full CPU core. Amber past 80%, where the High Task CPU Usage alert fires. A reading more than 15 minutes old is not shown.",
  ),
  taskMemory: translationKey(
    "Memory used by this task's container at the agent's last reading, not counting file cache the system has not used recently, as a percent of its memory limit, or of the node's memory when the service sets none. Amber past 85%, where the High Task Memory Usage alert fires. A reading more than 15 minutes old is not shown.",
  ),
  taskCpuColumn: translationKey(
    "CPU used by each task's container at the OneUptime agent's latest reading (100% is one full CPU core), amber past 80%, where the High Task CPU Usage alert fires. Shown only when the reading is under 15 minutes old; tasks on nodes without the agent show N/A.",
  ),
  taskMemoryColumn: translationKey(
    "Memory each task's container used, not counting file cache the system has not used recently, as a percent of its memory limit (or of the node's memory when the service sets none) over the amount; amber past 85%, where the High Task Memory Usage alert fires. Only a reading under 15 minutes old is shown; nodes without the agent show N/A.",
  ),
  stackServices: translationKey(
    "How many services carry this stack's name, which Docker adds to every service a stack deploys. They count whatever their state, including ones scaled to 0; from the agent's latest inventory snapshot, taken every 5 minutes by default.",
  ),
  stackStatusColumn: translationKey(
    "For a stack the status only repeats its service count from the latest inventory snapshot; it is not a health check. The Services list shows whether each service has all its copies running.",
  ),
  clusterListNodes: translationKey(
    "Nodes in the swarm at the agent's latest inventory snapshot (taken every 5 minutes by default), shown as ready out of total. Ready means the managers see the node as up; the figure turns red when any node is not ready.",
  ),
  clusterListServices: translationKey(
    "Services defined in the swarm at the agent's latest inventory snapshot, whatever their state, including ones scaled to 0. The cluster's Services list shows each one's replicas, and its Overview the ones that run short.",
  ),
  clusterListTasks: translationKey(
    "Tasks Swarm wants running at the latest inventory snapshot (one task is one container of a service), shown as how many are actually running out of that total. The rest are still starting, or have stopped or failed.",
  ),
};

/*
 * The Insights charts read container.* series straight from telemetry, so
 * unlike the task rows above they are on docker_stats' own scale: 100% is
 * one CPU core. Any container the agent sees can be drawn, including ones
 * that are not swarm tasks (such as the agent itself), but MetricView
 * fetches only the 10 series that peaked highest by default
 * (DEFAULT_TOP_N_SERIES, ranked by max) until the viewer asks for all.
 */
export type DockerSwarmInsightsChart =
  | "clusterCpu"
  | "clusterMemoryPercent"
  | "taskMemory"
  | "topTasksCpu"
  | "topTasksMemory"
  | "taskProcesses";

export const DOCKER_SWARM_INSIGHTS_CHART_DESCRIPTIONS: Record<
  DockerSwarmInsightsChart,
  string
> = {
  clusterCpu: translationKey(
    "100% is one full CPU core, so a busy container can go above 100%. One line per container on the nodes where the OneUptime agent runs, averaged per interval.",
  ),
  clusterMemoryPercent: translationKey(
    "Memory as a percent of each container's memory limit, or of the node's total memory when the service sets no limit. One line per container, averaged per interval.",
  ),
  taskMemory: translationKey(
    "Memory used by each container, not counting file cache the system has not used recently. One line per container, averaged per interval.",
  ),
  topTasksCpu: translationKey(
    "The highest CPU reading of each container in each interval, so short spikes are not averaged away. By default only the 10 containers that peaked highest are drawn; 100% is one full CPU core.",
  ),
  topTasksMemory: translationKey(
    "The highest memory use of each container in each interval, so short spikes are not averaged away. By default only the 10 containers that peaked highest are drawn.",
  ),
  taskProcesses: translationKey(
    "Processes and threads running inside each container, averaged per interval. A count that keeps climbing can point to a leak or a runaway process.",
  ),
};
