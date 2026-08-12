import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
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

type LogComponentErrorFunction = (data: {
  error: unknown;
  model: BaseModel | null;
  log: RunOptions["log"];
}) => void;

/*
 * Every database component failed the same way before this: two lines in the
 * workflow log and, for all but Create One, nothing at all in the server log.
 */
const logComponentError: LogComponentErrorFunction = (data: {
  error: unknown;
  model: BaseModel | null;
  log: RunOptions["log"];
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
  log(message);

  const hint: string | null = model ? buildColumnHint(message, model) : null;

  if (hint) {
    log(hint);
  }
};

export default logComponentError;
