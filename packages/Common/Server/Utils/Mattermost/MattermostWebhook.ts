import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import http from "http";
import { JSONObject } from "../../../Types/JSON";
import {
  MATTERMOST_MAX_NAME_LENGTH,
  MATTERMOST_WEBHOOK_ID_LENGTH,
} from "../../../Types/Workflow/Components/Mattermost";
import DataSourceEgressGuard, { PinnedAgents } from "../DataSource/EgressGuard";
import OutboundUserAgent from "../OutboundUserAgent";
import SSRFProtection, { ValidatedWebhookTarget } from "../SSRFProtection";

/*
 * POSTS A MESSAGE TO A MATTERMOST INCOMING WEBHOOK.
 *
 * Mattermost is usually self-hosted, so unlike Slack's or Discord's, its
 * webhook URL cannot be pinned to one vendor's host. What can be held is
 * everything else:
 *
 *   - The URL has to be an incoming webhook's: http or https, then the
 *     server, then /hooks/ and the webhook's ID, with nothing after it. The
 *     step can only ever POST to such a path, so it is not a way to send a
 *     request anywhere at all.
 *   - The host goes through the guard the API steps use (SSRFProtection,
 *     webhook policy): loopback, link-local and cloud metadata are refused
 *     everywhere, and private addresses unless a self-hosted administrator
 *     allows them (ALLOW_PRIVATE_NETWORK_WEBHOOKS,
 *     PRIVATE_NETWORK_WEBHOOK_ALLOWLIST) - which is how an operator reaches
 *     a Mattermost on their own network. The socket dials the addresses that
 *     check approved and no other (a pinned lookup), so a name cannot resolve
 *     somewhere else between the check and the connection; TLS still checks
 *     the certificate against the name in the URL.
 *   - No redirect is followed and no proxy from the environment is used:
 *     either would send the request somewhere the check never saw.
 *   - The URL is a secret - whoever has it can post to the channel - so no
 *     message here quotes it, or any part of it. What comes back from the
 *     server is reported as Mattermost's own reason when it is Mattermost's
 *     JSON, and otherwise as a status code, never as the bytes of the
 *     answer.
 */

// The longest URL a webhook's can sensibly be.
const MAX_URL_LENGTH: number = 2048;

// What sits between the server's address and the webhook's ID.
const HOOKS_PATH_SEGMENT: string = "/hooks/";

// How much of an answer is read: Mattermost answers "ok", or a short JSON error.
export const MATTERMOST_MAX_RESPONSE_BYTES: number = 64 * 1024;

/*
 * The most a request may carry: a post of 16,383 characters, JSON-escaped,
 * with the other settings, comes to a fraction of this.
 */
export const MATTERMOST_MAX_REQUEST_BYTES: number = 1024 * 1024;

// How much of Mattermost's own reason is quoted.
const MAX_REASON_LENGTH: number = 300;

// What a quoted reason may end with and still be a sentence.
const SENTENCE_ENDINGS: ReadonlyArray<string> = [".", "!", "?", "…"];

// What the URL is called wherever the step talks about it.
export const MATTERMOST_WEBHOOK_URL_LABEL: string =
  "Mattermost Incoming Webhook URL";

/*
 * A message whose words are written for the workflow's author: what went
 * wrong, and what to change. Nothing secret is in it.
 */
export class MattermostError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MattermostError";
  }
}

export interface MattermostMessage {
  text: string;
  // A channel's name, or @ and a username.
  channel?: string | undefined;
  username?: string | undefined;
  iconUrl?: string | undefined;
}

export interface MattermostSendOptions {
  // Checked with getWebhookUrlProblem first.
  webhookUrl: string;
  message: MattermostMessage;
  // How long the whole request may take, looking up the server included.
  timeoutInMs: number;
}

/*
 * Mattermost's AppError, as its API writes every error:
 * {"id": "...", "message": "...", "detailed_error": "...", "status_code": 404}
 */
interface MattermostAppError {
  id: string;
  message: string;
}

/*
 * What to do about the refusals people meet most, by the id Mattermost gives
 * each. The message Mattermost sends with them is in the server's language;
 * these say how to fix it. A Map, so an id such as "constructor" finds
 * nothing.
 */
