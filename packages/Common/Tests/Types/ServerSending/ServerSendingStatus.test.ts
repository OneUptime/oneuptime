import { describe, expect, test } from "@jest/globals";
import ServerSendingStatusUtil, {
  SERVER_SENDING_CHANNELS,
  SERVER_SENDING_HEALTH_REWRITE_INTERVAL_MS,
  MAX_SERVER_SENDING_FAILURE_LENGTH,
  ServerChannelStatus,
  ServerSendingChannel,
  ServerSendingHealthEntry,
  ServerSendingState,
  ServerSendingStatusAnswer,
} from "../../../Types/ServerSending/ServerSendingStatus";
import { seededRandom, SeededRandom } from "../../Helpers/SeededRandom";

/*
 * CAN THIS SERVER SEND? THE ONE ANSWER, AS PURE RULES (#6825).
 *
 * A channel is not-set-up whatever it remembers, failing while its sends
 * fail, working once one went out, untested before. A page anybody can open
 * may say the server cannot send only while it is not set up, or set up and
 * has never managed to - once email has worked, a later failure is the
 * admins' to hear. The senders write news, not every send: the first that
 * goes out, the first that fails, a new reason, and the same news at most
 * once an hour. What a browser reads back is held to known channels and
 * states, so a forged answer draws no banner it should not.
 */

const NOW: Date = new Date("2026-11-11T12:00:00.000Z");

function entry(
  overrides: Partial<ServerSendingHealthEntry> = {},
): ServerSendingHealthEntry {
  return {
    lastSucceededAt: null,
    lastFailedAt: null,
    failingSince: null,
    lastFailure: null,
    ...overrides,
  };
}

function minutesBefore(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60 * 1000).toISOString();
}

describe("where a channel stands", () => {
  test.each([
    [false, entry(), ServerSendingState.NotSetUp],
    [
      false,
      entry({ lastSucceededAt: minutesBefore(5) }),
      ServerSendingState.NotSetUp,
    ],
    [
      false,
      entry({ failingSince: minutesBefore(5), lastFailure: "refused" }),
      ServerSendingState.NotSetUp,
    ],
    [true, entry(), ServerSendingState.Untested],
    [
      true,
      entry({ lastSucceededAt: minutesBefore(5) }),
      ServerSendingState.Working,
    ],
    [
      true,
      entry({ failingSince: minutesBefore(5), lastFailure: "refused" }),
      ServerSendingState.Failing,
    ],
    [
      true,
      entry({
        lastSucceededAt: minutesBefore(50),
        failingSince: minutesBefore(5),
      }),
      ServerSendingState.Failing,
    ],
  ])(
    "set up %p with %j is %p",
    (
      isSetUp: boolean,
      remembered: ServerSendingHealthEntry,
      expected: ServerSendingState,
    ) => {
      expect(
        ServerSendingStatusUtil.getState({
          isSetUp: isSetUp,
          entry: remembered,
        }),
      ).toBe(expected);
    },
  );

  test("a status carries what the server remembers, and why it is not set up", () => {
    const status: ServerChannelStatus = ServerSendingStatusUtil.getStatus({
      channel: ServerSendingChannel.Email,
      setUpProblem: null,
      entry: entry({
        lastSucceededAt: minutesBefore(90),
        failingSince: minutesBefore(10),
        lastFailure: "535 Authentication failed",
      }),
    });

    expect(status).toEqual({
      channel: ServerSendingChannel.Email,
      state: ServerSendingState.Failing,
      hasWorked: true,
      lastWorkedAt: minutesBefore(90),
      failingSince: minutesBefore(10),
      lastFailure: "535 Authentication failed",
      setUpProblem: null,
    });

    expect(
      ServerSendingStatusUtil.getStatus({
        channel: ServerSendingChannel.SMS,
        setUpProblem: "No Twilio account.",
        entry: entry(),
      }),
    ).toMatchObject({
      state: ServerSendingState.NotSetUp,
      hasWorked: false,
      setUpProblem: "No Twilio account.",
    });
  });
});

