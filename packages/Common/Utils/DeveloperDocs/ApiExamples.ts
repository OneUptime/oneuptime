import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject, JSONValue } from "../../Types/JSON";
import {
  getNameColumn,
  getTerraformAttributes,
  getTerraformModelOperations,
  isModelInPublicApi,
  TerraformAttributeDescriptor,
  TerraformModelOperations,
  TerraformValueKind,
} from "./TerraformSchema";
import {
  getExampleJsonValue,
  ONEUPTIME_API_KEY_ENVIRONMENT_VARIABLE,
} from "./ExampleValues";

/*
 * REST API examples for the dashboard's Developer > API pages: curl commands
 * for one real resource (read, change, delete it) and for its type (list,
 * count, create), against this installation's API.
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

export interface ResourceApiExamples {
  read: ApiExample | null;
  update: ApiExample | null;
  delete: ApiExample | null;
}

export interface CollectionApiExamples {
  list: ApiExample | null;
  count: ApiExample | null;
  create: ApiExample | null;
}

// How many fields a read example asks for, besides the id.
const MAX_READ_EXAMPLE_FIELDS: number = 6;

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
export function getModelApiPath(modelType: DatabaseBaseModelType): string | null {
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

function example(data: {
  method: ApiExampleMethod;
  url: string;
  body?: JSONObject | undefined;
}): ApiExample {
  return {
    method: data.method,
    url: data.url,
    body: data.body,
    curl: getCurlCommand(data),
  };
}

function isReadableExampleField(
  descriptor: TerraformAttributeDescriptor,
): boolean {
  return (
    !descriptor.secretKind &&
    !descriptor.isServerManaged &&
    (descriptor.kind === TerraformValueKind.String ||
      descriptor.kind === TerraformValueKind.Number ||
      descriptor.kind === TerraformValueKind.Bool ||
      descriptor.kind === TerraformValueKind.DateTime)
  );
}

/*
 * The `select` of a read example: the name, then the first few plain fields
 * the model declares (no secrets, no large JSON).
 */
export function getExampleSelect(modelType: DatabaseBaseModelType): JSONObject {
  const select: JSONObject = { _id: true };
  const nameColumn: string | null = getNameColumn(modelType);

  if (nameColumn) {
    select[nameColumn] = true;
  }

  for (const descriptor of getTerraformAttributes(modelType)) {
    if (Object.keys(select).length > MAX_READ_EXAMPLE_FIELDS) {
      break;
    }

    if (isReadableExampleField(descriptor)) {
      select[descriptor.columnName] = true;
    }
  }

  return select;
}

/*
 * The `data` of a change example: a new description when the resource has
 * one, otherwise a new name.
 */
function getExampleUpdateData(data: {
  modelType: DatabaseBaseModelType;
  displayName: string | null;
}): JSONObject | null {
  const attributes: Array<TerraformAttributeDescriptor> = getTerraformAttributes(
    data.modelType,
  ).filter((descriptor: TerraformAttributeDescriptor): boolean => {
    return descriptor.inUpdateSchema;
  });

  const hasColumn: (columnName: string) => boolean = (
    columnName: string,
  ): boolean => {
    return attributes.some((descriptor: TerraformAttributeDescriptor) => {
      return descriptor.columnName === columnName;
    });
  };

  if (hasColumn("description")) {
    return { description: "Updated with the OneUptime API" };
  }

  const nameColumn: string | null = getNameColumn(data.modelType);

  if (nameColumn && hasColumn(nameColumn)) {
    return {
      [nameColumn]: data.displayName
        ? `${data.displayName} (renamed)`
        : "New name",
    };
  }

  return null;
}

/*
 * The `data` of a create example: every field the API requires, with
 * example values, plus the description.
 */
