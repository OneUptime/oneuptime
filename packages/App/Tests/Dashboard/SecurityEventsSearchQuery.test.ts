import { describe, expect, test } from "@jest/globals";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
import Wildcard from "Common/Types/BaseDatabase/Wildcard";
import ObjectID from "Common/Types/ObjectID";
import { SearchHelpRow } from "Common/UI/Components/TelemetryViewer/types";
import { parseSearchQuery } from "Common/Types/Telemetry/TelemetrySearchQuery";
import {
  SECURITY_EVENT_CONTAINS_FIELDS,
  SECURITY_EVENT_FIELD_ALIASES,
  SECURITY_EVENT_NUMERIC_FIELDS,
  SECURITY_EVENT_SEARCH_COMBINED_EXAMPLE,
  SECURITY_EVENT_SEARCH_FIELD_KEYS,
  SECURITY_EVENT_SEARCH_HELP_ROWS,
  SECURITY_EVENT_SEARCH_SUGGESTIONS,
  SecurityEventSearchFilters,
  applySecurityEventSearchToQuery,
  hasSecurityEventSearch,
  parseSecurityEventSearch,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsSearchQuery";

/*
 * The Security Events search bar, compiled.
 *
 * It speaks the shared telemetry grammar, so what is pinned here is the part
 * that is this signal's own: which field names exist, which columns are
 * numeric, which are free text where an exact match would be the wrong
 * reading, and where a parsed token lands on the query.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const WINDOW_START: Date = new Date("2026-09-17T00:00:00.000Z");
const WINDOW_END: Date = new Date("2026-09-18T00:00:00.000Z");

function baseQuery(): Query<SecurityEvent> {
  return {
    projectId: PROJECT_ID,
    time: new InBetween<Date>(WINDOW_START, WINDOW_END),
  } as Query<SecurityEvent>;
}

function compiled(raw: string): Record<string, unknown> {
  return applySecurityEventSearchToQuery({
    query: baseQuery(),
    filters: parseSecurityEventSearch(raw),
  }) as Record<string, unknown>;
}

function attributesOf(raw: string): Record<string, unknown> {
  return (compiled(raw)["attributes"] || {}) as Record<string, unknown>;
}

describe("the field vocabulary", () => {
  test("every alias points at a real SecurityEvent column", () => {
    const columns: Array<string> = new SecurityEvent().tableColumns.map(
      (column: { key: string }): string => {
        return column.key;
      },
    );

    for (const column of Object.values(SECURITY_EVENT_FIELD_ALIASES)) {
      expect(columns).toContain(column);
    }
  });

  /*
   * The shared parser looks aliases up lowercased. An alias key with an
   * upper-case letter is simply never found, and the token it was meant to
   * catch silently becomes an attribute filter on a key that does not exist.
   */
  test("every alias key is lower case", () => {
    for (const key of Object.keys(SECURITY_EVENT_FIELD_ALIASES)) {
      expect(key).toBe(key.toLowerCase());
    }
  });

  test("the known-field set is exactly the alias keys", () => {
    expect([...SECURITY_EVENT_SEARCH_FIELD_KEYS].sort()).toEqual(
      Object.keys(SECURITY_EVENT_FIELD_ALIASES).sort(),
    );
  });

  test("every column's own name is accepted beside its friendly alias", () => {
    for (const [alias, column] of Object.entries(
      SECURITY_EVENT_FIELD_ALIASES,
    )) {
      expect(SECURITY_EVENT_FIELD_ALIASES[column.toLowerCase()]).toBe(column);
      expect(alias.length).toBeGreaterThan(0);
    }
  });

  test("every numeric and contains column is a real column", () => {
    const columns: Array<string> = new SecurityEvent().tableColumns.map(
      (column: { key: string }): string => {
        return column.key;
      },
    );

    for (const key of [
      ...SECURITY_EVENT_NUMERIC_FIELDS,
      ...SECURITY_EVENT_CONTAINS_FIELDS,
    ]) {
      expect(columns).toContain(key);
    }
  });

  test("every suggestion the bar offers is a field the parser knows", () => {
    for (const suggestion of SECURITY_EVENT_SEARCH_SUGGESTIONS) {
      expect(SECURITY_EVENT_SEARCH_FIELD_KEYS.has(suggestion)).toBe(true);
    }
  });
});

describe("the help table", () => {
  /*
   * The help cannot advertise syntax the parser does not have: the previous
   * generation of these tables described filters that matched nothing.
   */
  test("every example parses into at least one token", () => {
    for (const row of SECURITY_EVENT_SEARCH_HELP_ROWS as Array<SearchHelpRow>) {
      expect(
        parseSearchQuery(row.example, {
          knownFieldKeys: SECURITY_EVENT_SEARCH_FIELD_KEYS,
          fieldAliases: SECURITY_EVENT_FIELD_ALIASES,
        }).length,
      ).toBeGreaterThan(0);
    }
  });

  test("every field example compiles to a predicate, not to free text", () => {
    for (const row of SECURITY_EVENT_SEARCH_HELP_ROWS as Array<SearchHelpRow>) {
      if (!row.syntax.includes("<") || row.syntax.startsWith("-")) {
        continue;
      }

      const filters: SecurityEventSearchFilters = parseSecurityEventSearch(
        row.example,
      );

      expect(
        Object.keys(filters.fields).length +
          Object.keys(filters.attributes).length,
      ).toBeGreaterThan(0);
    }
  });

  test("the combined example is a real query too", () => {
    const filters: SecurityEventSearchFilters = parseSecurityEventSearch(
      SECURITY_EVENT_SEARCH_COMBINED_EXAMPLE,
    );

    expect(filters.fields["severityName"]).toBeInstanceOf(Includes);
    expect(filters.fields["statusName"]).toBeInstanceOf(NotEqual);
    expect(filters.attributes["threat.matched"]).toBe("true");
  });
});

