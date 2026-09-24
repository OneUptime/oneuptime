/*
 * What each number on the Host pages means, in plain words: the Hosts
 * list, the overview, a single process, a Windows service, a systemd unit,
 * and the Processes, Services and Systemd Units lists. Shown in the (i)
 * tooltip beside a tile, chart or column title (and, for the one Detail
 * field, as its caption).
 *
 * Each text describes what the page actually computes, not what the title
 * suggests. The ones worth knowing before editing a fetch:
 *
 *  - Overview and process tiles average only the buckets that START in the
 *    last 5 minutes of the range. Buckets are 15 minutes or wider on ranges
 *    over 12 hours, so there the tile usually falls back to the average of
 *    the whole range - and it does the same when nothing arrived in those
 *    5 minutes (a host gone silent, a process that exited), instead of
 *    going blank.
 *  - Load average and Processes are the newest bucket, not a 5-minute mean.
 *    The "N total" beside Processes is Host.processCount, which ingest
 *    writes through ResourceHeartbeat at most about once a minute.
 *  - The Filesystem tile, the Disk space chart and the Filesystems table
 *    average the WHOLE range, and count reserved space in the total.
 *  - process.cpu.utilization arrives as three readings per scrape (user,
 *    system, wait). The process page averages them and the Processes list
 *    keeps whichever sorts first, so both under-read; the texts say so.
 *  - Service and unit availability are sample counts over at most the
 *    newest 2,000 samples, not time-weighted.
 *  - The Hosts list's Resources column reads the cached Host columns, not
 *    telemetry: cpuCores is the first system.cpu.logical.count point (so
 *    hyperthreads count), totalMemoryBytes is the SUM of every
 *    system.memory.usage state, and processCount the sum of
 *    system.processes.count over every status - all written through
 *    ResourceHeartbeat at most about once a minute.
 *
 * Change the fetch, change the words.
 */

export type HostMetric =
  // Host overview: tiles
  | "cpu"
  | "memory"
  | "filesystem"
  | "loadAverage"
  | "processes"
  // Host overview: charts
  | "availabilityChart"
  | "cpuChart"
  | "memoryChart"
  | "diskSpaceChart"
  | "networkChart"
  // Host overview: Filesystems table and Hardware & Runtime card
  | "filesystemUsedTotal"
  | "filesystemUtilization"
  | "processCountCached"
  // One process
  | "processCpu"
  | "processMemoryRss"
  | "processVirtualMemory"
  | "processThreads"
  | "processCpuChart"
  | "processMemoryRssChart"
  | "processDiskIoChart"
  // One Windows service
  | "serviceCurrentStatus"
  | "serviceAvailability"
  | "serviceStartupMode"
  | "serviceStateChanges"
  | "serviceStatusTimeline"
  // One systemd unit
  | "unitCurrentState"
  | "unitAvailability"
  | "unitType"
  | "unitStateChanges"
  | "unitStateTimeline"
  // Hosts list
  | "hostListResources"
  // Processes, Services and Systemd Units lists
  | "processListCpu"
  | "processListMemory"
  | "serviceListStatus"
  | "serviceListStartup"
  | "unitListState"
  | "unitListType";

