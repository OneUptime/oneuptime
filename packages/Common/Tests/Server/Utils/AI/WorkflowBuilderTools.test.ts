import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { getModelTypeByName } from "../../../../Models/DatabaseModels/Index";
import Workflow from "../../../../Models/DatabaseModels/Workflow";
import { CUSTOM_FIELD_RECORD_KINDS } from "../../../../Types/CustomField/CustomFieldRecordKinds";
import WorkflowService from "../../../../Server/Services/WorkflowService";
import AlertCustomFieldService from "../../../../Server/Services/AlertCustomFieldService";
import IncidentCustomFieldService from "../../../../Server/Services/IncidentCustomFieldService";
import InventoryItemCustomFieldService from "../../../../Server/Services/InventoryItemCustomFieldService";
import MonitorCustomFieldService from "../../../../Server/Services/MonitorCustomFieldService";
import OnCallDutyPolicyCustomFieldService from "../../../../Server/Services/OnCallDutyPolicyCustomFieldService";
import ScheduledMaintenanceCustomFieldService from "../../../../Server/Services/ScheduledMaintenanceCustomFieldService";
import SecurityCaseCustomFieldService from "../../../../Server/Services/SecurityCaseCustomFieldService";
import StatusPageCustomFieldService from "../../../../Server/Services/StatusPageCustomFieldService";
import TeamCustomFieldService from "../../../../Server/Services/TeamCustomFieldService";
import TeamMemberCustomFieldService from "../../../../Server/Services/TeamMemberCustomFieldService";
import AIToolbox from "../../../../Server/Utils/AI/Toolbox/Index";
import {
  ObservabilityTool,
  PreparedMutation,
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import {
  CUSTOM_FIELD_READERS,
  CheckWorkflowDraftTool,
  CreateWorkflowTool,
  FindWorkflowComponentsTool,
  UpdateWorkflowTool,
  getWorkflowComponent,
  searchWorkflowComponents,
} from "../../../../Server/Utils/AI/Toolbox/WorkflowBuilderTools";
import { QueryWorkflowsTool } from "../../../../Server/Utils/AI/Toolbox/WorkflowProbeTools";
import WorkflowLogService from "../../../../Server/Services/WorkflowLogService";
import AIChatPageContextType from "../../../../Types/AI/AIChatPageContext";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
import {
  AIActionSentence,
  describeAIActionSentence,
} from "../../../../Types/AI/AIActionWords";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  ComponentType,
} from "../../../../Types/Workflow/Component";
import BuiltInComponents from "../../../../Types/Workflow/Components";
import { HIDDEN_SECRET_VALUE } from "../../../../Types/Workflow/WorkflowDraft";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Issue #5945: Ask AI finds what a workflow can be made of, checks a draft, and
 * creates or changes a workflow as the person who asked. A new one starts off.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "e8000000-0000-4000-8000-0000000000a1",
);
const USER_ID: ObjectID = new ObjectID("e8000000-0000-4000-8000-0000000000b1");
const WORKFLOW_ID: ObjectID = new ObjectID(
  "e8000000-0000-4000-8000-0000000000c1",
);

const CTX: ToolContext = {
  projectId: PROJECT_ID,
  props: { tenantId: PROJECT_ID, userId: USER_ID, userType: UserType.User },
};

const DRAFT: JSONObject = {
  steps: [
    { id: "webhook-1", componentId: ComponentID.Webhook },
    {
      id: "log-1",
      componentId: ComponentID.Log,
      arguments: { value: "hello" },
    },
  ],
  connections: [{ from: "webhook-1", to: "log-1" }],
};

interface RecordedSpy {
  mock: { calls: Array<Array<any>> };
  mockResolvedValue: (value: unknown) => unknown;
}

type StoredWorkflowFunction = (values?: Partial<Workflow>) => Workflow;

