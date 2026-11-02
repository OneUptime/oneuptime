import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  PLACE_SEPARATOR,
  SECURITY_TELEMETRY_MAX_SOURCES_READ,
  SECURITY_TELEMETRY_READ_TIME_LIMIT,
  SecurityTelemetryMentionRow,
  SecurityTelemetryMentionsStatementData,
  SecurityTelemetryTable,
  buildSecurityTelemetryMentionsStatement,
  readSecurityTelemetryMentionRow,
} from "../../../../../Server/Utils/SecurityEvent/Connections/SecurityTelemetryStatements";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import {
  RESOURCE_ATTRIBUTE_PREFIX,
  SecurityTelemetrySearchValue,
  getTelemetrySearchValues,
} from "../../../../../Utils/SecurityCase/SecurityTelemetrySearch";
import { describe, expect, test } from "@jest/globals";

/*
 * The reads behind "In your logs and traces", as statements, without a
 * database: one project's rows of one window, every value in one pass, the
 * cheap conditions first, every value a bound parameter, a time limit that
 * throws - and how their answer is read back. App's
 * SecurityTelemetryMentionsClickhouse runs them on a real ClickHouse.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SERVICE_ID: string = "22222222-2222-4222-8222-222222222222";
const HIDDEN_ID: string = "33333333-3333-4333-8333-333333333333";
const START: Date = new Date("2026-10-25T08:30:00.000Z");
const END: Date = new Date("2026-10-25T10:30:00.000Z");

const VALUES: Array<SecurityTelemetrySearchValue> = getTelemetrySearchValues([
  { type: SecurityEntityType.IpAddress, value: "203.0.113.7" },
  { type: SecurityEntityType.Domain, value: "Evil-C2.Example.Net" },
  // A value with SQL in it: only ever a parameter.
  {
    type: SecurityEntityType.Url,
    value: "https://evil.example/a'OR'1'='1",
  },
]).values;

function data(
  overrides: Partial<SecurityTelemetryMentionsStatementData> = {},
): SecurityTelemetryMentionsStatementData {
  return {
    table: SecurityTelemetryTable.Logs,
    databaseName: "oneuptime",
    tableName: "LogItemV3",
    projectId: PROJECT_ID,
    startTime: START,
    endTime: END,
    values: VALUES,
    serviceFilter: {},
    ...overrides,
  };
}

function build(
  overrides: Partial<SecurityTelemetryMentionsStatementData> = {},
): Statement {
  const statement: Statement | null = buildSecurityTelemetryMentionsStatement(
    data(overrides),
  );

  expect(statement).not.toBeNull();

  return statement!;
}

// Every value bound to the statement, flattened.
function boundValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params).flatMap(
    (value: unknown): Array<unknown> => {
      return Array.isArray(value) ? value : [value];
    },
  );
}

describe("the statement of one table and one search", () => {
  test("nothing to search for, nothing to read", () => {
    expect(buildSecurityTelemetryMentionsStatement(data({ values: [] }))).toBe(
      null,
    );
  });

  test("the values searched for", () => {
    expect(
      VALUES.map((value: SecurityTelemetrySearchValue): string => {
        return value.entity.value;
      }),
    ).toEqual([
      "203.0.113.7",
      "Evil-C2.Example.Net",
      "https://evil.example/a'OR'1'='1",
    ]);
  });

  test("the log lines: one project's, of the window, their message or attributes holding a value, the records the reader may read", () => {
    const statement: Statement = build({
      serviceFilter: {
        excludedServiceIds: [new ObjectID(HIDDEN_ID)],
      },
    });
    const query: string = statement.query;

    expect(query).toContain("FROM oneuptime.LogItemV3 ARRAY JOIN arrayFilter(");
    expect(query).toMatch(/WHERE projectId = \{p\d+:String\}/);
    expect(query).toMatch(/AND time >= \{p\d+:DateTime64\(9\)\}/);
    expect(query).toMatch(/AND time <= \{p\d+:DateTime64\(9\)\}/);
    expect(query).toContain("multiSearchAnyCaseInsensitive(ifNull(body, ''),");
    expect(query).toContain("hasAny(mapValues(attributes),");
    /*
     * A line is read at all only when its message holds a value, whatever
     * its case, or an attribute holds one of its spellings (which the
     * attribute index serves): never every line of the window.
     */
    expect(query).toMatch(
      /AND \(multiSearchAnyCaseInsensitive\(ifNull\(body, ''\), \{p\d+:Array\(String\)\}\) OR hasAny\(mapValues\(attributes\), \{p\d+:Array\(String\)\}\)\)/,
    );
    expect(query).toContain("primaryEntityId NOT IN (");
    // One entry of the ARRAY JOIN a value, its message matched by its pattern.
    expect(query.split("match(ifNull(body, ''),").length - 1).toBe(
      VALUES.length,
    );
    expect(query).toContain(
      "GROUP BY valueIndex, resourceType, resourceId) GROUP BY valueIndex ORDER BY valueIndex ASC",
    );
    expect(query).toContain(
      `arraySlice(arrayReverseSort(groupArray(tuple(hitCount, resourceType, resourceId))), 1, ${SECURITY_TELEMETRY_MAX_SOURCES_READ})`,
    );

    const bound: Array<unknown> = boundValues(statement);

    expect(bound).toContain(PROJECT_ID.toString());
    expect(bound).toContain(HIDDEN_ID);
    expect(bound).toContain(RESOURCE_ATTRIBUTE_PREFIX);

    for (const value of VALUES) {
      expect(bound).toContain(value.messagePattern);

      for (const needle of value.needles) {
        expect(bound).toContain(needle);
      }

      for (const spelling of value.spellings) {
        expect(bound).toContain(spelling);
      }
    }
  });

  test("a value is only ever a parameter, never the statement's text", () => {
    const query: string = build().query;

    expect(query).not.toContain("203.0.113.7");
    expect(query).not.toContain("evil-c2");
    expect(query).not.toContain("'1'='1");
    expect(query).not.toContain(RESOURCE_ATTRIBUTE_PREFIX);
  });

  test("the spans: their attributes alone, by when they started", () => {
    const query: string = build({
      table: SecurityTelemetryTable.Spans,
      tableName: "SpanItemV3",
    }).query;

    expect(query).toContain("FROM oneuptime.SpanItemV3 ARRAY JOIN");
    expect(query).toMatch(/AND startTime >= \{p\d+:DateTime64\(9\)\}/);
    expect(query).toMatch(/AND startTime <= \{p\d+:DateTime64\(9\)\}/);
    expect(query).toContain("max(startTime) AS lastSeen");
    expect(query).not.toContain("body");
    expect(query).toContain("toUInt8(0), ");
    expect(query).toMatch(
      /AND \(hasAny\(mapValues\(attributes\), \{p\d+:Array\(String\)\}\)\)/,
    );
  });

  test("a reader of some services reads theirs alone", () => {
    const query: string = build({
      serviceFilter: { serviceIds: [new ObjectID(SERVICE_ID)] },
    }).query;

    expect(query).toContain("AND primaryEntityId IN (");
    expect(query).not.toContain("NOT IN");
  });

  test("a resource attribute is never a place a value was found in", () => {
    const query: string = build().query;

    expect(query).toMatch(
      /mapFilter\(\(mentionKey, mentionValue\) -> NOT startsWith\(mentionKey, \{p\d+:String\}\) AND has\(\{p\d+:Array\(String\)\}, mentionValue\), attributes\)/,
    );
  });

  test("its own time limit, which throws, and a bounded scan", () => {
    const query: string = build().query;

    expect(SECURITY_TELEMETRY_READ_TIME_LIMIT).toEqual({
      maxExecutionTimeInSeconds: 15,
      timeoutOverflowMode: "throw",
    });
    expect(query).toContain("max_execution_time = 15");
    expect(query).toContain("timeout_overflow_mode = 'throw'");
    expect(query).toContain("max_threads = 4");
  });

  test("a database or a table named with anything but letters, digits and _ is refused", () => {
    expect(() => {
      return buildSecurityTelemetryMentionsStatement(
        data({ databaseName: "oneuptime; DROP TABLE x" }),
      );
    }).toThrow("Invalid database name");
    expect(() => {
      return buildSecurityTelemetryMentionsStatement(
        data({ tableName: "LogItemV3`" }),
      );
    }).toThrow("Invalid table name");
  });
});

