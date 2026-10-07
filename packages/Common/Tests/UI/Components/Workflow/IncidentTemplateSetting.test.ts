/*
 * Create One Incident's Incident Template setting, as the workflow builder
 * reads it.
 *
 * A step that declares an incident from a template names the template under
 * its own setting, picked from the project's templates; with one picked, its
 * JSON Object only holds what should differ from the template, and may be
 * left empty. The workflow's checks, the settings form and the list the
 * setting offers all agree on that.
 */

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentTemplate from "../../../../Models/DatabaseModels/IncidentTemplate";
import Label from "../../../../Models/DatabaseModels/Label";
import Workflow from "../../../../Models/DatabaseModels/Workflow";
import { DropdownOption } from "../../../../UI/Components/Dropdown/Dropdown";
import {
  LintGraphNode,
  WorkflowLintIssue,
  WorkflowLintResult,
  WorkflowLintRule,
  lintWorkflowGraph,
} from "../../../../UI/Components/Workflow/GraphLint";
import {
  getRecordChoiceSource,
  getRecordChoiceTypes,
  loadRecordChoices,
  RecordChoiceSource,
} from "../../../../UI/Components/Workflow/RecordChoices";
import ModelAPI from "../../../../UI/Utils/ModelAPI/ModelAPI";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  NodeType,
  isArgumentRequired,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import Components from "../../../../Types/Workflow/Components";
import BaseModelComponents from "../../../../Types/Workflow/Components/BaseModel";
import { INCIDENT_TEMPLATE_ARGUMENT_ID } from "../../../../Types/Workflow/CreateFromTemplate";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

const TEMPLATE_ID: string = "7c000000-0000-4000-8000-0000000000a1";
const WORKFLOW_ID: string = "7c000000-0000-4000-8000-0000000000f1";

const CREATE_ONE_INCIDENT: ComponentMetadata =
  BaseModelComponents.getComponents(new Incident()).find(
    (component: ComponentMetadata): boolean => {
      return component.id === "incident-create-one";
    },
  )!;

const CREATE_ONE_LABEL: ComponentMetadata = BaseModelComponents.getComponents(
  new Label(),
).find((component: ComponentMetadata): boolean => {
  return component.id === "label-create-one";
})!;

const MANUAL: ComponentMetadata = Components.find(
  (component: ComponentMetadata): boolean => {
    return component.id === ComponentID.Manual;
  },
)!;

function argumentOf(metadata: ComponentMetadata, id: string): Argument {
  return metadata.arguments.find((argument: Argument): boolean => {
    return argument.id === id;
  })!;
}

const JSON_OBJECT: Argument = argumentOf(CREATE_ONE_INCIDENT, "json");

type GetListMock = jest.Mock<(args: JSONObject) => Promise<JSONObject>>;

const getList: GetListMock = ModelAPI.getList as unknown as GetListMock;

afterEach(() => {
  getList.mockReset();
});

describe("Create One Incident's settings", () => {
  test("the Incident Template comes first, a choice from the project's templates, never required", () => {
    expect(
      CREATE_ONE_INCIDENT.arguments.map((argument: Argument): string => {
        return argument.id;
      }),
    ).toEqual([INCIDENT_TEMPLATE_ARGUMENT_ID, "json"]);

    const setting: Argument = argumentOf(
      CREATE_ONE_INCIDENT,
      INCIDENT_TEMPLATE_ARGUMENT_ID,
    );

    expect(setting.name).toBe("Incident Template");
    expect(setting.type).toBe(ComponentInputType.IncidentTemplateSelect);
    expect(setting.required).toBe(false);
    expect(setting.description).toContain(
      "Anything you set in JSON Object wins",
    );
  });

  test("JSON Object says what it holds once a template is picked", () => {
    expect(JSON_OBJECT.required).toBe(true);
    expect(JSON_OBJECT.notRequiredWhen).toEqual({
      argumentId: INCIDENT_TEMPLATE_ARGUMENT_ID,
    });
    expect(JSON_OBJECT.description).toContain(
      "With a template picked, only what should differ from it.",
    );
  });

  test("a record with no templates keeps the one JSON Object setting, required", () => {
    expect(
      CREATE_ONE_LABEL.arguments.map((argument: Argument): string => {
        return argument.id;
      }),
    ).toEqual(["json"]);
    expect(
      argumentOf(CREATE_ONE_LABEL, "json").notRequiredWhen,
    ).toBeUndefined();
    expect(argumentOf(CREATE_ONE_LABEL, "json").description).not.toContain(
      "template",
    );
  });

  test("Create Many Incident has no template setting", () => {
    const createMany: ComponentMetadata = BaseModelComponents.getComponents(
      new Incident(),
    ).find((component: ComponentMetadata): boolean => {
      return component.id === "incident-create-many";
    })!;

    expect(
      createMany.arguments.map((argument: Argument): string => {
        return argument.id;
      }),
    ).toEqual(["json-array"]);
  });
});

