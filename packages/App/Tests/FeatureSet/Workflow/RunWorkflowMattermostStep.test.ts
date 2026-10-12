import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { NodeDataProp, NodeType } from "Common/Types/Workflow/Component";
import ComponentID from "Common/Types/Workflow/ComponentID";
import MattermostComponents from "Common/Types/Workflow/Components/Mattermost";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import {
  FakeMattermostAnswer,
  FakeMattermostServer,
  mattermostAppError,
  startFakeMattermostServer,
} from "Common/Tests/Server/Utils/Mattermost/FakeMattermostServer";
import RunWorkflow, {
  RunStack,
  StorageMap,
  WORKFLOW_LOG_REDACTED_VALUE,
} from "../../../FeatureSet/Workflow/Services/RunWorkflow";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * "Send Message to Mattermost" run by the workflow runner itself: its
 * settings as the builder saves them, resolved by getComponentArguments -
 * the webhook's URL from a secret global variable, the message from a
 * reference - and handed to the real step from the registry, which posts to
 * a Mattermost on 127.0.0.1. Only the database is not real.
 *
 * What this adds to the step's own tests: the URL reaches the step through
 * a variable, and the run log the runner writes - what a Workflow Viewer can
 * read - holds what the step did and Mattermost's reason, but never the
 * webhook's URL, though Mattermost got the message through it.
 */

const WORKFLOW_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const WORKFLOW_LOG_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const HOOK_ID: string = "8kzq3wbcd7f1nmyxta5ruspeoe";
const ALLOWLIST_ENV: string = "PRIVATE_NETWORK_WEBHOOK_ALLOWLIST";

interface PersistedLog {
  logs: string;
  workflowStatus: WorkflowStatus;
}

interface RecordedSpy {
  mock: { calls: Array<Array<unknown>> };
}

let server: FakeMattermostServer | undefined;
let savedAllowlist: string | undefined;

function mattermostStep(args: JSONObject): NodeDataProp {
  const metadata: NodeDataProp["metadata"] = MattermostComponents.find(
    (component: NodeDataProp["metadata"]) => {
      return component.id === ComponentID.MattermostSendMessageToChannel;
    },
  )!;

  return {
    error: "",
    id: "mattermost-1",
    internalId: "mattermost-1-internal",
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    arguments: args,
    returnValues: {},
    componentType: metadata.componentType,
  };
}

function webhookUrl(): string {
  return `http://127.0.0.1:${server!.port}/hooks/${HOOK_ID}`;
}

/*
 * Runs the one step, with the webhook's URL kept in a secret global
 * variable, as the step's help says to keep it.
 */
async function run(step: NodeDataProp): Promise<{
  persisted: PersistedLog;
  everything: string;
}> {
  const runner: RunWorkflow = new RunWorkflow();

  const workflow: Workflow = new Workflow();
  workflow.id = WORKFLOW_ID;
  workflow.projectId = PROJECT_ID;
  workflow.isEnabled = true;
  workflow.name = "Notify Mattermost";
  workflow.graph = { nodes: [], edges: [] };

  jest
    .spyOn(
      WorkflowService as unknown as {
        findOneById: (query: unknown) => Promise<Workflow | null>;
      },
      "findOneById",
    )
    .mockResolvedValue(workflow);

  const updateLogSpy: RecordedSpy = jest
    .spyOn(
      WorkflowLogService as unknown as {
        updateColumnsByIdWithoutHooks: (update: unknown) => Promise<void>;
      },
      "updateColumnsByIdWithoutHooks",
    )
    .mockResolvedValue(undefined) as unknown as RecordedSpy;

  const runStack: RunStack = {
    startWithComponentId: step.id,
    stack: { [step.id]: { node: step, outPorts: {} } },
  };

  const secret: WorkflowVariable = new WorkflowVariable();
  secret.name = "MATTERMOST_WEBHOOK_URL";
  secret.content = webhookUrl();
  secret.isSecret = true;

  const storageMap: StorageMap = {
    local: { variables: {}, components: {} },
    global: { variables: { MATTERMOST_WEBHOOK_URL: webhookUrl() } },
  };

  jest.spyOn(runner, "makeRunStack").mockResolvedValue(runStack);
  jest.spyOn(runner, "getVariables").mockResolvedValue({
    storageMap: storageMap,
    variables: [secret],
  });

  await runner.runWorkflow({
    arguments: {},
    workflowId: WORKFLOW_ID,
    workflowLogId: WORKFLOW_LOG_ID,
    timeout: 30_000,
  });

  const calls: Array<Array<unknown>> = updateLogSpy.mock.calls;
  const last: unknown = calls[calls.length - 1]?.[0];

  return {
    persisted: (last as { data: PersistedLog }).data,
    // Every write of the run log, all of it: what anyone could ever read.
    everything: JSON.stringify(calls),
  };
}

