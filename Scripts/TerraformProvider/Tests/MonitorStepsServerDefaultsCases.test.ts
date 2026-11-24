/*
 * WHAT ONEUPTIME WRITES OF ITS OWN INTO STEPS IT IS SENT
 * (Core/MonitorStepsServerDefaultsCases.ts, OneUptime/oneuptime#10907).
 *
 * The provider tells what OneUptime writes of its own from a setting someone
 * added in the Dashboard by a table of each setting's unset value
 * (StaticFiles/monitorstepsdrift.go, monitorStepsUnsetValues). These tests
 * read, for steps a configuration writes sparsely, everything the server's
 * own code adds to them, and fail on anything the table does not let pass:
 * a default OneUptime starts to write would otherwise fail every apply of a
 * monitor as "Provider produced inconsistent result after apply". They also
 * hold the generator to writing the cases where the provider's Go test reads
 * them.
 */

import fs from "fs";
import path from "path";
import {
  MONITOR_STEPS_SERVER_DEFAULTS_CASES_FILE,
  MonitorStepsServerDefaultsCase,
  MonitorStepsServerDefaultsCases,
  answerFor,
  buildMonitorStepsServerDefaultsCases,
  monitorStepsServerDefaultsCasesFile,
} from "../Core/MonitorStepsServerDefaultsCases";
import { JSONObject } from "Common/Types/JSON";
import escapeRegExp from "Common/Utils/RegExpEscape";

const cases: MonitorStepsServerDefaultsCases =
  buildMonitorStepsServerDefaultsCases();

const driftGo: string = fs.readFileSync(
  path.join(__dirname, "..", "StaticFiles", "monitorstepsdrift.go"),
  "utf-8",
);

const monitorStepsGo: string = fs.readFileSync(
  path.join(__dirname, "..", "StaticFiles", "monitorsteps.go"),
  "utf-8",
);

// A step's type-specific sub-configs, as monitorsteps.go lists them.
const SUB_CONFIG_KEYS: Array<string> = Array.from(
  monitorStepsGo.matchAll(/apiKey:\s*"([A-Za-z]+)"/g),
).map((match: RegExpMatchArray): string => {
  return match[1]!;
});

type Level =
  | "steps"
  | "step"
  | "criteria"
  | "filter"
  | "window"
  | "incident"
  | "alert"
  | "other";

// The level a key's value sits at, as monitorStepsChildLevel reads it.
function childLevel(level: Level, key: string): Level {
  if (level === "step" && key === "monitorCriteria") {
    return "criteria";
  }
  if (level === "criteria") {
    if (key === "filters" || key === "recoveryFilters") {
      return "filter";
    }
    if (key === "incidents") {
      return "incident";
    }
    if (key === "alerts") {
      return "alert";
    }
  }
  if (level === "filter" && key === "evaluateOverTimeOptions") {
    return "window";
  }
  return "other";
}

function unwrap(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "_type" in (value as JSONObject) &&
    "value" in (value as JSONObject)
  ) {
    return (value as JSONObject)["value"];
  }

  return value;
}

/*
 * Each key the answer holds that the steps sent do not, as
 * "level.key = value", at the levels a configuration writes settings in. A
 * sub-config's inside and the steps' default status are OneUptime's.
 */
