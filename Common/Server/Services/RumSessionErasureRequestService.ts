import DatabaseService from "./DatabaseService";
import Model, {
  RumSessionErasureRequestStatus,
  RumSessionErasureRequestType,
} from "../../Models/DatabaseModels/RumSessionErasureRequest";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * Session replay erasure requests.
 *
 * The service owns the two invariants the model cannot express on its
 * own: a request is always born Pending with zeroed counters no matter
 * what the client sent, and a request must actually be actionable by the
 * worker before it is accepted. A request that is accepted but can never
 * be executed is worse than a rejected one - the requester believes their
 * data is gone.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const requestType: RumSessionErasureRequestType | undefined =
      createBy.data.requestType;

    if (!requestType) {
      throw new BadDataException(
        "requestType is required on a session replay erasure request.",
      );
    }

    /*
     * Validated here rather than only in the UI because the worker cannot
     * do anything sensible with a request whose target is missing, and it
     * would sit Pending forever looking like an erasure in progress.
     */
    if (requestType === RumSessionErasureRequestType.ByDateRange) {
      if (!createBy.data.startDate || !createBy.data.endDate) {
        throw new BadDataException(
          "startDate and endDate are required for a ByDateRange erasure request.",
        );
      }

      if (
        OneUptimeDate.isAfter(createBy.data.startDate, createBy.data.endDate)
      ) {
        throw new BadDataException(
          "startDate must not be after endDate on a ByDateRange erasure request.",
        );
      }
    } else if (!createBy.data.targetValue) {
      throw new BadDataException(
        `targetValue is required for a ${requestType} erasure request.`,
      );
    }

    /*
     * A ByRumApplication request stores the application id in targetValue
     * as well as in the relation, because rumApplicationId is nulled out
     * (not cascaded) when the application is deleted - which is precisely
     * when the erasure still needs to run.
     */
    if (
      requestType === RumSessionErasureRequestType.ByRumApplication &&
      createBy.data.rumApplicationId &&
      !createBy.data.targetValue
    ) {
      createBy.data.targetValue = createBy.data.rumApplicationId.toString();
    }

    createBy.data.status = RumSessionErasureRequestStatus.Pending;
    createBy.data.requestedAt = OneUptimeDate.getCurrentDate();
    createBy.data.sessionsDeleted = 0;
    createBy.data.chunksDeleted = 0;

    if (createBy.props.userId) {
      createBy.data.requestedByUserId = createBy.props.userId;
    }

    return { createBy, carryForward: null };
  }

  /*
   * Outstanding requests for the erasure worker, oldest first so a
   * request cannot be starved by newer ones.
   */
  @CaptureSpan()
  public async getPendingRequests(data: {
    limit: number;
  }): Promise<Array<Model>> {
    return await this.findBy({
      query: {
        status: RumSessionErasureRequestStatus.Pending,
      },
      select: {
        _id: true,
        projectId: true,
        rumApplicationId: true,
        requestType: true,
        targetValue: true,
        startDate: true,
        endDate: true,
        requestedAt: true,
      },
      sort: {
        requestedAt: SortOrder.Ascending,
      },
      skip: 0,
      limit: data.limit,
      props: { isRoot: true },
    });
  }

  @CaptureSpan()
  public async markInProgress(data: { requestId: ObjectID }): Promise<void> {
    await this.updateOneById({
      id: data.requestId,
      data: {
        status: RumSessionErasureRequestStatus.InProgress,
      },
      props: { isRoot: true },
    });
  }

  @CaptureSpan()
  public async markCompleted(data: {
    requestId: ObjectID;
    sessionsDeleted: number;
    chunksDeleted: number;
  }): Promise<void> {
    await this.updateOneById({
      id: data.requestId,
      data: {
        status: RumSessionErasureRequestStatus.Completed,
        completedAt: OneUptimeDate.getCurrentDate(),
        sessionsDeleted: data.sessionsDeleted,
        chunksDeleted: data.chunksDeleted,
      },
      props: { isRoot: true },
    });
  }

  /*
   * completedAt is set on failure too. It means "the attempt finished",
   * not "the data is gone" - status is what says whether it worked, and
   * leaving completedAt null would make a failed request indistinguishable
   * from one still running.
   */
  @CaptureSpan()
  public async markFailed(data: {
    requestId: ObjectID;
    failureReason: string;
  }): Promise<void> {
    await this.updateOneById({
      id: data.requestId,
      data: {
        status: RumSessionErasureRequestStatus.Failed,
        completedAt: OneUptimeDate.getCurrentDate(),
        failureReason: data.failureReason,
      },
      props: { isRoot: true },
    });
  }
}

export default new Service();
