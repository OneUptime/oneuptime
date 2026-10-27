import {
  CLICKHOUSE_DB_SYSTEM_NAME,
  CLICKHOUSE_HTTP_PARAMETERS,
  ObiClickHouseQuery,
  applyObiClickHouseHttpSpan,
  decodeQueryComponent,
  getObiClickHouseSpanName,
  readClickHouseStatement,
  readObiClickHouseHttpQuery,
} from "../../FeatureSet/Telemetry/Utils/ObiClickHouseHttpSpan";
import type { SpanKind } from "Common/Models/AnalyticsModels/Span";
import { describe, expect, test } from "@jest/globals";

/*
 * OBI records a call to ClickHouse's HTTP interface as a plain HTTP span
 * (`POST /`); ingest gives the ones that carry a statement in the URL's
 * `query` parameter ClickHouse's database semantics. These pin which spans
 * qualify, what they are given, and that everything else — health checks,
 * other APIs with a `query` parameter, server spans, SDK spans — is left
 * alone.
 *
 * Span attributes are the maps the ingest service builds: span keys bare,
 * resource keys `resource.`-prefixed. The fixture is a production span of
 * OneUptime's own fan-in writer, as OBI v0.14 recorded it.
 */

type Attributes = Record<string, unknown>;

// SpanKind's values, checked against the enum when this compiles.
function spanKind(text: `${SpanKind}`): SpanKind {
  return text as SpanKind;
}

const CLIENT: SpanKind = spanKind("SPAN_KIND_CLIENT");
const SERVER: SpanKind = spanKind("SPAN_KIND_SERVER");
const PRODUCER: SpanKind = spanKind("SPAN_KIND_PRODUCER");
const CONSUMER: SpanKind = spanKind("SPAN_KIND_CONSUMER");
const INTERNAL: SpanKind = spanKind("SPAN_KIND_INTERNAL");

const OBI_RESOURCE: Attributes = {
  "resource.service.name": "oneuptime-app",
  "resource.telemetry.sdk.language": "nodejs",
  "resource.telemetry.sdk.name": "opentelemetry-ebpf-instrumentation",
  "resource.telemetry.distro.name": "opentelemetry-ebpf-instrumentation",
  "resource.telemetry.distro.version": "v0.14.0",
  "resource.k8s.namespace.name": "default",
  "resource.k8s.cluster.name": "oneuptime-prod",
};

const PRODUCTION_QUERY_STRING: string =
  "query_id=1472fec1-bab2-4dbf-b613-b94c6d8bc0e2&async_insert=1&wait_for_async_insert=0&async_insert_deduplicate=1&insert_deduplication_token=fanin%3ALogItemV3%3A01a17c37-62b6-7a50-a87a-adb5cc36ec4b&database=oneuptime&query=INSERT+INTO+LogItemV3+FORMAT";

// The production span: the fan-in writer's async insert into LogItemV3.
function fanInInsert(overrides: Attributes = {}): Attributes {
  return {
    ...OBI_RESOURCE,
    "server.address": "oneuptime-clickhouse",
    "server.port": "4129",
    "service.peer.name": "oneuptime-clickhouse",
    "http.request.method": "POST",
    "http.response.status_code": "200",
    "url.scheme": "http",
    "url.full": `/?${PRODUCTION_QUERY_STRING}`,
    "url.query": PRODUCTION_QUERY_STRING,
    "network.peer.address": "10.96.14.201",
    "network.peer.port": "4129",
    "network.protocol.version": "1.1",
    ...overrides,
  };
}

// The health check the same writer makes: no query at all.
function healthCheck(overrides: Attributes = {}): Attributes {
  return {
    ...OBI_RESOURCE,
    "server.address": "oneuptime-clickhouse",
    "server.port": "4129",
    "service.peer.name": "oneuptime-clickhouse",
    "http.request.method": "GET",
    "http.response.status_code": "200",
    "url.scheme": "http",
    "url.full": "http://oneuptime-clickhouse.default.svc.cluster.local/",
    "url.path": "/",
    ...overrides,
  };
}

// A span whose URL carries `queryString`, everything else as in production.
function withQueryString(
  queryString: string,
  overrides: Attributes = {},
): Attributes {
  return fanInInsert({
    "url.full": `/?${queryString}`,
    "url.query": queryString,
    ...overrides,
  });
}

