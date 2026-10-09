import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import { resolveClientIp } from "Common/Server/Utils/ClientIp";
import Response from "Common/Server/Utils/Response";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import PushNotificationService, {
  ExpoDeviceNotRegisteredError,
  ExpoInterruptionLevel,
  ExpoPushRefusedError,
  ExpoPushSound,
  MAX_EXPO_PUSH_RECEIPT_IDS_PER_REQUEST,
} from "Common/Server/Services/PushNotificationService";

const router: ExpressRouter = Express.getRouter();

const RATE_LIMIT_WINDOW_MS: number = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS: number = 60; // 60 requests per minute per IP

/*
 * A simple in-memory rate limiter by client IP: RATE_LIMIT_MAX_REQUESTS a
 * minute. Each route has its own, so the receipts a server asks for never
 * use up the requests its pages are sent with - a page refused for the
 * relay's rate limit is not delivered.
 */
export class RelayRateLimiter {
  private readonly entries: Map<string, { count: number; resetTime: number }> =
    new Map();

  public isRateLimited(ip: string, now: number = Date.now()): boolean {
    const entry: { count: number; resetTime: number } | undefined =
      this.entries.get(ip);

    if (!entry || now > entry.resetTime) {
      this.entries.set(ip, {
        count: 1,
        resetTime: now + RATE_LIMIT_WINDOW_MS,
      });
      return false;
    }

    entry.count++;

    return entry.count > RATE_LIMIT_MAX_REQUESTS;
  }

  // Forget the addresses whose window has passed.
  public prune(now: number = Date.now()): void {
    for (const [ip, entry] of this.entries.entries()) {
      if (now > entry.resetTime) {
        this.entries.delete(ip);
      }
    }
  }
}

const sendRateLimiter: RelayRateLimiter = new RelayRateLimiter();
const receiptsRateLimiter: RelayRateLimiter = new RelayRateLimiter();

// Clean up stale rate limit entries every 5 minutes
setInterval(
  () => {
    sendRateLimiter.prune();
    receiptsRateLimiter.prune();
  },
  5 * 60 * 1000,
);

/*
 * A critical alert is the one payload shape that can ring a silenced phone, so
 * the relay parses `sound` and `interruptionLevel` instead of forwarding
 * whatever arrived. This endpoint is unauthenticated (rate limited by client
 * IP only), and an unvalidated pass-through would let any caller who can reach
 * it hand Expo arbitrary structures under this deployment's Expo credentials.
 *
 * Strictness is one-directional on purpose: a malformed value is refused
 * rather than quietly downgraded, because a critical page that silently
 * degrades to a normal notification is exactly the missed-incident failure
 * this feature exists to prevent.
 */
const MAX_SOUND_NAME_LENGTH: number = 100;

const ALLOWED_INTERRUPTION_LEVELS: Array<ExpoInterruptionLevel> = [
  "active",
  "critical",
  "passive",
  "time-sensitive",
];

export function parseRelaySound(raw: unknown): ExpoPushSound | undefined {
  // Absent means "caller did not say", which the service turns into "default".
  if (raw === undefined) {
    return undefined;
  }

  // Explicit null is a request for a silent notification and is honoured.
  if (raw === null) {
    return null;
  }

  if (typeof raw === "string") {
    if (raw.length > MAX_SOUND_NAME_LENGTH) {
      throw new BadDataException("Push notification sound name is too long.");
    }
    return raw;
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new BadDataException(
      "Push notification sound must be a string, null, or a critical-alert object.",
    );
  }

  const soundObject: JSONObject = raw as JSONObject;
  const parsed: { critical?: boolean; name?: string | null; volume?: number } =
    {};

  const critical: unknown = soundObject["critical"];
  if (critical !== undefined) {
    if (typeof critical !== "boolean") {
      throw new BadDataException(
        "Push notification sound 'critical' must be a boolean.",
      );
    }
    parsed.critical = critical;
  }

  const name: unknown = soundObject["name"];
  if (name !== undefined) {
    if (name !== null && typeof name !== "string") {
      throw new BadDataException(
        "Push notification sound 'name' must be a string or null.",
      );
    }
    if (typeof name === "string" && name.length > MAX_SOUND_NAME_LENGTH) {
      throw new BadDataException("Push notification sound name is too long.");
    }
    parsed.name = name as string | null;
  }

  const volume: unknown = soundObject["volume"];
  if (volume !== undefined) {
    if (typeof volume !== "number" || !Number.isFinite(volume)) {
      throw new BadDataException(
        "Push notification sound 'volume' must be a number between 0 and 1.",
      );
    }
    /*
     * Clamped rather than refused: out-of-range is a caller bug, not an attack,
     * and refusing would drop the page.
     */
    parsed.volume = Math.min(1, Math.max(0, volume));
  }

  return parsed;
}

export function parseRelayInterruptionLevel(
  raw: unknown,
): ExpoInterruptionLevel | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (
    typeof raw !== "string" ||
    !ALLOWED_INTERRUPTION_LEVELS.includes(raw as ExpoInterruptionLevel)
  ) {
    throw new BadDataException(
      `Push notification interruptionLevel must be one of: ${ALLOWED_INTERRUPTION_LEVELS.join(", ")}.`,
    );
  }

  return raw as ExpoInterruptionLevel;
}

/*
 * The receipt ids a server asks the relay about: the ids the relay answered
 * its sends with. A list of 1 to MAX_EXPO_PUSH_RECEIPT_IDS_PER_REQUEST
 * receipt ids (Expo's own chunk size, one request to Expo), each asked for
 * once. Anything else is refused: this route is unauthenticated, and what it
 * passes on goes to Expo under this deployment's access token.
 */
