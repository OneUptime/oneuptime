import {
  buildResponse,
  buildSignedRequest,
  CapturedResponse,
  createMockRouter,
  MockRouter,
  RouteHandler,
  sign,
} from "./CalWebhookTestUtil";
import Attribution from "Common/Server/Utils/Attribution";
import { ExpressRequest, NextFunction } from "Common/Server/Utils/Express";
import { JSONObject } from "Common/Types/JSON";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * POST /api/cal-webhook — the only writer of MeetingBooked conversions.
 *
 * The endpoint is unauthenticated in the OneUptime sense: anyone on the
 * internet can reach it, and the ONLY thing standing between them and the
 * conversion ledger is an HMAC over the raw request bytes. So the load-bearing
 * assertions here are:
 *
 *   - nothing is written, and the database is not even read, unless the
 *     signature verifies against the exact bytes express received. A body that
 *     was re-serialised, or padded by one byte, must not verify.
 *   - a booking that Cal delivers twice produces exactly one ledger row. Cal
 *     retries on any non-2xx, so this is the normal path, not an edge case:
 *     the conversion id is derived from the booking id, the row is checked for
 *     before insert, and a lost insert race is absorbed rather than raised.
 *   - only allowlisted ad click ids survive into the row. Cal's metadata and
 *     booking responses carry free-form customer content (names, notes,
 *     answers), and none of it may be copied into the ledger.
 * ---------------------------------------------------------------------------
 */

const SECRET: string = "cal-test-secret";

const mockRouter: MockRouter = createMockRouter();

let mockCalWebhookSecret: string = SECRET;

/*
 * CalWebhookSecret is a module-level constant read from process.env at import
 * time, so the configured and unconfigured deployments cannot both be reached
 * from one file unless it is served through a getter. The route reads it as a
 * property off the module object on every request, so a getter is enough.
 */
jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual, __esModule: true };

  Object.defineProperty(mocked, "CalWebhookSecret", {
    get: (): string => {
      return mockCalWebhookSecret;
    },
  });

  return mocked;
});