export function getExampleCreateData(data: {
  modelType: DatabaseBaseModelType;
  singularName: string;
  exampleValues?: Record<string, JSONValue> | undefined;
}): JSONObject {
  const nameColumn: string | null = getNameColumn(data.modelType);
  const createData: JSONObject = {};

  for (const descriptor of getTerraformAttributes(data.modelType)) {
    if (!descriptor.inCreateSchema) {
      continue;
    }

    const isNameColumn: boolean = descriptor.columnName === nameColumn;
    const isDescription: boolean = descriptor.columnName === "description";

    if (!descriptor.isRequired && !isNameColumn && !isDescription) {
      continue;
    }

    if (descriptor.kind === TerraformValueKind.Unsupported) {
      continue;
    }

    const exampleValue: JSONValue | undefined =
      data.exampleValues?.[descriptor.columnName];

    if (exampleValue !== undefined) {
      createData[descriptor.columnName] = exampleValue;
    } else if (isDescription) {
      createData[descriptor.columnName] = "Created with the OneUptime API";
    } else {
      createData[descriptor.columnName] = getExampleJsonValue({
        descriptor,
        singularName: data.singularName,
        isNameColumn,
      });
    }
  }

  // The name first, as people read it.
  if (nameColumn && nameColumn in createData) {
    return {
      [nameColumn]: createData[nameColumn] as JSONValue,
      ...createData,
    };
  }

  return createData;
}

// Read, change and delete examples for one resource.
export function getResourceApiExamples(data: {
  modelType: DatabaseBaseModelType;
  apiBaseUrl: string;
  id: string;
  displayName?: string | null | undefined;
}): ResourceApiExamples {
  const path: string | null = getModelApiPath(data.modelType);

  if (!path || !isModelInPublicApi(data.modelType)) {
    return { read: null, update: null, delete: null };
  }

  const operations: TerraformModelOperations = getTerraformModelOperations(
    data.modelType,
  );
  const itemUrl: string = `${data.apiBaseUrl}${path}/${data.id}`;
  const updateData: JSONObject | null = operations.canUpdate
    ? getExampleUpdateData({
        modelType: data.modelType,
        displayName: data.displayName || null,
      })
    : null;

  return {
    read: operations.canRead
      ? example({
          method: "POST",
          url: `${itemUrl}/get-item`,
          body: { select: getExampleSelect(data.modelType) },
        })
      : null,
    update: updateData
      ? example({ method: "PUT", url: itemUrl, body: { data: updateData } })
      : null,
    delete: operations.canDelete
      ? example({ method: "DELETE", url: itemUrl })
      : null,
  };
}

// List, count and create examples for a resource type.
export function getCollectionApiExamples(data: {
  modelType: DatabaseBaseModelType;
  apiBaseUrl: string;
  singularName: string;
  exampleValues?: Record<string, JSONValue> | undefined;
}): CollectionApiExamples {
  const path: string | null = getModelApiPath(data.modelType);

  if (!path || !isModelInPublicApi(data.modelType)) {
    return { list: null, count: null, create: null };
  }

  const operations: TerraformModelOperations = getTerraformModelOperations(
    data.modelType,
  );
  const collectionUrl: string = `${data.apiBaseUrl}${path}`;
  const createData: JSONObject = getExampleCreateData({
    modelType: data.modelType,
    singularName: data.singularName,
    exampleValues: data.exampleValues,
  });

  return {
    list: operations.canRead
      ? example({
          method: "POST",
          url: `${collectionUrl}/get-list?skip=0&limit=10`,
          body: {
            select: getExampleSelect(data.modelType),
            sort: { createdAt: "DESC" },
          },
        })
      : null,
    count: operations.canRead
      ? example({
          method: "POST",
          url: `${collectionUrl}/count`,
          body: { query: {} },
        })
      : null,
    create:
      operations.canCreate && Object.keys(createData).length > 0
        ? example({
            method: "POST",
            url: collectionUrl,
            body: { data: createData },
          })
        : null,
  };
}

// The API reference page for a model: `https://oneuptime.com/reference/workflow`.
export function getApiReferenceUrl(data: {
  modelType: DatabaseBaseModelType;
  oneuptimeUrl: string;
}): string {
  const model: DatabaseBaseModel = new data.modelType();

  return `${data.oneuptimeUrl.replace(/\/+$/, "")}/reference/${model.getAPIDocumentationPath()}`;
}
