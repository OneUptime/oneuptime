/*
 * A WEBHOOK'S ADDRESS, AS A LOG KEEPS IT.
 *
 * A webhook's address is its credential: a Slack, Microsoft Teams or
 * Discord incoming webhook carries its secret in its path, others carry a
 * token in the query, or a user and password before the host. Whoever holds
 * the address posts into the channel. The webhook itself keeps it encrypted
 * at rest, and only its owner reads it back (#9013), but a log of what was
 * sent is read by everyone who reads the project's notification logs, and
 * kept for months. So the log keeps the address's scheme, host and port -
 * what tells a person's webhooks apart - and none of the rest:
 *
 *   https://hooks.slack.com/services/T0/B0/XXXX   ->  https://hooks.slack.com/•••
 *   https://user:pass@alerts.example.com:8443/in  ->  https://alerts.example.com:8443/•••
 *   https://alerts.example.com                    ->  https://alerts.example.com
 *
 * "/•••" says something was left out, and is there only when something was.
 * An address that cannot be read is nothing but the mask: no part of it can
 * be told apart from its secret. Masking a masked address changes nothing,
 * so a log written by either release, or masked twice, reads the same.
 */
// The schemes a webhook is posted over; anything else is masked whole.
const WEB_PROTOCOL: RegExp = /^https?:$/;

export default class WebhookAddressMask {
  // What stands for the part of an address a log does not keep.
  public static readonly MASK: string = "•••";

  public static mask(
    address: { toString(): string } | string | null | undefined,
  ): string {
    const text: string = (address?.toString() || "").trim();

    if (!text) {
      return "";
    }

    let parsed: globalThis.URL;

    try {
      parsed = new globalThis.URL(text);
    } catch {
      return WebhookAddressMask.MASK;
    }

    // `host` is the host and its port; never a user or a password.
    if (!parsed.host || !WEB_PROTOCOL.test(parsed.protocol)) {
      return WebhookAddressMask.MASK;
    }

    const origin: string = `${parsed.protocol}//${parsed.host}`;

    const hasMore: boolean =
      parsed.username !== "" ||
      parsed.password !== "" ||
      (parsed.pathname !== "" && parsed.pathname !== "/") ||
      parsed.search !== "" ||
      parsed.hash !== "";

    return hasMore ? `${origin}/${WebhookAddressMask.MASK}` : origin;
  }

  /*
   * `text` with every place it quotes `address` masked: an error a send
   * failed with can quote the address it was sent to, and the log keeps the
   * error's words.
   */
  public static maskIn(
    text: string,
    address: { toString(): string } | string | null | undefined,
  ): string {
    const raw: string = (address?.toString() || "").trim();

    if (!text || !raw) {
      return text;
    }

    return text.split(raw).join(WebhookAddressMask.mask(raw));
  }
}
