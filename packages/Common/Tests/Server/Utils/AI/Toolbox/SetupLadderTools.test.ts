import AIToolbox from "../../../../../Server/Utils/AI/Toolbox/Index";
import {
  HOW_TO_REACH_ME_DASHBOARD_PATH,
  LADDER_CHANNELS_BY_WORD,
  SetHowToReachMeTool,
  describeLadderForPerson,
  describeLadderInEnglish,
  readLadderSteps,
} from "../../../../../Server/Utils/AI/Toolbox/SetupLadderTools";
import {
  PreparedMutation,
  SetupActionRefusal,
  ToolContext,
  ToolExecutionResult,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import PagingLadderService from "../../../../../Server/Services/PagingLadderService";
import DashboardPages from "../../../../../Server/Utils/AI/Docs/DashboardPages.json";
import UserNotificationRule from "../../../../../Models/DatabaseModels/UserNotificationRule";
import {
  AI_ACTION_CARD_KINDS,
  AI_ACTION_CHANNEL_TERMS,
  describeAIActionCardWords,
  isKnownAIActionCardWords,
  isKnownAIActionSentence,
} from "../../../../../Types/AI/AIActionWords";
import { AIChatCitationTargetType } from "../../../../../Types/AI/AIChatTypes";
import { SET_HOW_TO_REACH_ME_TOOL_NAME } from "../../../../../Types/AI/AISetupActions";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotificationRuleType from "../../../../../Types/NotificationRule/NotificationRuleType";
import {
  PagingLadderCell,
  PagingLadderStep,
  getPagingLadderCells,
} from "../../../../../Types/NotificationRule/PagingLadder";
import { PagingLadderMethodReference } from "../../../../../Types/NotificationRule/PagingLadderDefault";
import ObjectID from "../../../../../Types/ObjectID";
import { OnCallPageChannel } from "../../../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import { NOTIFICATION_METHOD_NAMES } from "../../../../../UI/Utils/NotificationMethodUtil";
import {
  actionLineText,
  actionTitleText,
} from "../../../../Helpers/AIActionText";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * "TEXT ME, THEN CALL ME AFTER FIVE MINUTES" (#7454).
 *
 * set_how_to_reach_me sets the person's How to Reach Me ladder from a
 * sentence: each step a way to be reached and a wait, mapped to the
 * person's own verified methods as the project's default ladder is mapped
 * for a member (getPagingLadderFromDefault), and saved through
 * PagingLadderService.applyLadder as the person - the ladder page's own
 * save, with every check it makes. The card says the ladder a step a line,
 * which ways are left out until a method of them is verified, and that it
 * replaces how pages reach the person now. Nothing is saved before the
 * card is approved, and a ladder with no verified way is never proposed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "74540000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("74540000-0000-4000-8000-000000000002");
const SMS_ID: string = "74540000-0000-4000-8000-000000000010";
const SECOND_SMS_ID: string = "74540000-0000-4000-8000-000000000011";
const CALL_ID: string = "74540000-0000-4000-8000-000000000012";
const EMAIL_ID: string = "74540000-0000-4000-8000-000000000013";
const SEVERITY_ID: string = "74540000-0000-4000-8000-000000000020";
const ALERT_SEVERITY_ID: string = "74540000-0000-4000-8000-000000000021";

const ctx: ToolContext = {
  projectId: PROJECT_ID,
  props: { userId: USER_ID, tenantId: PROJECT_ID },
};

type Spy = jest.SpyInstance;

afterEach(() => {
  jest.restoreAllMocks();
});

const TEXT_THEN_CALL: { steps: Array<{ by: string; afterMinutes: number }> } = {
  steps: [
    { by: "sms", afterMinutes: 0 },
    { by: "call", afterMinutes: 5 },
  ],
};

// The person: their verified methods, and their rules now (email at once).
function personHas(data: {
  methods: Array<PagingLadderMethodReference>;
  rules?: Array<UserNotificationRule>;
}): void {
  jest
    .spyOn(PagingLadderService, "getUsableMethods")
    .mockResolvedValue(data.methods as never);

  const cells: Array<PagingLadderCell> = getPagingLadderCells({
    incidentSeverities: [{ _id: SEVERITY_ID, name: "Critical" }],
    alertSeverities: [{ _id: ALERT_SEVERITY_ID, name: "High" }],
  });

  jest.spyOn(PagingLadderService, "getCells").mockResolvedValue(cells as never);
  jest
    .spyOn(PagingLadderService, "getRules")
    .mockResolvedValue((data.rules || []) as never);
}

function emailRuleAtOnce(): Array<UserNotificationRule> {
  return [
    NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
  ].map((ruleType: NotificationRuleType): UserNotificationRule => {
    const rule: UserNotificationRule = new UserNotificationRule();
    rule._id = ObjectID.generate().toString();
    rule.ruleType = ruleType;
    rule.notifyAfterMinutes = 0;
    rule.userEmailId = new ObjectID(EMAIL_ID);

    if (
      ruleType === NotificationRuleType.ON_CALL_EXECUTED_INCIDENT ||
      ruleType === NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE
    ) {
      rule.incidentSeverityId = new ObjectID(SEVERITY_ID);
    } else {
      rule.alertSeverityId = new ObjectID(ALERT_SEVERITY_ID);
    }

    return rule;
  });
}

const sms: (id: string) => PagingLadderMethodReference = (
  id: string,
): PagingLadderMethodReference => {
  return { methodColumn: "userSmsId", methodId: id };
};

describe("reading the ladder a person asks for", () => {
  test("each way and its wait, in the order a page takes them, each once", () => {
    expect(
      readLadderSteps({
        steps: [
          { by: "call", afterMinutes: 5 },
          { by: "SMS", afterMinutes: 0 },
          { by: "sms", afterMinutes: 0 },
          { by: "pigeon", afterMinutes: 1 },
          "sms",
          { by: "email", afterMinutes: 2.6 },
          { by: "push", afterMinutes: -4 },
          { by: "whatsapp", afterMinutes: 99999 },
        ],
      }),
    ).toEqual([
      // A push step says how it sounds and repeats: a rule's own defaults.
      {
        channel: OnCallPageChannel.Push,
        notifyAfterMinutes: 0,
        pushNotificationLevel: "Critical",
        repeatEveryMinutes: 0,
      },
      { channel: OnCallPageChannel.SMS, notifyAfterMinutes: 0 },
      { channel: OnCallPageChannel.Email, notifyAfterMinutes: 3 },
      { channel: OnCallPageChannel.Call, notifyAfterMinutes: 5 },
      { channel: OnCallPageChannel.WhatsApp, notifyAfterMinutes: 1440 },
    ]);
    expect(readLadderSteps({})).toEqual([]);
    expect(readLadderSteps({ steps: "sms then call" })).toEqual([]);
  });

  test("every way a call names is a way a person is reached by", () => {
    expect(Object.keys(LADDER_CHANNELS_BY_WORD).sort()).toEqual(
      [
        "call",
        "email",
        "mattermost",
        "microsoft_teams",
        "push",
        "slack",
        "sms",
        "telegram",
        "webhook",
        "whatsapp",
      ].sort(),
    );
  });

  test("the channels' names are the ones Notification Methods draws, so the card says them as that page does", () => {
    expect(AI_ACTION_CHANNEL_TERMS).toEqual(NOTIFICATION_METHOD_NAMES);
  });
});

describe("the card", () => {
  test("is titled for what it changes", () => {
    expect(
      actionTitleText(SetHowToReachMeTool.buildActionTitle!(TEXT_THEN_CALL)),
    ).toBe("Set how pages reach you");
  });

  test("says the ladder a step a line, and that it replaces how pages reach the person now", async () => {
    personHas({
      methods: [sms(SMS_ID), { methodColumn: "userCallId", methodId: CALL_ID }],
    });

    const prepared: PreparedMutation =
      await SetHowToReachMeTool.prepareMutation!(TEXT_THEN_CALL, ctx);

    expect(actionLineText(prepared.description)).toBe(
      "At once: SMS. After 5 minutes: phone call. This replaces how pages reach you now, for every incident and alert at every severity.",
    );
    for (const sentence of prepared.description || []) {
      expect(isKnownAIActionSentence(sentence)).toBe(true);
    }
    // The steps as they run, by the words the call takes.
    expect(prepared.arguments["steps"]).toEqual([
      { by: "sms", afterMinutes: 0 },
      { by: "call", afterMinutes: 5 },
    ]);
    expect(prepared.describedArguments).toEqual(["steps"]);
  });

  test("a way the person has not verified is left out, and the card says where to add it - a missing phone", async () => {
    personHas({ methods: [sms(SMS_ID)] });

    const prepared: PreparedMutation =
      await SetHowToReachMeTool.prepareMutation!(TEXT_THEN_CALL, ctx);

    expect(actionLineText(prepared.description)).toBe(
      "At once: SMS. Left out until you verify one in Notification Methods: phone call. This replaces how pages reach you now, for every incident and alert at every severity.",
    );
  });

  test("ways that go together are one line", () => {
    expect(
      actionLineText(
        describeLadderForPerson({
          appliedSteps: [
            { channel: OnCallPageChannel.Push, notifyAfterMinutes: 0 },
            { channel: OnCallPageChannel.SMS, notifyAfterMinutes: 0 },
            { channel: OnCallPageChannel.Call, notifyAfterMinutes: 1 },
          ],
          leftOutChannels: [],
        }),
      ),
    ).toBe(
      // English joins a list with a comma; each language joins it its own way.
      "At once: push notification, SMS. After 1 minute: phone call. This replaces how pages reach you now, for every incident and alert at every severity.",
    );
    expect(
      describeLadderInEnglish([
        { channel: OnCallPageChannel.SMS, notifyAfterMinutes: 0 },
        { channel: OnCallPageChannel.Call, notifyAfterMinutes: 5 },
      ]),
    ).toBe("SMS at once, then phone call after 5 minutes");
  });
});

describe("asked before the card", () => {
  test("no way named is not proposed", async () => {
    expect(
      (await SetHowToReachMeTool.checkBeforeApproval!({ steps: [] }, ctx))
        ?.toldModel,
    ).toContain("say how to reach the person");
  });

  test("no verified method of any way asked: nothing proposed, and the person is told where to verify one - never asked for a number", async () => {
    personHas({ methods: [] });

    const refused: SetupActionRefusal | null =
      await SetHowToReachMeTool.checkBeforeApproval!(TEXT_THEN_CALL, ctx);

    expect(refused?.toldModel).toContain(
      "the person has verified no method of any way they asked to be reached (SMS, phone call)",
    );
    expect(refused?.toldModel).toContain("Ask AI never adds a phone number");
    expect(refused?.toldModel).toContain(
      'find_dashboard_page "Notification Methods"',
    );
  });

  test("the ladder they have already: nothing proposed", async () => {
    personHas({
      methods: [{ methodColumn: "userEmailId", methodId: EMAIL_ID }],
      rules: emailRuleAtOnce(),
    });

    expect(
      (
        await SetHowToReachMeTool.checkBeforeApproval!(
          { steps: [{ by: "email", afterMinutes: 0 }] },
          ctx,
        )
      )?.toldModel,
    ).toContain("pages already reach the person exactly this way");
  });

  test("a ladder that changes something lets the card show", async () => {
    personHas({ methods: [sms(SMS_ID)], rules: emailRuleAtOnce() });

    expect(
      await SetHowToReachMeTool.checkBeforeApproval!(TEXT_THEN_CALL, ctx),
    ).toBeNull();
  });

  test("what cannot be read lets the card show: saving says why", async () => {
    jest
      .spyOn(PagingLadderService, "getUsableMethods")
      .mockRejectedValue(new Error("down") as never);

    expect(
      await SetHowToReachMeTool.checkBeforeApproval!(TEXT_THEN_CALL, ctx),
    ).toBeNull();
  });
});

describe("approved", () => {
  test("it saves the ladder through the ladder page's own save, as the person, mapped to every verified method of each way", async () => {
    personHas({
      methods: [sms(SMS_ID), sms(SECOND_SMS_ID)],
      rules: emailRuleAtOnce(),
    });
    const apply: Spy = jest
      .spyOn(PagingLadderService, "applyLadder")
      .mockResolvedValue({
        createdCount: 8,
        updatedCount: 0,
        deletedCount: 4,
        unchangedCount: 0,
      } as never);

    const result: ToolExecutionResult = await SetHowToReachMeTool.execute(
      TEXT_THEN_CALL,
      ctx,
    );

    expect(apply).toHaveBeenCalledTimes(1);
    const saved: {
      projectId: ObjectID;
      targetUserId: ObjectID;
      steps: Array<PagingLadderStep>;
      props: unknown;
    } = apply.mock.calls[0]![0] as {
      projectId: ObjectID;
      targetUserId: ObjectID;
      steps: Array<PagingLadderStep>;
      props: unknown;
    };
    // As the person: the save asks who may change whose rules.
    expect(saved.props).toBe(ctx.props);
    expect(saved.projectId).toBe(PROJECT_ID);
    expect(saved.targetUserId.toString()).toBe(USER_ID.toString());
    // Both numbers at once; the call left out with no verified phone for it.
    expect(
      saved.steps.map((step: PagingLadderStep) => {
        return [step.methodColumn, step.methodId, step.notifyAfterMinutes];
      }),
    ).toEqual([
      ["userSmsId", SMS_ID, 0],
      ["userSmsId", SECOND_SMS_ID, 0],
    ]);

    expect(result.dataForLlm).toContain(
      "Saved how pages reach the person, as their How to Reach Me ladder: SMS at once, for every incident and alert at every severity",
    );
    expect(result.dataForLlm).toContain(
      "Left out, because the person has no verified method of it yet: phone call.",
    );
    expect(result.dataForLlm).toContain("never say one was sent");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.DashboardPage,
      params: {
        path: HOW_TO_REACH_ME_DASHBOARD_PATH,
        title: "How to Reach Me",
      },
    });
    expect(result.widget?.data.testPage).toEqual({ kind: "self" });
    expect(isKnownAIActionCardWords(result.widget?.data.words)).toBe(true);
    expect(describeAIActionCardWords(result.widget!.data.words!)).toEqual({
      kind: AI_ACTION_CARD_KINDS.howToReachMe,
      line: "At once: SMS",
      facts: [],
    });
  });

  test("the page it cites is the Dashboard's How to Reach Me", () => {
    expect(
      (DashboardPages as Array<{ path: string }>).some(
        (page: { path: string }): boolean => {
          return page.path === HOW_TO_REACH_ME_DASHBOARD_PATH;
        },
      ),
    ).toBe(true);
  });

  test("a ladder no verified method can carry saves nothing", async () => {
    personHas({ methods: [] });
    const apply: Spy = jest.spyOn(PagingLadderService, "applyLadder");

    await expect(
      SetHowToReachMeTool.execute(TEXT_THEN_CALL, ctx),
    ).rejects.toThrow(BadDataException);
    expect(apply).not.toHaveBeenCalled();
  });

  test("a refusal of the save is the person's to read", async () => {
    personHas({ methods: [sms(SMS_ID)] });
    jest
      .spyOn(PagingLadderService, "applyLadder")
      .mockRejectedValue(
        new BadDataException(
          "A step names a notification method that is not verified.",
        ) as never,
      );

    await expect(
      SetHowToReachMeTool.execute(TEXT_THEN_CALL, ctx),
    ).rejects.toThrow(
      "A step names a notification method that is not verified.",
    );
  });
});

test("it is a setup action of the toolbox: asked in every mode, of no one product", () => {
  expect(AIToolbox.getToolByName(SET_HOW_TO_REACH_ME_TOOL_NAME)).toBe(
    SetHowToReachMeTool,
  );
  expect(AIToolbox.isSetupAction(SET_HOW_TO_REACH_ME_TOOL_NAME)).toBe(true);
  expect(SetHowToReachMeTool.isMutation).toBe(true);
});
