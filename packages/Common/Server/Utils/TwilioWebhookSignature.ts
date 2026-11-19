import { Host, HttpProtocol } from "../EnvironmentConfig";
import GlobalConfigService from "../Services/GlobalConfigService";
import ProjectCallSMSConfigService from "../Services/ProjectCallSMSConfigService";
import { toServerTwilioConfig } from "./ServerTwilioConfig";
import {
  GLOBAL_TWILIO_CONFIG_SELECT,
  PROJECT_TWILIO_CONFIG_SELECT,
} from "./TwilioConfigSelect";
import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import ProjectCallSMSConfig from "../../Models/DatabaseModels/ProjectCallSMSConfig";
import { WebhookRequest } from "../../Types/Call/CallProvider";
import TwilioConfig from "../../Types/CallAndSMS/TwilioConfig";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import { validateRequest } from "twilio";

/*
 * WHETHER A REQUEST TO ONE OF ONEUPTIME'S TWILIO WEBHOOKS IS TWILIO'S.
 *
 * Twilio signs every request it makes to a webhook with the auth token of
 * the account the message or the call is on: X-Twilio-Signature, an HMAC of
 * the URL it called and every parameter it posted
 * (https://www.twilio.com/docs/usage/webhooks/webhooks-security). Every
 * route Twilio calls checks it:
 *
 *   - an SMS's delivery status and how a call ended (API/SMS.ts, API/Call.ts
 *     status callbacks), who answered an on-call call (its answering machine
 *     callback) and the key a person pressed on one (UserOnCallLogTimelineAPI
 *     call/gather-input): with the account that sent the message or placed
 *     the call - one of the project's own Twilio configs on the account the
 *     request names (AccountSid), or the OneUptime server's own account
 *     (findTwilioAccountThatSigned). Only an account that could have sent it
 *     is tried, so a project's auth token never vouches for another
 *     project's message;
 *   - an incoming call (API/IncomingCall.ts), with the config of the number
 *     it rang (TwilioCallProvider.validateWebhookSignature).
 *
 * The URL Twilio signed is the public one it was given. It is checked as
 * the request names it - the forwarded scheme and host, the path behind the
 * ingress's /notification rewrite - and as this server gives it to Twilio,
 * from HOST and HTTP_PROTOCOL: a proxy that forwards neither the public host
 * nor the scheme still passes on a request Twilio signed. Its path, query
 * and body, and the header, have to reach the server as Twilio sent them.
 *
 * The signature proves the request is Twilio's. A callback's URL token
 * still says which SMS or call it is about, and a keypad call's signed
 * tokens what each key answers.
 *
 * Why a request was refused is said in words for the server's log, with no
 * auth token, no whole account SID and no URL token in them.
 */

export const TWILIO_SIGNATURE_HEADER: string = "x-twilio-signature";

/*
 * How every line the server logs for a callback it refused begins, so an
 * operator can find them (self-hosted/twilio-integration).
 */
export const TWILIO_CALLBACK_REFUSED: string = "Twilio callback refused";

// The ingress serves the public /notification at /api/notification.
const INTERNAL_NOTIFICATION_PREFIX: string = "/api/notification";
const PUBLIC_NOTIFICATION_PREFIX: string = "/notification";

// What a log line shows in place of a secret.
const LEFT_OUT: string = "…";

// A Twilio account SID: AC and 32 hexadecimal characters.
const ACCOUNT_SID_LENGTH: number = 34;
const ACCOUNT_SID_SHOWN_END: number = 4;

/*
 * Whether a request is Twilio's, and on which account: the account whose
 * auth token made its signature, or - refused - why not, for the log.
 */
export type TwilioSignatureCheck =
  | { account: TwilioConfig; refusalReason: null }
  | { account: null; refusalReason: string };

// The X-Twilio-Signature header, or "" for a request without one.
export function getTwilioSignature(request: WebhookRequest): string {
  const header: string | Array<string> | undefined =
    request.headers?.[TWILIO_SIGNATURE_HEADER];

  return typeof header === "string" ? header.trim() : "";
}

// A value Twilio posted, as text, without the whitespace around it.
function postedText(body: unknown, key: string): string {
  const value: unknown =
    body && typeof body === "object"
      ? (body as Record<string, unknown>)[key]
      : undefined;

  return typeof value === "string" ? value.trim() : "";
}

/*
 * The first value of a forwarded header: a chain of proxies lists one a
 * hop ("https, http"), the first being what the caller used.
 */
function firstForwardedValue(value: string | undefined): string {
  return (value || "").split(",")[0]!.trim();
}

/*
 * The path and query Twilio was given. The ingress serves the public
 * /notification at /api/notification (Nginx's rewrite), and keeps every
 * other path - /api/user-notification-log-timeline - as it is.
 */
