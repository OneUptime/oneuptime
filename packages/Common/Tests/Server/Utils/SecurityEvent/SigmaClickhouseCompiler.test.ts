import SigmaClickhouseCompiler, {
  FIELD_ALIASES,
  buildSigmaDistinctCountExpression,
  buildSigmaFieldExpression,
  resolveSigmaField,
  sigmaPatternToLike,
} from "../../../../Server/Utils/SecurityEvent/Sigma/SigmaClickhouseCompiler";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import {
  SigmaWatchlist,
  SigmaWatchlists,
} from "../../../../Types/SecurityEvent/SecurityWatchlist";
import SigmaRule from "../../../../Types/SecurityEvent/SigmaRule";
import SigmaRuleParser from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import { describe, expect, test } from "@jest/globals";

/*
 * The compiler turns user-authored Sigma YAML into SQL that runs with
 * isRoot against the security events table, so these tests pin two things
 * with equal weight: that supported constructs compile to the intended
 * ClickHouse semantics, and that NOTHING user-controlled ever lands in
 * the SQL text itself — field names, values, patterns, and regexes must
 * all leave the compiler as bound parameters. A regression on the second
 * half is a SQL injection.
 */

function compile(ruleYaml: string): Statement {
  return SigmaClickhouseCompiler.compileYaml(ruleYaml);
}

function paramValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

function singleFieldRule(fieldLine: string): string {
  return `
title: Test
detection:
  selection:
    ${fieldLine}
  condition: selection
`;
}

describe("sigmaPatternToLike", () => {
  test("plain text passes through and reports no wildcard", () => {
    expect(sigmaPatternToLike("alice")).toEqual({
      pattern: "alice",
      hasWildcard: false,
    });
  });

  test("sigma wildcards translate to LIKE wildcards", () => {
    expect(sigmaPatternToLike("adm*n?")).toEqual({
      pattern: "adm%n_",
      hasWildcard: true,
    });
  });

  test("LIKE metacharacters in literal text are escaped", () => {
    expect(sigmaPatternToLike("100%_done")).toEqual({
      pattern: "100\\%\\_done",
      hasWildcard: false,
    });
  });

  test("escaped sigma wildcards become literals", () => {
    expect(sigmaPatternToLike("a\\*b")).toEqual({
      pattern: "a*b",
      hasWildcard: false,
    });
  });

  test("escaped backslash stays a literal backslash, LIKE-escaped", () => {
    expect(sigmaPatternToLike("c:\\\\windows")).toEqual({
      pattern: "c:\\\\windows",
      hasWildcard: false,
    });
  });
});

describe("resolveSigmaField", () => {
  test("known column names resolve case-insensitively", () => {
    expect(resolveSigmaField("principalUser")).toEqual({
      kind: "textColumn",
      column: "principalUser",
    });
    expect(resolveSigmaField("PRINCIPALUSER")).toEqual({
      kind: "textColumn",
      column: "principalUser",
    });
  });

  test("aliases resolve to canonical columns", () => {
    expect(resolveSigmaField("CommandLine")).toEqual({
      kind: "textColumn",
      column: "processCommandLine",
    });
    expect(resolveSigmaField("src_ip")).toEqual({
      kind: "textColumn",
      column: "principalIp",
    });
    expect(resolveSigmaField("dst_port")).toEqual({
      kind: "numberColumn",
      column: "targetPort",
    });
  });

  test("array columns resolve as arrays", () => {
    expect(resolveSigmaField("mitreTechniques")).toEqual({
      kind: "arrayColumn",
      column: "mitreTechniques",
    });
  });

  test("everything else becomes an attributes[] lookup under its original spelling", () => {
    expect(resolveSigmaField("principal.hostname")).toEqual({
      kind: "attribute",
      attributeKey: "principal.hostname",
    });
  });
});

/*
 * Sigma's process fields read the process an event is about - the one that
 * was started, in a process creation event - and its parent. They used to
 * read principalProcess, which in a process creation event holds the
 * PARENT (OCSF's actor), so a rule on CommandLine tested the parent's name
 * and the endpoint rules missed the attacks they were written for.
 */
