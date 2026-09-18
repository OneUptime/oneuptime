import { buildColumnHint } from "../../../../../Server/Types/Workflow/Components/BaseModel/LogComponentError";
import {
  ID_ARGUMENT_KEY,
  PRIMARY_KEY_COLUMN,
  applyTenantColumn,
  describeModelColumns,
  normalizeModelKeys,
} from "../../../../../Server/Types/Workflow/Components/BaseModel/ModelArguments";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import Project from "../../../../../Models/DatabaseModels/Project";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * https://github.com/OneUptime/oneuptime/issues/3132 - a workflow that
 * queried `{"id": "<uuid>"}` failed with
 * `Property "id" was not found in "Monitor". Make sure your query is correct.`
 *
 * "id" is only a TypeScript accessor on the model; the persisted primary key
 * column is "_id". The create path had always rewritten "id" to "_id"
 * (DatabaseBaseModel._fromJSON), so these tests pin the rewrite that makes
 * every other workflow argument agree with create.
 */

const MONITOR_ID: string = "09dc4d63-2fc3-4757-a509-5f688ae38ffd";

describe("normalizeModelKeys", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("rewrites a top-level id to the _id column", () => {
    const result: JSONObject = normalizeModelKeys(
      { id: MONITOR_ID },
      new Monitor(),
    );

    expect(result).toEqual({ _id: MONITOR_ID });
    expect(result[ID_ARGUMENT_KEY]).toBeUndefined();
  });

  test("leaves an explicit _id alone", () => {
    const result: JSONObject = normalizeModelKeys(
      { _id: MONITOR_ID },
      new Monitor(),
    );

    expect(result).toEqual({ _id: MONITOR_ID });
  });

  test("keeps _id and drops id when both are given, whatever the key order", () => {
    const idFirst: JSONObject = normalizeModelKeys(
      { id: "alias", _id: "explicit" },
      new Monitor(),
    );

    const primaryKeyFirst: JSONObject = normalizeModelKeys(
      { _id: "explicit", id: "alias" },
      new Monitor(),
    );

    expect(idFirst).toEqual({ _id: "explicit" });
    expect(primaryKeyFirst).toEqual({ _id: "explicit" });
  });

  test("leaves every other key untouched", () => {
    const result: JSONObject = normalizeModelKeys(
      {
        id: MONITOR_ID,
        monitorType: "Website",
        isEnabled: true,
        disableActiveMonitoringBecauseOfManualIncident: false,
        description: null,
      },
      new Monitor(),
    );

    expect(result).toEqual({
      _id: MONITOR_ID,
      monitorType: "Website",
      isEnabled: true,
      disableActiveMonitoringBecauseOfManualIncident: false,
      description: null,
    });
  });

  test("passes unknown keys through rather than validating them", () => {
    /*
     * Rewriting must not become a whitelist: an argument that reaches the
     * database today has to keep reaching it, right or wrong.
     */
    const result: JSONObject = normalizeModelKeys(
      { notAColumnAtAll: "value" },
      new Monitor(),
    );

    expect(result).toEqual({ notAColumnAtAll: "value" });
  });

  test("returns a new object and does not mutate the input", () => {
    const input: JSONObject = { id: MONITOR_ID };
    const result: JSONObject = normalizeModelKeys(input, new Monitor());

    expect(result).not.toBe(input);
    expect(input).toEqual({ id: MONITOR_ID });
  });

  test("handles an empty object", () => {
    expect(normalizeModelKeys({}, new Monitor())).toEqual({});
  });

  test("rewrites id inside a related record on an Entity column", () => {
    const result: JSONObject = normalizeModelKeys(
      { project: { id: true, name: true } },
      new Monitor(),
    );

    expect(result).toEqual({ project: { _id: true, name: true } });
  });

  test("rewrites id inside a related record on an EntityArray column", () => {
    const result: JSONObject = normalizeModelKeys(
      { labels: { id: true } },
      new Monitor(),
    );

    expect(result).toEqual({ labels: { _id: true } });
  });

  test("rewrites the alias at both levels at once", () => {
    const result: JSONObject = normalizeModelKeys(
      { id: MONITOR_ID, currentMonitorStatus: { id: true } },
      new Monitor(),
    );

    expect(result).toEqual({
      _id: MONITOR_ID,
      currentMonitorStatus: { _id: true },
    });
  });

  test("does not descend into a JSON column, whose keys are not column names", () => {
    /*
     * customFields is a JSON blob. An "id" in there belongs to the customer's
     * own data and renaming it would corrupt the value.
     */
    const result: JSONObject = normalizeModelKeys(
      { customFields: { id: "belongs-to-the-customer" } },
      new Monitor(),
    );

    expect(result).toEqual({
      customFields: { id: "belongs-to-the-customer" },
    });
  });

  test("does not descend into a serialized value", () => {
    /*
     * ObjectID, Date and every QueryHelper operator travel as
     * { "_type": ..., "value": ... }. Those are values, not column maps.
     */
    const result: JSONObject = normalizeModelKeys(
      {
        project: { _type: "ObjectID", value: MONITOR_ID, id: "not-a-column" },
      },
      new Monitor(),
    );

    expect(result).toEqual({
      project: { _type: "ObjectID", value: MONITOR_ID, id: "not-a-column" },
    });
  });

  test("leaves array values alone", () => {
    const result: JSONObject = normalizeModelKeys(
      { _id: ["first", "second"], labels: [{ id: "untouched" }] },
      new Monitor(),
    );

    expect(result).toEqual({
      _id: ["first", "second"],
      labels: [{ id: "untouched" }],
    });
  });

  test("leaves a relation queried by a plain id string alone", () => {
    const result: JSONObject = normalizeModelKeys(
      { project: MONITOR_ID },
      new Monitor(),
    );

    expect(result).toEqual({ project: MONITOR_ID });
  });

  test("works on any model, not just Monitor", () => {
    const result: JSONObject = normalizeModelKeys(
      { id: MONITOR_ID, name: true },
      new Project(),
    );

    expect(result).toEqual({ _id: MONITOR_ID, name: true });
  });

  test("keeps id as-is on a model that owns a column called id", () => {
    /*
     * No model ships an "id" column today. One that grew one would mean
     * something different by "id", so the alias has to stand down.
     */
    const model: Monitor = new Monitor();

    jest
      .spyOn(model, "hasColumn")
      .mockImplementation((columnName: string): boolean => {
        return columnName === ID_ARGUMENT_KEY || columnName === "_id";
      });

    expect(normalizeModelKeys({ id: MONITOR_ID }, model)).toEqual({
      id: MONITOR_ID,
    });
  });

  test("exports the key names it rewrites between", () => {
    expect(ID_ARGUMENT_KEY).toBe("id");
    expect(PRIMARY_KEY_COLUMN).toBe("_id");
  });
});

