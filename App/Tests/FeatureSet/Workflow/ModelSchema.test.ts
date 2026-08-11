import { mockRouter } from "Common/Tests/Server/API/Helpers";
import Response from "Common/Server/Utils/Response";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The workflow field picker reads /model-schema/:tableName, and the ID column
 * was the one column it never offered.
 *
 * describeColumns gated every column on the @ColumnAccessControl decorator.
 * "_id" carries no such decorator - the model injects its ACL from its own
 * record-level permissions - so the picker silently dropped it, leaving
 * builders to guess the primary key's name. They guessed "id", and got
 * `Property "id" was not found in "Monitor"` (issue #3132).
 */

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
    },
  };
});

import ModelSchemaAPI from "../../../FeatureSet/Workflow/API/ModelSchema";

interface Column {
  id: string;
  title: string;
  type: string;
  isRelation: boolean;
  relatedColumns?: Array<Column> | undefined;
}

async function getColumnsFor(tableName: string): Promise<Array<Column>> {
  const api: ModelSchemaAPI = new ModelSchemaAPI();

  const req: ExpressRequest = {
    params: { tableName: tableName },
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {} as unknown as ExpressResponse;

  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await api.getModelSchema(req, res, next);

  const sendJsonObjectResponse: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;

  expect(sendJsonObjectResponse).toHaveBeenCalled();

  const body: JSONObject = sendJsonObjectResponse.mock
    .calls[0]![2] as JSONObject;

  return body["columns"] as JSONArray as unknown as Array<Column>;
}

function findColumn(columns: Array<Column>, id: string): Column | undefined {
  return columns.find((column: Column): boolean => {
    return column.id === id;
  });
}

describe("Workflow /model-schema/:tableName", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("offers the _id column, which is what a Query argument is keyed on", async () => {
    const columns: Array<Column> = await getColumnsFor("Monitor");
    const idColumn: Column | undefined = findColumn(columns, "_id");

    expect(idColumn).toBeDefined();
    expect(idColumn?.title).toBe("ID");
    expect(idColumn?.isRelation).toBe(false);
  });

  test("never offers a column called id, because there is no such column", async () => {
    const columns: Array<Column> = await getColumnsFor("Monitor");

    expect(findColumn(columns, "id")).toBeUndefined();
  });

  test("offers the record timestamps alongside it", async () => {
    const columns: Array<Column> = await getColumnsFor("Monitor");

    expect(findColumn(columns, "createdAt")).toBeDefined();
    expect(findColumn(columns, "updatedAt")).toBeDefined();
  });

  test("still offers ordinary decorated columns", async () => {
    const columns: Array<Column> = await getColumnsFor("Monitor");

    expect(findColumn(columns, "name")).toBeDefined();
    expect(findColumn(columns, "monitorType")).toBeDefined();
  });

  test("offers _id on a related record too, so relation selects can pick it", async () => {
    const columns: Array<Column> = await getColumnsFor("Monitor");
    const project: Column | undefined = findColumn(columns, "project");

    expect(project?.isRelation).toBe(true);
    expect(findColumn(project?.relatedColumns || [], "_id")).toBeDefined();
  });

  test("answers with an error for a table that does not exist", async () => {
    const api: ModelSchemaAPI = new ModelSchemaAPI();

    const req: ExpressRequest = {
      params: { tableName: "NotAModel" },
    } as unknown as ExpressRequest;

    await api.getModelSchema(
      req,
      {} as unknown as ExpressResponse,
      jest.fn() as unknown as NextFunction,
    );

    expect(Response.sendErrorResponse).toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