describe("free text", () => {
  test("searches the message, which is the column with the token index", () => {
    const message: unknown = compiled("failed logon")["message"];

    expect(message).toBeInstanceOf(Search);
    expect((message as Search<string>).toString()).toBe("failed logon");
  });

  test("a quoted phrase keeps its spaces", () => {
    expect(
      (compiled('"brute force"')["message"] as Search<string>).toString(),
    ).toBe("brute force");
  });

  test("words either side of a filter are one search, not two phrases", () => {
    const filters: SecurityEventSearchFilters = parseSecurityEventSearch(
      "failed severity:High logon",
    );

    expect(filters.freeText).toBe("failed logon");
    expect(filters.fields["severityName"]).toBe("High");
  });

  test("no prose means no message predicate at all", () => {
    expect(parseSecurityEventSearch("severity:High").freeText).toBeNull();
    expect(compiled("severity:High")["message"]).toBeUndefined();
    expect(parseSecurityEventSearch("   ").freeText).toBeNull();
  });
});

describe("field filters", () => {
  test("a friendly alias and the column's own name mean the same thing", () => {
    expect(compiled("severity:Critical")["severityName"]).toBe("Critical");
    expect(compiled("severityName:Critical")["severityName"]).toBe("Critical");
  });

  test("the whole OCSF vocabulary reaches its column", () => {
    expect(compiled("class:Authentication")["className"]).toBe(
      "Authentication",
    );
    expect(compiled("category:IAM")["categoryName"]).toBe("IAM");
    expect(compiled("activity:Logon")["activityName"]).toBe("Logon");
    expect(compiled("status:Failure")["statusName"]).toBe("Failure");
    expect(compiled("vendor:Acme")["vendorName"]).toBe("Acme");
    expect(compiled("product:Defender")["productName"]).toBe("Defender");
    expect(compiled("rule:BruteForce")["ruleName"]).toBe("BruteForce");
    expect(compiled("user:alice")["principalUser"]).toBe("alice");
    expect(compiled("host:web-01")["principalHost"]).toBe("web-01");
    expect(compiled("ip:10.0.0.4")["principalIp"]).toBe("10.0.0.4");
    expect(compiled("targetuser:root")["targetUser"]).toBe("root");
    expect(compiled("targethost:db-01")["targetHost"]).toBe("db-01");
    expect(compiled("targetip:10.0.0.9")["targetIp"]).toBe("10.0.0.9");
    expect(compiled("uid:abc123")["eventUid"]).toBe("abc123");
  });

  test("negation, lists, wildcards and existence all reach the column", () => {
    expect(compiled("-severity:Informational")["severityName"]).toBeInstanceOf(
      NotEqual,
    );
    expect(
      compiled("severity:(High OR Critical)")["severityName"],
    ).toBeInstanceOf(Includes);
    expect(
      compiled("-severity:(High OR Critical)")["severityName"],
    ).toBeInstanceOf(IncludesNone);
    expect(compiled("host:web-*")["principalHost"]).toBeInstanceOf(Wildcard);
    expect(compiled("rule:*")["ruleName"]).toBeInstanceOf(NotNull);
    expect(compiled("-rule:*")["ruleName"]).toBeInstanceOf(IsNull);
  });

  test("the last token on a key wins, so an edited query means what it says", () => {
    expect(compiled("severity:Low severity:High")["severityName"]).toBe("High");
  });

  /*
   * These columns are UInt/Int. Comparing one to the STRING "443" is a type
   * error in ClickHouse, not a miss — the query fails rather than returning
   * nothing.
   */
  test("a numeric column gets a number", () => {
    expect(compiled("targetport:443")["targetPort"]).toBe(443);
    expect(compiled("severityid:5")["severityId"]).toBe(5);
    expect(compiled("classuid:3002")["classUid"]).toBe(3002);
  });

  test("a numeric column that is given prose keeps the string rather than NaN", () => {
    expect(compiled("targetport:http")["targetPort"]).toBe("http");
  });

  test("comparisons on a numeric column survive as comparisons", () => {
    expect(compiled("targetport:>1024")["targetPort"]).toBeInstanceOf(
      GreaterThan,
    );
  });

  /*
   * `message:refused` means "mentions refused"; the array columns are
   * matched per element, which is how "this event mentions X" is asked.
   */
  test("free-text and array columns default to contains, not equality", () => {
    for (const [token, column] of [
      ["message:refused", "message"],
      ["observable:10.0.0.4", "observables"],
      ["technique:T1110", "mitreTechniques"],
      ["tactic:TA0006", "mitreTactics"],
      ["process:/usr/bin/ssh", "principalProcess"],
      ["resource:/etc/passwd", "targetResource"],
    ] as Array<[string, string]>) {
      expect(compiled(token)[column]).toBeInstanceOf(Search);
    }
  });

  test("an explicit operator always beats the contains default", () => {
    expect(compiled("-observable:10.0.0.4")["observables"]).toBeInstanceOf(
      NotEqual,
    );
    expect(compiled("observable:(a OR b)")["observables"]).toBeInstanceOf(
      Includes,
    );
    expect(compiled("message:conn*")["message"]).toBeInstanceOf(Wildcard);
  });

  test("an exact-match column stays an exact match", () => {
    expect(compiled("severity:Critical")["severityName"]).toBe("Critical");
    expect(typeof compiled("user:alice")["principalUser"]).toBe("string");
  });
});

