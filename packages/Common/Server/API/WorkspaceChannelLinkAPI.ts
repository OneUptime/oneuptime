import UserMiddleware from "../Middleware/UserAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import WorkspaceChannelLinks from "../Utils/Workspace/WorkspaceChannelLinks";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import WorkspaceChannelLinkUtil, {
  WORKSPACE_CHANNEL_LINK_ROUTE,
  WorkspaceChannelLink,
  WorkspaceChannelRecordType,
} from "../../Types/Workspace/WorkspaceChannelLink";

/*
 * GET /workspace-channel-link/<record type>/<record id>
 *
 * The links behind an incident's, alert's, episode's or scheduled
 * maintenance event's "Open in Slack" / "Open in Microsoft Teams" button:
 * { links: [{ workspaceType, channelName, url }] }, empty when the record has
 * no channel of its own (WorkspaceChannelLinks).
 *
 * A signed-in member of the project asks it, for a record they can read: the
 * record is read with their own permissions first, so a private incident's
 * channel is no easier to find than the incident.
 */
const router: ExpressRouter = Express.getRouter();

router.get(
  `${WORKSPACE_CHANNEL_LINK_ROUTE}/:recordType/:recordId`,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      CommonAPI.assertTenantScoped(props);

      const recordType: unknown = req.params["recordType"];

      if (!WorkspaceChannelLinkUtil.isRecordType(recordType)) {
        throw new BadDataException(
          `Unknown record type. Use one of: ${Object.values(
            WorkspaceChannelRecordType,
          ).join(", ")}.`,
        );
      }

      const recordIdText: string = String(req.params["recordId"] || "");

      if (!ObjectID.isValidUUID(recordIdText)) {
        throw new BadDataException("The record id is not a valid id.");
      }

      const links: Array<WorkspaceChannelLink> =
        await WorkspaceChannelLinks.getLinks({
          recordType: recordType,
          recordId: new ObjectID(recordIdText),
          props: props,
        });

      Response.setNoCacheHeaders(res);

      return Response.sendJsonObjectResponse(req, res, {
        links: WorkspaceChannelLinkUtil.toJSONArray(links),
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
