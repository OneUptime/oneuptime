import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import { Expo, ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import { ExpoAccessToken } from "Common/Server/EnvironmentConfig";
import logger from "Common/Server/Utils/Logger";

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
setInterval(() => {
  const now: number = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now > entry.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}, 5 * 60 * 1000);

// Expo client for sending push notifications (only available when EXPO_ACCESS_TOKEN is set)
const expoClient: Expo | null = ExpoAccessToken
  ? new Expo({ accessToken: ExpoAccessToken })
  : null;

router.post(
  "/send",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const clientIp: string =
        (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        req.socket.remoteAddress ||
        "unknown";

      if (isRateLimited(clientIp)) {
        res.status(429).json({
          message: "Rate limit exceeded. Please try again later.",
        });
        return;
      }

      if (!expoClient) {
        throw new BadDataException(
          "Push relay is not configured. EXPO_ACCESS_TOKEN is not set on this server.",
        );
      }

      const body: JSONObject = req.body as JSONObject;

      const to: string | undefined = body["to"] as string | undefined;

      if (!to || !Expo.isExpoPushToken(to)) {
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

      const expoPushMessage: ExpoPushMessage = {
        to: to,
        title: title,
        body: messageBody,
        data: (body["data"] as { [key: string]: string }) || {},
        sound: (body["sound"] as "default" | null) || "default",
        priority: (body["priority"] as "default" | "normal" | "high") || "high",
        channelId: (body["channelId"] as string) || "default",
      };

      const tickets: ExpoPushTicket[] =
        await expoClient.sendPushNotificationsAsync([expoPushMessage]);

      const ticket: ExpoPushTicket | undefined = tickets[0];

      if (ticket && ticket.status === "error") {
        const errorTicket: ExpoPushTicket & {
          message?: string;
          details?: { error?: string };
        } = ticket as ExpoPushTicket & {
          message?: string;
          details?: { error?: string };
        };

        logger.error(
          `Push relay: Expo push notification error: ${errorTicket.message}`,
        );

        throw new BadDataException(
          `Failed to send push notification: ${errorTicket.message}`,
        );
      }

      logger.info(`Push relay: notification sent successfully to ${to}`);

      return Response.sendJsonObjectResponse(req, res, { success: true });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
