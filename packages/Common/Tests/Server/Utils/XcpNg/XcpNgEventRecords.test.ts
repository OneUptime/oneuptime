import {
  XCP_NG_EVENT_TIME_TOLERANCE_MS,
  buildXcpNgBackupLogRecord,
  buildXcpNgBackupResolvedLogRecord,
  buildXcpNgClearedLogRecord,
  buildXcpNgDerivedResourceMetrics,
  buildXcpNgEventResourceLogs,
  buildXcpNgMessageLogRecord,
  describeXcpNgAlarm,
  describeXcpNgBackupRun,
  describeXcpNgMessage,
  getXcpNgEventRecordTime,
  listXcpNgFailedVmNames,
} from "../../../../Server/Utils/XcpNg/XcpNgEventRecords";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import {
  XcpNgMessageAlert,
  XcpNgMessageDefinition,
  getXcpNgMessageDefinition,
} from "../../../../Types/XcpNg/XcpNgMessageCatalog";
import {
  XCP_NG_EVENTS_SCOPE_NAME,
  XcpNgBackupStatus,
} from "../../../../Types/XcpNg/XcpNgPoolEvents";
import { XcpNgPoolBackupRunSummary } from "../../../../Types/XcpNg/XcpNgPoolEventState";
import { XcpNgScope } from "../../../../Types/XcpNg/XcpNgTelemetry";
import { describe, expect, test } from "@jest/globals";

/*
 * A pool's events as OpenTelemetry (XcpNgEventRecords): the log records the
 * alert templates read, and the derived gauges the XCP-ng monitor reads.
 */

const POOL: string = "b7569d99-30f8-178a-7d94-801de3e29b5b";
const WEB_01: string = "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c";
const OBSERVED: Date = new Date(1795000100 * 1000);

function attributes(record: JSONObject): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of (record["attributes"] || []) as JSONArray) {
    const attribute: JSONObject = entry as JSONObject;
    out[String(attribute["key"])] = String(
      ((attribute["value"] || {}) as JSONObject)["stringValue"],
    );
  }
  return out;
}

function body(record: JSONObject): string {
  return String(((record["body"] || {}) as JSONObject)["stringValue"]);
}

function summary(
  overrides: Partial<XcpNgPoolBackupRunSummary> = {},
): XcpNgPoolBackupRunSummary {
  return {
    runId: "1794996000000",
    status: XcpNgBackupStatus.Failure,
    startedAt: new Date(1794996000000).toISOString(),
    endedAt: new Date(1794996300300).toISOString(),
    vmCount: 3,
    failedVmCount: 2,
    skippedVmCount: 1,
    problemVms: [
      {
        vmId: WEB_01,
        vmName: "web-01",
        status: XcpNgBackupStatus.Failure,
        error: "transfer: ENOSPC: no space left on device, write",
      },
      {
        vmId: "7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e",
        vmName: "app-02",
        status: XcpNgBackupStatus.Failure,
        error: "VDI_IO_ERROR(Device I/O errors)",
      },
      {
        vmId: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
        vmName: "db-01",
        status: XcpNgBackupStatus.Skipped,
        error: "unhealthy VDI chain",
      },
    ],
    ...overrides,
  };
}

describe("when a record is dated", () => {
  test("by the event's own time within ten minutes of its arrival", () => {
    expect(XCP_NG_EVENT_TIME_TOLERANCE_MS).toBe(600000);
    const event: Date = new Date(OBSERVED.getTime() - 90000);
    expect(
      getXcpNgEventRecordTime({ eventTime: event, observedAt: OBSERVED }),
    ).toBe(event);
  });

  test("by its arrival past that, either way, so a monitor's window sees it", () => {
    for (const offset of [-XCP_NG_EVENT_TIME_TOLERANCE_MS - 1, 3600000]) {
      expect(
        getXcpNgEventRecordTime({
          eventTime: new Date(OBSERVED.getTime() + offset),
          observedAt: OBSERVED,
        }),
      ).toBe(OBSERVED);
    }
    expect(
      getXcpNgEventRecordTime({ eventTime: null, observedAt: OBSERVED }),
    ).toBe(OBSERVED);
    expect(
      getXcpNgEventRecordTime({
        eventTime: new Date("nope"),
        observedAt: OBSERVED,
      }),
    ).toBe(OBSERVED);
  });
});

