import Project from "../../../../Models/DatabaseModels/Project";
import Runner from "../../../../Models/DatabaseModels/Runner";
import ProjectService from "../../../../Server/Services/ProjectService";
import RunnerService from "../../../../Server/Services/RunnerService";
import GlobalRunnerChoice from "../../../../Server/Utils/Runner/GlobalRunnerChoice";
import ObjectID from "../../../../Types/ObjectID";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import {
  ChosenRunnerKind,
  RunnerChoiceDecision,
  RunnerChoiceRefusal,
} from "../../../../Types/Runner/RunnerChoice";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The server side of the "global by default" rule: it reads the facts as
 * OneUptime - the Runner a step picked (held to the step's project), the
 * project's switch, whether the server has a global Runner - and asks the
 * rule. It reads only what decides the step: a custom pick needs neither the
 * switch nor the global Runners, and a step global Runners never run needs
 * no read at all.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROJECT_RUNNER_ID: string = "33333333-3333-4333-8333-333333333333";
const GLOBAL_RUNNER_ID: string = "44444444-4444-4444-8444-444444444444";

let runners: Map<string, Runner>;
let usesGlobalRunners: boolean | undefined;
let projectExists: boolean;
let hasGlobalRunner: boolean;

let findRunner: jest.SpyInstance;
let findProject: jest.SpyInstance;
let hasGlobal: jest.SpyInstance;

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
    expect(await decide(RunbookStepType.Bash, PROJECT_RUNNER_ID)).toEqual({
      kind: "custom",
      runnerId: PROJECT_RUNNER_ID,
    });

    expect(findProject).not.toHaveBeenCalled();
    expect(hasGlobal).not.toHaveBeenCalled();
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
    expect(
      (decision as { refusal: RunnerChoiceRefusal }).refusal,
    ).toBe(RunnerChoiceRefusal.RunnerNotFound);
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

    expect(
      (await decide(RunbookStepType.Bash, PROJECT_RUNNER_ID)).kind,
    ).toBe("custom");
  });

  test("a global Runner: the step is on the global Runners, held to the project's switch", async () => {
    expect(await decide(RunbookStepType.JavaScript, GLOBAL_RUNNER_ID)).toEqual(
      { kind: "global" },
    );

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

describe("a step that picked no Runner", () => {
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

  test.each([
    RunbookStepType.Bash,
    RunbookStepType.SSH,
    RunbookStepType.Kubernetes,
  ])(
    "a %s step needs a Runner of its own, and nothing is read to say so",
    async (stepType: string) => {
      expect(
        (
          (await decide(stepType, "")) as {
            refusal: RunnerChoiceRefusal;
          }
        ).refusal,
      ).toBe(RunnerChoiceRefusal.NeedsOwnRunner);

      expect(findRunner).not.toHaveBeenCalled();
      expect(findProject).not.toHaveBeenCalled();
      expect(hasGlobal).not.toHaveBeenCalled();
    },
  );
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
