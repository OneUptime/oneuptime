/*
 * What the picker's step groups say about where this step runs
 * (StepValueSource): a step before it on some runs only says which branch
 * decides; a step whose values are not there is listed apart, after
 * everything else, with why, and none of its values can be picked or opened.
 *
 * The graph (StepGraph) finds these steps; this is the words and the shape
 * the menu draws them from. Built from the real step definitions.
 */

jest.mock("../../../../../Models/DatabaseModels/Index", () => {
  return { __esModule: true, default: [] };
});

import {
  StepValueCopy,
  UNAVAILABLE_GROUP_ORDER,
  buildStepValueGroups,
  stepGroupId,
} from "../../../../../UI/Components/Workflow/ValuePicker/StepValueSource";
import { UnavailableReason } from "../../../../../UI/Components/Workflow/ValuePicker/StepGraph";
import {
  ValueAvailabilityState,
  ValueSuggestion,
  ValueSuggestionContext,
  ValueSuggestionGroup,
  ValueSuggestionGroupKind,
  dedupeSuggestions,
  filterSuggestionGroups,
  mergeSuggestionGroups,
} from "../../../../../UI/Components/Workflow/ValuePicker/ValueSuggestion";
import { buildVariableGroups } from "../../../../../UI/Components/Workflow/ValuePicker/VariableValueSource";
import { ModelSchemaColumn } from "../../../../../UI/Components/Workflow/ModelSchema";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components from "../../../../../Types/Workflow/Components";
import BaseModelComponentFactory from "../../../../../Types/Workflow/Components/BaseModel";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import { JSONObject } from "../../../../../Types/JSON";
import { describe, expect, jest, test } from "@jest/globals";

const INCIDENT_COMPONENTS: Array<ComponentMetadata> =
  BaseModelComponentFactory.getComponents(new Incident());

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
  const metadata: ComponentMetadata = [
    ...Components,
    ...INCIDENT_COMPONENTS,
  ].find((component: ComponentMetadata): boolean => {
    return component.id === metadataId;
  })!;

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
const ifElse: NodeDataProp = step(ComponentID.IfElse, "if-else-1");
const post: NodeDataProp = step(ComponentID.ApiPost, "api-post-1");
const get: NodeDataProp = step(ComponentID.ApiGet, "api-get-1");
const log: NodeDataProp = step(ComponentID.Log, "log-1");
const slack: NodeDataProp = step(
  ComponentID.SlackSendMessageToChannel,
  "slack-1",
);
const findIncident: NodeDataProp = step("incident-find-one", "find-1", {
  select: { title: true },
});

const COLUMNS: Array<ModelSchemaColumn> = [
  { id: "_id", title: "ID", type: "ObjectID", isRelation: false },
  { id: "title", title: "Title", type: "Text", isRelation: false },
];

type GroupFunction = (
  groups: Array<ValueSuggestionGroup>,
  stepId: string,
) => ValueSuggestionGroup | undefined;

const groupOf: GroupFunction = (
  groups: Array<ValueSuggestionGroup>,
  stepId: string,
): ValueSuggestionGroup | undefined => {
  return groups.find((group: ValueSuggestionGroup): boolean => {
    return group.id === stepGroupId(stepId);
  });
};

describe("a step before this one on some runs only", () => {
  const context: ValueSuggestionContext = {
    component: slack,
    upstreamComponents: [webhook, post, get],
    sometimesSteps: {
      "api-post-1": { branchStep: ifElse, portTitle: "Yes" },
      "api-get-1": { branchStep: ifElse },
    },
  };

  const groups: Array<ValueSuggestionGroup> = buildStepValueGroups(context);

  test("says which step decides, and on which of its outputs", () => {
    expect(groupOf(groups, "api-post-1")?.availability).toEqual({
      state: ValueAvailabilityState.Sometimes,
      reason: {
        template: StepValueCopy.sometimesWhen,
        values: { step: "If / Else", output: "Yes" },
      },
    });
  });

  test("without the output, says only that its values can be empty here", () => {
    expect(groupOf(groups, "api-get-1")?.availability).toEqual({
      state: ValueAvailabilityState.Sometimes,
      reason: { template: StepValueCopy.sometimes },
    });
  });

  test("is listed in run order with the others, its values usable", () => {
    expect(
      groups.map((group: ValueSuggestionGroup) => {
        return [group.id, group.order];
      }),
    ).toEqual([
      ["step:webhook-1", 0],
      ["step:api-post-1", 1],
      ["step:api-get-1", 2],
    ]);
    expect(
      groupOf(groups, "api-post-1")!.items.some((item: ValueSuggestion) => {
        return item.isUnavailable;
      }),
    ).toBe(false);
    // A JSON body still opens to a path: its values are values.
    expect(
      groupOf(groups, "api-post-1")!.items.find((item: ValueSuggestion) => {
        return item.reference.endsWith(".response-body}}");
      })?.drillIn,
    ).toBeDefined();
  });

  test("a step before it on every run says nothing of the kind", () => {
    expect(groupOf(groups, "webhook-1")?.availability).toBeUndefined();
  });

  test("a branch step with no title is named by its id", () => {
    const untitled: NodeDataProp = {
      ...ifElse,
      metadata: { ...ifElse.metadata, title: "" },
    };

    expect(
      buildStepValueGroups({
        component: slack,
        upstreamComponents: [post],
        sometimesSteps: {
          "api-post-1": { branchStep: untitled, portTitle: "No" },
        },
      })[0]?.availability?.reason.values,
    ).toEqual({ step: "if-else-1", output: "No" });
  });
});

