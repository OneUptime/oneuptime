import {
  ClusterKey as ONEUPTIME_SECRET,
  IsClusterKeyShipped,
  isShippedSecretValue,
} from "../EnvironmentConfig";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import TokenSigningKey from "../Utils/TokenSigningKey";
import WrongClusterKeyLimit, {
  WRONG_CLUSTER_KEYS_MESSAGE,
  WrongClusterKeyRefusal,
} from "../Utils/RateLimit/WrongClusterKeyLimit";
import Dictionary from "../../Types/Dictionary";
import BadDataException from "../../Types/Exception/BadDataException";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import crypto from "crypto";

/*
 * THE KEY ONEUPTIME'S OWN SERVICES PRESENT TO EACH OTHER
 *
 * A route behind isAuthorizedServiceMiddleware does what only OneUptime
 * itself may ask for - send an email, an SMS, a call or a message with the
 * installation's own accounts, run a workflow, write telemetry for any
 * project. A caller proves it is one of this installation's own services by
 * presenting the installation's cluster key.
 *
 * ONEUPTIME_SECRET, WHEN THE OPERATOR CHOSE ONE
 *
 * It is ONEUPTIME_SECRET, exactly as it always was, so services that share
 * it - the app and the workers - keep calling each other across the
 * upgrade.
 *
 * NEVER A VALUE THIS REPOSITORY SHIPS
 *
 * Not when ONEUPTIME_SECRET is unset or a value this repository ships
 * (EnvironmentConfig.isShippedSecretValue): "secret", which the code used to
 * fall back to, or a placeholder from config.example.env, which the README's
 * Docker Compose install copies as it is. Everybody knows those. Such an
 * installation's services present a key derived from the installation's own
 * token signing key instead (TokenSigningKey), which every app and worker
 * process loads at boot, before it mounts a route or starts a worker
 * (App/Index.ts), so they keep calling each other with no change by the
 * operator. And a shipped value is refused from every caller, whatever this
 * installation's own key is.
 *
 * NO RUNNER HOLDS IT
 *
 * Every Runner - a project's own, and the global ones OneUptime runs for
 * every project - proves who it is with its own id and key. None registers
 * with the cluster key, and no route a Runner calls takes it.
 *
 * IN A HEADER, AND NOWHERE ELSE
 *
 * The key travels in the clusterkey request header (x-clusterkey too, as
 * KEDA would send it), which every OneUptime service sends and every release
 * has read. Never in the URL: proxies, ingresses, access logs and the
 * request's own trace keep URLs, so a request whose URL carries the key is
 * refused, whatever else it carries. Never in the body either.
 *
 * Every OneUptime service presents the key to these routes alone, through
 * getClusterKeyHeaders, and no route hands the headers it is sent to
 * anything a project can read without taking these two out first
 * (withoutClusterKeyHeaders).
 *
 * NOT ONE GUESS AFTER ANOTHER
 *
 * A client may present only so many different wrong keys in a quarter of an
 * hour (WrongClusterKeyLimit); after that, every request it makes to these
 * routes is refused until the quarter of an hour ends, whichever key it
 * carries, right or wrong. A request with the right key is never counted, so
 * OneUptime's own traffic is never refused for being busy, and a service
 * that still sends an old key sends one wrong key, not one per request. A key
 * presented from a private network address, where every one of OneUptime's
 * own services calls from, is never counted at all, so nothing sent from
 * beside them can get them refused.
 */

// What the installation's own cluster key is derived for, and nothing else.
export const INSTALLATION_CLUSTER_KEY_LABEL: string =
  "oneuptime-installation-cluster-key";

export const CLUSTER_KEY_NOT_FOUND_MESSAGE: string =
  'Cluster key not found. OneUptime\'s services send it in the "clusterkey" request header.';

export const CLUSTER_KEY_IN_URL_MESSAGE: string =
  'OneUptime takes the cluster key only in the "clusterkey" request header, never in the URL, which proxies and access logs keep. Send it in the header, and if it was sent in a URL, change ONEUPTIME_SECRET on the OneUptime app and on every service that uses it.';

export const INVALID_CLUSTER_KEY_MESSAGE: string =
  "Invalid cluster key provided";

