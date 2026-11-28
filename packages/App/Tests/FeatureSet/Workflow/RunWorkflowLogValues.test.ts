import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import ProjectService from "Common/Server/Services/ProjectService";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import logger from "Common/Server/Utils/Logger";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  ComponentType,
  NodeDataProp,
  NodeType,
  Port,
  ReturnValue,
} from "Common/Types/Workflow/Component";
import {
  getLeftOutMarker,
  MAX_LOG_VALUE_LENGTH,
} from "Common/Types/Workflow/RunLogValues";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import QueueWorkflow from "../../../FeatureSet/Workflow/Services/QueueWorkflow";
import RunWorkflow, {
  RunStack,
  RunStackItem,
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
 * A WORKFLOW RUN'S TEXT LOG, VALUE BY VALUE (#11476), through the runner:
 *
 *   - each value the log writes is cut to 65,536 characters, ending with
 *     how many were left out - a step's arguments and returned values each
 *     on their own, and what a step logs itself;
 *   - secrets come out of the whole value before it is cut, so one the cut
 *     would split is still taken out whole;
 *   - a value a step returned as sensitive stays hidden when a later step
 *     is handed it: in that step's arguments, in what it returns, in what it
 *     logs, in its error, in the Steps view - and after a Sleep too.
 *
 * Only the database is stubbed: the run's arguments are resolved from the
 * earlier steps' values as a real run resolves them.
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

interface RecordedSpy {
  mock: { calls: Array<Array<unknown>> };
}

type RunComponentImplementation = (
  args: JSONObject,
  node: NodeDataProp,
  onError: VoidFunction,
) => Promise<unknown>;

const OUT_PORT: Port = {
  id: "out",
  title: "Out",
  description: "Runs after this step.",
};

const argument: (
  id: string,
  type?: ComponentInputType,
  isSensitive?: boolean,
) => Argument = (
  id: string,
  type: ComponentInputType = ComponentInputType.Text,
  isSensitive?: boolean,
): Argument => {
  return {
    id: id,
    name: id,
    description: id,
    type: type,
    required: false,
    ...(isSensitive === undefined ? {} : { isSensitive: isSensitive }),
  };
};

const returnValue: (id: string, isSensitive?: boolean) => ReturnValue = (
  id: string,
  isSensitive?: boolean,
): ReturnValue => {
  return {
    id: id,
    name: id,
    description: id,
    type: ComponentInputType.AnyValue,
    required: false,
    ...(isSensitive === undefined ? {} : { isSensitive: isSensitive }),
  };
};

const metadata: (params: {
  id: string;
  args?: Array<Argument>;
  returnValues?: Array<ReturnValue>;
}) => ComponentMetadata = (params: {
  id: string;
  args?: Array<Argument>;
  returnValues?: Array<ReturnValue>;
}): ComponentMetadata => {
  return {
    id: params.id,
    title: params.id,
    category: "Test",
    description: params.id,
    iconProp: IconProp.Bolt,
    componentType: ComponentType.Component,
    arguments: params.args || [],
    returnValues: params.returnValues || [],
    inPorts: [],
    outPorts: [OUT_PORT],
  };
};

const node: (
  id: string,
  componentMetadata: ComponentMetadata,
  configured?: JSONObject,
) => NodeDataProp = (
  id: string,
  componentMetadata: ComponentMetadata,
  configured?: JSONObject,
): NodeDataProp => {
  return {
    error: "",
    id: id,
    nodeType: NodeType.Node,
    metadata: componentMetadata,
    metadataId: componentMetadata.id,
    internalId: `internal-${id}`,
    arguments: configured || {},
    returnValues: {},
    componentType: ComponentType.Component,
  };
};

const stackOf: (
  items: Array<{ node: NodeDataProp; next?: Array<string> }>,
) => RunStack = (
  items: Array<{ node: NodeDataProp; next?: Array<string> }>,
): RunStack => {
  const stack: Record<string, RunStackItem> = {};

  for (const item of items) {
    stack[item.node.id] = {
      node: item.node,
      outPorts: item.next ? { [OUT_PORT.id]: item.next } : {},
    };
  }

  return { stack: stack, startWithComponentId: items[0]!.node.id };
};

const secretVariable: (content: string) => WorkflowVariable = (
  content: string,
): WorkflowVariable => {
  const variable: WorkflowVariable = new WorkflowVariable();
  variable.name = "token";
  variable.content = content;
  variable.isSecret = true;
  return variable;
};

const prepareRun: (
  runner: RunWorkflow,
  params: {
    stack: RunStack;
    variables?: Array<WorkflowVariable>;
    run: RunComponentImplementation;
  },
) => RecordedSpy = (
  runner: RunWorkflow,
  params: {
    stack: RunStack;
    variables?: Array<WorkflowVariable>;
    run: RunComponentImplementation;
  },
): RecordedSpy => {
  const workflowRow: Workflow = new Workflow();
  workflowRow.graph = { nodes: [], edges: [] } as JSONObject;
  workflowRow.projectId = PROJECT_ID;
  workflowRow.isEnabled = true;

  jest
    .spyOn(WorkflowService as never, "findOneById")
    .mockResolvedValue(workflowRow as never);

  const updateLogSpy: RecordedSpy = jest
    .spyOn(WorkflowLogService as never, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never) as unknown as RecordedSpy;

  jest.spyOn(runner, "makeRunStack").mockResolvedValue(params.stack as never);

  const storageMap: StorageMap = {
    local: { variables: {}, components: {} },
    global: { variables: {} },
  };

  for (const variable of params.variables || []) {
    storageMap.local.variables[variable.name!] = variable.content!;
  }

  jest.spyOn(runner, "getVariables").mockResolvedValue({
    storageMap: storageMap,
    variables: params.variables || [],
  } as never);

  jest.spyOn(runner, "runComponent").mockImplementation(params.run as never);

  return updateLogSpy;
};

const run: (runner: RunWorkflow, isResume?: boolean) => Promise<void> = async (
  runner: RunWorkflow,
  isResume?: boolean,
): Promise<void> => {
  await runner.runWorkflow({
    arguments: {},
    workflowId: WORKFLOW_ID,
    workflowLogId: WORKFLOW_LOG_ID,
    timeout: 20_000,
    ...(isResume ? { isResume: true } : {}),
  });
};

// What the run stored last: its log, its trace, its status.
const lastPersisted: (updateLogSpy: RecordedSpy) => {
  logs: string;
  stepTrace: string;
  workflowStatus: WorkflowStatus;
} = (
  updateLogSpy: RecordedSpy,
): {
  logs: string;
  stepTrace: string;
  workflowStatus: WorkflowStatus;
} => {
  const lastCall: unknown =
    updateLogSpy.mock.calls[updateLogSpy.mock.calls.length - 1]?.[0];
  const data: JSONObject = (lastCall as { data: JSONObject }).data;

  return {
    logs: String(data["logs"]),
    stepTrace: JSON.stringify(data["stepTrace"]),
    workflowStatus: data["workflowStatus"] as WorkflowStatus,
  };
};

// The log line that follows a heading the runner writes.
const lineAfter: (logs: string, heading: string, nth?: number) => string = (
  logs: string,
  heading: string,
  nth: number = 0,
): string => {
  const lines: Array<string> = logs.split("\n");
  let seen: number = 0;

  for (let index: number = 0; index < lines.length; index++) {
    if (lines[index]!.endsWith(`: ${heading}`)) {
      if (seen === nth) {
        return lines[index + 1] || "";
      }

      seen++;
    }
  }

  return "";
};

// The bytes of a picture, in base64, as Get Files From Markdown hands them on.
const BYTES: string = Buffer.alloc(3000, 7).toString("base64");
const ADDRESS: string = `https://oneuptime.example.com/file/image/access-token/${"ab".repeat(32)}`;

const FILES: Array<JSONObject> = [
  {
    name: "screenshot.png",
    mimeType: "image/png",
    sizeInBytes: 3000,
    base64: BYTES,
    contentId: "image-0123456789abcdef01234567",
    urls: [ADDRESS],
    fields: ["description"],
  },
];

// A step like Get Files From Markdown: its Files sensitive, its Count not.
const GET_FILES: ComponentMetadata = metadata({
  id: "get-files",
  returnValues: [returnValue("files", true), returnValue("count")],
});

/*
 * A step a workflow hands the files to: an email with attachments, a
 * message that names them, and a value of its own.
 */
const SEND: ComponentMetadata = metadata({
  id: "send",
  args: [
    argument("attachments", ComponentInputType.JSONArray),
    argument("message"),
    argument("body", ComponentInputType.JSON),
  ],
  returnValues: [returnValue("sent"), returnValue("echo")],
});

const FILES_REFERENCE: string =
  "{{local.components.get-files-1.returnValues.files}}";

describe("RunWorkflow writes each value of its log cut short", () => {
  beforeEach(() => {
    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const STEP: ComponentMetadata = metadata({
    id: "api-get",
    args: [argument("url"), argument("note")],
    returnValues: [returnValue("body"), returnValue("status")],
  });

  test("a returned value of ten megabytes is written as its first 65,536 characters and how many more there were", async () => {
    const body: string = "x".repeat(10 * 1024 * 1024);
    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareRun(runner, {
      stack: stackOf([{ node: node("api-1", STEP) }]),
      run: async (): Promise<unknown> => {
        return {
          returnValues: { body: body, status: 200 },
          executePort: OUT_PORT,
        };
      },
    });

    await run(runner);

    const persisted: { logs: string } = lastPersisted(updateLogSpy);
    const returned: string = lineAfter(persisted.logs, "Data Returned");

    expect(returned).toContain(
      `"body":"${"x".repeat(MAX_LOG_VALUE_LENGTH)}${getLeftOutMarker(body.length - MAX_LOG_VALUE_LENGTH)}"`,
    );
    // The other value of the step, whole.
    expect(returned).toContain('"status":200');
    expect(persisted.logs).not.toContain("x".repeat(MAX_LOG_VALUE_LENGTH + 1));
    // The whole log: a little over one cut value, not ten megabytes.
    expect(persisted.logs.length).toBeLessThan(MAX_LOG_VALUE_LENGTH + 4096);
  });

  test("each argument is cut on its own: a long one does not cut the next one off", async () => {
    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareRun(runner, {
      stack: stackOf([
        {
          node: node("api-1", STEP, {
            url: `https://example.com/?q=${"y".repeat(MAX_LOG_VALUE_LENGTH * 2)}`,
            note: "still here",
          }),
        },
      ]),
      run: async (): Promise<unknown> => {
        return { returnValues: {}, executePort: OUT_PORT };
      },
    });

    await run(runner);

    const args: string = lineAfter(
      lastPersisted(updateLogSpy).logs,
      "Component Args:",
    );

    expect(args).toContain('"note":"still here"');
    expect(args).toContain("more characters left out)");
    expect(args.length).toBeLessThan(MAX_LOG_VALUE_LENGTH + 1024);
  });

  test("what a step logs itself is cut too", async () => {
    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareRun(runner, {
      stack: stackOf([{ node: node("api-1", STEP) }]),
      run: async (): Promise<unknown> => {
        runner.log(`Response: ${"z".repeat(MAX_LOG_VALUE_LENGTH * 3)}`);
        runner.log({ headers: "h".repeat(MAX_LOG_VALUE_LENGTH + 5) });
        return { returnValues: {}, executePort: OUT_PORT };
      },
    });

    await run(runner);

    const logs: string = lastPersisted(updateLogSpy).logs;

    expect(logs).not.toContain("z".repeat(MAX_LOG_VALUE_LENGTH));
    expect(logs).toContain(getLeftOutMarker(MAX_LOG_VALUE_LENGTH * 2 + 10));
    expect(logs).toContain(
      `{"headers":"${"h".repeat(MAX_LOG_VALUE_LENGTH)}${getLeftOutMarker(5)}"}`,
    );
  });

  test("a value that fits is written whole, as before", async () => {
    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareRun(runner, {
      stack: stackOf([{ node: node("api-1", STEP) }]),
      run: async (): Promise<unknown> => {
        return {
          returnValues: { body: "ok", status: 204 },
          executePort: OUT_PORT,
        };
      },
    });

    await run(runner);

    expect(
      lineAfter(lastPersisted(updateLogSpy).logs, "Data Returned"),
    ).toMatch(/: \{"body":"ok","status":204\}$/);
  });

  test("a secret the cut would split is taken out whole first: no part of it is left", async () => {
    const secret: string = "S3CR3T-hunter2-TOKEN-value-0123456789";
    // The secret starts six characters before the cut and runs past it.
    const body: string =
      "a".repeat(MAX_LOG_VALUE_LENGTH - 6) + secret + "b".repeat(50);

    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareRun(runner, {
      stack: stackOf([{ node: node("api-1", STEP) }]),
      variables: [secretVariable(secret)],
      run: async (): Promise<unknown> => {
        return { returnValues: { body: body }, executePort: OUT_PORT };
      },
    });

    await run(runner);

    const logs: string = lastPersisted(updateLogSpy).logs;

    // Not its whole, nor the six characters the cut would have kept.
    expect(logs).not.toContain(secret);
    expect(logs).not.toContain("S3CR3T");
    // The cut falls inside the marker instead.
    expect(logs).toContain(
      "a".repeat(MAX_LOG_VALUE_LENGTH - 6) +
        "[REDAC" +
        getLeftOutMarker("[REDACTED]".length - 6 + 50),
    );
  });
});

describe("RunWorkflow keeps a value a step marked sensitive hidden when later steps are handed it", () => {
  beforeEach(() => {
    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // What each step was handed, as it ran.
  let handed: Record<string, JSONObject> = {};

  // Get Files returns the files; Send echoes what it was handed.
  const runSteps: (
    sendReturns?: (args: JSONObject) => JSONObject,
  ) => RunComponentImplementation = (
    sendReturns?: (args: JSONObject) => JSONObject,
  ): RunComponentImplementation => {
    return async (
      args: JSONObject,
      componentNode: NodeDataProp,
    ): Promise<unknown> => {
      handed[componentNode.id] = args;

      if (componentNode.metadataId === GET_FILES.id) {
        return {
          returnValues: { files: FILES, count: 1 },
          executePort: OUT_PORT,
        };
      }

      return {
        returnValues: sendReturns
          ? sendReturns(args)
          : { sent: true, echo: args["attachments"] },
        executePort: OUT_PORT,
      };
    };
  };

  beforeEach(() => {
    handed = {};
  });

  const twoSteps: (configured: JSONObject) => RunStack = (
    configured: JSONObject,
  ): RunStack => {
    return stackOf([
      { node: node("get-files-1", GET_FILES), next: ["send-1"] },
      { node: node("send-1", SEND, configured) },
    ]);
  };

  test("handed it whole: the later step's argument is the marker, and what it returns of it too", async () => {
    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareRun(runner, {
      stack: twoSteps({ attachments: FILES_REFERENCE }),
      run: runSteps(),
    });

    await run(runner);

    const persisted: { logs: string; stepTrace: string } =
      lastPersisted(updateLogSpy);

    // The step still ran with the files themselves, as a text setting is handed a list.
    expect(handed["send-1"]!["attachments"]).toBe(
      JSON.stringify(FILES, null, 2),
    );

    expect(lineAfter(persisted.logs, "Component Args:", 1)).toContain(
      `"attachments":"${WORKFLOW_LOG_REDACTED_VALUE}"`,
    );
    expect(lineAfter(persisted.logs, "Data Returned", 1)).toContain(
      `"echo":"${WORKFLOW_LOG_REDACTED_VALUE}"`,
    );
    // Its own values, whole.
    expect(lineAfter(persisted.logs, "Data Returned", 1)).toContain(
      '"sent":true',
    );
    expect(persisted.logs).not.toContain(BYTES);
    expect(persisted.stepTrace).not.toContain(BYTES);
    expect(persisted.stepTrace).toContain(WORKFLOW_LOG_REDACTED_VALUE);
  });

  test("the step that returned it hides it as it always did, and its other values not", async () => {
    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareRun(runner, {
      stack: twoSteps({ attachments: FILES_REFERENCE }),
      run: runSteps(),
    });

    await run(runner);

    expect(
      lineAfter(lastPersisted(updateLogSpy).logs, "Data Returned", 0),
    ).toMatch(new RegExp(`"files":"\\[REDACTED\\]","count":1`));
  });

  test("written into a message: its text is taken out, the rest of the message is kept", async () => {
    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareRun(runner, {
      stack: twoSteps({
        message: `Here are the screenshots: ${FILES_REFERENCE} Thanks.`,
      }),
      run: runSteps(),
    });

    await run(runner);

    const persisted: { logs: string; stepTrace: string } =
      lastPersisted(updateLogSpy);
    const args: string = lineAfter(persisted.logs, "Component Args:", 1);

    expect(String(handed["send-1"]!["message"])).toContain(BYTES);
    expect(args).toContain("Here are the screenshots: ");
    expect(args).toContain(" Thanks.");
    expect(args).toContain(WORKFLOW_LOG_REDACTED_VALUE);
    expect(persisted.logs).not.toContain(BYTES);
    expect(persisted.stepTrace).not.toContain(BYTES);
  });

  test("built into a JSON body: the picture's bytes and address are taken out, its name and type are kept", async () => {
    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareRun(runner, {
      stack: twoSteps({
        body: `{"subject": "Checkout is down", "attachments": ${FILES_REFERENCE}}`,
      }),
      run: runSteps((args: JSONObject): JSONObject => {
        return { sent: true, echo: args["body"]! };
      }),
    });

    await run(runner);

    const persisted: { logs: string; stepTrace: string } =
      lastPersisted(updateLogSpy);

    expect((handed["send-1"]!["body"] as JSONObject)["attachments"]).toEqual(
      FILES,
    );
    expect(persisted.logs).not.toContain(BYTES);
    expect(persisted.logs).not.toContain(ADDRESS);
    expect(persisted.stepTrace).not.toContain(BYTES);
    expect(lineAfter(persisted.logs, "Component Args:", 1)).toContain(
      "Checkout is down",
    );
    expect(lineAfter(persisted.logs, "Component Args:", 1)).toContain(
      "screenshot.png",
    );
  });

  test("what the later step logs, and the error it fails with, are kept from it too", async () => {
    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareRun(runner, {
      stack: twoSteps({ attachments: FILES_REFERENCE }),
      run: async (
        args: JSONObject,
        componentNode: NodeDataProp,
      ): Promise<unknown> => {
        if (componentNode.metadataId === GET_FILES.id) {
          return {
            returnValues: { files: FILES, count: 1 },
            executePort: OUT_PORT,
          };
        }

        const first: JSONObject = (
          JSON.parse(String(args["attachments"])) as Array<JSONObject>
        )[0]!;

        runner.log(`Uploading ${String(first["base64"])}`);
        throw new BadDataException(
          `Graph refused the attachment ${String(first["base64"])}`,
        );
      },
    });

    await run(runner);

    const persisted: {
      logs: string;
      stepTrace: string;
      workflowStatus: WorkflowStatus;
    } = lastPersisted(updateLogSpy);

    expect(persisted.workflowStatus).toBe(WorkflowStatus.Error);
    expect(persisted.logs).toContain(
      `Uploading ${WORKFLOW_LOG_REDACTED_VALUE}`,
    );
    expect(persisted.logs).toContain("Graph refused the attachment");
    expect(persisted.logs).not.toContain(BYTES);
    expect(persisted.stepTrace).not.toContain(BYTES);
  });

  test("a value not marked sensitive is written as it was", async () => {
    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareRun(runner, {
      stack: twoSteps({
        message: "{{local.components.get-files-1.returnValues.count}} file",
      }),
      run: runSteps((): JSONObject => {
        return { sent: true };
      }),
    });

    await run(runner);

    expect(
      lineAfter(lastPersisted(updateLogSpy).logs, "Component Args:", 1),
    ).toContain('"message":"1 file"');
  });

  test("a sensitive value with nothing long in it is not carried: a later step's log keeps reading", async () => {
    const tiny: Array<JSONObject> = [{ name: "a.png", mimeType: "image/png" }];
    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareRun(runner, {
      stack: twoSteps({ message: "Sending image/png now" }),
      run: async (
        _args: JSONObject,
        componentNode: NodeDataProp,
      ): Promise<unknown> => {
        return {
          returnValues:
            componentNode.metadataId === GET_FILES.id
              ? { files: tiny, count: 1 }
              : { sent: true },
          executePort: OUT_PORT,
        };
      },
    });

    await run(runner);

    expect(
      lineAfter(lastPersisted(updateLogSpy).logs, "Component Args:", 1),
    ).toContain('"message":"Sending image/png now"');
  });

  test("a secret and a sensitive value in one line are both taken out", async () => {
    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareRun(runner, {
      stack: twoSteps({
        message: `Bearer {{local.variables.token}} ${FILES_REFERENCE}`,
      }),
      variables: [secretVariable("hunter2-bearer-token")],
      run: runSteps(),
    });

    await run(runner);

    const logs: string = lastPersisted(updateLogSpy).logs;

    expect(String(handed["send-1"]!["message"])).toContain(
      "hunter2-bearer-token",
    );
    expect(logs).not.toContain("hunter2-bearer-token");
    expect(logs).not.toContain(BYTES);
  });

  test("handed it after a Sleep: still hidden, carried again from what the run kept", async () => {
    const storedLog: WorkflowLog = new WorkflowLog();
    storedLog.logs = "earlier lines";
    storedLog.stepTrace = { steps: [] } as unknown as JSONObject;
    storedLog.resumeData = {
      pendingStack: ["send-1"],
      executedComponents: ["get-files-1"],
      componentReturnValues: {
        "get-files-1": { returnValues: { files: FILES, count: 1 } },
      },
    } as unknown as JSONObject;

    jest
      .spyOn(WorkflowLogService as never, "findOneById")
      .mockResolvedValue(storedLog as never);
    jest
      .spyOn(QueueWorkflow, "addResumeJobToQueue")
      .mockResolvedValue(undefined as never);

    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareRun(runner, {
      stack: twoSteps({
        attachments: FILES_REFERENCE,
        message: `Again: ${FILES_REFERENCE}`,
      }),
      run: runSteps(),
    });

    await run(runner, true);

    const persisted: { logs: string; stepTrace: string } =
      lastPersisted(updateLogSpy);

    // Only the step after the Sleep ran, with the files themselves.
    expect(Object.keys(handed)).toEqual(["send-1"]);
    expect(handed["send-1"]!["attachments"]).toBe(
      JSON.stringify(FILES, null, 2),
    );
    expect(persisted.logs).toContain(
      `"attachments":"${WORKFLOW_LOG_REDACTED_VALUE}"`,
    );
    expect(persisted.logs).not.toContain(BYTES);
    expect(persisted.stepTrace).not.toContain(BYTES);
  });

  test("handed a value of megabytes three times over, the log stays small and holds none of it", async () => {
    const bigFiles: Array<JSONObject> = [
      {
        ...FILES[0]!,
        base64: Buffer.alloc(3 * 1024 * 1024, 9).toString("base64"),
      },
    ];
    const bigBytes: string = String(bigFiles[0]!["base64"]);

    const runner: RunWorkflow = new RunWorkflow();
    const updateLogSpy: RecordedSpy = prepareRun(runner, {
      stack: stackOf([
        { node: node("get-files-1", GET_FILES), next: ["send-1"] },
        {
          node: node("send-1", SEND, {
            attachments: FILES_REFERENCE,
            message: `Inline: ${FILES_REFERENCE}`,
          }),
          next: ["send-2"],
        },
        {
          node: node("send-2", SEND, { attachments: FILES_REFERENCE }),
        },
      ]),
      run: async (
        args: JSONObject,
        componentNode: NodeDataProp,
      ): Promise<unknown> => {
        if (componentNode.metadataId === GET_FILES.id) {
          return {
            returnValues: { files: bigFiles, count: 1 },
            executePort: OUT_PORT,
          };
        }

        return {
          returnValues: { sent: true, echo: args["attachments"] },
          executePort: OUT_PORT,
        };
      },
    });

    await run(runner);

    const persisted: { logs: string; stepTrace: string } =
      lastPersisted(updateLogSpy);

    expect(persisted.logs).not.toContain(bigBytes.slice(0, 64));
    expect(persisted.stepTrace).not.toContain(bigBytes.slice(0, 64));
    expect(persisted.logs.length).toBeLessThan(64 * 1024);
  });
});
