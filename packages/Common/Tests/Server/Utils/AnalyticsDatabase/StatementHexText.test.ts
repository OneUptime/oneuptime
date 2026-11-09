import { describe, expect, test } from "@jest/globals";
import { inspect } from "util";
import Logger from "../../../../Server/Utils/Logger";
import {
  QualifiedColumn,
  SQL,
  Statement,
} from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../../Types/BaseDatabase/IncludesNone";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import Search from "../../../../Types/BaseDatabase/Search";
import ObjectID from "../../../../Types/ObjectID";
import { readWebAttackKind } from "../../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import {
  SECURITY_SCAN_WORDS,
  holdsSecurityScanWord,
} from "../../../../Utils/SecurityEvent/SecurityScanWords";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";
import {
  echoStatement,
  readStatementValues,
  statementUrlQuery,
} from "../../../Helpers/StatementEcho";

/*
 * HEX ENCODED TEXT (issue #6419). A text parameter that holds a word the
 * security scans look for is sent hex encoded, and ClickHouse decodes it:
 *
 *   {p0:String}          is sent as   unhex({p0:String})
 *   {p1:Array(String)}   is sent as   [unhex({p1_0:String}), unhex({p1_1:String})]
 *
 * so the query ClickHouse writes down - in its error log, in
 * system.query_log - never holds the attack its words spell, and the scan
 * never reads its own query back as one. Every other parameter is sent as
 * it always was.
 */

function hex(text: string): string {
  return Buffer.from(text, "utf8").toString("hex");
}

// Whether a text would read as an attack or a scan word where it is written down.
function readsAsScanWord(text: string): boolean {
  return holdsSecurityScanWord(text) || readWebAttackKind(text) !== null;
}

describe("Statement: text that holds no scan word is sent as always", () => {
  test("a plain text, a search, an IN list and a text array", () => {
    const statement: Statement = SQL`SELECT * FROM logs WHERE serviceName = ${{
      type: TableColumnType.Text,
      value: "checkout-api",
    }} AND body ILIKE ${{
      type: TableColumnType.Text,
      value: new Search("timeout"),
    }} AND severityText IN ${{
      type: TableColumnType.Text,
      value: new Includes(["Error", "Warning"]),
    }} AND hasAny(tags, ${{
      type: TableColumnType.ArrayText,
      value: ["blue", "green"],
    }})`;

    expect(statement.query).toBe(
      "SELECT * FROM logs WHERE serviceName = {p0:String} AND body ILIKE {p1:String} AND severityText IN {p2:Array(String)} AND hasAny(tags, {p3:Array(String)})",
    );
    expect(statement.query_params).toStrictEqual({
      p0: "checkout-api",
      p1: "%timeout%",
      p2: ["Error", "Warning"],
      p3: ["blue", "green"],
    });
  });

  test("an empty text and an empty text array", () => {
    const statement: Statement = SQL`SELECT ${{
      type: TableColumnType.Text,
      value: "",
    }}, ${{ type: TableColumnType.ArrayText, value: [] }}`;

    expect(statement.query).toBe("SELECT {p0:String}, {p1:Array(String)}");
    expect(statement.query_params).toStrictEqual({ p0: "", p1: [] });
  });

  test("words the security scans read only together are sent as they are", () => {
    for (const word of ["login", "delete", "4625", "SELECT", "audit.k8s.io/"]) {
      const statement: Statement = SQL`SELECT ${{
        type: TableColumnType.Text,
        value: word,
      }}`;

      expect(statement.query).toBe("SELECT {p0:String}");
      expect(statement.query_params).toStrictEqual({ p0: word });
    }
  });
});