describe("Sigma's process fields", () => {
  test.each([
    ["CommandLine", "processCommandLine"],
    ["commandline", "processCommandLine"],
    ["command_line", "processCommandLine"],
    ["cmdline", "processCommandLine"],
    ["ProcessCommandLine", "processCommandLine"],
    ["process.command_line", "processCommandLine"],
    ["Image", "processPath"],
    ["process.executable", "processPath"],
    ["ProcessName", "processName"],
    ["ParentImage", "parentProcessPath"],
    ["process.parent.executable", "parentProcessPath"],
    ["ParentCommandLine", "parentProcessCommandLine"],
    ["process.parent.command_line", "parentProcessCommandLine"],
    ["ParentProcessName", "parentProcessName"],
  ])("%s reads %s", (field: string, column: string) => {
    expect(resolveSigmaField(field)).toEqual({ kind: "textColumn", column });
  });

  test("principalProcess is still a column of its own, for the rules and searches written against it", () => {
    expect(resolveSigmaField("principalProcess")).toEqual({
      kind: "textColumn",
      column: "principalProcess",
    });
  });

  test("no Sigma spelling of a process field reads principalProcess", () => {
    const processSpelling: RegExp = /command|cmd|image|executable|process/;
    const processSpellings: Array<string> = Object.keys(FIELD_ALIASES).filter(
      (alias: string): boolean => {
        return processSpelling.test(alias);
      },
    );

    expect(processSpellings.length).toBeGreaterThanOrEqual(10);

    for (const alias of processSpellings) {
      expect({ alias, column: FIELD_ALIASES[alias] }).not.toEqual({
        alias,
        column: "principalProcess",
      });
    }
  });

  test("CommandLine|contains compiles to a substring match on the process's command line", () => {
    const statement: Statement = compile(
      singleFieldRule("CommandLine|contains: ' -enc '"),
    );

    expect(statement.query).toContain("processCommandLine ILIKE {p0:String}");
    expect(statement.query).not.toContain("principalProcess");
    expect(statement.query_params["p0"]).toBe("% -enc %");
  });

  test("ParentImage|endswith compiles to a suffix match on the parent's executable", () => {
    const statement: Statement = compile(
      singleFieldRule("ParentImage|endswith: winword.exe"),
    );

    expect(statement.query).toContain("parentProcessPath ILIKE {p0:String}");
    expect(statement.query_params["p0"]).toBe("%winword.exe");
  });

  test("the process fields group and count as plain columns", () => {
    expect(buildSigmaFieldExpression("Image").query).toBe("processPath");
    expect(buildSigmaFieldExpression("ParentCommandLine").query).toBe(
      "parentProcessCommandLine",
    );
    expect(buildSigmaDistinctCountExpression("processName").query).toBe(
      "processName",
    );
  });
});

