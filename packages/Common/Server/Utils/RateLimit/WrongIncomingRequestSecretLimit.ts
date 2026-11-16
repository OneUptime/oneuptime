import { ExpressRequest } from "../Express";
import TokenSigningKey from "../TokenSigningKey";
import WrongComponentKeyLimit from "./WrongComponentKeyLimit";
import WrongKeyLimit, { WrongKeyRefusal } from "./WrongKeyLimit";
import crypto from "crypto";

/*
 * WRONG INCOMING REQUEST SECRETS, COUNTED FOR THE CLIENT AND THE MONITOR
 * (issue #8499).
 *
 * A project that requires an incoming request secret answers a request with
 * a wrong one 401, at once. A generated secret is 32 random bytes, past any
 * guessing, but one typed by hand may be as short as 16 characters, and
 * whoever has a monitor's URL could try one after another. So the endpoint
 * limits how many wrong ones a client may try, by the rule every such limit
 * keeps (WrongKeyLimit).
 *
 * THE RULE
 *
 * One client may present WRONG_INCOMING_REQUEST_SECRETS_PER_ADDRESS
 * different wrong secrets - or signatures no secret made - to one monitor in
 * a quarter of an hour. The next different one is refused with 429, and so is
 * every request the client sends that monitor with a secret or a signature
 * until the quarter of an hour ends, right or wrong: answering a right one as
 * right would leave the limit no limit on guessing. A request with a right
 * secret is never counted, and one with none is neither counted nor refused
 * here (it guesses nothing).
 *
 * WHY THE REAL SENDER IS NOT LOCKED OUT
 *
 *   - Counted for the client's address AND the monitor: somebody guessing
 *     from another address, or at another monitor, never adds to the count
 *     of the address the real sender calls from. To refuse it, they would
 *     have to send from its address.
 *   - Counted as DIFFERENT wrong secrets: a sender still holding an old
 *     secret sends the same one on every call - one secret, however many
 *     calls - and keeps getting the 401 that says what is wrong, never this.
 *   - A private network address is never counted (WrongKeyLimit, NOT ON A
 *     PRIVATE NETWORK ADDRESS): the bundled probes, an installation's own
 *     senders and a proxy whose hops are not counted all call from one,
 *     shared by many senders.
 *   - Valkey away, nothing is counted and nothing refused (FAILS OPEN): the
 *     secret keeps out everyone who does not hold it.
 *
 * A signer whose secret is wrong makes a new signature on every request, so
 * it is refused here after the same number of requests - with 429 instead of
 * 401, and a message that says why. It is refused either way.
 *
 * What Valkey keeps of a wrong secret is an HMAC of its SHA-256 with the
 * monitor, under a key of the installation's own: never the secret, a
 * near miss, or another project's.
 */

// The window a client's different wrong secrets are counted in.
export const WRONG_INCOMING_REQUEST_SECRET_WINDOW_SECONDS: number = 15 * 60;

// How many different wrong secrets one address may present to one monitor in a window.
export const WRONG_INCOMING_REQUEST_SECRETS_PER_ADDRESS: number = 10;

// What a client refused for its wrong secrets is told.
export const WRONG_INCOMING_REQUEST_SECRETS_MESSAGE: string =
  "This address has sent too many different wrong incoming request secrets or signatures to this monitor, so its requests to this monitor are refused for now. Wait for the time in the Retry-After header, then send one of the project's incoming request secrets that this monitor accepts.";

/*
 * What a wrong secret's digest is made with: a key derived for this alone
 * from the installation's token signing key.
 */
export const WRONG_INCOMING_REQUEST_SECRET_DIGEST_LABEL: string =
  "oneuptime-wrong-incoming-request-secret-digest";

const LIMIT: WrongKeyLimit = new WrongKeyLimit({
  scope: "wrong incoming request secret",
  logSource: "IncomingRequestSecretGate",
  countedKeys: "different wrong incoming request secrets for monitor",
  keyPrefix: "incoming-request-secret:wrong-secrets:",
  perAddress: WRONG_INCOMING_REQUEST_SECRETS_PER_ADDRESS,
  windowSeconds: WRONG_INCOMING_REQUEST_SECRET_WINDOW_SECONDS,
  countFailedMessage:
    "WrongIncomingRequestSecretLimit: the wrong incoming request secret count failed, so incoming request secrets are compared without it",
});

export default class WrongIncomingRequestSecretLimit {
  // Whether wrong secrets are counted at all just now (Valkey reachable).
  public static isCounting(): boolean {
    return LIMIT.isCounting();
  }

  /*
   * Before a request's secrets are compared: the refusal to answer it with
   * when its client is already over the limit for this monitor, or null.
   * Nothing is counted here.
   */
  public static async checkBeforeComparing(data: {
    req: ExpressRequest;
    monitorId: string;
  }): Promise<WrongKeyRefusal | null> {
    const subject: string | null = this.countedSubject(data);

    if (!subject) {
      return null;
    }

    return await LIMIT.check({
      req: data.req,
      wrongKey: null,
      subject: subject,
    });
  }

  /*
   * Once a request's secrets were compared and none was right: counts each
   * wrong one (its SHA-256, or a signature no secret made), and answers the
   * refusal when that took the client over the limit, or null.
   */
  public static async countWrong(data: {
    req: ExpressRequest;
    monitorId: string;
    wrongValues: ReadonlyArray<string>;
  }): Promise<WrongKeyRefusal | null> {
    const subject: string | null = this.countedSubject(data);

    if (!subject) {
      return null;
    }

    for (const value of Array.from(new Set<string>(data.wrongValues))) {
      if (!value) {
        continue;
      }

      const refusal: WrongKeyRefusal | null = await LIMIT.check({
        req: data.req,
        wrongKey: this.digestOf(subject, value),
        subject: subject,
      });

      if (refusal) {
        return refusal;
      }
    }

    return null;
  }

  // Seconds left in the current window, at least one.
  public static getSecondsUntilWindowEnd(): number {
    return LIMIT.getSecondsUntilWindowEnd();
  }

  public static digestOf(monitorId: string, value: string): string {
    return crypto
      .createHmac(
        "sha256",
        TokenSigningKey.deriveKey(WRONG_INCOMING_REQUEST_SECRET_DIGEST_LABEL),
      )
      .update(`${monitorId}\n${value.toLowerCase()}`, "utf8")
      .digest("hex");
  }

  /*
   * The monitor a client's wrong secrets are counted for - its id, as one
   * spelling - or null when nothing is counted: Valkey away, a private
   * network address, or no monitor id.
   */
  private static countedSubject(data: {
    req: ExpressRequest;
    monitorId: string;
  }): string | null {
    if (!LIMIT.isCounting()) {
      return null;
    }

    if (WrongKeyLimit.isFromPrivateNetwork(data.req)) {
      return null;
    }

    return WrongComponentKeyLimit.canonicalId(data.monitorId);
  }
}