describe("attribute filters", () => {
  test("@key:value lands in the attributes map", () => {
    expect(attributesOf("@threat.matched:true")).toEqual({
      "threat.matched": "true",
    });
  });

  test("attribute keys keep the user's casing — the data is case sensitive", () => {
    expect(Object.keys(attributesOf("@Device.HostName:web-01"))).toEqual([
      "Device.HostName",
    ]);
  });

  test("wildcard, contains, existence and negation all reach the map", () => {
    expect(
      attributesOf("@device.hostname:web-*")["device.hostname"],
    ).toBeInstanceOf(Wildcard);
    expect(attributesOf("@title:~ransom")["title"]).toBeInstanceOf(Search);
    expect(
      attributesOf("@threat.indicator:*")["threat.indicator"],
    ).toBeInstanceOf(NotNull);
    expect(
      attributesOf("-@threat.matched:true")["threat.matched"],
    ).toBeInstanceOf(NotEqual);
  });

  /*
   * Every un-typed source field lands in the attributes map, so a field name
   * the parser does not recognise is almost certainly one of those. Dropping
   * it would silently WIDEN the list the user is looking at.
   */
  test("an unknown field name is read as an attribute rather than dropped", () => {
    const filters: SecurityEventSearchFilters = parseSecurityEventSearch(
      "finding_info.title:ransom",
    );

    expect(filters.fields).toEqual({});
    expect(filters.attributes["finding_info.title"]).toBe("ransom");
  });

  test("attribute predicates merge into a map the query already carries", () => {
    /*
     * Built through a Record view rather than a spread into
     * Query<SecurityEvent>: the model's key-mapped Query type is deep enough
     * that spreading into it trips TypeScript's instantiation-depth limit.
     */
    const pinned: Record<string, unknown> = {
      ...(baseQuery() as Record<string, unknown>),
      attributes: { "pinned.key": "pinned" },
    };

    const query: Query<SecurityEvent> = applySecurityEventSearchToQuery({
      query: pinned as Query<SecurityEvent>,
      filters: parseSecurityEventSearch("@threat.matched:true"),
    });

    expect((query as Record<string, unknown>)["attributes"]).toEqual({
      "pinned.key": "pinned",
      "threat.matched": "true",
    });
  });

  test("no attribute token leaves the map untouched", () => {
    expect(compiled("severity:High")["attributes"]).toBeUndefined();
  });

  test("a bare @key with no value is not a filter", () => {
    expect(parseSecurityEventSearch("@threat.matched").attributes).toEqual({});
  });
});

describe("applySecurityEventSearchToQuery", () => {
  test("never mutates the query it is given", () => {
    const query: Query<SecurityEvent> = baseQuery();

    applySecurityEventSearchToQuery({
      query,
      filters: parseSecurityEventSearch("severity:High @k:v failed"),
    });

    expect((query as Record<string, unknown>)["severityName"]).toBeUndefined();
    expect((query as Record<string, unknown>)["attributes"]).toBeUndefined();
    expect((query as Record<string, unknown>)["message"]).toBeUndefined();
  });

  test("keeps the scope it was handed", () => {
    const query: Record<string, unknown> = compiled("severity:High");

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["time"]).toBeInstanceOf(InBetween);
  });

  test("an empty search compiles to the scope and nothing else", () => {
    expect(Object.keys(compiled("")).sort()).toEqual(["projectId", "time"]);
    expect(Object.keys(compiled("   ")).sort()).toEqual(["projectId", "time"]);
  });
});

describe("hasSecurityEventSearch", () => {
  test("is true for anything the parser turns into a filter", () => {
    expect(hasSecurityEventSearch("failed logon")).toBe(true);
    expect(hasSecurityEventSearch("severity:High")).toBe(true);
    expect(hasSecurityEventSearch("@threat.matched:true")).toBe(true);
  });

  test("is false for nothing, whitespace, and a half-typed filter", () => {
    expect(hasSecurityEventSearch("")).toBe(false);
    expect(hasSecurityEventSearch("   ")).toBe(false);
    expect(hasSecurityEventSearch("severity:")).toBe(false);
  });
});
