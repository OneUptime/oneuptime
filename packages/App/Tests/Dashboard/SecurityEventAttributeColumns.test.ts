import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import { JSONObject } from "Common/Types/JSON";
import {
  SecurityEventAttributeColumn,
  SecurityEventAttributeKeySearchResult,
  buildSecurityEventAttributeColumns,
  getSecurityEventAttributeColumnsStorageKey,
  getSecurityEventAttributeValue,
  mergeSecurityEventAttributeKeys,
  moveSecurityEventAttributeColumnKey,
  normalizeSecurityEventAttributeColumnKeys,
  readLegacySecurityEventAttributeColumnKeys,
  readSecurityEventAttributeColumnKeys,
  searchSecurityEventAttributeKeys,
  toggleSecurityEventAttributeColumnKey,
  writeSecurityEventAttributeColumnKeys,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventAttributeColumns";
import { SECURITY_EVENTS_TABLE_ID } from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsTimeRange";

/*
 * Source attributes a viewer has chosen to see on every security event row.
 *
 * A Google SecOps detection flattens its whole payload into `attributes` —
 * hundreds of keys like
 * `collectionElements.0.references.0.event.target.user.firstName` — so the
 * list cannot ship them as chips; the viewer picks the ones their SOC keys
 * off. What is pinned here is everything about that choice that is not
 * rendering: how a long key is named on a chip (short, but never ambiguous),
 * what counts as "this event does not carry it", the picker's search, and
 * where the choice is kept — including carrying over what the retired model
 * table was showing.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";

const FIRST_NAME_KEY: string =
  "collectionElements.0.references.0.event.target.user.firstName";
const CITY_KEY: string =
  "collectionElements.0.references.0.event.target.user.personalAddress.city";
const ADDRESS_NAME_KEY: string =
  "collectionElements.0.references.0.event.target.user.personalAddress.name";

const LEGACY_TABLE_STORAGE_KEY: string = `BaseModelTableColumns.${SECURITY_EVENTS_TABLE_ID}`;

/*
 * App's suites run under node, which has no localStorage. A Map-backed
 * stand-in is enough: the module only ever reads, writes and removes.
 */
class MemoryStorage {
  private items: Map<string, string> = new Map();

  public getItem(key: string): string | null {
    return this.items.has(key) ? (this.items.get(key) as string) : null;
  }

  public setItem(key: string, value: string): void {
    this.items.set(key, String(value));
  }

  public removeItem(key: string): void {
    this.items.delete(key);
  }

  public clear(): void {
    this.items.clear();
  }
}

type GlobalWithStorage = { localStorage?: unknown };

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  (globalThis as GlobalWithStorage).localStorage = storage;
});

afterEach(() => {
  delete (globalThis as GlobalWithStorage).localStorage;
});

function event(attributes?: JSONObject): SecurityEvent {
  return Object.assign(
    new SecurityEvent(),
    attributes ? { attributes: attributes } : {},
  );
}

function labels(keys: Array<string>): Array<string> {
  return buildSecurityEventAttributeColumns(keys).map(
    (column: SecurityEventAttributeColumn): string => {
      return column.label;
    },
  );
}

describe("normalizeSecurityEventAttributeColumnKeys", () => {
  test("keeps the viewer's order, trimmed and de-duplicated", () => {
    expect(
      normalizeSecurityEventAttributeColumnKeys([
        " device.hostname ",
        "threat.matched",
        "device.hostname",
      ]),
    ).toEqual(["device.hostname", "threat.matched"]);
  });

  test("drops blanks and anything that is not a string", () => {
    expect(
      normalizeSecurityEventAttributeColumnKeys([
        "",
        "   ",
        42,
        null,
        { key: "x" },
        "user.name",
      ]),
    ).toEqual(["user.name"]);
  });

  test("anything that is not a list reads as no columns", () => {
    expect(normalizeSecurityEventAttributeColumnKeys(null)).toEqual([]);
    expect(normalizeSecurityEventAttributeColumnKeys(undefined)).toEqual([]);
    expect(normalizeSecurityEventAttributeColumnKeys("user.name")).toEqual([]);
    expect(normalizeSecurityEventAttributeColumnKeys({ a: "b" })).toEqual([]);
  });

  /*
   * The storage serializer once wrote a top-level array as an index-keyed
   * object; a list saved that way must still load.
   */
  test("reads a list that storage wrote out as an index-keyed object", () => {
    expect(
      normalizeSecurityEventAttributeColumnKeys({
        "0": "user.name",
        "1": "device.hostname",
      }),
    ).toEqual(["user.name", "device.hostname"]);
  });
});