function without(attributes: Attributes, ...keys: Array<string>): Attributes {
  const copy: Attributes = { ...attributes };
  for (const key of keys) {
    delete copy[key];
  }
  return copy;
}

function read(
  attributes: Attributes,
  kind: SpanKind = CLIENT,
): ObiClickHouseQuery | null {
  return readObiClickHouseHttpQuery({ kind: kind, attributes: attributes });
}

// The span name a query string gives a span, or null when it gives none.
function nameFor(queryString: string): string | null {
  const query: ObiClickHouseQuery | null = read(withQueryString(queryString));
  return query ? getObiClickHouseSpanName(query) : null;
}

describe("readObiClickHouseHttpQuery: OBI's ClickHouse HTTP calls", () => {
  test("the production insert: database, decoded statement, operation and table", () => {
    expect(read(fanInInsert())).toEqual({
      queryText: "INSERT INTO LogItemV3 FORMAT",
      operationName: "INSERT",
      collectionName: "LogItemV3",
      namespace: "oneuptime",
    });
  });

  test("without url.query, the query string is read from url.full, relative or absolute", () => {
    for (const full of [
      `/?${PRODUCTION_QUERY_STRING}`,
      `http://oneuptime-clickhouse:4129/?${PRODUCTION_QUERY_STRING}`,
      `http://oneuptime-clickhouse:4129/?${PRODUCTION_QUERY_STRING}#ignored`,
    ]) {
      expect({
        full: full,
        query: read(without(fanInInsert({ "url.full": full }), "url.query")),
      }).toEqual({
        full: full,
        query: {
          queryText: "INSERT INTO LogItemV3 FORMAT",
          operationName: "INSERT",
          collectionName: "LogItemV3",
          namespace: "oneuptime",
        },
      });
    }
  });

  test("url.query with the question mark kept is read the same", () => {
    expect(
      read(fanInInsert({ "url.query": `?${PRODUCTION_QUERY_STRING}` })),
    ).toEqual(read(fanInInsert()));
  });

  test("a GET with the statement in the URL, and no database parameter", () => {
    expect(
      read(
        healthCheck({
          "url.query": "query_id=3f2c&query=SELECT%201",
          "url.full": "/?query_id=3f2c&query=SELECT%201",
        }),
      ),
    ).toEqual({
      queryText: "SELECT 1",
      operationName: "SELECT",
      collectionName: null,
      namespace: null,
    });
  });

  test("each ClickHouse parameter alone is enough beside `query`", () => {
    for (const parameter of CLICKHOUSE_HTTP_PARAMETERS) {
      expect({
        parameter: parameter,
        name: nameFor(`${parameter}=1&query=SELECT+1+FROM+t`),
      }).toEqual({ parameter: parameter, name: "SELECT t" });
    }
  });

  test("the parameters may come in any order, and the first `query` wins", () => {
    expect(nameFor("query=INSERT+INTO+a+FORMAT+Native&database=db")).toBe(
      "INSERT a",
    );
    expect(nameFor("database=db&query=INSERT+INTO+a&query=INSERT+INTO+b")).toBe(
      "INSERT a",
    );
    expect(
      read(withQueryString("database=one&database=two&query=SELECT+1")),
    ).toMatchObject({
      namespace: "one",
    });
  });

  test("an empty database parameter names no namespace", () => {
    expect(
      read(withQueryString("database=&query_id=1&query=SELECT+1")),
    ).toMatchObject({ namespace: null });
    expect(
      read(withQueryString("database&query_id=1&query=SELECT+1")),
    ).toMatchObject({ namespace: null });
  });
});

