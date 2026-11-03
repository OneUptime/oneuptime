/*
 * What each number on a container host's pages means, in plain words - the
 * Docker host and Podman host Overview and Containers pages, which compute
 * the same things the same way (both agents run the collector's docker_stats
 * receiver, Podman through its Docker-compatible socket). Shown in the (i)
 * tooltip beside a tile, chart, list or column title, so the wording never
 * names a runtime.
 *
 * Each text describes what the page actually computes, not what the title
 * might suggest:
 *
 * - The overview tiles are not "now". They average the chart's time slots
 *   that START in the last 5 minutes of the selected range, and fall back to
 *   every slot in the range when none does - which is what usually happens
 *   on ranges over 12 hours, whose slots are 15 minutes or wider.
 * - The Peak tiles are an average of per-slot maxima; the busiest container
 *   can be a different one in each slot.
 * - Container CPU is the docker stats figure: 100% is one full core, so a
 *   container on several cores reads above 100%.
 * - container.memory.percent divides by the container's memory limit, or by
 *   the HOST's total memory when the container has none (the default).
 *   Memory in use leaves out inactive_file - file cache not used recently -
 *   the way docker stats does; Podman's API subtracts the same.
 * - The Top consumer lists rank each container by its average over its
 *   latest time slot, which on long ranges can be an hour or a day wide, and
 *   list up to five - fewer when the host runs fewer containers.
 * - The Containers table always reads the last 5 minutes before now; that
 *   page has no time picker. Its network columns are running totals from a
 *   single interface's counter, not rates.
 *
 * Change the fetch, change the words.
 */

import { translationKey } from "Common/UI/Utils/TranslateTemplate";

export type ContainerHostMetric =
  | "containers"
  | "avgCpu"
  | "peakCpu"
  | "avgMemory"
  | "peakMemory"
  | "processes"
  | "availabilityChart"
  | "avgCpuChart"
  | "peakCpuChart"
  | "avgMemoryChart"
  | "peakMemoryChart"
  | "networkChart"
  | "topCpuConsumers"
  | "topMemoryConsumers"
  | "containerCpu"
  | "containerMemory"
  | "containerNetworkRx"
  | "containerNetworkTx"
  | "hostHealth"
  | "containerStatus"
  | "containerRestarts"
  | "containerUptime"
  | "containerComposeProject"
  | "containerCpuTile"
  | "containerMemoryTile"
  | "containerRestartsTile"
  | "containerUptimeTile";

export const CONTAINER_HOST_METRIC_DESCRIPTIONS: Record<
  ContainerHostMetric,
  string
