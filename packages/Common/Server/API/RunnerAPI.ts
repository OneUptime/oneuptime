import UserMiddleware from "../Middleware/UserAuthorization";
import RunnerService, {
  Service as RunnerServiceType,
} from "../Services/RunnerService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import PositiveNumber from "../../Types/PositiveNumber";
import Runner from "../../Models/DatabaseModels/Runner";

/*
 * The Runner table's CRUD routes, plus the global Runners as every project
 * sees them.
 */
export default class RunnerAPI extends BaseAPI<Runner, RunnerServiceType> {
  public constructor() {
    super(Runner, RunnerService);

    /*
     * The global Runners - the ones OneUptime runs for every project - as
     * the Runners page and the step, rule and code repository Runner
     * pickers list them: read
     * as OneUptime (no project owns them, so no project's read reaches
     * them), for anyone signed in, with the columns of
     * GLOBAL_RUNNER_PUBLIC_SELECT only. Never a key, a host, a version or a
     * capability a caller could steer: whatever the request asks for, this
     * is what it gets, sorted by name.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/global-runners`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const runners: Array<Runner> =
            await RunnerService.findGlobalRunners();

          return Response.sendEntityArrayResponse(
            req,
            res,
            runners,
            new PositiveNumber(runners.length),
            Runner,
          );
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
