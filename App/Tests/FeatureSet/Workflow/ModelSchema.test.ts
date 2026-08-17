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

import ModelSchemaAPI, {
  ModelSchemaAccess,
  parseAccess,
} from "../../../FeatureSet/Workflow/API/ModelSchema";

interface Column {
  id: string;
  title: string;
  description?: string | undefined;
  type: string;
  isRelation: boolean;
  relatedColumns?: Array<Column> | undefined;
  required?: boolean | undefined;
  hasDefault?: boolean | undefined;
  isTenantColumn?: boolean | undefined;
  example?: string | undefined;
  placeholder?: string | undefined;
}

/*
 * Reads the body of the last response, not the first: a test that asks for the
 * same model under both gates calls the handler twice against the same mock.
 */
async function getSchemaFor(
  tableName: string,
  access?: string | undefined,
): Promise<JSONObject> {
  const api: ModelSchemaAPI = new ModelSchemaAPI();

  const req: ExpressRequest = {
    params: { tableName: tableName },
    /*
     * Express always hands the handler a query object, so the helper carries
     * one even when the caller names no access. The handler still reads it with
     * `?.` — see the test below that passes a request without one at all.
     */
    query: access === undefined ? {} : { access: access },
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {} as unknown as ExpressResponse;

  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await api.getModelSchema(req, res, next);

  const sendJsonObjectResponse: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;

  expect(sendJsonObjectResponse).toHaveBeenCalled();

  return sendJsonObjectResponse.mock.calls[
    sendJsonObjectResponse.mock.calls.length - 1
  ]![2] as JSONObject;
}

async function getColumnsFor(
  tableName: string,
  access?: string | undefined,
): Promise<Array<Column>> {
  const body: JSONObject = await getSchemaFor(tableName, access);

  return body["columns"] as JSONArray as unknown as Array<Column>;
}

function columnIds(columns: Array<Column>): Array<string> {
  return columns.map((column: Column): string => {
    return column.id;
  });
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

  /*
   * The handler reaches for req.query?.["access"], and the guard is not
   * decoration: the callers this endpoint has always had do not necessarily
   * carry a query object, and reading it unguarded would turn every one of
   * their requests into a 500.
   */
  test("answers a request that carries no query object at all", async () => {
    const api: ModelSchemaAPI = new ModelSchemaAPI();

    const req: ExpressRequest = {
      params: { tableName: "Monitor" },
    } as unknown as ExpressRequest;

    const next: NextFunction = jest.fn() as unknown as NextFunction;

    await api.getModelSchema(req, {} as unknown as ExpressResponse, next);

    const sendJsonObjectResponse: jest.Mock =
      Response.sendJsonObjectResponse as unknown as jest.Mock;

    expect(next).not.toHaveBeenCalled();
    expect(sendJsonObjectResponse).toHaveBeenCalled();

    const body: JSONObject = sendJsonObjectResponse.mock
      .calls[0]![2] as JSONObject;

    expect(body["access"]).toBe("read");
    expect((body["columns"] as JSONArray).length).toBeGreaterThan(0);
  });
});

/*
 * parseAccess is the whole of the gate's input validation, so it is written to
 * be uninteresting: only the exact string "write" opens the write gate, and
 * every other value - including the ones a query string can smuggle in, like an
 * array from ?access=write&access=write - lands on the read default.
 */
describe("parseAccess", () => {
  test("returns write for exactly the string write", () => {
    const access: ModelSchemaAccess = parseAccess("write");

    expect(access).toBe("write");
  });

  const nonWriteValues: Array<unknown> = [
    "read",
    undefined,
    null,
    "",
    "WRITE",
    "Write",
    "write ",
    " write",
    "anything",
    123,
    0,
    true,
    ["write"],
    { access: "write" },
  ];

  nonWriteValues.forEach((value: unknown): void => {
    test(`falls back to read for ${JSON.stringify(value)}`, () => {
      expect(parseAccess(value)).toBe("read");
    });
  });
});