export const SHIPPED_CLUSTER_KEY_MESSAGE: string =
  'This cluster key is a value the OneUptime repository ships ("secret", or a "please-change-this-to-random-value" placeholder), so OneUptime does not accept it. Set ONEUPTIME_SECRET to the same long random value on the OneUptime app and on this service.';

// Header keys arrive lower-cased.
const CLUSTER_KEY_HEADER: string = "clusterkey";

// KEDA's TriggerAuthentication sends its parameters with an X- prefix.
const PREFIXED_CLUSTER_KEY_HEADER: string = "x-clusterkey";

// The headers the key travels in.
const CLUSTER_KEY_HEADERS: Array<string> = [
  CLUSTER_KEY_HEADER,
  PREFIXED_CLUSTER_KEY_HEADER,
];

// A URL's name for the key: any case, with or without separators.
const CLUSTER_KEY_NAMES: Array<string> = ["clusterkey", "xclusterkey"];

const NAME_SEPARATORS: RegExp = /[-_\s]/g;

function namesClusterKey(name: string): boolean {
  return CLUSTER_KEY_NAMES.includes(
    name.toLowerCase().replace(NAME_SEPARATORS, ""),
  );
}

// What WrongClusterKeyLimit keeps of a presented key that is not text.
const NOT_TEXT_WRONG_KEY: string = "not-text";

export default class ClusterKeyAuthorization {
  @CaptureSpan()
  public static getClusterKeyHeaders(): Dictionary<string> {
    return {
      [CLUSTER_KEY_HEADER]: ClusterKeyAuthorization.getClusterKey(),
    };
  }

  /*
   * The cluster key this process presents, as it travels: URI-encoded,
   * because a lot of people use special characters in ONEUPTIME_SECRET.
   */
  @CaptureSpan()
  public static getClusterKey(): string {
    return encodeURIComponent(
      ClusterKeyAuthorization.getInstallationClusterKey(),
    );
  }

  /*
   * This installation's cluster key: ONEUPTIME_SECRET when the operator
   * chose it, otherwise the key derived for it from the installation's own
   * token signing key. Read per call, so it follows the signing key the
   * moment App/Index.ts loads it.
   */
  public static getInstallationClusterKey(): string {
    if (!IsClusterKeyShipped) {
      return ONEUPTIME_SECRET.toString();
    }

    return TokenSigningKey.deriveKey(INSTALLATION_CLUSTER_KEY_LABEL).toString(
      "hex",
    );
  }

  /*
   * Whether ONEUPTIME_SECRET is unset or a value this repository ships, so
   * that this process presents the installation's derived key, which only
   * the app and worker processes can know.
   */
  public static isConfiguredClusterKeyShipped(): boolean {
    return IsClusterKeyShipped;
  }

  /*
   * Whether a presented key is a value this repository ships, as it
   * travels or once decoded.
   */
  public static isShippedClusterKey(presented: string): boolean {
    if (isShippedSecretValue(presented)) {
      return true;
    }

    let decoded: string;

    try {
      decoded = decodeURIComponent(presented);
    } catch {
      // Not URI-encoded text, so not anything a OneUptime service sends.
      return false;
    }

    return isShippedSecretValue(decoded);
  }

  /*
   * Whether a caller that presented this proves it is one of this
   * installation's own services: a string equal to the installation's
   * cluster key as it travels, and never a value this repository ships.
   * Compared in constant time.
   */
  public static isAcceptedClusterKey(presented: unknown): boolean {
    if (typeof presented !== "string" || presented.length === 0) {
      return false;
    }

    /*
     * First, so that no change to how the installation's own key is chosen
     * can ever make a public value one this accepts.
     */
    if (ClusterKeyAuthorization.isShippedClusterKey(presented)) {
      return false;
    }

    const expected: string = ClusterKeyAuthorization.getClusterKey();

    return crypto.timingSafeEqual(
      crypto.createHash("sha256").update(presented, "utf8").digest(),
      crypto.createHash("sha256").update(expected, "utf8").digest(),
    );
  }

  /*
   * What WrongClusterKeyLimit keeps of a wrong key: an HMAC of it, as it
   * travelled, under the installation's own key - so the wrong keys Valkey
   * holds say nothing about any of them, though one may be a near miss or
   * another installation's key. Anything that is not text is one wrong key,
   * whatever it holds: it can never be the key.
   */
  public static getWrongKeyDigest(presented: unknown): string {
    if (typeof presented !== "string") {
      return NOT_TEXT_WRONG_KEY;
    }

    return crypto
      .createHmac("sha256", ClusterKeyAuthorization.getClusterKey())
      .update(presented, "utf8")
      .digest("hex");
  }

