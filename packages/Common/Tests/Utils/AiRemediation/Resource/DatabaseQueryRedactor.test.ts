import {
  DATABASE_LITERAL_PLACEHOLDER,
  DATABASE_REDACTED_MARKER,
  DATABASE_UNREDACTABLE_OUTPUT,
  DatabaseQueryRedaction,
  looksLikeSqlStatement,
  normalizeSqlText,
  redactDatabaseOutput,
  redactDatabaseQueryText,
  redactRedisCommandArguments,
} from "../../../../Utils/AiRemediation/Resource/DatabaseQueryRedactor";
import {
  RESOURCE_REDACTED_MARKER,
  getResourceOutputRedactionHooks,
  redactResourceCommandOutput,
  redactResourceCommandOutputWithCount,
} from "../../../../Utils/AiRemediation/Resource/ResourceOutputRedactor";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test — DatabaseQueryRedactor, the "db" output hook.
 *
 * - normalizeSqlText: every string literal (all quoting styles and
 *   prefixes, dollar-quoted bodies) becomes '?', every number literal ?,
 *   a double-quoted word "?" unless it can only be a name; bind
 *   parameters, names and backtick identifiers stay.
 * - redactDatabaseOutput finds statements in JSON string values (by key or
 *   by shape) and in plain text (fields, table columns, continuation
 *   lines), masks single-quoted literals anywhere in plain text, and masks
 *   credentials and row data: PASSWORD / IDENTIFIED BY values, Redis AUTH /
 *   HELLO / MIGRATE / CONFIG SET / ACL SETUSER secrets, data values of
 *   Redis write commands, credential settings, InnoDB record dumps.
 * - Output that holds none of these passes through byte for byte; JSON
 *   stays valid JSON; the hook is idempotent, total and fails closed.
 * - Wired as ResourceOutputRedactor's "db" hook, before the generic rules.
 */

function redact(text: string): string {
  return redactDatabaseOutput({
    resourceType: AiResourceType.DatabaseServer,
    program: "db",
    text,
  }).text;
}

function redactWithCount(text: string): DatabaseQueryRedaction {
  return redactDatabaseOutput({
    resourceType: AiResourceType.DatabaseServer,
    program: "db",
    text,
  });
}

describe("the markers", () => {
  test("a literal becomes ?, a credential the generic marker", () => {
    expect(DATABASE_LITERAL_PLACEHOLDER).toBe("?");
    expect(DATABASE_REDACTED_MARKER).toBe(RESOURCE_REDACTED_MARKER);
  });
});

