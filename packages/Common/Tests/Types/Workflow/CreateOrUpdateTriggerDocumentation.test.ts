/*
 * On Create or Update's "How to use" help (DatabaseDocumentation): what it
 * says past what On Create's and On Update's help says - a new record always
 * runs it while Fields to watch narrows the updates, What Happened tells the
 * two apart, one save is one run, OneUptime's own changes are updates too,
 * and how Run Workflow tests either. ComponentDocumentation.test holds every
 * step's help, this one's included, to the shared rules (names that exist,
 * examples built from the step, the budget); this holds what it says.
 */

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorSecret from "../../../Models/DatabaseModels/MonitorSecret";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../Types/Workflow/Component";
import BaseModelComponent from "../../../Types/Workflow/Components/BaseModel";
import {
  WHAT_HAPPENED_ID,
  getCreateOrUpdateTriggerId,
} from "../../../Types/Workflow/CreateOrUpdateTrigger";
import ComponentDocumentation, {
  ComponentDocumentationNote,
  ComponentDocumentationNoteType,
  ComponentDocumentationTopic,
} from "../../../Types/Workflow/Documentation/ComponentDocumentation";
import { getComponentDocumentation } from "../../../Types/Workflow/Documentation/Index";
import { WORKFLOW_TEST_WHILE_OFF_HELP } from "../../../Types/Workflow/WorkflowEnabled";
import { describe, expect, test } from "@jest/globals";

const STEP_ID: string = "incident-on-create-or-update-1";

type TriggerOfFunction = (model: BaseModel) => ComponentMetadata;

const triggerOf: TriggerOfFunction = (model: BaseModel): ComponentMetadata => {
  return BaseModelComponent.getComponents(model).find(
    (component: ComponentMetadata): boolean => {
      return component.id === getCreateOrUpdateTriggerId(model.tableName!);
    },
  )!;
};

type DocsOfFunction = (model: BaseModel) => ComponentDocumentation;

const docsOf: DocsOfFunction = (model: BaseModel): ComponentDocumentation => {
  const metadata: ComponentMetadata = triggerOf(model);
  const node: NodeDataProp = {
    error: "",
    id: STEP_ID,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `internal-${STEP_ID}`,
    arguments: {},
    returnValues: {},
    componentType: metadata.componentType,
  };

  return getComponentDocumentation({
    metadata: metadata,
    stepId: STEP_ID,
    graphComponents: [node],
  })!;
};

const INCIDENT_DOCS: ComponentDocumentation = docsOf(new Incident());

type TopicOfFunction = (title: string) => ComponentDocumentationTopic;

const topicOf: TopicOfFunction = (
  title: string,
): ComponentDocumentationTopic => {
  return INCIDENT_DOCS.learnMore.find(
    (topic: ComponentDocumentationTopic): boolean => {
      return topic.title === title;
    },
  )!;
};

