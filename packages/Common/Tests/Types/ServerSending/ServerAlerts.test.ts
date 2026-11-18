import ServerAlertsUtil, {
  SERVER_ALERT_MIN_INTERVAL_MS,
  ServerAlertChannel,
  ServerAlertCondition,
  ServerAlertMessage,
  ServerAlertPlan,
  ServerAlertSettings,
  ServerAlertState,
  ServerAlertSubject,
  getServerAlertSettings,
  isServerAlertPushOnByDefault,
} from "../../../Types/ServerSending/ServerAlerts";
import {
  ServerChannelStatus,
  ServerSendingChannel,
  ServerSendingState,
  ServerSendingStatusAnswer,
} from "../../../Types/ServerSending/ServerSendingStatus";
import { describe, expect, test } from "@jest/globals";

/*
 * TELLING MASTER ADMINS WHEN EMAIL OR THE GLOBAL PROBES STOP (#6879).
 *
 * The rules the job follows: only a change is told - working to failing,
 * failing to working again - and the first look only notes where things
 * stand; at most one message about a thing an hour, a change in that hour
 * said once it is over and only if it still holds; never through the
 * channel the message is about, nor one the server cannot send through
 * now; a change no channel can carry waits, and nothing is thrown. Where
 * it goes is the master admins' choice, and OneUptime Cloud sends nothing
 * until its operator chooses.
 */

const NOW: Date = new Date("2026-11-18T10:00:00.000Z");

const minutesAgo: (minutes: number) => string = (minutes: number): string => {
  return new Date(NOW.getTime() - minutes * 60 * 1000).toISOString();
};

function channel(
  sendingChannel: ServerSendingChannel,
  state: ServerSendingState,
): ServerChannelStatus {
  return {
    channel: sendingChannel,
    state: state,
  } as ServerChannelStatus;
}

function answer(
  states: Partial<Record<ServerSendingChannel, ServerSendingState>> = {},
  probes: { total: number; reporting: number } | null = {
    total: 2,
    reporting: 2,
  },
): ServerSendingStatusAnswer {
  return {
    channels: [
      ServerSendingChannel.Email,
      ServerSendingChannel.SMS,
      ServerSendingChannel.Call,
      ServerSendingChannel.Push,
    ].map((sendingChannel: ServerSendingChannel): ServerChannelStatus => {
      return channel(
        sendingChannel,
        states[sendingChannel] || ServerSendingState.Working,
      );
    }),
    globalProbes: probes,
  };
}

const EVERYWHERE: ServerAlertSettings = {
  smsNumber: "+15550100",
  isPushOn: true,
  adminNotificationEmail: "ops@example.test",
};

function told(
  condition: ServerAlertCondition,
  toldMinutesAgo: number | null = null,
  triedMinutesAgo: number | null = null,
): ServerAlertState[ServerAlertSubject] {
  return {
    told: condition,
    toldAt: toldMinutesAgo === null ? null : minutesAgo(toldMinutesAgo),
    triedAt: triedMinutesAgo === null ? null : minutesAgo(triedMinutesAgo),
  };
}

function planOf(data: {
  answer: ServerSendingStatusAnswer;
  state?: ServerAlertState;
  settings?: ServerAlertSettings;
}): ServerAlertPlan {
  return ServerAlertsUtil.plan({
    answer: data.answer,
    state: data.state || {},
    settings: data.settings || EVERYWHERE,
    now: NOW,
  });
}

const WORKING_STATE: ServerAlertState = {
  [ServerAlertSubject.Email]: told(ServerAlertCondition.Working),
  [ServerAlertSubject.GlobalProbes]: told(ServerAlertCondition.Working),
};