describe("normalizeSqlText", () => {
  test.each([
    [
      "SELECT * FROM users WHERE email = 'a@b.com'",
      "SELECT * FROM users WHERE email = '?'",
      1,
    ],
    ["SELECT * FROM t WHERE id = 42", "SELECT * FROM t WHERE id = ?", 1],
    [
      "UPDATE t SET a = 3.14, b = 1e9, c = 0x1F WHERE id = -7",
      "UPDATE t SET a = ?, b = ?, c = ? WHERE id = -?",
      4,
    ],
    ["SELECT .5, 1., 12.5e-3", "SELECT ?, ?, ?", 3],
    [
      "SELECT $1, $2::int FROM t1 WHERE t1.col2 = $3",
      "SELECT $1, $2::int FROM t1 WHERE t1.col2 = $3",
      0,
    ],
    ["SELECT 'it''s', 'a\\'b'", "SELECT '?', '?'", 2],
    ["SELECT 'a\\' , 'secret'", "SELECT '?'", 1],
    [
      "SELECT E'\\x41', N'x', X'4142', B'101', _utf8mb4'abc', U&'d0061t'",
      "SELECT E'?', N'?', X'?', B'?', _utf8mb4'?', U&'?'",
      6,
    ],
    ["DO $$ BEGIN PERFORM 1; END $$", "DO $$?$$", 1],
    ["SELECT $fn$ secret $fn$ FROM x", "SELECT $fn$?$fn$ FROM x", 1],
    ["SELECT $tag$ never closed", "SELECT $tag$?", 1],
    [
      'SELECT "users"."email" FROM "users" WHERE "id" = 5',
      'SELECT "users"."email" FROM "users" WHERE "?" = ?',
      2,
    ],
    [
      'SELECT * FROM t WHERE name = "bob"',
      'SELECT * FROM t WHERE name = "?"',
      1,
    ],
    [
      'ALTER USER bob IDENTIFIED BY "hunter2"',
      'ALTER USER bob IDENTIFIED BY "?"',
      1,
    ],
    [
      'ALTER USER bob IDENTIFIED WITH caching_sha2_password AS "hash"',
      'ALTER USER bob IDENTIFIED WITH caching_sha2_password AS "?"',
      1,
    ],
    [
      "CREATE USER x WITH PASSWORD 'hunter2'",
      "CREATE USER x WITH PASSWORD '?'",
      1,
    ],
    [
      'INSERT INTO "orders" ("id", "note") VALUES (1, "x")',
      'INSERT INTO "orders" ("?", "?") VALUES (?, "?")',
      4,
    ],
    ["SELECT `col1` FROM `t2` LIMIT 10", "SELECT `col1` FROM `t2` LIMIT ?", 1],
    ["SELECT 'unterminated", "SELECT '?'", 1],
    [
      "INSERT INTO t VALUES (1, 'a'), (2, 'b')",
      "INSERT INTO t VALUES (?, '?'), (?, '?')",
      4,
    ],
    ["SELECT 1col FROM t", "SELECT 1col FROM t", 0],
    [
      "SELECT 'é' FROM données WHERE x = 5",
      "SELECT '?' FROM données WHERE x = ?",
      2,
    ],
    [
      "SELECT * FROM t WHERE ts > now() - interval '5 minutes'",
      "SELECT * FROM t WHERE ts > now() - interval '?'",
      1,
    ],
    [
      "SELECT * FROM t /* controller='users',id=7 */",
      "SELECT * FROM t /* controller='?',id=? */",
      2,
    ],
    ["SELECT '?' FROM t WHERE a = ?", "SELECT '?' FROM t WHERE a = ?", 0],
    ["", "", 0],
  ])("%p", (sql: string, expected: string, count: number) => {
    expect(normalizeSqlText(sql)).toEqual({
      text: expected,
      redactionCount: count,
    });
    expect(redactDatabaseQueryText(sql)).toBe(expected);
  });

  test.each([
    ["SELECT * FROM users WHERE email = 'a@b.com' AND id = 42"],
    ['SELECT "a" FROM "b" WHERE "c" = "d" AND e IN (1, 2.5, 0x3)'],
    ["DO $x$ select 1 $x$; SELECT E'a\\'b', 'c''d'"],
  ])("is idempotent: %p", (sql: string) => {
    const once: DatabaseQueryRedaction = normalizeSqlText(sql);
    const twice: DatabaseQueryRedaction = normalizeSqlText(once.text);

    expect(twice.text).toBe(once.text);
    expect(twice.redactionCount).toBe(0);
  });

  test("a non-string is empty", () => {
    expect(normalizeSqlText(null as unknown as string)).toEqual({
      text: "",
      redactionCount: 0,
    });
  });
});

describe("looksLikeSqlStatement", () => {
  test.each([
    ["SELECT 1", true],
    ["  select * from t", true],
    ["(SELECT 1) UNION (SELECT 2)", true],
    ["/* app=web */ UPDATE t SET a = 1", true],
    ["-- note\nDELETE FROM t", true],
    ["WITH x AS (SELECT 1) SELECT * FROM x", true],
    ["BEGIN;", true],
    ["SELECT*FROM t", true],
    ["selection of rows", false],
    ["set_config", false],
    ["active", false],
    ["idle in transaction", false],
    ["client backend", false],
    ["", false],
  ])("%p: %p", (text: string, expected: boolean) => {
    expect(looksLikeSqlStatement(text)).toBe(expected);
  });
});

