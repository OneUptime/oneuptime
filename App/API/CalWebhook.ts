import crypto from "crypto";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  OneUptimeRequest,
  headerValueToString,
} from "Common/Server/Utils/Express";
import { CalWebhookSecret } from "Common/Server/EnvironmentConfig";
import MarketingConversionService from "Common/Server/Services/MarketingConversionService";
import PostgresErrorTranslator from "Common/Server/Utils/Database/PostgresErrorTranslator";
import MarketingConversion from "Common/Models/DatabaseModels/MarketingConversion";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { MarketingConversionType } from "Common/Types/Marketing/MarketingConversion";

const router: ExpressRouter = Express.getRouter();
const CAL_SOURCE_NAMESPACE: string = "cal.com/booking";
const SUPPORTED_EVENT_TYPES: Set<string> = new Set<string>([
  "BOOKING_CREATED",
]);
const CLICK_ID_KEYS: Array<string> = [
  "gclid",
  "wbraid",
  "gbraid",
  "fbclid",
  "msclkid",
  "li_fat_id",
  "twclid",
  "rdt_cid",
];

export interface CalBookingConversion {
  bookingId: string;
  conversionAt: Date;
  email?: string | undefined;
  clickIds: JSONObject;
}

export function verifyCalWebhookSignature(data: {
  rawBody: string;
  signature: string;
  secret: string;
}): boolean {
  const suppliedHex: string = data.signature
    .trim()
    .replace(/^sha256=/i, "")
    .toLowerCase();

  if (!/^[a-f0-9]{64}$/.test(suppliedHex)) {
    return false;
  }

  const expected: Buffer = crypto
    .createHmac("sha256", data.secret)
    .update(data.rawBody)
    .digest();
  const supplied: Buffer = Buffer.from(suppliedHex, "hex");

  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function objectValue(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

function firstNonEmptyString(values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function collectClickIds(...objects: Array<JSONObject>): JSONObject {
  const result: JSONObject = {};
  for (const key of CLICK_ID_KEYS) {
    const value: string | undefined = firstNonEmptyString(
      objects.map((item: JSONObject) => {
        return item[key];
      }),
    );
    if (value) {
      result[key] = value.slice(0, 500);
    }
  }
  return result;
}

export function parseCalBookingConversion(
  body: JSONObject,
): CalBookingConversion | null {
  const eventType: string | undefined = firstNonEmptyString([
    body["triggerEvent"],
    body["eventType"],
  ]);
  if (!eventType || !SUPPORTED_EVENT_TYPES.has(eventType.toUpperCase())) {
    return null;
  }

  const payload: JSONObject = objectValue(body["payload"]);
  const booking: JSONObject = objectValue(payload["booking"]);
  const metadata: JSONObject = objectValue(payload["metadata"]);
  const bookingMetadata: JSONObject = objectValue(booking["metadata"]);
  const responses: JSONObject = objectValue(payload["responses"]);
  const bookingId: string | undefined = firstNonEmptyString([
    payload["uid"],
    booking["uid"],
    payload["bookingUid"],
    booking["id"],
    payload["id"],
  ]);

  if (!bookingId || bookingId.length > 500) {
    throw new Error("Cal BOOKING_CREATED payload has no valid booking identifier");
  }

  const rawDate: string | undefined = firstNonEmptyString([
    payload["startTime"],
    booking["startTime"],
    payload["createdAt"],
  ]);
  const conversionAt: Date = rawDate ? new Date(rawDate) : new Date();
  if (Number.isNaN(conversionAt.getTime())) {
    throw new Error("Cal BOOKING_CREATED payload has an invalid date");
  }

  const attendees: Array<JSONObject> = Array.isArray(payload["attendees"])
    ? (payload["attendees"] as Array<JSONObject>)
    : [];
  const email: string | undefined = firstNonEmptyString([
    attendees[0]?.["email"],
    payload["email"],
  ])
    ?.toLowerCase()
    .slice(0, 100);

  return {
    bookingId,
    conversionAt,
    ...(email ? { email } : {}),
    clickIds: collectClickIds(metadata, bookingMetadata, responses),
  };
}

export function getCalBookingConversionId(bookingId: string): ObjectID {
  const bytes: Buffer = crypto
    .createHash("sha256")
    .update(`${CAL_SOURCE_NAMESPACE}:${bookingId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex: string = bytes.toString("hex");
  return new ObjectID(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
  );
}

router.post(
  "/cal-webhook",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!CalWebhookSecret) {
        res.status(503).json({ error: "Cal webhook is not configured" });
        return;
      }

      const rawBody: string = (req as OneUptimeRequest).rawBody || "";
      const signature: string | undefined = headerValueToString(
        req.headers["x-cal-signature-256"],
      );
      if (
        !rawBody ||
        !signature ||
        !verifyCalWebhookSignature({
          rawBody,
          signature,
          secret: CalWebhookSecret,
        })
      ) {
        res.status(401).json({ error: "Invalid Cal webhook signature" });
        return;
      }

      let parsed: CalBookingConversion | null;
      try {
        parsed = parseCalBookingConversion((req.body || {}) as JSONObject);
      } catch {
        res.status(400).json({ error: "Invalid Cal webhook payload" });
        return;
      }

      if (!parsed) {
        res.status(200).json({ accepted: false });
        return;
      }

      const conversionId: ObjectID = getCalBookingConversionId(
        parsed.bookingId,
      );
      const existing: MarketingConversion | null =
        await MarketingConversionService.findOneById({
          id: conversionId,
          select: { _id: true },
          props: { isRoot: true },
        });
      if (existing) {
        res.status(200).json({ accepted: true, duplicate: true });
        return;
      }

      const conversion: MarketingConversion = new MarketingConversion();
      conversion.id = conversionId;
      conversion.conversionType = MarketingConversionType.MeetingBooked;
      conversion.conversionAt = parsed.conversionAt;
      conversion.clickIds = parsed.clickIds;
      conversion.email = parsed.email;

      try {
        await MarketingConversionService.create({
          data: conversion,
          props: { isRoot: true },
        });
      } catch (error) {
        if (!PostgresErrorTranslator.isUniqueViolation(error)) {
          throw error;
        }
      }

      res.status(200).json({ accepted: true });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
