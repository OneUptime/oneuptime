/*
 * The sources the value picker uses unless it is told otherwise: the steps
 * that run before this one, what they held the last times they ran, and the
 * workflow's variables. All need the API (a record's fields, the runs, the
 * variable list), which is why they are put together here and not in the
 * pure modules they are built from.
 *
 * Another source is added by handing the provider a longer list
 * (ValuePickerProvider's `sources`).
 */

import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import EqualToOrNull from "../../../../Types/BaseDatabase/EqualToOrNull";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  StepSample,
  parseStepSamplesResponse,
} from "../../../../Types/Workflow/StepSamples";
import { WorkflowVariableType } from "../../../../Types/Workflow/WorkflowVariableOAuth";
import WorkflowVariable from "../../../../Models/DatabaseModels/WorkflowVariable";
import { WORKFLOW_URL } from "../../../Config";
import API from "../../../Utils/API/API";
import ModelAPI, { ListResult } from "../../../Utils/ModelAPI/ModelAPI";
import { fetchModelSchema } from "../ModelSchema";
import {
  LoadStepSamplesFunction,
  createStepSampleSource,
} from "./StepSampleSource";
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

/**
 * What these steps held the last times the workflow ran (see the workflow
 * service's /step-samples). The project goes in the tenant header, like any
 * other read of the project's data.
 */
export const loadStepSamples: LoadStepSamplesFunction = async (
  workflowId: ObjectID,
  componentIds: Array<string>,
): Promise<Array<StepSample>> => {
  const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(WORKFLOW_URL.toString()).addRoute(
        `/step-samples/${workflowId.toString()}`,
      ),
      data: { componentIds: componentIds },
      headers: ModelAPI.getCommonHeaders(),
    });

  if (result instanceof HTTPErrorResponse) {
    throw result;
  }

  return parseStepSamplesResponse(result.data);
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
      createStepSampleSource({ load: loadStepSamples }),
      createVariableValueSource(),
    ];
  };
