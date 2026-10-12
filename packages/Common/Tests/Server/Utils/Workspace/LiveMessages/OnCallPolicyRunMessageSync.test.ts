import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import Semaphore from "../../../../../Server/Infrastructure/Semaphore";
import WorkspaceNotificationRuleService from "../../../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../../../Server/Services/WorkspaceProjectAuthTokenService";
import logger from "../../../../../Server/Utils/Logger";
import OnCallPolicyRunMessage, {
  OnCallPolicyRunReading,
} from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import {
  ON_CALL_RUN_ALARM_NOBODY_PAGED_AT_A_RULE,
  OnCallPolicyRun,
  OnCallPolicyRunOutcome,
} from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessageView";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceUtil from "../../../../../Server/Utils/Workspace/Workspace";
import { WorkspaceSendMessageResponse } from "../../../../../Server/Utils/Workspace/WorkspaceBase";
import ObjectID from "../../../../../Types/ObjectID";
import WorkspaceLiveMessageKey from "../../../../../Types/Workspace/WorkspaceLiveMessageKey";
import WorkspaceMessagePayload, {
  WorkspacePayloadMarkdown,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import InMemoryLiveMessages from "./InMemoryLiveMessages";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * HOW AN ON-CALL RUN'S ONE MESSAGE IS KEPT UP TO DATE.
 *
 * Every change to a run asks for its message to be brought up to date
 * (OnCallPolicyRunMessage.refresh); syncRun reads the run and posts the
 * message the first time, edits it after that, and posts each alarm the
 * run calls for once. Here the run as read (readRun) is stood in for, and
 * the far end is a Slack that records what it was sent, in order.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "b0000000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "b0000000-0000-4000-8000-000000000002",
);
const RUN_ID: ObjectID = new ObjectID("b0000000-0000-4000-8000-000000000003");
const OTHER_RUN_ID: ObjectID = new ObjectID(
  "b0000000-0000-4000-8000-000000000004",
);
const CHANNEL_ID: string = "C0INC8";

function run(overrides: Partial<OnCallPolicyRun> = {}): OnCallPolicyRun {
  return {
    policyName: "PolicyX",
    policyUrl: "https://oneuptime.test/policy",
    runUrl: "https://oneuptime.test/run",
    recordLabel: "Incident INC-8",
    recordUrl: "https://oneuptime.test/incident",
    outcome: OnCallPolicyRunOutcome.Paging,
    ruleCount: 2,
    currentRule: { order: 1, name: "fhirst" },
    nextRule: { order: 2, name: "second" },
    escalateAfterInMinutes: 5,
    repeatNumber: 0,
    repeatsAllowed: 0,
    paged: [
      {
        name: "Nitin",
        timesPaged: 1,
        isBeingPaged: false,
        acknowledged: false,
        methods: ["SMS"],
        coveringFor: [],
      },
    ],
    notPaged: [],
    ...overrides,
  };
}

function reading(
  overrides: Partial<OnCallPolicyRun> = {},
  hasStarted: boolean = true,
): OnCallPolicyRunReading {
  return {
    projectId: PROJECT_ID,
    notificationFor: { incidentId: INCIDENT_ID },
    run: run(overrides),
    hasStarted: hasStarted,
  };
}

const ACKNOWLEDGED: Partial<OnCallPolicyRun> = {
  outcome: OnCallPolicyRunOutcome.Acknowledged,
  acknowledgedByName: "Nitin",
};

const RULE_2_REACHED_NOBODY: Partial<OnCallPolicyRun> = {
  currentRule: { order: 2, name: "second" },
  nextRule: undefined,
  firstRuleThatReachedNobody: {
    rule: { order: 2, name: "second" },
    reasons: ["nobody was on call in schedule sec"],
  },
};

// What Slack was sent, in order: a new message or an edit, and its text.
interface Sent {
  method: "post" | "update" | "alarm";
  text: string;
  // What its notification shows: the plain text it was sent with.
  notification?: string | undefined;
}

let store: InMemoryLiveMessages;
let sent: Array<Sent>;
let readSpy: SpyInstance<typeof OnCallPolicyRunMessage.readRun>;
let alarmSpy: SpyInstance<
  typeof WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification
>;
let nextTs: number;

