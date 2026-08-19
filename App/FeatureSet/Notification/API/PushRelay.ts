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
  ExpoInterruptionLevel,
  ExpoPushSound,
} from "Common/Server/Services/PushNotificationService";

const router: ExpressRouter = Express.getRouter();

// Simple in-memory rate limiter by IP
const rateLimitMap: Map<string, { count: number; resetTime: number }> =
  new Map();
const RATE_LIMIT_WINDOW_MS: number = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS: number = 60; // 60 requests per minute per IP

function isRateLimited(ip: string): boolean {
  const now: number = Date.now();
  const entry: { count: number; resetTime: number } | undefined =
    rateLimitMap.get(ip);

  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count++;

  return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

// Clean up stale rate limit entries every 5 minutes
setInterval(
  () => {
    const now: number = Date.now();
    for (const [ip, entry] of rateLimitMap.entries()) {
      if (now > entry.resetTime) {
        rateLimitMap.delete(ip);
      }
    }
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

      if (isRateLimited(clientIp)) {
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

      return Response.sendJsonObjectResponse(req, res, { success: true });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
