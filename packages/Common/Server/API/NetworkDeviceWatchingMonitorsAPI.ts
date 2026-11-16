import Monitor from "../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../Models/DatabaseModels/NetworkDevice";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import MonitorType from "../../Types/Monitor/MonitorType";
import ObjectID from "../../Types/ObjectID";
import UserMiddleware from "../Middleware/UserAuthorization";
import MonitorNetworkDeviceService from "../Services/MonitorNetworkDeviceService";
import MonitorService from "../Services/MonitorService";
import NetworkDeviceService from "../Services/NetworkDeviceService";
import QueryHelper from "../Types/Database/QueryHelper";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";

/*
 * THE NETWORK DEVICE MONITORS WATCHING A DEVICE, OVER HTTP (OneUptime issue
 * #8101).
 *
 *   POST /network-device/:networkDeviceId/watching-monitors
 *     -> { monitorIds: [...] }: the Network Device monitors whose steps name
 *        the device, among those the caller may read, in id order.
 *
 * A Network Device monitor names its device only inside its steps JSON
 * (monitorSteps...networkDeviceMonitor.networkDeviceId). The device's
 * Overview and Monitors pages used to find the monitors watching it by
 * listing EVERY Network Device monitor of the project, steps and all, and
 * filtering them in the browser: one heavy read of every monitor's steps
 * each time someone opened a device, and past the list's page limit
 * (LIMIT_PER_PROJECT) a monitor that did watch the device was silently
 * missed. Postgres keeps MonitorNetworkDevice from every monitor's steps
 * (see the model), so this answers by the device instead: the device's rows
 * through the table's networkDeviceId index, then those monitors by id.
 * The page then reads them by id with the columns it shows
 * (DeviceMonitorLookupUtil), as it reads every other monitor.
 *
 * A bare router beside the device's CRUD routes, as the refresh's is: the
 * table is the server's own (no permission reads it), so these checks are
 * the gate.
 *
 *  - A person signed in to the project, or a project API key.
 *  - The device must be one the caller can read, in the caller's project:
 *    it is looked up with the caller's own permissions first, so a device
 *    another project owns, or one the caller cannot see, is "not found".
 *  - Only monitors the caller may read are answered: the ids are read again
 *    through MonitorService with the caller's own permissions (labels
 *    included), so the answer never names a monitor the caller could not
 *    list for themselves. A caller who may not read monitors at all is
 *    refused, as the Monitor list itself would refuse them.
 */
const router: ExpressRouter = Express.getRouter();

export const WATCHING_MONITORS_PATH: string = `${
  new NetworkDevice().getCrudApiPath()?.toString() || "/network-device"
}/:networkDeviceId/watching-monitors`;

/*
 * Monitor ids one read of the caller's monitors names. A device has a
 * handful of monitors; a statement names every id it is handed, so a
 * pathological device is read in pieces rather than in one huge IN list.
 */
export const WATCHING_MONITOR_IDS_PER_READ: number = 500;

router.post(
  WATCHING_MONITORS_PATH,
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

      const watchingIds: Array<string> =
        await MonitorNetworkDeviceService.findMonitorIdsWatching({
          projectId: projectId,
          deviceIds: [deviceId.toString()],
        });

      const monitorIds: Array<string> = await readableMonitorIds({
        monitorIds: watchingIds,
        projectId: projectId,
        props: props,
      });

      return Response.sendJsonObjectResponse(req, res, {
        monitorIds: monitorIds,
      });
    } catch (error) {
      next(error);
    }
  },
);

/*
 * The ids among these that the caller may read, as Network Device monitors
 * of the project, in id order.
 */
async function readableMonitorIds(data: {
  monitorIds: Array<string>;
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
}): Promise<Array<string>> {
  const ids: Array<string> = Array.from(new Set(data.monitorIds)).sort();
  const readable: Array<string> = [];

  for (
    let offset: number = 0;
    offset < ids.length;
    offset += WATCHING_MONITOR_IDS_PER_READ
  ) {
    const chunk: Array<string> = ids.slice(
      offset,
      offset + WATCHING_MONITOR_IDS_PER_READ,
    );

    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: {
        _id: QueryHelper.any(chunk),
        projectId: data.projectId,
        monitorType: MonitorType.NetworkDevice,
      },
      select: {
        _id: true,
      },
      limit: chunk.length,
      skip: 0,
      props: data.props,
    });

    for (const monitor of monitors) {
      const id: string | undefined = monitor.id?.toString();

      if (id) {
        readable.push(id);
      }
    }
  }

  return Array.from(new Set(readable)).sort();
}

export default router;
