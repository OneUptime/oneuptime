import { describe, expect, test } from "@jest/globals";
import buildJSONColumnQuery, {
  JSONColumnQuery,
} from "../../../../Server/Types/Database/JSONColumnQuery";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IsNull from "../../../../Types/BaseDatabase/IsNull";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../../Types/BaseDatabase/NotNull";
import Search from "../../../../Types/BaseDatabase/Search";
import { JSONObject } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";

/*
 * What an OpenStack list asks of a row's `facts` column, as it reaches the database: built
 * in the browser, written to JSON for the wire, read back on the server, and turned into a
 * WHERE fragment. A filter that lost its operator on the way would still answer, with the
 * wrong rows and a lit chip over them, so each filter the pages send is followed the whole
 * way here. The jsdom pages read a stand-in for the server, and can't see this.
 */

function overTheWire(facts: JSONObject): JSONObject {
  const sent: string = JSON.stringify(
    JSONFunctions.serialize({ facts: facts }),
  );
  return JSONFunctions.deserialize(JSON.parse(sent) as JSONObject)[
    "facts"
  ] as JSONObject;
}

function sqlOf(facts: JSONObject): {
  sql: string;
  parameters: Array<unknown>;
} {
  let next: number = 0;
  const query: JSONColumnQuery = buildJSONColumnQuery({
    value: overTheWire(facts),
    generateParameterName: (): string => {
      next += 1;
      return `p${next}`;
    },
  });
  return {
    sql: query.toSql('"facts"'),
    parameters: Object.values(query.parameters),
  };
}

describe("a filter on one fact survives the trip to the database", () => {
  test("an external network: a JSON true reads as its text, and as an element of an array", () => {
    const { sql, parameters } = sqlOf({ isExternal: true });

    expect(sql).toContain("->> CAST(:p1 AS TEXT) = CAST(:p2 AS TEXT)");
    expect(parameters).toEqual(["isExternal", "true", "[true]"]);
  });

  test("the networks that aren't: a row that doesn't say is kept, because it isn't known to be", () => {
    const { sql, parameters } = sqlOf({
      isExternal: new NotEqual("true") as never,
    });

    // IS NOT TRUE, because NOT of a missing key is NULL and would drop the row.
    expect(sql).toContain("IS NOT TRUE");
    expect(parameters).toContain("true");
  });

  test("an address in use: a router's ID, which is neither missing nor null", () => {
    const { sql } = sqlOf({ routerId: new NotNull() as never });

    expect(sql).toContain("IS NOT TRUE");
    expect(sql).toContain("IS NULL");
    expect(sql).toContain("jsonb_typeof");
  });

  test("a spare address: a router's ID cleared to null reads the same as one never there", () => {
    const { sql } = sqlOf({ routerId: new IsNull() as never });

    expect(sql).not.toContain("IS NOT TRUE");
    expect(sql).toContain("IS NULL");
    expect(sql).toContain("= 'null'");
  });

  test("what an L3 agent holds: its ID inside the JSON text of a router's agents", () => {
    const { sql, parameters } = sqlOf({
      l3Agents: new Search("agent-1") as never,
    });

    expect(sql).toContain("ILIKE");
    expect(parameters).toContain("%agent-1%");
  });

  test("a flavor, a volume type: a plain value, and one of several", () => {
    expect(sqlOf({ flavorId: "m1.small" }).parameters).toEqual([
      "flavorId",
      "m1.small",
      '["m1.small"]',
    ]);

    const several: { sql: string; parameters: Array<unknown> } = sqlOf({
      volumeType: new Includes(["ssd", "hdd"]) as never,
    });
    expect(several.sql).toContain(" OR ");
    expect(several.parameters).toContain("ssd");
    expect(several.parameters).toContain("hdd");
  });

  test("two filters on two facts both hold", () => {
    const { sql, parameters } = sqlOf({
      family: "network",
      l3Agents: new Search("agent-1") as never,
    });

    expect(sql).toContain(" AND ");
    expect(parameters).toContain("family");
    expect(parameters).toContain("l3Agents");
  });

  test("a value someone typed stays a value, never SQL", () => {
    const { sql, parameters } = sqlOf({
      flavorId: 'x\'; DROP TABLE "OpenStackResource"; --',
    });

    expect(sql).not.toContain("DROP TABLE");
    expect(parameters).toContain('x\'; DROP TABLE "OpenStackResource"; --');
  });
});
