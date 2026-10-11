import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import MonitorTemplateUtil from "../../../Server/Utils/Monitor/MonitorTemplateUtil";
import DataToProcess from "../../../Server/Utils/Monitor/DataToProcess";
import logger from "../../../Server/Utils/Logger";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import TemplateVariablesCatalog, {
  TemplateVariableGroup,
} from "../../../UI/Components/MonitorTemplateVariables/TemplateVariablesCatalog";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The monitor types evaluated as metric series ("metric-backed") are one list,
 * MonitorTypeHelper.getMetricBackedMonitorTypes(). The worker schedules them
 * as telemetry monitors, MonitorCriteriaEvaluator hands their criteria to
 * MetricMonitorCriteria, the server gives their incident and alert templates
 * {{metricName}} and the series labels, and the variables list under the
 * template editor offers both.
 *
 * Those used to be five lists. Two of them - MonitorTemplateUtil's and the
 * template variables catalog's - left IoT Device out, so an IoT incident's
 * {{metricName}} stayed in its title as written and the editor never offered
 * {{device.id}}. This suite holds every reader to the one list: by what each
 * one does for every monitor type, and by a scan that refuses a new copy of
 * the list anywhere in the code.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");

/*
 * Written out rather than read from the helper, so a change to the list is a
 * change to this file too.
 */
const METRIC_BACKED: Array<MonitorType> = [
  MonitorType.Metrics,
  MonitorType.Kubernetes,
  MonitorType.Docker,
  MonitorType.Host,
  MonitorType.Podman,
  MonitorType.DockerSwarm,
  MonitorType.Proxmox,
  MonitorType.VMware,
  MonitorType.Ceph,
  MonitorType.StorageArray,
  MonitorType.IoTDevice,
];

const ALL_TYPES: Array<MonitorType> = Object.values(
  MonitorType,
) as Array<MonitorType>;

const METRIC_GROUP_TITLE: string = "Metric";
const SERIES_GROUP_TITLE: string = "Series Labels (per-host / per-container)";

function metricCheck(): DataToProcess {
  const response: MetricMonitorResponse = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    metricResult: [],
    metricViewConfig: {
      queryConfigs: [
        {
          metricAliasData: {
            metricVariable: "a",
            title: undefined,
            description: undefined,
            legend: undefined,
            legendUnit: undefined,
          },
          metricQueryData: {
            filterData: { metricName: "watched.metric" },
          },
        },
      ],
      formulaConfigs: [],
    },
  };

  return response as unknown as DataToProcess;
}

function serverMap(monitorType: MonitorType): JSONObject {
  return MonitorTemplateUtil.buildTemplateStorageMap({
    monitorType,
    dataToProcess: metricCheck(),
  });
}

function catalogTitles(
  monitorType: MonitorType,
  seriesAttributeKeys?: Array<string> | undefined,
): Array<string> {
  return TemplateVariablesCatalog.getVariables({
    monitorType,
    seriesAttributeKeys,
  }).map((group: TemplateVariableGroup): string => {
    return group.title;
  });
}

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation(() => {});
  jest.spyOn(logger, "debug").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MonitorTypeHelper - the monitor types evaluated as metric series", () => {
  test("are the eleven the worker answers with a MetricMonitorResponse, IoT Device included", () => {
    expect(MonitorTypeHelper.getMetricBackedMonitorTypes()).toEqual(
      METRIC_BACKED,
    );
  });

  test("name each type once", () => {
    const types: Array<MonitorType> =
      MonitorTypeHelper.getMetricBackedMonitorTypes();

    expect(new Set<MonitorType>(types).size).toBe(types.length);
  });

  test("isMetricBackedMonitor answers for exactly those types", () => {
    const claimed: Array<MonitorType> = ALL_TYPES.filter(
      (monitorType: MonitorType): boolean => {
        return MonitorTypeHelper.isMetricBackedMonitor(monitorType);
      },
    );

    expect([...claimed].sort()).toEqual([...METRIC_BACKED].sort());
  });

  test("no monitor type at all is not metric-backed", () => {
    expect(MonitorTypeHelper.isMetricBackedMonitor(undefined)).toBe(false);
  });

  test("hand back a new array every time, so no caller can change the list", () => {
    const first: Array<MonitorType> =
      MonitorTypeHelper.getMetricBackedMonitorTypes();
    first.pop();

    expect(MonitorTypeHelper.getMetricBackedMonitorTypes()).toEqual(
      METRIC_BACKED,
    );
  });

  test("are all telemetry monitors, so the telemetry worker schedules every one", () => {
    for (const monitorType of METRIC_BACKED) {
      expect({
        monitorType,
        telemetry: MonitorTypeHelper.isTelemetryMonitor(monitorType),
      }).toEqual({ monitorType, telemetry: true });
      expect(MonitorTypeHelper.getTelemetryMonitorTypes()).toContain(
        monitorType,
      );
    }
  });

  test("the telemetry list is the telemetry signals plus the metric-backed list", () => {
    expect(MonitorTypeHelper.getTelemetryMonitorTypes()).toEqual([
      MonitorType.Logs,
      MonitorType.Traces,
      MonitorType.Exceptions,
      MonitorType.Profiles,
      MonitorType.SecurityEvents,
      MonitorType.Llm,
      ...METRIC_BACKED,
    ]);

    for (const monitorType of ALL_TYPES) {
      expect({
        monitorType,
        telemetry: MonitorTypeHelper.isTelemetryMonitor(monitorType),
      }).toEqual({
        monitorType,
        telemetry:
          MonitorTypeHelper.getTelemetryMonitorTypes().includes(monitorType),
      });
    }
  });
});

