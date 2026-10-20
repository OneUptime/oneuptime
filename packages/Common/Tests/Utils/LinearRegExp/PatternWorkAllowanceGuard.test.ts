import {
  REPOSITORY_DIRECTORY,
  SKIPPED_FOLDER_NAMES,
} from "../../Helpers/TagStripScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * ---------------------------------------------------------------------------
 * EVERY PIECE OF WORK THAT ASKS A PROJECT'S PATTERNS HAS AN ALLOWANCE.
 *
 * The questions asked of a project's patterns for one piece of work share
 * one allowance (Utils/LinearRegExp/PatternWork.ts), kept for the piece of
 * work by Server/Utils/PatternWorkScope.ts: a rule engine's evaluation is
 * marked @RuleEvaluation(), the handling of a batch of telemetry
 * @TelemetryBatch(), or the work runs inside PatternWorkScope.run. A
 * question asked outside any has only its own limit - and an evaluation of
 * thousands of rules, or a batch of thousands of records, is then bounded
 * by nothing.
 *
 * This reads the code the servers and workers run - Common/Server, App's
 * telemetry feature set, and ee/ when it is checked out - and finds every
 * method that asks a project's patterns (it calls the rule matchers, or one
 * of the steps that hand a record of telemetry to them). Each must have an
 * allowance: be marked, run inside PatternWorkScope.run, or be called only
 * by methods of its class that have one. A new evaluation that does not
 * fails here.
 * ---------------------------------------------------------------------------
 */

// What asks a project's rule patterns.
const RULE_MATCHING_CALLS: ReadonlyArray<string> = [
  "RuleCriteriaMatcher.matches",
  "RuleCriteriaMatcher.matchesSync",
  "RuleCriteriaMatcher.matchesWithLegacy",
  "RuleCriteriaMatcher.matchesWithLegacySync",
  "RulePatternMatchUtil.testRegex",
  "RulePatternMatchUtil.matches",
  "IncidentAlertRuleMatcher.doesIncidentMatch",
  "IncidentAlertRuleMatcher.doesAlertMatch",
  "AutoImportRuleMatcher.evaluateHost",
  "CidrMatchUtil.ruleMatches",
  "CidrMatchUtil.pickRule",
  "CidrMatchUtil.hostnameMatchesWildcard",
];

// What hands a record of telemetry to a project's patterns.
const TELEMETRY_STEP_CALLS: ReadonlyArray<string> = [
  "LogDropFilterService.shouldDropLog",
  "LogScrubRuleService.scrubLog",
  "LogPipelineService.processLog",
  "TraceDropFilterService.shouldDropSpan",
  "TraceScrubRuleService.scrubSpan",
  "TraceScrubRuleService.scrubExceptionContent",
  "TracePipelineService.processSpan",
  "MetricPipelineRuleService.applyRules",
  "SessionReplayScrubService.scrubEvents",
];

const ALLOWANCE_DECORATORS: ReadonlySet<string> = new Set<string>([
  "RuleEvaluation",
  "TelemetryBatch",
]);

// Where the code that asks them lives: the matchers and steps themselves.
const DEFINING_FILES: ReadonlySet<string> = new Set<string>([
  "packages/Common/Server/Utils/Rules/IncidentAlertRuleMatcher.ts",
]);

const SCANNED_FOLDERS: ReadonlyArray<string> = [
  "packages/Common/Server",
  "packages/App/FeatureSet/Telemetry",
  "packages/App/FeatureSet/Workers",
  "ee",
];

const CODE_FILE: RegExp = /\.ts$/;
const TEST_FOLDER: RegExp = /(?:^|\/)Tests\//;

interface MethodFacts {
  name: string;
  hasAllowance: boolean;
  // Not private or protected: another class can call it.
  isCallableOutside: boolean;
  // Calls that ask patterns, outside PatternWorkScope.run: their lines.
  unscopedAskingCalls: Array<number>;
  // Methods of the same class it calls.
  callees: Set<string>;
}

export interface UncoveredQuestion {
  file: string;
  method: string;
  line: number;
}

function callName(expression: ts.Expression): string | null {
  if (!ts.isPropertyAccessExpression(expression)) {
    return null;
  }

  const owner: ts.Expression = expression.expression;

  if (ts.isIdentifier(owner)) {
    return `${owner.text}.${expression.name.text}`;
  }

  if (owner.kind === ts.SyntaxKind.ThisKeyword) {
    return `this.${expression.name.text}`;
  }

  return null;
}