describe("SigmaClickhouseCompiler value matching", () => {
  test("plain equality is case-insensitive via lowerUTF8, value lowered and bound", () => {
    const statement: Statement = compile(
      singleFieldRule("principalUser: Alice"),
    );

    expect(statement.query).toContain("lowerUTF8(principalUser) = {p0:String}");
    expect(statement.query_params["p0"]).toBe("alice");
  });

  test("`cased` modifier compiles to exact equality with the original value", () => {
    const statement: Statement = compile(
      singleFieldRule("principalUser|cased: Alice"),
    );

    expect(statement.query).toContain("principalUser = {p0:String}");
    expect(statement.query).not.toContain("lowerUTF8");
    expect(statement.query_params["p0"]).toBe("Alice");
  });

  test("wildcard values compile to ILIKE with translated pattern", () => {
    const statement: Statement = compile(
      singleFieldRule("principalProcess: '*powershell*'"),
    );

    expect(statement.query).toContain("principalProcess ILIKE {p0:String}");
    expect(statement.query_params["p0"]).toBe("%powershell%");
  });

  test("contains modifier wraps the pattern in %", () => {
    const statement: Statement = compile(
      singleFieldRule("principalProcess|contains: mimikatz"),
    );

    expect(statement.query).toContain("principalProcess ILIKE {p0:String}");
    expect(statement.query_params["p0"]).toBe("%mimikatz%");
  });

  test("startswith / endswith anchor the pattern", () => {
    const startsWith: Statement = compile(
      singleFieldRule("principalIp|startswith: '10.'"),
    );
    expect(startsWith.query_params["p0"]).toBe("10.%");

    const endsWith: Statement = compile(
      singleFieldRule("targetResource|endswith: '.exe'"),
    );
    expect(endsWith.query_params["p0"]).toBe("%.exe");
  });

  test("a value list ORs; the `all` modifier ANDs", () => {
    const orStatement: Statement = compile(`
title: OR list
detection:
  selection:
    principalUser:
      - alice
      - bob
  condition: selection
`);
    expect(orStatement.query).toContain(") OR (");
    expect(paramValues(orStatement)).toEqual(["alice", "bob"]);

    const andStatement: Statement = compile(`
title: AND list
detection:
  selection:
    principalProcess|contains|all:
      - curl
      - http
  condition: selection
`);
    expect(andStatement.query).toContain(") AND (");
    expect(paramValues(andStatement)).toEqual(["%curl%", "%http%"]);
  });

  test("null on a text column matches empty string", () => {
    const statement: Statement = compile(
      singleFieldRule("principalUser: null"),
    );

    expect(statement.query).toContain("principalUser = ''");
    expect(paramValues(statement)).toEqual([]);
  });

  test("null on an attribute field compiles to NOT mapContains", () => {
    const statement: Statement = compile(singleFieldRule("custom.field: null"));

    expect(statement.query).toContain(
      "NOT mapContains(attributes, {p0:String})",
    );
    expect(statement.query_params["p0"]).toBe("custom.field");
  });

  test("exists modifier checks presence", () => {
    const existsStatement: Statement = compile(
      singleFieldRule("custom.field|exists: true"),
    );
    expect(existsStatement.query).toContain(
      "mapContains(attributes, {p0:String})",
    );

    const columnExists: Statement = compile(
      singleFieldRule("principalUser|exists: true"),
    );
    expect(columnExists.query).toContain("principalUser != ''");
  });

  test("re modifier compiles to match() with the regex bound as a parameter", () => {
    const statement: Statement = compile(
      singleFieldRule("message|re: '^Failed login from \\d+'"),
    );

    expect(statement.query).toContain("match(message, {p0:String})");
    expect(statement.query_params["p0"]).toBe("^Failed login from \\d+");
  });

  test("cidr modifier compiles to isIPAddressInRange, on text that is an address", () => {
    const statement: Statement = compile(
      singleFieldRule("principalIp|cidr: '10.0.0.0/8'"),
    );

    expect(statement.query).toContain(
      "((isIPv4String(principalIp) OR isIPv6String(principalIp)) AND isIPAddressInRange(if((isIPv4String(principalIp) OR isIPv6String(principalIp)), principalIp, '::'), {p0:String}))",
    );
    expect(statement.query_params["p0"]).toBe("10.0.0.0/8");
  });

  /*
   * ClickHouse's isIPAddressInRange throws on text that is not an address
   * ("Neither IPv4 nor IPv6 address: ''"), and most events hold '' in one
   * IP field or the other: a rule's cidr failed its whole read on the first
   * such event. Only an address is handed to it now ('::' in place of
   * anything else, which the guard in front turns down).
   */
  test("cidr never hands isIPAddressInRange text that is not an address", () => {
    const statement: Statement = compile(
      singleFieldRule("targetIp|cidr: 'fe80::/10'"),
    );

    const inRange: number = statement.query.indexOf("isIPAddressInRange(");
    const argument: string = statement.query.slice(
      inRange + "isIPAddressInRange(".length,
    );

    expect(
      argument.startsWith(
        "if((isIPv4String(targetIp) OR isIPv6String(targetIp)), targetIp, '::')",
      ),
    ).toBe(true);
    // The address check guards the range check.
    expect(statement.query.indexOf("isIPv4String(targetIp)")).toBeLessThan(
      inRange,
    );
    expect(statement.query_params["p0"]).toBe("fe80::/10");
  });

  test("cidr on an attribute guards the attribute's text the same way", () => {
    const statement: Statement = compile(
      singleFieldRule("client.address|cidr: '192.168.0.0/16'"),
    );

    expect(statement.query).toContain("isIPv4String(attributes[");
    expect(statement.query).toContain(
      "isIPAddressInRange(if((isIPv4String(attributes[",
    );
  });

  test("numeric comparison on a number column stays numeric", () => {
    const statement: Statement = compile(
      singleFieldRule("targetPort|gt: 1024"),
    );

    expect(statement.query).toContain("targetPort > {p0:Double}");
    expect(statement.query_params["p0"]).toBe(1024);
  });

  test("numeric comparison on an attribute goes through toFloat64OrNull", () => {
    const statement: Statement = compile(singleFieldRule("event.count|gte: 5"));

    expect(statement.query).toContain(
      "toFloat64OrNull(attributes[{p0:String}]) >= {p1:Double}",
    );
  });

  /*
   * Sigma rules routinely carry fractional thresholds (rates, ratios,
   * durations in seconds). The attribute comparison side is already
   * toFloat64OrNull, so the bound threshold has to be Double — an Int32
   * bind cannot parse `0.5` and fails the whole query at runtime.
   */
  describe("fractional numeric thresholds", () => {
    const comparisonModifiers: Array<{ modifier: string; sql: string }> = [
      { modifier: "gt", sql: ">" },
      { modifier: "gte", sql: ">=" },
      { modifier: "lt", sql: "<" },
      { modifier: "lte", sql: "<=" },
    ];

    test.each(comparisonModifiers)(
      "binds a fractional |$modifier attribute threshold as Double",
      ({ modifier, sql }: { modifier: string; sql: string }) => {
        const statement: Statement = compile(
          singleFieldRule(`event.errorRate|${modifier}: 0.5`),
        );

        expect(statement.query).toContain(
          `toFloat64OrNull(attributes[{p0:String}]) ${sql} {p1:Double}`,
        );
        expect(statement.query_params["p1"]).toBe(0.5);
      },
    );

    test("preserves a threshold smaller than one instead of truncating it", () => {
      const statement: Statement = compile(
        singleFieldRule("event.errorRate|gt: 0.001"),
      );

      expect(statement.query_params["p1"]).toBe(0.001);
      expect(statement.query_params["p1"]).not.toBe(0);
    });

    test("preserves a negative fractional threshold", () => {
      const statement: Statement = compile(
        singleFieldRule("event.drift|lt: -2.5"),
      );

      expect(statement.query).toContain(
        "toFloat64OrNull(attributes[{p0:String}]) < {p1:Double}",
      );
      expect(statement.query_params["p1"]).toBe(-2.5);
    });

    test("binds a fractional threshold on a number column as Double", () => {
      const statement: Statement = compile(
        singleFieldRule("targetPort|gte: 1024.5"),
      );

      expect(statement.query).toContain("targetPort >= {p0:Double}");
      expect(statement.query_params["p0"]).toBe(1024.5);
    });

    test("keeps integer thresholds exact under the Double bind", () => {
      const statement: Statement = compile(
        singleFieldRule("targetPort|gt: 1024"),
      );

      expect(statement.query_params["p0"]).toBe(1024);
    });

    test("binds an integer threshold beyond the Int32 range", () => {
      const statement: Statement = compile(
        singleFieldRule("event.bytes|gt: 3000000000"),
      );

      expect(statement.query_params["p1"]).toBe(3000000000);
    });

    test("a fractional threshold still leaves nothing user-controlled in the SQL text", () => {
      const statement: Statement = compile(
        singleFieldRule("event.errorRate|gte: 0.5"),
      );

      expect(statement.query).not.toContain("0.5");
      expect(statement.query).not.toContain("event.errorRate");
      expect(paramValues(statement)).toContain(0.5);
    });
  });

  test("numeric comparison with a non-numeric value is rejected", () => {
    expect(() => {
      return compile(singleFieldRule("targetPort|gt: banana"));
    }).toThrow(BadDataException);
  });

  test("numeric equality on a number column", () => {
    const statement: Statement = compile(singleFieldRule("classUid: 3002"));

    expect(statement.query).toContain("classUid = {p0:Double}");
    expect(statement.query_params["p0"]).toBe(3002);
  });

  test("array column membership uses has(); contains uses arrayExists ILIKE", () => {
    const membership: Statement = compile(
      singleFieldRule("mitreTechniques: T1110"),
    );
    expect(membership.query).toContain("has(mitreTechniques, {p0:String})");
    expect(membership.query_params["p0"]).toBe("T1110");

    const fuzzy: Statement = compile(
      singleFieldRule("observables|contains: evil.example"),
    );
    expect(fuzzy.query).toContain(
      "arrayExists(x -> x ILIKE {p0:String}, observables)",
    );
    expect(fuzzy.query_params["p0"]).toBe("%evil.example%");
  });

  test("windash expands dash values to both dash and slash spellings", () => {
    const statement: Statement = compile(
      singleFieldRule("principalProcess|contains|windash: '-enc'"),
    );

    expect(paramValues(statement)).toEqual(["%-enc%", "%/enc%"]);
  });

  test("keyword selections match the message column", () => {
    const statement: Statement = compile(`
title: Keywords
detection:
  keywords:
    - mimikatz
    - 'lsass dump'
  condition: keywords
`);

    expect(statement.query).toContain("message ILIKE {p0:String}");
    expect(statement.query).toContain("message ILIKE {p1:String}");
    expect(paramValues(statement)).toEqual(["%mimikatz%", "%lsass dump%"]);
  });
});

