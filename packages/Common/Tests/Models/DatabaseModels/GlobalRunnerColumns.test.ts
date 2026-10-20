import Project from "../../../Models/DatabaseModels/Project";
import RunbookVariable from "../../../Models/DatabaseModels/RunbookVariable";
import Runner from "../../../Models/DatabaseModels/Runner";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Permission from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * The columns global Runners are made of, and who may write them:
 *
 *   - Runner.isGlobalRunner: nobody but OneUptime or a master admin (no
 *     column create or update permission), default false;
 *   - Runner.projectId: no longer required - a global Runner has none;
 *   - RunnerJob.runsOnGlobalRunner: the server's own, default false;
 *   - RunbookVariable.isAvailableToGlobalRunners: whoever may write the
 *     variable, default false - a secret reaches a global Runner only when
 *     someone says so (runbook secrets became runbook variables);
 *   - Project.useGlobalRunners: a project admin's switch, on by default.
 */

interface ColumnFacts {
  type: TableColumnType;
  required: boolean;
  defaultValue: unknown;
  isDefaultValueColumn: boolean;
  access: ColumnAccessControl | undefined;
}

function factsOf(model: DatabaseBaseModel, column: string): ColumnFacts {
  const metadata: {
    type: TableColumnType;
    required?: boolean;
    defaultValue?: unknown;
    isDefaultValueColumn?: boolean;
  } = model.getTableColumnMetadata(column) as {
    type: TableColumnType;
    required?: boolean;
    defaultValue?: unknown;
    isDefaultValueColumn?: boolean;
  };

  expect(metadata).toBeDefined();

  return {
    type: metadata.type,
    required: Boolean(metadata.required),
    defaultValue: metadata.defaultValue,
    isDefaultValueColumn: Boolean(metadata.isDefaultValueColumn),
    access: model.getColumnAccessControlFor(column) || undefined,
  };
}

describe("Runner.isGlobalRunner", () => {
  const facts: ColumnFacts = factsOf(new Runner(), "isGlobalRunner");

  test("is a boolean that is false unless OneUptime or a master admin says otherwise", () => {
    expect(facts.type).toBe(TableColumnType.Boolean);
    expect(facts.defaultValue).toBe(false);
    expect(facts.isDefaultValueColumn).toBe(true);
  });

  test("no project role may create or change it", () => {
    expect(facts.access?.create).toEqual([]);
    expect(facts.access?.update).toEqual([]);
  });

  test("whoever may read a project's Runners may read it", () => {
    expect(facts.access?.read).toEqual(
      expect.arrayContaining([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.RunbookAdmin,
        Permission.ReadRunner,
      ]),
    );
  });
});

describe("Runner.projectId", () => {
  test("is no longer required: a global Runner belongs to no project", () => {
    expect(factsOf(new Runner(), "projectId").required).toBe(false);
    expect(new Runner().getRequiredColumns().columns).not.toContain(
      "projectId",
    );
  });

  test("is still the Runner table's tenant column", () => {
    expect(new Runner().getTenantColumn()).toBe("projectId");
  });
});

describe("RunnerJob.runsOnGlobalRunner", () => {
  const facts: ColumnFacts = factsOf(new RunnerJob(), "runsOnGlobalRunner");

  test("is a boolean, false by default: a job waits for one Runner unless written for the global ones", () => {
    expect(facts.type).toBe(TableColumnType.Boolean);
    expect(facts.defaultValue).toBe(false);
  });

  test("is the server's own: nobody creates or changes it through the API", () => {
    expect(facts.access?.create).toEqual([]);
    expect(facts.access?.update).toEqual([]);
  });
});

describe("RunbookVariable.isAvailableToGlobalRunners", () => {
  const facts: ColumnFacts = factsOf(
    new RunbookVariable(),
    "isAvailableToGlobalRunners",
  );

  test("is false by default: a secret reaches a global Runner only when someone says so", () => {
    expect(facts.type).toBe(TableColumnType.Boolean);
    expect(facts.defaultValue).toBe(false);
  });

  test("whoever may create or edit the variable may set it, and nobody else", () => {
    expect(facts.access?.create).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookSecret,
    ]);
    expect(facts.access?.update).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookSecret,
    ]);
  });
});

describe("Project.useGlobalRunners", () => {
  const facts: ColumnFacts = factsOf(new Project(), "useGlobalRunners");

  test("is on by default, like global probes", () => {
    expect(facts.type).toBe(TableColumnType.Boolean);
    expect(facts.defaultValue).toBe(true);
    expect(facts.isDefaultValueColumn).toBe(true);
  });

  test("a project admin turns it off or on, as with the global probes switch", () => {
    expect(facts.access?.update).toEqual(
      factsOf(new Project(), "doNotAddGlobalProbesByDefaultOnNewMonitors")
        .access?.update,
    );
    expect(facts.access?.update).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProject,
    ]);
  });

  test("every project member may read it, so the step editor can say what a step runs on", () => {
    expect(facts.access?.read).toEqual(
      expect.arrayContaining([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.Viewer,
        Permission.ProjectUser,
      ]),
    );
  });
});