/*
 * The read gate answers "which column may this workflow name in a Select or a
 * Query", and the write gate answers "which column may it put a value into".
 * They are not the same question, and MonitorSecret is the proof: secretValue
 * declares `read: []` with full create and update lists (MonitorSecret.ts
 * lines 219-245), so the one column the Create Monitor Secret component exists
 * to fill is invisible to a reader. Shipping the ?access=write parameter
 * without the hasWriteAccess gate, or the gate without the parameter, would
 * have left that column unreachable either way.
 */
describe("Workflow /model-schema/:tableName access gate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("defaults to the read gate when no access is asked for", async () => {
    const body: JSONObject = await getSchemaFor("Monitor");

    expect(body["tableName"]).toBe("Monitor");
    expect(body["access"]).toBe("read");
  });

  test("the default answer is the same set of columns as an explicit read", async () => {
    const defaulted: Array<Column> = await getColumnsFor("Monitor");
    const explicit: Array<Column> = await getColumnsFor("Monitor", "read");

    expect(columnIds(defaulted)).toEqual(columnIds(explicit));
  });

  test("reports back the access it applied", async () => {
    const body: JSONObject = await getSchemaFor("MonitorSecret", "write");

    expect(body["access"]).toBe("write");
  });

  test("an unrecognised access value is answered on the read gate", async () => {
    const body: JSONObject = await getSchemaFor("MonitorSecret", "readwrite");
    const columns: Array<Column> = body[
      "columns"
    ] as JSONArray as unknown as Array<Column>;

    expect(body["access"]).toBe("read");
    expect(findColumn(columns, "secretValue")).toBeUndefined();
  });

  test("hides MonitorSecret.secretValue under the read gate, because no role may read it", async () => {
    const columns: Array<Column> = await getColumnsFor("MonitorSecret");

    expect(findColumn(columns, "secretValue")).toBeUndefined();
    // The rest of the model is still there — this is one column, not a blanket.
    expect(findColumn(columns, "name")).toBeDefined();
  });

  test("offers MonitorSecret.secretValue under the write gate, which is the only way to write one", async () => {
    const columns: Array<Column> = await getColumnsFor(
      "MonitorSecret",
      "write",
    );
    const secretValue: Column | undefined = findColumn(columns, "secretValue");

    expect(secretValue).toBeDefined();
    expect(secretValue?.title).toBe("Secret Value");
    expect(secretValue?.isRelation).toBe(false);
  });

  /*
   * The gate has to cut both ways, or "write" would just mean "read plus the
   * secrets". Monitor.slug declares `create: []` and `update: []` with a full
   * read list (Monitor.ts lines 273-285): it is computed on save, so offering
   * it in a create payload would invite a value the write path throws away.
   */
  test("drops a readable-but-not-writable column under the write gate", async () => {
    const read: Array<Column> = await getColumnsFor("Monitor", "read");
    const write: Array<Column> = await getColumnsFor("Monitor", "write");

    expect(findColumn(read, "slug")).toBeDefined();
    expect(findColumn(write, "slug")).toBeUndefined();
  });

  /*
   * Pointing a new record at a related row means naming a row that already
   * exists, so the relation's own columns stay on the read gate even when the
   * request is for writable columns. MonitorSecret.monitors relates to Monitor,
   * whose slug is readable and not writable - if the related columns had
   * inherited the write gate it would be missing here.
   */
  test("describes related columns on the read gate even under a write request", async () => {
    const columns: Array<Column> = await getColumnsFor(
      "MonitorSecret",
      "write",
    );
    const monitors: Column | undefined = findColumn(columns, "monitors");

    expect(monitors?.isRelation).toBe(true);
    expect(findColumn(monitors?.relatedColumns || [], "slug")).toBeDefined();
    expect(findColumn(monitors?.relatedColumns || [], "_id")).toBeDefined();
  });
});

/*
 * The record editor builds its form from this response alone, so what a model
 * declares about a column has to survive the trip: whether a create must supply
 * it, whether it can be left out, whether the runner stamps it anyway, and what
 * a plausible value looks like.
 */
