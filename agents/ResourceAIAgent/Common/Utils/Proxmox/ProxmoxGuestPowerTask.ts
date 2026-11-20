/*
 * WHO OR WHAT STOPPED A PROXMOX GUEST, FROM THE CLUSTER'S TASK LOG (#10017).
 *
 * "Stopped, but starts on boot" says a guest should run. Whether someone ran
 * `qm stop` an hour ago, HA stopped it on someone's request, its last start
 * failed, or it went down by itself decides whether to start it again or
 * look at it first - and the inventory (prometheus-pve-exporter's series)
 * says none of it.
 *
 * Proxmox VE logs every action on a guest as a task: GET
 * /nodes/{node}/tasks?vmid={vmid} lists them, newest first, each with its
 * type (qmstop, qmshutdown, vzstop, hastop, qmstart...), the user who ran it
 * (alice@pve, root@pam, a token's user@realm!name), when it started and
 * ended, and its status: "OK", "WARNINGS: n", or the error it failed with
 * ("start failed: QEMU exited with code 1"). The task types are the ones the
 * Proxmox VE web UI names (pve-manager's task descriptions).
 *
 * The Proxmox AI agent reads the task log of each guest that is stopped
 * (agents/ResourceAIAgent, ProxmoxGuestTaskReporter) and sends, for each,
 * the last task that started or stopped it, as one gauge datapoint of the
 * metric below with the task in its attributes. The metrics ingest keeps it
 * on the guest's inventory row, and a guest that should be running says
 * who or what stopped it, and when.
 *
 * Shared, byte for byte, by the agent (its Common copy, Scripts/
 * CommonCopies.json) and the server: the one place the metric, its
 * attributes and the rule that picks the task are written. Pure and
 * dependency-free. These names are stored in customers' metrics: never
 * rename one.
 */

// The metric: its value is when the task ended (or started), in Unix seconds; 0 for none.
export const PROXMOX_GUEST_POWER_TASK_METRIC_NAME: string =
  "pve_guest_last_power_task";

// The instrumentation scope the agent sends it under.
export const PROXMOX_GUEST_POWER_TASK_SCOPE_NAME: string =
  "oneuptime-proxmox-guest-tasks";

// The task's facts, as datapoint attributes beside the guest's own `id`.
export enum ProxmoxGuestPowerTaskAttribute {
  // qmstop, qmshutdown, vzstop, hastop, qmstart...; "" when none was found.
  Type = "pve.task.type",
  // Who ran it: alice@pve, root@pam, monitoring@pam!oneuptime.
  User = "pve.task.user",
  // "OK", "WARNINGS: 2", or the error the task failed with.
  Status = "pve.task.status",
  // The node it ran on.
  Node = "pve.task.node",
}

/*
 * The tasks that stop a guest: stop, shut down, hibernate, and HA's stop
 * and shutdown requests (a guest HA manages is stopped through HA: `qm
 * stop` asks the cluster resource manager, whose local resource manager
 * then runs the stop as root@pam).
 */
export const PROXMOX_STOP_TASK_TYPES: ReadonlyArray<string> = [
  "qmstop",
  "qmshutdown",
  "qmsuspend",
  "vzstop",
  "vzshutdown",
  "hastop",
  "hashutdown",
];

// The tasks that start a guest, or stop and start it.
export const PROXMOX_START_TASK_TYPES: ReadonlyArray<string> = [
  "qmstart",
  "qmreboot",
  "vzstart",
  "vzreboot",
  "hastart",
];

// The tasks that restore a guest from a backup, which leave it stopped.
export const PROXMOX_RESTORE_TASK_TYPES: ReadonlyArray<string> = [
  "qmrestore",
  "vzrestore",
];

// HA's own requests to stop a guest, which a stop by root@pam then carries out.
export const PROXMOX_HA_STOP_TASK_TYPES: ReadonlyArray<string> = [
  "hastop",
  "hashutdown",
];

// The stops HA's local resource manager runs for a request.
const LOCAL_STOP_TASK_TYPES: ReadonlyArray<string> = [
  "qmstop",
  "qmshutdown",
  "vzstop",
  "vzshutdown",
];

// The user HA's local resource manager runs its tasks as.
export const PROXMOX_HA_TASK_USER: string = "root@pam";

/*
 * How long after HA's request its local resource manager may start the
 * stop it asked for, and still be read as that request's. The manager acts
 * on its next round, seconds later; a stop by root@pam long after a request
 * is another stop.
 */
export const PROXMOX_HA_REQUEST_WINDOW_SECONDS: number = 10 * 60;

// One task of the task log, as GET /nodes/{node}/tasks lists it.
export interface ProxmoxTaskLogEntry {
  upid?: string | undefined;
  node?: string | undefined;
  type: string;
  // The guest's VMID, for a guest's task.
  id?: string | undefined;
  user?: string | undefined;
  // Unix seconds.
  starttime?: number | undefined;
  // Unix seconds; absent while the task runs.
  endtime?: number | undefined;
  // Absent while the task runs.
  status?: string | undefined;
}

