import {
  coerceDateColumnValue,
  coerceDateColumnsInJSON,
  isDateTableColumnType,
} from "../../../Types/Database/DateColumnValue";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { JSONObject } from "../../../Types/JSON";
import EnterpriseLicense from "../../../Models/DatabaseModels/EnterpriseLicense";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — normalizing a JSON value bound for a date column.
 *
 * HTML has no Date input event: `<input type="date">` hands back
 * `e.target.value`, the string "YYYY-MM-DD". So the dashboard posted a plain
 * string for every date field, `BaseModel.fromJSON` assigned it verbatim, and
 * Postgres quietly parsed it on the way in — which is why nobody noticed until
 * something read the column back off the SAVED model. TypeORM's `save()`
 * returns the entity it was handed, not a re-read row, so:
 *
 *   TypeError: createdItem.expiresAt.toISOString is not a function
 *
 * thrown from EnterpriseLicenseService.onCreateSuccess, AFTER the INSERT had
 * committed. Creating an enterprise licence in the admin dashboard answered
 * "Server Error" every time while writing a licence row every time.
 */

describe("isDateTableColumnType", () => {
  it("covers every column type stored as a JS Date", () => {
    expect(isDateTableColumnType(TableColumnType.Date)).toBe(true);
  });

  /*
   * The types that would be destroyed by coercion. Everything numeric, every
   * string type, and the wrapped objects.
   */
  it("excludes types that are not dates", () => {
    for (const type of [
      TableColumnType.Number,
      TableColumnType.SmallNumber,
      TableColumnType.BigNumber,
      TableColumnType.PositiveNumber,
      TableColumnType.Port,
      TableColumnType.Version,
      TableColumnType.ShortText,
      TableColumnType.LongText,
      TableColumnType.VeryLongText,
      TableColumnType.Boolean,
      TableColumnType.ObjectID,
      TableColumnType.Entity,
      TableColumnType.EntityArray,
      TableColumnType.JSON,
      TableColumnType.Email,
    ]) {
      expect(isDateTableColumnType(type)).toBe(false);
    }
  });

  it("treats a missing type as not a date", () => {
    expect(isDateTableColumnType(undefined)).toBe(false);
    expect(isDateTableColumnType(null)).toBe(false);
  });
});

