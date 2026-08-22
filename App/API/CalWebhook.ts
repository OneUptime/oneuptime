import crypto from "crypto";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  OneUptimeRequest,
  headerValueToString,
} from "Common/Server/Utils/Express";
import Attribution, { UtmAttribution } from "Common/Server/Utils/Attribution";
import { CalWebhookSecret } from "Common/Server/EnvironmentConfig";
import MarketingConversionService from "Common/Server/Services/MarketingConversionService";
import PostgresErrorTranslator from "Common/Server/Utils/Database/PostgresErrorTranslator";
import logger from "Common/Server/Utils/Logger";
import MarketingConversion from "Common/Models/DatabaseModels/MarketingConversion";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  AdClickIdKeys,
  UtmWireKeyToPropertyKey,
} from "Common/Types/Marketing/Attribution";
import { MarketingConversionType } from "Common/Types/Marketing/MarketingConversion";

/*
 * Cal.com booking webhook — the only writer of MeetingBooked rows in the
 * MarketingConversion ledger. Cal signs the exact request bytes with
 * CAL_WEBHOOK_SECRET, so the route authenticates itself and needs no
 * OneUptime session. The browser `meeting_booked` analytics event on the demo
 * pages is a mirror of the same moment, not a second source of truth — see
 * Docs/analytics/enterprise-conversion-tracking.md.
 */

const router: ExpressRouter = Express.getRouter();

/*
 * Namespace for the deterministic conversion id. Changing it re-keys every
 * future booking, so bookings already in the ledger would be insertable a
 * second time — never change it.
 */
const CAL_SOURCE_NAMESPACE: string = "cal.com/booking";

/*
 * Only a created booking is a conversion. A reschedule or a cancellation is a
 * change to a booking that already converted, and Cal sends those through the
 * same endpoint.
 */
const SUPPORTED_EVENT_TYPES: Set<string> = new Set<string>(["BOOKING_CREATED"]);

/*
 * The attribution keys the demo/support embeds put into Cal booking metadata
 * (Home/Views/head-basic.ejs -> oneUptimeCalAttributionMetadata) and that are
 * retained here. Only these are copied — everything else Cal sends is
 * free-form customer content (names, notes, answers to booking questions) and
 * must not land in the ledger.
 *
 * The click-id half of this used to be parsed while the embeds sent nothing at
 * all, so every MeetingBooked row carried an empty clickIds object. The
 * embeds now send both halves; see
 * Docs/analytics/enterprise-conversion-tracking.md.
 */
const CLICK_ID_KEYS: Array<string> = AdClickIdKeys;

/*
 * Cal metadata values are scalars, so the visitor's first touch travels as one
 * JSON string under this key rather than as nested structure.
 */
const FIRST_TOUCH_METADATA_KEY: string = "ou_first_touch";

// Bounds the JSON blob a caller can push through the first-touch key.
const MAX_FIRST_TOUCH_LENGTH: number = 4000;

// A hex-encoded SHA-256 digest, with Cal's optional `sha256=` prefix removed.
const HEX_DIGEST_REGEX: RegExp = /^[a-f0-9]{64}$/;
const SIGNATURE_PREFIX_REGEX: RegExp = /^sha256=/i;

const MAX_BOOKING_ID_LENGTH: number = 500;
const MAX_CLICK_ID_LENGTH: number = 500;
// Matches the ShortText width of MarketingConversion.email.
const MAX_EMAIL_LENGTH: number = 100;

export interface CalBookingConversion {
  bookingId: string;
  conversionAt: Date;
  email?: string | undefined;
  clickIds: JSONObject;
  utm: UtmAttribution;
  firstTouchAttribution?: JSONObject | undefined;
}

export type VerifyCalWebhookSignatureFunction = (data: {
  rawBody: string;
  signature: string;
  secret: string;
}) => boolean;

/*
 * HMAC-SHA256 over the raw request bytes, as Cal computes it. Re-serialising
 * the parsed JSON would not reproduce the same bytes (whitespace, escaping and
 * key order all differ), so the caller must pass the body express captured
 * before parsing.
 */
export const verifyCalWebhookSignature: VerifyCalWebhookSignatureFunction =
  (data: { rawBody: string; signature: string; secret: string }): boolean => {
    const suppliedHex: string = data.signature
      .trim()
      .replace(SIGNATURE_PREFIX_REGEX, "")
      .toLowerCase();

    /*
     * timingSafeEqual throws on a length mismatch, and Buffer.from() silently
     * truncates at the first non-hex character — so the shape is checked before
     * either of them sees the value.
     */
    if (!HEX_DIGEST_REGEX.test(suppliedHex)) {
      return false;
    }

    const expected: Buffer = crypto
      .createHmac("sha256", data.secret)
      .update(data.rawBody)
      .digest();

    return crypto.timingSafeEqual(Buffer.from(suppliedHex, "hex"), expected);
  };

type ObjectValueFunction = (value: JSONValue | undefined) => JSONObject;

const objectValue: ObjectValueFunction = (
  value: JSONValue | undefined,
): JSONObject => {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
};