describe("the steps whose values are not there", () => {
  const context: ValueSuggestionContext = {
    component: post,
    upstreamComponents: [webhook],
    unavailableSteps: [
      { step: slack, reason: UnavailableReason.RunsAfter },
      { step: get, reason: UnavailableReason.NotOnPath },
      { step: findIncident, reason: UnavailableReason.NeverRuns },
    ],
  };

  const groups: Array<ValueSuggestionGroup> = buildStepValueGroups(context, {
    loadRecordColumns: async (): Promise<Array<ModelSchemaColumn>> => {
      return COLUMNS;
    },
  });

  test("come after the usable ones, in the order the graph gives, each with why", () => {
    expect(
      groups.map((group: ValueSuggestionGroup) => {
        return [
          group.id,
          group.order,
          group.availability?.state,
          group.availability?.reason.template,
        ];
      }),
    ).toEqual([
      ["step:webhook-1", 0, undefined, undefined],
      [
        "step:slack-1",
        UNAVAILABLE_GROUP_ORDER,
        ValueAvailabilityState.Unavailable,
        StepValueCopy.runsAfter,
      ],
      [
        "step:api-get-1",
        UNAVAILABLE_GROUP_ORDER + 1,
        ValueAvailabilityState.Unavailable,
        StepValueCopy.notOnPath,
      ],
      [
        "step:find-1",
        UNAVAILABLE_GROUP_ORDER + 2,
        ValueAvailabilityState.Unavailable,
        StepValueCopy.neverRuns,
      ],
    ]);
  });

  test("the reasons, in words", () => {
    expect(StepValueCopy.runsAfter).toBe("Runs after this step.");
    expect(StepValueCopy.notOnPath).toBe(
      "Not on the path to this step. Connect it before this step to use its values.",
    );
    expect(StepValueCopy.neverRuns).toBe(
      "Not connected to the trigger, so it never runs.",
    );
  });

  test("are named and iconed like any step, so they can be found", () => {
    const group: ValueSuggestionGroup = groupOf(groups, "api-get-1")!;

    expect(group.kind).toBe(ValueSuggestionGroupKind.Step);
    expect(group.title).toBe(get.metadata.title);
    expect(group.subtitle).toBe("api-get-1");
    expect(group.iconProp).toBe(get.metadata.iconProp);
  });

  test("their values are listed, marked as not there, and cannot be opened", () => {
    for (const id of ["slack-1", "api-get-1", "find-1"]) {
      const items: Array<ValueSuggestion> = groupOf(groups, id)!.items;

      expect(items.length).toBeGreaterThan(0);

      for (const item of items) {
        expect(item.isUnavailable).toBe(true);
        expect(item.drillIn).toBeUndefined();
      }
    }

    // A record too: nothing to look inside where it is not there.
    expect(groupOf(groups, "find-1")!.items[0]!.typeLabel).toBe("Record");
  });

  test("come after the variables too", () => {
    const merged: Array<ValueSuggestionGroup> = mergeSuggestionGroups([
      ...groups,
      ...buildVariableGroups([
        { name: "DEPLOY_ENV", isGlobal: false },
        { name: "API_KEY", isGlobal: true },
      ]),
    ]);

    expect(
      merged.map((group: ValueSuggestionGroup) => {
        return group.id;
      }),
    ).toEqual([
      "step:webhook-1",
      "variables:workflow",
      "variables:global",
      "step:slack-1",
      "step:api-get-1",
      "step:find-1",
    ]);
  });

  test("a step that returns nothing is not listed among them either", () => {
    expect(
      buildStepValueGroups({
        component: post,
        upstreamComponents: [webhook],
        unavailableSteps: [{ step: log, reason: UnavailableReason.NotOnPath }],
      }).map((group: ValueSuggestionGroup) => {
        return group.id;
      }),
    ).toEqual(["step:webhook-1"]);
  });

  test("the step being edited is never among them", () => {
    expect(
      buildStepValueGroups({
        component: post,
        upstreamComponents: [webhook],
        unavailableSteps: [{ step: post, reason: UnavailableReason.RunsAfter }],
      }).map((group: ValueSuggestionGroup) => {
        return group.id;
      }),
    ).toEqual(["step:webhook-1"]);
  });

  test("without a graph to say so, nothing is unavailable", () => {
    expect(
      buildStepValueGroups({
        component: post,
        upstreamComponents: [webhook, slack],
      }).some((group: ValueSuggestionGroup) => {
        return Boolean(group.availability);
      }),
    ).toBe(false);
  });

  test("a search finds their values, still marked", () => {
    const found: Array<ValueSuggestionGroup> = filterSuggestionGroups(
      groups,
      "response",
    );

    expect(
      found.map((group: ValueSuggestionGroup) => {
        return group.id;
      }),
    ).toContain("step:api-get-1");
    expect(
      groupOf(found, "api-get-1")!.items.every((item: ValueSuggestion) => {
        return item.isUnavailable;
      }),
    ).toBe(true);
  });
});