describe("buildSecurityEventAttributeColumns", () => {
  test("names each key by its last two segments — what the customer asked to see reads as a short chip", () => {
    expect(
      buildSecurityEventAttributeColumns([
        FIRST_NAME_KEY,
        CITY_KEY,
        ADDRESS_NAME_KEY,
      ]),
    ).toEqual([
      { key: FIRST_NAME_KEY, label: "user.firstName" },
      { key: CITY_KEY, label: "personalAddress.city" },
      { key: ADDRESS_NAME_KEY, label: "personalAddress.name" },
    ]);
  });

  test("a key with one or two segments is its own label", () => {
    expect(labels(["severity", "device.hostname"])).toEqual([
      "severity",
      "device.hostname",
    ]);
  });

  test("never starts a label on an array index", () => {
    expect(
      labels([
        "collectionElements.0.references.0.event.detectionFields.0.value",
      ]),
    ).toEqual(["detectionFields.0.value"]);
    expect(labels(["a.0.1.value"])).toEqual(["a.0.1.value"]);
  });

  test("a trailing index keeps the segment it indexes", () => {
    expect(
      labels(["collectionElements.0.references.0.event.target.labels.9"]),
    ).toEqual(["labels.9"]);
  });

  /*
   * The one mix-up that matters on a SIEM row: which side of the interaction
   * a name belongs to.
   */
  test("two keys that would read the same both grow until they differ", () => {
    expect(
      labels(["event.principal.user.firstName", "event.target.user.firstName"]),
    ).toEqual(["principal.user.firstName", "target.user.firstName"]);
  });

  test("keys that share a long tail grow as far as it takes", () => {
    expect(labels(["a.x.user.name", "b.x.user.name"])).toEqual([
      "a.x.user.name",
      "b.x.user.name",
    ]);
  });

  test("a key that is the tail of another keeps its whole self as a label", () => {
    expect(labels(["user.name", "target.user.name"])).toEqual([
      "user.name",
      "target.user.name",
    ]);
  });

  test("only the keys that collide grow", () => {
    expect(
      labels([
        "event.principal.user.firstName",
        "event.target.user.firstName",
        CITY_KEY,
      ]),
    ).toEqual([
      "principal.user.firstName",
      "target.user.firstName",
      "personalAddress.city",
    ]);
  });

  test("every label is unique, however the keys overlap", () => {
    const keys: Array<string> = [
      "a.b.c",
      "x.b.c",
      "b.c",
      "c",
      "y.a.b.c",
      "0.b.c",
      "q.0.b.c",
    ];

    const built: Array<string> = labels(keys);

    expect(new Set(built).size).toBe(keys.length);
  });

  test("keeps the viewer's order and collapses repeats", () => {
    expect(
      buildSecurityEventAttributeColumns([
        CITY_KEY,
        FIRST_NAME_KEY,
        CITY_KEY,
      ]).map((column: SecurityEventAttributeColumn): string => {
        return column.key;
      }),
    ).toEqual([CITY_KEY, FIRST_NAME_KEY]);
  });

  test("no keys, no columns", () => {
    expect(buildSecurityEventAttributeColumns([])).toEqual([]);
  });
});

describe("getSecurityEventAttributeValue", () => {
  test("reads the value the event carries under the exact key", () => {
    expect(
      getSecurityEventAttributeValue(
        event({ [FIRST_NAME_KEY]: "jdoe" }),
        FIRST_NAME_KEY,
      ),
    ).toBe("jdoe");
  });

  test("trims, so a padded value does not render a blank chip", () => {
    expect(
      getSecurityEventAttributeValue(event({ city: "  Springfield " }), "city"),
    ).toBe("Springfield");
  });

  test("missing, null and whitespace-only all read as not carried", () => {
    expect(getSecurityEventAttributeValue(event({}), "city")).toBe("");
    expect(getSecurityEventAttributeValue(event({ city: null }), "city")).toBe(
      "",
    );
    expect(getSecurityEventAttributeValue(event({ city: "   " }), "city")).toBe(
      "",
    );
    expect(getSecurityEventAttributeValue(event(), "city")).toBe("");
  });

  test("a number or a boolean is shown as written, zero and false included", () => {
    expect(getSecurityEventAttributeValue(event({ port: 443 }), "port")).toBe(
      "443",
    );
    expect(getSecurityEventAttributeValue(event({ port: 0 }), "port")).toBe(
      "0",
    );
    expect(
      getSecurityEventAttributeValue(event({ matched: false }), "matched"),
    ).toBe("false");
  });

  test("a nested value is shown as JSON rather than [object Object]", () => {
    expect(
      getSecurityEventAttributeValue(
        event({ label: { key: "risk", value: "high" } }),
        "label",
      ),
    ).toBe('{"key":"risk","value":"high"}');
  });

  test("does not reach through a dotted key into nested objects", () => {
    expect(
      getSecurityEventAttributeValue(
        event({ user: { name: "alice" } }),
        "user.name",
      ),
    ).toBe("");
  });
});

