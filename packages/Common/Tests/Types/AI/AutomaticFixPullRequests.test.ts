import {
  AUTOMATIC_FIX_PULL_REQUESTS,
  AUTOMATIC_FIX_SWITCH_COLUMNS,
  AutomaticFixPullRequest,
  AutomaticFixPullRequestBlocker,
  AutomaticFixPullRequestDecision,
  AutomaticFixPullRequestRules,
  AutomaticFixSwitchValues,
  REMEDIATION_RULE_PULL_REQUEST_COLUMNS,
  REMEDIATION_RULE_PULL_REQUEST_DEFAULT,
  REMEDIATION_RULE_PULL_REQUEST_SELECT,
  RemediationRulePullRequestFacts,
  decideAutomaticFixPullRequest,
  describeAutomaticFixPullRequestBlocker,
  doesRuleOpenPullRequest,
  getAutomaticFixSignal,
  getAutomaticFixSwitchSelect,
} from "../../../Types/AI/AutomaticFixPullRequests";
import {
  EVERY_CODE_REPOSITORY,
  NO_CODE_REPOSITORY,
} from "../../../Types/CodeRepository/CodeRepositoryAllowance";
import AutoRemediationTriggerEntity, {
  IncidentOrAlertTriggerEntity,
} from "../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import Project from "../../../Models/DatabaseModels/Project";
import TableColumnType from "../../../Types/Database/TableColumnType";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * The one rule behind the pull requests OneUptime AI opens on its own after
 * an investigation (Types/AI/AutomaticFixPullRequests): "Fix new incidents
 * automatically" (or alerts) must be on, and then the project's auto
 * remediation rules decide - with none, both pull requests open, in any
 * connected repository; with some, only for an incident a rule with that
 * pull request's switch on matches, in the repositories those rules name.
 * The maintainer: "Both of these toggles should be inside of Remediation
 * Rule, inside of More, and they should be checked by default ... If there
 * are no rules, by the way, this should happen by default."
 */

const SIGNALS: Array<IncidentOrAlertTriggerEntity> = [
  AutoRemediationTriggerEntity.Incident,
  AutoRemediationTriggerEntity.Alert,
];

const PULL_REQUESTS: Array<AutomaticFixPullRequest> = [
  AutomaticFixPullRequest.CodeFix,
  AutomaticFixPullRequest.MissingTelemetry,
];

// The values a project row or a rule row can hold for a switch, as read.
const VALUES: Array<boolean | null | undefined> = [
  true,
  false,
  null,
  undefined,
];

const API: string = "c1111111-1111-4111-8111-111111111111";
const WEB: string = "c2222222-2222-4222-8222-222222222222";

function fixingOn(
  signal: IncidentOrAlertTriggerEntity,
): AutomaticFixSwitchValues {
  return { [AUTOMATIC_FIX_SWITCH_COLUMNS[signal]]: true };
}

function rule(
  facts: Partial<RemediationRulePullRequestFacts>,
): RemediationRulePullRequestFacts {
  return {
    openCodeFixPullRequests: true,
    openTelemetryPullRequests: true,
    ...facts,
  };
}

function decide(data: {
  signal?: IncidentOrAlertTriggerEntity;
  pullRequest?: AutomaticFixPullRequest;
  project?: AutomaticFixSwitchValues;
  rules: AutomaticFixPullRequestRules | null;
}): AutomaticFixPullRequestDecision {
  const signal: IncidentOrAlertTriggerEntity =
    data.signal || AutoRemediationTriggerEntity.Incident;

  return decideAutomaticFixPullRequest({
    signal,
    pullRequest: data.pullRequest || AutomaticFixPullRequest.CodeFix,
    project: data.project || fixingOn(signal),
    rules: data.rules,
  });
}

