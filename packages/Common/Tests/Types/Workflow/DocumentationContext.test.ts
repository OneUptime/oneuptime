/*
 * What a step's help is written from: its own references, the other steps in
 * the workflow, the value an example borrows from one of them, and the step
 * that hands on a record of a table (DocumentationContext).
 */

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IconProp from "../../../Types/Icon/IconProp";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
  NodeDataProp,
  NodeType,
  ReturnValue,
} from "../../../Types/Workflow/Component";
import ComponentID from "../../../Types/Workflow/ComponentID";
import {
  ComponentDocumentationContext,
  SampleValue,
  findRecordStep,
  getSampleValue,
  otherSteps,
  ownReference,
} from "../../../Types/Workflow/Documentation/DocumentationContext";
import {
  ExampleColumn,
  getDisplayColumn,
  getWorkflowModel,
} from "../../../Types/Workflow/Documentation/ModelExamples";
import { describe, expect, test } from "@jest/globals";

type ReturnValueFunction = (id: string, name?: string) => ReturnValue;

const returnValue: ReturnValueFunction = (
  id: string,
  name?: string,
): ReturnValue => {
  return {
    id: id,
    name: name || id,
    description: "",
    type: ComponentInputType.Text,
    required: false,
  };
};

type MetadataFunction = (data: {
  id: string;
  componentType?: ComponentType | undefined;
  returnValues?: Array<ReturnValue> | undefined;
  tableName?: string | undefined;
}) => ComponentMetadata;

const metadata: MetadataFunction = (data: {
  id: string;
  componentType?: ComponentType | undefined;
  returnValues?: Array<ReturnValue> | undefined;
  tableName?: string | undefined;
}): ComponentMetadata => {
  const result: ComponentMetadata = {
    id: data.id,
    title: data.id,
    category: "Test",
    description: "",
    iconProp: IconProp.Bolt,
    componentType: data.componentType || ComponentType.Component,
    arguments: [],
    returnValues: data.returnValues || [],
    inPorts: [],
    outPorts: [],
  };

  if (data.tableName) {
    result.tableName = data.tableName;
  }

  return result;
};

type StepFunction = (
  id: string,
  stepMetadata: ComponentMetadata,
  nodeType?: NodeType,
) => NodeDataProp;

const step: StepFunction = (
  id: string,
  stepMetadata: ComponentMetadata,
  nodeType: NodeType = NodeType.Node,
): NodeDataProp => {
  return {
    error: "",
    id: id,
    nodeType: nodeType,
    metadata: stepMetadata,
    metadataId: stepMetadata.id,
    internalId: `internal-${id}`,
    arguments: {},
    returnValues: {},
    componentType: stepMetadata.componentType,
  };
};

type ContextFunction = (
  stepId: string,
  graphComponents: Array<NodeDataProp>,
) => ComponentDocumentationContext;

const context: ContextFunction = (
  stepId: string,
  graphComponents: Array<NodeDataProp>,
): ComponentDocumentationContext => {
  return {
    metadata: metadata({ id: ComponentID.Log }),
    stepId: stepId,
    graphComponents: graphComponents,
  };
};

const self: NodeDataProp = step(
  "log-1",
  metadata({ id: ComponentID.Log, returnValues: [returnValue("output")] }),
);

describe("ownReference", () => {
  test("refers to one of this step's own return values", () => {
    expect(ownReference(context("slack-1", []), "error")).toBe(
      "{{local.components.slack-1.returnValues.error}}",
    );
  });

  test("goes deeper along a path", () => {
    expect(
      ownReference(context("api-get-1", []), "response-body", ["data", "id"]),
    ).toBe("{{local.components.api-get-1.returnValues.response-body.data.id}}");
  });

  test("an empty path is the value itself", () => {
    expect(ownReference(context("x", []), "value", [])).toBe(
      "{{local.components.x.returnValues.value}}",
    );
  });
});

describe("otherSteps", () => {
  test("leaves out this step and placeholders", () => {
    const other: NodeDataProp = step(
      "js-1",
      metadata({ id: ComponentID.JavaScriptCode }),
    );
    const placeholder: NodeDataProp = step(
      "placeholder",
      metadata({ id: ComponentID.Log }),
      NodeType.PlaceholderNode,
    );

    expect(
      otherSteps(context("log-1", [self, other, placeholder])).map(
        (node: NodeDataProp): string => {
          return node.id;
        },
      ),
    ).toEqual(["js-1"]);
  });

  test("skips steps with no metadata and empty entries", () => {
    const broken: NodeDataProp = {
      ...step("broken", metadata({ id: ComponentID.Log })),
      metadata: undefined as unknown as ComponentMetadata,
    };

    expect(
      otherSteps(
        context("log-1", [broken, null as unknown as NodeDataProp, self]),
      ),
    ).toEqual([]);
  });

  test("a workflow with no graph has no other steps", () => {
    expect(
      otherSteps({
        metadata: metadata({ id: ComponentID.Log }),
        stepId: "log-1",
        graphComponents: undefined as unknown as Array<NodeDataProp>,
      }),
    ).toEqual([]);
  });

  test("keeps the workflow's order", () => {
    const a: NodeDataProp = step("a", metadata({ id: ComponentID.Log }));
    const b: NodeDataProp = step("b", metadata({ id: ComponentID.Log }));
    const c: NodeDataProp = step("c", metadata({ id: ComponentID.Log }));

    expect(
      otherSteps(context("b", [c, a, b])).map((node: NodeDataProp): string => {
        return node.id;
      }),
    ).toEqual(["c", "a"]);
  });
});