describe("statements in JSON output", () => {
  test("a query column is normalized; every other value stays", () => {
    const text: string = JSON.stringify([
      {
        pid: 4242,
        usename: "app",
        state: "active",
        query: "SELECT * FROM users WHERE email = 'a@b.com' AND id = 42",
        backend_type: "client backend",
        duration_ms: 1234,
      },
    ]);
    const result: DatabaseQueryRedaction = redactWithCount(text);

    expect(JSON.parse(result.text)).toEqual([
      {
        pid: 4242,
        usename: "app",
        state: "active",
        query: "SELECT * FROM users WHERE email = '?' AND id = ?",
        backend_type: "client backend",
        duration_ms: 1234,
      },
    ]);
    expect(result.redactionCount).toBe(2);
  });

  test("pretty-printed JSON keeps its layout", () => {
    const text: string = JSON.stringify(
      { pid: 1, query: "select 1 where x = 'y'" },
      null,
      2,
    );

    expect(redact(text)).toBe(
      JSON.stringify({ pid: 1, query: "select ? where x = '?'" }, null, 2),
    );
  });

  test.each([
    [
      "info",
      "/* app */ select * from t where id = 5",
      "/* app */ select * from t where id = ?",
    ],
    ["INFO", "SELECT 7", "SELECT ?"],
    [
      "digest_text",
      "SELECT * FROM `t` WHERE `a` = 3",
      "SELECT * FROM `t` WHERE `a` = ?",
    ],
    ["sql_text", "UPDATE t SET a = 'b'", "UPDATE t SET a = '?'"],
    [
      "query_sample_text",
      "DELETE FROM t WHERE id = 9",
      "DELETE FROM t WHERE id = ?",
    ],
    [
      "query",
      "idle-in-transaction since 12:00 'x'",
      "idle-in-transaction since ?:? '?'",
    ],
    ["text", "DELETE FROM t WHERE id = 5", "DELETE FROM t WHERE id = ?"],
    ["note", "not a statement 5 'x'", "not a statement 5 'x'"],
  ])("key %s", (key: string, value: string, expected: string) => {
    const text: string = JSON.stringify({ [key]: value, n: 3 });

    expect(JSON.parse(redact(text))).toEqual({ [key]: expected, n: 3 });
  });

  test("escaped quotes and line breaks survive as valid JSON", () => {
    const text: string = JSON.stringify({
      query: "SELECT \"a\" FROM t\nWHERE b = 'x' AND c = 5",
      calls: 12,
    });
    const redacted: string = redact(text);

    expect(JSON.parse(redacted)).toEqual({
      query: "SELECT \"?\" FROM t\nWHERE b = '?' AND c = ?",
      calls: 12,
    });
  });

  test("a key named like a query with a number value is left alone", () => {
    const text: string =
      '{"opcounters": {"insert": 5, "query": 10, "update": 3}}';

    expect(redact(text)).toBe(text);
  });

  test("a value under a query key is normalized even when it does not start like a statement", () => {
    expect(redact('{"query": "<IDLE> 42"}')).toBe('{"query": "<IDLE> ?"}');
  });

  test("JSON with no statements passes through byte for byte", () => {
    const text: string = JSON.stringify(
      {
        state: "active",
        backend_type: "client backend",
        wait_event: "ClientRead",
        numbers: [1, 2, 3],
        version: "PostgreSQL 16.4 on x86_64",
      },
      null,
      4,
    );

    expect(redact(text)).toBe(text);
  });
});

