/*
 * The paging templates, and each of them run end to end.
 *
 * The maintainer's ask: "I want to conditionally page someone / a group of
 * people / an on-call person. Can I do this in workflow?" These three
 * templates are that answer, ready to start from:
 *
 *   - "Page whoever is on call when a critical incident is created": an
 *     If / Else in front of a Page step.
 *   - "Page different people for each incident severity": a Switch / Case
 *     with a different Page step on each path.
 *   - "Page someone when another tool calls a webhook": a page about
 *     something new, with no incident behind it.
 *
 * Each asks one thing of whoever creates the workflow: who to page - a
 * person, a team, a schedule or a policy of their own project, picked in
 * the create wizard with the people picker the Builder draws for the step
 * (whoToPage). The workflow is created with who was picked, so it opens in
 * the Builder with no error on the step. The first half of this file holds
 * the templates to that. The second runs them through the template
 * simulator: the graph the create wizard builds, with who to page filled
 * in the way the builder stores it, the real If / Else, Switch / Case and
 * Page steps, and the paging itself (OnCallPageService.page) stood in for.
 *
 * Each is three or four steps: a page that went out says so in its own
 * Steps entry, and one that did not fails the run (UnhandledStepFailure),
 * where a Log after each output used to say the same.
 */

import OnCallPageService, {
  OnCallPageAbout,
  OnCallPageRecordType,
  OnCallPageResult,
  OnCallPageTargets,
} from "../../../Server/Services/OnCallPageService";
import WorkflowPrincipal, {
  WorkflowPrincipalOptions,
} from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import ComponentMetadata, {
  Argument,
  ComponentType,
  NodeDataProp,
  NodeType,
  isRecordListInputType,
} from "../../../Types/Workflow/Component";
import ComponentID from "../../../Types/Workflow/ComponentID";
import {
  PageTargetKind,
  getPageStepTarget,
  isPageStep,
} from "../../../Types/Workflow/Components/OnCall";
import { getNewPageStepArguments } from "../../../Types/Workflow/Components/OnCallPageNewStep";
import {
  HUNTRESS_INCIDENT_TEMPLATE_ID,
  WhoToPagePicks,
  WorkflowTemplate,
  WorkflowTemplateCategory,
  WorkflowTemplateWhoToPage,
  applyWhoToPage,
  getRecommendedWorkflowTemplates,
  getTemplateGraphSpec,
  getWorkflowTemplate,
  getWorkflowTemplateCategoryInfo,
  getWorkflowTemplates,
} from "../../../Types/Workflow/Templates";
import {
  LintGraphNode,
  WorkflowLintIssue,
  WorkflowLintRule,
  lintWorkflowGraph,
} from "../../../UI/Components/Workflow/GraphLint";
import { summarizePageStep } from "../../../UI/Components/Workflow/OnCall/PageStepSummary";
import { loadComponentsAndCategories } from "../../../UI/Components/Workflow/Utils";
import {
  SIMULATED_PROJECT_ID,
  SIMULATED_WORKFLOW_ID,
  SIMULATED_WORKFLOW_NAME,
  SimulationTrace,
  runTemplate,
} from "./WorkflowTemplateSimulator";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const CRITICAL_PAGE: string = "incident-critical-page-on-call";
const SEVERITY_PAGE: string = "incident-severity-page";
const WEBHOOK_PAGE: string = "webhook-page-users";

const PAGE_TEMPLATE_IDS: Array<string> = [
  CRITICAL_PAGE,
  SEVERITY_PAGE,
  WEBHOOK_PAGE,
];

const INCIDENT_ID: string = "6a1b2c3d-0000-4000-8000-000000000001";
const ALERT_ID: string = "a1e70000-0000-4000-8000-000000000001";
const SCHEDULE_ID: string = "5c4e0000-0000-4000-8000-000000000001";
const POLICY_ID: string = "dddddddd-0000-4000-8000-000000000001";
const TEAM_ID: string = "7eae0000-0000-4000-8000-000000000001";
const JANE_ID: string = "10000000-0000-4000-8000-000000000001";

type TemplateGraphSpec = NonNullable<ReturnType<typeof getTemplateGraphSpec>>;
type TemplateNodeSpec = TemplateGraphSpec["nodes"][number];
type TemplateEdgeSpec = TemplateGraphSpec["edges"][number];

// The catalog the builder draws from: a template's trigger is a database step.
const CATALOG: Array<ComponentMetadata> =
  loadComponentsAndCategories().components;

function metadataOf(id: string): ComponentMetadata {
  const found: ComponentMetadata | undefined = CATALOG.find(
    (component: ComponentMetadata): boolean => {
      return component.id === id;
    },
  );

  if (!found) {
    throw new Error(`No step ${id}`);
  }

  return found;
}

