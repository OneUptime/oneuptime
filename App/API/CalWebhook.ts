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
import MarketingEventUtil from "Common/Server/Utils/Marketing/MarketingEventUtil";
import logger from "Common/Server/Utils/Logger";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  AdClickIdKeys,
  UtmWireKeyToPropertyKey,
} from "Common/Types/Marketing/Attribution";
import { MarketingEventType } from "Common/Types/Marketing/MarketingEvent";

/*
 * Cal.com booking webhook — the only source of the meeting_booked conversion.
 * Cal signs the exact request bytes with CAL_WEBHOOK_SECRET, so the route
 * authenticates itself and needs no OneUptime session.
 *
 * Nothing here is stored. A verified booking is parsed, turned into an
 * outbound marketing event and handed to the delivery queue; the browser
 * `meeting_booked` analytics event on the demo pages is a mirror of the same
 * moment, not a second source of truth — see
 * Docs/analytics/marketing-event-webhooks.md.
 */

const router: ExpressRouter = Express.getRouter();

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
// Bounds what an unauthenticated caller can push through in the email field.
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

    /*
     * Emit rather than store.
     *
     * OneUptime keeps no conversion ledger, so there is no row to read back
     * and no unique key to collide on — which also means this endpoint can no
     * longer tell a first delivery from a retry. That is deliberate and it is
     * why eventId is the booking uid: Cal retrying, or the queue retrying,
     * produces the same id every time and the receiver deduplicates on it.
     *
     * The response is therefore always `accepted: true` with no `duplicate`
     * flag. Cal only needs a 2xx to stop retrying.
     */
    /*
     * Isolated from the response path on purpose. Everything above has already
     * succeeded — the signature verified and the booking parsed — so Cal is
     * owed its 2xx whatever happens here. Letting an emit failure reach the
     * outer catch would answer 500, and Cal retries on any non-2xx, so a
     * broken queue would turn one booking into a retry storm.
     */
    try {
      MarketingEventUtil.emitInBackground(
        MarketingEventUtil.buildEvent({
          eventType: MarketingEventType.MeetingBooked,
          eventId: `${MarketingEventType.MeetingBooked}:${parsed.bookingId}`,
          /*
           * When the booking was MADE, not when the meeting starts. The old
           * ledger stamped this with the meeting's start time, which is in the
           * future and forced every consumer to clamp it before it could order
           * a booking against a signup. The meeting time is still reported, as
           * data.meetingStartsAt, where being in the future is unsurprising.
           */
          occurredAt: new Date(),
          email: parsed.email,
          attributionSource: {
            utmSource: parsed.utm.utmSource,
            utmMedium: parsed.utm.utmMedium,
            utmCampaign: parsed.utm.utmCampaign,
            utmTerm: parsed.utm.utmTerm,
            utmContent: parsed.utm.utmContent,
            utmUrl: parsed.utm.utmUrl,
            clickIds: parsed.clickIds,
            firstTouchAttribution: parsed.firstTouchAttribution,
          },
          data: {
            calBookingId: parsed.bookingId,
            meetingStartsAt: parsed.conversionAt.toISOString(),
          },
        }),
      );
    } catch (err) {
      logger.error(
        `Cal webhook: failed to emit meeting_booked for booking ${parsed.bookingId}: ${err}`,
      );
    }

    res.status(200).json({ accepted: true });
  } catch (err) {
    return next(err);
  }
};

router.post("/cal-webhook", calWebhookRouteHandler);

export default router;