describe("applyTenantColumn", () => {
  const PROJECT_ID: ObjectID = ObjectID.generate();

  test("stamps the scalar tenant column", () => {
    const result: JSONObject = applyTenantColumn(
      { isEnabled: true },
      new Monitor(),
      PROJECT_ID,
    );

    expect(result).toEqual({ isEnabled: true, projectId: PROJECT_ID });
  });

  test("overwrites a projectId the caller supplied", () => {
    const result: JSONObject = applyTenantColumn(
      { projectId: "some-other-project" },
      new Monitor(),
      PROJECT_ID,
    );

    expect(result["projectId"]).toBe(PROJECT_ID);
  });

  test("drops the relation that writes the same column as the tenant column", () => {
    /*
     * Monitor.project is @JoinColumn({name: "projectId"}), so TypeORM writes
     * the tenant column from the relation property and ignores the scalar.
     * Left in place, a payload naming another project moved the record there.
     */
    const result: JSONObject = applyTenantColumn(
      { name: "keep me", project: "some-other-project" },
      new Monitor(),
      PROJECT_ID,
    );

    expect(result).toEqual({ name: "keep me", projectId: PROJECT_ID });
    expect(result["project"]).toBeUndefined();
  });

  test("drops the relation whichever spelling it takes", () => {
    const asObject: JSONObject = applyTenantColumn(
      { project: { _id: "some-other-project" } },
      new Monitor(),
      PROJECT_ID,
    );

    const asAlias: JSONObject = applyTenantColumn(
      normalizeModelKeys(
        { project: { id: "some-other-project" } },
        new Monitor(),
      ),
      new Monitor(),
      PROJECT_ID,
    );

    expect(asObject).toEqual({ projectId: PROJECT_ID });
    expect(asAlias).toEqual({ projectId: PROJECT_ID });
  });

  test("keeps relations that point at some other column", () => {
    const result: JSONObject = applyTenantColumn(
      { currentMonitorStatus: { _id: MONITOR_ID } },
      new Monitor(),
      PROJECT_ID,
    );

    expect(result["currentMonitorStatus"]).toEqual({ _id: MONITOR_ID });
    expect(result["projectId"]).toBe(PROJECT_ID);
  });

  test("leaves a model without a tenant column untouched", () => {
    const model: Monitor = new Monitor();
    jest.spyOn(model, "getTenantColumn").mockReturnValue(null);

    const input: JSONObject = { name: "unchanged" };
    const result: JSONObject = applyTenantColumn(input, model, PROJECT_ID);

    expect(result).toBe(input);
    expect(result["projectId"]).toBeUndefined();
  });

  test("does not mutate the input", () => {
    const input: JSONObject = { project: "some-other-project" };
    applyTenantColumn(input, new Monitor(), PROJECT_ID);

    expect(input).toEqual({ project: "some-other-project" });
  });
});

describe("describeModelColumns", () => {
  test("lists the model's real columns, sorted", () => {
    const columns: string = describeModelColumns(new Monitor());

    expect(columns).toContain("_id");
    expect(columns).toContain("monitorType");
    expect(columns).toContain("projectId");
    expect(columns).not.toContain(" id,");
  });

  test("is sorted so the list is scannable", () => {
    const columns: Array<string> = describeModelColumns(new Monitor()).split(
      ", ",
    );

    const sorted: Array<string> = [...columns].sort(
      (a: string, b: string): number => {
        return a.localeCompare(b);
      },
    );

    expect(columns).toEqual(sorted);
  });
});

describe("buildColumnHint", () => {
  test("points id at _id, which is the mistake in issue 3132", () => {
    const hint: string | null = buildColumnHint(
      'Property "id" was not found in "Monitor". Make sure your query is correct.',
      new Monitor(),
    );

    expect(hint).toContain('"id" is not a column on Monitor');
    expect(hint).toContain('Use "_id" instead');
    expect(hint).toContain("monitorType");
  });

  test("names the offending column and lists the real ones", () => {
    const hint: string | null = buildColumnHint(
      'Property "currentStatus" was not found in "Monitor". Make sure your query is correct.',
      new Monitor(),
    );

    expect(hint).toContain('"currentStatus" is not a column on Monitor');
    expect(hint).toContain("Query, Select and Data");
    expect(hint).toContain("currentMonitorStatusId");
  });

  test("returns null for an error that is not about an unknown column", () => {
    expect(
      buildColumnHint("connect ECONNREFUSED 127.0.0.1:5432", new Monitor()),
    ).toBeNull();
  });
});