  /*
   * The cluster key a request presents in its headers, where OneUptime's
   * services and KEDA put it, or undefined. Nothing else of a request is
   * read for it.
   */
  public static getPresentedClusterKey(req: ExpressRequest): unknown {
    if (req.headers && req.headers[CLUSTER_KEY_HEADER]) {
      return req.headers[CLUSTER_KEY_HEADER];
    }

    if (req.headers && req.headers[PREFIXED_CLUSTER_KEY_HEADER]) {
      return req.headers[PREFIXED_CLUSTER_KEY_HEADER];
    }

    return undefined;
  }

  /*
   * Whether the request's URL - its query string, or a path parameter -
   * names the key, under any spelling of its name.
   */
  public static carriesClusterKeyInUrl(req: ExpressRequest): boolean {
    for (const names of [req.query, req.params]) {
      if (
        names &&
        typeof names === "object" &&
        Object.keys(names).some(namesClusterKey)
      ) {
        return true;
      }
    }

    return false;
  }

  /*
   * A copy of request headers without the ones that carry the key, for a
   * route that hands the headers it was sent on to something a project can
   * read - a workflow's Webhook trigger hands them to the run.
   */
  public static withoutClusterKeyHeaders<T>(
    headers: Dictionary<T> | undefined | null,
  ): Dictionary<T> {
    const kept: Dictionary<T> = {};

    for (const [name, value] of Object.entries(headers || {})) {
      // Header names are not case-sensitive.
      if (!CLUSTER_KEY_HEADERS.includes(name.toLowerCase())) {
        kept[name] = value;
      }
    }

    return kept;
  }

  /*
   * Every route that takes the cluster key: the key in a request header,
   * and only there.
   */
  @CaptureSpan()
  public static async isAuthorizedServiceMiddleware(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    return await ClusterKeyAuthorization.authorize({
      req: req,
      res: res,
      next: next,
      presented: ClusterKeyAuthorization.getPresentedClusterKey(req),
    });
  }

  private static async authorize(data: {
    req: ExpressRequest;
    res: ExpressResponse;
    next: NextFunction;
    presented: unknown;
  }): Promise<void> {
    const { req, res, next, presented } = data;

    if (ClusterKeyAuthorization.carriesClusterKeyInUrl(req)) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException(CLUSTER_KEY_IN_URL_MESSAGE),
      );
    }

    if (presented === undefined) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException(CLUSTER_KEY_NOT_FOUND_MESSAGE),
      );
    }

    if (
      typeof presented === "string" &&
      ClusterKeyAuthorization.isShippedClusterKey(presented)
    ) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException(SHIPPED_CLUSTER_KEY_MESSAGE),
      );
    }

    const isAccepted: boolean =
      ClusterKeyAuthorization.isAcceptedClusterKey(presented);

    /*
     * The key is compared first, so that checking the client and counting
     * a wrong key are one step (WrongClusterKeyLimit). A client over the
     * limit is refused whichever key it sent: once it has sent too many
     * wrong keys, it learns nothing from the next one.
     */
    const refusal: WrongClusterKeyRefusal | null =
      await WrongClusterKeyLimit.check({
        req: req,
        wrongKey: isAccepted
          ? null
          : ClusterKeyAuthorization.getWrongKeyDigest(presented),
      });

    if (refusal) {
      ClusterKeyAuthorization.setRetryAfter(res, refusal.retryAfterSeconds);

      return Response.sendErrorResponse(
        req,
        res,
        new TooManyRequestsException(WRONG_CLUSTER_KEYS_MESSAGE),
      );
    }

    if (!isAccepted) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException(INVALID_CLUSTER_KEY_MESSAGE),
      );
    }

    return next();
  }

  // When a refused client may try again, for a response that can carry it.
  private static setRetryAfter(
    res: ExpressResponse,
    retryAfterSeconds: number,
  ): void {
    if (typeof res.setHeader === "function") {
      res.setHeader("Retry-After", String(retryAfterSeconds));
    }
  }
}