describe("only a change is told", () => {
  test("the first look notes where things stand, and tells nothing", () => {
    const plan: ServerAlertPlan = planOf({
      answer: answer({
        [ServerSendingChannel.Email]: ServerSendingState.Failing,
      }),
    });

    expect(plan.messages).toEqual([]);
    expect(plan.hasStateChanged).toBe(true);
    expect(plan.state[ServerAlertSubject.Email]?.told).toBe(
      ServerAlertCondition.Failing,
    );
    expect(plan.state[ServerAlertSubject.GlobalProbes]?.told).toBe(
      ServerAlertCondition.Working,
    );
  });

  test("email that worked and now fails is told, never by email", () => {
    const plan: ServerAlertPlan = planOf({
      answer: answer({
        [ServerSendingChannel.Email]: ServerSendingState.Failing,
      }),
      state: WORKING_STATE,
    });

    expect(plan.messages).toEqual([
      {
        subject: ServerAlertSubject.Email,
        condition: ServerAlertCondition.Failing,
        channels: [ServerAlertChannel.Push, ServerAlertChannel.SMS],
      },
    ]);
  });

  test("email that failed and works again is told once more", () => {
    const plan: ServerAlertPlan = planOf({
      answer: answer(),
      state: {
        ...WORKING_STATE,
        [ServerAlertSubject.Email]: told(ServerAlertCondition.Failing, 90, 90),
      },
    });

    expect(plan.messages).toEqual([
      {
        subject: ServerAlertSubject.Email,
        condition: ServerAlertCondition.Working,
        channels: [ServerAlertChannel.Push, ServerAlertChannel.SMS],
      },
    ]);
  });

  test("nothing is told while nothing changes, and nothing is written", () => {
    const failing: ServerAlertPlan = planOf({
      answer: answer({
        [ServerSendingChannel.Email]: ServerSendingState.Failing,
      }),
      state: {
        ...WORKING_STATE,
        [ServerAlertSubject.Email]: told(ServerAlertCondition.Failing, 5, 5),
      },
    });

    expect(failing.messages).toEqual([]);
    expect(failing.hasStateChanged).toBe(false);

    const working: ServerAlertPlan = planOf({
      answer: answer(),
      state: WORKING_STATE,
    });

    expect(working.messages).toEqual([]);
    expect(working.hasStateChanged).toBe(false);
  });

  test.each([
    ["not set up", ServerSendingState.NotSetUp],
    ["not tried since its settings changed", ServerSendingState.Untested],
  ])(
    "email %s is nothing to tell, and what was told stays",
    (_name: string, state: ServerSendingState) => {
      const plan: ServerAlertPlan = planOf({
        answer: answer({ [ServerSendingChannel.Email]: state }),
        state: WORKING_STATE,
      });

      expect(plan.messages).toEqual([]);
      expect(plan.state).toEqual(WORKING_STATE);
    },
  );

  test("every global probe gone quiet is told, by email too", () => {
    const plan: ServerAlertPlan = planOf({
      answer: answer({}, { total: 3, reporting: 0 }),
      state: WORKING_STATE,
    });

    expect(plan.messages).toEqual([
      {
        subject: ServerAlertSubject.GlobalProbes,
        condition: ServerAlertCondition.Failing,
        channels: [
          ServerAlertChannel.Push,
          ServerAlertChannel.SMS,
          ServerAlertChannel.Email,
        ],
      },
    ]);
  });

  test("one probe of three gone quiet is not every probe, and is not told", () => {
    expect(
      planOf({
        answer: answer({}, { total: 3, reporting: 2 }),
        state: WORKING_STATE,
      }).messages,
    ).toEqual([]);
  });

  test("a server with no global probes has nothing to tell of them", () => {
    expect(
      ServerAlertsUtil.getCondition(
        ServerAlertSubject.GlobalProbes,
        answer({}, null),
      ),
    ).toBeNull();
    expect(
      ServerAlertsUtil.getCondition(
        ServerAlertSubject.GlobalProbes,
        answer({}, { total: 0, reporting: 0 }),
      ),
    ).toBeNull();
  });
});

