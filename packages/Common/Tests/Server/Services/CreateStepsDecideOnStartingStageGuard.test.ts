import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, test } from "@jest/globals";

/*
 * Every step an incident, alert or episode create sets off is decided for a
 * record that starts already acknowledged or resolved (Common/Utils/
 * StartingStage): either it runs for every record - its rules, its owners,
 * its feed, its first state - or it is decided by where the record starts.
 *
 * A record created at or past the acknowledged state pages nobody, and one
 * created at or past the resolved state is also not grouped, not remediated,
 * not investigated and gets no workspace channel. The behaviour is pinned
 * per kind in CreatedClosedNoAutomations.test.ts; this guard keeps it from
 * coming undone as steps are added or moved:
 *
 *   - each service's onCreateSuccess reads the stage its onBeforeCreate
 *     handed over (StartingStageUtil.fromCarryForward), and onBeforeCreate
 *     reads it from the state service (getStartingStage), never with an
 *     order comparison of its own;
 *   - every awaited step of onCreateSuccess is listed below as running for
 *     every record, as decided by isOngoing, as handed isOngoing to decide
 *     on itself, or as the on-call fan-out; a step that is in none of the
 *     lists fails here, so a new step has to be decided for a record
 *     created already over;
 *   - a step listed as decided by isOngoing sits under a condition on it,
 *     and a step listed as handed it gets it as an argument;
 *   - grouping may open (or reopen) an episode only for a record that pages
 *     (pagesOnCall): an episode it opens runs its own on-call policies;
 *   - the on-call fan-out takes the stage and checks pagesOnCall before any
 *     OnCallDutyPolicyService.executePolicy call - the only calls of it in
 *     these services - and leaves the line saying nobody was paged to
 *     OnCallNotRunOnCreate, which writes it to the record's own feed;
 *   - an episode is resolved from the moment it exists exactly when it
 *     starts resolved (its resolvedAt follows the stage), and an incident's
 *     first state is told the incident never held its monitors exactly when
 *     it starts resolved.
 *
 * Only real syntax is read, through the TypeScript AST.
 */

const SERVICES_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../Server/Services",
);

interface ServiceSteps {
  file: string;
  // Steps that run for every record, whatever state it starts in, and why.
  always: Record<string, string>;
  // Steps that run only for a record that does not start resolved.
  decidedByOngoing: Array<string>;
  /*
   * Steps that run for every record and are told whether it starts
   * resolved, to decide on it themselves - the AI investigation runner,
   * which records why it did not start in its own order.
   */
  handedIsOngoing: Array<string>;
  // The grouping step, told whether it may open an episode.
  grouping?: string | undefined;
  // The method that runs the on-call policies, deciding on pagesOnCall.
  onCallFanOut: string;
}

