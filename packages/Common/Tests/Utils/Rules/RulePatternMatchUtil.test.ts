import RulePatternMatchUtil from "../../../Utils/Rules/RulePatternMatchUtil";

/*
 * Contract under test - the pattern language automation rules (label rules,
 * owner rules) accept:
 *
 *   - a case-insensitive, UNANCHORED regular expression (the documented and
 *     historical behaviour), and
 *   - a '*' wildcard glob, which must match the WHOLE value, as a fallback
 *     for patterns the regex engine rejects or does not match.
 *
 * The glob fallback exists because the sibling Network Site assignment rules
 * take globs, so `*0664*` is what users actually type - and `new
 * RegExp("*0664*")` throws, which the engines used to swallow into "matches
 * nothing, forever" (OneUptime/oneuptime#2940).
 */

describe("RulePatternMatchUtil.matches - regex behaviour (unchanged)", () => {
  it("matches an unanchored regex anywhere in the value", () => {
    expect(RulePatternMatchUtil.matches("core-switch-01", "switch")).toBe(true);
    expect(
      RulePatternMatchUtil.matches("core-switch-01", "core-switch-.*"),
    ).toBe(true);
    expect(RulePatternMatchUtil.matches("core-switch-01", "^core")).toBe(true);
    expect(RulePatternMatchUtil.matches("core-switch-01", "01$")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(RulePatternMatchUtil.matches("CORE-SWITCH-01", "core-switch")).toBe(
      true,
    );
    expect(RulePatternMatchUtil.matches("core-switch-01", "CORE-SWITCH")).toBe(
      true,
    );
  });

  it("supports regex alternation and character classes", () => {
    expect(
      RulePatternMatchUtil.matches(
        "production edge router",
        "production|critical",
      ),
    ).toBe(true);
    expect(
      RulePatternMatchUtil.matches(
        "critical edge router",
        "production|critical",
      ),
    ).toBe(true);
    expect(
      RulePatternMatchUtil.matches(
        "staging edge router",
        "production|critical",
      ),
    ).toBe(false);
    expect(RulePatternMatchUtil.matches("sw-07", "sw-0[0-9]")).toBe(true);
    expect(RulePatternMatchUtil.matches("sw-7a", "sw-0[0-9]")).toBe(false);
  });

  it("returns false when a valid regex simply does not match", () => {
    expect(RulePatternMatchUtil.matches("core-switch-01", "^edge")).toBe(false);
    expect(RulePatternMatchUtil.matches("core-switch-01", "firewall")).toBe(
      false,
    );
  });
});

describe("RulePatternMatchUtil.matches - wildcard fallback", () => {
  /*
   * The exact reproduction from the issue: a rule authored with the site
   * assignment rules' glob syntax against a device discovered by SNMP.
   */
  it("matches the *0664* pattern from issue #2940 against UN0664LANSWI03", () => {
    expect(RulePatternMatchUtil.matches("UN0664LANSWI03", "*0664*")).toBe(true);
    expect(RulePatternMatchUtil.matches("UN0664OUTWAP06", "*0664*")).toBe(true);
    expect(RulePatternMatchUtil.matches("UN0661LANSWI03", "*0664*")).toBe(
      false,
    );
  });

  it("proves the fallback is needed - the pattern is not a valid regex", () => {
    expect(RulePatternMatchUtil.isValidRegex("*0664*")).toBe(false);
  });

  it("matches a glob against the whole value", () => {
    expect(RulePatternMatchUtil.matches("unit-1042-sw1", "unit-*")).toBe(true);
    expect(RulePatternMatchUtil.matches("unit-1042-sw1", "*-sw1")).toBe(true);
    expect(RulePatternMatchUtil.matches("unit-1042-sw1", "unit-*-sw1")).toBe(
      true,
    );
    expect(RulePatternMatchUtil.matches("edge-1042-sw1", "unit-*")).toBe(false);
  });

  /*
   * Regex first, so a pattern that happens to compile keeps the regex's
   * unanchored reading even when the author meant a glob: `unit-*` compiles
   * to "unit" + zero-or-more "-", which is found inside "my-unit-1042-sw1".
   * That is deliberately the OLD behaviour - matching must only ever widen,
   * never narrow, or fixing this bug would break rules that already work.
   */
  it("keeps the unanchored regex reading for a glob that also compiles", () => {
    expect(RulePatternMatchUtil.isValidRegex("unit-*")).toBe(true);
    expect(RulePatternMatchUtil.matches("my-unit-1042-sw1", "unit-*")).toBe(
      true,
    );
  });

  it("treats a bare * as match-everything", () => {
    expect(RulePatternMatchUtil.matches("anything at all", "*")).toBe(true);
    expect(RulePatternMatchUtil.matches("10.242.170.222", "*")).toBe(true);
  });

  it("is case-insensitive in the glob path too", () => {
    expect(RulePatternMatchUtil.matches("un0664lanswi03", "*0664*")).toBe(true);
    expect(RulePatternMatchUtil.matches("UN0664LANSWI03", "*LANSWI*")).toBe(
      true,
    );
    expect(RulePatternMatchUtil.matches("UN0664LANSWI03", "*lanswi*")).toBe(
      true,
    );
  });

  it("falls back to the glob only when the regex attempt fails to match", () => {
    /*
     * `UN*SWI03` compiles ("U" followed by zero or more "N"), and as a regex
     * it does not match - the glob reading does. Both are tried, so the user
     * gets the reading they meant.
     */
    expect(RulePatternMatchUtil.isValidRegex("UN*SWI03")).toBe(true);
    expect(new RegExp("UN*SWI03", "i").test("UN0664LANSWI03")).toBe(false);
    expect(RulePatternMatchUtil.matches("UN0664LANSWI03", "UN*SWI03")).toBe(
      true,
    );
  });

  it("keeps regex semantics when the regex matches and the glob would not", () => {
    // `.*0664.*` is a regex match; as a glob the literal dots would not match.
    expect(RulePatternMatchUtil.matches("UN0664LANSWI03", ".*0664.*")).toBe(
      true,
    );
  });
});

describe("RulePatternMatchUtil.matches - unsupported and empty patterns", () => {
  it("never matches a pattern that is neither a regex nor a glob", () => {
    expect(RulePatternMatchUtil.matches("switch-01", "switch-(01")).toBe(false);
    expect(RulePatternMatchUtil.matches("switch-01", "[unclosed")).toBe(false);
  });

  it("does not throw on an unparseable pattern", () => {
    expect(() => {
      return RulePatternMatchUtil.matches("switch-01", "switch-(01");
    }).not.toThrow();
  });

  it("treats an empty or whitespace-only pattern as 'no criterion'", () => {
    expect(RulePatternMatchUtil.matches("switch-01", "")).toBe(true);
    expect(RulePatternMatchUtil.matches("switch-01", "   ")).toBe(true);
    expect(RulePatternMatchUtil.matches("switch-01", null)).toBe(true);
    expect(RulePatternMatchUtil.matches("switch-01", undefined)).toBe(true);
  });

  it("never matches a missing value against a configured pattern", () => {
    expect(RulePatternMatchUtil.matches(undefined, "*0664*")).toBe(false);
    expect(RulePatternMatchUtil.matches(null, "*0664*")).toBe(false);
    expect(RulePatternMatchUtil.matches("", "*0664*")).toBe(false);
    expect(RulePatternMatchUtil.matches("", "*")).toBe(false);
  });

  it("trims surrounding whitespace on the pattern", () => {
    // Untrimmed, the glob would demand the literal spaces and match nothing.
    expect(RulePatternMatchUtil.matches("UN0664LANSWI03", "  *0664*  ")).toBe(
      true,
    );
    expect(RulePatternMatchUtil.matches("core-switch-01", "  switch  ")).toBe(
      true,
    );
    expect(RulePatternMatchUtil.matches("core-switch-01", " switch 01 ")).toBe(
      false,
    );
  });

  it("survives non-string inputs without throwing", () => {
    expect(
      RulePatternMatchUtil.matches(
        42 as unknown as string,
        "*0664*" as unknown as string,
      ),
    ).toBe(false);
    expect(
      RulePatternMatchUtil.matches("switch", 42 as unknown as string),
    ).toBe(true);
  });
});

describe("RulePatternMatchUtil.isValidRegex", () => {
  it("accepts real regular expressions", () => {
    expect(RulePatternMatchUtil.isValidRegex("core-switch-.*")).toBe(true);
    expect(RulePatternMatchUtil.isValidRegex("production|critical")).toBe(true);
    expect(RulePatternMatchUtil.isValidRegex("^sw-[0-9]{2}$")).toBe(true);
    expect(RulePatternMatchUtil.isValidRegex("")).toBe(true);
  });

  it("rejects patterns the engine cannot compile", () => {
    expect(RulePatternMatchUtil.isValidRegex("*0664*")).toBe(false);
    expect(RulePatternMatchUtil.isValidRegex("+bad")).toBe(false);
    expect(RulePatternMatchUtil.isValidRegex("(unclosed")).toBe(false);
    expect(RulePatternMatchUtil.isValidRegex("[unclosed")).toBe(false);
    expect(RulePatternMatchUtil.isValidRegex("a{2,1}")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(RulePatternMatchUtil.isValidRegex(null as unknown as string)).toBe(
      false,
    );
    expect(
      RulePatternMatchUtil.isValidRegex(undefined as unknown as string),
    ).toBe(false);
  });
});

describe("RulePatternMatchUtil.isSupportedPattern", () => {
  it("supports valid regexes", () => {
    expect(RulePatternMatchUtil.isSupportedPattern("core-switch-.*")).toBe(
      true,
    );
    expect(RulePatternMatchUtil.isSupportedPattern("production|critical")).toBe(
      true,
    );
  });

  it("supports wildcard globs that are not valid regexes", () => {
    expect(RulePatternMatchUtil.isSupportedPattern("*0664*")).toBe(true);
    expect(RulePatternMatchUtil.isSupportedPattern("*")).toBe(true);
    expect(RulePatternMatchUtil.isSupportedPattern("*(*")).toBe(true);
  });

  it("treats an empty pattern as supported - it is simply not a criterion", () => {
    expect(RulePatternMatchUtil.isSupportedPattern("")).toBe(true);
    expect(RulePatternMatchUtil.isSupportedPattern("   ")).toBe(true);
  });

  it("rejects patterns that can never match anything", () => {
    expect(RulePatternMatchUtil.isSupportedPattern("switch-(01")).toBe(false);
    expect(RulePatternMatchUtil.isSupportedPattern("[unclosed")).toBe(false);
    expect(RulePatternMatchUtil.isSupportedPattern("+bad")).toBe(false);
  });
});

describe("RulePatternMatchUtil.matches - performance", () => {
  /*
   * The glob path is the one a user-authored `*a*a*a...` lands on. It is
   * O(value x pattern) by construction (CidrMatchUtil.hostnameMatchesWildcard),
   * so a hostile-looking rule cannot wedge the event loop the way the
   * equivalent regex would.
   */
  it("rejects a pathological wildcard pattern quickly", () => {
    const pattern: string = `${"*a".repeat(12)}*b`;
    const value: string = "a".repeat(60);

    const startedAt: number = Date.now();
    expect(RulePatternMatchUtil.matches(value, pattern)).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it("accepts a pathological wildcard pattern quickly when it does match", () => {
    const pattern: string = `${"*a".repeat(12)}*b`;
    const value: string = `${"a".repeat(60)}b`;

    const startedAt: number = Date.now();
    expect(RulePatternMatchUtil.matches(value, pattern)).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });
});
