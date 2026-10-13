/*
 * A chip for a record's field that its step does not pass on. The step reads
 * only its Fields to pass on (and the ID), so any other field is empty where
 * the reference is used - the value picker lists it apart, and the chip, once
 * inserted, says so too and how to fix it.
 */

jest.mock("../../../../../Models/DatabaseModels/Index", () => {
  return { __esModule: true, default: [] };
});

import {
  ReferenceDescription,
  ReferenceTone,
  describeReference,
} from "../../../../../UI/Components/Workflow/ValuePicker/ReferenceDescription";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components from "../../../../../Types/Workflow/Components";
import BaseModelComponentFactory, {
  SELECT_FIELDS_NAME,
} from "../../../../../Types/Workflow/Components/BaseModel";
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

const find: NodeDataProp = step("incident-find-one", "find-1", {
  select: {
    title: true,
    currentIncidentState: { name: true },
    incidentSeverity: true,
  },
});
const onDelete: NodeDataProp = step("incident-on-delete", "on-delete-1");
const webhook: NodeDataProp = step(ComponentID.Webhook, "webhook-1");
const slack: NodeDataProp = step(
  ComponentID.SlackSendMessageToChannel,
  "slack-1",
);

type DescribeFunction = (
  reference: string,
  steps?: Array<NodeDataProp>,
  downstreamIds?: Array<string>,
) => ReferenceDescription;

const describeIn: DescribeFunction = (
  reference: string,
  steps: Array<NodeDataProp> = [webhook, find, onDelete, slack],
  downstreamIds: Array<string> = [],
): ReferenceDescription => {
  return describeReference(reference, {
    graphComponents: steps,
    editedComponentId: "slack-1",
    downstreamIds: downstreamIds,
  })!;
};

const FIND_MODEL: string = "local.components.find-1.returnValues.model";

const NOT_PASSED_ON: string = `"Find One Incident" doesn't pass this field on, so it is empty here. Add it to its ${SELECT_FIELDS_NAME}.`;

describe("a field its step passes on", () => {
  test("is a chip like any other", () => {
    const description: ReferenceDescription = describeIn(
      `{{${FIND_MODEL}.title}}`,
    );

    expect(description.tone).toBe(ReferenceTone.Normal);
    expect(description.problem).toBeUndefined();
    expect(description.label).toBe("Find One Incident › Incident › title");
  });

  test("the ID is always passed on, named or not", () => {
    expect(describeIn(`{{${FIND_MODEL}._id}}`).tone).toBe(ReferenceTone.Normal);
  });

  test("so is a related record's field it names", () => {
    expect(describeIn(`{{${FIND_MODEL}.currentIncidentState.name}}`).tone).toBe(
      ReferenceTone.Normal,
    );
    // The related record itself is passed on with it.
    expect(describeIn(`{{${FIND_MODEL}.currentIncidentState}}`).tone).toBe(
      ReferenceTone.Normal,
    );
  });

  test("a related record passed on whole is not judged field by field", () => {
    expect(describeIn(`{{${FIND_MODEL}.incidentSeverity.name}}`).tone).toBe(
      ReferenceTone.Normal,
    );
  });

  test("a list item's field is judged by the field it is in", () => {
    expect(describeIn(`{{${FIND_MODEL}.title[0]}}`).tone).toBe(
      ReferenceTone.Normal,
    );
  });

  test("the whole record is never empty", () => {
    expect(describeIn(`{{${FIND_MODEL}}}`).tone).toBe(ReferenceTone.Normal);
  });
});

describe("a field its step does not pass on", () => {
  test("is a warning that says it is empty, and how to pass it on", () => {
    const description: ReferenceDescription = describeIn(
      `{{${FIND_MODEL}.description}}`,
    );

    expect(description.tone).toBe(ReferenceTone.Warning);
    expect(description.problem).toBe(NOT_PASSED_ON);
    // Still named, so it can be seen and removed.
    expect(description.label).toBe(
      "Find One Incident › Incident › description",
    );
  });

  test("a related record's field it does not name", () => {
    expect(describeIn(`{{${FIND_MODEL}.currentIncidentState.color}}`)).toEqual(
      expect.objectContaining({
        tone: ReferenceTone.Warning,
        problem: NOT_PASSED_ON,
      }),
    );
  });

  test("a related record it does not pass on at all", () => {
    expect(describeIn(`{{${FIND_MODEL}.monitors[0].name}}`).problem).toBe(
      NOT_PASSED_ON,
    );
  });

  test("a deleted record passes on only its ID", () => {
    const model: string = "local.components.on-delete-1.returnValues.model";

    expect(describeIn(`{{${model}._id}}`).tone).toBe(ReferenceTone.Normal);
    expect(describeIn(`{{${model}.title}}`).problem).toBe(
      `"On Delete Incident" doesn't pass this field on, so it is empty here. Add it to its ${SELECT_FIELDS_NAME}.`,
    );
  });

  test("a step that runs after this one says that first", () => {
    expect(
      describeIn(
        `{{${FIND_MODEL}.description}}`,
        [webhook, find, slack],
        ["find-1"],
      ).problem,
    ).toBe(
      '"Find One Incident" runs after this step, so this value is empty here.',
    );
  });
});

describe("what is not judged by it", () => {
  test("a step whose Fields to pass on cannot be read", () => {
    const unreadable: NodeDataProp = step("incident-find-one", "find-1", {
      select: "{not json",
    });

    expect(
      describeIn(`{{${FIND_MODEL}.description}}`, [unreadable, slack]).tone,
    ).toBe(ReferenceTone.Normal);
  });

  test("a step with nothing in its Fields to pass on", () => {
    const empty: NodeDataProp = step("incident-find-one", "find-1", {});

    expect(
      describeIn(`{{${FIND_MODEL}.description}}`, [empty, slack]).tone,
    ).toBe(ReferenceTone.Normal);
  });

  test("a value that is not a record: a request body has any field", () => {
    expect(
      describeIn(
        "{{local.components.webhook-1.returnValues.request-body.description}}",
      ).tone,
    ).toBe(ReferenceTone.Normal);
  });

  test("with no workflow to look in, nothing is judged", () => {
    expect(describeReference(`{{${FIND_MODEL}.description}}`, {})!.tone).toBe(
      ReferenceTone.Normal,
    );
  });
});