const storedWorkflow: StoredWorkflowFunction = (
  values: Partial<Workflow> = {},
): Workflow => {
  const workflow: Workflow = new Workflow();
  workflow.id = WORKFLOW_ID;
  workflow.name = "Tickets";
  workflow.isEnabled = false;
  workflow.isArchived = false;
  workflow.graph = {
    nodes: [
      {
        id: "node-1",
        type: "node",
        position: { x: 300, y: 50 },
        data: {
          id: "webhook-1",
          nodeType: "Node",
          componentType: ComponentType.Trigger,
          metadataId: ComponentID.Webhook,
          internalId: "internal-1",
          arguments: {},
        },
      },
    ],
    edges: [],
  } as unknown as JSONObject;
  Object.assign(workflow, values);
  return workflow;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the toolbox", () => {
  test("has the four tools, and the two that change something are mutations", () => {
    expect(AIToolbox.getToolByName("find_workflow_components")).toBeDefined();
    expect(AIToolbox.getToolByName("check_workflow_draft")).toBeDefined();
    expect(AIToolbox.isMutationTool("create_workflow")).toBe(true);
    expect(AIToolbox.isMutationTool("update_workflow")).toBe(true);
    expect(AIToolbox.isMutationTool("find_workflow_components")).toBe(false);
    expect(AIToolbox.isMutationTool("check_workflow_draft")).toBe(false);
  });

  test("a read-only conversation is not offered the two that change something", () => {
    const names: Array<string> = AIToolbox.getLlmToolDefinitions(
      AIChatPermissionMode.ReadOnly,
    ).map((definition: { name: string }): string => {
      return definition.name;
    });

    expect(names).not.toContain("create_workflow");
    expect(names).not.toContain("update_workflow");
    expect(names).toContain("find_workflow_components");
    expect(names).toContain("check_workflow_draft");
  });

  test("the gates are the model's own lists", () => {
    const workflow: Workflow = new Workflow();

    expect(FindWorkflowComponentsTool.requiredPermissions).toEqual(
      workflow.getReadPermissions(),
    );
    expect(CheckWorkflowDraftTool.requiredPermissions).toEqual(
      workflow.getReadPermissions(),
    );
    expect(CreateWorkflowTool.requiredPermissions).toEqual(
      workflow.getCreatePermissions(),
    );
    expect(UpdateWorkflowTool.requiredPermissions).toEqual(
      workflow.getUpdatePermissions(),
    );
  });

  test.each(["create_workflow", "update_workflow"])(
    "%s runs for no one who is not a signed-in person",
    async (name: string) => {
      const create: RecordedSpy = jest
        .spyOn(WorkflowService as never, "create")
        .mockResolvedValue(storedWorkflow() as never) as unknown as RecordedSpy;

      const outcome: { success: boolean } = await AIToolbox.executeTool({
        name: name,
        args: { name: "x", ...DRAFT },
        ctx: { projectId: PROJECT_ID, props: { isRoot: true } },
      });

      expect(outcome.success).toBe(false);
      expect(create.mock.calls).toHaveLength(0);
    },
  );

  test("create_workflow is refused to someone without the permission", async () => {
    const create: RecordedSpy = jest
      .spyOn(WorkflowService as never, "create")
      .mockResolvedValue(storedWorkflow() as never) as unknown as RecordedSpy;

    const outcome: { success: boolean; textForLlm: string } =
      await AIToolbox.executeTool({
        name: "create_workflow",
        args: { name: "x", ...DRAFT },
        ctx: {
          projectId: PROJECT_ID,
          props: {
            ...CTX.props,
            userTenantAccessPermission: {
              [PROJECT_ID.toString()]: {
                _type: "UserTenantAccessPermission",
                projectId: PROJECT_ID,
                permissions: [
                  {
                    _type: "UserPermission",
                    permission: Permission.WorkflowViewer,
                    labelIds: [],
                  },
                ],
              },
            } as never,
          },
        },
      });

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("does not have permission");
    expect(create.mock.calls).toHaveLength(0);
  });
});