function added(sent: JSONObject, answered: JSONObject): Array<string> {
  const out: Array<string> = [];

  const sentSteps: Array<unknown> = ((unwrap(sent) as JSONObject)[
    "monitorStepsInstanceArray"
  ] || []) as Array<unknown>;
  const answeredSteps: Array<unknown> = ((unwrap(answered) as JSONObject)[
    "monitorStepsInstanceArray"
  ] || []) as Array<unknown>;

  for (const key of Object.keys(unwrap(answered) as JSONObject)) {
    if (!(key in (unwrap(sent) as JSONObject))) {
      out.push(`steps.${key}`);
    }
  }

  answeredSteps.forEach((step: unknown, index: number) => {
    walk(
      "step",
      unwrap(sentSteps[index]) as JSONObject,
      unwrap(step) as JSONObject,
    );
  });

  function walk(level: Level, written: unknown, held: unknown): void {
    if (Array.isArray(held) && Array.isArray(written)) {
      held.forEach((item: unknown, index: number) => {
        walk(level, written[index], item);
      });
      return;
    }

    if (
      !held ||
      typeof held !== "object" ||
      !written ||
      typeof written !== "object"
    ) {
      return;
    }

    const w: JSONObject = written as JSONObject;
    const h: JSONObject = held as JSONObject;

    for (const [key, value] of Object.entries(h)) {
      if (level === "step" && SUB_CONFIG_KEYS.includes(key)) {
        continue;
      }

      if (!(key in w)) {
        out.push(`${level}.${key} = ${JSON.stringify(value)}`);
        continue;
      }

      if (level === "step" && key === "monitorCriteria") {
        const writtenCriteria: Array<unknown> = ((unwrap(w[key]) as JSONObject)[
          "monitorCriteriaInstanceArray"
        ] || []) as Array<unknown>;
        const heldCriteria: Array<unknown> = ((unwrap(value) as JSONObject)[
          "monitorCriteriaInstanceArray"
        ] || []) as Array<unknown>;

        heldCriteria.forEach((criteria: unknown, index: number) => {
          walk(
            "criteria",
            unwrap(writtenCriteria[index]),
            unwrap(criteria),
          );
        });
        continue;
      }

      const next: Level = childLevel(level, key);

      if (next !== "other") {
        walk(next, w[key], value);
      }
    }
  }

  return out;
}

// What a key the answer adds may be: an id, the steps' default status, or a setting's unset value.
function isLetPass(entry: string): boolean {
  if (/^(step|criteria|incident|alert)\.id = "[0-9a-f-]{36}"$/.test(entry)) {
    return true;
  }

  if (entry === "steps.defaultMonitorStatusId") {
    return true;
  }

  /*
   * The provider reads an empty text, list or map as none
   * (MonitorStepsFromAPI): a criteria's description written as "", its
   * incidents and alerts as [].
   */
  if (/ = (""|\[\]|\{\})$/.test(entry)) {
    return true;
  }

  return UNSET_VALUES.includes(entry);
}

/*
 * monitorStepsUnsetValues, as these tests expect it - each entry checked
 * against the Go table below, so the two cannot drift apart.
 */
const UNSET_VALUES: Array<string> = [
  'step.requestType = "GET"',
  "step.doNotFollowRedirects = false",
  "step.allowSelfSignedCertificates = false",
  'step.requestBodyFormat = "json"',
  "criteria.changeMonitorStatus = false",
  "criteria.createIncidents = false",
  "criteria.createAlerts = false",
  "criteria.isEnabled = true",
  'criteria.recoveryFilterCondition = "All"',
  "criteria.openForEveryEmail = false",
  "filter.evaluateOverTime = false",
  'window.onNoDataPolicy = "Ignore"',
  "window.percentile = 95",
  'window.countFilterType = "Greater Than"',
  "window.countValue = 0",
  'window.changeType = "Amount"',
  "window.changeValue = 0",
  "incident.isPrivate = false",
  "incident.showIncidentOnStatusPage = true",
  "incident.autoResolveIncident = false",
  "alert.isPrivate = false",
  "alert.autoResolveAlert = false",
];