function specOf(templateId: string): TemplateGraphSpec {
  return getTemplateGraphSpec(templateId) as TemplateGraphSpec;
}

// Somebody of the right kind for each Page step, as the wizard is told.
const PICKED_FOR: Record<PageTargetKind, string> = {
  [PageTargetKind.User]: "10000000-0000-4000-8000-000000000001",
  [PageTargetKind.Team]: "7eae0000-0000-4000-8000-000000000001",
  [PageTargetKind.OnCallSchedule]: "5c4e0000-0000-4000-8000-000000000001",
  [PageTargetKind.OnCallPolicy]: "dddddddd-0000-4000-8000-000000000001",
};

// The graph as the create wizard builds it, with somebody picked for each Page step.
function asTheWizardBuildsIt(templateId: string): TemplateGraphSpec {
  const picks: WhoToPagePicks = {};

  for (const node of pageStepsOf(templateId)) {
    picks[node.componentId] = [
      PICKED_FOR[getPageStepTarget(node.metadataId)!.kind],
    ];
  }

  return applyWhoToPage({
    spec: specOf(templateId),
    whoToPage: getWorkflowTemplate(templateId)!.whoToPage || [],
    picks: picks,
  }) as TemplateGraphSpec;
}

function nodeOf(templateId: string, componentId: string): TemplateNodeSpec {
  const found: TemplateNodeSpec | undefined = specOf(templateId).nodes.find(
    (node: TemplateNodeSpec): boolean => {
      return node.componentId === componentId;
    },
  );

  if (!found) {
    throw new Error(`${templateId} has no step ${componentId}`);
  }

  return found;
}

function pageStepsOf(templateId: string): Array<TemplateNodeSpec> {
  return specOf(templateId).nodes.filter((node: TemplateNodeSpec): boolean => {
    return isPageStep(node.metadataId);
  });
}

// Where an output of a step leads, by the component ids it is connected to.
function leadsTo(
  templateId: string,
  componentId: string,
  port: string,
): Array<string> {
  return specOf(templateId)
    .edges.filter((edge: TemplateEdgeSpec): boolean => {
      return edge.fromComponentId === componentId && edge.fromPort === port;
    })
    .map((edge: TemplateEdgeSpec): string => {
      return edge.toComponentId;
    });
}

// The template as the builder loads it, for its checks.
function asBuilderLoadsIt(
  templateId: string,
  spec: TemplateGraphSpec = specOf(templateId),
): Array<LintGraphNode> {
  return spec.nodes.map((node: TemplateNodeSpec): LintGraphNode => {
    const metadata: ComponentMetadata = metadataOf(node.metadataId);

    return {
      id: `canvas-${node.componentId}`,
      data: {
        id: node.componentId,
        internalId: `runner-${node.componentId}`,
        nodeType: NodeType.Node,
        componentType: metadata.componentType,
        metadataId: metadata.id,
        metadata: metadata,
        error: "",
        arguments: (node.args || {}) as JSONObject,
        returnValues: {},
      },
    };
  });
}

function lintIssuesOf(
  templateId: string,
  spec: TemplateGraphSpec = specOf(templateId),
): Array<WorkflowLintIssue> {
  return lintWorkflowGraph({
    nodes: asBuilderLoadsIt(templateId, spec),
    edges: spec.edges.map((edge: TemplateEdgeSpec) => {
      return {
        source: `canvas-${edge.fromComponentId}`,
        target: `canvas-${edge.toComponentId}`,
        sourceHandle: edge.fromPort,
      };
    }),
  }).issues;
}

