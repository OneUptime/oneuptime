/*
 * The pure half of "create a workflow from a template".
 *
 * The wizard's own job is screens and state; everything that decides what
 * actually gets written lives here, with no React and no API calls, because
 * this is the part where a mistake is expensive and invisible: an unresolved
 * {{local.variables.…}} reference is NOT an error at run time — VMAPI leaves
 * the literal text in place and the run still reports success — so a workflow
 * built slightly wrong looks healthy and posts braces to Slack.
 */

import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import {
  WORKFLOW_TEMPLATE_VARIABLE_NAME_REGEX,
  WorkflowTemplate,
  WorkflowTemplateVariable,
  buildGraphForTemplate,
} from "Common/Types/Workflow/Templates";

/** Keyed by WorkflowTemplateVariable.name. */
export interface WorkflowTemplateVariableValues {
  [variableName: string]: string;
}

/** Field-level errors for the variables step, keyed by variable name. */
export interface WorkflowTemplateVariableErrors {
  [variableName: string]: string;
}

export type GenerateIdFunction = () => string;

export const generateWorkflowNodeId: GenerateIdFunction = (): string => {
  return ObjectID.generate().toString();
};

type ReferenceForFunction = (variableName: string) => string;

/**
 * The exact reference string a template uses for a variable. No whitespace
 * inside the braces: the runtime hands the raw capture to deepFind untrimmed,
 * and the builder's linter flags a padded reference as an error.
 */
export const referenceForVariable: ReferenceForFunction = (
  variableName: string,
): string => {
  return `{{local.variables.${variableName}}}`;
};

type IsBlankFunction = (value: string | undefined) => boolean;

const isBlank: IsBlankFunction = (value: string | undefined): boolean => {
  return !value || value.trim() === "";
};

export type ValidateTemplateVariableValuesFunction = (
  template: WorkflowTemplate,
  values: WorkflowTemplateVariableValues,
) => WorkflowTemplateVariableErrors;

/**
 * Validates the values typed into the variables step. Returns an empty object
 * when everything is fine.
 */
export const validateTemplateVariableValues: ValidateTemplateVariableValuesFunction =
  (
    template: WorkflowTemplate,
    values: WorkflowTemplateVariableValues,
  ): WorkflowTemplateVariableErrors => {
    const errors: WorkflowTemplateVariableErrors = {};

    for (const variable of template.variables) {
      const value: string | undefined = values[variable.name];

      if (variable.required && isBlank(value)) {
        errors[variable.name] = `${variable.title} is required.`;
      }
    }

    return errors;
  };

export type TemplateVariablesToFillFunction = (
  template: WorkflowTemplate | null,
) => Array<WorkflowTemplateVariable>;

/** Whether the wizard needs to show a variables step at all. */
export const templateVariablesToFill: TemplateVariablesToFillFunction = (
  template: WorkflowTemplate | null,
): Array<WorkflowTemplateVariable> => {
  return template ? template.variables : [];
};

interface ApplyValuesProps {
  graph: JSONObject;
  template: WorkflowTemplate;
  values: WorkflowTemplateVariableValues;
}

export type ApplyTemplateVariableValuesToGraphFunction = (
  props: ApplyValuesProps,
) => JSONObject;

/*
 * Filled variables need no graph edit at all — the reference stays, and the
 * WorkflowVariable row it points at is created alongside. An OPTIONAL variable
 * left blank is the case that needs handling: no row gets written for it, so
 * the reference would resolve to nothing and ship literal braces into (say) an
 * SMTP username. Where the argument is nothing BUT that reference, drop the
 * argument, which is what "leave it blank" was supposed to mean.
 */
export const applyTemplateVariableValuesToGraph: ApplyTemplateVariableValuesToGraphFunction =
  (props: ApplyValuesProps): JSONObject => {
    const unfilled: Array<string> = props.template.variables
      .filter((variable: WorkflowTemplateVariable) => {
        return isBlank(props.values[variable.name]);
      })
      .map((variable: WorkflowTemplateVariable) => {
        return referenceForVariable(variable.name);
      });

    if (unfilled.length === 0) {
      return props.graph;
    }

    const nodes: Array<JSONObject> = (props.graph["nodes"] ||
      []) as Array<JSONObject>;

    for (const node of nodes) {
      const data: JSONObject | undefined = node["data"] as
        | JSONObject
        | undefined;

      const args: JSONObject | undefined = data?.["arguments"] as
        | JSONObject
        | undefined;

      if (!args) {
        continue;
      }

      for (const argumentId of Object.keys(args)) {
        const value: unknown = args[argumentId];

        if (typeof value !== "string") {
          continue;
        }

        if (unfilled.includes(value.trim())) {
          delete args[argumentId];
        }
      }
    }

    return props.graph;
  };