describe("statements in plain-text output", () => {
  test.each([
    [
      "psql-style table: the next column stays",
      "pid | state | query | secs\n123 | active | SELECT * FROM users WHERE email = 'a@b.com' AND id = 42 | 5",
      "pid | state | query | secs\n123 | active | SELECT * FROM users WHERE email = '?' AND id = ? | 5",
    ],
    [
      "tab-separated: the next column stays",
      "123\tactive\tSELECT * FROM t WHERE id = 42\t5",
      "123\tactive\tSELECT * FROM t WHERE id = ?\t5",
    ],
    [
      "vertical key: value",
      "Id: 7\nInfo: UPDATE accounts SET balance = 100 WHERE id = 3\nTime: 12",
      "Id: 7\nInfo: UPDATE accounts SET balance = ? WHERE id = ?\nTime: 12",
    ],
    [
      "a multi-line statement",
      "query: SELECT *\n  FROM users\n  WHERE email = 'a@b.com'\n    AND id = 42\n  LIMIT 10",
      "query: SELECT *\n  FROM users\n  WHERE email = '?'\n    AND id = ?\n  LIMIT ?",
    ],
    [
      "a statement at the start of a line",
      "SELECT 1 WHERE x = 'a'",
      "SELECT ? WHERE x = '?'",
    ],
    [
      "a column gap",
      "42  active  DELETE FROM t WHERE id = 5",
      "42  active  DELETE FROM t WHERE id = ?",
    ],
    [
      "a clause cut by a tab continues",
      "SELECT *\tFROM t WHERE id = 42",
      "SELECT *\tFROM t WHERE id = ?",
    ],
    [
      "InnoDB status statement lines",
      "MySQL thread id 12, OS thread handle 1234, query id 56 localhost root updating\nUPDATE t SET a = 5 WHERE id = 7",
      "MySQL thread id 12, OS thread handle 1234, query id 56 localhost root updating\nUPDATE t SET a = ? WHERE id = ?",
    ],
  ])("%s", (_name: string, text: string, expected: string) => {
    expect(redact(text)).toBe(expected);
  });

  test.each([
    ["used_memory:1048576\nrole:master\ndb0:keys=5,expires=0,avg_ttl=0"],
    ["connections: 42 of 100"],
    ["id=5 addr=10.0.0.1:5000 name= age=10 idle=0 db=0 cmd=auth user=default"],
    ["It's fine, don't worry; count 5"],
    [
      "state: idle in transaction\nwait_event_type: Lock\nbackend_type: client backend",
    ],
    ['max_connections = 100\nwork_mem = 4MB\nsearch_path = "$user", public'],
    ["PostgreSQL 16.4 on x86_64-pc-linux-gnu, compiled by gcc 12.2.0, 64-bit"],
    ["Uptime: 12345 Threads: 4 Questions: 99 Slow queries: 0"],
    [
      "LATEST DETECTED DEADLOCK\n------------------------\n2024-01-01 10:00:00 0x7f",
    ],
  ])("no statement, no change: %p", (text: string) => {
    expect(redact(text)).toBe(text);
  });

  test.each([
    ["Error: Unknown database 'foo'", "Error: Unknown database '?'"],
    ["near 'password=abc' at line 1", "near '?' at line 1"],
    ["note: N'x' and E'y'", "note: N'?' and E'?'"],
    ["a 'b'c' d", "a '?' d"],
    ["open 'never closed", "open '?'"],
  ])(
    "a single-quoted literal is masked anywhere: %p",
    (text: string, expected: string) => {
      expect(redact(text)).toBe(expected);
    },
  );
});

