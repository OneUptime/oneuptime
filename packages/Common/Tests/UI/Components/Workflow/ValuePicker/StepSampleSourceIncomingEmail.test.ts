/*
 * The value picker's suggestions from an Incoming Email trigger: what the
 * last email held, the fields inside its headers and attachments, and - until
 * the first email arrives - a note that says so, the way the Webhook trigger
 * has one until its first request.
 */

jest.mock("../../../../../Models/DatabaseModels/Index", () => {
  return { __esModule: true, default: [] };
});

import {
  BuildStepSampleGroupsOptions,
  FormatWhenFunction,
  STEP_SAMPLE_SOURCE_ID,
  StepSampleCopy,
  buildStepSampleGroups,
} from "../../../../../UI/Components/Workflow/ValuePicker/StepSampleSource";
import {
  ValueSuggestion,
  ValueSuggestionContext,
  ValueSuggestionGroup,
} from "../../../../../UI/Components/Workflow/ValuePicker/ValueSuggestion";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components from "../../../../../Types/Workflow/Components";
import ObjectID from "../../../../../Types/ObjectID";
import {
  StepSample,
  StepSampleValue,
  describeSampleValue,
} from "../../../../../Types/Workflow/StepSamples";
import { describe, expect, jest, test } from "@jest/globals";

const metadataOf: (id: string) => ComponentMetadata = (
  id: string,
): ComponentMetadata => {
  return Components.find((component: ComponentMetadata) => {
    return component.id === id;
  })!;
};

const step: (metadataId: string, id: string) => NodeDataProp = (
  metadataId: string,
  id: string,
): NodeDataProp => {
  const metadata: ComponentMetadata = metadataOf(metadataId);

  return {
    error: "",
    id: id,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `${id}-internal`,
    arguments: {},
    returnValues: {},
    componentType: metadata.componentType,
  };
};

const trigger: NodeDataProp = step(
  ComponentID.IncomingEmail,
  "incoming-email-1",
);
const log: NodeDataProp = step(ComponentID.Log, "log-1");
const manual: NodeDataProp = step(ComponentID.Manual, "manual-1");

const WORKFLOW_ID: ObjectID = new ObjectID(
  "b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a",
);
const RAN_AT: string = "2026-10-01T11:55:00.000Z";

const HEADERS: string =
  "{{local.components.incoming-email-1.returnValues.headers}}";
const ATTACHMENTS: string =
  "{{local.components.incoming-email-1.returnValues.attachments}}";
const SUBJECT: string =
  "{{local.components.incoming-email-1.returnValues.subject}}";

const formatWhen: FormatWhenFunction = (): string => {
  return "5 minutes ago";
};

const OPTIONS: BuildStepSampleGroupsOptions = { formatWhen: formatWhen };

const value: (raw: unknown) => StepSampleValue = (
  raw: unknown,
): StepSampleValue => {
  return describeSampleValue(raw, { ranAt: RAN_AT });
};

const context: (upstream: Array<NodeDataProp>) => ValueSuggestionContext = (
  upstream: Array<NodeDataProp>,
): ValueSuggestionContext => {
  return {
    workflowId: WORKFLOW_ID,
    component: log,
    upstreamComponents: upstream,
  };
};

const itemOf: (
  group: ValueSuggestionGroup | undefined,
  reference: string,
) => ValueSuggestion | undefined = (
  group: ValueSuggestionGroup | undefined,
  reference: string,
): ValueSuggestion | undefined => {
  return group?.items.find((candidate: ValueSuggestion) => {
    return candidate.reference === reference && !candidate.searchOnly;
  });
};

describe("an Incoming Email trigger that has received email", () => {
  const sample: StepSample = {
    componentId: "incoming-email-1",
    returnValues: {
      subject: value("Disk space low on db-1"),
      headers: value({
        "message-id": "<abc@vendor.example>",
        "x-priority": "1",
      }),
      attachments: value([
        { filename: "graph.png", contentType: "image/png", size: 2048 },
      ]),
    },
  };

  const group: ValueSuggestionGroup | undefined = buildStepSampleGroups(
    context([trigger]),
    [sample],
    OPTIONS,
  )[0];

  test("says beside each value what the last email held", () => {
    expect(itemOf(group, SUBJECT)?.sample).toBe('"Disk space low on db-1"');
    expect(itemOf(group, HEADERS)?.sample).toBe("2 fields");
    expect(group?.note).toBeUndefined();
  });

  test("says the fields come from the last email, not the last run", () => {
    expect(itemOf(group, HEADERS)?.drillIn?.note).toBe(
      "From the email received 5 minutes ago.",
    );
  });

  test("opens the headers to each header, and the attachments to each file", async () => {
    const headers: Array<ValueSuggestion> = await itemOf(group, HEADERS)!
      .drillIn!.loadChildren!();
    const attachments: Array<ValueSuggestion> = await itemOf(
      group,
      ATTACHMENTS,
    )!.drillIn!.loadChildren!();

    expect(
      headers.map((child: ValueSuggestion) => {
        return child.reference;
      }),
    ).toContain(
      "{{local.components.incoming-email-1.returnValues.headers.message-id}}",
    );
    expect(
      attachments.map((child: ValueSuggestion) => {
        return child.label;
      }),
    ).toContain("[0].filename");
  });
});

describe("an Incoming Email trigger no email has reached yet", () => {
  const group: ValueSuggestionGroup | undefined = buildStepSampleGroups(
    context([trigger]),
    [],
    OPTIONS,
  )[0];

  test("says so, and keeps asking while the list is open", () => {
    expect(group?.note).toEqual({
      text: "No email has reached the workflow's address yet. Send one, and its fields show up here.",
      refreshSourceId: STEP_SAMPLE_SOURCE_ID,
      waitingText: StepSampleCopy.waitingForEmail,
    });
  });

  test("offers no request to copy: an email is sent from a mail app", () => {
    expect(group?.note?.copyText).toBeUndefined();
  });

  test("the values with fields say the fields come with the first email", () => {
    expect(itemOf(group, HEADERS)?.drillIn?.note).toBe(
      StepSampleCopy.noEmailYetInside,
    );
    expect(itemOf(group, ATTACHMENTS)?.drillIn?.note).toBe(
      "No email has arrived yet. Its fields show up here after the first one.",
    );
  });
});

describe("an email too big to keep", () => {
  test("says the fields come with the next email", () => {
    const sample: StepSample = {
      componentId: "incoming-email-1",
      returnValues: {
        headers: { ...value({}), isCutShort: true },
      },
    };

    const group: ValueSuggestionGroup | undefined = buildStepSampleGroups(
      context([trigger]),
      [sample],
      OPTIONS,
    )[0];

    expect(itemOf(group, HEADERS)?.drillIn?.note).toBe(
      "The last email was too big to keep, so its fields show up here after the next one.",
    );
  });
});

describe("the Manual trigger is unchanged", () => {
  test("it still promises no fields before a run", () => {
    const groups: Array<ValueSuggestionGroup> = buildStepSampleGroups(
      context([manual]),
      [],
      OPTIONS,
    );

    expect(groups).toEqual([]);
  });
});
