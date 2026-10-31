import TelemetryException from "../../Models/DatabaseModels/TelemetryException";
import Model, {
  TelemetryExceptionActivityType,
} from "../../Models/DatabaseModels/TelemetryExceptionActivity";
import Includes from "../../Types/BaseDatabase/Includes";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import CountBy from "../Types/Database/CountBy";
import FindBy from "../Types/Database/FindBy";
import { OnFind } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import FeedApiKeyActorUtil, {
  FeedApiKeyActor,
} from "../Utils/Feed/FeedApiKeyActor";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ProjectReferencesService from "./ProjectReferencesService";
import TelemetryExceptionService from "./TelemetryExceptionService";

// The most exceptions one read of activity may name.
export const MAX_EXCEPTIONS_READ_AT_ONCE: number = 100;

// No exception has this id: a read narrowed to it reads nothing.
const NO_EXCEPTION_ID: string = "00000000-0000-0000-0000-000000000000";

// One entry, as the code that saw the change hands it over.
export interface TelemetryExceptionActivityEntry {
  projectId: ObjectID;
  telemetryExceptionId: ObjectID;
  activityType: TelemetryExceptionActivityType;
  assigneeUserId?: ObjectID | string | null | undefined;
  assigneeTeamId?: ObjectID | string | null | undefined;
  relatedTelemetryExceptionId?: ObjectID | string | null | undefined;
  release?: string | null | undefined;
}

// Who made a change: a person, an API key, or - neither - OneUptime.
export interface TelemetryExceptionActivityActor {
  userId?: ObjectID | undefined;
  apiKeyName?: string | undefined;
}

