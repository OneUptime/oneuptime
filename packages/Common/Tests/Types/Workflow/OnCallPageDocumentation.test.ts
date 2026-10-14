/*
 * THE EXAMPLES UNDER "HOW TO USE" ON A PAGE STEP.
 *
 * Each of the four Page steps - Page Users, Page a Team, Page Whoever Is On
 * Call, Page an On-Call Policy - has two worked examples in its help
 * (Types/Workflow/Documentation/OnCallDocumentation):
 *
 *   - a page about what this workflow already has: its incident or its
 *     alert, by a reference to the step that hands it on, or something new
 *     when it has neither; and
 *   - posting the step's Summary to a channel.
 *
 * A person scans the titles to find the one they want, so each is titled
 * as the thing they would ask for. They used to read "Page about the
 * incident this workflow has" and "Tell a channel what the page came to";
 * and the second said the same on Page an On-Call Policy, whose Summary
 * says a policy started, not who was paged.
 */

import IconProp from "../../../Types/Icon/IconProp";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
  NodeDataProp,
  NodeType,
} from "../../../Types/Workflow/Component";
import ComponentID from "../../../Types/Workflow/ComponentID";
import OnCallComponents from "../../../Types/Workflow/Components/OnCall";
import ComponentDocumentation, {
  ComponentDocumentationExample,
  ComponentDocumentationField,
} from "../../../Types/Workflow/Documentation/ComponentDocumentation";
import { getComponentDocumentation } from "../../../Types/Workflow/Documentation/Index";
import { describe, expect, test } from "@jest/globals";

interface PageStep {
  id: ComponentID;
  // The step's who-to-page setting, by the name its form gives it.
  whoSetting: string;
  // What posting its Summary tells a channel.
  summaryTitle: string;
}

const WHO_WAS_PAGED: string = "Tell a channel who was paged";

const PAGE_STEPS: Array<PageStep> = [
  {
    id: ComponentID.PageUsers,
    whoSetting: "Users",
    summaryTitle: WHO_WAS_PAGED,
  },
  {
    id: ComponentID.PageTeam,
    whoSetting: "Teams",
    summaryTitle: WHO_WAS_PAGED,
  },
  {
    id: ComponentID.PageOnCall,
    whoSetting: "On-Call Schedules",
    summaryTitle: WHO_WAS_PAGED,
  },
  {
    id: ComponentID.PageOnCallPolicy,
    whoSetting: "On-Call Policies",
    summaryTitle: "Tell a channel which policy started",
  },
];

type MetadataOfFunction = (id: ComponentID) => ComponentMetadata;

const metadataOf: MetadataOfFunction = (id: ComponentID): ComponentMetadata => {
  const found: ComponentMetadata | undefined = OnCallComponents.find(
    (metadata: ComponentMetadata): boolean => {
      return metadata.id === id;
    },
  );

  if (!found) {
    throw new Error(`There is no ${id} step`);
  }

  return found;
};

type RecordTriggerFunction = (id: string, tableName: string) => NodeDataProp;

// The trigger of a workflow that starts on a record: it hands the record on.
const recordTrigger: RecordTriggerFunction = (
  id: string,
  tableName: string,
): NodeDataProp => {
  const metadata: ComponentMetadata = {
    id: id.replace(/-1$/, ""),
    title: `On Create ${tableName}`,
    category: tableName,
    description: "",
    iconProp: IconProp.Bolt,
    componentType: ComponentType.Trigger,
    tableName: tableName,
    arguments: [],
    returnValues: [
      {
        id: "model",
        name: tableName,
        description: "",
        type: ComponentInputType.JSON,
        required: false,
      },
    ],
    inPorts: [],
    outPorts: [],
  };

  return {
    error: "",
    id: id,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `internal-${id}`,
    arguments: {},
    returnValues: {},
    componentType: ComponentType.Trigger,
  };
};

const INCIDENT_TRIGGER: NodeDataProp = recordTrigger(
  "incident-on-create-1",
  "Incident",
);
const ALERT_TRIGGER: NodeDataProp = recordTrigger("alert-on-create-1", "Alert");

type HelpOfFunction = (
  step: PageStep,
  otherSteps: Array<NodeDataProp>,
) => ComponentDocumentation;

const helpOf: HelpOfFunction = (
  step: PageStep,
  otherSteps: Array<NodeDataProp>,
): ComponentDocumentation => {
  const documentation: ComponentDocumentation | null =
    getComponentDocumentation({
      metadata: metadataOf(step.id),
      stepId: `${step.id}-1`,
      graphComponents: otherSteps,
    });

  if (!documentation) {
    throw new Error(`${step.id} has no help`);
  }

  return documentation;
};

type FieldsOfFunction = (
  example: ComponentDocumentationExample,
) => Record<string, string>;