describe("On Create or Update's help", () => {
  test("says in one sentence that it runs for a new record and for a changed one", () => {
    expect(INCIDENT_DOCS.summary).toBe(
      "Starts this workflow each time a new Incident is created in this project, and each time one changes.",
    );
  });

  test("walks through the settings: Fields to watch for updates, Fields to pass on, Success and What Happened, then turning it on", () => {
    expect(INCIDENT_DOCS.steps).toEqual([
      "To run on an update only when particular fields change, add them to **Fields to watch**. A new Incident always starts a run.",
      "Under **Fields to pass on**, choose the fields of the Incident later steps need.",
      "Connect **Success** to the steps to run. **What Happened** says whether the Incident was `created` or `updated`.",
      "Turn the workflow on. Only Incidents created or changed while it is on start a run.",
    ]);
  });

  test("shows how to read a field of the record, and how to tell a new one from a change", () => {
    expect(INCIDENT_DOCS.examples).toHaveLength(2);
    expect(INCIDENT_DOCS.examples[0]!.code).toBe(
      `{{local.components.${STEP_ID}.returnValues.model.title}}`,
    );
    expect(INCIDENT_DOCS.examples[0]!.description).toBe(
      "`title` must be one of the **Fields to pass on**.",
    );
    expect(INCIDENT_DOCS.examples[1]!.title).toBe(
      "Tell a new one from a change",
    );
    expect(INCIDENT_DOCS.examples[1]!.code).toBe(
      `{{local.components.${STEP_ID}.returnValues.${WHAT_HAPPENED_ID}}}`,
    );
    expect(INCIDENT_DOCS.examples[1]!.description).toBe(
      "`created` or `updated`. Compare it in an **If / Else** step, or take a path for each with **Switch / Case**.",
    );
  });

  test("warns that a field not passed on is empty, and says one save is one run", () => {
    const notes: Array<string> = INCIDENT_DOCS.notes.map(
      (note: ComponentDocumentationNote): string => {
        return `${note.type}: ${note.text}`;
      },
    );

    expect(notes).toEqual([
      `${ComponentDocumentationNoteType.Warning}: A field left out of **Fields to pass on** is empty in later steps, even though the Incident has it.`,
      `${ComponentDocumentationNoteType.Tip}: One save starts one run. What OneUptime fills in while it creates the Incident is part of the create, so a new Incident runs it once, as \`created\`.`,
      `${ComponentDocumentationNoteType.Tip}: A field saved with the value it already has is not a change, so it does not start a run. **Fields to watch** is no guarantee either: when an update does not say which fields changed, the workflow runs anyway.`,
    ]);
  });

  /*
   * An incident gets its Slack channel, its owners are told, its monitors
   * are held - each an update OneUptime makes after the create, and each a
   * run of a workflow that watches nothing.
   */
  test("says OneUptime's own changes are updates too, and what to do about them", () => {
    expect(topicOf("Changes OneUptime makes").paragraphs).toEqual([
      "OneUptime makes changes of its own too - it gives a new incident its Slack channel, say. A change it makes to the Incident is an update like any other, and starts a run. To run only for the changes you care about, add those fields to **Fields to watch**.",
    ]);
  });

  test("tests it with Run Workflow, as a create or an update, while the workflow is still off", () => {
    expect(topicOf("Testing it").paragraphs).toEqual([
      `Click **Run Workflow** in the builder's toolbar and pick one Incident: type its number or part of its name. Under **What Happened**, choose whether the workflow runs as if that Incident had just been created or just been updated. ${WORKFLOW_TEST_WHILE_OFF_HELP}`,
    ]);
  });

  test("how a record is picked follows what the model's records can be found by", () => {
    // A monitor has a name and no number.
    expect(docsOf(new Monitor()).learnMore[1]!.paragraphs[0]).toContain(
      "pick one Monitor: type part of its name, or paste its ID.",
    );
    // A monitor secret has a name too; whatever it has, the sentence holds.
    expect(docsOf(new MonitorSecret()).learnMore[1]!.paragraphs[0]).toMatch(
      /^Click \*\*Run Workflow\*\* in the builder's toolbar and (pick one Monitor Secret: |paste the ID of one Monitor Secret\.)/,
    );
  });

  test("links to the model's reference and the record triggers guide, as the other triggers do", () => {
    const onUpdate: ComponentDocumentation = getComponentDocumentation({
      metadata: BaseModelComponent.getComponents(new Incident()).find(
        (component: ComponentMetadata): boolean => {
          return component.id === "incident-on-update";
        },
      )!,
      stepId: "incident-on-update-1",
    })!;

    expect(INCIDENT_DOCS.links).toEqual(onUpdate.links);
  });

  test("is its own, not On Create's or On Update's", () => {
    for (const suffix of ["on-create", "on-update"]) {
      const other: ComponentDocumentation = getComponentDocumentation({
        metadata: BaseModelComponent.getComponents(new Incident()).find(
          (component: ComponentMetadata): boolean => {
            return component.id === `incident-${suffix}`;
          },
        )!,
        stepId: `incident-${suffix}-1`,
      })!;

      expect(other.summary).not.toBe(INCIDENT_DOCS.summary);
      expect(JSON.stringify(other)).not.toContain("What Happened");
    }
  });
});