describe("the server's template variables and the editor's list follow the one list", () => {
  test.each(ALL_TYPES)(
    "%s: the server sets {{metricName}} exactly when the editor offers it",
    (monitorType: MonitorType) => {
      const metricBacked: boolean =
        MonitorTypeHelper.isMetricBackedMonitor(monitorType);
      const map: JSONObject = serverMap(monitorType);

      expect({
        monitorType,
        server: "metricName" in map,
        editor: catalogTitles(monitorType).includes(METRIC_GROUP_TITLE),
      }).toEqual({
        monitorType,
        server: metricBacked,
        editor: metricBacked,
      });

      if (metricBacked) {
        expect(map["metricName"]).toBe("watched.metric");
      }
    },
  );

  test.each(ALL_TYPES)(
    "%s: the editor offers series labels exactly when the monitor is evaluated as metric series",
    (monitorType: MonitorType) => {
      expect({
        monitorType,
        seriesLabels: catalogTitles(monitorType, ["device.id"]).includes(
          SERIES_GROUP_TITLE,
        ),
      }).toEqual({
        monitorType,
        seriesLabels: MonitorTypeHelper.isMetricBackedMonitor(monitorType),
      });
    },
  );

  test("a series label the editor offers is one the server places", () => {
    for (const monitorType of METRIC_BACKED) {
      const rendered: string = MonitorTemplateUtil.processTemplateString({
        value: "{{device.id}}",
        storageMap: MonitorTemplateUtil.buildTemplateStorageMap({
          monitorType,
          dataToProcess: metricCheck(),
          seriesLabels: { "device.id": "sensor-001" },
        }),
      });

      expect({ monitorType, rendered }).toEqual({
        monitorType,
        rendered: "sensor-001",
      });
    }
  });
});

/*
 * No source file keeps its own copy of the list. A copy is a run of the
 * metric-backed types written one after another as a list: array items
 * (`MonitorType.A, MonitorType.B`), switch labels falling through
 * (`case MonitorType.A: case MonitorType.B:`), or an `||` chain of
 * comparisons (`x === MonitorType.A || x === MonitorType.B`). A run naming
 * at least MIN_COPY_LENGTH of them counts; a type or two handled together
 * (Docker and Podman) does not.
 *
 * MonitorType.ts is where the list lives. The two runs below are not copies
 * of it, and are written out here with why: a new run anywhere fails until it
 * uses MonitorTypeHelper instead, or is added here with its reason, and a run
 * that goes away has to leave this list too.
 */

const MIN_COPY_LENGTH: number = 5;

const SCANNED_ROOTS: Array<string> = [
  "packages/Common/Server",
  "packages/Common/Types",
  "packages/Common/UI",
  "packages/Common/Utils",
  "packages/Common/Models",
  "packages/App/FeatureSet",
  "ee",
];

const HOME: string = "packages/Common/Types/Monitor/MonitorType.ts";

interface ListRun {
  file: string;
  members: Array<string>;
}

