import fs from "fs";
import path from "path";
import {
  MONITOR_STEPS_API_KEYS_FILE,
  MONITOR_STEPS_IDENTITY_CASES_FILE,
  MONITOR_STEPS_SYNC_FIELDS_GO_FILE,
  MonitorStepsApiKeys,
  buildMonitorStepsApiKeys,
  buildMonitorStepsIdentityCases,
  getDoNotSyncFieldValues,
  matchesFor,
  monitorStepsApiKeysFile,
  monitorStepsIdentityCasesFile,
  monitorStepsSyncFieldsGoFile,
} from "../Core/MonitorStepsApiKeys";
import { JSONObject } from "Common/Types/JSON";
import MonitorTemplateSyncFieldUtil from "Common/Types/Monitor/MonitorTemplateSyncField";
import MonitorType from "Common/Types/Monitor/MonitorType";

/*
 * What the generator writes for the provider's monitor_steps so that it
 * never removes a setting it cannot write (OneUptime/oneuptime#10984): every
 * key OneUptime's API schema holds, how the server matches an item sent
 * without an id, and the fields a template's step can keep when it syncs.
 * The provider's Go test (monitorstepsunmanaged_test.go) reads them.
 */

const STATIC_FILES: string = path.join(__dirname, "..", "StaticFiles");

const unmanagedGo: string = fs.readFileSync(
  path.join(STATIC_FILES, "monitorstepsunmanaged.go"),
  "utf-8",
);
const unmanagedGoTest: string = fs.readFileSync(
  path.join(STATIC_FILES, "monitorstepsunmanaged_test.go"),
  "utf-8",
);
const generator: string = fs.readFileSync(
  path.join(__dirname, "..", "Core", "ResourceGenerator.ts"),
  "utf-8",
);

describe("every key OneUptime's API schema holds", () => {
  const keys: MonitorStepsApiKeys = buildMonitorStepsApiKeys();

  test("is listed for each level the provider writes", () => {
    expect(Object.keys(keys.levels).sort()).toEqual(
      [
        "alert",
        "criteria",
        "filter",
        "incident",
        "incidentMemberRole",
        "serverMonitorOptions",
        "step",
        "steps",
        "window",
      ].sort(),
    );

    for (const level of Object.keys(keys.levels)) {
      expect(keys.levels[level]!.length).toBeGreaterThan(0);
      expect([...keys.levels[level]!].sort()).toEqual(keys.levels[level]);
    }
  });

  test("holds the keys #10984 found the provider had no attribute for", () => {
    expect(keys.levels["step"]).toEqual(
      expect.arrayContaining([
        "doNotSyncFields",
        "securityEventsMonitor",
        "snmpMonitor",
        "id",
      ]),
    );
    expect(keys.levels["incident"]).toEqual(
      expect.arrayContaining(["incidentMemberRoles", "id"]),
    );
    expect(keys.levels["incidentMemberRole"]).toEqual(["roleId", "userId"]);
  });

  test("leaves out what a step only carries to a probe, and what the server fills in while it evaluates", () => {
    expect(keys.levels["step"]).not.toContain("totpSecrets");
    expect(keys.levels["step"]).not.toContain("secretValuesToHide");
    expect(keys.levels["filter"]).not.toContain("metricCriteriaContext");
  });

  test("reads every level of the steps the API takes", () => {
    expect(keys.levels["steps"]).toEqual([
      "defaultMonitorStatusId",
      "monitorStepsInstanceArray",
    ]);
    expect(keys.levels["criteria"]).toEqual(
      expect.arrayContaining(["filters", "incidents", "alerts", "name"]),
    );
    expect(keys.levels["window"]).toEqual(
      expect.arrayContaining(["evaluateOverTimeType", "changeValue"]),
    );
    expect(keys.levels["serverMonitorOptions"]).toEqual(["diskPath"]);
  });

  test("every key the provider decides to keep without an attribute is one of them", () => {
    const decided: Array<[string, string]> = [];
    const decisions: RegExp =
      /"(steps|step|criteria|incident|alert)": \{([^}]*)\}/g;

    for (const match of unmanagedGo.matchAll(decisions)) {
      for (const key of match[2]!.matchAll(/"([A-Za-z]+)":/g)) {
        decided.push([match[1]!, key[1]!]);
      }
    }

    expect(decided.length).toBeGreaterThanOrEqual(6);

    for (const [level, key] of decided) {
      expect(keys.levels[level]).toContain(key);
    }
  });
});

