import { describe, expect, test } from "@jest/globals";
import {
  PROXMOX_GUEST_POWER_TASK_METRIC_NAME,
  PROXMOX_HA_REQUEST_WINDOW_SECONDS,
  ProxmoxGuestStopCause,
  ProxmoxTaskLogEntry,
  getProxmoxGuestStopCause,
  isProxmoxTaskOk,
  selectProxmoxGuestPowerTask,
} from "../../../Utils/Proxmox/ProxmoxGuestPowerTask";

/*
 * Which task of a guest's task log says who or what stopped it (#10017),
 * the rule the Proxmox AI agent picks it by and the Dashboard words it by.
 * The tasks are as GET /nodes/{node}/tasks lists them on Proxmox VE 8: the
 * types its web UI names, the users it records (a realm's user, root@pam
 * for what HA runs, a token's user@realm!name), its statuses ("OK",
 * "WARNINGS: n", the error a task failed with).
 */

const NOW: number = 1763640000;

function entry(
  type: string,
  minutesAgo: number,
  fields: Partial<ProxmoxTaskLogEntry> = {},
): ProxmoxTaskLogEntry {
  const start: number = NOW - minutesAgo * 60;
  return {
    upid: `UPID:pve1:0001A2B3:0C4D5E6F:${start.toString(16).toUpperCase()}:${type}:101:${fields.user || "alice@pve"}:`,
    node: "pve1",
    type: type,
    id: "101",
    user: "alice@pve",
    starttime: start,
    endtime: start + 3,
    status: "OK",
    ...fields,
  };
}

describe("the metric", () => {
  test("keeps the name customers' metrics are stored under", () => {
    expect(PROXMOX_GUEST_POWER_TASK_METRIC_NAME).toBe(
      "pve_guest_last_power_task",
    );
  });
});

describe("a guest's last power task", () => {
  test("is the newest task that started, stopped or restored it, whatever came after", () => {
    const task: ReturnType<typeof selectProxmoxGuestPowerTask> =
      selectProxmoxGuestPowerTask([
        // Consoles and backups say nothing of why it stopped.
        entry("vncproxy", 5),
        entry("vzdump", 60, { user: "root@pam" }),
        entry("qmstop", 120),
        entry("qmstart", 3000, { user: "root@pam" }),
      ]);
    expect(task).toEqual({
      type: "qmstop",
      user: "alice@pve",
      status: "OK",
      node: "pve1",
      at: NOW - 120 * 60 + 3,
    });
  });

  test("is read by when it ended, whatever order the log lists them in", () => {
    expect(
      selectProxmoxGuestPowerTask([
        entry("qmstart", 3000),
        entry("qmshutdown", 30),
        entry("qmstop", 300),
      ])?.type,
    ).toBe("qmshutdown");
  });

  test("a task still running is not yet what it did", () => {
    const running: ProxmoxTaskLogEntry = entry("qmshutdown", 1);
    delete running.status;
    delete running.endtime;
    expect(
      selectProxmoxGuestPowerTask([running, entry("qmstop", 120)])?.type,
    ).toBe("qmstop");
  });

  test("a stop HA ran as root@pam for someone's request is that request: who asked", () => {
    const task: ReturnType<typeof selectProxmoxGuestPowerTask> =
      selectProxmoxGuestPowerTask([
        entry("qmshutdown", 30, { user: "root@pam" }),
        // HA's request, seconds before its local resource manager ran it.
        {
          ...entry("hastop", 30, { user: "bob@pve" }),
          starttime: NOW - 30 * 60 - 6,
          endtime: NOW - 30 * 60 - 5,
        },
      ]);
    expect(task?.type).toBe("hastop");
    expect(task?.user).toBe("bob@pve");
  });

  test("a stop by root@pam long after an HA request is another stop: root's", () => {
    const longBefore: number = PROXMOX_HA_REQUEST_WINDOW_SECONDS / 60 + 30;
    const task: ReturnType<typeof selectProxmoxGuestPowerTask> =
      selectProxmoxGuestPowerTask([
        entry("qmstop", 10, { user: "root@pam" }),
        entry("hastop", 10 + longBefore, { user: "bob@pve" }),
      ]);
    expect(task?.type).toBe("qmstop");
    expect(task?.user).toBe("root@pam");
  });

  test("a stop by someone else than root@pam is theirs, HA or not", () => {
    expect(
      selectProxmoxGuestPowerTask([
        entry("qmstop", 30, { user: "carol@pam" }),
        entry("hastop", 30, { user: "bob@pve" }),
      ])?.user,
    ).toBe("carol@pam");
  });

  test("a start that failed keeps Proxmox's own reason", () => {
    expect(
      selectProxmoxGuestPowerTask([
        entry("qmstart", 10, {
          user: "root@pam",
          status: "start failed: QEMU exited with code 1",
        }),
        entry("qmstop", 120),
      ]),
    ).toEqual({
      type: "qmstart",
      user: "root@pam",
      status: "start failed: QEMU exited with code 1",
      node: "pve1",
      at: NOW - 10 * 60 + 3,
    });
  });

  test("a token's user is kept as Proxmox writes it", () => {
    expect(
      selectProxmoxGuestPowerTask([
        entry("vzshutdown", 15, { user: "automation@pve!nightly" }),
      ])?.user,
    ).toBe("automation@pve!nightly");
  });

  test("a log with none of them has no last power task", () => {
    expect(
      selectProxmoxGuestPowerTask([
        entry("vncproxy", 5),
        entry("vzdump", 60),
        entry("qmconfig", 70),
      ]),
    ).toBeNull();
    expect(selectProxmoxGuestPowerTask([])).toBeNull();
  });
});