describe("at most one message about a thing an hour", () => {
  test("a change within the hour of the last message waits", () => {
    const plan: ServerAlertPlan = planOf({
      answer: answer(),
      state: {
        ...WORKING_STATE,
        [ServerAlertSubject.Email]: told(ServerAlertCondition.Failing, 10, 10),
      },
    });

    expect(plan.messages).toEqual([]);
  });

  test("and is told once the hour is over, if it still holds", () => {
    const plan: ServerAlertPlan = planOf({
      answer: answer(),
      state: {
        ...WORKING_STATE,
        [ServerAlertSubject.Email]: told(
          ServerAlertCondition.Failing,
          SERVER_ALERT_MIN_INTERVAL_MS / 60000,
          SERVER_ALERT_MIN_INTERVAL_MS / 60000,
        ),
      },
    });

    expect(plan.messages).toHaveLength(1);
  });

  test("email that flaps back within the hour says nothing more: what was told still holds", () => {
    // Told failing ten minutes ago; it worked a moment, and fails again now.
    const plan: ServerAlertPlan = planOf({
      answer: answer({
        [ServerSendingChannel.Email]: ServerSendingState.Failing,
      }),
      state: {
        ...WORKING_STATE,
        [ServerAlertSubject.Email]: told(ServerAlertCondition.Failing, 10, 10),
      },
    });

    expect(plan.messages).toEqual([]);
  });

  test("a try that no channel took is tried again only after the hour", () => {
    const state: ServerAlertState = ServerAlertsUtil.afterSending({
      state: WORKING_STATE,
      message: {
        subject: ServerAlertSubject.Email,
        condition: ServerAlertCondition.Failing,
        channels: [ServerAlertChannel.SMS],
      },
      sentThrough: [],
      now: NOW,
    });

    // Not told: it is still the change to tell.
    expect(state[ServerAlertSubject.Email]?.told).toBe(
      ServerAlertCondition.Working,
    );
    expect(state[ServerAlertSubject.Email]?.triedAt).toBe(NOW.toISOString());

    expect(
      ServerAlertsUtil.plan({
        answer: answer({
          [ServerSendingChannel.Email]: ServerSendingState.Failing,
        }),
        state: state,
        settings: EVERYWHERE,
        now: new Date(NOW.getTime() + 5 * 60 * 1000),
      }).messages,
    ).toEqual([]);
    expect(
      ServerAlertsUtil.plan({
        answer: answer({
          [ServerSendingChannel.Email]: ServerSendingState.Failing,
        }),
        state: state,
        settings: EVERYWHERE,
        now: new Date(NOW.getTime() + SERVER_ALERT_MIN_INTERVAL_MS),
      }).messages,
    ).toHaveLength(1);
  });

  test("a message any channel took is told", () => {
    const message: ServerAlertMessage = {
      subject: ServerAlertSubject.Email,
      condition: ServerAlertCondition.Failing,
      channels: [ServerAlertChannel.Push, ServerAlertChannel.SMS],
    };

    expect(
      ServerAlertsUtil.afterSending({
        state: WORKING_STATE,
        message,
        sentThrough: [ServerAlertChannel.Push],
        now: NOW,
      })[ServerAlertSubject.Email],
    ).toEqual({
      told: ServerAlertCondition.Failing,
      toldAt: NOW.toISOString(),
      triedAt: NOW.toISOString(),
    });
  });
});

describe("never through the failing channel, nor one that cannot send", () => {
  test("email is never told by email, even with an Admin Notification Email", () => {
    for (const channels of [
      ServerAlertsUtil.getChannels(
        ServerAlertSubject.Email,
        answer({ [ServerSendingChannel.Email]: ServerSendingState.Failing }),
        EVERYWHERE,
      ),
      ServerAlertsUtil.getChannels(
        ServerAlertSubject.Email,
        answer(),
        EVERYWHERE,
      ),
    ]) {
      expect(channels).not.toContain(ServerAlertChannel.Email);
    }
  });

  test.each([[ServerSendingState.Failing], [ServerSendingState.NotSetUp]])(
    "a channel that is %s is left out",
    (state: ServerSendingState) => {
      expect(
        ServerAlertsUtil.getChannels(
          ServerAlertSubject.GlobalProbes,
          answer({
            [ServerSendingChannel.SMS]: state,
            [ServerSendingChannel.Push]: state,
          }),
          EVERYWHERE,
        ),
      ).toEqual([ServerAlertChannel.Email]);
    },
  );

  test("a channel not tried yet is used", () => {
    expect(
      ServerAlertsUtil.getChannels(
        ServerAlertSubject.Email,
        answer({ [ServerSendingChannel.SMS]: ServerSendingState.Untested }),
        EVERYWHERE,
      ),
    ).toContain(ServerAlertChannel.SMS);
  });

  test("with no channel that can carry it, nothing is planned and the change waits", () => {
    const plan: ServerAlertPlan = planOf({
      answer: answer({
        [ServerSendingChannel.Email]: ServerSendingState.Failing,
        [ServerSendingChannel.SMS]: ServerSendingState.NotSetUp,
        [ServerSendingChannel.Push]: ServerSendingState.Failing,
      }),
      state: WORKING_STATE,
    });

    expect(plan.messages).toEqual([]);
    expect(plan.state[ServerAlertSubject.Email]?.told).toBe(
      ServerAlertCondition.Working,
    );
    expect(plan.hasStateChanged).toBe(false);
  });

  test("only the channels master admins chose", () => {
    expect(
      ServerAlertsUtil.getChannels(ServerAlertSubject.GlobalProbes, answer(), {
        smsNumber: null,
        isPushOn: false,
        adminNotificationEmail: "ops@example.test",
      }),
    ).toEqual([ServerAlertChannel.Email]);
    expect(
      ServerAlertsUtil.getChannels(ServerAlertSubject.Email, answer(), {
        smsNumber: null,
        isPushOn: false,
        adminNotificationEmail: "ops@example.test",
      }),
    ).toEqual([]);
  });
});