describe("how the server matches an item sent without an id", () => {
  const stored: Array<{ id: string; name: string }> = [
    { id: "a1000000-0000-4000-8000-000000000001", name: "Online" },
    { id: "a1000000-0000-4000-8000-000000000002", name: "Offline" },
  ];

  test("by a name each side holds once", () => {
    expect(matchesFor({ incoming: ["Offline", "Online"], stored })).toEqual([
      1, 0,
    ]);
  });

  test("then by position, a stored item taken once", () => {
    expect(
      matchesFor({ incoming: ["Degraded", "Online", "Offline"], stored }),
    ).toEqual([-1, 0, 1]);
    expect(matchesFor({ incoming: ["Down", "Up"], stored })).toEqual([0, 1]);
  });

  test("a name held twice on either side matches nothing by name", () => {
    expect(matchesFor({ incoming: ["Online", "Online"], stored })).toEqual([
      0, 1,
    ]);
  });

  test("the cases the Go test reads are the server's answers", () => {
    const file: { cases: Array<JSONObject> } =
      buildMonitorStepsIdentityCases() as unknown as {
        cases: Array<JSONObject>;
      };

    expect(file.cases.length).toBeGreaterThanOrEqual(12);

    for (const c of file.cases) {
      expect(c["matches"]).toEqual(
        matchesFor({
          incoming: c["incoming"] as Array<string>,
          stored: c["stored"] as Array<{ id: string; name: string }>,
        }),
      );
      expect((c["matches"] as Array<number>).length).toBe(
        (c["incoming"] as Array<string>).length,
      );
    }

    // Some cases match nothing for an item, and some by name across positions.
    const all: string = JSON.stringify(file.cases);
    expect(all).toContain("-1");
  });
});

describe("the fields a template's step can keep when it syncs", () => {
  test("are every monitor type's, each once, sorted", () => {
    const values: Array<string> = getDoNotSyncFieldValues();

    expect(values).toEqual([...new Set(values)].sort());

    for (const monitorType of Object.values(MonitorType)) {
      for (const field of MonitorTemplateSyncFieldUtil.getFields(
        monitorType as MonitorType,
      )) {
        expect(values).toContain(field.path);
      }
    }
  });

  test("are what the server takes, and nothing it refuses", () => {
    expect(
      MonitorTemplateSyncFieldUtil.parse(getDoNotSyncFieldValues()),
    ).toEqual(getDoNotSyncFieldValues());
    expect(() => {
      MonitorTemplateSyncFieldUtil.parse(["monitorName"]);
    }).toThrow();
  });

  test("are written as Go the provider's validator reads", () => {
    const go: string = monitorStepsSyncFieldsGoFile();

    expect(go.startsWith("package provider\n")).toBe(true);
    expect(go).toContain("DO NOT EDIT.");
    expect(go).toContain("var monitorStepsDoNotSyncFieldValues = []string{");

    for (const value of getDoNotSyncFieldValues()) {
      expect(go).toContain(`\t${JSON.stringify(value)},\n`);
    }
  });
});

describe("the generator writes them where the provider reads them", () => {
  test("as JSON and Go", () => {
    expect(JSON.parse(monitorStepsApiKeysFile())).toEqual(
      JSON.parse(JSON.stringify(buildMonitorStepsApiKeys())),
    );
    expect(JSON.parse(monitorStepsIdentityCasesFile())).toEqual(
      JSON.parse(JSON.stringify(buildMonitorStepsIdentityCases())),
    );
    expect(MONITOR_STEPS_API_KEYS_FILE).toBe("monitor_steps_api_keys.json");
    expect(MONITOR_STEPS_IDENTITY_CASES_FILE).toBe(
      "monitor_steps_identity_cases.json",
    );
    expect(MONITOR_STEPS_SYNC_FIELDS_GO_FILE).toBe(
      "monitorsteps_syncfields.go",
    );
  });

  test("into internal/provider and its testdata, beside the Go that reads them", () => {
    expect(generator).toContain('"monitorstepsunmanaged.go"');
    expect(generator).toContain('"monitorstepsunmanaged_test.go"');
    expect(generator).toContain("MONITOR_STEPS_SYNC_FIELDS_GO_FILE,");
    expect(generator).toContain("MONITOR_STEPS_API_KEYS_FILE,");
    expect(generator).toContain("MONITOR_STEPS_IDENTITY_CASES_FILE,");
    expect(unmanagedGoTest).toContain(
      `filepath.Join("testdata", "${MONITOR_STEPS_API_KEYS_FILE}")`,
    );
    expect(unmanagedGoTest).toContain(
      `filepath.Join("testdata", "${MONITOR_STEPS_IDENTITY_CASES_FILE}")`,
    );
  });

  test("and an update that writes a monitor's steps keeps what the provider cannot write", () => {
    expect(generator).toContain("MonitorStepsHeld(ctx, r.client,");
    expect(generator).toContain("MonitorStepsKeepUnmanaged(ctx,");
    expect(unmanagedGo).toContain(
      "func MonitorStepsKeepUnmanaged(ctx context.Context, outgoing interface{}, prior types.List, held interface{}) interface{} {",
    );
  });
});