const REFUSAL_HINTS: ReadonlyMap<string, string> = new Map<string, string>([
  [
    "web.incoming_webhook.invalid.app_error",
    "The webhook may have been deleted: add a new one, and use its URL.",
  ],
  [
    "web.incoming_webhook.disabled.app_error",
    "A Mattermost system admin turns incoming webhooks on in the System Console, under Integrations.",
  ],
  [
    "web.incoming_webhook.channel_locked.app_error",
    "This webhook is locked to its own channel: leave Channel empty, or use a webhook that is not locked.",
  ],
]);

// Only where Channel was filled in: otherwise it is the webhook's own channel that is gone.
const CHANNEL_NOT_FOUND_ID: string = "web.incoming_webhook.channel.app_error";
const CHANNEL_NOT_FOUND_HINT: string =
  "Channel takes the channel's name as its URL shows it, such as town-square, not the name it is shown under.";

/*
 * Errors that say the server's TLS certificate was not trusted, as Node's
 * TLS reports them.
 */
const UNTRUSTED_CERTIFICATE_CODES: ReadonlyArray<string> = [
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_UNTRUSTED",
  "CERT_SIGNATURE_FAILURE",
  "CERT_REVOKED",
  "CERT_REJECTED",
];

export default class MattermostWebhook {
  /*
   * What is wrong with a webhook URL, in a sentence that says what to paste
   * instead, or null when it is an incoming webhook's URL. Takes the URL
   * trimmed; quotes nothing of it.
   */
  public static getWebhookUrlProblem(value: string): string | null {
    if (!value) {
      return `${MATTERMOST_WEBHOOK_URL_LABEL} not found. Paste the URL Mattermost shows for the webhook under Integrations, Incoming Webhooks.`;
    }

    if (value.length > MAX_URL_LENGTH) {
      return `${MATTERMOST_WEBHOOK_URL_LABEL} is too long to be a webhook's URL.`;
    }

    for (let index: number = 0; index < value.length; index++) {
      const code: number = value.charCodeAt(index);

      if (code <= 0x20 || code === 0x7f || value.charAt(index) === "\\") {
        return `${MATTERMOST_WEBHOOK_URL_LABEL} holds a space, a line break or a backslash, which a webhook's URL never does. Paste it again, exactly as Mattermost shows it.`;
      }
    }

    let url: globalThis.URL;

    try {
      url = new globalThis.URL(value);
    } catch {
      return `${MATTERMOST_WEBHOOK_URL_LABEL} is not a URL. It looks like https://mattermost.example.com/hooks/ and then the webhook's ID.`;
    }

    /*
     * Read as typed, not only as the URL parser reads it: the parser takes
     * "HTTPS:/host" for "https://host", which no one pastes, and which the
     * template wizard's pattern refuses.
     */
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      !(value.startsWith("https://") || value.startsWith("http://"))
    ) {
      return `${MATTERMOST_WEBHOOK_URL_LABEL} must start with https:// (or http:// for a server without TLS).`;
    }

    if (url.username || url.password || value.includes("@")) {
      return `${MATTERMOST_WEBHOOK_URL_LABEL} must not hold a user name or a password.`;
    }

    /*
     * The parser skips a third slash and takes the next part of the path
     * for the server: "https:///hooks/..." would go to a server called
     * "hooks".
     */
    const schemeLength: number = value.startsWith("https://")
      ? "https://".length
      : "http://".length;

    if (!url.hostname || value.charAt(schemeLength) === "/") {
      return `${MATTERMOST_WEBHOOK_URL_LABEL} has no server in it.`;
    }

    if (value.includes("?") || value.includes("#")) {
      return `${MATTERMOST_WEBHOOK_URL_LABEL} ends with the webhook's ID: nothing goes after it, no ? and no #.`;
    }

    /*
     * The webhook's path ends the URL as typed, too: "/hooks/x/../<id>" is
     * read as "/hooks/<id>", but it is not a URL Mattermost shows anyone.
     */
    if (
      !MattermostWebhook.isWebhookPath(url.pathname) ||
      !value.endsWith(
        url.pathname.substring(url.pathname.lastIndexOf(HOOKS_PATH_SEGMENT)),
      )
    ) {
      return `${MATTERMOST_WEBHOOK_URL_LABEL} is not an incoming webhook's URL. It is the server's address, then /hooks/ and the webhook's ID of ${MATTERMOST_WEBHOOK_ID_LENGTH} lowercase letters and digits, as Mattermost shows it under Integrations, Incoming Webhooks.`;
    }