function isInsideScopeRun(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (
      ts.isCallExpression(current) &&
      callName(current.expression) === "PatternWorkScope.run"
    ) {
      return true;
    }

    current = current.parent;
  }

  return false;
}

function decoratorNames(node: ts.Node): Array<string> {
  const decorators: ReadonlyArray<ts.Decorator> = ts.canHaveDecorators(node)
    ? ts.getDecorators(node) || []
    : [];

  return decorators
    .map((decorator: ts.Decorator): string | null => {
      const expression: ts.Expression = decorator.expression;

      if (
        ts.isCallExpression(expression) &&
        ts.isIdentifier(expression.expression)
      ) {
        return expression.expression.text;
      }

      return null;
    })
    .filter((name: string | null): name is string => {
      return name !== null;
    });
}

function isCallableOutsideItsClass(node: ts.Node): boolean {
  const modifiers: ReadonlyArray<ts.ModifierLike> = ts.canHaveModifiers(node)
    ? ts.getModifiers(node) || []
    : [];

  return !modifiers.some((modifier: ts.ModifierLike): boolean => {
    return (
      modifier.kind === ts.SyntaxKind.PrivateKeyword ||
      modifier.kind === ts.SyntaxKind.ProtectedKeyword
    );
  });
}

interface SourceReading {
  uncovered: Array<UncoveredQuestion>;
  askersCallableOutside: Array<string>;
}

const NO_OUTSIDE_ASKERS: ReadonlySet<string> = new Set<string>();

/*
 * The methods of each class in a source that ask a project's patterns with
 * no allowance of their own, and are not called only by methods that have
 * one. `outsideAskers` names methods other classes define that ask them
 * with no allowance of their own (findAskersCallableOutside): a call to one
 * from this source asks them too.
 */
export function findUncoveredQuestions(
  file: string,
  text: string,
  outsideAskers: ReadonlySet<string> = NO_OUTSIDE_ASKERS,
): Array<UncoveredQuestion> {
  return readSource(file, text, outsideAskers).uncovered;
}

/*
 * The methods of a source's classes that ask a project's patterns - in
 * their own body, or through methods of their class with no allowance of
 * their own - with no allowance of their own, and that another class can
 * call. Covered here when every caller in their class has an allowance; a
 * call from anywhere else must have one too.
 */
export function findAskersCallableOutside(
  file: string,
  text: string,
): Array<string> {
  return readSource(file, text, NO_OUTSIDE_ASKERS).askersCallableOutside;
}

