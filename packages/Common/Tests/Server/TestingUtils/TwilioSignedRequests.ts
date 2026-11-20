import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import { getExpectedTwilioSignature } from "twilio";

/*
 * REQUESTS AS TWILIO SENDS THEM TO ONEUPTIME'S WEBHOOKS, SIGNED AS TWILIO
 * SIGNS THEM.
 *
 * Twilio posts to the public URL it was given - without the URL's fragment,
 * which only tells Twilio when to send it again - and signs that URL and
 * every parameter it posts with the auth token of the account the message
 * or the call is on: X-Twilio-Signature, by Twilio's own algorithm
 * (getExpectedTwilioSignature). OneUptime's ingress then rewrites the public
 * /notification to /api/notification and forwards the public scheme and
 * host to the app, which it reaches at a host of its own. The requests here
 * are the route's view of one: its URL behind the rewrite, its headers, the
 * body Express parsed, and Express's get().
 */

export const TWILIO_PUBLIC_HOST: string = "oneuptime.example.com";
export const TWILIO_PUBLIC_ORIGIN: string = `https://${TWILIO_PUBLIC_HOST}`;

// Where the ingress reaches the app.
export const TWILIO_INTERNAL_HOST: string = "app:3002";

export interface TwilioRequestLike {
  params: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, string>;
  headers: Record<string, string>;
  protocol: string;
  originalUrl: string;
  url: string;
  get: (name: string) => string | undefined;
}

// The scheme, host, path and query Twilio calls, from the URL it was given.
function publicPartsOf(publicUrl: string): {
  proto: string;
  host: string;
  path: string;
  search: string;
} {
  const url: globalThis.URL = new globalThis.URL(
    publicUrl.split("#")[0]!,
    TWILIO_PUBLIC_ORIGIN,
  );

  return {
    proto: url.protocol.replace(":", ""),
    host: url.host,
    path: url.pathname,
    search: url.search,
  };
}

/*
 * A request Twilio sent to `publicUrl` - a path on TWILIO_PUBLIC_ORIGIN, or a
 * whole URL - signed with `signedWith` - an auth token, or null for a request
 * that carries no signature - over `signedBody`, or the body itself when
 * nothing changed it on the way. The ingress forwards the public scheme and
 * host unless `forwarded` says otherwise: null leaves a header out, as a
 * proxy that does not set it does.
 */
export function signedTwilioRequest(data: {
  publicUrl: string;
  body: Record<string, string>;
  signedWith: string | null;
  signedBody?: Record<string, string> | undefined;
  params?: Record<string, string> | undefined;
  forwarded?:
    | {
        proto?: string | null | undefined;
        host?: string | null | undefined;
      }
    | undefined;
  // The Host header the app sees.
  host?: string | undefined;
  // The scheme the app itself was reached over.
  protocol?: string | undefined;
}): TwilioRequestLike {
  // Twilio leaves the fragment out of the request and of its signature.
  const requested: string = data.publicUrl.split("#")[0]!;
  const signedUrl: string = requested.startsWith("http")
    ? requested
    : `${TWILIO_PUBLIC_ORIGIN}${requested}`;
  const { proto, host, path, search } = publicPartsOf(signedUrl);

  const forwardedProto: string | null =
    data.forwarded?.proto === undefined ? proto : data.forwarded.proto;
  const forwardedHost: string | null =
    data.forwarded?.host === undefined ? host : data.forwarded.host;

  const headers: Record<string, string> = {
    host: data.host ?? TWILIO_INTERNAL_HOST,
    ...(forwardedProto !== null ? { "x-forwarded-proto": forwardedProto } : {}),
    ...(forwardedHost !== null ? { "x-forwarded-host": forwardedHost } : {}),
    ...(data.signedWith !== null
      ? {
          "x-twilio-signature": getExpectedTwilioSignature(
            data.signedWith,
            signedUrl,
            data.signedBody || data.body,
          ),
        }
      : {}),
  };

  // The ingress serves the public /notification at /api/notification.
  const internalPath: string = path.startsWith("/notification/")
    ? `/api${path}`
    : path;

  const query: Record<string, string> = {};
  new URLSearchParams(search).forEach((value: string, key: string): void => {
    query[key] = value;
  });

  return {
    params: data.params || {},
    query: query,
    body: data.body,
    headers: headers,
    protocol: data.protocol ?? "http",
    originalUrl: `${internalPath}${search}`,
    url: `${path}${search}`,
    get: (name: string): string | undefined => {
      return headers[name.toLowerCase()];
    },
  };
}

/*
 * The server's own Twilio account as GlobalConfig holds it, as
 * GlobalConfigService.findOneBy returns it (GLOBAL_TWILIO_CONFIG_SELECT).
 */
export function serverTwilioRow(account: TwilioConfig): GlobalConfig {
  const row: GlobalConfig = new GlobalConfig();
  row.twilioAccountSID = account.accountSid;
  row.twilioAuthToken = account.authToken;

  if (account.primaryPhoneNumber) {
    row.twilioPrimaryPhoneNumber = account.primaryPhoneNumber;
  }

  return row;
}