export function parseRelayReceiptIds(raw: unknown): Array<string> {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new BadDataException(
      "'ids' must be a list of the receipt ids the relay answered its sends with.",
    );
  }

  if (raw.length > MAX_EXPO_PUSH_RECEIPT_IDS_PER_REQUEST) {
    throw new BadDataException(
      `At most ${MAX_EXPO_PUSH_RECEIPT_IDS_PER_REQUEST} receipt ids can be asked for at once.`,
    );
  }

  const ids: Array<string> = [];

  for (const id of raw) {
    if (!PushNotificationService.isExpoPushReceiptId(id)) {
      throw new BadDataException("Each receipt id must be a receipt id.");
    }

    if (!ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
}

router.post(
  "/send",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      /*
       * Key the limiter on the resolved client address, not the leftmost
       * X-Forwarded-For entry. That entry is written by the caller, so a
       * caller who varied it got a fresh 60/minute bucket every request and
       * the limit did not exist. Callers we cannot place share the "unknown"
       * bucket, which is the conservative direction for a limiter.
       */
      const clientIp: string = resolveClientIp(req) || "unknown";

      if (sendRateLimiter.isRateLimited(clientIp)) {
        res.status(429).json({
          message: "Rate limit exceeded. Please try again later.",
        });
        return;
      }

      if (!PushNotificationService.hasExpoAccessToken()) {
        throw new BadDataException(
          "Push relay is not configured. EXPO_ACCESS_TOKEN is not set on this server.",
        );
      }

      const body: JSONObject = req.body as JSONObject;

      const to: string | undefined = body["to"] as string | undefined;

      if (!to || !PushNotificationService.isValidExpoPushToken(to)) {
        throw new BadDataException(
          "Invalid or missing push token. Must be a valid Expo push token.",
        );
      }

      const title: string | undefined = body["title"] as string | undefined;
      const messageBody: string | undefined = body["body"] as
        | string
        | undefined;

      if (!title && !messageBody) {
        throw new BadDataException(
          "At least one of 'title' or 'body' must be provided.",
        );
      }

      const sound: ExpoPushSound | undefined = parseRelaySound(body["sound"]);
      const interruptionLevel: ExpoInterruptionLevel | undefined =
        parseRelayInterruptionLevel(body["interruptionLevel"]);

      const receiptId: string | undefined =
        await PushNotificationService.sendRelayPushNotification({
          to: to,
          ...(title !== undefined ? { title } : {}),
          ...(messageBody !== undefined ? { body: messageBody } : {}),
          data: (body["data"] as { [key: string]: string }) || {},
          sound: sound === undefined ? "default" : sound,
          priority: (body["priority"] as string) || "high",
          channelId: (body["channelId"] as string) || "default",
          ...(interruptionLevel ? { interruptionLevel } : {}),
        });

      /*
       * The receipt id of the push Expo accepted, for the server to ask
       * whether it was delivered (POST /receipts, about 15 minutes on). A
       * server older than this reads `success` and nothing else.
       */
      return Response.sendJsonObjectResponse(req, res, {
        success: true,
        ...(receiptId ? { receiptId: receiptId } : {}),
      });
    } catch (err) {
      /*
       * Expo says the token is gone. Answered apart from every other
       * failure, so the server that relayed the page can stop sending to
       * the token (PushNotificationService.sendViaRelay). It used to reach
       * the error handler like any failure and come back as 500 "Server
       * Error". Still a failure to a server that does not know this answer,
       * which counts the send as failed, as it always did.
       */
      if (err instanceof ExpoDeviceNotRegisteredError) {
        res
          .status(
            PushNotificationService.RELAY_DEVICE_NOT_REGISTERED_STATUS_CODE,
          )
          .json(PushNotificationService.getRelayDeviceNotRegisteredAnswer());
        return;
      }

      /*
       * Expo refused the push for another reason - the message is too big,
       * the phone got too many too fast, the push credentials are not
       * valid. Answered with Expo's code and words, where it used to be 500
       * "Server Error", which told the server that relayed the page nothing.
       * Still a failure to every server, of any version.
       */
      if (err instanceof ExpoPushRefusedError) {
        res
          .status(PushNotificationService.RELAY_EXPO_REFUSAL_STATUS_CODE)
          .json(PushNotificationService.getRelayExpoRefusalAnswer(err));
        return;
      }

      return next(err);
    }
  },
);

/*
 * Whether the pushes a server relayed were delivered: their receipts, which
 * the relay reads from Expo with its access token, since the server that
 * relayed them has none. The server asks with the receipt ids the relay
 * answered its sends with, about 15 minutes after each (its workers'
 * ExpoPushReceiptService). Answered as { receipts: { <id>: receipt } }, a
 * receipt that is not ready yet left out, as Expo does.
 *
 * The relay keeps nothing about the pushes it sends: each server keeps its
 * own receipt ids and asks for them. Like /send, the route is
 * unauthenticated and rate limited by client IP, in a bucket of its own; a
 * receipt id is a random UUID only its sender was given, and an answer
 * carries no push token.
 */
router.post(
  "/receipts",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const clientIp: string = resolveClientIp(req) || "unknown";

      if (receiptsRateLimiter.isRateLimited(clientIp)) {
        res.status(429).json({
          message: "Rate limit exceeded. Please try again later.",
        });
        return;
      }

      if (!PushNotificationService.hasExpoAccessToken()) {
        throw new BadDataException(
          "Push relay is not configured. EXPO_ACCESS_TOKEN is not set on this server.",
        );
      }

      const body: JSONObject = (req.body as JSONObject) || {};

      const receiptIds: Array<string> = parseRelayReceiptIds(body["ids"]);

      const receipts: JSONObject =
        await PushNotificationService.getRelayPushReceipts(receiptIds);

      return Response.sendJsonObjectResponse(req, res, {
        receipts: receipts,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
