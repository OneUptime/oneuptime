import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LogDropFilter from "../../../Models/DatabaseModels/LogDropFilter";
import TraceDropFilter from "../../../Models/DatabaseModels/TraceDropFilter";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import LogDropFilterAction from "../../../Types/Log/LogDropFilterAction";
import { coerceNumericColumnsInJSON } from "../../../Types/Database/NumericColumnValue";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Port from "../../../Types/Port";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — what a number column holds after a JSON round trip.
 *
 * `BaseModel.fromJSON` is the single door every model comes through, and it
 * runs on BOTH sides of the wire: ModelForm builds the model it is about to
 * POST with it, and BaseAPI rebuilds that model from the request body with
 * it. That makes it the one place that can fix the following, once.
 *
 * HTML has no numeric input event — `<input type="number">` gives you
 * `e.target.value`, a string — so the dashboard posted "10" for every number
 * field in the product. Postgres coerces '10' to 10 on the way in, so this
 * was invisible everywhere except where something reads the value before it
 * is stored. The drop-filter save hook does exactly that, and a user who
 * typed a perfectly good sample percentage got:
 *
 *   HTTP 400 — Sample percentage is required when the action is "Sample".
 *
 * github.com/OneUptime/oneuptime/issues/3027
 */

describe("BaseModel.fromJSON on number columns", () => {
  /*
   * The reported payload, as the dashboard actually sends it: every scalar
   * that came from a text-ish input is a string.
   */
  it("turns the dashboard's sample-filter payload into real numbers", () => {
    const posted: JSONObject = {
      name: "Sample healthcheck logs",
      filterQuery: "body LIKE 'healthcheck'",
      action: LogDropFilterAction.Sample,
      samplePercentage: "10",
      sortOrder: "1",
      isEnabled: true,
    };

    const model: LogDropFilter = BaseModel.fromJSON(
      posted,
      LogDropFilter,
    ) as LogDropFilter;

    expect(model.samplePercentage).toBe(10);
    expect(typeof model.samplePercentage).toBe("number");
    expect(model.sortOrder).toBe(1);
    expect(typeof model.sortOrder).toBe("number");
  });

  it("does the same for trace drop filters", () => {
    const model: TraceDropFilter = BaseModel.fromJSON(
      {
        action: "sample",
        samplePercentage: "25",
        filterQuery: "name = 'GET /health'",
      },
      TraceDropFilter,
    ) as TraceDropFilter;

    expect(model.samplePercentage).toBe(25);
  });

  it("accepts a percentage that was already a number", () => {
    const model: LogDropFilter = BaseModel.fromJSON(
      { samplePercentage: 10 },
      LogDropFilter,
    ) as LogDropFilter;

    expect(model.samplePercentage).toBe(10);
  });

  it("keeps the whole usable percentage range intact", () => {
    for (const percentage of [1, 5, 10, 50, 99]) {
      const model: LogDropFilter = BaseModel.fromJSON(
        { samplePercentage: String(percentage) },
        LogDropFilter,
      ) as LogDropFilter;

      expect(model.samplePercentage).toBe(percentage);
    }
  });

  it("leaves an unset percentage unset rather than defaulting it to zero", () => {
    const model: LogDropFilter = BaseModel.fromJSON(
      { action: LogDropFilterAction.Drop, filterQuery: "severityText='Debug'" },
      LogDropFilter,
    ) as LogDropFilter;

    expect(model.samplePercentage).toBeUndefined();
  });

  it("leaves a null percentage null", () => {
    const model: LogDropFilter = BaseModel.fromJSON(
      { samplePercentage: null },
      LogDropFilter,
    ) as LogDropFilter;

    expect(model.samplePercentage).toBeNull();
  });

  /*
   * `Number("")` is 0, and 0 is a meaningful sample percentage the validator
   * rejects on purpose. Inventing it from a cleared field would turn a
   * user's blank into a rejection about a value they never typed.
   */
  it("does not turn a cleared field into zero", () => {
    const model: LogDropFilter = BaseModel.fromJSON(
      { samplePercentage: "" },
      LogDropFilter,
    ) as LogDropFilter;

    expect(model.samplePercentage).not.toBe(0);
  });

  it("leaves unparsable text alone for validation to reject", () => {
    const model: LogDropFilter = BaseModel.fromJSON(
      { samplePercentage: "abc" },
      LogDropFilter,
    ) as LogDropFilter;

    expect(model.samplePercentage).toBe("abc" as unknown as number);
  });

  /*
   * This is deliberately not drop-filter specific: the string arrived from a
   * shared form component, so the fix has to hold for every number column or
   * the next hook that reads one before storage repeats issue 3027.
   */
  it("applies to number columns on unrelated models too", () => {
    const monitor: Monitor = BaseModel.fromJSON(
      { name: "API", minimumProbeAgreement: "3" },
      Monitor,
    ) as Monitor;

    expect(monitor.minimumProbeAgreement).toBe(3);
  });

  it("does not touch columns that merely look numeric", () => {
    const model: LogDropFilter = BaseModel.fromJSON(
      {
        name: "12345",
        action: "sample",
        filterQuery: "1234",
        samplePercentage: "10",
      },
      LogDropFilter,
    ) as LogDropFilter;

    expect(model.name).toBe("12345");
    expect(model.filterQuery).toBe("1234");
    expect(model.action).toBe("sample");
    // ...while the number column beside them is still coerced.
    expect(model.samplePercentage).toBe(10);
  });

  it("still deserializes the columns beside it normally", () => {
    const projectId: string = "22222222-2222-4222-8222-222222222222";

    const model: LogDropFilter = BaseModel.fromJSON(
      {
        projectId: new ObjectID(projectId).toJSON(),
        samplePercentage: "10",
      },
      LogDropFilter,
    ) as LogDropFilter;

    expect(model.projectId).toBeInstanceOf(ObjectID);
    expect(model.projectId?.toString()).toBe(projectId);
    expect(model.samplePercentage).toBe(10);
  });

  /*
   * The browser leg of the same trip: ModelForm hands fromJSON the raw form
   * values and then serializes the result as the request body. If coercion
   * did not survive toJSON, the server would still receive a string.
   */
  it("survives the toJSON that turns the model into a request body", () => {
    const model: LogDropFilter = BaseModel.fromJSON(
      {
        name: "Sample healthcheck logs",
        filterQuery: "body LIKE 'healthcheck'",
        action: LogDropFilterAction.Sample,
        samplePercentage: "10",
      },
      LogDropFilter,
    ) as LogDropFilter;

    const body: JSONObject = BaseModel.toJSON(model, LogDropFilter);

    expect(body["samplePercentage"]).toBe(10);

    const rebuilt: LogDropFilter = BaseModel.fromJSON(
      body,
      LogDropFilter,
    ) as LogDropFilter;

    expect(rebuilt.samplePercentage).toBe(10);
  });

  /*
   * `droppedCount` is bigint and ingest-owned. The API serializes it as a
   * number, but a client (or a driver) handing back the string form must not
   * leave a string on a column the dashboard does arithmetic on.
   */
  it("normalizes a bigint counter that arrives as a string", () => {
    const model: LogDropFilter = BaseModel.fromJSON(
      { droppedCount: "4294967296" },
      LogDropFilter,
    ) as LogDropFilter;

    expect(model.droppedCount).toBe(4294967296);
  });

  /*
   * Not every `TableColumnType.Number` column holds a bare number in
   * memory: an SMTP port is declared Number but typed `Port`, and it is
   * written through Port's own transformer. Coercing "587" to 587 there is
   * only safe because that transformer accepts a raw number — so assert the
   * pair, not just the coercion.
   */
  it("keeps a Port column storable after coercing its string form", () => {
    const config: GlobalConfig = BaseModel.fromJSON(
      { smtpPort: "587" },
      GlobalConfig,
    ) as GlobalConfig;

    expect(config.smtpPort).toBe(587 as unknown as Port);
    expect(Port.getDatabaseTransformer().to(config.smtpPort)).toBe(587);
  });
});