function textOf(payload: WorkspaceMessagePayload): string {
  return (payload.messageBlocks[0] as WorkspacePayloadMarkdown).text;
}

function lastSent(): Sent {
  return sent[sent.length - 1]!;
}

beforeEach(() => {
  store = new InMemoryLiveMessages();
  store.install();
  sent = [];
  nextTs = 1;

  // No Valkey: one hold per run in this process.
  jest
    .spyOn(Semaphore, "lock")
    .mockRejectedValue(new Error("Redis client is not connected"));

  const slackAuth: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  slackAuth.projectId = PROJECT_ID;
  slackAuth.workspaceType = WorkspaceType.Slack;
  slackAuth.authToken = "xoxb-project";

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
    .mockResolvedValue([slackAuth]);
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockResolvedValue(slackAuth);

  jest
    .spyOn(WorkspaceNotificationRuleService, "getMessageDestinations")
    .mockResolvedValue([
      {
        _type: "WorkspaceMessagePayload",
        workspaceType: WorkspaceType.Slack,
        messageBlocks: [],
        channelNames: [],
        channelIds: [CHANNEL_ID],
      },
    ]);
  jest
    .spyOn(WorkspaceNotificationRuleService, "logSendResponses")
    .mockResolvedValue(undefined);

  jest
    .spyOn(WorkspaceUtil, "postMessageToAllWorkspaceChannelsAsBot")
    .mockImplementation((async (data: {
      messagePayloadsByWorkspace: Array<WorkspaceMessagePayload>;
    }): Promise<Array<WorkspaceSendMessageResponse>> => {
      const payload: WorkspaceMessagePayload =
        data.messagePayloadsByWorkspace[0]!;
      sent.push({
        method: "post",
        text: textOf(payload),
        notification: payload.text,
      });

      return [
        {
          workspaceType: WorkspaceType.Slack,
          threads: [
            {
              channel: {
                id: CHANNEL_ID,
                name: "inc-inc-8",
                workspaceType: WorkspaceType.Slack,
              },
              threadId: `1760000000.00000${nextTs++}`,
            },
          ],
        },
      ];
    }) as never);

  jest.spyOn(SlackUtil, "updateMessage").mockImplementation((async (data: {
    messageBlocks: Array<WorkspacePayloadMarkdown>;
    text?: string | undefined;
  }): Promise<void> => {
    sent.push({
      method: "update",
      text: data.messageBlocks[0]!.text,
      notification: data.text,
    });
  }) as never);

  alarmSpy = jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "sendWorkspaceMarkdownNotification",
    )
    .mockImplementation((async (data: {
      feedInfoInMarkdown: string;
      notificationText?: string | undefined;
    }): Promise<void> => {
      sent.push({
        method: "alarm",
        text: data.feedInfoInMarkdown,
        notification: data.notificationText,
      });
    }) as never);

  readSpy = jest.spyOn(OnCallPolicyRunMessage, "readRun");
});

afterEach(async () => {
  await OnCallPolicyRunMessage.whenIdle();
  jest.restoreAllMocks();
});