type FirstNonEmptyStringFunction = (
  values: Array<JSONValue | undefined>,
) => string | undefined;

const firstNonEmptyString: FirstNonEmptyStringFunction = (
  values: Array<JSONValue | undefined>,
): string | undefined => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
};

/*
 * Cal identifies a booking by its string `uid` but numbers its rows, so `id`
 * arrives as a number. Both are accepted; a number is stringified so the
 * derived conversion id is stable whichever field carried it.
 */
type FirstIdentifierFunction = (
  values: Array<JSONValue | undefined>,
) => string | undefined;

const firstIdentifier: FirstIdentifierFunction = (
  values: Array<JSONValue | undefined>,
): string | undefined => {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }

    const asString: string | undefined = firstNonEmptyString([value]);

    if (asString) {
      return asString;
    }
  }

  return undefined;
};

/*
 * Answers to Cal booking questions arrive either as a bare value or as
 * `{ label, value }` depending on the Cal version, so unwrap one level.
 */
type UnwrapResponseValueFunction = (
  value: JSONValue | undefined,
) => JSONValue | undefined;

const unwrapResponseValue: UnwrapResponseValueFunction = (
  value: JSONValue | undefined,
): JSONValue | undefined => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return (value as JSONObject)["value"];
  }

  return value;
};

type CollectClickIdsFunction = (
  sources: Array<JSONObject>,
  responses: JSONObject,
) => JSONObject;

const collectClickIds: CollectClickIdsFunction = (
  sources: Array<JSONObject>,
  responses: JSONObject,
): JSONObject => {
  const clickIds: JSONObject = {};

  for (const key of CLICK_ID_KEYS) {
    const value: string | undefined = firstNonEmptyString([
      ...sources.map((source: JSONObject) => {
        return source[key];
      }),
      unwrapResponseValue(responses[key]),
    ]);

    if (value) {
      clickIds[key] = value.slice(0, MAX_CLICK_ID_LENGTH);
    }
  }

  return clickIds;
};

type CollectUtmFunction = (
  sources: Array<JSONObject>,
  responses: JSONObject,
) => UtmAttribution;

/*
 * UTM parameters out of the same three places the click ids come from.
 *
 * Collected into a flat object first and sanitised in one pass, so the
 * whitelist and the length bound are Attribution's single definition rather
 * than a second copy that can drift from the one the signup path uses.
 */
const collectUtm: CollectUtmFunction = (
  sources: Array<JSONObject>,
  responses: JSONObject,
): UtmAttribution => {
  const collected: JSONObject = {};

  const wireKeys: Array<string> = [
    ...Object.keys(UtmWireKeyToPropertyKey),
    "utm_url",
  ];

  for (const key of wireKeys) {
    const value: string | undefined = firstNonEmptyString([
      ...sources.map((source: JSONObject) => {
        return source[key];
      }),
      unwrapResponseValue(responses[key]),
    ]);

    if (value) {
      collected[key] = value;
    }
  }

  return Attribution.sanitizeUtm(collected);
};

type CollectFirstTouchFunction = (
  sources: Array<JSONObject>,
  responses: JSONObject,
) => JSONObject | undefined;

/*
 * The visitor's first attributed touch, which the embed sends as one JSON
 * string because Cal metadata values are scalars.
 *
 * Parsing caller-supplied JSON is only safe because nothing structural is
 * trusted afterwards: the result goes straight through
 * Attribution.sanitizeFirstTouchAttribution, which whitelists keys and bounds
 * every value. A malformed string yields no first touch rather than a failed
 * booking — the booking is the conversion, and losing its attribution must
 * never lose the conversion too.
 */
const collectFirstTouch: CollectFirstTouchFunction = (
  sources: Array<JSONObject>,
  responses: JSONObject,
): JSONObject | undefined => {
  const raw: string | undefined = firstNonEmptyString([
    ...sources.map((source: JSONObject) => {
      return source[FIRST_TOUCH_METADATA_KEY];
    }),
    unwrapResponseValue(responses[FIRST_TOUCH_METADATA_KEY]),
  ]);

  if (!raw || raw.length > MAX_FIRST_TOUCH_LENGTH) {
    return undefined;
  }

  let parsed: JSONValue;

  try {
    parsed = JSON.parse(raw) as JSONValue;
  } catch {
    return undefined;
  }

  return Attribution.sanitizeFirstTouchAttribution(parsed);
};

export type ParseCalBookingConversionFunction = (
  body: JSONObject,
) => CalBookingConversion | null;

/*
 * Null means "validly signed, but not an event this endpoint converts on" —
 * the delivery is acknowledged and dropped. A throw means the event IS a
 * BOOKING_CREATED but is unusable, which is a 400 so the failure is visible in
 * Cal's delivery log rather than silently swallowed.
 */