jest.mock("Common/Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      getRouter: (): MockRouter => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

/*
 * The route emits rather than stores, so the seam under test is the event
 * builder. buildEvent is left REAL — asserting on a stubbed builder would
 * prove the route called something, not that a receiver gets the right event —
 * and only the queue hand-off is stubbed.
 */
jest.mock("Common/Server/Utils/Marketing/MarketingEventUtil", () => {
  const actual: {
    default: typeof import("Common/Server/Utils/Marketing/MarketingEventUtil").default;
  } = jest.requireActual(
    "Common/Server/Utils/Marketing/MarketingEventUtil",
  ) as {
    default: typeof import("Common/Server/Utils/Marketing/MarketingEventUtil").default;
  };

  return {
    __esModule: true,
    default: {
      buildEvent: actual.default.buildEvent.bind(actual.default),
      buildAttribution: actual.default.buildAttribution.bind(actual.default),
      emitInBackground: jest.fn(),
      emit: jest.fn(),
    },
  };
});

import MarketingEventUtil from "Common/Server/Utils/Marketing/MarketingEventUtil";
import { MarketingEvent } from "Common/Types/Marketing/MarketingEvent";
import {
  CalBookingConversion,
  parseCalBookingConversion,
  verifyCalWebhookSignature,
} from "../../API/CalWebhook";

type BookingCreatedBodyFunction = (payload?: JSONObject) => JSONObject;

const bookingCreatedBody: BookingCreatedBodyFunction = (
  payload: JSONObject = {},
): JSONObject => {
  return {
    triggerEvent: "BOOKING_CREATED",
    payload: {
      uid: "booking-123",
      startTime: "2026-08-19T10:00:00.000Z",
      ...payload,
    },
  };
};

type CallRouteResult = {
  response: CapturedResponse;
  nextError: unknown;
};

type CallRouteFunction = (req: ExpressRequest) => Promise<CallRouteResult>;

const callRoute: CallRouteFunction = async (
  req: ExpressRequest,
): Promise<CallRouteResult> => {
  const handler: RouteHandler = mockRouter.match("post", "/cal-webhook");
  const response: CapturedResponse = buildResponse();

  let nextError: unknown = undefined;

  const next: NextFunction = ((err: unknown): void => {
    nextError = err;
  }) as unknown as NextFunction;

  await handler(req, response, next);

  return { response: response, nextError: nextError };
};

type EmittedEventFunction = () => MarketingEvent;

const emittedEvent: EmittedEventFunction = (): MarketingEvent => {
  const calls: Array<Array<unknown>> = (
    MarketingEventUtil.emitInBackground as unknown as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  expect(calls).toHaveLength(1);

  return calls[0]![0] as MarketingEvent;
};

describe("CalWebhook", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCalWebhookSecret = SECRET;
    (
      MarketingEventUtil.emitInBackground as unknown as jest.Mock
    ).mockImplementation((): void => {
      return undefined;
    });
  });

  describe("signature verification", () => {
    test("accepts a digest over the exact raw body", () => {
      const rawBody: string = '{"triggerEvent":"BOOKING_CREATED"}';

      expect(
        verifyCalWebhookSignature({
          rawBody: rawBody,
          signature: sign(rawBody, SECRET),
          secret: SECRET,
        }),
      ).toBe(true);
    });

    test.each([
      ["a sha256= prefix", "sha256="],
      ["an uppercase SHA256= prefix", "SHA256="],
    ])("tolerates %s", (_label: string, prefix: string) => {
      const rawBody: string = "{}";

      expect(
        verifyCalWebhookSignature({
          rawBody: rawBody,
          signature: `${prefix}${sign(rawBody, SECRET)}`,
          secret: SECRET,
        }),
      ).toBe(true);
    });

    test("tolerates uppercase hex and surrounding whitespace", () => {
      const rawBody: string = "{}";

      expect(
        verifyCalWebhookSignature({
          rawBody: rawBody,
          signature: `  ${sign(rawBody, SECRET).toUpperCase()}  `,
          secret: SECRET,
        }),
      ).toBe(true);
    });

    /*
     * The reason the route signs req.rawBody rather than the parsed body:
     * JSON.parse + JSON.stringify is not byte-preserving, so a re-serialised
     * body would never match Cal's digest, and any proxy that reformats the
     * body must fail loudly rather than be silently accepted.
     */
    test("rejects a body that differs by a single trailing byte", () => {
      const rawBody: string = '{"triggerEvent":"BOOKING_CREATED"}';
      const signature: string = sign(rawBody, SECRET);

      expect(
        verifyCalWebhookSignature({
          rawBody: `${rawBody} `,
          signature: signature,
          secret: SECRET,
        }),
      ).toBe(false);
    });

    test("rejects a digest computed with a different secret", () => {
      const rawBody: string = "{}";

      expect(
        verifyCalWebhookSignature({
          rawBody: rawBody,
          signature: sign(rawBody, "some-other-secret"),
          secret: SECRET,
        }),
      ).toBe(false);
    });

    /*
     * timingSafeEqual THROWS when the buffers differ in length, and
     * Buffer.from(hex) silently truncates at the first non-hex character — so
     * a malformed signature must be rejected by shape before either of them
     * sees it, not by catching an exception.
     */
    test.each([
      ["not-a-signature"],
      [""],
      ["   "],
      ["zz" + "0".repeat(62)],
      ["0".repeat(63)],
      ["0".repeat(65)],
      ["sha256="],
    ])(
      "rejects the malformed signature %p without throwing",
      (signature: string) => {
        expect(() => {
          return verifyCalWebhookSignature({
            rawBody: "{}",
            signature: signature,
            secret: SECRET,
          });
        }).not.toThrow();

        expect(
          verifyCalWebhookSignature({
            rawBody: "{}",
            signature: signature,
            secret: SECRET,
          }),
        ).toBe(false);
      },
    );

    test("rejects a correct digest truncated to a shorter prefix", () => {
      const rawBody: string = "{}";
      const signature: string = sign(rawBody, SECRET);

      expect(
        verifyCalWebhookSignature({
          rawBody: rawBody,
          signature: signature.slice(0, 32),
          secret: SECRET,
        }),
      ).toBe(false);
    });
  });

  describe("payload parsing", () => {
    test("parses a BOOKING_CREATED event", () => {
      const parsed: CalBookingConversion | null = parseCalBookingConversion(
        bookingCreatedBody({
          attendees: [{ email: "BUYER@EXAMPLE.COM", name: "Private Name" }],
          metadata: { gclid: "google-click", unknown: "must-not-be-retained" },
          responses: { fbclid: "meta-click", notes: "must-not-be-retained" },
        }),
      );

      expect(parsed).toEqual({
        bookingId: "booking-123",
        conversionAt: new Date("2026-08-19T10:00:00.000Z"),
        email: "buyer@example.com",
        clickIds: { gclid: "google-click", fbclid: "meta-click" },
        // No UTM parameters in this payload, and no first touch either.
        utm: {},
      });
    });

    test("accepts the eventType spelling as well as triggerEvent", () => {
      expect(
        parseCalBookingConversion({
          eventType: "booking_created",
          payload: { uid: "booking-123" },
        }),
      ).toMatchObject({ bookingId: "booking-123" });
    });

    /*
     * A reschedule or a cancellation changes a booking that already converted.
     * Counting either as a new conversion would double-count the meeting, and
     * Cal delivers them all to the same endpoint.
     */
    test.each([
      ["BOOKING_CANCELLED"],
      ["BOOKING_RESCHEDULED"],
      ["BOOKING_PAYMENT_INITIATED"],
      ["MEETING_ENDED"],
      ["SOMETHING_NEW"],
    ])("ignores the %s event", (triggerEvent: string) => {
      expect(
        parseCalBookingConversion({
          triggerEvent: triggerEvent,
          payload: { uid: "booking-123" },
        }),
      ).toBeNull();
    });

    test.each([
      ["a missing trigger event", {}],
      ["a blank trigger event", { triggerEvent: "   " }],
      ["a non-string trigger event", { triggerEvent: 7 }],
    ])("ignores %s", (_label: string, body: JSONObject) => {
      expect(parseCalBookingConversion(body)).toBeNull();
    });

    test("throws when a booking created event carries no identifier", () => {
      expect(() => {
        return parseCalBookingConversion({
          triggerEvent: "BOOKING_CREATED",
          payload: { startTime: "2026-08-19T10:00:00.000Z" },
        });
      }).toThrow("no usable booking identifier");
    });

    test("throws when the booking identifier is absurdly long", () => {
      expect(() => {
        return parseCalBookingConversion(
          bookingCreatedBody({ uid: "x".repeat(501) }),
        );
      }).toThrow("no usable booking identifier");
    });

    test("throws when the booking date cannot be parsed", () => {
      expect(() => {
        return parseCalBookingConversion(
          bookingCreatedBody({ startTime: "not-a-date" }),
        );
      }).toThrow("invalid booking date");
    });

    // Cal's `uid` is a string but its row `id` is a number.
    test("accepts a numeric booking identifier", () => {
      expect(
        parseCalBookingConversion({
          triggerEvent: "BOOKING_CREATED",
          payload: { booking: { id: 98765 } },
        }),
      ).toMatchObject({ bookingId: "98765" });
    });

    test.each([
      ["payload.uid", { uid: "from-payload-uid" }, "from-payload-uid"],
      [
        "booking.uid",
        { booking: { uid: "from-booking-uid" } },
        "from-booking-uid",
      ],
      [
        "payload.bookingUid",
        { bookingUid: "from-booking-uid-field" },
        "from-booking-uid-field",
      ],
    ])(
      "reads the booking identifier from %s",
      (_label: string, payload: JSONObject, expected: string) => {
        expect(
          parseCalBookingConversion({
            triggerEvent: "BOOKING_CREATED",
            payload: payload,
          }),
        ).toMatchObject({ bookingId: expected });
      },
    );

    test("prefers payload.uid over every other identifier source", () => {
      expect(
        parseCalBookingConversion({
          triggerEvent: "BOOKING_CREATED",
          payload: {
            uid: "preferred",
            bookingUid: "secondary",
            id: 1,
            booking: { uid: "tertiary", id: 2 },
          },
        }),
      ).toMatchObject({ bookingId: "preferred" });
    });

    test("falls back through startTime, booking.startTime and createdAt", () => {
      expect(
        parseCalBookingConversion({
          triggerEvent: "BOOKING_CREATED",
          payload: {
            uid: "booking-123",
            booking: { startTime: "2026-08-19T11:00:00.000Z" },
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        }),
      ).toMatchObject({
        conversionAt: new Date("2026-08-19T11:00:00.000Z"),
      });

      expect(
        parseCalBookingConversion({
          triggerEvent: "BOOKING_CREATED",
          payload: {
            uid: "booking-123",
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        }),
      ).toMatchObject({
        conversionAt: new Date("2026-08-01T00:00:00.000Z"),
      });
    });

    test("uses the current time when the payload carries no date at all", () => {
      const before: number = Date.now();

      const parsed: CalBookingConversion | null = parseCalBookingConversion({
        triggerEvent: "BOOKING_CREATED",
        payload: { uid: "booking-123" },
      });

      expect(parsed!.conversionAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(parsed!.conversionAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    test("lowercases the attendee email and truncates it to the column width", () => {
      const localPart: string = "A".repeat(120);

      const parsed: CalBookingConversion | null = parseCalBookingConversion(
        bookingCreatedBody({
          attendees: [{ email: `${localPart}@example.com` }],
        }),
      );

      expect(parsed!.email).toHaveLength(100);
      expect(parsed!.email).toBe("a".repeat(100));
    });

    test("falls back to payload.email and omits the field when absent", () => {
      expect(
        parseCalBookingConversion(
          bookingCreatedBody({ email: "fallback@example.com" }),
        ),
      ).toMatchObject({ email: "fallback@example.com" });

      expect(
        parseCalBookingConversion(bookingCreatedBody()),
      ).not.toHaveProperty("email");
    });

    test("prefers the first attendee over payload.email", () => {
      expect(
        parseCalBookingConversion(
          bookingCreatedBody({
            attendees: [{ email: "attendee@example.com" }],
            email: "fallback@example.com",
          }),
        ),
      ).toMatchObject({ email: "attendee@example.com" });
    });

    describe("click id allowlist", () => {
      test.each([
        ["gclid"],
        ["wbraid"],
        ["gbraid"],
        ["fbclid"],
        ["msclkid"],
        ["li_fat_id"],
        ["twclid"],
        ["rdt_cid"],
      ])("retains %s from booking metadata", (key: string) => {
        expect(
          parseCalBookingConversion(
            bookingCreatedBody({ metadata: { [key]: "click-value" } }),
          ),
        ).toMatchObject({ clickIds: { [key]: "click-value" } });
      });

      /*
       * Cal metadata and booking answers are free-form customer content. An
       * allowlist, not a denylist: anything not named above is not copied,
       * however innocuous the key looks.
       */
      test("copies nothing that is not on the allowlist", () => {
        const parsed: CalBookingConversion | null = parseCalBookingConversion(
          bookingCreatedBody({
            metadata: {
              gclid: "google-click",
              utm_source: "linkedin",
              videoCallUrl: "https://example.com/call",
              attendeeName: "Private Name",
            },
            responses: {
              name: "Private Name",
              notes: "We run 400 services on-prem",
              phone: "+15550000000",
            },
          }),
        );

        expect(parsed!.clickIds).toEqual({ gclid: "google-click" });
      });

      test("reads booking.metadata as well as payload.metadata", () => {
        expect(
          parseCalBookingConversion(
            bookingCreatedBody({
              booking: { metadata: { msclkid: "microsoft-click" } },
            }),
          ),
        ).toMatchObject({ clickIds: { msclkid: "microsoft-click" } });
      });

      // Cal answers arrive bare on some versions and as {label,value} on others.
      test("unwraps a labelled booking response value", () => {
        expect(
          parseCalBookingConversion(
            bookingCreatedBody({
              responses: {
                gclid: { label: "Google Click Id", value: "google-click" },
              },
            }),
          ),
        ).toMatchObject({ clickIds: { gclid: "google-click" } });
      });

      test("prefers metadata over a booking response for the same key", () => {
        expect(
          parseCalBookingConversion(
            bookingCreatedBody({
              metadata: { gclid: "from-metadata" },
              responses: { gclid: "from-responses" },
            }),
          ),
        ).toMatchObject({ clickIds: { gclid: "from-metadata" } });
      });

      test("truncates an oversized click id", () => {
        const parsed: CalBookingConversion | null = parseCalBookingConversion(
          bookingCreatedBody({ metadata: { gclid: "g".repeat(900) } }),
        );

        expect((parsed!.clickIds as JSONObject)["gclid"]).toHaveLength(500);
      });

      test.each([
        ["a number", 12345],
        ["a boolean", true],
        ["null", null],
        ["an object", { nested: "value" }],
        ["an array", ["value"]],
        ["a blank string", "   "],
      ])("ignores %s click id value", (_label: string, value: unknown) => {
        expect(
          parseCalBookingConversion(
            bookingCreatedBody({ metadata: { gclid: value } as JSONObject }),
          ),
        ).toMatchObject({ clickIds: {} });
      });

      test("returns an empty object when there is no attribution at all", () => {
        expect(parseCalBookingConversion(bookingCreatedBody())).toMatchObject({
          clickIds: {},
        });
      });
    });

    /*
     * ---------------------------------------------------------------------
     * Campaign attribution.
     *
     * This half of the payload is what the demo branch of the funnel was
     * missing entirely. The webhook parsed click ids while the embed sent no
     * metadata at all, so every booked demo landed in the ledger attributable
     * to nothing — and a click id alone cannot name a campaign anyway.
     *
     * Cal metadata is free-form customer content, so exactly the same rules
     * apply as to the click ids: whitelist the keys, bound the values, and
     * copy nothing else.
     * ---------------------------------------------------------------------
     */
    describe("campaign attribution", () => {
      test("reads every UTM parameter out of booking metadata", () => {
        expect(
          parseCalBookingConversion(
            bookingCreatedBody({
              metadata: {
                utm_source: "google",
                utm_medium: "cpc",
                utm_campaign: "enterprise-observability",
                utm_term: "datadog alternative",
                utm_content: "demo-cta-b",
                utm_url: "https://oneuptime.com/enterprise/demo?gclid=abc",
              },
            }),
          ),
        ).toMatchObject({
          utm: {
            utmSource: "google",
            utmMedium: "cpc",
            utmCampaign: "enterprise-observability",
            utmTerm: "datadog alternative",
            utmContent: "demo-cta-b",
            utmUrl: "https://oneuptime.com/enterprise/demo?gclid=abc",
          },
        });
      });

      test("reads UTMs out of booking question answers too", () => {
        expect(
          parseCalBookingConversion(
            bookingCreatedBody({
              responses: {
                utm_campaign: { label: "Campaign", value: "conference-2026" },
              },
            }),
          ),
        ).toMatchObject({ utm: { utmCampaign: "conference-2026" } });
      });

      test("reads UTMs out of nested booking metadata", () => {
        expect(
          parseCalBookingConversion(
            bookingCreatedBody({
              booking: { metadata: { utm_source: "newsletter" } },
            }),
          ),
        ).toMatchObject({ utm: { utmSource: "newsletter" } });
      });

      test("keeps a campaign that arrived with no click id at all", () => {
        // A newsletter or conference link no ad platform ever tagged.
        expect(
          parseCalBookingConversion(
            bookingCreatedBody({ metadata: { utm_source: "newsletter" } }),
          ),
        ).toMatchObject({
          clickIds: {},
          utm: { utmSource: "newsletter" },
        });
      });

      test("drops metadata keys that are not UTMs or click ids", () => {
        const parsed: CalBookingConversion | null = parseCalBookingConversion(
          bookingCreatedBody({
            metadata: {
              utm_source: "google",
              internalNote: "must-not-be-retained",
              phone: "+1 555 0100",
            },
          }),
        );

        expect(JSON.stringify(parsed)).not.toContain("must-not-be-retained");
        expect(JSON.stringify(parsed)).not.toContain("555 0100");
      });

      test("caps a UTM value at 500 characters", () => {
        const parsed: CalBookingConversion | null = parseCalBookingConversion(
          bookingCreatedBody({
            metadata: { utm_campaign: "c".repeat(900) },
          }),
        );

        expect(parsed?.utm.utmCampaign).toBe("c".repeat(500));
      });
    });

    /*
     * ---------------------------------------------------------------------
     * First touch.
     *
     * Cal metadata values are scalars, so the visitor's first attributed visit
     * travels as one JSON string. Parsing caller-supplied JSON is only safe
     * because nothing structural is trusted afterwards — the result goes
     * straight through the same whitelist the signup path uses.
     *
     * And a first touch that cannot be parsed must never cost the booking: the
     * booking IS the conversion, the attribution is a bonus.
     * ---------------------------------------------------------------------
     */
    describe("first touch", () => {
      test("parses the JSON blob the embed sends", () => {
        expect(
          parseCalBookingConversion(
            bookingCreatedBody({
              metadata: {
                ou_first_touch: JSON.stringify({
                  utmSource: "google",
                  utmCampaign: "first-campaign",
                  landingUrl: "https://oneuptime.com/?gclid=abc",
                  referrer: "https://google.com/",
                  timestamp: "2026-06-01T09:00:00.000Z",
                  clickIds: { gclid: "abc" },
                }),
              },
            }),
          ),
        ).toMatchObject({
          firstTouchAttribution: {
            utmSource: "google",
            utmCampaign: "first-campaign",
            landingUrl: "https://oneuptime.com/?gclid=abc",
            referrer: "https://google.com/",
            timestamp: "2026-06-01T09:00:00.000Z",
            clickIds: { gclid: "abc" },
          },
        });
      });

      test("whitelists the keys inside the blob", () => {
        const parsed: CalBookingConversion | null = parseCalBookingConversion(
          bookingCreatedBody({
            metadata: {
              ou_first_touch: JSON.stringify({
                utmSource: "google",
                attackerControlledKey: "must-not-be-retained",
                clickIds: { arbitrary: "must-not-be-retained" },
              }),
            },
          }),
        );

        expect(parsed?.firstTouchAttribution).toEqual({ utmSource: "google" });
      });

      test.each([
        ["malformed JSON", "{not json"],
        ["a JSON array", "[1,2,3]"],
        ["a JSON scalar", '"just a string"'],
        ["an oversized blob", JSON.stringify({ utmSource: "s".repeat(5000) })],
      ])(
        "keeps the booking and drops the first touch for %s",
        (_label: string, blob: string) => {
          const parsed: CalBookingConversion | null = parseCalBookingConversion(
            bookingCreatedBody({ metadata: { ou_first_touch: blob } }),
          );

          expect(parsed?.bookingId).toBe("booking-123");
          expect(parsed?.firstTouchAttribution).toBeUndefined();
        },
      );

      test("omits the key entirely when no first touch was sent", () => {
        const parsed: CalBookingConversion | null =
          parseCalBookingConversion(bookingCreatedBody());

        expect(parsed).not.toHaveProperty("firstTouchAttribution");
      });
    });

    test.each([
      ["a missing payload", {}],
      ["a null payload", { payload: null }],
      ["an array payload", { payload: [] }],
      ["a string payload", { payload: "nope" }],
    ])(
      "throws rather than crashing on %s",
      (_label: string, extra: JSONObject) => {
        expect(() => {
          return parseCalBookingConversion({
            triggerEvent: "BOOKING_CREATED",
            ...extra,
          });
        }).toThrow("no usable booking identifier");
      },
    );
  });

  describe("route", () => {
    test("registers itself as POST /cal-webhook", () => {
      expect(mockRouter.routes).toContainEqual(
        expect.objectContaining({ method: "POST", uri: "/cal-webhook" }),
      );
    });

    test("answers 503 and emits nothing when the secret is unconfigured", async () => {
      mockCalWebhookSecret = "";

      const { response } = await callRoute(
        buildSignedRequest({ body: bookingCreatedBody(), secret: SECRET }),
      );

      expect(response.statusCode).toBe(503);
      expect(MarketingEventUtil.emitInBackground).not.toHaveBeenCalled();
    });

    test.each([
      [
        "the signature header is missing",
        { omitSignatureHeader: true } as Record<string, unknown>,
      ],
      ["the signature is wrong", { signature: "0".repeat(64) }],
      ["the signature is malformed", { signature: "nope" }],
      [
        "the raw body was reformatted after signing",
        { rawBody: `${JSON.stringify(bookingCreatedBody())} ` },
      ],
      ["the raw body was never captured", { rawBody: "" }],
    ])(
      "answers 401 and emits nothing when %s",
      async (_label: string, overrides: Record<string, unknown>) => {
        const { response } = await callRoute(
          buildSignedRequest({
            body: bookingCreatedBody(),
            secret: SECRET,
            ...overrides,
          }),
        );

        expect(response.statusCode).toBe(401);
        expect(response.jsonBody).toEqual({
          error: "Invalid Cal webhook signature",
        });
        expect(MarketingEventUtil.emitInBackground).not.toHaveBeenCalled();
      },
    );

    /*
     * The signature is computed over the raw body, so an attacker who cannot
     * forge it cannot get a different parsed body considered either.
     */
    test("answers 401 when the parsed body was swapped for another one", async () => {
      const honest: JSONObject = bookingCreatedBody();
      const forged: JSONObject = bookingCreatedBody({ uid: "attacker" });

      const req: ExpressRequest = buildSignedRequest({
        body: honest,
        secret: SECRET,
      });
      (req as unknown as { body: JSONObject }).body = forged;
      (req as unknown as { rawBody: string }).rawBody = JSON.stringify(forged);

      const { response } = await callRoute(req);

      expect(response.statusCode).toBe(401);
      expect(MarketingEventUtil.emitInBackground).not.toHaveBeenCalled();
    });

    test("answers 400 for a signed but unusable booking payload", async () => {
      const body: JSONObject = {
        triggerEvent: "BOOKING_CREATED",
        payload: { startTime: "2026-08-19T10:00:00.000Z" },
      };

      const { response } = await callRoute(
        buildSignedRequest({ body: body, secret: SECRET }),
      );

      expect(response.statusCode).toBe(400);
      expect(response.jsonBody).toEqual({
        error: "Invalid Cal webhook payload",
      });
      expect(MarketingEventUtil.emitInBackground).not.toHaveBeenCalled();
    });

    test("acknowledges an unsupported event without emitting", async () => {
      const { response } = await callRoute(
        buildSignedRequest({
          body: { triggerEvent: "BOOKING_CANCELLED", payload: { uid: "b1" } },
          secret: SECRET,
        }),
      );

      expect(response.statusCode).toBe(200);
      expect(response.jsonBody).toEqual({ accepted: false });
      expect(MarketingEventUtil.emitInBackground).not.toHaveBeenCalled();
    });

    test("emits a meeting_booked event keyed by the booking", async () => {
      const { response } = await callRoute(
        buildSignedRequest({
          body: bookingCreatedBody({
            attendees: [{ email: "Buyer@Example.com" }],
            metadata: { gclid: "google-click", notes: "private" },
          }),
          secret: SECRET,
        }),
      );

      expect(response.statusCode).toBe(200);
      expect(response.jsonBody).toEqual({ accepted: true });

      const event: MarketingEvent = emittedEvent();

      expect(event.eventType).toBe("meeting_booked");
      expect(event.eventId).toBe("meeting_booked:booking-123");
      expect(event.schemaVersion).toBe(1);
      expect(event.email).toBe("buyer@example.com");
      expect(event.attribution.clickIds).toEqual({ gclid: "google-click" });
      expect(event.data["calBookingId"]).toBe("booking-123");
    });

    /*
     * occurredAt is when the booking was MADE. The meeting's own start time is
     * separate and may be weeks later — conflating them is what forced every
     * consumer of the old ledger to clamp the value before it could order a
     * booking against a signup.
     */
    test("separates when the booking happened from when the meeting starts", async () => {
      const before: number = Date.now();

      await callRoute(
        buildSignedRequest({ body: bookingCreatedBody(), secret: SECRET }),
      );

      const event: MarketingEvent = emittedEvent();

      expect(event.data["meetingStartsAt"]).toBe("2026-08-19T10:00:00.000Z");

      const occurredAt: number = new Date(event.occurredAt).getTime();
      expect(occurredAt).toBeGreaterThanOrEqual(before);
      expect(occurredAt).toBeLessThanOrEqual(Date.now());
    });

    /*
     * The attribution the embed carried has to reach the EVENT, not just be
     * parsed — nothing is stored now, so anything missing here is gone.
     */
    test("carries the campaign attribution on the event", async () => {
      await callRoute(
        buildSignedRequest({
          body: bookingCreatedBody({
            metadata: {
              utm_source: "google",
              utm_medium: "cpc",
              utm_campaign: "enterprise-observability",
              utm_term: "datadog alternative",
              utm_content: "demo-cta-b",
              utm_url: "https://oneuptime.com/enterprise/demo?gclid=abc",
              ou_first_touch: JSON.stringify({
                utmSource: "linkedin",
                landingUrl: "https://oneuptime.com/enterprise",
              }),
            },
          }),
          secret: SECRET,
        }),
      );

      const event: MarketingEvent = emittedEvent();

      expect(event.attribution.utmSource).toBe("google");
      expect(event.attribution.utmMedium).toBe("cpc");
      expect(event.attribution.utmCampaign).toBe("enterprise-observability");
      expect(event.attribution.utmTerm).toBe("datadog alternative");
      expect(event.attribution.utmContent).toBe("demo-cta-b");
      expect(event.attribution.utmUrl).toBe(
        "https://oneuptime.com/enterprise/demo?gclid=abc",
      );
      /*
       * First touch travels separately from last touch: the campaign that
       * introduced this person is not the one that produced the booking.
       */
      expect(event.attribution.firstTouch).toEqual({
        utmSource: "linkedin",
        landingUrl: "https://oneuptime.com/enterprise",
      });
    });

    test("carries both the address and its SHA-256", async () => {
      await callRoute(
        buildSignedRequest({
          body: bookingCreatedBody({
            attendees: [{ email: "BUYER@Example.com" }],
          }),
          secret: SECRET,
        }),
      );

      const event: MarketingEvent = emittedEvent();

      expect(event.email).toBe("buyer@example.com");
      expect(event.emailHash).toBe(Attribution.hashEmail("buyer@example.com"));
    });

    test("omits both identity fields when the booking carried no attendee email", async () => {
      await callRoute(
        buildSignedRequest({
          body: bookingCreatedBody({ attendees: [] }),
          secret: SECRET,
        }),
      );

      const event: MarketingEvent = emittedEvent();

      expect(event.email).toBeUndefined();
      expect(event.emailHash).toBeUndefined();
    });

    /*
     * Cal retries on any non-2xx, so redelivery is the normal path. Nothing is
     * stored, so the endpoint cannot tell a retry from a first delivery — the
     * stable eventId is what lets the RECEIVER tell, and it is the only thing
     * standing between a retry and a double-counted demo.
     */
    test("derives the same eventId for every delivery of one booking", async () => {
      await callRoute(
        buildSignedRequest({ body: bookingCreatedBody(), secret: SECRET }),
      );
      const first: MarketingEvent = emittedEvent();

      (MarketingEventUtil.emitInBackground as unknown as jest.Mock).mockClear();

      // Cal re-sends the same booking with a differently ordered payload.
      const { response } = await callRoute(
        buildSignedRequest({
          body: {
            payload: {
              startTime: "2026-08-19T10:00:00.000Z",
              uid: "booking-123",
            },
            triggerEvent: "BOOKING_CREATED",
          },
          secret: SECRET,
        }),
      );

      expect(response.statusCode).toBe(200);
      expect(emittedEvent().eventId).toBe(first.eventId);
    });

    test("gives different bookings different event ids", async () => {
      await callRoute(
        buildSignedRequest({ body: bookingCreatedBody(), secret: SECRET }),
      );
      const first: MarketingEvent = emittedEvent();

      (MarketingEventUtil.emitInBackground as unknown as jest.Mock).mockClear();

      await callRoute(
        buildSignedRequest({
          body: bookingCreatedBody({ uid: "booking-456" }),
          secret: SECRET,
        }),
      );

      expect(emittedEvent().eventId).not.toBe(first.eventId);
    });

    /*
     * Emitting is fire-and-forget by design: the queue owns delivery, and a
     * marketing endpoint having a bad day must not turn a booking Cal
     * successfully delivered into one it will retry forever.
     */
    test("still acknowledges the booking when emitting throws", async () => {
      (
        MarketingEventUtil.emitInBackground as unknown as jest.Mock
      ).mockImplementation((): void => {
        throw new Error("queue unavailable");
      });

      const { response, nextError } = await callRoute(
        buildSignedRequest({ body: bookingCreatedBody(), secret: SECRET }),
      );

      expect(nextError).toBeUndefined();
      expect(response.statusCode).toBe(200);
      expect(response.jsonBody).toEqual({ accepted: true });
    });
  });
});
