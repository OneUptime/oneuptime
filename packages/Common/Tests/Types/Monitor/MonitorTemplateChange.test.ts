import BadDataException from "../../../Types/Exception/BadDataException";
import {
  MAX_MONITORS_PER_TEMPLATE_CHANGE,
  MonitorTemplateChangeKind,
  MonitorTemplateChangeOutcome,
  MonitorTemplateChangeResults,
  MonitorTemplateChangeStatus,
  assertMonitorTemplateChangeSettings,
  emptyMonitorTemplateChangeProgress,
  getRetryableMonitorIds,
  isMonitorTemplateChangeActive,
  readMonitorTemplateChangeMonitorIds,
  readMonitorTemplateChangeProgress,
  readMonitorTemplateChangeResults,
  readMonitorTemplateChangeSettings,
} from "../../../Types/Monitor/MonitorTemplateChange";
import { describe, expect, it } from "@jest/globals";

/*
 * THE SHAPES A CHANGE OF MANY MONITORS' TEMPLATE IS KEPT IN (issues #11260,
 * #11266), read back whatever a row holds: the server writes them, the
 * worker reads them after a restart, and the Dashboard draws them.
 */

describe("a change's settings", () => {
  it("read back as written", () => {
    expect(
      readMonitorTemplateChangeSettings({
        kind: MonitorTemplateChangeKind.Unlink,
        applyTemplateSettings: false,
        clearTemplateSettings: true,
        deleteTemplateWhenDone: true,
      }),
    ).toEqual({
      kind: MonitorTemplateChangeKind.Unlink,
      applyTemplateSettings: false,
      clearTemplateSettings: true,
      deleteTemplateWhenDone: true,
    });
  });

  it("read anything that is not a yes as no, and anything that is not Unlink as Link", () => {
    expect(
      readMonitorTemplateChangeSettings({
        kind: "rename",
        applyTemplateSettings: "true",
        clearTemplateSettings: 1,
      }),
    ).toEqual({
      kind: MonitorTemplateChangeKind.Link,
      applyTemplateSettings: false,
      clearTemplateSettings: false,
      deleteTemplateWhenDone: false,
    });
    expect(readMonitorTemplateChangeSettings(null).kind).toBe(
      MonitorTemplateChangeKind.Link,
    );
  });

  it("a link needs a template; only an unlink of a template's monitors deletes it", () => {
    expect(() => {
      assertMonitorTemplateChangeSettings({
        settings: readMonitorTemplateChangeSettings({
          kind: MonitorTemplateChangeKind.Link,
        }),
        hasTemplate: false,
      });
    }).toThrow(BadDataException);

    expect(() => {
      assertMonitorTemplateChangeSettings({
        settings: readMonitorTemplateChangeSettings({
          kind: MonitorTemplateChangeKind.Link,
          deleteTemplateWhenDone: true,
        }),
        hasTemplate: true,
      });
    }).toThrow(
      "Only a change that unlinks a template's monitors can delete the template when it is done.",
    );

    expect(() => {
      assertMonitorTemplateChangeSettings({
        settings: readMonitorTemplateChangeSettings({
          kind: MonitorTemplateChangeKind.Unlink,
          deleteTemplateWhenDone: true,
        }),
        hasTemplate: false,
      });
    }).toThrow(BadDataException);

    // An unlink from the Monitors list names no template, and that is fine.
    expect(() => {
      assertMonitorTemplateChangeSettings({
        settings: readMonitorTemplateChangeSettings({
          kind: MonitorTemplateChangeKind.Unlink,
        }),
        hasTemplate: false,
      });
    }).not.toThrow();
  });
});

