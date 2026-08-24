import crypto from "crypto";
import { beforeEach, describe, expect, test } from "@jest/globals";

let mockUrl: string = "";
let mockSecret: string = "";

jest.mock("../../../../Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    get MarketingWebhookUrl(): string {
      return mockUrl;
    },
    get MarketingWebhookSecret(): string {
      return mockSecret;
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
  };
});

const mockPost: jest.Mock = jest.fn();

jest.mock("axios", () => {
  class MockAxiosError extends Error {
    public response?: { status: number; data: unknown } | undefined;
  }

  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return mockPost(...args);
      },
    },
    AxiosError: MockAxiosError,
  };
});

import MarketingEventWebhook from "../../../../Server/Utils/Marketing/MarketingEventWebhook";
import {
  MarketingEvent,
  MarketingEventType,
} from "../../../../Types/Marketing/MarketingEvent";

const URL: string = "https://receiver.example.com/oneuptime";
const SECRET: string = "test-secret-not-for-production";

type MakeEventFunction = () => MarketingEvent;

const makeEvent: MakeEventFunction = (): MarketingEvent => {
  return {
    schemaVersion: 1,
    eventId: "sign_up:user-1",
    eventType: MarketingEventType.SignUp,
    occurredAt: "2026-08-24T10:00:00.000Z",
    email: "buyer@example.com",
    emailHash: "hash",
    attribution: { clickIds: {}, firstTouch: {} },
    data: {},
  };
};

type PostCallFunction = () => {
  url: string;
  body: string;
  config: { headers: Record<string, string> };
};

const postCall: PostCallFunction = (): {
  url: string;
  body: string;
  config: { headers: Record<string, string> };
} => {
  const call: Array<unknown> = mockPost.mock.calls[0] as Array<unknown>;

  return {
    url: call[0] as string,
    body: call[1] as string,
    config: call[2] as { headers: Record<string, string> },
  };
};

describe("MarketingEventWebhook", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUrl = URL;
    mockSecret = SECRET;
    mockPost.mockResolvedValue({ status: 200 } as never);
  });

  describe("configuration", () => {
    test("needs both a url and a secret", () => {
      expect(MarketingEventWebhook.isConfigured()).toBe(true);

      mockSecret = "";
      expect(MarketingEventWebhook.isConfigured()).toBe(false);

      mockSecret = SECRET;
      mockUrl = "";
      expect(MarketingEventWebhook.isConfigured()).toBe(false);
    });

    /*
     * A URL with no secret is the dangerous shape: it looks configured, and
     * sending to it would put email addresses on the wire with nothing for the
     * receiver to authenticate. It has to be distinguishable from "not set up",
     * so a caller can say so out loud instead of silently dropping events.
     */
    test("reports a url without a secret as misconfigured, not unconfigured", () => {
      mockSecret = "";

      expect(MarketingEventWebhook.isMisconfigured()).toBe(true);
      expect(MarketingEventWebhook.isConfigured()).toBe(false);
    });

    test("is not misconfigured when nothing is set at all", () => {
      mockUrl = "";
      mockSecret = "";

      expect(MarketingEventWebhook.isMisconfigured()).toBe(false);
    });

    test("sends nothing when unconfigured", async () => {
      mockUrl = "";

      await MarketingEventWebhook.deliver(makeEvent());

      expect(mockPost).not.toHaveBeenCalled();
    });
  });

  describe("signing", () => {
    test("signs the exact bytes it sends", async () => {
      await MarketingEventWebhook.deliver(makeEvent());

      const { body, config } = postCall();

      const expected: string = crypto
        .createHmac("sha256", SECRET)
        .update(body, "utf8")
        .digest("hex");

      expect(config.headers["x-oneuptime-signature-256"]).toBe(expected);
    });

    /*
     * The body has to go out as the pre-serialised string. If it were handed
     * over as an object, the HTTP client would serialise it again and any
     * difference in key order or spacing would make the digest unverifiable —
     * the single most likely way for this integration to break silently.
     */
    test("sends the body as a string, not an object", async () => {
      await MarketingEventWebhook.deliver(makeEvent());

      const { body, config } = postCall();

      expect(typeof body).toBe("string");
      expect(JSON.parse(body)).toEqual(makeEvent());
      expect(config.headers["content-type"]).toBe("application/json");
    });

    test("a digest computed over re-serialised JSON does not match", async () => {
      await MarketingEventWebhook.deliver(makeEvent());

      const { body, config } = postCall();

      // Same data, different bytes — reordered and re-spaced.
      const reSerialised: string = JSON.stringify(JSON.parse(body), null, 2);

      const naive: string = crypto
        .createHmac("sha256", SECRET)
        .update(reSerialised, "utf8")
        .digest("hex");

      expect(naive).not.toBe(config.headers["x-oneuptime-signature-256"]);
    });

    test("different secrets produce different signatures", () => {
      const body: string = JSON.stringify(makeEvent());

      const first: string = MarketingEventWebhook.sign(body);

      mockSecret = "a-different-secret";

      expect(MarketingEventWebhook.sign(body)).not.toBe(first);
    });

    test("routes on id and type headers as well as the body", async () => {
      await MarketingEventWebhook.deliver(makeEvent());

      const { url, config } = postCall();

      expect(url).toBe(URL);
      expect(config.headers["x-oneuptime-event-id"]).toBe("sign_up:user-1");
      expect(config.headers["x-oneuptime-event-type"]).toBe("sign_up");
    });
  });

  describe("failure handling", () => {
    /*
     * Nothing stores these events, so the queue's retry is the only backstop.
     * A delivery that fails has to throw — swallowing it loses the conversion
     * with no row anywhere to reconcile against later.
     */
    test("throws on a transport failure so the queue retries", async () => {
      mockPost.mockRejectedValue(new Error("ECONNREFUSED") as never);

      await expect(MarketingEventWebhook.deliver(makeEvent())).rejects.toThrow(
        /ECONNREFUSED/,
      );
    });

    test("names the event in the failure so a log line is actionable", async () => {
      mockPost.mockRejectedValue(new Error("boom") as never);

      await expect(MarketingEventWebhook.deliver(makeEvent())).rejects.toThrow(
        /sign_up:user-1/,
      );
    });

    test("resolves quietly on a 2xx", async () => {
      mockPost.mockResolvedValue({ status: 202 } as never);

      await expect(
        MarketingEventWebhook.deliver(makeEvent()),
      ).resolves.toBeUndefined();
    });

    /*
     * Non-2xx must reach the catch rather than resolving, which is what the
     * explicit validateStatus is for — the default would resolve on a 4xx and
     * the event would be reported as delivered when it was rejected.
     */
    test("treats only 2xx as success", async () => {
      const { config } = await MarketingEventWebhook.deliver(makeEvent()).then(
        () => {
          return postCall();
        },
      );

      const validateStatus: (status: number) => boolean = (
        config as unknown as { validateStatus: (status: number) => boolean }
      ).validateStatus;

      expect(validateStatus(200)).toBe(true);
      expect(validateStatus(299)).toBe(true);
      expect(validateStatus(400)).toBe(false);
      expect(validateStatus(500)).toBe(false);
      expect(validateStatus(302)).toBe(false);
    });
  });
});
