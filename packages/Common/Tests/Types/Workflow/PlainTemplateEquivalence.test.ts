/*
 * The templates that are not an integration's, before and after they were
 * made simple (TemplateEquivalence).
 *
 * Most only lost the Log their template kept on a step's Error output: a
 * step that fails with nothing connected there fails the run now, and its
 * Steps entry says why (UnhandledStepFailure), so the Log said what the run
 * says itself. For those, the graph is the old one, step for step and
 * setting for setting, but those Logs - which this holds for each of them.
 *
 * Six changed more, and run old against new here on the same events:
 *
 *   - the three paging templates lost the Logs on their No, Default and
 *     Success outputs, and ask who to page in the create wizard;
 *   - the two subscriber templates read the subscriber in a Check With
 *     JavaScript, which goes on by Yes or says why by No, where a script
 *     and an If / Else did;
 *   - "Tell Slack only when a monitor goes offline" lost the Log on its No.
 */

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import WorkflowPrincipal, {
  WorkflowPrincipalOptions,
} from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import {
  WorkflowTemplate,
  buildGraphForTemplate,
  getWorkflowTemplates,
} from "../../../Types/Workflow/Templates";
import { EquivalenceRun, OtherTool, runOldAndNew } from "./TemplateEquivalence";
import { getTemplateGraphBeforeSimplifying } from "./TemplateGraphsBeforeSimplifying";
import TemplateWorld from "./TemplateWorld";
import {
  SimulatedReply,
  SimulatedRequest,
  stubDnsLookups,
} from "./WorkflowTemplateSimulator";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.setTimeout(120000);

// The templates that changed beyond a Log on an Error output, run below.
const CHANGED: Array<string> = [
  "incident-critical-page-on-call",
  "incident-severity-page",
  "webhook-page-users",
  "subscriber-added-slack",
  "subscriber-added-forward",
  "monitor-offline-only-slack",
];

const INTEGRATION_TEMPLATE: RegExp = /^(jira|dynamics|zabbix|huntress)-/;

interface Shape {
  nodes: Record<string, { metadataId: string; arguments: JSONValue }>;
  edges: Array<string>;
}

// A graph as what it does: each step's component and settings, and each connection.
const shapeOf: (graph: JSONObject) => Shape = (graph: JSONObject): Shape => {
  const idOf: Record<string, string> = {};
  const nodes: Shape["nodes"] = {};

  for (const node of graph["nodes"] as Array<JSONObject>) {
    const data: JSONObject = node["data"] as JSONObject;

    idOf[node["id"] as string] = data["id"] as string;
    nodes[data["id"] as string] = {
      metadataId: data["metadataId"] as string,
      arguments: (data["arguments"] as JSONValue) || {},
    };
  }

  return {
    nodes: nodes,
    edges: (graph["edges"] as Array<JSONObject>)
      .map((edge: JSONObject): string => {
        return `${idOf[edge["source"] as string]} ${String(edge["sourceHandle"])} ${idOf[edge["target"] as string]}`;
      })
      .sort(),
  };
};

// The shape without the Logs that only sit on an Error output, with nothing after them.
const withoutErrorLogs: (shape: Shape) => Shape = (shape: Shape): Shape => {
  const dropped: Set<string> = new Set(
    Object.keys(shape.nodes).filter((id: string): boolean => {
      const incoming: Array<string> = shape.edges.filter((edge: string) => {
        return edge.split(" ")[2] === id;
      });
      const outgoing: Array<string> = shape.edges.filter((edge: string) => {
        return edge.split(" ")[0] === id;
      });

      return (
        shape.nodes[id]?.metadataId === "log" &&
        incoming.length === 1 &&
        incoming[0]?.split(" ")[1] === "error" &&
        outgoing.length === 0
      );
    }),
  );

  return {
    nodes: Object.fromEntries(
      Object.entries(shape.nodes).filter(([id]: [string, unknown]) => {
        return !dropped.has(id);
      }),
    ),
    edges: shape.edges.filter((edge: string): boolean => {
      const [from, , to] = edge.split(" ");

      return !dropped.has(from as string) && !dropped.has(to as string);
    }),
  };
};

let generated: number = 0;

const newShape: (templateId: string) => Shape = (templateId: string): Shape => {
  return shapeOf(
    buildGraphForTemplate(templateId, (): string => {
      generated++;
      return `plain-${generated}`;
    }) as JSONObject,
  );
};

const PLAIN: Array<string> = getWorkflowTemplates()
  .map((template: WorkflowTemplate): string => {
    return template.id;
  })
  .filter((templateId: string): boolean => {
    return !INTEGRATION_TEMPLATE.test(templateId);
  });

