import NetworkDeviceLinkRuleScope, {
  NetworkDeviceLinkRuleScopeUtil,
} from "../../../Types/NetworkDevice/NetworkDeviceLinkRuleScope";

/*
 * `scope` was added to a table that already had rules in it, so every rule
 * written before the column existed holds NULL — and each of those rules is
 * currently drawing a topology somebody has already looked at and trusted.
 * NULL therefore has to read as Project, because Project is exactly what
 * those rules have always meant: one parent across whatever device set the
 * query handed the resolver. Read NULL as Site instead and every legacy rule
 * quietly starts asking a different question, re-pointing cables on maps
 * nobody re-opened. That is why the default lives in `parse` rather than in a
 * `=== "Site"` comparison scattered over the call sites: one place to be
 * right, and it is pinned here.
 *
 * The mirror of the same worry is the unrecognised value. The column is free
 * text (the NetworkDeviceMonitoringMethod precedent), so a typo, an older
 * client, or a future scope name that this build has never heard of can all
 * land in it. Every one of them has to fall back to the behaviour that was
 * already on screen rather than to the new one.
 */
describe("NetworkDeviceLinkRuleScope enum", () => {
  /*
   * These strings are persisted values, not display labels. Renaming one is
   * a silent data migration: every row already holding the old spelling stops
   * being recognised and — by the fallback above — quietly reverts to
   * Project, with no error anywhere to say so. Change these only alongside a
   * migration that rewrites the column.
   */
  test("Project is persisted as the string Project", () => {
    expect(NetworkDeviceLinkRuleScope.Project).toBe("Project");
  });

  test("Site is persisted as the string Site", () => {
    expect(NetworkDeviceLinkRuleScope.Site).toBe("Site");
  });

  test("has exactly the two known scopes", () => {
    expect(Object.values(NetworkDeviceLinkRuleScope).sort()).toEqual([
      "Project",
      "Site",
    ]);
  });
});

/*
 * One table, two consumers. `parse` and `isSiteScoped` are asserted against
 * the same rows further down so the pair cannot drift apart: a caller that
 * branches on `isSiteScoped` and a caller that switches on `parse` must never
 * disagree about the same stored string.
 */
const PROJECT_INPUTS: Array<string | null | undefined> = [
  // The pre-column rows, and the shapes an empty form field arrives as.
  undefined,
  null,
  "",
  "  ",
  // The value written by anything that does set the column explicitly.
  "Project",
  "project",
  "PROJECT",
  " Project ",
  /*
   * Near-misses that must NOT be read as site scope. "Sites" and
   * "site-scoped" are the plausible typo and the plausible rename; matching
   * them loosely would turn a mistyped rule into one that silently redraws.
   */
  "Sites",
  "site-scoped",
  "anything",
  // Falsy-looking text is still just unrecognised text, not a flag.
  "0",
  "false",
];

const SITE_INPUTS: Array<string> = [
  "Site",
  "site",
  "SITE",
  " site ",
  "  SiTe  ",
];

interface ScopeCase {
  value: string | null | undefined;
  expected: NetworkDeviceLinkRuleScope;
}

const ALL_CASES: Array<ScopeCase> = [
  ...PROJECT_INPUTS.map((value: string | null | undefined): ScopeCase => {
    return { value: value, expected: NetworkDeviceLinkRuleScope.Project };
  }),
  ...SITE_INPUTS.map((value: string): ScopeCase => {
    return { value: value, expected: NetworkDeviceLinkRuleScope.Site };
  }),
];