describe("find_workflow_components", () => {
  type FindFunction = (args: JSONObject) => Promise<string>;

  const find: FindFunction = async (args: JSONObject): Promise<string> => {
    return (await FindWorkflowComponentsTool.execute(args, CTX)).dataForLlm;
  };

  test("finds a built-in step by what it does", () => {
    expect(
      searchWorkflowComponents("slack")
        .map((component: { id: string }): string => {
          return component.id;
        })
        .some((id: string): boolean => {
          return id.includes("slack");
        }),
    ).toBe(true);
  });

  test("finds a record's step, and the model's are in the catalog", () => {
    expect(getWorkflowComponent("incident-create-one")).toBeDefined();
    expect(
      searchWorkflowComponents("incident create").map(
        (component: { id: string }): string => {
          return component.id;
        },
      ),
    ).toContain("incident-create-one");
  });

  test("every word has to be found", () => {
    expect(searchWorkflowComponents("incident xyzzy")).toEqual([]);
  });

  test("the title counts for most", () => {
    expect(searchWorkflowComponents("webhook", true)[0]?.id).toBe(
      ComponentID.Webhook,
    );
  });

  test("trigger=true finds triggers alone, and false steps alone", () => {
    expect(
      searchWorkflowComponents("incident", true).every(
        (component: { componentType: ComponentType }): boolean => {
          return component.componentType === ComponentType.Trigger;
        },
      ),
    ).toBe(true);
    expect(
      searchWorkflowComponents("incident", false).every(
        (component: { componentType: ComponentType }): boolean => {
          return component.componentType === ComponentType.Component;
        },
      ),
    ).toBe(true);
  });

  test("a search gives at most 25, in short", async () => {
    const text: string = await find({ query: "incident" });

    expect(text).toContain("incident");
    expect(text).not.toContain("recordColumns");
  });

  test("asking for one gives its settings, outputs and return values", async () => {
    const text: string = await find({ componentIds: [ComponentID.Log] });

    expect(text).toContain("settings");
    expect(text).toContain("outputs");
    expect(text).toContain("returnValues");
  });

  test("a record's step gives its columns, with what takes an ID", async () => {
    jest
      .spyOn(IncidentCustomFieldService as never, "findBy")
      .mockResolvedValue([] as never);

    const text: string = await find({ componentIds: ["incident-create-one"] });

    expect(text).toContain("recordColumns");
    expect(text).toContain("title: ");
    expect(text).toContain(
      "incidentSeverityId: takes the ID of a IncidentSeverity",
    );
  });

  test("nothing of it is cut short: settings cut short are settings written wrong", async () => {
    jest
      .spyOn(IncidentCustomFieldService as never, "findBy")
      .mockResolvedValue([] as never);

    const result: ToolExecutionResult =
      await FindWorkflowComponentsTool.execute(
        { componentIds: ["incident-create-one"] },
        CTX,
      );

    expect(result.isTruncated).toBe(false);
    expect(result.dataForLlm).not.toContain("[truncated]");
    expect(() => {
      return JSON.parse(result.dataForLlm);
    }).not.toThrow();
  });

  test("an example is not redacted: it is the product's own words", async () => {
    jest
      .spyOn(IncidentCustomFieldService as never, "findBy")
      .mockResolvedValue([] as never);

    expect(await find({ componentIds: ["incident-create-one"] })).not.toContain(
      "[redacted",
    );
  });

  test("a system column is not offered, whatever the record", async () => {
    jest
      .spyOn(IncidentCustomFieldService as never, "findBy")
      .mockResolvedValue([] as never);

    const text: string = await find({ componentIds: ["incident-create-one"] });

    expect(text).not.toContain('"createdAt:');
    expect(text).not.toContain('"projectId:');
  });

  test("and the project's custom fields, read as the person", async () => {
    const findBy: RecordedSpy = jest
      .spyOn(IncidentCustomFieldService as never, "findBy")
      .mockResolvedValue([
        {
          name: "Priority Level",
          customFieldType: "Dropdown",
          dropdownOptions: "P1\nP2",
        },
      ] as never) as unknown as RecordedSpy;

    const text: string = await find({ componentIds: ["incident-create-one"] });

    expect(text).toContain("Priority Level");
    expect(text).toContain("P1");
    expect(findBy.mock.calls[0]![0].props).toBe(CTX.props);
    expect(String(findBy.mock.calls[0]![0].query.projectId)).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("custom fields that cannot be read are simply not listed", async () => {
    (
      jest.spyOn(IncidentCustomFieldService as never, "findBy") as never as {
        mockRejectedValue: (e: Error) => void;
      }
    ).mockRejectedValue(new Error("Not on this plan"));

    expect(await find({ componentIds: ["incident-create-one"] })).not.toContain(
      "customFieldsAreWritten",
    );
  });

  test("says which it could not find", async () => {
    expect(await find({ componentIds: ["no-such-thing"] })).toContain(
      "no-such-thing",
    );
  });

  test("asks for a search or ids when given neither", async () => {
    await expect(find({})).rejects.toBeInstanceOf(BadDataException);
  });
});

describe("the custom fields of every kind of record", () => {
  const SERVICES: Array<[string, unknown]> = [
    ["IncidentCustomField", IncidentCustomFieldService],
    ["AlertCustomField", AlertCustomFieldService],
    ["MonitorCustomField", MonitorCustomFieldService],
    ["ScheduledMaintenanceCustomField", ScheduledMaintenanceCustomFieldService],
    ["StatusPageCustomField", StatusPageCustomFieldService],
    ["OnCallDutyPolicyCustomField", OnCallDutyPolicyCustomFieldService],
    ["TeamCustomField", TeamCustomFieldService],
    ["TeamMemberCustomField", TeamMemberCustomFieldService],
    ["InventoryItemCustomField", InventoryItemCustomFieldService],
    ["SecurityCaseCustomField", SecurityCaseCustomFieldService],
  ];

  test("every kind has a reader, by the table its fields are defined in", () => {
    for (const kind of CUSTOM_FIELD_RECORD_KINDS) {
      expect([
        kind.definitionTableName,
        typeof CUSTOM_FIELD_READERS[kind.definitionTableName],
      ]).toEqual([kind.definitionTableName, "function"]);
    }
  });

  test.each(SERVICES)(
    "%s is read as the person, in the project, by columns its table has",
    async (table: string, service: unknown) => {
      const findBy: RecordedSpy = jest
        .spyOn(service as never, "findBy")
        .mockResolvedValue([] as never) as unknown as RecordedSpy;

      await CUSTOM_FIELD_READERS[table]!(CTX);

      const call: Record<string, any> = findBy.mock.calls[0]![0];
      const modelType: { new (): BaseModel } = getModelTypeByName(table) as {
        new (): BaseModel;
      };
      const model: BaseModel = new modelType();

      expect(call["props"]).toBe(CTX.props);
      expect(String(call["query"].projectId)).toBe(PROJECT_ID.toString());

      for (const column of [
        ...Object.keys(call["sort"]),
        ...Object.keys(call["select"]),
      ]) {
        expect([
          table,
          column,
          Boolean(model.getTableColumnMetadata(column)),
        ]).toEqual([table, column, true]);
      }
    },
  );
});

describe("check_workflow_draft", () => {
  type CheckFunction = (args: JSONObject) => Promise<string>;

  const check: CheckFunction = async (args: JSONObject): Promise<string> => {
    return (await CheckWorkflowDraftTool.execute(args, CTX)).dataForLlm;
  };

  test("says what stops a draft being saved", async () => {
    expect(
      await check({
        steps: [{ id: "a", componentId: "no-such-thing" }],
        connections: [],
      }),
    ).toContain("cannot be saved yet");
  });

  test("says what the Builder would say of one that can be", async () => {
    const text: string = await check({
      steps: [
        { id: "webhook-1", componentId: ComponentID.Webhook },
        { id: "log-1", componentId: ComponentID.Log },
      ],
      connections: [{ from: "webhook-1", to: "log-1" }],
    });

    expect(text).toContain("can be saved");
    expect(text).toContain("log-1");
  });

  test("catches a reference to a step that does not exist", async () => {
    const text: string = await check({
      steps: [
        { id: "webhook-1", componentId: ComponentID.Webhook },
        {
          id: "log-1",
          componentId: ComponentID.Log,
          arguments: {
            value: "{{local.components.nope.returnValues.request-body}}",
          },
        },
      ],
      connections: [{ from: "webhook-1", to: "log-1" }],
    });

    expect(text).toContain("nope");
  });

  test("says when there is nothing to say", async () => {
    expect(await check(DRAFT)).toContain("finds nothing to say");
  });

  test("writes nothing", async () => {
    const create: RecordedSpy = jest
      .spyOn(WorkflowService as never, "create")
      .mockResolvedValue(storedWorkflow() as never) as unknown as RecordedSpy;

    await check(DRAFT);

    expect(create.mock.calls).toHaveLength(0);
  });
});

describe("create_workflow", () => {
  let create: RecordedSpy;

  beforeEach(() => {
    create = jest
      .spyOn(WorkflowService as never, "create")
      .mockResolvedValue(storedWorkflow() as never) as unknown as RecordedSpy;
  });

  type CreateFunction = (args?: JSONObject) => Promise<ToolExecutionResult>;

  const run: CreateFunction = async (
    args: JSONObject = {},
  ): Promise<ToolExecutionResult> => {
    return await CreateWorkflowTool.execute(
      { name: "Log it", ...DRAFT, ...args },
      CTX,
    );
  };

  type WrittenFunction = () => Workflow;

  const written: WrittenFunction = (): Workflow => {
    return create.mock.calls[0]![0].data as Workflow;
  };

  test("writes as the person: the props of who asked, never OneUptime's", async () => {
    await run();

    expect(create.mock.calls[0]![0].props).toBe(CTX.props);
  });

  test("in the project of the request, whatever the arguments say", async () => {
    await run({ projectId: "e8000000-0000-4000-8000-0000000000ff" });

    expect(String(written().projectId)).toBe(PROJECT_ID.toString());
  });

  test("starts turned off: it does not even say otherwise", async () => {
    await run({ isEnabled: true });

    expect(written().isEnabled).toBeUndefined();
  });

  test("with the graph its steps make, and its name and description", async () => {
    await run({ description: "Logs a delivery." });

    const graph: { nodes: Array<any>; edges: Array<any> } = written()
      .graph as never;

    expect(written().name).toBe("Log it");
    expect(written().description).toBe("Logs a delivery.");
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[1].data.metadataId).toBe(ComponentID.Log);
    expect(graph.edges).toHaveLength(1);
  });

  test("says it is off and that it cannot be turned on from here", async () => {
    const result: ToolExecutionResult = await run();

    expect(result.dataForLlm).toContain("turned off");
    expect(result.dataForLlm).toContain("you cannot turn it on");
  });

  test("links to its Builder", async () => {
    const result: ToolExecutionResult = await run();

    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.WorkflowBuilder,
      params: { workflowId: WORKFLOW_ID.toString() },
    });
  });

  test("tells the model what is left to fill in, and not to ask for secrets here", async () => {
    const result: ToolExecutionResult = await run({
      steps: [
        { id: "webhook-1", componentId: ComponentID.Webhook },
        { id: "log-1", componentId: ComponentID.Log },
      ],
    });

    expect(result.dataForLlm).toContain("log-1");
    expect(result.dataForLlm).toContain("Do not ask them for a password");
  });

  test("a name is required", async () => {
    await expect(CreateWorkflowTool.execute({ ...DRAFT }, CTX)).rejects.toThrow(
      "name is required",
    );
    expect(create.mock.calls).toHaveLength(0);
  });

  test("a name past the limit is refused, not cut", async () => {
    await expect(run({ name: "x".repeat(101) })).rejects.toThrow(
      "100 characters",
    );
  });

  test("what is wrong with the draft is refused, saying what, with nothing written", async () => {
    await expect(
      run({
        steps: [{ id: "a", componentId: "no-such-thing" }],
        connections: [],
      }),
    ).rejects.toThrow("no-such-thing");
    expect(create.mock.calls).toHaveLength(0);
  });

  test("a refusal from the service reaches the model as one", async () => {
    (
      WorkflowService.create as unknown as {
        mockRejectedValue: (e: Error) => void;
      }
    ).mockRejectedValue(new BadDataException("Not on this plan."));

    await expect(run()).rejects.toThrow("Not on this plan.");
  });

  describe("the approval card", () => {
    type EnglishFunction = (sentence: AIActionSentence) => string;

    const english: EnglishFunction = (sentence: AIActionSentence): string => {
      return describeAIActionSentence(sentence);
    };

    test("names the workflow", () => {
      expect(
        english(CreateWorkflowTool.buildActionTitle!({ name: "Log it" })),
      ).toBe("Create workflow: Log it");
    });

    test("names none when the call gives none", () => {
      expect(english(CreateWorkflowTool.buildActionTitle!({}))).toBe(
        "Create workflow: Untitled",
      );
    });

    test("says its steps by the Builder's titles, and that it starts off", async () => {
      const prepared: PreparedMutation =
        await CreateWorkflowTool.prepareMutation!(
          { name: "Log it", ...DRAFT },
          CTX,
        );

      const line: string = (prepared.description || []).map(english).join(" ");

      expect(line).toContain("Steps:");
      expect(line).toContain("Webhook");
      expect(line).toContain("starts turned off");
    });

    test("does not print the draft as a line of JSON", async () => {
      const prepared: PreparedMutation =
        await CreateWorkflowTool.prepareMutation!(
          { name: "Log it", ...DRAFT },
          CTX,
        );

      expect(prepared.describedArguments).toEqual(["steps", "connections"]);
    });

    test("does not write anything to prepare", async () => {
      await CreateWorkflowTool.prepareMutation!(
        { name: "Log it", ...DRAFT },
        CTX,
      );

      expect(create.mock.calls).toHaveLength(0);
    });
  });

  test("leaves a card that links to the Builder", async () => {
    const widget: JSONObject = (await run()).widget as unknown as JSONObject;

    expect(JSON.stringify(widget)).toContain("WorkflowBuilder");
    expect(JSON.stringify(widget)).toContain("Log it");
  });
});

