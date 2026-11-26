import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import DataSecurityActionRunner from "../Utils/AI/Toolbox/DataSecurityActionRunner";
import ProductsOfRequest from "../Utils/ServerProducts/ProductsOfRequest";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import {
  DATA_SECURITY_ACTION_RUN_ROUTE,
  DataSecurityActionRunResult,
} from "../../Types/AI/AIDataSecurityActions";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

/*
 * RUNS ONE OF ASK AI'S DATA SECURITY ACTIONS, OUTSIDE THE CHAT (#10378).
 *
 * POST /api/data-security-actions/run with { action, arguments }: the MCP
 * server's scrub_data_security_finding, judge_data_security_finding,
 * change_data_security_issue, set_data_store_owners,
 * draft_data_security_rule, save_data_security_rule, respond_on_data_store,
 * fix_data_security_issue_with_ai, query_data_security_proposals and
 * decide_data_security_proposal (DATA_SECURITY_ACTIONS_RUN_OUTSIDE_CHAT),
 * one call each, as the caller - a member signed in to an MCP client with
 * OAuth reaches it as themselves (McpDelegationAuthorization).
 * DataSecurityActionRunner runs the very tools Ask AI runs, which call the
 * very server code Data Security's buttons call, with the same checks, and
 * answers with what was done in the words of Ask AI's approval card - or
 * refuses with what is needed. An action that asks in every mode in Ask AI
 * is refused here, with where to do it: no card OneUptime can wait on is
 * shown to anyone. It takes only the arguments each action's schema takes.
 * A project API key reads the drafts and the proposals; acting needs a
 * person.
 *
 * While Data Security is switched off on the server, every one of them is
 * refused before anything is read (ProductsOfRequest.dataSecurityAction,
 * the products Ask AI's tool names - Code too, for Fix with AI), and again
 * where the tool runs.
 */

const router: ExpressRouter = Express.getRouter();

router.post(
  DATA_SECURITY_ACTION_RUN_ROUTE,
  UserMiddleware.getUserMiddleware,
  ServerProductRoutes.refuseWhileOffFor(ProductsOfRequest.dataSecurityAction),
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
          "Name the Data Security action to run in action, such as scrub_data_security_finding.",
        );
      }

      const result: DataSecurityActionRunResult =
        await DataSecurityActionRunner.run({
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
