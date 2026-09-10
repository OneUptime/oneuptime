/*
 * A scheduled workflow whose "Schedule at" references a workflow variable has
 * that variable substituted at registration time, because BullMQ needs a
 * concrete cron. When the result is not a valid cron, QueueWorkflow quotes it
 * back in an error and writes that error into a WorkflowLog row — a row any
 * member with workflow read permission can open.
 *
 * If the referenced variable is marked Secret, that quoted value is the
 * secret's plaintext. These tests hold the line the run log already holds:
 * the secret never reaches the persisted output.
 */

import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import Queue from "Common/Server/Infrastructure/Queue";
import ProjectService from "Common/Server/Services/ProjectService";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import WorkflowVariableService from "Common/Server/Services/WorkflowVariableService";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import QueueWorkflow from "../../../FeatureSet/Workflow/Services/QueueWorkflow";
import { WORKFLOW_LOG_REDACTED_VALUE } from "../../../FeatureSet/Workflow/Utils/SecretRedaction";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

interface RecordedSpy {
  mock: { calls: Array<Array<unknown>> };
}

type VariableFunction = (params: {
  name: string;
  content: string;
  isSecret?: boolean | string | undefined;
}) => WorkflowVariable;

const variable: VariableFunction = (params: {
  name: string;
  content: string;
  isSecret?: boolean | string | undefined;
}): WorkflowVariable => {
  const workflowVariable: WorkflowVariable = new WorkflowVariable();
  workflowVariable.name = params.name;
  workflowVariable.content = params.content;

  if (params.isSecret !== undefined) {
    workflowVariable.isSecret = params.isSecret as string;
  }

  return workflowVariable;
};

interface PreparedQueue {
  createLogSpy: RecordedSpy;
  findVariablesSpy: RecordedSpy;
}

type PrepareFunction = (params: {
  localVariables: Array<WorkflowVariable>;
  globalVariables?: Array<WorkflowVariable> | undefined;
}) => PreparedQueue;

/**
 * Stand the enqueue path up far enough to reach the schedule-resolution
 * failure: an enabled workflow, its variables, and a capturable log writer.
 * The failure returns before the plan check and before BullMQ is touched, so
 * nothing further needs mocking.
 */
const prepareQueue: PrepareFunction = (params: {
  localVariables: Array<WorkflowVariable>;
  globalVariables?: Array<WorkflowVariable> | undefined;
}): PreparedQueue => {
  const workflowRow: Workflow = new Workflow();
  workflowRow.isEnabled = true;
  workflowRow.projectId = PROJECT_ID;

  jest
    .spyOn(WorkflowService as never, "findOneById")
    .mockResolvedValue(workflowRow as never);

  const findVariablesSpy: RecordedSpy = jest
    .spyOn(WorkflowVariableService as never, "findBy")
    .mockImplementation(((findParams: {
      query: { workflowId?: unknown };
    }): Promise<Array<WorkflowVariable>> => {
      /*
       * Local variables are queried by workflowId; the global query looks for
       * rows whose workflowId is null, which arrives here as a QueryHelper
       * instance rather than an ObjectID.
       */
      const isLocalQuery: boolean =
        findParams.query.workflowId instanceof ObjectID;

      return Promise.resolve(
        isLocalQuery ? params.localVariables : params.globalVariables || [],
      );
    }) as never) as unknown as RecordedSpy;

  const createLogSpy: RecordedSpy = jest
    .spyOn(WorkflowLogService as never, "create")
    .mockResolvedValue(new WorkflowLog() as never) as unknown as RecordedSpy;

  return { createLogSpy: createLogSpy, findVariablesSpy: findVariablesSpy };
};

type PersistedLogFunction = (createLogSpy: RecordedSpy) => WorkflowLog;

const lastPersistedLog: PersistedLogFunction = (
  createLogSpy: RecordedSpy,
): WorkflowLog => {
  const lastCall: unknown =
    createLogSpy.mock.calls[createLogSpy.mock.calls.length - 1]?.[0];

  return (lastCall as { data: WorkflowLog }).data;
};

type EnqueueFunction = (scheduleAt: string) => Promise<void>;

const enqueueScheduled: EnqueueFunction = async (
  scheduleAt: string,
): Promise<void> => {
  await QueueWorkflow.addWorkflowToQueue(
    { workflowId: WORKFLOW_ID, returnValues: {} },
    scheduleAt,
  );
};

