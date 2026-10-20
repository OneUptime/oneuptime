import RunnerJobService from "../../../Server/Services/RunnerJobService";
import RunbookExecutionService from "../../../Server/Services/RunbookExecutionService";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import RunbookVariableResolver, {
  RunbookVariableResolution,
} from "../../../Server/Utils/Runbook/RunbookVariableResolver";
import RunbookExecution from "../../../Models/DatabaseModels/RunbookExecution";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import ObjectID from "../../../Types/ObjectID";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "../../../Types/Runbook/RunnerJobOrigin";
import { RunbookVariableScope } from "../../../Types/Runbook/RunbookVariableReference";
import { REDACTED_SECRET_TEXT } from "../../../Types/Runbook/SecretOutputRedaction";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * A STEP'S SECRETS NEVER LAND ON THE RUN.
 *
 * What a step printed is stored on its RunnerJob row and shown with the run.
 * The secret runbook variables the step was handed are hidden in it before
 * it is stored, whatever the Runner sent - a Runner hides them too, but one
 * older than runbook variables does not know to:
 *
 *   - getSecretValuesGivenToJob reads them again - for the Runner that holds
 *     the job only, and none for a command OneUptime AI composed, which is
 *     never filled in - with the step's own runbook for its own variables;
 *   - submitResult hides them in the output and the error message, in the
 *     same one UPDATE as before.
 */

const JOB_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const AGENT_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RUNBOOK_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const EXECUTION_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