describe("readObiClickHouseHttpQuery: what is left alone", () => {
  test("the health check, GET / with no query string", () => {
    expect(read(healthCheck())).toBeNull();
    expect(
      read(healthCheck({ "url.full": "/ping", "url.path": "/ping" })),
    ).toBeNull();
  });

  test("a statement with no ClickHouse parameter beside it", () => {
    expect(read(withQueryString("query=SELECT+1"))).toBeNull();
    expect(
      read(withQueryString("query=SELECT+1&format=json&user=default")),
    ).toBeNull();
  });

  test("other APIs that take a query parameter", () => {
    for (const queryString of [
      // Prometheus' instant query.
      "query=up&time=1730000000",
      "query=rate(http_requests_total%5B5m%5D)&database=metrics",
      // A search API.
      "query=red+shoes&page=2",
      "query=red+shoes&database=products",
      // GraphQL over GET.
      "query=query+GetUser+%7B+user+%7B+id+%7D+%7D&database=main",
      "query=%7B+users+%7B+id+%7D+%7D&query_id=7",
      // QuestDB's REST API: SQL, but none of ClickHouse's parameters.
      "query=SELECT+*+FROM+trades&count=true&limit=10",
      // Loki: a LogQL selector.
      "query=%7Bapp%3D%22api%22%7D&database=logs",
    ]) {
      expect({
        queryString: queryString,
        query: read(withQueryString(queryString)),
      }).toEqual({
        queryString: queryString,
        query: null,
      });
    }
  });

  test("a blank or missing statement", () => {
    for (const queryString of [
      "database=oneuptime",
      "database=oneuptime&query=",
      "database=oneuptime&query=+++",
      "database=oneuptime&query",
      "database=oneuptime&q=SELECT+1",
      "database=oneuptime&queryText=SELECT+1",
    ]) {
      expect({
        queryString: queryString,
        query: read(withQueryString(queryString)),
      }).toEqual({
        queryString: queryString,
        query: null,
      });
    }
  });

  test("a statement that does not start with a statement keyword", () => {
    for (const statement of [
      "hello",
      "1+%2B+1",
      "SELECTED",
      "%27SELECT%27",
      "--+only+a+comment",
      "%2F*+only+a+comment+*%2F",
    ]) {
      expect({
        statement: statement,
        query: read(withQueryString(`database=db&query=${statement}`)),
      }).toEqual({ statement: statement, query: null });
    }
  });

  test("any kind but CLIENT: the span ClickHouse's own server reports, and the rest", () => {
    for (const kind of [SERVER, PRODUCER, CONSUMER, INTERNAL]) {
      expect({ kind: kind, query: read(fanInInsert(), kind) }).toEqual({
        kind: kind,
        query: null,
      });
    }
  });

  test("an application SDK's span, or one with no distro", () => {
    expect(
      read(
        fanInInsert({
          "resource.telemetry.distro.name": "opentelemetry-js-instrumentation",
        }),
      ),
    ).toBeNull();
    expect(
      read(without(fanInInsert(), "resource.telemetry.distro.name")),
    ).toBeNull();
  });

  test("a method other than GET or POST, or no HTTP method", () => {
    for (const method of ["PUT", "DELETE", "post", "", 1]) {
      expect({
        method: method,
        query: read(fanInInsert({ "http.request.method": method })),
      }).toEqual({ method: method, query: null });
    }
    expect(read(without(fanInInsert(), "http.request.method"))).toBeNull();
  });

  test("a span that already names a database or messaging system", () => {
    const named: Array<[string, string]> = [
      ["db.system.name", "clickhouse"],
      ["db.system", "clickhouse"],
      ["db.system.name", "postgresql"],
      ["messaging.system", "kafka"],
    ];
    for (const [key, value] of named) {
      expect({
        key: key,
        query: read(fanInInsert({ [key]: value })),
      }).toEqual({ key: key, query: null });
    }
  });

  test("no attributes at all", () => {
    expect(
      readObiClickHouseHttpQuery({ kind: CLIENT, attributes: null }),
    ).toBeNull();
    expect(
      readObiClickHouseHttpQuery({ kind: CLIENT, attributes: undefined }),
    ).toBeNull();
  });

  test("a query string that is not a string", () => {
    expect(
      read(without(fanInInsert({ "url.full": 7 }), "url.query")),
    ).toBeNull();
    expect(
      read(fanInInsert({ "url.query": ["query=SELECT+1"], "url.full": "/" })),
    ).toBeNull();
  });
});

