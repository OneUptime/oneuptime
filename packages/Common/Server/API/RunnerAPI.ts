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
import AIAgentService from "../Services/AIAgentService";
import PositiveNumber from "../../Types/PositiveNumber";
import AIAgent from "../../Models/DatabaseModels/AIAgent";
import Runner from "../../Models/DatabaseModels/Runner";
import RunnerLiveStatus from "../../Types/Runner/RunnerLiveStatus";
import { JSONObject } from "../../Types/JSON";

// The route a code repository's Runner picker reads its Global Runner from.
export const GLOBAL_CODE_RUNNERS_PATH: string = "/global-code-runners";

/*
 * How a global Runner for code is doing, in the words a Runner picker draws
 * a Runner's status in: alive now (AIAgentService.isAgentAlive), seen
 * before, or never.
 */
export function getGlobalCodeRunnerLiveStatus(
  agent: AIAgent,
): RunnerLiveStatus {
  if (AIAgentService.isAgentAlive(agent)) {
    return RunnerLiveStatus.Connected;
  }

  return agent.lastAlive
    ? RunnerLiveStatus.Disconnected
    : RunnerLiveStatus.NeverConnected;
}

/*
 * The Runner table's CRUD routes, plus the global Runners as every project
 * sees them.
 */
export default class RunnerAPI extends BaseAPI<Runner, RunnerServiceType> {
  public constructor() {
    super(Runner, RunnerService);

    /*
     * The global Runners - the ones OneUptime runs for every project - as
     * the Runners page and the step editor's Runner picker list them: read
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

    /*
     * The global Runners for code - the global AI agents that take the AI
     * work of every code repository that picks no Runner of its own (the
     * installation's bundled Runner, OneUptime Cloud's fleet) - as a code
     * repository's Runner picker draws its Global Runner choice: how each is
     * doing, and nothing else. Never a name, a key or a host: read as
     * OneUptime, for anyone signed in, whatever the request asks for.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}${GLOBAL_CODE_RUNNERS_PATH}`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const agents: Array<AIAgent> =
            await AIAgentService.findGlobalCodeRunners();

          return Response.sendJsonObjectResponse(req, res, {
            globalRunners: agents.map((agent: AIAgent): JSONObject => {
              return {
                liveStatus: getGlobalCodeRunnerLiveStatus(agent),
              };
            }),
          });
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