describe("Statement: text that holds a scan word is sent hex encoded", () => {
  test("a text: unhex of a String parameter holding its hex", () => {
    const statement: Statement = SQL`SELECT count() FROM logs WHERE positionCaseInsensitive(body, ${{
      type: TableColumnType.Text,
      value: "${jndi:",
    }}) > 0`;

    expect(statement.query).toBe(
      "SELECT count() FROM logs WHERE positionCaseInsensitive(body, unhex({p0:String})) > 0",
    );
    expect(statement.query_params).toStrictEqual({ p0: hex("${jndi:") });
    expect(readStatementValues(statement)).toEqual(["${jndi:"]);
  });

  test("a text array: each element its own String parameter, in order", () => {
    const words: Array<string> = ["${jndi:", "union select", "plain"];
    const statement: Statement = SQL`SELECT multiSearchAnyCaseInsensitive(body, ${{
      type: TableColumnType.ArrayText,
      value: words,
    }})`;

    expect(statement.query).toBe(
      "SELECT multiSearchAnyCaseInsensitive(body, [unhex({p0_0:String}), unhex({p0_1:String}), unhex({p0_2:String})])",
    );
    expect(statement.query_params).toStrictEqual({
      p0_0: hex("${jndi:"),
      p0_1: hex("union select"),
      p0_2: hex("plain"),
    });
    expect(readStatementValues(statement)).toEqual([words]);
  });

  test("an IN list and a NOT IN list of text", () => {
    const statement: Statement = SQL`SELECT * FROM logs WHERE body IN ${{
      type: TableColumnType.Text,
      value: new Includes(["/etc/passwd", "ok"]),
    }} AND body NOT IN ${{
      type: TableColumnType.Text,
      value: new IncludesNone(["' or 1=1", "fine"]),
    }}`;

    expect(statement.query).toBe(
      "SELECT * FROM logs WHERE body IN [unhex({p0_0:String}), unhex({p0_1:String})] AND body NOT IN [unhex({p1_0:String}), unhex({p1_1:String})]",
    );
    expect(readStatementValues(statement)).toEqual([
      ["/etc/passwd", "ok"],
      ["' or 1=1", "fine"],
    ]);
  });

  test("a search: the escaped pattern it always was, hex encoded", () => {
    const statement: Statement = SQL`SELECT * FROM logs WHERE body ILIKE ${{
      type: TableColumnType.Text,
      value: new Search("union select 100%"),
    }}`;

    expect(statement.query).toBe(
      "SELECT * FROM logs WHERE body ILIKE unhex({p0:String})",
    );
    expect(readStatementValues(statement)).toEqual(["%union select 100\\%%"]);
  });

  test("a not-equal text", () => {
    const statement: Statement = SQL`SELECT * FROM logs WHERE body != ${{
      type: TableColumnType.Text,
      value: new NotEqual("../../etc"),
    }}`;

    expect(statement.query).toBe(
      "SELECT * FROM logs WHERE body != unhex({p0:String})",
    );
    expect(readStatementValues(statement)).toEqual(["../../etc"]);
  });

  test("whatever its case, and with its white space spread out", () => {
    for (const value of [
      "${JNDI:LDAP://x}",
      "UNION SELECT",
      "Ignore   previous\n instructions",
    ]) {
      const statement: Statement = SQL`SELECT ${{
        type: TableColumnType.Text,
        value,
      }}`;

      expect(statement.query).toBe("SELECT unhex({p0:String})");
      expect(readStatementValues(statement)).toEqual([value]);
    }
  });

  test("a word only its URL-encoded form spells: the client sends it in a URL", () => {
    // "../" is no marker, but the URL carries it as "..%2F", which is one.
    const statement: Statement = SQL`SELECT ${{
      type: TableColumnType.Text,
      value: "../",
    }}`;

    expect(statement.query).toBe("SELECT unhex({p0:String})");
    expect(statementUrlQuery(statement).toLowerCase()).not.toContain("..%2f");
  });

  test("a text that passes the log scan's prefilter on its own", () => {
    const line: string =
      "CEF:0|Acme|Gateway|1.0|100|Login failed|7|src=203.0.113.7";
    const statement: Statement = SQL`SELECT ${{
      type: TableColumnType.Text,
      value: line,
    }}`;

    expect(statement.query).toBe("SELECT unhex({p0:String})");
    expect(readStatementValues(statement)).toEqual([line]);
  });

  test("text that is not ASCII decodes to what was sent", () => {
    const value: string = "Ünïcode ${jndi:ldap://例え.example/ä} — 日本 🙂";
    const statement: Statement = SQL`SELECT ${{
      type: TableColumnType.Text,
      value,
    }}`;

    expect(statement.query_params["p0"]).toBe(hex(value));
    expect(readStatementValues(statement)).toEqual([value]);
  });
});