describe("a change's results", () => {
  it("keep only the lines worth one, with a known outcome and a monitor", () => {
    const results: MonitorTemplateChangeResults =
      readMonitorTemplateChangeResults({
        processedCount: 4,
        lines: [
          {
            monitorId: "m1",
            monitorName: "core-sw-01",
            outcome: MonitorTemplateChangeOutcome.Skipped,
            reason: "Another type.",
          },
          { monitorId: "m2", outcome: MonitorTemplateChangeOutcome.Failed },
          { monitorId: "m3", outcome: MonitorTemplateChangeOutcome.Changed },
          { outcome: MonitorTemplateChangeOutcome.Failed, reason: "no id" },
          "garbage",
          null,
        ],
        isTemplateDeleted: true,
      });

    expect(results.processedCount).toBe(4);
    expect(results.lines).toEqual([
      {
        monitorId: "m1",
        monitorName: "core-sw-01",
        outcome: MonitorTemplateChangeOutcome.Skipped,
        reason: "Another type.",
      },
      {
        monitorId: "m2",
        outcome: MonitorTemplateChangeOutcome.Failed,
        reason: "",
      },
    ]);
    expect(results.isTemplateDeleted).toBe(true);
  });

  it("say why a template was kept, as a count or the refusal", () => {
    expect(
      readMonitorTemplateChangeResults({
        processedCount: 2,
        lines: [],
        templateStillLinkedCount: 3,
        templateDeleteError: "Warehouse switches is used by 1 rule.",
      }),
    ).toEqual({
      processedCount: 2,
      lines: [],
      templateStillLinkedCount: 3,
      templateDeleteError: "Warehouse switches is used by 1 rule.",
    });
  });

  it("read nothing from what is not a record of results", () => {
    expect(readMonitorTemplateChangeResults(undefined)).toEqual({
      processedCount: 0,
      lines: [],
    });
    expect(readMonitorTemplateChangeResults([1, 2])).toEqual({
      processedCount: 0,
      lines: [],
    });
  });

  it("retry the monitors that failed or were not reached, each once, in order", () => {
    expect(
      getRetryableMonitorIds({
        processedCount: 5,
        lines: [
          {
            monitorId: "a",
            outcome: MonitorTemplateChangeOutcome.Failed,
            reason: "",
          },
          {
            monitorId: "b",
            outcome: MonitorTemplateChangeOutcome.Skipped,
            reason: "",
          },
          {
            monitorId: "c",
            outcome: MonitorTemplateChangeOutcome.NotReached,
            reason: "",
          },
          {
            monitorId: "A",
            outcome: MonitorTemplateChangeOutcome.NotReached,
            reason: "",
          },
        ],
      }),
    ).toEqual(["a", "c"]);
  });
});

describe("a change's progress and monitors", () => {
  it("count from zero, and read every count back as a whole number", () => {
    expect(emptyMonitorTemplateChangeProgress(851)).toEqual({
      total: 851,
      processed: 0,
      changed: 0,
      unchanged: 0,
      skipped: 0,
      failed: 0,
      notReached: 0,
      resolvedIncidents: 0,
      resolvedAlerts: 0,
    });

    expect(
      readMonitorTemplateChangeProgress({
        total: "851",
        processed: 12.7,
        changed: -3,
        failed: "x",
      }),
    ).toEqual({
      ...emptyMonitorTemplateChangeProgress(851),
      processed: 12,
    });
  });

  it("read the monitors asked for as strings, in order", () => {
    expect(
      readMonitorTemplateChangeMonitorIds(["a", 7, "", "b", null]),
    ).toEqual(["a", "b"]);
    expect(readMonitorTemplateChangeMonitorIds("a")).toEqual([]);
  });

  it("a change takes as many monitors as a list selects", () => {
    expect(MAX_MONITORS_PER_TEMPLATE_CHANGE).toBe(10000);
  });

  it("is active while Queued or Running", () => {
    expect(
      isMonitorTemplateChangeActive(MonitorTemplateChangeStatus.Queued),
    ).toBe(true);
    expect(
      isMonitorTemplateChangeActive(MonitorTemplateChangeStatus.Running),
    ).toBe(true);

    for (const status of [
      MonitorTemplateChangeStatus.Completed,
      MonitorTemplateChangeStatus.Stopped,
      MonitorTemplateChangeStatus.Failed,
      undefined,
      "Paused",
    ]) {
      expect(isMonitorTemplateChangeActive(status)).toBe(false);
    }
  });
});