describe("toggleSecurityEventAttributeColumnKey", () => {
  test("adds a key that is not shown yet, at the end", () => {
    expect(
      toggleSecurityEventAttributeColumnKey(["a.b"], FIRST_NAME_KEY),
    ).toEqual(["a.b", FIRST_NAME_KEY]);
  });

  test("removes a key that is", () => {
    expect(
      toggleSecurityEventAttributeColumnKey(
        ["a.b", FIRST_NAME_KEY, "c.d"],
        FIRST_NAME_KEY,
      ),
    ).toEqual(["a.b", "c.d"]);
  });

  test("a blank key changes nothing", () => {
    expect(toggleSecurityEventAttributeColumnKey(["a.b"], "   ")).toEqual([
      "a.b",
    ]);
  });

  test("does not change the list it was handed", () => {
    const keys: Array<string> = ["a.b"];

    toggleSecurityEventAttributeColumnKey(keys, "c.d");
    toggleSecurityEventAttributeColumnKey(keys, "a.b");

    expect(keys).toEqual(["a.b"]);
  });
});

describe("moveSecurityEventAttributeColumnKey", () => {
  const keys: Array<string> = ["a", "b", "c"];

  test("moves a key one step up or down", () => {
    expect(moveSecurityEventAttributeColumnKey(keys, "b", -1)).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(moveSecurityEventAttributeColumnKey(keys, "b", 1)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  test("a step off either end leaves the order alone", () => {
    expect(moveSecurityEventAttributeColumnKey(keys, "a", -1)).toEqual(keys);
    expect(moveSecurityEventAttributeColumnKey(keys, "c", 1)).toEqual(keys);
  });

  test("a key that is not shown leaves the order alone", () => {
    expect(moveSecurityEventAttributeColumnKey(keys, "z", 1)).toEqual(keys);
  });

  test("does not change the list it was handed", () => {
    moveSecurityEventAttributeColumnKey(keys, "b", -1);

    expect(keys).toEqual(["a", "b", "c"]);
  });
});

describe("searchSecurityEventAttributeKeys", () => {
  const KEYS: Array<string> = [
    "collectionElements.0.references.0.event.principal.user.firstName",
    FIRST_NAME_KEY,
    CITY_KEY,
    ADDRESS_NAME_KEY,
    "device.hostname",
  ];

  test("with nothing typed, offers every key", () => {
    const result: SecurityEventAttributeKeySearchResult =
      searchSecurityEventAttributeKeys({ keys: KEYS, query: "", limit: 50 });

    expect(result.keys).toEqual(KEYS);
    expect(result.total).toBe(KEYS.length);
  });

  test("every word has to appear, in any order and any case", () => {
    expect(
      searchSecurityEventAttributeKeys({
        keys: KEYS,
        query: "TARGET firstname",
        limit: 50,
      }).keys,
    ).toEqual([FIRST_NAME_KEY]);

    expect(
      searchSecurityEventAttributeKeys({
        keys: KEYS,
        query: "personaladdress",
        limit: 50,
      }).keys,
    ).toEqual([CITY_KEY, ADDRESS_NAME_KEY]);
  });

  test("extra whitespace between words is ignored", () => {
    expect(
      searchSecurityEventAttributeKeys({
        keys: KEYS,
        query: "   device    hostname  ",
        limit: 50,
      }).keys,
    ).toEqual(["device.hostname"]);
  });

  test("keys already shown are not offered again", () => {
    expect(
      searchSecurityEventAttributeKeys({
        keys: KEYS,
        query: "firstname",
        excludeKeys: [FIRST_NAME_KEY],
        limit: 50,
      }).keys,
    ).toEqual([
      "collectionElements.0.references.0.event.principal.user.firstName",
    ]);
  });

  test("lists at most `limit` keys, and counts every match", () => {
    const result: SecurityEventAttributeKeySearchResult =
      searchSecurityEventAttributeKeys({
        keys: KEYS,
        query: "collectionElements",
        limit: 2,
      });

    expect(result.keys).toHaveLength(2);
    expect(result.total).toBe(4);
  });

  test("nothing matching is an empty result, not an error", () => {
    expect(
      searchSecurityEventAttributeKeys({
        keys: KEYS,
        query: "nope",
        limit: 50,
      }),
    ).toEqual({ keys: [], total: 0 });
  });
});

describe("mergeSecurityEventAttributeKeys", () => {
  /*
   * The server's key list is sampled from recent events and capped; an
   * attribute the reader can see on a listed event must still be offered.
   */
  test("adds every key on the listed events to the project's list", () => {
    expect(
      mergeSecurityEventAttributeKeys({
        attributeKeys: ["device.hostname"],
        events: [
          event({ [FIRST_NAME_KEY]: "jdoe" }),
          event({ [CITY_KEY]: "Springfield", "device.hostname": "web-01" }),
        ],
      }),
    ).toEqual(
      [CITY_KEY, FIRST_NAME_KEY, "device.hostname"].sort(
        (a: string, b: string): number => {
          return a.localeCompare(b);
        },
      ),
    );
  });

  test("lists each key once, sorted, without blanks", () => {
    expect(
      mergeSecurityEventAttributeKeys({
        attributeKeys: ["b", "a", "", "  ", "b"],
        events: [event({ a: "1", c: "2", " ": "3" }), event()],
      }),
    ).toEqual(["a", "b", "c"]);
  });

  test("no keys and no events is an empty list", () => {
    expect(
      mergeSecurityEventAttributeKeys({ attributeKeys: [], events: [] }),
    ).toEqual([]);
  });
});

describe("where the choice is kept", () => {
  test("one entry per project", () => {
    expect(getSecurityEventAttributeColumnsStorageKey(PROJECT_ID)).not.toBe(
      getSecurityEventAttributeColumnsStorageKey(OTHER_PROJECT_ID),
    );
    expect(getSecurityEventAttributeColumnsStorageKey(PROJECT_ID)).toContain(
      PROJECT_ID,
    );
  });

  test("what is written is what is read back, in order", () => {
    writeSecurityEventAttributeColumnKeys(PROJECT_ID, [
      CITY_KEY,
      FIRST_NAME_KEY,
    ]);

    expect(readSecurityEventAttributeColumnKeys(PROJECT_ID)).toEqual([
      CITY_KEY,
      FIRST_NAME_KEY,
    ]);
  });

  test("is written as a plain JSON list", () => {
    writeSecurityEventAttributeColumnKeys(PROJECT_ID, [FIRST_NAME_KEY]);

    expect(
      JSON.parse(
        storage.getItem(
          getSecurityEventAttributeColumnsStorageKey(PROJECT_ID),
        ) as string,
      ),
    ).toEqual([FIRST_NAME_KEY]);
  });

  test("is written normalized", () => {
    writeSecurityEventAttributeColumnKeys(PROJECT_ID, [
      " a.b ",
      "a.b",
      "",
      "c.d",
    ]);

    expect(readSecurityEventAttributeColumnKeys(PROJECT_ID)).toEqual([
      "a.b",
      "c.d",
    ]);
  });

  test("one project's columns do not show up in another's", () => {
    writeSecurityEventAttributeColumnKeys(PROJECT_ID, [FIRST_NAME_KEY]);

    expect(readSecurityEventAttributeColumnKeys(OTHER_PROJECT_ID)).toEqual([]);
  });

  test("a viewer who never chose any has none", () => {
    expect(readSecurityEventAttributeColumnKeys(PROJECT_ID)).toEqual([]);
  });

  test("garbage in storage reads as no columns, never as a broken page", () => {
    storage.setItem(
      getSecurityEventAttributeColumnsStorageKey(PROJECT_ID),
      "{not json",
    );

    expect(readSecurityEventAttributeColumnKeys(PROJECT_ID)).toEqual([]);

    storage.setItem(
      getSecurityEventAttributeColumnsStorageKey(PROJECT_ID),
      JSON.stringify({ columns: "nope" }),
    );

    expect(readSecurityEventAttributeColumnKeys(PROJECT_ID)).toEqual([]);
  });

  test("storage that is unavailable neither breaks reading nor writing", () => {
    delete (globalThis as GlobalWithStorage).localStorage;

    expect(readSecurityEventAttributeColumnKeys(PROJECT_ID)).toEqual([]);
    expect(() => {
      writeSecurityEventAttributeColumnKeys(PROJECT_ID, [FIRST_NAME_KEY]);
    }).not.toThrow();
  });

  test("storage that refuses writes (quota, private mode) does not throw", () => {
    storage.setItem = (): void => {
      throw new Error("QuotaExceededError");
    };

    expect(() => {
      writeSecurityEventAttributeColumnKeys(PROJECT_ID, [FIRST_NAME_KEY]);
    }).not.toThrow();
  });
});

/*
 * The model table this explorer replaced had its own "Add Attribute Column"
 * picker, and kept what the viewer chose in their browser. Someone who set
 * that up should find the same attributes on the new rows, not an empty
 * picker.
 */
describe("carrying over the retired table's attribute columns", () => {
  function storeLegacyPreference(preference: JSONObject): void {
    storage.setItem(LEGACY_TABLE_STORAGE_KEY, JSON.stringify(preference));
  }

  test("reads the attribute columns the table was showing, in its order", () => {
    storeLegacyPreference({
      order: [
        "time",
        `attributes.${CITY_KEY}`,
        "severityName",
        `attributes.${FIRST_NAME_KEY}`,
      ],
      hidden: [],
    });

    expect(readLegacySecurityEventAttributeColumnKeys()).toEqual([
      CITY_KEY,
      FIRST_NAME_KEY,
    ]);
  });

  test("leaves out the ones the viewer had switched off", () => {
    storeLegacyPreference({
      order: [`attributes.${CITY_KEY}`, `attributes.${FIRST_NAME_KEY}`],
      hidden: [`attributes.${CITY_KEY}`],
    });

    expect(readLegacySecurityEventAttributeColumnKeys()).toEqual([
      FIRST_NAME_KEY,
    ]);
  });

  test("ignores the table's own columns, the whole-map one included", () => {
    storeLegacyPreference({
      order: ["time", "attributes", "attributes.", "message"],
      hidden: [],
    });

    expect(readLegacySecurityEventAttributeColumnKeys()).toEqual([]);
  });

  test("seeds a project that has never had a choice of its own", () => {
    storeLegacyPreference({
      order: [`attributes.${FIRST_NAME_KEY}`],
      hidden: [],
    });

    expect(readSecurityEventAttributeColumnKeys(PROJECT_ID)).toEqual([
      FIRST_NAME_KEY,
    ]);
  });

  test("never overrides a choice made since — clearing the list keeps it clear", () => {
    storeLegacyPreference({
      order: [`attributes.${FIRST_NAME_KEY}`],
      hidden: [],
    });

    writeSecurityEventAttributeColumnKeys(PROJECT_ID, []);

    expect(readSecurityEventAttributeColumnKeys(PROJECT_ID)).toEqual([]);

    writeSecurityEventAttributeColumnKeys(PROJECT_ID, [CITY_KEY]);

    expect(readSecurityEventAttributeColumnKeys(PROJECT_ID)).toEqual([
      CITY_KEY,
    ]);
  });

  test("a missing, partial or malformed table layout carries nothing over", () => {
    expect(readLegacySecurityEventAttributeColumnKeys()).toEqual([]);

    storeLegacyPreference({ hidden: [`attributes.${CITY_KEY}`] });
    expect(readLegacySecurityEventAttributeColumnKeys()).toEqual([]);

    storeLegacyPreference({ order: "attributes.x" });
    expect(readLegacySecurityEventAttributeColumnKeys()).toEqual([]);

    storage.setItem(LEGACY_TABLE_STORAGE_KEY, JSON.stringify(["x"]));
    expect(readLegacySecurityEventAttributeColumnKeys()).toEqual([]);

    storage.setItem(LEGACY_TABLE_STORAGE_KEY, "{broken");
    expect(readLegacySecurityEventAttributeColumnKeys()).toEqual([]);
  });

  test("an order list stored as an index-keyed object still carries over", () => {
    storeLegacyPreference({
      order: { "0": `attributes.${CITY_KEY}`, "1": "time" },
      hidden: {},
    });

    expect(readLegacySecurityEventAttributeColumnKeys()).toEqual([CITY_KEY]);
  });
});