describe("what OneUptime writes of its own into steps a configuration writes sparsely", () => {
  test("there are cases for every part of a step a configuration writes", () => {
    expect(cases.cases.length).toBeGreaterThanOrEqual(10);

    const all: string = JSON.stringify(
      cases.cases.map((c: MonitorStepsServerDefaultsCase): JSONObject => {
        return c.sent;
      }),
    );

    for (const part of [
      "requestHeaders",
      "requestBody",
      "incidents",
      "alerts",
      "recoveryFilters",
      "activeHours",
      "Status Changes",
      "Percentile",
      "Previous Check",
      "serverMonitorOptions",
      "metricMonitorOptions",
      "metricMonitor",
      "browserTypes",
      "monitorDestinationPort",
      '"isEnabled":false',
    ]) {
      expect(all).toContain(part);
    }
  });

  test.each(
    cases.cases.map((c: MonitorStepsServerDefaultsCase) => {
      return [c.name, c] as const;
    }),
  )(
    "%s: everything the server adds is an id or a setting's unset value",
    (_name: string, c: MonitorStepsServerDefaultsCase) => {
      const notLetPass: Array<string> = added(c.sent, c.answered).filter(
        (entry: string): boolean => {
          return !isLetPass(entry);
        },
      );

      // A default OneUptime writes that the provider does not know fails every apply.
      expect(notLetPass).toEqual([]);
    },
  );

  test("the server does write defaults of its own: the cases are not empty of them", () => {
    const seen: Set<string> = new Set<string>();

    for (const c of cases.cases) {
      for (const entry of added(c.sent, c.answered)) {
        seen.add(entry);
      }
    }

    for (const expected of [
      'step.requestType = "GET"',
      "criteria.isEnabled = true",
      "criteria.changeMonitorStatus = false",
      "criteria.createAlerts = false",
      'criteria.recoveryFilterCondition = "All"',
    ]) {
      expect(seen).toContain(expected);
    }
  });

  test("each unset value these tests let pass is the provider's own", () => {
    for (const entry of UNSET_VALUES) {
      const [, key, value] = entry.match(/^[a-z]+\.([A-Za-z]+) = (.+)$/)!;
      const goValue: string = /^\d+$/.test(value!)
        ? `float64(${value})`
        : value!;

      expect(driftGo).toContain(`"${key}":`);
      expect(
        new RegExp(`"${key}":\\s+${escapeRegExp(goValue)},`).test(driftGo),
      ).toBe(true);
    }
  });

  test("a setting someone adds is never an unset value", () => {
    const page: MonitorStepsServerDefaultsCase = cases.cases[0]!;
    const withHours: JSONObject = JSON.parse(
      JSON.stringify(page.sent),
    ) as JSONObject;
    const step: JSONObject = (
      (unwrap(withHours) as JSONObject)["monitorStepsInstanceArray"] as Array<
        JSONObject
      >
    )[0]!["value"] as JSONObject;
    const criteria: JSONObject = (
      (unwrap(step["monitorCriteria"]) as JSONObject)[
        "monitorCriteriaInstanceArray"
      ] as Array<JSONObject>
    )[0]!["value"] as JSONObject;
    criteria["createIncidents"] = true;
    criteria["description"] = "From the Dashboard.";

    const entries: Array<string> = added(page.sent, answerFor(withHours));

    expect(entries).toContain("criteria.createIncidents = true");
    expect(entries).toContain('criteria.description = "From the Dashboard."');
    expect(entries.filter(isLetPass)).not.toContain(
      "criteria.createIncidents = true",
    );
  });
});

describe("the generator writes them where the provider's Go test reads them", () => {
  test("as JSON the Go test reads", () => {
    const file: MonitorStepsServerDefaultsCases = JSON.parse(
      monitorStepsServerDefaultsCasesFile(),
    ) as MonitorStepsServerDefaultsCases;

    expect(file.cases).toHaveLength(cases.cases.length);
    expect(MONITOR_STEPS_SERVER_DEFAULTS_CASES_FILE).toBe(
      "monitor_steps_server_defaults.json",
    );
  });

  test("into internal/provider/testdata, beside the Go test that reads them", () => {
    const generator: string = fs.readFileSync(
      path.join(__dirname, "..", "Core", "ResourceGenerator.ts"),
      "utf-8",
    );
    const goTest: string = fs.readFileSync(
      path.join(__dirname, "..", "StaticFiles", "monitorstepsdrift_test.go"),
      "utf-8",
    );

    expect(generator).toContain("MONITOR_STEPS_SERVER_DEFAULTS_CASES_FILE,");
    expect(generator).toContain('"monitorstepsdrift.go"');
    expect(generator).toContain('"monitorstepsdrift_test.go"');
    expect(goTest).toContain(
      `filepath.Join("testdata", "${MONITOR_STEPS_SERVER_DEFAULTS_CASES_FILE}")`,
    );
  });

  test("a read and an apply keep the steps the configuration writes", () => {
    const generator: string = fs.readFileSync(
      path.join(__dirname, "..", "Core", "ResourceGenerator.ts"),
      "utf-8",
    );

    expect(generator).toContain(
      "MonitorStepsKeepWritten(ctx, ${fieldName}.ListValue, mappedSteps)",
    );
  });
});