describe("update_workflow", () => {
  let update: RecordedSpy;
  let read: RecordedSpy;

  beforeEach(() => {
    read = jest
      .spyOn(WorkflowService as never, "findOneById")
      .mockResolvedValue(storedWorkflow() as never) as unknown as RecordedSpy;
    update = jest
      .spyOn(WorkflowService as never, "updateOneById")
      .mockResolvedValue(undefined as never) as unknown as RecordedSpy;
  });

  type UpdateFunction = (
    args?: JSONObject,
    ctx?: ToolContext,
  ) => Promise<ToolExecutionResult>;

  const run: UpdateFunction = async (
    args: JSONObject = {},
    ctx: ToolContext = CTX,
  ): Promise<ToolExecutionResult> => {
    return await UpdateWorkflowTool.execute(
      { workflowId: WORKFLOW_ID.toString(), ...args },
      ctx,
    );
  };

  test("reads and writes as the person", async () => {
    await run(DRAFT);

    expect(read.mock.calls[0]![0].props).toBe(CTX.props);
    expect(update.mock.calls[0]![0].props).toBe(CTX.props);
    expect(String(update.mock.calls[0]![0].id)).toBe(WORKFLOW_ID.toString());
  });

  test("a step that stays keeps its place on the canvas", async () => {
    await run(DRAFT);

    const graph: { nodes: Array<any> } = update.mock.calls[0]![0].data.graph;

    expect(graph.nodes[0].id).toBe("node-1");
    expect(graph.nodes[0].position).toEqual({ x: 300, y: 50 });
    expect(graph.nodes).toHaveLength(2);
  });

  test("changes only what it is given", async () => {
    await run({ name: "New name" });

    expect(update.mock.calls[0]![0].data).toEqual({ name: "New name" });
  });

  test("never touches whether it is on", async () => {
    await run({ ...DRAFT, isEnabled: true });

    expect(update.mock.calls[0]![0].data.isEnabled).toBeUndefined();
  });

  test("asked from a workflow's page, it is that workflow", async () => {
    await UpdateWorkflowTool.execute(
      { name: "New name" },
      {
        ...CTX,
        pageContext: {
          type: AIChatPageContextType.Workflow,
          entityId: WORKFLOW_ID.toString(),
        },
      },
    );

    expect(String(update.mock.calls[0]![0].id)).toBe(WORKFLOW_ID.toString());
  });

  test("a page about something else is not a workflow", async () => {
    await expect(
      UpdateWorkflowTool.execute(
        { name: "New name" },
        {
          ...CTX,
          pageContext: {
            type: AIChatPageContextType.Incident,
            entityId: WORKFLOW_ID.toString(),
          },
        },
      ),
    ).rejects.toThrow("workflowId is required");
  });

  test("a workflow the person cannot read is refused, with nothing written", async () => {
    read.mockResolvedValue(null);

    await expect(run(DRAFT)).rejects.toThrow("can read");
    expect(update.mock.calls).toHaveLength(0);
  });

  test("an archived workflow is refused, saying what to do", async () => {
    read.mockResolvedValue(storedWorkflow({ isArchived: true }));

    await expect(run(DRAFT)).rejects.toThrow("archived");
    expect(update.mock.calls).toHaveLength(0);
  });

  test("nothing to change is said, not written", async () => {
    await expect(run({})).rejects.toThrow("Nothing to change");
    expect(update.mock.calls).toHaveLength(0);
  });

  test("a draft with something wrong is refused, with nothing written", async () => {
    await expect(
      run({
        steps: [{ id: "a", componentId: "no-such-thing" }],
        connections: [],
      }),
    ).rejects.toThrow("no-such-thing");
    expect(update.mock.calls).toHaveLength(0);
  });

  test("says when its next run uses the change", async () => {
    read.mockResolvedValue(storedWorkflow({ isEnabled: true }));

    expect((await run(DRAFT)).dataForLlm).toContain("next run");
  });

  test("says when it is still off", async () => {
    expect((await run(DRAFT)).dataForLlm).toContain("turned off");
  });

  describe("the approval card", () => {
    type EnglishFunction = (sentence: AIActionSentence) => string;

    const english: EnglishFunction = (sentence: AIActionSentence): string => {
      return describeAIActionSentence(sentence);
    };

    test("names the workflow by its name, read as the person", async () => {
      const prepared: PreparedMutation =
        await UpdateWorkflowTool.prepareMutation!(
          { workflowId: WORKFLOW_ID.toString(), ...DRAFT },
          CTX,
        );

      expect(english(prepared.title as AIActionSentence)).toBe(
        "Update workflow Tickets",
      );
      expect(read.mock.calls[0]![0].props).toBe(CTX.props);
    });

    test("says what the change does to the steps", async () => {
      const prepared: PreparedMutation =
        await UpdateWorkflowTool.prepareMutation!(
          { workflowId: WORKFLOW_ID.toString(), ...DRAFT },
          CTX,
        );

      expect((prepared.description || []).map(english).join(" ")).toContain(
        "Adds Log",
      );
    });

    test("says a workflow that is on takes it at its next run", async () => {
      read.mockResolvedValue(storedWorkflow({ isEnabled: true }));

      const prepared: PreparedMutation =
        await UpdateWorkflowTool.prepareMutation!(
          { workflowId: WORKFLOW_ID.toString(), name: "x" },
          CTX,
        );

      expect((prepared.description || []).map(english).join(" ")).toContain(
        "next run uses the change",
      );
    });

    test("writes out the workflow on screen, so the person approves what runs", async () => {
      const prepared: PreparedMutation =
        await UpdateWorkflowTool.prepareMutation!(
          { name: "x" },
          {
            ...CTX,
            pageContext: {
              type: AIChatPageContextType.Workflow,
              entityId: WORKFLOW_ID.toString(),
            },
          },
        );

      expect(prepared.arguments["workflowId"]).toBe(WORKFLOW_ID.toString());
    });

    test("a setting read back hidden is no change", async () => {
      read.mockResolvedValue(
        storedWorkflow({
          graph: {
            nodes: [
              {
                id: "node-1",
                position: { x: 0, y: 0 },
                data: {
                  id: "webhook-1",
                  nodeType: "Node",
                  componentType: ComponentType.Trigger,
                  metadataId: ComponentID.Webhook,
                  arguments: {},
                },
              },
              {
                id: "node-2",
                position: { x: 0, y: 220 },
                data: {
                  id: "log-1",
                  nodeType: "Node",
                  componentType: ComponentType.Component,
                  metadataId: ComponentID.Log,
                  arguments: { value: "from 10.0.0.1" },
                },
              },
            ],
            edges: [],
          } as unknown as JSONObject,
        }),
      );

      const prepared: PreparedMutation =
        await UpdateWorkflowTool.prepareMutation!(
          {
            workflowId: WORKFLOW_ID.toString(),
            steps: [
              { id: "webhook-1", componentId: ComponentID.Webhook },
              {
                id: "log-1",
                componentId: ComponentID.Log,
                arguments: { value: "from [redacted-ip]" },
              },
            ],
            connections: [{ from: "webhook-1", to: "log-1" }],
          },
          CTX,
        );

      expect((prepared.description || []).map(english).join(" ")).not.toContain(
        "Changes",
      );
    });

    test("a draft that cannot be saved says nothing of its changes, and does not throw", async () => {
      const prepared: PreparedMutation =
        await UpdateWorkflowTool.prepareMutation!(
          {
            workflowId: WORKFLOW_ID.toString(),
            steps: [{ id: "a", componentId: "no-such-thing" }],
            connections: [],
          },
          CTX,
        );

      expect(prepared.description).toEqual([]);
    });

    test("a workflow it cannot read leaves the plain title, and does not throw", async () => {
      (
        read as unknown as { mockRejectedValue: (e: Error) => void }
      ).mockRejectedValue(new Error("Not allowed"));

      const prepared: PreparedMutation =
        await UpdateWorkflowTool.prepareMutation!(
          { workflowId: WORKFLOW_ID.toString(), name: "x" },
          CTX,
        );

      expect(prepared.title).toBeUndefined();
      expect(english(UpdateWorkflowTool.buildActionTitle!({ name: "x" }))).toBe(
        "Update workflow",
      );
    });
  });
});