function toObjectID(
  value: ObjectID | string | null | undefined,
): ObjectID | undefined {
  if (!value) {
    return undefined;
  }

  if (value instanceof ObjectID) {
    return value;
  }

  return ObjectID.isValidUUID(value) ? new ObjectID(value) : undefined;
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Entries are written by OneUptime as things happen to an exception,
   * crediting whoever did them - someone who may have left the project
   * since. Refusing one of those would only lose the record (the feeds do
   * the same).
   */
  protected override checksServerWrites(): boolean {
    return false;
  }

  /*
   * Who made the change the props carry: the person, else the project API
   * key (by the name it has now, kept as it was), else OneUptime.
   */
  public getActor(
    props: DatabaseCommonInteractionProps | null | undefined,
  ): TelemetryExceptionActivityActor {
    if (props?.userId) {
      return { userId: props.userId };
    }

    const apiKey: FeedApiKeyActor = FeedApiKeyActorUtil.fromProps(props);

    return apiKey.apiKeyName ? { apiKeyName: apiKey.apiKeyName } : {};
  }

  /*
   * Writes the entries, as OneUptime. Never throws: the change they record
   * has landed already, and must not fail because its entry could not be
   * written, so a failure is logged and the rest are still written.
   */
  @CaptureSpan()
  public async record(data: {
    entries: Array<TelemetryExceptionActivityEntry>;
    actor: TelemetryExceptionActivityActor;
  }): Promise<number> {
    let written: number = 0;

    for (const entry of data.entries) {
      try {
        const item: Model = new Model();
        item.projectId = entry.projectId;
        item.telemetryExceptionId = entry.telemetryExceptionId;
        item.activityType = entry.activityType;

        if (data.actor.userId) {
          item.userId = data.actor.userId;
        } else if (data.actor.apiKeyName) {
          item.apiKeyName = data.actor.apiKeyName;
        }

        const assigneeUserId: ObjectID | undefined = toObjectID(
          entry.assigneeUserId,
        );
        const assigneeTeamId: ObjectID | undefined = toObjectID(
          entry.assigneeTeamId,
        );
        const relatedId: ObjectID | undefined = toObjectID(
          entry.relatedTelemetryExceptionId,
        );

        if (assigneeUserId) {
          item.assigneeUserId = assigneeUserId;
        }

        if (assigneeTeamId) {
          item.assigneeTeamId = assigneeTeamId;
        }

        if (relatedId) {
          item.relatedTelemetryExceptionId = relatedId;
        }

        if (entry.release && entry.release.trim()) {
          item.release = entry.release.trim();
        }

        await this.create({
          data: item,
          props: {
            isRoot: true,
          },
        });

        written++;
      } catch (error) {
        logger.error(
          `TelemetryExceptionActivityService: could not record ${entry.activityType} on exception ${entry.telemetryExceptionId.toString()}:`,
        );
        logger.error(error);
      }
    }

    return written;
  }

  /*
   * AN EXCEPTION'S ACTIVITY IS READ AS THE EXCEPTION IS.
   *
   * A read names the exceptions whose activity it reads (telemetryExceptionId:
   * an id, or a list of at most MAX_EXCEPTIONS_READ_AT_ONCE) or one entry by
   * its id, and is kept to the exceptions among them the caller may read -
   * asked of TelemetryExceptionService as the caller, so the scope every read
   * of exceptions follows (the table's permission, the project, the
   * resources whose exceptions they may read) decides it, and the timeline
   * can never show more than the exception itself. A read that names neither
   * is refused. Root and master admins read as asked.
   */
  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = await this.keepToReadableExceptions(
      findBy.query,
      findBy.props,
    );

    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = await this.keepToReadableExceptions(
      countBy.query,
      countBy.props,
    );

    return super.countBy(countBy);
  }

  /*
   * The ids a query names in a column - an id, an ObjectID, a list, an
   * Includes - or null when it names them some other way (or not at all).
   */
  public static readNamedIds(value: unknown): Array<string> | null {
    if (value === undefined || value === null) {
      return null;
    }

    const values: Array<unknown> =
      value instanceof Includes
        ? (value.values as Array<unknown>)
        : Array.isArray(value)
          ? value
          : [value];

    const ids: Array<string> = [];

    for (const entry of values) {
      const text: string =
        entry instanceof ObjectID
          ? entry.toString()
          : typeof entry === "string"
            ? entry
            : "";

      if (!ObjectID.isValidUUID(text)) {
        return null;
      }

      if (!ids.includes(text.toLowerCase())) {
        ids.push(text.toLowerCase());
      }
    }

    return ids.length > 0 ? ids : null;
  }

  public async keepToReadableExceptions<TQuery>(
    query: TQuery,
    props: DatabaseCommonInteractionProps,
  ): Promise<TQuery> {
    if (props.isRoot || props.isMasterAdmin) {
      return query;
    }

    const record: Record<string, unknown> = {
      ...((query || {}) as Record<string, unknown>),
    };

    let exceptionIds: Array<string> | null = Service.readNamedIds(
      record["telemetryExceptionId"],
    );

    // One entry by its id: the exception it is on.
    if (!exceptionIds && record["telemetryExceptionId"] === undefined) {
      const entryIds: Array<string> | null = Service.readNamedIds(
        record["_id"],
      );

      if (entryIds && entryIds.length === 1) {
        const entry: Model | null = await this.findOneBy({
          query: { _id: entryIds[0]! },
          select: { telemetryExceptionId: true },
          props: { isRoot: true },
        });

        exceptionIds = entry?.telemetryExceptionId
          ? [entry.telemetryExceptionId.toString().toLowerCase()]
          : [NO_EXCEPTION_ID];
      }
    }

    if (!exceptionIds) {
      throw new BadDataException(
        "Name the exception whose activity to read: telemetryExceptionId, one id or a list of ids.",
      );
    }

    if (exceptionIds.length > MAX_EXCEPTIONS_READ_AT_ONCE) {
      throw new BadDataException(
        `Read the activity of at most ${MAX_EXCEPTIONS_READ_AT_ONCE} exceptions at once.`,
      );
    }

    // Read as the caller: a caller who may not read exceptions is refused here.
    const readable: Array<TelemetryException> =
      await TelemetryExceptionService.findBy({
        query: {
          _id: QueryHelper.any(exceptionIds),
        },
        select: {
          _id: true,
        },
        limit: exceptionIds.length,
        skip: 0,
        props: props,
      });

    const readableIds: Array<string> = readable
      .map((exception: TelemetryException): string => {
        return exception.id?.toString().toLowerCase() || "";
      })
      .filter((id: string): boolean => {
        return exceptionIds!.includes(id);
      });

    record["telemetryExceptionId"] =
      readableIds.length === 1
        ? readableIds[0]
        : QueryHelper.any(
            readableIds.length > 0 ? readableIds : [NO_EXCEPTION_ID],
          );

    return record as unknown as TQuery;
  }
}

export default new Service();
