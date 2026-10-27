import {
  CUSTOM_CHANNEL_ACTIONS,
  CUSTOM_CHANNEL_EVENT_HEADER,
  CUSTOM_CHANNEL_METHOD_LABEL,
  CUSTOM_CHANNEL_PAYLOAD_VERSION,
  CUSTOM_CHANNEL_SIGNATURE_HEADER,
  CustomChannelAction,
  CustomChannelActionResult,
  CustomChannelEvent,
  CustomChannelPageInput,
  CustomChannelRecordType,
  MAX_CUSTOM_CHANNEL_TEXT_LENGTH,
  buildCustomChannelPagePayload,
  buildCustomChannelTestPayload,
  getCustomChannelEventFor,
  isCustomChannelAction,
} from "../../../Types/CustomNotificationChannel/CustomNotificationChannelPayload";
import { JSONObject } from "../../../Types/JSON";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import { TRUNCATED_TEXT_NOTE } from "../../../Utils/MessageFit";
import { describe, expect, test } from "@jest/globals";

/*
 * What a custom channel's service receives is a contract with services
 * OneUptime does not own: its shape, its version, the four on-call events
 * and their record types, the three actions, and the text held to a budget
 * however long a description is.
 */

const SENT_AT: Date = new Date("2026-10-27T03:14:15.000Z");

function pageInput(
  overrides: Partial<CustomChannelPageInput> = {},
): CustomChannelPageInput {
  return {
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
      url: "https://oneuptime.example.com/dashboard/p/incidents/i",
    },
    onCallPolicy: { id: "policy-id", name: "Primary" },
    escalationRule: { id: "rule-id", name: "Level 1" },
    isPageAgain: false,
    actions: {
      [CustomChannelAction.Acknowledge]: "https://x/acknowledge",
      [CustomChannelAction.Escalate]: "https://x/escalate",
      [CustomChannelAction.Resolve]: "https://x/resolve",
    },
    ...overrides,
  };
}

describe("custom channel payload constants", () => {
  test("the payload is version 1", () => {
    expect(CUSTOM_CHANNEL_PAYLOAD_VERSION).toBe(1);
  });

  test("the headers are the ones the docs name", () => {
    expect(CUSTOM_CHANNEL_EVENT_HEADER).toBe("X-OneUptime-Event");
    expect(CUSTOM_CHANNEL_SIGNATURE_HEADER).toBe("X-OneUptime-Signature");
  });

  test("a channel is named Custom Channel among the methods", () => {
    expect(CUSTOM_CHANNEL_METHOD_LABEL).toBe("Custom Channel");
  });

  test("the events are spelled as the docs spell them", () => {
    expect(Object.values(CustomChannelEvent).sort()).toEqual(
      [
        "on-call.alert.created",
        "on-call.alertEpisode.created",
        "on-call.incident.created",
        "on-call.incidentEpisode.created",
        "test",
      ].sort(),
    );
  });

  test("the action results are spelled as the docs spell them", () => {
    expect(Object.values(CustomChannelActionResult).sort()).toEqual(
      [
        "acknowledged",
        "alreadyAcknowledged",
        "alreadyResolved",
        "escalated",
        "notEscalated",
        "resolved",
      ].sort(),
    );
  });
});

describe("isCustomChannelAction", () => {
  test.each(["acknowledge", "escalate", "resolve"])(
    "takes %s",
    (action: string) => {
      expect(isCustomChannelAction(action)).toBe(true);
    },
  );

  test.each([
    "ack",
    "Acknowledge",
    "RESOLVE",
    "delete",
    "",
    "acknowledge ",
    "__proto__",
    "constructor",
  ])("refuses %p", (action: string) => {
    expect(isCustomChannelAction(action)).toBe(false);
  });

  test.each([undefined, null, 1, {}, [], true])(
    "refuses %p",
    (value: unknown) => {
      expect(isCustomChannelAction(value)).toBe(false);
    },
  );

  test("there are exactly three actions", () => {
    expect([...CUSTOM_CHANNEL_ACTIONS]).toEqual([
      CustomChannelAction.Acknowledge,
      CustomChannelAction.Escalate,
      CustomChannelAction.Resolve,
    ]);
  });
});

