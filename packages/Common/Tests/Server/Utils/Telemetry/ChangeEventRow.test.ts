import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  DEFAULT_CHANGE_EVENT_RETENTION_IN_DAYS,
  DEFAULT_CHANGE_EVENT_TYPE,
  MAX_CHANGE_EVENT_AGE_IN_DAYS,
  MAX_CHANGE_EVENT_ATTRIBUTES,
  MAX_CHANGE_EVENT_DESCRIPTION_LENGTH,
  MAX_CHANGE_EVENT_FUTURE_SKEW_IN_MINUTES,
  MAX_CHANGE_EVENT_TITLE_LENGTH,
  MAX_CHANGE_EVENT_TYPE_LENGTH,
  MAX_CHANGE_EVENTS_PER_REQUEST,
  ParsedChangeEventEntry,
  buildChangeEventDbRow,
  extractChangeEventEntries,
  parseChangeEventIngestEntry,
} from "../../../../Server/Utils/Telemetry/ChangeEventRow";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import type { TelemetryServiceMetadata } from "../../../../Server/Services/OpenTelemetryIngestService";

/*
 * ChangeEventRow is the pure validation + row-building layer behind the
 * change-event (deploy marker) ingest endpoint. CI scripts send whatever they
 * like, so these tests pin the repair-don't-reject rules, the accepted body
 * shapes, and the timestamp guard that keeps a forged time from creating
 * arbitrary ClickHouse partitions.
 */

const parseOrFail: (entry: JSONObject) => ParsedChangeEventEntry = (
  entry: JSONObject,
): ParsedChangeEventEntry => {
  const parsed: ParsedChangeEventEntry | null =
    parseChangeEventIngestEntry(entry);
  if (!parsed) {
    throw new Error("Expected entry to parse");
  }
  return parsed;
};

describe("ChangeEventRow constants", () => {
  test("pins the ingest caps and defaults", () => {
    expect(MAX_CHANGE_EVENT_AGE_IN_DAYS).toBe(366);
    expect(MAX_CHANGE_EVENT_FUTURE_SKEW_IN_MINUTES).toBe(60);
    expect(MAX_CHANGE_EVENTS_PER_REQUEST).toBe(100);
    expect(MAX_CHANGE_EVENT_TITLE_LENGTH).toBe(500);
    expect(MAX_CHANGE_EVENT_DESCRIPTION_LENGTH).toBe(5000);
    expect(MAX_CHANGE_EVENT_TYPE_LENGTH).toBe(50);
    expect(MAX_CHANGE_EVENT_ATTRIBUTES).toBe(50);
    expect(DEFAULT_CHANGE_EVENT_TYPE).toBe("deployment");
    expect(DEFAULT_CHANGE_EVENT_RETENTION_IN_DAYS).toBe(365);
  });
});

