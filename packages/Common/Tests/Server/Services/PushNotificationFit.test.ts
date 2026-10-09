import { describe, expect, jest, test } from "@jest/globals";

// The relay sends only where Expo's access token is set.
jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return { __esModule: true, ...actual, ExpoAccessToken: "expo-token" };
});

import PushNotificationService from "../../../Server/Services/PushNotificationService";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import {
  MAX_PUSH_TEXT_BYTES,
  TRUNCATED_NAME_NOTE,
  TRUNCATED_TEXT_NOTE,
} from "../../../Utils/MessageFit";

/*
 * A PUSH NOTIFICATION EVERY PUSH SERVICE TAKES.
 *
 * Expo - and APNs and FCM behind it - and web push refuse a notification of
 * more than 4,096 bytes, and it is lost. A notification's title and body
 * can carry anything a template placed in them. fitMessage holds the texts
 * of a notification - its title, its body and the texts of its data - to
 * MAX_PUSH_TEXT_BYTES together, as JSON writes them in UTF-8, leaving the
 * rest of the payload room; the address it opens is never cut.
 */

// The bytes the texts of a message take, as JSON writes them.
function textBytes(message: PushNotificationMessage): number {
  return [
    message.title,
    message.body,
    ...Object.values(message.data || {}).filter((value: unknown): boolean => {
      return typeof value === "string";
    }),
  ].reduce((total: number, text: unknown): number => {
    return total + Buffer.byteLength(JSON.stringify(text), "utf8");
  }, 0);
}

describe("PushNotificationService.fitMessage", () => {
  test("a notification that fits is sent as it is", () => {
    const message: PushNotificationMessage = {
      title: "Incident #42 created",
      body: "Checkout is down.",
      data: { url: "/dashboard/project/incidents/42", type: "incident" },
    };

    expect(PushNotificationService.fitMessage(message)).toBe(message);
  });

  test("a body of megabytes is cut to fit, with the note; a short title stays whole", () => {
    const fitted: PushNotificationMessage = PushNotificationService.fitMessage({
      title: "Incident #42 created",
      body: `Checkout is down. ${"A long response body. ".repeat(100000)}`,
      data: { url: "https://oneuptime.example.com/incidents/42" },
    });

    expect(fitted.title).toBe("Incident #42 created");
    expect(fitted.body.startsWith("Checkout is down.")).toBe(true);
    expect(fitted.body.endsWith(TRUNCATED_TEXT_NOTE)).toBe(true);
    expect(textBytes(fitted)).toBeLessThanOrEqual(MAX_PUSH_TEXT_BYTES);
    // Where it opens is never cut.
    expect(fitted.data).toEqual({
      url: "https://oneuptime.example.com/incidents/42",
    });
  });

  test("a title and data texts of any length are cut too, a title with an ellipsis", () => {
    const fitted: PushNotificationMessage = PushNotificationService.fitMessage({
      title: `Incident: ${"a very long title ".repeat(500)}`,
      body: "障害".repeat(5000),
      data: { note: "x".repeat(10000), url: "/incidents/42", count: 3 },
    });

    expect(fitted.title.endsWith(TRUNCATED_NAME_NOTE)).toBe(true);
    expect(fitted.body.endsWith(TRUNCATED_TEXT_NOTE)).toBe(true);
    expect((fitted.data!["note"] as string).endsWith(TRUNCATED_NAME_NOTE)).toBe(
      true,
    );
    expect(fitted.data!["url"]).toBe("/incidents/42");
    expect(fitted.data!["count"]).toBe(3);
    expect(textBytes(fitted)).toBeLessThanOrEqual(MAX_PUSH_TEXT_BYTES);
    // The whole payload, with the rest of what a notification carries, fits.
    expect(Buffer.byteLength(JSON.stringify(fitted), "utf8")).toBeLessThan(
      4096,
    );
  });
});

describe("PushNotificationService.sendRelayPushNotification", () => {
  test("what another server relays is held to what Expo takes as well", async () => {
    const sent: Array<Record<string, unknown>> = [];

    jest
      .spyOn(
        PushNotificationService["expoClient"] as unknown as {
          sendPushNotificationsAsync: (
            messages: Array<Record<string, unknown>>,
          ) => Promise<Array<unknown>>;
        },
        "sendPushNotificationsAsync",
      )
      .mockImplementation(async (messages: Array<Record<string, unknown>>) => {
        sent.push(...messages);
        return [{ status: "ok", id: "ticket" }];
      });

    await PushNotificationService.sendRelayPushNotification({
      to: "ExponentPushToken[abc]",
      title: "Incident #42 created",
      body: "A long log line. ".repeat(10000),
      data: { url: "/incidents/42" },
    });

    expect(sent).toHaveLength(1);
    expect((sent[0]!["body"] as string).endsWith(TRUNCATED_TEXT_NOTE)).toBe(
      true,
    );
    expect(sent[0]!["data"]).toEqual({ url: "/incidents/42" });
    expect(Buffer.byteLength(JSON.stringify(sent[0]), "utf8")).toBeLessThan(
      4096,
    );
  });
});