describe("the columns", () => {
  test("each signal's fixing switch is its Project column, and the two share none", () => {
    expect(AUTOMATIC_FIX_SWITCH_COLUMNS).toEqual({
      [AutoRemediationTriggerEntity.Incident]:
        "enableAutomaticIncidentRemediation",
      [AutoRemediationTriggerEntity.Alert]: "enableAutomaticAlertRemediation",
    });
  });

  test("each fixing switch is a real boolean Project column that starts off", () => {
    const project: Project = new Project();

    for (const signal of SIGNALS) {
      const column: string = AUTOMATIC_FIX_SWITCH_COLUMNS[signal];
      const metadata: ReturnType<Project["getTableColumnMetadata"]> =
        project.getTableColumnMetadata(column);

      expect([column, metadata?.type, metadata?.defaultValue]).toEqual([
        column,
        TableColumnType.Boolean,
        false,
      ]);
    }
  });

  test("the project no longer holds a pull request switch of its own", () => {
    const columns: Array<string> = new Project().getTableColumns().columns;

    for (const retired of [
      "enableAutomaticIncidentCodeFixes",
      "enableIncidentInstrumentationFixTasks",
      "enableAutomaticAlertCodeFixes",
      "enableAlertInstrumentationFixTasks",
    ]) {
      expect(columns).not.toContain(retired);
    }
  });

  test("the pull requests come code fix first, then missing telemetry, each a rule column", () => {
    expect(AUTOMATIC_FIX_PULL_REQUESTS).toEqual([
      AutomaticFixPullRequest.CodeFix,
      AutomaticFixPullRequest.MissingTelemetry,
    ]);
    expect(REMEDIATION_RULE_PULL_REQUEST_COLUMNS).toEqual({
      [AutomaticFixPullRequest.CodeFix]: "openCodeFixPullRequests",
      [AutomaticFixPullRequest.MissingTelemetry]: "openTelemetryPullRequests",
    });
  });

  test("each rule switch is a required boolean AutoRemediationRule column that starts on", () => {
    const model: AutoRemediationRule = new AutoRemediationRule();

    expect(REMEDIATION_RULE_PULL_REQUEST_DEFAULT).toBe(true);

    for (const pullRequest of PULL_REQUESTS) {
      const column: string = REMEDIATION_RULE_PULL_REQUEST_COLUMNS[pullRequest];
      const metadata: ReturnType<
        AutoRemediationRule["getTableColumnMetadata"]
      > = model.getTableColumnMetadata(column);

      expect([
        column,
        metadata?.type,
        metadata?.required,
        metadata?.defaultValue,
        metadata?.isDefaultValueColumn,
      ]).toEqual([column, TableColumnType.Boolean, true, true, true]);
    }
  });

  test("a rule names its repositories as a list of Code Repositories", () => {
    const metadata: ReturnType<AutoRemediationRule["getTableColumnMetadata"]> =
      new AutoRemediationRule().getTableColumnMetadata("codeRepositories");

    expect(metadata?.type).toBe(TableColumnType.EntityArray);
    expect(metadata?.title).toBe("Code Repositories");
  });

  test("the rule read selects the two switches and the repositories", () => {
    expect(REMEDIATION_RULE_PULL_REQUEST_SELECT).toEqual({
      openCodeFixPullRequests: true,
      openTelemetryPullRequests: true,
      codeRepositories: { _id: true },
      llmProviderId: true,
    });
  });
});

describe("getAutomaticFixSignal", () => {
  const incidentId: ObjectID = ObjectID.generate();
  const alertId: ObjectID = ObjectID.generate();

  test("an incident or an alert, from the subject the investigation was about", () => {
    expect(getAutomaticFixSignal({ incidentId })).toBe(
      AutoRemediationTriggerEntity.Incident,
    );
    expect(getAutomaticFixSignal({ alertId })).toBe(
      AutoRemediationTriggerEntity.Alert,
    );
  });

  test("no subject, or both, is no signal", () => {
    expect(getAutomaticFixSignal({})).toBeNull();
    expect(getAutomaticFixSignal({ incidentId, alertId })).toBeNull();
    expect(
      getAutomaticFixSignal({ incidentId: undefined, alertId: null }),
    ).toBeNull();
  });
});

describe("doesRuleOpenPullRequest", () => {
  test("only a switch that is on opens: a value not read, or a legacy null, does not", () => {
    for (const pullRequest of PULL_REQUESTS) {
      for (const value of VALUES) {
        const facts: RemediationRulePullRequestFacts = {
          [REMEDIATION_RULE_PULL_REQUEST_COLUMNS[pullRequest]]: value,
        };

        expect([
          pullRequest,
          value,
          doesRuleOpenPullRequest(facts, pullRequest),
        ]).toEqual([pullRequest, value, value === true]);
      }
    }
  });

  test("each kind reads its own switch only", () => {
    const codeOnly: RemediationRulePullRequestFacts = {
      openCodeFixPullRequests: true,
      openTelemetryPullRequests: false,
    };

    expect(
      doesRuleOpenPullRequest(codeOnly, AutomaticFixPullRequest.CodeFix),
    ).toBe(true);
    expect(
      doesRuleOpenPullRequest(
        codeOnly,
        AutomaticFixPullRequest.MissingTelemetry,
      ),
    ).toBe(false);
  });
});

