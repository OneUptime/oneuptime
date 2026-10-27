import {
  CALL_AND_SMS_GATEWAY_PAYLOAD_VERSION,
  CallAndSmsGatewayEvent,
  CallAndSmsGatewayMessageInput,
  MAX_CALL_AND_SMS_GATEWAY_MESSAGE_LENGTH,
  buildCallAndSmsGatewayMessagePayload,
  buildCallAndSmsGatewayTestPayload,
} from "../../../Types/CallAndSMS/CallAndSmsGatewayPayload";
import {
  CUSTOM_CHANNEL_PAYLOAD_VERSION,
  CustomChannelAction,
} from "../../../Types/CustomNotificationChannel/CustomNotificationChannelPayload";
import { JSONObject } from "../../../Types/JSON";
import {
  MAX_SMS_LENGTH,
  TRUNCATED_TEXT_NOTE,
  TRUNCATED_TEXT_NOTE_PLAIN,
} from "../../../Utils/MessageFit";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT AN SMS AND CALL GATEWAY RECEIVES.
 *
 * The request is a contract with a service OneUptime does not own - the
 * installation's own gateway - so its shape, its version, its three events
 * and every field the docs list are pinned here, as is the message: held to
 * MAX_CALL_AND_SMS_GATEWAY_MESSAGE_LENGTH however long a template made it,
 * ending with a note in characters every SMS encoding has.
 */

const SENT_AT: Date = new Date("2026-10-27T09:30:00.000Z");

const ACTIONS: Record<CustomChannelAction, string> = {
  [CustomChannelAction.Acknowledge]:
    "https://oneuptime.example.com/api/custom-notification-channel/page/n/acknowledge?token=t",
  [CustomChannelAction.Escalate]:
    "https://oneuptime.example.com/api/custom-notification-channel/page/n/escalate?token=t",
  [CustomChannelAction.Resolve]:
    "https://oneuptime.example.com/api/custom-notification-channel/page/n/resolve?token=t",
};

function messageInput(
  overrides: Partial<CallAndSmsGatewayMessageInput> = {},
): CallAndSmsGatewayMessageInput {
  return {
    event: CallAndSmsGatewayEvent.Sms,
    id: "7c5b0d0e-3e5f-4d1a-9a4f-2b8e6c1d9f00",
    sentAt: SENT_AT,
    to: "+15551234567",
    message:
      "OneUptime: A new alert has been created. Alert #42: Database is down",
    isSensitive: false,
    project: {
      id: "0f6b8c3a-1d2e-4f5a-8b9c-0d1e2f3a4b5c",
      name: "Production",
    },
    actions: ACTIONS,
    ...overrides,
  };
}

function messageOf(payload: JSONObject): string {
  return payload["message"] as string;
}

describe("the gateway's request: constants", () => {
  test("is version 1, as a custom channel's is", () => {
    expect(CALL_AND_SMS_GATEWAY_PAYLOAD_VERSION).toBe(1);
    expect(CALL_AND_SMS_GATEWAY_PAYLOAD_VERSION).toBe(
      CUSTOM_CHANNEL_PAYLOAD_VERSION,
    );
  });

  test("names its events sms, call and test, as the docs and X-OneUptime-Event spell them", () => {
    expect(CallAndSmsGatewayEvent.Sms).toBe("sms");
    expect(CallAndSmsGatewayEvent.Call).toBe("call");
    expect(CallAndSmsGatewayEvent.Test).toBe("test");
    expect(Object.values(CallAndSmsGatewayEvent).sort()).toEqual(
      ["call", "sms", "test"].sort(),
    );
  });

  test("carries a message of at most 16,384 characters, far more than an SMS takes", () => {
    expect(MAX_CALL_AND_SMS_GATEWAY_MESSAGE_LENGTH).toBe(16384);
    expect(MAX_CALL_AND_SMS_GATEWAY_MESSAGE_LENGTH).toBeGreaterThan(
      MAX_SMS_LENGTH,
    );
  });
});