describe("a message's record", () => {
  const definition: XcpNgMessageDefinition = getXcpNgMessageDefinition({
    name: "VM_CRASHED",
  });

  test("carries what the templates match and group on", () => {
    const record: JSONObject = buildXcpNgMessageLogRecord({
      message: {
        uuid: "m1",
        poolId: POOL,
        name: "VM_CRASHED",
        priority: 2,
        objectClass: "vm",
        objectUuid: WEB_01,
        timestamp: new Date(1795000030 * 1000).toISOString(),
        body: "",
      },
      definition: definition,
      object: { type: XcpNgScope.VM, uuid: WEB_01, name: "web-01" },
      alarm: null,
      observedAt: OBSERVED,
    });

    expect(attributes(record)).toEqual({
      "xcp_ng.event.kind": "message",
      "xcp_ng.message.id": "m1",
      "xcp_ng.message.name": "VM_CRASHED",
      "xcp_ng.message.priority": "2",
      "xcp_ng.message.alert": XcpNgMessageAlert.VmCrashed,
      "xcp_ng.message.state": "raised",
      "xcp_ng.object.type": "vm",
      "xcp_ng.object.uuid": WEB_01,
      "xcp_ng.object.name": "web-01",
      "xcp_ng.alarm.variable": "",
      "xcp_ng.message.time": new Date(1795000030 * 1000).toISOString(),
    });
    expect(record["severityNumber"]).toBe(17);
    expect(record["severityText"]).toBe("ERROR");
    expect(record["timeUnixNano"]).toBe(`${1795000030 * 1000}000000`);
    expect(record["observedTimeUnixNano"]).toBe(`${OBSERVED.getTime()}000000`);
    expect(body(record)).toBe("VM crashed: web-01");
  });

  test("an ALARM names its variable and value, in words a person reads", () => {
    const record: JSONObject = buildXcpNgMessageLogRecord({
      message: {
        uuid: "m2",
        poolId: POOL,
        name: "ALARM",
        priority: 3,
        objectClass: "VM",
        objectUuid: WEB_01,
        timestamp: new Date(1795000040 * 1000).toISOString(),
        body: "value: 0.953",
      },
      definition: getXcpNgMessageDefinition({ name: "ALARM" }),
      object: { type: XcpNgScope.VM, uuid: WEB_01, name: "db-01" },
      alarm: { variable: "cpu_usage", value: 0.953 },
      observedAt: OBSERVED,
    });
    expect(attributes(record)["xcp_ng.alarm.variable"]).toBe("cpu_usage");
    expect(attributes(record)["xcp_ng.alarm.value"]).toBe("0.953");
    expect(record["severityText"]).toBe("WARN");
    expect(body(record)).toBe(
      "Threshold alarm: db-01 - cpu_usage reached 95.3%",
    );
  });

  test("XAPI's own words follow what happened", () => {
    expect(
      describeXcpNgMessage({
        definition: getXcpNgMessageDefinition({
          name: "PBD_PLUG_FAILED_ON_SERVER_START",
        }),
        object: { type: XcpNgScope.Host, uuid: "h", name: "xcp-prod-02" },
        body: "  SR 'NFS' could not be plugged  ",
        alarm: null,
      }),
    ).toBe(
      "Storage failed to plug when a host started: xcp-prod-02 - SR 'NFS' could not be plugged",
    );
  });

  test("an alarm whose variable is not a fraction keeps its number", () => {
    expect(
      describeXcpNgAlarm({ variable: "network_usage", value: 12345678.901 }),
    ).toBe("network_usage reached 12345678.9");
    expect(describeXcpNgAlarm({ variable: "mem_usage", value: 0.96 })).toBe(
      "mem_usage reached 96%",
    );
    expect(describeXcpNgAlarm({ variable: "x", value: null })).toBe(
      "x crossed its threshold",
    );
  });

  test("the record that clears an alert lands in that alert's group", () => {
    const record: JSONObject = buildXcpNgClearedLogRecord({
      open: {
        id: "m2",
        name: "ALARM",
        alert: XcpNgMessageAlert.OtherAlarm,
        objectType: "vm",
        objectUuid: WEB_01,
        objectName: "web-01 (old name)",
        variable: "cpu_usage",
        raisedAt: new Date(1795000040 * 1000).toISOString(),
      },
      priority: 3,
      observedAt: OBSERVED,
    });
    expect(attributes(record)).toEqual({
      "xcp_ng.event.kind": "message",
      "xcp_ng.message.id": "m2",
      "xcp_ng.message.name": "ALARM",
      "xcp_ng.message.priority": "3",
      "xcp_ng.message.alert": XcpNgMessageAlert.OtherAlarm,
      "xcp_ng.message.state": "cleared",
      "xcp_ng.object.type": "vm",
      "xcp_ng.object.uuid": WEB_01,
      "xcp_ng.object.name": "web-01 (old name)",
      "xcp_ng.alarm.variable": "cpu_usage",
    });
    expect(record["timeUnixNano"]).toBe(`${OBSERVED.getTime()}000000`);
    expect(record["severityText"]).toBe("INFO");
    expect(body(record)).toContain("no longer listed by XCP-ng");
  });
});

