/*
 * THE CASES THE PROVIDER'S READING OF MONITOR STEP VALUES IS CHECKED AGAINST
 * (Core/MonitorStepsValuesCases.ts, OneUptime/oneuptime#6723).
 *
 * The provider's Go test (StaticFiles/monitorstepsvalues_test.go) checks
 * every case it is handed, and only those. Cases that left out a rolling
 * time, a unit or a name would leave the provider free to read it otherwise
 * than the server, with every test passing. So every rolling time, unit and
 * name the server reads is in them, the ones a person can check by eye read
 * as they should, and the generator writes them where the Go test reads
 * them.
 */

import fs from "fs";
import os from "os";
import path from "path";
import {
  CRITERIA_NAME,
  CriteriaValueCase,
  MONITOR_STEPS_VALUES_CASES_FILE,
  MonitorStepsValuesCases,
  RollingTimeCase,
  StoredCase,
  buildMonitorStepsValuesCases,
  monitorStepsValuesCasesFile,
} from "../Core/MonitorStepsValuesCases";
import { ResourceGenerator } from "../Core/ResourceGenerator";
import { TerraformProviderConfig } from "../Core/Types";
import { buildFixtureSpec } from "./Fixtures";
import CriteriaFilterValues, {
  CriteriaFilterValueField,
} from "Common/Types/Monitor/CriteriaFilterValues";
import {
  EvaluateOverTimeType,
  NoDataPolicy,
} from "Common/Types/Monitor/CriteriaFilter";
import { JSONValue } from "Common/Types/JSON";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import RollingTimeUtil from "Common/Types/RollingTime/RollingTimeUtil";

const cases: MonitorStepsValuesCases = buildMonitorStepsValuesCases();

// A case's written value as a key: JSON tells "15" and 15 apart.
function keyOf(value: JSONValue): string {
  return JSON.stringify(value);
}

function rollingTimeCase(written: JSONValue): RollingTimeCase {
  const found: RollingTimeCase | undefined = cases.rollingTimeCases.find(
    (c: RollingTimeCase): boolean => {
      return keyOf(c.written) === keyOf(written);
    },
  );

  if (!found) {
    throw new Error(`No rolling time case writes ${keyOf(written)}`);
  }

  return found;
}

function criteriaValueCase(
  key: CriteriaValueCase["key"],
  written: JSONValue,
): CriteriaValueCase {
  const found: CriteriaValueCase | undefined = cases.criteriaValueCases.find(
    (c: CriteriaValueCase): boolean => {
      return c.key === key && keyOf(c.written) === keyOf(written);
    },
  );

  if (!found) {
    throw new Error(`No ${key} case writes ${keyOf(written)}`);
  }

  return found;
}

function storedCase(list: Array<StoredCase>, written: JSONValue): StoredCase {
  const found: StoredCase | undefined = list.find((c: StoredCase): boolean => {
    return keyOf(c.written) === keyOf(written);
  });

  if (!found) {
    throw new Error(`No stored case writes ${keyOf(written)}`);
  }

  return found;
}

const REFUSED_ROLLING_TIME: RegExp =
  /^metricMonitor\.rollingTime .+ is not a rolling time\. Use one of "Past 1 Minute", .+ or "Past 365 Days" - or a length exactly as long as one of them, such as "15 minutes", "1h" or "PT15M"\.$/;

