import RunnerService, {
  Service as RunnerServiceClass,
} from "../../../Server/Services/RunnerService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import Runner from "../../../Models/DatabaseModels/Runner";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import {
  stubGenericReferenceCheck,
  stubProjectDirectory,
} from "../TestingUtils/ProjectDirectory";
import { stubRowsCallerMayWrite } from "../TestingUtils/RowsCallerMayWrite";

/*
 * THE PROJECT'S DEFAULT RUNNER, AS RUNNERSERVICE KEEPS IT.
 *
 * A project makes one of its own Runners its default (Runner.isProjectDefault):
 * the runbook steps that pick no Runner run on it. RunnerService keeps it a
 * Runner that can run them (Types/Runner/ProjectDefaultRunner):
 *
 *   - a write that makes a global Runner, the in-cluster Runner the
 *     Kubernetes agent chart installed, or one with Runs Runbooks off the
 *     default is refused, saying why - create or update, root included for
 *     a create;
 *   - an update that turns Runs Runbooks off for the default, and leaves it
 *     the default, is refused: the steps that pick no Runner run on it;
 *   - and the rule reads the default through findProjectDefaultRunner, as
 *     OneUptime, passing over a stored default that may not be it.
 *
 * Taking the default from the project's other Runners, once the write
 * succeeded, is ProjectDefaultRow's; ProjectDefaultRowWrites.test.ts drives
 * it through the real create and update for RunnerService too.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

interface HookAccess {
  onBeforeCreate(createBy: CreateBy<Runner>): Promise<OnCreate<Runner>>;
  onBeforeUpdate(updateBy: UpdateBy<Runner>): Promise<OnUpdate<Runner>>;
}

const hooks: HookAccess = RunnerService as unknown as HookAccess;

// Someone who edits the project's Runners (a Runbook Admin).
function editorProps(): DatabaseCommonInteractionProps {
  return {
    userId: ObjectID.generate(),
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [Permission.RunbookAdmin, Permission.ProjectUser].map(
          (permission: Permission) => {
            return {
              _type: "UserPermission",
              permission,
              labelIds: [],
              isBlockPermission: false,
            };
          },
        ),
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

function masterAdminProps(): DatabaseCommonInteractionProps {
  return {
    userId: ObjectID.generate(),
    isMasterAdmin: true,
  } as DatabaseCommonInteractionProps;
}

function rootProps(): DatabaseCommonInteractionProps {
  return { isRoot: true } as DatabaseCommonInteractionProps;
}

function runner(overrides: Partial<Record<string, unknown>> = {}): Runner {
  const row: Runner = new Runner();
  row._id = RUNNER_ID.toString();
  row.name = "prod-eu-west-1";
  row.projectId = PROJECT_ID;
  row.isGlobalRunner = false;
  row.canRunRunbooks = true;
  Object.assign(row, overrides);
  return row;
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("expected the write to be refused");
}

beforeEach(() => {
  stubProjectDirectory({});
  stubGenericReferenceCheck();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("assertMayBeProjectDefault", () => {
  it("lets one of the project's own Runners that runs runbooks be the default", () => {
    expect(() => {
      RunnerServiceClass.assertMayBeProjectDefault({
        isProjectDefault: true,
        name: "prod-eu-west-1",
        canRunRunbooks: true,
      });
    }).not.toThrow();
  });

  it("asks nothing of a Runner that is not written as the default", () => {
    for (const isProjectDefault of [false, undefined]) {
      expect(() => {
        RunnerServiceClass.assertMayBeProjectDefault({
          isProjectDefault,
          isGlobalRunner: true,
          canRunRunbooks: false,
          name: "kubernetes-agent/prod-us",
        });
      }).not.toThrow();
    }
  });

  it.each([
    [
      "a global Runner",
      { isGlobalRunner: true, name: "Global Runner" },
      '"Global Runner" is a global Runner, which belongs to no project',
    ],
    [
      "the agent chart's Runner, by name",
      { name: "kubernetes-agent/prod-us" },
      "is the in-cluster Runner the Kubernetes agent chart installed",
    ],
    [
      "the agent chart's Runner, by posture",
      {
        name: "renamed",
        hostInfo: {
          kubernetes: { inCluster: true, clusterIdentifier: "prod-ap" },
        },
      },
      "is the in-cluster Runner the Kubernetes agent chart installed",
    ],
    [
      "a Runner with Runs Runbooks off",
      { name: "office-runner", canRunRunbooks: false },
      '"office-runner" does not run runbooks',
    ],
  ])(
    "refuses %s, saying why",
    (_label: string, row: Record<string, unknown>, words: string) => {
      let message: string = "";

      try {
        RunnerServiceClass.assertMayBeProjectDefault({
          isProjectDefault: true,
          ...row,
        });
      } catch (error) {
        expect(error).toBeInstanceOf(BadDataException);
        message = (error as Error).message;
      }

      expect(message).toContain(words);
    },
  );
});

describe("RunnerService's create hook", () => {
  it("a Runner created as the project's default passes", async () => {
    const data: Runner = runner({ isProjectDefault: true });
    data._id = undefined as never;

    const created: OnCreate<Runner> = await hooks.onBeforeCreate({
      data,
      props: editorProps(),
    } as CreateBy<Runner>);

    expect(created.createBy.data.isProjectDefault).toBe(true);
  });

  it("a Runner created as the default with Runs Runbooks off is refused, root included", async () => {
    for (const props of [editorProps(), rootProps()]) {
      expect(
        await refusal(
          hooks.onBeforeCreate({
            data: runner({ isProjectDefault: true, canRunRunbooks: false }),
            props,
          } as CreateBy<Runner>),
        ),
      ).toContain("does not run runbooks");
    }
  });

  it("a global Runner created as a project's default is refused", async () => {
    const data: Runner = new Runner();
    data.name = "global-runner-eu";
    data.isGlobalRunner = true;
    data.isProjectDefault = true;

    expect(
      await refusal(
        hooks.onBeforeCreate({
          data,
          props: masterAdminProps(),
        } as CreateBy<Runner>),
      ),
    ).toContain("belongs to no project");
  });

  it("a Runner created without a word on the default is not made one: no Runner is the default by itself", async () => {
    const data: Runner = runner();

    const created: OnCreate<Runner> = await hooks.onBeforeCreate({
      data,
      props: editorProps(),
    } as CreateBy<Runner>);

    // Left to the column's default, off.
    expect(created.createBy.data.isProjectDefault).toBeUndefined();
    expect(
      new Runner().getTableColumnMetadata("isProjectDefault").defaultValue,
    ).toBe(false);
  });
});

describe("RunnerService's update hook", () => {
  let rows: Array<Runner>;

  function stubRows(row: Runner): void {
    rows = [row];

    jest
      .spyOn(RunnerService, "findBy")
      .mockImplementation(async (): Promise<Array<Runner>> => {
        return rows;
      });
    stubRowsCallerMayWrite(RunnerService, () => {
      return rows;
    });
  }

  function update(
    data: Record<string, unknown>,
    props: DatabaseCommonInteractionProps = editorProps(),
  ): UpdateBy<Runner> {
    return {
      query: { _id: RUNNER_ID.toString() },
      data: data as unknown as Runner,
      limit: 1,
      skip: 0,
      props,
    } as unknown as UpdateBy<Runner>;
  }

  it("makes one of the project's own Runners that runs runbooks the default", async () => {
    stubRows(runner());

    await expect(
      hooks.onBeforeUpdate(update({ isProjectDefault: true })),
    ).resolves.toBeDefined();
  });

  it("refuses making a Runner with Runs Runbooks off the default", async () => {
    stubRows(runner({ name: "office-runner", canRunRunbooks: false }));

    expect(
      await refusal(hooks.onBeforeUpdate(update({ isProjectDefault: true }))),
    ).toBe(
      '"office-runner" does not run runbooks, so it cannot be the project\'s default Runner. Turn on Runs Runbooks for it first.',
    );
  });

  it("lets the same update turn Runs Runbooks on and make it the default", async () => {
    stubRows(runner({ name: "office-runner", canRunRunbooks: false }));

    await expect(
      hooks.onBeforeUpdate(
        update({ isProjectDefault: true, canRunRunbooks: true }),
      ),
    ).resolves.toBeDefined();
  });

  it.each([
    ["by name", { name: "kubernetes-agent/prod-us" }],
    [
      "by posture",
      {
        name: "renamed-in-cluster-runner",
        hostInfo: {
          kubernetes: { inCluster: true, clusterIdentifier: "prod-ap" },
        },
      },
    ],
  ])(
    "refuses making the agent chart's in-cluster Runner the default (%s)",
    async (_label: string, row: Record<string, unknown>) => {
      stubRows(runner({ ...row, canRunRunbooks: false }));

      expect(
        await refusal(
          hooks.onBeforeUpdate(update({ isProjectDefault: true })),
        ),
      ).toContain("runs kubectl for its own cluster only");
    },
  );

  it("refuses a master admin making a global Runner a project's default", async () => {
    stubRows(
      runner({
        name: "global-runner-eu",
        isGlobalRunner: true,
        projectId: undefined,
      }),
    );

    expect(
      await refusal(
        hooks.onBeforeUpdate(
          update({ isProjectDefault: true }, masterAdminProps()),
        ),
      ),
    ).toContain("belongs to no project");
  });

  it("refuses turning Runs Runbooks off for the default while it stays the default", async () => {
    stubRows(runner({ isProjectDefault: true }));

    expect(
      await refusal(hooks.onBeforeUpdate(update({ canRunRunbooks: false }))),
    ).toBe(
      '"prod-eu-west-1" is the project\'s default Runner: the runbook steps that pick no Runner run on it, so Runs Runbooks stays on. Make another Runner the default, or stop using this one as the default, first.',
    );
  });

  it("lets an update stop using a Runner as the default and turn Runs Runbooks off together", async () => {
    stubRows(runner({ isProjectDefault: true }));

    await expect(
      hooks.onBeforeUpdate(
        update({ isProjectDefault: false, canRunRunbooks: false }),
      ),
    ).resolves.toBeDefined();
  });

  it("negative control: Runs Runbooks turned off for a Runner that is not the default", async () => {
    stubRows(runner({ isProjectDefault: false }));

    await expect(
      hooks.onBeforeUpdate(update({ canRunRunbooks: false })),
    ).resolves.toBeDefined();
  });

  it("negative control: stopping using a Runner as the default asks nothing", async () => {
    stubRows(runner({ isProjectDefault: true, canRunRunbooks: false }));

    await expect(
      hooks.onBeforeUpdate(update({ isProjectDefault: false })),
    ).resolves.toBeDefined();
  });

  it("negative control: the Runner form re-posting the switch as it is saves, for the default too", async () => {
    stubRows(runner({ isProjectDefault: true }));

    await expect(
      hooks.onBeforeUpdate(
        update({
          name: "prod-eu-west-1",
          description: "Production VPC.",
          canRunRunbooks: true,
        }),
      ),
    ).resolves.toBeDefined();
  });

  it("negative control: a heartbeat (root) is the server's own and asks nothing", async () => {
    stubRows(runner({ isProjectDefault: true }));

    await expect(
      hooks.onBeforeUpdate(
        update(
          { lastAlive: new Date(), connectionStatus: "connected" },
          rootProps(),
        ),
      ),
    ).resolves.toBeDefined();
  });
});

describe("findProjectDefaultRunner", () => {
  function stubDefault(row: Runner | null): jest.SpyInstance {
    return jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue(row as never);
  }

  it("reads the project's default as OneUptime, with what decides whether it may be it", async () => {
    const findOneBy: jest.SpyInstance = stubDefault(
      runner({ isProjectDefault: true }),
    );

    const found: Runner | null =
      await RunnerService.findProjectDefaultRunner(PROJECT_ID);

    expect(found?._id?.toString()).toBe(RUNNER_ID.toString());

    const args: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = findOneBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    };

    expect(args.query).toEqual({
      projectId: PROJECT_ID,
      isProjectDefault: true,
    });
    for (const column of [
      "_id",
      "name",
      "isGlobalRunner",
      "canRunRunbooks",
      "hostInfo",
    ]) {
      expect(args.select[column]).toBe(true);
    }
    expect(args.props.isRoot).toBe(true);
  });

  it("answers none when the project has none", async () => {
    stubDefault(null);

    await expect(
      RunnerService.findProjectDefaultRunner(PROJECT_ID),
    ).resolves.toBeNull();
  });

  it.each([
    ["Runs Runbooks off", { canRunRunbooks: false }],
    ["the agent chart's in-cluster Runner", { name: "kubernetes-agent/x" }],
    ["a global Runner", { isGlobalRunner: true }],
  ])(
    "passes over a stored default that may not be it (%s): the step goes on by the default order",
    async (_label: string, row: Record<string, unknown>) => {
      stubDefault(runner({ isProjectDefault: true, ...row }));

      await expect(
        RunnerService.findProjectDefaultRunner(PROJECT_ID),
      ).resolves.toBeNull();
    },
  );
});