describe("decodeQueryComponent", () => {
  test("a form's spelling: + is a space, %XX a byte of UTF-8", () => {
    expect(decodeQueryComponent("INSERT+INTO+LogItemV3+FORMAT")).toBe(
      "INSERT INTO LogItemV3 FORMAT",
    );
    expect(decodeQueryComponent("fanin%3ALogItemV3%3A01a1")).toBe(
      "fanin:LogItemV3:01a1",
    );
    expect(decodeQueryComponent("a%2Bb+c%20d")).toBe("a+b c d");
    expect(decodeQueryComponent("caf%C3%A9+%E2%82%AC+%F0%9F%98%80")).toBe(
      "café € 😀",
    );
    expect(decodeQueryComponent("plain")).toBe("plain");
    expect(decodeQueryComponent("")).toBe("");
  });

  test("what is no escape is kept as written", () => {
    expect(decodeQueryComponent("100%")).toBe("100%");
    expect(decodeQueryComponent("50%25+off")).toBe("50% off");
    expect(decodeQueryComponent("%ZZ%4")).toBe("%ZZ%4");
    expect(decodeQueryComponent("%%41")).toBe("%A");
  });

  test("a character the cut left half of stays as written; the rest of its run decodes", () => {
    expect(decodeQueryComponent("SELECT+%27%E2%82")).toBe("SELECT '%E2%82");
    expect(decodeQueryComponent("%C3%A9%E2%82")).toBe("é%E2%82");
    expect(decodeQueryComponent("%E2%82%C3%A9")).toBe("%E2%82é");
    expect(decodeQueryComponent("%FF%41")).toBe("%FFA");
    expect(decodeQueryComponent("%80%80")).toBe("%80%80");
  });
});

// A statement, the operation it is, and the table it names.
const STATEMENTS: Array<[string, string, string | null]> = [
  ["INSERT INTO LogItemV3 FORMAT", "INSERT", "LogItemV3"],
  ["INSERT INTO LogItemV3 FORMAT JSONEachRow", "INSERT", "LogItemV3"],
  [
    "insert into oneuptime.SpanItemV3 format Native",
    "INSERT",
    "oneuptime.SpanItemV3",
  ],
  ["INSERT INTO TABLE t (a, b) VALUES (1, 2)", "INSERT", "t"],
  [
    'INSERT INTO "oneuptime"."Log Items" FORMAT CSV',
    "INSERT",
    "oneuptime.Log Items",
  ],
  ["INSERT INTO `db`.`t`(a) SELECT 1", "INSERT", "db.t"],
  ["INSERT INTO FUNCTION remote('h', db.t) VALUES (1)", "INSERT", null],
  ["INSERT INTO {table:Identifier} VALUES (1)", "INSERT", null],
  ["  /* writer */ INSERT INTO t FORMAT Native", "INSERT", "t"],
  ["-- writer\nINSERT INTO t FORMAT Native", "INSERT", "t"],
  ["# writer\nINSERT INTO t FORMAT Native", "INSERT", "t"],
  ["SELECT 1", "SELECT", null],
  ["SELECT count() FROM system.parts WHERE active", "SELECT", "system.parts"],
  ["select * from t final", "SELECT", "t"],
  ["SELECT 'FROM x' AS a, b -- FROM y\nFROM t", "SELECT", "t"],
  ["SELECT extract(YEAR FROM d), trim(BOTH ' ' FROM s) FROM t", "SELECT", "t"],
  ["SELECT * FROM (SELECT * FROM inner_t)", "SELECT", null],
  ["SELECT * FROM numbers(10)", "SELECT", null],
  ["SELECT a FROM t1 JOIN t2 ON t1.k = t2.k", "SELECT", "t1"],
  ["(SELECT a FROM t) UNION ALL (SELECT a FROM u)", "SELECT", "t"],
  ["WITH x AS (SELECT * FROM a) SELECT * FROM b", "WITH", "b"],
  ["WITH 1 AS one SELECT one", "WITH", null],
  ["DELETE FROM t WHERE id = 1", "DELETE", "t"],
  ["SHOW TABLES FROM oneuptime", "SHOW", null],
  ["CREATE TABLE t (a UInt8) ENGINE = Memory", "CREATE", null],
  ["ALTER TABLE t DELETE WHERE 1", "ALTER", null],
  ["OPTIMIZE TABLE t FINAL", "OPTIMIZE", null],
  ["EXISTS TABLE t", "EXISTS", null],
  ["SYSTEM FLUSH LOGS", "SYSTEM", null],
  ["SELECT * FROM t WHERE s = 'it''s' AND u = 'a\\'b'", "SELECT", "t"],
  ["SELECT * FROM", "SELECT", null],
  ["SELECT * FROM 'unterminated", "SELECT", null],
];

describe("readClickHouseStatement: the operation and the table", () => {
  test.each(STATEMENTS)(
    "%s",
    (queryText: string, operation: string, table: string | null) => {
      expect(readClickHouseStatement(queryText)).toEqual({
        operationName: operation,
        collectionName: table,
      });
    },
  );

  test("text that is no statement", () => {
    for (const text of [
      "",
      "   ",
      "(",
      "1",
      "'SELECT'",
      "`SELECT`",
      "unknown x",
    ]) {
      expect({ text: text, statement: readClickHouseStatement(text) }).toEqual({
        text: text,
        statement: null,
      });
    }
  });
});