describe("SigmaClickhouseCompiler condition composition", () => {
  const TWO_SELECTION_RULE: string = `
title: Two selections
detection:
  sel_a:
    principalUser: alice
  sel_b:
    principalHost: web-01
  condition: __CONDITION__
`;

  function compileWithCondition(condition: string): Statement {
    return compile(TWO_SELECTION_RULE.replace("__CONDITION__", condition));
  }

  test("and / or / not compose", () => {
    const andStatement: Statement = compileWithCondition("sel_a and sel_b");
    expect(andStatement.query).toContain(") AND (");

    const orStatement: Statement = compileWithCondition("sel_a or sel_b");
    expect(orStatement.query).toContain(") OR (");

    const notStatement: Statement = compileWithCondition("sel_a and not sel_b");
    expect(notStatement.query).toContain("NOT (");
  });

  test("`all of sel_*` ANDs every matched selection", () => {
    const statement: Statement = compileWithCondition("all of sel_*");

    expect(statement.query).toContain(") AND (");
    expect(paramValues(statement)).toEqual(["alice", "web-01"]);
  });

  test("`1 of sel_*` compiles to a toUInt8 sum threshold", () => {
    const statement: Statement = compileWithCondition("1 of sel_*");

    expect(statement.query).toContain("toUInt8((");
    expect(statement.query).toContain(") >= {p2:Double}");
    expect(statement.query_params["p2"]).toBe(1);
  });

  test("`any of them` ORs every selection", () => {
    const statement: Statement = compileWithCondition("any of them");

    expect(statement.query).toContain(") OR (");
  });
});

