/*
 * The steps before this one, as the picker lists them: by their names, each
 * value with its name, what it holds and its shape - and a record opening to
 * its fields, the ones the step reads first.
 *
 * Built from the real component definitions, so a renamed return value
 * shows up here.
 */

jest.mock("../../../../../Models/DatabaseModels/Index", () => {
  return { __esModule: true, default: [] };
});

import {
  NOT_SELECTED_BADGE,
  STEP_VALUE_SOURCE_ID,
  buildStepValueGroups,
  createStepValueSource,
  recordFieldSuggestions,
  selectedColumnIds,
  stepGroupId,
} from "../../../../../UI/Components/Workflow/ValuePicker/StepValueSource";
import {
  ValueSuggestion,
  ValueSuggestionGroup,
  ValueSuggestionGroupKind,
  ValueSuggestionSource,
} from "../../../../../UI/Components/Workflow/ValuePicker/ValueSuggestion";
import { ModelSchemaColumn } from "../../../../../UI/Components/Workflow/ModelSchema";
import ComponentMetadata, {
  ComponentInputType,
  NodeDataProp,
  NodeType,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components from "../../../../../Types/Workflow/Components";
import BaseModelComponentFactory from "../../../../../Types/Workflow/Components/BaseModel";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import { JSONObject } from "../../../../../Types/JSON";
import { describe, expect, jest, test } from "@jest/globals";

type MetadataFunction = (id: string) => ComponentMetadata;

const INCIDENT_COMPONENTS: Array<ComponentMetadata> =
  BaseModelComponentFactory.getComponents(new Incident());

const metadataOf: MetadataFunction = (id: string): ComponentMetadata => {
  const metadata: ComponentMetadata | undefined = [
    ...Components,
    ...INCIDENT_COMPONENTS,
  ].find((component: ComponentMetadata) => {
    return component.id === id;
  });

  if (!metadata) {
    throw new Error(`No component ${id}`);
  }

  return metadata;
};

type StepFunction = (
  metadataId: string,
  id: string,
  args?: JSONObject,
) => NodeDataProp;

const step: StepFunction = (
  metadataId: string,
  id: string,
  args: JSONObject = {},
): NodeDataProp => {
  const metadata: ComponentMetadata = metadataOf(metadataId);

  return {
    error: "",
    id: id,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `${id}-internal`,
    arguments: args,
    returnValues: {},
    componentType: metadata.componentType,
  };
};

const webhook: NodeDataProp = step(ComponentID.Webhook, "webhook-1");
const apiPost: NodeDataProp = step(ComponentID.ApiPost, "api-post-1");
const log: NodeDataProp = step(ComponentID.Log, "log-1");

const COLUMNS: Array<ModelSchemaColumn> = [
  { id: "_id", title: "ID", type: "Object ID", isRelation: false },
  {
    id: "title",
    title: "Title",
    description: "The incident's title",
    type: "Text",
    isRelation: false,
  },
  {
    id: "description",
    title: "Description",
    description: "Description",
    type: "Long Text",
    isRelation: false,
  },
  { id: "project", title: "Project", type: "Entity", isRelation: true },
];

describe("buildStepValueGroups", () => {
  test("one group per step, named by the step, holding its return values", () => {
    const groups: Array<ValueSuggestionGroup> = buildStepValueGroups({
      upstreamComponents: [webhook, apiPost],
    });

    expect(
      groups.map((group: ValueSuggestionGroup) => {
        return [group.id, group.title, group.subtitle, group.kind];
      }),
    ).toEqual([
      [
        stepGroupId("webhook-1"),
        "Webhook",
        "webhook-1",
        ValueSuggestionGroupKind.Step,
      ],
      [
        stepGroupId("api-post-1"),
        apiPost.metadata.title,
        "api-post-1",
        ValueSuggestionGroupKind.Step,
      ],
    ]);

    const body: ValueSuggestion = groups[0]!.items.find(
      (item: ValueSuggestion) => {
        return item.label === "Request Body";
      },
    )!;

    expect(body.reference).toBe(
      "{{local.components.webhook-1.returnValues.request-body}}",
    );
    expect(body.typeLabel).toBe("JSON");
    expect(body.description).toBeTruthy();
  });

  test("the run order it is given is kept", () => {
    expect(
      buildStepValueGroups({ upstreamComponents: [apiPost, webhook] }).map(
        (group: ValueSuggestionGroup) => {
          return group.order;
        },
      ),
    ).toEqual([0, 1]);
  });

  test("a step that returns nothing is not listed", () => {
    expect(
      buildStepValueGroups({ upstreamComponents: [webhook, log] }).map(
        (group: ValueSuggestionGroup) => {
          return group.subtitle;
        },
      ),
    ).toEqual(["webhook-1"]);
  });

  test("the step being edited never offers its own values", () => {
    expect(
      buildStepValueGroups({
        component: apiPost,
        upstreamComponents: [webhook, apiPost],
      }).map((group: ValueSuggestionGroup) => {
        return group.subtitle;
      }),
    ).toEqual(["webhook-1"]);
  });

  test("a JSON value can be opened to type a path, a number cannot", () => {
    const items: Array<ValueSuggestion> = buildStepValueGroups({
      upstreamComponents: [apiPost],
    })[0]!.items;

    const body: ValueSuggestion = items.find((item: ValueSuggestion) => {
      return item.label === "Response Body";
    })!;
    const status: ValueSuggestion = items.find((item: ValueSuggestion) => {
      return item.label === "Response Status";
    })!;

    expect(body.drillIn?.allowsPath).toBe(true);
    expect(body.drillIn?.loadChildren).toBeUndefined();
    expect(body.drillIn?.wholeValueLabel).toBe("The whole Response Body");
    expect(status.drillIn).toBeUndefined();
  });

  test("headers offer a header name as the example path", () => {
    const headers: ValueSuggestion = buildStepValueGroups({
      upstreamComponents: [webhook],
    })[0]!.items.find((item: ValueSuggestion) => {
      return item.label === "Request Headers";
    })!;

    expect(headers.drillIn?.pathPlaceholder).toBe("e.g. content-type");
  });

  test("a record opens to its fields, loaded from the model", async () => {
    const onCreate: NodeDataProp = step(
      "incident-on-create",
      "incident-on-create-1",
      { select: '{"_id": true, "title": true}' },
    );
    const loadRecordColumns: jest.Mock<
      (tableName: string) => Promise<Array<ModelSchemaColumn>>
    > = jest.fn(async (_tableName: string) => {
      return COLUMNS;
    });

    const model: ValueSuggestion = buildStepValueGroups(
      { upstreamComponents: [onCreate] },
      { loadRecordColumns },
    )[0]!.items[0]!;

    expect(model.label).toBe("Incident");
    expect(model.typeLabel).toBe("Record");
    expect(model.drillIn?.wholeValueLabel).toBe("The whole Incident");

    const fields: Array<ValueSuggestion> = await model.drillIn!.loadChildren!();

    expect(loadRecordColumns).toHaveBeenCalledWith("Incident");
    expect(
      fields.map((field: ValueSuggestion) => {
        return field.label;
      }),
    ).toEqual(["ID", "Title", "Description"]);
    expect(fields[1]!.reference).toBe(
      "{{local.components.incident-on-create-1.returnValues.model.title}}",
    );
  });

  test("without a loader a record can still be opened to a typed path", () => {
    const onCreate: NodeDataProp = step(
      "incident-on-create",
      "incident-on-create-1",
    );

    const model: ValueSuggestion = buildStepValueGroups({
      upstreamComponents: [onCreate],
    })[0]!.items[0]!;

    expect(model.drillIn?.loadChildren).toBeUndefined();
    expect(model.drillIn?.allowsPath).toBe(true);
  });

  test("the source wraps the builder, under its own id", () => {
    const source: ValueSuggestionSource = createStepValueSource();

    expect(source.id).toBe(STEP_VALUE_SOURCE_ID);
    expect(source.getGroups!({ upstreamComponents: [webhook] })).toHaveLength(
      1,
    );
  });
});

describe("the fields a database step reads", () => {
  test("Select Fields, stored as JSON text or as an object", () => {
    expect(
      selectedColumnIds(
        step("incident-find-one", "find-1", {
          select: '{"_id": true, "title": true, "description": false}',
        }),
      ),
    ).toEqual(["_id", "title"]);

    expect(
      selectedColumnIds(
        step("incident-find-one", "find-1", {
          select: { title: true },
        }),
      ),
    ).toEqual(["title"]);
  });

  test("an On Delete trigger is only ever given the ID", () => {
    expect(
      selectedColumnIds(step("incident-on-delete", "on-delete-1")),
    ).toEqual(["_id"]);
  });

  test("nothing selected, unreadable, or no such setting: unknown", () => {
    expect(selectedColumnIds(step("incident-find-one", "find-1"))).toBeNull();
    expect(
      selectedColumnIds(step("incident-find-one", "find-1", { select: "{" })),
    ).toBeNull();
    expect(
      selectedColumnIds(step("incident-find-one", "find-1", { select: "{}" })),
    ).toBeNull();
    expect(selectedColumnIds(webhook)).toBeNull();
  });

  test("the fields it reads come first; the others say they will be empty", () => {
    const find: NodeDataProp = step("incident-find-one", "find-1", {
      select: '{"description": true}',
    });

    const fields: Array<ValueSuggestion> = recordFieldSuggestions({
      component: find,
      returnValue: find.metadata.returnValues[0]!,
      columns: COLUMNS,
    });

    expect(
      fields.map((field: ValueSuggestion) => {
        return [field.label, field.badges || []];
      }),
    ).toEqual([
      ["Description", []],
      ["ID", [NOT_SELECTED_BADGE]],
      ["Title", [NOT_SELECTED_BADGE]],
    ]);
    expect(fields[1]!.description).toMatch(/empty/);
  });

  test("a description that only repeats the title is left out", () => {
    const fields: Array<ValueSuggestion> = recordFieldSuggestions({
      component: step("incident-find-one", "find-1"),
      returnValue: { ...metadataOf("incident-find-one").returnValues[0]! },
      columns: COLUMNS,
    });

    expect(
      fields.find((field: ValueSuggestion) => {
        return field.label === "Title";
      })?.description,
    ).toBe("The incident's title");
    expect(
      fields.find((field: ValueSuggestion) => {
        return field.label === "Description";
      })?.description,
    ).toBeUndefined();
  });

  test("a relation is not offered: its ID column is", () => {
    const fields: Array<ValueSuggestion> = recordFieldSuggestions({
      component: step("incident-find-one", "find-1"),
      returnValue: metadataOf("incident-find-one").returnValues[0]!,
      columns: COLUMNS,
    });

    expect(
      fields.some((field: ValueSuggestion) => {
        return field.label === "Project";
      }),
    ).toBe(false);
  });

  test("the return value types it opens are the ones with an inside", () => {
    expect(metadataOf("incident-find-one").returnValues[0]!.type).toBe(
      ComponentInputType.BaseModel,
    );
  });
});
