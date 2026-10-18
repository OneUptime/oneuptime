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
 * project, register a Runner that fixes code for every project - and it is
 * reachable through the ingress like any other route. What keeps a stranger
 * out is that the caller presents this installation's cluster key.
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
 */

// What the installation's own cluster key is derived for, and nothing else.
export const INSTALLATION_CLUSTER_KEY_LABEL: string =
  "oneuptime-installation-cluster-key";

export const CLUSTER_KEY_NOT_FOUND_MESSAGE: string = "Cluster key not found.";

export const INVALID_CLUSTER_KEY_MESSAGE: string =
  "Invalid cluster key provided";

export const SHIPPED_CLUSTER_KEY_MESSAGE: string =
  'This cluster key is a value the OneUptime repository ships ("secret", or a "please-change-this-to-random-value" placeholder), so OneUptime does not accept it. Set ONEUPTIME_SECRET to the same long random value on the OneUptime app and on this service.';

// Header keys arrive lower-cased.
const CLUSTER_KEY_HEADER: string = "clusterkey";

// KEDA's TriggerAuthentication sends its parameters with an X- prefix.
const PREFIXED_CLUSTER_KEY_HEADER: string = "x-clusterkey";

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
   * The cluster key a request presents, where OneUptime's services and
   * KEDA put it, or undefined.
   */
  public static getPresentedClusterKey(req: ExpressRequest): unknown {
    if (req.params && req.params["clusterKey"]) {
      return req.params["clusterKey"];
    }

    if (req.query && req.query["clusterKey"]) {
      return req.query["clusterKey"];
    }

    if (req.headers && req.headers[CLUSTER_KEY_HEADER]) {
      return req.headers[CLUSTER_KEY_HEADER];
    }

    if (req.headers && req.headers[PREFIXED_CLUSTER_KEY_HEADER]) {
      return req.headers[PREFIXED_CLUSTER_KEY_HEADER];
    }

    if (req.body && req.body.clusterKey) {
      return req.body.clusterKey;
    }

    return undefined;
  }

  @CaptureSpan()
  public static async isAuthorizedServiceMiddleware(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    const presented: unknown =
      ClusterKeyAuthorization.getPresentedClusterKey(req);

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

    return next();
  }
}