describe("buildCallAndSmsGatewayMessagePayload", () => {
  test("an on-call page by SMS carries every field the docs list, in their order", () => {
    const payload: JSONObject =
      buildCallAndSmsGatewayMessagePayload(messageInput());

    expect(payload).toEqual({
      version: 1,
      event: "sms",
      id: "7c5b0d0e-3e5f-4d1a-9a4f-2b8e6c1d9f00",
      sentAt: "2026-10-27T09:30:00.000Z",
      to: "+15551234567",
      message:
        "OneUptime: A new alert has been created. Alert #42: Database is down",
      isSensitive: false,
      project: {
        id: "0f6b8c3a-1d2e-4f5a-8b9c-0d1e2f3a4b5c",
        name: "Production",
      },
      actions: {
        acknowledge: ACTIONS[CustomChannelAction.Acknowledge],
        escalate: ACTIONS[CustomChannelAction.Escalate],
        resolve: ACTIONS[CustomChannelAction.Resolve],
      },
    });
    expect(Object.keys(payload)).toEqual([
      "version",
      "event",
      "id",
      "sentAt",
      "to",
      "message",
      "isSensitive",
      "project",
      "actions",
    ]);
  });

  test("a call is the same shape, its event call", () => {
    const payload: JSONObject = buildCallAndSmsGatewayMessagePayload(
      messageInput({
        event: CallAndSmsGatewayEvent.Call,
        message: "A new incident has been created. Incident #7: API is down.",
      }),
    );

    expect(payload["event"]).toBe("call");
    expect(payload["message"]).toBe(
      "A new incident has been created. Incident #7: API is down.",
    );
    expect(Object.keys(payload)).toHaveLength(9);
  });

  test("a message that is not a page has no actions, and says null", () => {
    const payload: JSONObject = buildCallAndSmsGatewayMessagePayload(
      messageInput({ actions: undefined }),
    );

    expect(payload["actions"]).toBeNull();
    expect("actions" in payload).toBe(true);
  });

  test("a message no project sent - a sign-up's verification code - names no project, and says null", () => {
    const payload: JSONObject = buildCallAndSmsGatewayMessagePayload(
      messageInput({ project: undefined, actions: undefined }),
    );

    expect(payload["project"]).toBeNull();
    expect("project" in payload).toBe(true);
  });

  test("a verification code is marked sensitive, so the gateway keeps it out of its logs", () => {
    expect(
      buildCallAndSmsGatewayMessagePayload(
        messageInput({ isSensitive: true, message: "Your code is 123456" }),
      )["isSensitive"],
    ).toBe(true);
    expect(
      buildCallAndSmsGatewayMessagePayload(messageInput())["isSensitive"],
    ).toBe(false);
  });

  test("the project carries its id and name and nothing else it was handed", () => {
    const payload: JSONObject = buildCallAndSmsGatewayMessagePayload(
      messageInput({
        project: {
          id: "project-id",
          name: "Agency A",
          secret: "must not leak",
        } as unknown as CallAndSmsGatewayMessageInput["project"],
      }),
    );

    expect(payload["project"]).toEqual({ id: "project-id", name: "Agency A" });
  });

  test("the actions are the three links, and nothing else they were handed", () => {
    const payload: JSONObject = buildCallAndSmsGatewayMessagePayload(
      messageInput({
        actions: {
          ...ACTIONS,
          delete: "https://x/delete",
        } as unknown as CallAndSmsGatewayMessageInput["actions"],
      }),
    );

    expect(Object.keys(payload["actions"] as JSONObject)).toEqual([
      "acknowledge",
      "escalate",
      "resolve",
    ]);
  });

  test("the date is ISO 8601, in UTC", () => {
    expect(
      buildCallAndSmsGatewayMessagePayload(
        messageInput({ sentAt: new Date(Date.UTC(2031, 0, 2, 3, 4, 5, 6)) }),
      )["sentAt"],
    ).toBe("2031-01-02T03:04:05.006Z");
  });

  test("the id and number are carried exactly as given", () => {
    const payload: JSONObject = buildCallAndSmsGatewayMessagePayload(
      messageInput({ id: "the-sms-log-id", to: "+6581234567" }),
    );

    expect(payload["id"]).toBe("the-sms-log-id");
    expect(payload["to"]).toBe("+6581234567");
  });

  test("an empty message is sent as empty text, never undefined", () => {
    expect(
      messageOf(
        buildCallAndSmsGatewayMessagePayload(messageInput({ message: "" })),
      ),
    ).toBe("");
    expect(
      messageOf(
        buildCallAndSmsGatewayMessagePayload(
          messageInput({ message: undefined as unknown as string }),
        ),
      ),
    ).toBe("");
  });

  test("survives a round trip through JSON unchanged", () => {
    const payload: JSONObject =
      buildCallAndSmsGatewayMessagePayload(messageInput());

    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });
});

