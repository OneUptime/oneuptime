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
 *    average the WHOLE range. The tile and the chart read the FULLEST mount,
 *    and how full a mount is is df's Use%: used over used plus free, space
 *    reserved for root left out (its Size still counts it).
 *  - process.cpu.utilization arrives as one reading per CPU mode per scrape
 *    (user, system and, on Linux, wait) - twice with the collector's v1
 *    gate on. The process page (per interval) and the Processes list (at
 *    the newest scrape) both add user and system, each mode once, and leave
 *    wait out: Pages/Host/Utils/Processes.ts holds the rule for both.
 *  - Service and unit availability are sample counts over at most the
 *    newest 2,000 samples, not time-weighted.
 *  - The Hosts list's Status, CPU, Memory and Disk columns read what the
 *    host last reported, kept on its record (HostReadingsScan writes it
 *    through ResourceHeartbeat about once a minute), not telemetry: CPU is
 *    user plus system time across every core, memory the used share without
 *    buffers and cache, disk the fullest mount's used over used plus free
 *    (df's Use%). Status and the bars' colours follow HostHealth's lines
 *    (Common/Types/Host/HostHealth). cpuCores is the first
 *    system.cpu.logical.count point (so hyperthreads count), and
 *    totalMemoryBytes the SUM of every system.memory.usage state.
 *
 * Change the fetch, change the words.
 */

import { translationKey } from "Common/UI/Utils/TranslateTemplate";

export type HostMetric =
  // Host overview: the hero's health pill and the Details card's Booted
  | "hostHealth"
  | "booted"
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
  | "hostListStatus"
  | "hostListCpu"
  | "hostListMemory"
  | "hostListDisk"
  // Processes, Services and Systemd Units lists
  | "processListCpu"
  | "processListMemory"
  | "serviceListStatus"
  | "serviceListStartup"
  | "unitListState"
  | "unitListType";

export const HOST_METRIC_DESCRIPTIONS: Record<HostMetric, string> = {
  cpu: translationKey(
    "Share of CPU time across all cores spent running programs and the operating system, averaged over the last 5 minutes of the range. 100% means every core was busy; on ranges over 12 hours or with no recent data, it is usually the whole-range average.",
  ),
  memory: translationKey(
    "Share of the host's physical memory (RAM) in use, not counting file cache the system can free, averaged over the last 5 minutes of the range. On ranges over 12 hours, or with no recent data, it is usually the whole-range average; below is the total RAM.",
  ),
  hostHealth: translationKey(
    "Healthy, Degraded or Unhealthy, by the rules the host's Needs attention card and the Hosts list follow, from what it last reported. Health Unknown while it is not reporting: its last readings are no longer the truth.",
  ),
  booted: translationKey(
    "When the host last started, from the uptime its collector reports (system.uptime). A reboot moves it.",
  ),
  filesystem: translationKey(
    "How full the host's fullest filesystem is, as df's Use% (used space over used plus free, space reserved for root not counted), averaged over the whole selected range, not the last 5 minutes; below, its mount point. The Filesystems table lists every mount.",
  ),
  loadAverage: translationKey(
    "The 1-minute load average from the newest interval: about how many processes were running or waiting for a CPU (Linux also counts ones waiting on disk). The % divides it by the number of cores, and over 100% means work is queuing.",
  ),
  processes: translationKey(
    "Processes running or ready to run on a CPU in the newest interval; the total on the line below counts every state and is updated at most about once a minute. Where states are not reported, as on Windows, it counts every process seen in the last 5 minutes.",
  ),
  availabilityChart: translationKey(
    "Up if OneUptime received metrics from this host in that interval, Down if nothing arrived; one missed minute between up ones counts as up. The uptime badge leaves out time OneUptime was not receiving, and the newest interval is not judged until data arrives.",
  ),
  cpuChart: translationKey(
    "Share of CPU time spent running programs and the operating system (user plus system time), averaged across all cores, in each interval of the selected range. 100% means every core was busy for the whole interval.",
  ),
  memoryChart: translationKey(
    "Share of the host's physical memory (RAM) in use in each interval of the selected range, not counting file cache the system can free.",
  ),
  diskSpaceChart: translationKey(
    "How full the host's fullest filesystem is, the same mount as the Filesystem tile, in each interval of the selected range, as df's Use%: space reserved for root not counted.",
  ),
  networkChart: translationKey(
    "Bytes per second received (In) and sent (Out), added up across every network interface the host reports, including loopback when the collector sends it. Worked out from the change in each interface's byte counters between intervals.",
  ),
  filesystemUsedTotal: translationKey(
    "Space used on this mount and its total size (used, free and reserved space added up), each averaged over the selected range. Sizes use 1024-based units, so 1 GiB is 1,024 MiB.",
  ),
  filesystemUtilization: translationKey(
    "How full this mount is, as df's Use%: used space over used plus free, space reserved for root not counted, averaged over the selected range. The bar turns amber above 85% and red above 95%.",
  ),
  processCountCached: translationKey(
    "How many processes the host had, in any state, as last saved. It refreshes at most about once a minute.",
  ),
  processCpu: translationKey(
    "CPU this process used (user plus system time) as a share of all host CPU cores, averaged over the last 5 minutes of the range (usually the whole range if over 12 hours or no recent data). Time it spent waiting on disk is left out.",
  ),
  processMemoryRss: translationKey(
    "Physical memory (RAM) this process holds, called resident set size or RSS, averaged over the last 5 minutes of the range (usually the whole range on ranges over 12 hours or with no recent data). The percentage below compares it with the host's total RAM.",
  ),
  processVirtualMemory: translationKey(
    "All the address space this process has reserved, including parts not in RAM such as mapped files, averaged over the last 5 minutes of the range (usually the whole range on ranges over 12 hours or with no recent data). It is normally far larger than RSS.",
  ),
  processThreads: translationKey(
    "This process's threads, averaged over the last 5 minutes of the range (usually the whole range on ranges over 12 hours or with no recent data); open file handles are below. Both need the collector's process.threads and process.open_file_descriptors turned on.",
  ),
  processCpuChart: translationKey(
    "CPU this process used in each interval of the selected range (user plus system time), as a share of the host's total CPU capacity. As on the CPU tile, time it spent waiting on disk is left out.",
  ),
  processMemoryRssChart: translationKey(
    "Physical memory (RSS) held by this process in each interval of the selected range.",
  ),
  processDiskIoChart: translationKey(
    "How fast this process read from and wrote to disk, in bytes per second, in each interval of the selected range. Worked out from the change in its running totals of bytes read and written.",
  ),
  serviceCurrentStatus: translationKey(
    "The service's state in the newest sample in the selected range: Running, Stopped, Paused, or a start, stop, pause or resume still in progress. The line below says how long ago that sample was taken.",
  ),
  serviceAvailability: translationKey(
    "Share of status samples in the selected range in which the service was Running; samples usually arrive every 30 seconds. Only the newest 2,000 samples count, and the tile says capped when the range holds more.",
  ),
  serviceStartupMode: translationKey(
    "How Windows starts this service, from its newest sample: Automatic (at boot), Manual (only when something asks for it), Disabled (cannot start), or Boot and System (loaded early in startup, usually drivers).",
  ),
  serviceStateChanges: translationKey(
    "How many times a status sample in the selected range differed from the one before it, such as Running to Stopped. A stop and restart that both happen between two samples is not seen.",
  ),
  serviceStatusTimeline: translationKey(
    "The service's status across the selected range. Where one point on the chart covers several samples it shows the worst status among them, so a short stop stays visible.",
  ),
  unitCurrentState: translationKey(
    "The unit's state in the newest sample in the selected range, as systemd reports it: Active, Inactive, Failed, Activating and so on. The line below says how long ago that sample was taken.",
  ),
  unitAvailability: translationKey(
    "Share of samples in the selected range in which the unit was Active (a service running, a socket listening, a timer waiting to fire); Reloading counts as not active. Only the newest 2,000 samples count, and the tile says capped when there are more.",
  ),
  unitType: translationKey(
    "The kind of systemd unit, read from the end of its name: Service (a background program), Socket, Timer, Mount, Target and so on.",
  ),
  unitStateChanges: translationKey(
    "How many times a sample in the selected range showed a different state from the one before it, such as Active to Failed. A failure and recovery that both happen between two samples is not seen.",
  ),
  unitStateTimeline: translationKey(
    "The unit's state across the selected range. Where one point on the chart covers several samples it shows the worst state among them, so a brief failure stays visible.",
  ),
  hostListStatus: translationKey(
    "The host's health by the rules its Needs attention card follows: Unhealthy when something is critical (a filesystem or memory past 95%), Degraded when something needs a look, Not reporting when nothing has arrived for 15 minutes. Below, the reason.",
  ),
  hostListCpu: translationKey(
    "Share of CPU time spent running programs and the operating system (user plus system time) across every core, from the host's last report, updated about once a minute; below, its logical cores. Amber above 90%.",
  ),
  hostListMemory: translationKey(
    "Share of physical memory (RAM) in use, not counting file cache the system can free, from the host's last report, updated about once a minute; below, its total RAM. Amber above 90%, red above 95%.",
  ),
  hostListDisk: translationKey(
    "How full the host's fullest filesystem is, as df's Use% (space reserved for root not counted), from the host's last report, updated about once a minute; below, its mount point. Amber above 85%, red above 95%.",
  ),
  processListCpu: translationKey(
    "CPU this process used at its newest reading in the last 15 minutes (user plus system time), as a share of the host's total capacity (all cores together). Time it spent waiting on disk is left out.",
  ),
  processListMemory: translationKey(
    "Physical memory (RSS) this process held at its newest reading in the last 15 minutes, with its share of the host's total RAM. The bar turns amber at 10% and red at 20% of RAM.",
  ),
  serviceListStatus: translationKey(
    "Each service's state at its newest sample from the last 15 minutes: Running, Stopped, Paused, or a start, stop, pause or resume still in progress.",
  ),
  serviceListStartup: translationKey(
    "How Windows starts the service: Automatic (at boot), Manual (only when requested), Disabled (cannot be started), or Boot and System (loaded early, usually drivers).",
  ),
  unitListState: translationKey(
    "Each unit's state at its newest sample from the last 15 minutes. Active means running, listening or waiting to fire; Failed means it crashed or exited with an error; Unknown means no state was reported.",
  ),
  unitListType: translationKey(
    "What kind of unit this is, taken from the end of its name, for example Service for a background program or Timer for a scheduled job.",
  ),
};