const NOT_COPIES: Array<ListRun & { why: string }> = [
  {
    file: "packages/App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter.ts",
    members: [
      "Kubernetes",
      "Docker",
      "Host",
      "Podman",
      "DockerSwarm",
      "Proxmox",
      "VMware",
      "Ceph",
      "StorageArray",
      "Metrics",
    ],
    why: "CriteriaFilterUtil.isMetricOnlyMonitorType, the types whose criteria form hides Filter Type and pins every filter to the metric value. IoT Device is left out on purpose, so its criteria keep the full filter UI.",
  },
  {
    file: "packages/Common/Utils/Monitor/MonitorOverviewFamily.ts",
    members: [
      "Kubernetes",
      "Docker",
      "Host",
      "Podman",
      "DockerSwarm",
      "Proxmox",
      "VMware",
      "Ceph",
      "StorageArray",
      "IoTDevice",
    ],
    why: "The Infrastructure family of a monitor's overview page, in a switch that names every monitor type once and fails to compile when one is missing.",
  },
];

// The enum member names of the metric-backed types: "StorageArray", not "Storage Array".
const METRIC_BACKED_MEMBERS: Set<string> = new Set<string>(
  Object.entries(MonitorType)
    .filter(([, value]: [string, string]): boolean => {
      return METRIC_BACKED.includes(value as MonitorType);
    })
    .map(([member]: [string, string]): string => {
      return member;
    }),
);

const MEMBER_REFERENCE: RegExp = /MonitorType\.([A-Za-z]+)\b/g;
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /\/\/[^\n]*/g;
const WHITESPACE: RegExp = /\s+/g;
const OR_COMPARISON: RegExp = /^\|\|[A-Za-z_$][\w$.?!()]*={2,3}$/;

// Whether the text between two references only separates items of one list.
function isListSeparator(between: string): boolean {
  const separator: string = between
    .replace(BLOCK_COMMENT, "")
    .replace(LINE_COMMENT, "")
    .replace(WHITESPACE, "");

  return (
    separator === "," || separator === ":case" || OR_COMPARISON.test(separator)
  );
}

function listRunsIn(file: string, source: string): Array<ListRun> {
  const runs: Array<ListRun> = [];
  let current: Array<string> = [];
  let previousEnd: number = -1;

  const close: () => void = (): void => {
    const distinct: Array<string> = Array.from(new Set<string>(current));

    if (distinct.length >= MIN_COPY_LENGTH) {
      runs.push({ file, members: distinct });
    }

    current = [];
  };

  for (const match of source.matchAll(MEMBER_REFERENCE)) {
    const member: string = match[1]!;
    const start: number = match.index!;

    if (!METRIC_BACKED_MEMBERS.has(member)) {
      close();
      previousEnd = -1;
      continue;
    }

    if (
      previousEnd === -1 ||
      !isListSeparator(source.slice(previousEnd, start))
    ) {
      close();
    }

    current.push(member);
    previousEnd = start + match[0].length;
  }

  close();

  return runs;
}

function sourceFiles(root: string): Array<string> {
  const absoluteRoot: string = path.join(REPO_ROOT, root);

  if (!fs.existsSync(absoluteRoot)) {
    return [];
  }

  const files: Array<string> = [];
  const pending: Array<string> = [absoluteRoot];

  while (pending.length > 0) {
    const directory: string = pending.pop()!;

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (
          entry.name === "node_modules" ||
          entry.name === "build" ||
          entry.name === "dist" ||
          entry.name === "Tests"
        ) {
          continue;
        }

        pending.push(absolute);
        continue;
      }

      if (
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
        !entry.name.endsWith(".d.ts") &&
        !entry.name.includes(".test.")
      ) {
        files.push(path.relative(REPO_ROOT, absolute));
      }
    }
  }

  return files;
}

function describeRun(run: ListRun): string {
  return `${run.file}: ${run.members.join(", ")}`;
}