describe("merged with what other sources say", () => {
  test("a group keeps the availability the first source gave it", () => {
    const merged: Array<ValueSuggestionGroup> = mergeSuggestionGroups([
      {
        id: "step:api-post-1",
        kind: ValueSuggestionGroupKind.Step,
        title: "HTTP POST",
        order: 1,
        items: [{ reference: "{{a}}", label: "A" }],
        availability: {
          state: ValueAvailabilityState.Sometimes,
          reason: { template: StepValueCopy.sometimes },
        },
      },
      // What the last runs held adds to the same group, and says nothing of it.
      {
        id: "step:api-post-1",
        kind: ValueSuggestionGroupKind.Step,
        title: "HTTP POST",
        order: 1,
        items: [{ reference: "{{a}}", label: "A", sample: "200" }],
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.availability?.state).toBe(
      ValueAvailabilityState.Sometimes,
    );
    expect(merged[0]!.items[0]!.sample).toBe("200");
  });

  test("a group another source made first takes the availability it is given", () => {
    const merged: Array<ValueSuggestionGroup> = mergeSuggestionGroups([
      {
        id: "step:api-post-1",
        kind: ValueSuggestionGroupKind.Step,
        title: "HTTP POST",
        order: 1,
        items: [{ reference: "{{a}}", label: "A", sample: "200" }],
      },
      {
        id: "step:api-post-1",
        kind: ValueSuggestionGroupKind.Step,
        title: "HTTP POST",
        order: 1,
        items: [{ reference: "{{a}}", label: "A" }],
        availability: {
          state: ValueAvailabilityState.Sometimes,
          reason: { template: StepValueCopy.sometimes },
        },
      },
    ]);

    expect(merged[0]!.availability?.state).toBe(
      ValueAvailabilityState.Sometimes,
    );
  });

  test("a record's field keeps its empty-here mark when a sample is added", () => {
    const merged: Array<ValueSuggestion> = dedupeSuggestions([
      {
        reference: "{{local.components.find-1.returnValues.model.title}}",
        label: "Title",
        isEmptyHere: true,
      },
      {
        reference: "{{local.components.find-1.returnValues.model.title}}",
        label: "title",
        sample: "Database is down",
        annotatesOnly: true,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.isEmptyHere).toBe(true);
    expect(merged[0]!.label).toBe("Title");
    expect(merged[0]!.sample).toBe("Database is down");
  });

  test("a record's note on its empty fields survives a second way inside", () => {
    const record: string = "{{local.components.find-1.returnValues.model}}";
    const merged: Array<ValueSuggestion> = dedupeSuggestions([
      {
        reference: record,
        label: "Incident",
        drillIn: {
          wholeValueLabel: "The whole Incident",
          allowsPath: true,
          emptyHereNote: {
            template: StepValueCopy.notPassedOn,
            values: { step: "Find One Incident", setting: "Fields to pass on" },
          },
        },
      },
      {
        reference: record,
        label: "Incident",
        annotatesOnly: true,
        drillIn: {
          wholeValueLabel: "The whole Incident",
          allowsPath: true,
          note: "Fields of the last run.",
        },
      },
    ]);

    expect(merged[0]!.drillIn?.emptyHereNote?.template).toBe(
      StepValueCopy.notPassedOn,
    );
    expect(merged[0]!.drillIn?.note).toBe("Fields of the last run.");
  });
});
