/*
 * A project's incoming request secrets (issue #7526).
 *
 * An Incoming Request monitor's URL carries the monitor's own secret key, and
 * a monitor's criteria can check a header on top of it. Neither is the
 * project's to enforce: the key is shown to everyone who can edit monitors,
 * and a criteria is written monitor by monitor, by whoever configures that
 * monitor. A project owner or admin can therefore make every Incoming Request
 * monitor in the project require one of the project's own secrets as well
 * (Project.requireIncomingRequestSecret, IncomingRequestSecret). The secret is
 * checked before anything else - before the request counts as a heartbeat,
 * before it is kept as the monitor's latest request, before any criteria -
 * so a monitor's own criteria still apply, after it.
 *
 * What lives here is what the ingest endpoint, the ingest worker, the service
 * that stores the secrets and the Dashboard must agree on: where a sender puts
 * the secret, and which values may be one. Nothing here touches Node, so the
 * Dashboard reads the same rules the server enforces.
 */

import Dictionary from "../../Dictionary";
import MonitorSecretAccess from "../MonitorSecretAccess";

/*
 * The header a sender puts the secret in. Header names are not case
 * sensitive; it is written here the way the docs and the Dashboard show it.
 */
export const INCOMING_REQUEST_SECRET_HEADER: string = "X-OneUptime-Secret";

/*
 * The other place a sender may put it: `Authorization: Bearer <secret>`, which
 * most webhook senders (Prometheus Alertmanager, Grafana, CI systems) can set
 * without custom headers.
 */
export const INCOMING_REQUEST_SECRET_AUTHORIZATION_SCHEME: string = "Bearer";

/*
 * SIGNING A REQUEST INSTEAD OF SENDING THE SECRET (issue #8500).
 *
 * Some senders cannot set a header of their own: GitHub's webhooks take a URL
 * and a secret, and Slack's and Stripe's take a URL alone and sign with a
 * secret they generate. Each signs the request's body with the secret, an
 * HMAC-SHA256, and sends the signature in a header of its own - so the
 * secret never travels at all. OneUptime checks these signatures with the
 * project's secrets, as it checks a secret sent in a header:
 *
 *   - X-OneUptime-Signature: t=<unix seconds>,v1=<hex HMAC of "<t>.<body>">,
 *     for a sender of your own: the one to prefer, as nothing secret travels
 *     and the time in it keeps a request someone captured from being sent
 *     again later;
 *   - X-Hub-Signature-256: sha256=<hex HMAC of the body>, GitHub's;
 *   - X-Slack-Signature: v0=<hex HMAC of "v0:<timestamp>:<body>">, with
 *     X-Slack-Request-Timestamp, Slack's;
 *   - Stripe-Signature: t=<unix seconds>,v1=<hex HMAC of "<t>.<body>">,
 *     Stripe's - the same shape as OneUptime's own.
 *
 * A signature with a time is accepted only within
 * INCOMING_REQUEST_SIGNATURE_TOLERANCE_SECONDS of OneUptime's clock, and each
 * accepted signature is remembered so the same request is refused if it is
 * sent again (GitHub's carries no time, and is remembered for a day).
 *
 * The secret in a URL's query string was weighed and left out: a URL is
 * written to proxy, load balancer and browser logs, and it already carries
 * the monitor's own key, so a secret beside it would leak with it.
 */
export enum IncomingRequestSignatureScheme {
  OneUptime = "OneUptime",
  GitHub = "GitHub",
  Slack = "Slack",
  Stripe = "Stripe",
}

// OneUptime's own signature header.
export const INCOMING_REQUEST_SIGNATURE_HEADER: string =
  "X-OneUptime-Signature";

export interface IncomingRequestSignatureFormat {
  scheme: IncomingRequestSignatureScheme;
  // The header the signature comes in, as the docs write it.
  header: string;
  // The header the signature's time comes in, when not in the signature itself.
  timestampHeader?: string | undefined;
  // Whether the signature carries a time, and so expires.
  hasTimestamp: boolean;
}

// The signatures OneUptime checks, in the order the docs list them.
export const INCOMING_REQUEST_SIGNATURE_FORMATS: ReadonlyArray<IncomingRequestSignatureFormat> =
  [
    {
      scheme: IncomingRequestSignatureScheme.OneUptime,
      header: INCOMING_REQUEST_SIGNATURE_HEADER,
      hasTimestamp: true,
    },
    {
      scheme: IncomingRequestSignatureScheme.GitHub,
      header: "X-Hub-Signature-256",
      hasTimestamp: false,
    },
    {
      scheme: IncomingRequestSignatureScheme.Slack,
      header: "X-Slack-Signature",
      timestampHeader: "X-Slack-Request-Timestamp",
      hasTimestamp: true,
    },
    {
      scheme: IncomingRequestSignatureScheme.Stripe,
      header: "Stripe-Signature",
      hasTimestamp: true,
    },
  ];

/*
 * Whether a request's headers, as Node hands them over (names in lower
 * case), carry one of the signatures above. Only the header's name is looked
 * at: whether its value is a signature, and whose, is decided where it is
 * checked. A relay - a probe's incoming request ingress - passes such a
 * request's body on as the bytes that came, so its signature still holds.
 */