describe("what a page anybody can open may say", () => {
  test.each([
    [ServerSendingState.NotSetUp, false, false],
    [ServerSendingState.NotSetUp, true, false],
    [ServerSendingState.Untested, false, true],
    [ServerSendingState.Working, true, true],
    // Set up, and has never managed to send: said, as "cannot send yet".
    [ServerSendingState.Failing, false, false],
    // Has worked, fails now: told to the admins only, never on a public page.
    [ServerSendingState.Failing, true, true],
  ])(
    "%p, having worked %p: can send publicly %p",
    (state: ServerSendingState, hasWorked: boolean, expected: boolean) => {
      expect(
        ServerSendingStatusUtil.canSendPublicly({
          state: state,
          hasWorked: hasWorked,
        }),
      ).toBe(expected);
    },
  );

  test.each([
    [ServerSendingState.NotSetUp, true],
    [ServerSendingState.Failing, true],
    [ServerSendingState.Untested, false],
    [ServerSendingState.Working, false],
  ])(
    "a master admin is told of %p: %p",
    (state: ServerSendingState, expected: boolean) => {
      expect(ServerSendingStatusUtil.needsAttention({ state: state })).toBe(
        expected,
      );
    },
  );
});

describe("what the senders write down", () => {
  test("a send that went out clears the failing streak and keeps the last reason", () => {
    const next: ServerSendingHealthEntry = ServerSendingStatusUtil.withSucceeded(
      entry({
        failingSince: minutesBefore(30),
        lastFailedAt: minutesBefore(2),
        lastFailure: "timeout",
      }),
      NOW,
    );

    expect(next).toEqual({
      lastSucceededAt: NOW.toISOString(),
      failingSince: null,
      lastFailedAt: minutesBefore(2),
      lastFailure: "timeout",
    });
  });

  test("a failure starts the streak once, and the streak keeps its start", () => {
    const first: ServerSendingHealthEntry = ServerSendingStatusUtil.withFailed(
      entry({ lastSucceededAt: minutesBefore(60) }),
      "Connection refused",
      NOW,
    );

    expect(first).toEqual({
      lastSucceededAt: minutesBefore(60),
      lastFailedAt: NOW.toISOString(),
      failingSince: NOW.toISOString(),
      lastFailure: "Connection refused",
    });

    const later: Date = new Date(NOW.getTime() + 5 * 60 * 1000);
    const second: ServerSendingHealthEntry =
      ServerSendingStatusUtil.withFailed(first, "Timed out", later);

    expect(second.failingSince).toBe(NOW.toISOString());
    expect(second.lastFailedAt).toBe(later.toISOString());
    expect(second.lastFailure).toBe("Timed out");
  });

  test("a reason is trimmed and held to its longest, and an empty one still says something", () => {
    const long: ServerSendingHealthEntry = ServerSendingStatusUtil.withFailed(
      entry(),
      `  ${"x".repeat(MAX_SERVER_SENDING_FAILURE_LENGTH * 3)}  `,
      NOW,
    );

    expect(long.lastFailure).toHaveLength(MAX_SERVER_SENDING_FAILURE_LENGTH);

    expect(
      ServerSendingStatusUtil.withFailed(entry(), "   ", NOW).lastFailure,
    ).toBe("Unknown error.");
  });

  describe("a send that went out is news", () => {
    test("the first ever, and the first after failures", () => {
      expect(
        ServerSendingStatusUtil.shouldWriteSucceeded(entry(), NOW),
      ).toBe(true);
      expect(
        ServerSendingStatusUtil.shouldWriteSucceeded(
          entry({
            lastSucceededAt: minutesBefore(1),
            failingSince: minutesBefore(0.5),
          }),
          NOW,
        ),
      ).toBe(true);
    });

    test("the same news only once the rewrite interval has passed", () => {
      const intervalInMinutes: number =
        SERVER_SENDING_HEALTH_REWRITE_INTERVAL_MS / 60000;

      expect(
        ServerSendingStatusUtil.shouldWriteSucceeded(
          entry({ lastSucceededAt: minutesBefore(intervalInMinutes - 1) }),
          NOW,
        ),
      ).toBe(false);
      expect(
        ServerSendingStatusUtil.shouldWriteSucceeded(
          entry({ lastSucceededAt: minutesBefore(intervalInMinutes) }),
          NOW,
        ),
      ).toBe(true);
    });
  });

  describe("a failure is news", () => {
    test("the first, and a new reason", () => {
      expect(
        ServerSendingStatusUtil.shouldWriteFailed(entry(), "refused", NOW),
      ).toBe(true);

      const failing: ServerSendingHealthEntry = entry({
        failingSince: minutesBefore(10),
        lastFailedAt: minutesBefore(1),
        lastFailure: "refused",
      });

      expect(
        ServerSendingStatusUtil.shouldWriteFailed(failing, "refused", NOW),
      ).toBe(false);
      expect(
        ServerSendingStatusUtil.shouldWriteFailed(failing, "timed out", NOW),
      ).toBe(true);
    });

    test("the same failure only once the rewrite interval has passed", () => {
      const intervalInMinutes: number =
        SERVER_SENDING_HEALTH_REWRITE_INTERVAL_MS / 60000;

      const failing: (lastFailedMinutesAgo: number) => ServerSendingHealthEntry =
        (lastFailedMinutesAgo: number): ServerSendingHealthEntry => {
          return entry({
            failingSince: minutesBefore(intervalInMinutes * 5),
            lastFailedAt: minutesBefore(lastFailedMinutesAgo),
            lastFailure: "refused",
          });
        };

      expect(
        ServerSendingStatusUtil.shouldWriteFailed(
          failing(intervalInMinutes - 1),
          "refused",
          NOW,
        ),
      ).toBe(false);
      expect(
        ServerSendingStatusUtil.shouldWriteFailed(
          failing(intervalInMinutes),
          "refused",
          NOW,
        ),
      ).toBe(true);
    });
  });

  test("a busy server writes a handful of times, not once per send", () => {
    const random: SeededRandom = seededRandom(6825);
    let remembered: ServerSendingHealthEntry = entry();
    let writes: number = 0;

    // A day of sends, one every 0-60 seconds, one in ten failing for one of two reasons.
    let at: number = NOW.getTime();

    for (let i: number = 0; i < 3000; i++) {
      at += random(60) * 1000;
      const now: Date = new Date(at);
      const fails: boolean = random(10) === 0;
      const reason: string = random(2) === 0 ? "refused" : "timed out";

      const isNews: boolean = fails
        ? ServerSendingStatusUtil.shouldWriteFailed(remembered, reason, now)
        : ServerSendingStatusUtil.shouldWriteSucceeded(remembered, now);

      if (isNews) {
        writes++;
        remembered = fails
          ? ServerSendingStatusUtil.withFailed(remembered, reason, now)
          : ServerSendingStatusUtil.withSucceeded(remembered, now);
      }
    }

    // Every write is a change of state or reason, or an hour's news.
    expect(writes).toBeGreaterThan(10);
    expect(writes).toBeLessThan(3000 / 4);
  });
});