describe("credentials", () => {
  test.each([
    [
      "CREATE USER x WITH PASSWORD 'hunter2'",
      "CREATE USER x WITH PASSWORD '[redacted]'",
    ],
    [
      "ALTER ROLE x ENCRYPTED PASSWORD 'md5abc'",
      "ALTER ROLE x ENCRYPTED PASSWORD '[redacted]'",
    ],
    [
      "SET PASSWORD = PASSWORD('hunter2')",
      "SET PASSWORD = PASSWORD('[redacted]')",
    ],
    ['password = "hunter2"', 'password = "[redacted]"'],
    [
      'Info: ALTER USER bob IDENTIFIED BY "hunter2"',
      'Info: ALTER USER bob IDENTIFIED BY "[redacted]"',
    ],
    [
      "CREATE USER bob IDENTIFIED BY 'hunter2'",
      "CREATE USER bob IDENTIFIED BY '[redacted]'",
    ],
    [
      "ALTER USER x IDENTIFIED WITH caching_sha2_password AS '$A$005$abc'",
      "ALTER USER x IDENTIFIED WITH caching_sha2_password AS '[redacted]'",
    ],
    [
      "ALTER USER x IDENTIFIED WITH mysql_native_password BY 'pw'",
      "ALTER USER x IDENTIFIED WITH mysql_native_password BY '[redacted]'",
    ],
  ])("%p", (text: string, expected: string) => {
    expect(redact(text)).toBe(expected);
  });

  test.each([
    ["password authentication failed for user bob"],
    ["ALTER USER bob PASSWORD EXPIRE"],
    ['{"password_encryption": "scram-sha-256"}'],
    ["password_encryption: scram-sha-256"],
  ])(
    "a phrase with no quoted value is left for the generic rules: %p",
    (text: string) => {
      expect(redact(text)).toBe(text);
    },
  );

  test("a password inside a JSON query value is masked and the JSON stays valid", () => {
    const text: string = JSON.stringify({
      info: "ALTER USER bob IDENTIFIED BY 'hunter2'",
    });
    const redacted: string = redact(text);

    expect(redacted).not.toContain("hunter2");
    expect(JSON.parse(redacted)).toEqual({
      info: "ALTER USER bob IDENTIFIED BY '[redacted]'",
    });
  });

  test.each([
    [
      '{"name": "requirepass", "value": "hunter2"}',
      '{"name": "requirepass", "value": "[redacted]"}',
    ],
    [
      '{"name": "masterauth", "setting": "hunter2"}',
      '{"name": "masterauth", "setting": "[redacted]"}',
    ],
    [
      '{"name": "primaryauth", "value": "Hunter2Secret!"}',
      '{"name": "primaryauth", "value": "[redacted]"}',
    ],
    [
      '[{"Variable_name": "some_password", "Value": "x"}]',
      '[{"Variable_name": "some_password", "Value": "[redacted]"}]',
    ],
    [
      '{"name": "work_mem", "setting": "4096"}',
      '{"name": "work_mem", "setting": "4096"}',
    ],
  ])(
    "credential settings listed as name/value: %p",
    (text: string, expected: string) => {
      expect(redact(text)).toBe(expected);
    },
  );
});