describe("the monitor step values cases", () => {
  test.each(Object.values(RollingTime))(
    "hold %p as written, in other cases and spacing, and as lengths of its window",
    (rollingTime: RollingTime) => {
      const readAs: Array<JSONValue> = cases.rollingTimeCases
        .filter((c: RollingTimeCase): boolean => {
          return c.read === rollingTime;
        })
        .map((c: RollingTimeCase): JSONValue => {
          return c.written;
        });

      expect(readAs).toContain(rollingTime);
      expect(readAs).toContain(rollingTime.toUpperCase());
      expect(readAs).toContain(
        `PT${RollingTimeUtil.getWindowInMs(rollingTime) / 1000}S`,
      );
      expect(readAs.length).toBeGreaterThanOrEqual(15);
    },
  );

  test.each(RollingTimeUtil.getUnitsRead())(
    "write lengths in the unit %p, alone and with a count",
    (unit: string) => {
      const written: Array<JSONValue> = cases.rollingTimeCases.map(
        (c: RollingTimeCase): JSONValue => {
          return c.written;
        },
      );

      for (const spelling of [unit, `past ${unit}`, `1 ${unit}`, `1${unit}`]) {
        expect(written).toContain(spelling);
      }
    },
  );

  test.each([
    ["metricAggregationType", "evaluateOverTimeType"],
    ["onNoDataPolicy", "noDataPolicy"],
  ] as const)(
    "write every name the server reads %s by, in other cases",
    (key: CriteriaValueCase["key"], field: CriteriaFilterValueField) => {
      const written: Array<JSONValue> = cases.criteriaValueCases
        .filter((c: CriteriaValueCase): boolean => {
          return c.key === key;
        })
        .map((c: CriteriaValueCase): JSONValue => {
          return c.written;
        });
      const names: Array<string> = CriteriaFilterValues.getNamesRead(field);

      expect(names.length).toBeGreaterThan(2);
      for (const name of names) {
        expect(written).toContain(name);
        expect(written).toContain(name.toUpperCase());
      }
    },
  );

  test("hold plenty of values the server reads, and of ones it refuses", () => {
    const refused: number = cases.rollingTimeCases.filter(
      (c: RollingTimeCase): boolean => {
        return c.read === null;
      },
    ).length;

    expect(cases.rollingTimeCases.length).toBeGreaterThan(500);
    expect(refused).toBeGreaterThan(100);
    expect(cases.rollingTimeCases.length - refused).toBeGreaterThan(300);
    expect(cases.criteriaValueCases.length).toBeGreaterThan(100);
  });

  test("refuse a value exactly when it is written and means none", () => {
    for (const c of cases.rollingTimeCases) {
      const notWritten: boolean = c.written === null || c.written === "";

      expect([keyOf(c.written), c.error === null]).toEqual([
        keyOf(c.written),
        c.read !== null || notWritten,
      ]);
      if (c.error !== null) {
        expect(c.error).toMatch(REFUSED_ROLLING_TIME);
      }
    }

    for (const c of cases.criteriaValueCases) {
      const notWritten: boolean = c.written === null || c.written === "";

      expect([c.key, keyOf(c.written), c.error === null]).toEqual([
        c.key,
        keyOf(c.written),
        c.read !== null || notWritten,
      ]);
    }
  });

  test("read the customer's values, and ones a person can check, as the server does", () => {
    expect(rollingTimeCase("15 minutes")).toEqual({
      written: "15 minutes",
      read: RollingTime.Past15Minutes,
      error: null,
    });
    expect(rollingTimeCase("PT1H").read).toBe(RollingTime.Past1Hour);
    expect(rollingTimeCase("2 weeks").read).toBe(RollingTime.Past14Days);
    expect(rollingTimeCase("past hour").read).toBe(RollingTime.Past1Hour);
    expect(rollingTimeCase("Past1Hours").read).toBeNull();
    expect(rollingTimeCase("20 minutes").error).toBe(
      `metricMonitor.rollingTime "20 minutes" is not a rolling time. Use one of ${RollingTimeUtil.getValuesText()} - or a length exactly as long as one of them, such as "15 minutes", "1h" or "PT15M".`,
    );
    expect(rollingTimeCase(15).error).toContain(
      "metricMonitor.rollingTime 15 is not a rolling time.",
    );

    expect(criteriaValueCase("metricAggregationType", "avg").read).toBe(
      EvaluateOverTimeType.Average,
    );
    expect(criteriaValueCase("onNoDataPolicy", "TREAT-AS-ZERO").read).toBe(
      NoDataPolicy.TreatAsZero,
    );
    expect(criteriaValueCase("metricAggregationType", "x").error).toBe(
      `Criteria ${JSON.stringify(CRITERIA_NAME)}: filters[0].metricMonitorOptions.metricAggregationType "x" is not a value OneUptime reads there. Use one of "Average", "Sum", "Maximum Value", "Minimum Value", "All Values" or "Any Value".`,
    );
    // The name is quoted as JSON writes it.
    expect(CRITERIA_NAME).toMatch(/["\\]/);
  });

  test("hold what the server stores of each settings' rolling time", () => {
    const keys: Array<string> = cases.rollingTimeSettings.map(
      (settings: { apiKey: string }): string => {
        return settings.apiKey;
      },
    );

    expect(keys).toEqual(
      expect.arrayContaining(["metricMonitor", "kubernetesMonitor"]),
    );
    expect(keys.length).toBeGreaterThanOrEqual(12);

    /*
     * Read where it means one; a metric monitor's falsy one is the default;
     * the rest are kept as written.
     */
    expect(
      storedCase(cases.storedRollingTimes, "15 minutes").stored[
        "kubernetesMonitor"
      ],
    ).toEqual({ rollingTime: RollingTime.Past15Minutes });
    expect(storedCase(cases.storedRollingTimes, null).stored).toMatchObject({
      metricMonitor: { rollingTime: RollingTime.Past1Minute },
      kubernetesMonitor: { rollingTime: null },
    });
    expect(
      storedCase(cases.storedRollingTimes, "20 minutes").stored[
        "metricMonitor"
      ],
    ).toEqual({ rollingTime: "20 minutes" });

    for (const c of cases.storedRollingTimes) {
      expect(Object.keys(c.stored).sort()).toEqual([...keys].sort());
    }

    expect(storedCase(cases.storedMetricMonitorOptions, "avg").stored).toEqual({
      metricAggregationType: "Average",
      onNoDataPolicy: "avg",
    });
    expect(
      storedCase(cases.storedMetricMonitorOptions, "trigger").stored,
    ).toEqual({ metricAggregationType: "trigger", onNoDataPolicy: "Trigger" });
  });
});

describe("the monitor step values cases file", () => {
  const file: string = monitorStepsValuesCasesFile();

  test("is the cases, the same each time it is written", () => {
    expect(monitorStepsValuesCasesFile()).toBe(file);
    expect(JSON.parse(file)).toEqual(JSON.parse(JSON.stringify(cases)));
    expect(file.endsWith("}\n")).toBe(true);
  });

  test("has one case a line, so a change to the server's reading shows case by case", () => {
    const lines: Array<string> = file.split("\n");

    for (const c of [
      ...cases.rollingTimeCases.slice(0, -1),
      ...cases.criteriaValueCases.slice(0, -1),
    ]) {
      expect(lines).toContain(`    ${JSON.stringify(c)},`);
    }
  });
});

describe("the generator", () => {
  let outputDir: string;

  beforeAll(async () => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-step-values-"));
    const config: TerraformProviderConfig = {
      outputDir,
      providerName: "oneuptime",
      providerVersion: "11.0.0",
      goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
    };
    await new ResourceGenerator(config, buildFixtureSpec()).generateResources();
  });

  afterAll(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  test("writes the cases where the provider's Go test reads them", () => {
    const provider: string = path.join(outputDir, "internal", "provider");
    const goTest: string = fs.readFileSync(
      path.join(provider, "monitorstepsvalues_test.go"),
      "utf-8",
    );

    expect(goTest).toContain(
      `filepath.Join("testdata", "${MONITOR_STEPS_VALUES_CASES_FILE}")`,
    );
    expect(
      fs.readFileSync(
        path.join(provider, "testdata", MONITOR_STEPS_VALUES_CASES_FILE),
        "utf-8",
      ),
    ).toBe(monitorStepsValuesCasesFile());
  });

  test("ships the reader and its tests", () => {
    for (const name of [
      "monitorstepsvalues.go",
      "monitorstepsvalues_test.go",
      "monitorstepsvalues_roundtrip_test.go",
    ]) {
      expect(
        fs.existsSync(path.join(outputDir, "internal", "provider", name)),
      ).toBe(true);
    }
  });
});