export const HOST_METRIC_DESCRIPTIONS: Record<HostMetric, string> = {
  cpu: "Share of CPU time across all cores spent running programs and the operating system, averaged over the last 5 minutes of the range. 100% means every core was busy; on ranges over 12 hours or with no recent data, it is usually the whole-range average.",
  memory:
    "Share of the host's physical memory (RAM) in use, not counting file cache the system can free, averaged over the last 5 minutes of the range. On ranges over 12 hours, or with no recent data, it is usually the whole-range average; below is the total RAM.",
  filesystem:
    "Used space on the host's largest filesystem, as a share of its total size with reserved space included. Averaged over the whole selected range, not the last 5 minutes; the Filesystems table lists every mount.",
  loadAverage:
    "The 1-minute load average from the newest interval: about how many processes were running or waiting for a CPU (Linux also counts ones waiting on disk). The % divides it by the number of cores, and over 100% means work is queuing.",
  processes:
    "Processes running or ready to run on a CPU in the newest interval; the total on the line below counts every state and is updated at most about once a minute. Where states are not reported, as on Windows, it counts every process seen in the last 5 minutes.",
  availabilityChart:
    "Up if OneUptime received metrics from this host in that interval, Down if nothing arrived; the uptime badge is the share of intervals that were up. The newest interval is not judged until its data can arrive, and one missed minute between up ones counts as up.",
  cpuChart:
    "Share of CPU time spent running programs and the operating system (user plus system time), averaged across all cores, in each interval of the selected range. 100% means every core was busy for the whole interval.",
  memoryChart:
    "Share of the host's physical memory (RAM) in use in each interval of the selected range, not counting file cache the system can free.",
  diskSpaceChart:
    "Used share of the host's largest filesystem, the same mount as the Filesystem tile, in each interval of the selected range. Reserved space counts toward the total.",
  networkChart:
    "Bytes per second received (In) and sent (Out), added up across every network interface the host reports, including loopback when the collector sends it. Worked out from the change in each interface's byte counters between intervals.",
  filesystemUsedTotal:
    "Space used on this mount and its total size (used, free and reserved space added up), each averaged over the selected range. Sizes use 1024-based units, so 1 GiB is 1,024 MiB.",
  filesystemUtilization:
    "Used space as a share of this mount's total size, reserved space included, averaged over the selected range. The bar turns amber at 75% and red at 90%.",
  processCountCached:
    "How many processes the host had in any state (running, sleeping, idle and so on), as last saved on the host record. It is refreshed from incoming metrics at most about once a minute.",
  processCpu:
    "This process's share of all host CPU cores, averaged over the last 5 minutes of the range (usually the whole range if over 12 hours or no recent data). Its user, system and wait readings are averaged, not added, so it reads about a third of the real use.",
  processMemoryRss:
    "Physical memory (RAM) this process holds, called resident set size or RSS, averaged over the last 5 minutes of the range (usually the whole range on ranges over 12 hours or with no recent data). The percentage below compares it with the host's total RAM.",
  processVirtualMemory:
    "All the address space this process has reserved, including parts not in RAM such as mapped files, averaged over the last 5 minutes of the range (usually the whole range on ranges over 12 hours or with no recent data). It is normally far larger than RSS.",
  processThreads:
    "This process's threads, averaged over the last 5 minutes of the range (usually the whole range on ranges over 12 hours or with no recent data); open file handles are below. Both need the collector's process.threads and process.open_file_descriptors turned on.",
  processCpuChart:
    "This process's share of the host's total CPU capacity in each interval. Like the CPU tile, it averages the separate user, system and wait readings instead of adding them, so it reads about a third of the real use.",
  processMemoryRssChart:
    "Physical memory (RSS) held by this process in each interval of the selected range.",
  processDiskIoChart:
    "How fast this process read from and wrote to disk, in bytes per second, in each interval of the selected range. Worked out from the change in its running totals of bytes read and written.",
  serviceCurrentStatus:
    "The service's state in the newest sample in the selected range: Running, Stopped, Paused, or a start, stop, pause or resume still in progress. The line below says how long ago that sample was taken.",
  serviceAvailability:
    "Share of status samples in the selected range in which the service was Running; samples usually arrive every 30 seconds. Only the newest 2,000 samples count, and the tile says capped when the range holds more.",
  serviceStartupMode:
    "How Windows starts this service, from its newest sample: Automatic (at boot), Manual (only when something asks for it), Disabled (cannot start), or Boot and System (loaded early in startup, usually drivers).",
  serviceStateChanges:
    "How many times a status sample in the selected range differed from the one before it, such as Running to Stopped. A stop and restart that both happen between two samples is not seen.",
  serviceStatusTimeline:
    "The service's status across the selected range. Where one point on the chart covers several samples it shows the worst status among them, so a short stop stays visible.",
  unitCurrentState:
    "The unit's state in the newest sample in the selected range, as systemd reports it: Active, Inactive, Failed, Activating and so on. The line below says how long ago that sample was taken.",
  unitAvailability:
    "Share of samples in the selected range in which the unit was Active (a service running, a socket listening, a timer waiting to fire); Reloading counts as not active. Only the newest 2,000 samples count, and the tile says capped when there are more.",
  unitType:
    "The kind of systemd unit, read from the end of its name: Service (a background program), Socket, Timer, Mount, Target and so on.",
  unitStateChanges:
    "How many times a sample in the selected range showed a different state from the one before it, such as Active to Failed. A failure and recovery that both happen between two samples is not seen.",
  unitStateTimeline:
    "The unit's state across the selected range. Where one point on the chart covers several samples it shows the worst state among them, so a brief failure stays visible.",
  hostListResources:
    "Logical CPU cores (each hyperthread counts as one) and total RAM, the sum of every memory state the collector reports; below, processes in any state. All three are the latest values saved on the host, updated at most about once a minute.",
  processListCpu:
    "This process's newest CPU reading from the last 15 minutes, as a share of the host's total capacity (all cores together). The collector sends user, system and wait readings separately and this column shows only one of them, so it can read low.",
  processListMemory:
    "Physical memory (RSS) this process held at its newest reading in the last 15 minutes, with its share of the host's total RAM. The bar turns amber at 10% and red at 20% of RAM.",
  serviceListStatus:
    "Each service's state at its newest sample from the last 15 minutes: Running, Stopped, Paused, or a start, stop, pause or resume still in progress.",
  serviceListStartup:
    "How Windows starts the service: Automatic (at boot), Manual (only when requested), Disabled (cannot be started), or Boot and System (loaded early, usually drivers).",
  unitListState:
    "Each unit's state at its newest sample from the last 15 minutes. Active means running, listening or waiting to fire; Failed means it crashed or exited with an error; Unknown means no state was reported.",
  unitListType:
    "What kind of unit this is, taken from the end of its name, for example Service for a background program or Timer for a scheduled job.",
};