describe("JSON Object is required until a template is picked", () => {
  test.each([
    ["no template setting", {}],
    ["an empty one", { [INCIDENT_TEMPLATE_ARGUMENT_ID]: "" }],
    ["one of spaces", { [INCIDENT_TEMPLATE_ARGUMENT_ID]: "   " }],
    ["one that is not text", { [INCIDENT_TEMPLATE_ARGUMENT_ID]: 7 }],
  ] as Array<[string, JSONObject]>)(
    "%s: required",
    (_case: string, values: JSONObject) => {
      expect(isArgumentRequired(JSON_OBJECT, values)).toBe(true);
    },
  );

  test.each([
    ["a template", { [INCIDENT_TEMPLATE_ARGUMENT_ID]: TEMPLATE_ID }],
    [
      "a template from an earlier step's value",
      {
        [INCIDENT_TEMPLATE_ARGUMENT_ID]:
          "{{local.components.find-1.returnValues.model._id}}",
      },
    ],
  ] as Array<[string, JSONObject]>)(
    "%s: optional",
    (_case: string, values: JSONObject) => {
      expect(isArgumentRequired(JSON_OBJECT, values)).toBe(false);
    },
  );

  test("a rule with values still lifts it only for those values", () => {
    const conditional: Argument = {
      ...JSON_OBJECT,
      notRequiredWhen: { argumentId: "operator", values: ["is empty"] },
    };

    expect(isArgumentRequired(conditional, { operator: "is empty" })).toBe(
      false,
    );
    expect(isArgumentRequired(conditional, { operator: "==" })).toBe(true);
  });
});

describe("the workflow's checks agree", () => {
  function missing(args: JSONObject): Array<string> {
    const node: (
      id: string,
      metadata: ComponentMetadata,
      nodeArgs: JSONObject,
    ) => LintGraphNode = (
      id: string,
      metadata: ComponentMetadata,
      nodeArgs: JSONObject,
    ): LintGraphNode => {
      return {
        id: id,
        data: {
          error: "",
          id: `${metadata.id}-1`,
          nodeType: NodeType.Node,
          metadata: metadata,
          metadataId: metadata.id,
          internalId: `${id}-internal`,
          arguments: nodeArgs,
          returnValues: {},
          componentType: metadata.componentType,
        },
      };
    };

    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [node("n1", MANUAL, {}), node("n2", CREATE_ONE_INCIDENT, args)],
      edges: [{ source: "n1", target: "n2" }],
    });

    return result.issues
      .filter((issue: WorkflowLintIssue): boolean => {
        return issue.rule === WorkflowLintRule.MissingRequiredArgument;
      })
      .map((issue: WorkflowLintIssue): string => {
        return issue.message;
      });
  }

  test("a step with neither a template nor a JSON Object is not set up", () => {
    expect(missing({})).toEqual(['"JSON Object" is required but empty.']);
  });

  test("a step with a template and no JSON Object is", () => {
    expect(missing({ [INCIDENT_TEMPLATE_ARGUMENT_ID]: TEMPLATE_ID })).toEqual(
      [],
    );
  });

  test("so is one with a JSON Object and no template, as before", () => {
    expect(missing({ json: { title: "Checkout is down" } })).toEqual([]);
  });
});

