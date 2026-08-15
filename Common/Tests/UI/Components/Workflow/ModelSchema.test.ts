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
  requiredWritableColumns,
} from "../../../../UI/Components/Workflow/ModelSchema";
import API from "../../../../UI/Utils/API/API";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Every `type` here is a TableColumnType *value*, because that is what the
 * endpoint puts on the wire — JSON.stringify of a string enum emits the value.
 *
 * This is worth being explicit about, because several values differ from the
 * member name that reads like the obvious literal: ShortText is "Text",
 * ObjectID is "Object ID", PositiveNumber is "Positive Number". These tests
 * previously asserted against the member names, so they passed while the code
 * they covered classified the two most-declared non-relation types wrongly.
 */
type MakeColumnFunction = (
  overrides: Partial<ModelSchemaColumn>,
) => ModelSchemaColumn;

const makeColumn: MakeColumnFunction = (
  overrides: Partial<ModelSchemaColumn>,
): ModelSchemaColumn => {
  return {
    id: "name",
    title: "Name",
    type: TableColumnType.ShortText,
    isRelation: false,
    ...overrides,
  };
};

describe("isScalarColumn", () => {
  test("accepts the column types a single input can hold", () => {
    const scalarTypes: Array<string> = [
      TableColumnType.ShortText,
      TableColumnType.LongText,
      TableColumnType.VeryLongText,
      TableColumnType.ObjectID,
      TableColumnType.Number,
      TableColumnType.PositiveNumber,
      TableColumnType.Boolean,
      TableColumnType.Date,
      TableColumnType.Email,
      TableColumnType.LongURL,
      TableColumnType.Markdown,
      TableColumnType.Slug,
      TableColumnType.Port,
    ];

    for (const type of scalarTypes) {
      expect(isScalarColumn(makeColumn({ type: type }))).toBe(true);
    }
  });

  /*
   * The exact regression: "Text" is what the wire carries for a ShortText
   * column, and it is the single most common column type in the schema.
   */
  test('accepts a ShortText column, which arrives on the wire as "Text"', () => {
    expect(isScalarColumn(makeColumn({ type: "Text" }))).toBe(true);
  });

  test('accepts an ObjectID column, which arrives as "Object ID"', () => {
    expect(isScalarColumn(makeColumn({ type: "Object ID" }))).toBe(true);
  });

  test("rejects a relation, however it is typed", () => {
    expect(
      isScalarColumn(
        makeColumn({ type: TableColumnType.ShortText, isRelation: true }),
      ),
    ).toBe(false);
    expect(
      isScalarColumn(
        makeColumn({ type: TableColumnType.Entity, isRelation: true }),
      ),
    ).toBe(false);
  });

  test("rejects types a single box cannot hold", () => {
    expect(isScalarColumn(makeColumn({ type: TableColumnType.JSON }))).toBe(
      false,
    );
    expect(isScalarColumn(makeColumn({ type: TableColumnType.Buffer }))).toBe(
      false,
    );
    expect(
      isScalarColumn(makeColumn({ type: TableColumnType.EntityArray })),
    ).toBe(false);
    expect(
      isScalarColumn(makeColumn({ type: TableColumnType.MonitorSteps })),
    ).toBe(false);
  });

  test("rejects a type it has never heard of", () => {
    expect(isScalarColumn(makeColumn({ type: "SomethingNew" }))).toBe(false);
  });

  /*
   * Guards the whole class of bug above: no member NAME may be accepted unless
   * it happens to also be a value. If someone reintroduces a hand-written
   * literal list, this fails.
   */
  test("never classifies on the enum member name", () => {
    const values: Array<string> = Object.values(TableColumnType);

    for (const [name] of Object.entries(TableColumnType)) {
      if (values.includes(name)) {
        continue;
      }

      expect(isScalarColumn(makeColumn({ type: name }))).toBe(false);
    }
  });
});

describe("isNumericColumn", () => {
  test("is true for every numeric width", () => {
    const numericTypes: Array<string> = [
      TableColumnType.Number,
      TableColumnType.SmallNumber,
      TableColumnType.BigNumber,
      TableColumnType.PositiveNumber,
      TableColumnType.SmallPositiveNumber,
      TableColumnType.BigPositiveNumber,
      TableColumnType.Port,
    ];

    for (const type of numericTypes) {
      expect(isNumericColumn(makeColumn({ type: type }))).toBe(true);
    }
  });

  test("is false for everything else", () => {
    expect(
      isNumericColumn(makeColumn({ type: TableColumnType.ShortText })),
    ).toBe(false);
    expect(isNumericColumn(makeColumn({ type: TableColumnType.Boolean }))).toBe(
      false,
    );
  });

  test("is false for a relation, whatever it is typed", () => {
    expect(
      isNumericColumn(
        makeColumn({ type: TableColumnType.Number, isRelation: true }),
      ),
    ).toBe(false);
  });
});