/*
 * The update half. `BaseAPI.updateItem` never builds a model — it goes from
 * the request body straight to a partial entity — so it needs the same
 * normalization applied to a loose patch, or a PATCH and a POST disagree
 * about what "10" is and the save-time hooks see different types depending
 * on which verb the caller used.
 */
describe("coerceNumericColumnsInJSON on an update patch", () => {
  it("coerces a number column the patch names", () => {
    const patch: JSONObject = coerceNumericColumnsInJSON(
      { samplePercentage: "25" },
      new LogDropFilter(),
    );

    expect(patch["samplePercentage"]).toBe(25);
  });

  it("leaves the columns it does not own alone", () => {
    const patch: JSONObject = coerceNumericColumnsInJSON(
      {
        name: "12345",
        action: "sample",
        filterQuery: "severityText = 'Debug'",
        samplePercentage: "25",
        isEnabled: false,
      },
      new LogDropFilter(),
    );

    expect(patch["name"]).toBe("12345");
    expect(patch["action"]).toBe("sample");
    expect(patch["filterQuery"]).toBe("severityText = 'Debug'");
    expect(patch["isEnabled"]).toBe(false);
    expect(patch["samplePercentage"]).toBe(25);
  });

  it("ignores keys that are not columns at all", () => {
    const patch: JSONObject = coerceNumericColumnsInJSON(
      { notAColumn: "10" },
      new LogDropFilter(),
    );

    expect(patch["notAColumn"]).toBe("10");
  });

  /*
   * A PartialEntity may carry a `() => string` raw SQL expression instead of
   * a literal. Coercion must not stringify or otherwise disturb one.
   */
  it("passes a raw SQL expression through untouched", () => {
    const expression: () => string = (): string => {
      return '"samplePercentage" + 1';
    };

    const patch: JSONObject = coerceNumericColumnsInJSON(
      { samplePercentage: expression as unknown as JSONObject },
      new LogDropFilter(),
    );

    expect(patch["samplePercentage"]).toBe(expression);
  });

  it("does not invent a value for a cleared field", () => {
    const patch: JSONObject = coerceNumericColumnsInJSON(
      { samplePercentage: "" },
      new LogDropFilter(),
    );

    expect(patch["samplePercentage"]).not.toBe(0);
  });

  it("keeps an explicit null so a nullable column can be cleared", () => {
    const patch: JSONObject = coerceNumericColumnsInJSON(
      { samplePercentage: null },
      new LogDropFilter(),
    );

    expect(patch["samplePercentage"]).toBeNull();
  });

  /*
   * The API layer hands this a freshly-constructed model of the entity
   * being updated, so it has to work off an instance rather than the class.
   */
  it("works off any model instance, not just drop filters", () => {
    const patch: JSONObject = coerceNumericColumnsInJSON(
      { minimumProbeAgreement: "3" },
      new Monitor(),
    );

    expect(patch["minimumProbeAgreement"]).toBe(3);
  });
});
