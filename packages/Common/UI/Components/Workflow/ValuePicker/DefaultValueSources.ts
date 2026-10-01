/*
 * The sources the value picker uses unless it is told otherwise: the steps
 * that run before this one, and the workflow's variables. Both need the API
 * (a record's fields, the variable list), which is why they are put together
 * here and not in the pure modules they are built from.
 *
 * A new source - values from the last run, say - is added by handing the
 * provider a longer list (ValuePickerProvider's `sources`).
 */

import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import EqualToOrNull from "../../../../Types/BaseDatabase/EqualToOrNull";
import ObjectID from "../../../../Types/ObjectID";
import { WorkflowVariableType } from "../../../../Types/Workflow/WorkflowVariableOAuth";
import WorkflowVariable from "../../../../Models/DatabaseModels/WorkflowVariable";
import ModelAPI, { ListResult } from "../../../Utils/ModelAPI/ModelAPI";
import { fetchModelSchema } from "../ModelSchema";
import { createStepValueSource } from "./StepValueSource";
import {
  ValueSuggestionContext,
  ValueSuggestionGroup,
  ValueSuggestionSource,
} from "./ValueSuggestion";
import {
  VARIABLE_SOURCE_ID,
  WorkflowVariableSummary,
  buildVariableGroups,
} from "./VariableValueSource";

export type LoadWorkflowVariablesFunction = (
  workflowId: ObjectID,
) => Promise<Array<WorkflowVariableSummary>>;

/** This workflow's variables and the project's global ones. */
export const loadWorkflowVariables: LoadWorkflowVariablesFunction = async (
  workflowId: ObjectID,
): Promise<Array<WorkflowVariableSummary>> => {
  const result: ListResult<WorkflowVariable> =
    await ModelAPI.getList<WorkflowVariable>({
      modelType: WorkflowVariable,
      // A null workflowId is a global variable, readable from every workflow.
      query: {
        workflowId: new EqualToOrNull(workflowId.toString()),
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        _id: true,
        name: true,
        description: true,
        workflowId: true,
        isSecret: true,
        variableType: true,
      },
      sort: {
        name: "Ascending" as any,
      },
    });

  return result.data.map(
    (variable: WorkflowVariable): WorkflowVariableSummary => {
      return {
        name: (variable.name as string) || "",
        description: variable.description || undefined,
        isGlobal: !variable.workflowId,
        isSecret: Boolean(variable.isSecret),
        isOAuth: variable.variableType === WorkflowVariableType.OAuth2,
      };
    },
  );
};

export type CreateVariableValueSourceFunction = (
  load?: LoadWorkflowVariablesFunction,
) => ValueSuggestionSource;

export const createVariableValueSource: CreateVariableValueSourceFunction = (
  load: LoadWorkflowVariablesFunction = loadWorkflowVariables,
): ValueSuggestionSource => {
  return {
    id: VARIABLE_SOURCE_ID,
    loadGroups: async (
      context: ValueSuggestionContext,
    ): Promise<Array<ValueSuggestionGroup>> => {
      if (!context.workflowId) {
        return [];
      }

      return buildVariableGroups(await load(context.workflowId));
    },
  };
};

export type CreateDefaultValueSourcesFunction =
  () => Array<ValueSuggestionSource>;

export const createDefaultValueSources: CreateDefaultValueSourcesFunction =
  (): Array<ValueSuggestionSource> => {
    return [
      createStepValueSource({
        loadRecordColumns: (tableName: string) => {
          return fetchModelSchema(tableName, "read");
        },
      }),
      createVariableValueSource(),
    ];
  };
