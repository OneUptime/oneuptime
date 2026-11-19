import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { Argument } from "../../../../../Types/Workflow/Component";
import {
  getCreateFromTemplateArgument,
  getCreateFromTemplateColumn,
} from "../../../../../Types/Workflow/CreateFromTemplate";
import NotAuthenticatedException from "../../../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import ProductSwitchedOffException from "../../../../../Types/Exception/ProductSwitchedOffException";
import CallerPlan from "../../../../Utils/Billing/CallerPlan";
import ColumnWriteRefusedException from "../../../Database/Permissions/ColumnWriteRefusedException";
import WorkflowAccessChangeRefusedException from "../../../Database/Permissions/WorkflowAccessChangeRefusedException";
import logger from "../../../../Utils/Logger";
import { WorkflowRunAsGrant } from "../../../../Utils/Workflow/WorkflowPrincipal";
import {
  WorkflowRunAs,
  describeWorkflowRunAs,
} from "../../../../../Types/Workflow/WorkflowRunAs";
import { RunOptions } from "../../ComponentCode";
import {
  ID_ARGUMENT_KEY,
  PRIMARY_KEY_COLUMN,
  describeModelColumns,
} from "./ModelArguments";

/*
 * TypeORM's EntityPropertyNotFoundError reads
 * `Property "foo" was not found in "Monitor". Make sure your query is correct.`
 * On its own that tells a workflow builder nothing they can act on: it names
 * neither the argument at fault nor anything they can pick from, and it says
 * "query" even when the offending key was in Data. Everything the builder
 * needs is already on the model, so the components append it.
 */
