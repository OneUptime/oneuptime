import crypto from "crypto";
import {
  getCalBookingConversionId,
  parseCalBookingConversion,
  verifyCalWebhookSignature,
} from "../API/CalWebhook";

jest.mock("Common/Server/Services/MarketingConversionService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      create: jest.fn(),
    },
  };
});

describe("Cal webhook conversion foundation", () => {
  test("verifies the exact raw body and accepts Cal's optional sha256 prefix", () => {
    const secret: string = "test-secret";
    const rawBody: string = '{"triggerEvent":"BOOKING_CREATED"}';
    const signature: string = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");

    expect(verifyCalWebhookSignature({ rawBody, signature, secret })).toBe(true);
    expect(
      verifyCalWebhookSignature({
        rawBody,
        signature: `sha256=${signature}`,
        secret,
      }),
    ).toBe(true);
    expect(
      verifyCalWebhookSignature({
        rawBody: `${rawBody} `,
        signature,
        secret,
      }),
    ).toBe(false);
  });

  test("rejects malformed signatures without throwing on unequal buffers", () => {
    expect(
      verifyCalWebhookSignature({
        rawBody: "{}",
        signature: "not-a-signature",
        secret: "test-secret",
      }),
    ).toBe(false);
  });

  test("parses only BOOKING_CREATED and allowlists attribution fields", () => {
    const conversion = parseCalBookingConversion({
      triggerEvent: "BOOKING_CREATED",
      payload: {
        uid: "booking-123",
        startTime: "2026-08-19T10:00:00.000Z",
        attendees: [{ email: "BUYER@EXAMPLE.COM", name: "Private Name" }],
        metadata: {
          gclid: "google-click",
          unknown: "must-not-be-retained",
        },
        responses: {
          fbclid: "meta-click",
          notes: "must-not-be-retained",
        },
      },
    });

    expect(conversion).toEqual({
      bookingId: "booking-123",
      conversionAt: new Date("2026-08-19T10:00:00.000Z"),
      email: "buyer@example.com",
      clickIds: {
        gclid: "google-click",
        fbclid: "meta-click",
      },
    });
    expect(
      parseCalBookingConversion({
        triggerEvent: "BOOKING_CANCELLED",
        payload: { uid: "booking-123" },
      }),
    ).toBeNull();
  });

  test("derives a stable UUID from the Cal booking id", () => {
    const first: string = getCalBookingConversionId("booking-123").toString();
    const retry: string = getCalBookingConversionId("booking-123").toString();
    const other: string = getCalBookingConversionId("booking-456").toString();

    expect(first).toBe(retry);
    expect(first).not.toBe(other);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