> = {
  containers: translationKey(
    "Every container on this host the agent reported in the last 15 minutes: each one that runs now, and one that stopped until OneUptime forgets it, 15 minutes after its last reading. It opens the Containers list.",
  ),
  avgCpu: translationKey(
    "Average CPU use across the containers on this host in the last 5 minutes of the selected range (often the whole range on ranges over 12 hours or without recent data). 100% is one full CPU core, so a container using several cores can push this above 100%.",
  ),
  peakCpu: translationKey(
    "CPU use of the host's busiest container, averaged over the last 5 minutes of the selected range (often the whole range on ranges over 12 hours or without recent data). The busiest container is picked per interval, so it can change; 100% is one full CPU core.",
  ),
  avgMemory: translationKey(
    "Average memory use across the containers on this host in the last 5 minutes of the selected range (often the whole range on ranges over 12 hours or without recent data). Each counts as a percent of its memory limit, or of host memory if it has none.",
  ),
  peakMemory: translationKey(
    "The highest memory percentage of any container (of its memory limit, or of host memory if it has none), picked per interval and averaged over the last 5 minutes of the selected range (often the whole range on ranges over 12 hours or without recent data).",
  ),
  processes: translationKey(
    "Processes and threads running inside all containers on this host, added together and averaged over the last 5 minutes of the selected range (often the whole range on ranges over 12 hours or without recent data). Each thread counts as one.",
  ),
  availabilityChart: translationKey(
    "Up for each interval in which this host's agent sent metrics, Down if it sent none; a lone missed minute between Up minutes counts as Up. The uptime badge is the Up share, leaving out ones still waiting for data and time OneUptime was not receiving.",
  ),
  avgCpuChart: translationKey(
    "Average CPU use across the containers on this host in each interval of the selected range. 100% is one full CPU core, so the line can rise above 100%.",
  ),
  peakCpuChart: translationKey(
    "CPU use of the busiest container on this host in each interval of the selected range, which can be a different container from one interval to the next. 100% is one full CPU core.",
  ),
  avgMemoryChart: translationKey(
    "Average memory use across the containers on this host in each interval of the selected range, as a percent of each container's memory limit, or of host memory for a container with no limit.",
  ),
  peakMemoryChart: translationKey(
    "The highest memory percentage of any container on this host in each interval of the selected range. Each container is measured against its memory limit, or against host memory if it has none.",
  ),
  networkChart: translationKey(
    "How fast the containers on this host, all added together, received (In) and sent (Out) data over the network in each interval of the selected range, in bytes per second.",
  ),
  topCpuConsumers: translationKey(
    "Up to five containers using the most CPU, ranked by each one's average in its latest interval in the last 5 minutes of the selected range (on ranges over 12 hours, often anywhere in it). 100% is one full CPU core.",
  ),
  topMemoryConsumers: translationKey(
    "Up to five containers with the highest memory percentage - of their memory limit, or of host memory if none - ranked by each one's average in its latest interval in the last 5 minutes of the selected range (on ranges over 12 hours, often anywhere in it).",
  ),
  containerCpu: translationKey(
    "CPU this container was using at its latest reading, taken within the last 5 minutes. 100% is one full CPU core, so a container using several cores can show more than 100%.",
  ),
  containerMemory: translationKey(
    "Memory in use at the latest reading, taken within the last 5 minutes, as a percent of this container's memory limit or, without one, of the host's total memory; the amount is under it. File cache the system has not used recently is not counted.",
  ),
  containerNetworkRx: translationKey(
    "Total data this container has received over the network since it last started, at its latest reading. It is a running total, not a current speed; for a container on several networks it may count only one of them.",
  ),
  containerNetworkTx: translationKey(
    "Total data this container has sent over the network since it last started, at its latest reading. It is a running total, not a current speed; for a container on several networks it may count only one of them.",
  ),
  hostHealth: translationKey(
    "Unhealthy while a container keeps restarting (more than 3 times in 15 minutes); Degraded while one restarted, uses more than 85% of its memory or stopped reporting after running for 10 minutes or more; Healthy otherwise.",
  ),
  containerStatus: translationKey(
    "Running while its readings arrive, amber after a restart or past 85% of its memory; Restart loop past 3 restarts in 15 minutes; Stopped reporting when it ran 10 minutes or more, then went quiet; Not reporting, in grey, for a job that finished.",
  ),
  containerRestarts: translationKey(
    "Times its restart policy restarted this container in the last 15 minutes, as the Container Restart Loop alert counts them. A restart by hand is not counted; more than 3 is a restart loop.",
  ),
  containerUptime: translationKey(
    "How long this container has run since it last started, from the agent's readings. A container that restarts starts counting again.",
  ),
  containerComposeProject: translationKey(
    "The Compose project that created this container, from the label Compose puts on what it creates. Containers started on their own have none.",
  ),
  containerCpuTile: translationKey(
    "CPU this container was using at its latest reading, within the last 5 minutes; 100% is one full CPU core. Amber past 80%, where the High Container CPU Usage alert fires.",
  ),
  containerMemoryTile: translationKey(
    "Memory in use at the latest reading, as a percent of this container's memory limit, or of the host's memory when it has none, not counting file cache the system has not used recently. Amber past 85%, where the High Container Memory Usage alert fires.",
  ),
  containerRestartsTile: translationKey(
    "Times its restart policy restarted this container in the last 15 minutes. More than 3 is a restart loop, where the Container Restart Loop alert fires.",
  ),
  containerUptimeTile: translationKey(
    "How long this container has run since it last started, at its latest reading. The Container Restarted (Low Uptime) alert fires while it is under 2 minutes.",
  ),
};