describe("the paging templates", () => {
  test("are three, filed under On-Call with the template that follows an escalation", () => {
    for (const templateId of PAGE_TEMPLATE_IDS) {
      expect(getWorkflowTemplate(templateId)?.category).toBe(
        WorkflowTemplateCategory.OnCall,
      );
    }

    expect(
      getWorkflowTemplates()
        .filter((template: WorkflowTemplate): boolean => {
          return template.category === WorkflowTemplateCategory.OnCall;
        })
        .map((template: WorkflowTemplate): string => {
          return template.id;
        }),
    ).toEqual(["oncall-executed-slack", ...PAGE_TEMPLATE_IDS]);
  });

  /*
   * Besides them, only the Huntress template and the two Zabbix sends its
   * problems to page: for the incident or alert each opens
   * (HuntressTemplateSimulation and ZabbixTemplateSimulation run them).
   */
  test("are every template that pages: no other has a Page step but Huntress's and Zabbix's", () => {
    expect(
      getWorkflowTemplates()
        .filter((template: WorkflowTemplate): boolean => {
          return pageStepsOf(template.id).length > 0;
        })
        .map((template: WorkflowTemplate): string => {
          return template.id;
        }),
    ).toEqual([
      ...PAGE_TEMPLATE_IDS,
      HUNTRESS_INCIDENT_TEMPLATE_ID,
      "zabbix-declare-incident-from-problem",
      "zabbix-create-alert-from-problem",
    ]);
  });

  test("are named for what they do, starting with Page, so a search for it finds them", () => {
    expect(
      PAGE_TEMPLATE_IDS.map((templateId: string): string => {
        return getWorkflowTemplate(templateId)!.name;
      }),
    ).toEqual([
      "Page whoever is on call when a critical incident is created",
      "Page different people for each incident severity",
      "Page someone when another tool calls a webhook",
    ]);
  });

  test("between them use all four Page steps", () => {
    expect(
      PAGE_TEMPLATE_IDS.flatMap((templateId: string): Array<string> => {
        return pageStepsOf(templateId).map((node: TemplateNodeSpec): string => {
          return node.metadataId;
        });
      }).sort(),
    ).toEqual(
      [
        ComponentID.PageOnCall,
        ComponentID.PageOnCallPolicy,
        ComponentID.PageTeam,
        ComponentID.PageUsers,
      ]
        .map(String)
        .sort(),
    );
  });

  test("the category says it is where paging is, in the picker", () => {
    expect(
      getWorkflowTemplateCategoryInfo(WorkflowTemplateCategory.OnCall)
        .description,
    ).toBe(
      "Page the right people, and follow an on-call escalation from start to finish.",
    );
  });

  test("none is among the recommended ones: each asks who to page before it is created", () => {
    const recommended: Array<string> = getRecommendedWorkflowTemplates().map(
      (template: WorkflowTemplate): string => {
        return template.id;
      },
    );

    for (const templateId of PAGE_TEMPLATE_IDS) {
      expect(recommended).not.toContain(templateId);
    }
  });
});

describe.each(PAGE_TEMPLATE_IDS)("%s: who it pages", (templateId: string) => {
  test("the wizard asks for no settings: who to page is not something to type", () => {
    expect(getWorkflowTemplate(templateId)!.variables).toEqual([]);
  });

  test("as the template is written, who each Page step pages is left empty, and nothing else it needs is", () => {
    for (const node of pageStepsOf(templateId)) {
      const metadata: ComponentMetadata = metadataOf(node.metadataId);
      const who: string = getPageStepTarget(node.metadataId)!.argumentId;

      expect(Object.keys(node.args || {})).not.toContain(who);

      // Every setting it holds is one of the step's.
      for (const argumentId of Object.keys(node.args || {})) {
        expect(
          metadata.arguments.map((argument: Argument): string => {
            return argument.id;
          }),
        ).toContain(argumentId);
      }
    }
  });

  test("the wizard asks who each Page step pages, in the order they are on the canvas, and needs an answer", () => {
    expect(
      (getWorkflowTemplate(templateId)!.whoToPage || []).map(
        (ask: WorkflowTemplateWhoToPage): [string, boolean] => {
          return [ask.componentId, ask.required];
        },
      ),
    ).toEqual(
      pageStepsOf(templateId).map(
        (node: TemplateNodeSpec): [string, boolean] => {
          return [node.componentId, true];
        },
      ),
    );
  });

  test("each question says what kind of record its step pages", () => {
    for (const ask of getWorkflowTemplate(templateId)!.whoToPage || []) {
      const kind: PageTargetKind = getPageStepTarget(
        nodeOf(templateId, ask.componentId).metadataId,
      )!.kind;

      expect(ask.description.toLowerCase()).toContain(WHAT_A_STEP_PICKS[kind]);

      for (const other of Object.values(PageTargetKind)) {
        if (other !== kind) {
          expect(ask.description.toLowerCase()).not.toContain(
            WHAT_A_STEP_PICKS[other],
          );
        }
      }
    }
  });

  /*
   * The wizard fills that in. Created with somebody picked, the workflow
   * opens in the Builder with nothing for its checks to say - where it
   * used to open with an error on each Page step.
   */
  test("as the wizard builds it, the builder's checks find nothing", () => {
    expect(
      lintIssuesOf(templateId, asTheWizardBuildsIt(templateId)).map(
        (issue: WorkflowLintIssue): string => {
          return issue.message;
        },
      ),
    ).toEqual([]);
  });

  test("as the template is written, the builder's checks ask for who to page, once for each Page step, and for nothing else", () => {
    const issues: Array<WorkflowLintIssue> = lintIssuesOf(templateId);

    expect(
      issues.map(
        (
          issue: WorkflowLintIssue,
        ): [string | null, WorkflowLintRule, string | null] => {
          return [issue.componentId, issue.rule, issue.argumentId];
        },
      ),
    ).toEqual(
      pageStepsOf(templateId).map(
        (node: TemplateNodeSpec): [string, WorkflowLintRule, string] => {
          return [
            node.componentId,
            WorkflowLintRule.MissingRequiredArgument,
            getPageStepTarget(node.metadataId)!.argumentId,
          ];
        },
      ),
    );

    // The one setting asked for is a list picked from the project, each time.
    for (const issue of issues) {
      const metadata: ComponentMetadata = metadataOf(
        nodeOf(templateId, issue.componentId!).metadataId,
      );

      expect(
        isRecordListInputType(
          metadata.arguments.find((argument: Argument): boolean => {
            return argument.id === issue.argumentId;
          })!.type,
        ),
      ).toBe(true);
    }
  });

  test("on the canvas each Page step says who it pages once the wizard fills it in", () => {
    const built: TemplateGraphSpec = asTheWizardBuildsIt(templateId);

    for (const node of pageStepsOf(templateId)) {
      // As the template is written: Click to set up.
      expect(
        summarizePageStep(node.metadataId, (node.args || {}) as JSONObject),
      ).toBeNull();

      const filled: TemplateNodeSpec = built.nodes.find(
        (candidate: TemplateNodeSpec): boolean => {
          return candidate.componentId === node.componentId;
        },
      )!;

      expect(
        summarizePageStep(filled.metadataId, filled.args as JSONObject),
      ).not.toBeNull();
    }
  });

  test("its card says somebody is picked, not typed", () => {
    expect(getWorkflowTemplate(templateId)!.description).toMatch(YOU_PICK);
    // Nothing is left for the Builder: the wizard asks.
    expect(getWorkflowTemplate(templateId)!.setUpInBuilder).toBeUndefined();
  });

  /*
   * A page nobody got fails the run, and the Page step's Steps entry says
   * why (UnhandledStepFailure): nothing is connected to its Error output.
   */
  test("a page nobody got is never silent: it fails the run", () => {
    for (const node of pageStepsOf(templateId)) {
      expect(leadsTo(templateId, node.componentId, "error")).toEqual([]);
      expect(leadsTo(templateId, node.componentId, "success")).toEqual([]);
    }
  });
});