describe("getSampleValue", () => {
  test("is null when no other step returns anything", () => {
    expect(getSampleValue(context("log-1", [self]))).toBeNull();
    expect(
      getSampleValue(
        context("log-1", [
          self,
          step("manual-1", metadata({ id: ComponentID.Manual })),
        ]),
      ),
    ).toBeNull();
  });

  test("a step that returns only an error offers nothing", () => {
    expect(
      getSampleValue(
        context("log-1", [
          self,
          step(
            "x-1",
            metadata({
              id: "some-step",
              returnValues: [returnValue("error", "Error")],
            }),
          ),
        ]),
      ),
    ).toBeNull();
  });

  test("a plain step offers its first return value that is not the error", () => {
    const sample: SampleValue | null = getSampleValue(
      context("log-1", [
        self,
        step(
          "x-1",
          metadata({
            id: "some-step",
            returnValues: [
              returnValue("error", "Error"),
              returnValue("result", "Result"),
              returnValue("other", "Other"),
            ],
          }),
        ),
      ]),
    );

    expect(sample).toEqual({
      reference: "{{local.components.x-1.returnValues.result}}",
      stepId: "x-1",
      description: "the Result from `x-1`",
    });
  });

  test("an API step offers its response body, not its leading error", () => {
    const sample: SampleValue | null = getSampleValue(
      context("log-1", [
        self,
        step(
          "api-get-1",
          metadata({
            id: ComponentID.ApiGet,
            returnValues: [
              returnValue("error", "Error"),
              returnValue("response-status", "Response Status"),
              returnValue("response-body", "Response Body"),
            ],
          }),
        ),
      ]),
    );

    expect(sample).toEqual({
      reference: "{{local.components.api-get-1.returnValues.response-body}}",
      stepId: "api-get-1",
      description: "the Response Body from `api-get-1`",
    });
  });

  test("the main return value is named by its id when the step does not list it", () => {
    const sample: SampleValue | null = getSampleValue(
      context("log-1", [
        self,
        step("js-1", metadata({ id: ComponentID.JavaScriptCode })),
      ]),
    );

    expect(sample).toEqual({
      reference: "{{local.components.js-1.returnValues.returnValue}}",
      stepId: "js-1",
      description: "the returnValue from `js-1`",
    });
  });

  test("a webhook offers the message field of its request body", () => {
    const sample: SampleValue | null = getSampleValue(
      context("log-1", [
        self,
        step(
          "webhook-1",
          metadata({
            id: ComponentID.Webhook,
            componentType: ComponentType.Trigger,
            returnValues: [returnValue("request-headers")],
          }),
        ),
      ]),
    );

    expect(sample).toEqual({
      reference:
        "{{local.components.webhook-1.returnValues.request-body.message}}",
      stepId: "webhook-1",
      description: "the message field of the request body `webhook-1` received",
    });
  });

  test("the trigger comes first, wherever it sits in the workflow", () => {
    const component: NodeDataProp = step(
      "x-1",
      metadata({ id: "some-step", returnValues: [returnValue("result")] }),
    );
    const trigger: NodeDataProp = step(
      "webhook-1",
      metadata({
        id: ComponentID.Webhook,
        componentType: ComponentType.Trigger,
      }),
    );

    expect(
      getSampleValue(context("log-1", [component, self, trigger]))!.stepId,
    ).toBe("webhook-1");
  });

  test("falls through a trigger that offers nothing to the next step", () => {
    const trigger: NodeDataProp = step(
      "manual-1",
      metadata({
        id: ComponentID.Manual,
        componentType: ComponentType.Trigger,
      }),
    );
    const component: NodeDataProp = step(
      "x-1",
      metadata({ id: "some-step", returnValues: [returnValue("result")] }),
    );

    expect(getSampleValue(context("log-1", [trigger, component]))!.stepId).toBe(
      "x-1",
    );
  });

  test("never borrows from the step it documents", () => {
    const documented: NodeDataProp = step(
      "x-1",
      metadata({ id: "some-step", returnValues: [returnValue("result")] }),
    );

    expect(getSampleValue(context("x-1", [documented]))).toBeNull();
  });

  test("a database step that returns one record offers its display column", () => {
    const model: BaseModel = getWorkflowModel("Incident")!;
    const display: ExampleColumn = getDisplayColumn(model);

    const sample: SampleValue | null = getSampleValue(
      context("log-1", [
        self,
        step(
          "incident-find-one-1",
          metadata({
            id: "incident-find-one",
            tableName: "Incident",
            returnValues: [returnValue("error"), returnValue("model")],
          }),
        ),
      ]),
    );

    expect(display.id).toBe("title");
    expect(sample).toEqual({
      reference: `{{local.components.incident-find-one-1.returnValues.model.${display.id}}}`,
      stepId: "incident-find-one-1",
      description: `the ${display.title} of the ${model.singularName} from \`incident-find-one-1\``,
    });
  });

  test("a database step that returns a list offers the first record's display column", () => {
    const model: BaseModel = getWorkflowModel("Incident")!;
    const display: ExampleColumn = getDisplayColumn(model);

    const sample: SampleValue | null = getSampleValue(
      context("log-1", [
        self,
        step(
          "incident-find-many-1",
          metadata({
            id: "incident-find-many",
            tableName: "Incident",
            returnValues: [returnValue("models")],
          }),
        ),
      ]),
    );

    expect(sample).toEqual({
      reference: `{{local.components.incident-find-many-1.returnValues.models[0].${display.id}}}`,
      stepId: "incident-find-many-1",
      description: `the ${display.title} of the first ${model.singularName} from \`incident-find-many-1\``,
    });
  });

  test("a database step that returns no record offers nothing", () => {
    expect(
      getSampleValue(
        context("log-1", [
          self,
          step(
            "incident-delete-1",
            metadata({
              id: "incident-delete-one",
              tableName: "Incident",
              returnValues: [returnValue("error")],
            }),
          ),
        ]),
      ),
    ).toBeNull();
  });

  test("a table OneUptime has no model for is referred to by ID", () => {
    const sample: SampleValue | null = getSampleValue(
      context("log-1", [
        self,
        step(
          "ghost-1",
          metadata({
            id: "ghost-find-one",
            tableName: "NoSuchTable",
            returnValues: [returnValue("model")],
          }),
        ),
      ]),
    );

    expect(sample).toEqual({
      reference: "{{local.components.ghost-1.returnValues.model._id}}",
      stepId: "ghost-1",
      description: "the ID of the NoSuchTable from `ghost-1`",
    });
  });
});