describe("parseChangeEventIngestEntry", () => {
  describe("entry shape", () => {
    test("returns null for null / undefined / non-object entries", () => {
      expect(
        parseChangeEventIngestEntry(null as unknown as JSONObject),
      ).toBeNull();
      expect(
        parseChangeEventIngestEntry(undefined as unknown as JSONObject),
      ).toBeNull();
      expect(
        parseChangeEventIngestEntry("deploy" as unknown as JSONObject),
      ).toBeNull();
      expect(parseChangeEventIngestEntry(42 as unknown as JSONObject)).toBe(
        null,
      );
    });

    test("returns null for an array entry even if it looks titled", () => {
      const arrayEntry: unknown = [{ title: "Deploy" }];
      expect(parseChangeEventIngestEntry(arrayEntry as JSONObject)).toBeNull();
    });
  });

  describe("title", () => {
    test("uses title and trims surrounding whitespace", () => {
      const parsed: ParsedChangeEventEntry = parseOrFail({
        title: "   Deploy v1.2.3  ",
      });
      expect(parsed.title).toBe("Deploy v1.2.3");
    });

    test("falls back to name when title is absent", () => {
      expect(parseOrFail({ name: "Release 7" }).title).toBe("Release 7");
    });

    test("falls back to name when title is null", () => {
      expect(parseOrFail({ title: null, name: "Release 7" }).title).toBe(
        "Release 7",
      );
    });

    test("prefers title over name when both are present", () => {
      expect(parseOrFail({ title: "A", name: "B" }).title).toBe("A");
    });

    test("an empty-string title does NOT fall back to name (?? only skips nullish)", () => {
      expect(parseChangeEventIngestEntry({ title: "", name: "B" })).toBeNull();
    });

    test("returns null when there is no usable title", () => {
      expect(parseChangeEventIngestEntry({})).toBeNull();
      expect(parseChangeEventIngestEntry({ title: "   " })).toBeNull();
      expect(parseChangeEventIngestEntry({ title: 123 })).toBeNull();
      expect(parseChangeEventIngestEntry({ title: true })).toBeNull();
      expect(
        parseChangeEventIngestEntry({ title: { text: "x" } } as JSONObject),
      ).toBeNull();
      expect(
        parseChangeEventIngestEntry({ description: "no title here" }),
      ).toBeNull();
    });

    test("caps the title at MAX_CHANGE_EVENT_TITLE_LENGTH", () => {
      const longTitle: string = "t".repeat(MAX_CHANGE_EVENT_TITLE_LENGTH + 25);
      const parsed: ParsedChangeEventEntry = parseOrFail({ title: longTitle });
      expect(parsed.title).toHaveLength(MAX_CHANGE_EVENT_TITLE_LENGTH);
    });

    test("keeps a title exactly at the cap untouched", () => {
      const exact: string = "x".repeat(MAX_CHANGE_EVENT_TITLE_LENGTH);
      expect(parseOrFail({ title: exact }).title).toBe(exact);
    });

    test("trims before capping so leading whitespace does not eat the budget", () => {
      const body: string = "y".repeat(MAX_CHANGE_EVENT_TITLE_LENGTH);
      const parsed: ParsedChangeEventEntry = parseOrFail({
        title: `      ${body}`,
      });
      expect(parsed.title).toBe(body);
    });
  });

  describe("eventType", () => {
    test("defaults to deployment when absent", () => {
      expect(parseOrFail({ title: "x" }).eventType).toBe(
        DEFAULT_CHANGE_EVENT_TYPE,
      );
    });

    test("defaults when blank or non-string", () => {
      expect(parseOrFail({ title: "x", eventType: "   " }).eventType).toBe(
        DEFAULT_CHANGE_EVENT_TYPE,
      );
      expect(parseOrFail({ title: "x", eventType: 12 }).eventType).toBe(
        DEFAULT_CHANGE_EVENT_TYPE,
      );
      expect(parseOrFail({ title: "x", eventType: false }).eventType).toBe(
        DEFAULT_CHANGE_EVENT_TYPE,
      );
    });

    test("an empty-string eventType does not fall back to type", () => {
      expect(
        parseOrFail({ title: "x", eventType: "", type: "rollback" }).eventType,
      ).toBe(DEFAULT_CHANGE_EVENT_TYPE);
    });

    test("falls back to type when eventType is absent", () => {
      expect(parseOrFail({ title: "x", type: "rollback" }).eventType).toBe(
        "rollback",
      );
    });

    test("prefers eventType over type", () => {
      expect(
        parseOrFail({ title: "x", eventType: "flag", type: "rollback" })
          .eventType,
      ).toBe("flag");
    });

    test("trims and lowercases", () => {
      expect(
        parseOrFail({ title: "x", eventType: "  Feature-Flag  " }).eventType,
      ).toBe("feature-flag");
    });

    test("caps at MAX_CHANGE_EVENT_TYPE_LENGTH", () => {
      const parsed: ParsedChangeEventEntry = parseOrFail({
        title: "x",
        eventType: "A".repeat(MAX_CHANGE_EVENT_TYPE_LENGTH + 10),
      });
      expect(parsed.eventType).toBe("a".repeat(MAX_CHANGE_EVENT_TYPE_LENGTH));
    });
  });

  describe("description", () => {
    test("defaults to an empty string when absent or non-string", () => {
      expect(parseOrFail({ title: "x" }).description).toBe("");
      expect(parseOrFail({ title: "x", description: 5 }).description).toBe("");
      expect(parseOrFail({ title: "x", description: null }).description).toBe(
        "",
      );
    });

    test("trims and caps at MAX_CHANGE_EVENT_DESCRIPTION_LENGTH", () => {
      expect(
        parseOrFail({ title: "x", description: "  shipped  " }).description,
      ).toBe("shipped");

      const parsed: ParsedChangeEventEntry = parseOrFail({
        title: "x",
        description: "d".repeat(MAX_CHANGE_EVENT_DESCRIPTION_LENGTH + 1),
      });
      expect(parsed.description).toHaveLength(
        MAX_CHANGE_EVENT_DESCRIPTION_LENGTH,
      );
    });
  });

  describe("attributes", () => {
    test("defaults to an empty object when absent", () => {
      expect(parseOrFail({ title: "x" }).attributes).toEqual({});
    });

    test("ignores non-object and array attribute payloads", () => {
      expect(parseOrFail({ title: "x", attributes: "a=b" }).attributes).toEqual(
        {},
      );
      expect(
        parseOrFail({ title: "x", attributes: ["a", "b"] }).attributes,
      ).toEqual({});
      expect(parseOrFail({ title: "x", attributes: null }).attributes).toEqual(
        {},
      );
    });

    test("stringifies string, number and boolean values", () => {
      const parsed: ParsedChangeEventEntry = parseOrFail({
        title: "x",
        attributes: {
          version: "1.2.3",
          build: 42,
          ratio: 0.5,
          canary: true,
          rollback: false,
        },
      });
      expect(parsed.attributes).toEqual({
        version: "1.2.3",
        build: "42",
        ratio: "0.5",
        canary: "true",
        rollback: "false",
      });
    });

    test("drops null, object and array values", () => {
      const parsed: ParsedChangeEventEntry = parseOrFail({
        title: "x",
        attributes: {
          keep: "yes",
          nothing: null,
          nested: { a: 1 },
          list: [1, 2],
        },
      } as JSONObject);
      expect(parsed.attributes).toEqual({ keep: "yes" });
    });

    test("skips blank and whitespace-only keys", () => {
      const parsed: ParsedChangeEventEntry = parseOrFail({
        title: "x",
        attributes: { "": "empty", "   ": "spaces", ok: "1" },
      });
      expect(parsed.attributes).toEqual({ ok: "1" });
    });

    test("caps the number of attributes at MAX_CHANGE_EVENT_ATTRIBUTES", () => {
      const raw: JSONObject = {};
      for (let i: number = 0; i < MAX_CHANGE_EVENT_ATTRIBUTES + 20; i++) {
        raw[`key${i}`] = `value${i}`;
      }
      const parsed: ParsedChangeEventEntry = parseOrFail({
        title: "x",
        attributes: raw,
      });
      const keys: Array<string> = Object.keys(parsed.attributes);
      expect(keys).toHaveLength(MAX_CHANGE_EVENT_ATTRIBUTES);
      // Insertion order wins: the first N keys are kept.
      expect(keys[0]).toBe("key0");
      expect(keys[MAX_CHANGE_EVENT_ATTRIBUTES - 1]).toBe(
        `key${MAX_CHANGE_EVENT_ATTRIBUTES - 1}`,
      );
      expect(parsed.attributes[`key${MAX_CHANGE_EVENT_ATTRIBUTES}`]).toBe(
        undefined,
      );
    });

    test("dropped (invalid) values do not consume the attribute budget", () => {
      const raw: JSONObject = {};
      for (let i: number = 0; i < 10; i++) {
        raw[`bad${i}`] = null;
      }
      for (let i: number = 0; i < MAX_CHANGE_EVENT_ATTRIBUTES; i++) {
        raw[`good${i}`] = i;
      }
      const parsed: ParsedChangeEventEntry = parseOrFail({
        title: "x",
        attributes: raw,
      });
      expect(Object.keys(parsed.attributes)).toHaveLength(
        MAX_CHANGE_EVENT_ATTRIBUTES,
      );
      expect(
        Object.keys(parsed.attributes).every((key: string) => {
          return key.startsWith("good");
        }),
      ).toBe(true);
    });
  });

  describe("time", () => {
    test("is null when absent (stamp with ingestion time)", () => {
      expect(parseOrFail({ title: "x" }).time).toBeNull();
    });

    test("parses ISO-8601 strings", () => {
      const parsed: ParsedChangeEventEntry = parseOrFail({
        title: "x",
        time: "2026-09-01T10:20:30.456Z",
      });
      expect(parsed.time?.toISOString()).toBe("2026-09-01T10:20:30.456Z");
    });

    test("falls back to timestamp when time is absent", () => {
      const parsed: ParsedChangeEventEntry = parseOrFail({
        title: "x",
        timestamp: "2026-09-01T00:00:00.000Z",
      });
      expect(parsed.time?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    });

    test("prefers time over timestamp", () => {
      const parsed: ParsedChangeEventEntry = parseOrFail({
        title: "x",
        time: "2026-09-01T00:00:00.000Z",
        timestamp: "2020-01-01T00:00:00.000Z",
      });
      expect(parsed.time?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    });

    test("treats numbers below 1e12 as epoch seconds", () => {
      const seconds: number = 1788000000; // 2026-08-29
      const parsed: ParsedChangeEventEntry = parseOrFail({
        title: "x",
        time: seconds,
      });
      expect(parsed.time?.getTime()).toBe(seconds * 1000);
    });

    test("treats numbers at or above 1e12 as epoch milliseconds", () => {
      const ms: number = 1788000000123;
      expect(parseOrFail({ title: "x", time: ms }).time?.getTime()).toBe(ms);
      expect(parseOrFail({ title: "x", time: 1e12 }).time?.getTime()).toBe(
        1e12,
      );
    });

    test("fractional seconds are preserved", () => {
      expect(
        parseOrFail({ title: "x", time: 1788000000.5 }).time?.getTime(),
      ).toBe(1788000000500);
    });

    test("0 is a valid (epoch) number, not treated as missing", () => {
      expect(parseOrFail({ title: "x", time: 0 }).time?.getTime()).toBe(0);
    });

    test("non-finite numbers yield null", () => {
      expect(parseOrFail({ title: "x", time: NaN }).time).toBeNull();
      expect(parseOrFail({ title: "x", time: Infinity }).time).toBeNull();
      expect(parseOrFail({ title: "x", time: -Infinity }).time).toBeNull();
    });

    test("out-of-range numbers that produce an invalid Date yield null", () => {
      expect(parseOrFail({ title: "x", time: 1e20 }).time).toBeNull();
    });

    test("blank or unparseable strings yield null", () => {
      expect(parseOrFail({ title: "x", time: "" }).time).toBeNull();
      expect(parseOrFail({ title: "x", time: "   " }).time).toBeNull();
      expect(parseOrFail({ title: "x", time: "not a date" }).time).toBeNull();
    });

    test("other types yield null", () => {
      expect(parseOrFail({ title: "x", time: true }).time).toBeNull();
      expect(
        parseOrFail({ title: "x", time: { at: 1 } } as JSONObject).time,
      ).toBeNull();
    });
  });

  test("returns the full parsed shape", () => {
    expect(
      parseChangeEventIngestEntry({
        title: "Deploy api",
        type: "DEPLOYMENT",
        description: "rolled out",
        time: "2026-09-10T00:00:00.000Z",
        attributes: { sha: "abc123" },
      }),
    ).toEqual({
      time: new Date("2026-09-10T00:00:00.000Z"),
      eventType: "deployment",
      title: "Deploy api",
      description: "rolled out",
      attributes: { sha: "abc123" },
    });
  });
});

describe("extractChangeEventEntries", () => {
  test("returns [] for falsy bodies", () => {
    expect(extractChangeEventEntries(undefined)).toEqual([]);
    expect(extractChangeEventEntries(null)).toEqual([]);
    expect(extractChangeEventEntries("")).toEqual([]);
    expect(extractChangeEventEntries(0)).toEqual([]);
    expect(extractChangeEventEntries(false)).toEqual([]);
  });

  test("returns [] for primitive bodies", () => {
    expect(extractChangeEventEntries("deploy")).toEqual([]);
    expect(extractChangeEventEntries(7)).toEqual([]);
    expect(extractChangeEventEntries(true)).toEqual([]);
  });

  test("wraps a bare event object", () => {
    const body: JSONObject = { title: "Deploy" };
    expect(extractChangeEventEntries(body)).toEqual([body]);
  });

  test("returns [] for an empty object", () => {
    expect(extractChangeEventEntries({})).toEqual([]);
  });

  test("returns bare arrays, keeping only plain objects", () => {
    const a: JSONObject = { title: "a" };
    const b: JSONObject = { title: "b" };
    expect(
      extractChangeEventEntries([a, null, "str", 5, [{ title: "nested" }], b]),
    ).toEqual([a, b]);
  });

  test("returns [] for an empty array", () => {
    expect(extractChangeEventEntries([])).toEqual([]);
  });

  test("unwraps { events: [...] }", () => {
    const a: JSONObject = { title: "a" };
    expect(extractChangeEventEntries({ events: [a, 1, null] })).toEqual([a]);
  });

  test("does not treat { events: <non-array> } as a bare event", () => {
    expect(extractChangeEventEntries({ events: { title: "x" } })).toEqual([]);
    expect(extractChangeEventEntries({ events: "x" })).toEqual([]);
    expect(extractChangeEventEntries({ events: null })).toEqual([]);
  });

  test("does not cap the number of entries itself", () => {
    const events: Array<JSONObject> = [];
    for (let i: number = 0; i < MAX_CHANGE_EVENTS_PER_REQUEST + 5; i++) {
      events.push({ title: `e${i}` });
    }
    expect(extractChangeEventEntries({ events })).toHaveLength(
      MAX_CHANGE_EVENTS_PER_REQUEST + 5,
    );
  });
});

describe("buildChangeEventDbRow", () => {
  const NOW: Date = new Date("2026-09-19T12:00:00.000Z");
  const DAY_MS: number = 24 * 60 * 60 * 1000;
  const MINUTE_MS: number = 60 * 1000;
  const projectId: ObjectID = new ObjectID(
    "7e6a3c1a-1111-4222-8333-944455556666",
  );

  const makeParsed: (
    overrides?: Partial<ParsedChangeEventEntry>,
  ) => ParsedChangeEventEntry = (
    overrides?: Partial<ParsedChangeEventEntry>,
  ): ParsedChangeEventEntry => {
    return {
      time: null,
      eventType: "deployment",
      title: "Deploy api",
      description: "rolled out",
      attributes: {},
      ...overrides,
    };
  };

  const build: (
    parsed: ParsedChangeEventEntry,
    options?: {
      serviceMetadata?: TelemetryServiceMetadata | null;
      retentionDays?: number;
    },
  ) => JSONObject = (
    parsed: ParsedChangeEventEntry,
    options?: {
      serviceMetadata?: TelemetryServiceMetadata | null;
      retentionDays?: number;
    },
  ): JSONObject => {
    return buildChangeEventDbRow({
      parsed,
      projectId,
      serviceMetadata: options?.serviceMetadata ?? null,
      retentionDays: options?.retentionDays ?? 30,
    });
  };

  beforeEach(() => {
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(NOW.getTime());
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("stamps a time-less event with the ingestion time", () => {
    const row: JSONObject = build(makeParsed());
    expect(row["time"]).toBe("2026-09-19 12:00:00.000000000");
    expect(row["createdAt"]).toBe("2026-09-19 12:00:00");
    expect(row["attributes"]).toEqual({});
    expect(row["attributeKeys"]).toEqual([]);
  });

  test("copies the parsed fields and the project id", () => {
    const row: JSONObject = build(
      makeParsed({
        eventType: "rollback",
        title: "Rollback web",
        description: "bad deploy",
      }),
    );
    expect(row["projectId"]).toBe(projectId.toString());
    expect(row["eventType"]).toBe("rollback");
    expect(row["title"]).toBe("Rollback web");
    expect(row["description"]).toBe("bad deploy");
  });

  test("keeps a valid recent source time with millisecond precision", () => {
    const row: JSONObject = build(
      makeParsed({ time: new Date("2026-09-18T08:30:15.123Z") }),
    );
    expect(row["time"]).toBe("2026-09-18 08:30:15.123000000");
    expect(row["attributes"]).toEqual({});
  });

  test("generates a fresh, valid _id per row", () => {
    const first: JSONObject = build(makeParsed());
    const second: JSONObject = build(makeParsed());
    expect(typeof first["_id"]).toBe("string");
    expect(ObjectID.isValidUUID(first["_id"] as string)).toBe(true);
    expect(first["_id"]).not.toBe(second["_id"]);
  });

  test("computes retentionDate from the ingestion time", () => {
    const row: JSONObject = build(makeParsed(), { retentionDays: 0 });
    expect(row["retentionDate"]).toBe("2026-09-19 12:00:00");

    const later: JSONObject = build(makeParsed(), {
      retentionDays: DEFAULT_CHANGE_EVENT_RETENTION_IN_DAYS,
    });
    expect(later["retentionDate"]).toBe(
      OneUptimeDate.toClickhouseDateTime(
        OneUptimeDate.addRemoveDays(
          NOW,
          DEFAULT_CHANGE_EVENT_RETENTION_IN_DAYS,
        ),
      ),
    );
  });

  test("retentionDate is anchored to ingestion, not to an old source time", () => {
    const row: JSONObject = build(
      makeParsed({ time: new Date(NOW.getTime() - 100 * DAY_MS) }),
      { retentionDays: 0 },
    );
    expect(row["retentionDate"]).toBe("2026-09-19 12:00:00");
  });

  test("omits primary entity fields without service metadata", () => {
    const row: JSONObject = build(makeParsed());
    expect(row).not.toHaveProperty("primaryEntityId");
    expect(row).not.toHaveProperty("primaryEntityType");
  });

  test("includes primary entity fields when service metadata is present", () => {
    const entityId: ObjectID = ObjectID.generate();
    const metadata: TelemetryServiceMetadata = {
      serviceName: "api",
      primaryEntityId: entityId,
      primaryEntityType: ServiceType.OpenTelemetry,
    } as unknown as TelemetryServiceMetadata;

    const row: JSONObject = build(makeParsed(), { serviceMetadata: metadata });
    expect(row["primaryEntityId"]).toBe(entityId.toString());
    expect(row["primaryEntityType"]).toBe(ServiceType.OpenTelemetry);
  });

  test("sorts attributeKeys and does not mutate the parsed attributes", () => {
    const attributes: Dictionary<string> = { zeta: "1", alpha: "2", mid: "3" };
    const parsed: ParsedChangeEventEntry = makeParsed({ attributes });
    const row: JSONObject = build(parsed);
    expect(row["attributeKeys"]).toEqual(["alpha", "mid", "zeta"]);
    expect(row["attributes"]).toEqual(attributes);
    expect(row["attributes"]).not.toBe(attributes);
  });

  describe("timestamp guard", () => {
    test("keeps an event exactly MAX_CHANGE_EVENT_AGE_IN_DAYS old", () => {
      const time: Date = new Date(
        NOW.getTime() - MAX_CHANGE_EVENT_AGE_IN_DAYS * DAY_MS,
      );
      const row: JSONObject = build(makeParsed({ time }));
      expect(row["time"]).toBe(OneUptimeDate.toClickhouseDateTime64(time));
      expect(row["attributes"]).toEqual({});
    });

    test("re-stamps an event older than MAX_CHANGE_EVENT_AGE_IN_DAYS and preserves the original", () => {
      const time: Date = new Date(
        NOW.getTime() - (MAX_CHANGE_EVENT_AGE_IN_DAYS + 1) * DAY_MS,
      );
      const parsed: ParsedChangeEventEntry = makeParsed({
        time,
        attributes: { sha: "abc" },
      });
      const row: JSONObject = build(parsed);

      expect(row["time"]).toBe("2026-09-19 12:00:00.000000000");
      expect(row["attributes"]).toEqual({
        sha: "abc",
        "oneuptime.original_time": String(time),
      });
      expect(row["attributeKeys"]).toEqual(["oneuptime.original_time", "sha"]);
      // The caller's parsed entry is left alone.
      expect(parsed.attributes).toEqual({ sha: "abc" });
    });

    test("re-stamps an epoch-zero time", () => {
      const row: JSONObject = build(makeParsed({ time: new Date(0) }));
      expect(row["time"]).toBe("2026-09-19 12:00:00.000000000");
      expect(
        (row["attributes"] as Dictionary<string>)["oneuptime.original_time"],
      ).toBe(String(new Date(0)));
    });

    test("keeps an event exactly MAX_CHANGE_EVENT_FUTURE_SKEW_IN_MINUTES ahead", () => {
      const time: Date = new Date(
        NOW.getTime() + MAX_CHANGE_EVENT_FUTURE_SKEW_IN_MINUTES * MINUTE_MS,
      );
      const row: JSONObject = build(makeParsed({ time }));
      expect(row["time"]).toBe("2026-09-19 13:00:00.000000000");
      expect(row["attributes"]).toEqual({});
    });

    test("re-stamps an event further in the future than the allowed skew", () => {
      const time: Date = new Date(
        NOW.getTime() +
          MAX_CHANGE_EVENT_FUTURE_SKEW_IN_MINUTES * MINUTE_MS +
          1000,
      );
      const row: JSONObject = build(makeParsed({ time }));
      expect(row["time"]).toBe("2026-09-19 12:00:00.000000000");
      expect(
        (row["attributes"] as Dictionary<string>)["oneuptime.original_time"],
      ).toBe(String(time));
    });

    test("re-stamps an invalid Date", () => {
      const row: JSONObject = build(makeParsed({ time: new Date(NaN) }));
      expect(row["time"]).toBe("2026-09-19 12:00:00.000000000");
      expect(
        (row["attributes"] as Dictionary<string>)["oneuptime.original_time"],
      ).toBe("Invalid Date");
    });

    test("a user-supplied oneuptime.original_time is overwritten on re-stamp", () => {
      const time: Date = new Date(NOW.getTime() + 10 * DAY_MS);
      const row: JSONObject = build(
        makeParsed({
          time,
          attributes: { "oneuptime.original_time": "forged" },
        }),
      );
      expect(
        (row["attributes"] as Dictionary<string>)["oneuptime.original_time"],
      ).toBe(String(time));
    });
  });

  test("parse -> build round trip for a typical CI payload", () => {
    const entries: Array<JSONObject> = extractChangeEventEntries({
      events: [
        {
          name: "Deploy checkout",
          type: "Deployment",
          timestamp: Math.floor(NOW.getTime() / 1000) - 60,
          attributes: { "git.sha": "deadbeef", build: 101 },
        },
        { description: "no title — dropped" },
      ],
    });
    const parsed: Array<ParsedChangeEventEntry> = entries
      .map((entry: JSONObject) => {
        return parseChangeEventIngestEntry(entry);
      })
      .filter(
        (
          entry: ParsedChangeEventEntry | null,
        ): entry is ParsedChangeEventEntry => {
          return entry !== null;
        },
      );

    expect(parsed).toHaveLength(1);

    const row: JSONObject = build(parsed[0]!);
    expect(row["title"]).toBe("Deploy checkout");
    expect(row["eventType"]).toBe("deployment");
    expect(row["time"]).toBe("2026-09-19 11:59:00.000000000");
    expect(row["attributes"]).toEqual({ "git.sha": "deadbeef", build: "101" });
    expect(row["attributeKeys"]).toEqual(["build", "git.sha"]);
  });
});
