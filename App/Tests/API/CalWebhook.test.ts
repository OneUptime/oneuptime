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
import MarketingConversion from "Common/Models/DatabaseModels/MarketingConversion";
import MarketingConversionService from "Common/Server/Services/MarketingConversionService";
import { ExpressRequest, NextFunction } from "Common/Server/Utils/Express";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { MarketingConversionType } from "Common/Types/Marketing/MarketingConversion";
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

jest.mock("Common/Server/Services/MarketingConversionService", () => {
  return {
    __esModule: true,
    default: {
      create: jest.fn(),
      findOneById: jest.fn(),
    },
  };
});

import {
  CalBookingConversion,
  getCalBookingConversionId,
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

type UniqueViolationFunction = () => Record<string, unknown>;

/*
 * Shaped like the TypeORM QueryFailedError a colliding insert produces — the
 * only failure the route is allowed to swallow.
 */
const uniqueViolation: UniqueViolationFunction = (): Record<
  string,
  unknown
> => {
  return {
    message:
      'duplicate key value violates unique constraint "PK_MarketingConversion"',
    code: "23505",
    table: "MarketingConversion",
    detail: "Key (_id)=(...) already exists.",
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

type CreatedConversionFunction = () => MarketingConversion;

const createdConversion: CreatedConversionFunction =
  (): MarketingConversion => {
    const calls: Array<Array<unknown>> = (
      MarketingConversionService.create as unknown as jest.Mock
    ).mock.calls as Array<Array<unknown>>;

    expect(calls).toHaveLength(1);

    return (calls[0]![0] as { data: MarketingConversion }).data;
  };

describe("CalWebhook", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCalWebhookSecret = SECRET;
    (
      MarketingConversionService.findOneById as unknown as jest.Mock
    ).mockResolvedValue(null as never);
    (
      MarketingConversionService.create as unknown as jest.Mock
    ).mockImplementation((createBy: unknown): unknown => {
      return Promise.resolve((createBy as { data: unknown }).data);
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

  describe("deterministic conversion id", () => {
    test("is stable across calls for one booking", () => {
      expect(getCalBookingConversionId("booking-123").toString()).toBe(
        getCalBookingConversionId("booking-123").toString(),
      );
    });

    test("differs between bookings", () => {
      expect(getCalBookingConversionId("booking-123").toString()).not.toBe(
        getCalBookingConversionId("booking-456").toString(),
      );
    });

    // Postgres will reject anything that is not a well-formed UUID.
    test("is a well-formed v5-shaped UUID", () => {
      expect(getCalBookingConversionId("booking-123").toString()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    test("stays well-formed for identifiers of every shape", () => {
      for (const bookingId of [
        "1",
        "x".repeat(500),
        "booking/with/slashes",
        "ünïcödé-booking",
        "0",
      ]) {
        expect(getCalBookingConversionId(bookingId).toString()).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
      }
    });
  });

  describe("route", () => {
    test("registers itself as POST /cal-webhook", () => {
      expect(mockRouter.routes).toContainEqual(
        expect.objectContaining({ method: "POST", uri: "/cal-webhook" }),
      );
    });

    test("answers 503 and touches nothing when the secret is unconfigured", async () => {
      mockCalWebhookSecret = "";

      const { response } = await callRoute(
        buildSignedRequest({ body: bookingCreatedBody(), secret: SECRET }),
      );

      expect(response.statusCode).toBe(503);
      expect(MarketingConversionService.findOneById).not.toHaveBeenCalled();
      expect(MarketingConversionService.create).not.toHaveBeenCalled();
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
      "answers 401 and never reaches the database when %s",
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
        expect(MarketingConversionService.findOneById).not.toHaveBeenCalled();
        expect(MarketingConversionService.create).not.toHaveBeenCalled();
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
      expect(MarketingConversionService.create).not.toHaveBeenCalled();
    });

    test("acknowledges an unsupported event without writing a conversion", async () => {
      const { response } = await callRoute(
        buildSignedRequest({
          body: { triggerEvent: "BOOKING_CANCELLED", payload: { uid: "b1" } },
          secret: SECRET,
        }),
      );

      expect(response.statusCode).toBe(200);
      expect(response.jsonBody).toEqual({ accepted: false });
      expect(MarketingConversionService.findOneById).not.toHaveBeenCalled();
      expect(MarketingConversionService.create).not.toHaveBeenCalled();
    });

    test("records a MeetingBooked conversion keyed by the booking", async () => {
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

      const conversion: MarketingConversion = createdConversion();

      expect(conversion.conversionType).toBe(
        MarketingConversionType.MeetingBooked,
      );
      expect(conversion.id!.toString()).toBe(
        getCalBookingConversionId("booking-123").toString(),
      );
      expect(conversion.conversionAt).toEqual(
        new Date("2026-08-19T10:00:00.000Z"),
      );
      expect(conversion.email).toBe("buyer@example.com");
      expect(conversion.clickIds).toEqual({ gclid: "google-click" });
    });

    /*
     * The attribution the embed carried has to land on the ROW, not just be
     * parsed — the campaign columns are what makes a booked demo reportable,
     * and emailHash is the only thing that can later join this booking to the
     * signup it produced.
     */
    test("persists the campaign attribution onto the conversion row", async () => {
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

      const conversion: MarketingConversion = createdConversion();

      expect(conversion.utmSource).toBe("google");
      expect(conversion.utmMedium).toBe("cpc");
      expect(conversion.utmCampaign).toBe("enterprise-observability");
      expect(conversion.utmTerm).toBe("datadog alternative");
      expect(conversion.utmContent).toBe("demo-cta-b");
      expect(conversion.utmUrl).toBe(
        "https://oneuptime.com/enterprise/demo?gclid=abc",
      );
      /*
       * First touch is preserved separately from last touch: the campaign that
       * introduced this person is not the one that produced the booking.
       */
      expect(conversion.firstTouchAttribution).toEqual({
        utmSource: "linkedin",
        landingUrl: "https://oneuptime.com/enterprise",
      });
    });

    test("stores the SHA-256 of the attendee email as emailHash", async () => {
      await callRoute(
        buildSignedRequest({
          body: bookingCreatedBody({
            attendees: [{ email: "BUYER@Example.com" }],
          }),
          secret: SECRET,
        }),
      );

      expect(createdConversion().emailHash).toBe(
        Attribution.hashEmail("buyer@example.com"),
      );
    });

    test("stores no emailHash when the booking carried no attendee email", async () => {
      await callRoute(
        buildSignedRequest({
          body: bookingCreatedBody({ attendees: [] }),
          secret: SECRET,
        }),
      );

      expect(createdConversion().emailHash).toBeUndefined();
    });

    /*
     * Chains are computed by the worker, which is the only thing that can see
     * more than one conversion at once. A writer guessing at one would be
     * guessing.
     */
    test("never links the booking to another conversion itself", async () => {
      await callRoute(
        buildSignedRequest({ body: bookingCreatedBody(), secret: SECRET }),
      );

      expect(createdConversion().attributedToConversionId).toBeUndefined();
    });

    /*
     * A booking is not a signup and not a subscription: it belongs to no
     * OneUptime user or project, and it has no revenue. Inventing either would
     * make the ledger claim something the booking does not prove.
     */
    test("attributes the conversion to no user, project or revenue", async () => {
      await callRoute(
        buildSignedRequest({ body: bookingCreatedBody(), secret: SECRET }),
      );

      const conversion: MarketingConversion = createdConversion();

      expect(conversion.userId).toBeUndefined();
      expect(conversion.projectId).toBeUndefined();
      expect(conversion.conversionValueInUSDCents).toBeUndefined();
    });

    test("creates and reads with root props on this internal table", async () => {
      await callRoute(
        buildSignedRequest({ body: bookingCreatedBody(), secret: SECRET }),
      );

      expect(MarketingConversionService.findOneById).toHaveBeenCalledWith(
        expect.objectContaining({ props: { isRoot: true } }),
      );
      expect(MarketingConversionService.create).toHaveBeenCalledWith(
        expect.objectContaining({ props: { isRoot: true } }),
      );
    });

    test("looks the conversion up by its derived id", async () => {
      await callRoute(
        buildSignedRequest({ body: bookingCreatedBody(), secret: SECRET }),
      );

      const lookup: { id: ObjectID } = (
        MarketingConversionService.findOneById as unknown as jest.Mock
      ).mock.calls[0]![0] as { id: ObjectID };

      expect(lookup.id.toString()).toBe(
        getCalBookingConversionId("booking-123").toString(),
      );
    });

    // Cal retries on any non-2xx, so redelivery is the normal path.
    test("reports a redelivered booking as a duplicate without inserting", async () => {
      (
        MarketingConversionService.findOneById as unknown as jest.Mock
      ).mockResolvedValue(new MarketingConversion() as never);

      const { response } = await callRoute(
        buildSignedRequest({ body: bookingCreatedBody(), secret: SECRET }),
      );

      expect(response.statusCode).toBe(200);
      expect(response.jsonBody).toEqual({ accepted: true, duplicate: true });
      expect(MarketingConversionService.create).not.toHaveBeenCalled();
    });

    /*
     * The existence check and the insert are two statements. Two concurrent
     * deliveries of one booking both miss and both insert; the loser collides
     * on the derived primary key, which means the booking IS recorded.
     */
    test("absorbs a lost insert race as a duplicate rather than an error", async () => {
      (
        MarketingConversionService.create as unknown as jest.Mock
      ).mockRejectedValue(uniqueViolation() as never);

      const { response, nextError } = await callRoute(
        buildSignedRequest({ body: bookingCreatedBody(), secret: SECRET }),
      );

      expect(response.statusCode).toBe(200);
      expect(response.jsonBody).toEqual({ accepted: true, duplicate: true });
      expect(nextError).toBeUndefined();
    });

    test("two deliveries of one booking derive the same conversion id", async () => {
      await callRoute(
        buildSignedRequest({ body: bookingCreatedBody(), secret: SECRET }),
      );
      const first: MarketingConversion = createdConversion();

      (MarketingConversionService.create as unknown as jest.Mock).mockClear();

      /*
       * Cal re-sends the same booking with a later delivery timestamp and a
       * differently ordered payload — the derived id must not move.
       */
      await callRoute(
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
      const second: MarketingConversion = createdConversion();

      expect(second.id!.toString()).toBe(first.id!.toString());
    });

    // Anything that is not a duplicate is a real failure and must surface.
    test("passes a non-duplicate database failure to the error handler", async () => {
      const failure: Error = new Error("connection terminated");
      (
        MarketingConversionService.create as unknown as jest.Mock
      ).mockRejectedValue(failure as never);

      const { response, nextError } = await callRoute(
        buildSignedRequest({ body: bookingCreatedBody(), secret: SECRET }),
      );

      expect(nextError).toBe(failure);
      expect(response.statusCode).toBeNull();
    });

    test("passes a read failure to the error handler", async () => {
      const failure: Error = new Error("read timeout");
      (
        MarketingConversionService.findOneById as unknown as jest.Mock
      ).mockRejectedValue(failure as never);

      const { nextError } = await callRoute(
        buildSignedRequest({ body: bookingCreatedBody(), secret: SECRET }),
      );

      expect(nextError).toBe(failure);
    });
  });
});
