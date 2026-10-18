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
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "../Utils/Logger";
import Response from "../Utils/Response";
import TokenSigningKey from "../Utils/TokenSigningKey";
import Dictionary from "../../Types/Dictionary";
import BadDataException from "../../Types/Exception/BadDataException";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import crypto from "crypto";

/*
 * THE KEY ONEUPTIME'S OWN SERVICES PRESENT TO EACH OTHER
 *
 * A route behind isAuthorizedServiceMiddleware does what only OneUptime
 * itself may ask for - send an email, an SMS, a call or a message with the
 * installation's own accounts, run a workflow, write telemetry for any
 * project, register a Runner that fixes code for every project. A caller
 * proves it is one of this installation's own services by presenting the
 * installation's cluster key.
 *
 * ONEUPTIME_SECRET, WHEN THE OPERATOR CHOSE ONE
 *
 * It is ONEUPTIME_SECRET, exactly as it always was, so services that share
 * it - the app, the workers and the in-cluster Runner - keep calling each
 * other across the upgrade.
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
 * The in-cluster Runner cannot derive that key - it never reads the
 * database - so it registers only on an installation whose operator gave it
 * and the app the same ONEUPTIME_SECRET. npm start and npm run update put a
 * random one in config.env for Docker Compose
 * (Scripts/Install/ReplacePlaceholderSecrets.js), and the Helm chart
 * generates one.
 *
 * IN A HEADER, AND NOWHERE ELSE
 *
 * The key travels in the clusterkey request header (x-clusterkey too, as
 * KEDA would send it), which every OneUptime service sends and every release
 * has read. Never in the URL: proxies, ingresses, access logs and the
 * request's own trace keep URLs, so a request whose URL carries the key is
 * refused, whatever else it carries. Never in the body either - with one
 * exception, for as long as Runners of earlier releases are about: the
 * Runner's registration (isAuthorizedRunnerRegistrationMiddleware) also
 * takes the clusterKey field of its JSON body, where those Runners put it,
 * and logs that the Runner should be updated.
 *
 * Every OneUptime service presents the key to these routes alone, through
 * getClusterKeyHeaders, and no route hands the headers it is sent to
 * anything a project can read without taking these two out first
 * (withoutClusterKeyHeaders).
 */

// What the installation's own cluster key is derived for, and nothing else.
export const INSTALLATION_CLUSTER_KEY_LABEL: string =
  "oneuptime-installation-cluster-key";

export const CLUSTER_KEY_NOT_FOUND_MESSAGE: string =
  'Cluster key not found. OneUptime\'s services send it in the "clusterkey" request header.';

export const CLUSTER_KEY_IN_URL_MESSAGE: string =
  'OneUptime takes the cluster key only in the "clusterkey" request header, never in the URL, which proxies and access logs keep. Send it in the header, and if it was sent in a URL, change ONEUPTIME_SECRET on the OneUptime app and on every service that uses it.';

export const OLDER_RUNNER_CLUSTER_KEY_MESSAGE: string =
  'A Runner registered with the cluster key in its request body, as Runners of earlier releases send it. Update that Runner to the release the OneUptime app runs: it sends the key in the "clusterkey" request header.';

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

// Where Runners of earlier releases put the key: their registration's body.
const OLDER_RUNNER_BODY_FIELD: string = "clusterKey";

// A URL's name for the key: any case, with or without separators.
const CLUSTER_KEY_NAMES: Array<string> = ["clusterkey", "xclusterkey"];

const NAME_SEPARATORS: RegExp = /[-_\s]/g;

function namesClusterKey(name: string): boolean {
  return CLUSTER_KEY_NAMES.includes(
    name.toLowerCase().replace(NAME_SEPARATORS, ""),
  );
}

// Where a request presented the key from.
type PresentedFrom = "header" | "older Runner body";

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
   * The key a Runner of an earlier release registers with: the clusterKey
   * field of its JSON body, or undefined. Read for the Runner's
   * registration alone.
   */
  public static getOlderRunnerClusterKey(req: ExpressRequest): unknown {
    const body: unknown = req.body;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return undefined;
    }

    return (body as Dictionary<unknown>)[OLDER_RUNNER_BODY_FIELD] || undefined;
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
      presentedFrom: "header",
    });
  }

  /*
   * The in-cluster Runner's registration: the key in a request header, as
   * the Runner of this release sends it - or, from a Runner of an earlier
   * release, in the clusterKey field of the request's JSON body, so that a
   * Runner a release behind the app still registers, during a rolling
   * upgrade or after it.
   */
  @CaptureSpan()
  public static async isAuthorizedRunnerRegistrationMiddleware(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    const inHeader: unknown =
      ClusterKeyAuthorization.getPresentedClusterKey(req);

    return await ClusterKeyAuthorization.authorize({
      req: req,
      res: res,
      next: next,
      presented:
        inHeader !== undefined
          ? inHeader
          : ClusterKeyAuthorization.getOlderRunnerClusterKey(req),
      presentedFrom:
        inHeader !== undefined ? "header" : "older Runner body",
    });
  }

  private static async authorize(data: {
    req: ExpressRequest;
    res: ExpressResponse;
    next: NextFunction;
    presented: unknown;
    presentedFrom: PresentedFrom;
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

    if (!ClusterKeyAuthorization.isAcceptedClusterKey(presented)) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException(INVALID_CLUSTER_KEY_MESSAGE),
      );
    }

    if (data.presentedFrom === "older Runner body") {
      logger.warn(
        OLDER_RUNNER_CLUSTER_KEY_MESSAGE,
        getLogAttributesFromRequest(req as RequestLike),
      );
    }

    return next();
  }
}
