import {
  IsSharedRunnerKeyShipped,
  isShippedSecretValue,
  SharedRunnerKey,
} from "../EnvironmentConfig";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import SecretKeyComparison from "../Utils/SecretKeyComparison";
import WrongComponentKeyLimit, {
  ComponentKeyKind,
} from "../Utils/RateLimit/WrongComponentKeyLimit";
import { WrongKeyRefusal } from "../Utils/RateLimit/WrongKeyLimit";
import Dictionary from "../../Types/Dictionary";
import BadDataException from "../../Types/Exception/BadDataException";

/*
 * THE SHARED RUNNER REGISTERS WITH ITS OWN KEY
 *
 * The shared Runner - the runner service of Docker Compose and the Helm
 * chart - serves AI code fixes for every project that has no Runner of its
 * own, as the installation's global AI agent. Registering as that agent is
 * what only the installation's own Runner may do.
 *
 * It proves it is that Runner with the key it registers and authenticates
 * with anyway, ONEUPTIME_RUNNER_KEY: its deployment gives the app the same
 * key (docker-compose.yml from config.env, the Helm chart from runner.key,
 * runner.existingSecret or the key it generates), and the registration is
 * let through when the key it presents is that one - compared in constant
 * time, and never a value this repository ships. So the Runner holds no
 * cluster key: ONEUPTIME_SECRET opens every route OneUptime's own services
 * call each other on, and the Runner never needs one of them.
 *
 * A Runner of an earlier release presents the cluster key instead, and so
 * does a Runner whose deployment still gives it ONEUPTIME_SECRET:
 * ClusterKeyAuthorization lets those through with it, as before, and hands a
 * registration that carries no cluster key here.
 *
 * Wrong keys are counted for the client that sends them
 * (WrongComponentKeyLimit), so nobody can try one key after another.
 */

export const SHARED_RUNNER_KEY_NOT_SET_MESSAGE: string =
  "The OneUptime app has no ONEUPTIME_RUNNER_KEY of its own, so the shared Runner cannot register with its key. Give the app the same long random ONEUPTIME_RUNNER_KEY as the Runner: the docker-compose.yml and the Helm chart of this release do (from config.env, and from runner.key or the key the chart generates).";

export const SHARED_RUNNER_KEY_MISSING_MESSAGE: string =
  "aiAgentKey is missing. The shared Runner registers with its ONEUPTIME_RUNNER_KEY.";

export const SHIPPED_SHARED_RUNNER_KEY_MESSAGE: string =
  "aiAgentKey is a value the OneUptime repository ships, which is public, so it is refused. Set ONEUPTIME_RUNNER_KEY to the same long random value on the shared Runner and the OneUptime app.";

export const WRONG_SHARED_RUNNER_KEY_MESSAGE: string =
  "This Runner's ONEUPTIME_RUNNER_KEY is not the one the OneUptime app holds, so it cannot register as the shared Runner. Give the Runner and the app the same ONEUPTIME_RUNNER_KEY: with Docker Compose both read it from config.env, and the Helm chart gives both the same one.";

// Where the Runner puts its key: its registration's JSON body.
const RUNNER_KEY_BODY_FIELD: string = "aiAgentKey";

export default class SharedRunnerKeyAuthorization {
  /*
   * The shared Runner's registration, from a Runner that presented no
   * cluster key: let through when the key it registers with is the one the
   * app holds.
   */
  public static async authorizeRegistration(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    if (IsSharedRunnerKeyShipped) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException(SHARED_RUNNER_KEY_NOT_SET_MESSAGE),
      );
    }

    const presented: unknown =
      SharedRunnerKeyAuthorization.getPresentedRunnerKey(req);

    if (typeof presented !== "string" || presented.length === 0) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException(SHARED_RUNNER_KEY_MISSING_MESSAGE),
      );
    }

    if (isShippedSecretValue(presented)) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException(SHIPPED_SHARED_RUNNER_KEY_MESSAGE),
      );
    }

    const isKeyRight: boolean = SecretKeyComparison.timingSafeEqual(
      presented,
      SharedRunnerKey,
    );

    /*
     * The key is compared first, so that checking the client and counting
     * a wrong key are one step. A client over the limit is refused
     * whichever key it sent.
     */
    const refusal: WrongKeyRefusal | null =
      await WrongComponentKeyLimit.checkRegistrationKey({
        req: req,
        kind: ComponentKeyKind.SharedRunner,
        presentedKey: presented,
        isKeyRight: isKeyRight,
      });

    if (refusal) {
      return WrongComponentKeyLimit.answerRefusal(
        req,
        res,
        ComponentKeyKind.SharedRunner,
        refusal,
      );
    }

    if (!isKeyRight) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException(WRONG_SHARED_RUNNER_KEY_MESSAGE),
      );
    }

    return next();
  }

  // The key the Runner registers with, from its JSON body, or undefined.
  private static getPresentedRunnerKey(req: ExpressRequest): unknown {
    const body: unknown = req.body;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return undefined;
    }

    return (body as Dictionary<unknown>)[RUNNER_KEY_BODY_FIELD];
  }
}
