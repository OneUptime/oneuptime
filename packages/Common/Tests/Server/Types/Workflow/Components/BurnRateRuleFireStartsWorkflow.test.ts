import ServiceLevelObjectiveBurnRateRule from "../../../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import Workflow from "../../../../../Models/DatabaseModels/Workflow";
import ServiceLevelObjectiveBurnRateRuleService from "../../../../../Server/Services/ServiceLevelObjectiveBurnRateRuleService";
import WorkflowService from "../../../../../Server/Services/WorkflowService";
import OnTriggerBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/OnTriggerBaseModel";
import {
  ExecuteWorkflowType,
  InitProps,
} from "../../../../../Server/Types/Workflow/TriggerCode";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../../Server/Utils/Express";
import Response from "../../../../../Server/Utils/Response";
import { ColumnAccessControl } from "../../../../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../../../../Types/Dictionary";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import ComponentMetadata, {
  Argument,
} from "../../../../../Types/Workflow/Component";
import BaseModelComponents, {
  SELECT_FIELDS_NAME,
  WATCHED_FIELDS_NAME,
} from "../../../../../Types/Workflow/Components/BaseModel";
import {
  SLO_BURN_RATE_RULE_TRIGGER_ID,
  WorkflowTemplate,
  WorkflowTemplateCategory,
  getTemplateGraphSpec,
  getWorkflowTemplates,
} from "../../../../../Types/Workflow/Templates";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A BURN RATE RULE'S FIRE STARTS THE WORKFLOWS WATCHING IT, AND NOTHING ELSE
 * THE RULE'S UPDATES CHANGE DOES (#8447).
 *
 * The SLOs workflow templates turn a feature flag off when an SLO burns its
 * error budget too fast. They start on the burn rate rule's On Update, with
 * Last Alert Created At and Last Incident Declared At in Fields to watch.
 * The worker stamps those two, and only those, in an update of the rule
 * when it fires (EvaluateSlos.test.ts, "the stamps a workflow follows").
 * This holds the trigger's half: the trigger is one a workflow can pick,
 * the fields it passes on are ones a workflow's steps can read, and it runs
 * a workflow watching the fire for a fire, never for a resolve or an edit.
 */

const RULE_ID: string = "6ba7b810-9dad-41d1-80b4-00c04fd47001";
const WATCHING_THE_FIRE: string = "6ba7b810-9dad-41d1-80b4-00c04fd47101";

const TRIGGER_METADATA_ID: string =
  "service-level-objective-burn-rate-rule-on-update";

const SLO_TEMPLATES: Array<WorkflowTemplate> = getWorkflowTemplates().filter(
  (template: WorkflowTemplate): boolean => {
    return template.category === WorkflowTemplateCategory.Slos;
  },
);

interface TriggerNode {
  componentId: string;
  metadataId: string;
  args?: JSONObject | undefined;
}

const triggerOf: (templateId: string) => TriggerNode = (
  templateId: string,
): TriggerNode => {
  const nodes: Array<TriggerNode> = (getTemplateGraphSpec(templateId)?.nodes ||
    []) as Array<TriggerNode>;
  const trigger: TriggerNode | undefined = nodes.find(
    (node: TriggerNode): boolean => {
      return node.componentId === SLO_BURN_RATE_RULE_TRIGGER_ID;
    },
  );

  expect(trigger).toBeDefined();

  return trigger as TriggerNode;
};

// The Fields to watch every SLOs template watches with: one, the same in each.
const LISTEN_ON: JSONObject = triggerOf(SLO_TEMPLATES[0]!.id).args![
  "listen-on"
] as JSONObject;

function workflowWatching(listenOn: JSONObject): Workflow {
  const workflow: Workflow = new Workflow();
  workflow._id = WATCHING_THE_FIRE;
  workflow.id = new ObjectID(WATCHING_THE_FIRE);
  workflow.isEnabled = true;
  workflow.triggerArguments = { "listen-on": listenOn };
  return workflow;
}

// The runs one update of the rule starts, as DatabaseService reports it.
async function runsFor(updatedFields: JSONObject): Promise<Array<string>> {
  jest
    .spyOn(WorkflowService, "findBy")
    .mockResolvedValue([workflowWatching(LISTEN_ON)]);

  const trigger: OnTriggerBaseModel<never> = new OnTriggerBaseModel(
    ServiceLevelObjectiveBurnRateRuleService as never,
    "on-update",
  );

  const executed: Array<ExecuteWorkflowType> = [];

  await trigger.initTrigger(
    {
      params: { projectId: ObjectID.generate().toString() },
      body: {
        data: {
          _id: RULE_ID,
          miscData: { updatedFields: updatedFields },
        },
      },
    } as unknown as ExpressRequest,
    {} as unknown as ExpressResponse,
    {
      router: {} as InitProps["router"],
      executeWorkflow: async (run: ExecuteWorkflowType): Promise<void> => {
        executed.push(run);
      },
      scheduleWorkflow: async (): Promise<void> => {},
      removeWorkflow: async (): Promise<void> => {},
    },
  );

  return executed.map((run: ExecuteWorkflowType): string => {
    return run.workflowId.toString();
  });
}

