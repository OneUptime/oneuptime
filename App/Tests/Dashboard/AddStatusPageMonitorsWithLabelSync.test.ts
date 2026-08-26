import { describe, expect, test } from "@jest/globals";
import {
  AddStatusPageMonitorsWithLabelSyncResult,
  NormalizedSyncLabel,
  addStatusPageMonitorsWithLabelSync,
  buildMonitorRuleForLabelSync,
  buildMonitorRuleName,
  normalizeSyncLabels,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/AddStatusPageMonitorsWithLabelSync";
import type {
  BulkAddStatusPageMonitorsOptions,
  BulkAddStatusPageMonitorsResult,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/BulkAddStatusPageMonitors";
import Label from "Common/Models/DatabaseModels/Label";
import ColumnLength from "Common/Types/Database/ColumnLength";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import StatusPageMonitorRule from "Common/Models/DatabaseModels/StatusPageMonitorRule";
import ObjectID from "Common/Types/ObjectID";
import UptimePrecision from "Common/Types/StatusPage/UptimePrecision";

/*
 * Contract under test - what happens when someone fills a status page group
 * from a label.
 *
 * The monitor picker's "Bulk-add by tag" expands a label into the monitors
 * carrying it right now, creates an ordinary resource for each, and drops the
 * label. That is #3418: a monitor given the same label tomorrow lands on no
 * page, and with ten status pages and monitors added daily the label saved
 * nobody any work at all.
 *
 * A StatusPageMonitorRule is the durable form of the same intent - the server
 * re-runs it on every monitor create and relabel - so populating a group from
 * a label has to write one. This module is that decision, and it takes both
 * the bulk add and the rule create as seams, so every path below is drivable
 * without a renderer or a network.
 *
 * The two properties that matter most, and are easiest to lose in a refactor:
 *
 *   - the rule is written AFTER the resources. The server's backfill skips
 *     monitors already on the page, so this ordering is the only thing
 *     stopping every label-added monitor appearing on a public page twice.
 *
 *   - a rule that cannot be written never costs the caller the resources that
 *     were added successfully.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const GROUP_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const LABEL_A_ID: ObjectID = new ObjectID(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
);
const LABEL_B_ID: ObjectID = new ObjectID(
  "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
);
const MONITOR_A_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const MONITOR_B_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);

type MakeMonitorFunction = (id: ObjectID, name: string) => Monitor;

const makeMonitor: MakeMonitorFunction = (
  id: ObjectID,
  name: string,
): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor._id = id.toString();
  monitor.name = name;
  return monitor;
};

const MONITORS: Array<Monitor> = [
  makeMonitor(MONITOR_A_ID, "Mobile App - Payment"),
  makeMonitor(MONITOR_B_ID, "Mobile App - Order"),
];

interface Recorder {
  calls: Array<string>;
  bulkAddOptions: Array<BulkAddStatusPageMonitorsOptions>;
  rules: Array<StatusPageMonitorRule>;
}

interface Seams {
  recorder: Recorder;
  bulkAdd: (
    options: BulkAddStatusPageMonitorsOptions,
  ) => Promise<BulkAddStatusPageMonitorsResult>;
  createMonitorRule: (rule: StatusPageMonitorRule) => Promise<void>;
}

type MakeSeamsFunction = (behaviour?: {
  bulkAddResult?: BulkAddStatusPageMonitorsResult | undefined;
  bulkAddError?: Error | undefined;
  ruleError?: Error | undefined;
}) => Seams;

const makeSeams: MakeSeamsFunction = (behaviour?: {
  bulkAddResult?: BulkAddStatusPageMonitorsResult | undefined;
  bulkAddError?: Error | undefined;
  ruleError?: Error | undefined;
}): Seams => {
  const recorder: Recorder = {
    calls: [],
    bulkAddOptions: [],
    rules: [],
  };

  return {
    recorder: recorder,
    bulkAdd: async (
      options: BulkAddStatusPageMonitorsOptions,
    ): Promise<BulkAddStatusPageMonitorsResult> => {
      recorder.calls.push("bulkAdd");
      recorder.bulkAddOptions.push(options);

      if (behaviour?.bulkAddError) {
        throw behaviour.bulkAddError;
      }

      return (
        behaviour?.bulkAddResult || {
          succeeded: options.monitors,
          failed: [],
        }
      );
    },
    createMonitorRule: async (rule: StatusPageMonitorRule): Promise<void> => {
      recorder.calls.push("createMonitorRule");
      recorder.rules.push(rule);

      if (behaviour?.ruleError) {
        throw behaviour.ruleError;
      }
    },
  };
};

describe("normalizeSyncLabels", () => {
  test("returns nothing for a missing or empty list", () => {
    expect(normalizeSyncLabels(undefined)).toEqual([]);
    expect(normalizeSyncLabels([])).toEqual([]);
  });

  test("accepts a label id as a string", () => {
    const labels: Array<NormalizedSyncLabel> = normalizeSyncLabels([
      { id: LABEL_A_ID.toString(), name: "WB Digital" },
    ]);

    expect(labels).toHaveLength(1);
    expect(labels[0]!.id.toString()).toBe(LABEL_A_ID.toString());
    expect(labels[0]!.id).toBeInstanceOf(ObjectID);
    expect(labels[0]!.name).toBe("WB Digital");
  });

  test("accepts a label id as an ObjectID", () => {
    const labels: Array<NormalizedSyncLabel> = normalizeSyncLabels([
      { id: LABEL_A_ID },
    ]);

    expect(labels).toHaveLength(1);
    expect(labels[0]!.id.toString()).toBe(LABEL_A_ID.toString());
  });

  /*
   * The picker can be opened twice, and the same label picked both times. A
   * rule naming a label twice is a rule with a duplicate join row.
   */
  test("collapses a label picked more than once", () => {
    const labels: Array<NormalizedSyncLabel> = normalizeSyncLabels([
      { id: LABEL_A_ID, name: "WB Digital" },
      { id: LABEL_A_ID.toString(), name: "WB Digital" },
      { id: LABEL_B_ID, name: "WB Digital Service" },
    ]);

    expect(
      labels.map((label: NormalizedSyncLabel) => {
        return label.id.toString();
      }),
    ).toEqual([LABEL_A_ID.toString(), LABEL_B_ID.toString()]);
  });

  test("keeps the order the labels were picked in", () => {
    const labels: Array<NormalizedSyncLabel> = normalizeSyncLabels([
      { id: LABEL_B_ID },
      { id: LABEL_A_ID },
    ]);

    expect(
      labels.map((label: NormalizedSyncLabel) => {
        return label.id.toString();
      }),
    ).toEqual([LABEL_B_ID.toString(), LABEL_A_ID.toString()]);
  });

  test("drops blanks rather than building an empty label reference", () => {
    const labels: Array<NormalizedSyncLabel> = normalizeSyncLabels([
      { id: "" },
      { id: LABEL_A_ID },
      { id: undefined as unknown as string },
    ]);

    expect(labels).toHaveLength(1);
    expect(labels[0]!.id.toString()).toBe(LABEL_A_ID.toString());
  });

  test("tolerates a label the picker could not name", () => {
    const labels: Array<NormalizedSyncLabel> = normalizeSyncLabels([
      { id: LABEL_A_ID },
    ]);

    expect(labels[0]!.name).toBe("");
  });

  test("trims the name, which ends up in a column with a length limit", () => {
    const labels: Array<NormalizedSyncLabel> = normalizeSyncLabels([
      { id: LABEL_A_ID, name: "  WB Digital  " },
    ]);

    expect(labels[0]!.name).toBe("WB Digital");
  });
});