function getPublicPath(request: WebhookRequest): string {
  const path: string = request.originalUrl || request.url || "";

  if (
    path === INTERNAL_NOTIFICATION_PREFIX ||
    path.startsWith(`${INTERNAL_NOTIFICATION_PREFIX}/`) ||
    path.startsWith(`${INTERNAL_NOTIFICATION_PREFIX}?`)
  ) {
    return `${PUBLIC_NOTIFICATION_PREFIX}${path.slice(INTERNAL_NOTIFICATION_PREFIX.length)}`;
  }

  return path;
}

/*
 * The public URLs Twilio may have signed a request at: as the request names
 * it - the scheme and host a proxy forwarded, or the request's own - and as
 * this server gives it to Twilio (HOST, HTTP_PROTOCOL). Once each.
 */
export function getTwilioWebhookUrls(request: WebhookRequest): Array<string> {
  const path: string = getPublicPath(request);
  const urls: Array<string> = [];

  const protocol: string =
    firstForwardedValue(request.get?.("x-forwarded-proto")) ||
    request.protocol ||
    "https";
  const host: string =
    firstForwardedValue(request.get?.("x-forwarded-host")) ||
    (request.get?.("host") || "").trim();

  if (host) {
    urls.push(`${protocol}://${host}${path}`);
  }

  if (Host) {
    urls.push(`${HttpProtocol}${Host}${path}`);
  }

  return urls.filter(
    (url: string, index: number, all: Array<string>): boolean => {
      return all.indexOf(url) === index;
    },
  );
}

/*
 * The parameters Twilio posted, as it signed them: each value as text, a
 * parameter it posted more than once as each of its values.
 */
function getSignedParameters(
  body: unknown,
): Record<string, string | Array<string>> {
  const parameters: Record<string, string | Array<string>> = {};

  if (!body || typeof body !== "object") {
    return parameters;
  }

  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    parameters[key] = Array.isArray(value)
      ? value.map((item: unknown): string => {
          return String(item);
        })
      : String(value);
  }

  return parameters;
}

/*
 * Whether a request carries the signature this auth token makes, at any URL
 * Twilio may have signed it at (getTwilioWebhookUrls).
 */
export function isSignedWithAuthToken(data: {
  request: WebhookRequest;
  authToken: string;
  // The request's own X-Twilio-Signature unless given.
  signature?: string | undefined;
}): boolean {
  const signature: string =
    data.signature === undefined
      ? getTwilioSignature(data.request)
      : data.signature;

  if (!signature || !data.authToken) {
    return false;
  }

  const parameters: Record<string, string | Array<string>> =
    getSignedParameters(data.request.body);

  return getTwilioWebhookUrls(data.request).some((url: string): boolean => {
    try {
      return validateRequest(data.authToken, signature, url, parameters);
    } catch {
      // A URL Twilio's check cannot read was signed by nobody.
      return false;
    }
  });
}

/*
 * An account SID as a log line names it: its kind and its last characters,
 * never the whole SID - and nothing of a value that is no SID, which the
 * request may have made up.
 */
export function describeTwilioAccountSid(accountSid: string): string {
  const readable: string = accountSid.replace(/[^A-Za-z0-9]/g, "");

  if (readable.length !== ACCOUNT_SID_LENGTH) {
    return "a Twilio account SID that is not one Twilio makes";
  }

  return `Twilio account ${readable.slice(0, 2)}${LEFT_OUT}${readable.slice(-ACCOUNT_SID_SHOWN_END)}`;
}

/*
 * A URL as a log line shows it: the secrets it carries left out, and the
 * value of every query parameter - a keypad call's tokens ride there.
 */
export function describeTwilioWebhookUrl(
  url: string,
  secrets: Array<string> = [],
): string {
  const queryStart: number = url.indexOf("?");
  let address: string = queryStart === -1 ? url : url.slice(0, queryStart);

  for (const secret of secrets) {
    if (secret) {
      address = address.split(secret).join(LEFT_OUT);
    }
  }

  if (queryStart === -1) {
    return address;
  }

  const names: Array<string> = url
    .slice(queryStart + 1)
    .split("&")
    .filter((pair: string): boolean => {
      return Boolean(pair);
    })
    .map((pair: string): string => {
      const name: string = pair.split("=")[0] || "";

      return `${name}=${LEFT_OUT}`;
    });

  return names.length ? `${address}?${names.join("&")}` : address;
}

function refused(reason: string): TwilioSignatureCheck {
  return { account: null, refusalReason: reason };
}

/*
 * The project's Twilio configs on the account the request names: a project
 * can hold two for one account, with other numbers. A config that cannot be
 * read as an account is passed over: nothing went out on it.
 */