describe("SigmaClickhouseCompiler injection resistance", () => {
  test("hostile values never appear in SQL text — only as bound parameters", () => {
    const hostile: string = "'; DROP TABLE SecurityEventItemV1; --";
    const statement: Statement = compile(`
title: Hostile value
detection:
  selection:
    principalUser: "${hostile}"
  condition: selection
`);

    expect(statement.query).not.toContain("DROP TABLE");
    expect(paramValues(statement)).toContain(hostile.toLowerCase());
  });

  test("hostile field names become attribute-key parameters, not identifiers", () => {
    const statement: Statement = compile(`
title: Hostile field
detection:
  selection:
    "attributes[] ; SELECT 1": x
  condition: selection
`);

    expect(statement.query).not.toContain("SELECT 1");
    expect(statement.query).toContain("attributes[{p0:String}]");
    expect(statement.query_params["p0"]).toBe("attributes[] ; SELECT 1");
  });

  test("hostile regex stays a parameter", () => {
    const statement: Statement = compile(
      singleFieldRule('message|re: "\') OR 1=1 --"'),
    );

    expect(statement.query).toContain("match(message, {p0:String})");
    expect(statement.query).not.toContain("OR 1=1");
  });
});

describe("buildSigmaFieldExpression", () => {
  test("text column renders bare", () => {
    expect(buildSigmaFieldExpression("principalHost").query).toBe(
      "principalHost",
    );
  });

  test("number column renders via toString", () => {
    expect(buildSigmaFieldExpression("targetPort").query).toBe(
      "toString(targetPort)",
    );
  });

  test("array column renders via arrayStringConcat", () => {
    expect(buildSigmaFieldExpression("mitreTactics").query).toBe(
      "arrayStringConcat(mitreTactics, ',')",
    );
  });

  test("attribute field renders as a parameterized attributes[] lookup", () => {
    const statement: Statement = buildSigmaFieldExpression("custom.key");

    expect(statement.query).toBe("attributes[{p0:String}]");
    expect(statement.query_params["p0"]).toBe("custom.key");
  });
});

