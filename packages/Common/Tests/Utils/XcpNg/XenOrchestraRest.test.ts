import FakeXenOrchestraRest, {
  FAKE_XO_TOKEN,
  FakeXoRecord,
  FakeXoResponse,
  LAB_NOW_SECONDS,
  LAB_POOL_PRODUCTION,
  LAB_POOL_UNNAMED,
  parseXoFilter,
} from "../../Helpers/XcpNg/FakeXenOrchestraRest";
import {
  XO_ALARM_FIELDS,
  XO_BACKUP_JOB_FIELDS,
  XO_BACKUP_LOG_SUMMARY_FIELDS,
  XO_HOST_FIELDS,
  XO_MAX_MESSAGE_BODY_LENGTH,
  XO_MESSAGE_FIELDS,
  XO_POOL_FIELDS,
  XO_SCHEDULE_FIELDS,
  XcpNgAlarmReading,
  XoBackupLogSummary,
  buildXcpNgAlarmBody,
  buildXcpNgBackupJobInfos,
  buildXoBackupLogFilter,
  buildXoIdFilter,
  buildXoPath,
  buildXoPerPoolTimeFilter,
  buildXoPoolFilter,
  cleanXoText,
  readXcpNgAlarmBody,
  readXoAlarms,
  readXoBackupJobs,
  readXoBackupLogSummaries,
  readXoBackupRun,
  readXoBackupStatus,
  readXoHosts,
  readXoIds,
  readXoMessages,
  readXoMissingPatches,
  readXoPools,
  readXoSchedules,
  readXoUuid,
} from "../../../Utils/XcpNg/XenOrchestraRest";
import {
  XcpNgBackupJobInfo,
  XcpNgBackupRun,
  XcpNgBackupStatus,
  XcpNgBackupVmResult,
} from "../../../Types/XcpNg/XcpNgPoolEvents";
import {
  XcpNgPoolMessage,
  XcpNgPoolState,
} from "../../../Types/XcpNg/XcpNgProbeCollection";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Reading Xen Orchestra's REST answers (XenOrchestraRest), held to the
 * recorded lab served the way Xen Orchestra serves it (FakeXenOrchestraRest:
 * its filters, its `fields`, its alarms endpoint's parsing). Every reader
 * takes untrusted JSON: what is not Xen Orchestra's shape is skipped.
 */

const WEB_01: string = "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c";
const DB_01: string = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
const APP_02: string = "7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e";
const LAB_VM: string = "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b";
const PROD_01: string = "9c6c0b6e-4f2a-4a7e-8b1e-0d1f2a3b4c5d";
const NFS_SR: string = "1d2c3b4a-5e6f-4789-9abc-def012345678";

let xo: FakeXenOrchestraRest;

async function get(path: string): Promise<unknown> {
  const response: FakeXoResponse = await xo.handle({
    method: "GET",
    path: path,
    headers: { Cookie: `authenticationToken=${FAKE_XO_TOKEN}` },
  });
  expect(response.status).toBe(200);
  return JSON.parse(response.body) as unknown;
}

beforeEach(() => {
  xo = new FakeXenOrchestraRest();
});

describe("the stand-in's filters are Xen Orchestra's complex-matcher", () => {
  test("a property is a case-insensitive substring; a number also equal", () => {
    const match: (value: unknown) => boolean = parseXoFilter("name:vm_cra");
    expect(match({ name: "VM_CRASHED" })).toBe(true);
    expect(match({ name: "VM_STARTED" })).toBe(false);
    expect(parseXoFilter("id:1794996000000")({ id: "1794996000000" })).toBe(
      true,
    );
  });

  test("comparisons, OR, AND and NOT", () => {
    expect(parseXoFilter("time:>=10")({ time: 10 })).toBe(true);
    expect(parseXoFilter("time:>10")({ time: 10 })).toBe(false);
    expect(parseXoFilter("time:<10")({ time: "9" })).toBe(false);
    const either: (value: unknown) => boolean = parseXoFilter(
      "|(($pool:a time:>=5) ($pool:b time:>=9))",
    );
    expect(either({ $pool: "a", time: 5 })).toBe(true);
    expect(either({ $pool: "b", time: 5 })).toBe(false);
    expect(either({ $pool: "b", time: 9 })).toBe(true);
    expect(parseXoFilter("!name:alarm")({ name: "VM_STARTED" })).toBe(true);
    expect(parseXoFilter("name?")({ name: "" })).toBe(false);
  });
});

describe("filters OneUptime sends", () => {
  test("one pool's new messages: the pool and its watermark", () => {
    expect(
      buildXoPerPoolTimeFilter([
        { poolId: LAB_POOL_PRODUCTION, since: 1795000000 },
      ]),
    ).toBe(`$pool:${LAB_POOL_PRODUCTION} time:>=1795000000`);
  });

  test("every pool's new messages in one OR, each from its own watermark", () => {
    const filter: string | null = buildXoPerPoolTimeFilter([
      { poolId: LAB_POOL_PRODUCTION, since: 1795000040.9 },
      { poolId: LAB_POOL_UNNAMED.toUpperCase(), since: 1794000000 },
    ]);
    expect(filter).toBe(
      `|(($pool:${LAB_POOL_PRODUCTION} time:>=1795000040) ($pool:${LAB_POOL_UNNAMED} time:>=1794000000))`,
    );

    xo.setNowSeconds(1795000200);
    const selected: Array<FakeXoRecord> = xo
      .listedMessages()
      .filter(parseXoFilter(filter as string));
    expect(
      selected.map((message: FakeXoRecord) => {
        return message["id"];
      }),
    ).toContain("11111111-0000-4000-8000-000000000003");
    expect(
      selected.every((message: FakeXoRecord): boolean => {
        return (
          message["$pool"] !== LAB_POOL_PRODUCTION ||
          Number(message["time"]) >= 1795000040
        );
      }),
    ).toBe(true);
  });

  test("a pool with no valid UUID or time is left out; none left is null", () => {
    expect(
      buildXoPerPoolTimeFilter([
        { poolId: "not-a-uuid", since: 1 },
        { poolId: LAB_POOL_PRODUCTION, since: Number.NaN },
        { poolId: LAB_POOL_UNNAMED, since: -5 },
      ]),
    ).toBeNull();
    expect(buildXoPerPoolTimeFilter([])).toBeNull();
  });

  test("ids: deduplicated, only what goes in a filter unquoted", () => {
    expect(buildXoIdFilter(["a1", "a1", "b-2"])).toBe("id:|(a1 b-2)");
    expect(buildXoIdFilter(["only"])).toBe("id:only");
    expect(buildXoIdFilter(["bad id", ")", ""])).toBeNull();
  });

  test("a pool's every message, and backup runs since a time", () => {
    expect(buildXoPoolFilter(LAB_POOL_UNNAMED)).toBe(
      `$pool:${LAB_POOL_UNNAMED}`,
    );
    expect(buildXoPoolFilter("x")).toBeNull();
    expect(buildXoBackupLogFilter(1794996000000.7)).toBe(
      "start:>=1794996000000",
    );
    expect(buildXoBackupLogFilter(-1)).toBe("start:>=0");
  });

  test("paths encode every query value", () => {
    expect(
      buildXoPath("/rest/v0/messages", {
        fields: "id,$pool",
        filter: "|(a b)",
        limit: undefined,
        ndjson: null,
      }),
    ).toBe("/rest/v0/messages?fields=id%2C%24pool&filter=%7C(a%20b)");
    expect(buildXoPath("/rest/v0/pools", {})).toBe("/rest/v0/pools");
  });
});

describe("messages and alarms", () => {
  test("/messages: XAPI's messages without the alarm names, priority by name", async () => {
    xo.setNowSeconds(1795000200);
    const messages: Array<XcpNgPoolMessage> = readXoMessages(
      await get(
        buildXoPath("/rest/v0/messages", {
          fields: XO_MESSAGE_FIELDS,
          filter: buildXoPerPoolTimeFilter([
            { poolId: LAB_POOL_PRODUCTION, since: LAB_NOW_SECONDS },
          ]),
        }),
      ),
    );

    const names: Array<string> = messages.map((message: XcpNgPoolMessage) => {
      return message.name;
    });
    expect(names).toContain("VM_CRASHED");
    expect(names).toContain("HA_HOST_FAILED");
    expect(names).not.toContain("ALARM");
    expect(names).not.toContain("BOND_STATUS_CHANGED");
    expect(names).not.toContain("MULTIPATH_PERIODIC_ALERT");

    const crash: XcpNgPoolMessage = messages.find(
      (message: XcpNgPoolMessage) => {
        return message.name === "VM_CRASHED";
      },
    ) as XcpNgPoolMessage;
    expect(crash).toEqual({
      uuid: "11111111-0000-4000-8000-000000000010",
      poolId: LAB_POOL_PRODUCTION,
      name: "VM_CRASHED",
      priority: 2,
      objectClass: "vm",
      objectUuid: WEB_01,
      timestamp: new Date(1795000030 * 1000).toISOString(),
      body: "",
    });

    // A plugin's own name: priority 4, the feed and no alert.
    const plugin: XcpNgPoolMessage | undefined = messages.find(
      (message: XcpNgPoolMessage) => {
        return message.name === "ACME_PLUGIN_NOTICE";
      },
    );
    expect(plugin?.priority).toBe(4);
  });

  test("/alarms: milliseconds read back to seconds, the perfmon body rebuilt", async () => {
    xo.setNowSeconds(1795000200);
    const alarms: Array<XcpNgPoolMessage> = readXoAlarms(
      await get(
        buildXoPath("/rest/v0/alarms", {
          fields: XO_ALARM_FIELDS,
          filter: buildXoPerPoolTimeFilter([
            { poolId: LAB_POOL_PRODUCTION, since: LAB_NOW_SECONDS * 1000 },
          ]),
        }),
      ),
    );

    const cpu: XcpNgPoolMessage = alarms.find((alarm: XcpNgPoolMessage) => {
      return alarm.uuid === "11111111-0000-4000-8000-000000000011";
    }) as XcpNgPoolMessage;
    expect(cpu.name).toBe("ALARM");
    expect(cpu.priority).toBe(3);
    expect(cpu.objectClass).toBe("VM");
    expect(cpu.objectUuid).toBe(DB_01);
    expect(cpu.timestamp).toBe(new Date(1795000040 * 1000).toISOString());
    const reading: XcpNgAlarmReading | null = readXcpNgAlarmBody(cpu.body);
    expect(reading).toEqual({ variable: "cpu_usage", value: 0.953 });

    const bond: XcpNgPoolMessage = alarms.find((alarm: XcpNgPoolMessage) => {
      return alarm.name === "BOND_STATUS_CHANGED";
    }) as XcpNgPoolMessage;
    expect(bond.body).toBe("The status of the eth0+eth1 bond is: 1/2 up");
    expect(bond.objectClass).toBe("host");
    expect(readXcpNgAlarmBody(bond.body)).toBeNull();

    const storage: XcpNgPoolMessage = alarms.find((alarm: XcpNgPoolMessage) => {
      return alarm.objectUuid === NFS_SR;
    }) as XcpNgPoolMessage;
    expect(readXcpNgAlarmBody(storage.body)).toEqual({
      variable: "physical_utilisation",
      value: 0.913,
    });
  });

  test("an alarm whose time was a whole second is read as that second", async () => {
    xo.setNowSeconds(LAB_NOW_SECONDS);
    const alarms: Array<XcpNgPoolMessage> = readXoAlarms(
      await get(buildXoPath("/rest/v0/alarms", { fields: XO_ALARM_FIELDS })),
    );
    expect(
      alarms.map((alarm: XcpNgPoolMessage) => {
        return alarm.timestamp;
      }),
    ).toEqual([new Date(1794995000 * 1000).toISOString()]);
  });

  test("anything not a message is skipped, never thrown", () => {
    expect(readXoMessages(null)).toEqual([]);
    expect(readXoMessages("text")).toEqual([]);
    expect(
      readXoMessages([
        { id: "a", name: "VM_CRASHED", time: 5 },
        { id: "b", name: "VM_CRASHED", $pool: "nope", time: 5 },
        { id: "c", $pool: LAB_POOL_UNNAMED, time: 5 },
        { name: "VM_CRASHED", $pool: LAB_POOL_UNNAMED, time: 5 },
        { id: "d", name: "VM_CRASHED", $pool: LAB_POOL_UNNAMED, time: "x" },
        { id: "e", name: "VM_CRASHED", $pool: LAB_POOL_UNNAMED, time: -1 },
        7,
      ]),
    ).toEqual([]);
    expect(readXoAlarms([{ id: "a", name: "ALARM", time: 5 }])).toEqual([]);
  });

  test("an object of messages (keyed by id) is read like a list", () => {
    const read: Array<XcpNgPoolMessage> = readXoMessages({
      x: {
        id: "x",
        name: "vm_crashed",
        $pool: LAB_POOL_UNNAMED.toUpperCase(),
        time: 1795000000,
        body: "hi",
      },
    });
    expect(read).toHaveLength(1);
    expect(read[0]?.name).toBe("VM_CRASHED");
    expect(read[0]?.poolId).toBe(LAB_POOL_UNNAMED);
    expect(read[0]?.objectUuid).toBe("");
  });

  test("a body is cut at XO_MAX_MESSAGE_BODY_LENGTH and loses control characters", () => {
    const long: string = `${"a\u0007".repeat(3000)}`;
    const read: Array<XcpNgPoolMessage> = readXoMessages([
      {
        id: "x",
        name: "VM_STARTED",
        $pool: LAB_POOL_UNNAMED,
        time: 1,
        body: long,
      },
    ]);
    expect(read[0]?.body.length).toBe(XO_MAX_MESSAGE_BODY_LENGTH);
    expect(read[0]?.body.includes("\u0007")).toBe(false);
    expect(read[0]?.body.endsWith("…")).toBe(true);
  });

  test("ids still listed, from fields=id or from a list of hrefs", async () => {
    xo.setNowSeconds(1795000200);
    const filter: string = buildXoIdFilter([
      "11111111-0000-4000-8000-000000000010",
      "11111111-0000-4000-8000-000000009999",
    ]) as string;
    expect(
      Array.from(
        readXoIds(
          await get(
            buildXoPath("/rest/v0/messages", { fields: "id", filter: filter }),
          ),
        ),
      ),
    ).toEqual(["11111111-0000-4000-8000-000000000010"]);
    expect(
      Array.from(
        readXoIds(await get(buildXoPath("/rest/v0/messages", { filter }))),
      ),
    ).toEqual(["11111111-0000-4000-8000-000000000010"]);
    xo.dismiss("11111111-0000-4000-8000-000000000010");
    expect(
      readXoIds(
        await get(
          buildXoPath("/rest/v0/messages", { fields: "id", filter: filter }),
        ),
      ).size,
    ).toBe(0);
  });
});

describe("the perfmon ALARM body", () => {
  test("read from XAPI's own body", () => {
    expect(
      readXcpNgAlarmBody(
        'value: 0.921000\nconfig:\n<variable>\n<name value="fs_usage"/>\n</variable>',
      ),
    ).toEqual({ variable: "fs_usage", value: 0.921 });
  });

  test("rebuilt from Xen Orchestra's parse, and read back the same", () => {
    const body: string = buildXcpNgAlarmBody({
      variable: "cpu_usage",
      value: "95.3",
    });
    expect(body).toBe(
      'value: 0.953\nconfig:\n<variable>\n<name value="cpu_usage"/>\n</variable>',
    );
    expect(readXcpNgAlarmBody(body)).toEqual({
      variable: "cpu_usage",
      value: 0.953,
    });
  });

  test("NaN and Infinity, a quote in the name, a body that is not one", () => {
    expect(
      readXcpNgAlarmBody(buildXcpNgAlarmBody({ variable: "x", value: "NaN" })),
    ).toEqual({ variable: "x", value: null });
    expect(
      buildXcpNgAlarmBody({ variable: 'a"b', value: null }).includes('"a"b"'),
    ).toBe(false);
    expect(readXcpNgAlarmBody("The status of the bond is: 1/2 up")).toBeNull();
    expect(readXcpNgAlarmBody("value: 1\nconfig: nothing")).toBeNull();
    expect(readXcpNgAlarmBody("")).toBeNull();
    expect(readXcpNgAlarmBody(undefined)).toBeNull();
  });
});

describe("pools, hosts and patches", () => {
  test("/pools: whether HA is on, and the master", async () => {
    const pools: Array<XcpNgPoolState> = readXoPools(
      await get(buildXoPath("/rest/v0/pools", { fields: XO_POOL_FIELDS })),
    );
    expect(pools).toEqual([
      {
        poolId: LAB_POOL_PRODUCTION,
        haEnabled: true,
        masterHostUuid: PROD_01,
      },
      {
        poolId: LAB_POOL_UNNAMED,
        haEnabled: false,
        masterHostUuid: "6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d",
      },
    ]);
  });

  test("a pool object Xen Orchestra does not finish says HA off and no master", () => {
    expect(readXoPools([{ id: LAB_POOL_UNNAMED }, { id: "x" }, 3])).toEqual([
      { poolId: LAB_POOL_UNNAMED, haEnabled: false },
    ]);
  });

  test("/hosts: which hosts a patch check asks about", async () => {
    const hosts: ReturnType<typeof readXoHosts> = readXoHosts(
      await get(buildXoPath("/rest/v0/hosts", { fields: XO_HOST_FIELDS })),
    );
    expect(hosts).toHaveLength(4);
    expect(
      hosts
        .filter((host: { isRunning: boolean }) => {
          return host.isRunning;
        })
        .map((host: { name: string }) => {
          return host.name;
        }),
    ).toEqual(["xcp-prod-01", "xcp-prod-02", "xcp-lab-01"]);
  });

  test("a host's missing patches: by name, counted, deduplicated", async () => {
    const read: ReturnType<typeof readXoMissingPatches> = readXoMissingPatches(
      await get(`/rest/v0/hosts/${PROD_01}/missing_patches`),
    );
    expect(read.patchCount).toBe(3);
    expect(
      read.patches.map((patch: { name: string }) => {
        return patch.name;
      }),
    ).toEqual(["libsmbclient", "openssh", "xapi-core"]);
    expect(read.patches[1]).toEqual({
      name: "openssh",
      version: "7.4p1",
      release: "23.3.2.xcpng8.2",
      description:
        "An open source implementation of SSH protocol versions 1 and 2",
      size: 429044,
    });

    const twice: ReturnType<typeof readXoMissingPatches> = readXoMissingPatches(
      [
        { name: "a", version: "1", release: "1" },
        { name: "a", version: "1", release: "1" },
        { name: "a", version: "2", release: "1" },
        { id: "XS82E015", description: "x".repeat(600) },
        { nothing: true },
      ],
    );
    expect(twice.patchCount).toBe(3);
    const update: { name: string; description?: string | undefined } =
      twice.patches.find((patch: { name: string }) => {
        return patch.name === "XS82E015";
      }) as { name: string; description?: string | undefined };
    expect(update.description?.length).toBe(300);
  });

  test("no host's patches when there are none", async () => {
    expect(
      readXoMissingPatches(
        await get(
          "/rest/v0/hosts/4e1d3a2b-7c8d-4e9f-a0b1-c2d3e4f5a6b7/missing_patches",
        ),
      ),
    ).toEqual({ patchCount: 0, patches: [] });
  });
});

describe("backups", () => {
  test("statuses are Xen Orchestra's words only", () => {
    expect(readXoBackupStatus("success")).toBe(XcpNgBackupStatus.Success);
    expect(readXoBackupStatus("pending")).toBe("pending");
    expect(readXoBackupStatus("Failure")).toBeNull();
    expect(readXoBackupStatus(undefined)).toBeNull();
  });

  test("run summaries: oldest first, a pending one too", async () => {
    xo.addBackupLog({
      id: "1795000000000",
      jobId: "59af07fc-e82c-43b5-8137-026832f30166",
      jobName: "Nightly delta",
      message: "backup",
      start: 1795000000000,
      status: "pending",
    });
    const summaries: Array<XoBackupLogSummary> = readXoBackupLogSummaries(
      await get(
        buildXoPath("/rest/v0/backup-logs", {
          fields: XO_BACKUP_LOG_SUMMARY_FIELDS,
          filter: buildXoBackupLogFilter(1794900000000),
        }),
      ),
    );
    expect(
      summaries.map((summary: XoBackupLogSummary) => {
        return `${summary.jobName}:${summary.status}`;
      }),
    ).toEqual([
      "Nightly delta:success",
      "Nightly delta:failure",
      "Pool metadata:failure",
      "Weekly full:interrupted",
      "Nightly delta:pending",
    ]);
    expect(summaries[0]?.end).toBe(1794910400300);
    expect(summaries[4]?.end).toBeNull();
  });

  test("a run read the way Xen Orchestra's own reports read it", async () => {
    const run: XcpNgBackupRun = readXoBackupRun(
      await get("/rest/v0/backup-logs/1794996000000"),
    ) as XcpNgBackupRun;

    expect(run.runId).toBe("1794996000000");
    expect(run.jobName).toBe("Nightly delta");
    expect(run.mode).toBe("delta");
    expect(run.status).toBe(XcpNgBackupStatus.Failure);
    expect(run.startedAt).toBe(new Date(1794996000000).toISOString());
    expect(run.endedAt).toBe(new Date(1794996300300).toISOString());
    expect(run.error).toBeUndefined();
    expect(run.includedVmIds).toEqual([WEB_01, DB_01, APP_02, LAB_VM]);
    expect(run.includedPoolIds).toEqual([]);

    // Failed first, then skipped, then what succeeded.
    expect(
      run.vms.map((vm: XcpNgBackupVmResult) => {
        return `${vm.vmName}:${vm.status}`;
      }),
    ).toEqual([
      "web-01:failure",
      "app-02:failure",
      "db-01:skipped",
      "lab-vm-01:success",
    ]);

    const web: XcpNgBackupVmResult = run.vms[0] as XcpNgBackupVmResult;
    // The deepest task that failed, said with where it was; never the stack.
    expect(web.error).toBe("transfer: ENOSPC: no space left on device, write");
    expect(web.endedAt).toBe(new Date(1794996150200).toISOString());

    expect(run.vms[1]?.error).toBe("VDI_IO_ERROR(Device I/O errors)");
    expect(run.vms[2]?.error).toBe(
      "unhealthy VDI chain: Xen Orchestra skipped the VM to protect its disks' chain until it is coalesced",
    );
    expect(run.vms[3]?.error).toBeUndefined();
    expect(run.vms[3]?.bytes).toBe(536870912);
    expect(JSON.stringify(run).includes("stack")).toBe(false);
    expect(JSON.stringify(run).includes("/opt/xo")).toBe(false);
  });

  test("a successful run sums what each VM sent", async () => {
    const run: XcpNgBackupRun = readXoBackupRun(
      await get("/rest/v0/backup-logs/1794909600000"),
    ) as XcpNgBackupRun;
    expect(run.status).toBe(XcpNgBackupStatus.Success);
    const web: XcpNgBackupVmResult | undefined = run.vms.find(
      (vm: XcpNgBackupVmResult) => {
        return vm.vmId === WEB_01;
      },
    );
    // What it sent: the transfer, not the merge Xen Orchestra ran after.
    expect(web?.bytes).toBe(2147483648);
    expect(
      run.vms.every((vm: XcpNgBackupVmResult) => {
        return vm.error === undefined;
      }),
    ).toBe(true);
  });

  test("a metadata backup that could not reach its remote fails as a run", async () => {
    const run: XcpNgBackupRun = readXoBackupRun(
      await get("/rest/v0/backup-logs/1794997800000"),
    ) as XcpNgBackupRun;
    expect(run.status).toBe(XcpNgBackupStatus.Failure);
    expect(run.vms).toEqual([]);
    expect(run.error).toBe(
      "get remote adapter 4d4c8be8-5815-42af-82ad-b413d45b2d38: connect ECONNREFUSED 10.0.0.9:2049",
    );
  });

  test("an interrupted run's VM is interrupted", async () => {
    const run: XcpNgBackupRun = readXoBackupRun(
      await get("/rest/v0/backup-logs/1794999600000"),
    ) as XcpNgBackupRun;
    expect(run.status).toBe(XcpNgBackupStatus.Interrupted);
    expect(run.vms).toEqual([
      {
        vmId: "9d0e1f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a",
        vmName: "win-03",
        status: XcpNgBackupStatus.Interrupted,
        startedAt: new Date(1794999601000).toISOString(),
      },
    ]);
  });

  test("a metadata backup's pool task names its pool", () => {
    const run: XcpNgBackupRun = readXoBackupRun({
      id: "1",
      jobId: "j",
      status: "success",
      start: 1,
      tasks: [
        {
          data: { type: "pool", id: LAB_POOL_PRODUCTION.toUpperCase() },
          status: "success",
        },
        { data: { type: "xo" }, status: "success" },
      ],
    }) as XcpNgBackupRun;
    expect(run.includedPoolIds).toEqual([LAB_POOL_PRODUCTION]);
  });

  test("a pending run, or anything that is not a run, is null", () => {
    expect(
      readXoBackupRun({ id: "1", jobId: "j", status: "pending", start: 1 }),
    ).toBeNull();
    expect(
      readXoBackupRun({ id: "1", status: "success", start: 1 }),
    ).toBeNull();
    expect(
      readXoBackupRun({ id: "1", jobId: "j", status: "success" }),
    ).toBeNull();
    expect(readXoBackupRun([])).toBeNull();
    expect(readXoBackupRun("x")).toBeNull();
  });

  test("a VM still pending in a finished run is interrupted; a VM twice is once", () => {
    const run: XcpNgBackupRun = readXoBackupRun({
      id: "1",
      jobId: "j",
      status: "interrupted",
      start: 1,
      tasks: [
        { data: { type: "VM", id: WEB_01 }, status: "pending" },
        { data: { type: "VM", id: WEB_01 }, status: "success" },
        { data: { type: "VM", id: "nope" }, status: "success" },
      ],
    }) as XcpNgBackupRun;
    expect(run.vms).toEqual([
      { vmId: WEB_01, status: XcpNgBackupStatus.Interrupted },
    ]);
    expect(run.jobName).toBe("j");
  });

  test("jobs and their schedules, a metadata job's pools", async () => {
    const infos: Array<XcpNgBackupJobInfo> = buildXcpNgBackupJobInfos({
      jobs: readXoBackupJobs(
        await get(
          buildXoPath("/rest/v0/backup-jobs", { fields: XO_BACKUP_JOB_FIELDS }),
        ),
      ),
      schedules: readXoSchedules(
        await get(
          buildXoPath("/rest/v0/schedules", { fields: XO_SCHEDULE_FIELDS }),
        ),
      ),
    });

    expect(
      infos.map((info: XcpNgBackupJobInfo) => {
        return info.name;
      }),
    ).toEqual(["Nightly delta", "Weekly full", "Pool metadata", "Old archive"]);
    expect(infos[0]).toEqual({
      jobId: "59af07fc-e82c-43b5-8137-026832f30166",
      name: "Nightly delta",
      mode: "delta",
      jobType: "backup",
      schedules: [
        {
          scheduleId: "1c7cfc78-a006-4942-aab6-b4c825ce9a4e",
          cron: "0 10 * * *",
          timezone: "UTC",
          enabled: true,
        },
      ],
    });
    expect(infos[2]?.poolIds).toEqual([LAB_POOL_PRODUCTION]);
    expect(infos[2]?.jobType).toBe("metadataBackup");
    expect(infos[3]?.schedules[0]?.enabled).toBe(false);
  });
});

describe("words a person reads", () => {
  test("control characters go, the rest stays, a long text ends in an ellipsis", () => {
    expect(cleanXoText("a\u0000b\tc\nd\u007F", 100)).toBe("ab\tc\nd");
    expect(cleanXoText("abcdef", 4)).toBe("abc…");
    expect(cleanXoText(5, 4)).toBe("");
    expect(cleanXoText("  x  ", 4)).toBe("x");
  });

  test("UUIDs are read lower case, anything else is not one", () => {
    expect(readXoUuid(LAB_POOL_PRODUCTION.toUpperCase())).toBe(
      LAB_POOL_PRODUCTION,
    );
    expect(readXoUuid("b7569d99-30f8-178a-7d94-801de3e29b5")).toBeNull();
    expect(readXoUuid(12)).toBeNull();
  });
});
