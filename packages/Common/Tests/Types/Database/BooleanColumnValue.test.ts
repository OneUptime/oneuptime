import Form from "../../../Models/DatabaseModels/Form";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import {
  coerceBooleanColumnsInJSON,
  getBooleanColumnValueMessage,
  getBooleanColumnWriteError,
  isBooleanTableColumnType,
  isWritableBooleanValue,
  toStoredBoolean,
} from "../../../Types/Database/BooleanColumnValue";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * A SWITCH WRITTEN AS TEXT IS THE SWITCH THE DATABASE STORES.
 *
 * Every Boolean column is a Postgres `boolean`, and Postgres reads a written
 * value as its boolin function does. These pin that reading (toStoredBoolean)
 * literal by literal, what the API and DatabaseService turn a write's Boolean
 * columns into (coerceBooleanColumnsInJSON), and what they refuse, with
 * which message (getBooleanColumnWriteError).
 */

describe("isBooleanTableColumnType", () => {
  test("is the Boolean column type and nothing else", () => {
    expect(isBooleanTableColumnType(TableColumnType.Boolean)).toBe(true);

    for (const type of [
      TableColumnType.ShortText,
      TableColumnType.Number,
      TableColumnType.Date,
      TableColumnType.JSON,
      TableColumnType.Entity,
      TableColumnType.ObjectID,
    ]) {
      expect(isBooleanTableColumnType(type)).toBe(false);
    }

    expect(isBooleanTableColumnType(undefined)).toBe(false);
    expect(isBooleanTableColumnType(null)).toBe(false);
  });
});

describe("toStoredBoolean: what Postgres stores for a value written to a boolean column", () => {
  /*
   * boolin: "true", "yes", "on", "1" and their unique prefixes, in any case,
   * with whitespace around them; the driver sends the number 1 as "1".
   */
  test.each([
    ["true", true],
    ['"true"', "true"],
    ['"TRUE" with spaces around it', "  TRUE "],
    ['"True"', "True"],
    ['"t"', "t"],
    ['"tr"', "tr"],
    ['"tru"', "tru"],
    ['"yes"', "yes"],
    ['"Y"', "Y"],
    ['"ye"', "ye"],
    ['"on"', "on"],
    ['"ON"', "ON"],
    ['"1"', "1"],
    ['"1" with a tab and a newline around it', "\t1\n"],
    ["the number 1", 1],
  ] as Array<[string, unknown]>)(
    "%s is stored as true",
    (_label: string, value: unknown) => {
      expect(toStoredBoolean(value)).toBe(true);
    },
  );

  test.each([
    ["false", false],
    ['"false"', "false"],
    ['"FALSE" with a space before it', " FALSE"],
    ['"f"', "f"],
    ['"fa"', "fa"],
    ['"fal"', "fal"],
    ['"fals"', "fals"],
    ['"no"', "no"],
    ['"n"', "n"],
    ['"No"', "No"],
    ['"off"', "off"],
    ['"of"', "of"],
    ['"OFF"', "OFF"],
    ['"0"', "0"],
    ["the number 0", 0],
  ] as Array<[string, unknown]>)(
    "%s is stored as false",
    (_label: string, value: unknown) => {
      expect(toStoredBoolean(value)).toBe(false);
    },
  );

  test.each([
    ["null", null],
    ["undefined", undefined],
    ['""', ""],
    ['" "', " "],
    ['"o" (on or off: refused)', "o"],
    ['"truex"', "truex"],
    ['"yess"', "yess"],
    ['"onn"', "onn"],
    ['"offf"', "offf"],
    ['"01"', "01"],
    ['"00"', "00"],
    ['"10"', "10"],
    ['"2"', "2"],
    ['"-1"', "-1"],
    ['"maybe"', "maybe"],
    ['"enabled"', "enabled"],
    ["the number 2", 2],
    ["the number -1", -1],
    ["the number 0.5", 0.5],
    ["NaN", NaN],
    ["an object", { value: true }],
    ["a list", [true]],
    ["a date", new Date(0)],
  ] as Array<[string, unknown]>)(
    "%s is left as it is (null, not written, or a value the database refuses)",
    (_label: string, value: unknown) => {
      expect(toStoredBoolean(value)).toBe(value);
    },
  );
});

describe("toStoredBoolean: exactly the literals boolin reads, no more", () => {
  /*
   * boolin skips C's isspace around a literal - space, tab, newline,
   * vertical tab, form feed, carriage return - and nothing else, so a
   * literal wrapped in other whitespace is refused by the database and is
   * no switch here either.
   */
  test.each([
    ["a vertical tab and a form feed", "\vtrue\f", true],
    ["a carriage return and a newline", "\rno\r\n", false],
    ["spaces on both sides", "   off   ", false],
  ] as Array<[string, string, boolean]>)(
    "a literal with %s around it is read",
    (_label: string, value: string, stored: boolean) => {
      expect(toStoredBoolean(value)).toBe(stored);
    },
  );

  test.each([
    ["a non-breaking space", "\u00a0true\u00a0"],
    ["an ideographic space", "\u3000yes"],
    ["a byte order mark", "\ufefffalse"],
    ["a zero-width space", "on\u200b"],
  ] as Array<[string, string]>)(
    "a literal with %s around it is refused, as the database refuses it",
    (_label: string, value: string) => {
      expect(toStoredBoolean(value)).toBe(value);
      expect(isWritableBooleanValue(value)).toBe(false);
    },
  );

  test("-0 is sent as 0, so it is stored as false", () => {
    expect(toStoredBoolean(-0)).toBe(false);
  });

  test('1.0 is the number 1, while the text "1.0" is refused', () => {
    expect(toStoredBoolean(1.0)).toBe(true);
    expect(toStoredBoolean("1.0")).toBe("1.0");
    expect(toStoredBoolean(" 1 ")).toBe(true);
  });

  test("a fullwidth TRUE is not the letters boolin reads", () => {
    expect(toStoredBoolean("\uff34\uff32\uff35\uff25")).toBe(
      "\uff34\uff32\uff35\uff25",
    );
  });

  test("Infinity and a bigint are refused", () => {
    expect(toStoredBoolean(Infinity)).toBe(Infinity);
    expect(isWritableBooleanValue(BigInt(1))).toBe(false);
  });
});