/*
 * name is a required, non-nullable column on StatusPageMonitorRule. A rule
 * built without one is refused by the server, and the only symptom the user
 * sees is that the group quietly stops being kept in sync - which is the
 * original bug all over again.
 */
describe("buildMonitorRuleName", () => {
  test("names the single label the monitors came from", () => {
    expect(buildMonitorRuleName([{ id: LABEL_A_ID, name: "WB Digital" }])).toBe(
      "Label: WB Digital",
    );
  });

  test("names every label when more than one was used", () => {
    expect(
      buildMonitorRuleName([
        { id: LABEL_A_ID, name: "WB Digital" },
        { id: LABEL_B_ID, name: "WB Digital Service" },
      ]),
    ).toBe("Labels: WB Digital, WB Digital Service");
  });

  test("falls back to something valid when no label could be named", () => {
    const name: string = buildMonitorRuleName([{ id: LABEL_A_ID, name: "" }]);

    expect(name).toBe("Monitors by label");
    expect(name.length).toBeGreaterThan(0);
  });

  test("skips the labels it has no name for rather than leaving a gap", () => {
    expect(
      buildMonitorRuleName([
        { id: LABEL_A_ID, name: "" },
        { id: LABEL_B_ID, name: "WB Digital Service" },
      ]),
    ).toBe("Label: WB Digital Service");
  });

  /*
   * A project with a dozen labels selected would otherwise build a name the
   * column cannot hold, and the create fails on length instead.
   */
  test("never exceeds the column the name is stored in", () => {
    const labels: Array<NormalizedSyncLabel> = Array.from(
      { length: 20 },
      (_unused: unknown, index: number): NormalizedSyncLabel => {
        return {
          id: LABEL_A_ID,
          name: `A very long label name number ${index}`,
        };
      },
    );

    const name: string = buildMonitorRuleName(labels);

    expect(name.length).toBeLessThanOrEqual(ColumnLength.ShortText);
    expect(name.endsWith("\u2026")).toBe(true);
  });

  test("leaves a name that already fits exactly as it is", () => {
    const name: string = buildMonitorRuleName([
      { id: LABEL_A_ID, name: "Production" },
    ]);

    expect(name).toBe("Label: Production");
    expect(name).not.toContain("\u2026");
  });
});