describe("no other file keeps its own copy of the metric-backed list", () => {
  const scanned: Array<string> = SCANNED_ROOTS.flatMap(sourceFiles).filter(
    (file: string): boolean => {
      return file !== HOME;
    },
  );

  const runs: Array<ListRun> = scanned.flatMap((file: string) => {
    return listRunsIn(
      file,
      fs.readFileSync(path.join(REPO_ROOT, file), "utf8"),
    );
  });

  test("the scan reads the code that used to keep copies", () => {
    for (const file of [
      "packages/Common/Server/Utils/Monitor/MonitorTemplateUtil.ts",
      "packages/Common/Server/Utils/Monitor/MonitorCriteriaEvaluator.ts",
      "packages/Common/Types/Monitor/MonitorCriteriaInstance.ts",
      "packages/Common/UI/Components/MonitorTemplateVariables/TemplateVariablesCatalog.ts",
      "packages/App/FeatureSet/Dashboard/src/Utils/MonitorStepViewModel.ts",
      "packages/App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter.ts",
      "packages/App/FeatureSet/Dashboard/src/Components/Form/Monitor/CriteriaFilters.tsx",
      "packages/App/FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor.ts",
    ]) {
      expect(scanned).toContain(file);
    }
  });

  test("finds every kind of list it is looking for", () => {
    const array: string = `[MonitorType.Metrics, MonitorType.Kubernetes, MonitorType.Docker, MonitorType.Host, MonitorType.Podman]`;
    const labels: string = `switch (t) {\n  case MonitorType.Ceph:\n  // a comment\n  case MonitorType.VMware:\n  case MonitorType.Proxmox:\n  case MonitorType.DockerSwarm:\n  case MonitorType.IoTDevice:\n    return 1;\n}`;
    const chain: string = `if (\n  input.monitor.monitorType === MonitorType.Metrics ||\n  input.monitor.monitorType === MonitorType.Host ||\n  input.monitor.monitorType === MonitorType.Ceph ||\n  input.monitor.monitorType === MonitorType.StorageArray ||\n  input.monitor.monitorType === MonitorType.IoTDevice\n) {}`;

    expect(listRunsIn("array.ts", array).length).toBe(1);
    expect(listRunsIn("labels.ts", labels).length).toBe(1);
    expect(listRunsIn("chain.ts", chain).length).toBe(1);
  });

  test("leaves alone types handled one by one, or a few together", () => {
    const oneByOne: string = `switch (t) {\n  case MonitorType.Metrics:\n    return a();\n  case MonitorType.Kubernetes:\n    return b();\n  case MonitorType.Docker:\n    return c();\n  case MonitorType.Host:\n    return d();\n  case MonitorType.Podman:\n    return e();\n}`;
    const fewTogether: string = `t === MonitorType.Docker || t === MonitorType.Podman`;
    const brokenByAnotherType: string = `[MonitorType.Metrics, MonitorType.Kubernetes, MonitorType.Logs, MonitorType.Docker, MonitorType.Host, MonitorType.Podman]`;

    expect(listRunsIn("one.ts", oneByOne)).toEqual([]);
    expect(listRunsIn("few.ts", fewTogether)).toEqual([]);
    expect(listRunsIn("broken.ts", brokenByAnotherType)).toEqual([]);
  });

  test("finds no copy but the deliberate ones", () => {
    const deliberate: Array<string> = NOT_COPIES.map(describeRun);

    expect(
      runs.map(describeRun).filter((run: string): boolean => {
        return !deliberate.includes(run);
      }),
    ).toEqual([]);
  });

  test("every deliberate list is still there, as written here", () => {
    const found: Array<string> = runs.map(describeRun);

    expect(
      NOT_COPIES.map(describeRun).filter((run: string): boolean => {
        return !found.includes(run);
      }),
    ).toEqual([]);
  });

  test("the readers that used to keep a copy read the helper", () => {
    for (const file of [
      "packages/Common/Server/Utils/Monitor/MonitorTemplateUtil.ts",
      "packages/Common/Server/Utils/Monitor/MonitorCriteriaEvaluator.ts",
      "packages/Common/UI/Components/MonitorTemplateVariables/TemplateVariablesCatalog.ts",
      "packages/App/FeatureSet/Dashboard/src/Utils/MonitorStepViewModel.ts",
      "packages/App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter.ts",
      "packages/Common/Types/Monitor/MonitorCriteriaInstance.ts",
    ]) {
      expect({
        file,
        readsHelper: fs
          .readFileSync(path.join(REPO_ROOT, file), "utf8")
          .includes("MonitorTypeHelper.isMetricBackedMonitor("),
      }).toEqual({ file, readsHelper: true });
    }

    expect(
      fs
        .readFileSync(
          path.join(
            REPO_ROOT,
            "packages/App/FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor.ts",
          ),
          "utf8",
        )
        .includes("MonitorTypeHelper.getTelemetryMonitorTypes()"),
    ).toBe(true);
  });

  test("the old second list on MonitorCriteriaInstance is gone", () => {
    expect(
      fs
        .readFileSync(
          path.join(
            REPO_ROOT,
            "packages/Common/Types/Monitor/MonitorCriteriaInstance.ts",
          ),
          "utf8",
        )
        .includes("isMetricBackedMonitorType"),
    ).toBe(false);
  });
});