describe("decideAutomaticFixPullRequest: fixing first", () => {
  for (const signal of SIGNALS) {
    for (const pullRequest of PULL_REQUESTS) {
      for (const fix of VALUES) {
        test(`${signal} ${pullRequest}: fixing ${String(fix)} -> ${fix === true ? "opens with no rule" : "FixOff"}`, () => {
          const decision: AutomaticFixPullRequestDecision =
            decideAutomaticFixPullRequest({
              signal,
              pullRequest,
              project: { [AUTOMATIC_FIX_SWITCH_COLUMNS[signal]]: fix },
              rules: { rulesSetUp: false, matchingRules: [] },
            });

          expect(decision).toEqual(
            fix === true
              ? {
                  blocker: null,
                  repositories: EVERY_CODE_REPOSITORY,
                  llmProviderId: "",
                }
              : {
                  blocker: AutomaticFixPullRequestBlocker.FixOff,
                  repositories: NO_CODE_REPOSITORY,
                  llmProviderId: "",
                },
          );
        });
      }
    }
  }

  test("with fixing off, nothing about the rules can open one", () => {
    for (const rules of [
      null,
      { rulesSetUp: false, matchingRules: [] },
      { rulesSetUp: true, matchingRules: [rule({})] },
    ]) {
      expect(
        decide({
          project: { enableAutomaticIncidentRemediation: false },
          rules,
        }).blocker,
      ).toBe(AutomaticFixPullRequestBlocker.FixOff);
    }
  });

  test("the other signal's fixing switch opens nothing for this one", () => {
    expect(
      decide({
        signal: AutoRemediationTriggerEntity.Alert,
        project: { enableAutomaticIncidentRemediation: true },
        rules: { rulesSetUp: false, matchingRules: [] },
      }).blocker,
    ).toBe(AutomaticFixPullRequestBlocker.FixOff);
    expect(
      decide({
        signal: AutoRemediationTriggerEntity.Incident,
        project: { enableAutomaticAlertRemediation: true },
        rules: { rulesSetUp: false, matchingRules: [] },
      }).blocker,
    ).toBe(AutomaticFixPullRequestBlocker.FixOff);
  });

  test("a Project row decides the same way as a plain object", () => {
    const project: Project = new Project();
    project.enableAutomaticAlertRemediation = true;

    expect(
      decide({
        signal: AutoRemediationTriggerEntity.Alert,
        project,
        rules: { rulesSetUp: false, matchingRules: [] },
      }).blocker,
    ).toBeNull();

    project.enableAutomaticAlertRemediation = false;

    expect(
      decide({
        signal: AutoRemediationTriggerEntity.Alert,
        project,
        rules: { rulesSetUp: false, matchingRules: [] },
      }).blocker,
    ).toBe(AutomaticFixPullRequestBlocker.FixOff);
  });
});

describe("decideAutomaticFixPullRequest: the rules", () => {
  test("no rule set up: both pull requests open, in every connected repository", () => {
    for (const pullRequest of PULL_REQUESTS) {
      expect(
        decide({
          pullRequest,
          rules: { rulesSetUp: false, matchingRules: [] },
        }),
      ).toEqual({
        blocker: null,
        repositories: EVERY_CODE_REPOSITORY,
        llmProviderId: "",
      });
    }
  });

  test("rules that cannot be read open nothing: a fix the rules might keep out is not made", () => {
    for (const pullRequest of PULL_REQUESTS) {
      expect(decide({ pullRequest, rules: null })).toEqual({
        blocker: AutomaticFixPullRequestBlocker.RulesUnreadable,
        repositories: NO_CODE_REPOSITORY,
        llmProviderId: "",
      });
    }
  });

  test("rules set up that do not match the incident: it is not fixed, so nothing opens", () => {
    expect(decide({ rules: { rulesSetUp: true, matchingRules: [] } })).toEqual({
      blocker: AutomaticFixPullRequestBlocker.NoMatchingRule,
      repositories: NO_CODE_REPOSITORY,
      llmProviderId: "",
    });
  });

  test("a matching rule with the switch on (its default) opens it", () => {
    expect(
      decide({ rules: { rulesSetUp: true, matchingRules: [rule({})] } }),
    ).toEqual({
      blocker: null,
      repositories: EVERY_CODE_REPOSITORY,
      llmProviderId: "",
    });
  });

  test("matching rules that all have it off open nothing, the other kind still opens", () => {
    const rules: AutomaticFixPullRequestRules = {
      rulesSetUp: true,
      matchingRules: [
        rule({ openCodeFixPullRequests: false }),
        rule({ openCodeFixPullRequests: false }),
      ],
    };

    expect(
      decide({ pullRequest: AutomaticFixPullRequest.CodeFix, rules }).blocker,
    ).toBe(AutomaticFixPullRequestBlocker.PullRequestOff);
    expect(
      decide({ pullRequest: AutomaticFixPullRequest.MissingTelemetry, rules })
        .blocker,
    ).toBeNull();
  });

  test("of several matching rules, one with the switch on is enough", () => {
    expect(
      decide({
        rules: {
          rulesSetUp: true,
          matchingRules: [
            rule({ openCodeFixPullRequests: false }),
            rule({ openCodeFixPullRequests: true }),
          ],
        },
      }).blocker,
    ).toBeNull();
  });

  test("a switch the read did not hold is not on", () => {
    expect(
      decide({
        rules: {
          rulesSetUp: true,
          matchingRules: [{ codeRepositories: [] }],
        },
      }).blocker,
    ).toBe(AutomaticFixPullRequestBlocker.PullRequestOff);
  });
});

