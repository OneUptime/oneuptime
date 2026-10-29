import { formatQueryParams, toSearchParams } from "@clickhouse/client-common";
import ThreatIntelIndicatorService from "../../../../../Server/Services/ThreatIntelIndicatorService";
import {
  SQL,
  Statement,
} from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  MAX_DETECTION_READ_PARAMETER_BYTES,
  MAX_WATCHLIST_BYTES_PER_PARAMETER,
  WATCHLIST_ELEMENT,
  assertDetectionReadFits,
  buildWatchlistArrayMatch,
  buildWatchlistTextMatch,
  formatClickhouseParameterString,
  getParameterTextUrlBytes,
  getStatementParameterUrlBytes,
  getWatchlistValueUrlBytes,
  splitWatchlistValueParameters,
} from "../../../../../Server/Utils/SecurityEvent/Watchlists/SecurityWatchlistMatch";
import TableColumnType from "../../../../../Types/AnalyticsDatabase/TableColumnType";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import { SigmaWatchlist } from "../../../../../Types/SecurityEvent/SecurityWatchlist";
import { getJestSpyOn } from "../../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHETHER AN EVENT'S FIELD IS ON A WATCHLIST, AS SQL: what a rule's
 * `field|expand: '%name%'` compiles to. The statements' shape is pinned
 * here - every value bound, never written into the text; values as written
 * in a hash set, patterns and ranges one constant each, a feed's indicators
 * as a subquery - and real ClickHouse reads them in App's
 * SecurityWatchlistsClickhouse suite. So is the size of what a read sends:
 * @clickhouse/client sends parameters in the request URL, which ClickHouse
 * holds to 128 KiB a parameter and 1 MiB in all.
 */

const PROJECT_ID: string = "12121212-1212-4212-8212-121212121212";
const FEED_ID: string = "34343434-3434-4434-8434-343434343434";

function watchlist(overrides: Partial<SigmaWatchlist>): SigmaWatchlist {
  return {
    name: "vip_users",
    entityType: SecurityEntityType.User,
    exactValues: [],
    patterns: [],
    ranges: [],
    ...overrides,
  };
}

