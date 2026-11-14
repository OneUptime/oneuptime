import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  HookFreeWrite,
  HookFreeWriteForm,
  HookFreeWriteScanner,
} from "../../../Helpers/HookFreeWriteScan";
import Alert from "../../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import { getColumnAccessControlForAllColumns } from "../../../../Types/Database/AccessControl/ColumnAccessControl";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * GUARD: every write that can open, for a monitor, a record its criteria
 * raised makes what the monitor knew of its open records unusable
 * (MonitorOpenRecords).
 *
 * A monitor result whose criteria opens nothing skips reading the monitor's
 * open incidents and alerts when MonitorOpenRecords says none is open that
 * a criteria raised - the read would only look for something to
 * auto-resolve. That is safe while every way such a record becomes open for
 * a monitor starts a new token:
 *
 *   - an incident's current state or its monitors written: IncidentService's
 *     onUpdateSuccess forgets the monitors of the incidents written
 *     (forgetMonitorsOfIncidents) - a reopen, through the state timeline,
 *     is such a write, and so is linking a monitor;
 *   - an alert's current state or its monitor written: AlertService's
 *     onUpdateSuccess, the same (forgetMonitorsOfAlerts);
 *   - a project's incident or alert states created, changed or deleted -
 *     which can make a state that counted as resolved count as open: the
 *     state services forget the project;
 *   - a record a criteria raises: MonitorIncident and MonitorAlert forget the
 *     monitor (and the service hook above does too).
 *
 * createdCriteriaId cannot be written through the API (create and update
 * are refused to every role), so only those writes matter. A write that goes
 * round DatabaseService's hooks - raw SQL, a *WithoutHooks statement, a
 * relation write, an ignoreHooks create - would start no token, and a
 * monitor could then skip reading a record it should resolve. This guard
 * finds every such write of those columns and tables (HookFreeWriteScanner)
 * and allows none, and reads that the hooks above are where they must be.
 */

// packages/Common/Tests/Server/Utils/Monitor -> packages/Common.
const COMMON_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");
const REPOSITORY_ROOT: string = path.resolve(COMMON_ROOT, "..", "..");

const SCAN_ROOTS: Array<string> = [
  path.join(COMMON_ROOT, "Server"),
  path.join(REPOSITORY_ROOT, "packages", "App", "FeatureSet"),
  path.join(REPOSITORY_ROOT, "ee", "Server"),
];

/*
 * The columns, by table, a write of which can open a record a criteria
 * raised for a monitor; "*" for a table any write of which can.
 */
const WATCHED: Readonly<Record<string, ReadonlyArray<string>>> = {
  Incident: [
    "currentIncidentStateId",
    "currentIncidentState",
    "monitors",
    "createdCriteriaId",
  ],
  Alert: [
    "currentAlertStateId",
    "currentAlertState",
    "monitorId",
    "monitor",
    "createdCriteriaId",
  ],
  IncidentMonitor: ["*"],
  IncidentState: ["*"],
  AlertState: ["*"],
};

// An assignment of a record's createdCriteriaId.
const SETS_CREATED_CRITERIA_ID: RegExp = /\.createdCriteriaId\s*=[^=]/;

// DatabaseService's hook-free methods that read rather than write.
const HOOK_FREE_READS: ReadonlySet<string> = new Set<string>([
  "hasRowWithIdWithoutHooks",
]);

let writes: Array<HookFreeWrite> = [];

