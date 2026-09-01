import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../Utils/Rules/RuleEngineLimits";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every rule engine asks the same question when a resource is created -
 * "which of this project's enabled rules match it?" - and every one of them
 * used to ask it with `limit: 100, skip: 0`. That is not a page of a paged
 * walk; it is the entire evaluation. A project with more rules than the cap
 * silently never consulted the rest, which is how 1,243 monitor label rules
 * produced roughly 50-100 labelled monitors out of 1,000+
 * (OneUptime/oneuptime#3506).
 *
 * The fix is one shared constant, and this is the guard on it: the bug was a
 * copy-paste that spread across 62 files, so the next engine copied from a
 * sibling has to inherit the fix rather than the cap. Scanning the directory
 * catches a new engine; asserting on the constant catches the cap being
 * reintroduced under a different number.
 *
 * Raising the cap is only half of it. A read of `limit: <cap>, skip: 0` with
 * no second page still cannot tell "that is all of them" from "that is all I
 * was allowed to ask for", so an engine that reads rules must also REPORT
 * hitting the ceiling. Without that, 10,000 is not a ceiling - it is the same
 * cliff, further away. Both halves are asserted below.
 */

const SERVICES_DIRECTORY: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "Server",
  "Services",
);

interface RuleEngineSource {
  /** Repo-relative-ish, so a failure message names something greppable. */
  name: string;
  contents: string;
}

/*
 * Reads of a project's hand-authored rule config that do NOT carry the
 * *RuleEngineService.ts suffix, and so were missed the first time the cap was
 * lifted by filename. Five hang off IncidentService/AlertService
 * onCreateSuccess and one off ScheduledMaintenanceService's - the same
 * create-time chain, the same `limit: 100, skip: 0` shape, the same defect.
 *
 * Listed explicitly rather than matched by pattern: there is no naming
 * convention that separates these from the hundreds of legitimate paged reads
 * in the same directory, and a wrong pattern here would be a test that
 * silently checks nothing.
 */
const OTHER_PROJECT_RULE_READS: Array<string> = [
  "IncidentGroupingEngineService.ts",
  "AlertGroupingEngineService.ts",
  "IncidentSlaRuleService.ts",
  "IncidentReminderRuleService.ts",
  "AlertReminderRuleService.ts",
  "ScheduledMaintenanceReminderRuleService.ts",
];

function readSource(fileName: string): RuleEngineSource {
  return {
    name: fileName,
    contents: fs.readFileSync(path.join(SERVICES_DIRECTORY, fileName), "utf8"),
  };
}

/*
 * The engines that evaluate a project's configured rules. Named by
 * convention, and the convention is what a new engine will be named too.
 */
function readRuleEngineSources(): Array<RuleEngineSource> {
  return fs
    .readdirSync(SERVICES_DIRECTORY)
    .filter((fileName: string) => {
      return fileName.endsWith("RuleEngineService.ts");
    })
    .map(readSource);
}

/*
 * A file that reads a project's rules at all, and the shape of a limit that
 * reads all of them. Hoisted rather than written inline: `/x/.test(y)` is a
 * lint fight between `wrap-regex`, which wants parentheses, and prettier,
 * which takes them straight back off.
 */