describe("buildMonitorRuleForLabelSync", () => {
  /*
   * The server refuses a rule with no criteria rather than reading it as
   * "every monitor in the project", which on a public page is the one mistake
   * worth being loud about. There is nothing to ask it for here.
   */
  test("writes no rule when no label was used", () => {
    expect(
      buildMonitorRuleForLabelSync({
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        labels: [],
      }),
    ).toBeNull();
  });

  test("names the project and the status page it belongs to", () => {
    const rule: StatusPageMonitorRule | null = buildMonitorRuleForLabelSync({
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      labels: [{ id: LABEL_A_ID, name: "WB Digital" }],
    });

    expect(rule?.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(rule?.statusPageId?.toString()).toBe(STATUS_PAGE_ID.toString());
  });

  /*
   * The whole complaint is that a monitor does not land in the group it should
   * land in. A rule that forgot the group would put every future monitor at
   * the top of the page instead.
   */
  test("puts the rule in the group the monitors were added to", () => {
    const rule: StatusPageMonitorRule | null = buildMonitorRuleForLabelSync({
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      statusPageGroupId: GROUP_ID,
      labels: [{ id: LABEL_A_ID, name: "WB Digital" }],
    });

    expect(rule?.statusPageGroupId?.toString()).toBe(GROUP_ID.toString());
  });

  test("leaves the group unset when the monitors were added ungrouped", () => {
    const rule: StatusPageMonitorRule | null = buildMonitorRuleForLabelSync({
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      labels: [{ id: LABEL_A_ID, name: "WB Digital" }],
    });

    expect(rule?.statusPageGroupId).toBeUndefined();
  });

  test("is enabled, or it would match nothing the moment it is written", () => {
    const rule: StatusPageMonitorRule | null = buildMonitorRuleForLabelSync({
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      labels: [{ id: LABEL_A_ID, name: "WB Digital" }],
    });

    expect(rule?.isEnabled).toBe(true);
  });

  test("carries every label that was used", () => {
    const rule: StatusPageMonitorRule | null = buildMonitorRuleForLabelSync({
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      labels: [
        { id: LABEL_A_ID, name: "WB Digital" },
        { id: LABEL_B_ID, name: "WB Digital Service" },
      ],
    });

    expect(
      (rule?.monitorLabels || []).map((label: Label) => {
        return label.id?.toString();
      }),
    ).toEqual([LABEL_A_ID.toString(), LABEL_B_ID.toString()]);
  });

  /*
   * A monitor the rule adds next week has to look like the ones added today,
   * or the group ends up with two visual styles and no explanation for it.
   */
  test("copies the display options the resources were created with", () => {
    const rule: StatusPageMonitorRule | null = buildMonitorRuleForLabelSync({
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      labels: [{ id: LABEL_A_ID, name: "WB Digital" }],
      resourceOptions: {
        showCurrentStatus: false,
        showUptimePercent: true,
        uptimePercentPrecision: UptimePrecision.THREE_DECIMAL,
        showStatusHistoryChart: false,
      },
    });

    expect(rule?.showCurrentStatus).toBe(false);
    expect(rule?.showUptimePercent).toBe(true);
    expect(rule?.uptimePercentPrecision).toBe(UptimePrecision.THREE_DECIMAL);
    expect(rule?.showStatusHistoryChart).toBe(false);
  });

  /*
   * Leaving a column unset lets the model's own default stand. Writing
   * `undefined` explicitly would be the same thing here, but writing `false`
   * because the value was missing would not.
   */
  test("leaves display options the caller did not set alone", () => {
    const rule: StatusPageMonitorRule | null = buildMonitorRuleForLabelSync({
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      labels: [{ id: LABEL_A_ID, name: "WB Digital" }],
    });

    expect(rule?.showCurrentStatus).toBeUndefined();
    expect(rule?.showUptimePercent).toBeUndefined();
    expect(rule?.uptimePercentPrecision).toBeUndefined();
    expect(rule?.showStatusHistoryChart).toBeUndefined();
  });

  /*
   * The precision dropdown is only asked for when uptime is shown, so it
   * arrives empty the rest of the time.
   */
  test("omits the uptime precision when the resources carry none", () => {
    const rule: StatusPageMonitorRule | null = buildMonitorRuleForLabelSync({
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      labels: [{ id: LABEL_A_ID, name: "WB Digital" }],
      resourceOptions: {
        showUptimePercent: false,
      },
    });

    expect(rule?.showUptimePercent).toBe(false);
    expect(rule?.uptimePercentPrecision).toBeUndefined();
  });

  /*
   * A tooltip is per-resource prose. There is no column on the rule for it,
   * and inventing one would put the same sentence under every future monitor.
   */
  test("does not try to carry the per-resource tooltip", () => {
    const rule: StatusPageMonitorRule | null = buildMonitorRuleForLabelSync({
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      labels: [{ id: LABEL_A_ID, name: "WB Digital" }],
      resourceOptions: {
        displayTooltip: "Checkout path",
      },
    });

    expect(
      (rule as unknown as Record<string, unknown>)["displayTooltip"],
    ).toBeUndefined();
  });

  /*
   * The one that bit this change in review: name is required and non-nullable,
   * so a rule built without it never reaches the database at all.
   */
  test("carries a name, which the column requires", () => {
    const rule: StatusPageMonitorRule | null = buildMonitorRuleForLabelSync({
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      labels: [{ id: LABEL_A_ID, name: "WB Digital" }],
    });

    expect(rule?.name).toBe("Label: WB Digital");
    expect((rule?.name || "").length).toBeLessThanOrEqual(
      ColumnLength.ShortText,
    );
  });

  test("still carries a name when the label could not be named", () => {
    const rule: StatusPageMonitorRule | null = buildMonitorRuleForLabelSync({
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      labels: [{ id: LABEL_A_ID, name: "" }],
    });

    expect(rule?.name).toBeTruthy();
  });

  /*
   * These rules appear in Status Page > Monitor Rules beside hand-written
   * ones, so they say where they came from.
   */
  test("says where it came from", () => {
    const rule: StatusPageMonitorRule | null = buildMonitorRuleForLabelSync({
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      labels: [{ id: LABEL_A_ID, name: "WB Digital" }],
    });

    expect(rule?.description).toContain("Resources");
  });

  test("matches on labels only - it must not also pin the monitor names", () => {
    const rule: StatusPageMonitorRule | null = buildMonitorRuleForLabelSync({
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      labels: [{ id: LABEL_A_ID, name: "WB Digital" }],
    });

    expect(rule?.monitorNamePattern).toBeUndefined();
    expect(rule?.monitorDescriptionPattern).toBeUndefined();
  });
});

describe("addStatusPageMonitorsWithLabelSync - adding the monitors", () => {
  test("adds every monitor it was given", async () => {
    const seams: Seams = makeSeams();

    const result: AddStatusPageMonitorsWithLabelSyncResult =
      await addStatusPageMonitorsWithLabelSync({
        monitors: MONITORS,
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        bulkAdd: seams.bulkAdd,
        createMonitorRule: seams.createMonitorRule,
      });

    expect(seams.recorder.bulkAddOptions[0]!.monitors).toEqual(MONITORS);
    expect(result.succeeded).toEqual(MONITORS);
    expect(result.failed).toEqual([]);
  });

  test("passes the placement and display options straight through", async () => {
    const seams: Seams = makeSeams();

    await addStatusPageMonitorsWithLabelSync({
      monitors: MONITORS,
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      statusPageGroupId: GROUP_ID,
      rowAxisValue: "Region 1",
      columnAxisValue: "Tier 1",
      resourceOptions: {
        displayTooltip: "Checkout path",
        showCurrentStatus: true,
        showUptimePercent: true,
        uptimePercentPrecision: UptimePrecision.TWO_DECIMAL,
        showStatusHistoryChart: false,
      },
      bulkAdd: seams.bulkAdd,
      createMonitorRule: seams.createMonitorRule,
    });

    const options: BulkAddStatusPageMonitorsOptions =
      seams.recorder.bulkAddOptions[0]!;

    expect(options.projectId).toBe(PROJECT_ID);
    expect(options.statusPageId).toBe(STATUS_PAGE_ID);
    expect(options.statusPageGroupId).toBe(GROUP_ID);
    expect(options.rowAxisValue).toBe("Region 1");
    expect(options.columnAxisValue).toBe("Tier 1");
    expect(options.resourceOptions?.displayTooltip).toBe("Checkout path");
    expect(options.resourceOptions?.uptimePercentPrecision).toBe(
      UptimePrecision.TWO_DECIMAL,
    );
    expect(options.resourceOptions?.showStatusHistoryChart).toBe(false);
  });

  test("reports the per-monitor failures the bulk add reported", async () => {
    const failure: { monitor: Monitor; error: unknown } = {
      monitor: MONITORS[1]!,
      error: new Error("nope"),
    };

    const seams: Seams = makeSeams({
      bulkAddResult: {
        succeeded: [MONITORS[0]!],
        failed: [failure],
      },
    });

    const result: AddStatusPageMonitorsWithLabelSyncResult =
      await addStatusPageMonitorsWithLabelSync({
        monitors: MONITORS,
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        bulkAdd: seams.bulkAdd,
        createMonitorRule: seams.createMonitorRule,
      });

    expect(result.succeeded).toEqual([MONITORS[0]]);
    expect(result.failed).toEqual([failure]);
  });

  /*
   * A bulk add that fell over outright is the caller's error to show. Writing
   * a rule on top of it would leave a status page configured by a request the
   * user was told had failed.
   */
  test("does not write a rule when the bulk add itself throws", async () => {
    const seams: Seams = makeSeams({ bulkAddError: new Error("api down") });

    await expect(
      addStatusPageMonitorsWithLabelSync({
        monitors: MONITORS,
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        syncLabels: [{ id: LABEL_A_ID, name: "WB Digital" }],
        keepInSyncWithLabels: true,
        bulkAdd: seams.bulkAdd,
        createMonitorRule: seams.createMonitorRule,
      }),
    ).rejects.toThrow("api down");

    expect(seams.recorder.calls).toEqual(["bulkAdd"]);
  });
});

describe("addStatusPageMonitorsWithLabelSync - keeping the labels live", () => {
  /*
   * This is #3418. Before the fix the label was expanded once and forgotten,
   * so a monitor given that label the next day landed on no page at all.
   */
  test("writes a rule for the labels the selection came from", async () => {
    const seams: Seams = makeSeams();

    const result: AddStatusPageMonitorsWithLabelSyncResult =
      await addStatusPageMonitorsWithLabelSync({
        monitors: MONITORS,
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        statusPageGroupId: GROUP_ID,
        syncLabels: [{ id: LABEL_A_ID, name: "WB Digital" }],
        keepInSyncWithLabels: true,
        bulkAdd: seams.bulkAdd,
        createMonitorRule: seams.createMonitorRule,
      });

    expect(seams.recorder.rules).toHaveLength(1);

    const rule: StatusPageMonitorRule = seams.recorder.rules[0]!;

    expect(rule.statusPageId?.toString()).toBe(STATUS_PAGE_ID.toString());
    expect(rule.statusPageGroupId?.toString()).toBe(GROUP_ID.toString());
    expect(
      (rule.monitorLabels || []).map((label: Label) => {
        return label.id?.toString();
      }),
    ).toEqual([LABEL_A_ID.toString()]);
    expect(result.monitorRule).toBe(rule);
    expect(result.monitorRuleError).toBeNull();
  });

  /*
   * Every column the model marks required has to be on the rule before it is
   * handed to the API, or the create is rejected and the sync silently never
   * happens.
   */
  test("hands over a rule with every required column filled in", async () => {
    const seams: Seams = makeSeams();

    await addStatusPageMonitorsWithLabelSync({
      monitors: MONITORS,
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      syncLabels: [{ id: LABEL_A_ID, name: "WB Digital" }],
      keepInSyncWithLabels: true,
      bulkAdd: seams.bulkAdd,
      createMonitorRule: seams.createMonitorRule,
    });

    const rule: StatusPageMonitorRule = seams.recorder.rules[0]!;

    for (const column of rule.getRequiredColumns().columns) {
      expect({
        column: column,
        value: (rule as unknown as Record<string, unknown>)[column],
      }).toEqual({
        column: column,
        value: expect.anything(),
      });
    }
  });

  /*
   * The ordering guarantee. The server's backfill adds every matching monitor
   * that is not already on the page - so the rule has to run second, or the
   * monitors this add just created get a second resource each and every
   * visitor sees the group twice over.
   */
  test("writes the rule only after the resources exist", async () => {
    const seams: Seams = makeSeams();

    await addStatusPageMonitorsWithLabelSync({
      monitors: MONITORS,
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      syncLabels: [{ id: LABEL_A_ID, name: "WB Digital" }],
      keepInSyncWithLabels: true,
      bulkAdd: seams.bulkAdd,
      createMonitorRule: seams.createMonitorRule,
    });

    expect(seams.recorder.calls).toEqual(["bulkAdd", "createMonitorRule"]);
  });

  test("writes exactly one rule however many labels were used", async () => {
    const seams: Seams = makeSeams();

    await addStatusPageMonitorsWithLabelSync({
      monitors: MONITORS,
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      syncLabels: [
        { id: LABEL_A_ID, name: "WB Digital" },
        { id: LABEL_B_ID, name: "WB Digital Service" },
      ],
      keepInSyncWithLabels: true,
      bulkAdd: seams.bulkAdd,
      createMonitorRule: seams.createMonitorRule,
    });

    expect(seams.recorder.rules).toHaveLength(1);
    expect(seams.recorder.rules[0]!.monitorLabels).toHaveLength(2);
  });

  test("collapses a label the picker was used with twice", async () => {
    const seams: Seams = makeSeams();

    await addStatusPageMonitorsWithLabelSync({
      monitors: MONITORS,
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      syncLabels: [
        { id: LABEL_A_ID, name: "WB Digital" },
        { id: LABEL_A_ID.toString(), name: "WB Digital" },
      ],
      keepInSyncWithLabels: true,
      bulkAdd: seams.bulkAdd,
      createMonitorRule: seams.createMonitorRule,
    });

    expect(seams.recorder.rules[0]!.monitorLabels).toHaveLength(1);
  });

  /*
   * Someone who pruned the expanded list by hand is saying they want these
   * monitors and not the label. Turning the toggle off has to mean the old
   * behaviour exactly.
   */
  test("writes no rule when the user turned the sync off", async () => {
    const seams: Seams = makeSeams();

    const result: AddStatusPageMonitorsWithLabelSyncResult =
      await addStatusPageMonitorsWithLabelSync({
        monitors: MONITORS,
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        syncLabels: [{ id: LABEL_A_ID, name: "WB Digital" }],
        keepInSyncWithLabels: false,
        bulkAdd: seams.bulkAdd,
        createMonitorRule: seams.createMonitorRule,
      });

    expect(seams.recorder.calls).toEqual(["bulkAdd"]);
    expect(result.monitorRule).toBeNull();
    expect(result.monitorRuleError).toBeNull();
    expect(result.succeeded).toEqual(MONITORS);
  });

  test("writes no rule when the monitors were picked one at a time", async () => {
    const seams: Seams = makeSeams();

    const result: AddStatusPageMonitorsWithLabelSyncResult =
      await addStatusPageMonitorsWithLabelSync({
        monitors: MONITORS,
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        keepInSyncWithLabels: true,
        bulkAdd: seams.bulkAdd,
        createMonitorRule: seams.createMonitorRule,
      });

    expect(seams.recorder.calls).toEqual(["bulkAdd"]);
    expect(result.monitorRule).toBeNull();
  });

  test("writes no rule for a label list that is all blanks", async () => {
    const seams: Seams = makeSeams();

    await addStatusPageMonitorsWithLabelSync({
      monitors: MONITORS,
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      syncLabels: [{ id: "" }, { id: "" }],
      keepInSyncWithLabels: true,
      bulkAdd: seams.bulkAdd,
      createMonitorRule: seams.createMonitorRule,
    });

    expect(seams.recorder.calls).toEqual(["bulkAdd"]);
  });

  /*
   * Creating a rule needs a permission that adding a resource does not, so a
   * status page member can hit this. Throwing here would report the whole add
   * as failed when every resource was created.
   */
  test("keeps the resources when the rule cannot be written", async () => {
    const ruleError: Error = new Error("no permission to create rules");
    const seams: Seams = makeSeams({ ruleError: ruleError });

    const result: AddStatusPageMonitorsWithLabelSyncResult =
      await addStatusPageMonitorsWithLabelSync({
        monitors: MONITORS,
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        syncLabels: [{ id: LABEL_A_ID, name: "WB Digital" }],
        keepInSyncWithLabels: true,
        bulkAdd: seams.bulkAdd,
        createMonitorRule: seams.createMonitorRule,
      });

    expect(result.succeeded).toEqual(MONITORS);
    expect(result.monitorRuleError).toBe(ruleError);
  });

  /*
   * The failure message names what could not be kept in sync, so the rule it
   * tried to write has to survive the failure.
   */
  test("still reports the rule it was trying to write", async () => {
    const seams: Seams = makeSeams({ ruleError: new Error("nope") });

    const result: AddStatusPageMonitorsWithLabelSyncResult =
      await addStatusPageMonitorsWithLabelSync({
        monitors: MONITORS,
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        syncLabels: [{ id: LABEL_A_ID, name: "WB Digital" }],
        keepInSyncWithLabels: true,
        bulkAdd: seams.bulkAdd,
        createMonitorRule: seams.createMonitorRule,
      });

    expect(
      (result.monitorRule?.monitorLabels || []).map((label: Label) => {
        return label.id?.toString();
      }),
    ).toEqual([LABEL_A_ID.toString()]);
  });

  /*
   * Every monitor carrying the label may already be on the page, which the
   * picker reports as nothing new to add. The label still has to become a rule
   * - that is the only reason the user opened this dialog.
   */
  test("writes the rule even when the bulk add added nothing", async () => {
    const seams: Seams = makeSeams({
      bulkAddResult: { succeeded: [], failed: [] },
    });

    const result: AddStatusPageMonitorsWithLabelSyncResult =
      await addStatusPageMonitorsWithLabelSync({
        monitors: [],
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        syncLabels: [{ id: LABEL_A_ID, name: "WB Digital" }],
        keepInSyncWithLabels: true,
        bulkAdd: seams.bulkAdd,
        createMonitorRule: seams.createMonitorRule,
      });

    expect(seams.recorder.rules).toHaveLength(1);
    expect(result.monitorRule).not.toBeNull();
  });

  /*
   * A group drawn as a grid places every resource in a row/column cell, and
   * the public page skips a resource in such a group that has neither. A rule
   * has nowhere to record the cell, so every monitor it added later would be
   * on the page and rendered nowhere. Refusing the rule keeps the promise the
   * toggle makes honest - and the toggle is not offered there either.
   */
  test("writes no rule for a grid group, whose placement it cannot record", async () => {
    const seams: Seams = makeSeams();

    const result: AddStatusPageMonitorsWithLabelSyncResult =
      await addStatusPageMonitorsWithLabelSync({
        monitors: MONITORS,
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        statusPageGroupId: GROUP_ID,
        rowAxisValue: "Region 1",
        columnAxisValue: "Tier 1",
        syncLabels: [{ id: LABEL_A_ID, name: "WB Digital" }],
        keepInSyncWithLabels: true,
        bulkAdd: seams.bulkAdd,
        createMonitorRule: seams.createMonitorRule,
      });

    expect(seams.recorder.calls).toEqual(["bulkAdd"]);
    expect(result.monitorRule).toBeNull();
    expect(result.succeeded).toEqual(MONITORS);
  });

  test("writes no rule when only the row of a grid cell is known", async () => {
    const seams: Seams = makeSeams();

    await addStatusPageMonitorsWithLabelSync({
      monitors: MONITORS,
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      rowAxisValue: "Region 1",
      syncLabels: [{ id: LABEL_A_ID, name: "WB Digital" }],
      keepInSyncWithLabels: true,
      bulkAdd: seams.bulkAdd,
      createMonitorRule: seams.createMonitorRule,
    });

    expect(seams.recorder.calls).toEqual(["bulkAdd"]);
  });

  test("writes no rule when only the column of a grid cell is known", async () => {
    const seams: Seams = makeSeams();

    await addStatusPageMonitorsWithLabelSync({
      monitors: MONITORS,
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      columnAxisValue: "Tier 1",
      syncLabels: [{ id: LABEL_A_ID, name: "WB Digital" }],
      keepInSyncWithLabels: true,
      bulkAdd: seams.bulkAdd,
      createMonitorRule: seams.createMonitorRule,
    });

    expect(seams.recorder.calls).toEqual(["bulkAdd"]);
  });

  /*
   * The grid group still gets its resources - refusing the rule must not
   * refuse the add the user actually asked for.
   */
  test("still places the resources in the grid cell it was given", async () => {
    const seams: Seams = makeSeams();

    await addStatusPageMonitorsWithLabelSync({
      monitors: MONITORS,
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      rowAxisValue: "Region 1",
      columnAxisValue: "Tier 1",
      syncLabels: [{ id: LABEL_A_ID, name: "WB Digital" }],
      keepInSyncWithLabels: true,
      bulkAdd: seams.bulkAdd,
      createMonitorRule: seams.createMonitorRule,
    });

    expect(seams.recorder.bulkAddOptions[0]!.rowAxisValue).toBe("Region 1");
    expect(seams.recorder.bulkAddOptions[0]!.columnAxisValue).toBe("Tier 1");
  });

  test("gives the rule the same display options as the resources", async () => {
    const seams: Seams = makeSeams();

    await addStatusPageMonitorsWithLabelSync({
      monitors: MONITORS,
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      resourceOptions: {
        showCurrentStatus: false,
        showUptimePercent: true,
        uptimePercentPrecision: UptimePrecision.ONE_DECIMAL,
        showStatusHistoryChart: true,
      },
      syncLabels: [{ id: LABEL_A_ID, name: "WB Digital" }],
      keepInSyncWithLabels: true,
      bulkAdd: seams.bulkAdd,
      createMonitorRule: seams.createMonitorRule,
    });

    const rule: StatusPageMonitorRule = seams.recorder.rules[0]!;

    expect(rule.showCurrentStatus).toBe(false);
    expect(rule.showUptimePercent).toBe(true);
    expect(rule.uptimePercentPrecision).toBe(UptimePrecision.ONE_DECIMAL);
    expect(rule.showStatusHistoryChart).toBe(true);
  });
});
