import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SecurityEventConnectorProvider from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryCategory,
  DetectionRuleLibraryEntry,
} from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import { MITRE_TECHNIQUES } from "Common/Types/SecurityEvent/MitreAttack";
import SecurityCasePriority from "Common/Types/SecurityCase/SecurityCasePriority";
import SecurityCaseStatus from "Common/Types/SecurityCase/SecurityCaseStatus";
import SecurityCaseVerdict from "Common/Types/SecurityCase/SecurityCaseVerdict";
import {
  SECURITY_PLAYBOOK_ACTIONS,
  SecurityPlaybookActionDefinition,
  SecurityPlaybookActionType,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookAction";
import {
  SecurityPlaybookStep,
  parseSecurityPlaybookSteps,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";
import {
  AttackCoverage,
  CoveringRule,
  TacticCoverageSummary,
  buildAttackCoverage,
  countCoveredTechniques,
  readRuleAttackTags,
  summarizeTacticCoverage,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/AttackCoverage";
import {
  LibraryRuleView,
  getLibraryRuleViews,
  isLibraryRuleAdded,
  matchesLibrarySearch,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/RuleLibraryUtil";
import {
  CONNECTION_FIELD_BY_PROVIDER,
  STEP_ACTION_KEY,
  formValuesToStep,
  getConnectionFieldKey,
  getNewStepFormValues,
  getStepConfigKeys,
  moveStep,
  readFormId,
  readFormIdList,
  stepToFormValues,
} from "../../FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookStepForm";
import {
  emptyStepNameLookup,
  StepNameLookup,
  summarizeSecurityPlaybookStep,
} from "../../FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookStepSummary";
import {
  SECURITY_PLAYBOOK_TEMPLATES,
  SecurityPlaybookTemplate,
} from "../../FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookTemplates";

/*
 * The playbook editor's logic, the templates it starts from, and the rule
 * library and ATT&CK coverage pages: each pinned without a browser.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

const ID_A: string = "11111111-1111-4111-8111-111111111111";
const ID_B: string = "22222222-2222-4222-8222-222222222222";
const ID_C: string = "33333333-3333-4333-8333-333333333333";

// A filled-in dialog for every action, as a person would complete it.
const FILLED: Record<SecurityPlaybookActionType, JSONObject> = {
  [SecurityPlaybookActionType.AssignCase]: { userId: ID_A, teamId: ID_B },
  [SecurityPlaybookActionType.SetCasePriority]: {
    priority: SecurityCasePriority.Critical,
  },
  [SecurityPlaybookActionType.SetCaseStatus]: {
    status: SecurityCaseStatus.Closed,
    verdict: SecurityCaseVerdict.FalsePositive,
  },
  [SecurityPlaybookActionType.AddCaseNote]: { note: "Check {{case.title}}." },
  [SecurityPlaybookActionType.AddCaseLabels]: { labelIds: [ID_A, ID_B] },
  [SecurityPlaybookActionType.CheckThreatIntel]: {
    raisePriorityTo: SecurityCasePriority.High,
  },
  [SecurityPlaybookActionType.LookUpEntityActivity]: { lookbackInHours: 48 },
  [SecurityPlaybookActionType.EmailPeople]: {
    userIds: [ID_A],
    teamIds: [ID_B],
    message: "Have a look.",
  },
  [SecurityPlaybookActionType.PostToSlack]: {
    channelName: "security",
    message: "New case {{case.number}}",
  },
  [SecurityPlaybookActionType.PostToMicrosoftTeams]: {
    channelName: "security",
    microsoftTeamsTeamId: "19:abc",
  },
  [SecurityPlaybookActionType.PageOnCall]: { onCallPolicyId: ID_C },
  [SecurityPlaybookActionType.DeclareIncident]: { incidentSeverityId: ID_C },
  [SecurityPlaybookActionType.SuspendOktaUser]: { oktaConnectionId: ID_A },
  [SecurityPlaybookActionType.EndOktaSessions]: { oktaConnectionId: ID_A },
  [SecurityPlaybookActionType.ContainCrowdStrikeHost]: {
    crowdStrikeConnectionId: ID_B,
  },
  [SecurityPlaybookActionType.IsolateDefenderDevice]: {
    defenderConnectionId: ID_C,
    isolationType: "Selective",
  },
  [SecurityPlaybookActionType.SendWebhook]: {
    url: "https://example.com/hooks/security",
  },
  [SecurityPlaybookActionType.RunWorkflow]: { workflowId: ID_B },
};

describe("the step dialog's values", () => {
  test.each(Object.values(SecurityPlaybookActionType))(
    "%s survives the round trip from dialog to step and back",
    (action: SecurityPlaybookActionType) => {
      const values: JSONObject = {
        [STEP_ACTION_KEY]: action,
        requiresApproval: true,
        continueOnFailure: false,
        onlyIfThreatIntelMatched: true,
        ...FILLED[action],
      };

      const step: SecurityPlaybookStep = formValuesToStep({
        values,
        index: 2,
      });

      expect(step.action).toBe(action);
      expect(step.requiresApproval).toBe(true);
      expect(step.onlyIfThreatIntelMatched).toBe(true);
      expect(ObjectID.isValidUUID(step.id)).toBe(true);

      // The step saves: the server reads it with the same rules.
      expect(parseSecurityPlaybookSteps([step])).toHaveLength(1);

      const reopened: JSONObject = stepToFormValues(step);

      for (const key of Object.keys(FILLED[action])) {
        expect([key, reopened[key]]).toEqual([key, FILLED[action][key]]);
      }
    },
  );

  test("keeps the step's id when it is edited", () => {
    const step: SecurityPlaybookStep = formValuesToStep({
      values: {
        [STEP_ACTION_KEY]: SecurityPlaybookActionType.AddCaseNote,
        note: "n",
      },
      stepId: "kept-id",
      index: 0,
    });

    expect(step.id).toBe("kept-id");
  });

  test("names the step and what is missing, as the server would", () => {
    expect(() => {
      formValuesToStep({
        values: { [STEP_ACTION_KEY]: SecurityPlaybookActionType.PostToSlack },
        index: 1,
      });
    }).toThrow("Step 2 (Post to Slack): name the channel to post to.");

    expect(() => {
      formValuesToStep({
        values: {
          [STEP_ACTION_KEY]: SecurityPlaybookActionType.SuspendOktaUser,
        },
        index: 0,
      });
    }).toThrow(/Step 1 \(Suspend the user in Okta\)/);
  });

  test("refuses a dialog with no action picked", () => {
    expect(() => {
      formValuesToStep({ values: {}, index: 0 });
    }).toThrow("Choose what the step does.");
  });

  test("gives each contain action the picker of its own product's connections", () => {
    expect(
      getConnectionFieldKey(SecurityPlaybookActionType.SuspendOktaUser),
    ).toBe(
      CONNECTION_FIELD_BY_PROVIDER[
        SecurityEventConnectorProvider.OktaSystemLog
      ],
    );
    expect(
      getConnectionFieldKey(SecurityPlaybookActionType.ContainCrowdStrikeHost),
    ).toBe("crowdStrikeConnectionId");
    expect(
      getConnectionFieldKey(SecurityPlaybookActionType.IsolateDefenderDevice),
    ).toBe("defenderConnectionId");
    expect(getConnectionFieldKey(SecurityPlaybookActionType.AddCaseNote)).toBe(
      undefined,
    );
  });

  test("covers every action's settings, and no key twice within an action", () => {
    for (const action of Object.values(SecurityPlaybookActionType)) {
      const keys: Array<string> = getStepConfigKeys(action);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  test("a disruptive action starts needing approval, anything else does not", () => {
    for (const definition of SECURITY_PLAYBOOK_ACTIONS) {
      expect([
        definition.type,
        getNewStepFormValues(definition.type)["requiresApproval"],
      ]).toEqual([definition.type, definition.isDisruptive]);
    }

    expect(
      getNewStepFormValues(SecurityPlaybookActionType.LookUpEntityActivity)[
        "lookbackInHours"
      ],
    ).toBe(24);
  });

  test("reads ids from whatever a picker hands back", () => {
    expect(readFormId(ID_A)).toBe(ID_A);
    expect(readFormId(new ObjectID(ID_A))).toBe(ID_A);
    expect(readFormId({ value: ID_B })).toBe(ID_B);
    expect(readFormId({ _id: ID_C })).toBe(ID_C);
    expect(readFormId(undefined)).toBe("");
    expect(readFormId(42)).toBe("");
    expect(readFormIdList([ID_A, { value: ID_B }, ID_A, "", null])).toEqual([
      ID_A,
      ID_B,
    ]);
    expect(readFormIdList(ID_C)).toEqual([ID_C]);
    expect(readFormIdList(undefined)).toEqual([]);
  });

  test("moves a step one place, and leaves the ends alone", () => {
    const steps: Array<SecurityPlaybookStep> = ["a", "b", "c"].map(
      (id: string): SecurityPlaybookStep => {
        return {
          id,
          action: SecurityPlaybookActionType.CheckThreatIntel,
          config: {},
          requiresApproval: false,
          continueOnFailure: false,
          onlyIfThreatIntelMatched: false,
        };
      },
    );

    const ids: (list: Array<SecurityPlaybookStep>) => Array<string> = (
      list: Array<SecurityPlaybookStep>,
    ): Array<string> => {
      return list.map((step: SecurityPlaybookStep): string => {
        return step.id;
      });
    };

    expect(ids(moveStep(steps, 1, -1))).toEqual(["b", "a", "c"]);
    expect(ids(moveStep(steps, 1, 1))).toEqual(["a", "c", "b"]);
    expect(ids(moveStep(steps, 0, -1))).toEqual(["a", "b", "c"]);
    expect(ids(moveStep(steps, 2, 1))).toEqual(["a", "b", "c"]);
    expect(ids(steps)).toEqual(["a", "b", "c"]);
  });
});

describe("a step's one-line summary", () => {
  const lookup: StepNameLookup = emptyStepNameLookup();
  lookup.connections.set(ID_A, "Okta production");
  lookup.onCallPolicies.set(ID_C, "Security on-call");

  function summary(
    action: SecurityPlaybookActionType,
    config: JSONObject,
  ): string {
    return summarizeSecurityPlaybookStep(
      {
        id: "s",
        action,
        config,
        requiresApproval: false,
        continueOnFailure: false,
        onlyIfThreatIntelMatched: false,
      },
      lookup,
      ENGLISH,
    );
  }

  test("names what the step uses", () => {
    expect(
      summary(SecurityPlaybookActionType.SuspendOktaUser, {
        connectionId: ID_A,
      }),
    ).toBe("Through Okta production");
    expect(
      summary(SecurityPlaybookActionType.PageOnCall, { onCallPolicyId: ID_C }),
    ).toBe("Security on-call");
    expect(
      summary(SecurityPlaybookActionType.PostToSlack, { channelName: "soc" }),
    ).toBe("#soc");
    expect(
      summary(SecurityPlaybookActionType.SetCasePriority, {
        priority: SecurityCasePriority.High,
      }),
    ).toBe("Priority becomes High");
    expect(
      summary(SecurityPlaybookActionType.LookUpEntityActivity, {
        lookbackInHours: 1,
      }),
    ).toBe("The last 1 hour of events");
  });

  test("says when what it names is gone", () => {
    expect(
      summary(SecurityPlaybookActionType.ContainCrowdStrikeHost, {
        connectionId: ID_B,
      }),
    ).toBe("Through a removed connection");
    expect(
      summary(SecurityPlaybookActionType.RunWorkflow, { workflowId: ID_B }),
    ).toBe("a removed workflow");
  });

  test("shows only the start of a long note, on one line", () => {
    const text: string = summary(SecurityPlaybookActionType.AddCaseNote, {
      note: `First line\n\nsecond ${"word ".repeat(100)}`,
    });

    expect(text.includes("\n")).toBe(false);
    expect(text.length).toBeLessThanOrEqual(81);
    expect(text.startsWith("First line second")).toBe(true);
  });
});

describe("the playbook templates", () => {
  test.each(
    SECURITY_PLAYBOOK_TEMPLATES.map((template: SecurityPlaybookTemplate) => {
      return [template.key, template];
    }),
  )(
    "%s is a working playbook as it is",
    (_key: string, template: SecurityPlaybookTemplate) => {
      const steps: Array<SecurityPlaybookStep> = template.getSteps();

      expect(steps.length).toBeGreaterThan(0);
      expect(parseSecurityPlaybookSteps(steps)).toHaveLength(steps.length);

      // Nothing of the project's own: no connection, person or channel to fill in.
      for (const step of steps) {
        const definition: SecurityPlaybookActionDefinition | undefined =
          SECURITY_PLAYBOOK_ACTIONS.find(
            (action: SecurityPlaybookActionDefinition): boolean => {
              return action.type === step.action;
            },
          );

        expect(definition?.connectionProvider).toBeUndefined();
        expect(Object.keys(step.config)).not.toContain("connectionId");
        expect(Object.keys(step.config)).not.toContain("userId");
        expect(Object.keys(step.config)).not.toContain("channelName");
      }
    },
  );

  test("gives every template a new set of step ids", () => {
    const first: Array<string> = SECURITY_PLAYBOOK_TEMPLATES[0]!
      .getSteps()
      .map((step: SecurityPlaybookStep): string => {
        return step.id;
      });
    const second: Array<string> = SECURITY_PLAYBOOK_TEMPLATES[0]!
      .getSteps()
      .map((step: SecurityPlaybookStep): string => {
        return step.id;
      });

    expect(first).not.toEqual(second);
  });

  test("a step that waits on threat intel comes after a step that checks it", () => {
    for (const template of SECURITY_PLAYBOOK_TEMPLATES) {
      const steps: Array<SecurityPlaybookStep> = template.getSteps();
      const firstCheck: number = steps.findIndex(
        (step: SecurityPlaybookStep): boolean => {
          return step.action === SecurityPlaybookActionType.CheckThreatIntel;
        },
      );

      steps.forEach((step: SecurityPlaybookStep, index: number) => {
        if (step.onlyIfThreatIntelMatched) {
          expect([template.key, firstCheck >= 0 && firstCheck < index]).toEqual(
            [template.key, true],
          );
        }
      });
    }
  });
});

describe("ATT&CK coverage", () => {
  function rule(
    id: string,
    tags: Array<string>,
    isEnabled: boolean = true,
  ): { id: string; name: string; isEnabled: boolean; sigmaRuleYaml: string } {
    return {
      id,
      name: `Rule ${id}`,
      isEnabled,
      sigmaRuleYaml: `title: Rule ${id}
id: ${id}
level: high
tags:
${tags
  .map((tag: string): string => {
    return `  - ${tag}`;
  })
  .join("\n")}
detection:
  selection:
    className: Authentication
  condition: selection
`,
    };
  }

  test("counts a sub-technique for its parent, and a technique for its tactics", () => {
    const coverage: AttackCoverage = buildAttackCoverage([
      rule("r1", ["attack.t1110.001"]),
    ]);

    expect(
      coverage.rulesByTechnique.get("T1110")?.map((r: CoveringRule) => {
        return r.id;
      }),
    ).toEqual(["r1"]);
    // Brute Force serves Credential Access.
    expect(
      coverage.rulesByTactic.get("TA0006")?.map((r: CoveringRule) => {
        return r.id;
      }),
    ).toEqual(["r1"]);
  });

  test("counts a revoked technique for the one that replaced it", () => {
    const coverage: AttackCoverage = buildAttackCoverage([
      rule("r1", ["attack.t1562.001"]),
    ]);

    expect(coverage.rulesByTechnique.has("T1685")).toBe(true);
    expect(coverage.rulesByTechnique.has("T1562")).toBe(false);
  });

  test("takes tactics by short name, and counts each rule once per cell", () => {
    const coverage: AttackCoverage = buildAttackCoverage([
      rule("r1", [
        "attack.credential_access",
        "attack.t1110",
        "attack.t1110.003",
      ]),
      rule("r2", ["attack.t1110"]),
    ]);

    expect(
      coverage.rulesByTechnique.get("T1110")?.map((r: CoveringRule) => {
        return r.id;
      }),
    ).toEqual(["r1", "r2"]);
    expect(coverage.rulesByTactic.get("TA0006")?.length).toBe(2);
  });

  test("a disabled rule is listed but covers nothing in the counts", () => {
    const coverage: AttackCoverage = buildAttackCoverage([
      rule("r1", ["attack.t1110"], false),
    ]);

    expect(coverage.rulesByTechnique.get("T1110")?.length).toBe(1);
    expect(countCoveredTechniques(coverage)).toBe(0);
  });

  test("a rule whose YAML does not read covers nothing, and is said to", () => {
    const coverage: AttackCoverage = buildAttackCoverage([
      {
        id: "bad",
        name: "Bad",
        isEnabled: true,
        sigmaRuleYaml: "::: not yaml :::",
      },
    ]);

    expect(coverage.unreadableRuleIds).toEqual(["bad"]);
    expect(countCoveredTechniques(coverage)).toBe(0);
    expect(readRuleAttackTags("")).toBeNull();
  });

  test("summarizes each of the matrix's tactics", () => {
    const summary: Array<TacticCoverageSummary> = summarizeTacticCoverage(
      buildAttackCoverage([rule("r1", ["attack.t1110"])]),
    );

    expect(summary).toHaveLength(15);

    const credentialAccess: TacticCoverageSummary = summary.find(
      (item: TacticCoverageSummary) => {
        return item.tactic.id === "TA0006";
      },
    )!;

    expect(credentialAccess.coveredTechniqueCount).toBe(1);
    expect(credentialAccess.techniqueCount).toBeGreaterThan(10);
  });

  test("every library rule reads, and maps to a technique of the matrix", () => {
    for (const entry of DETECTION_RULE_LIBRARY) {
      const tags: ReturnType<typeof readRuleAttackTags> = readRuleAttackTags(
        entry.sigmaRuleYaml,
      );

      expect([entry.title, Boolean(tags)]).toEqual([entry.title, true]);
      expect([entry.title, (tags?.techniques.length || 0) > 0]).toEqual([
        entry.title,
        true,
      ]);
    }

    const library: AttackCoverage = buildAttackCoverage(
      DETECTION_RULE_LIBRARY.map((entry: DetectionRuleLibraryEntry) => {
        return {
          id: entry.id,
          name: entry.title,
          isEnabled: true,
          sigmaRuleYaml: entry.sigmaRuleYaml,
        };
      }),
    );

    expect(countCoveredTechniques(library)).toBeGreaterThan(20);
    expect(countCoveredTechniques(library)).toBeLessThanOrEqual(
      MITRE_TECHNIQUES.length,
    );
  });
});

describe("the rule library page", () => {
  const first: DetectionRuleLibraryEntry = DETECTION_RULE_LIBRARY[0]!;

  test("marks a rule added when the project has one of its name, whatever the case", () => {
    expect(isLibraryRuleAdded(first, [first.title.toUpperCase()])).toBe(true);
    expect(isLibraryRuleAdded(first, [`  ${first.title}  `])).toBe(true);
    expect(isLibraryRuleAdded(first, ["Something else"])).toBe(false);
  });

  test("filters by category", () => {
    const identity: Array<LibraryRuleView> = getLibraryRuleViews({
      category: DetectionRuleLibraryCategory.Identity,
      search: "",
      existingRuleNames: [],
    });

    expect(identity.length).toBeGreaterThan(0);
    expect(
      identity.every((view: LibraryRuleView) => {
        return view.entry.category === DetectionRuleLibraryCategory.Identity;
      }),
    ).toBe(true);
    expect(
      getLibraryRuleViews({ category: "", search: "", existingRuleNames: [] }),
    ).toHaveLength(DETECTION_RULE_LIBRARY.length);
  });

  test("searches every word, in any order and case", () => {
    expect(matchesLibrarySearch(first, "")).toBe(true);
    expect(matchesLibrarySearch(first, "   ")).toBe(true);
    expect(matchesLibrarySearch(first, "IP brute")).toBe(true);
    expect(matchesLibrarySearch(first, "brute kubernetes-only-word")).toBe(
      false,
    );
  });
});