describe("the message, held to what a request carries", () => {
  test("a message of exactly the limit is sent as it is", () => {
    const message: string = "m".repeat(MAX_CALL_AND_SMS_GATEWAY_MESSAGE_LENGTH);

    expect(
      messageOf(
        buildCallAndSmsGatewayMessagePayload(messageInput({ message })),
      ),
    ).toBe(message);
  });

  test("one character over is cut, and ends with the note, in characters every SMS encoding has", () => {
    const message: string = "m".repeat(
      MAX_CALL_AND_SMS_GATEWAY_MESSAGE_LENGTH + 1,
    );
    const sent: string = messageOf(
      buildCallAndSmsGatewayMessagePayload(messageInput({ message })),
    );

    expect(sent.length).toBe(MAX_CALL_AND_SMS_GATEWAY_MESSAGE_LENGTH);
    expect(sent.endsWith(TRUNCATED_TEXT_NOTE_PLAIN)).toBe(true);
    // Not the note chat messages end with: "…" and "—" are not GSM 7-bit.
    expect(sent.endsWith(TRUNCATED_TEXT_NOTE)).toBe(false);
    expect(sent).not.toContain("…");
    expect(sent).not.toContain("—");
  });

  test("a call's description of megabytes is cut, in time linear in its length", () => {
    const message: string = "A new incident has been created.\n".repeat(
      200_000,
    );

    const timed: FastestRun<string> = fastestRun({
      run: (): string => {
        return messageOf(
          buildCallAndSmsGatewayMessagePayload(
            messageInput({ event: CallAndSmsGatewayEvent.Call, message }),
          ),
        );
      },
      limitInMs: 2000,
    });
    const sent: string = timed.result;

    expect(sent.length).toBeLessThanOrEqual(
      MAX_CALL_AND_SMS_GATEWAY_MESSAGE_LENGTH,
    );
    expect(sent.endsWith(TRUNCATED_TEXT_NOTE_PLAIN)).toBe(true);
    // Cut at a line break: the last sentence before the note is whole.
    expect(
      sent.slice(0, -TRUNCATED_TEXT_NOTE_PLAIN.length).endsWith("created."),
    ).toBe(true);
    expect(timed.inMs).toBeLessThan(2000);
  });

  test("one long line of emoji is cut between whole characters", () => {
    const message: string = "📟".repeat(
      MAX_CALL_AND_SMS_GATEWAY_MESSAGE_LENGTH,
    );
    const sent: string = messageOf(
      buildCallAndSmsGatewayMessagePayload(messageInput({ message })),
    );
    const beforeNote: string = sent.slice(0, -TRUNCATED_TEXT_NOTE_PLAIN.length);

    expect(sent.endsWith(TRUNCATED_TEXT_NOTE_PLAIN)).toBe(true);
    // Every emoji is two UTF-16 code units, so a whole cut has an even length.
    expect(beforeNote.length % 2).toBe(0);
    expect(message.startsWith(beforeNote)).toBe(true);
  });

  test("only the message is cut: the id, number, project and links stay whole", () => {
    const payload: JSONObject = buildCallAndSmsGatewayMessagePayload(
      messageInput({ message: "x".repeat(100_000) }),
    );

    expect(payload["id"]).toBe("7c5b0d0e-3e5f-4d1a-9a4f-2b8e6c1d9f00");
    expect(payload["to"]).toBe("+15551234567");
    expect(payload["project"]).toEqual({
      id: "0f6b8c3a-1d2e-4f5a-8b9c-0d1e2f3a4b5c",
      name: "Production",
    });
    expect((payload["actions"] as JSONObject)["resolve"]).toBe(
      ACTIONS[CustomChannelAction.Resolve],
    );
  });

  test("for messages of every length around the limit: as they are when they fit, else a prefix of them and the note", () => {
    const random: SeededRandom = seededRandom(16384);
    const alphabet: Array<string> = [
      "a",
      "Z",
      " ",
      "\n",
      "📟",
      "é",
      ".",
      "Incident ",
      "\n\n",
    ];
    const pieces: Array<string> = generatedTexts(300, 4096, alphabet, 40);

    for (let index: number = 0; index < pieces.length; index++) {
      // A text whose length lands anywhere from well under to well over the limit.
      const target: number =
        MAX_CALL_AND_SMS_GATEWAY_MESSAGE_LENGTH - 400 + random(800);
      let message: string = "";

      while (message.length < target) {
        message += pieces[random(pieces.length)] || "x";
      }

      const sent: string = messageOf(
        buildCallAndSmsGatewayMessagePayload(messageInput({ message })),
      );

      expect(sent.length).toBeLessThanOrEqual(
        MAX_CALL_AND_SMS_GATEWAY_MESSAGE_LENGTH,
      );

      if (message.length <= MAX_CALL_AND_SMS_GATEWAY_MESSAGE_LENGTH) {
        expect(sent).toBe(message);
        continue;
      }

      const beforeNote: string = sent.slice(
        0,
        -TRUNCATED_TEXT_NOTE_PLAIN.length,
      );

      expect(sent.endsWith(TRUNCATED_TEXT_NOTE_PLAIN)).toBe(true);
      expect(message.startsWith(beforeNote)).toBe(true);

      // Never half of an emoji before the note.
      const last: number = beforeNote.charCodeAt(beforeNote.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
  });
});

describe("buildCallAndSmsGatewayTestPayload", () => {
  test("is a test, in the same shape, to nobody, with nothing to act on", () => {
    const payload: JSONObject = buildCallAndSmsGatewayTestPayload({
      id: "test-id",
      sentAt: SENT_AT,
    });

    expect(payload).toEqual({
      version: 1,
      event: "test",
      id: "test-id",
      sentAt: "2026-10-27T09:30:00.000Z",
      to: null,
      message:
        "This is a test of your SMS and call gateway from OneUptime. Answer 2xx and send nothing.",
      isSensitive: false,
      project: null,
      actions: null,
    });
  });

  test("has every key a real message has, in the same order", () => {
    expect(
      Object.keys(
        buildCallAndSmsGatewayTestPayload({ id: "test-id", sentAt: SENT_AT }),
      ),
    ).toEqual(
      Object.keys(buildCallAndSmsGatewayMessagePayload(messageInput())),
    );
  });

  test("tells the gateway to answer 2xx and send nothing", () => {
    const message: string = messageOf(
      buildCallAndSmsGatewayTestPayload({ id: "test-id", sentAt: SENT_AT }),
    );

    expect(message).toContain("Answer 2xx and send nothing.");
    expect(message).toContain("OneUptime");
  });

  test("carries the id it was given, so a test can be told from another", () => {
    expect(
      buildCallAndSmsGatewayTestPayload({ id: "a", sentAt: SENT_AT })["id"],
    ).toBe("a");
    expect(
      buildCallAndSmsGatewayTestPayload({ id: "b", sentAt: SENT_AT })["id"],
    ).toBe("b");
  });
});