    return null;
  }

  /*
   * The channel to post in, as Mattermost takes it: a channel's name, or @
   * and a username. People copy a channel as Mattermost writes it in a
   * message - ~town-square - or as Slack does - #town-square - so either
   * mark is taken off; Mattermost's names are lowercase, so is the result.
   * Throws a MattermostError that says what to type when the value cannot
   * be a channel.
   */
  public static getChannel(value: string): string {
    let channel: string = value.trim().toLowerCase();

    if (channel.startsWith("~") || channel.startsWith("#")) {
      channel = channel.substring(1);
    }

    const isDirectMessage: boolean = channel.startsWith("@");
    const name: string = isDirectMessage ? channel.substring(1) : channel;

    if (!name) {
      throw new MattermostError(
        "Channel needs a channel's name, such as town-square, or @ and a username for a direct message.",
      );
    }

    if (name.length > MATTERMOST_MAX_NAME_LENGTH) {
      throw new MattermostError(
        `Channel is longer than a Mattermost channel's name can be (${MATTERMOST_MAX_NAME_LENGTH} characters).`,
      );
    }

    for (let index: number = 0; index < name.length; index++) {
      const character: string = name.charAt(index);
      const isAllowed: boolean =
        (character >= "a" && character <= "z") ||
        (character >= "0" && character <= "9") ||
        character === "-" ||
        character === "_" ||
        character === ".";

      if (!isAllowed) {
        throw new MattermostError(
          isDirectMessage
            ? "Channel takes @ and a username for a direct message, such as @jane.doe: lowercase letters, digits, '.', '-' and '_'."
            : "Channel takes the channel's name as its URL shows it, such as town-square, not the name it is shown under: lowercase letters, digits, '-' and '_'.",
        );
      }
    }

    return isDirectMessage ? `@${name}` : name;
  }

  // The name to post under, or a MattermostError that says why it cannot be.
  public static getUsername(value: string): string {
    const username: string = value.trim();

    if (username.length > MATTERMOST_MAX_NAME_LENGTH) {
      throw new MattermostError(
        `Username can be at most ${MATTERMOST_MAX_NAME_LENGTH} characters, as a Mattermost username can.`,
      );
    }

    for (let index: number = 0; index < username.length; index++) {
      const code: number = username.charCodeAt(index);

      if (code < 0x20 || code === 0x7f) {
        throw new MattermostError(
          "Username must be one line, without line breaks or tabs.",
        );
      }
    }

    return username;
  }

  /*
   * The picture to post with: an http or https address. Mattermost's own
   * apps load it, not OneUptime, so where it points is not checked further.
   */
  public static getIconUrl(value: string): string {
    const iconUrl: string = value.trim();

    let url: globalThis.URL | null = null;

    try {
      url = new globalThis.URL(iconUrl);
    } catch {
      url = null;
    }

    if (
      !url ||
      iconUrl.length > MAX_URL_LENGTH ||
      (url.protocol !== "https:" && url.protocol !== "http:")
    ) {
      throw new MattermostError(
        "Icon URL must be the https:// address of a picture, such as https://example.com/oneuptime.png.",
      );
    }

    return iconUrl;
  }

  // The JSON body of the request, with only the settings that were given.
  public static getPayload(message: MattermostMessage): JSONObject {
    const payload: JSONObject = { text: message.text };

    if (message.channel) {
      payload["channel"] = message.channel;
    }

    if (message.username) {
      payload["username"] = message.username;
    }

    if (message.iconUrl) {
      payload["icon_url"] = message.iconUrl;
    }

    return payload;
  }

  /*
   * Posts the message. Resolves once Mattermost has answered with a 2xx;
   * throws a MattermostError, or the guard's BadDataException, whose message
   * says why it did not.
   */
  public static async send(options: MattermostSendOptions): Promise<void> {
    const startedAt: number = Date.now();

    const target: ValidatedWebhookTarget =
      await SSRFProtection.validateAndResolveWebhookTarget(options.webhookUrl, {
        allowPrivateNetworkTargets: true,
        targetLabel: MATTERMOST_WEBHOOK_URL_LABEL,
      });

    const timeoutInMs: number = options.timeoutInMs - (Date.now() - startedAt);

    if (timeoutInMs < 1000) {
      throw new MattermostError(
        "Looking up the Mattermost server took all the time the step had, so the message was not sent.",
      );
    }

    const agents: PinnedAgents = DataSourceEgressGuard.createPinnedAgents(
      target.addresses,
    );

    const requestConfig: AxiosRequestConfig = {
      // Only Node's http adapter uses the pinned agents.
      adapter: "http",
      method: "POST",
      url: target.url.toString(),
      headers: OutboundUserAgent.withDefault({
        "Content-Type": "application/json",
        Accept: "application/json",
      }),
      data: JSON.stringify(MattermostWebhook.getPayload(options.message)),
      timeout: timeoutInMs,
      maxRedirects: 0,
      proxy: false,
      maxContentLength: MATTERMOST_MAX_RESPONSE_BYTES,
      maxBodyLength: MATTERMOST_MAX_REQUEST_BYTES,
      responseType: "text",
      transformResponse: [
        (body: string): string => {
          return body;
        },
      ],
      // Every answer is read here, a refusal or a redirect too.
      validateStatus: (): boolean => {
        return true;
      },
      httpAgent: agents.httpAgent,
      httpsAgent: agents.httpsAgent,
    };

    let response: AxiosResponse<string>;

    try {
      response = await axios(requestConfig);
    } catch (error) {
      throw new MattermostError(
        MattermostWebhook.describeTransportError(error, timeoutInMs),
      );
    } finally {
      agents.httpAgent.destroy();
      agents.httpsAgent.destroy();
    }

    if (response.status >= 200 && response.status < 300) {
      return;
    }

    throw new MattermostError(
      MattermostWebhook.describeAnswer({
        status: response.status,
        body: typeof response.data === "string" ? response.data : "",
        hasChannel: Boolean(options.message.channel),
      }),
    );
  }

  /*
   * Why an answer that is not a 2xx means the message was not posted: a
   * redirect, Mattermost's own reason (with what to do about it, where that
   * is known), or the status of an answer that did not come from Mattermost.
   */
  public static describeAnswer(data: {
    status: number;
    body: string;
    hasChannel: boolean;
  }): string {
    const status: string = MattermostWebhook.describeStatus(data.status);

    if (data.status >= 300 && data.status < 400) {
      return `Mattermost did not take the message: the server answered with a redirect (${status}), which the step does not follow. Use the webhook's URL exactly as Mattermost shows it, with https:// if the server uses it.`;
    }

    const appError: MattermostAppError | null = MattermostWebhook.readAppError(
      data.body,
    );

    // A reason with nothing left to show once it is cleaned is no reason.
    const cleanedReason: string = appError
      ? MattermostWebhook.cleanReason(appError.message)
      : "";

    if (appError && cleanedReason) {
      const reason: string = MattermostWebhook.asSentence(cleanedReason);

      const hint: string | undefined =
        appError.id === CHANNEL_NOT_FOUND_ID && data.hasChannel
          ? CHANNEL_NOT_FOUND_HINT
          : REFUSAL_HINTS.get(appError.id);

      const verb: string =
        data.status >= 500
          ? "could not take the message"
          : "refused the message";

      return hint
        ? `Mattermost ${verb} (${status}): ${reason} ${hint}`
        : `Mattermost ${verb} (${status}): ${reason}`;
    }

    if (data.status === 404) {
      return `Mattermost did not take the message: the server answered ${status}, and not as Mattermost answers. Check that ${MATTERMOST_WEBHOOK_URL_LABEL} is the webhook's URL, as Mattermost shows it.`;
    }

    return `Mattermost did not take the message: the server answered ${status}.`;
  }

  // Why no answer came back at all, in words that quote nothing of the URL.
  public static describeTransportError(
    error: unknown,
    timeoutInMs: number,
  ): string {
    const code: string =
      axios.isAxiosError(error) && error.code
        ? error.code
        : (error as NodeJS.ErrnoException | undefined)?.code ?? "";
    const message: string =
      error instanceof Error ? (error.message || "").toLowerCase() : "";

    if (
      code === "ECONNABORTED" ||
      code === "ETIMEDOUT" ||
      code === "ESOCKETTIMEDOUT" ||
      message.includes("timeout")
    ) {
      return `Mattermost did not answer within ${Math.max(1, Math.round(timeoutInMs / 1000))} seconds, so the message may not have been posted.`;
    }

    if (
      code === "ERR_FR_MAX_BODY_LENGTH_EXCEEDED" ||
      message.includes("maxcontentlength")
    ) {
      return "Mattermost's answer was larger than an answer to a webhook can be, so it was not read.";
    }

    if (code === "ECONNREFUSED") {
      return `The Mattermost server refused the connection. Check the server and port in ${MATTERMOST_WEBHOOK_URL_LABEL}.`;
    }

    if (code === "ECONNRESET" || message.includes("socket hang up")) {
      return "The connection to the Mattermost server closed before it answered, so the message may not have been posted.";
    }

    if (
      code === "EHOSTUNREACH" ||
      code === "ENETUNREACH" ||
      code === "EADDRNOTAVAIL" ||
      code === "ENOTFOUND" ||
      code === "EAI_AGAIN"
    ) {
      return `The Mattermost server could not be reached from OneUptime (${code}).`;
    }

    if (code === "ERR_TLS_CERT_ALTNAME_INVALID") {
      return `The Mattermost server's TLS certificate is not for the server named in ${MATTERMOST_WEBHOOK_URL_LABEL}.`;
    }

    if (code === "CERT_HAS_EXPIRED" || code === "CERT_NOT_YET_VALID") {
      return `The Mattermost server's TLS certificate is not valid now (${code}).`;
    }

    if (UNTRUSTED_CERTIFICATE_CODES.includes(code)) {
      return `The Mattermost server's TLS certificate is not trusted (${code}). A self-hosted install can trust its own certificate authority with NODE_EXTRA_CA_CERTS.`;
    }

    if (code === "EPROTO" || message.includes("wrong version number")) {
      return `Could not make a TLS connection to the Mattermost server. If it does not use TLS, ${MATTERMOST_WEBHOOK_URL_LABEL} starts with http://.`;
    }

    return code
      ? `Could not reach the Mattermost server (${code}).`
      : "Could not reach the Mattermost server.";
  }

  // "/hooks/<id>", after whatever path Mattermost is served under.
  private static isWebhookPath(pathname: string): boolean {
    const index: number = pathname.lastIndexOf(HOOKS_PATH_SEGMENT);

    if (index < 0) {
      return false;
    }

    const id: string = pathname.substring(index + HOOKS_PATH_SEGMENT.length);

    if (id.length !== MATTERMOST_WEBHOOK_ID_LENGTH) {
      return false;
    }

    for (let position: number = 0; position < id.length; position++) {
      const character: string = id.charAt(position);
      const isAllowed: boolean =
        (character >= "a" && character <= "z") ||
        (character >= "0" && character <= "9");

      if (!isAllowed) {
        return false;
      }
    }

    return true;
  }

  // Mattermost's AppError, when the answer is one.
  private static readAppError(body: string): MattermostAppError | null {
    const text: string = body.trim();

    if (!text.startsWith("{")) {
      return null;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const message: unknown = (parsed as Record<string, unknown>)["message"];
    const id: unknown = (parsed as Record<string, unknown>)["id"];

    if (typeof message !== "string" || !message.trim()) {
      return null;
    }

    return {
      id: typeof id === "string" ? id : "",
      message: message,
    };
  }

  /*
   * A reason from the server as one short line: control and direction
   * characters become spaces, runs of spaces one, and a long one is cut.
   */
  private static cleanReason(reason: string): string {
    let cleaned: string = "";
    let isAfterSpace: boolean = true;

    for (const character of reason) {
      const code: number = character.codePointAt(0) as number;
      const isSpace: boolean =
        code <= 0x20 ||
        (code >= 0x7f && code <= 0x9f) ||
        code === 0x2028 ||
        code === 0x2029 ||
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x2069);

      if (isSpace) {
        if (!isAfterSpace) {
          cleaned += " ";
          isAfterSpace = true;
        }
        continue;
      }

      cleaned += character;
      isAfterSpace = false;

      if (cleaned.length > MAX_REASON_LENGTH) {
        return cleaned.substring(0, MAX_REASON_LENGTH).trimEnd() + "…";
      }
    }

    return cleaned.trimEnd();
  }

  // A reason that ends as a sentence does.
  private static asSentence(reason: string): string {
    if (SENTENCE_ENDINGS.includes(reason.charAt(reason.length - 1))) {
      return reason;
    }

    return `${reason}.`;
  }

  // "HTTP 502 Bad Gateway", or "HTTP 599" for a status Node has no name for.
  private static describeStatus(status: number): string {
    const name: string | undefined = http.STATUS_CODES[status];

    return name ? `HTTP ${status} ${name}` : `HTTP ${status}`;
  }
}
