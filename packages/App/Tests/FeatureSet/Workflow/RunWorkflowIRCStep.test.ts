import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import DataSourceEgressGuard from "Common/Server/Utils/DataSource/EgressGuard";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { NodeDataProp, NodeType } from "Common/Types/Workflow/Component";
import ComponentID from "Common/Types/Workflow/ComponentID";
import IRCComponents from "Common/Types/Workflow/Components/IRC";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import {
  FakeIRCServer,
  FakeIRCServerOptions,
  linesSent,
  startFakeIRCServer,
} from "Common/Tests/Server/Utils/IRC/FakeIRCServer";
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
 * "Send Message to IRC" run by the workflow runner itself: its settings as
 * the builder saves them, resolved by getComponentArguments, handed to the
 * real step from the registry, which talks to an IRC server on 127.0.0.1.
 * Only the database is not real.
 *
 * What this adds to the step's own tests: a toggle, a number and a password
 * arrive as the step reads them, and the run log the runner writes - what a
 * Workflow Viewer can read - holds what the step did and none of its
 * passwords, though the server got every one of them.
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

const SECRETS: Array<string> = [
  "bouncer-pass",
  "correct horse battery",
  "hunter2",
];

interface PersistedLog {
  logs: string;
  workflowStatus: WorkflowStatus;
}

interface RecordedSpy {
  mock: { calls: Array<Array<unknown>> };
}

let server: FakeIRCServer | undefined;

function ircStep(args: JSONObject): NodeDataProp {
  const metadata: NodeDataProp["metadata"] = IRCComponents.find(
    (component: NodeDataProp["metadata"]) => {
      return component.id === ComponentID.IRCSendMessageToChannel;
    },
  )!;

  return {
    error: "",
    id: "irc-1",
    internalId: "irc-1-internal",
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    arguments: args,
    returnValues: {},
    componentType: metadata.componentType,
  };
}

async function run(step: NodeDataProp): Promise<PersistedLog> {
  const runner: RunWorkflow = new RunWorkflow();

  const workflow: Workflow = new Workflow();
  workflow.id = WORKFLOW_ID;
  workflow.projectId = PROJECT_ID;
  workflow.isEnabled = true;
  workflow.name = "Notify IRC";
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

  const storageMap: StorageMap = {
    local: { variables: {}, components: {} },
    global: { variables: {} },
  };

  jest.spyOn(runner, "makeRunStack").mockResolvedValue(runStack);
  jest.spyOn(runner, "getVariables").mockResolvedValue({
    storageMap: storageMap,
    variables: [],
  });

  await runner.runWorkflow({
    arguments: {},
    workflowId: WORKFLOW_ID,
    workflowLogId: WORKFLOW_LOG_ID,
    timeout: 30_000,
  });

  const calls: Array<Array<unknown>> = updateLogSpy.mock.calls;
  const last: unknown = calls[calls.length - 1]?.[0];

  return (last as { data: PersistedLog }).data;
}

async function start(options: FakeIRCServerOptions): Promise<FakeIRCServer> {
  server = await startFakeIRCServer(options);
  return server;
}

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });

  // The one address a test can listen on, which the real guard refuses.
  jest
    .spyOn(DataSourceEgressGuard, "assertHostnameAllowed")
    .mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
});

afterEach(async () => {
  jest.restoreAllMocks();

  if (server) {
    await server.close();
    server = undefined;
  }
});

describe("RunWorkflow runs Send Message to IRC", () => {
  test("delivers the message, signed in, and the run log keeps every password out", async () => {
    const fakeServer: FakeIRCServer = await start({
      password: "bouncer-pass",
      sasl: { username: "deploy", password: "correct horse battery" },
      channelKey: "hunter2",
    });

    const persisted: PersistedLog = await run(
      ircStep({
        server: "irc.example.invalid",
        port: fakeServer.port,
        "disable-tls": true,
        channel: "#ops",
        text: "Incident #42 declared\nSeverity: Critical",
        "channel-key": "hunter2",
        "server-password": "bouncer-pass",
        "sasl-username": "deploy",
        "sasl-password": "correct horse battery",
      }),
    );

    expect(linesSent(fakeServer)).toEqual(
      expect.arrayContaining([
        "PASS bouncer-pass",
        "CAP END",
        "JOIN #ops hunter2",
        "PRIVMSG #ops :Incident #42 declared",
        "PRIVMSG #ops :Severity: Critical",
        "QUIT :Sent from OneUptime",
      ]),
    );

    expect(persisted.workflowStatus).toBe(WorkflowStatus.Success);
    expect(persisted.logs).toContain("Executing Port: Success");
    expect(persisted.logs).toContain('Signed in with SASL as "deploy".');
    expect(persisted.logs).toContain("Joined #ops.");
    expect(persisted.logs).toContain("Sent 2 lines to #ops.");
    expect(persisted.logs).toContain(WORKFLOW_LOG_REDACTED_VALUE);
    // What is not secret is there to read.
    expect(persisted.logs).toContain("irc.example.invalid");

    for (const secret of SECRETS) {
      expect(persisted.logs).not.toContain(secret);
    }
  });

  test("a refusal takes the Error port, with the server's reason in the log", async () => {
    const fakeServer: FakeIRCServer = await start({
      joinReply:
        ":irc.fake.test 474 {nick} #ops :Cannot join channel (+b) - you are banned",
    });

    const persisted: PersistedLog = await run(
      ircStep({
        server: "irc.example.invalid",
        port: String(fakeServer.port),
        "disable-tls": "true",
        channel: "#ops",
        text: "Deploy finished",
      }),
    );

    expect(persisted.logs).toContain("Executing Port: Error");
    expect(persisted.logs).toContain(
      "Could not join #ops: Cannot join channel (+b) - you are banned.",
    );
    expect(
      linesSent(fakeServer).some((line: string) => {
        return line.startsWith("PRIVMSG");
      }),
    ).toBe(false);
  });

  test("a setting that cannot work stops the run before anything connects", async () => {
    const fakeServer: FakeIRCServer = await start({});

    const persisted: PersistedLog = await run(
      ircStep({
        server: "ircs://irc.example.invalid",
        port: fakeServer.port,
        channel: "#ops",
        text: "Deploy finished",
      }),
    );

    expect(persisted.workflowStatus).toBe(WorkflowStatus.Error);
    expect(persisted.logs).toContain('without "irc://" or "ircs://"');
    expect(fakeServer.connectionCount()).toBe(0);
  });
});