describe("what it says about why the guest is stopped", () => {
  test.each([
    ["qmstop", "OK", ProxmoxGuestStopCause.StoppedBy],
    ["vzstop", "OK", ProxmoxGuestStopCause.StoppedBy],
    ["qmshutdown", "OK", ProxmoxGuestStopCause.ShutDownBy],
    ["vzshutdown", "OK", ProxmoxGuestStopCause.ShutDownBy],
    ["hastop", "OK", ProxmoxGuestStopCause.StoppedThroughHaBy],
    ["hashutdown", "OK", ProxmoxGuestStopCause.StoppedThroughHaBy],
    ["qmsuspend", "OK", ProxmoxGuestStopCause.HibernatedBy],
    ["qmrestore", "OK", ProxmoxGuestStopCause.RestoredBy],
    ["vzrestore", "OK", ProxmoxGuestStopCause.RestoredBy],
    // Its last start went well: nothing that Proxmox ran stopped it.
    ["qmstart", "OK", ProxmoxGuestStopCause.StoppedWithoutTask],
    ["vzstart", "WARNINGS: 1", ProxmoxGuestStopCause.StoppedWithoutTask],
    ["qmreboot", "OK", ProxmoxGuestStopCause.StoppedWithoutTask],
    [
      "qmstart",
      "start failed: QEMU exited with code 1",
      ProxmoxGuestStopCause.StartFailed,
    ],
    [
      "hastart",
      "unable to find configuration file for VM 101 on node 'pve2'",
      ProxmoxGuestStopCause.StartFailed,
    ],
  ])("%s, %s", (type: string, status: string, cause: string) => {
    expect(getProxmoxGuestStopCause({ type, status })).toBe(cause);
  });

  test("a task this does not know says nothing", () => {
    expect(
      getProxmoxGuestStopCause({ type: "qmigrate", status: "OK" }),
    ).toBeNull();
  });

  test("a task ended well when it said OK, or finished with warnings", () => {
    expect(isProxmoxTaskOk("OK")).toBe(true);
    expect(isProxmoxTaskOk("WARNINGS: 2")).toBe(true);
    expect(isProxmoxTaskOk("start failed: QEMU exited with code 1")).toBe(
      false,
    );
    expect(isProxmoxTaskOk("")).toBe(false);
    expect(isProxmoxTaskOk(undefined)).toBe(false);
  });
});