describe("the templates that only lost a Log on an Error output", () => {
  test("are every plain template but the six that changed more", () => {
    expect(PLAIN.length).toBeGreaterThan(20);

    for (const templateId of CHANGED) {
      expect(PLAIN).toContain(templateId);
    }
  });

  test.each(
    PLAIN.filter((templateId: string): boolean => {
      return !CHANGED.includes(templateId);
    }),
  )(
    "%s: is the old graph, step for step, but those Logs",
    (templateId: string) => {
      expect(newShape(templateId)).toEqual(
        withoutErrorLogs(
          shapeOf(getTemplateGraphBeforeSimplifying(templateId)),
        ),
      );
    },
  );

  test.each(CHANGED)(
    "%s: changed beyond those Logs, so it is run below",
    (templateId: string) => {
      expect(newShape(templateId)).not.toEqual(
        withoutErrorLogs(
          shapeOf(getTemplateGraphBeforeSimplifying(templateId)),
        ),
      );
    },
  );
});

/* ------------------------------ The six, run ------------------------------ */

const POLICY_ID: string = "aaaaaaaa-1111-4222-8333-444444444444";
const TEAM_ID: string = "bbbbbbbb-1111-4222-8333-444444444444";
const SCHEDULE_ID: string = "cccccccc-1111-4222-8333-444444444444";
const USER_ID: string = "dddddddd-1111-4222-8333-444444444444";

// Where messages go: every request, kept, answered as asked.
const receiver: (status?: number) => () => OtherTool = (
  status?: number,
): (() => OtherTool) => {
  return (): OtherTool => {
    const requests: Array<JSONObject> = [];

    return {
      http: (request: SimulatedRequest): SimulatedReply => {
        requests.push({
          method: request.method,
          url: request.url,
          body: (request.body as JSONValue) || null,
        });

        return status && status >= 400
          ? { status: status, body: "Internal Server Error" }
          : { status: 200, body: "ok" };
      },
      state: (): JSONValue => {
        return requests;
      },
    };
  };
};

