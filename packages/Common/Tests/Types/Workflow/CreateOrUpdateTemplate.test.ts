/*
 * "Keep another system up to date with your incidents": the template built on
 * On Create or Update. Templates.test holds every template to the registry
 * and the builder's checks; this holds what this one is for - one workflow
 * for a new incident and a changed one, saying which, and only for the
 * changes the other system shows.
 */

import Incident from "../../../Models/DatabaseModels/Incident";
import {
  TableColumnMetadata,
  getTableColumns,
} from "../../../Types/Database/TableColumn";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import { ComponentType } from "../../../Types/Workflow/Component";
import ComponentID from "../../../Types/Workflow/ComponentID";
import { WHAT_HAPPENED_ID } from "../../../Types/Workflow/CreateOrUpdateTrigger";
import {
  RECOMMENDED_WORKFLOW_TEMPLATE_IDS,
  WorkflowTemplate,
  WorkflowTemplateCategory,
  getTemplateGraphSpec,
  getWorkflowTemplate,
  getWorkflowTemplates,
} from "../../../Types/Workflow/Templates";
import { getWatchedColumns } from "../../../Types/Workflow/WatchedFields";
import { describe, expect, test } from "@jest/globals";

const TEMPLATE_ID: string = "incident-created-or-updated-forward";

// A reference to a step's value, standing for the text it resolves to.
const STEP_REFERENCE: RegExp = /\{\{local\.components\.[^{}]+\}\}/g;
const TRIGGER: string = "incident-on-create-or-update-1";

interface GraphNodeSpec {
  componentId: string;
  metadataId: string;
  componentType: ComponentType;
  args?: JSONObject;
}

interface GraphEdgeSpec {
  fromComponentId: string;
  toComponentId: string;
  fromPort: string;
}

const GRAPH: { nodes: Array<GraphNodeSpec>; edges: Array<GraphEdgeSpec> } =
  getTemplateGraphSpec(TEMPLATE_ID) as unknown as {
    nodes: Array<GraphNodeSpec>;
    edges: Array<GraphEdgeSpec>;
  };

type NodeOfFunction = (componentId: string) => GraphNodeSpec;

const nodeOf: NodeOfFunction = (componentId: string): GraphNodeSpec => {
  return GRAPH.nodes.find((node: GraphNodeSpec): boolean => {
    return node.componentId === componentId;
  })!;
};

const WATCHED: JSONObject = nodeOf(TRIGGER).args!["listen-on"] as JSONObject;

describe("the template", () => {
  test("is listed with the incident templates, under its own name", () => {
    const template: WorkflowTemplate | null = getWorkflowTemplate(TEMPLATE_ID);

    expect(template?.name).toBe(
      "Keep another system up to date with your incidents",
    );
    expect(template?.category).toBe(WorkflowTemplateCategory.Incidents);
    // Right after the template that forwards new incidents only.
    const ids: Array<string> = getWorkflowTemplates().map(
      (each: WorkflowTemplate): string => {
        return each.id;
      },
    );

    expect(ids.indexOf(TEMPLATE_ID)).toBe(
      ids.indexOf("incident-created-forward") + 1,
    );
    // One to pick, not one of the few the dialog starts with.
    expect(RECOMMENDED_WORKFLOW_TEMPLATE_IDS).not.toContain(TEMPLATE_ID);
  });

  /*
   * A post the other system refuses fails the run, and the post's Steps
   * entry says why (UnhandledStepFailure): nothing is connected to its
   * Error output.
   */
  test("starts on On Create or Update Incident, then posts, and a refused post fails the run", () => {
    expect(
      GRAPH.nodes.map((node: GraphNodeSpec): [string, string] => {
        return [node.componentId, node.metadataId];
      }),
    ).toEqual([
      [TRIGGER, "incident-on-create-or-update"],
      ["api-post-1", ComponentID.ApiPost],
    ]);
    expect(nodeOf(TRIGGER).componentType).toBe(ComponentType.Trigger);
    expect(
      GRAPH.edges.map((edge: GraphEdgeSpec): string => {
        return `${edge.fromComponentId}:${edge.fromPort}->${edge.toComponentId}`;
      }),
    ).toEqual([`${TRIGGER}:success->api-post-1`]);
  });
});

describe("what it watches", () => {
  test("the four things the other system shows, each a field an update can change", () => {
    expect(Object.keys(WATCHED).sort()).toEqual(
      [
        "currentIncidentStateId",
        "description",
        "incidentSeverityId",
        "title",
      ].sort(),
    );

    const columns: Dictionary<TableColumnMetadata> = getTableColumns(
      new Incident(),
    );

    for (const key of Object.keys(WATCHED)) {
      expect([key, Boolean(columns[key])]).toEqual([key, true]);
    }
  });

  test("hears a new state or severity, by the column holding its ID", () => {
    const heard: Array<string> = getWatchedColumns({
      listenOn: WATCHED,
      model: new Incident(),
    });

    expect(heard).toEqual(
      expect.arrayContaining([
        "title",
        "description",
        "currentIncidentStateId",
        "incidentSeverityId",
      ]),
    );
  });

  /*
   * OneUptime changes an incident itself after it is created: its Slack
   * channels, whether its owners were told, whether it holds its monitors.
   * None of that is the other system's business, so none of it is watched.
   */
  test("hears none of OneUptime's own bookkeeping on an incident", () => {
    const heard: Array<string> = getWatchedColumns({
      listenOn: WATCHED,
      model: new Incident(),
    });

    for (const bookkeeping of [
      "postUpdatesToWorkspaceChannels",
      "isOwnerNotifiedOfResourceCreation",
      "holdsMonitors",
      "nextReminderNotificationAt",
      "subscriberNotificationStatusOnIncidentCreated",
    ]) {
      expect(heard).not.toContain(bookkeeping);
    }
  });
});

describe("what it sends", () => {
  const body: string = nodeOf("api-post-1").args!["request-body"] as string;

  test("says whether the incident was created or updated, with the incident's fields", () => {
    // The references stand for strings, so the body is JSON once filled in.
    const filled: string = body.replace(STEP_REFERENCE, "x");
    const parsed: JSONObject = JSON.parse(filled) as JSONObject;

    expect(Object.keys(parsed)).toEqual([
      "event",
      "id",
      "number",
      "title",
      "severity",
      "state",
    ]);
    expect(body).toContain(
      `"event": "{{local.components.${TRIGGER}.returnValues.${WHAT_HAPPENED_ID}}}"`,
    );
  });

  test("reads only fields its trigger passes on", () => {
    const select: JSONObject = nodeOf(TRIGGER).args!["select"] as JSONObject;

    for (const field of ["_id", "incidentNumber", "title"]) {
      expect([field, Boolean(select[field])]).toEqual([field, true]);
    }

    expect(select["incidentSeverity"]).toEqual({ name: true });
    expect(select["currentIncidentState"]).toEqual({ name: true });
  });

  test("goes to the URL the template asks for, kept secret", () => {
    const template: WorkflowTemplate = getWorkflowTemplate(TEMPLATE_ID)!;

    expect(nodeOf("api-post-1").args!["url"]).toBe(
      "{{local.variables.forwardUrl}}",
    );
    expect(
      template.variables.map(
        (variable: { name: string; isSecret: boolean; required: boolean }) => {
          return [variable.name, variable.isSecret, variable.required];
        },
      ),
    ).toEqual([["forwardUrl", true, true]]);
  });
});