describe("isWritableBooleanValue: what a Boolean column may be written with", () => {
  test.each([
    ["true", true],
    ["false", false],
    ["null (no value)", null],
    ["undefined (not written)", undefined],
    ['"yes"', "yes"],
    ['"off"', "off"],
    ["1", 1],
    ["0", 0],
    [
      "an SQL expression OneUptime writes itself",
      (): string => {
        return 'NOT "isEnabled"';
      },
    ],
  ] as Array<[string, unknown]>)(
    "%s may be written",
    (_label: string, value: unknown) => {
      expect(isWritableBooleanValue(value)).toBe(true);
    },
  );

  test.each([
    ['"maybe"', "maybe"],
    ['""', ""],
    ['"o"', "o"],
    ["2", 2],
    ["0.5", 0.5],
    ["an object", { on: true }],
    ["a list", [false]],
  ] as Array<[string, unknown]>)(
    "%s is refused",
    (_label: string, value: unknown) => {
      expect(isWritableBooleanValue(value)).toBe(false);
    },
  );
});

describe("coerceBooleanColumnsInJSON", () => {
  test("turns every Boolean column into the boolean the database stores, in place", () => {
    const json: JSONObject = {
      isVisibleOnStatusPage: "yes",
      shouldStatusPageSubscribersBeNotifiedOnEventCreated: "0",
      enableReminders: 1,
      title: "Database upgrade",
    };

    const result: JSONObject = coerceBooleanColumnsInJSON(
      json,
      new ScheduledMaintenance(),
    );

    expect(result).toBe(json);
    expect(json).toEqual({
      isVisibleOnStatusPage: true,
      shouldStatusPageSubscribersBeNotifiedOnEventCreated: false,
      enableReminders: true,
      title: "Database upgrade",
    });
  });

  test("never touches a column that is not a switch, whatever it holds", () => {
    const json: JSONObject = {
      title: "true",
      description: "0",
      name: "yes",
    };

    coerceBooleanColumnsInJSON(json, new ScheduledMaintenance());

    expect(json).toEqual({ title: "true", description: "0", name: "yes" });
  });

  test("leaves null, undefined, SQL expressions and refused values as they are", () => {
    const expression: () => string = (): string => {
      return "TRUE";
    };

    const json: JSONObject = {
      isVisibleOnStatusPage: null,
      enableReminders: undefined,
      shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing:
        expression as never,
      shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: "maybe",
      isSomething: "yes",
    } as unknown as JSONObject;

    coerceBooleanColumnsInJSON(json, new ScheduledMaintenance());

    expect(json["isVisibleOnStatusPage"]).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(json, "enableReminders")).toBe(
      true,
    );
    expect(json["enableReminders"]).toBeUndefined();
    expect(
      json["shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing"],
    ).toBe(expression);
    // Left for getBooleanColumnWriteError to refuse.
    expect(
      json["shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded"],
    ).toBe("maybe");
    // Not a column of the model: left alone.
    expect(json["isSomething"]).toBe("yes");
  });

  test("works on a model as well as on a plain object", () => {
    const monitor: Monitor = new Monitor();
    monitor.name = "Checkout";
    (monitor as unknown as Record<string, unknown>)["isArchived"] = "false";
    (monitor as unknown as Record<string, unknown>)["disableActiveMonitoring"] =
      "ON";

    coerceBooleanColumnsInJSON(monitor as unknown as JSONObject, monitor);

    expect(monitor.isArchived).toBe(false);
    expect(monitor.disableActiveMonitoring).toBe(true);
    expect(monitor.name).toBe("Checkout");
  });
});

describe("getBooleanColumnWriteError: one plain message for a switch the database would refuse", () => {
  test("names the column", () => {
    expect(getBooleanColumnValueMessage("isEnabled")).toBe(
      "isEnabled must be true or false.",
    );
  });

  test("null when every switch holds true, false, null or a literal the database stores", () => {
    expect(
      getBooleanColumnWriteError(
        {
          isVisibleOnStatusPage: true,
          shouldStatusPageSubscribersBeNotifiedOnEventCreated: "no",
          enableReminders: null,
          title: "maybe",
        },
        new ScheduledMaintenance(),
      ),
    ).toBeNull();
  });

  test("the first switch, in the order the write names them, that the database would refuse", () => {
    expect(
      getBooleanColumnWriteError(
        {
          title: "not a switch",
          isVisibleOnStatusPage: "maybe",
          shouldStatusPageSubscribersBeNotifiedOnEventCreated: 2,
        },
        new ScheduledMaintenance(),
      ),
    ).toBe("isVisibleOnStatusPage must be true or false.");
  });

  test("an empty text is refused, as Postgres refuses it", () => {
    expect(getBooleanColumnWriteError({ isEnabled: "" }, new Form())).toBe(
      "isEnabled must be true or false.",
    );
  });

  test("a column that is not a switch is never refused here", () => {
    expect(
      getBooleanColumnWriteError(
        { name: { anything: true } } as unknown as JSONObject,
        new Form(),
      ),
    ).toBeNull();
  });
});
