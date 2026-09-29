import CommonModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/CommonModel";
import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";

/*
 * Unit tests for CommonModel — the base every analytics (ClickHouse) model
 * extends. It owns the column-aware value coercion (setColumnValue) and the
 * JSON (de)serialization that the analytics query/ingest layer relies on.
 *
 * Nothing imports CommonModel directly in the existing test suite, so its
 * per-type string coercion and its static/instance JSON helpers were
 * uncovered. The logic is pure: it reads column metadata off the instance,
 * so no ClickHouse connection is required.
 */

// Build a column of a given type. Only key + type matter for these tests.
const column: (key: string, type: TableColumnType) => AnalyticsTableColumn = (
  key: string,
  type: TableColumnType,
): AnalyticsTableColumn => {
  return new AnalyticsTableColumn({
    key,
    title: key,
    description: `${key} column`,
    required: false,
    type,
  });
};

const COLUMNS: Array<AnalyticsTableColumn> = [
  column("name", TableColumnType.Text),
  column("resourceId", TableColumnType.ObjectID),
  column("startsAt", TableColumnType.Date),
  column("observedAt", TableColumnType.DateTime64),
  column("attributes", TableColumnType.JSON),
  column("tags", TableColumnType.JSONArray),
  column("count", TableColumnType.Number),
  column("ratio", TableColumnType.Decimal),
  column("bigCount", TableColumnType.LongNumber),
];

/*
 * A concrete model with a no-arg constructor so the static new type() paths
 * (fromJSON / fromJSONArray) work.
 */
class TestModel extends CommonModel {
  public constructor() {
    super({ tableColumns: COLUMNS });
  }
}

const newModel: () => TestModel = (): TestModel => {
  return new TestModel();
};

describe("CommonModel.getTableColumn", () => {
  test("returns the column when it exists", () => {
    const model: TestModel = newModel();
    const col: AnalyticsTableColumn | null = model.getTableColumn("name");
    expect(col).not.toBeNull();
    expect(col!.key).toBe("name");
    expect(col!.type).toBe(TableColumnType.Text);
  });

  test("returns null for an unknown column", () => {
    expect(newModel().getTableColumn("doesNotExist")).toBeNull();
  });

  test("getTableColumns returns the full column set", () => {
    expect(newModel().getTableColumns()).toHaveLength(COLUMNS.length);
  });
});

describe("CommonModel.setColumnValue coercion by column type", () => {
  test("stores a plain text value unchanged", () => {
    const model: TestModel = newModel();
    model.setColumnValue("name", "hello");
    expect(model.getColumnValue("name")).toBe("hello");
  });

  test("wraps a string into an ObjectID for an ObjectID column", () => {
    const model: TestModel = newModel();
    const id: ObjectID = ObjectID.generate();
    model.setColumnValue("resourceId", id.toString());
    const stored: unknown = model.getColumnValue("resourceId");
    expect(stored).toBeInstanceOf(ObjectID);
    expect((stored as ObjectID).toString()).toBe(id.toString());
  });

  test("parses a string into a Date for Date and DateTime64 columns", () => {
    const model: TestModel = newModel();
    model.setColumnValue("startsAt", "2023-01-15T12:30:00.000Z");
    model.setColumnValue("observedAt", "2023-06-01T00:00:00.000Z");
    expect(model.getColumnValue("startsAt")).toBeInstanceOf(Date);
    expect(model.getColumnValue("observedAt")).toBeInstanceOf(Date);
  });

  test("parses a JSON string for a JSON column", () => {
    const model: TestModel = newModel();
    model.setColumnValue("attributes", '{"env":"prod","n":5}');
    expect(model.getColumnValue("attributes")).toEqual({
      env: "prod",
      n: 5,
    });
  });

  test("falls back to an empty object when the JSON string is invalid", () => {
    const model: TestModel = newModel();
    model.setColumnValue("attributes", "not json {");
    expect(model.getColumnValue("attributes")).toEqual({});
  });

  test("parses a JSON array string for a JSONArray column", () => {
    const model: TestModel = newModel();
    model.setColumnValue("tags", "[1, 2, 3]");
    expect(model.getColumnValue("tags")).toEqual([1, 2, 3]);
  });

  test("falls back to an empty array when the JSONArray string is invalid", () => {
    const model: TestModel = newModel();
    model.setColumnValue("tags", "definitely not an array");
    expect(model.getColumnValue("tags")).toEqual([]);
  });

  test("parses a string into an integer for a Number column", () => {
    const model: TestModel = newModel();
    model.setColumnValue("count", "42");
    expect(model.getColumnValue("count")).toBe(42);
  });

  test("parses a string into a float for a Decimal column", () => {
    const model: TestModel = newModel();
    model.setColumnValue("ratio", "3.14");
    expect(model.getColumnValue("ratio")).toBe(3.14);
  });

  test("parses a string into an integer for a LongNumber column", () => {
    const model: TestModel = newModel();
    model.setColumnValue("bigCount", "1000");
    expect(model.getColumnValue("bigCount")).toBe(1000);
  });

  test("leaves an already-numeric value on a Number column unchanged", () => {
    const model: TestModel = newModel();
    model.setColumnValue("count", 7);
    expect(model.getColumnValue("count")).toBe(7);
  });

  test("throws BadDataException when setting an unknown column", () => {
    const model: TestModel = newModel();
    expect(() => {
      model.setColumnValue("nope", "x");
    }).toThrow(BadDataException);
  });
});