async function getProjectAccounts(data: {
  accountSid: string;
  projectId: ObjectID;
}): Promise<Array<TwilioConfig>> {
  const configs: Array<ProjectCallSMSConfig> =
    await ProjectCallSMSConfigService.findBy({
      query: {
        projectId: data.projectId,
      },
      select: PROJECT_TWILIO_CONFIG_SELECT,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

  const accounts: Array<TwilioConfig> = [];

  for (const config of configs) {
    if ((config.twilioAccountSID || "").trim() !== data.accountSid) {
      continue;
    }

    try {
      const account: TwilioConfig | undefined =
        ProjectCallSMSConfigService.toTwilioConfig(config);

      if (account) {
        accounts.push(account);
      }
    } catch {
      // Without its account's credentials: nothing went out on it.
    }
  }

  return accounts;
}

/*
 * The OneUptime server's own account, as the senders take it
 * (ServerTwilioConfig). A server whose settings cannot be read has none to
 * try: a message on a project's own config is still checked against it.
 */
async function getServerAccount(): Promise<TwilioConfig | null> {
  try {
    const globalConfig: GlobalConfig | null =
      await GlobalConfigService.findOneBy({
        query: {
          _id: ObjectID.getZeroObjectID().toString(),
        },
        select: GLOBAL_TWILIO_CONFIG_SELECT,
        props: {
          isRoot: true,
        },
      });

    return toServerTwilioConfig(globalConfig);
  } catch {
    return null;
  }
}

/*
 * Why a signature none of the accounts makes was refused: the URLs it was
 * checked at, for an operator to compare with the public URL Twilio was
 * given.
 */
function getMismatchReason(data: {
  request: WebhookRequest;
  accountSid: string;
  urlSecrets: Array<string>;
}): string {
  const urls: Array<string> = getTwilioWebhookUrls(data.request).map(
    (url: string): string => {
      return describeTwilioWebhookUrl(url, data.urlSecrets);
    },
  );

  if (!urls.length) {
    return `Its X-Twilio-Signature cannot be checked: the request names no host, and this server's HOST is not set.`;
  }

  return `Its X-Twilio-Signature does not match the one ${describeTwilioAccountSid(data.accountSid)} makes for ${urls.join(" or ")}: the request is not Twilio's, or a proxy on the way changed its host, protocol, path, query or body.`;
}

/*
 * The account that signed a Twilio callback about one of a project's
 * messages or calls - the project's own Twilio config, or the server's own
 * account - or why none did: the request names no account, carries no
 * signature, names an account it could not have gone out on, or carries a
 * signature none of those accounts makes. `urlSecrets` are what of the
 * request's URL the reason leaves out: its token.
 */
export async function findTwilioAccountThatSigned(data: {
  request: WebhookRequest;
  projectId: ObjectID | undefined;
  urlSecrets?: Array<string> | undefined;
}): Promise<TwilioSignatureCheck> {
  const signature: string = getTwilioSignature(data.request);

  if (!signature) {
    return refused(
      "It carries no X-Twilio-Signature header: it is not Twilio's, or a proxy on the way dropped the header.",
    );
  }

  const accountSid: string = postedText(data.request.body, "AccountSid");

  if (!accountSid) {
    return refused(
      "It names no Twilio account (no AccountSid): it is not Twilio's, or a proxy on the way changed its body.",
    );
  }

  let isAccountKnown: boolean = false;

  if (data.projectId) {
    for (const account of await getProjectAccounts({
      accountSid: accountSid,
      projectId: data.projectId,
    })) {
      isAccountKnown = true;

      if (
        isSignedWithAuthToken({
          request: data.request,
          authToken: account.authToken,
          signature: signature,
        })
      ) {
        return { account: account, refusalReason: null };
      }
    }
  }

  const serverAccount: TwilioConfig | null = await getServerAccount();

  if (serverAccount && serverAccount.accountSid.trim() === accountSid) {
    isAccountKnown = true;

    if (
      isSignedWithAuthToken({
        request: data.request,
        authToken: serverAccount.authToken,
        signature: signature,
      })
    ) {
      return { account: serverAccount, refusalReason: null };
    }
  }

  if (!isAccountKnown) {
    return refused(
      `It names ${describeTwilioAccountSid(accountSid)}, which is ${
        data.projectId
          ? "neither one of the project's Twilio configs nor this server's own Twilio account"
          : "not this server's own Twilio account"
      }: nothing it is about went out on that account.`,
    );
  }

  return refused(
    getMismatchReason({
      request: data.request,
      accountSid: accountSid,
      urlSecrets: data.urlSecrets || [],
    }),
  );
}

/*
 * The line the server logs for a callback it refused: which callback, and
 * why (findTwilioAccountThatSigned).
 */
export function getTwilioCallbackRefusedMessage(data: {
  callback: string;
  reason: string;
}): string {
  return `${TWILIO_CALLBACK_REFUSED}: ${data.callback}. ${data.reason}`;
}
