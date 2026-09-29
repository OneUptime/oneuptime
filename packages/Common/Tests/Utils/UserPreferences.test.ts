import UserPreferences, {
  UserPreferenceType,
} from "../../Utils/UserPreferences";
import { JSONObject } from "../../Types/JSON";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * UserPreferences is the only thing standing between a table's saved layout and
 * real browser storage, so the two properties worth pinning are:
 *
 *  1. Namespacing. Every entry lands under `${UserPreferenceType}.${key}`. Two
 *     tables, and two kinds of preference on the same table, must never land in
 *     the same slot - a collision there means changing a page size silently
 *     wipes a column layout.
 *  2. The read guard. localStorage is user-editable and can be left half
 *     written by a closing tab, so anything that comes back as the wrong type
 *     has to degrade to "no preference" instead of being handed to the caller,
 *     which would spread the bad value through the column-preference code.
 *
 * These run against the real jsdom localStorage rather than a mock, so the raw
 * keys asserted below are exactly what ships in a browser. Jest runs with
 * --runInBand and storage leaks between files, hence the clear() below.
 */

const TABLE_KEY: string = "monitors-table";
const OTHER_TABLE_KEY: string = "incidents-table";

type ReadRawFn = (key: string) => string | null;

const readRaw: ReadRawFn = (key: string): string | null => {
  return window.localStorage.getItem(key);
};