export const parseCalBookingConversion: ParseCalBookingConversionFunction = (
  body: JSONObject,
): CalBookingConversion | null => {
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

  const bookingId: string | undefined = firstIdentifier([
    payload["uid"],
    booking["uid"],
    payload["bookingUid"],
    booking["id"],
    payload["id"],
  ]);

  if (!bookingId || bookingId.length > MAX_BOOKING_ID_LENGTH) {
    throw new Error(
      "Cal BOOKING_CREATED payload has no usable booking identifier",
    );
  }

  const rawDate: string | undefined = firstNonEmptyString([
    payload["startTime"],
    booking["startTime"],
    payload["createdAt"],
  ]);
  const conversionAt: Date = rawDate ? new Date(rawDate) : new Date();

  if (Number.isNaN(conversionAt.getTime())) {
    throw new Error("Cal BOOKING_CREATED payload has an invalid booking date");
  }

  const attendees: Array<JSONObject> = Array.isArray(payload["attendees"])
    ? (payload["attendees"] as Array<JSONObject>)
    : [];
  const email: string | undefined = firstNonEmptyString([
    objectValue(attendees[0])["email"],
    payload["email"],
  ])
    ?.toLowerCase()
    .slice(0, MAX_EMAIL_LENGTH);

  const sources: Array<JSONObject> = [metadata, bookingMetadata];

  const firstTouchAttribution: JSONObject | undefined = collectFirstTouch(
    sources,
    responses,
  );

  return {
    bookingId: bookingId,
    conversionAt: conversionAt,
    ...(email ? { email: email } : {}),
    clickIds: collectClickIds(sources, responses),
    utm: collectUtm(sources, responses),
    ...(firstTouchAttribution
      ? { firstTouchAttribution: firstTouchAttribution }
      : {}),
  };
};

export type GetCalBookingConversionIdFunction = (bookingId: string) => ObjectID;

/*
 * A UUIDv5-shaped id derived from the booking, so every delivery and redelivery
 * of one booking resolves to the same primary key. Cal retries on any non-2xx
 * and can deliver the same booking more than once; without a derived key each
 * retry would insert another conversion.
 *
 * SHA-256 truncated to 16 bytes rather than RFC 4122's SHA-1, with the version
 * and variant nibbles set so the value is a well-formed UUID that Postgres and
 * ObjectID accept.
 */
export const getCalBookingConversionId: GetCalBookingConversionIdFunction = (
  bookingId: string,
): ObjectID => {
  const bytes: Buffer = crypto
    .createHash("sha256")
    .update(`${CAL_SOURCE_NAMESPACE}:${bookingId}`)
    .digest()
    .subarray(0, 16);

  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex: string = bytes.toString("hex");

  return new ObjectID(
    [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-"),
  );
};

export type CalWebhookRouteHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

export const calWebhookRouteHandler: CalWebhookRouteHandler = async (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!CalWebhookSecret) {
      logger.warn(
        "Cal webhook received but CAL_WEBHOOK_SECRET is not configured",
      );
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
        rawBody: rawBody,
        signature: signature,
        secret: CalWebhookSecret,
      })
    ) {
      logger.warn("Cal webhook rejected: missing or invalid signature");
      res.status(401).json({ error: "Invalid Cal webhook signature" });
      return;
    }

    let parsed: CalBookingConversion | null = null;

    try {
      parsed = parseCalBookingConversion((req.body || {}) as JSONObject);
    } catch (err) {
      logger.error(err);
      res.status(400).json({ error: "Invalid Cal webhook payload" });
      return;
    }

    if (!parsed) {
      res.status(200).json({ accepted: false });
      return;
    }

    const conversionId: ObjectID = getCalBookingConversionId(parsed.bookingId);

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

    /*
     * The hash, not the address, is what leaves this service: ad platforms get
     * it for enhanced matching, and the worker joins this booking to the
     * signup it later produced by it. Storing it here rather than deriving it
     * downstream keeps the value stable even if the email column is later
     * redacted.
     */
    const emailHash: string | null = Attribution.hashEmail(parsed.email);

    if (emailHash) {
      conversion.emailHash = emailHash;
    }

    conversion.utmSource = parsed.utm.utmSource;
    conversion.utmMedium = parsed.utm.utmMedium;
    conversion.utmCampaign = parsed.utm.utmCampaign;
    conversion.utmTerm = parsed.utm.utmTerm;
    conversion.utmContent = parsed.utm.utmContent;
    conversion.utmUrl = parsed.utm.utmUrl;
    conversion.firstTouchAttribution = parsed.firstTouchAttribution;

    try {
      await MarketingConversionService.create({
        data: conversion,
        props: { isRoot: true },
      });
    } catch (err) {
      /*
       * The read above and this insert are two statements: two deliveries of
       * one booking can both miss and both insert. The loser collides on the
       * derived primary key, which means the booking IS recorded — the whole
       * point of deriving the key — so it is a success, not a failure.
       */
      if (!PostgresErrorTranslator.isUniqueViolation(err)) {
        throw err;
      }

      res.status(200).json({ accepted: true, duplicate: true });
      return;
    }

    res.status(200).json({ accepted: true });
  } catch (err) {
    return next(err);
  }
};

router.post("/cal-webhook", calWebhookRouteHandler);

export default router;