function readSource(
  file: string,
  text: string,
  outsideAskers: ReadonlySet<string>,
): SourceReading {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const asking: ReadonlySet<string> = new Set<string>([
    ...RULE_MATCHING_CALLS,
    ...TELEMETRY_STEP_CALLS,
  ]);
  const uncovered: Array<UncoveredQuestion> = [];
  const askersCallableOutside: Array<string> = [];

  const visitClass: (node: ts.ClassLikeDeclaration) => void = (
    node: ts.ClassLikeDeclaration,
  ): void => {
    const className: string = node.name?.text || "";
    const methods: Map<string, MethodFacts> = new Map<string, MethodFacts>();

    for (const member of node.members) {
      if (
        !(
          ts.isMethodDeclaration(member) ||
          ts.isPropertyDeclaration(member) ||
          ts.isGetAccessorDeclaration(member)
        ) ||
        !member.name ||
        !ts.isIdentifier(member.name)
      ) {
        continue;
      }

      const facts: MethodFacts = {
        name: member.name.text,
        hasAllowance: decoratorNames(member).some((name: string): boolean => {
          return ALLOWANCE_DECORATORS.has(name);
        }),
        isCallableOutside: isCallableOutsideItsClass(member),
        unscopedAskingCalls: [],
        callees: new Set<string>(),
      };

      const visitBody: (child: ts.Node) => void = (child: ts.Node): void => {
        if (ts.isCallExpression(child)) {
          const name: string | null = callName(child.expression);
          const [owner, method] =
            name === null ? ["", ""] : (name.split(".") as [string, string]);
          const callsAnAskerOfAnotherClass: boolean =
            owner !== "" &&
            owner !== "this" &&
            owner !== className &&
            outsideAskers.has(method);

          if (
            name !== null &&
            (asking.has(name) || callsAnAskerOfAnotherClass) &&
            !isInsideScopeRun(child)
          ) {
            facts.unscopedAskingCalls.push(
              source.getLineAndCharacterOfPosition(child.getStart()).line + 1,
            );
          }

          if (name !== null && (owner === "this" || owner === className)) {
            facts.callees.add(method);
          }
        }

        ts.forEachChild(child, visitBody);
      };

      ts.forEachChild(member, visitBody);
      methods.set(facts.name, facts);
    }

    // Who calls each method, within the class.
    const callers: Map<string, Set<string>> = new Map<string, Set<string>>();

    for (const facts of methods.values()) {
      for (const callee of facts.callees) {
        if (!callers.has(callee)) {
          callers.set(callee, new Set<string>());
        }

        callers.get(callee)!.add(facts.name);
      }
    }

    const covered: Map<string, boolean> = new Map<string, boolean>();

    const isCovered: (name: string, seen: Set<string>) => boolean = (
      name: string,
      seen: Set<string>,
    ): boolean => {
      const known: boolean | undefined = covered.get(name);

      if (known !== undefined) {
        return known;
      }

      const facts: MethodFacts | undefined = methods.get(name);

      if (!facts) {
        return false;
      }

      if (facts.hasAllowance) {
        covered.set(name, true);
        return true;
      }

      if (seen.has(name)) {
        // A cycle: covered only if a way in from outside it is.
        return true;
      }

      const callersOfIt: Set<string> | undefined = callers.get(name);

      if (!callersOfIt || callersOfIt.size === 0) {
        covered.set(name, false);
        return false;
      }

      const nextSeen: Set<string> = new Set<string>(seen).add(name);
      const result: boolean = Array.from(callersOfIt).every(
        (caller: string): boolean => {
          return caller !== name && isCovered(caller, nextSeen);
        },
      );

      covered.set(name, result);

      return result;
    };

    for (const facts of methods.values()) {
      if (facts.unscopedAskingCalls.length === 0) {
        continue;
      }

      if (!isCovered(facts.name, new Set<string>())) {
        uncovered.push({
          file: file,
          method: `${className}.${facts.name}`,
          line: facts.unscopedAskingCalls[0]!,
        });
      }
    }

    /*
     * Which methods ask, in their own body or through methods of the class
     * with no allowance of their own: a method with an allowance asks
     * nothing of whoever calls it.
     */
    const asks: Map<string, boolean> = new Map<string, boolean>();

    const doesAsk: (name: string, seen: Set<string>) => boolean = (
      name: string,
      seen: Set<string>,
    ): boolean => {
      const known: boolean | undefined = asks.get(name);

      if (known !== undefined) {
        return known;
      }

      const facts: MethodFacts | undefined = methods.get(name);

      if (!facts || facts.hasAllowance || seen.has(name)) {
        return false;
      }

      const nextSeen: Set<string> = new Set<string>(seen).add(name);
      const result: boolean =
        facts.unscopedAskingCalls.length > 0 ||
        Array.from(facts.callees).some((callee: string): boolean => {
          return doesAsk(callee, nextSeen);
        });

      asks.set(name, result);

      return result;
    };

    for (const facts of methods.values()) {
      if (
        facts.isCallableOutside &&
        !facts.hasAllowance &&
        doesAsk(facts.name, new Set<string>())
      ) {
        askersCallableOutside.push(facts.name);
      }
    }
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      visitClass(node);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return { uncovered: uncovered, askersCallableOutside: askersCallableOutside };
}

function listServerFiles(): Array<string> {
  const files: Array<string> = [];

  const walk: (relative: string) => void = (relative: string): void => {
    const absolute: string = path.join(REPOSITORY_DIRECTORY, relative);

    if (!fs.existsSync(absolute)) {
      return;
    }

    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const child: string = `${relative}/${entry.name}`;

      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDER_NAMES.has(entry.name) && entry.name !== "Tests") {
          walk(child);
        }

        continue;
      }

      if (CODE_FILE.test(entry.name) && !TEST_FOLDER.test(child)) {
        files.push(child);
      }
    }
  };

  for (const folder of SCANNED_FOLDERS) {
    walk(folder);
  }

  return files.sort();
}

interface AllowanceFacts {
  files: Array<string>;
  uncovered: Array<UncoveredQuestion>;
  decorated: Array<string>;
  // Methods that ask with no allowance of their own, callable from outside.
  askersCallableOutside: Set<string>;
}

let factsMemo: AllowanceFacts | null = null;

function callsAny(text: string, names: Iterable<string>): boolean {
  for (const name of names) {
    if (text.includes(`${name}(`) || text.includes(`${name}<`)) {
      return true;
    }
  }

  return false;
}

