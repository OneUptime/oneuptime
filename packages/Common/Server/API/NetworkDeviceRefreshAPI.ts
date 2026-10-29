import NetworkDevice from "../../Models/DatabaseModels/NetworkDevice";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import UserMiddleware from "../Middleware/UserAuthorization";
import NetworkDeviceService from "../Services/NetworkDeviceService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import NetworkDeviceRefreshRunner, {
  NetworkDeviceRefreshAnswer,
} from "../Utils/NetworkDevice/NetworkDeviceRefreshRunner";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";

/*
 * REFRESH A NETWORK DEVICE, OVER HTTP.
 *
 *   POST /network-device/:networkDeviceId/refresh
 *     -> NetworkDeviceRefreshAnswer: when it was asked for, and who reads
 *        the device again (its probe, its Meraki connection).
 *
 * A bare router beside the device's CRUD routes, as the discovery import's
 * is: the refresh is not a column a caller writes, so these checks are the
 * gate.
 *
 *  - A person signed in to the project, or a project API key that may write
 *    (a CMDB sync may want a device read again before it exports it).
 *  - The permission to EDIT network devices: a refresh puts the device at
 *    the front of its probe's queue and may read its Meraki organization
 *    again - an action on the project's network, not a read of a page.
 *  - The device must be one the caller can read, in the caller's project:
 *    it is looked up with the caller's own permissions first, so a device
 *    another project owns, or one the caller cannot see, is "not found".
 */
const router: ExpressRouter = Express.getRouter();

const REFRESH_PATH: string = `${
  new NetworkDevice().getCrudApiPath()?.toString() || "/network-device"
}/:networkDeviceId/refresh`;

router.post(
  REFRESH_PATH,
  UserMiddleware.getUserMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);
      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectPrincipal(props);

      DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(props);

      CommonAPI.assertPermittedInProject({
        databaseProps: props,
        allowedPermissions: new NetworkDevice().getUpdatePermissions(),
        errorMessage:
          "Refreshing a network device needs permission to edit network devices.",
      });

      const value: string | undefined = req.params["networkDeviceId"];

      if (!value || !ObjectID.isValidUUID(value)) {
        throw new BadDataException("A valid network device ID is required.");
      }

      const deviceId: ObjectID = new ObjectID(value);

      // The caller must be able to see the device, in their own project.
      const visible: NetworkDevice | null =
        await NetworkDeviceService.findOneBy({
          query: { _id: deviceId, projectId: projectId },
          select: { _id: true, projectId: true },
          props: props,
        });

      if (!visible) {
        throw new NotFoundException("This network device does not exist.");
      }

      CommonAPI.assertResourceBelongsToProject({
        resourceProjectId: visible.projectId,
        projectId: projectId,
      });

      const answer: NetworkDeviceRefreshAnswer =
        await NetworkDeviceRefreshRunner.refresh({
          projectId: projectId,
          deviceId: deviceId,
        });

      return Response.sendJsonObjectResponse(
        req,
        res,
        answer as unknown as JSONObject,
      );
    } catch (error) {
      next(error);
    }
  },
);

export default router;