const fieldsOf: FieldsOfFunction = (
  example: ComponentDocumentationExample,
): Record<string, string> => {
  const fields: Record<string, string> = {};

  for (const field of example.fields || []) {
    fields[(field as ComponentDocumentationField).name] = field.value;
  }

  return fields;
};

describe.each(PAGE_STEPS)("the examples of $id", (step: PageStep) => {
  test("there are two: a page, and telling a channel about it", () => {
    for (const otherSteps of [[], [INCIDENT_TRIGGER], [ALERT_TRIGGER]]) {
      expect(helpOf(step, otherSteps).examples).toHaveLength(2);
    }
  });

  test("in a workflow that starts on an incident, the page is about this workflow's incident", () => {
    const example: ComponentDocumentationExample = helpOf(step, [
      INCIDENT_TRIGGER,
    ]).examples[0]!;

    expect(example.title).toBe("Page about this workflow's incident");

    const fields: Record<string, string> = fieldsOf(example);

    expect(Object.keys(fields)).toEqual([
      step.whoSetting,
      "Page About",
      "Incident ID",
    ]);
    expect(fields["Page About"]).toBe("An incident");
    // The reference a person would paste: the trigger's own incident.
    expect(fields["Incident ID"]).toBe(
      "{{local.components.incident-on-create-1.returnValues.model._id}}",
    );
    expect(example.description).toContain("`incident-on-create-1`");
  });

  test("in a workflow that starts on an alert, it is about this workflow's alert", () => {
    const example: ComponentDocumentationExample = helpOf(step, [ALERT_TRIGGER])
      .examples[0]!;

    expect(example.title).toBe("Page about this workflow's alert");

    const fields: Record<string, string> = fieldsOf(example);

    expect(Object.keys(fields)).toEqual([
      step.whoSetting,
      "Page About",
      "Alert ID",
    ]);
    expect(fields["Page About"]).toBe("An alert");
    expect(fields["Alert ID"]).toBe(
      "{{local.components.alert-on-create-1.returnValues.model._id}}",
    );
  });

  test("with an incident and an alert among its steps, the incident is the one shown", () => {
    expect(
      helpOf(step, [ALERT_TRIGGER, INCIDENT_TRIGGER]).examples[0]!.title,
    ).toBe("Page about this workflow's incident");
  });

  test("with neither, it is about something new: a title and a message", () => {
    const example: ComponentDocumentationExample = helpOf(step, [])
      .examples[0]!;

    expect(example.title).toBe("Page about something new");

    const fields: Record<string, string> = fieldsOf(example);

    expect(Object.keys(fields)).toEqual([
      step.whoSetting,
      "Page About",
      "Title",
      "Message",
    ]);
    expect(fields["Page About"]).toBe("A new alert");
  });

  test("the second posts the step's own Summary, and its title says what that tells the channel", () => {
    for (const otherSteps of [[], [INCIDENT_TRIGGER], [ALERT_TRIGGER]]) {
      const example: ComponentDocumentationExample = helpOf(step, otherSteps)
        .examples[1]!;

      expect(example.title).toBe(step.summaryTitle);
      expect(example.code).toBe(
        `{{local.components.${step.id}-1.returnValues.summary}}`,
      );
      expect(example.description).toContain("It reads like");
    }
  });

  test("every title is the thing a person would ask for: short, and with no full stop", () => {
    for (const otherSteps of [[], [INCIDENT_TRIGGER], [ALERT_TRIGGER]]) {
      for (const example of helpOf(step, otherSteps).examples) {
        expect(example.title.length).toBeLessThanOrEqual(40);
        expect(example.title.endsWith(".")).toBe(false);
        // As they used to read.
        expect(example.title).not.toContain("this workflow has");
        expect(example.title).not.toContain("came to");
      }
    }
  });
});

describe("what posting the Summary tells a channel", () => {
  test("the three steps that page people say who was paged, and their Summary names people", () => {
    for (const step of PAGE_STEPS.filter((pageStep: PageStep): boolean => {
      return pageStep.id !== ComponentID.PageOnCallPolicy;
    })) {
      const example: ComponentDocumentationExample = helpOf(step, [])
        .examples[1]!;

      expect(example.title).toBe(WHO_WAS_PAGED);
      expect(example.description).toContain("Paged Jane Doe");
    }
  });

  test("Page an On-Call Policy starts a policy, and does not claim to say who was paged", () => {
    const example: ComponentDocumentationExample = helpOf(PAGE_STEPS[3]!, [])
      .examples[1]!;

    expect(example.title).toBe("Tell a channel which policy started");
    expect(example.title).not.toContain("who was paged");
    expect(example.description).toContain(
      "Started on-call policy Critical Escalation",
    );
  });
});