export const carriesIncomingRequestSignature: (
  headers: Dictionary<string | Array<string> | undefined>,
) => boolean = (
  headers: Dictionary<string | Array<string> | undefined>,
): boolean => {
  return INCOMING_REQUEST_SIGNATURE_FORMATS.some(
    (format: IncomingRequestSignatureFormat): boolean => {
      const value: string | Array<string> | undefined =
        headers[format.header.toLowerCase()];

      return Array.isArray(value) ? value.length > 0 : Boolean(value);
    },
  );
};

/*
 * How far a signature's time may be from OneUptime's clock, either way: five
 * minutes, what Slack and Stripe ask of their receivers.
 */
export const INCOMING_REQUEST_SIGNATURE_TOLERANCE_SECONDS: number = 5 * 60;

/*
 * How long an accepted signature without a time (GitHub's) is remembered, so
 * the same delivery sent again is refused: a day.
 */
export const INCOMING_REQUEST_UNTIMED_SIGNATURE_MEMORY_SECONDS: number =
  24 * 60 * 60;

/*
 * Which monitors a new incoming request secret covers when nobody says
 * otherwise (issue #8501): all of the project's, as every secret did before
 * a secret could be limited.
 */
export const INCOMING_REQUEST_SECRET_DEFAULT_ACCESS: MonitorSecretAccess =
  MonitorSecretAccess.AllMonitors;

/*
 * A secret someone types instead of letting OneUptime generate one. 16
 * characters at least, so a value short enough to guess is never the only
 * thing between a forged request and every monitor of the project; 256 at
 * most, so it fits any header a proxy passes on.
 */
export const INCOMING_REQUEST_SECRET_MIN_LENGTH: number = 16;
export const INCOMING_REQUEST_SECRET_MAX_LENGTH: number = 256;

/*
 * Visible ASCII, no spaces: what an HTTP header value carries unchanged
 * through every client, proxy and shell. A space or a non-ASCII letter is
 * mangled, folded or refused somewhere between the sender and OneUptime, and
 * a secret that never arrives as it was typed would refuse every request.
 */
const SECRET_VALUE_PATTERN: RegExp = /^[\x21-\x7E]+$/;

/*
 * Why a request to an Incoming Request monitor had no valid incoming request
 * secret: it sent none; one that is not the project's (or a signature none of
 * them made); one of the project's that does not cover this monitor (issue
 * #8501); or a signature whose time is too far from OneUptime's (issue
 * #8500). Kept on the monitor (Monitor.incomingRequestWithoutSecretReason,
 * issue #8498) and shown where its requests are refused, or would be. Stored
 * values: never rename one.
 */
export enum IncomingRequestSecretProblem {
  NoSecret = "No Secret",
  WrongSecret = "Wrong Secret",
  SecretNotForMonitor = "Secret Not For Monitor",
  ExpiredSignature = "Expired Signature",
}

/*
 * How long a request without a valid secret keeps a monitor on Monitors >
 * Settings > Incoming Request Secrets' list of requests without a secret,
 * and on the note under its heartbeat URL: a day, so a sender that calls once
 * a day (a nightly job) is still caught, and a fixed sender drops off within
 * a day.
 */
export const INCOMING_REQUEST_WITHOUT_SECRET_WINDOW_HOURS: number = 24;

export enum IncomingRequestSecretValueProblem {
  TooShort = "TooShort",
  TooLong = "TooLong",
  UnsupportedCharacters = "UnsupportedCharacters",
}

export default class IncomingRequestSecretRules {
  /*
   * What is wrong with a secret value someone typed, or null when it can be
   * used. The value is judged as it would be sent: trimmed.
   */
  public static getValueProblem(
    value: string,
  ): IncomingRequestSecretValueProblem | null {
    const trimmed: string = value.trim();

    if (trimmed.length < INCOMING_REQUEST_SECRET_MIN_LENGTH) {
      return IncomingRequestSecretValueProblem.TooShort;
    }

    if (trimmed.length > INCOMING_REQUEST_SECRET_MAX_LENGTH) {
      return IncomingRequestSecretValueProblem.TooLong;
    }

    if (!SECRET_VALUE_PATTERN.test(trimmed)) {
      return IncomingRequestSecretValueProblem.UnsupportedCharacters;
    }

    return null;
  }

  // What the server answers when a typed value cannot be used.
  public static getValueProblemMessage(
    problem: IncomingRequestSecretValueProblem,
  ): string {
    switch (problem) {
      case IncomingRequestSecretValueProblem.TooShort:
        return `An incoming request secret needs at least ${INCOMING_REQUEST_SECRET_MIN_LENGTH} characters. Enter a longer one, or leave it empty and OneUptime generates a strong one.`;
      case IncomingRequestSecretValueProblem.TooLong:
        return `An incoming request secret can have at most ${INCOMING_REQUEST_SECRET_MAX_LENGTH} characters. Enter a shorter one, or leave it empty and OneUptime generates one.`;
      case IncomingRequestSecretValueProblem.UnsupportedCharacters:
        return "An incoming request secret can only use letters, digits and the symbols on a keyboard, with no spaces, so it reaches OneUptime as it was typed. Remove the other characters, or leave it empty and OneUptime generates one.";
    }
  }
}