function repositoryFacts(): AllowanceFacts {
  if (factsMemo) {
    return factsMemo;
  }

  const askingNames: Array<string> = [
    ...RULE_MATCHING_CALLS,
    ...TELEMETRY_STEP_CALLS,
  ];
  const sources: Array<{ file: string; text: string }> = [];

  for (const file of listServerFiles()) {
    if (DEFINING_FILES.has(file)) {
      continue;
    }

    sources.push({
      file: file,
      text: fs.readFileSync(path.join(REPOSITORY_DIRECTORY, file), "utf8"),
    });
  }

  /*
   * First, the methods that ask with no allowance of their own and that any
   * class can call: covered in their own class only when every caller there
   * has one, so a call from any other source asks too.
   */
  const askersCallableOutside: Set<string> = new Set<string>();

  for (const { file, text } of sources) {
    if (callsAny(text, askingNames)) {
      for (const name of findAskersCallableOutside(file, text)) {
        askersCallableOutside.add(name);
      }
    }
  }

  const callsOfAskers: Array<string> = Array.from(askersCallableOutside).map(
    (name: string): string => {
      return `.${name}`;
    },
  );
  const files: Array<string> = [];
  const uncovered: Array<UncoveredQuestion> = [];
  const decorated: Array<string> = [];

  for (const { file, text } of sources) {
    if (!callsAny(text, askingNames) && !callsAny(text, callsOfAskers)) {
      continue;
    }

    files.push(file);
    uncovered.push(
      ...findUncoveredQuestions(file, text, askersCallableOutside),
    );

    for (const line of text.split("\n")) {
      const trimmed: string = line.trim();

      if (trimmed === "@RuleEvaluation()" || trimmed === "@TelemetryBatch()") {
        decorated.push(file);
      }
    }
  }

  factsMemo = {
    files: files,
    uncovered: uncovered,
    decorated: decorated,
    askersCallableOutside: askersCallableOutside,
  };

  return factsMemo;
}

describe("the reading of a class", () => {
  test("a method that asks patterns with no allowance is found", () => {
    const found: Array<UncoveredQuestion> = findUncoveredQuestions(
      "example.ts",
      `class Engine {
        public async applyRules(rules: Array<Rule>): Promise<void> {
          for (const rule of rules) {
            RulePatternMatchUtil.testRegex(rule.pattern, "title");
          }
        }
      }`,
    );

    expect(found).toEqual([
      { file: "example.ts", method: "Engine.applyRules", line: 4 },
    ]);
  });

  test("a marked method, and a helper only it calls, are covered", () => {
    expect(
      findUncoveredQuestions(
        "example.ts",
        `class Engine {
          @CaptureSpan()
          @RuleEvaluation()
          private async applyRules(rules: Array<Rule>): Promise<void> {
            for (const rule of rules) {
              this.doesMatch(rule);
            }
          }

          private doesMatch(rule: Rule): boolean {
            return RuleCriteriaMatcher.matchesWithLegacySync({ rule });
          }
        }`,
      ),
    ).toEqual([]);
  });

  test("a helper also called by an unmarked method is not covered", () => {
    expect(
      findUncoveredQuestions(
        "example.ts",
        `class Engine {
          @RuleEvaluation()
          private async applyRules(rule: Rule): Promise<boolean> {
            return this.doesMatch(rule);
          }

          public preview(rule: Rule): boolean {
            return this.doesMatch(rule);
          }

          private doesMatch(rule: Rule): boolean {
            return RulePatternMatchUtil.matches("value", rule.pattern);
          }
        }`,
      ),
    ).toEqual([{ file: "example.ts", method: "Engine.doesMatch", line: 12 }]);
  });

  test("a step run inside PatternWorkScope.run is covered; one outside it is not", () => {
    expect(
      findUncoveredQuestions(
        "example.ts",
        `class Ingest {
          public static async handle(row: Row, context: Context): Promise<void> {
            PatternWorkScope.run(context.patternWork, () => {
              return LogScrubRuleService.scrubLog(row, context.rules);
            });
            LogPipelineService.processLog(row, context.pipelines);
          }
        }`,
      ),
    ).toEqual([{ file: "example.ts", method: "Ingest.handle", line: 6 }]);
  });

  test("a method another class can call, asking with no allowance of its own, is found as one", () => {
    expect(
      findAskersCallableOutside(
        "example.ts",
        `class Engine {
          @RuleEvaluation()
          private async applyRules(rule: Rule): Promise<boolean> {
            return this.doesMatch(rule);
          }

          public doesMatch(rule: Rule): boolean {
            return this.readsPattern(rule);
          }

          private readsPattern(rule: Rule): boolean {
            return RulePatternMatchUtil.matches("value", rule.pattern);
          }

          public preview(rule: Rule): Promise<boolean> {
            return this.applyRules(rule);
          }
        }`,
      ),
    ).toEqual(["doesMatch"]);
  });

  test("a call to such a method from another class needs an allowance there", () => {
    const askers: ReadonlySet<string> = new Set<string>(["doesMatch"]);

    expect(
      findUncoveredQuestions(
        "other.ts",
        `class Report {
          public static async build(rule: Rule): Promise<boolean> {
            return EngineService.doesMatch(rule);
          }

          @RuleEvaluation()
          public static async buildMarked(rule: Rule): Promise<boolean> {
            return EngineService.doesMatch(rule);
          }

          public static async buildScoped(rule: Rule): Promise<boolean> {
            return PatternWorkScope.run(allowance, () => {
              return EngineService.doesMatch(rule);
            });
          }
        }`,
        askers,
      ),
    ).toEqual([{ file: "other.ts", method: "Report.build", line: 3 }]);
  });

  test("a static method calling another through its class is followed", () => {
    expect(
      findUncoveredQuestions(
        "example.ts",
        `class Rules {
          @RuleEvaluation()
          public static async scope(): Promise<boolean> {
            return Rules.check();
          }

          private static check(): boolean {
            return IncidentAlertRuleMatcher.doesIncidentMatch();
          }
        }`,
      ),
    ).toEqual([]);
  });
});

