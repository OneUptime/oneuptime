import { describe, expect, test } from "@jest/globals";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SecurityEventConnectorProvider from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryCategory,
  DetectionRuleLibraryEntry,
} from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import { MITRE_TECHNIQUES } from "Common/Types/SecurityEvent/MitreAttack";
import SecurityCasePriorityLevel from "Common/Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "Common/Types/SecurityCase/SecurityCaseStage";
import { SecurityPlaybookTemplateValues } from "Common/Types/SecurityPlaybook/SecurityPlaybookTemplates";
import { getSecurityPlaybookTemplateValues } from "Common/Utils/SecurityEvent/SecurityTemplateRecords";
import {
  TEST_PRIORITY_IDS,
  TEST_STATUS_IDS,
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
} from "Common/Tests/Helpers/SecurityCaseValues";
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
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import {
  SecurityPlaybookStepResult,
  SecurityPlaybookTarget,
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookStepResult";
import {
  RunStepRow,
  UNDO_BUTTON_TITLES,
  didStartRun,
  getApprovalTargets,
  getRunStepRows,
} from "../../FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookRunStepRows";
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
  findLibraryEntryProblem,
  getLibraryRuleViews,
  isLibraryRuleAdded,
  matchesLibrarySearch,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/RuleLibraryUtil";
import {
  TurnOnRecommendedAction,
  TurnOnRecommendedPart,
  TurnOnRecommendedProblem,
  TurnOnRecommendedReason,
} from "Common/Types/SecurityEvent/TurnOnRecommended";
import {
  CONNECTION_FIELD_BY_PROVIDER,
  STEP_ACTION_KEY,
  formValuesToStep,
  getConnectionFieldKey,
  getNewStepFormValues,
  getStepConfigKeys,
  isApprovalSwitchOffered,
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

// A new project's priorities and statuses, which the templates' steps name.
const TEMPLATE_VALUES: SecurityPlaybookTemplateValues =
  getSecurityPlaybookTemplateValues({
    priorities: buildDefaultTestPriorities(),
    statuses: buildDefaultTestStatuses(),
  });

// A filled-in dialog for every action, as a person would complete it.
const FILLED: Record<SecurityPlaybookActionType, JSONObject> = {
  [SecurityPlaybookActionType.AssignCase]: { userId: ID_A, teamId: ID_B },
  // The project's own priority and status, by id.
  [SecurityPlaybookActionType.SetCasePriority]: {
    priorityId: TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical],
  },
  [SecurityPlaybookActionType.SetCaseStatus]: {
    statusId: TEST_STATUS_IDS[SecurityCaseStage.Closed],
    verdict: SecurityCaseVerdict.FalsePositive,
  },
  [SecurityPlaybookActionType.AddCaseNote]: { note: "Check {{case.title}}." },
  [SecurityPlaybookActionType.AddCaseLabels]: { labelIds: [ID_A, ID_B] },
  [SecurityPlaybookActionType.CheckThreatIntel]: {
    raisePriorityToId: TEST_PRIORITY_IDS[SecurityCasePriorityLevel.High],
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
  [SecurityPlaybookActionType.UnsuspendOktaUser]: { oktaConnectionId: ID_A },
  [SecurityPlaybookActionType.LiftCrowdStrikeContainment]: {
    crowdStrikeConnectionId: ID_B,
  },
  [SecurityPlaybookActionType.ReleaseDefenderDevice]: {
    defenderConnectionId: ID_C,
  },
  [SecurityPlaybookActionType.SendWebhook]: {
    url: "https://example.com/hooks/security",
  },
  [SecurityPlaybookActionType.RunWorkflow]: { workflowId: ID_B },
  [SecurityPlaybookActionType.RunRunbook]: { runbookId: ID_A },
  [SecurityPlaybookActionType.PreserveEvidence]: {},
  [SecurityPlaybookActionType.PostStatusPageAnnouncement]: {
    statusPageIds: [ID_A, ID_B],
    announcementTitle: "We are investigating a security issue",
    announcementDescription: "Some sign-ins may be slower while we look.",
    notifySubscribers: true,
  },
  [SecurityPlaybookActionType.FixWithAi]: {},
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

  test("an announcement's subscriber switch is kept as on or off, never as text", () => {
    const off: SecurityPlaybookStep = formValuesToStep({
      values: {
        [STEP_ACTION_KEY]:
          SecurityPlaybookActionType.PostStatusPageAnnouncement,
        ...FILLED[SecurityPlaybookActionType.PostStatusPageAnnouncement],
        notifySubscribers: undefined,
      },
      index: 0,
    });

    expect(off.config["notifySubscribers"]).toBe(false);

    const picked: SecurityPlaybookStep = formValuesToStep({
      values: {
        [STEP_ACTION_KEY]:
          SecurityPlaybookActionType.PostStatusPageAnnouncement,
        ...FILLED[SecurityPlaybookActionType.PostStatusPageAnnouncement],
        // A picker hands back options, not ids.
        statusPageIds: [{ value: ID_C }],
      },
      index: 0,
    });

    expect(picked.config["statusPageIds"]).toEqual([ID_C]);
    expect(picked.config["notifySubscribers"]).toBe(true);
  });

  test("a runbook or an announcement with nothing picked says what is missing, as the server would", () => {
    expect(() => {
      formValuesToStep({
        values: { [STEP_ACTION_KEY]: SecurityPlaybookActionType.RunRunbook },
        index: 0,
      });
    }).toThrow("Step 1 (Run a runbook): choose the runbook to run.");

    expect(() => {
      formValuesToStep({
        values: {
          [STEP_ACTION_KEY]:
            SecurityPlaybookActionType.PostStatusPageAnnouncement,
          announcementTitle: "Title",
          announcementDescription: "Text",
        },
        index: 3,
      });
    }).toThrow(
      "Step 4 (Post a status page announcement): choose the status pages to post on.",
    );
  });

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

  test("a disruptive action starts needing approval, and so does one that runs commands or speaks to customers; anything else does not", () => {
    for (const definition of SECURITY_PLAYBOOK_ACTIONS) {
      expect([
        definition.type,
        getNewStepFormValues(definition.type)["requiresApproval"],
      ]).toEqual([
        definition.type,
        definition.isDisruptive || Boolean(definition.needsApprovalByDefault),
      ]);
    }

    expect(
      getNewStepFormValues(SecurityPlaybookActionType.RunRunbook)[
        "requiresApproval"
      ],
    ).toBe(true);
    expect(
      getNewStepFormValues(
        SecurityPlaybookActionType.PostStatusPageAnnouncement,
      ),
    ).toMatchObject({ requiresApproval: true, notifySubscribers: false });
    expect(
      getNewStepFormValues(SecurityPlaybookActionType.PreserveEvidence)[
        "requiresApproval"
      ],
    ).toBe(false);

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

describe("approval and undo in the editor and on a run", () => {
  test("offers the Needs Approval switch on a containment step only to whoever may turn it off", () => {
    for (const action of [
      SecurityPlaybookActionType.SuspendOktaUser,
      SecurityPlaybookActionType.EndOktaSessions,
      SecurityPlaybookActionType.ContainCrowdStrikeHost,
      SecurityPlaybookActionType.IsolateDefenderDevice,
    ]) {
      expect([action, isApprovalSwitchOffered(action, false)]).toEqual([
        action,
        false,
      ]);
      expect(isApprovalSwitchOffered(action, true)).toBe(true);
    }

    // Any other step, an undo included, is anyone's to switch.
    for (const action of [
      SecurityPlaybookActionType.AddCaseNote,
      SecurityPlaybookActionType.UnsuspendOktaUser,
      SecurityPlaybookActionType.ReleaseDefenderDevice,
    ]) {
      expect(isApprovalSwitchOffered(action, false)).toBe(true);
    }
  });

  test("gives each undo action the picker of its own product's connections", () => {
    expect(
      getConnectionFieldKey(SecurityPlaybookActionType.UnsuspendOktaUser),
    ).toBe("oktaConnectionId");
    expect(
      getConnectionFieldKey(
        SecurityPlaybookActionType.LiftCrowdStrikeContainment,
      ),
    ).toBe("crowdStrikeConnectionId");
    expect(
      getConnectionFieldKey(SecurityPlaybookActionType.ReleaseDefenderDevice),
    ).toBe("defenderConnectionId");
    expect(
      getNewStepFormValues(SecurityPlaybookActionType.UnsuspendOktaUser)[
        "requiresApproval"
      ],
    ).toBe(false);
  });

  test("shows a containment step saved with approval off, and stamped by nobody, as needing approval", () => {
    const rows: Array<RunStepRow> = getRunStepRows({
      steps: [
        {
          id: "s1",
          action: SecurityPlaybookActionType.SuspendOktaUser,
          config: { connectionId: ID_A },
          requiresApproval: false,
        },
        {
          id: "s2",
          action: SecurityPlaybookActionType.SuspendOktaUser,
          config: { connectionId: ID_A },
          requiresApproval: false,
          approvalTurnedOff: { at: "2026-10-20T10:00:00.000Z" },
        },
      ] as unknown as JSONArray,
      stepResults: [],
    });

    expect(
      rows.map((row: RunStepRow): boolean => {
        return row.requiresApproval;
      }),
    ).toEqual([true, false]);
    expect(rows[1]!.stepId).toBe("s2");
  });

  test("asks the approver about the waiting step's targets, and shows the protected ones apart", () => {
    const target: (
      value: string,
      state: SecurityPlaybookTargetState,
    ) => SecurityPlaybookTarget = (
      value: string,
      state: SecurityPlaybookTargetState,
    ): SecurityPlaybookTarget => {
      return {
        type: SecurityEntityType.Host,
        value,
        reason: SecurityPlaybookTargetReason.GroupedOn,
        state,
      };
    };
    const results: Array<SecurityPlaybookStepResult> = [
      {
        stepId: "s1",
        action: SecurityPlaybookActionType.ContainCrowdStrikeHost,
        status: "Waiting for Approval" as never,
        targets: [
          target("web-01", SecurityPlaybookTargetState.Proposed),
          target("vpn-gw-01", SecurityPlaybookTargetState.Protected),
        ],
      },
    ];

    const { proposed, protectedTargets } = getApprovalTargets({
      steps: [
        {
          id: "s1",
          action: SecurityPlaybookActionType.ContainCrowdStrikeHost,
          config: { connectionId: ID_B },
        },
      ] as unknown as JSONArray,
      stepResults: results as unknown as JSONArray,
      currentStepIndex: 0,
    });

    expect(
      proposed.map((item: SecurityPlaybookTarget): string => {
        return item.value;
      }),
    ).toEqual(["web-01"]);
    expect(
      protectedTargets.map((item: SecurityPlaybookTarget): string => {
        return item.value;
      }),
    ).toEqual(["vpn-gw-01"]);
  });

  test("knows the person who started a run, who cannot approve it", () => {
    const starter: ObjectID = new ObjectID(ID_A);

    expect(didStartRun(starter, new ObjectID(ID_A))).toBe(true);
    expect(didStartRun(starter, new ObjectID(ID_B))).toBe(false);
    // A run a detection started has no starter: anyone who may approves it.
    expect(didStartRun(undefined, new ObjectID(ID_A))).toBe(false);
  });

  test("names each undo button after what it does", () => {
    expect(
      [
        SecurityPlaybookActionType.UnsuspendOktaUser,
        SecurityPlaybookActionType.LiftCrowdStrikeContainment,
        SecurityPlaybookActionType.ReleaseDefenderDevice,
      ].map((action: SecurityPlaybookActionType): string | undefined => {
        return UNDO_BUTTON_TITLES[action];
      }),
    ).toEqual(["Unsuspend", "Lift Containment", "Release"]);
  });
});

describe("a step's one-line summary", () => {
  const lookup: StepNameLookup = emptyStepNameLookup();
  lookup.connections.set(ID_A, "Okta production");
  lookup.onCallPolicies.set(ID_C, "Security on-call");
  // The project's priorities and statuses, as it names them.
  lookup.casePriorities.set(
    TEST_PRIORITY_IDS[SecurityCasePriorityLevel.High],
    "High",
  );
  lookup.casePriorities.set(
    TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical],
    "Sev 1",
  );
  lookup.caseStatuses.set(
    TEST_STATUS_IDS[SecurityCaseStage.Closed],
    "Resolved",
  );

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
        priorityId: TEST_PRIORITY_IDS[SecurityCasePriorityLevel.High],
      }),
    ).toBe("Priority becomes High");
    // As the project names them.
    expect(
      summary(SecurityPlaybookActionType.CheckThreatIntel, {
        raisePriorityToId:
          TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical],
      }),
    ).toBe("On a match, priority rises to Sev 1");
    expect(
      summary(SecurityPlaybookActionType.SetCaseStatus, {
        statusId: TEST_STATUS_IDS[SecurityCaseStage.Closed],
        verdict: SecurityCaseVerdict.FalsePositive,
      }),
    ).toContain("Resolved");
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
    // A priority or status the project has since deleted.
    expect(
      summary(SecurityPlaybookActionType.SetCasePriority, {
        priorityId: ID_B,
      }),
    ).toBe("Priority becomes a removed priority");
    expect(
      summary(SecurityPlaybookActionType.SetCaseStatus, { statusId: ID_B }),
    ).toContain("a removed status");
  });

  test("names the runbook and the status pages a response step uses, and says when one is gone", () => {
    const named: StepNameLookup = emptyStepNameLookup();
    named.runbooks.set(ID_A, "Block an address at the edge");
    named.statusPages.set(ID_A, "Acme Status");

    const responseSummary: (
      action: SecurityPlaybookActionType,
      config: JSONObject,
    ) => string = (
      action: SecurityPlaybookActionType,
      config: JSONObject,
    ): string => {
      return summarizeSecurityPlaybookStep(
        {
          id: "s",
          action,
          config,
          requiresApproval: true,
          continueOnFailure: false,
          onlyIfThreatIntelMatched: false,
        },
        named,
        ENGLISH,
      );
    };

    expect(
      responseSummary(SecurityPlaybookActionType.RunRunbook, {
        runbookId: ID_A,
      }),
    ).toBe("Block an address at the edge");
    expect(
      responseSummary(SecurityPlaybookActionType.RunRunbook, {
        runbookId: ID_B,
      }),
    ).toBe("a removed runbook");
    expect(
      responseSummary(SecurityPlaybookActionType.PostStatusPageAnnouncement, {
        statusPageIds: [ID_A, ID_B],
        notifySubscribers: false,
      }),
    ).toBe("On Acme Status, a removed status page");
    expect(
      responseSummary(SecurityPlaybookActionType.PostStatusPageAnnouncement, {
        statusPageIds: [ID_A],
        notifySubscribers: true,
      }),
    ).toBe("On Acme Status, notifying subscribers");
    expect(
      responseSummary(SecurityPlaybookActionType.PreserveEvidence, {}),
    ).toBe("Keeps session replays, notes traces and exceptions");
    expect(responseSummary(SecurityPlaybookActionType.FixWithAi, {})).toBe(
      "A pull request for each exception the case's requests threw",
    );
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
    SECURITY_PLAYBOOK_TEMPLATES.map(
      (
        template: SecurityPlaybookTemplate,
      ): [string, SecurityPlaybookTemplate] => {
        return [template.key, template];
      },
    ),
  )(
    "%s is a working playbook as it is",
    (_key: string, template: SecurityPlaybookTemplate) => {
      const steps: Array<SecurityPlaybookStep> =
        template.getSteps(TEMPLATE_VALUES);

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

  test("names the project's own priorities and statuses, by what each means", () => {
    const steps: Array<SecurityPlaybookStep> =
      SECURITY_PLAYBOOK_TEMPLATES.flatMap(
        (template: SecurityPlaybookTemplate): Array<SecurityPlaybookStep> => {
          return template.getSteps(TEMPLATE_VALUES);
        },
      );
    const named: Array<string> = steps.flatMap(
      (step: SecurityPlaybookStep): Array<string> => {
        return ["priorityId", "statusId", "raisePriorityToId"]
          .map((key: string): string => {
            return String(step.config[key] || "");
          })
          .filter(Boolean);
      },
    );

    expect(named.length).toBeGreaterThan(0);

    // Every one is the project's: one of its priorities or statuses.
    for (const id of named) {
      expect([
        id,
        [
          ...Object.values(TEST_PRIORITY_IDS),
          ...Object.values(TEST_STATUS_IDS),
        ].includes(id),
      ]).toEqual([id, true]);
    }
  });

  test("gives every template a new set of step ids", () => {
    const first: Array<string> = SECURITY_PLAYBOOK_TEMPLATES[0]!
      .getSteps(TEMPLATE_VALUES)
      .map((step: SecurityPlaybookStep): string => {
        return step.id;
      });
    const second: Array<string> = SECURITY_PLAYBOOK_TEMPLATES[0]!
      .getSteps(TEMPLATE_VALUES)
      .map((step: SecurityPlaybookStep): string => {
        return step.id;
      });

    expect(first).not.toEqual(second);
  });

  test("a step that waits on threat intel comes after a step that checks it", () => {
    for (const template of SECURITY_PLAYBOOK_TEMPLATES) {
      const steps: Array<SecurityPlaybookStep> =
        template.getSteps(TEMPLATE_VALUES);
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

  test("marks a rule added when the project's rule carries its Sigma id, however the team renamed it", () => {
    // As Turn on recommended knows it on the server, so neither adds it twice.
    expect(
      isLibraryRuleAdded(first, [
        { name: "Our own name for it", sigmaRuleYaml: first.sigmaRuleYaml },
      ]),
    ).toBe(true);
    expect(
      isLibraryRuleAdded(first, [
        { name: "Something else", sigmaRuleYaml: "title: x\nid: another-id" },
      ]),
    ).toBe(false);
    expect(
      getLibraryRuleViews({
        category: "",
        search: first.title,
        existingRules: [
          { name: "Renamed", sigmaRuleYaml: first.sigmaRuleYaml },
        ],
      }).find((view: LibraryRuleView) => {
        return view.entry.id === first.id;
      })?.isAdded,
    ).toBe(true);
  });

  test("filters by category", () => {
    const identity: Array<LibraryRuleView> = getLibraryRuleViews({
      category: DetectionRuleLibraryCategory.Identity,
      search: "",
      existingRules: [],
    });

    expect(identity.length).toBeGreaterThan(0);
    expect(
      identity.every((view: LibraryRuleView) => {
        return view.entry.category === DetectionRuleLibraryCategory.Identity;
      }),
    ).toBe(true);
    expect(
      getLibraryRuleViews({ category: "", search: "", existingRules: [] }),
    ).toHaveLength(DETECTION_RULE_LIBRARY.length);
  });

  test("finds what an Add could not do for a rule, by its title, so its card can say why", () => {
    function problem(
      overrides: Partial<TurnOnRecommendedProblem>,
    ): TurnOnRecommendedProblem {
      return {
        part: TurnOnRecommendedPart.Rule,
        action: TurnOnRecommendedAction.Add,
        name: first.title,
        reason: TurnOnRecommendedReason.Failed,
        detail: "",
        ...overrides,
      };
    }

    const second: DetectionRuleLibraryEntry = DETECTION_RULE_LIBRARY[1]!;
    const own: TurnOnRecommendedProblem = problem({});

    expect(
      findLibraryEntryProblem(first, [problem({ name: second.title }), own]),
    ).toBe(own);
    // Whatever its case or spacing, as the server names it.
    expect(
      findLibraryEntryProblem(first, [
        problem({ name: `  ${first.title.toUpperCase()} ` }),
      ]),
    ).toBeDefined();
    expect(
      findLibraryEntryProblem(first, [problem({ name: second.title })]),
    ).toBeUndefined();
    // Not a rule's, or no name at all: no card to say it on.
    expect(
      findLibraryEntryProblem(first, [
        problem({ part: TurnOnRecommendedPart.Playbook }),
        problem({ part: TurnOnRecommendedPart.Logs }),
        problem({ name: "" }),
      ]),
    ).toBeUndefined();
    expect(findLibraryEntryProblem(first, [])).toBeUndefined();
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
