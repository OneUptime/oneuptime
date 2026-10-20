import UserMiddleware from "../Middleware/UserAuthorization";
import ScheduledMaintenanceExternalCalendarService, {
  Service as ScheduledMaintenanceExternalCalendarServiceType,
} from "../Services/ScheduledMaintenanceExternalCalendarService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import ExternalCalendarRefresher from "../Utils/ScheduledMaintenance/ExternalCalendar/ExternalCalendarRefresher";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import ScheduledMaintenanceExternalCalendar from "../../Models/DatabaseModels/ScheduledMaintenanceExternalCalendar";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ObjectID from "../../Types/ObjectID";

export const EXTERNAL_CALENDAR_NOT_FOUND_MESSAGE: string =
  "Calendar not found, or you do not have access to it.";

/*
 * The calendars drawn on the maintenance calendar: the CRUD routes, and
 * Read now.
 *
 *   POST /scheduled-maintenance-external-calendar/:id/read-now
 *
 * reads the calendar at once instead of at its next scheduled read, and
 * answers with what the read found (the calendar's status columns). For
 * whoever may update the calendar - asked as an update asks it
 * (findOneUpdatableById); a calendar the caller may not read is answered
 * as missing. The read runs as OneUptime, through the same egress guard and
 * worker thread as the scheduled one (ExternalCalendarRefresher), and is
 * refused while the calendar is off or within half a minute of its last
 * read.
 */
export default class ScheduledMaintenanceExternalCalendarAPI extends BaseAPI<
  ScheduledMaintenanceExternalCalendar,
  ScheduledMaintenanceExternalCalendarServiceType
> {
  public constructor() {
    super(
      ScheduledMaintenanceExternalCalendar,
      ScheduledMaintenanceExternalCalendarService,
    );

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id/read-now`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          CommonAPI.assertAuthenticatedProjectPrincipal(props);

          const idParam: string | undefined = req.params["id"];

          // A malformed id would otherwise reach Postgres as a syntax error.
          if (!idParam || !ObjectID.isValidUUID(idParam)) {
            throw new BadDataException(EXTERNAL_CALENDAR_NOT_FOUND_MESSAGE);
          }

          const id: ObjectID = new ObjectID(idParam);

          const calendar: ScheduledMaintenanceExternalCalendar | null =
            await ScheduledMaintenanceExternalCalendarService.findOneUpdatableById(
              {
                id: id,
                select: {
                  _id: true,
                },
                props: props,
              },
            );

          if (!calendar) {
            throw new NotFoundException(EXTERNAL_CALENDAR_NOT_FOUND_MESSAGE);
          }

          await ExternalCalendarRefresher.readNow(id);

          // What the read found, read as the caller reads the calendar.
          const status: ScheduledMaintenanceExternalCalendar | null =
            await ScheduledMaintenanceExternalCalendarService.findOneById({
              id: id,
              select: {
                _id: true,
                name: true,
                isEnabled: true,
                lastReadAt: true,
                lastReadAttemptAt: true,
                lastReadError: true,
                lastReadHttpStatus: true,
                eventCount: true,
                hasMoreEvents: true,
                nextReadAt: true,
              },
              props: props,
            });

          if (!status) {
            throw new NotFoundException(EXTERNAL_CALENDAR_NOT_FOUND_MESSAGE);
          }

          return Response.sendEntityResponse(
            req,
            res,
            status,
            ScheduledMaintenanceExternalCalendar,
          );
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