describe("decideAutomaticFixPullRequest: the repositories", () => {
  test("a matching rule that names repositories opens in those only", () => {
    expect(
      decide({
        rules: {
          rulesSetUp: true,
          matchingRules: [rule({ codeRepositories: [{ _id: API }] })],
        },
      }),
    ).toEqual({
      blocker: null,
      repositories: { isEveryRepository: false, repositoryIds: [API] },
      llmProviderId: "",
    });
  });

  test("the repositories of every matching rule with the switch on, together", () => {
    expect(
      decide({
        rules: {
          rulesSetUp: true,
          matchingRules: [
            rule({ codeRepositories: [{ _id: API }] }),
            rule({ codeRepositories: [{ _id: WEB }] }),
          ],
        },
      }).repositories,
    ).toEqual({ isEveryRepository: false, repositoryIds: [API, WEB] });
  });

  test("a rule with the switch off adds no repository of its own", () => {
    expect(
      decide({
        rules: {
          rulesSetUp: true,
          matchingRules: [
            rule({ codeRepositories: [{ _id: API }] }),
            rule({
              openCodeFixPullRequests: false,
              codeRepositories: [{ _id: WEB }],
            }),
          ],
        },
      }).repositories,
    ).toEqual({ isEveryRepository: false, repositoryIds: [API] });
  });

  test("a matching rule with the switch on that names none opens in every repository", () => {
    expect(
      decide({
        rules: {
          rulesSetUp: true,
          matchingRules: [
            rule({ codeRepositories: [{ _id: API }] }),
            rule({ codeRepositories: [] }),
          ],
        },
      }).repositories,
    ).toEqual(EVERY_CODE_REPOSITORY);
  });
});

describe("getAutomaticFixSwitchSelect", () => {
  test("a server read selects the signal's fixing switch, and nothing else", () => {
    expect(
      getAutomaticFixSwitchSelect(AutoRemediationTriggerEntity.Incident),
    ).toEqual({ enableAutomaticIncidentRemediation: true });
    expect(
      getAutomaticFixSwitchSelect(AutoRemediationTriggerEntity.Alert),
    ).toEqual({ enableAutomaticAlertRemediation: true });
  });

  test("what it selects is exactly what the decision reads", () => {
    for (const signal of SIGNALS) {
      const project: AutomaticFixSwitchValues = {};

      for (const column of Object.keys(getAutomaticFixSwitchSelect(signal))) {
        (project as Record<string, boolean>)[column] = true;
      }

      expect(
        decideAutomaticFixPullRequest({
          signal,
          pullRequest: AutomaticFixPullRequest.CodeFix,
          project,
          rules: { rulesSetUp: false, matchingRules: [] },
        }).blocker,
      ).toBeNull();
    }
  });
});

describe("describeAutomaticFixPullRequestBlocker", () => {
  test("says, for each blocker, why nothing opened, naming the signal and the pull request", () => {
    expect(
      describeAutomaticFixPullRequestBlocker({
        blocker: AutomaticFixPullRequestBlocker.FixOff,
        signal: AutoRemediationTriggerEntity.Incident,
        pullRequest: AutomaticFixPullRequest.CodeFix,
      }),
    ).toBe(
      "project has fixing new incidents automatically off, and its fix pull requests open only while it is on",
    );
    expect(
      describeAutomaticFixPullRequestBlocker({
        blocker: AutomaticFixPullRequestBlocker.RulesUnreadable,
        signal: AutoRemediationTriggerEntity.Alert,
        pullRequest: AutomaticFixPullRequest.MissingTelemetry,
      }),
    ).toBe(
      "the AI rules could not be read, so no telemetry pull requests open",
    );
    expect(
      describeAutomaticFixPullRequestBlocker({
        blocker: AutomaticFixPullRequestBlocker.NoMatchingRule,
        signal: AutoRemediationTriggerEntity.Alert,
        pullRequest: AutomaticFixPullRequest.CodeFix,
      }),
    ).toBe("no AI rule that fixes matches this alert, so it is not fixed");
    expect(
      describeAutomaticFixPullRequestBlocker({
        blocker: AutomaticFixPullRequestBlocker.PullRequestOff,
        signal: AutoRemediationTriggerEntity.Incident,
        pullRequest: AutomaticFixPullRequest.MissingTelemetry,
      }),
    ).toBe(
      "the AI rules that match this incident have telemetry pull requests off",
    );
  });
});