describe("OnCallPolicyRunMessage.syncRun", () => {
  test("a run that has not started an escalation rule yet posts nothing", async () => {
    readSpy.mockResolvedValue(reading({}, false));

    await OnCallPolicyRunMessage.syncRun(RUN_ID);

    expect(sent).toEqual([]);
    expect(store.rows).toEqual([]);
  });

  test("a run with nothing to tell - gone, or no Slack or Teams - posts nothing", async () => {
    readSpy.mockResolvedValue(null);

    await OnCallPolicyRunMessage.syncRun(RUN_ID);

    expect(sent).toEqual([]);
  });

  test("the first sync posts the run's message once and keeps it under the run's key", async () => {
    readSpy.mockResolvedValue(reading());

    await OnCallPolicyRunMessage.syncRun(RUN_ID);

    expect(
      sent.map((item: Sent) => {
        return item.method;
      }),
    ).toEqual(["post"]);
    expect(lastSent().text).toContain("is paging for");
    // A new message: its notification says what it is about.
    expect(lastSent().notification).toBe(
      "PolicyX is paging for Incident INC-8",
    );

    const kept: Array<unknown> = store.forKey(
      WorkspaceLiveMessageKey.forOnCallPolicyRun(RUN_ID),
    );
    expect(kept).toHaveLength(1);
    expect(store.rows[0]!.channelId).toBe(CHANNEL_ID);
    expect(store.rows[0]!.messageData).toEqual({ alarms: [] });
  });

  test("an alarm the run already calls for when it is first posted is said by that post - not raised on top of it, and remembered", async () => {
    readSpy.mockResolvedValue(reading(RULE_2_REACHED_NOBODY));

    await OnCallPolicyRunMessage.syncRun(RUN_ID);

    expect(
      sent.map((item: Sent) => {
        return item.method;
      }),
    ).toEqual(["post"]);
    expect(alarmSpy).not.toHaveBeenCalled();
    expect(store.rows[0]!.messageData).toEqual({
      alarms: [ON_CALL_RUN_ALARM_NOBODY_PAGED_AT_A_RULE],
    });
  });

  test("later: the message is edited in place, a new alarm is raised ONCE, and a sync that changes nothing sends nothing", async () => {
    readSpy.mockResolvedValue(reading());
    await OnCallPolicyRunMessage.syncRun(RUN_ID);

    readSpy.mockResolvedValue(reading(RULE_2_REACHED_NOBODY));
    await OnCallPolicyRunMessage.syncRun(RUN_ID);
    await OnCallPolicyRunMessage.syncRun(RUN_ID);

    expect(
      sent.map((item: Sent) => {
        return item.method;
      }),
    ).toEqual(["post", "alarm", "update"]);
    expect(sent[1]!.text).toContain(
      "paged nobody at escalation rule 2 of 2 (second)",
    );
    // The alarm is posted to be seen: its notification says what is wrong.
    expect(sent[1]!.notification).toBe(
      "PolicyX paged nobody at escalation rule 2 of 2 (second) for Incident INC-8",
    );
    expect(sent[2]!.text).toContain("Escalation rule 2 of 2 (second)");
    expect(sent[2]!.notification).toBe("PolicyX is paging for Incident INC-8");
    expect(store.rows[0]!.messageData).toEqual({
      alarms: [ON_CALL_RUN_ALARM_NOBODY_PAGED_AT_A_RULE],
    });
  });

  test("an alarm raised by the run's message in another channel is not raised again; every message remembers it", async () => {
    readSpy.mockResolvedValue(reading());
    await OnCallPolicyRunMessage.syncRun(RUN_ID);

    // The same run's message in a second channel, which raised the alarm.
    store.rows.push(
      Object.assign(
        Object.create(Object.getPrototypeOf(store.rows[0]!)),
        store.rows[0]!,
        {
          id: ObjectID.generate(),
          channelId: "C0OTHER",
          messageId: "1760000000.999999",
          messageData: { alarms: [ON_CALL_RUN_ALARM_NOBODY_PAGED_AT_A_RULE] },
        },
      ),
    );

    readSpy.mockResolvedValue(reading(RULE_2_REACHED_NOBODY));
    await OnCallPolicyRunMessage.syncRun(RUN_ID);

    expect(alarmSpy).not.toHaveBeenCalled();
    expect(
      sent.filter((item: Sent): boolean => {
        return item.method === "update";
      }),
    ).toHaveLength(2);

    for (const row of store.rows) {
      expect(row.messageData).toEqual({
        alarms: [ON_CALL_RUN_ALARM_NOBODY_PAGED_AT_A_RULE],
      });
    }
  });

  test("an alarm that cannot be posted is remembered all the same: it is not retried on every change", async () => {
    readSpy.mockResolvedValue(reading());
    await OnCallPolicyRunMessage.syncRun(RUN_ID);

    alarmSpy.mockRejectedValueOnce(new Error("channel_not_found"));
    readSpy.mockResolvedValue(reading(RULE_2_REACHED_NOBODY));
    await OnCallPolicyRunMessage.syncRun(RUN_ID);
    await OnCallPolicyRunMessage.syncRun(RUN_ID);

    expect(alarmSpy).toHaveBeenCalledTimes(1);
    expect(store.rows[0]!.messageData).toEqual({
      alarms: [ON_CALL_RUN_ALARM_NOBODY_PAGED_AT_A_RULE],
    });
  });

  test("REGRESSION: the run is read under its lock - a slow read of an older state never lands after a newer edit", async () => {
    // Worker A read the run while it was still paging; its read is slow.
    let finishOlderRead: (value: OnCallPolicyRunReading) => void = () => {};
    const olderRead: Promise<OnCallPolicyRunReading> =
      new Promise<OnCallPolicyRunReading>(
        (resolve: (value: OnCallPolicyRunReading) => void) => {
          finishOlderRead = resolve;
        },
      );

    readSpy
      .mockImplementationOnce(async (): Promise<OnCallPolicyRunReading> => {
        return await olderRead;
      })
      // Worker B reads the run once Nitin has acknowledged.
      .mockImplementationOnce(async (): Promise<OnCallPolicyRunReading> => {
        return reading(ACKNOWLEDGED);
      });

    const workerA: Promise<void> = OnCallPolicyRunMessage.syncRun(RUN_ID);
    const workerB: Promise<void> = OnCallPolicyRunMessage.syncRun(RUN_ID);

    // Let worker B get as far as it can while A's read is outstanding.
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }

    finishOlderRead(reading());
    await Promise.all([workerA, workerB]);

    // A posted what it read; B, reading after it, edited that to the newer state.
    expect(
      sent.map((item: Sent) => {
        return item.method;
      }),
    ).toEqual(["post", "update"]);
    expect(lastSent().text).toContain("acknowledged");
    expect(lastSent().text).not.toContain("is paging for");
  });
});