describe("reading what it answers", () => {
  const row: JSONObject = {
    valueIndex: 1,
    totalCount: "1284",
    messageTotal: "1200",
    lastSeenAt: "2026-10-25 10:12:00.000000000",
    sourceCount: "3",
    sources: [
      ["1200", "OpenTelemetry", SERVICE_ID],
      // A tuple as an object, as some formats send it.
      { 1: "84", 2: "Host", 3: HIDDEN_ID },
      // A row that is no record.
      ["4", "OpenTelemetry", "not-an-id"],
    ],
    places: [
      [
        `client_ip${PLACE_SEPARATOR}203.0.113.7`,
        `client_ip${PLACE_SEPARATOR}203.0.113.7 `,
        `net.peer.ip${PLACE_SEPARATOR}203.0.113.7`,
        "no separator",
        `${PLACE_SEPARATOR}203.0.113.7`,
      ],
      ["80", "4", "2", "9", "9"],
    ],
  };

  test("counts sent as text or numbers; the records that are records; the places by key, the spelling most hold", () => {
    const read: SecurityTelemetryMentionRow | null =
      readSecurityTelemetryMentionRow(row, 3);

    expect(read).toEqual({
      valueIndex: 1,
      count: 1284,
      messageCount: 1200,
      lastSeen: new Date("2026-10-25T10:12:00.000Z"),
      sourceCount: 3,
      sources: [
        { type: "OpenTelemetry", id: SERVICE_ID, count: 1200 },
        { type: "Host", id: HIDDEN_ID, count: 84 },
      ],
      attributeKeys: [
        { key: "client_ip", count: 84, value: "203.0.113.7" },
        { key: "net.peer.ip", count: 2, value: "203.0.113.7" },
      ],
    });
  });

  test("a key holding a separator of its own is split at the last one", () => {
    const read: SecurityTelemetryMentionRow | null =
      readSecurityTelemetryMentionRow(
        {
          valueIndex: 2,
          totalCount: 5,
          places: [
            [`odd${PLACE_SEPARATOR}key${PLACE_SEPARATOR}evil.example`],
            [5],
          ],
        },
        3,
      );

    expect(read?.attributeKeys).toEqual([
      { key: `odd${PLACE_SEPARATOR}key`, count: 5, value: "evil.example" },
    ]);
  });

  test("a row of no value searched, or of no hit, is no row", () => {
    expect(
      readSecurityTelemetryMentionRow({ ...row, valueIndex: 0 }, 3),
    ).toBeNull();
    expect(
      readSecurityTelemetryMentionRow({ ...row, valueIndex: 4 }, 3),
    ).toBeNull();
    expect(
      readSecurityTelemetryMentionRow({ ...row, totalCount: "0" }, 3),
    ).toBeNull();
    expect(readSecurityTelemetryMentionRow({}, 3)).toBeNull();
  });

  test("the message's count never past the whole count; an empty window's time is none; a short source list never says fewer records", () => {
    const read: SecurityTelemetryMentionRow | null =
      readSecurityTelemetryMentionRow(
        {
          valueIndex: 1,
          totalCount: 2,
          messageTotal: 5,
          lastSeenAt: "1970-01-01 00:00:00.000000000",
          sourceCount: 0,
          sources: [[2, "OpenTelemetry", SERVICE_ID]],
          places: "not a tuple",
        },
        1,
      );

    expect(read).toEqual({
      valueIndex: 1,
      count: 2,
      messageCount: 2,
      lastSeen: null,
      sourceCount: 1,
      sources: [{ type: "OpenTelemetry", id: SERVICE_ID, count: 2 }],
      attributeKeys: [],
    });
  });
});