/*
 * The LLM provider OneUptime AI writes the pull request with
 * (Types/AI/LlmProviderChoice): the pick of the first rule that opens it, by
 * name, that picks one - a rule that picks none, or one whose switch for
 * this pull request is off, decides nothing - else "" (the project's
 * default provider, else the global one).
 */
describe("decideAutomaticFixPullRequest: the LLM provider", () => {
  const OPUS: string = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
  const AZURE: string = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";

  const named: (
    name: string,
    facts: Partial<RemediationRulePullRequestFacts>,
  ) => RemediationRulePullRequestFacts = (
    name: string,
    facts: Partial<RemediationRulePullRequestFacts>,
  ): RemediationRulePullRequestFacts => {
    return rule({ name, _id: ObjectID.generate().toString(), ...facts });
  };

  test("no rule set up: no pick - the project's default provider", () => {
    expect(
      decide({ rules: { rulesSetUp: false, matchingRules: [] } }).llmProviderId,
    ).toBe("");
  });

  test("a matching rule that picks a provider writes the pull request with it", () => {
    expect(
      decide({
        rules: {
          rulesSetUp: true,
          matchingRules: [named("Checkout", { llmProviderId: OPUS })],
        },
      }).llmProviderId,
    ).toBe(OPUS);
  });

  test("of several opening rules, the first by name that picks one decides", () => {
    expect(
      decide({
        rules: {
          rulesSetUp: true,
          matchingRules: [
            named("Zeta", { llmProviderId: AZURE }),
            named("alpha", { llmProviderId: OPUS }),
            named("Beta", {}),
          ],
        },
      }).llmProviderId,
    ).toBe(OPUS);
  });

  test("a rule that picks none never hides the pick of another that opens it", () => {
    expect(
      decide({
        rules: {
          rulesSetUp: true,
          matchingRules: [
            named("A catch-all", {}),
            named("Critical", { llmProviderId: AZURE }),
          ],
        },
      }).llmProviderId,
    ).toBe(AZURE);
  });

  test("a rule whose switch for this pull request is off picks nothing for it", () => {
    const rules: AutomaticFixPullRequestRules = {
      rulesSetUp: true,
      matchingRules: [
        named("A", { llmProviderId: OPUS, openCodeFixPullRequests: false }),
        named("B", { llmProviderId: AZURE }),
      ],
    };

    expect(
      decide({ pullRequest: AutomaticFixPullRequest.CodeFix, rules })
        .llmProviderId,
    ).toBe(AZURE);
    expect(
      decide({ pullRequest: AutomaticFixPullRequest.MissingTelemetry, rules })
        .llmProviderId,
    ).toBe(OPUS);
  });

  test("a blocked pull request picks no provider", () => {
    expect(
      decide({
        project: { enableAutomaticIncidentRemediation: false },
        rules: {
          rulesSetUp: true,
          matchingRules: [named("A", { llmProviderId: OPUS })],
        },
      }),
    ).toEqual({
      blocker: AutomaticFixPullRequestBlocker.FixOff,
      repositories: NO_CODE_REPOSITORY,
      llmProviderId: "",
    });
    expect(
      decide({
        rules: {
          rulesSetUp: true,
          matchingRules: [
            named("A", {
              llmProviderId: OPUS,
              openCodeFixPullRequests: false,
            }),
          ],
        },
      }).llmProviderId,
    ).toBe("");
  });

  test("an AutoRemediationRule row's pick reads the same as a plain object", () => {
    const row: AutoRemediationRule = new AutoRemediationRule();
    row._id = ObjectID.generate().toString();
    row.name = "Checkout";
    row.openCodeFixPullRequests = true;
    row.openTelemetryPullRequests = true;
    row.llmProviderId = new ObjectID(OPUS);

    expect(
      decide({ rules: { rulesSetUp: true, matchingRules: [row] } })
        .llmProviderId,
    ).toBe(OPUS);
  });
});
