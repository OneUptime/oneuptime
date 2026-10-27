import {
  CUSTOM_CHANNEL_PAYLOAD_VERSION,
  CustomChannelAction,
  CustomChannelEvent,
  CustomChannelNotificationInput,
  CustomChannelPerson,
  CustomChannelRecordType,
  CustomChannelReference,
  MAX_CUSTOM_CHANNEL_TEXT_LENGTH,
  buildCustomChannelNotificationPayload,
  buildCustomChannelPagePayload,
  buildCustomChannelTestPayload,
} from "../../../Types/CustomNotificationChannel/CustomNotificationChannelPayload";
import { JSONObject } from "../../../Types/JSON";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import { TRUNCATED_TEXT_NOTE } from "../../../Utils/MessageFit";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * A notification that is not a page - an owner's, a note posted, a shift
 * starting - through a custom channel (buildCustomChannelNotificationPayload).
 * The body is part of the same contract as a page's: the page's shape, field
 * for field and in the same order, with no record, nothing to act on, and two
 * fields of its own at the end - the setting it was sent for
 * (`notificationType`) and where it links (`url`, null when nowhere). Its
 * title and message are held to the page's budget together, the longest cut
 * first, so a title stays whole when a megabyte message is cut.
 */

const SENT_AT: Date = new Date("2026-10-27T03:20:00.000Z");

const STATE_CHANGED: NotificationSettingEventType =
  NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION;

const INCIDENT_URL: string =
  "https://oneuptime.example.com/dashboard/8d1f/incidents/9a3c";

function notificationInput(
  overrides: Partial<CustomChannelNotificationInput> = {},
): CustomChannelNotificationInput {
  return {
    sentAt: SENT_AT,
    channel: { id: "channel-id", name: "CorpoApp" },
    notificationType: STATE_CHANGED,
    title: "Incident INC-42 acknowledged",
    message: "Incident INC-42 (API latency high) was acknowledged in Agency A.",
    url: INCIDENT_URL,
    project: { id: "project-id", name: "Agency A" },
    user: { id: "user-id", name: "Jane Tan", email: "jane@example.com" },
    ...overrides,
  };
}

function build(
  overrides: Partial<CustomChannelNotificationInput> = {},
): JSONObject {
  return buildCustomChannelNotificationPayload(notificationInput(overrides));
}

// A page's body, for the shape the notification's must keep.
function pagePayload(): JSONObject {
  return buildCustomChannelPagePayload({
    event: CustomChannelEvent.IncidentCreated,
    notificationId: "5f2c8a1e-6b1d-4c3a-9e7f-2a4b6c8d0e1f",
    sentAt: SENT_AT,
    channel: { id: "channel-id", name: "CorpoApp" },
    title: "New Incident INC-42: API latency high",
    message: "A new incident has been created.",
    project: { id: "project-id", name: "Agency A" },
    team: { id: "team-id", name: "SRE" },
    user: { id: "user-id", name: "Jane Tan", email: "jane@example.com" },
    recordType: CustomChannelRecordType.Incident,
    record: {
      id: "incident-id",
      number: "INC-42",
      title: "API latency high",
      description: "p95 above 2 seconds.",
      severity: "Critical",
      state: "Created",
      url: INCIDENT_URL,
    },
    onCallPolicy: { id: "policy-id", name: "Primary" },
    escalationRule: { id: "rule-id", name: "Level 1" },
    isPageAgain: false,
    actions: {
      [CustomChannelAction.Acknowledge]: "https://x/acknowledge",
      [CustomChannelAction.Escalate]: "https://x/escalate",
      [CustomChannelAction.Resolve]: "https://x/resolve",
    },
  });
}

function textsOf(payload: JSONObject): { title: string; message: string } {
  return {
    title: payload["title"] as string,
    message: payload["message"] as string,
  };
}

