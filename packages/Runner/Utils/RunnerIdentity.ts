import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import LocalCache from "Common/Server/Infrastructure/LocalCache";

/*
 * The Runner's own id. In project-scoped mode it comes from the
 * ONEUPTIME_RUNNER_ID the dashboard issued; in cluster-scoped mode the
 * server assigns it during registration and RegisterRunner caches it here.
 */
export default class RunnerIdentity {
  public static getRunnerId(): ObjectID {
    const id: string | undefined =
      LocalCache.getString("RUNNER", "RUNNER_ID") ||
      process.env["ONEUPTIME_RUNNER_ID"];

    if (!id) {
      throw new BadDataException(
        "Runner ID not found — the Runner has not finished registering yet.",
      );
    }

    return new ObjectID(id);
  }
}