describe("what the server reads back from the stored column", () => {
  test("known channels with their dates and reason; anything else is left out", () => {
    expect(
      ServerSendingStatusUtil.readHealth({
        email: {
          lastSucceededAt: "2026-11-10T10:00:00.000Z",
          lastFailedAt: "not a date",
          failingSince: 42,
          lastFailure: "  refused  ",
          extra: "ignored",
        },
        fax: { lastSucceededAt: "2026-11-10T10:00:00.000Z" },
        sms: "not an entry",
      }),
    ).toEqual({
      email: {
        lastSucceededAt: "2026-11-10T10:00:00.000Z",
        lastFailedAt: null,
        failingSince: null,
        lastFailure: "refused",
      },
    });
  });

  test.each([null, undefined, "text", 7, [], [{ email: {} }]])(
    "%p reads as nothing remembered",
    (stored: unknown) => {
      expect(ServerSendingStatusUtil.readHealth(stored)).toEqual({});
    },
  );

  test("a channel nothing is remembered for reads as an empty entry, a copy each time", () => {
    const first: ServerSendingHealthEntry = ServerSendingStatusUtil.getEntry(
      {},
      ServerSendingChannel.Call,
    );

    first.lastFailure = "changed";

    expect(
      ServerSendingStatusUtil.getEntry({}, ServerSendingChannel.Call),
    ).toEqual(entry());
  });

  test("every channel there is: email, SMS, calls and push", () => {
    expect([...SERVER_SENDING_CHANNELS]).toEqual([
      ServerSendingChannel.Email,
      ServerSendingChannel.SMS,
      ServerSendingChannel.Call,
      ServerSendingChannel.Push,
    ]);
  });
});