describe("query_workflows, with includeSteps", () => {
  beforeEach(() => {
    jest
      .spyOn(WorkflowLogService as never, "findBy")
      .mockResolvedValue([] as never);
  });

  test("gives the steps as update_workflow takes them", async () => {
    const read: RecordedSpy = jest
      .spyOn(WorkflowService as never, "findOneById")
      .mockResolvedValue(storedWorkflow() as never) as unknown as RecordedSpy;

    const text: string = (
      await (QueryWorkflowsTool as ObservabilityTool).execute(
        { workflowId: WORKFLOW_ID.toString(), includeSteps: true },
        CTX,
      )
    ).dataForLlm;

    expect(read.mock.calls[0]![0].select.graph).toBe(true);
    expect(text).toContain("webhook-1");
  });

  test("gives them whole, however long: a draft cut short would remove the rest", async () => {
    const nodes: Array<JSONObject> = Array.from(
      { length: 60 },
      (_: unknown, i: number): JSONObject => {
        return {
          id: `n${i}`,
          data: {
            id: `step-${i}`,
            nodeType: "Node",
            metadataId: ComponentID.Log,
            arguments: { value: "a line of text that takes some room" },
          },
        };
      },
    ) as unknown as Array<JSONObject>;

    jest.spyOn(WorkflowService as never, "findOneById").mockResolvedValue(
      storedWorkflow({
        graph: { nodes: nodes, edges: [] } as unknown as JSONObject,
      }) as never,
    );

    const text: string = (
      await (QueryWorkflowsTool as ObservabilityTool).execute(
        { workflowId: WORKFLOW_ID.toString(), includeSteps: true },
        CTX,
      )
    ).dataForLlm;

    expect(text).toContain("step-59");
    expect(text).not.toContain("[truncated]");
  });

  test("one too long to read whole is not read at all, saying where to change it", async () => {
    jest.spyOn(WorkflowService as never, "findOneById").mockResolvedValue(
      storedWorkflow({
        graph: {
          nodes: [
            {
              id: "n",
              data: {
                id: "big",
                nodeType: "Node",
                metadataId: ComponentID.Log,
                arguments: { value: "x y ".repeat(20000) },
              },
            },
          ],
          edges: [],
        } as unknown as JSONObject,
      }) as never,
    );

    const text: string = (
      await (QueryWorkflowsTool as ObservabilityTool).execute(
        { workflowId: WORKFLOW_ID.toString(), includeSteps: true },
        CTX,
      )
    ).dataForLlm;

    expect(text).toContain("change them in its Builder");
    expect(text).not.toContain("x y x y");
  });

  test("what looks like a secret in a setting is redacted before it reaches the model", async () => {
    jest.spyOn(WorkflowService as never, "findOneById").mockResolvedValue(
      storedWorkflow({
        graph: {
          nodes: [
            {
              id: "n",
              data: {
                id: "log-1",
                nodeType: "Node",
                metadataId: ComponentID.Log,
                arguments: { value: "from 203.0.113.7" },
              },
            },
          ],
          edges: [],
        } as unknown as JSONObject,
      }) as never,
    );

    const result: ToolExecutionResult = await (
      QueryWorkflowsTool as ObservabilityTool
    ).execute({ workflowId: WORKFLOW_ID.toString(), includeSteps: true }, CTX);

    expect(result.dataForLlm).not.toContain("203.0.113.7");
    expect(result.redactionCount).toBeGreaterThan(0);
  });

  test("does not read the graph unless asked", async () => {
    const read: RecordedSpy = jest
      .spyOn(WorkflowService as never, "findOneById")
      .mockResolvedValue(storedWorkflow() as never) as unknown as RecordedSpy;

    await (QueryWorkflowsTool as ObservabilityTool).execute(
      { workflowId: WORKFLOW_ID.toString() },
      CTX,
    );

    expect(read.mock.calls[0]![0].select.graph).toBeUndefined();
  });

  test("never gives a saved secret", async () => {
    const withSecret: ComponentMetadata = BuiltInComponents.find(
      (component: ComponentMetadata): boolean => {
        return component.arguments.some((argument: Argument): boolean => {
          return argument.type === ComponentInputType.Password;
        });
      },
    ) as ComponentMetadata;
    const secret: Argument = withSecret.arguments.find(
      (argument: Argument): boolean => {
        return argument.type === ComponentInputType.Password;
      },
    ) as Argument;

    jest.spyOn(WorkflowService as never, "findOneById").mockResolvedValue(
      storedWorkflow({
        graph: {
          nodes: [
            {
              id: "n",
              data: {
                id: "with-secret",
                nodeType: "Node",
                metadataId: withSecret.id,
                arguments: { [secret.id]: "s3cret-value" },
              },
            },
          ],
          edges: [],
        } as unknown as JSONObject,
      }) as never,
    );

    const text: string = (
      await (QueryWorkflowsTool as ObservabilityTool).execute(
        { workflowId: WORKFLOW_ID.toString(), includeSteps: true },
        CTX,
      )
    ).dataForLlm;

    expect(text).toContain("with-secret");
    expect(text).not.toContain("s3cret-value");
    expect(text).toContain(HIDDEN_SECRET_VALUE);
  });
});