describe("coerceDateColumnValue", () => {
  it("converts the string an <input type=date> produces", () => {
    const coerced: unknown = coerceDateColumnValue("2027-01-01");

    expect(coerced).toBeInstanceOf(Date);
    expect((coerced as Date).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("converts the string an <input type=datetime-local> produces", () => {
    const coerced: unknown = coerceDateColumnValue("2027-01-01T10:30");

    expect(coerced).toBeInstanceOf(Date);
    expect((coerced as Date).toISOString()).toBe("2027-01-01T10:30:00.000Z");
  });

  it("converts a full ISO instant", () => {
    const coerced: unknown = coerceDateColumnValue("2027-01-01T10:30:00.000Z");

    expect(coerced).toBeInstanceOf(Date);
    expect((coerced as Date).toISOString()).toBe("2027-01-01T10:30:00.000Z");
  });

  it("honours an explicit offset instead of assuming UTC", () => {
    const coerced: unknown = coerceDateColumnValue("2027-01-01T10:30:00+02:00");

    expect(coerced).toBeInstanceOf(Date);
    expect((coerced as Date).toISOString()).toBe("2027-01-01T08:30:00.000Z");
  });

  it("converts the space-separated form Postgres renders", () => {
    const coerced: unknown = coerceDateColumnValue("2027-01-01 10:30:00");

    expect(coerced).toBeInstanceOf(Date);
    expect((coerced as Date).toISOString()).toBe("2027-01-01T10:30:00.000Z");
  });

  it("trims surrounding whitespace before parsing", () => {
    const coerced: unknown = coerceDateColumnValue("  2027-01-01  ");

    expect(coerced).toBeInstanceOf(Date);
    expect((coerced as Date).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  /*
   * The whole point of coercing at all: what lands in Postgres must not
   * change. An offset-less literal in a timestamptz column is parsed in the
   * session timezone, which is UTC in every OneUptime deployment, so reading
   * it as UTC here reproduces the previous stored instant exactly — and does
   * it independently of the timezone the Node process happens to run in,
   * which moment's default local parse would not.
   */
  it("reads an offset-less string as UTC regardless of the host timezone", () => {
    const originalTimezone: string | undefined = process.env["TZ"];

    try {
      process.env["TZ"] = "America/Los_Angeles";

      const coerced: unknown = coerceDateColumnValue("2027-01-01");

      expect((coerced as Date).toISOString()).toBe("2027-01-01T00:00:00.000Z");
    } finally {
      if (originalTimezone === undefined) {
        delete process.env["TZ"];
      } else {
        process.env["TZ"] = originalTimezone;
      }
    }
  });

  it("leaves a Date exactly as it is", () => {
    const date: Date = new Date("2027-01-01T00:00:00.000Z");

    expect(coerceDateColumnValue(date)).toBe(date);
  });

  it("leaves null and undefined alone so a nullable column can be cleared", () => {
    expect(coerceDateColumnValue(null)).toBeNull();
    expect(coerceDateColumnValue(undefined)).toBeUndefined();
  });

  it("does not invent a date for a cleared field", () => {
    expect(coerceDateColumnValue("")).toBe("");
    expect(coerceDateColumnValue("   ")).toBe("   ");
  });

  /*
   * moment's fallback parser accepts almost anything and invents a date for
   * it: "12" becomes 2001-12-01 and "0" becomes 2000-01-01. Handing it every
   * string that lands on a date column would silently manufacture values, so
   * the gate is a recognised ISO shape and nothing else.
   */
  it("refuses the loose strings moment would happily invent a date for", () => {
    for (const garbage of ["12", "0", "1", "2027", "true", "abc", "now"]) {
      expect(coerceDateColumnValue(garbage)).toBe(garbage);
    }
  });

  it("leaves an ISO-shaped but impossible date alone so validation reports it", () => {
    expect(coerceDateColumnValue("2027-13-45")).toBe("2027-13-45");
    expect(coerceDateColumnValue("2027-02-30T99:99")).toBe("2027-02-30T99:99");
  });

  it("leaves non-string, non-date values untouched", () => {
    const object: JSONObject = { a: 1 };
    const array: Array<number> = [1, 2];

    expect(coerceDateColumnValue(object)).toBe(object);
    expect(coerceDateColumnValue(array)).toBe(array);
    expect(coerceDateColumnValue(true)).toBe(true);
    expect(coerceDateColumnValue(42)).toBe(42);
  });
});

/*
 * The update half. `BaseAPI.updateItem` never builds a model — it goes from
 * the request body straight to a partial entity — so it needs the same
 * normalization applied to a loose patch, or a PUT and a POST disagree about
 * what "2027-01-01" is and the save-time hooks see different types depending
 * on which verb the caller used.
 */
describe("coerceDateColumnsInJSON on an update patch", () => {
  it("coerces a date column the patch names", () => {
    const patch: JSONObject = coerceDateColumnsInJSON(
      { expiresAt: "2027-01-01" },
      new EnterpriseLicense(),
    );

    expect(patch["expiresAt"]).toBeInstanceOf(Date);
    expect((patch["expiresAt"] as Date).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  it("leaves the columns it does not own alone", () => {
    const patch: JSONObject = coerceDateColumnsInJSON(
      {
        companyName: "2027-01-01",
        licenseKey: "2027-01-01",
        userLimit: 50,
        isEvaluationLicense: false,
        expiresAt: "2027-01-01",
      },
      new EnterpriseLicense(),
    );

    expect(patch["companyName"]).toBe("2027-01-01");
    expect(patch["licenseKey"]).toBe("2027-01-01");
    expect(patch["userLimit"]).toBe(50);
    expect(patch["isEvaluationLicense"]).toBe(false);
    expect(patch["expiresAt"]).toBeInstanceOf(Date);
  });

  it("ignores keys that are not columns at all", () => {
    const patch: JSONObject = coerceDateColumnsInJSON(
      { notAColumn: "2027-01-01" },
      new EnterpriseLicense(),
    );

    expect(patch["notAColumn"]).toBe("2027-01-01");
  });

  /*
   * A PartialEntity may carry a `() => string` raw SQL expression instead of
   * a literal. Coercion must not stringify or otherwise disturb one.
   */
  it("passes a raw SQL expression through untouched", () => {
    const expression: () => string = (): string => {
      return "NOW()";
    };

    const patch: JSONObject = coerceDateColumnsInJSON(
      { expiresAt: expression as unknown as JSONObject },
      new EnterpriseLicense(),
    );

    expect(patch["expiresAt"]).toBe(expression);
  });

  it("keeps an explicit null so a nullable column can be cleared", () => {
    const patch: JSONObject = coerceDateColumnsInJSON(
      { userCountUpdatedAt: null },
      new EnterpriseLicense(),
    );

    expect(patch["userCountUpdatedAt"]).toBeNull();
  });

  /*
   * The API layer hands this a freshly-constructed model of the entity being
   * updated, so it has to work off an instance rather than the class.
   */
  it("works off any model instance, not just licences", () => {
    const patch: JSONObject = coerceDateColumnsInJSON(
      { disableActiveMonitoringBecauseOfManualIncident: false },
      new Monitor(),
    );

    expect(patch["disableActiveMonitoringBecauseOfManualIncident"]).toBe(false);
  });
});