describe("getObiClickHouseSpanName", () => {
  test("OTel's database span name: the operation and the table, or the operation alone", () => {
    expect(nameFor(PRODUCTION_QUERY_STRING)).toBe("INSERT LogItemV3");
    expect(nameFor("database=db&query=SELECT+1")).toBe("SELECT");
    expect(nameFor("database=db&query=SELECT+*+FROM+db.t")).toBe("SELECT db.t");
  });
});

describe("applyObiClickHouseHttpSpan", () => {
  test("adds ClickHouse's database attributes, keeps every attribute OBI wrote, and returns the name", () => {
    const original: Attributes = fanInInsert();
    const attributes: Attributes = { ...original };

    expect(applyObiClickHouseHttpSpan({ kind: CLIENT, attributes })).toBe(
      "INSERT LogItemV3",
    );
    expect(attributes).toEqual({
      ...original,
      "db.system.name": CLICKHOUSE_DB_SYSTEM_NAME,
      "db.namespace": "oneuptime",
      "db.query.text": "INSERT INTO LogItemV3 FORMAT",
      "db.operation.name": "INSERT",
      "db.collection.name": "LogItemV3",
    });
    expect(CLICKHOUSE_DB_SYSTEM_NAME).toBe("clickhouse");
  });

  test("no namespace or table attribute when the call names none", () => {
    const attributes: Attributes = withQueryString("query_id=1&query=SELECT+1");
    expect(applyObiClickHouseHttpSpan({ kind: CLIENT, attributes })).toBe(
      "SELECT",
    );
    expect(attributes).not.toHaveProperty("db.namespace");
    expect(attributes).not.toHaveProperty("db.collection.name");
    expect(attributes["db.query.text"]).toBe("SELECT 1");
  });

  test("changes nothing on a span that is not a ClickHouse call", () => {
    for (const attributes of [
      healthCheck(),
      withQueryString("query=up&time=1"),
      fanInInsert({
        "resource.telemetry.distro.name": "opentelemetry-js-instrumentation",
      }),
    ]) {
      const before: Attributes = { ...attributes };
      expect(
        applyObiClickHouseHttpSpan({ kind: CLIENT, attributes }),
      ).toBeNull();
      expect(attributes).toEqual(before);
    }
    const server: Attributes = fanInInsert();
    expect(
      applyObiClickHouseHttpSpan({ kind: SERVER, attributes: server }),
    ).toBeNull();
    expect(server).toEqual(fanInInsert());
    expect(
      applyObiClickHouseHttpSpan({ kind: CLIENT, attributes: null }),
    ).toBeNull();
  });
});

describe("values of any length are read in one pass", () => {
  test("a statement a megabyte long, a cut escape at its end", () => {
    const columns: string = "a%2C+".repeat(200_000);
    const queryString: string = `query_id=1&database=db&query=INSERT+INTO+t+(${columns}z)+VALUES%E2%82`;
    const query: ObiClickHouseQuery | null = read(withQueryString(queryString));
    expect(query?.operationName).toBe("INSERT");
    expect(query?.collectionName).toBe("t");
    expect(query?.queryText.endsWith("z) VALUES%E2%82")).toBe(true);
    expect(query?.queryText.length).toBe(
      "INSERT INTO t (".length +
        200_000 * "a, ".length +
        "z) VALUES%E2%82".length,
    );
  });

  test("a query string of nothing but separators, or of parameters without values", () => {
    expect(read(withQueryString("&".repeat(1_000_000)))).toBeNull();
    expect(read(withQueryString("x&".repeat(500_000)))).toBeNull();
    expect(
      read(
        withQueryString(`${"x&".repeat(500_000)}database=db&query=SELECT+1`),
      ),
    ).toMatchObject({ operationName: "SELECT", namespace: "db" });
  });

  test("a statement whose comment, string or quoted name never closes", () => {
    for (const tail of ["/*", "'", "`", '"', "--"]) {
      const text: string = `SELECT * ${tail}${"x".repeat(1_000_000)}`;
      expect({ tail: tail, statement: readClickHouseStatement(text) }).toEqual({
        tail: tail,
        statement: { operationName: "SELECT", collectionName: null },
      });
    }
  });
});