function params(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

const FIELD: Statement = new Statement(["principalUser"], []);

// What a read too large for one request is refused with, its size in kilobytes.
const TOO_LARGE_MESSAGE: RegExp =
  /^This rule reads more watchlist values than one read can send to the database: about [\d,]+ KB, where 900 KB fit\. Read fewer or shorter watchlists, or follow a threat intel feed for a long list\.$/;

afterEach(() => {
  jest.restoreAllMocks();
});

describe("values as written", () => {
  test("one hash set of the lowercased values, bound as an Array(String)", () => {
    const statement: Statement = buildWatchlistTextMatch(
      FIELD,
      watchlist({ exactValues: ["alice", "bob"] }),
    );

    expect(statement.query).toBe(
      "lowerUTF8(principalUser) IN {p0:Array(String)}",
    );
    expect(params(statement)).toEqual([["alice", "bob"]]);
  });

  test("a value never reaches the SQL text, whatever it holds", () => {
    const hostile: string = "x') OR 1=1 --";
    const statement: Statement = buildWatchlistTextMatch(
      FIELD,
      watchlist({ exactValues: [hostile] }),
    );

    expect(statement.query).not.toContain("OR 1=1");
    expect(params(statement)).toEqual([[hostile]]);
  });

  test("a long list is split over parameters of at most 100 KiB, ORed", () => {
    const values: Array<string> = [];

    for (let index: number = 0; index < 5000; index++) {
      // A SHA-256 digest: 64 characters.
      values.push(index.toString(16).padStart(64, "a"));
    }

    const statement: Statement = buildWatchlistTextMatch(
      FIELD,
      watchlist({ exactValues: values }),
    );
    const bound: Array<Array<string>> = params(statement) as Array<
      Array<string>
    >;

    expect(bound.length).toBeGreaterThan(1);
    expect(bound.flat()).toEqual(values);
    expect(statement.query).toContain(
      "(lowerUTF8(principalUser) IN {p0:Array(String)}) OR (lowerUTF8(principalUser) IN {p1:Array(String)})",
    );

    for (const group of bound) {
      const urlBytes: number = new URLSearchParams({
        p: formatQueryParams({ value: group }),
      }).toString().length;

      expect(urlBytes).toBeLessThanOrEqual(MAX_WATCHLIST_BYTES_PER_PARAMETER);
    }
  });
});

describe("patterns and ranges", () => {
  test("a pattern is one LIKE with a constant: * for any run, LIKE's own % _ and \\ written as they are", () => {
    const statement: Statement = buildWatchlistTextMatch(
      FIELD,
      watchlist({ patterns: ["svc-*", "100%_*\\done"] }),
    );

    expect(statement.query).toBe(
      "((lowerUTF8(principalUser) LIKE {p0:String}) OR (lowerUTF8(principalUser) LIKE {p1:String}))",
    );
    expect(params(statement)).toEqual(["svc-%", "100\\%\\_%\\\\done"]);
  });

  test("ranges: the address checked once, then each range, a constant each", () => {
    const statement: Statement = buildWatchlistTextMatch(
      new Statement(["principalIp"], []),
      watchlist({
        entityType: SecurityEntityType.IpAddress,
        ranges: ["10.20.0.0/16", "2001:db8::/32"],
      }),
    );

    expect(statement.query).toBe(
      "((isIPv4String(principalIp) OR isIPv6String(principalIp)) AND (isIPAddressInRange(if((isIPv4String(principalIp) OR isIPv6String(principalIp)), principalIp, '::'), {p0:String}) OR isIPAddressInRange(if((isIPv4String(principalIp) OR isIPv6String(principalIp)), principalIp, '::'), {p1:String})))",
    );
    expect(params(statement)).toEqual(["10.20.0.0/16", "2001:db8::/32"]);
  });

  test("values, patterns and ranges together: on the list when any matches", () => {
    const statement: Statement = buildWatchlistTextMatch(
      new Statement(["principalIp"], []),
      watchlist({
        entityType: SecurityEntityType.IpAddress,
        exactValues: ["203.0.113.7"],
        patterns: ["10.30.*"],
        ranges: ["10.20.0.0/16"],
      }),
    );

    expect(statement.query.startsWith("((lowerUTF8(principalIp) IN")).toBe(
      true,
    );
    expect(statement.query).toContain(") OR (lowerUTF8(principalIp) LIKE");
    expect(statement.query).toContain(") OR (((isIPv4String(principalIp)");
    expect(params(statement)).toEqual([
      ["203.0.113.7"],
      "10.30.%",
      "10.20.0.0/16",
    ]);
  });
});

describe("a list that follows a threat intel feed", () => {
  test("the field against the feed's active indicators of the list's kind, read where the rule runs", () => {
    getJestSpyOn(
      ThreatIntelIndicatorService.database,
      "getDatasourceOptions",
    ).mockReturnValue({ database: "oneuptime" } as never);

    const statement: Statement = buildWatchlistTextMatch(
      new Statement(["principalIp"], []),
      watchlist({
        name: "tor_exits",
        entityType: SecurityEntityType.IpAddress,
        threatIntelFeed: {
          projectId: PROJECT_ID,
          feedId: FEED_ID,
          indicatorTypes: ["ipv4-addr", "ipv6-addr"],
        },
      }),
    );

    expect(
      statement.query.startsWith(
        "lowerUTF8(principalIp) GLOBAL IN (SELECT lowerUTF8(indicatorValue) FROM (",
      ),
    ).toBe(true);
    expect(statement.query).toContain("FROM oneuptime.ThreatIntelIndicator");
    expect(params(statement)).toContain(PROJECT_ID);
    expect(params(statement)).toContain(FEED_ID);
    expect(params(statement)).toContainEqual(["ipv4-addr", "ipv6-addr"]);
    // Nothing of the feed's is copied into the statement: it is read where it runs.
    expect(statement.query).not.toContain(FEED_ID);
  });
});

describe("a list with nothing on it", () => {
  test("matches nothing, so `not` of it holds for every event", () => {
    const statement: Statement = buildWatchlistTextMatch(FIELD, watchlist({}));

    expect(statement.query).toBe("0");
    expect(params(statement)).toEqual([]);
  });

  test("a feed list whose feed is gone follows nothing, and matches nothing", () => {
    expect(
      buildWatchlistTextMatch(
        FIELD,
        watchlist({ entityType: SecurityEntityType.IpAddress }),
      ).query,
    ).toBe("0");
  });
});

describe("an array column: any of its elements on the list", () => {
  test("arrayExists over the column, with an element no column can shadow", () => {
    const statement: Statement = buildWatchlistArrayMatch(
      "observables",
      watchlist({ exactValues: ["evil.example"], patterns: ["*.onion"] }),
    );

    expect(WATCHLIST_ELEMENT).toBe("__watchlist_element");
    expect(statement.query).toBe(
      "arrayExists(__watchlist_element -> ((lowerUTF8(__watchlist_element) IN {p0:Array(String)}) OR (lowerUTF8(__watchlist_element) LIKE {p1:String})), observables)",
    );
    expect(params(statement)).toEqual([["evil.example"], "%.onion"]);
  });
});

describe("what a read sends", () => {
  test("a string is written into a parameter as the client writes it", () => {
    for (const value of [
      "plain",
      "it's",
      "back\\slash",
      "tab\there",
      "line\nbreak",
      "carriage\rreturn",
      "ünïcödé ✓",
      "%25 & = + ?",
      "",
    ]) {
      expect(formatClickhouseParameterString(value)).toBe(
        formatQueryParams({ value }),
      );
    }
  });

  test("a text's cost in the URL is what the client and URLSearchParams send, counted in one pass", () => {
    for (const value of [
      "plain-text_with.dots*",
      "with space",
      "it's",
      "back\\slash",
      "tab\there",
      "line\nbreak\r",
      "@:/?#[]!$&()+,;=~%",
      "ünïcödé",
      "日本語",
      "emoji 🚀 here",
      "lone \ud800 surrogate",
      "",
    ]) {
      expect(getParameterTextUrlBytes(value)).toBe(
        new URLSearchParams({ p: formatQueryParams({ value }) }).toString()
          .length - 2,
      );
    }
  });

  test("a value's cost in the URL is its share of the encoded Array(String)", () => {
    for (const values of [
      ["alice"],
      ["it's", "a\\b"],
      ["ünïcödé", "x y", "%41"],
    ]) {
      const encoded: number = new URLSearchParams({
        p: formatQueryParams({ value: values }),
      }).toString().length;
      const counted: number = values.reduce(
        (total: number, value: string): number => {
          return total + getWatchlistValueUrlBytes(value);
        },
        0,
      );

      // `p=` and `[]` around the values, and one comma fewer than counted.
      expect(counted).toBe(encoded - 2 - 6 + 3);
    }
  });

  test("groups keep their order and stay under their budget, a lone large value in a group of its own", () => {
    const groups: Array<Array<string>> = splitWatchlistValueParameters(
      ["a".repeat(40), "b".repeat(40), "c".repeat(200), "d"],
      100,
    );

    expect(groups).toEqual([
      ["a".repeat(40), "b".repeat(40)],
      ["c".repeat(200)],
      ["d"],
    ]);
    expect(splitWatchlistValueParameters([])).toEqual([]);
  });

  test("a statement's parameters are counted as the client sends them, never less", () => {
    const statement: Statement = SQL`a = ${{
      type: TableColumnType.Text,
      value: "it's ü",
    }} AND b IN ${{
      type: TableColumnType.ArrayText,
      value: ["x", "y'z", "ü"],
    }} AND c = ${{ type: TableColumnType.Number, value: 42 }}`;

    const sent: number = toSearchParams({
      database: "default",
      query_id: "q",
      query_params: statement.query_params,
    }).toString().length;
    const queryIdPart: number = "query_id=q".length;

    expect(getStatementParameterUrlBytes(statement)).toBeGreaterThanOrEqual(
      sent - queryIdPart,
    );
    // Within a few bytes: an & each, and the array's comma counted once more.
    expect(getStatementParameterUrlBytes(statement)).toBeLessThanOrEqual(
      sent - queryIdPart + 3 * 4,
    );
  });

  test("5,000 SHA-256 digests - a full list of them - fit one read", () => {
    const values: Array<string> = [];

    for (let index: number = 0; index < 5000; index++) {
      values.push(index.toString(16).padStart(64, "f"));
    }

    const statement: Statement = buildWatchlistTextMatch(
      FIELD,
      watchlist({ exactValues: values }),
    );

    expect(getStatementParameterUrlBytes(statement)).toBeLessThan(
      MAX_DETECTION_READ_PARAMETER_BYTES,
    );
    expect(() => {
      assertDetectionReadFits(statement);
    }).not.toThrow();
  });

  test("a read past what one request carries is refused with what to do", () => {
    const values: Array<string> = [];

    for (let index: number = 0; index < 5000; index++) {
      values.push(`${"v".repeat(200)}${index}`);
    }

    const statement: Statement = buildWatchlistTextMatch(
      FIELD,
      watchlist({ exactValues: values }),
    );

    expect(getStatementParameterUrlBytes(statement)).toBeGreaterThan(
      MAX_DETECTION_READ_PARAMETER_BYTES,
    );
    expect(() => {
      assertDetectionReadFits(statement);
    }).toThrow(BadDataException);
    expect(() => {
      assertDetectionReadFits(statement);
    }).toThrow(TOO_LARGE_MESSAGE);
  });

  test("the budget sits under ClickHouse's 1 MiB for the whole URL", () => {
    expect(MAX_DETECTION_READ_PARAMETER_BYTES).toBeLessThan(1024 * 1024);
    expect(MAX_WATCHLIST_BYTES_PER_PARAMETER).toBeLessThan(128 * 1024);
  });
});
