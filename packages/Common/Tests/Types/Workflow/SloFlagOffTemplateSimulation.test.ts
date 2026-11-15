/*
 * The SLOs templates that turn a feature flag off when an SLO burns its
 * error budget too fast (#8447), run end to end by the template simulator
 * (WorkflowTemplateSimulator). Each runs the graph the create wizard builds,
 * with its values substituted the way RunWorkflow does, through the real If
 * / Else and API steps. The flag service's side is what LaunchDarkly's and
 * Unleash's APIs answer.
 *
 * The rule that fired is what the burn rate rule's On Update passes on.
 * That it runs for a fire, and not for a resolve or an edit, is
 * BurnRateRuleFireStartsWorkflow.test.ts's to hold, and that the worker
 * stamps a fire so is EvaluateSlos.test.ts's.
 */

import API from "../../../Utils/API";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ComponentID from "../../../Types/Workflow/ComponentID";
import {
  SLO_BURN_RATE_RULE_ID_PATTERN,
  SLO_BURN_RATE_RULE_TRIGGER_ID,
  WorkflowTemplate,
  WorkflowTemplateCategory,
  WorkflowTemplateVariable,
  getTemplateGraphSpec,
  getWorkflowTemplate,
  getWorkflowTemplates,
} from "../../../Types/Workflow/Templates";
import {
  SimulatedReply,
  SimulatedRequest,
  SimulationTrace,
  runTemplate,
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

const LAUNCHDARKLY: string = "slo-burn-launchdarkly-flag-off";
const UNLEASH: string = "slo-burn-unleash-flag-off";

const RULE_ID: string = "6ba7b810-9dad-41d1-80b4-00c04fd47001";
const OTHER_RULE_ID: string = "6ba7b810-9dad-41d1-80b4-00c04fd47002";

const FIRED_AT: string = "2026-11-15T12:00:00.000Z";

// The rule as its On Update passes it on, with the fields the templates select.
const ruleThatFired: (overrides?: {
  id?: string;
  name?: string;
  sloName?: string;
}) => JSONObject = (overrides?: {
  id?: string;
  name?: string;
  sloName?: string;
}): JSONObject => {
  return {
    _id: overrides?.id || RULE_ID,
    name: overrides?.name || "Checkout fast burn",
    serviceLevelObjective: {
      _id: "6ba7b810-9dad-41d1-80b4-00c04fd47201",
      name: overrides?.sloName || "Checkout requests",
    },
    lastAlertCreatedAt: FIRED_AT,
  };
};

const LAUNCHDARKLY_VARIABLES: Record<string, string> = {
  burnRateRuleId: RULE_ID,
  launchDarklyAccessToken: "api-5f3c-test-token",
  launchDarklyProjectKey: "default",
  launchDarklyFlagKey: "new-checkout",
  launchDarklyEnvironmentKey: "production",
};

const UNLEASH_VARIABLES: Record<string, string> = {
  burnRateRuleId: RULE_ID,
  unleashUrl: "https://unleash.example.com",
  unleashApiToken: "user:5f3c0000test0000token",
  unleashProjectId: "default",
  unleashFlagName: "new-checkout",
  unleashEnvironment: "production",
};

// What LaunchDarkly answers a semantic patch it applied: the flag, now off.
const LAUNCHDARKLY_OK: SimulatedReply = {
  status: 200,
  body: { key: "new-checkout", environments: { production: { on: false } } },
};

// Unleash answers a flag turned off in an environment with 200 and no body.
const UNLEASH_OK: SimulatedReply = { status: 200, body: "" };

const answering: (
  reply: SimulatedReply,
) => (request: SimulatedRequest) => SimulatedReply = (
  reply: SimulatedReply,
): ((request: SimulatedRequest) => SimulatedReply) => {
  return (): SimulatedReply => {
    return reply;
  };
};

const run: (data: {
  templateId: string;
  rule: JSONObject;
  variables: Record<string, string>;
  reply: SimulatedReply;
}) => Promise<SimulationTrace> = async (data: {
  templateId: string;
  rule: JSONObject;
  variables: Record<string, string>;
  reply: SimulatedReply;
}): Promise<SimulationTrace> => {
  return await runTemplate({
    templateId: data.templateId,
    trigger: { model: data.rule },
    variables: data.variables,
    http: answering(data.reply),
  });
};

beforeEach(() => {
  // The API steps resolve the flag service's host before they call it.
  stubDnsLookups("93.184.216.34");
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the SLOs category's templates", () => {
  const templates: Array<WorkflowTemplate> = getWorkflowTemplates().filter(
    (template: WorkflowTemplate): boolean => {
      return template.category === WorkflowTemplateCategory.Slos;
    },
  );

  test("are the LaunchDarkly and Unleash ones", () => {
    expect(
      templates.map((template: WorkflowTemplate): string => {
        return template.id;
      }),
    ).toEqual([LAUNCHDARKLY, UNLEASH]);
  });

  test.each([LAUNCHDARKLY, UNLEASH])(
    "%s is the trigger, the rule check and the call that turns the flag off, in that order",
    (templateId: string) => {
      const spec: {
        nodes: Array<{ componentId: string; metadataId: string }>;
        edges: Array<{
          fromComponentId: string;
          toComponentId: string;
          fromPort: string;
        }>;
      } = getTemplateGraphSpec(templateId) as never;

      expect(
        spec.nodes.map((node: { metadataId: string }): string => {
          return node.metadataId;
        }),
      ).toEqual([
        "service-level-objective-burn-rate-rule-on-update",
        ComponentID.IfElse,
        templateId === LAUNCHDARKLY
          ? ComponentID.ApiPatch
          : ComponentID.ApiPost,
      ]);
      expect(
        spec.edges.map(
          (edge: {
            fromComponentId: string;
            toComponentId: string;
            fromPort: string;
          }): string => {
            return `${edge.fromComponentId} ${edge.fromPort} ${edge.toComponentId}`;
          },
        ),
      ).toEqual([
        `${SLO_BURN_RATE_RULE_TRIGGER_ID} success if-else-1`,
        `if-else-1 yes ${spec.nodes[2]!.componentId}`,
      ]);
    },
  );

  test.each([LAUNCHDARKLY, UNLEASH])(
    "%s asks for the rule's ID first, then the flag service's settings, the token kept secret",
    (templateId: string) => {
      const variables: Array<WorkflowTemplateVariable> =
        getWorkflowTemplate(templateId)!.variables;

      expect(variables[0]!.name).toBe("burnRateRuleId");
      expect(variables[0]!.title).toBe("Burn Rate Rule ID");
      expect(variables[0]!.description).toContain("Show ID");

      expect(
        variables
          .filter((variable: WorkflowTemplateVariable): boolean => {
            return variable.isSecret;
          })
          .map((variable: WorkflowTemplateVariable): string => {
            return variable.name;
          }),
      ).toEqual([
        templateId === LAUNCHDARKLY
          ? "launchDarklyAccessToken"
          : "unleashApiToken",
      ]);
    },
  );
});

describe("Turn a LaunchDarkly flag off when an SLO burns too fast", () => {
  test("turns the flag off in the environment, with LaunchDarkly's semantic patch, when its rule fires", async () => {
    const trace: SimulationTrace = await run({
      templateId: LAUNCHDARKLY,
      rule: ruleThatFired(),
      variables: LAUNCHDARKLY_VARIABLES,
      reply: LAUNCHDARKLY_OK,
    });

    expect(trace.executed).toEqual([
      SLO_BURN_RATE_RULE_TRIGGER_ID,
      "if-else-1",
      "api-patch-1",
    ]);
    expect(trace.ports["if-else-1"]).toBe("yes");
    expect(trace.ports["api-patch-1"]).toBe("success");
    expect(trace.failedSteps).toEqual([]);
    expect(trace.requests).toEqual([
      {
        method: "PATCH",
        url: "https://app.launchdarkly.com/api/v2/flags/default/new-checkout",
        headers: {
          Authorization: "api-5f3c-test-token",
          "Content-Type":
            "application/json; domain-model=launchdarkly.semanticpatch",
        },
        body: {
          environmentKey: "production",
          comment:
            "Turned off by OneUptime: the burn rate rule Checkout fast burn of the SLO Checkout requests fired.",
          instructions: [{ kind: "turnFlagOff" }],
        },
      },
    ]);
  });

  test("leaves the flag alone when another burn rate rule fires", async () => {
    const trace: SimulationTrace = await run({
      templateId: LAUNCHDARKLY,
      rule: ruleThatFired({ id: OTHER_RULE_ID, name: "Slow burn" }),
      variables: LAUNCHDARKLY_VARIABLES,
      reply: LAUNCHDARKLY_OK,
    });

    expect(trace.executed).toEqual([
      SLO_BURN_RATE_RULE_TRIGGER_ID,
      "if-else-1",
    ]);
    expect(trace.ports["if-else-1"]).toBe("no");
    expect(trace.requests).toEqual([]);
    expect(trace.failedSteps).toEqual([]);
  });

  test("still sends valid JSON when the rule's or the SLO's name has quotes, a backslash or a line break", async () => {
    const name: string = 'Checkout "fast" burn \\ 1h\nand 5m';
    const sloName: string = "Checkout's {{requests}}";

    const trace: SimulationTrace = await run({
      templateId: LAUNCHDARKLY,
      rule: ruleThatFired({ name: name, sloName: sloName }),
      variables: LAUNCHDARKLY_VARIABLES,
      reply: LAUNCHDARKLY_OK,
    });

    expect(trace.requests).toHaveLength(1);
    expect((trace.requests[0]!.body as JSONObject)["comment"]).toBe(
      `Turned off by OneUptime: the burn rate rule ${name} of the SLO ${sloName} fired.`,
    );
    expect((trace.requests[0]!.body as JSONObject)["instructions"]).toEqual([
      { kind: "turnFlagOff" },
    ]);
  });

  test.each([
    [401, "an access token LaunchDarkly does not know"],
    [403, "a token whose role cannot update the flag"],
    [404, "a project or flag key that does not exist"],
  ])(
    "fails the run on a %s, for %s, so its Steps say why",
    async (status: number) => {
      const trace: SimulationTrace = await run({
        templateId: LAUNCHDARKLY,
        rule: ruleThatFired(),
        variables: LAUNCHDARKLY_VARIABLES,
        reply: {
          status: status,
          body: { code: "forbidden", message: "Access denied" },
        },
      });

      expect(trace.ports["api-patch-1"]).toBe("error");
      expect(trace.failedSteps).toEqual(["api-patch-1"]);
    },
  );
});

describe("Turn an Unleash flag off when an SLO burns too fast", () => {
  test("turns the flag off in the environment, with Unleash's Admin API, when its rule fires", async () => {
    const trace: SimulationTrace = await run({
      templateId: UNLEASH,
      rule: ruleThatFired(),
      variables: UNLEASH_VARIABLES,
      reply: UNLEASH_OK,
    });

    expect(trace.executed).toEqual([
      SLO_BURN_RATE_RULE_TRIGGER_ID,
      "if-else-1",
      "api-post-1",
    ]);
    expect(trace.ports["if-else-1"]).toBe("yes");
    expect(trace.ports["api-post-1"]).toBe("success");
    expect(trace.failedSteps).toEqual([]);
    expect(trace.requests).toEqual([
      {
        method: "POST",
        url: "https://unleash.example.com/api/admin/projects/default/features/new-checkout/environments/production/off",
        // The token as it is: Unleash's Admin API takes no Bearer.
        headers: { Authorization: "user:5f3c0000test0000token" },
      },
    ]);
  });

  test("keeps the path of an Unleash address that has one, as a hosted instance's does", async () => {
    const trace: SimulationTrace = await run({
      templateId: UNLEASH,
      rule: ruleThatFired(),
      variables: {
        ...UNLEASH_VARIABLES,
        unleashUrl: "https://us.app.unleash-hosted.com/ushosted",
      },
      reply: UNLEASH_OK,
    });

    expect(
      trace.requests.map((request: SimulatedRequest) => {
        return request.url;
      }),
    ).toEqual([
      "https://us.app.unleash-hosted.com/ushosted/api/admin/projects/default/features/new-checkout/environments/production/off",
    ]);
  });

  test("leaves the flag alone when another burn rate rule fires", async () => {
    const trace: SimulationTrace = await run({
      templateId: UNLEASH,
      rule: ruleThatFired({ id: OTHER_RULE_ID }),
      variables: UNLEASH_VARIABLES,
      reply: UNLEASH_OK,
    });

    expect(trace.ports["if-else-1"]).toBe("no");
    expect(trace.requests).toEqual([]);
  });

  test("fails the run when Unleash refuses the token, so its Steps say why", async () => {
    const trace: SimulationTrace = await run({
      templateId: UNLEASH,
      rule: ruleThatFired(),
      variables: UNLEASH_VARIABLES,
      reply: {
        status: 401,
        body: { name: "AuthenticationRequired", message: "Unauthorized" },
      },
    });

    expect(trace.ports["api-post-1"]).toBe("error");
    expect(trace.failedSteps).toEqual(["api-post-1"]);
  });
});

describe("what the wizard accepts", () => {
  test("the rule's ID as Show ID gives it, the form every ID OneUptime makes has", () => {
    expect(SLO_BURN_RATE_RULE_ID_PATTERN.test(RULE_ID)).toBe(true);

    for (let i: number = 0; i < 20; i++) {
      const id: string = ObjectID.generate().toString();

      expect({
        id: id,
        accepted: SLO_BURN_RATE_RULE_ID_PATTERN.test(id),
      }).toEqual({ id: id, accepted: true });
    }
  });

  test.each([
    [
      "in capitals, which the If / Else would never match",
      RULE_ID.toUpperCase(),
    ],
    ["cut short", RULE_ID.slice(0, 30)],
    ["with the SLO's address around it", `/slos/${RULE_ID}`],
    ["empty", ""],
  ])("not an ID %s", (_label: string, value: string) => {
    expect(SLO_BURN_RATE_RULE_ID_PATTERN.test(value)).toBe(false);
  });

  test.each([
    ["https://unleash.example.com", true],
    ["https://us.app.unleash-hosted.com/ushosted", true],
    ["http://localhost:4242", true],
    ["https://unleash.example.com/", false],
    ["https://us.app.unleash-hosted.com/ushosted/", false],
    ["unleash.example.com", false],
    ["https://unleash.example.com?project=default", false],
  ] as Array<[string, boolean]>)(
    "the Unleash URL %s: %s",
    (value: string, accepted: boolean) => {
      const format: WorkflowTemplateVariable["format"] = getWorkflowTemplate(
        UNLEASH,
      )!.variables.find((variable: WorkflowTemplateVariable): boolean => {
        return variable.name === "unleashUrl";
      })!.format;

      expect(format!.pattern.test(value)).toBe(accepted);
    },
  );
});

/*
 * The simulator stands in at API.fetch, so it sees the headers a template
 * sets. The real request merges them over the API utility's own, and
 * LaunchDarkly reads a semantic patch only with its Content-Type: the
 * template's has to be the one sent.
 */
describe("the headers a request is sent with", () => {
  test("a template's Content-Type replaces the API utility's own", () => {
    const headers: Record<string, string> = (
      API as unknown as {
        getHeaders: (headers: Record<string, string>) => Record<string, string>;
      }
    ).getHeaders({
      Authorization: "api-5f3c-test-token",
      "Content-Type":
        "application/json; domain-model=launchdarkly.semanticpatch",
    });

    expect(headers["Content-Type"]).toBe(
      "application/json; domain-model=launchdarkly.semanticpatch",
    );
    expect(headers["Authorization"]).toBe("api-5f3c-test-token");
  });
});
