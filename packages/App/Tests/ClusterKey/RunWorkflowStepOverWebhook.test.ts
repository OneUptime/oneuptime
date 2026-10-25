import {
  OPERATOR_CLUSTER_KEYS,
  restoreClusterKey,
  setClusterKey,
} from "Common/Tests/Server/TestingUtils/ShippedClusterKeys";
import type { PlaybookStepContext } from "Common/Server/Utils/SecurityPlaybook/SecurityPlaybookActions";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SecurityPlaybookActionType } from "Common/Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStepStatus } from "Common/Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import SecurityCasePriorityLevel from "Common/Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "Common/Types/SecurityCase/SecurityCaseStage";
import {
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
  testPriorityId,
  testStatusId,
} from "Common/Tests/Helpers/SecurityCaseValues";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { createServer, IncomingHttpHeaders, Server } from "http";
import { AddressInfo } from "net";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

/*
 * A security playbook's Run Workflow step starts a workflow through that
 * workflow's own Webhook trigger, inside the cluster. The trigger asks for
 * its URL's secret and nothing else, and the request's headers, query string
 * and body become the run's values, the project's to read.
 *
 * The rule: the step sends the case alone, and the trigger keeps every
 * header but the two the key OneUptime's own services present to each
 * other travels in.
 *
 * Everything here is real but the database and the dashboard address: the
 * playbook step's request goes over HTTP, through the real JSON parser, to
 * the real Webhook trigger mounted where the workflow service mounts it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CASE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const RUN_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const WORKFLOW_ID: string = "77777777-7777-4777-8777-777777777777";
const WEBHOOK_SECRET_KEY: string = "88888888-8888-4888-8888-888888888888";

const OPERATOR_KEY: string = OPERATOR_CLUSTER_KEYS[0]!.value!;

type AnyModule = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function require_(modulePath: string): AnyModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require(modulePath);
}

// What a run was started with: the trigger's values.
interface StartedRun {
  workflowId: string;
  returnValues: JSONObject;
}

interface WorkflowService {
  http: Server;
  origin: string;
  runs: Array<StartedRun>;
  SecurityPlaybookActions: AnyModule;
  ClusterKeyAuthorization: AnyModule;
}

/*
 * One installation, its operator's ONEUPTIME_SECRET set: the workflow service
 * listening on the address the app reaches it at (SERVER_APP_HOSTNAME and
 * APP_PORT), with the Webhook trigger mounted under /workflow.
 */
async function startWorkflowService(): Promise<WorkflowService> {
  const http: Server = createServer();

  await new Promise<void>((resolve: () => void) => {
    http.listen(0, "127.0.0.1", resolve);
  });

  const port: number = (http.address() as AddressInfo).port;
  const saved: Record<string, string | undefined> = {
    SERVER_APP_HOSTNAME: process.env["SERVER_APP_HOSTNAME"],
    APP_PORT: process.env["APP_PORT"],
  };

  process.env["SERVER_APP_HOSTNAME"] = "127.0.0.1";
  process.env["APP_PORT"] = String(port);
  setClusterKey(OPERATOR_KEY);

  const runs: Array<StartedRun> = [];
  let service: WorkflowService | null = null;

  try {
    jest.isolateModules(() => {
      const Express: AnyModule = require_("Common/Server/Utils/Express");
      const WorkflowServiceModule: AnyModule = require_(
        "Common/Server/Services/WorkflowService",
      ).default;
      const SecurityCaseService: AnyModule = require_(
        "Common/Server/Services/SecurityCaseService",
      ).default;
      const URL: AnyModule = require_("Common/Types/API/URL").default;

      // The workflow the step names: enabled, started by its Webhook trigger.
      jest
        .spyOn(WorkflowServiceModule, "findOneBy")
        .mockImplementation((async () => {
          return {
            _id: WORKFLOW_ID,
            id: new ObjectID(WORKFLOW_ID),
            name: "Hand the case to the SOC",
            isEnabled: true,
            triggerId: "webhook",
            webhookSecretKey: WEBHOOK_SECRET_KEY,
          };
        }) as never);

      jest
        .spyOn(SecurityCaseService, "getCaseLinkInDashboard")
        .mockImplementation((async () => {
          return URL.fromString(
            `https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/security-events/cases/${CASE_ID.toString()}`,
          );
        }) as never);

      // The project's case priorities and statuses, which the payload names the case's by.
      const SecurityCaseValues: AnyModule = require_(
        "Common/Server/Utils/SecurityCase/SecurityCaseValues",
      ).default;

      jest
        .spyOn(SecurityCaseValues, "getPriorities")
        .mockResolvedValue(buildDefaultTestPriorities() as never);
      jest
        .spyOn(SecurityCaseValues, "getStatuses")
        .mockResolvedValue(buildDefaultTestStatuses() as never);

      const WebhookTrigger: AnyModule = require_(
        "Common/Server/Types/Workflow/Components/Webhook",
      ).default;
      const router: AnyModule = Express.default.getRouter();

      void new WebhookTrigger().setupComponent({
        router: router,
        executeWorkflow: async (run: {
          workflowId: ObjectID;
          returnValues: JSONObject;
        }): Promise<void> => {
          runs.push({
            workflowId: run.workflowId.toString(),
            returnValues: run.returnValues,
          });
        },
        scheduleWorkflow: async (): Promise<void> => {},
        removeWorkflow: async (): Promise<void> => {},
      });

      const app: AnyModule = Express.createExpressApp();
      app.use(Express.ExpressJson());
      app.use("/workflow", router);
      http.on("request", app);

      service = {
        http: http,
        origin: `http://127.0.0.1:${port}`,
        runs: runs,
        SecurityPlaybookActions: require_(
          "Common/Server/Utils/SecurityPlaybook/SecurityPlaybookActions",
        ).default,
        ClusterKeyAuthorization: require_(
          "Common/Server/Middleware/ClusterKeyAuthorization",
        ).default,
      };
    });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    restoreClusterKey();
  }

  return service!;
}