describe("getCustomChannelEventFor", () => {
  test.each([
    [
      UserNotificationEventType.IncidentCreated,
      CustomChannelEvent.IncidentCreated,
      CustomChannelRecordType.Incident,
    ],
    [
      UserNotificationEventType.AlertCreated,
      CustomChannelEvent.AlertCreated,
      CustomChannelRecordType.Alert,
    ],
    [
      UserNotificationEventType.IncidentEpisodeCreated,
      CustomChannelEvent.IncidentEpisodeCreated,
      CustomChannelRecordType.IncidentEpisode,
    ],
    [
      UserNotificationEventType.AlertEpisodeCreated,
      CustomChannelEvent.AlertEpisodeCreated,
      CustomChannelRecordType.AlertEpisode,
    ],
  ])(
    "%s is %s about an %s",
    (
      eventType: UserNotificationEventType,
      event: CustomChannelEvent,
      recordType: CustomChannelRecordType,
    ) => {
      expect(getCustomChannelEventFor(eventType)).toEqual({
        event: event,
        recordType: recordType,
      });
    },
  );

  test("every on-call event type has an event", () => {
    for (const eventType of Object.values(UserNotificationEventType)) {
      expect(getCustomChannelEventFor(eventType).event).toBeTruthy();
    }
  });
});

describe("buildCustomChannelPagePayload", () => {
  test("carries everything the docs list, in its shape", () => {
    expect(buildCustomChannelPagePayload(pageInput())).toEqual({
      version: 1,
      event: "on-call.incident.created",
      notificationId: "5f2c8a1e-6b1d-4c3a-9e7f-2a4b6c8d0e1f",
      sentAt: "2026-10-27T03:14:15.000Z",
      channel: { id: "channel-id", name: "CorpoApp" },
      title: "New Incident INC-42: API latency high",
      message: "A new incident has been created.",
      project: { id: "project-id", name: "Agency A" },
      team: { id: "team-id", name: "SRE" },
      user: { id: "user-id", name: "Jane Tan", email: "jane@example.com" },
      recordType: "incident",
      record: {
        id: "incident-id",
        number: "INC-42",
        title: "API latency high",
        description: "p95 above 2 seconds.",
        severity: "Critical",
        state: "Created",
        url: "https://oneuptime.example.com/dashboard/p/incidents/i",
      },
      onCallPolicy: { id: "policy-id", name: "Primary" },
      escalationRule: { id: "rule-id", name: "Level 1" },
      isPageAgain: false,
      actions: {
        acknowledge: "https://x/acknowledge",
        escalate: "https://x/escalate",
        resolve: "https://x/resolve",
      },
    });
  });

  test("a page made directly, with no team, policy or rule, says null", () => {
    const payload: JSONObject = buildCustomChannelPagePayload(
      pageInput({
        team: undefined,
        onCallPolicy: undefined,
        escalationRule: undefined,
      }),
    );

    expect(payload["team"]).toBeNull();
    expect(payload["onCallPolicy"]).toBeNull();
    expect(payload["escalationRule"]).toBeNull();
  });

  test("a page again says so", () => {
    expect(
      buildCustomChannelPagePayload(pageInput({ isPageAgain: true }))[
        "isPageAgain"
      ],
    ).toBe(true);
  });

  test.each(Object.values(CustomChannelRecordType))(
    "names a %s record",
    (recordType: CustomChannelRecordType) => {
      expect(
        buildCustomChannelPagePayload(pageInput({ recordType: recordType }))[
          "recordType"
        ],
      ).toBe(recordType);
    },
  );

  test("carries the actions it is given and no others", () => {
    const actions: JSONObject = buildCustomChannelPagePayload(pageInput())[
      "actions"
    ] as JSONObject;

    expect(Object.keys(actions).sort()).toEqual(
      ["acknowledge", "escalate", "resolve"].sort(),
    );
  });

  test("survives a round trip through JSON unchanged", () => {
    const payload: JSONObject = buildCustomChannelPagePayload(pageInput());

    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });

  test("texts within the budget are sent exactly as they are", () => {
    const description: string = "x".repeat(1000);
    const payload: JSONObject = buildCustomChannelPagePayload(
      pageInput({
        record: { ...pageInput().record, description: description },
      }),
    );

    expect((payload["record"] as JSONObject)["description"]).toBe(description);
  });

  test("a description of megabytes is cut, ends with the note, and the title stays whole", () => {
    const description: string = "log line\n".repeat(500_000);
    const title: string = "New Incident INC-42: API latency high";

    const startedAt: number = Date.now();
    const payload: JSONObject = buildCustomChannelPagePayload(
      pageInput({
        title: title,
        record: { ...pageInput().record, description: description },
      }),
    );
    const tookMs: number = Date.now() - startedAt;

    const sent: string = (payload["record"] as JSONObject)[
      "description"
    ] as string;

    expect(payload["title"]).toBe(title);
    expect(sent.length).toBeLessThan(description.length);
    expect(sent.endsWith(TRUNCATED_TEXT_NOTE)).toBe(true);
    expect(
      (payload["title"] as string).length +
        (payload["message"] as string).length +
        sent.length,
    ).toBeLessThanOrEqual(MAX_CUSTOM_CHANNEL_TEXT_LENGTH);
    // Linear in its input: megabytes in well under a second on any machine.
    expect(tookMs).toBeLessThan(2000);
  });

  test("a description of one long line is cut without breaking a character", () => {
    const description: string = "🚨".repeat(200_000);
    const payload: JSONObject = buildCustomChannelPagePayload(
      pageInput({
        record: { ...pageInput().record, description: description },
      }),
    );

    const sent: string = (payload["record"] as JSONObject)[
      "description"
    ] as string;
    const beforeNote: string = sent.slice(0, -TRUNCATED_TEXT_NOTE.length);

    expect(sent.endsWith(TRUNCATED_TEXT_NOTE)).toBe(true);
    // Every emoji is two UTF-16 code units, so a whole cut has an even length.
    expect(beforeNote.trimEnd().length % 2).toBe(0);
  });

  test("an over-long title and message are held to the budget too", () => {
    const payload: JSONObject = buildCustomChannelPagePayload(
      pageInput({
        title: "t".repeat(40_000),
        message: "m".repeat(40_000),
        record: { ...pageInput().record, description: "d".repeat(40_000) },
      }),
    );

    const total: number =
      (payload["title"] as string).length +
      (payload["message"] as string).length +
      ((payload["record"] as JSONObject)["description"] as string).length;

    expect(total).toBeLessThanOrEqual(MAX_CUSTOM_CHANNEL_TEXT_LENGTH);
  });

  test("the date is ISO 8601 in UTC", () => {
    expect(buildCustomChannelPagePayload(pageInput())["sentAt"]).toBe(
      "2026-10-27T03:14:15.000Z",
    );
  });
});

