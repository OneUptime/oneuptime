import HostLogSessionService from "../../Services/HostLogSessionService";
import LogService from "../../Services/LogService";
import CaptureSpan from "../Telemetry/CaptureSpan";
import HostLogSession from "../../../Models/DatabaseModels/HostLogSession";
import Log from "../../../Models/AnalyticsModels/Log";
import Query from "../../Types/AnalyticsDatabase/Query";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { HOST_LOG_SESSION_ATTRIBUTE } from "../../../Types/Host/HostLogSession";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import HostLogSessionFileWriter, {
  HostLogSessionFile,
} from "../../../Utils/Host/HostLogSessionFile";

/*
 * A log session's lines, as a file (#9966; the format is
 * Utils/Host/HostLogSessionFile): what Download Lines on a device's Logs
 * page hands the reader.
 *
 * Read as viewing them is, with the reader's own permissions: the session
 * as its list reads it (HostLogSessionService - the device's host must be
 * readable), and its lines as the Logs page's Show Lines reads them
 * (LogService - reading logs is a permission of its own), with the same
 * filter - the device's host.name and the session's attribute. A reader
 * who can see the session but not the project's logs is refused, as Logs
 * refuses them. The lines are the ones OneUptime keeps: what the agent's
 * redaction and the project's scrub rules left of them.
 *
 * Bounded: lines are read in pages, the oldest first, until the file is
 * full (HOST_LOG_SESSION_FILE_MAX_LINES lines or ..._MAX_BYTES bytes), and
 * only from a day before the session was asked for to a day after it
 * ended, which covers a device's clock that is off by that much.
 */

export const LOG_SESSION_LINES_PAGE_SIZE: number = 5_000;

// How far the device's clock may be off: lines are read from this long before the request to this long after the end.
export const LOG_SESSION_CLOCK_SLACK_MINUTES: number = 24 * 60;

export const SESSION_NOT_FOUND_MESSAGE: string =
  "This log session was not found in this project. It may have been deleted with its device.";

export const NO_LINES_MESSAGE: string =
  "This log session has no lines: nobody allowed it on the device. Request another one, and someone at the device can allow it.";

export default class HostLogSessionLines {
  @CaptureSpan()
  public static async getFile(data: {
    sessionId: ObjectID;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<HostLogSessionFile> {
    const session: HostLogSession | null =
      await HostLogSessionService.findOneById({
        id: data.sessionId,
        select: {
          _id: true,
          projectId: true,
          createdAt: true,
          startedAt: true,
          endsAt: true,
          endedAt: true,
          minimumLevel: true,
          note: true,
          host: { name: true, hostIdentifier: true },
          createdByUser: { name: true, email: true },
        },
        props: data.props,
      });

    if (!session?._id || !session.projectId) {
      throw new NotFoundException(SESSION_NOT_FOUND_MESSAGE);
    }

    const hostIdentifier: string | undefined =
      session.host?.hostIdentifier?.toString() || undefined;

    if (!session.startedAt || !hostIdentifier) {
      throw new BadDataException(NO_LINES_MESSAGE);
    }

    // From when it was asked for to when it ended - now, while it runs - each by the device's clock's slack.
    const askedAt: Date = session.createdAt || session.startedAt;
    const over: Date =
      session.endedAt ||
      session.endsAt ||
      data.now ||
      OneUptimeDate.getCurrentDate();

    const query: Query<Log> = {
      projectId: new ObjectID(session.projectId.toString()),
      time: new InBetween<Date>(
        OneUptimeDate.addRemoveMinutes(
          askedAt,
          -LOG_SESSION_CLOCK_SLACK_MINUTES,
        ),
        OneUptimeDate.addRemoveMinutes(over, LOG_SESSION_CLOCK_SLACK_MINUTES),
      ),
      attributes: {
        "resource.host.name": hostIdentifier,
        [HOST_LOG_SESSION_ATTRIBUTE]: session._id.toString(),
      } as JSONObject,
    } as Query<Log>;

    const writer: HostLogSessionFileWriter = new HostLogSessionFileWriter({
      sessionId: session._id.toString(),
      deviceName:
        session.host?.name?.toString().trim() || hostIdentifier.toString(),
      requestedBy:
        session.createdByUser?.name?.toString().trim() ||
        session.createdByUser?.email?.toString().trim() ||
        undefined,
      requestedAt: session.createdAt,
      note: session.note || undefined,
      minimumLevel: session.minimumLevel,
    });

    for (let skip: number = 0; !writer.full; ) {
      const lines: Array<Log> = await LogService.findBy({
        query: query,
        select: {
          time: true,
          severityText: true,
          severityNumber: true,
          body: true,
          attributes: true,
        },
        sort: { time: SortOrder.Ascending },
        skip: skip,
        limit: LOG_SESSION_LINES_PAGE_SIZE,
        props: data.props,
      });

      for (const line of lines) {
        if (
          !writer.add({
            time: line.time,
            severityNumber: line.severityNumber,
            severityText: line.severityText,
            body: line.body,
            attributes: line.attributes as JSONObject | undefined,
          })
        ) {
          break;
        }
      }

      if (lines.length < LOG_SESSION_LINES_PAGE_SIZE) {
        break;
      }

      skip += lines.length;
    }

    /*
     * A file that filled up says how many lines the session has: counted
     * only then, with the same query and permissions.
     */
    const total: number | undefined = writer.full
      ? (
          (await LogService.countBy({
            query: query,
            props: data.props,
          })) as PositiveNumber
        ).toNumber()
      : undefined;

    return writer.finish({ totalLineCount: total });
  }
}