async function start(
  answer?: (request: unknown) => FakeMattermostAnswer,
): Promise<FakeMattermostServer> {
  server = await startFakeMattermostServer({ answer: answer });
  return server;
}

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });

  // The test's Mattermost is on loopback, which only an exact entry opens.
  savedAllowlist = process.env[ALLOWLIST_ENV];
  process.env[ALLOWLIST_ENV] = "127.0.0.1";
});

afterEach(async () => {
  jest.restoreAllMocks();

  if (savedAllowlist === undefined) {
    delete process.env[ALLOWLIST_ENV];
  } else {
    process.env[ALLOWLIST_ENV] = savedAllowlist;
  }

  if (server) {
    await server.close();
    server = undefined;
  }
});

describe("RunWorkflow runs Send Message to Mattermost", () => {
  test("posts the message through the URL in a secret variable, and the run log never shows the URL", async () => {
    const fakeServer: FakeMattermostServer = await start();

    const { persisted, everything } = await run(
      mattermostStep({
        "webhook-url": "{{global.variables.MATTERMOST_WEBHOOK_URL}}",
        text: "**Incident 42 declared**\nSeverity: Critical",
        channel: "~ops",
        username: "OneUptime",
      }),
    );

    expect(fakeServer.requests).toHaveLength(1);
    expect(fakeServer.requests[0]!.url).toBe(`/hooks/${HOOK_ID}`);
    expect(JSON.parse(fakeServer.requests[0]!.body)).toEqual({
      text: "**Incident 42 declared**\nSeverity: Critical",
      channel: "ops",
      username: "OneUptime",
    });

    expect(persisted.workflowStatus).toBe(WorkflowStatus.Success);
    expect(persisted.logs).toContain("Executing Port: Success");
    expect(persisted.logs).toContain("Mattermost took the message for ops.");
    expect(persisted.logs).toContain(WORKFLOW_LOG_REDACTED_VALUE);
    // What is not secret is there to read.
    expect(persisted.logs).toContain("Incident 42 declared");

    expect(everything).not.toContain(HOOK_ID);
  });

  test("a URL typed into the step, not kept in a variable, is hidden in the log all the same", async () => {
    await start();

    const { persisted, everything } = await run(
      mattermostStep({
        "webhook-url": `http://127.0.0.1:${server!.port}/hooks/${HOOK_ID}`,
        text: "Deploy finished",
      }),
    );

    expect(persisted.workflowStatus).toBe(WorkflowStatus.Success);
    expect(persisted.logs).toContain("Mattermost took the message.");
    expect(everything).not.toContain(HOOK_ID);
  });

  test("a refusal takes the Error port, with Mattermost's reason in the log", async () => {
    const fakeServer: FakeMattermostServer = await start(() => {
      return mattermostAppError(
        403,
        "web.incoming_webhook.channel_locked.app_error",
        "This webhook is not permitted to post to the requested channel.",
      );
    });

    const { persisted, everything } = await run(
      mattermostStep({
        "webhook-url": "{{global.variables.MATTERMOST_WEBHOOK_URL}}",
        text: "Deploy finished",
        channel: "town-square",
      }),
    );

    expect(fakeServer.requests).toHaveLength(1);
    expect(persisted.logs).toContain("Executing Port: Error");
    expect(persisted.logs).toContain(
      "Mattermost refused the message (HTTP 403 Forbidden): This webhook is not permitted to post to the requested channel. This webhook is locked to its own channel: leave Channel empty, or use a webhook that is not locked.",
    );
    expect(everything).not.toContain(HOOK_ID);
  });

  test("a URL that is not a webhook's stops the run before anything is sent", async () => {
    const fakeServer: FakeMattermostServer = await start();

    const { persisted, everything } = await run(
      mattermostStep({
        "webhook-url": `http://127.0.0.1:${server!.port}/hooks/commands/${HOOK_ID}`,
        text: "Deploy finished",
      }),
    );

    expect(persisted.workflowStatus).toBe(WorkflowStatus.Error);
    expect(persisted.logs).toContain(
      "Mattermost Incoming Webhook URL is not an incoming webhook's URL.",
    );
    expect(fakeServer.requests).toHaveLength(0);
    expect(everything).not.toContain(HOOK_ID);
  });

  test("where the operator has not named the server, the guard refuses it and the Error port says why", async () => {
    delete process.env[ALLOWLIST_ENV];
    const fakeServer: FakeMattermostServer = await start();

    const { persisted, everything } = await run(
      mattermostStep({
        "webhook-url": "{{global.variables.MATTERMOST_WEBHOOK_URL}}",
        text: "Deploy finished",
      }),
    );

    expect(persisted.logs).toContain("Executing Port: Error");
    expect(persisted.logs).toContain(
      "Mattermost Incoming Webhook URL points to a private, loopback, or link-local address and is not allowed.",
    );
    expect(fakeServer.requests).toHaveLength(0);
    expect(everything).not.toContain(HOOK_ID);
  });
});