describe("buildCustomChannelTestPayload", () => {
  const user: { id: string; name: string; email: string } = {
    id: "user-id",
    name: "Jane Tan",
    email: "jane@example.com",
  };

  test("is a test, in the same shape, with nothing to act on", () => {
    const payload: JSONObject = buildCustomChannelTestPayload({
      sentAt: SENT_AT,
      channel: { id: "channel-id", name: "CorpoApp" },
      user: user,
    });

    expect(payload["version"]).toBe(1);
    expect(payload["event"]).toBe("test");
    expect(payload["notificationId"]).toBeNull();
    expect(payload["record"]).toBeNull();
    expect(payload["recordType"]).toBeNull();
    expect(payload["actions"]).toBeNull();
    expect(payload["team"]).toBeNull();
    expect(payload["onCallPolicy"]).toBeNull();
    expect(payload["escalationRule"]).toBeNull();
    expect(payload["isPageAgain"]).toBe(false);
    expect(payload["user"]).toEqual(user);
    expect(payload["channel"]).toEqual({ id: "channel-id", name: "CorpoApp" });
    expect(payload["sentAt"]).toBe("2026-10-27T03:14:15.000Z");
  });

  test("names the channel and the person in words", () => {
    const payload: JSONObject = buildCustomChannelTestPayload({
      sentAt: SENT_AT,
      channel: { id: "channel-id", name: "CorpoApp" },
      user: user,
    });

    expect(payload["title"]).toContain("CorpoApp");
    expect(payload["message"]).toContain("CorpoApp");
    expect(payload["message"]).toContain("Jane Tan");
  });

  test("names a person with no name by their email", () => {
    const payload: JSONObject = buildCustomChannelTestPayload({
      sentAt: SENT_AT,
      channel: { id: "channel-id", name: "CorpoApp" },
      user: { ...user, name: "" },
    });

    expect(payload["message"]).toContain("jane@example.com");
  });

  test("carries the project a member's test was sent in", () => {
    const payload: JSONObject = buildCustomChannelTestPayload({
      sentAt: SENT_AT,
      channel: { id: "channel-id", name: "CorpoApp" },
      user: user,
      project: { id: "project-id", name: "Agency A" },
    });

    expect(payload["project"]).toEqual({ id: "project-id", name: "Agency A" });
  });

  test("an admin's test names no project", () => {
    const payload: JSONObject = buildCustomChannelTestPayload({
      sentAt: SENT_AT,
      channel: { id: "channel-id", name: "CorpoApp" },
      user: user,
    });

    expect(payload["project"]).toBeNull();
  });
});