describe("Workflow /model-schema/:tableName column descriptors", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("carries required through from the model", async () => {
    const columns: Array<Column> = await getColumnsFor("Monitor");

    expect(findColumn(columns, "name")?.required).toBe(true);
    expect(findColumn(columns, "description")?.required).toBe(false);
  });

  /*
   * The record editor labels each field with the model's own title and prints
   * this sentence under it, so a column described here with nothing to say
   * arrives on screen as a bare name. It was produced but asserted nowhere.
   */
  test("carries the model's own title and description for a column", async () => {
    const columns: Array<Column> = await getColumnsFor("Monitor");
    const name: Column | undefined = findColumn(columns, "name");

    expect(name?.title).toBe("Name");
    expect(typeof name?.description).toBe("string");
    expect((name?.description as string).length).toBeGreaterThan(0);
  });

  /*
   * hasDefault is what tells the editor a required column still need not be
   * typed into. Monitor.disableActiveMonitoring is exactly that case: required
   * true, isDefaultValueColumn true, defaultValue false (Monitor.ts lines
   * 995-1010).
   */
  test("marks a required column that carries a default", async () => {
    const columns: Array<Column> = await getColumnsFor("Monitor");
    const disableMonitoring: Column | undefined = findColumn(
      columns,
      "disableActiveMonitoring",
    );

    expect(disableMonitoring?.required).toBe(true);
    expect(disableMonitoring?.hasDefault).toBe(true);
    expect(findColumn(columns, "name")?.hasDefault).toBe(false);
  });

  /*
   * The tenant column is stamped by the runner, so both the id column and the
   * relation sharing it have to be flagged - Monitor declares
   * @TenantColumn("projectId") and gives project the manyToOneRelationColumn
   * "projectId" (Monitor.ts lines 48 and 128).
   */
  test("flags the tenant column and the relation that shares it", async () => {
    const columns: Array<Column> = await getColumnsFor("Monitor");

    expect(findColumn(columns, "projectId")?.isTenantColumn).toBe(true);
    expect(findColumn(columns, "project")?.isTenantColumn).toBe(true);
    expect(findColumn(columns, "name")?.isTenantColumn).toBe(false);
  });

  test("carries the example the model declares", async () => {
    const columns: Array<Column> = await getColumnsFor("Monitor");

    expect(findColumn(columns, "name")?.example).toBe("Production API Server");
    // A boolean example is still useful in a one-line input, so it is kept.
    expect(findColumn(columns, "disableActiveMonitoring")?.example).toBe(
      "false",
    );
  });

  /*
   * The example that matters most is the one only a write request can see: a
   * builder filling secretValue has nothing else to go on, since the column is
   * unreadable by design.
   */
  test("carries the example of a write-only column through the write gate", async () => {
    const columns: Array<Column> = await getColumnsFor(
      "MonitorSecret",
      "write",
    );
    const secretValue: Column | undefined = findColumn(columns, "secretValue");

    expect(secretValue?.example).toBe("sk_test_1234567890abcdefghijklmnop");
    expect(secretValue?.required).toBe(false);
    expect(secretValue?.hasDefault).toBe(false);
    expect(secretValue?.isTenantColumn).toBe(false);
  });

  /*
   * example is typed loosely because the same metadata feeds the API reference,
   * where a JSON column's example is a whole object. Stringifying one would put
   * "[object Object]" in a placeholder, so it is dropped instead.
   * Dashboard.dashboardViewConfig declares `example: { components: [], layout:
   * "grid" }` (Dashboard.ts line 490).
   */
  test("drops an example that is not a scalar", async () => {
    const columns: Array<Column> = await getColumnsFor("Dashboard");
    const viewConfig: Column | undefined = findColumn(
      columns,
      "dashboardViewConfig",
    );

    expect(viewConfig).toBeDefined();
    expect(viewConfig?.example).toBeUndefined();
  });

  test("never hands back an example that is not a string", async () => {
    const models: Array<string> = ["Monitor", "Dashboard", "MonitorSecret"];

    for (const model of models) {
      const columns: Array<Column> = await getColumnsFor(model);

      for (const column of columns) {
        expect(["string", "undefined"]).toContain(typeof column.example);
      }
    }
  });
});
