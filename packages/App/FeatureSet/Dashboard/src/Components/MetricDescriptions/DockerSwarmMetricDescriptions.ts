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
 *    from any time range. Removed resources are pruned once they are 15
 *    minutes older than the cluster's own lastSeenAt (which itself may lag
 *    by the 5-minute ingest fence), on a 5-minute cleanup: gone roughly
 *    10-25 minutes after removal, depending on where in the snapshot cycle
 *    it happened.
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
 *    always show N/A in those columns.
 *  - docker_stats only sees the containers of the node it runs on, so a
 *    task on a node without the agent has no CPU/memory reading.
 *  - The list views hide readings older than 15 minutes (METRIC_STALE_MS);
 *    the task detail page does not.
 *  - The task CPU texts deliberately name no scale: the mirrored value is
 *    multiplied by 100 at ingest (cpuValueToPercent) although docker_stats
 *    already reports a percent. See the bug report on this change.
 *
 * Change the fetch, change the words.
 */

export type DockerSwarmMetric =
  | "nodes"
  | "managers"
  | "services"
  | "tasks"
  | "stacks"
  | "networks"
  | "volumes"
  | "serviceStatus"
  | "serviceStatusColumn"
  | "replicas"
  | "taskCpu"
  | "taskMemory"
  | "taskCpuColumn"
  | "taskMemoryColumn"
  | "nodeUsageColumns"
  | "serviceUsageColumns"
  | "stackServices"
  | "stackStatusColumn"
  | "clusterListNodes"
  | "clusterListServices"
  | "clusterListTasks";

export const DOCKER_SWARM_METRIC_DESCRIPTIONS: Record<
  DockerSwarmMetric,
  string
> = {
  nodes:
    "Machines running Docker that have joined this swarm, from the agent's latest inventory snapshot (taken every 5 minutes by default). Ready counts the nodes the managers currently see as up; a node that is Down cannot run tasks.",
  managers:
    "Nodes acting as swarm managers: they keep the swarm's state and decide which node runs each task, and they can run tasks too. Every other node is a worker.",
  services:
    "Services defined in this swarm - each tells Swarm which image to run and how many copies to keep running. Converged counts the services with every wanted copy running; a service scaled to 0 never counts as converged.",
  tasks:
    "Tasks Swarm wants running, where one task is one container of a service; running counts those actually running, while the rest are starting, stopped or failed. From the latest inventory snapshot, so a replaced task can linger for up to about 25 minutes.",
  stacks:
    "Groups of services deployed together, for example with docker stack deploy, counted from the stack name Docker puts on each service. Services created on their own are not part of a stack.",
  networks:
    "Swarm-wide networks, such as overlay networks and the built-in ingress network, that connect services across nodes. Networks that exist on a single node only, such as bridge or host, are not counted.",
  volumes:
    "Docker volumes on the node where the OneUptime inventory poller runs, which is normally one manager. Volumes belong to individual nodes, so volumes on nodes without the poller are not counted.",
  serviceStatus:
    "Running tasks out of the tasks this service wants, such as 2/3, from the latest inventory snapshot. Green when every wanted task is running; amber when some are missing or the service is scaled to 0.",
  serviceStatusColumn:
    "For a service the status is its replica count: running tasks out of wanted tasks, the same figure as Replicas. It comes from the latest inventory snapshot.",
  replicas:
    "Copies of the service running now, out of the copies it should be running - 2/3 means one is missing. A global service wants one copy on every eligible node.",
  taskCpu:
    "CPU used by this task's container at the last reading the OneUptime agent sent (it reads every 30 seconds). Unlike the Tasks list, this page keeps showing that reading even when it is more than 15 minutes old.",
  taskMemory:
    "Memory used by this task's container at the agent's last reading, not counting file cache the system has not used recently. This page keeps showing that reading even when it is more than 15 minutes old.",
  taskCpuColumn:
    "CPU used by each task's container at the OneUptime agent's latest reading, shown only when that reading is under 15 minutes old. Tasks on nodes where the agent does not run show N/A.",
  taskMemoryColumn:
    "Memory used by each task's container at the agent's latest reading, not counting file cache the system has not used recently, shown only when that reading is under 15 minutes old. Tasks on nodes without the agent show N/A.",
  nodeUsageColumns:
    "Swarm CPU and memory are collected per task container, not per node, so these columns show N/A for nodes. The Tasks list shows each task's node and what it is using.",
  serviceUsageColumns:
    "Swarm CPU and memory are collected per task container, not per service, so these columns show N/A for services. The Tasks list names each task's service and shows what it is using.",
  stackServices:
    "How many services carry this stack's name, which Docker adds to every service a stack deploys. They count whatever their state, including ones scaled to 0; from the agent's latest inventory snapshot, taken every 5 minutes by default.",
  stackStatusColumn:
    "For a stack the status only repeats its service count from the latest inventory snapshot; it is not a health check. The Services list shows whether each service has all its copies running.",
  clusterListNodes:
    "Nodes in the swarm at the agent's latest inventory snapshot (taken every 5 minutes by default), shown as ready out of total. Ready means the managers see the node as up; the figure turns red when any node is not ready.",
  clusterListServices:
    "Services defined in the swarm at the agent's latest inventory snapshot, whatever their state, including ones scaled to 0. The cluster's overview shows how many have every wanted copy running.",
  clusterListTasks:
    "Tasks Swarm wants running at the latest inventory snapshot (one task is one container of a service), shown as how many are actually running out of that total. The rest are still starting, or have stopped or failed.",
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
  clusterCpu:
    "100% is one full CPU core, so a busy container can go above 100%. One line per container on the nodes where the OneUptime agent runs, averaged per interval.",
  clusterMemoryPercent:
    "Memory as a percent of each container's memory limit, or of the node's total memory when the service sets no limit. One line per container, averaged per interval.",
  taskMemory:
    "Memory used by each container, not counting file cache the system has not used recently. One line per container, averaged per interval.",
  topTasksCpu:
    "The highest CPU reading of each container in each interval, so short spikes are not averaged away. By default only the 10 containers that peaked highest are drawn; 100% is one full CPU core.",
  topTasksMemory:
    "The highest memory use of each container in each interval, so short spikes are not averaged away. By default only the 10 containers that peaked highest are drawn.",
  taskProcesses:
    "Processes and threads running inside each container, averaged per interval. A count that keeps climbing can point to a leak or a runaway process.",
};