// What a cut text kept of its original, without the note it ends with.
function keptOf(sent: string): string {
  return sent.slice(0, -TRUNCATED_TEXT_NOTE.length);
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/*
 * The pieces generated texts are made of: words, line breaks, runs of
 * spaces, accented and CJK characters, emoji of two code units and one
 * joined from two, and the Markdown punctuation a log is full of.
 */
const PIECES: ReadonlyArray<string> = [
  "word ",
  "x",
  "\n",
  "  ",
  "é",
  "漢字",
  "🚨",
  "👩‍💻",
  "|",
  "`",
  "log line\n",
  '{"status":503}',
];

/*
 * A text of at least `length` code units drawn from PIECES, built in runs
 * of one piece so a long one costs few draws. Never sliced, so it never
 * ends in half an emoji.
 */
function drawText(random: SeededRandom, length: number): string {
  let text: string = "";

  while (text.length < length) {
    text += PIECES[random(PIECES.length)]!.repeat(1 + random(64));
  }

  return text;
}

describe("the notification event", () => {
  test("is spelled notification, as the docs spell it", () => {
    expect(CustomChannelEvent.Notification).toBe("notification");
  });

  test("is not an on-call event, so a service routing pages by their prefix never takes it for one", () => {
    expect(CustomChannelEvent.Notification.startsWith("on-call.")).toBe(false);
    expect(CustomChannelEvent.Notification).not.toBe(CustomChannelEvent.Test);
  });
});

describe("buildCustomChannelNotificationPayload", () => {
  test("carries everything the docs list, in its shape", () => {
    expect(build()).toEqual({
      version: 1,
      event: "notification",
      notificationId: null,
      sentAt: "2026-10-27T03:20:00.000Z",
      channel: { id: "channel-id", name: "CorpoApp" },
      title: "Incident INC-42 acknowledged",
      message:
        "Incident INC-42 (API latency high) was acknowledged in Agency A.",
      project: { id: "project-id", name: "Agency A" },
      team: null,
      user: { id: "user-id", name: "Jane Tan", email: "jane@example.com" },
      recordType: null,
      record: null,
      onCallPolicy: null,
      escalationRule: null,
      isPageAgain: false,
      actions: null,
      notificationType:
        "Send incident state changed notification when I am the owner of the incident",
      url: INCIDENT_URL,
    });
  });

  test("keeps a page's fields in a page's order, and adds its own two at the end", () => {
    expect(Object.keys(build())).toEqual([
      ...Object.keys(pagePayload()),
      "notificationType",
      "url",
    ]);
  });

  test("keeps the test request's fields too, so a service tried against Send test reads it", () => {
    const testPayload: JSONObject = buildCustomChannelTestPayload({
      sentAt: SENT_AT,
      channel: { id: "channel-id", name: "CorpoApp" },
      user: { id: "user-id", name: "Jane Tan", email: "jane@example.com" },
    });

    expect(Object.keys(build())).toEqual([
      ...Object.keys(testPayload),
      "notificationType",
      "url",
    ]);
  });

  test("has no record, team, policy or rule, and nothing to act on", () => {
    const payload: JSONObject = build();

    expect(payload["notificationId"]).toBeNull();
    expect(payload["team"]).toBeNull();
    expect(payload["recordType"]).toBeNull();
    expect(payload["record"]).toBeNull();
    expect(payload["onCallPolicy"]).toBeNull();
    expect(payload["escalationRule"]).toBeNull();
    expect(payload["actions"]).toBeNull();
    // Not a page, so never a page again: false, as a test's, not null.
    expect(payload["isPageAgain"]).toBe(false);
  });

  test("is payload version 1, the version every request carries", () => {
    expect(build()["version"]).toBe(CUSTOM_CHANNEL_PAYLOAD_VERSION);
    expect(CUSTOM_CHANNEL_PAYLOAD_VERSION).toBe(1);
  });

  test.each(Object.values(NotificationSettingEventType))(
    "sent for %p, it is the notification event and names that setting exactly",
    (eventType: NotificationSettingEventType) => {
      const payload: JSONObject = build({ notificationType: eventType });

      expect(payload["event"]).toBe(CustomChannelEvent.Notification);
      expect(payload["notificationType"]).toBe(eventType);
    },
  );

  test("carries a notification type as it is given, whatever its characters", () => {
    expect(
      build({ notificationType: 'Ünïcode — "quoted" <b>type</b>' })[
        "notificationType"
      ],
    ).toBe('Ünïcode — "quoted" <b>type</b>');
  });

  describe("its link", () => {
    test("is carried as it is", () => {
      expect(build({ url: INCIDENT_URL })["url"]).toBe(INCIDENT_URL);
    });

    test("is null when the notification links nowhere: a key that is there, never left out", () => {
      const payload: JSONObject = build({ url: undefined });

      expect(payload["url"]).toBeNull();
      expect(Object.keys(payload)).toContain("url");
      expect(JSON.stringify(payload)).toContain('"url":null');
    });

    test("is null for an empty link too", () => {
      expect(build({ url: "" })["url"]).toBeNull();
    });

    test("is never cut, however long the texts beside it", () => {
      const longUrl: string = `${INCIDENT_URL}?${"q=1&".repeat(2000)}`;
      const payload: JSONObject = build({
        url: longUrl,
        title: "t".repeat(40_000),
        message: "m".repeat(40_000),
      });

      expect(payload["url"]).toBe(longUrl);
    });
  });

  describe("the channel, project and person", () => {
    test("are carried as they are given", () => {
      const payload: JSONObject = build({
        channel: { id: "c-1", name: "Pager" },
        project: { id: "p-1", name: "Agency B" },
        user: { id: "u-1", name: "Sam Lee", email: "sam@example.com" },
      });

      expect(payload["channel"]).toEqual({ id: "c-1", name: "Pager" });
      expect(payload["project"]).toEqual({ id: "p-1", name: "Agency B" });
      expect(payload["user"]).toEqual({
        id: "u-1",
        name: "Sam Lee",
        email: "sam@example.com",
      });
    });

    test("a person with no name keeps an empty name beside their email, not a made-up one", () => {
      const payload: JSONObject = build({
        user: { id: "u-1", name: "", email: "sam@example.com" },
      });

      expect(payload["user"]).toEqual({
        id: "u-1",
        name: "",
        email: "sam@example.com",
      });
    });

    test("a project whose name could not be read keeps an empty name", () => {
      expect(build({ project: { id: "p-1", name: "" } })["project"]).toEqual({
        id: "p-1",
        name: "",
      });
    });

    test("carry only their id, name and email, whatever else the objects they come from hold", () => {
      const channel: CustomChannelReference = {
        id: "c-1",
        name: "Pager",
        webhookUrl: "https://internal.example.com/secret-hook",
        secret: "s3cr3t",
      } as CustomChannelReference;
      const project: CustomChannelReference = {
        id: "p-1",
        name: "Agency B",
        apiKey: "project-api-key",
      } as CustomChannelReference;
      const user: CustomChannelPerson = {
        id: "u-1",
        name: "Sam Lee",
        email: "sam@example.com",
        password: "hunter2",
      } as CustomChannelPerson;

      const payload: JSONObject = build({ channel, project, user });

      expect(Object.keys(payload["channel"] as JSONObject)).toEqual([
        "id",
        "name",
      ]);
      expect(Object.keys(payload["project"] as JSONObject)).toEqual([
        "id",
        "name",
      ]);
      expect(Object.keys(payload["user"] as JSONObject)).toEqual([
        "id",
        "name",
        "email",
      ]);

      const json: string = JSON.stringify(payload);

      for (const leak of [
        "secret-hook",
        "s3cr3t",
        "project-api-key",
        "hunter2",
      ]) {
        expect(json).not.toContain(leak);
      }
    });

    test("are copies: changing the input afterwards changes nothing that was built", () => {
      const input: CustomChannelNotificationInput = notificationInput();
      const payload: JSONObject = buildCustomChannelNotificationPayload(input);

      input.channel.name = "Renamed";
      input.project.name = "Renamed";
      input.user.email = "someone-else@example.com";

      expect(payload["channel"]).toEqual({
        id: "channel-id",
        name: "CorpoApp",
      });
      expect(payload["project"]).toEqual({
        id: "project-id",
        name: "Agency A",
      });
      expect((payload["user"] as JSONObject)["email"]).toBe("jane@example.com");
    });
  });

  test("leaves the input it is given as it was", () => {
    const input: CustomChannelNotificationInput = notificationInput({
      message: "m".repeat(40_000),
    });
    const before: string = JSON.stringify(input);

    buildCustomChannelNotificationPayload(input);

    expect(JSON.stringify(input)).toBe(before);
  });

  test("the date is ISO 8601 in UTC, to the millisecond, whatever offset it was made with", () => {
    expect(
      build({ sentAt: new Date("2026-10-27T05:20:00.123+02:00") })["sentAt"],
    ).toBe("2026-10-27T03:20:00.123Z");
  });

  test("survives a round trip through JSON unchanged", () => {
    const payload: JSONObject = build();

    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });

  test("survives the round trip with no link, and with texts that were cut", () => {
    const payload: JSONObject = build({
      url: undefined,
      message: "🚨 log line\n".repeat(20_000),
    });

    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });
});

describe("the notification's text budget", () => {
  test("is the page's: 16,384 characters for the title and message together", () => {
    expect(MAX_CUSTOM_CHANNEL_TEXT_LENGTH).toBe(16384);
  });

  test("texts within the budget are sent exactly as they are", () => {
    const message: string = "x".repeat(10_000);
    const payload: JSONObject = build({ title: "Short title", message });

    expect(textsOf(payload)).toEqual({ title: "Short title", message });
  });

  test("texts that come to the budget exactly are not cut, and one character more is", () => {
    const title: string = "Incident INC-42 acknowledged";
    const atBudget: string = "y".repeat(
      MAX_CUSTOM_CHANNEL_TEXT_LENGTH - title.length,
    );

    expect(textsOf(build({ title, message: atBudget }))).toEqual({
      title,
      message: atBudget,
    });

    const overBudget: JSONObject = build({ title, message: `${atBudget}y` });

    expect(overBudget["title"]).toBe(title);
    expect(
      (overBudget["message"] as string).endsWith(TRUNCATED_TEXT_NOTE),
    ).toBe(true);
  });

  test("an empty title and message stay empty strings, never null", () => {
    expect(textsOf(build({ title: "", message: "" }))).toEqual({
      title: "",
      message: "",
    });
  });

  test("a message of megabytes is cut, ends with the note, and the title stays whole", () => {
    const title: string = "Incident INC-42 acknowledged";
    const message: string = "log line\n".repeat(500_000);

    const timed: FastestRun<JSONObject> = fastestRun({
      run: (): JSONObject => {
        return build({ title, message });
      },
      limitInMs: 2000,
    });

    const sent: { title: string; message: string } = textsOf(timed.result);

    expect(sent.title).toBe(title);
    expect(sent.message.length).toBeLessThan(message.length);
    expect(sent.message.endsWith(TRUNCATED_TEXT_NOTE)).toBe(true);
    expect(message.startsWith(keptOf(sent.message))).toBe(true);
    expect(sent.title.length + sent.message.length).toBeLessThanOrEqual(
      MAX_CUSTOM_CHANNEL_TEXT_LENGTH,
    );
    // Linear in its input: megabytes in well under a second on any machine.
    expect(timed.inMs).toBeLessThan(2000);
  });

  test("a title of megabytes is cut and the message stays whole", () => {
    const title: string = "T".repeat(2_000_000);
    const message: string = "A short message.";

    const sent: { title: string; message: string } = textsOf(
      build({ title, message }),
    );

    expect(sent.message).toBe(message);
    expect(sent.title.endsWith(TRUNCATED_TEXT_NOTE)).toBe(true);
    expect(sent.title.length + sent.message.length).toBeLessThanOrEqual(
      MAX_CUSTOM_CHANNEL_TEXT_LENGTH,
    );
  });

  test("an over-long title and message are both cut to about the same size, each ending with the note", () => {
    const sent: { title: string; message: string } = textsOf(
      build({ title: "t".repeat(40_000), message: "m".repeat(40_000) }),
    );

    expect(sent.title.endsWith(TRUNCATED_TEXT_NOTE)).toBe(true);
    expect(sent.message.endsWith(TRUNCATED_TEXT_NOTE)).toBe(true);
    expect(sent.title.length).toBe(sent.message.length);
    expect(sent.title.length + sent.message.length).toBeLessThanOrEqual(
      MAX_CUSTOM_CHANNEL_TEXT_LENGTH,
    );
  });

  test("a message of one long line of emoji is cut without breaking a character", () => {
    const message: string = "🚨".repeat(200_000);
    const sent: string = build({ message })["message"] as string;
    const kept: string = keptOf(sent);

    expect(sent.endsWith(TRUNCATED_TEXT_NOTE)).toBe(true);
    // Every emoji is two UTF-16 code units, so a whole cut has an even length.
    expect(kept.trimEnd().length % 2).toBe(0);
    expect(isHighSurrogate(kept.charCodeAt(kept.length - 1))).toBe(false);
  });

  test("a message of many lines is cut at a line break, never inside a line", () => {
    const line: string = "2026-10-27T03:20:00Z GET /api/health 503";
    const message: string = `${line}\n`.repeat(5_000);
    const kept: string = keptOf(build({ message })["message"] as string);

    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length % (line.length + 1)).toBe(line.length);
    expect(kept.endsWith(line)).toBe(true);
  });

  test("a title kept whole beside messages of every length the seed draws, from just over the budget to megabytes", () => {
    const random: SeededRandom = seededRandom(20261027);
    const title: string = "Incident INC-42 (API latency high) acknowledged";

    for (let draw: number = 0; draw < 30; draw++) {
      const message: string = drawText(
        random,
        MAX_CUSTOM_CHANNEL_TEXT_LENGTH + random(1_500_000),
      );
      const sent: { title: string; message: string } = textsOf(
        build({ title, message }),
      );

      expect({ draw, title: sent.title }).toEqual({ draw, title });
      expect({
        draw,
        endsWithNote: sent.message.endsWith(TRUNCATED_TEXT_NOTE),
        isPrefix: message.startsWith(keptOf(sent.message)),
        fits:
          sent.title.length + sent.message.length <=
          MAX_CUSTOM_CHANNEL_TEXT_LENGTH,
      }).toEqual({ draw, endsWithNote: true, isPrefix: true, fits: true });
    }
  });

  /*
   * Generated titles and messages of every size, against what the budget
   * promises: within it nothing changes; over it they fit, the shorter one
   * - when it is a short text - comes through whole, and whatever is cut is
   * the start of the original, never broken inside a character, ending with
   * the note.
   */
  test("holds 300 generated titles and messages to the budget, the shorter one whole", () => {
    const random: SeededRandom = seededRandom(16384);
    const failures: Array<string> = [];

    for (let draw: number = 0; draw < 300; draw++) {
      const title: string =
        random(4) === 0
          ? drawText(random, random(30_000))
          : drawText(random, random(400));
      const message: string =
        random(3) === 0
          ? drawText(random, random(120_000))
          : drawText(random, random(20_000));

      const sent: { title: string; message: string } = textsOf(
        build({ title, message }),
      );
      const fail: (problem: string) => void = (problem: string): void => {
        failures.push(
          `draw ${draw} (title ${title.length}, message ${message.length}): ${problem}`,
        );
      };

      if (
        sent.title.length + sent.message.length >
        MAX_CUSTOM_CHANNEL_TEXT_LENGTH
      ) {
        fail("over the budget");
      }

      if (title.length + message.length <= MAX_CUSTOM_CHANNEL_TEXT_LENGTH) {
        if (sent.title !== title || sent.message !== message) {
          fail("changed although within the budget");
        }
        continue;
      }

      const pairs: Array<[string, string, string]> = [
        ["title", title, sent.title],
        ["message", message, sent.message],
      ];
      let cutCount: number = 0;

      for (const [name, original, result] of pairs) {
        if (result === original) {
          continue;
        }

        cutCount++;

        if (!result.endsWith(TRUNCATED_TEXT_NOTE)) {
          fail(`the ${name} was cut without the note`);
        }

        const kept: string = keptOf(result);

        if (!original.startsWith(kept)) {
          fail(`the ${name} kept something other than its start`);
        }

        if (
          kept.length > 0 &&
          isHighSurrogate(kept.charCodeAt(kept.length - 1))
        ) {
          fail(`the ${name} was cut inside a character`);
        }
      }

      if (cutCount === 0) {
        fail("over the budget, yet nothing was cut");
      }

      const shorter: string = title.length <= message.length ? title : message;
      const shorterSent: string =
        title.length <= message.length ? sent.title : sent.message;

      if (
        shorter.length <= MAX_CUSTOM_CHANNEL_TEXT_LENGTH / 4 &&
        shorterSent !== shorter
      ) {
        fail("the shorter text was cut");
      }
    }

    expect(failures).toEqual([]);
  });
});