describe("Redis secrets and data", () => {
  test.each([
    ['["AUTH","hunter2"]', '["AUTH","[redacted]"]'],
    ['["auth","default","pw"]', '["auth","[redacted]","[redacted]"]'],
    [
      '{"args": ["AUTH", "hunter2"], "id": 5}',
      '{"args": ["AUTH", "[redacted]"], "id": 5}',
    ],
    [
      '["HELLO","3","AUTH","default","pw","SETNAME","x"]',
      '["HELLO","3","AUTH","[redacted]","[redacted]","SETNAME","x"]',
    ],
    [
      '["MIGRATE","h","6379","k","0","5000","AUTH","pw","KEYS","a"]',
      '["MIGRATE","h","6379","k","0","5000","AUTH","[redacted]","KEYS","a"]',
    ],
    [
      '["MIGRATE","h","6379","k","0","5000","AUTH2","u","pw"]',
      '["MIGRATE","h","6379","k","0","5000","AUTH2","[redacted]","[redacted]"]',
    ],
    [
      '["CONFIG","SET","requirepass","hunter2","maxmemory","1gb"]',
      '["CONFIG","SET","requirepass","[redacted]","maxmemory","1gb"]',
    ],
    [
      '["ACL","SETUSER","bob","on",">pw1","#abc","~*"]',
      '["ACL","SETUSER","bob","on","[redacted]","[redacted]","~*"]',
    ],
    [
      '["SET","session:1","{\\"user\\":1}","EX","60"]',
      '["SET","session:1","[redacted]","[redacted]","[redacted]"]',
    ],
    [
      '["HSET","user:1","email","a@b.com"]',
      '["HSET","user:1","[redacted]","[redacted]"]',
    ],
    [
      '["requirepass","x","maxmemory","0"]',
      '["requirepass","[redacted]","maxmemory","0"]',
    ],
    ['["GET","k"]', '["GET","k"]'],
    ['["active","idle"]', '["active","idle"]'],
    ['["AUTH"]', '["AUTH"]'],
  ])("%s", (text: string, expected: string) => {
    expect(redact(text)).toBe(expected);
  });

  test("pretty-printed SLOWLOG arrays keep their layout", () => {
    const text: string = JSON.stringify(
      [{ id: 1, durationMicros: 12000, args: ["SET", "k", "secretvalue"] }],
      null,
      2,
    );

    expect(JSON.parse(redact(text))).toEqual([
      { id: 1, durationMicros: 12000, args: ["SET", "k", "[redacted]"] },
    ]);
  });

  test.each([
    ["AUTH hunter2", "AUTH [redacted]"],
    ["auth default hunter2", "auth [redacted]"],
    ["1) AUTH default hunter2", "1) AUTH [redacted]"],
    ["cmd: AUTH hunter2", "cmd: AUTH [redacted]"],
    ['{"cmd": "AUTH hunter2"}', '{"cmd": "AUTH [redacted]"}'],
    ["HELLO 3 AUTH default hunter2", "HELLO 3 AUTH [redacted] [redacted]"],
    [
      "MIGRATE host 6379 key 0 5000 AUTH pw KEYS a",
      "MIGRATE host 6379 key 0 5000 AUTH [redacted] KEYS a",
    ],
    [
      'MIGRATE host 6379 "" 0 5000 COPY AUTH2 user pw KEYS a',
      'MIGRATE host 6379 "" 0 5000 COPY AUTH2 [redacted] [redacted] KEYS a',
    ],
    ["config set requirepass hunter2", "config set requirepass [redacted]"],
    ['1) "requirepass"\n2) "hunter2"', '1) "requirepass"\n2) "[redacted]"'],
    ["masterauth\nhunter2", "masterauth\n[redacted]"],
    ["primaryauth\nHunter2Secret", "primaryauth\n[redacted]"],
    [
      '1) "primaryauth"\n2) "Hunter2Secret"',
      '1) "primaryauth"\n2) "[redacted]"',
    ],
    [
      "config set primaryauth Hunter2Secret",
      "config set primaryauth [redacted]",
    ],
  ])("plain text %p", (text: string, expected: string) => {
    expect(redact(text)).toBe(expected);
  });

  test.each([
    ["id=5 addr=10.0.0.1:5000 cmd=auth user=default"],
    ["authentication: ok"],
    ["oauth tokens expire"],
  ])("CLIENT LIST and prose keep their words: %p", (text: string) => {
    expect(redact(text)).toBe(text);
  });
});