describe("NetworkDeviceLinkRuleScopeUtil.parse", () => {
  test.each(PROJECT_INPUTS)(
    "reads %p as Project",
    (value: string | null | undefined) => {
      expect(NetworkDeviceLinkRuleScopeUtil.parse(value)).toBe(
        NetworkDeviceLinkRuleScope.Project,
      );
    },
  );

  test.each(SITE_INPUTS)(
    "reads %p as Site, case- and whitespace-insensitively",
    (value: string) => {
      expect(NetworkDeviceLinkRuleScopeUtil.parse(value)).toBe(
        NetworkDeviceLinkRuleScope.Site,
      );
    },
  );

  /*
   * Only an exact (trimmed, lowercased) "site" opts in. Substring matching
   * would make "not site" or "site (deprecated)" flip the rule's meaning,
   * which is the one direction of mistake this type refuses to make.
   */
  test("does not treat a string merely containing 'site' as site-scoped", () => {
    expect(NetworkDeviceLinkRuleScopeUtil.parse("per site")).toBe(
      NetworkDeviceLinkRuleScope.Project,
    );
    expect(NetworkDeviceLinkRuleScopeUtil.parse("not site")).toBe(
      NetworkDeviceLinkRuleScope.Project,
    );
  });

  /*
   * The return value is always one of the two enum members — never the raw
   * column text passed straight back. Callers switch on it, and a passthrough
   * would send an unrecognised spelling into a branch that does not exist.
   */
  test("returns an enum member for every case in the table, never the raw input", () => {
    for (const testCase of ALL_CASES) {
      const parsed: NetworkDeviceLinkRuleScope =
        NetworkDeviceLinkRuleScopeUtil.parse(testCase.value);

      expect(Object.values(NetworkDeviceLinkRuleScope)).toContain(parsed);
    }
  });

  /*
   * The parser sits in the middle of rendering a topology map: throwing here
   * would take out the whole map over one bad cell, when the safe answer
   * (Project, what the rule drew yesterday) is right there. So nothing in the
   * declared signature may throw — and neither may the falsy non-string
   * shapes a loosely typed caller or a hand-rolled JSON body can smuggle past
   * TypeScript, which the `|| ""` guard absorbs.
   */
  test("never throws for any value in or near its declared signature", () => {
    const inputs: Array<string | null | undefined> = [
      ...ALL_CASES.map((testCase: ScopeCase): string | null | undefined => {
        return testCase.value;
      }),
      "\tSITE\n",
      "\n  project  \t",
      "Site\u0000",
      "🙂",
    ];

    for (const input of inputs) {
      expect((): NetworkDeviceLinkRuleScope => {
        return NetworkDeviceLinkRuleScopeUtil.parse(input);
      }).not.toThrow();
    }

    /*
     * Not strings at all. 0/false/NaN are what a JSON body or a permissive
     * ORM can hand over in place of "no scope set", and they have to land on
     * the same safe default rather than blow up.
     */
    const nonStrings: Array<unknown> = [0, false, NaN];

    for (const input of nonStrings) {
      expect(
        NetworkDeviceLinkRuleScopeUtil.parse(input as unknown as string),
      ).toBe(NetworkDeviceLinkRuleScope.Project);
    }
  });
});

describe("NetworkDeviceLinkRuleScopeUtil.isSiteScoped", () => {
  test.each(SITE_INPUTS)("is true for %p", (value: string) => {
    expect(NetworkDeviceLinkRuleScopeUtil.isSiteScoped(value)).toBe(true);
  });

  test.each(PROJECT_INPUTS)(
    "is false for %p",
    (value: string | null | undefined) => {
      expect(NetworkDeviceLinkRuleScopeUtil.isSiteScoped(value)).toBe(false);
    },
  );

  /*
   * The two entry points are asserted against the same table in the same
   * loop, so neither can be extended (a new alias, a new scope) without the
   * other. `NetworkDeviceLinkRuleUtil` branches on `isSiteScoped` while the
   * dashboard's rule list renders off it too — if they ever disagreed, a rule
   * would be labelled one way and resolved the other.
   */
  test("agrees with parse on every case in the table", () => {
    for (const testCase of ALL_CASES) {
      expect(NetworkDeviceLinkRuleScopeUtil.parse(testCase.value)).toBe(
        testCase.expected,
      );
      expect(NetworkDeviceLinkRuleScopeUtil.isSiteScoped(testCase.value)).toBe(
        testCase.expected === NetworkDeviceLinkRuleScope.Site,
      );
    }
  });
});
