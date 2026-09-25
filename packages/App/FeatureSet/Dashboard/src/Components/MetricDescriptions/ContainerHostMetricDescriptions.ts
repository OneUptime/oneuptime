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
  | "containerMemoryPercent"
  | "containerNetworkRx"
  | "containerNetworkTx";

export const CONTAINER_HOST_METRIC_DESCRIPTIONS: Record<
  ContainerHostMetric,
  string
> = {
  containers:
    "Containers on this host that reported CPU or memory in the last 5 minutes of the selected range. If none did (common on ranges over 12 hours), every container seen anywhere in the range is counted, including ones that have since stopped.",
  avgCpu:
    "Average CPU use across the containers on this host in the last 5 minutes of the selected range (often the whole range on ranges over 12 hours or without recent data). 100% is one full CPU core, so a container using several cores can push this above 100%.",
  peakCpu:
    "CPU use of the host's busiest container, averaged over the last 5 minutes of the selected range (often the whole range on ranges over 12 hours or without recent data). The busiest container is picked per interval, so it can change; 100% is one full CPU core.",
  avgMemory:
    "Average memory use across the containers on this host in the last 5 minutes of the selected range (often the whole range on ranges over 12 hours or without recent data). Each counts as a percent of its memory limit, or of host memory if it has none.",
  peakMemory:
    "The highest memory percentage of any container (of its memory limit, or of host memory if it has none), picked per interval and averaged over the last 5 minutes of the selected range (often the whole range on ranges over 12 hours or without recent data).",
  processes:
    "Processes and threads running inside all containers on this host, added together and averaged over the last 5 minutes of the selected range (often the whole range on ranges over 12 hours or without recent data). Each thread counts as one.",
  availabilityChart:
    "Up for each interval of the selected range in which this host's agent sent metrics, Down if it sent none; a lone missed minute between Up minutes counts as Up. The uptime badge is the share of Up intervals, leaving out recent ones still waiting for data.",
  avgCpuChart:
    "Average CPU use across the containers on this host in each interval of the selected range. 100% is one full CPU core, so the line can rise above 100%.",
  peakCpuChart:
    "CPU use of the busiest container on this host in each interval of the selected range, which can be a different container from one interval to the next. 100% is one full CPU core.",
  avgMemoryChart:
    "Average memory use across the containers on this host in each interval of the selected range, as a percent of each container's memory limit, or of host memory for a container with no limit.",
  peakMemoryChart:
    "The highest memory percentage of any container on this host in each interval of the selected range. Each container is measured against its memory limit, or against host memory if it has none.",
  networkChart:
    "How fast the containers on this host, all added together, received (In) and sent (Out) data over the network in each interval of the selected range, in bytes per second.",
  topCpuConsumers:
    "Up to five containers using the most CPU, ranked by each one's average in its latest interval in the last 5 minutes of the selected range (on ranges over 12 hours, often anywhere in it). 100% is one full CPU core.",
  topMemoryConsumers:
    "Up to five containers with the highest memory percentage - of their memory limit, or of host memory if none - ranked by each one's average in its latest interval in the last 5 minutes of the selected range (on ranges over 12 hours, often anywhere in it).",
  containerCpu:
    "CPU this container was using at its latest reading, taken within the last 5 minutes. 100% is one full CPU core, so a container using several cores can show more than 100%.",
  containerMemory:
    "Memory this container was using at its latest reading, taken within the last 5 minutes. File cache the system has not used recently, and can free on demand, is not counted.",
  containerMemoryPercent:
    "Memory in use at the latest reading, as a percent of this container's memory limit. If the container has no memory limit, it is a percent of the host's total memory instead.",
  containerNetworkRx:
    "Total data this container has received over the network since it last started, at its latest reading. It is a running total, not a current speed; for a container on several networks it may count only one of them.",
  containerNetworkTx:
    "Total data this container has sent over the network since it last started, at its latest reading. It is a running total, not a current speed; for a container on several networks it may count only one of them.",
};