const SERVICES: Array<ServiceSteps> = [
  {
    file: "IncidentService.ts",
    always: {
      "this.findOneById": "reads the incident its created feed entry names",
      "IncidentPrivacyRuleEngineService.applyRulesToIncident":
        "who may see the incident",
      "this.createIncidentFeedAsync": "the created feed entry",
      "IncidentAlertService.createDeclaredFromAlertsFeedItem":
        "the alerts it was declared from",
      "IncidentAlertService.copyAlertOwnersToIncident":
        "who may see a private incident",
      "this.handleIncidentStateChangeAsync": "its first state",
      "this.addOwners": "its owners",
      "this.releaseCreatedNotificationHeldForOwners":
        "its owners' created notification",
      "IncidentOwnerRuleEngineService.applyRulesToIncident": "its owners",
      "IncidentLabelRuleEngineService.applyRulesToIncident": "its labels",
      "IncidentOnCallRuleEngineService.applyRulesToIncident":
        "which on-call policies it lists",
      "this.refreshReminderSchedule":
        "reminders, which never come for a resolved incident",
      "this.linkAlertsDeclaredWithIncident": "the alerts it was declared from",
    },
    decidedByOngoing: [
      "this.handleIncidentWorkspaceOperationsAsync",
      "this.handleMonitorStatusChangeAsync",
      "this.disableActiveMonitoringIfManualIncident",
      "RunbookRuleEngineService.applyRulesToIncident",
      "IncidentGroupingEngineService.processIncident",
      "IncidentSlaService.createSlaForIncident",
      "AutoRemediationRuleEngineService.onIncidentCreated",
    ],
    handedIsOngoing: ["AIIncidentInvestigationRunner.investigateNewIncident"],
    grouping: "IncidentGroupingEngineService.processIncident",
    onCallFanOut: "executeOnCallDutyPoliciesAsync",
  },
  {
    file: "AlertService.ts",
    always: {
      "AlertPrivacyRuleEngineService.applyRulesToAlert":
        "who may see the alert",
      "this.createAlertFeedAsync": "the created feed entry",
      "this.handleAlertStateChangeAsync": "its first state",
      "this.addOwners": "its owners",
      "AlertOwnerRuleEngineService.applyRulesToAlert": "its owners",
      "AlertLabelRuleEngineService.applyRulesToAlert": "its labels",
      "AlertOnCallRuleEngineService.applyRulesToAlert":
        "which on-call policies it lists",
      "this.refreshReminderSchedule":
        "reminders, which never come for a resolved alert",
    },
    decidedByOngoing: [
      "this.handleAlertWorkspaceOperationsAsync",
      "RunbookRuleEngineService.applyRulesToAlert",
      "AlertGroupingEngineService.processAlert",
      "AutoRemediationRuleEngineService.onAlertCreated",
    ],
    handedIsOngoing: ["AIAlertInvestigationRunner.investigateNewAlert"],
    grouping: "AlertGroupingEngineService.processAlert",
    onCallFanOut: "executeAlertOnCallDutyPoliciesAsync",
  },
  {
    file: "AlertEpisodeService.ts",
    always: {
      "AlertEpisodePrivacyRuleEngineService.applyRulesToEpisode":
        "who may see the episode",
      "this.changeEpisodeState": "its first state",
      "this.createEpisodeCreatedFeed": "the created feed entry",
      "AlertEpisodeOwnerRuleEngineService.applyRulesToEpisode": "its owners",
      "AlertEpisodeLabelRuleEngineService.applyRulesToEpisode": "its labels",
      "AlertEpisodeOnCallRuleEngineService.applyRulesToEpisode":
        "which on-call policies it lists",
    },
    decidedByOngoing: ["this.handleEpisodeWorkspaceOperationsAsync"],
    handedIsOngoing: [],
    onCallFanOut: "executeEpisodeOnCallDutyPoliciesAsync",
  },
  {
    file: "IncidentEpisodeService.ts",
    always: {
      "IncidentEpisodePrivacyRuleEngineService.applyRulesToEpisode":
        "who may see the episode",
      "this.changeEpisodeState": "its first state",
      "this.createEpisodeCreatedFeed": "the created feed entry",
      "IncidentEpisodeOwnerRuleEngineService.applyRulesToEpisode": "its owners",
      "IncidentEpisodeLabelRuleEngineService.applyRulesToEpisode": "its labels",
      "IncidentEpisodeOnCallRuleEngineService.applyRulesToEpisode":
        "which on-call policies it lists",
    },
    decidedByOngoing: ["this.handleEpisodeWorkspaceOperationsAsync"],
    handedIsOngoing: [],
    onCallFanOut: "executeEpisodeOnCallDutyPoliciesAsync",
  },
];