describe("buildSigmaDistinctCountExpression", () => {
  /*
   * The distinct-count variant differs from buildSigmaFieldExpression on
   * exactly one point: number columns map their 0-as-unset sentinel to
   * NULL, so a portless event never counts as distinct port "0" — the
   * caller's nullIf(expr, '') only handles the text sentinel.
   */
  test("number column nullIfs its 0-as-unset sentinel before toString", () => {
    expect(buildSigmaDistinctCountExpression("targetPort").query).toBe(
      "toString(nullIf(targetPort, 0))",
    );
  });

  test("number-column aliases get the same treatment", () => {
    expect(buildSigmaDistinctCountExpression("dst_port").query).toBe(
      "toString(nullIf(targetPort, 0))",
    );
  });

  test("text column renders bare, same as the plain expression", () => {
    expect(buildSigmaDistinctCountExpression("principalUser").query).toBe(
      "principalUser",
    );
  });

  test("attribute field stays a parameterized attributes[] lookup", () => {
    const statement: Statement =
      buildSigmaDistinctCountExpression("custom.key");

    expect(statement.query).toBe("attributes[{p0:String}]");
    expect(statement.query_params["p0"]).toBe("custom.key");
  });
});

/*
 * `field|expand: '%name%'`: the field is on a watchlist. The compiler
 * takes the project's lists bound to the rule (SigmaRule.watchlists, from
 * the server's SecurityWatchlists) and writes each as the list's values;
 * a list that is not bound is the rule's error, by name.
 */