beforeEach(() => {
  jest.spyOn(Response, "sendJsonObjectResponse").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the burn rate rule's On Update, as the SLOs templates use it", () => {
  const model: ServiceLevelObjectiveBurnRateRule =
    new ServiceLevelObjectiveBurnRateRule();
  const metadata: ComponentMetadata | undefined =
    BaseModelComponents.getComponents(model).find(
      (component: ComponentMetadata): boolean => {
        return component.id === TRIGGER_METADATA_ID;
      },
    );

  test("there are SLOs templates to hold to it", () => {
    expect(SLO_TEMPLATES.length).toBeGreaterThanOrEqual(2);
  });

  test("is a trigger the Builder offers, by the name it shows, with Fields to watch", () => {
    expect(model.enableWorkflowOn?.update).toBe(true);
    expect(metadata?.title).toBe("On Update SLO Burn Rate Rule");
    expect(
      (metadata?.arguments || []).map((argument: Argument): string => {
        return `${argument.id} ${argument.name}`;
      }),
    ).toEqual([
      `listen-on ${WATCHED_FIELDS_NAME}`,
      `select ${SELECT_FIELDS_NAME}`,
    ]);
  });

  test.each(
    SLO_TEMPLATES.map((template: WorkflowTemplate) => {
      return template.id;
    }),
  )(
    "%s starts on it, by the id the Builder gives the first one added",
    (templateId: string) => {
      const trigger: TriggerNode = triggerOf(templateId);

      expect(trigger.metadataId).toBe(TRIGGER_METADATA_ID);
      expect(SLO_BURN_RATE_RULE_TRIGGER_ID).toBe(`${TRIGGER_METADATA_ID}-1`);
      expect(trigger.args!["listen-on"]).toEqual(LISTEN_ON);
    },
  );

  test("watches the two stamps of a fire, by the names Fields to watch shows them", () => {
    expect(Object.keys(LISTEN_ON).sort()).toEqual([
      "lastAlertCreatedAt",
      "lastIncidentCreatedAt",
    ]);
    expect(model.getTableColumnMetadata("lastAlertCreatedAt").title).toBe(
      "Last Alert Created At",
    );
    expect(model.getTableColumnMetadata("lastIncidentCreatedAt").title).toBe(
      "Last Incident Declared At",
    );
  });

  /*
   * A workflow's steps read as a Project Admin of its project (getStepProps),
   * so every field a template passes on has to be one a Project Admin reads.
   */
  test.each(
    SLO_TEMPLATES.map((template: WorkflowTemplate) => {
      return template.id;
    }),
  )(
    "%s passes on only fields a Project Admin can read",
    (templateId: string) => {
      const columns: Dictionary<ColumnAccessControl> =
        model.getColumnAccessControlForAllColumns();
      const select: JSONObject = triggerOf(templateId).args![
        "select"
      ] as JSONObject;

      for (const field of Object.keys(select).filter((key: string) => {
        return key !== "_id";
      })) {
        expect({
          field: field,
          readable: (columns[field]?.read || []).includes(
            Permission.ProjectAdmin,
          ),
        }).toEqual({ field: field, readable: true });
      }

      for (const field of Object.keys(LISTEN_ON)) {
        expect(Object.keys(select)).toContain(field);
      }
    },
  );
});

describe("an update of the rule starts a workflow watching the fire", () => {
  test("when the rule raises its alert", async () => {
    await expect(
      runsFor({ lastAlertCreatedAt: "2026-11-15T12:00:00.000Z" }),
    ).resolves.toEqual([WATCHING_THE_FIRE]);
  });

  test("when the rule declares its incident", async () => {
    await expect(
      runsFor({ lastIncidentCreatedAt: "2026-11-15T12:00:00.000Z" }),
    ).resolves.toEqual([WATCHING_THE_FIRE]);
  });

  test("once, when the rule raises its alert and declares its incident in one update", async () => {
    await expect(
      runsFor({
        lastAlertCreatedAt: "2026-11-15T12:00:00.000Z",
        lastIncidentCreatedAt: "2026-11-15T12:00:00.000Z",
      }),
    ).resolves.toEqual([WATCHING_THE_FIRE]);
  });

  test.each([
    ["its alert resolves", { lastAlertResolvedAt: "2026-11-15T13:00:00.000Z" }],
    [
      "its incident resolves",
      { lastIncidentResolvedAt: "2026-11-15T13:00:00.000Z" },
    ],
    ["someone changes its threshold", { burnRateThreshold: 6 }],
    ["someone renames it", { name: "Checkout fast burn" }],
    ["someone switches it off", { isEnabled: false }],
  ] as Array<[string, JSONObject]>)(
    "but not when %s",
    async (_label: string, updatedFields: JSONObject) => {
      await expect(runsFor(updatedFields)).resolves.toEqual([]);
    },
  );
});
