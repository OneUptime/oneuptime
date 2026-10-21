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
import type { Mock } from "jest-mock";

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
    const loadRecordColumns: Mock<
      (tableName: string) => Promise<Array<ModelSchemaColumn>>
    > = jest.fn<(tableName: string) => Promise<Array<ModelSchemaColumn>>>(
      async (_tableName: string): Promise<Array<ModelSchemaColumn>> => {
        return COLUMNS;
      },
    );

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
  test("Fields to pass on, stored as JSON text or as an object, and the ID always", () => {
    expect(
      selectedColumnIds(
        step("incident-find-one", "find-1", {
          select: '{"_id": true, "title": true, "description": false}',
        }),
      ),
    ).toEqual(["_id", "title"]);

    // The ID is passed on whether it is named or not.
    expect(
      selectedColumnIds(
        step("incident-find-one", "find-1", {
          select: { title: true },
        }),
      ),
    ).toEqual(["_id", "title"]);
  });

  test("a related record's fields it passes on, as record.field", () => {
    expect(
      selectedColumnIds(
        step("incident-on-update", "on-update-1", {
          select: {
            title: true,
            currentIncidentState: { name: true, color: false },
          },
        }),
      ),
    ).toEqual([
      "_id",
      "title",
      "currentIncidentState",
      "currentIncidentState.name",
    ]);
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

  test("the fields it passes on come first; the others are apart, empty here", () => {
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
        return [field.label, Boolean(field.isEmptyHere)];
      }),
    ).toEqual([
      // The ID is always passed on.
      ["ID", false],
      ["Description", false],
      ["Title", true],
    ]);
    // No badge: the menu draws the empty-here fields under why.
    expect(fields[2]!.badges).toBeUndefined();
    expect(fields[2]!.description).toBe("The incident's title");
  });

  test("a related record's field it passes on is offered under the record's name", () => {
    const onUpdate: NodeDataProp = step("incident-on-update", "on-update-1", {
      select: { title: true, currentIncidentState: { name: true } },
    });

    const fields: Array<ValueSuggestion> = recordFieldSuggestions({
      component: onUpdate,
      returnValue: onUpdate.metadata.returnValues[0]!,
      columns: [
        ...COLUMNS,
        {
          id: "currentIncidentState",
          title: "Current Incident State",
          type: "Entity",
          isRelation: true,
          relatedColumns: [
            { id: "name", title: "Name", type: "Text", isRelation: false },
            { id: "color", title: "Color", type: "Color", isRelation: false },
          ],
        },
      ],
    });

    expect(
      fields.map((field: ValueSuggestion) => {
        return [field.label, Boolean(field.isEmptyHere)];
      }),
    ).toEqual([
      ["ID", false],
      ["Title", false],
      ["Current Incident State › Name", false],
      ["Description", true],
    ]);
    expect(fields[2]!.reference).toBe(
      "{{local.components.on-update-1.returnValues.model.currentIncidentState.name}}",
    );
  });

  test("a record's drill-in says whose its empty fields are, and how to pass them on", () => {
    const onUpdate: NodeDataProp = step("incident-on-update", "on-update-1", {
      select: { title: true },
    });

    const model: ValueSuggestion = buildStepValueGroups(
      { upstreamComponents: [onUpdate] },
      {
        loadRecordColumns: async (): Promise<Array<ModelSchemaColumn>> => {
          return COLUMNS;
        },
      },
    )[0]!.items[0]!;

    expect(model.drillIn?.emptyHereNote).toEqual({
      template:
        "{{step}} doesn't pass these on, so they are empty here. Add them to its {{setting}} to use them.",
      values: { step: "On Update Incident", setting: "Fields to pass on" },
    });

    const onDelete: NodeDataProp = step("incident-on-delete", "on-delete-1");
    const deleted: ValueSuggestion = buildStepValueGroups(
      { upstreamComponents: [onDelete] },
      {
        loadRecordColumns: async (): Promise<Array<ModelSchemaColumn>> => {
          return COLUMNS;
        },
      },
    )[0]!.items[0]!;

    expect(deleted.drillIn?.emptyHereNote).toEqual({
      template: "{{step}} passes on only the ID: the record is already gone.",
      values: { step: "On Delete Incident" },
    });
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

/*
 * On Create or Update hands on the record, as On Create and On Update do,
 * and What Happened: "created" or "updated". A later step's value picker
 * lists both under the trigger - the record opening to its fields, the ones
 * it passes on first; What Happened as the plain text it is.
 */
describe("On Create or Update, before the step being set up", () => {
  const trigger: NodeDataProp = step(
    "incident-on-create-or-update",
    "incident-on-create-or-update-1",
    { select: { title: true } },
  );

  test("offers the record and What Happened, in that order", () => {
    const groups: Array<ValueSuggestionGroup> = buildStepValueGroups({
      upstreamComponents: [trigger],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]!.title).toBe("On Create or Update Incident");
    expect(groups[0]!.subtitle).toBe("incident-on-create-or-update-1");
    expect(
      groups[0]!.items.map((item: ValueSuggestion) => {
        return [item.label, item.reference, item.typeLabel];
      }),
    ).toEqual([
      [
        "Incident",
        "{{local.components.incident-on-create-or-update-1.returnValues.model}}",
        groups[0]!.items[0]!.typeLabel,
      ],
      [
        "What Happened",
        "{{local.components.incident-on-create-or-update-1.returnValues.what-happened}}",
        groups[0]!.items[1]!.typeLabel,
      ],
    ]);
    expect(groups[0]!.items[1]!.description).toBe(
      '"created" for a new Incident, "updated" for a change to one.',
    );
  });

  test("What Happened is plain text, picked whole: nothing to open", () => {
    const whatHappened: ValueSuggestion = buildStepValueGroups({
      upstreamComponents: [trigger],
    })[0]!.items[1]!;

    expect(whatHappened.drillIn).toBeUndefined();
    expect(whatHappened.isUnavailable).toBeUndefined();
  });

  test("the record opens to its fields, the ones passed on first, as On Update's does", async () => {
    const model: ValueSuggestion = buildStepValueGroups(
      { upstreamComponents: [trigger] },
      {
        loadRecordColumns: async (): Promise<Array<ModelSchemaColumn>> => {
          return COLUMNS;
        },
      },
    )[0]!.items[0]!;

    expect(model.drillIn?.wholeValueLabel).toBe("The whole Incident");

    const fields: Array<ValueSuggestion> = await model.drillIn!.loadChildren!();

    expect(
      fields.map((field: ValueSuggestion) => {
        return [field.label, Boolean(field.isEmptyHere)];
      }),
    ).toEqual([
      ["ID", false],
      ["Title", false],
      ["Description", true],
    ]);
    expect(model.drillIn?.emptyHereNote).toEqual({
      template:
        "{{step}} doesn't pass these on, so they are empty here. Add them to its {{setting}} to use them.",
      values: {
        step: "On Create or Update Incident",
        setting: "Fields to pass on",
      },
    });
  });

  test("reads which fields it passes on from Fields to pass on, as every record step does", () => {
    expect(selectedColumnIds(trigger)).toEqual(["_id", "title"]);
  });
});