describe("SigmaClickhouseCompiler: watchlists", () => {
  const VIP: SigmaWatchlist = {
    name: "vip_users",
    entityType: SecurityEntityType.User,
    exactValues: ["alice", "bob"],
    patterns: ["exec-*"],
    ranges: [],
  };

  const ADMIN_ADDRESSES: SigmaWatchlist = {
    name: "admin_addresses",
    entityType: SecurityEntityType.IpAddress,
    exactValues: [],
    patterns: [],
    ranges: ["10.20.0.0/16"],
  };

  function compileWith(ruleYaml: string, watchlists: SigmaWatchlists): Statement {
    const rule: SigmaRule = SigmaRuleParser.parse(ruleYaml);
    return SigmaClickhouseCompiler.compile({ ...rule, watchlists });
  }

  test("a typed column on a list: its values, its patterns, every value bound", () => {
    const statement: Statement = compileWith(
      singleFieldRule("principalUser|expand: '%vip_users%'"),
      { vip_users: VIP },
    );

    expect(statement.query).toContain(
      "(lowerUTF8(principalUser) IN {p0:Array(String)}) OR (lowerUTF8(principalUser) LIKE {p1:String})",
    );
    expect(paramValues(statement)).toEqual([["alice", "bob"], "exec-%"]);
    expect(statement.query).not.toContain("alice");
    expect(statement.query).not.toContain("vip_users");
  });

  test("a rule names a list whatever the case of its name", () => {
    const statement: Statement = compileWith(
      singleFieldRule("principalUser|expand: '%VIP_Users%'"),
      { vip_users: VIP },
    );

    expect(paramValues(statement)).toEqual([["alice", "bob"], "exec-%"]);
  });

  test("several lists: on any of them", () => {
    const statement: Statement = compileWith(
      `
title: Test
detection:
  selection:
    principalIp|expand:
      - '%vip_users%'
      - '%admin_addresses%'
  condition: selection
`,
      { vip_users: VIP, admin_addresses: ADMIN_ADDRESSES },
    );

    expect(statement.query).toContain(") OR (");
    expect(statement.query).toContain("isIPAddressInRange(");
    expect(paramValues(statement)).toEqual([
      ["alice", "bob"],
      "exec-%",
      "10.20.0.0/16",
    ]);
  });

  test("an address not on the allow list: `not` of the list's match", () => {
    const statement: Statement = compileWith(
      `
title: Admin sign-in from an address not on the list
detection:
  admin:
    className: Authentication
    principalUser|expand: '%vip_users%'
  allowed:
    principalIp|expand: '%admin_addresses%'
  condition: admin and not allowed
`,
      { vip_users: VIP, admin_addresses: ADMIN_ADDRESSES },
    );

    const notAt: number = statement.query.indexOf("NOT (");

    // The admin on the VIP list, and NOT the address on the allow list.
    expect(notAt).toBeGreaterThan(-1);
    expect(statement.query.slice(0, notAt)).toContain(
      "lowerUTF8(principalUser) IN",
    );
    expect(statement.query.slice(notAt)).toContain("isIPAddressInRange(");
    expect(statement.query.slice(notAt)).not.toContain("principalUser");
  });

  test("an attribute, a number column and an array column each read as text", () => {
    const attribute: Statement = compileWith(
      singleFieldRule("http.user_agent|expand: '%vip_users%'"),
      { vip_users: VIP },
    );
    expect(attribute.query).toContain(
      "lowerUTF8(attributes[{p0:String}]) IN {p1:Array(String)}",
    );
    expect(paramValues(attribute)[0]).toBe("http.user_agent");

    const port: Statement = compileWith(
      singleFieldRule("targetPort|expand: '%vip_users%'"),
      { vip_users: { ...VIP, patterns: [] } },
    );
    expect(port.query).toContain(
      "lowerUTF8(toString(targetPort)) IN {p0:Array(String)}",
    );

    const observables: Statement = compileWith(
      singleFieldRule("observables|expand: '%vip_users%'"),
      { vip_users: { ...VIP, patterns: [] } },
    );
    expect(observables.query).toContain(
      "arrayExists(__watchlist_element -> lowerUTF8(__watchlist_element) IN {p0:Array(String)}, observables)",
    );
  });

  test("a list the rule names that is not bound is the rule's error, by name", () => {
    expect(() => {
      return compileWith(
        singleFieldRule("principalUser|expand: '%vip_user%'"),
        { vip_users: VIP },
      );
    }).toThrow(BadDataException);

    expect(() => {
      return compileWith(
        singleFieldRule("principalUser|expand: '%vip_user%'"),
        {},
      );
    }).toThrow(
      "There is no watchlist named vip_user in this project. Create it under Security Events > Detections > Watchlists, or fix its name in the rule.",
    );

    // A rule compiled with no lists bound at all.
    expect(() => {
      return compile(singleFieldRule("principalUser|expand: '%vip_users%'"));
    }).toThrow("There is no watchlist named vip_users");
  });

  test("a list bound to a rule that never reads it changes nothing", () => {
    const plain: Statement = compile(singleFieldRule("principalUser: alice"));
    const withList: Statement = compileWith(
      singleFieldRule("principalUser: alice"),
      { vip_users: VIP },
    );

    expect(withList.query).toBe(plain.query);
    expect(paramValues(withList)).toEqual(paramValues(plain));
  });
});