describe("what a browser reads of GET /global-config/sending-status", () => {
  const answer: ServerSendingStatusAnswer = {
    channels: [
      {
        channel: ServerSendingChannel.Email,
        state: ServerSendingState.Failing,
        hasWorked: true,
        lastWorkedAt: "2026-11-10T10:00:00.000Z",
        failingSince: "2026-11-11T10:00:00.000Z",
        lastFailure: "535 Authentication failed",
        setUpProblem: null,
      },
      {
        channel: ServerSendingChannel.SMS,
        state: ServerSendingState.NotSetUp,
        hasWorked: false,
        lastWorkedAt: null,
        failingSince: null,
        lastFailure: null,
        setUpProblem: "No Twilio account or SMS gateway is set up.",
      },
    ],
    globalProbes: { total: 2, reporting: 0 },
  };

  test("an answer reads back as it was sent", () => {
    expect(
      ServerSendingStatusUtil.parseAnswer(JSON.parse(JSON.stringify(answer))),
    ).toEqual(answer);
  });

  test.each([null, undefined, "text", [], {}, { channels: "x" }])(
    "%p is not an answer",
    (value: unknown) => {
      expect(ServerSendingStatusUtil.parseAnswer(value)).toBeNull();
    },
  );

  test("a row that is not a known channel and state is left out", () => {
    const parsed: ServerSendingStatusAnswer | null =
      ServerSendingStatusUtil.parseAnswer({
        channels: [
          { channel: "fax", state: "working" },
          { channel: "email", state: "on-fire" },
          "text",
          { channel: "push", state: "untested", hasWorked: "yes" },
        ],
        globalProbes: null,
      });

    expect(parsed).toEqual({
      channels: [
        {
          channel: ServerSendingChannel.Push,
          state: ServerSendingState.Untested,
          hasWorked: false,
          lastWorkedAt: null,
          failingSince: null,
          lastFailure: null,
          setUpProblem: null,
        },
      ],
      globalProbes: null,
    });
  });

  test("probe counts are whole, not negative, and never more reporting than there are", () => {
    expect(
      ServerSendingStatusUtil.parseAnswer({
        channels: [],
        globalProbes: { total: 3.7, reporting: 9 },
      })?.globalProbes,
    ).toEqual({ total: 3, reporting: 3 });

    expect(
      ServerSendingStatusUtil.parseAnswer({
        channels: [],
        globalProbes: { total: -1, reporting: "2" },
      })?.globalProbes,
    ).toEqual({ total: 0, reporting: 0 });
  });

  test("finds a channel's row", () => {
    expect(
      ServerSendingStatusUtil.getChannel(answer, ServerSendingChannel.SMS)
        ?.state,
    ).toBe(ServerSendingState.NotSetUp);
    expect(
      ServerSendingStatusUtil.getChannel(answer, ServerSendingChannel.Push),
    ).toBeNull();
  });

  test.each([
    [null, false],
    [{ total: 0, reporting: 0 }, false],
    [{ total: 2, reporting: 1 }, false],
    [{ total: 2, reporting: 0 }, true],
  ])(
    "global probes %j are silent: %p",
    (probes: { total: number; reporting: number } | null, expected: boolean) => {
      expect(ServerSendingStatusUtil.areGlobalProbesSilent(probes)).toBe(
        expected,
      );
    },
  );
});
