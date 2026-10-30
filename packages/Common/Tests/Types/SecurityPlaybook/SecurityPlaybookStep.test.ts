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
  doesActionNeedApprovalByDefault,
  getSecurityPlaybookAction,
  getSecurityPlaybookUndoAction,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import {
  DefenderIsolationType,
  SECURITY_PLAYBOOK_MAX_STEPS,
  SECURITY_PLAYBOOK_MAX_TASKS_PER_STEP,
  SECURITY_PLAYBOOK_TASK_MAX_LENGTH,
  SecurityPlaybookStep,
  assertSecurityPlaybookStepConditions,
  doesStepNeedApproval,
  getStepsWaitingOn,
  parseSecurityPlaybookSteps,
  readTaskLines,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import { SecurityPlaybookStepOutcome } from "../../../Types/SecurityPlaybook/SecurityPlaybookStepCondition";
import {
  SECURITY_PLAYBOOK_TEMPLATE_DEFINITIONS,
  SecurityPlaybookTemplateDefinition,
  getSecurityPlaybookTemplateDefinition,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookTemplates";
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
      [
        SecurityPlaybookActionType.EnableEntraIdUser,
        SecurityPlaybookActionType.DisableEntraIdUser,
      ],
      [
        SecurityPlaybookActionType.UnsuspendGoogleWorkspaceUser,
        SecurityPlaybookActionType.SuspendGoogleWorkspaceUser,
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

/*
 * The steps that respond through the rest of OneUptime: a runbook, the
 * evidence a case's requests left, a status page announcement and a fix by
 * OneUptime AI.
 */
describe("the steps that respond through OneUptime", () => {
  test("Run a runbook names the runbook, by id, and nothing else", () => {
    expect(
      parseOne(SecurityPlaybookActionType.RunRunbook, {
        runbookId: ` ${OTHER_ID} `,
        command: "rm -rf /",
      }).config,
    ).toEqual({ runbookId: OTHER_ID });
    expectRejected(
      SecurityPlaybookActionType.RunRunbook,
      {},
      /choose the runbook to run/,
    );
    expectRejected(
      SecurityPlaybookActionType.RunRunbook,
      { runbookId: "not-an-id" },
      /choose the runbook to run/,
    );
  });

  test("Preserve the evidence and Fix the code with AI take no settings: they read the case", () => {
    expect(
      parseOne(SecurityPlaybookActionType.PreserveEvidence, {
        anything: "dropped",
      }).config,
    ).toEqual({});
    expect(
      parseOne(SecurityPlaybookActionType.FixWithAi, { repository: "x" })
        .config,
    ).toEqual({});
  });

  test("Post a status page announcement keeps its pages, title, text and whether to notify", () => {
    expect(
      parseOne(SecurityPlaybookActionType.PostStatusPageAnnouncement, {
        statusPageIds: [USER_ID, "not-an-id", USER_ID, TEAM_ID],
        announcementTitle: "  We are investigating a security issue  ",
        announcementDescription: "Some sign-ins may be slower while we look.",
        notifySubscribers: true,
        extra: "dropped",
      }).config,
    ).toEqual({
      statusPageIds: [USER_ID, TEAM_ID],
      announcementTitle: "We are investigating a security issue",
      announcementDescription: "Some sign-ins may be slower while we look.",
      notifySubscribers: true,
    });

    // Subscribers are told only when the step says so.
    expect(
      parseOne(SecurityPlaybookActionType.PostStatusPageAnnouncement, {
        statusPageIds: [USER_ID],
        announcementTitle: "Title",
        announcementDescription: "Text",
        notifySubscribers: "yes",
      }).config["notifySubscribers"],
    ).toBe(false);
  });

  test("Post a status page announcement says what is missing or too long", () => {
    const complete: Record<string, unknown> = {
      statusPageIds: [USER_ID],
      announcementTitle: "Title",
      announcementDescription: "Text",
    };

    expectRejected(
      SecurityPlaybookActionType.PostStatusPageAnnouncement,
      { ...complete, statusPageIds: [] },
      /choose the status pages to post on/,
    );
    expectRejected(
      SecurityPlaybookActionType.PostStatusPageAnnouncement,
      { ...complete, announcementTitle: "  " },
      /write the announcement's title/,
    );
    expectRejected(
      SecurityPlaybookActionType.PostStatusPageAnnouncement,
      { ...complete, announcementTitle: "x".repeat(101) },
      /longer than 100 characters/,
    );
    expectRejected(
      SecurityPlaybookActionType.PostStatusPageAnnouncement,
      { ...complete, announcementDescription: "" },
      /write what the announcement says/,
    );
    expectRejected(
      SecurityPlaybookActionType.PostStatusPageAnnouncement,
      { ...complete, announcementDescription: "x".repeat(10001) },
      /longer than 10000 characters/,
    );
  });

  test("a runbook and a status page announcement start needing approval; neither is disruptive", () => {
    for (const type of [
      SecurityPlaybookActionType.RunRunbook,
      SecurityPlaybookActionType.PostStatusPageAnnouncement,
    ]) {
      const definition: SecurityPlaybookActionDefinition =
        getSecurityPlaybookAction(type)!;

      expect(definition.isDisruptive).toBe(false);
      expect(definition.needsApprovalByDefault).toBe(true);
      expect(doesActionNeedApprovalByDefault(definition)).toBe(true);
    }

    // Containment starts needing it too; reading and noting does not.
    expect(
      doesActionNeedApprovalByDefault(
        getSecurityPlaybookAction(SecurityPlaybookActionType.SuspendOktaUser),
      ),
    ).toBe(true);
    expect(
      doesActionNeedApprovalByDefault(
        getSecurityPlaybookAction(SecurityPlaybookActionType.PreserveEvidence),
      ),
    ).toBe(false);
    expect(
      doesActionNeedApprovalByDefault(
        getSecurityPlaybookAction(SecurityPlaybookActionType.FixWithAi),
      ),
    ).toBe(false);
    expect(doesActionNeedApprovalByDefault(undefined)).toBe(false);
  });

  test("the approval a step was saved with is the one it waits for: a runbook step saved without it runs without it", () => {
    const [withApproval, withoutApproval] = parseSecurityPlaybookSteps([
      step(
        SecurityPlaybookActionType.RunRunbook,
        { runbookId: OTHER_ID },
        { requiresApproval: true },
      ),
      step(
        SecurityPlaybookActionType.RunRunbook,
        { runbookId: OTHER_ID },
        { requiresApproval: false },
      ),
    ]) as [SecurityPlaybookStep, SecurityPlaybookStep];

    expect(doesStepNeedApproval(withApproval)).toBe(true);
    expect(doesStepNeedApproval(withoutApproval)).toBe(false);
  });

  test("each sits where a response reaches for it", () => {
    expect(
      getSecurityPlaybookAction(SecurityPlaybookActionType.PreserveEvidence)
        ?.category,
    ).toBe(SecurityPlaybookActionCategory.Investigate);
    expect(
      getSecurityPlaybookAction(
        SecurityPlaybookActionType.PostStatusPageAnnouncement,
      )?.category,
    ).toBe(SecurityPlaybookActionCategory.Notify);
    expect(
      getSecurityPlaybookAction(SecurityPlaybookActionType.RunRunbook)
        ?.category,
    ).toBe(SecurityPlaybookActionCategory.Automate);
    expect(
      getSecurityPlaybookAction(SecurityPlaybookActionType.FixWithAi)?.category,
    ).toBe(SecurityPlaybookActionCategory.Automate);
  });
});

/*
 * BRANCHING ON SAVE: a step's condition is read with the step, and the
 * list is held to the branching rule as a whole.
 */
describe("a step that waits on an earlier step's result", () => {
  function steps(
    ...list: Array<Record<string, unknown>>
  ): Array<SecurityPlaybookStep> {
    return parseSecurityPlaybookSteps(list);
  }

  const CHECK: Record<string, unknown> = step(
    SecurityPlaybookActionType.CheckThreatIntel,
    {},
    { id: "check" },
  );
  const NOTE: Record<string, unknown> = step(
    SecurityPlaybookActionType.AddCaseNote,
    { note: "n" },
    { id: "note" },
  );

  function waitingOn(
    stepId: string,
    outcome: string,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return step(
      SecurityPlaybookActionType.SuspendOktaUser,
      { connectionId: OTHER_ID },
      { id: "suspend", runIf: { stepId, outcome }, ...extra },
    );
  }

  test("keeps the step it waits on and the result, and nothing for a step that always runs", () => {
    const parsed: Array<SecurityPlaybookStep> = steps(
      CHECK,
      waitingOn("check", "Found"),
      { ...NOTE, id: "plain", runIf: null },
    );

    expect(parsed[1]!.runIf).toEqual({
      stepId: "check",
      outcome: SecurityPlaybookStepOutcome.Found,
    });
    expect(parsed[0]!.runIf).toBeUndefined();
    expect("runIf" in parsed[2]!).toBe(false);
    // A condition read from the JSON text a step list is posted as, too.
    expect(
      parseSecurityPlaybookSteps(
        JSON.stringify([CHECK, waitingOn("check", "Found Nothing")]),
      )[1]!.runIf,
    ).toEqual({
      stepId: "check",
      outcome: SecurityPlaybookStepOutcome.FoundNothing,
    });
  });

  test("refuses a condition that does not read, naming the step - never dropped into a step that always runs", () => {
    expect(() => {
      steps(CHECK, waitingOn("check", "Matched"));
    }).toThrow(
      "Step 2 (Suspend the user in Okta): choose which result of the earlier step it runs after.",
    );
    expect(() => {
      steps(CHECK, waitingOn("", "Found"));
    }).toThrow(
      "Step 2 (Suspend the user in Okta): choose the earlier step it runs after.",
    );
  });

  test("an if and an else on one check pass the branching rule", () => {
    expect(() => {
      assertSecurityPlaybookStepConditions(
        steps(CHECK, waitingOn("check", "Found"), {
          ...NOTE,
          runIf: { stepId: "check", outcome: "Found Nothing" },
        }),
      );
    }).not.toThrow();
  });

  test("a step may wait only on a step before it", () => {
    expect(() => {
      assertSecurityPlaybookStepConditions(
        steps(waitingOn("check", "Found"), CHECK),
      );
    }).toThrow(
      "Step 1 (Suspend the user in Okta): it runs after step 2, which comes after it. Move it below step 2, or choose again when it runs.",
    );

    expect(() => {
      assertSecurityPlaybookStepConditions(
        steps(CHECK, waitingOn("suspend", "Succeeded")),
      );
    }).toThrow(
      "Step 2 (Suspend the user in Okta): a step cannot run after its own result. Choose an earlier step.",
    );

    expect(() => {
      assertSecurityPlaybookStepConditions(
        steps(CHECK, waitingOn("deleted", "Succeeded")),
      );
    }).toThrow(
      "Step 2 (Suspend the user in Okta): the step it runs after is no longer in the playbook. Choose again when it runs.",
    );
  });

  test("a step waits on a failure only of a step that carries on past one", () => {
    expect(() => {
      assertSecurityPlaybookStepConditions(
        steps(NOTE, waitingOn("note", "Failed")),
      );
    }).toThrow(
      "Step 2 (Suspend the user in Okta): it runs only if step 1 (Add a note) fails, but a failed step 1 stops the run. Turn on Carry On If It Fails for step 1, or choose again when this step runs.",
    );

    expect(() => {
      assertSecurityPlaybookStepConditions(
        steps({ ...NOTE, continueOnFailure: true }, waitingOn("note", "Failed")),
      );
    }).not.toThrow();
  });

  test("a step waits on a result the earlier step can have", () => {
    // A note finds nothing.
    expect(() => {
      assertSecurityPlaybookStepConditions(
        steps(NOTE, waitingOn("note", "Found")),
      );
    }).toThrow(
      "Step 2 (Suspend the user in Okta): step 1 (Add a note) does not look anything up, so it can only succeed or fail. Choose one of those.",
    );

    // A check finds or finds nothing: it does not just succeed.
    expect(() => {
      assertSecurityPlaybookStepConditions(
        steps(CHECK, waitingOn("check", "Succeeded")),
      );
    }).toThrow(
      "Step 2 (Suspend the user in Okta): step 1 (Check entities against threat intel) looks something up, so it finds something or finds nothing. Choose one of those.",
    );
  });

  test("the steps waiting on a step are the later ones that name it", () => {
    const parsed: Array<SecurityPlaybookStep> = steps(
      CHECK,
      waitingOn("check", "Found"),
      { ...NOTE, runIf: { stepId: "check", outcome: "Found Nothing" } },
      step(SecurityPlaybookActionType.AddCaseNote, { note: "x" }),
    );

    expect(
      getStepsWaitingOn(parsed, "check").map(
        (waiting: { index: number }): number => {
          return waiting.index;
        },
      ),
    ).toEqual([1, 2]);
    expect(getStepsWaitingOn(parsed, "suspend")).toEqual([]);
  });

  test("a step saved before branching keeps its legacy threat intel switch beside no condition", () => {
    const parsed: Array<SecurityPlaybookStep> = steps(CHECK, {
      ...waitingOn("check", "Found"),
      runIf: undefined,
      onlyIfThreatIntelMatched: true,
    });

    expect(parsed[1]!.onlyIfThreatIntelMatched).toBe(true);
    expect(parsed[1]!.runIf).toBeUndefined();
    expect(() => {
      assertSecurityPlaybookStepConditions(parsed);
    }).not.toThrow();
  });
});

describe("Add tasks", () => {
  test("keeps the tasks one a line, trimmed, without empty lines or the same task twice", () => {
    expect(
      parseOne(SecurityPlaybookActionType.AddCaseTasks, {
        tasks: "  Confirm the sign-in  \n\nReset the password\nConfirm the sign-in\n",
        assigneeUserId: USER_ID,
      }).config,
    ).toEqual({
      tasks: ["Confirm the sign-in", "Reset the password"],
      assigneeUserId: USER_ID,
    });

    // A list, as the API may send it.
    expect(
      parseOne(SecurityPlaybookActionType.AddCaseTasks, {
        tasks: ["Check the device", " ", 42, "Check the device"],
      }).config,
    ).toEqual({ tasks: ["Check the device"] });
  });

  test("leaves out an assignee that is not an id: the tasks are for whoever works the case", () => {
    expect(
      parseOne(SecurityPlaybookActionType.AddCaseTasks, {
        tasks: "Check the device",
        assigneeUserId: "alice",
      }).config,
    ).toEqual({ tasks: ["Check the device"] });
  });

  test("needs a task, at most the limit, each within a line's length", () => {
    expectRejected(
      SecurityPlaybookActionType.AddCaseTasks,
      { tasks: " \n " },
      /Step 1 \(Add tasks\): write at least one task\./,
    );

    const many: Array<string> = [];

    for (let index: number = 0; index <= SECURITY_PLAYBOOK_MAX_TASKS_PER_STEP; index++) {
      many.push(`Task ${index + 1}`);
    }

    expectRejected(
      SecurityPlaybookActionType.AddCaseTasks,
      { tasks: many.join("\n") },
      new RegExp(
        `a step adds at most ${SECURITY_PLAYBOOK_MAX_TASKS_PER_STEP} tasks; this one has ${SECURITY_PLAYBOOK_MAX_TASKS_PER_STEP + 1}`,
      ),
    );
    expect(
      parseOne(SecurityPlaybookActionType.AddCaseTasks, {
        tasks: many.slice(0, SECURITY_PLAYBOOK_MAX_TASKS_PER_STEP).join("\n"),
      }).config["tasks"],
    ).toHaveLength(SECURITY_PLAYBOOK_MAX_TASKS_PER_STEP);

    expectRejected(
      SecurityPlaybookActionType.AddCaseTasks,
      { tasks: "x".repeat(SECURITY_PLAYBOOK_TASK_MAX_LENGTH + 1) },
      new RegExp(
        `a task can be at most ${SECURITY_PLAYBOOK_TASK_MAX_LENGTH} characters`,
      ),
    );
    expect(SECURITY_PLAYBOOK_MAX_TASKS_PER_STEP).toBe(20);
    expect(SECURITY_PLAYBOOK_TASK_MAX_LENGTH).toBe(500);
  });

  test("reads lines from text or a list, and nothing from anything else", () => {
    expect(readTaskLines("a\r\nb\n a ")).toEqual(["a", "b"]);
    expect(readTaskLines(["a", "a", "b"])).toEqual(["a", "b"]);
    expect(readTaskLines(undefined)).toEqual([]);
    expect(readTaskLines(7)).toEqual([]);
  });

  test("is a Case step that stays inside OneUptime and needs no approval", () => {
    const definition: SecurityPlaybookActionDefinition | undefined =
      getSecurityPlaybookAction(SecurityPlaybookActionType.AddCaseTasks);

    expect(definition?.category).toBe(SecurityPlaybookActionCategory.Case);
    expect(definition?.isDisruptive).toBe(false);
    expect(doesActionNeedApprovalByDefault(definition)).toBe(false);
  });
});

describe("containment in Microsoft Entra ID and Google Workspace", () => {
  const ENTRA: Array<SecurityPlaybookActionType> = [
    SecurityPlaybookActionType.DisableEntraIdUser,
    SecurityPlaybookActionType.SignOutEntraIdUser,
    SecurityPlaybookActionType.EnableEntraIdUser,
  ];
  const WORKSPACE: Array<SecurityPlaybookActionType> = [
    SecurityPlaybookActionType.SuspendGoogleWorkspaceUser,
    SecurityPlaybookActionType.SignOutGoogleWorkspaceUser,
    SecurityPlaybookActionType.UnsuspendGoogleWorkspaceUser,
  ];

  test("each acts on the case's users through a connection of its product", () => {
    for (const [actions, provider] of [
      [ENTRA, SecurityEventConnectorProvider.MicrosoftEntraId],
      [WORKSPACE, SecurityEventConnectorProvider.GoogleWorkspace],
    ] as Array<[Array<SecurityPlaybookActionType>, SecurityEventConnectorProvider]>) {
      for (const action of actions) {
        expect(getSecurityPlaybookAction(action)).toMatchObject({
          category: SecurityPlaybookActionCategory.Contain,
          connectionProvider: provider,
          entityType: SecurityEntityType.User,
        });
        expect(actsOnSecurityEntities(getSecurityPlaybookAction(action))).toBe(
          true,
        );
        expect(
          parseOne(action, { connectionId: ` ${OTHER_ID} `, extra: 1 }).config,
        ).toEqual({ connectionId: OTHER_ID });
        expectRejected(action, {}, /choose the connection to act through/);
      }
    }
  });

  test("disabling, suspending and signing out cut someone off, so they wait for approval; enabling and unsuspending undo them", () => {
    for (const action of [
      SecurityPlaybookActionType.DisableEntraIdUser,
      SecurityPlaybookActionType.SignOutEntraIdUser,
      SecurityPlaybookActionType.SuspendGoogleWorkspaceUser,
      SecurityPlaybookActionType.SignOutGoogleWorkspaceUser,
    ]) {
      expect(getSecurityPlaybookAction(action)?.isDisruptive).toBe(true);
      expect(parseOne(action, { connectionId: OTHER_ID }).requiresApproval).toBe(
        true,
      );
    }

    expect(
      getSecurityPlaybookUndoAction(SecurityPlaybookActionType.DisableEntraIdUser)
        ?.type,
    ).toBe(SecurityPlaybookActionType.EnableEntraIdUser);
    expect(
      getSecurityPlaybookUndoAction(
        SecurityPlaybookActionType.SuspendGoogleWorkspaceUser,
      )?.type,
    ).toBe(SecurityPlaybookActionType.UnsuspendGoogleWorkspaceUser);
    // A session that was ended stays ended.
    expect(
      getSecurityPlaybookUndoAction(SecurityPlaybookActionType.SignOutEntraIdUser),
    ).toBeUndefined();
    expect(
      getSecurityPlaybookUndoAction(
        SecurityPlaybookActionType.SignOutGoogleWorkspaceUser,
      ),
    ).toBeUndefined();
  });

  test("the picker lists them with the other containment steps, the steps that cut someone off before their undos", () => {
    const contain: Array<SecurityPlaybookActionType> = SECURITY_PLAYBOOK_ACTIONS.filter(
      (action: SecurityPlaybookActionDefinition): boolean => {
        return Boolean(action.connectionProvider);
      },
    ).map((action: SecurityPlaybookActionDefinition): SecurityPlaybookActionType => {
      return action.type;
    });
    const firstUndo: number = contain.findIndex(
      (type: SecurityPlaybookActionType): boolean => {
        return Boolean(getSecurityPlaybookAction(type)?.undoes);
      },
    );

    expect(
      contain.slice(0, firstUndo).every((type: SecurityPlaybookActionType) => {
        return getSecurityPlaybookAction(type)?.isDisruptive;
      }),
    ).toBe(true);
    expect(
      contain.slice(firstUndo).every((type: SecurityPlaybookActionType) => {
        return Boolean(getSecurityPlaybookAction(type)?.undoes);
      }),
    ).toBe(true);
  });
});

describe("the playbook templates", () => {
  test("every template's steps pass the branching rule", () => {
    for (const template of SECURITY_PLAYBOOK_TEMPLATE_DEFINITIONS) {
      const built: Array<SecurityPlaybookStep> = parseSecurityPlaybookSteps(
        template.getSteps({
          priorityId: (): string => {
            return OTHER_ID;
          },
          statusId: (): string => {
            return OTHER_ID;
          },
        }),
      );

      expect(() => {
        assertSecurityPlaybookStepConditions(built);
      }).not.toThrow();
    }
  });

  test("Escalate Known-Bad Indicators raises the case only on its threat intel check's match", () => {
    const template: SecurityPlaybookTemplateDefinition | undefined =
      getSecurityPlaybookTemplateDefinition("known-bad");
    const built: Array<SecurityPlaybookStep> = template!.getSteps({
      priorityId: (): string => {
        return OTHER_ID;
      },
      statusId: (): string => {
        return OTHER_ID;
      },
    });

    expect(built.map((item: SecurityPlaybookStep) => {
      return item.action;
    })).toEqual([
      SecurityPlaybookActionType.CheckThreatIntel,
      SecurityPlaybookActionType.SetCasePriority,
      SecurityPlaybookActionType.SetCaseStatus,
    ]);

    for (const later of built.slice(1)) {
      expect(later.runIf).toEqual({
        stepId: built[0]!.id,
        outcome: SecurityPlaybookStepOutcome.Found,
      });
      expect(later.onlyIfThreatIntelMatched).toBe(false);
    }

    // Each build is a playbook of its own: new ids, the branch pointing at its own check.
    const again: Array<SecurityPlaybookStep> = template!.getSteps({
      priorityId: (): string => {
        return OTHER_ID;
      },
      statusId: (): string => {
        return OTHER_ID;
      },
    });

    expect(again[0]!.id).not.toBe(built[0]!.id);
    expect(again[1]!.runIf?.stepId).toBe(again[0]!.id);
  });
});