describe("every piece of work that asks a project's patterns has an allowance", () => {
  test("no method asks them outside one", () => {
    expect(repositoryFacts().uncovered).toEqual([]);
  });

  test("the engines and ingest services this was written for are read, and more cannot hide", () => {
    const facts: AllowanceFacts = repositoryFacts();

    // About 70 label, owner, on-call, privacy and runbook engines, and more.
    expect(facts.files.length).toBeGreaterThanOrEqual(85);
    expect(facts.decorated.length).toBeGreaterThanOrEqual(90);

    for (const file of [
      "packages/Common/Server/Services/MonitorLabelRuleEngineService.ts",
      "packages/Common/Server/Services/IncidentPrivacyRuleEngineService.ts",
      "packages/Common/Server/Services/IncidentOnCallRuleEngineService.ts",
      "packages/Common/Server/Services/AlertGroupingEngineService.ts",
      "packages/Common/Server/Services/IncidentSlaRuleService.ts",
      "packages/Common/Server/Services/AutoRemediationRuleEngineService.ts",
      "packages/Common/Server/Services/ServiceLevelObjectiveMonitorRuleEngineService.ts",
      "packages/Common/Server/Services/StatusPageMonitorRuleEngineService.ts",
      "packages/Common/Server/Services/NetworkDeviceAutoImportRuleEngineService.ts",
      "packages/Common/Server/Services/NetworkDeviceService.ts",
      "packages/Common/Server/Utils/AI/SRE/InvestigationRules.ts",
      "packages/Common/Server/Utils/AI/SRE/PostmortemRules.ts",
      "packages/App/FeatureSet/Telemetry/Services/OtelLogsIngestService.ts",
      "packages/App/FeatureSet/Telemetry/Services/OtelTracesIngestService.ts",
      "packages/App/FeatureSet/Telemetry/Services/OtelMetricsIngestService.ts",
      "packages/App/FeatureSet/Telemetry/Services/FluentLogsIngestService.ts",
      "packages/App/FeatureSet/Telemetry/Services/SyslogIngestService.ts",
      "packages/App/FeatureSet/Telemetry/Services/SessionReplayIngestService.ts",
    ]) {
      expect({ file, read: facts.files.includes(file) }).toEqual({
        file,
        read: true,
      });
      expect({ file, marked: facts.decorated.includes(file) }).toEqual({
        file,
        marked: true,
      });
    }

    // A probe's batch carries many projects': each runs inside its own.
    expect(facts.files).toContain(
      "packages/App/FeatureSet/Telemetry/Services/ProbeSyslogIngestService.ts",
    );
  });

  test("the rule helpers other classes could call are known, and none is called outside an allowance", () => {
    const facts: AllowanceFacts = repositoryFacts();

    /*
     * Public helpers of the engines that evaluate one rule: each is covered
     * in its class, and a call from any other class must have an allowance
     * of its own (the test above holds that).
     */
    for (const name of [
      "doesIncidentMatchRule",
      "doesAlertMatchRule",
      "doesScheduledMaintenanceMatchRule",
      "doesMonitorMatchRule",
    ]) {
      expect({ name, known: facts.askersCallableOutside.has(name) }).toEqual({
        name,
        known: true,
      });
    }
  });
});
