import RunnerIngressAPI, {
  RunInputsForJob,
} from "../../FeatureSet/Runbook/API/RunnerIngress";
import RunbookExecutionService from "Common/Server/Services/RunbookExecutionService";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import RunnerJob from "Common/Models/DatabaseModels/RunnerJob";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import RunbookTriggerType from "Common/Types/Runbook/RunbookTriggerType";
import RunnerJobOrigin from "Common/Types/Runbook/RunnerJobOrigin";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT A CLAIMED STEP IS HANDED BESIDE ITS SCRIPT: the values its run was
 * started with (a webhook call's body) and what started it, read from the
 * run in the claiming Runner's own project - for a runbook's own Bash and
 * JavaScript steps, and a kubectl step that takes a script (which runs with
 * bash on the Runner, as a Bash step does), and nothing else. The Runner
 * turns them into environment variables and `args` (RunbookExecutorInputs,
 * in the Runner's suites); the script itself is never touched.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-1111111111a1",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-1111111111a2",
);
const EXECUTION_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-3333333333a3",
);

const INPUTS: JSONObject = { host: "web-1", reason: "$(touch /tmp/pwned)" };

/*
 * Fixture overrides may set a column to undefined on purpose (a job with no
 * run, a run with no inputs are cases under test), which Partial<Model>
 * forbids under exactOptionalPropertyTypes.
 */
type Loose<TModel> = { [K in keyof TModel]?: TModel[K] | undefined };

function job(overrides: Loose<RunnerJob> = {}): RunnerJob {
  const item: RunnerJob = new RunnerJob();

  Object.assign(item, {
    _id: ObjectID.generate().toString(),
    origin: RunnerJobOrigin.Runbook,
    stepType: RunbookStepType.Bash,
    runbookExecutionId: EXECUTION_ID,
    script: 'echo "$ONEUPTIME_INPUT_HOST"',
    ...overrides,
  });

  return item;
}

function run(overrides: Loose<RunbookExecution> = {}): RunbookExecution {
  const item: RunbookExecution = new RunbookExecution();

  Object.assign(item, {
    _id: EXECUTION_ID.toString(),
    projectId: PROJECT_ID,
    inputs: INPUTS,
    triggerType: RunbookTriggerType.Webhook,
    ...overrides,
  });

  return item;
}

let readRun: jest.SpyInstance;

beforeEach(() => {
  readRun = jest
    .spyOn(RunbookExecutionService, "findOneById")
    .mockResolvedValue(run() as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function inputsFor(
  claimed: RunnerJob,
  options: { isAgentRunnerRow?: boolean } = {},
): Promise<RunInputsForJob | null> {
  return await RunnerIngressAPI.getRunInputsForJob({
    job: claimed,
    projectId: PROJECT_ID,
    isAgentRunnerRow: Boolean(options.isAgentRunnerRow),
  });
}

describe("a runbook's own Bash and JavaScript steps", () => {
  test.each([[RunbookStepType.Bash], [RunbookStepType.JavaScript]])(
    "a %s step gets its run's inputs and what started it",
    async (stepType: RunbookStepType) => {
      expect(await inputsFor(job({ stepType }))).toEqual({
        inputs: INPUTS,
        trigger: RunbookTriggerType.Webhook,
      });

      const read: { id: ObjectID; select: Record<string, unknown> } = readRun
        .mock.calls[0]![0] as { id: ObjectID; select: Record<string, unknown> };

      expect(read.id.toString()).toBe(EXECUTION_ID.toString());
      expect(read.select).toEqual({
        projectId: true,
        inputs: true,
        triggerType: true,
      });
    },
  );

  test("a run with no inputs hands an empty object, so a script can always read them", async () => {
    readRun.mockResolvedValue(
      run({
        inputs: undefined,
        triggerType: RunbookTriggerType.Schedule,
      }) as never,
    );

    expect(await inputsFor(job())).toEqual({
      inputs: {},
      trigger: RunbookTriggerType.Schedule,
    });
  });

  test("inputs that are not an object - a row written some other way - are handed as none", async () => {
    readRun.mockResolvedValue(
      run({
        inputs: ["not", "an", "object"] as unknown as JSONObject,
      }) as never,
    );

    expect((await inputsFor(job()))?.inputs).toEqual({});
  });

  test("a run started before triggers were recorded hands no trigger", async () => {
    readRun.mockResolvedValue(run({ triggerType: undefined }) as never);

    expect((await inputsFor(job()))?.trigger).toBeNull();
  });
});

describe("a kubectl step that takes a script", () => {
  test("gets its run's inputs, as a Bash step does: it runs with bash on the Runner", async () => {
    expect(
      await inputsFor(
        job({
          stepType: RunbookStepType.Kubernetes,
          script: "",
          payload: {
            script:
              'kubectl rollout restart deployment/"$ONEUPTIME_INPUT_HOST"',
          },
        }),
      ),
    ).toEqual({
      inputs: INPUTS,
      trigger: RunbookTriggerType.Webhook,
    });
  });

  test("a Kubernetes step written before scripts - one action with a credential - gets none", async () => {
    expect(
      await inputsFor(
        job({
          stepType: RunbookStepType.Kubernetes,
          script: "",
          payload: {
            credentialId: ObjectID.generate().toString(),
            action: "restart-workload",
            namespace: "web",
            workloadName: "api",
          },
        }),
      ),
    ).toBeNull();
    expect(readRun).not.toHaveBeenCalled();
  });
});

describe("nothing for anything else", () => {
  /*
   * An SSH step's script runs on another machine, never with the Runner's
   * environment; Kubectl is OneUptime AI's command lane.
   */
  test.each([
    [RunbookStepType.SSH],
    [RunbookStepType.Kubectl],
    [RunbookStepType.HttpRequest],
  ])("a %s step", async (stepType: RunbookStepType) => {
    expect(await inputsFor(job({ stepType }))).toBeNull();
    expect(readRun).not.toHaveBeenCalled();
  });

  test.each([
    [RunnerJobOrigin.AiRemediation],
    [RunnerJobOrigin.AiInvestigation],
  ])("an AI-composed command (%s)", async (origin: RunnerJobOrigin) => {
    expect(await inputsFor(job({ origin }))).toBeNull();
    expect(readRun).not.toHaveBeenCalled();
  });

  test("a kubernetes-agent Runner", async () => {
    expect(await inputsFor(job(), { isAgentRunnerRow: true })).toBeNull();
    expect(readRun).not.toHaveBeenCalled();
  });

  test("a job with no run", async () => {
    expect(await inputsFor(job({ runbookExecutionId: undefined }))).toBeNull();
    expect(readRun).not.toHaveBeenCalled();
  });

  test("a run that is gone", async () => {
    readRun.mockResolvedValue(null as never);

    expect(await inputsFor(job())).toBeNull();
  });

  test("a run of another project than the Runner's", async () => {
    readRun.mockResolvedValue(run({ projectId: OTHER_PROJECT_ID }) as never);

    expect(await inputsFor(job())).toBeNull();
  });
});