describe("redactRedisCommandArguments: a command masked before it is printed", () => {
  test.each([
    [
      ["AUTH", "app", "hunter2"],
      ["AUTH", "[redacted]", "[redacted]"],
    ],
    [
      ["HSET", "user:1", "email", "a@b.com"],
      ["HSET", "user:1", "[redacted]", "[redacted]"],
    ],
    [
      ["CONFIG", "SET", "requirepass", "x", "maxmemory", "1gb"],
      ["CONFIG", "SET", "requirepass", "[redacted]", "maxmemory", "1gb"],
    ],
    [
      ["GET", "k"],
      ["GET", "k"],
    ],
    [
      ["SET", "k", "?"],
      ["SET", "k", "?"],
    ],
    [
      ["SMOVE", "pending", "done", "card-4111"],
      ["SMOVE", "pending", "[redacted]", "[redacted]"],
    ],
    [
      ["HSETEX", "h", "EX", "60", "FIELDS", "1", "f", "v"],
      [
        "HSETEX",
        "h",
        "[redacted]",
        "[redacted]",
        "[redacted]",
        "[redacted]",
        "[redacted]",
        "[redacted]",
      ],
    ],
    [
      ["LPOS", "l", "john@example.com"],
      ["LPOS", "l", "[redacted]"],
    ],
    [
      ["ZSCORE", "z", "john@example.com"],
      ["ZSCORE", "z", "[redacted]"],
    ],
    [
      ["JSON.MSET", "d", "$", '{"a":1}'],
      ["JSON.MSET", "d", "[redacted]", "[redacted]"],
    ],
    [
      ["JSON.ARRAPPEND", "d", "$.tags", '"vip"'],
      ["JSON.ARRAPPEND", "d", "[redacted]", "[redacted]"],
    ],
    [
      ["BF.ADD", "seen", "john@example.com"],
      ["BF.ADD", "seen", "[redacted]"],
    ],
  ])("%j", (args: Array<string>, expected: Array<string>) => {
    expect(redactRedisCommandArguments(args)).toEqual(expected);
  });

  test("what is not a string is read as its text; what is not a list is nothing", () => {
    expect(redactRedisCommandArguments(["SET", "k", 42, null])).toEqual([
      "SET",
      "k",
      "[redacted]",
      "[redacted]",
    ]);
    expect(
      redactRedisCommandArguments("AUTH x" as unknown as Array<string>),
    ).toEqual([]);
  });

  test("the hook masks the same arguments in a printed array", () => {
    const args: Array<string> = ["JSON.MSET", "d", "$", '{"a":1}'];

    expect(redact(JSON.stringify(args))).toBe(
      JSON.stringify(redactRedisCommandArguments(args)),
    );
  });
});

describe("InnoDB record dumps", () => {
  test("the row bytes are masked, the field's number and length stay", () => {
    const text: string = [
      "Record lock, heap no 2 PHYSICAL RECORD: n_fields 4; compact format; info bits 0",
      " 0: len 4; hex 80000001; asc     ;;",
      " 3: len 15; hex 626f62406578616d706c652e636f6d; asc bob@example.com;;",
      " 4: len 30; hex 6162; asc a;;b;...(truncated);",
    ].join("\n");

    expect(redact(text)).toBe(
      [
        "Record lock, heap no 2 PHYSICAL RECORD: n_fields 4; compact format; info bits 0",
        " 0: len 4; hex [redacted]; asc [redacted];;",
        " 3: len 15; hex [redacted]; asc [redacted];;",
        " 4: len 30; hex [redacted]; asc [redacted];",
      ].join("\n"),
    );
    expect(redact(text)).not.toContain("bob@example.com");
  });
});