const YOU_PICK: RegExp = /you pick/;

// What each kind of Page step pages, as a who-to-page question names it.
const WHAT_A_STEP_PICKS: Record<PageTargetKind, string> = {
  [PageTargetKind.User]: "people",
  [PageTargetKind.Team]: "teams",
  [PageTargetKind.OnCallSchedule]: "on-call schedules",
  [PageTargetKind.OnCallPolicy]: "on-call policies",
};

describe("what each page is about", () => {
  test.each([
    [CRITICAL_PAGE, "page-on-call-1"],
    [SEVERITY_PAGE, "page-on-call-policy-1"],
    [SEVERITY_PAGE, "page-team-1"],
  ])(
    "%s: %s pages about the incident that started the workflow, as the builder would have set it",
    (templateId: string, componentId: string) => {
      const trigger: TemplateNodeSpec = specOf(templateId).nodes.find(
        (node: TemplateNodeSpec): boolean => {
          return node.componentType === ComponentType.Trigger;
        },
      )!;
      const triggerMetadata: ComponentMetadata = metadataOf(trigger.metadataId);

      // What a Page step added to this workflow by hand starts with.
      const started: JSONObject | null = getNewPageStepArguments({
        metadataId: nodeOf(templateId, componentId).metadataId,
        steps: [
          {
            id: trigger.componentId,
            internalId: "runner-trigger",
            nodeType: NodeType.Node,
            componentType: triggerMetadata.componentType,
            metadataId: triggerMetadata.id,
            metadata: triggerMetadata,
            error: "",
            arguments: {},
            returnValues: {},
          } as NodeDataProp,
        ],
      });

      expect(started).not.toBeNull();
      expect(nodeOf(templateId, componentId).args).toEqual(started);
      expect(started).toEqual({
        about: "incident",
        "incident-id":
          "{{local.components.incident-on-create-1.returnValues.model._id}}",
      });
    },
  );

  test("the webhook's pages about something new: the title and the message it was sent", () => {
    expect(nodeOf(WEBHOOK_PAGE, "page-users-1").args).toEqual({
      about: "new-alert",
      title: "{{local.components.webhook-1.returnValues.request-body.title}}",
      message:
        "{{local.components.webhook-1.returnValues.request-body.message}}",
    });
  });
});

