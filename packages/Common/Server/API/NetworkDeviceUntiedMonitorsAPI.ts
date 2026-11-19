import NetworkDevice from "../../Models/DatabaseModels/NetworkDevice";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { JSONArray } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import UserMiddleware from "../Middleware/UserAuthorization";
import NetworkDeviceService from "../Services/NetworkDeviceService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import UntiedDeviceMonitors from "../Utils/NetworkDevice/UntiedDeviceMonitors";
import { UntiedDeviceMonitorsAnswer } from "../../Utils/NetworkDevice/UntiedDeviceMonitor";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";

/*
 * THE MONITORS THAT CHECK A DEVICE'S ADDRESS BUT ARE TIED TO NO DEVICE,
 * OVER HTTP (OneUptime issue #9903).
 *
 *   POST /network-device/:networkDeviceId/untied-monitors
 *     -> { monitors: [...], hasMore }: each monitor the caller may read
 *        that checks the device's address and is tied to no device, with
 *        what its probes see there (UntiedDeviceMonitors): this device, so
 *        one click ties it on the device's Monitors card; this device and
 *        others they cannot tell apart; or nothing they can know.
 *
 * A bare router beside the device's CRUD routes, as the watching monitors'
 * is (NetworkDeviceWatchingMonitorsAPI): it reads, and a monitor's steps,
 * where its address is, are searched as OneUptime.
 *
 *  - A person signed in to the project, or a project API key.
 *  - The device must be one the caller can read, in the caller's project:
 *    looked up with the caller's own permissions first, so a device another
 *    project owns, or one the caller cannot see, is "not found".
 *  - Only monitors the caller may read are answered (UntiedDeviceMonitors
 *    reads them again with the caller's props).
 */
const router: ExpressRouter = Express.getRouter();

export const UNTIED_MONITORS_PATH: string = `${
  new NetworkDevice().getCrudApiPath()?.toString() || "/network-device"
}/:networkDeviceId/untied-monitors`;

router.post(
  UNTIED_MONITORS_PATH,
  UserMiddleware.getUserMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);
      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectPrincipal(props);

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

      // Its address and where it is, as the rule reads them.
      const device: NetworkDevice | null = await NetworkDeviceService.findOneBy(
        {
          query: { _id: deviceId, projectId: projectId },
          select: { _id: true, hostname: true, siteId: true, probeId: true },
          props: { isRoot: true },
        },
      );

      const answer: UntiedDeviceMonitorsAnswer = device
        ? await UntiedDeviceMonitors.findFor({
            projectId: projectId,
            device: device,
            props: props,
          })
        : { monitors: [], hasMore: false };

      return Response.sendJsonObjectResponse(req, res, {
        monitors: answer.monitors as unknown as JSONArray,
        hasMore: answer.hasMore,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