describe("the list a setting picked from the project's records offers", () => {
  test("Incident Template lists the project's incident templates by name", () => {
    const source: RecordChoiceSource | null = getRecordChoiceSource(
      ComponentInputType.IncidentTemplateSelect,
    );

    expect(source?.modelType).toBe(IncidentTemplate);
    expect(source?.labelColumn).toBe("templateName");
    expect(source?.excludesCurrentWorkflow).toBe(false);
  });

  test("Workflow lists the project's workflows, leaving out the one being edited", () => {
    const source: RecordChoiceSource | null = getRecordChoiceSource(
      ComponentInputType.WorkflowSelect,
    );

    expect(source?.modelType).toBe(Workflow);
    expect(source?.labelColumn).toBe("name");
    expect(source?.excludesCurrentWorkflow).toBe(true);
  });

  test("no other setting is a list of records", () => {
    for (const type of Object.values(ComponentInputType)) {
      if (
        type === ComponentInputType.IncidentTemplateSelect ||
        type === ComponentInputType.WorkflowSelect
      ) {
        continue;
      }

      expect({ type, source: getRecordChoiceSource(type) }).toEqual({
        type,
        source: null,
      });
    }
  });

  test("a step's list settings, each once, in their order", () => {
    expect(getRecordChoiceTypes(CREATE_ONE_INCIDENT.arguments)).toEqual([
      ComponentInputType.IncidentTemplateSelect,
    ]);
    expect(getRecordChoiceTypes(CREATE_ONE_LABEL.arguments)).toEqual([]);
    expect(getRecordChoiceTypes(undefined)).toEqual([]);
  });

  test("the templates come from the API by name, each offered as its ID; an unnamed one by its ID", async () => {
    const named: IncidentTemplate = new IncidentTemplate();
    named._id = TEMPLATE_ID;
    named.templateName = "Checkout degraded";

    const unnamed: IncidentTemplate = new IncidentTemplate();
    unnamed._id = "7c000000-0000-4000-8000-0000000000a2";

    getList.mockResolvedValue({
      data: [named, unnamed],
      count: 2,
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    } as never);

    const options: Array<DropdownOption> = await loadRecordChoices({
      type: ComponentInputType.IncidentTemplateSelect,
      workflowId: new ObjectID(WORKFLOW_ID),
    });

    expect(options).toEqual([
      { label: "Checkout degraded", value: TEMPLATE_ID },
      {
        label: "7c000000-0000-4000-8000-0000000000a2",
        value: "7c000000-0000-4000-8000-0000000000a2",
      },
    ]);

    const request: JSONObject = getList.mock.calls[0]![0];

    expect(request["modelType"]).toBe(IncidentTemplate);
    expect(request["select"]).toEqual({ _id: true, templateName: true });
    expect(request["sort"]).toEqual({ templateName: SortOrder.Ascending });
    expect(request["limit"]).toBe(LIMIT_PER_PROJECT);
  });

  test("the workflow list leaves out the workflow being edited", async () => {
    const self: Workflow = new Workflow();
    self._id = WORKFLOW_ID;
    self.name = "This one";

    const other: Workflow = new Workflow();
    other._id = "7c000000-0000-4000-8000-0000000000f2";
    other.name = "Escalate to on-call";

    getList.mockResolvedValue({
      data: [self, other],
      count: 2,
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    } as never);

    expect(
      await loadRecordChoices({
        type: ComponentInputType.WorkflowSelect,
        workflowId: new ObjectID(WORKFLOW_ID),
      }),
    ).toEqual([
      {
        label: "Escalate to on-call",
        value: "7c000000-0000-4000-8000-0000000000f2",
      },
    ]);
  });

  test("a setting that lists no records asks the API for nothing", async () => {
    expect(
      await loadRecordChoices({
        type: ComponentInputType.Text,
        workflowId: new ObjectID(WORKFLOW_ID),
      }),
    ).toEqual([]);
    expect(getList).not.toHaveBeenCalled();
  });
});