beforeEach(() => {
  stubDnsLookups("93.184.216.34");

  jest.spyOn(WorkflowPrincipal, "getProps").mockImplementation((async (
    data: WorkflowPrincipalOptions,
  ) => {
    return WorkflowPrincipal.getPropsWithoutPlan(data);
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const expectSameOutcome: (run: EquivalenceRun) => void = (
  run: EquivalenceRun,
): void => {
  expect(run.new.world).toEqual(run.old.world);
  expect(run.new.tool).toEqual(run.old.tool);
  expect(run.new.pages).toEqual(run.old.pages);
  expect(run.new.failed).toBe(run.old.failed);
};

const newIncident: (
  severityName: string,
) => (world: TemplateWorld) => JSONObject = (
  severityName: string,
): ((world: TemplateWorld) => JSONObject) => {
  return (world: TemplateWorld): JSONObject => {
    const record: BaseModel = world.addIncident({ title: "Checkout down" });
    const json: JSONObject = BaseModel.toJSON(
      record,
      world.incidents.records.modelType,
    );

    // As the trigger hands it over: the severity by name.
    json["incidentSeverity"] = { name: severityName };

    return { model: json };
  };
};

describe("the paging templates, old and new", () => {
  test.each([
    ["Critical Incident", 1],
    ["Major Incident", 0],
  ])(
    "incident-critical-page-on-call: a %s pages whoever is on call, or nobody",
    async (severityName: string, pages: number) => {
      const run: EquivalenceRun = await runOldAndNew({
        templateId: "incident-critical-page-on-call",
        trigger: newIncident(severityName),
        picks: { "page-on-call-1": [SCHEDULE_ID] },
      });

      expectSameOutcome(run);
      expect(run.new.pages).toHaveLength(pages);
    },
  );

  test("incident-critical-page-on-call: a page that reaches nobody fails the run, in both", async () => {
    const run: EquivalenceRun = await runOldAndNew({
      templateId: "incident-critical-page-on-call",
      trigger: newIncident("Critical Incident"),
      picks: { "page-on-call-1": [SCHEDULE_ID] },
      pagingFails: true,
    });

    expectSameOutcome(run);
    expect(run.new.failed).toBe(true);
  });

  test.each([
    ["Critical Incident", { policies: [POLICY_ID] }],
    ["Major Incident", { teams: [TEAM_ID] }],
    ["Minor Incident", null],
  ] as Array<[string, JSONObject | null]>)(
    "incident-severity-page: a %s pages as the template says",
    async (severityName: string, who: JSONObject | null) => {
      const run: EquivalenceRun = await runOldAndNew({
        templateId: "incident-severity-page",
        trigger: newIncident(severityName),
        picks: {
          "page-on-call-policy-1": [POLICY_ID],
          "page-team-1": [TEAM_ID],
        },
      });

      expectSameOutcome(run);
      expect(run.new.pages).toEqual(who ? [expect.objectContaining(who)] : []);
    },
  );

  test("incident-severity-page: a page that reaches nobody fails the run, in both", async () => {
    const run: EquivalenceRun = await runOldAndNew({
      templateId: "incident-severity-page",
      trigger: newIncident("Major Incident"),
      picks: {
        "page-on-call-policy-1": [POLICY_ID],
        "page-team-1": [TEAM_ID],
      },
      pagingFails: true,
    });

    expectSameOutcome(run);
    expect(run.new.failed).toBe(true);
  });

  test.each([false, true])(
    "webhook-page-users: a request pages the people picked (paging fails: %p)",
    async (pagingFails: boolean) => {
      const run: EquivalenceRun = await runOldAndNew({
        templateId: "webhook-page-users",
        trigger: (): JSONObject => {
          return {
            "request-body": {
              title: "Disk full on db-1",
              message: "Free: 1 %",
            },
            "request-headers": {},
            "request-params": {},
          };
        },
        picks: { "page-users-1": [USER_ID] },
        pagingFails: pagingFails,
      });

      expectSameOutcome(run);
      expect(run.new.pages).toEqual([
        expect.objectContaining({
          users: [USER_ID],
          about: "a new alert: Disk full on db-1",
        }),
      ]);
    },
  );
});

describe("the subscriber templates, old and new", () => {
  const subscriber: (confirmed: boolean, email: string) => () => JSONObject = (
    confirmed: boolean,
    email: string,
  ): (() => JSONObject) => {
    return (): JSONObject => {
      return {
        model: {
          _id: "eeeeeeee-1111-4222-8333-444444444444",
          subscriberEmail: email ? { _type: "Email", value: email } : null,
          isSubscriptionConfirmed: confirmed,
          statusPage: { name: "Acme Status" },
        },
      };
    };
  };

  test.each([
    [
      "subscriber-added-slack",
      { slackWebhookUrl: "https://hooks.slack.com/services/T0/B0/x" },
    ],
    [
      "subscriber-added-forward",
      { crmWebhookUrl: "https://crm.example.com/hooks/subscribers" },
    ],
  ] as Array<[string, { [name: string]: string }]>)(
    "%s: a confirmed email subscriber is sent on, and nobody else is",
    async (templateId: string, variables: { [name: string]: string }) => {
      for (const [confirmed, email, sent] of [
        [true, "ada@example.com", 1],
        [false, "ada@example.com", 0],
        [true, "", 0],
      ] as Array<[boolean, string, number]>) {
        const run: EquivalenceRun = await runOldAndNew({
          templateId,
          variables,
          trigger: subscriber(confirmed, email),
          tool: receiver(),
        });

        expectSameOutcome(run);
        expect(run.new.tool).toHaveLength(sent);
      }
    },
  );
});

describe("Tell Slack only when a monitor goes offline, old and new", () => {
  const statusChange: (isOffline: boolean) => () => JSONObject = (
    isOffline: boolean,
  ): (() => JSONObject) => {
    return (): JSONObject => {
      return {
        model: {
          _id: "ffffffff-1111-4222-8333-444444444444",
          monitor: { name: "Checkout API" },
          monitorStatus: {
            name: isOffline ? "Offline" : "Operational",
            isOfflineState: isOffline,
          },
        },
      };
    };
  };

  test.each([
    [true, 1],
    [false, 0],
  ])(
    "a status that is offline (%p) posts %p message",
    async (isOffline: boolean, sent: number) => {
      const run: EquivalenceRun = await runOldAndNew({
        templateId: "monitor-offline-only-slack",
        variables: {
          slackWebhookUrl: "https://hooks.slack.com/services/T0/B0/x",
        },
        trigger: statusChange(isOffline),
        tool: receiver(),
      });

      expectSameOutcome(run);
      expect(run.new.tool).toHaveLength(sent);
    },
  );

  // The old graph ended this with a ❌ Log on Slack's Error output.
  test("Slack refusing the message fails the run, in both", async () => {
    const run: EquivalenceRun = await runOldAndNew({
      templateId: "monitor-offline-only-slack",
      variables: {
        slackWebhookUrl: "https://hooks.slack.com/services/T0/B0/x",
      },
      trigger: statusChange(true),
      tool: receiver(500),
    });

    expectSameOutcome(run);
    expect(run.new.failed).toBe(true);
    expect(run.newTrace.failedSteps).toEqual(["slack-1"]);
  });
});