describe("how the paging is made conditional", () => {
  test("an If / Else on the severity stands in front of the Page step: Yes pages, No ends the run", () => {
    expect(nodeOf(CRITICAL_PAGE, "if-else-1").metadataId).toBe(
      ComponentID.IfElse,
    );
    expect(nodeOf(CRITICAL_PAGE, "if-else-1").args).toMatchObject({
      "input-1":
        "{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}",
      "input-2": "Critical Incident",
    });
    expect(leadsTo(CRITICAL_PAGE, "if-else-1", "yes")).toEqual([
      "page-on-call-1",
    ]);
    expect(leadsTo(CRITICAL_PAGE, "if-else-1", "no")).toEqual([]);
  });

  test("a Switch / Case on the severity has a different Page step on each case, and Default ends the run", () => {
    expect(nodeOf(SEVERITY_PAGE, "switch-1").metadataId).toBe(
      ComponentID.Switch,
    );
    expect(leadsTo(SEVERITY_PAGE, "switch-1", "case-1")).toEqual([
      "page-on-call-policy-1",
    ]);
    expect(leadsTo(SEVERITY_PAGE, "switch-1", "case-2")).toEqual([
      "page-team-1",
    ]);
    expect(leadsTo(SEVERITY_PAGE, "switch-1", "default")).toEqual([]);
    // Critical escalates through a policy; major pages a team at once.
    expect(nodeOf(SEVERITY_PAGE, "page-on-call-policy-1").metadataId).toBe(
      ComponentID.PageOnCallPolicy,
    );
    expect(nodeOf(SEVERITY_PAGE, "page-team-1").metadataId).toBe(
      ComponentID.PageTeam,
    );
  });
});

/* ------------------------------ end to end ------------------------------ */

interface PageRequest {
  projectId: ObjectID;
  targets: OnCallPageTargets;
  about: OnCallPageAbout;
  props: DatabaseCommonInteractionProps;
}

// Every page the workflow asked for, in order.
let pagesAsked: Array<PageRequest> = [];

// What the paging answers: a result, or why nobody could be paged.
let pagingAnswers: (request: PageRequest) => OnCallPageResult = (): never => {
  throw new Error("The test did not say what the paging answers.");
};

function idsOf(ids: Array<ObjectID> | undefined): Array<string> {
  return (ids || []).map((id: ObjectID): string => {
    return id.toString();
  });
}

function paged(data: {
  summary: string;
  type?: OnCallPageRecordType;
  recordId?: string;
  isNew?: boolean;
  people?: Array<{ id: string; name: string; email: string }>;
  policies?: Array<{ id: string; name: string }>;
}): OnCallPageResult {
  return {
    record: {
      type: data.type || OnCallPageRecordType.Incident,
      id: new ObjectID(data.recordId || INCIDENT_ID),
      label: "INC-42",
      title: "Checkout is down",
      url: "https://oneuptime.example.com/dashboard/incidents/42",
      isNew: Boolean(data.isNew),
    },
    paged: (data.people || []).map(
      (person: { id: string; name: string; email: string }) => {
        return {
          userId: new ObjectID(person.id),
          name: person.name,
          email: person.email,
          teamName: null,
          scheduleName: null,
          coveringForName: null,
        };
      },
    ),
    startedPolicies: (data.policies || []).map(
      (policy: { id: string; name: string }) => {
        return {
          onCallDutyPolicyId: new ObjectID(policy.id),
          name: policy.name,
        };
      },
    ),
    notPaged: [],
    isAnyonePaged: true,
    directPageExecutionLogId: null,
    summary: data.summary,
  } as unknown as OnCallPageResult;
}

function incident(severity: string): JSONObject {
  return {
    model: {
      _id: INCIDENT_ID,
      title: "Checkout is down",
      incidentNumber: 42,
      incidentNumberWithPrefix: "INC-42",
      incidentSeverity: { name: severity },
      currentIncidentState: { name: "Created" },
    },
  };
}

