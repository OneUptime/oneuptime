import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "../../Types/JSON";
import { ONEUPTIME_API_KEY_ENVIRONMENT_VARIABLE } from "./ExampleValues";

/*
 * The REST API's side of the dashboard's Developer > API pages: where a
 * model's endpoints are, and a request as a curl command against this
 * installation. What the requests carry comes from ExampleBuilder.
 *
 * Every command reads the API key from the same environment variable the
 * Terraform provider uses, so one `export` serves both pages, and no key is
 * ever written into a command.
 */

export type ApiExampleMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface ApiExample {
  method: ApiExampleMethod;
  url: string;
  body?: JSONObject | undefined;
  curl: string;
}

// Characters a POSIX shell leaves alone in an unquoted word.
const SHELL_SAFE_WORD: RegExp = /^[A-Za-z0-9._:@%+,/=-]+$/;

/*
 * One shell word that reaches the command exactly as written: bare when made
 * only of characters the shell leaves alone, otherwise single-quoted (a `'`
 * inside closes the quote, adds an escaped quote and opens it again). A
 * resource named "Bob's API" can therefore not end the quoted JSON early.
 */
export function shellQuote(value: string): string {
  return SHELL_SAFE_WORD.test(value)
    ? value
    : `'${value.split("'").join("'\\''")}'`;
}

/*
 * `https://oneuptime.com/api`: the API's base URL, from the dashboard's
 * origin.
 */
export function getApiBaseUrl(oneuptimeUrl: string): string {
  return `${oneuptimeUrl.replace(/\/+$/, "")}/api`;
}

// `/workflow`, the model's path under the API.
export function getModelApiPath(
  modelType: DatabaseBaseModelType,
): string | null {
  const model: DatabaseBaseModel = new modelType();
  const path: string | undefined = model.crudApiPath?.toString();

  return path ? `/${path.replace(/^\/+/, "")}` : null;
}

/*
 * A curl command for one request: the API key from the environment, and
 * the JSON body pretty-printed inside single quotes.
 */
export function getCurlCommand(data: {
  method: ApiExampleMethod;
  url: string;
  body?: JSONObject | undefined;
}): string {
  const lines: Array<string> = [
    `curl -X ${data.method} ${shellQuote(data.url)}`,
    `-H "ApiKey: $${ONEUPTIME_API_KEY_ENVIRONMENT_VARIABLE}"`,
  ];

  if (data.body) {
    lines.push(`-H "Content-Type: application/json"`);
    lines.push(`-d ${shellQuote(JSON.stringify(data.body, null, 2))}`);
  }

  return lines.join(" \\\n  ");
}

// The API reference page for a model: `https://oneuptime.com/reference/workflow`.
export function getApiReferenceUrl(data: {
  modelType: DatabaseBaseModelType;
  oneuptimeUrl: string;
}): string {
  const model: DatabaseBaseModel = new data.modelType();

  return `${data.oneuptimeUrl.replace(/\/+$/, "")}/reference/${model.getAPIDocumentationPath()}`;
}