// The task a guest's row keeps: what it was, who ran it, how it ended, when.
export interface ProxmoxGuestPowerTask {
  type: string;
  user: string;
  // "OK", "WARNINGS: n" or the error; "" when the log said nothing.
  status: string;
  node: string;
  // When it ended, else when it started; Unix seconds.
  at: number;
}

function isPowerTask(type: string): boolean {
  return (
    PROXMOX_STOP_TASK_TYPES.includes(type) ||
    PROXMOX_START_TASK_TYPES.includes(type) ||
    PROXMOX_RESTORE_TASK_TYPES.includes(type)
  );
}

function timeOf(task: ProxmoxTaskLogEntry): number {
  const end: number = Number(task.endtime);
  if (Number.isFinite(end) && end > 0) {
    return end;
  }
  const start: number = Number(task.starttime);
  return Number.isFinite(start) && start > 0 ? start : 0;
}

function startOf(task: ProxmoxTaskLogEntry): number {
  const start: number = Number(task.starttime);
  return Number.isFinite(start) && start > 0 ? start : timeOf(task);
}

function toPowerTask(task: ProxmoxTaskLogEntry): ProxmoxGuestPowerTask {
  return {
    type: task.type,
    user: (task.user || "").trim(),
    status: (task.status || "").trim(),
    node: (task.node || "").trim(),
    at: timeOf(task),
  };
}

// Whether a task ended well: "OK", or done with warnings.
export function isProxmoxTaskOk(status: string | null | undefined): boolean {
  const text: string = (status || "").trim();
  return text === "OK" || text.startsWith("WARNINGS");
}

/*
 * The last task that started, stopped or restored the guest, from its task
 * log: the newest of them that has finished. A stop HA's local resource
 * manager ran as root@pam for a request is read as that request, which
 * names who asked: "Stopped through HA by alice@pve", never "by root@pam".
 * Null when the log holds none of them.
 */
export function selectProxmoxGuestPowerTask(
  tasks: ReadonlyArray<ProxmoxTaskLogEntry>,
): ProxmoxGuestPowerTask | null {
  const finished: Array<ProxmoxTaskLogEntry> = tasks
    .filter((task: ProxmoxTaskLogEntry): boolean => {
      return (
        typeof task.type === "string" &&
        isPowerTask(task.type) &&
        timeOf(task) > 0 &&
        // Still running: not yet what it did.
        typeof task.status === "string"
      );
    })
    .sort((a: ProxmoxTaskLogEntry, b: ProxmoxTaskLogEntry): number => {
      return timeOf(b) - timeOf(a);
    });

  const newest: ProxmoxTaskLogEntry | undefined = finished[0];
  if (!newest) {
    return null;
  }

  if (
    LOCAL_STOP_TASK_TYPES.includes(newest.type) &&
    (newest.user || "").trim() === PROXMOX_HA_TASK_USER
  ) {
    const startedAt: number = startOf(newest);
    const request: ProxmoxTaskLogEntry | undefined = finished.find(
      (task: ProxmoxTaskLogEntry): boolean => {
        return (
          PROXMOX_HA_STOP_TASK_TYPES.includes(task.type) &&
          timeOf(task) <= startedAt + 1 &&
          startedAt - startOf(task) <= PROXMOX_HA_REQUEST_WINDOW_SECONDS
        );
      },
    );
    if (request) {
      return toPowerTask(request);
    }
  }

  return toPowerTask(newest);
}

// What a guest's last power task says about why it is stopped.
export enum ProxmoxGuestStopCause {
  StoppedBy = "stopped-by",
  ShutDownBy = "shut-down-by",
  StoppedThroughHaBy = "stopped-through-ha-by",
  HibernatedBy = "hibernated-by",
  RestoredBy = "restored-by",
  // A start (or a reboot) that failed: the error is the task's status.
  StartFailed = "start-failed",
  // Its last start went well, and no task stopped it since.
  StoppedWithoutTask = "stopped-without-task",
}

/*
 * Why a guest that is stopped is stopped, by its last power task. Null for
 * a task this does not know.
 */
export function getProxmoxGuestStopCause(
  task: Pick<ProxmoxGuestPowerTask, "type" | "status">,
): ProxmoxGuestStopCause | null {
  switch (task.type) {
    case "qmstop":
    case "vzstop":
      return ProxmoxGuestStopCause.StoppedBy;
    case "qmshutdown":
    case "vzshutdown":
      return ProxmoxGuestStopCause.ShutDownBy;
    case "hastop":
    case "hashutdown":
      return ProxmoxGuestStopCause.StoppedThroughHaBy;
    case "qmsuspend":
      return ProxmoxGuestStopCause.HibernatedBy;
    case "qmrestore":
    case "vzrestore":
      return ProxmoxGuestStopCause.RestoredBy;
    case "qmstart":
    case "qmreboot":
    case "vzstart":
    case "vzreboot":
    case "hastart":
      return isProxmoxTaskOk(task.status)
        ? ProxmoxGuestStopCause.StoppedWithoutTask
        : ProxmoxGuestStopCause.StartFailed;
    default:
      return null;
  }
}
