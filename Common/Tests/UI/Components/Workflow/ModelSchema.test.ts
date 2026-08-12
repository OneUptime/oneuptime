jest.mock("../../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(),
      getFriendlyMessage: jest.fn((err: unknown) => {
        return String(err);
      }),
    },
  };
});

import {
  ModelSchemaColumn,
  fetchModelSchema,
  findColumn,
  isBooleanColumn,
  isNumericColumn,
  isScalarColumn,
} from "../../../../UI/Components/Workflow/ModelSchema";
import API from "../../../../UI/Utils/API/API";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import { afterEach, describe, expect, test } from "@jest/globals";

type MakeColumnFunction = (
  overrides: Partial<ModelSchemaColumn>,
) => ModelSchemaColumn;

const makeColumn: MakeColumnFunction = (
  overrides: Partial<ModelSchemaColumn>,
): ModelSchemaColumn => {
  return {
    id: "name",
    title: "Name",
    type: "ShortText",
    isRelation: false,
    ...overrides,
  };
};

describe("isScalarColumn", () => {
  test("accepts the column types a single input can hold", () => {
    const scalarTypes: Array<string> = [
      "ShortText",
      "LongText",
      "ObjectID",
      "Number",
      "Boolean",
      "Date",
      "Email",
      "URL",
      "Markdown",
    ];

    for (const type of scalarTypes) {
      expect(isScalarColumn(makeColumn({ type: type }))).toBe(true);
    }
  });

  test("rejects a relation, however it is typed", () => {
    expect(
      isScalarColumn(makeColumn({ type: "ShortText", isRelation: true })),
    ).toBe(false);
    expect(
      isScalarColumn(makeColumn({ type: "Entity", isRelation: true })),
    ).toBe(false);
  });

  test("rejects types a single box cannot hold", () => {
    expect(isScalarColumn(makeColumn({ type: "JSON" }))).toBe(false);
    expect(isScalarColumn(makeColumn({ type: "Buffer" }))).toBe(false);
    expect(isScalarColumn(makeColumn({ type: "EntityArray" }))).toBe(false);
  });

  test("rejects a type it has never heard of", () => {
    expect(isScalarColumn(makeColumn({ type: "SomethingNew" }))).toBe(false);
  });
});

describe("isNumericColumn", () => {
  test("is true for the two numeric types", () => {
    expect(isNumericColumn(makeColumn({ type: "Number" }))).toBe(true);
    expect(isNumericColumn(makeColumn({ type: "PositiveNumber" }))).toBe(true);
  });

  test("is false for everything else", () => {
    expect(isNumericColumn(makeColumn({ type: "ShortText" }))).toBe(false);
    expect(isNumericColumn(makeColumn({ type: "Boolean" }))).toBe(false);
  });
});

describe("isBooleanColumn", () => {
  test("is true only for Boolean", () => {
    expect(isBooleanColumn(makeColumn({ type: "Boolean" }))).toBe(true);
    expect(isBooleanColumn(makeColumn({ type: "ShortText" }))).toBe(false);
  });
});

describe("findColumn", () => {
  const columns: Array<ModelSchemaColumn> = [
    makeColumn({ id: "_id" }),
    makeColumn({ id: "name" }),
  ];

  test("finds a column by id", () => {
    expect(findColumn(columns, "_id")?.id).toBe("_id");
  });

  test("returns nothing for an id that isn't there", () => {
    expect(findColumn(columns, "id")).toBeUndefined();
  });

  test("is case sensitive, as column names are", () => {
    expect(findColumn(columns, "Name")).toBeUndefined();
  });

  test("copes with an empty list", () => {
    expect(findColumn([], "name")).toBeUndefined();
  });
});

describe("fetchModelSchema", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  type MockedGetFunction = (value: unknown) => void;

  const mockGet: MockedGetFunction = (value: unknown): void => {
    (API.get as unknown as jest.Mock).mockResolvedValue(value);
  };

  test("returns the columns the endpoint sent", async () => {
    mockGet({
      data: { tableName: "Monitor", columns: [makeColumn({ id: "_id" })] },
    });

    const columns: Array<ModelSchemaColumn> = await fetchModelSchema("Monitor");

    expect(columns).toHaveLength(1);
    expect(columns[0]?.id).toBe("_id");
  });

  test("returns an empty list when the endpoint sends no columns", async () => {
    mockGet({ data: { tableName: "Monitor" } });

    await expect(fetchModelSchema("Monitor")).resolves.toEqual([]);
  });

  test("throws when the endpoint answers with an error", async () => {
    const errorResponse: HTTPErrorResponse = new HTTPErrorResponse(
      500,
      { message: "boom" },
      {},
    );

    mockGet(errorResponse);

    await expect(fetchModelSchema("Monitor")).rejects.toBe(errorResponse);
  });

  test("escapes the table name into the path", async () => {
    mockGet({ data: { columns: [] } });

    await fetchModelSchema("Weird/Name");

    const call: { url: { toString: () => string } } = (
      API.get as unknown as jest.Mock
    ).mock.calls[0][0] as { url: { toString: () => string } };

    expect(call.url.toString()).toContain("Weird%2FName");
    expect(call.url.toString()).not.toContain("Weird/Name");
  });
});
