import Project from "../../../../Models/DatabaseModels/Project";
import Runner from "../../../../Models/DatabaseModels/Runner";
import ProjectService from "../../../../Server/Services/ProjectService";
import RunnerService from "../../../../Server/Services/RunnerService";
import GlobalRunnerChoice from "../../../../Server/Utils/Runner/GlobalRunnerChoice";
import ObjectID from "../../../../Types/ObjectID";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import {
  ChosenRunnerKind,
  GLOBAL_RUNNER_CHOICE_ID,
  RunnerChoiceDecision,
  RunnerChoiceRefusal,
  RunnerDefaultOrderResult,
  RunnerSource,
} from "../../../../Types/Runner/RunnerChoice";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The server side of the one rule, in its default order: it reads the
 * facts as OneUptime - the Runner a step picked (held to the step's
 * project), the project's default Runner, the project's switch, whether the
 * server has a global Runner - and asks the rule. It reads only what decides
 * the step: a pick of the project's own needs nothing else, the project's
 * default is read only for a step that picked none, and the switch and the
 * global Runners only for a step that ends up on them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROJECT_RUNNER_ID: string = "33333333-3333-4333-8333-333333333333";
const GLOBAL_RUNNER_ID: string = "44444444-4444-4444-8444-444444444444";
const DEFAULT_RUNNER_ID: string = "55555555-5555-4555-8555-555555555555";

let runners: Map<string, Runner>;
let usesGlobalRunners: boolean | undefined;
let projectExists: boolean;
let hasGlobalRunner: boolean;
// The project's default Runner, as RunnerService.findProjectDefaultRunner answers.
let defaultRunner: Runner | null;

let findRunner: jest.SpyInstance;
let findProject: jest.SpyInstance;
let hasGlobal: jest.SpyInstance;
let findDefault: jest.SpyInstance;

function runner(data: {
  id: string;
  projectId?: ObjectID;
  isGlobalRunner?: boolean;
}): Runner {
  const row: Runner = new Runner();
  row._id = data.id;
  if (data.projectId) {
    row.projectId = data.projectId;
  }
  row.isGlobalRunner = Boolean(data.isGlobalRunner);
  return row;
}