interface CapturedQuery {
  sql: string;
  params: Array<unknown>;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("submitResult with the secrets a step was handed", () => {
  let queries: Array<CapturedQuery>;

  beforeEach(() => {
    queries = [];
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue({
      query: jest
        .fn()
        .mockImplementation(
          async (sql: string, params: Array<unknown>): Promise<unknown> => {
            queries.push({ sql, params });
            return [[{ _id: JOB_ID.toString() }], 1];
          },
        ),
    } as never);
  });

  it("hides them in the output and the error message, both copies, in one UPDATE", async () => {
    const written: boolean = await RunnerJobService.submitResult({
      jobId: JOB_ID,
      agentId: AGENT_ID,
      success: false,
      output: "sudo: password for deploy: hunter2-hunter2",
      errorMessage: "auth failed for hunter2-hunter2",
      exitCode: 1,
      secretValues: ["hunter2-hunter2"],
    });

    expect(written).toBe(true);
    expect(queries).toHaveLength(1);

    const params: Array<unknown> = queries[0]!.params;
    // $2 / $4: the verbatim copies a runbook's row keeps.
    expect(params[1]).toBe(
      `sudo: password for deploy: ${REDACTED_SECRET_TEXT}`,
    );
    expect(params[3]).toBe(`auth failed for ${REDACTED_SECRET_TEXT}`);
    // $10 / $11: the copies an AI job's row keeps.
    expect(params[9]).toBe(
      `sudo: password for deploy: ${REDACTED_SECRET_TEXT}`,
    );
    expect(params[10]).toBe(`auth failed for ${REDACTED_SECRET_TEXT}`);
    expect(JSON.stringify(params)).not.toContain("hunter2-hunter2");
  });

  it("stores the text as it was sent when the step was handed none", async () => {
    await RunnerJobService.submitResult({
      jobId: JOB_ID,
      agentId: AGENT_ID,
      success: true,
      output: "hunter2-hunter2 is just text",
    });

    expect(queries[0]!.params[1]).toBe("hunter2-hunter2 is just text");
  });
});

describe("getSecretValuesGivenToJob", () => {
  let findJob: jest.SpyInstance;
  let resolve: jest.SpyInstance;
  let findExecution: jest.SpyInstance;

  function job(fields: Record<string, unknown>): RunnerJob {
    return Object.assign(new RunnerJob(), {
      _id: JOB_ID.toString(),
      projectId: PROJECT_ID,
      runbookExecutionId: EXECUTION_ID,
      origin: RunnerJobOrigin.Runbook,
      stepType: RunbookStepType.Bash,
      script: "psql -W {{global.variables.DB_PASSWORD}}",
      ...fields,
    });
  }

  beforeEach(() => {
    findJob = jest.spyOn(RunnerJobService, "findOneBy");
    resolve = jest
      .spyOn(RunbookVariableResolver, "resolve")
      .mockImplementation(async (): Promise<RunbookVariableResolution> => {
        return {
          variables: new Map(),
          problems: [],
          secretValues: ["db-password-1234"],
        };
      });
    findExecution = jest
      .spyOn(RunbookExecutionService, "findOneById")
      .mockImplementation(async (): Promise<RunbookExecution> => {
        return Object.assign(new RunbookExecution(), {
          projectId: PROJECT_ID,
          runbookId: RUNBOOK_ID,
        });
      });
  });

  it("reads the job only as the Runner that holds it", async () => {
    findJob.mockResolvedValue(job({}));

    expect(
      await RunnerJobService.getSecretValuesGivenToJob({
        jobId: JOB_ID,
        agentId: AGENT_ID,
      }),
    ).toEqual(["db-password-1234"]);

    const query: Record<string, unknown> = (
      findJob.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(String(query["_id"])).toBe(JOB_ID.toString());
    expect(String(query["assignedAgentId"])).toBe(AGENT_ID.toString());

    const args: {
      projectId: ObjectID;
      runbookId: ObjectID | null;
      access: { kind: string };
      includeValues: boolean;
      references: Array<{ scope: RunbookVariableScope; name: string }>;
    } = resolve.mock.calls[0]![0] as never;

    expect(String(args.projectId)).toBe(PROJECT_ID.toString());
    expect(args.access).toEqual({ kind: "server" });
    expect(args.includeValues).toBe(true);
    expect(args.references).toEqual([
      { scope: RunbookVariableScope.Global, name: "DB_PASSWORD" },
    ]);
    // Only global variables named: the run is not read.
    expect(args.runbookId).toBeNull();
    expect(findExecution).not.toHaveBeenCalled();
  });

  it("a step's own variables are read from the runbook of its run", async () => {
    findJob.mockResolvedValue(
      job({ script: "kubectl -n {{local.variables.NS}} get pods" }),
    );

    await RunnerJobService.getSecretValuesGivenToJob({
      jobId: JOB_ID,
      agentId: AGENT_ID,
    });

    expect(
      String((resolve.mock.calls[0]![0] as { runbookId: ObjectID }).runbookId),
    ).toBe(RUNBOOK_ID.toString());
  });

  it("never the runbook of a run of another project", async () => {
    findJob.mockResolvedValue(
      job({ script: "kubectl -n {{local.variables.NS}} get pods" }),
    );
    findExecution.mockImplementation(async (): Promise<RunbookExecution> => {
      return Object.assign(new RunbookExecution(), {
        projectId: ObjectID.generate(),
        runbookId: RUNBOOK_ID,
      });
    });

    await RunnerJobService.getSecretValuesGivenToJob({
      jobId: JOB_ID,
      agentId: AGENT_ID,
    });

    expect(
      (resolve.mock.calls[0]![0] as { runbookId: ObjectID | null }).runbookId,
    ).toBeNull();
  });

  it("an SSH step's sign-in and a kubectl step's kubeconfig are read too", async () => {
    findJob.mockResolvedValue(
      job({
        stepType: RunbookStepType.SSH,
        script: "",
        payload: {
          host: "10.0.4.21",
          username: "deploy",
          signIn: "{{global.variables.DB_KEY}}",
          script: "uptime",
        },
      }),
    );

    await RunnerJobService.getSecretValuesGivenToJob({
      jobId: JOB_ID,
      agentId: AGENT_ID,
    });

    expect(
      (
        resolve.mock.calls[0]![0] as {
          references: Array<{ name: string }>;
        }
      ).references.map((reference: { name: string }): string => {
        return reference.name;
      }),
    ).toEqual(["DB_KEY"]);
  });

  it.each([
    ["a job that is not the Runner's", null],
    [
      "a command OneUptime AI composed, which is never filled in",
      job({ origin: RunnerJobOrigin.AiRemediation }),
    ],
    ["a step that names no variable", job({ script: "uptime" })],
    [
      "a step written with a credential",
      job({
        stepType: RunbookStepType.SSH,
        script: "",
        payload: { credentialId: "c1", command: "{{global.variables.X}}" },
      }),
    ],
  ])(
    "none for %s, and nothing decrypted",
    async (_label: string, found: unknown) => {
      findJob.mockResolvedValue(found as never);

      expect(
        await RunnerJobService.getSecretValuesGivenToJob({
          jobId: JOB_ID,
          agentId: AGENT_ID,
        }),
      ).toEqual([]);
      expect(resolve).not.toHaveBeenCalled();
    },
  );
});
