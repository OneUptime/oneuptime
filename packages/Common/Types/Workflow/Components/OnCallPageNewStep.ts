/*
 * WHAT A PAGE STEP STARTS WITH WHEN IT IS ADDED TO A WORKFLOW.
 *
 * Most pages a workflow sends are about the record the workflow started on:
 * "when an incident is created, page whoever is on call". So a Page step
 * added to a workflow whose trigger is an incident's or an alert's starts as
 * a page about that record - Page About chosen, and the record's ID filled
 * in with the value from the trigger - and all it still asks is who to page.
 *
 * Added to any other workflow it starts empty, which is a page about a new
 * alert: it asks who to page and for a title. That includes a workflow that
 * starts when an incident or an alert is deleted: the record is gone by the
 * time the step runs, and nobody can be paged about it.
 *
 * Only as the step is added. What the person editing it chooses after that
 * is theirs, and a trigger changed later changes no step.
 *
 * Pure: no DOM, no server.
 */

import { JSONObject } from "../../JSON";
import { ComponentType, NodeDataProp, NodeType } from "../Component";
import { componentReturnValueReference } from "../TemplateSyntax";
import { isPageStep } from "./OnCall";
import { PAGE_ARGUMENT_IDS, PageAbout } from "./OnCallPageSettings";

// The value a record trigger hands its record on as, and the record's id in it.
const TRIGGER_RECORD_RETURN_VALUE_ID: string = "model";
const RECORD_ID_COLUMN: string = "_id";

// How the id of every "On Delete ..." trigger ends (Components/BaseModel).
const ON_DELETE_TRIGGER_ID_SUFFIX: string = "-on-delete";

// The records a page can be about, by their table, and what a page about one stores.
const PAGE_ABOUT_BY_TABLE: Record<
  string,
  { about: PageAbout; recordIdArgumentId: string }
> = {
  Incident: {
    about: PageAbout.Incident,
    recordIdArgumentId: PAGE_ARGUMENT_IDS.incidentId,
  },
  Alert: {
    about: PageAbout.Alert,
    recordIdArgumentId: PAGE_ARGUMENT_IDS.alertId,
  },
};

export type GetNewPageStepArgumentsFunction = (data: {
  // The step being added.
  metadataId: string | undefined | null;
  // The steps already in the workflow.
  steps: Array<NodeDataProp>;
}) => JSONObject | null;

/**
 * The settings a Page step is added with, or null: for a step that is not a
 * Page step, and for a workflow that does not start on an incident or an
 * alert.
 */
export const getNewPageStepArguments: GetNewPageStepArgumentsFunction = (data: {
  metadataId: string | undefined | null;
  steps: Array<NodeDataProp>;
}): JSONObject | null => {
  if (!isPageStep(data.metadataId)) {
    return null;
  }

  const trigger: NodeDataProp | undefined = (data.steps || []).find(
    (step: NodeDataProp): boolean => {
      return (
        Boolean(step) &&
        Boolean(step.metadata) &&
        step.nodeType !== NodeType.PlaceholderNode &&
        step.metadata.componentType === ComponentType.Trigger
      );
    },
  );

  if (!trigger || !trigger.id || !trigger.metadata.tableName) {
    return null;
  }

  // The record a delete trigger hands on is no longer there to page about.
  if ((trigger.metadata.id || "").endsWith(ON_DELETE_TRIGGER_ID_SUFFIX)) {
    return null;
  }

  const page: { about: PageAbout; recordIdArgumentId: string } | undefined =
    PAGE_ABOUT_BY_TABLE[trigger.metadata.tableName];

  if (!page) {
    return null;
  }

  const handsRecordOn: boolean = (trigger.metadata.returnValues || []).some(
    (returnValue: { id: string }): boolean => {
      return returnValue.id === TRIGGER_RECORD_RETURN_VALUE_ID;
    },
  );

  if (!handsRecordOn) {
    return null;
  }

  return {
    [PAGE_ARGUMENT_IDS.about]: page.about,
    [page.recordIdArgumentId]: componentReturnValueReference(
      trigger.id,
      TRIGGER_RECORD_RETURN_VALUE_ID,
      [RECORD_ID_COLUMN],
    ),
  };
};