function runWorkflowStep(): PlaybookStepContext {
  const securityCase: AnyModule = {
    id: CASE_ID,
    _id: CASE_ID.toString(),
    caseNumberWithPrefix: "SC-12",
    title: "Impossible travel for alice",
    description: "Sign-ins from two countries ten minutes apart.",
    securityCasePriorityId: testPriorityId(SecurityCasePriorityLevel.High),
    securityCaseStatusId: testStatusId(SecurityCaseStage.Acknowledged),
    source: "Detection Rule",
    detectionCount: 2,
    entities: [{ type: "user", value: "alice@example.com" }],
  };

  return {
    projectId: PROJECT_ID,
    runId: RUN_ID,
    playbookName: "Escalate travel anomalies",
    stepNumber: 1,
    securityCase: securityCase,
    step: {
      id: ObjectID.generate().toString(),
      action: SecurityPlaybookActionType.RunWorkflow,
      config: { workflowId: WORKFLOW_ID },
      requiresApproval: false,
      continueOnFailure: false,
      onlyIfThreatIntelMatched: false,
    },
  };
}

// Every header name a run was handed, lower-cased.
function headerNamesOf(run: StartedRun): Array<string> {
  return Object.keys(
    (run.returnValues["request-headers"] as JSONObject) || {},
  ).map((name: string): string => {
    return name.toLowerCase();
  });
}

let service: WorkflowService;

beforeAll(async () => {
  service = await startWorkflowService();
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    service.http.close(() => {
      resolve();
    });
  });
  restoreClusterKey();
});

describe("a security playbook's Run Workflow step", () => {
  test("starts the workflow through its Webhook trigger, with the case as the body", async () => {
    const before: number = service.runs.length;

    const outcome: AnyModule =
      await service.SecurityPlaybookActions.execute(runWorkflowStep());

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(service.runs.length).toBe(before + 1);

    const run: StartedRun = service.runs[service.runs.length - 1]!;
    const body: JSONObject = run.returnValues["request-body"] as JSONObject;

    expect(run.workflowId).toBe(WORKFLOW_ID);
    expect((body["case"] as JSONObject)["number"]).toBe("SC-12");
    // The case's priority and status as the project names them, and by id.
    expect((body["case"] as JSONObject)["priority"]).toBe("High");
    expect((body["case"] as JSONObject)["status"]).toBe("Investigating");
    expect((body["case"] as JSONObject)["priorityId"]).toBe(
      testPriorityId(SecurityCasePriorityLevel.High).toString(),
    );
    expect((body["playbook"] as JSONObject)["name"]).toBe(
      "Escalate travel anomalies",
    );
    expect(body["projectId"]).toBe(PROJECT_ID.toString());
  });

  test("hands the run no cluster key: not in its headers, its query string or its body", async () => {
    const before: number = service.runs.length;

    await service.SecurityPlaybookActions.execute(runWorkflowStep());

    const run: StartedRun = service.runs[before]!;
    const everything: string = JSON.stringify(run.returnValues);

    expect(headerNamesOf(run)).not.toContain("clusterkey");
    expect(headerNamesOf(run)).not.toContain("x-clusterkey");
    expect(everything).not.toContain(OPERATOR_KEY);
    expect(everything).not.toContain(encodeURIComponent(OPERATOR_KEY));
    expect(everything).not.toContain(
      service.ClusterKeyAuthorization.getClusterKey(),
    );
  });
});

describe("a workflow's Webhook trigger", () => {
  async function callTrigger(
    headers: Record<string, string>,
  ): Promise<StartedRun> {
    const before: number = service.runs.length;

    const response: globalThis.Response = await fetch(
      `${service.origin}/workflow/trigger/${WEBHOOK_SECRET_KEY}?ticket=42`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ alert: "disk full" }),
      },
    );

    expect(response.status).toBe(200);
    expect(service.runs.length).toBe(before + 1);

    return service.runs[before]!;
  }

  test("never hands a run the cluster key headers, whoever sends them", async () => {
    const key: string = service.ClusterKeyAuthorization.getClusterKey();
    const run: StartedRun = await callTrigger({
      clusterkey: key,
      "x-clusterkey": key,
      "x-request-source": "ticketing",
    });

    expect(headerNamesOf(run)).not.toContain("clusterkey");
    expect(headerNamesOf(run)).not.toContain("x-clusterkey");
    expect(JSON.stringify(run.returnValues)).not.toContain(key);
  });

  test("still hands the run every other header, the query string and the body, as sent", async () => {
    const run: StartedRun = await callTrigger({
      "x-request-source": "ticketing",
      authorization: "Bearer the-callers-own-token",
    });
    const headers: IncomingHttpHeaders = run.returnValues[
      "request-headers"
    ] as IncomingHttpHeaders;

    expect(headers["x-request-source"]).toBe("ticketing");
    expect(headers["authorization"]).toBe("Bearer the-callers-own-token");
    expect(headers["content-type"]).toBe("application/json");
    expect(run.returnValues["request-params"]).toStrictEqual({ ticket: "42" });
    expect(run.returnValues["request-body"]).toStrictEqual({
      alert: "disk full",
    });
  });
});