describe("the whole hook", () => {
  test("counts every masked value", () => {
    expect(
      redactWithCount(
        "SELECT 1 WHERE x = 'a'\nAUTH hunter2\n 0: len 4; hex 80000001; asc     ;;",
      ).redactionCount,
    ).toBe(4);
  });

  test.each([
    ["SELECT * FROM users WHERE email = 'a@b.com' AND id = 42"],
    ['[{"query": "select 1 where a = \'b\'", "args": ["AUTH", "pw"]}]'],
    [
      "ALTER USER x IDENTIFIED BY 'pw'\nconfig set requirepass pw\n 0: len 4; hex 80000001; asc     ;;",
    ],
    ['{"name": "requirepass", "value": "x"}'],
  ])("is idempotent: %p", (text: string) => {
    const once: DatabaseQueryRedaction = redactWithCount(text);
    const twice: DatabaseQueryRedaction = redactWithCount(once.text);

    expect(twice.text).toBe(once.text);
    expect(twice.redactionCount).toBe(0);
  });

  test.each([[null], [undefined], [42], [{}], [""]])(
    "text %p redacts to an empty string",
    (text: unknown) => {
      expect(
        redactDatabaseOutput({
          resourceType: AiResourceType.DatabaseServer,
          program: "db",
          text: text as string,
        }),
      ).toEqual({ text: "", redactionCount: 0 });
    },
  );

  test("a missing request redacts to an empty string", () => {
    expect(
      redactDatabaseOutput(
        null as unknown as Parameters<typeof redactDatabaseOutput>[0],
      ),
    ).toEqual({ text: "", redactionCount: 0 });
  });

  test("output that cannot be normalized is withheld, never passed on", () => {
    let reads: number = 0;
    const request: Parameters<typeof redactDatabaseOutput>[0] = {
      resourceType: AiResourceType.DatabaseServer,
      program: "db",
      get text(): string {
        reads++;

        if (reads > 2) {
          throw new Error("unreadable output");
        }

        return "SELECT 1 WHERE email = 'a@b.com'";
      },
    };

    expect(redactDatabaseOutput(request)).toEqual({
      text: DATABASE_UNREDACTABLE_OUTPUT,
      redactionCount: 1,
    });
  });

  test("hostile shapes of 50 KB finish quickly and change nothing they need not", () => {
    const size: number = 50 * 1024;
    const cases: Array<string> = [
      "'".repeat(size),
      "a'".repeat(size / 2),
      '"'.repeat(size),
      `"${'\\"'.repeat(size / 2)}`,
      "SELECT ".repeat(size / 7),
      '["'.repeat(size / 2),
      "$a$".repeat(size / 3),
      "hello ".repeat(size / 6),
      "migrate ".repeat(size / 8),
      "PASSWORD '".repeat(size / 10),
      "len 1; hex 00; asc ".repeat(size / 19),
      '{"name": "'.repeat(size / 10),
      "SELECT `".repeat(size / 8),
      "SELECT 1\n".repeat(size / 9),
    ];
    const started: number = Date.now();

    for (const text of cases) {
      const result: DatabaseQueryRedaction = redactWithCount(text);

      expect(typeof result.text).toBe("string");
      expect(result.text).not.toBe(DATABASE_UNREDACTABLE_OUTPUT);
    }

    // Generous: a catastrophic (exponential) regex would take minutes.
    expect(Date.now() - started).toBeLessThan(60_000);
  });
});

describe("wired into ResourceOutputRedactor as the db hook", () => {
  test("the db program has this hook", () => {
    expect(getResourceOutputRedactionHooks("db")).toContain(
      redactDatabaseOutput,
    );
  });

  test("the hook runs before the generic rules, and both apply", () => {
    const text: string = [
      "query: SELECT * FROM t WHERE x = 'a' AND id = 42",
      "DB_PASSWORD=hunter2",
      "url: postgres://app:hunter2@db:5432/app",
      '{"password": "hunter2"}',
      "AUTH hunter2",
    ].join("\n");
    const redacted: string = redactResourceCommandOutput({
      resourceType: AiResourceType.DatabaseServer,
      program: "db",
      text,
    });

    expect(redacted).not.toContain("hunter2");
    expect(redacted).toContain(
      "query: SELECT * FROM t WHERE x = '?' AND id = ?",
    );
    expect(redacted).toContain("DB_PASSWORD=[redacted]");
    expect(
      redactResourceCommandOutputWithCount({
        resourceType: AiResourceType.DatabaseServer,
        program: "db",
        text,
      }).redactionCount,
    ).toBeGreaterThanOrEqual(6);
  });

  test("other programs never get query normalization", () => {
    const text: string = "SELECT 1 WHERE x = 'a'";

    expect(
      redactResourceCommandOutput({
        resourceType: AiResourceType.DockerHost,
        program: "docker",
        text,
      }),
    ).toBe(text);
  });

  test("plain db output passes through", () => {
    const text: string =
      "PostgreSQL 16.4 on x86_64-pc-linux-gnu\nmax_connections: 100";

    expect(
      redactResourceCommandOutput({
        resourceType: AiResourceType.DatabaseServer,
        program: "db",
        text,
      }),
    ).toBe(text);
  });
});