describe("isBooleanColumn", () => {
  test("is true only for Boolean", () => {
    expect(isBooleanColumn(makeColumn({ type: TableColumnType.Boolean }))).toBe(
      true,
    );
    expect(
      isBooleanColumn(makeColumn({ type: TableColumnType.ShortText })),
    ).toBe(false);
  });
});

/*
 * The record editor opens with a blank row for each of these, so getting the
 * set wrong is immediately visible: too many rows and the builder is asked for
 * values the server would have supplied, too few and the create fails.
 */
describe("requiredWritableColumns", () => {
  test("keeps a required column with no default", () => {
    const columns: Array<ModelSchemaColumn> = [
      makeColumn({ id: "name", required: true }),
    ];

    expect(
      requiredWritableColumns(columns).map((c: ModelSchemaColumn) => {
        return c.id;
      }),
    ).toEqual(["name"]);
  });

  test("drops optional columns", () => {
    expect(
      requiredWritableColumns([makeColumn({ id: "description" })]),
    ).toEqual([]);
    expect(
      requiredWritableColumns([
        makeColumn({ id: "description", required: false }),
      ]),
    ).toEqual([]);
  });

  /*
   * DatabaseService.checkRequiredFields exempts a column carrying a default, so
   * asking the builder for one would be asking for something the create does
   * not need.
   */
  test("drops a required column that has a default", () => {
    expect(
      requiredWritableColumns([
        makeColumn({ id: "createdAt", required: true, hasDefault: true }),
      ]),
    ).toEqual([]);
  });

  /*
   * applyTenantColumn stamps the project itself and discards anything supplied
   * for it, so a row for it could only ever mislead.
   */
  test("drops the project column even when it is required", () => {
    expect(
      requiredWritableColumns([
        makeColumn({ id: "projectId", required: true, isTenantColumn: true }),
      ]),
    ).toEqual([]);
  });

  test("drops relations, because a row holds one scalar", () => {
    expect(
      requiredWritableColumns([
        makeColumn({
          id: "monitorStatus",
          required: true,
          isRelation: true,
          type: TableColumnType.Entity,
        }),
      ]),
    ).toEqual([]);
  });

  test("treats a column from an older response, with no flags, as optional", () => {
    expect(requiredWritableColumns([makeColumn({ id: "name" })])).toEqual([]);
  });

  test("picks only the required ones out of a realistic mix", () => {
    const columns: Array<ModelSchemaColumn> = [
      makeColumn({ id: "_id", required: true, hasDefault: true }),
      makeColumn({ id: "projectId", required: true, isTenantColumn: true }),
      makeColumn({ id: "name", required: true }),
      makeColumn({ id: "secretValue", required: true }),
      makeColumn({ id: "description" }),
    ];

    expect(
      requiredWritableColumns(columns).map((c: ModelSchemaColumn) => {
        return c.id;
      }),
    ).toEqual(["name", "secretValue"]);
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

  type RequestedUrlFunction = () => string;

  const requestedUrl: RequestedUrlFunction = (): string => {
    const call: { url: { toString: () => string } } = (
      API.get as unknown as jest.Mock
    ).mock.calls[0][0] as { url: { toString: () => string } };

    return call.url.toString();
  };

  /*
   * The read request has to keep the URL it always had. The field picker and
   * the query builder are both gated on read access deliberately — filtering on
   * a column your role cannot read is a disclosure vector — so an accidental
   * "access" parameter on those would widen what they offer.
   */
  test("asks for read access by default, without saying so", async () => {
    mockGet({ data: { columns: [] } });

    await fetchModelSchema("Monitor");

    expect(requestedUrl()).not.toContain("access");
  });

  test("says nothing extra when read is asked for explicitly", async () => {
    mockGet({ data: { columns: [] } });

    await fetchModelSchema("Monitor", "read");

    expect(requestedUrl()).not.toContain("access");
  });

  /*
   * Write access is what makes MonitorSecret.secretValue visible: it declares
   * read: [] with full create and update lists, so under the read gate the one
   * column Create One Monitor Secret exists to write is absent.
   */
  test("asks for write access when the record editor needs it", async () => {
    mockGet({ data: { columns: [] } });

    await fetchModelSchema("MonitorSecret", "write");

    expect(requestedUrl()).toContain("access=write");
  });

  test("escapes the table name into the path", async () => {
    mockGet({ data: { columns: [] } });

    await fetchModelSchema("Weird/Name");

    expect(requestedUrl()).toContain("Weird%2FName");
    expect(requestedUrl()).not.toContain("Weird/Name");
  });
});