describe("Statement: sendAsHex", () => {
  test("sends a text hex encoded whatever it holds", () => {
    const statement: Statement = SQL`SELECT ${{
      type: TableColumnType.Text,
      value: "login",
      sendAsHex: true,
    }}, ${{
      type: TableColumnType.ArrayText,
      value: ["4625", "delete"],
      sendAsHex: true,
    }}`;

    expect(statement.query).toBe(
      "SELECT unhex({p0:String}), [unhex({p1_0:String}), unhex({p1_1:String})]",
    );
    expect(readStatementValues(statement)).toEqual([
      "login",
      ["4625", "delete"],
    ]);
  });

  test("an empty array stays an Array(String) parameter: [] has no type", () => {
    const statement: Statement = SQL`SELECT ${{
      type: TableColumnType.ArrayText,
      value: [],
      sendAsHex: true,
    }}`;

    expect(statement.query).toBe("SELECT {p0:Array(String)}");
    expect(statement.query_params).toStrictEqual({ p0: [] });
  });

  test("never changes what is not text: numbers, dates, ids", () => {
    const projectId: ObjectID = new ObjectID(
      "0192f1a0-0000-7000-8000-000000006419",
    );
    const statement: Statement = SQL`SELECT ${{
      type: TableColumnType.Number,
      value: 5,
      sendAsHex: true,
    }}, ${{
      type: TableColumnType.Date,
      value: new Date("2026-11-09T10:00:00.000Z"),
      sendAsHex: true,
    }}, ${{
      type: TableColumnType.ObjectID,
      value: projectId,
      sendAsHex: true,
    }}, ${{
      type: TableColumnType.Text,
      value: new Includes([1, 2]),
      sendAsHex: true,
    }}`;

    expect(statement.query).toBe(
      "SELECT {p0:Int32}, {p1:DateTime}, {p2:String}, {p3:Array(Int32)}",
    );
    expect(statement.query_params["p2"]).toBe(projectId.toString());
    // As an IN list over a text column always was: its values as text.
    expect(statement.query_params["p3"]).toEqual(["1", "2"]);
  });
});

describe("Statement: what is never hex encoded", () => {
  test("an identifier and a qualified column, whatever they hold", () => {
    const statement: Statement = SQL`SELECT ${"union select"} FROM t AS l WHERE ${new QualifiedColumn(
      "l",
      "../../",
    )} = ${{ type: TableColumnType.Text, value: "${jndi:ldap://x}" }}`;

    expect(statement.query).toBe(
      "SELECT {p0:Identifier} FROM t AS l WHERE {p1_t:Identifier}.{p1_c:Identifier} = unhex({p2:String})",
    );
    expect(statement.query_params).toStrictEqual({
      p0: "union select",
      p1_t: "l",
      p1_c: "../../",
      p2: hex("${jndi:ldap://x}"),
    });
    expect(readStatementValues(statement)).toEqual([
      "union select",
      "l.../../",
      "${jndi:ldap://x}",
    ]);
  });
});

