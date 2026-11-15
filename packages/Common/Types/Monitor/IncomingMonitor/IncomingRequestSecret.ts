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