beforeEach(() => {
  pagesAsked = [];
  pagingAnswers = (): never => {
    throw new Error("The test did not say what the paging answers.");
  };

  jest.spyOn(OnCallPageService, "page").mockImplementation((async (
    request: PageRequest,
  ) => {
    pagesAsked.push(request);
    return pagingAnswers(request);
  }) as never);

  // The step's caller, without the read of the project's plan.
  jest.spyOn(WorkflowPrincipal, "getProps").mockImplementation((async (
    data: WorkflowPrincipalOptions,
  ) => {
    return WorkflowPrincipal.getPropsWithoutPlan(data);
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Page whoever is on call when a critical incident is created", () => {
  // As the builder stores a schedule picked by name.
  const PICKED: JSONObject = {
    "page-on-call-1": { "on-call-schedules": [SCHEDULE_ID] },
  };

  async function run(
    severity: string,
    settings: JSONObject = PICKED,
  ): Promise<SimulationTrace> {
    return await runTemplate({
      templateId: CRITICAL_PAGE,
      trigger: incident(severity),
      variables: {},
      settings: settings as never,
    });
  }

  test("a critical incident pages whoever is on call in the schedule picked, about that incident", async () => {
    pagingAnswers = (): OnCallPageResult => {
      return paged({
        summary: "Paged Jane Doe (on call in Primary) about INC-42.",
        people: [{ id: JANE_ID, name: "Jane Doe", email: "jane@example.com" }],
      });
    };

    const trace: SimulationTrace = await run("Critical Incident");

    expect(trace.executed).toEqual([
      "incident-on-create-1",
      "if-else-1",
      "page-on-call-1",
    ]);
    expect(pagesAsked).toHaveLength(1);
    expect(idsOf(pagesAsked[0]!.targets.onCallScheduleIds)).toEqual([
      SCHEDULE_ID,
    ]);
    // Nobody else: not a person, a team or a policy.
    expect(pagesAsked[0]!.targets.userIds).toBeUndefined();
    expect(pagesAsked[0]!.targets.teamIds).toBeUndefined();
    expect(pagesAsked[0]!.targets.onCallDutyPolicyIds).toBeUndefined();
    expect(pagesAsked[0]!.about.incidentId?.toString()).toBe(INCIDENT_ID);
    expect(pagesAsked[0]!.about.newAlert).toBeUndefined();
    expect(trace.ports["page-on-call-1"]).toBe("success");
    // Who was paged, said by the step itself.
    expect(
      trace.storage.local.components["page-on-call-1"]!.returnValues["summary"],
    ).toBe("Paged Jane Doe (on call in Primary) about INC-42.");
    expect(trace.failedSteps).toEqual([]);
  });

  test("it pages in the workflow's project, as the workflow: never as OneUptime itself", async () => {
    pagingAnswers = (): OnCallPageResult => {
      return paged({ summary: "Paged Jane Doe about INC-42." });
    };

    await run("Critical Incident");

    const request: PageRequest = pagesAsked[0]!;

    expect(request.projectId.toString()).toBe(SIMULATED_PROJECT_ID.toString());
    expect(request.props.isRoot).toBeUndefined();
    expect(request.props.userType).toBe(UserType.Workflow);
    expect(request.props.workflowId?.toString()).toBe(
      SIMULATED_WORKFLOW_ID.toString(),
    );
    expect(request.props.workflowName).toBe(SIMULATED_WORKFLOW_NAME);
  });

  test.each(["Major Incident", "Minor Incident", "critical incident", ""])(
    "an incident that is '%s' pages nobody: the run ends at the check, and succeeds",
    async (severity: string) => {
      const trace: SimulationTrace = await run(severity);

      expect(trace.executed).toEqual(["incident-on-create-1", "if-else-1"]);
      expect(trace.ports["if-else-1"]).toBe("no");
      expect(pagesAsked).toEqual([]);
      expect(trace.failedSteps).toEqual([]);
    },
  );

  test("when nobody could be paged, the run fails at the Page step, which says why", async () => {
    pagingAnswers = (): never => {
      throw new BadDataException(
        "Nobody was paged. Nobody is on call in Primary right now.",
      );
    };

    const trace: SimulationTrace = await run("Critical Incident");

    expect(trace.executed).toEqual([
      "incident-on-create-1",
      "if-else-1",
      "page-on-call-1",
    ]);
    expect(trace.ports["page-on-call-1"]).toBe("error");
    expect(trace.failedSteps).toEqual(["page-on-call-1"]);
    expect(
      trace.storage.local.components["page-on-call-1"]!.returnValues["error"],
    ).toBe("Nobody was paged. Nobody is on call in Primary right now.");
  });

  // As it would be had the wizard not asked: a workflow made through the API, say.
  test("run with nobody picked, it stops at the Page step and says what to do", async () => {
    await expect(run("Critical Incident", {})).rejects.toThrow(
      "On-Call Schedules is empty, so this step has nobody to page. Open the step and choose who to page.",
    );
    expect(pagesAsked).toEqual([]);
  });

  test("and an incident that is not critical still runs clean then: the Page step is never reached", async () => {
    const trace: SimulationTrace = await run("Minor Incident", {});

    expect(trace.executed).toEqual(["incident-on-create-1", "if-else-1"]);
  });

  test("a value from the trigger beside the schedule picked is handed on with it", async () => {
    pagingAnswers = (): OnCallPageResult => {
      return paged({ summary: "Paged 2 people about INC-42." });
    };

    const trace: SimulationTrace = await runTemplate({
      templateId: CRITICAL_PAGE,
      trigger: {
        model: {
          ...(incident("Critical Incident")["model"] as JSONObject),
          backupScheduleId: "5c4e0000-0000-4000-8000-000000000002",
        },
      },
      variables: {},
      settings: {
        "page-on-call-1": {
          "on-call-schedules": [
            SCHEDULE_ID,
            "{{local.components.incident-on-create-1.returnValues.model.backupScheduleId}}",
          ],
        },
      },
    });

    expect(trace.ports["page-on-call-1"]).toBe("success");
    expect(idsOf(pagesAsked[0]!.targets.onCallScheduleIds)).toEqual([
      SCHEDULE_ID,
      "5c4e0000-0000-4000-8000-000000000002",
    ]);
  });
});

describe("Page different people for each incident severity", () => {
  const PICKED: JSONObject = {
    "page-on-call-policy-1": { "on-call-policies": [POLICY_ID] },
    "page-team-1": { teams: [TEAM_ID] },
  };

  async function run(severity: string): Promise<SimulationTrace> {
    return await runTemplate({
      templateId: SEVERITY_PAGE,
      trigger: incident(severity),
      variables: {},
      settings: PICKED as never,
    });
  }

  test("a critical incident starts the on-call policy picked, and pages nobody directly", async () => {
    pagingAnswers = (): OnCallPageResult => {
      return paged({
        summary: "Started on-call policy Critical for INC-42.",
        policies: [{ id: POLICY_ID, name: "Critical" }],
      });
    };

    const trace: SimulationTrace = await run("Critical Incident");

    expect(trace.executed).toEqual([
      "incident-on-create-1",
      "switch-1",
      "page-on-call-policy-1",
    ]);
    expect(trace.ports["switch-1"]).toBe("case-1");
    expect(pagesAsked).toHaveLength(1);
    expect(idsOf(pagesAsked[0]!.targets.onCallDutyPolicyIds)).toEqual([
      POLICY_ID,
    ]);
    expect(pagesAsked[0]!.targets.teamIds).toBeUndefined();
    expect(pagesAsked[0]!.targets.userIds).toBeUndefined();
    expect(pagesAsked[0]!.about.incidentId?.toString()).toBe(INCIDENT_ID);
    expect(trace.ports["page-on-call-policy-1"]).toBe("success");
    expect(trace.logs).toEqual([]);
  });

  test("a major incident pages the team picked, and starts no policy", async () => {
    pagingAnswers = (): OnCallPageResult => {
      return paged({ summary: "Paged 3 people of Platform about INC-42." });
    };

    const trace: SimulationTrace = await run("Major Incident");

    expect(trace.executed).toEqual([
      "incident-on-create-1",
      "switch-1",
      "page-team-1",
    ]);
    expect(trace.ports["switch-1"]).toBe("case-2");
    expect(pagesAsked).toHaveLength(1);
    expect(idsOf(pagesAsked[0]!.targets.teamIds)).toEqual([TEAM_ID]);
    expect(pagesAsked[0]!.targets.onCallDutyPolicyIds).toBeUndefined();
    expect(pagesAsked[0]!.about.incidentId?.toString()).toBe(INCIDENT_ID);
  });

  test.each(["Minor Incident", "Low", ""])(
    "an incident that is '%s' takes Default: nobody paged, and the run succeeds",
    async (severity: string) => {
      const trace: SimulationTrace = await run(severity);

      expect(trace.executed).toEqual(["incident-on-create-1", "switch-1"]);
      expect(trace.ports["switch-1"]).toBe("default");
      expect(pagesAsked).toEqual([]);
      expect(trace.failedSteps).toEqual([]);
    },
  );

  test("a policy that could not be started fails the run at its step, which says why", async () => {
    pagingAnswers = (): never => {
      throw new BadDataException(
        "Nobody was paged. No on-call policy has the ID dddddddd-0000-4000-8000-000000000001.",
      );
    };

    const trace: SimulationTrace = await run("Critical Incident");

    expect(trace.executed).toEqual([
      "incident-on-create-1",
      "switch-1",
      "page-on-call-policy-1",
    ]);
    expect(trace.failedSteps).toEqual(["page-on-call-policy-1"]);
    expect(
      trace.storage.local.components["page-on-call-policy-1"]!.returnValues[
        "error"
      ],
    ).toBe(
      "Nobody was paged. No on-call policy has the ID dddddddd-0000-4000-8000-000000000001.",
    );
  });

  test("a team nobody could be paged in fails the run at its step, which says why", async () => {
    pagingAnswers = (): never => {
      throw new BadDataException("Nobody was paged. Platform has no members.");
    };

    const trace: SimulationTrace = await run("Major Incident");

    expect(trace.executed).toEqual([
      "incident-on-create-1",
      "switch-1",
      "page-team-1",
    ]);
    expect(trace.failedSteps).toEqual(["page-team-1"]);
    expect(
      trace.storage.local.components["page-team-1"]!.returnValues["error"],
    ).toBe("Nobody was paged. Platform has no members.");
  });
});

describe("Page someone when another tool calls a webhook", () => {
  const PICKED: JSONObject = { "page-users-1": { users: [JANE_ID] } };

  async function run(body: JSONObject): Promise<SimulationTrace> {
    return await runTemplate({
      templateId: WEBHOOK_PAGE,
      trigger: {
        "request-headers": { "content-type": "application/json" },
        "request-params": {},
        "request-body": body,
      },
      variables: {},
      settings: PICKED as never,
    });
  }

  test("a POST with a title and a message pages the people picked about a new alert made from them", async () => {
    pagingAnswers = (): OnCallPageResult => {
      return paged({
        summary: "Paged Jane Doe about a new alert, Database CPU is above 90%.",
        type: OnCallPageRecordType.Alert,
        recordId: ALERT_ID,
        isNew: true,
        people: [{ id: JANE_ID, name: "Jane Doe", email: "jane@example.com" }],
      });
    };

    const trace: SimulationTrace = await run({
      title: "Database CPU is above 90%",
      message: "Queries are queueing on db-primary.",
    });

    expect(trace.executed).toEqual(["webhook-1", "page-users-1"]);
    expect(pagesAsked).toHaveLength(1);
    expect(idsOf(pagesAsked[0]!.targets.userIds)).toEqual([JANE_ID]);
    expect(pagesAsked[0]!.about.incidentId).toBeUndefined();
    expect(pagesAsked[0]!.about.alertId).toBeUndefined();
    expect(pagesAsked[0]!.about.newAlert).toMatchObject({
      title: "Database CPU is above 90%",
      description: "Queries are queueing on db-primary.",
    });
    expect(
      trace.storage.local.components["page-users-1"]!.returnValues["summary"],
    ).toBe("Paged Jane Doe about a new alert, Database CPU is above 90%.");

    // The alert it made is handed on, for a step after this one.
    expect(
      trace.storage.local.components["page-users-1"]!.returnValues["alert-id"],
    ).toBe(ALERT_ID);
    expect(
      trace.storage.local.components["page-users-1"]!.returnValues[
        "paged-users"
      ],
    ).toEqual([{ id: JANE_ID, name: "Jane Doe", email: "jane@example.com" }]);
  });

  test("a title and a message are taken as text: nothing in them is run or read as a value", async () => {
    pagingAnswers = (): OnCallPageResult => {
      return paged({
        summary: "Paged Jane Doe.",
        type: OnCallPageRecordType.Alert,
        recordId: ALERT_ID,
        isNew: true,
      });
    };

    await run({
      title: "{{local.variables.secret}} <b>down</b>",
      message: '"; DROP TABLE alerts; --',
    });

    expect(pagesAsked[0]!.about.newAlert).toMatchObject({
      title: "{{local.variables.secret}} <b>down</b>",
      description: '"; DROP TABLE alerts; --',
    });
  });

  test("a POST with no title pages nobody, and fails the run at the Page step, which says a title is needed", async () => {
    const trace: SimulationTrace = await run({
      message: "Queries are queueing on db-primary.",
    });

    expect(pagesAsked).toEqual([]);
    expect(trace.executed).toEqual(["webhook-1", "page-users-1"]);
    expect(trace.ports["page-users-1"]).toBe("error");
    expect(trace.failedSteps).toEqual(["page-users-1"]);
    expect(
      String(
        trace.storage.local.components["page-users-1"]!.returnValues["error"],
      ),
    ).toMatch(NOBODY_PAGED_FOR_WANT_OF_A_TITLE);
  });

  test("a message is optional: a title alone is enough to page", async () => {
    pagingAnswers = (): OnCallPageResult => {
      return paged({
        summary: "Paged Jane Doe.",
        type: OnCallPageRecordType.Alert,
        recordId: ALERT_ID,
        isNew: true,
      });
    };

    const trace: SimulationTrace = await run({ title: "Disk is full" });

    expect(trace.ports["page-users-1"]).toBe("success");
    expect(pagesAsked[0]!.about.newAlert?.title).toBe("Disk is full");
  });
});

const NOBODY_PAGED_FOR_WANT_OF_A_TITLE: RegExp = /Title/;