function hookFreeWriteMethods(): Set<string> {
  const file: string = path.join(
    COMMON_ROOT,
    "Server/Services/DatabaseService.ts",
  );
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const methods: Set<string> = new Set<string>();

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isMethodDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text.endsWith("WithoutHooks") &&
      !HOOK_FREE_READS.has(node.name.text)
    ) {
      methods.add(node.name.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return methods;
}

// The table a write is of: the model it is made through, or the SQL's.
function tableOf(write: HookFreeWrite): string | null {
  if (write.modelFile) {
    return path.basename(write.modelFile, ".ts");
  }

  return write.tableName;
}

// Whether a write can open a record a criteria raised for a monitor.
function isWatched(write: HookFreeWrite): boolean {
  const table: string | null = tableOf(write);

  if (!table || !WATCHED[table]) {
    return false;
  }

  const watched: ReadonlyArray<string> = WATCHED[table]!;

  // A relation write names its relation; any other names columns, or not.
  if (watched.includes("*") || write.columns === null) {
    return true;
  }

  return write.columns.some((column: string): boolean => {
    return watched.includes(column);
  });
}

function read(relativeToCommon: string): string {
  return fs.readFileSync(path.join(COMMON_ROOT, relativeToCommon), "utf8");
}

// The body of a method of a class in `source`, by name.
function methodBody(source: string, name: string): string {
  const start: number = source.indexOf(`async ${name}(`);

  expect(start).toBeGreaterThan(-1);

  // Up to the next method declaration.
  const next: number = source
    .slice(start + 1)
    .search(/\n {2}(public|protected|private) /);

  return next === -1
    ? source.slice(start)
    : source.slice(start, start + 1 + next);
}

beforeAll(() => {
  const scanner: HookFreeWriteScanner = new HookFreeWriteScanner({
    repoRoot: REPOSITORY_ROOT,
    commonRoot: COMMON_ROOT,
    writeMethods: hookFreeWriteMethods(),
  });

  writes = scanner.scan(SCAN_ROOTS);
}, 600000);

describe("GUARD: what can open a record for a monitor tells MonitorOpenRecords", () => {
  test("the scan finds writes that go round the hooks at all", () => {
    expect(writes.length).toBeGreaterThan(50);
    expect(
      writes.some((write: HookFreeWrite): boolean => {
        return write.form === HookFreeWriteForm.RawSql;
      }),
    ).toBe(true);
  });

  test("no write round the hooks sets an incident's or alert's state, monitors or criteria, or a project's states", () => {
    const found: Array<string> = writes
      .filter(isWatched)
      .map((write: HookFreeWrite): string => {
        return `${write.file}:${write.line} ${write.inFunction} ${tableOf(write)} ${write.form} ${
          write.columns ? write.columns.join(",") : "(columns unknown)"
        }`;
      });

    expect(found).toEqual([]);
  });

  test("IncidentService forgets the monitors of an incident whose state or monitors are written", () => {
    const hook: string = methodBody(
      read("Server/Services/IncidentService.ts"),
      "onUpdateSuccess",
    );

    expect(hook).toMatch(
      /if \(\s*updatedIncidentStateId \|\|\s*Object\.prototype\.hasOwnProperty\.call\(onUpdate\.updateBy\.data, "monitors"\)\s*\) \{\s*await MonitorOpenRecords\.forgetMonitorsOfIncidents\(updatedItemIds\);/,
    );
    // The state is read under both of its names.
    expect(read("Server/Services/IncidentService.ts")).toContain(
      'const CURRENT_STATE_KEYS: Array<string> = [\n  "currentIncidentStateId",\n  "currentIncidentState",\n];',
    );
  });

  test("AlertService forgets the monitor of an alert whose state or monitor is written", () => {
    const source: string = read("Server/Services/AlertService.ts");
    const hook: string = methodBody(source, "onUpdateSuccess");

    expect(hook).toMatch(
      /\[\.\.\.ALERT_STATE_KEYS, \.\.\.ALERT_MONITOR_KEYS\]\.some\([\s\S]*?\)\s*\) \{\s*await MonitorOpenRecords\.forgetMonitorsOfAlerts\(updatedItemIds\);/,
    );
    expect(source).toContain(
      'const ALERT_MONITOR_KEYS: Array<string> = ["monitorId", "monitor"];',
    );
    expect(source).toContain(
      'const ALERT_STATE_KEYS: Array<string> = [\n  "currentAlertStateId",\n  "currentAlertState",',
    );
  });

  test.each(["IncidentStateService", "AlertStateService"])(
    "%s forgets the project on every create, update and delete of a state",
    (service: string) => {
      const source: string = read(`Server/Services/${service}.ts`);

      expect(methodBody(source, "onCreateSuccess")).toContain(
        "await this.forgetProjects([createdItem.projectId]);",
      );
      expect(methodBody(source, "onUpdateSuccess")).toContain(
        "await this.forgetProjectsOf(updatedItemIds);",
      );
      expect(methodBody(source, "onDeleteSuccess")).toContain(
        "await this.forgetProjectsOf(itemIdsBeforeDelete);",
      );
      expect(methodBody(source, "forgetProjects")).toContain(
        "await MonitorOpenRecords.forgetProject(projectId);",
      );
      // Projects that cannot be read: nothing known counts anywhere.
      expect(methodBody(source, "forgetProjectsOf")).toContain(
        "await MonitorOpenRecords.forgetAll();",
      );
    },
  );

  test.each([
    ["MonitorIncident", "IncidentService.create(createBy)"],
    ["MonitorAlert", "AlertService.create(createBy)"],
  ])(
    "%s forgets the monitor right after it raises a record",
    (util: string, create: string) => {
      const source: string = read(`Server/Utils/Monitor/${util}.ts`);
      const createdAt: number = source.indexOf(create);

      expect(createdAt).toBeGreaterThan(-1);

      const after: string = source.slice(createdAt, createdAt + 1200);

      expect(after).toContain(
        "await MonitorOpenRecords.forgetMonitors([input.monitor.id]);",
      );
    },
  );

  test.each([
    ["Incident", Incident],
    ["Alert", Alert],
  ] as Array<[string, { new (): BaseModel }]>)(
    "nobody may write %s.createdCriteriaId through the API",
    (_name: string, modelType: { new (): BaseModel }) => {
      const access: { create: Array<unknown>; update: Array<unknown> } =
        getColumnAccessControlForAllColumns(new modelType())[
          "createdCriteriaId"
        ] as unknown as { create: Array<unknown>; update: Array<unknown> };

      expect(access.create).toEqual([]);
      expect(access.update).toEqual([]);
    },
  );

  test("only MonitorIncident and MonitorAlert set createdCriteriaId", () => {
    const setters: Array<string> = [];

    for (const root of SCAN_ROOTS) {
      if (!fs.existsSync(root)) {
        continue;
      }

      const stack: Array<string> = [root];

      while (stack.length > 0) {
        const directory: string = stack.pop()!;

        for (const entry of fs.readdirSync(directory, {
          withFileTypes: true,
        })) {
          const full: string = path.join(directory, entry.name);

          if (entry.isDirectory()) {
            if (entry.name !== "node_modules" && !entry.name.startsWith(".")) {
              stack.push(full);
            }
            continue;
          }

          if (
            !entry.name.endsWith(".ts") ||
            full.includes("SchemaMigrations")
          ) {
            continue;
          }

          if (SETS_CREATED_CRITERIA_ID.test(fs.readFileSync(full, "utf8"))) {
            setters.push(path.relative(REPOSITORY_ROOT, full));
          }
        }
      }
    }

    expect(setters.sort()).toEqual([
      "packages/Common/Server/Utils/Monitor/MonitorAlert.ts",
      "packages/Common/Server/Utils/Monitor/MonitorIncident.ts",
    ]);
  });
});
