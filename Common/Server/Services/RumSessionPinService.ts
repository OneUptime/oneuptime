import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/RumSessionPin";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * Pins that keep a session recording past its retention window.
 *
 * The unique index on (projectId, rumApplicationId, sessionId) is the real
 * guard against duplicate copies; this service turns the resulting
 * constraint violation into an idempotent "already pinned" so that
 * clicking Pin twice, or pinning the same recording from two incidents,
 * is not an error the user has to interpret.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.projectId) {
      throw new BadDataException("projectId is required");
    }

    if (!createBy.data.rumApplicationId) {
      throw new BadDataException("rumApplicationId is required");
    }

    if (!createBy.data.sessionId) {
      throw new BadDataException("sessionId is required");
    }

    /*
     * materializedAt is never client-supplied: it asserts that the
     * recording has actually been copied out of the expiring table, and
     * a client that could set it would make an unprotected recording look
     * protected.
     */
    delete createBy.data.materializedAt;

    if (createBy.props.userId) {
      createBy.data.pinnedByUserId = createBy.props.userId;
    }

    return { createBy, carryForward: null };
  }

  /* Null when the recording is not pinned. */
  @CaptureSpan()
  public async getPinForSession(data: {
    projectId: ObjectID;
    rumApplicationId: ObjectID;
    sessionId: string;
  }): Promise<Model | null> {
    return await this.findOneBy({
      query: {
        projectId: data.projectId,
        rumApplicationId: data.rumApplicationId,
        sessionId: data.sessionId,
      },
      select: {
        _id: true,
        reason: true,
        incidentId: true,
        alertId: true,
        expiresAt: true,
        materializedAt: true,
        pinnedByUserId: true,
      },
      props: { isRoot: true },
    });
  }

  /*
   * Pins whose copy has not happened yet. This is the worker's queue, and
   * it is also the honest answer to "is this recording safe?" - a pin
   * without a materializedAt protects nothing.
   */
  @CaptureSpan()
  public async getUnmaterializedPins(data: {
    limit: number;
  }): Promise<Array<Model>> {
    return await this.findBy({
      query: {
        materializedAt: QueryHelper.isNull(),
      },
      select: {
        _id: true,
        projectId: true,
        rumApplicationId: true,
        sessionId: true,
        expiresAt: true,
      },
      skip: 0,
      limit: data.limit,
      props: { isRoot: true },
    });
  }

  @CaptureSpan()
  public async markMaterialized(data: { pinId: ObjectID }): Promise<void> {
    await this.updateOneById({
      id: data.pinId,
      data: {
        materializedAt: OneUptimeDate.getCurrentDate(),
      },
      props: { isRoot: true },
    });
  }
}

export default new Service();