describe("where it goes, as master admins chose", () => {
  test("push is on until a master admin turns it off, on a self-hosted server", () => {
    expect(isServerAlertPushOnByDefault(false)).toBe(true);
    expect(
      getServerAlertSettings({
        smsNumber: null,
        isPushOn: null,
        adminNotificationEmail: null,
        isBillingEnabled: false,
      }),
    ).toEqual({
      smsNumber: null,
      isPushOn: true,
      adminNotificationEmail: null,
    });
    expect(
      getServerAlertSettings({
        smsNumber: "+15550100",
        isPushOn: false,
        adminNotificationEmail: "ops@example.test",
        isBillingEnabled: false,
      }),
    ).toEqual({
      smsNumber: "+15550100",
      isPushOn: false,
      adminNotificationEmail: "ops@example.test",
    });
  });

  test("OneUptime Cloud sends nothing until its operator chooses", () => {
    expect(isServerAlertPushOnByDefault(true)).toBe(false);
    expect(
      getServerAlertSettings({
        smsNumber: null,
        isPushOn: null,
        adminNotificationEmail: "ops@example.test",
        isBillingEnabled: true,
      }),
    ).toEqual({
      smsNumber: null,
      isPushOn: false,
      adminNotificationEmail: null,
    });
    expect(
      getServerAlertSettings({
        smsNumber: null,
        isPushOn: true,
        adminNotificationEmail: "ops@example.test",
        isBillingEnabled: true,
      }),
    ).toEqual({
      smsNumber: null,
      isPushOn: true,
      adminNotificationEmail: "ops@example.test",
    });
  });
});

describe("what is kept, and what is said", () => {
  test("the state reads back as written, and anything else as nothing told", () => {
    const state: ServerAlertState = {
      [ServerAlertSubject.Email]: told(ServerAlertCondition.Failing, 3, 3),
    };

    expect(ServerAlertsUtil.readState(ServerAlertsUtil.toJSON(state))).toEqual(
      state,
    );
    expect(ServerAlertsUtil.readState(null)).toEqual({});
    expect(ServerAlertsUtil.readState([])).toEqual({});
    expect(
      ServerAlertsUtil.readState({ email: { told: "maybe" }, globalProbes: 3 }),
    ).toEqual({});
  });

  test("the words name the server and never a mail server's answer", () => {
    const text: { title: string; body: string } = ServerAlertsUtil.getText({
      message: {
        subject: ServerAlertSubject.Email,
        condition: ServerAlertCondition.Failing,
        channels: [ServerAlertChannel.SMS],
      },
      serverName: "oneuptime.acme.io",
      probes: null,
    });

    expect(text.title).toContain("oneuptime.acme.io");
    expect(text.body).toContain("Settings > Emails");
    expect(text.body.length).toBeLessThanOrEqual(160);
  });

  test("the probes' words say how many report again", () => {
    expect(
      ServerAlertsUtil.getText({
        message: {
          subject: ServerAlertSubject.GlobalProbes,
          condition: ServerAlertCondition.Working,
          channels: [ServerAlertChannel.Push],
        },
        serverName: "oneuptime.acme.io",
        probes: { total: 3, reporting: 2 },
      }).body,
    ).toContain("2 of 3");
  });
});