describe("a backup run's record", () => {
  test("a failure names the job and the VMs that failed, and why", () => {
    const record: JSONObject = buildXcpNgBackupLogRecord({
      jobId: "job-a",
      jobName: "Nightly delta",
      mode: "delta",
      summary: summary(),
      observedAt: OBSERVED,
    });
    expect(attributes(record)).toEqual({
      "xcp_ng.event.kind": "backup",
      "xcp_ng.backup.job.id": "job-a",
      "xcp_ng.backup.job.name": "Nightly delta",
      "xcp_ng.backup.run.id": "1794996000000",
      "xcp_ng.backup.status": "failure",
      "xcp_ng.backup.mode": "delta",
      "xcp_ng.backup.vm_count": "3",
      "xcp_ng.backup.failed_vm_count": "2",
      "xcp_ng.backup.failed_vms": "web-01, app-02",
    });
    expect(record["severityText"]).toBe("ERROR");
    expect(body(record)).toBe(
      "Backup job Nightly delta failed: 2 of 3 VMs failed. web-01: transfer: ENOSPC: no space left on device, write; app-02: VDI_IO_ERROR(Device I/O errors); db-01: unhealthy VDI chain",
    );
    // Dated by its arrival: the run ended over ten minutes before.
    expect(record["timeUnixNano"]).toBe(`${OBSERVED.getTime()}000000`);
  });

  test("a success, a skip and an interruption, in a sentence each", () => {
    expect(
      describeXcpNgBackupRun({
        jobName: "Nightly delta",
        summary: summary({
          status: XcpNgBackupStatus.Success,
          failedVmCount: 0,
          skippedVmCount: 0,
          problemVms: [],
          vmCount: 1,
        }),
      }),
    ).toBe("Backup job Nightly delta succeeded: 1 VM backed up.");
    expect(
      describeXcpNgBackupRun({
        jobName: "Nightly delta",
        summary: summary({
          status: XcpNgBackupStatus.Skipped,
          failedVmCount: 0,
          skippedVmCount: 2,
          problemVms: [],
        }),
      }),
    ).toBe("Backup job Nightly delta skipped 2 VMs.");
    expect(
      describeXcpNgBackupRun({
        jobName: "Weekly full",
        summary: summary({
          status: XcpNgBackupStatus.Interrupted,
          failedVmCount: 0,
          skippedVmCount: 0,
          problemVms: [],
          error: "Xen Orchestra restarted",
        }),
      }),
    ).toBe("Backup job Weekly full was interrupted. Xen Orchestra restarted");
    expect(
      buildXcpNgBackupLogRecord({
        jobId: "j",
        jobName: "j",
        summary: summary({ status: XcpNgBackupStatus.Skipped }),
        observedAt: OBSERVED,
      })["severityText"],
    ).toBe("WARN");
  });

  test("a run that failed before any VM: no VM count in the sentence", () => {
    expect(
      describeXcpNgBackupRun({
        jobName: "Pool metadata",
        summary: summary({
          vmCount: 0,
          failedVmCount: 0,
          skippedVmCount: 0,
          problemVms: [],
          error: "get remote adapter: ECONNREFUSED",
        }),
      }),
    ).toBe("Backup job Pool metadata failed. get remote adapter: ECONNREFUSED");
  });

  test("the failed VMs listed for an alert's name: five, then how many more", () => {
    const many: XcpNgPoolBackupRunSummary = summary({
      failedVmCount: 8,
      problemVms: Array.from({ length: 8 }).map(
        (_value: unknown, index: number) => {
          return {
            vmId: `vm-${index}`,
            vmName: `vm-${index}`,
            status: XcpNgBackupStatus.Failure,
          };
        },
      ),
    });
    expect(listXcpNgFailedVmNames(many)).toBe(
      "vm-0, vm-1, vm-2, vm-3, vm-4 (+3 more)",
    );
    expect(
      listXcpNgFailedVmNames(summary({ failedVmCount: 0, problemVms: [] })),
    ).toBe("");
  });

  test("the record that resolves a failure's alert carries that failure's group", () => {
    const record: JSONObject = buildXcpNgBackupResolvedLogRecord({
      open: {
        jobId: "job-a",
        jobName: "Nightly (renamed since)",
        failedVms: "web-01, app-02",
        failedAt: new Date(1794996300300).toISOString(),
      },
      summary: summary({
        runId: "1795082400000",
        status: XcpNgBackupStatus.Success,
        endedAt: new Date(OBSERVED.getTime() - 60000).toISOString(),
      }),
      observedAt: OBSERVED,
    });
    expect(attributes(record)).toEqual({
      "xcp_ng.event.kind": "backup",
      "xcp_ng.backup.job.id": "job-a",
      "xcp_ng.backup.job.name": "Nightly (renamed since)",
      "xcp_ng.backup.run.id": "1795082400000",
      "xcp_ng.backup.status": "success",
      "xcp_ng.backup.failed_vms": "web-01, app-02",
    });
    expect(body(record)).toBe(
      "Backup job Nightly (renamed since) succeeded again: web-01, app-02 backed up.",
    );
  });
});