interface BuildWorkflowProps {
  name: string;
  description: string;
  projectId: ObjectID;
  template?: WorkflowTemplate | null | undefined;
  values?: WorkflowTemplateVariableValues | undefined;
  generateId?: GenerateIdFunction | undefined;
}

export type BuildWorkflowFromTemplateFunction = (
  props: BuildWorkflowProps,
) => Workflow;

/**
 * Builds the Workflow row to POST. A null/absent template yields a blank
 * workflow with an empty graph, which is what "Start from scratch" produces.
 */
export const buildWorkflowFromTemplate: BuildWorkflowFromTemplateFunction = (
  props: BuildWorkflowProps,
): Workflow => {
  const workflow: Workflow = new Workflow();

  workflow.name = props.name.trim();
  workflow.description = props.description.trim();
  workflow.projectId = props.projectId;

  /*
   * Created switched off on purpose: a scheduled template would otherwise
   * start firing against a placeholder URL the moment it is created, and a
   * notification template would fire before its variables exist.
   */
  workflow.isEnabled = false;

  if (!props.template) {
    workflow.graph = { nodes: [], edges: [] };
    return workflow;
  }

  const graph: JSONObject | null = buildGraphForTemplate(
    props.template.id,
    props.generateId || generateWorkflowNodeId,
  );

  if (!graph) {
    throw new Error("This template could not be built.");
  }

  workflow.graph = applyTemplateVariableValuesToGraph({
    graph: graph,
    template: props.template,
    values: props.values || {},
  });

  return workflow;
};

interface BuildVariablesProps {
  template: WorkflowTemplate;
  values: WorkflowTemplateVariableValues;
  workflowId: ObjectID;
  projectId: ObjectID;
}

export type BuildWorkflowVariablesFunction = (
  props: BuildVariablesProps,
) => Array<WorkflowVariable>;

/**
 * The WorkflowVariable rows to write after the workflow exists. Blank optional
 * variables are skipped — `content` is a required column, so there is no such
 * thing as an empty variable, and the matching reference has already been
 * stripped from the graph by applyTemplateVariableValuesToGraph.
 */
export const buildWorkflowVariables: BuildWorkflowVariablesFunction = (
  props: BuildVariablesProps,
): Array<WorkflowVariable> => {
  const variables: Array<WorkflowVariable> = [];

  for (const templateVariable of props.template.variables) {
    const value: string | undefined = props.values[templateVariable.name];

    if (isBlank(value)) {
      continue;
    }

    const variable: WorkflowVariable = new WorkflowVariable();

    variable.name = templateVariable.name;
    variable.description = templateVariable.description;
    variable.content = (value as string).trim();
    variable.workflowId = props.workflowId;
    variable.projectId = props.projectId;

    /*
     * isSecret is declared `string` on a genuinely boolean column, so it needs
     * a cast. It must also be sent explicitly: the column is required and its
     * `defaultValue` is not an `isDefaultValueColumn`, so leaving it undefined
     * is a 400 rather than a false.
     */
    (variable as unknown as { isSecret?: boolean }).isSecret =
      templateVariable.isSecret;

    variables.push(variable);
  }

  return variables;
};

export type TemplateVariableNamesAreValidFunction = (
  template: WorkflowTemplate,
) => boolean;

/**
 * A template's own variable names have to survive being pasted into a
 * reference path. Dots are fatal (the path is split on them), and case has to
 * match exactly, so the picker and the row are always written from this one
 * string.
 */
export const templateVariableNamesAreValid: TemplateVariableNamesAreValidFunction =
  (template: WorkflowTemplate): boolean => {
    return template.variables.every((variable: WorkflowTemplateVariable) => {
      return WORKFLOW_TEMPLATE_VARIABLE_NAME_REGEX.test(variable.name);
    });
  };