describe("CommonModel.getColumnValue", () => {
  test("returns undefined for an unknown column", () => {
    expect(newModel().getColumnValue("nope")).toBeUndefined();
  });

  test("returns undefined for a known-but-unset column", () => {
    expect(newModel().getColumnValue("name")).toBeUndefined();
  });
});

describe("CommonModel.fromJSON (instance) and toJSON", () => {
  test("fromJSON populates every provided column with coercion", () => {
    const model: CommonModel = newModel().fromJSON({
      name: "widget",
      count: "10",
      ratio: "2.5",
    });

    expect(model.getColumnValue("name")).toBe("widget");
    expect(model.getColumnValue("count")).toBe(10);
    expect(model.getColumnValue("ratio")).toBe(2.5);
  });

  test("toJSON emits set columns and omits unset ones", () => {
    const model: TestModel = newModel();
    model.setColumnValue("name", "widget");
    model.setColumnValue("count", 3);

    const json: Record<string, unknown> = model.toJSON();

    expect(json["name"]).toBe("widget");
    expect(json["count"]).toBe(3);
    // Unset columns serialize to undefined, which JSONFunctions.serialize drops.
    expect(Object.prototype.hasOwnProperty.call(json, "ratio")).toBe(false);
    expect(json["ratio"]).toBeUndefined();
  });

  test("toJSON recursively serializes a nested CommonModel value", () => {
    const parent: TestModel = newModel();
    const child: TestModel = newModel();
    child.setColumnValue("name", "child");

    /*
     * A non-string value on a column is stored as-is, so a nested model
     * survives to toJSON where it is recursively serialized.
     */
    parent.setColumnValue("attributes", child as unknown as never);

    const json: Record<string, unknown> = parent.toJSON();
    expect((json["attributes"] as Record<string, unknown>)["name"]).toBe(
      "child",
    );
  });
});

describe("CommonModel static fromJSON / toJSON", () => {
  test("builds a model instance from a plain JSON object", () => {
    const model: CommonModel = CommonModel.fromJSON(
      { name: "from-json" },
      TestModel,
    ) as CommonModel;

    expect(model).toBeInstanceOf(TestModel);
    expect(model.getColumnValue("name")).toBe("from-json");
  });

  test("returns an already-constructed model unchanged", () => {
    const existing: TestModel = newModel();
    existing.setColumnValue("name", "existing");

    const result: CommonModel = CommonModel.fromJSON(
      existing,
      TestModel,
    ) as CommonModel;

    expect(result).toBe(existing);
  });

  test("builds an array of models, passing through existing instances", () => {
    const existing: TestModel = newModel();
    existing.setColumnValue("name", "kept");

    const result: Array<CommonModel> = CommonModel.fromJSON(
      [{ name: "a" }, existing, { name: "b" }] as never,
      TestModel,
    ) as Array<CommonModel>;

    expect(result).toHaveLength(3);
    expect(result[0]!.getColumnValue("name")).toBe("a");
    expect(result[1]).toBe(existing);
    expect(result[2]!.getColumnValue("name")).toBe("b");
  });

  test("static toJSON delegates to the instance toJSON", () => {
    const model: TestModel = newModel();
    model.setColumnValue("name", "delegated");

    const json: Record<string, unknown> = CommonModel.toJSON(model, TestModel);
    expect(json["name"]).toBe("delegated");
  });
});

describe("CommonModel static fromJSONArray / toJSONArray", () => {
  test("fromJSONArray builds instances and passes through existing ones", () => {
    const existing: TestModel = newModel();
    existing.setColumnValue("name", "kept");

    const models: Array<CommonModel> = CommonModel.fromJSONArray(
      [{ name: "first" }, existing],
      TestModel,
    );

    expect(models).toHaveLength(2);
    expect(models[0]!.getColumnValue("name")).toBe("first");
    expect(models[1]).toBe(existing);
  });

  test("toJSONArray round-trips a list of models to JSON objects", () => {
    const a: TestModel = newModel();
    a.setColumnValue("name", "a");
    const b: TestModel = newModel();
    b.setColumnValue("name", "b");

    const jsonArray: Array<Record<string, unknown>> = CommonModel.toJSONArray(
      [a, b],
      TestModel,
    );

    expect(jsonArray).toHaveLength(2);
    expect(jsonArray[0]!["name"]).toBe("a");
    expect(jsonArray[1]!["name"]).toBe("b");
  });

  test("fromJSONArray then toJSONArray preserves scalar values", () => {
    const input: Array<Record<string, unknown>> = [
      { name: "x", count: 1 },
      { name: "y", count: 2 },
    ];

    const models: Array<CommonModel> = CommonModel.fromJSONArray(
      input as never,
      TestModel,
    );
    const output: Array<Record<string, unknown>> = CommonModel.toJSONArray(
      models,
      TestModel,
    );

    expect(output[0]!["name"]).toBe("x");
    expect(output[0]!["count"]).toBe(1);
    expect(output[1]!["name"]).toBe("y");
    expect(output[1]!["count"]).toBe(2);
  });
});