describe("Statement: the query and its parameters always agree", () => {
  // A mix of plain and hex encoded parameters, many times over.
  const ALPHABET: ReadonlyArray<string> = [
    "a",
    "b",
    " ",
    "${jndi:",
    "union select",
    "'",
    "\\",
    "%",
    "_",
    "../",
    "ignore previous instructions",
    "日本",
    "169.254.169.254",
    "",
  ];
  const texts: Array<string> = generatedTexts(600, 6419, ALPHABET, 6);

  test("every placeholder has its parameter, every parameter its placeholder, and each decodes to what was given", () => {
    for (let index: number = 0; index + 3 < texts.length; index += 4) {
      const single: string = texts[index]!;
      const list: Array<string> = [texts[index + 1]!, texts[index + 2]!];
      const searched: string = texts[index + 3]!;
      const statement: Statement = SQL`SELECT ${{
        type: TableColumnType.Number,
        value: index,
      }} WHERE a = ${{ type: TableColumnType.Text, value: single }} AND b IN ${{
        type: TableColumnType.Text,
        value: new Includes(list),
      }} AND c ILIKE ${{
        type: TableColumnType.Text,
        value: new Search(searched),
      }} AND has(${{ type: TableColumnType.ArrayText, value: list }}, d)`;

      const query: string = statement.query;
      const names: Array<string> = Object.keys(statement.query_params);

      for (const name of names) {
        expect(query).toContain(`{${name}:`);
      }

      expect(query.split("{p").length - 1).toBe(names.length);

      const values: Array<unknown> = readStatementValues(statement);

      expect(values[0]).toBe(index);
      expect(values[1]).toBe(single);
      expect(values[2]).toEqual(list);
      expect(values[4]).toEqual(list);
      expect(String(values[3]).startsWith("%")).toBe(true);
    }
  });

  test("what ClickHouse writes down, and the URL the client sends, hold no scan word", () => {
    for (let index: number = 0; index + 1 < texts.length; index += 2) {
      const statement: Statement = SQL`SELECT ${{
        type: TableColumnType.Text,
        value: texts[index]!,
      }}, ${{
        type: TableColumnType.ArrayText,
        value: [texts[index + 1]!, "x"],
      }}`;

      expect(readsAsScanWord(echoStatement(statement))).toBe(false);
      expect(readsAsScanWord(statementUrlQuery(statement))).toBe(false);
    }
  });

  test("the same words sent as they are would have read as an attack", () => {
    // What the guard above would miss if hex encoding were gone.
    const words: Array<string> = ["${jndi:ldap://x}", "union select"];

    expect(
      readsAsScanWord(`multiSearchAny(body, ['${words.join("', '")}'])`),
    ).toBe(true);
  });
});

describe("Statement: what a log line shows of it", () => {
  const statement: Statement = SQL`SELECT count() FROM logs WHERE multiSearchAnyCaseInsensitive(body, ${{
    type: TableColumnType.ArrayText,
    value: ["${jndi:", "union select", "../../"],
  }}) AND serviceName = ${{ type: TableColumnType.Text, value: "api" }}`;

  test("toJSON: the query and parameters as sent", () => {
    expect(JSON.parse(JSON.stringify(statement))).toEqual({
      query: statement.query,
      query_params: statement.query_params,
    });
  });

  test("the logger, util.inspect and JSON hold no scan word", () => {
    for (const shown of [
      Logger.serializeLogBody(statement as never),
      inspect(statement),
      JSON.stringify(statement),
    ]) {
      expect(shown).toContain("api");
      expect(readsAsScanWord(shown)).toBe(false);
    }
  });
});

describe("SECURITY_SCAN_WORDS and Statement", () => {
  test("every scan word, alone, is sent hex encoded", () => {
    for (const word of SECURITY_SCAN_WORDS) {
      const statement: Statement = SQL`SELECT ${{
        type: TableColumnType.Text,
        value: word.toUpperCase(),
      }}`;

      expect(statement.query).toBe("SELECT unhex({p0:String})");
      expect(readsAsScanWord(echoStatement(statement))).toBe(false);
    }
  });
});