describe("findRecordStep", () => {
  const findOne: NodeDataProp = step(
    "incident-find-one-1",
    metadata({
      id: "incident-find-one",
      tableName: "Incident",
      returnValues: [returnValue("model")],
    }),
  );
  const onCreate: NodeDataProp = step(
    "on-create-incident-1",
    metadata({
      id: "on-create-incident",
      tableName: "Incident",
      componentType: ComponentType.Trigger,
      returnValues: [returnValue("model")],
    }),
  );
  const findMany: NodeDataProp = step(
    "incident-find-many-1",
    metadata({
      id: "incident-find-many",
      tableName: "Incident",
      returnValues: [returnValue("models")],
    }),
  );
  const monitorFindOne: NodeDataProp = step(
    "monitor-find-one-1",
    metadata({
      id: "monitor-find-one",
      tableName: "Monitor",
      returnValues: [returnValue("model")],
    }),
  );

  test("prefers a trigger of the table over any other step", () => {
    expect(
      findRecordStep(context("log-1", [findOne, onCreate]), "Incident"),
    ).toBe(onCreate);
  });

  test("otherwise the first step of the table that returns one record", () => {
    expect(
      findRecordStep(context("log-1", [findMany, findOne]), "Incident"),
    ).toBe(findOne);
  });

  test("a step that returns only a list does not count", () => {
    expect(findRecordStep(context("log-1", [findMany]), "Incident")).toBeNull();
  });

  test("steps of another table do not count", () => {
    expect(
      findRecordStep(context("log-1", [monitorFindOne]), "Incident"),
    ).toBeNull();
    expect(
      findRecordStep(context("log-1", [findOne, monitorFindOne]), "Monitor"),
    ).toBe(monitorFindOne);
  });

  test("the documented step itself does not count", () => {
    expect(
      findRecordStep(context("incident-find-one-1", [findOne]), "Incident"),
    ).toBeNull();
  });

  test("an empty workflow has no record step", () => {
    expect(findRecordStep(context("log-1", []), "Incident")).toBeNull();
  });
});