describe("OnCallPolicyRunMessage.refresh", () => {
  test("never waits, and a burst of changes to one run is at most two syncs: the one running and one after it", async () => {
    let finishFirst: () => void = () => {};
    const first: Promise<void> = new Promise<void>((resolve: () => void) => {
      finishFirst = resolve;
    });

    const syncSpy: SpyInstance<typeof OnCallPolicyRunMessage.syncRun> = jest
      .spyOn(OnCallPolicyRunMessage, "syncRun")
      .mockImplementationOnce(async (): Promise<void> => {
        await first;
      })
      .mockResolvedValue(undefined);

    for (let i: number = 0; i < 5; i++) {
      expect(OnCallPolicyRunMessage.refresh(RUN_ID)).toBeUndefined();
    }

    finishFirst();
    await OnCallPolicyRunMessage.whenIdle();

    expect(syncSpy).toHaveBeenCalledTimes(2);
    expect(syncSpy.mock.calls[0]![0].toString()).toBe(RUN_ID.toString());
  });

  test("two runs are brought up to date each on their own", async () => {
    const syncSpy: SpyInstance<typeof OnCallPolicyRunMessage.syncRun> = jest
      .spyOn(OnCallPolicyRunMessage, "syncRun")
      .mockResolvedValue(undefined);

    OnCallPolicyRunMessage.refresh(RUN_ID);
    OnCallPolicyRunMessage.refresh(OTHER_RUN_ID.toString());
    await OnCallPolicyRunMessage.whenIdle();

    expect(
      syncSpy.mock.calls
        .map((call: [ObjectID]): string => {
          return call[0].toString();
        })
        .sort(),
    ).toEqual([RUN_ID.toString(), OTHER_RUN_ID.toString()].sort());
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty id", ""],
  ])(
    "a change without a run (%s) asks for nothing",
    async (_label: string, id: unknown) => {
      const syncSpy: SpyInstance<typeof OnCallPolicyRunMessage.syncRun> =
        jest.spyOn(OnCallPolicyRunMessage, "syncRun");

      OnCallPolicyRunMessage.refresh(id as never);
      await OnCallPolicyRunMessage.whenIdle();

      expect(syncSpy).not.toHaveBeenCalled();
    },
  );

  test("never throws: a sync that fails is logged, and the next change tries again", async () => {
    const syncSpy: SpyInstance<typeof OnCallPolicyRunMessage.syncRun> = jest
      .spyOn(OnCallPolicyRunMessage, "syncRun")
      .mockRejectedValueOnce(new Error("Slack is down"))
      .mockResolvedValue(undefined);

    expect(() => {
      OnCallPolicyRunMessage.refresh(RUN_ID);
    }).not.toThrow();
    await OnCallPolicyRunMessage.whenIdle();

    expect(logger.error).toHaveBeenCalled();

    OnCallPolicyRunMessage.refresh(RUN_ID);
    await OnCallPolicyRunMessage.whenIdle();

    expect(syncSpy).toHaveBeenCalledTimes(2);
  });
});