describe("a pool's OTLP", () => {
  test("logs: one resource with the pool's UUID, name and Xen Orchestra", () => {
    const logs: JSONObject = buildXcpNgEventResourceLogs({
      resource: {
        poolIdentifier: POOL,
        reportedName: "Production",
        xenOrchestraName: "xo-paris",
      },
      records: [{ body: { stringValue: "x" } }],
    });
    expect(logs).toEqual({
      resource: {
        attributes: [
          { key: "xcp_ng.pool.id", value: { stringValue: POOL } },
          { key: "xcp_ng.pool.name", value: { stringValue: "Production" } },
          { key: "xen_orchestra.name", value: { stringValue: "xo-paris" } },
        ],
      },
      scopeLogs: [
        {
          scope: { name: XCP_NG_EVENTS_SCOPE_NAME },
          logRecords: [{ body: { stringValue: "x" } }],
        },
      ],
    });
    expect(
      (
        buildXcpNgEventResourceLogs({
          resource: { poolIdentifier: POOL },
          records: [],
        })["resource"] as JSONObject
      )["attributes"],
    ).toEqual([{ key: "xcp_ng.pool.id", value: { stringValue: POOL } }]);
  });

  test("metrics: HA, overdue backups and missing patches as gauges", () => {
    const at: Date = new Date(1795000060 * 1000);
    const metrics: JSONObject = buildXcpNgDerivedResourceMetrics({
      resource: { poolIdentifier: POOL },
      readings: {
        at: at,
        ha: {
          enabled: true,
          canTolerateHostFailure: false,
          hostFailuresToTolerate: 1,
          planExistsFor: 0,
        },
        vmBackups: [{ vmId: WEB_01, vmName: "web-01", overdue: true }],
        hostPatches: [{ hostId: "h1", hostName: "xcp-prod-01", count: 3 }],
      },
    }) as JSONObject;

    const scopeMetrics: JSONObject = (
      metrics["scopeMetrics"] as JSONArray
    )[0] as JSONObject;
    expect((scopeMetrics["scope"] as JSONObject)["name"]).toBe(
      XCP_NG_EVENTS_SCOPE_NAME,
    );
    const byName: Record<string, JSONObject> = {};
    for (const metric of scopeMetrics["metrics"] as JSONArray) {
      byName[String((metric as JSONObject)["name"])] = metric as JSONObject;
    }
    expect(Object.keys(byName).sort()).toEqual([
      "xcp_ng.host.missing_patches",
      "xcp_ng.pool.ha.can_tolerate_host_failure",
      "xcp_ng.pool.ha.enabled",
      "xcp_ng.pool.ha.host_failures_to_tolerate",
      "xcp_ng.pool.ha.plan_exists_for",
      "xcp_ng.vm.backup_overdue",
    ]);

    const point: (name: string) => JSONObject = (name: string): JSONObject => {
      return (
        ((byName[name] as JSONObject)["gauge"] as JSONObject)[
          "dataPoints"
        ] as JSONArray
      )[0] as JSONObject;
    };
    expect(point("xcp_ng.pool.ha.can_tolerate_host_failure")["asDouble"]).toBe(
      0,
    );
    expect(point("xcp_ng.pool.ha.enabled")["timeUnixNano"]).toBe(
      `${at.getTime()}000000`,
    );
    expect(attributes(point("xcp_ng.pool.ha.enabled"))).toEqual({
      "xcp_ng.scope": "pool",
      "xcp_ng.id": POOL,
    });
    expect(attributes(point("xcp_ng.vm.backup_overdue"))).toEqual({
      "xcp_ng.scope": "vm",
      "xcp_ng.id": WEB_01,
      uuid: WEB_01,
      vm_name: "web-01",
    });
    expect(point("xcp_ng.vm.backup_overdue")["asDouble"]).toBe(1);
    expect(attributes(point("xcp_ng.host.missing_patches"))).toEqual({
      "xcp_ng.scope": "host",
      "xcp_ng.id": "h1",
      uuid: "h1",
      host_name: "xcp-prod-01",
    });
    expect(point("xcp_ng.host.missing_patches")["asDouble"]).toBe(3);
  });

  test("HA off: only that it is off; nothing read: no metrics at all", () => {
    const off: JSONObject = buildXcpNgDerivedResourceMetrics({
      resource: { poolIdentifier: POOL },
      readings: {
        at: OBSERVED,
        ha: {
          enabled: false,
          canTolerateHostFailure: null,
          hostFailuresToTolerate: null,
          planExistsFor: null,
        },
        vmBackups: [],
        hostPatches: [],
      },
    }) as JSONObject;
    expect(
      (
        ((off["scopeMetrics"] as JSONArray)[0] as JSONObject)[
          "metrics"
        ] as JSONArray
      ).map((metric: unknown) => {
        return (metric as JSONObject)["name"];
      }),
    ).toEqual(["xcp_ng.pool.ha.enabled"]);

    expect(
      buildXcpNgDerivedResourceMetrics({
        resource: { poolIdentifier: POOL },
        readings: { at: OBSERVED, vmBackups: [], hostPatches: [] },
      }),
    ).toBeNull();
  });
});