const ONGOING_CONDITION: RegExp = /\bisOngoing\b/;
const PAGES_ON_CALL_CONDITION: RegExp = /\bStartingStageUtil\.pagesOnCall\(/;
const MAY_OPEN_EPISODE_OPTION: RegExp =
  /\bmayOpenEpisode:\s*StartingStageUtil\.pagesOnCall\(\s*startingStage\s*\)/;

function parse(file: string): ts.SourceFile {
  const fullPath: string = path.join(SERVICES_DIRECTORY, file);
  return ts.createSourceFile(
    fullPath,
    fs.readFileSync(fullPath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function methodOf(
  source: ts.SourceFile,
  name: string,
): ts.MethodDeclaration | undefined {
  let found: ts.MethodDeclaration | undefined = undefined;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      !found &&
      ts.isMethodDeclaration(node) &&
      node.name.getText(source) === name
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
}

function eachNode(node: ts.Node, visit: (child: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child: ts.Node) => {
    eachNode(child, visit);
  });
}

// The callee of every awaited call, as written: "this.addOwners".
function awaitedCalls(
  source: ts.SourceFile,
  root: ts.Node,
): Array<{ callee: string; call: ts.CallExpression }> {
  const calls: Array<{ callee: string; call: ts.CallExpression }> = [];

  eachNode(root, (node: ts.Node) => {
    if (ts.isAwaitExpression(node) && ts.isCallExpression(node.expression)) {
      calls.push({
        callee: node.expression.expression.getText(source),
        call: node.expression,
      });
    }
  });

  return calls;
}

function containsReturn(node: ts.Node): boolean {
  let found: boolean = false;

  eachNode(node, (child: ts.Node) => {
    if (ts.isReturnStatement(child)) {
      found = true;
    }
  });

  return found;
}

/*
 * Whether `node` runs only on a condition that matches `condition`, within
 * `boundary`: inside an if (or a ternary) on it, or after an if on it that
 * returns.
 */
function isDecidedBy(
  source: ts.SourceFile,
  node: ts.Node,
  boundary: ts.Node,
  condition: RegExp,
): boolean {
  let child: ts.Node = node;
  let current: ts.Node | undefined = node.parent;

  while (current && child !== boundary) {
    if (
      ts.isIfStatement(current) &&
      child !== current.expression &&
      condition.test(current.expression.getText(source))
    ) {
      return true;
    }

    if (
      ts.isConditionalExpression(current) &&
      child !== current.condition &&
      condition.test(current.condition.getText(source))
    ) {
      return true;
    }

    if (ts.isBlock(current)) {
      for (const statement of current.statements) {
        if (statement === child) {
          break;
        }

        if (
          ts.isIfStatement(statement) &&
          condition.test(statement.expression.getText(source)) &&
          containsReturn(statement.thenStatement)
        ) {
          return true;
        }
      }
    }

    if (current === boundary) {
      break;
    }

    child = current;
    current = current.parent;
  }

  return false;
}

describe.each(SERVICES)(
  "$file: what a create sets off",
  (service: ServiceSteps) => {
    const source: ts.SourceFile = parse(service.file);
    const onCreateSuccess: ts.MethodDeclaration | undefined = methodOf(
      source,
      "onCreateSuccess",
    );
    const onBeforeCreate: ts.MethodDeclaration | undefined = methodOf(
      source,
      "onBeforeCreate",
    );

    test("onBeforeCreate reads where the record starts from the state service, and hands it on", () => {
      expect(onBeforeCreate).toBeDefined();
      const text: string = onBeforeCreate!.getText(source);

      expect(text).toMatch(/StateService\.getStartingState\(/);
      expect(text).toMatch(/startingStage: startingStage/);
      // No comparison of its own: the rule lives in StartingStage.
      expect(text).not.toMatch(/\.order\b/);
      expect(text).not.toMatch(/isResolvedState|isAcknowledgedState/);
    });

    test("onCreateSuccess reads the stage onBeforeCreate handed over", () => {
      expect(onCreateSuccess).toBeDefined();
      expect(onCreateSuccess!.getText(source)).toMatch(
        /StartingStageUtil\.fromCarryForward\(\s*onCreate\.carryForward,?\s*\)/,
      );
    });

    test("every awaited step is decided for a record created already acknowledged or resolved", () => {
      const known: Set<string> = new Set<string>([
        ...Object.keys(service.always),
        ...service.decidedByOngoing,
        ...service.handedIsOngoing,
        `this.${service.onCallFanOut}`,
      ]);

      const undecided: Array<string> = awaitedCalls(source, onCreateSuccess!)
        .map((step: { callee: string }): string => {
          return step.callee;
        })
        .filter((callee: string): boolean => {
          return !known.has(callee);
        });

      expect(undecided).toEqual([]);
    });

    test("the steps that answer a live problem run only for a record that does not start resolved", () => {
      const steps: Array<{ callee: string; call: ts.CallExpression }> =
        awaitedCalls(source, onCreateSuccess!).filter(
          (step: { callee: string }): boolean => {
            return service.decidedByOngoing.includes(step.callee);
          },
        );

      // Each listed step is still there to decide on.
      expect(
        Array.from(
          new Set(
            steps.map((step: { callee: string }): string => {
              return step.callee;
            }),
          ),
        ).sort(),
      ).toEqual([...service.decidedByOngoing].sort());

      const ungated: Array<string> = steps
        .filter((step: { call: ts.CallExpression }): boolean => {
          return !isDecidedBy(
            source,
            step.call,
            onCreateSuccess!,
            ONGOING_CONDITION,
          );
        })
        .map((step: { callee: string }): string => {
          return step.callee;
        });

      expect(ungated).toEqual([]);
    });

    test("the steps handed whether the record starts resolved get it as an argument", () => {
      const steps: Array<{ callee: string; call: ts.CallExpression }> =
        awaitedCalls(source, onCreateSuccess!).filter(
          (step: { callee: string }): boolean => {
            return service.handedIsOngoing.includes(step.callee);
          },
        );

      expect(
        steps
          .map((step: { callee: string }): string => {
            return step.callee;
          })
          .sort(),
      ).toEqual([...service.handedIsOngoing].sort());

      for (const step of steps) {
        expect(
          step.call.arguments
            .map((argument: ts.Expression): string => {
              return argument.getText(source);
            })
            .join(" "),
        ).toMatch(ONGOING_CONDITION);
      }
    });

    if (service.grouping) {
      test("grouping may open or reopen an episode only for a record that pages", () => {
        const calls: Array<ts.CallExpression> = awaitedCalls(
          source,
          onCreateSuccess!,
        )
          .filter((step: { callee: string }): boolean => {
            return step.callee === service.grouping;
          })
          .map((step: { call: ts.CallExpression }): ts.CallExpression => {
            return step.call;
          });

        expect(calls).toHaveLength(1);
        expect(calls[0]!.arguments).toHaveLength(2);
        expect(calls[0]!.arguments[1]!.getText(source)).toMatch(
          MAY_OPEN_EPISODE_OPTION,
        );
      });
    }

    test("the steps that run for every record are not held back by the stage", () => {
      const held: Array<string> = awaitedCalls(source, onCreateSuccess!)
        .filter((step: { callee: string }): boolean => {
          return Object.prototype.hasOwnProperty.call(
            service.always,
            step.callee,
          );
        })
        .filter((step: { call: ts.CallExpression }): boolean => {
          return isDecidedBy(
            source,
            step.call,
            onCreateSuccess!,
            ONGOING_CONDITION,
          );
        })
        .map((step: { callee: string }): string => {
          return step.callee;
        });

      expect(held).toEqual([]);
    });

    test("the on-call fan-out takes the stage and pages only a record that starts open", () => {
      const fanOut: ts.MethodDeclaration | undefined = methodOf(
        source,
        service.onCallFanOut,
      );

      expect(fanOut).toBeDefined();
      expect(
        fanOut!.parameters.map((parameter: ts.ParameterDeclaration): string => {
          return parameter.name.getText(source);
        }),
      ).toContain("startingStage");

      const executions: Array<ts.CallExpression> = [];

      eachNode(source, (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          node.expression.getText(source) ===
            "OnCallDutyPolicyService.executePolicy"
        ) {
          executions.push(node);
        }
      });

      expect(executions.length).toBeGreaterThan(0);

      for (const execution of executions) {
        // Only inside the fan-out...
        expect(
          fanOut!.getStart(source) <= execution.getStart(source) &&
            execution.getEnd() <= fanOut!.getEnd(),
        ).toBe(true);

        // ...and only once pagesOnCall said so.
        expect(
          isDecidedBy(source, execution, fanOut!, PAGES_ON_CALL_CONDITION),
        ).toBe(true);
      }
    });

    test("the fan-out leaves the line saying nobody was paged to OnCallNotRunOnCreate", () => {
      const fanOut: ts.MethodDeclaration | undefined = methodOf(
        source,
        service.onCallFanOut,
      );

      const lines: Array<ts.CallExpression> = [];

      eachNode(fanOut!, (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          node.expression.getText(source) ===
            "OnCallNotRunOnCreate.createFeedItem"
        ) {
          lines.push(node);
        }
      });

      expect(lines).toHaveLength(1);

      // Only for a record that does not page.
      expect(
        isDecidedBy(source, lines[0]!, fanOut!, PAGES_ON_CALL_CONDITION),
      ).toBe(true);

      // No line of its own, anywhere in the service.
      expect(source.getText()).not.toMatch(
        /OnCallNotRunOnCreate\.getFeedMarkdown\(/,
      );
    });

    test("onCreateSuccess hands the stage to the on-call fan-out", () => {
      const fanOutCalls: Array<ts.CallExpression> = awaitedCalls(
        source,
        onCreateSuccess!,
      )
        .filter((step: { callee: string }): boolean => {
          return step.callee === `this.${service.onCallFanOut}`;
        })
        .map((step: { call: ts.CallExpression }): ts.CallExpression => {
          return step.call;
        });

      expect(fanOutCalls).toHaveLength(1);
      expect(
        fanOutCalls[0]!.arguments.map((argument: ts.Expression): string => {
          return argument.getText(source);
        }),
      ).toContain("startingStage");
    });
  },
);

describe.each(["AlertEpisodeService.ts", "IncidentEpisodeService.ts"])(
  "%s: resolvedAt follows the resolved flag",
  (file: string) => {
    test("onBeforeCreate stamps resolvedAt exactly when the state is flagged resolved, as the first timeline row does, with no lookup of its own", () => {
      const source: ts.SourceFile = parse(file);
      const text: string = methodOf(source, "onBeforeCreate")!.getText(source);

      expect(text).toMatch(
        /if \(pickedStart\?\.flaggedResolved\) \{\s*createBy\.data\.resolvedAt = /,
      );
      expect(text).not.toMatch(/isResolved\w*State\(/);
    });
  },
);

describe("IncidentService.ts: the first state of an incident declared resolved", () => {
  const source: ts.SourceFile = parse("IncidentService.ts");

  test("onCreateSuccess hands the stage to the step that writes the first state", () => {
    const calls: Array<ts.CallExpression> = awaitedCalls(
      source,
      methodOf(source, "onCreateSuccess")!,
    )
      .filter((step: { callee: string }): boolean => {
        return step.callee === "this.handleIncidentStateChangeAsync";
      })
      .map((step: { call: ts.CallExpression }): ts.CallExpression => {
        return step.call;
      });

    expect(calls).toHaveLength(1);
    expect(
      calls[0]!.arguments.map((argument: ts.Expression): string => {
        return argument.getText(source);
      }),
    ).toContain("startingStage");
  });

  test("the first state is told the incident never held its monitors exactly when it does not start ongoing", () => {
    const text: string = methodOf(
      source,
      "handleIncidentStateChangeAsync",
    )!.getText(source);

    expect(text).toMatch(
      /neverHeldItsMonitors: !StartingStageUtil\.isOngoing\(startingStage\)/,
    );
    // Written as OneUptime: the timeline hears it from a root write only.
    expect(text).toMatch(/props: \{\s*isRoot: true,?\s*\}/);
  });
});

describe("IncidentStateTimelineService.ts: which resolve gives the monitors back", () => {
  const timelineSource: ts.SourceFile = ts.createSourceFile(
    "IncidentStateTimelineService.ts",
    fs.readFileSync(
      path.join(SERVICES_DIRECTORY, "IncidentStateTimelineService.ts"),
      "utf8",
    ),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  test("every resolve but the first state of an incident declared resolved, said by a root write - not read off the timeline's rows", () => {
    const onCreateSuccess: ts.MethodDeclaration = methodOf(
      timelineSource,
      "onCreateSuccess",
    )!;

    const giveBacks: Array<ts.CallExpression> = [];

    eachNode(onCreateSuccess, (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(timelineSource) ===
          "IncidentService.markMonitorsActiveForMonitoring"
      ) {
        giveBacks.push(node);
      }
    });

    expect(giveBacks).toHaveLength(1);

    const decidedBy: RegExp = /isFirstStateOfIncidentDeclaredResolved\(/;
    expect(
      isDecidedBy(timelineSource, giveBacks[0]!, onCreateSuccess, decidedBy),
    ).toBe(true);

    const decision: string = methodOf(
      timelineSource,
      "isFirstStateOfIncidentDeclaredResolved",
    )!.getText(timelineSource);

    expect(decision).toMatch(/createBy\.props\.isRoot === true/);
    expect(decision).toMatch(/INCIDENT_NEVER_HELD_ITS_MONITORS_KEY\] === true/);
    expect(decision).not.toMatch(/statusTimeline(Before|After)ThisStatus/);
    expect(decision).not.toMatch(/declaredAt|startsAt/);
  });
});

describe("the guard's own detector", () => {
  const sample: ts.SourceFile = ts.createSourceFile(
    "sample.ts",
    `
    class Sample {
      async onCreateSuccess() {
        Promise.resolve()
          .then(async () => {
            if (!isOngoing) {
              return;
            }
            await Guarded.byEarlyReturn();
          })
          .then(async () => {
            if (a && isOngoing) {
              await Guarded.byIf();
            }
            await NotGuarded.after();
          })
          .then(async () => {
            const x = isOngoing ? await Guarded.byTernary() : null;
            await NotGuarded.plain();
          });
      }
    }
    `,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const method: ts.MethodDeclaration = methodOf(sample, "onCreateSuccess")!;

  test.each([
    ["Guarded.byEarlyReturn", true],
    ["Guarded.byIf", true],
    ["Guarded.byTernary", true],
    ["NotGuarded.after", false],
    ["NotGuarded.plain", false],
  ] as Array<[string, boolean]>)(
    "%s decided by isOngoing: %s",
    (callee: string, expected: boolean) => {
      const step: { callee: string; call: ts.CallExpression } | undefined =
        awaitedCalls(sample, method).find(
          (candidate: { callee: string }): boolean => {
            return candidate.callee === callee;
          },
        );

      expect(step).toBeDefined();
      expect(isDecidedBy(sample, step!.call, method, ONGOING_CONDITION)).toBe(
        expected,
      );
    },
  );
});
