import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import SecurityCasePriorityLevel from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import {
  TEST_PRIORITY_IDS,
  TEST_STATUS_IDS,
} from "../../Helpers/SecurityCaseValues";
import SecurityCaseVerdict from "../../../Types/SecurityCase/SecurityCaseVerdict";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  SECURITY_PLAYBOOK_ACTIONS,
  SECURITY_PLAYBOOK_ACTION_CATEGORIES,
  SecurityPlaybookActionCategory,
  SecurityPlaybookActionDefinition,
  SecurityPlaybookActionType,
  actsOnSecurityEntities,
  getSecurityPlaybookAction,
  getSecurityPlaybookUndoAction,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import {
  DefenderIsolationType,
  SECURITY_PLAYBOOK_MAX_STEPS,
  SecurityPlaybookStep,
  doesStepNeedApproval,
  parseSecurityPlaybookSteps,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import { describe, expect, test } from "@jest/globals";

const USER_ID: string = ObjectID.generate().toString();
const TEAM_ID: string = ObjectID.generate().toString();
const OTHER_ID: string = ObjectID.generate().toString();

function step(
  action: SecurityPlaybookActionType,
  config: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { id: ObjectID.generate().toString(), action, config, ...extra };
}

function parseOne(
  action: SecurityPlaybookActionType,
  config: Record<string, unknown>,
): SecurityPlaybookStep {
  return parseSecurityPlaybookSteps([step(action, config)])[0]!;
}

function expectRejected(
  action: SecurityPlaybookActionType,
  config: Record<string, unknown>,
  message: RegExp,
): void {
  expect(() => {
    return parseSecurityPlaybookSteps([step(action, config)]);
  }).toThrow(message);
}

describe("SECURITY_PLAYBOOK_ACTIONS", () => {
  test("describes every action exactly once, in a known category", () => {
    const types: Array<string> = SECURITY_PLAYBOOK_ACTIONS.map(
      (action: SecurityPlaybookActionDefinition) => {
        return action.type;
      },
    );

    expect(new Set(types).size).toBe(types.length);
    expect(types.sort()).toEqual(
      Object.values(SecurityPlaybookActionType).sort(),
    );

    for (const action of SECURITY_PLAYBOOK_ACTIONS) {
      expect(SECURITY_PLAYBOOK_ACTION_CATEGORIES).toContain(action.category);
      expect(action.title.length).toBeGreaterThan(3);
      expect(action.description.length).toBeGreaterThan(20);
    }
  });

  test("only the actions that cut someone off are disruptive; every action on a connected product names its product and entity", () => {
    for (const action of SECURITY_PLAYBOOK_ACTIONS) {
      expect(action.isDisruptive).toBe(
        Boolean(action.connectionProvider) && !action.undoes,
      );
      expect(Boolean(action.entityType)).toBe(
        Boolean(action.connectionProvider),
      );
      expect(actsOnSecurityEntities(action)).toBe(
        Boolean(action.connectionProvider),
      );
    }

    expect(
      getSecurityPlaybookAction(SecurityPlaybookActionType.SuspendOktaUser),
    ).toMatchObject({
      connectionProvider: SecurityEventConnectorProvider.OktaSystemLog,
      entityType: SecurityEntityType.User,
    });
    expect(
      getSecurityPlaybookAction(
        SecurityPlaybookActionType.ContainCrowdStrikeHost,
      ),
    ).toMatchObject({
      connectionProvider: SecurityEventConnectorProvider.CrowdStrikeFalcon,
      entityType: SecurityEntityType.Host,
    });
  });
});

describe("the undo actions", () => {
  test("each undoes a containment action through the same product, on the same kind of entity", () => {
    const undos: Array<SecurityPlaybookActionDefinition> =
      SECURITY_PLAYBOOK_ACTIONS.filter(
        (action: SecurityPlaybookActionDefinition): boolean => {
          return Boolean(action.undoes);
        },
      );

    expect(
      undos.map((action: SecurityPlaybookActionDefinition): Array<string> => {
        return [action.type, action.undoes!];
      }),
    ).toEqual([
      [
        SecurityPlaybookActionType.UnsuspendOktaUser,
        SecurityPlaybookActionType.SuspendOktaUser,
      ],
      [
        SecurityPlaybookActionType.LiftCrowdStrikeContainment,
        SecurityPlaybookActionType.ContainCrowdStrikeHost,
      ],
      [
        SecurityPlaybookActionType.ReleaseDefenderDevice,
        SecurityPlaybookActionType.IsolateDefenderDevice,
      ],
    ]);

    for (const undo of undos) {
      const contained: SecurityPlaybookActionDefinition =
        getSecurityPlaybookAction(undo.undoes)!;

      expect(undo.category).toBe(SecurityPlaybookActionCategory.Contain);
      expect(contained.isDisruptive).toBe(true);
      expect(undo.connectionProvider).toBe(contained.connectionProvider);
      expect(undo.entityType).toBe(contained.entityType);
      expect(getSecurityPlaybookUndoAction(contained.type)).toBe(undo);
    }

    // A session that was ended stays ended.
    expect(
      getSecurityPlaybookUndoAction(SecurityPlaybookActionType.EndOktaSessions),
    ).toBeUndefined();
  });

  test("act through a connection, like the steps they undo", () => {
    for (const action of [
      SecurityPlaybookActionType.UnsuspendOktaUser,
      SecurityPlaybookActionType.LiftCrowdStrikeContainment,
      SecurityPlaybookActionType.ReleaseDefenderDevice,
    ]) {
      expect(parseOne(action, { connectionId: OTHER_ID }).config).toEqual({
        connectionId: OTHER_ID,
      });
      expectRejected(action, {}, /connection to act through/);
    }
  });
});

describe("approval of a containment step", () => {
  test("is on unless the step says false outright", () => {
    const [absent, notTrue, off]: Array<SecurityPlaybookStep> =
      parseSecurityPlaybookSteps([
        step(SecurityPlaybookActionType.SuspendOktaUser, {
          connectionId: OTHER_ID,
        }),
        step(
          SecurityPlaybookActionType.ContainCrowdStrikeHost,
          { connectionId: OTHER_ID },
          { requiresApproval: "no" },
        ),
        step(
          SecurityPlaybookActionType.IsolateDefenderDevice,
          { connectionId: OTHER_ID },
          { requiresApproval: false },
        ),
      ]);

    expect(absent!.requiresApproval).toBe(true);
    expect(notTrue!.requiresApproval).toBe(true);
    expect(off!.requiresApproval).toBe(false);
  });

  test("is still needed when nobody stamped it off: a step saved off before the rule waits too", () => {
    const [off]: Array<SecurityPlaybookStep> = parseSecurityPlaybookSteps([
      step(
        SecurityPlaybookActionType.SuspendOktaUser,
        { connectionId: OTHER_ID },
        { requiresApproval: false },
      ),
    ]);

    expect(off!.approvalTurnedOff).toBeUndefined();
    expect(doesStepNeedApproval(off!)).toBe(true);
  });

  test("is not needed once a Security Admin's stamp says it was turned off", () => {
    const [off]: Array<SecurityPlaybookStep> = parseSecurityPlaybookSteps([
      step(
        SecurityPlaybookActionType.SuspendOktaUser,
        { connectionId: OTHER_ID },
        {
          requiresApproval: false,
          approvalTurnedOff: {
            byUserId: USER_ID,
            at: "2026-10-20T10:00:00.000Z",
          },
        },
      ),
    ]);

    expect(off!.approvalTurnedOff).toEqual({
      byUserId: USER_ID,
      at: "2026-10-20T10:00:00.000Z",
    });
    expect(doesStepNeedApproval(off!)).toBe(false);
  });

  test("a stamp on a step that asks for approval, or on any other step, is dropped", () => {
    const stamp: Record<string, unknown> = {
      approvalTurnedOff: { at: "2026-10-20T10:00:00.000Z" },
    };
    const [on, note]: Array<SecurityPlaybookStep> = parseSecurityPlaybookSteps([
      step(
        SecurityPlaybookActionType.SuspendOktaUser,
        { connectionId: OTHER_ID },
        { requiresApproval: true, ...stamp },
      ),
      step(SecurityPlaybookActionType.AddCaseNote, { note: "n" }, stamp),
    ]);

    expect(on!.approvalTurnedOff).toBeUndefined();
    expect(note!.approvalTurnedOff).toBeUndefined();
    expect(doesStepNeedApproval(note!)).toBe(false);
  });

  test("an undo step does not need approval unless marked so", () => {
    const [undo]: Array<SecurityPlaybookStep> = parseSecurityPlaybookSteps([
      step(SecurityPlaybookActionType.UnsuspendOktaUser, {
        connectionId: OTHER_ID,
      }),
    ]);

    expect(undo!.requiresApproval).toBe(false);
    expect(doesStepNeedApproval(undo!)).toBe(false);
  });
});

describe("parseSecurityPlaybookSteps", () => {
  test("reads nothing from nothing", () => {
    expect(parseSecurityPlaybookSteps(undefined)).toEqual([]);
    expect(parseSecurityPlaybookSteps(null)).toEqual([]);
    expect(parseSecurityPlaybookSteps("")).toEqual([]);
    expect(parseSecurityPlaybookSteps([])).toEqual([]);
  });

  test("reads the JSON text of a list the way it reads the list", () => {
    const steps: Array<Record<string, unknown>> = [
      step(SecurityPlaybookActionType.SetCasePriority, {
        priorityId: TEST_PRIORITY_IDS[SecurityCasePriorityLevel.High],
      }),
    ];

    expect(parseSecurityPlaybookSteps(JSON.stringify(steps))).toEqual(
      parseSecurityPlaybookSteps(steps),
    );
  });

  test("refuses what is not a list of steps", () => {
    expect(() => {
      return parseSecurityPlaybookSteps("{not json");
    }).toThrow(BadDataException);
    expect(() => {
      return parseSecurityPlaybookSteps({ steps: [] });
    }).toThrow(/must be a list/);
    expect(() => {
      return parseSecurityPlaybookSteps([{ action: "Format Hard Drive" }]);
    }).toThrow(/Step 1: "Format Hard Drive" is not an action/);
  });

  test("caps the number of steps", () => {
    const steps: Array<Record<string, unknown>> = [];

    for (let index: number = 0; index <= SECURITY_PLAYBOOK_MAX_STEPS; index++) {
      steps.push(step(SecurityPlaybookActionType.CheckThreatIntel, {}));
    }

    expect(() => {
      return parseSecurityPlaybookSteps(steps);
    }).toThrow(/at most 25 steps/);
  });

  test("keeps the three switches only when they are exactly true", () => {
    const [parsed]: Array<SecurityPlaybookStep> = parseSecurityPlaybookSteps([
      step(
        SecurityPlaybookActionType.CheckThreatIntel,
        {},
        {
          requiresApproval: "yes",
          continueOnFailure: true,
          onlyIfThreatIntelMatched: 1,
        },
      ),
    ]);

    expect(parsed!.requiresApproval).toBe(false);
    expect(parsed!.continueOnFailure).toBe(true);
    expect(parsed!.onlyIfThreatIntelMatched).toBe(false);
  });

  test("gives a step without an id, or with a repeated one, an id of its own", () => {
    const parsed: Array<SecurityPlaybookStep> = parseSecurityPlaybookSteps([
      { action: SecurityPlaybookActionType.CheckThreatIntel, config: {} },
      { id: "same", action: SecurityPlaybookActionType.CheckThreatIntel },
      { id: "same", action: SecurityPlaybookActionType.CheckThreatIntel },
    ]);

    expect(parsed[0]!.id).toBeTruthy();
    expect(parsed[1]!.id).toBe("same");
    expect(parsed[2]!.id).not.toBe("same");
    expect(
      new Set(
        parsed.map((item: SecurityPlaybookStep) => {
          return item.id;
        }),
      ).size,
    ).toBe(3);
  });

  test("names the step and the fix in every refusal", () => {
    expect(() => {
      return parseSecurityPlaybookSteps([
        step(SecurityPlaybookActionType.CheckThreatIntel, {}),
        step(SecurityPlaybookActionType.AssignCase, {}),
      ]);
    }).toThrow("Step 2 (Assign the case): choose a user, a team, or both.");
  });

  test("Assign the case keeps a user, a team, or both, and drops malformed ids", () => {
    expect(
      parseOne(SecurityPlaybookActionType.AssignCase, { userId: USER_ID })
        .config,
    ).toEqual({ userId: USER_ID });
    expect(
      parseOne(SecurityPlaybookActionType.AssignCase, {
        userId: USER_ID,
        teamId: TEAM_ID,
        extra: "dropped",
      }).config,
    ).toEqual({ userId: USER_ID, teamId: TEAM_ID });
    expectRejected(
      SecurityPlaybookActionType.AssignCase,
      { userId: "not-an-id" },
      /choose a user, a team, or both/,
    );
  });

  test("Set the priority needs one of the project's priorities, by id", () => {
    const priorityId: string =
      TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical];

    expect(
      parseOne(SecurityPlaybookActionType.SetCasePriority, {
        priorityId,
        extra: "dropped",
      }).config,
    ).toEqual({ priorityId });
    expectRejected(
      SecurityPlaybookActionType.SetCasePriority,
      { priorityId: "Urgent" },
      /choose a priority/,
    );
    // A priority by name, as steps were written before priorities were the project's own.
    expectRejected(
      SecurityPlaybookActionType.SetCasePriority,
      { priority: "Critical" },
      /choose a priority/,
    );
  });

  test("Set the status needs one of the project's statuses, by id, and keeps a verdict", () => {
    const statusId: string = TEST_STATUS_IDS[SecurityCaseStage.Closed];

    /*
     * Whether the status closes a case - and so needs the verdict - is the
     * project's list's to say, when the playbook is saved
     * (validateSecurityPlaybookStepValues).
     */
    expect(
      parseOne(SecurityPlaybookActionType.SetCaseStatus, {
        statusId,
        verdict: SecurityCaseVerdict.FalsePositive,
      }).config,
    ).toEqual({ statusId, verdict: SecurityCaseVerdict.FalsePositive });
    expect(
      parseOne(SecurityPlaybookActionType.SetCaseStatus, {
        statusId,
        verdict: "Malicious",
      }).config,
    ).toEqual({ statusId });
    expectRejected(
      SecurityPlaybookActionType.SetCaseStatus,
      { statusId: "Closed" },
      /choose a status/,
    );
    expectRejected(
      SecurityPlaybookActionType.SetCaseStatus,
      { status: "Investigating" },
      /choose a status/,
    );
  });

  test("Add a note needs text, trimmed, within the limit", () => {
    expect(
      parseOne(SecurityPlaybookActionType.AddCaseNote, {
        note: "  Check the VPN logs.  ",
      }).config,
    ).toEqual({ note: "Check the VPN logs." });
    expectRejected(
      SecurityPlaybookActionType.AddCaseNote,
      { note: "   " },
      /write the note/,
    );
    expectRejected(
      SecurityPlaybookActionType.AddCaseNote,
      { note: "x".repeat(10001) },
      /longer than 10000/,
    );
  });

  test("Add labels keeps distinct well-formed ids and needs one", () => {
    expect(
      parseOne(SecurityPlaybookActionType.AddCaseLabels, {
        labelIds: [USER_ID, USER_ID, "bad", 7, OTHER_ID],
      }).config,
    ).toEqual({ labelIds: [USER_ID, OTHER_ID] });
    expectRejected(
      SecurityPlaybookActionType.AddCaseLabels,
      { labelIds: ["bad"] },
      /at least one label/,
    );
  });

  test("Check threat intel keeps a priority id to raise to, and nothing else", () => {
    const priorityId: string =
      TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical];

    expect(
      parseOne(SecurityPlaybookActionType.CheckThreatIntel, {}).config,
    ).toEqual({});
    expect(
      parseOne(SecurityPlaybookActionType.CheckThreatIntel, {
        raisePriorityToId: priorityId,
      }).config,
    ).toEqual({ raisePriorityToId: priorityId });
    expect(
      parseOne(SecurityPlaybookActionType.CheckThreatIntel, {
        raisePriorityToId: "Max",
      }).config,
    ).toEqual({});
    expect(
      parseOne(SecurityPlaybookActionType.CheckThreatIntel, {
        raisePriorityTo: "Critical",
      }).config,
    ).toEqual({});
  });

  test("Look up entity activity takes whole hours from 1 to 720, 24 by default", () => {
    expect(
      parseOne(SecurityPlaybookActionType.LookUpEntityActivity, {}).config,
    ).toEqual({ lookbackInHours: 24 });
    expect(
      parseOne(SecurityPlaybookActionType.LookUpEntityActivity, {
        lookbackInHours: "72",
      }).config,
    ).toEqual({ lookbackInHours: 72 });
    expectRejected(
      SecurityPlaybookActionType.LookUpEntityActivity,
      { lookbackInHours: 0 },
      /1 to 720/,
    );
    expectRejected(
      SecurityPlaybookActionType.LookUpEntityActivity,
      { lookbackInHours: 1.5 },
      /1 to 720/,
    );
    expectRejected(
      SecurityPlaybookActionType.LookUpEntityActivity,
      { lookbackInHours: 721 },
      /1 to 720/,
    );
  });

  test("Email people needs somebody to email", () => {
    expect(
      parseOne(SecurityPlaybookActionType.EmailPeople, {
        userIds: [USER_ID],
        message: "  ",
      }).config,
    ).toEqual({ userIds: [USER_ID], teamIds: [] });
    expect(
      parseOne(SecurityPlaybookActionType.EmailPeople, {
        teamIds: [TEAM_ID],
        message: "Look at {{case.title}}",
      }).config,
    ).toEqual({
      userIds: [],
      teamIds: [TEAM_ID],
      message: "Look at {{case.title}}",
    });
    expectRejected(
      SecurityPlaybookActionType.EmailPeople,
      {},
      /choose who to email/,
    );
  });

  test("posting to a channel needs its name, with or without the #", () => {
    expect(
      parseOne(SecurityPlaybookActionType.PostToSlack, {
        channelName: "#soc-alerts",
      }).config,
    ).toEqual({ channelName: "soc-alerts" });
    expect(
      parseOne(SecurityPlaybookActionType.PostToMicrosoftTeams, {
        channelName: "SOC",
        microsoftTeamsTeamId: "8b2f3a51-7d1e-4c0a-9a35-2f0b1d6c7e44",
        message: "New case",
      }).config,
    ).toEqual({
      channelName: "SOC",
      microsoftTeamsTeamId: "8b2f3a51-7d1e-4c0a-9a35-2f0b1d6c7e44",
      message: "New case",
    });
    expectRejected(
      SecurityPlaybookActionType.PostToMicrosoftTeams,
      { channelName: "SOC" },
      /choose the team the channel is in/,
    );
    expectRejected(
      SecurityPlaybookActionType.PostToSlack,
      { channelName: " # " },
      /name the channel/,
    );
  });

  test("actions on another record need that record's id", () => {
    expect(
      parseOne(SecurityPlaybookActionType.PageOnCall, {
        onCallPolicyId: OTHER_ID,
      }).config,
    ).toEqual({ onCallPolicyId: OTHER_ID });
    expectRejected(SecurityPlaybookActionType.PageOnCall, {}, /on-call policy/);
    expectRejected(
      SecurityPlaybookActionType.DeclareIncident,
      {},
      /incident's severity/,
    );
    expectRejected(
      SecurityPlaybookActionType.RunWorkflow,
      { workflowId: "x" },
      /workflow/,
    );
    expectRejected(
      SecurityPlaybookActionType.SuspendOktaUser,
      {},
      /connection to act through/,
    );
  });

  test("Isolate the device defaults to full isolation", () => {
    expect(
      parseOne(SecurityPlaybookActionType.IsolateDefenderDevice, {
        connectionId: OTHER_ID,
      }).config,
    ).toEqual({
      connectionId: OTHER_ID,
      isolationType: DefenderIsolationType.Full,
    });
    expect(
      parseOne(SecurityPlaybookActionType.IsolateDefenderDevice, {
        connectionId: OTHER_ID,
        isolationType: DefenderIsolationType.Selective,
      }).config,
    ).toEqual({
      connectionId: OTHER_ID,
      isolationType: DefenderIsolationType.Selective,
    });
  });

  test("Send a webhook takes only http and https URLs", () => {
    expect(
      parseOne(SecurityPlaybookActionType.SendWebhook, {
        url: " https://hooks.example.com/soc?token=abc ",
      }).config,
    ).toEqual({ url: "https://hooks.example.com/soc?token=abc" });
    expectRejected(
      SecurityPlaybookActionType.SendWebhook,
      { url: "ftp://example.com" },
      /https:\/\//,
    );
    expectRejected(
      SecurityPlaybookActionType.SendWebhook,
      { url: "javascript:alert(1)" },
      /https:\/\//,
    );
    expectRejected(
      SecurityPlaybookActionType.SendWebhook,
      { url: "https://" },
      /https:\/\//,
    );
  });
});
