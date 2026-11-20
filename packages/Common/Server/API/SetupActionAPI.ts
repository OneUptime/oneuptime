import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import SetupActionRunner from "../Utils/AI/Toolbox/SetupActionRunner";
import ProductsOfRequest from "../Utils/ServerProducts/ProductsOfRequest";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import {
  SETUP_ACTION_RUN_ROUTE,
  SetupActionRunResult,
} from "../../Types/AI/AISetupActions";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

/*
 * RUNS ONE OF ASK AI'S SETUP ACTIONS, OUTSIDE THE CHAT (#7241).
 *
 * POST /api/setup-actions/run with { action, arguments }: the MCP server's
 * set_up_website_monitoring, set_up_service_monitor, set_up_paging,
 * add_to_on_call_policy, invite_people, set_how_to_reach_me,
 * publish_status_page, add_monitors_to_status_page and who_is_told
 * (SETUP_ACTIONS_RUN_OUTSIDE_CHAT), one call each, as the caller - a
 * member signed in to an MCP client with OAuth reaches it as themselves
 * (McpDelegationAuthorization). SetupActionRunner runs the very tools Ask
 * AI runs, with the same checks and the same writes, and answers with what
 * was made in the words of Ask AI's approval card, or refuses with what is
 * needed. It takes only the arguments each action's schema takes. A
 * project API key reads who_is_told; setting things up acts as a person,
 * so a key is refused that.
 *
 * While a product an action belongs to is switched off on the server, the
 * action is refused before anything is read (ProductsOfRequest.setupAction,
 * the products Ask AI's tool names), and again where the tool runs.
 * invite_people and set_how_to_reach_me are of no one product: a project's
 * people and how pages reach a person are always on.
 */

const router: ExpressRouter = Express.getRouter();

router.post(
  SETUP_ACTION_RUN_ROUTE,
  UserMiddleware.getUserMiddleware,
  ServerProductRoutes.refuseWhileOffFor(ProductsOfRequest.setupAction),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      // A member or a project API key of this one project, never anonymous.
      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectPrincipal(props);

      const body: JSONObject = (req.body || {}) as JSONObject;
      const action: unknown = body["action"];

      if (typeof action !== "string" || !action.trim()) {
        throw new BadDataException(
          "Name the setup action to run in action, such as set_up_website_monitoring.",
        );
      }

      const result: SetupActionRunResult = await SetupActionRunner.run({
        action: action.trim(),
        args: body["arguments"] === undefined ? {} : body["arguments"],
        ctx: { projectId: projectId, props: props },
      });

      Response.sendJsonObjectResponse(
        req,
        res,
        result as unknown as JSONObject,
      );
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

export default router;