beforeEach(() => {
  runners = new Map<string, Runner>([
    [
      PROJECT_RUNNER_ID,
      runner({ id: PROJECT_RUNNER_ID, projectId: PROJECT_ID }),
    ],
    [GLOBAL_RUNNER_ID, runner({ id: GLOBAL_RUNNER_ID, isGlobalRunner: true })],
  ]);
  usesGlobalRunners = true;
  projectExists = true;
  hasGlobalRunner = true;
  defaultRunner = null;

  findRunner = jest
    .spyOn(RunnerService, "findOneById")
    .mockImplementation(
      async (args: { id: ObjectID }): Promise<Runner | null> => {
        return runners.get(args.id.toString()) || null;
      },
    );

  findProject = jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation(async (): Promise<Project | null> => {
      if (!projectExists) {
        return null;
      }

      const project: Project = new Project();
      project._id = PROJECT_ID.toString();
      if (usesGlobalRunners !== undefined) {
        project.useGlobalRunners = usesGlobalRunners;
      }
      return project;
    });

  hasGlobal = jest
    .spyOn(RunnerService, "hasGlobalRunnerForRunbooks")
    .mockImplementation(async (): Promise<boolean> => {
      return hasGlobalRunner;
    });

  findDefault = jest
    .spyOn(RunnerService, "findProjectDefaultRunner")
    .mockImplementation(async (): Promise<Runner | null> => {
      return defaultRunner;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function decide(
  stepType: string,
  chosenRunnerId: unknown,
): Promise<RunnerChoiceDecision> {
  return await GlobalRunnerChoice.decideForStep({
    projectId: PROJECT_ID,
    stepType,
    chosenRunnerId,
  });
}

describe("a step that picked a Runner", () => {
  test("one of its project's own: it runs there, and nothing else is read", async () => {
    defaultRunner = runner({ id: DEFAULT_RUNNER_ID, projectId: PROJECT_ID });

    expect(await decide(RunbookStepType.Bash, PROJECT_RUNNER_ID)).toEqual({
      kind: "custom",
      runnerId: PROJECT_RUNNER_ID,
    });

    expect(findProject).not.toHaveBeenCalled();
    expect(hasGlobal).not.toHaveBeenCalled();
    // A pick never follows the project's default: it is not even read.
    expect(findDefault).not.toHaveBeenCalled();
  });

  test("the Runner is read as OneUptime, with whether it is global and whose it is", async () => {
    await decide(RunbookStepType.JavaScript, PROJECT_RUNNER_ID);

    const args: {
      select: Record<string, unknown>;
      props: { isRoot?: boolean };
    } = findRunner.mock.calls[0]![0] as {
      select: Record<string, unknown>;
      props: { isRoot?: boolean };
    };

    expect(args.select["projectId"]).toBe(true);
    expect(args.select["isGlobalRunner"]).toBe(true);
    expect(args.props.isRoot).toBe(true);
  });

  test("another project's Runner is refused, never run", async () => {
    runners.set(
      PROJECT_RUNNER_ID,
      runner({ id: PROJECT_RUNNER_ID, projectId: OTHER_PROJECT_ID }),
    );

    const decision: RunnerChoiceDecision = await decide(
      RunbookStepType.Bash,
      PROJECT_RUNNER_ID,
    );

    expect(decision.kind).toBe("refused");
    expect((decision as { refusal: RunnerChoiceRefusal }).refusal).toBe(
      RunnerChoiceRefusal.RunnerNotFound,
    );
  });

  test("a deleted Runner is refused at once rather than waited on", async () => {
    runners.delete(PROJECT_RUNNER_ID);

    expect(
      (
        (await decide(RunbookStepType.JavaScript, PROJECT_RUNNER_ID)) as {
          refusal: RunnerChoiceRefusal;
        }
      ).refusal,
    ).toBe(RunnerChoiceRefusal.RunnerNotFound);
  });

  test("the project id is compared whatever its case", async () => {
    runners.set(
      PROJECT_RUNNER_ID,
      runner({
        id: PROJECT_RUNNER_ID,
        projectId: new ObjectID(PROJECT_ID.toString().toUpperCase()),
      }),
    );

    expect((await decide(RunbookStepType.Bash, PROJECT_RUNNER_ID)).kind).toBe(
      "custom",
    );
  });

  test("a global Runner: the step picked the Global Runner, held to the project's switch, and the default is not read", async () => {
    defaultRunner = runner({ id: DEFAULT_RUNNER_ID, projectId: PROJECT_ID });

    expect(await decide(RunbookStepType.JavaScript, GLOBAL_RUNNER_ID)).toEqual({
      kind: "global",
    });
    expect(findDefault).not.toHaveBeenCalled();

    usesGlobalRunners = false;

    expect(
      (
        (await decide(RunbookStepType.JavaScript, GLOBAL_RUNNER_ID)) as {
          refusal: RunnerChoiceRefusal;
        }
      ).refusal,
    ).toBe(RunnerChoiceRefusal.ProjectTurnedGlobalRunnersOff);
  });

  test("an id that is not one is refused without a read", async () => {
    const decision: RunnerChoiceDecision = await decide(
      RunbookStepType.JavaScript,
      "prod-runner",
    );

    expect((decision as { refusal: RunnerChoiceRefusal }).refusal).toBe(
      RunnerChoiceRefusal.InvalidRunnerId,
    );
    expect(findRunner).not.toHaveBeenCalled();
    expect(findProject).not.toHaveBeenCalled();
  });
});

describe("a step that picked the Global Runner itself", () => {
  test("a JavaScript step runs on the global Runners, whatever the project's default, which is never read", async () => {
    defaultRunner = runner({ id: DEFAULT_RUNNER_ID, projectId: PROJECT_ID });

    expect(
      await decide(RunbookStepType.JavaScript, GLOBAL_RUNNER_CHOICE_ID),
    ).toEqual({ kind: "global" });
    expect(findDefault).not.toHaveBeenCalled();
    expect(findRunner).not.toHaveBeenCalled();
    expect(findProject).toHaveBeenCalledTimes(1);
    expect(hasGlobal).toHaveBeenCalledTimes(1);
  });

  test.each([
    RunbookStepType.Bash,
    RunbookStepType.SSH,
    RunbookStepType.Kubernetes,
  ])(
    "a %s step is refused - global Runners never run it - and nothing is read to say so",
    async (stepType: string) => {
      defaultRunner = runner({ id: DEFAULT_RUNNER_ID, projectId: PROJECT_ID });

      const decision: RunnerChoiceDecision = await decide(
        stepType,
        GLOBAL_RUNNER_CHOICE_ID,
      );

      expect((decision as { refusal: RunnerChoiceRefusal }).refusal).toBe(
        RunnerChoiceRefusal.NeedsOwnRunner,
      );
      expect((decision as { message: string }).message).toContain(
        "picks the Global Runner",
      );
      expect(findRunner).not.toHaveBeenCalled();
      expect(findDefault).not.toHaveBeenCalled();
      expect(findProject).not.toHaveBeenCalled();
      expect(hasGlobal).not.toHaveBeenCalled();
    },
  );

  test("a project that turned global Runners off: refused", async () => {
    usesGlobalRunners = false;

    expect(
      (
        (await decide(RunbookStepType.JavaScript, " Global ")) as {
          refusal: RunnerChoiceRefusal;
        }
      ).refusal,
    ).toBe(RunnerChoiceRefusal.ProjectTurnedGlobalRunnersOff);
  });
});

describe("a step that picked no Runner, in a project with a default Runner", () => {
  beforeEach(() => {
    defaultRunner = runner({ id: DEFAULT_RUNNER_ID, projectId: PROJECT_ID });
  });

  test.each([
    RunbookStepType.JavaScript,
    RunbookStepType.Bash,
    RunbookStepType.SSH,
    RunbookStepType.Kubernetes,
  ])(
    "a %s step runs on the project's default Runner; the switch and the global Runners are not read",
    async (stepType: string) => {
      expect(await decide(stepType, "")).toEqual({
        kind: "custom",
        runnerId: DEFAULT_RUNNER_ID,
        isProjectDefault: true,
      });

      expect(findDefault).toHaveBeenCalledTimes(1);
      expect((findDefault.mock.calls[0]![0] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(findRunner).not.toHaveBeenCalled();
      expect(findProject).not.toHaveBeenCalled();
      expect(hasGlobal).not.toHaveBeenCalled();
    },
  );

  test("the default runs the step in a project that turned global Runners off, on a server with none", async () => {
    usesGlobalRunners = false;
    hasGlobalRunner = false;

    expect((await decide(RunbookStepType.JavaScript, undefined)).kind).toBe(
      "custom",
    );
  });
});

describe("a step that picked no Runner, in a project with no default Runner", () => {
  test("the project's default is asked for, and its answer of none sends a JavaScript step to the global Runners", async () => {
    expect(await decide(RunbookStepType.JavaScript, "")).toEqual({
      kind: "global",
    });
    expect(findDefault).toHaveBeenCalledTimes(1);
  });

  test("a JavaScript step of a project that uses global Runners, on a server that has one, runs on them", async () => {
    expect(await decide(RunbookStepType.JavaScript, "")).toEqual({
      kind: "global",
    });

    expect(findRunner).not.toHaveBeenCalled();

    const projectArgs: {
      id: ObjectID;
      select: Record<string, unknown>;
      props: { isRoot?: boolean };
    } = findProject.mock.calls[0]![0] as {
      id: ObjectID;
      select: Record<string, unknown>;
      props: { isRoot?: boolean };
    };

    expect(projectArgs.id.toString()).toBe(PROJECT_ID.toString());
    expect(projectArgs.select["useGlobalRunners"]).toBe(true);
    expect(projectArgs.props.isRoot).toBe(true);
  });

  test("a project that never set the switch uses global Runners: it is on by default", async () => {
    usesGlobalRunners = undefined;

    expect((await decide(RunbookStepType.JavaScript, undefined)).kind).toBe(
      "global",
    );
  });

  test("a project that turned them off: refused, and the server's global Runners are not even asked", async () => {
    usesGlobalRunners = false;

    expect(
      (
        (await decide(RunbookStepType.JavaScript, "")) as {
          refusal: RunnerChoiceRefusal;
        }
      ).refusal,
    ).toBe(RunnerChoiceRefusal.ProjectTurnedGlobalRunnersOff);
    expect(hasGlobal).not.toHaveBeenCalled();
  });

  test("a project that cannot be read is not taken as having said yes", async () => {
    projectExists = false;

    expect(
      (
        (await decide(RunbookStepType.JavaScript, "")) as {
          refusal: RunnerChoiceRefusal;
        }
      ).refusal,
    ).toBe(RunnerChoiceRefusal.ProjectTurnedGlobalRunnersOff);
  });

  test("a server with no global Runner: the existing refusal", async () => {
    hasGlobalRunner = false;

    expect(
      (
        (await decide(RunbookStepType.JavaScript, "")) as {
          refusal: RunnerChoiceRefusal;
        }
      ).refusal,
    ).toBe(RunnerChoiceRefusal.NoGlobalRunner);
  });

  /*
   * What the picker hides, the server refuses: a Bash, SSH or kubectl step
   * with no Runner and no project default never reaches a global Runner.
   * Only the project's default is read to say so - it is what could have
   * run the step.
   */
  test.each([
    RunbookStepType.Bash,
    RunbookStepType.SSH,
    RunbookStepType.Kubernetes,
  ])(
    "a %s step needs a Runner of its own: only the project's default is read to say so",
    async (stepType: string) => {
      const decision: RunnerChoiceDecision = await decide(stepType, "");

      expect((decision as { refusal: RunnerChoiceRefusal }).refusal).toBe(
        RunnerChoiceRefusal.NeedsOwnRunner,
      );
      expect((decision as { message: string }).message).toContain(
        "make one the project's default Runner",
      );

      expect(findDefault).toHaveBeenCalledTimes(1);
      expect(findRunner).not.toHaveBeenCalled();
      expect(findProject).not.toHaveBeenCalled();
      expect(hasGlobal).not.toHaveBeenCalled();
    },
  );
});

describe("the default order, for any work that picks a Runner", () => {
  test("work global Runners never run follows the project's default, and never asks for a global Runner", async () => {
    defaultRunner = runner({ id: DEFAULT_RUNNER_ID, projectId: PROJECT_ID });

    const result: RunnerDefaultOrderResult =
      await GlobalRunnerChoice.decideByDefaultOrder({
        projectId: PROJECT_ID,
        chosenRunnerId: "",
        canGlobalRunnersRunWork: false,
      });

    expect(result).toEqual({
      source: RunnerSource.ProjectDefault,
      runnerId: DEFAULT_RUNNER_ID,
    });
    expect(findProject).not.toHaveBeenCalled();
    expect(hasGlobal).not.toHaveBeenCalled();
  });

  test("work global Runners never run, with no default, runs nowhere - and the global Runners are not asked", async () => {
    expect(
      await GlobalRunnerChoice.decideByDefaultOrder({
        projectId: PROJECT_ID,
        chosenRunnerId: undefined,
        canGlobalRunnersRunWork: false,
      }),
    ).toEqual({
      source: RunnerSource.None,
      refusal: RunnerChoiceRefusal.NeedsOwnRunner,
      pickedGlobalRunner: false,
    });
    expect(findProject).not.toHaveBeenCalled();
    expect(hasGlobal).not.toHaveBeenCalled();
  });

  test("its own Runner wins over the project's default", async () => {
    defaultRunner = runner({ id: DEFAULT_RUNNER_ID, projectId: PROJECT_ID });

    expect(
      await GlobalRunnerChoice.decideByDefaultOrder({
        projectId: PROJECT_ID,
        chosenRunnerId: PROJECT_RUNNER_ID,
        canGlobalRunnersRunWork: false,
      }),
    ).toEqual({ source: RunnerSource.Picked, runnerId: PROJECT_RUNNER_ID });
  });

  test("findProjectDefaultRunnerId answers the default's id, or nothing", async () => {
    expect(
      await GlobalRunnerChoice.findProjectDefaultRunnerId(PROJECT_ID),
    ).toBe("");

    defaultRunner = runner({ id: DEFAULT_RUNNER_ID, projectId: PROJECT_ID });

    expect(
      await GlobalRunnerChoice.findProjectDefaultRunnerId(PROJECT_ID),
    ).toBe(DEFAULT_RUNNER_ID);
  });
});

describe("getChosenRunnerKind", () => {
  test("names each kind", async () => {
    expect(
      await GlobalRunnerChoice.getChosenRunnerKind({
        projectId: PROJECT_ID,
        runnerId: new ObjectID(PROJECT_RUNNER_ID),
      }),
    ).toBe(ChosenRunnerKind.ProjectRunner);

    expect(
      await GlobalRunnerChoice.getChosenRunnerKind({
        projectId: PROJECT_ID,
        runnerId: new ObjectID(GLOBAL_RUNNER_ID),
      }),
    ).toBe(ChosenRunnerKind.GlobalRunner);

    expect(
      await GlobalRunnerChoice.getChosenRunnerKind({
        projectId: OTHER_PROJECT_ID,
        runnerId: new ObjectID(PROJECT_RUNNER_ID),
      }),
    ).toBe(ChosenRunnerKind.NotFound);

    expect(
      await GlobalRunnerChoice.getChosenRunnerKind({
        projectId: PROJECT_ID,
        runnerId: ObjectID.generate(),
      }),
    ).toBe(ChosenRunnerKind.NotFound);
  });
});
