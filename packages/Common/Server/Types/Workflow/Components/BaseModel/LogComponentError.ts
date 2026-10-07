import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { Argument } from "../../../../../Types/Workflow/Component";
import {
  getCreateFromTemplateArgument,
  getCreateFromTemplateColumn,
} from "../../../../../Types/Workflow/CreateFromTemplate";
import NotAuthenticatedException from "../../../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import CallerPlan from "../../../../Utils/Billing/CallerPlan";
import ColumnWriteRefusedException from "../../../Database/Permissions/ColumnWriteRefusedException";
import logger from "../../../../Utils/Logger";
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
}) => string | null;

/*
 * A step acts as a Project Admin of its project, on the project's plan
 * (WorkflowPrincipal). When it is refused for either - something only an
 * owner, or the billing team, or nobody but OneUptime itself may do;
 * something the plan does not sell - the run log says so in plain words and
 * names the step, before the reason the refusal itself gave. Refusals are
 * told by their type (a column refusal is a ColumnWriteRefusedException),
 * never by their words. Null for any other failure.
 */
export const describeRefusal: DescribeRefusalFunction = (data: {
  error: unknown;
  message: string;
  stepTitle: string;
}): string | null => {
  const step: string = `"${data.stepTitle}"`;

  if (data.message === CallerPlan.PLAN_UNKNOWN_MESSAGE) {
    return `${step} did not run: ${data.message}`;
  }

  if (data.error instanceof PaymentRequiredException) {
    return `${step} was refused because of this project's plan: ${data.message}`;
  }

  if (
    data.error instanceof NotAuthorizedException ||
    data.error instanceof NotAuthenticatedException ||
    data.error instanceof ColumnWriteRefusedException
  ) {
    return `${step} was refused. Workflow steps can do only what a Project Admin of this project can do: ${data.message}`;
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
}) => void;

/*
 * Every database component failed the same way before this: two lines in the
 * workflow log and, for all but Create One, nothing at all in the server log.
 */
const logComponentError: LogComponentErrorFunction = (data: {
  error: unknown;
  model: BaseModel | null;
  log: RunOptions["log"];
  stepTitle?: string | undefined;
}): void => {
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
      })
    : null;

  log(refusal || message);

  const hint: string | null = model ? buildColumnHint(message, model) : null;

  if (hint) {
    log(hint);
  }

  const templateHint: string | null = buildTemplateColumnHint({
    error: error,
    model: model,
  });

  if (templateHint) {
    log(templateHint);
  }
};

export default logComponentError;
