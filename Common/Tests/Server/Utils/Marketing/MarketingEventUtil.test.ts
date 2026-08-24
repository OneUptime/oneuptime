import { beforeEach, describe, expect, test } from "@jest/globals";

let mockConfigured: boolean = true;
let mockMisconfigured: boolean = false;

jest.mock("../../../../Server/Utils/Marketing/MarketingEventWebhook", () => {
  return {
    __esModule: true,
    default: {
      isConfigured: (): boolean => {
        return mockConfigured;
      },
      isMisconfigured: (): boolean => {
        return mockMisconfigured;
      },
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
  };
});

const mockAddJob: jest.Mock = jest.fn();

jest.mock("../../../../Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    QueueName: { MarketingEvent: "MarketingEvent" },
    default: {
      addJob: (...args: Array<unknown>): unknown => {
        return mockAddJob(...args);
      },
    },
  };
});

import MarketingEventUtil from "../../../../Server/Utils/Marketing/MarketingEventUtil";
import Attribution from "../../../../Server/Utils/Attribution";
import {
  MarketingEvent,
  MarketingEventType,
} from "../../../../Types/Marketing/MarketingEvent";

describe("MarketingEventUtil", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfigured = true;
    mockMisconfigured = false;
    mockAddJob.mockResolvedValue({} as never);
  });

  describe("buildEvent", () => {
    test("stamps the schema version so a receiver can branch on it", () => {
      const event: MarketingEvent = MarketingEventUtil.buildEvent({
        eventType: MarketingEventType.SignUp,
        eventId: "sign_up:u1",
        occurredAt: new Date("2026-08-24T10:00:00.000Z"),
      });

      expect(event.schemaVersion).toBe(1);
      expect(event.eventType).toBe("sign_up");
      expect(event.eventId).toBe("sign_up:u1");
      expect(event.occurredAt).toBe("2026-08-24T10:00:00.000Z");
    });

    /*
     * Both identity forms travel together: the address for a direct CRM join
     * and the digest for anywhere that wants one. The digest must match what
     * every other part of OneUptime produces, or the join it exists for fails.
     */
    test("carries the address and a matching SHA-256", () => {
      const event: MarketingEvent = MarketingEventUtil.buildEvent({
        eventType: MarketingEventType.MeetingBooked,
        eventId: "meeting_booked:b1",
        occurredAt: new Date(),
        email: "Buyer@Example.com",
      });

      expect(event.email).toBe("Buyer@Example.com");
      expect(event.emailHash).toBe(Attribution.hashEmail("Buyer@Example.com"));
      // Normalisation is case-insensitive, so a differently cased address joins.
      expect(event.emailHash).toBe(Attribution.hashEmail("buyer@example.com"));
    });

    test("omits both identity fields when there is no email", () => {
      const event: MarketingEvent = MarketingEventUtil.buildEvent({
        eventType: MarketingEventType.EnterpriseLicenseIssued,
        eventId: "enterprise_license_issued:l1",
        occurredAt: new Date(),
      });

      expect(event.email).toBeUndefined();
      expect(event.emailHash).toBeUndefined();
    });

    test("copies every attribution column off the source row", () => {
      const event: MarketingEvent = MarketingEventUtil.buildEvent({
        eventType: MarketingEventType.SignUp,
        eventId: "sign_up:u1",
        occurredAt: new Date(),
        attributionSource: {
          utmSource: "google",
          utmMedium: "cpc",
          utmCampaign: "brand",
          utmTerm: "oneuptime",
          utmContent: "hero-b",
          utmUrl: "https://oneuptime.com/?gclid=x",
          clickIds: { gclid: "x" },
          firstTouchAttribution: { utmSource: "linkedin" },
        },
      });

      expect(event.attribution).toEqual({
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "brand",
        utmTerm: "oneuptime",
        utmContent: "hero-b",
        utmUrl: "https://oneuptime.com/?gclid=x",
        clickIds: { gclid: "x" },
        firstTouch: { utmSource: "linkedin" },
      });
    });

    /*
     * A conversion carrying no attribution is still a conversion. The two
     * container fields default to empty objects rather than undefined so a
     * receiver can always read .clickIds without a guard.
     */
    test("always gives attribution containers, even with no source", () => {
      const event: MarketingEvent = MarketingEventUtil.buildEvent({
        eventType: MarketingEventType.SignUp,
        eventId: "sign_up:u1",
        occurredAt: new Date(),
      });

      expect(event.attribution.clickIds).toEqual({});
      expect(event.attribution.firstTouch).toEqual({});
      expect(event.data).toEqual({});
    });
  });

  describe("emit", () => {
    test("queues the event under its own id with retries", async () => {
      const event: MarketingEvent = MarketingEventUtil.buildEvent({
        eventType: MarketingEventType.SignUp,
        eventId: "sign_up:u1",
        occurredAt: new Date(),
      });

      await MarketingEventUtil.emit(event);

      expect(mockAddJob).toHaveBeenCalledTimes(1);

      const call: Array<unknown> = mockAddJob.mock.calls[0] as Array<unknown>;

      expect(call[0]).toBe("MarketingEvent");
      expect(call[1]).toBe("sign_up:u1");
      expect(call[2]).toBe("sign_up");
      expect(call[3]).toEqual(event);
      expect(call[4]).toEqual(
        expect.objectContaining({ attempts: 5, backoffDelayInMs: 30_000 }),
      );
    });

    test("does nothing when no endpoint is configured", async () => {
      mockConfigured = false;

      await MarketingEventUtil.emit(
        MarketingEventUtil.buildEvent({
          eventType: MarketingEventType.SignUp,
          eventId: "sign_up:u1",
          occurredAt: new Date(),
        }),
      );

      expect(mockAddJob).not.toHaveBeenCalled();
    });

    /*
     * A URL with no secret must not silently behave like "not configured" —
     * the operator meant to send these somewhere and needs to be told why
     * nothing arrived.
     */
    test("refuses to queue when a url is set without a secret", async () => {
      mockConfigured = false;
      mockMisconfigured = true;

      await MarketingEventUtil.emit(
        MarketingEventUtil.buildEvent({
          eventType: MarketingEventType.SignUp,
          eventId: "sign_up:u1",
          occurredAt: new Date(),
        }),
      );

      expect(mockAddJob).not.toHaveBeenCalled();
    });

    test("swallows a queue failure rather than failing its caller", async () => {
      mockAddJob.mockRejectedValue(new Error("redis down") as never);

      await expect(
        MarketingEventUtil.emit(
          MarketingEventUtil.buildEvent({
            eventType: MarketingEventType.SignUp,
            eventId: "sign_up:u1",
            occurredAt: new Date(),
          }),
        ),
      ).resolves.toBeUndefined();
    });
  });

  /*
   * Every caller is a commercial transaction that has already succeeded — a
   * user created, a plan changed, a booking verified. Emitting must never be
   * able to turn one of those into a failure, on either the synchronous or the
   * asynchronous path.
   */
  describe("emitInBackground", () => {
    test("never throws when the queue rejects", async () => {
      mockAddJob.mockRejectedValue(new Error("redis down") as never);

      expect(() => {
        MarketingEventUtil.emitInBackground(
          MarketingEventUtil.buildEvent({
            eventType: MarketingEventType.SignUp,
            eventId: "sign_up:u1",
            occurredAt: new Date(),
          }),
        );
      }).not.toThrow();

      // Let the swallowed rejection settle so it cannot surface as unhandled.
      await Promise.resolve();
    });

    test("never throws when the queue throws synchronously", () => {
      mockAddJob.mockImplementation((): never => {
        throw new Error("boom");
      });

      expect(() => {
        MarketingEventUtil.emitInBackground(
          MarketingEventUtil.buildEvent({
            eventType: MarketingEventType.SignUp,
            eventId: "sign_up:u1",
            occurredAt: new Date(),
          }),
        );
      }).not.toThrow();
    });
  });
});
