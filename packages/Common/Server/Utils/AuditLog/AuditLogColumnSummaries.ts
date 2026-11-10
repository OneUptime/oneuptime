import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONValue } from "../../../Types/JSON";
import ComponentMetadata from "../../../Types/Workflow/Component";
import Components from "../../../Types/Workflow/Components";
import BaseModelComponentFactory from "../../../Types/Workflow/Components/BaseModel";
import {
  WorkflowComponentLookup,
  WorkflowGraphChanges,
  describeWorkflowGraphSize,
  getWorkflowGraphChanges,
  listWorkflowGraphSteps,
} from "../../../Utils/Workflow/WorkflowGraphChanges";
import {
  describeRunbookStepExecutions,
  getRunbookStepExecutionChanges,
  listRunbookStepExecutions,
} from "../../../Utils/Runbook/RunbookStepExecutionChanges";
import logger from "../Logger";

/*
 * COLUMNS AN AUDIT LOG ENTRY DESCRIBES RATHER THAN COPIES.
 *
 * Most columns are recorded as they are, before and after (AuditLogRecorder).
 * A few hold a whole document that a person edits piece by piece, and whose
 * copies would bury what changed - a workflow's graph is the canvas, a card's
 * position included, saved a second after every click. Those are recorded as
 * what changed, in plain lines (`summary`), with the values before and after
 * described in a few words: an export reads "3 steps and 2 connections" ->
 * "4 steps and 3 connections" in the fields its schema has, and the audit
 * log's own table shows the lines.
 *
 * A runbook run's steps are the other: every step's copy of the runbook
 * step, its status, and what it printed. An entry says what happened to
 * them - "Approved "Restart the API" (step 3)" - with where the steps stood
 * before and after in a few words, and never quotes a step's output, its
 * error or the note someone left with it (RunbookStepExecutionChanges).
 */

export interface AuditLogValueSummary {
  oldValue?: JSONValue | undefined;
  newValue?: JSONValue | undefined;
  summary: Array<string>;
}

export interface AuditLogColumnSummarizer {
  /*
   * What changed, or null when the two values do the same thing: a workflow
   * whose cards were only moved or selected has not changed, and its save
   * adds no entry.
   */
  summarizeUpdate: (
    before: unknown,
    after: unknown,
  ) => AuditLogValueSummary | null;
  // What a created or deleted record held.
  summarizeSnapshot: (value: unknown) => {
    value: JSONValue;
    summary: Array<string>;
  };
}

let componentsById: Map<string, ComponentMetadata> | null = null;

/*
 * Every step a workflow can hold, by id: the built-in components, and each
 * model's record triggers and data steps. Built once, on the first workflow
 * an entry describes.
 */
const getComponentsById: () => Map<string, ComponentMetadata> = (): Map<
  string,
  ComponentMetadata
> => {
  if (componentsById) {
    return componentsById;
  }

  const map: Map<string, ComponentMetadata> = new Map<
    string,
    ComponentMetadata
  >();

  for (const component of Components) {
    map.set(component.id, component);
  }

  for (const modelType of AllModelTypes as Array<{ new (): BaseModel }>) {
    try {
      for (const component of BaseModelComponentFactory.getComponents(
        new modelType(),
      )) {
        map.set(component.id, component);
      }
    } catch (err) {
      logger.debug(
        "AuditLog: a model's workflow steps could not be listed; its steps are named by their ids",
      );
      logger.debug(err);
    }
  }

  componentsById = map;

  return map;
};

export const lookUpWorkflowComponent: WorkflowComponentLookup = (
  componentId: string,
): ComponentMetadata | undefined => {
  return getComponentsById().get(componentId);
};

const WorkflowGraphSummarizer: AuditLogColumnSummarizer = {
  summarizeUpdate: (
    before: unknown,
    after: unknown,
  ): AuditLogValueSummary | null => {
    const changes: WorkflowGraphChanges = getWorkflowGraphChanges({
      before,
      after,
      lookup: lookUpWorkflowComponent,
    });

    if (changes.lines.length === 0) {
      return null;
    }

    return {
      oldValue: describeWorkflowGraphSize(before),
      newValue: describeWorkflowGraphSize(after),
      summary: changes.lines,
    };
  },
  summarizeSnapshot: (
    value: unknown,
  ): { value: JSONValue; summary: Array<string> } => {
    return {
      value: describeWorkflowGraphSize(value),
      summary: listWorkflowGraphSteps({
        graph: value,
        lookup: lookUpWorkflowComponent,
      }),
    };
  },
};

const RunbookStepExecutionsSummarizer: AuditLogColumnSummarizer = {
  summarizeUpdate: (
    before: unknown,
    after: unknown,
  ): AuditLogValueSummary | null => {
    const lines: Array<string> = getRunbookStepExecutionChanges({
      before,
      after,
    }).lines;

    // Only what a step printed, or a note, changed: no step moved on.
    if (lines.length === 0) {
      return null;
    }

    return {
      oldValue: describeRunbookStepExecutions(before),
      newValue: describeRunbookStepExecutions(after),
      summary: lines,
    };
  },
  summarizeSnapshot: (
    value: unknown,
  ): { value: JSONValue; summary: Array<string> } => {
    return {
      value: describeRunbookStepExecutions(value),
      summary: listRunbookStepExecutions({ value }),
    };
  },
};

// By "<table name>.<column>".
const SUMMARIZERS: Readonly<Record<string, AuditLogColumnSummarizer>> = {
  "Workflow.graph": WorkflowGraphSummarizer,
  "RunbookExecution.stepExecutions": RunbookStepExecutionsSummarizer,
};

export const getAuditLogColumnSummarizer: (
  tableName: string | null | undefined,
  column: string,
) => AuditLogColumnSummarizer | null = (
  tableName: string | null | undefined,
  column: string,
): AuditLogColumnSummarizer | null => {
  if (!tableName) {
    return null;
  }

  const key: string = `${tableName}.${column}`;

  return Object.prototype.hasOwnProperty.call(SUMMARIZERS, key)
    ? (SUMMARIZERS[key] as AuditLogColumnSummarizer)
    : null;
};

// The columns described rather than copied, for the guard that holds them to real columns.
export const AUDIT_LOG_SUMMARIZED_COLUMNS: ReadonlyArray<string> =
  Object.keys(SUMMARIZERS);
