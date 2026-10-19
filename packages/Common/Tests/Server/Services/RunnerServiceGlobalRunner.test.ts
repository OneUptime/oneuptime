import RunnerService, {
  GLOBAL_RUNNER_CAPABILITY_MESSAGE,
  GLOBAL_RUNNER_CHANGED_MESSAGE,
  GLOBAL_RUNNER_IN_A_PROJECT_MESSAGE,
  GLOBAL_RUNNER_PUBLIC_SELECT,
  RUNNER_WITHOUT_PROJECT_MESSAGE,
  Service as RunnerServiceClass,
} from "../../../Server/Services/RunnerService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import Runner from "../../../Models/DatabaseModels/Runner";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import {
  stubGenericReferenceCheck,
  stubProjectDirectory,
} from "../TestingUtils/ProjectDirectory";
import { stubRowsCallerMayWrite } from "../TestingUtils/RowsCallerMayWrite";

/*
 * A global Runner is one the OneUptime server runs for every project: no
 * project owns it, only OneUptime or a master admin creates it, and it runs
 * runbook steps only. RunnerService holds every row to that shape:
 *
 *   - a Runner is a project's own (projectId) or global - never both, never
 *     neither;
 *   - a global Runner's code-fix and AI-command capabilities stay off;
 *   - whether a Runner is global, and its project, are never rewritten
 *     (root and master admins included);
 *   - the global Runners every project reads are the public columns only.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const GLOBAL_RUNNER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

interface HookAccess {
  onBeforeCreate(createBy: CreateBy<Runner>): Promise<OnCreate<Runner>>;
  onBeforeUpdate(updateBy: UpdateBy<Runner>): Promise<OnUpdate<Runner>>;
}

const hooks: HookAccess = RunnerService as unknown as HookAccess;

function masterAdminProps(): DatabaseCommonInteractionProps {
  return {
    userId: ObjectID.generate(),
    isMasterAdmin: true,
  } as DatabaseCommonInteractionProps;
}

function rootProps(): DatabaseCommonInteractionProps {
  return { isRoot: true } as DatabaseCommonInteractionProps;
}

function editorProps(): DatabaseCommonInteractionProps {
  return {
    userId: ObjectID.generate(),
    tenantId: PROJECT_ID,
  } as DatabaseCommonInteractionProps;
}

function globalRunner(overrides: Partial<Record<string, unknown>> = {}): Runner {
  const runner: Runner = new Runner();
  runner.name = "global-runner-eu";
  runner.isGlobalRunner = true;
  Object.assign(runner, overrides);
  return runner;
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

describe("holdToGlobalRunnerShape: a Runner is a project's own, or global", () => {
  it("a global Runner has no project", () => {
    const runner: Runner = globalRunner();

    expect(() => {
      RunnerServiceClass.holdToGlobalRunnerShape(runner);
    }).not.toThrow();
  });

  it("refuses a global Runner in a project, by id, by relation or by the tenant it is created in", () => {
    expect(() => {
      RunnerServiceClass.holdToGlobalRunnerShape(
        globalRunner({ projectId: PROJECT_ID }),
      );
    }).toThrow(GLOBAL_RUNNER_IN_A_PROJECT_MESSAGE);

    expect(() => {
      RunnerServiceClass.holdToGlobalRunnerShape(
        globalRunner({ project: { _id: PROJECT_ID.toString() } }),
      );
    }).toThrow(GLOBAL_RUNNER_IN_A_PROJECT_MESSAGE);

    expect(() => {
      RunnerServiceClass.holdToGlobalRunnerShape(globalRunner(), PROJECT_ID);
    }).toThrow(GLOBAL_RUNNER_IN_A_PROJECT_MESSAGE);
  });

  it("refuses a global Runner that would run AI code fixes or AI remediation commands", () => {
    expect(() => {
      RunnerServiceClass.holdToGlobalRunnerShape(
        globalRunner({ canRunCodeFixTasks: true }),
      );
    }).toThrow(GLOBAL_RUNNER_CAPABILITY_MESSAGE);

    expect(() => {
      RunnerServiceClass.holdToGlobalRunnerShape(
        globalRunner({ canRunAiCommands: true }),
      );
    }).toThrow(GLOBAL_RUNNER_CAPABILITY_MESSAGE);
  });

  it("writes a global Runner's capabilities off, and runbook steps on unless said", () => {
    const runner: Runner = globalRunner();

    RunnerServiceClass.holdToGlobalRunnerShape(runner);

    expect(runner.canRunCodeFixTasks).toBe(false);
    expect(runner.canRunAiCommands).toBe(false);
    expect(runner.canRunRunbooks).toBe(true);
  });

  it("keeps a global Runner created paused (Runs Runbooks off) paused", () => {
    const runner: Runner = globalRunner({ canRunRunbooks: false });

    RunnerServiceClass.holdToGlobalRunnerShape(runner);

    expect(runner.canRunRunbooks).toBe(false);
  });

  it("refuses a Runner of no project that is not global", () => {
    expect(() => {
      RunnerServiceClass.holdToGlobalRunnerShape(new Runner());
    }).toThrow(RUNNER_WITHOUT_PROJECT_MESSAGE);
  });

  it("negative control: a project's Runner, by id, relation or tenant, passes and keeps its capabilities", () => {
    const byId: Runner = new Runner();
    byId.projectId = PROJECT_ID;
    byId.canRunCodeFixTasks = true;
    byId.canRunAiCommands = true;

    RunnerServiceClass.holdToGlobalRunnerShape(byId);
    expect(byId.canRunCodeFixTasks).toBe(true);
    expect(byId.canRunAiCommands).toBe(true);

    const byTenant: Runner = new Runner();
    expect(() => {
      RunnerServiceClass.holdToGlobalRunnerShape(byTenant, PROJECT_ID);
    }).not.toThrow();
  });
});

describe("assertNotMovedInOrOutOfGlobal", () => {
  it.each([
    [{ isGlobalRunner: true }],
    [{ isGlobalRunner: false }],
    [{ projectId: PROJECT_ID }],
    [{ project: { _id: PROJECT_ID.toString() } }],
    [{ projectId: null }],
  ])("refuses an update that writes %p", (data: Record<string, unknown>) => {
    expect(() => {
      RunnerServiceClass.assertNotMovedInOrOutOfGlobal(data);
    }).toThrow(GLOBAL_RUNNER_CHANGED_MESSAGE);
  });

  it("negative control: an update of anything else, or of those as undefined, passes", () => {
    for (const data of [
      { name: "renamed" },
      { description: "x", canRunRunbooks: false },
      { isGlobalRunner: undefined, projectId: undefined },
      {},
      null,
      undefined,
    ]) {
      expect(() => {
        RunnerServiceClass.assertNotMovedInOrOutOfGlobal(data);
      }).not.toThrow();
    }
  });
});

describe("RunnerService's create hook", () => {
  it("a master admin creates a global Runner of no project: a key is made, capabilities held", async () => {
    const created: OnCreate<Runner> = await hooks.onBeforeCreate({
      data: globalRunner(),
      props: masterAdminProps(),
    } as CreateBy<Runner>);

    const data: Runner = created.createBy.data;

    expect(data.isGlobalRunner).toBe(true);
    expect(data.projectId).toBeUndefined();
    expect(typeof data.key).toBe("string");
    expect((data.key as string).length).toBeGreaterThan(20);
    expect(data.canRunCodeFixTasks).toBe(false);
    expect(data.canRunAiCommands).toBe(false);
    expect(data.canRunRunbooks).toBe(true);
  });

  it("refuses a global Runner created inside a project", async () => {
    const message: string = await refusal(
      hooks.onBeforeCreate({
        data: globalRunner({ projectId: PROJECT_ID }),
        props: masterAdminProps(),
      } as CreateBy<Runner>),
    );

    expect(message).toBe(GLOBAL_RUNNER_IN_A_PROJECT_MESSAGE);
  });

  it("refuses a global Runner that runs AI code fixes", async () => {
    await refusal(
      hooks.onBeforeCreate({
        data: globalRunner({ canRunCodeFixTasks: true }),
        props: masterAdminProps(),
      } as CreateBy<Runner>),
    );
  });

  it("refuses a Runner of no project that is not global, root included", async () => {
    const runner: Runner = new Runner();
    runner.name = "orphan";

    const message: string = await refusal(
      hooks.onBeforeCreate({
        data: runner,
        props: rootProps(),
      } as CreateBy<Runner>),
    );

    expect(message).toBe(RUNNER_WITHOUT_PROJECT_MESSAGE);
  });

  it("negative control: a project member's create, stamped with its project, passes", async () => {
    const runner: Runner = new Runner();
    runner.name = "office-runner";

    await expect(
      hooks.onBeforeCreate({
        data: runner,
        props: editorProps(),
      } as CreateBy<Runner>),
    ).resolves.toBeDefined();
  });
});

describe("RunnerService's update hook", () => {
  let rows: Array<Runner>;

  beforeEach(() => {
    const row: Runner = new Runner();
    row._id = GLOBAL_RUNNER_ID.toString();
    row.name = "global-runner-eu";
    row.isGlobalRunner = true;
    rows = [row];

    jest
      .spyOn(RunnerService, "findBy")
      .mockImplementation(async (): Promise<Array<Runner>> => {
        return rows;
      });
    stubRowsCallerMayWrite(RunnerService, () => {
      return rows;
    });
  });

  function update(
    data: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
  ): UpdateBy<Runner> {
    return {
      query: { _id: GLOBAL_RUNNER_ID.toString() },
      data: data as unknown as Runner,
      limit: 1,
      skip: 0,
      props,
    } as unknown as UpdateBy<Runner>;
  }

  it.each([
    [{ canRunCodeFixTasks: true }],
    [{ canRunAiCommands: true }],
  ])(
    "refuses a master admin turning on %p for a global Runner",
    async (data: Record<string, unknown>) => {
      const message: string = await refusal(
        hooks.onBeforeUpdate(update(data, masterAdminProps())),
      );

      expect(message).toBe(GLOBAL_RUNNER_CAPABILITY_MESSAGE);
    },
  );

  it.each([
    [{ isGlobalRunner: false }],
    [{ projectId: PROJECT_ID }],
  ])(
    "refuses writing %p, root included",
    async (data: Record<string, unknown>) => {
      expect(await refusal(hooks.onBeforeUpdate(update(data, rootProps())))).toBe(
        GLOBAL_RUNNER_CHANGED_MESSAGE,
      );
      expect(
        await refusal(hooks.onBeforeUpdate(update(data, masterAdminProps()))),
      ).toBe(GLOBAL_RUNNER_CHANGED_MESSAGE);
    },
  );

  it("negative control: a master admin renames a global Runner, describes it and pauses it", async () => {
    await expect(
      hooks.onBeforeUpdate(
        update(
          {
            name: "global-runner-eu-2",
            description: "Runs JavaScript steps for every project.",
            canRunRunbooks: false,
          },
          masterAdminProps(),
        ),
      ),
    ).resolves.toBeDefined();
  });

  it("negative control: a heartbeat (root) writes a global Runner's liveness", async () => {
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

describe("the global Runners every project reads", () => {
  it("hasGlobalRunnerForRunbooks counts the global Runners that take runbook steps, as OneUptime", async () => {
    const countBy: jest.SpyInstance = jest
      .spyOn(RunnerService, "countBy")
      .mockResolvedValue(new PositiveNumber(2));

    await expect(RunnerService.hasGlobalRunnerForRunbooks()).resolves.toBe(
      true,
    );

    const args: {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = countBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    };

    expect(args.query).toEqual({ isGlobalRunner: true, canRunRunbooks: true });
    expect(args.props.isRoot).toBe(true);

    countBy.mockResolvedValue(new PositiveNumber(0));
    await expect(RunnerService.hasGlobalRunnerForRunbooks()).resolves.toBe(
      false,
    );
  });

  it("findGlobalRunners reads the global Runners with the public columns only", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(RunnerService, "findBy")
      .mockResolvedValue([]);

    await RunnerService.findGlobalRunners();

    const args: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = findBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    };

    expect(args.query).toEqual({ isGlobalRunner: true });
    expect(args.select).toBe(GLOBAL_RUNNER_PUBLIC_SELECT);
    expect(args.props.isRoot).toBe(true);
  });

  it("the public columns never include the key, the host or the version", () => {
    expect(Object.keys(GLOBAL_RUNNER_PUBLIC_SELECT).sort()).toEqual(
      [
        "_id",
        "canRunRunbooks",
        "description",
        "isGlobalRunner",
        "lastAlive",
        "name",
      ].sort(),
    );

    for (const secret of [
      "key",
      "hostInfo",
      "agentVersion",
      "createdByUserId",
      "projectId",
    ]) {
      expect(GLOBAL_RUNNER_PUBLIC_SELECT).not.toHaveProperty(secret);
    }
  });

  it("findByIdAndKey reads whether the Runner is global, so the claim path can tell", async () => {
    const findOneBy: jest.SpyInstance = jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue(null);

    await RunnerService.findByIdAndKey({
      agentId: GLOBAL_RUNNER_ID,
      agentKey: "a-long-random-runner-key-0123456789abcdef",
    });

    const args: { select: Record<string, unknown> } = findOneBy.mock
      .calls[0]![0] as { select: Record<string, unknown> };

    expect(args.select["isGlobalRunner"]).toBe(true);
    expect(args.select["projectId"]).toBe(true);
  });
});