describe("QueueWorkflow schedule errors do not leak secret variables", () => {
  let loggedErrors: Array<unknown> = [];

  beforeEach(() => {
    loggedErrors = [];
    jest.spyOn(logger, "error").mockImplementation(((
      message: unknown,
    ): void => {
      loggedErrors.push(message);
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("selects isSecret when reading the variables it resolves the schedule from", async () => {
    const { findVariablesSpy } = prepareQueue({
      /*
       * Invalid on purpose: the run returns after writing the error log,
       * before anything that would need a queue or a plan.
       */
      localVariables: [variable({ name: "schedule", content: "nope" })],
    });

    await enqueueScheduled("{{local.variables.schedule}}");

    expect(findVariablesSpy.mock.calls.length).toBe(2);

    for (const call of findVariablesSpy.mock.calls) {
      const select: Record<string, unknown> = (
        call[0] as { select: Record<string, unknown> }
      ).select;

      // Without this column every variable reads as non-secret and nothing is redacted.
      expect(select["isSecret"]).toBe(true);
    }
  });

  test("a secret local variable that is not a valid cron never reaches the workflow log", async () => {
    const { createLogSpy } = prepareQueue({
      localVariables: [
        variable({
          name: "schedule",
          content: "sk-live-super-secret-value",
          isSecret: true,
        }),
      ],
    });

    await enqueueScheduled("{{local.variables.schedule}}");

    const persistedLog: WorkflowLog = lastPersistedLog(createLogSpy);

    expect(persistedLog.workflowStatus).toBe(WorkflowStatus.Error);
    expect(JSON.stringify(persistedLog)).not.toContain(
      "sk-live-super-secret-value",
    );
    expect(persistedLog.logs).toContain(WORKFLOW_LOG_REDACTED_VALUE);
    // The operator still learns which workflow setting is broken.
    expect(persistedLog.logs).toContain("{{local.variables.schedule}}");
    expect(persistedLog.logs).toContain("not a valid cron expression");
  });

  test("a secret global variable is redacted the same way", async () => {
    const { createLogSpy } = prepareQueue({
      localVariables: [],
      globalVariables: [
        variable({
          name: "cron",
          content: "not-a-cron-global-secret",
          isSecret: true,
        }),
      ],
    });

    await enqueueScheduled("{{global.variables.cron}}");

    expect(JSON.stringify(lastPersistedLog(createLogSpy))).not.toContain(
      "not-a-cron-global-secret",
    );
  });

  test('isSecret arriving as the string "true" is redacted too', async () => {
    const { createLogSpy } = prepareQueue({
      localVariables: [
        variable({
          name: "schedule",
          content: "string-flagged-secret",
          isSecret: "true",
        }),
      ],
    });

    await enqueueScheduled("{{local.variables.schedule}}");

    expect(JSON.stringify(lastPersistedLog(createLogSpy))).not.toContain(
      "string-flagged-secret",
    );
  });

  test("a secret substituted into part of a cron is redacted", async () => {
    const { createLogSpy } = prepareQueue({
      localVariables: [
        variable({
          name: "hours",
          content: "secret-hours-value",
          isSecret: true,
        }),
      ],
    });

    await enqueueScheduled("0 */{{local.variables.hours}} * * *");

    expect(JSON.stringify(lastPersistedLog(createLogSpy))).not.toContain(
      "secret-hours-value",
    );
  });

  test("the server log line is redacted as well as the database row", async () => {
    prepareQueue({
      localVariables: [
        variable({
          name: "schedule",
          content: "leaky-secret-in-server-log",
          isSecret: true,
        }),
      ],
    });

    await enqueueScheduled("{{local.variables.schedule}}");

    expect(loggedErrors.length).toBeGreaterThan(0);
    expect(JSON.stringify(loggedErrors)).not.toContain(
      "leaky-secret-in-server-log",
    );
  });

  test("a non-secret variable is still quoted back so the error stays useful", async () => {
    const { createLogSpy } = prepareQueue({
      localVariables: [
        variable({ name: "schedule", content: "every-monday-please" }),
      ],
    });

    await enqueueScheduled("{{local.variables.schedule}}");

    expect(lastPersistedLog(createLogSpy).logs).toContain(
      "every-monday-please",
    );
  });

  test("a valid secret cron schedules the job and writes no error log", async () => {
    const { createLogSpy } = prepareQueue({
      localVariables: [
        variable({ name: "schedule", content: "0 */6 * * *", isSecret: true }),
      ],
    });

    const addJobSpy: RecordedSpy = jest
      .spyOn(Queue as never, "addJob")
      .mockResolvedValue({} as never) as unknown as RecordedSpy;

    jest
      .spyOn(ProjectService as never, "getCurrentPlan")
      .mockResolvedValue({ plan: null, isSubscriptionUnpaid: false } as never);

    await enqueueScheduled("{{local.variables.schedule}}");

    expect(createLogSpy.mock.calls.length).toBe(0);
    expect(addJobSpy.mock.calls.length).toBe(1);

    /*
     * The cron itself is deliberately NOT redacted — it goes to BullMQ, which
     * needs the real pattern, not to anything a reader sees.
     */
    const options: { scheduleAt?: string } = addJobSpy.mock.calls[0]?.[4] as {
      scheduleAt?: string;
    };

    expect(options.scheduleAt).toBe("0 */6 * * *");
  });
});

/*
 * The pure resolver, exercised directly for the cases that are awkward to set
 * up through the database: overlapping secrets, regex metacharacters, and the
 * ordering guarantee redaction depends on.
 */
describe("QueueWorkflow.buildScheduleCronFromVariables secret redaction", () => {
  test("redacts the secret but keeps the concrete cron for the scheduler", () => {
    const result: { cron: string; error: string | null } =
      QueueWorkflow.buildScheduleCronFromVariables(
        "{{local.variables.schedule}}",
        { schedule: "totally-not-a-cron" },
        {},
        ["totally-not-a-cron"],
      );

    expect(result.error).not.toContain("totally-not-a-cron");
    expect(result.error).toContain(WORKFLOW_LOG_REDACTED_VALUE);
    expect(result.cron).toBe("totally-not-a-cron");
  });

  test("redacts overlapping secrets regardless of the order they are passed in", () => {
    const result: { cron: string; error: string | null } =
      QueueWorkflow.buildScheduleCronFromVariables(
        "{{local.variables.schedule}}",
        { schedule: "token-with-suffix token" },
        {},
        // Deliberately shortest-first: the resolver must reorder these.
        ["token", "token-with-suffix"],
      );

    expect(result.error).not.toContain("token");
    expect(result.error).not.toContain("with-suffix");
    expect(result.error).toContain(
      `${WORKFLOW_LOG_REDACTED_VALUE} ${WORKFLOW_LOG_REDACTED_VALUE}`,
    );
  });

  test("redacts a secret containing regex metacharacters", () => {
    const result: { cron: string; error: string | null } =
      QueueWorkflow.buildScheduleCronFromVariables(
        "{{local.variables.schedule}}",
        { schedule: "a.*b(c)+[d]$" },
        {},
        ["a.*b(c)+[d]$"],
      );

    expect(result.error).not.toContain("a.*b(c)+[d]$");
    expect(result.error).toContain(WORKFLOW_LOG_REDACTED_VALUE);
  });

  test("redacts a secret from the global scope", () => {
    const result: { cron: string; error: string | null } =
      QueueWorkflow.buildScheduleCronFromVariables(
        "{{global.variables.cron}}",
        {},
        { cron: "global-secret-cron" },
        ["global-secret-cron"],
      );

    expect(result.error).not.toContain("global-secret-cron");
  });

  test("an empty secret does not turn the whole message into redaction markers", () => {
    const result: { cron: string; error: string | null } =
      QueueWorkflow.buildScheduleCronFromVariables("60 * * * *", {}, {}, [""]);

    expect(result.error).toContain("60 * * * *");
    expect(result.error).not.toContain(WORKFLOW_LOG_REDACTED_VALUE);
  });

  test("with no secrets the message is unchanged", () => {
    const result: { cron: string; error: string | null } =
      QueueWorkflow.buildScheduleCronFromVariables(
        "{{local.variables.schedule}}",
        { schedule: "plain-invalid" },
        {},
        [],
      );

    expect(result.error).toContain("plain-invalid");
    expect(result.error).not.toContain(WORKFLOW_LOG_REDACTED_VALUE);
  });

  test("redacts a secret out of the unresolved-variable error too", () => {
    const result: { cron: string; error: string | null } =
      QueueWorkflow.buildScheduleCronFromVariables(
        "{{local.variables.missing}}",
        {},
        {},
        ["{{local.variables.missing}}"],
      );

    expect(result.error).not.toContain("{{local.variables.missing}}");
    expect(result.error).toContain("could not be resolved");
  });

  test("a valid resolved cron returns no error to redact", () => {
    const result: { cron: string; error: string | null } =
      QueueWorkflow.buildScheduleCronFromVariables(
        "{{local.variables.schedule}}",
        { schedule: "0 */6 * * *" },
        {},
        ["0 */6 * * *"],
      );

    expect(result.error).toBeNull();
    expect(result.cron).toBe("0 */6 * * *");
  });
});