describe("UserPreferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  describe("UserPreferenceType", () => {
    /*
     * These strings are baked into every user's localStorage. Renaming one does
     * not migrate anything - it just makes every saved preference unreachable,
     * so everyone's table silently resets to the default layout.
     */
    test("exposes the stable persisted key for column layouts", () => {
      expect(UserPreferenceType.BaseModelTableColumns).toBe(
        "BaseModelTableColumns",
      );
    });

    test("keeps the pre-existing page size key unchanged", () => {
      expect(UserPreferenceType.BaseModelTablePageSize).toBe(
        "BaseModelTablePageSize",
      );
    });
  });

  describe("key namespacing", () => {
    test("stores a number under `${UserPreferenceType}.${key}`", () => {
      UserPreferences.saveUserPreferenceByTypeAsNumber({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTablePageSize,
        value: 25,
      });

      expect(readRaw("BaseModelTablePageSize.monitors-table")).toBe("25");
    });

    test("stores an object under `${UserPreferenceType}.${key}`", () => {
      UserPreferences.saveUserPreferenceByTypeAsJSON({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        value: { order: ["name"], hidden: [] },
      });

      const raw: string | null = readRaw(
        "BaseModelTableColumns.monitors-table",
      );

      expect(raw).not.toBeNull();
      expect(JSON.parse(raw as string)).toEqual({
        order: ["name"],
        hidden: [],
      });
    });

    // Two tables on the same page must not overwrite each other's layout.
    test("two tables with different keys do not collide", () => {
      UserPreferences.saveUserPreferenceByTypeAsJSON({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        value: { order: ["monitor-name"], hidden: ["monitor-status"] },
      });

      UserPreferences.saveUserPreferenceByTypeAsJSON({
        key: OTHER_TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        value: { order: ["incident-title"], hidden: [] },
      });

      expect(readRaw("BaseModelTableColumns.monitors-table")).not.toBe(
        readRaw("BaseModelTableColumns.incidents-table"),
      );

      expect(
        UserPreferences.getUserPreferenceByTypeAsJSON({
          key: TABLE_KEY,
          userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        }),
      ).toEqual({ order: ["monitor-name"], hidden: ["monitor-status"] });

      expect(
        UserPreferences.getUserPreferenceByTypeAsJSON({
          key: OTHER_TABLE_KEY,
          userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        }),
      ).toEqual({ order: ["incident-title"], hidden: [] });
    });

    /*
     * One table holds both a page size and a column layout under the same
     * userPreferencesKey. The type prefix is the only thing keeping them apart.
     */
    test("two preference types on the same table key do not collide", () => {
      UserPreferences.saveUserPreferenceByTypeAsNumber({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTablePageSize,
        value: 50,
      });

      UserPreferences.saveUserPreferenceByTypeAsJSON({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        value: { order: ["name"], hidden: ["description"] },
      });

      expect(readRaw("BaseModelTablePageSize.monitors-table")).toBe("50");
      expect(readRaw("BaseModelTableColumns.monitors-table")).not.toBeNull();

      expect(
        UserPreferences.getUserPreferenceByTypeAsNumber({
          key: TABLE_KEY,
          userPreferenceType: UserPreferenceType.BaseModelTablePageSize,
        }),
      ).toBe(50);

      expect(
        UserPreferences.getUserPreferenceByTypeAsJSON({
          key: TABLE_KEY,
          userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        }),
      ).toEqual({ order: ["name"], hidden: ["description"] });
    });

    test("a value saved under one type is invisible to another type", () => {
      UserPreferences.saveUserPreferenceByTypeAsNumber({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTablePageSize,
        value: 25,
      });

      expect(
        UserPreferences.getUserPreferenceByTypeAsNumber({
          key: TABLE_KEY,
          userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        }),
      ).toBeNull();

      expect(
        UserPreferences.getUserPreferenceByTypeAsJSON({
          key: TABLE_KEY,
          userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        }),
      ).toBeNull();
    });
  });

  describe("number preferences", () => {
    test("saves and reads back a page size", () => {
      UserPreferences.saveUserPreferenceByTypeAsNumber({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTablePageSize,
        value: 25,
      });

      expect(
        UserPreferences.getUserPreferenceByTypeAsNumber({
          key: TABLE_KEY,
          userPreferenceType: UserPreferenceType.BaseModelTablePageSize,
        }),
      ).toBe(25);
    });

    // A number must not come back as the string localStorage actually holds.
    test("reads back a number, not the stored string", () => {
      UserPreferences.saveUserPreferenceByTypeAsNumber({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTablePageSize,
        value: 10,
      });

      expect(
        typeof UserPreferences.getUserPreferenceByTypeAsNumber({
          key: TABLE_KEY,
          userPreferenceType: UserPreferenceType.BaseModelTablePageSize,
        }),
      ).toBe("number");
    });

    test("the newest value wins", () => {
      UserPreferences.saveUserPreferenceByTypeAsNumber({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTablePageSize,
        value: 10,
      });

      UserPreferences.saveUserPreferenceByTypeAsNumber({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTablePageSize,
        value: 50,
      });

      expect(
        UserPreferences.getUserPreferenceByTypeAsNumber({
          key: TABLE_KEY,
          userPreferenceType: UserPreferenceType.BaseModelTablePageSize,
        }),
      ).toBe(50);
    });

    test("returns null when nothing was ever saved", () => {
      expect(
        UserPreferences.getUserPreferenceByTypeAsNumber({
          key: "never-rendered-table",
          userPreferenceType: UserPreferenceType.BaseModelTablePageSize,
        }),
      ).toBeNull();
    });
  });

  describe("JSON preferences", () => {
    test("round trips a column preference", () => {
      const preference: JSONObject = {
        order: ["name", "currentMonitorStatus", "labels"],
        hidden: ["description"],
      };

      UserPreferences.saveUserPreferenceByTypeAsJSON({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        value: preference,
      });

      expect(
        UserPreferences.getUserPreferenceByTypeAsJSON({
          key: TABLE_KEY,
          userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        }),
      ).toEqual(preference);
    });

    /*
     * The column preference is nothing but arrays of ids, and LocalStorage runs
     * everything through a serializer on the way in and out - so the arrays,
     * their order, and empty arrays all have to survive intact.
     */
    test("arrays keep their contents and their order", () => {
      UserPreferences.saveUserPreferenceByTypeAsJSON({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        value: {
          order: ["c", "a", "b"],
          hidden: [],
        },
      });

      const preference: JSONObject | null =
        UserPreferences.getUserPreferenceByTypeAsJSON({
          key: TABLE_KEY,
          userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        });

      expect(preference?.["order"]).toEqual(["c", "a", "b"]);
      expect(preference?.["hidden"]).toEqual([]);
    });

    test("arrays nested inside a nested object survive", () => {
      UserPreferences.saveUserPreferenceByTypeAsJSON({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        value: {
          columns: {
            order: ["name", "customField.severity"],
            hidden: ["createdAt"],
          },
          version: 1,
        },
      });

      expect(
        UserPreferences.getUserPreferenceByTypeAsJSON({
          key: TABLE_KEY,
          userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        }),
      ).toEqual({
        columns: {
          order: ["name", "customField.severity"],
          hidden: ["createdAt"],
        },
        version: 1,
      });
    });

    /*
     * An empty object is a real, deliberately saved preference (the caller
     * wrote it), not the absence of one - collapsing it to null would resurrect
     * the default layout the user just cleared.
     */
    test("an empty object is a preference, not an absent one", () => {
      UserPreferences.saveUserPreferenceByTypeAsJSON({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        value: {},
      });

      expect(
        UserPreferences.getUserPreferenceByTypeAsJSON({
          key: TABLE_KEY,
          userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        }),
      ).toEqual({});
    });

    test("returns null when nothing was ever saved", () => {
      expect(
        UserPreferences.getUserPreferenceByTypeAsJSON({
          key: "never-rendered-table",
          userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        }),
      ).toBeNull();
    });
  });

  /*
   * Everything below writes straight into localStorage, which is what a
   * hand-edited entry, an older build, or a tab that died mid-write leaves
   * behind. None of it may reach the caller as anything but null: the column
   * code expects an object and would happily read `.order` off a string.
   */
  describe("JSON preferences reject anything that is not an object", () => {
    const columnsKey: string = "BaseModelTableColumns.monitors-table";

    type ReadPreferenceFn = () => JSONObject | null;

    const readPreference: ReadPreferenceFn = (): JSONObject | null => {
      return UserPreferences.getUserPreferenceByTypeAsJSON({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTableColumns,
      });
    };

    test("a bare string that is not JSON at all", () => {
      window.localStorage.setItem(columnsKey, "just-a-string");

      expect(readPreference()).toBeNull();
    });

    test("a quoted string that parses cleanly into a string", () => {
      window.localStorage.setItem(columnsKey, JSON.stringify("name,status"));

      expect(readPreference()).toBeNull();
    });

    test("a number", () => {
      // e.g. a build where this key used to hold a page size.
      UserPreferences.saveUserPreferenceByTypeAsNumber({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        value: 25,
      });

      expect(readPreference()).toBeNull();
    });

    // An array of ids is not a preference object, even though it parses.
    test("an array", () => {
      window.localStorage.setItem(
        columnsKey,
        JSON.stringify(["name", "status"]),
      );

      expect(readPreference()).toBeNull();
    });

    test("malformed JSON left behind by a half-finished write", () => {
      window.localStorage.setItem(columnsKey, '{"order": ["name",');

      expect(readPreference()).toBeNull();
    });

    test("a stored null", () => {
      window.localStorage.setItem(columnsKey, "null");

      expect(readPreference()).toBeNull();
    });

    test("a bad entry never throws and never returns a string", () => {
      window.localStorage.setItem(columnsKey, '{"order": ["name",');

      const preference: JSONObject | null = readPreference();

      expect(typeof preference).not.toBe("string");
      expect(preference).toBeNull();
    });

    // A rejected entry must not poison the neighbouring page size.
    test("a bad column entry leaves the page size readable", () => {
      UserPreferences.saveUserPreferenceByTypeAsNumber({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTablePageSize,
        value: 50,
      });

      window.localStorage.setItem(columnsKey, "not json");

      expect(readPreference()).toBeNull();
      expect(
        UserPreferences.getUserPreferenceByTypeAsNumber({
          key: TABLE_KEY,
          userPreferenceType: UserPreferenceType.BaseModelTablePageSize,
        }),
      ).toBe(50);
    });
  });

  describe("removeUserPreferenceByType", () => {
    test("removes the value it owns", () => {
      UserPreferences.saveUserPreferenceByTypeAsJSON({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        value: { order: ["name"], hidden: [] },
      });

      UserPreferences.removeUserPreferenceByType({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTableColumns,
      });

      expect(readRaw("BaseModelTableColumns.monitors-table")).toBeNull();
      expect(
        UserPreferences.getUserPreferenceByTypeAsJSON({
          key: TABLE_KEY,
          userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        }),
      ).toBeNull();
    });

    // "Reset columns" on one table must not reset every other table.
    test("leaves the same preference type on another table alone", () => {
      UserPreferences.saveUserPreferenceByTypeAsJSON({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        value: { order: ["name"], hidden: [] },
      });

      UserPreferences.saveUserPreferenceByTypeAsJSON({
        key: OTHER_TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        value: { order: ["title"], hidden: [] },
      });

      UserPreferences.removeUserPreferenceByType({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTableColumns,
      });

      expect(
        UserPreferences.getUserPreferenceByTypeAsJSON({
          key: OTHER_TABLE_KEY,
          userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        }),
      ).toEqual({ order: ["title"], hidden: [] });
    });

    // ...nor the page size the same table stored under the same key.
    test("leaves the other preference type on the same table alone", () => {
      UserPreferences.saveUserPreferenceByTypeAsNumber({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTablePageSize,
        value: 25,
      });

      UserPreferences.saveUserPreferenceByTypeAsJSON({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        value: { order: ["name"], hidden: [] },
      });

      UserPreferences.removeUserPreferenceByType({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTableColumns,
      });

      expect(readRaw("BaseModelTableColumns.monitors-table")).toBeNull();
      expect(
        UserPreferences.getUserPreferenceByTypeAsNumber({
          key: TABLE_KEY,
          userPreferenceType: UserPreferenceType.BaseModelTablePageSize,
        }),
      ).toBe(25);
    });

    test("removing something that was never saved is a no-op", () => {
      UserPreferences.saveUserPreferenceByTypeAsJSON({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        value: { order: ["name"], hidden: [] },
      });

      UserPreferences.removeUserPreferenceByType({
        key: "never-rendered-table",
        userPreferenceType: UserPreferenceType.BaseModelTableColumns,
      });

      expect(
        UserPreferences.getUserPreferenceByTypeAsJSON({
          key: TABLE_KEY,
          userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        }),
      ).toEqual({ order: ["name"], hidden: [] });
    });

    test("a removed preference can be saved again", () => {
      UserPreferences.saveUserPreferenceByTypeAsJSON({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        value: { order: ["name"], hidden: [] },
      });

      UserPreferences.removeUserPreferenceByType({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTableColumns,
      });

      UserPreferences.saveUserPreferenceByTypeAsJSON({
        key: TABLE_KEY,
        userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        value: { order: ["status"], hidden: ["name"] },
      });

      expect(
        UserPreferences.getUserPreferenceByTypeAsJSON({
          key: TABLE_KEY,
          userPreferenceType: UserPreferenceType.BaseModelTableColumns,
        }),
      ).toEqual({ order: ["status"], hidden: ["name"] });
    });
  });
});