const RULE_FETCH_CALL: RegExp = /RuleService\.findBy\(|this\.findBy\(/;
const WHOLE_PROJECT_LIMIT: RegExp =
  /limit:\s*(MAX_RULES_EVALUATED_PER_PROJECT|LIMIT_PER_PROJECT|LIMIT_MAX)/;
/*
 * A read that advances an offset rather than always starting at zero, i.e.
 * one that pages. Such a read cannot truncate, so it needs no ceiling report.
 */
const PAGED_READ: RegExp = /skip:\s*skip,/;

/*
 * Every `limit: <literal number>` in the file. Limits written as a named
 * constant - MAX_RULES_EVALUATED_PER_PROJECT, LIMIT_PER_PROJECT, LIMIT_MAX,
 * or a page size the file defines and documents - are deliberate; a bare
 * number in a rule read is the shape of the bug.
 */
function numericLimits(source: string): Array<number> {
  const matches: Array<string> = source.match(/limit:\s*\d+/g) || [];

  return matches.map((match: string) => {
    return Number(match.replace(/limit:\s*/, ""));
  });
}

describe("MAX_RULES_EVALUATED_PER_PROJECT", () => {
  it("is the codebase's existing whole-project bound", () => {
    expect(MAX_RULES_EVALUATED_PER_PROJECT).toBe(LIMIT_PER_PROJECT);
  });

  /*
   * 1,243 is the reporter's rule count. A ceiling that a real project has
   * already walked up to is not a ceiling.
   */
  it("leaves room well past the rule counts that broke", () => {
    expect(MAX_RULES_EVALUATED_PER_PROJECT).toBeGreaterThanOrEqual(10000);
  });
});

describe("rule engines read every enabled rule in the project", () => {
  const sources: Array<RuleEngineSource> = readRuleEngineSources();

  it("finds the rule engines to check", () => {
    expect(sources.length).toBeGreaterThan(50);
  });

  it.each(
    sources.map((source: RuleEngineSource) => {
      return [source.name, source] as [string, RuleEngineSource];
    }),
  )(
    "%s does not cap its rule read at a bare number",
    (_name: string, source: RuleEngineSource) => {
      /*
       * `limit: 1` is a single-row existence probe, not a rule evaluation, and
       * a couple of engines legitimately use one. Anything else written as a
       * literal is a cap on how much configuration gets evaluated.
       */
      const suspiciousLimits: Array<number> = numericLimits(
        source.contents,
      ).filter((limit: number) => {
        return limit > 1 && limit < LIMIT_PER_PROJECT;
      });

      expect(suspiciousLimits).toEqual([]);
    },
  );

  /*
   * The read is `limit: <cap>, skip: 0` - there is no second page - so the
   * cap has to be the whole-project one. An engine that fetches rules must
   * say so with the shared constant.
   */
  it.each(
    sources
      .filter((source: RuleEngineSource) => {
        return RULE_FETCH_CALL.test(source.contents);
      })
      .map((source: RuleEngineSource) => {
        return [source.name, source] as [string, RuleEngineSource];
      }),
  )(
    "%s fetches its rules with a whole-project limit",
    (_name: string, source: RuleEngineSource) => {
      expect(WHOLE_PROJECT_LIMIT.test(source.contents)).toBe(true);
    },
  );

  /*
   * The half that turns a cliff into a ceiling. `limit: <cap>, skip: 0`
   * returns a full page whether or not more rows exist, so an engine that
   * does not report the full page has merely relocated #3506 to a higher
   * number.
   *
   * Two ways to satisfy that, and both are fine. Page to exhaustion, as
   * NetworkDeviceAutoImportRuleEngineService.loadEnabledRules does - a read
   * that keeps going until a short page proves the end has nothing left to
   * truncate. Or read once and report a full result, which is what every
   * other engine does. What is not fine is a single capped read that says
   * nothing.
   */
  it.each(
    sources
      .filter((source: RuleEngineSource) => {
        return RULE_FETCH_CALL.test(source.contents);
      })
      .map((source: RuleEngineSource) => {
        return [source.name, source] as [string, RuleEngineSource];
      }),
  )(
    "%s either pages its rule read to exhaustion or reports hitting the ceiling",
    (_name: string, source: RuleEngineSource) => {
      const pagesToExhaustion: boolean = PAGED_READ.test(source.contents);
      const reportsCeiling: boolean =
        source.contents.includes("logIfRuleReadWasTruncated({") &&
        source.contents.includes("rulesRead:");

      expect(pagesToExhaustion || reportsCeiling).toBe(true);
    },
  );
});

/*
 * The same two properties for the rule reads that do not carry the
 * *RuleEngineService.ts suffix. These were missed when the cap was first
 * lifted, precisely because the fix was scoped by filename - which is the
 * argument for listing them here by name rather than trusting a pattern.
 */
describe("project rule reads outside the *RuleEngineService.ts naming", () => {
  const sources: Array<RuleEngineSource> =
    OTHER_PROJECT_RULE_READS.map(readSource);

  it.each(
    sources.map((source: RuleEngineSource) => {
      return [source.name, source] as [string, RuleEngineSource];
    }),
  )(
    "%s reads its rules with a whole-project limit and reports the ceiling",
    (_name: string, source: RuleEngineSource) => {
      const suspiciousLimits: Array<number> = numericLimits(
        source.contents,
      ).filter((limit: number) => {
        return limit > 1 && limit < LIMIT_PER_PROJECT;
      });

      expect(suspiciousLimits).toEqual([]);
      expect(WHOLE_PROJECT_LIMIT.test(source.contents)).toBe(true);
      expect(source.contents).toContain("logIfRuleReadWasTruncated({");
    },
  );
});