const UNKNOWN_PROPERTY_PATTERN: RegExp =
  /Property "([^"]+)" was not found in "([^"]+)"/;

type BuildColumnHintFunction = (
  message: string,
  model: BaseModel,
) => string | null;

export const buildColumnHint: BuildColumnHintFunction = (
  message: string,
  model: BaseModel,
): string | null => {
  const match: RegExpMatchArray | null = message.match(
    UNKNOWN_PROPERTY_PATTERN,
  );

  if (!match) {
    return null;
  }

  const property: string = match[1] as string;
  const modelName: string = model.singularName || (match[2] as string);

  if (property === ID_ARGUMENT_KEY) {
    return `Tip: "${ID_ARGUMENT_KEY}" is not a column on ${modelName}. Use "${PRIMARY_KEY_COLUMN}" instead. Columns you can use: ${describeModelColumns(
      model,
    )}.`;
  }

  return `Tip: "${property}" is not a column on ${modelName}. Check every key in this component's Query, Select and Data arguments. Columns you can use: ${describeModelColumns(
    model,
  )}.`;
};

type DescribeRefusalFunction = (data: {
  error: unknown;
  message: string;
  stepTitle: string;
  // What the run acts as (RunOptions.runAs); the default permissions when absent.
  runAs?: WorkflowRunAsGrant | undefined;
}) => string | null;

/*
 * What a refused step of a run that acts as `runAs` was held to, as the run
 * log says it: "Workflow steps can do only what a Project Admin of this
 * project can do" for the default permissions, as it always said; what a
 * Project Owner can do, or what the custom role allows, for a workflow
 * that runs as one (#9695).
 */
export const describeStepCeiling: (
  runAs?: WorkflowRunAsGrant | undefined,
) => string = (runAs?: WorkflowRunAsGrant | undefined): string => {
  switch (runAs?.runAs) {
    case WorkflowRunAs.ProjectOwner:
      return "This workflow runs as Project Owner, so its steps can do only what a Project Owner of this project can do";
    case WorkflowRunAs.CustomRole:
      return `This workflow runs as ${describeWorkflowRunAs({
        runAs: WorkflowRunAs.CustomRole,
        customRoleName: runAs.customRoleName,
      })}, so its steps can do only what that role allows`;
    default:
      return "Workflow steps can do only what a Project Admin of this project can do";
  }
};

/*
 * A step acts as what its workflow runs as - a Project Admin of its project
 * by default - on the project's plan (WorkflowPrincipal). When it is
 * refused for either - something only an owner, or the billing team, or
 * nobody but OneUptime itself may do; something the plan does not sell -
 * the run log says so in plain words and names the step, before the
 * reason the refusal itself gave. A change to who may do what in the
 * project that the step may not make whatever it holds - any change, for a
 * workflow that runs with the default permissions, and an API key's or a
 * sign-in setting's for every workflow - says its reason as it is
 * (WorkflowAccessChangeRefusedException). Refusals are told by their type
 * (a column refusal is a ColumnWriteRefusedException), never by their
 * words. Null for any other failure.
 */
export const describeRefusal: DescribeRefusalFunction = (data: {
  error: unknown;
  message: string;
  stepTitle: string;
  runAs?: WorkflowRunAsGrant | undefined;
}): string | null => {
  const step: string = `"${data.stepTitle}"`;

  if (data.message === CallerPlan.PLAN_UNKNOWN_MESSAGE) {
    return `${step} did not run: ${data.message}`;
  }

  if (data.error instanceof PaymentRequiredException) {
    return `${step} was refused because of this project's plan: ${data.message}`;
  }

  if (data.error instanceof WorkflowAccessChangeRefusedException) {
    return `${step} was refused. ${data.message}`;
  }

  /*
   * The record's product is switched off on the server (#7479): no step
   * changes it, whatever a Project Admin may do, and the words say who can
   * switch it on.
   */
  if (ProductSwitchedOffException.isException(data.error)) {
    return `${step} was refused. ${data.message}`;
  }

  if (
    data.error instanceof NotAuthorizedException ||
    data.error instanceof NotAuthenticatedException ||
    data.error instanceof ColumnWriteRefusedException
  ) {
    return `${step} was refused. ${describeStepCeiling(data.runAs)}: ${data.message}`;
  }

  return null;
};

type BuildTemplateColumnHintFunction = (data: {
  error: unknown;
  model: BaseModel | null;
}) => string | null;

/*
 * A Create One step refused the column its record remembers its template
 * in (createdIncidentTemplateId) - the way a workflow declared an incident
 * from a template before steps acted as a Project Admin. The step has a
 * setting for that now (Types/Workflow/CreateFromTemplate), and the run log
 * says so. Told by the refusal's type and its column, never by its words.
 */
export const buildTemplateColumnHint: BuildTemplateColumnHintFunction = (data: {
  error: unknown;
  model: BaseModel | null;
}): string | null => {
  if (!(data.error instanceof ColumnWriteRefusedException) || !data.model) {
    return null;
  }

  const tableName: string | undefined = data.model.tableName || undefined;
  const templateColumn: string | null = getCreateFromTemplateColumn(tableName);
  const argument: Argument | null = getCreateFromTemplateArgument(tableName);

  if (
    !templateColumn ||
    !argument ||
    data.error.columnName !== templateColumn
  ) {
    return null;
  }

  return `Tip: to declare the ${data.model.singularName || "record"} from a template, pick the template under ${argument.name} on this step, and take "${templateColumn}" out of JSON Object.`;
};

type LogComponentErrorFunction = (data: {
  error: unknown;
  model: BaseModel | null;
  log: RunOptions["log"];
  // The step's title, as the builder shows it ("Create One Team Permission").
  stepTitle?: string | undefined;
  // What the run acts as (RunOptions.runAs), for what a refusal says it was held to.
  runAs?: WorkflowRunAsGrant | undefined;
}) => string;

/*
 * Every database component failed the same way before this: two lines in the
 * workflow log and, for all but Create One, nothing at all in the server log.
 *
 * Returns what it wrote after "Error running component" - the refusal or the
 * message, then any tip - as one paragraph. The step hands it on as the
 * reason it took its Error output (RunReturnType.executePortReason), which
 * the run window's Steps view shows under that output: a failed database
 * step used to say why only in the Full Log, while the Steps view - the tab
 * a run opens on - showed the step failed and nothing more.
 */
const logComponentError: LogComponentErrorFunction = (data: {
  error: unknown;
  model: BaseModel | null;
  log: RunOptions["log"];
  stepTitle?: string | undefined;
  runAs?: WorkflowRunAsGrant | undefined;
}): string => {
  const { error, model, log } = data;

  logger.error(error);

  const errorMessage: unknown = (error as { message?: unknown } | null)
    ?.message;

  const message: string =
    typeof errorMessage === "string" && errorMessage
      ? errorMessage
      : JSON.stringify(error, null, 2);

  log("Error running component");

  const refusal: string | null = data.stepTitle
    ? describeRefusal({
        error: error,
        message: message,
        stepTitle: data.stepTitle,
        runAs: data.runAs,
      })
    : null;

  const reason: Array<string> = [refusal || message];

  log(refusal || message);

  const hint: string | null = model ? buildColumnHint(message, model) : null;

  if (hint) {
    log(hint);
    reason.push(hint);
  }

  const templateHint: string | null = buildTemplateColumnHint({
    error: error,
    model: model,
  });

  if (templateHint) {
    log(templateHint);
    reason.push(templateHint);
  }

  return reason.join(" ");
};

export default logComponentError;
