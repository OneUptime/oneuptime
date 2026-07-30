import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/RumSessionPin";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/* Postgres unique_violation. https://www.postgresql.org/docs/current/errcodes-appendix.html */
const UNIQUE_VIOLATION: string = "23505";

type IsUniqueViolationFunction = (error: unknown) => boolean;

/*
 * TypeORM wraps driver failures in QueryFailedError, which hoists the pg
 * fields onto itself but also keeps the original under `driverError`.
 * Check both rather than assuming which one carries the code.
 */
const isUniqueViolation: IsUniqueViolationFunction = (
  error: unknown,
): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  if ((error as { code?: string | undefined }).code === UNIQUE_VIOLATION) {
    return true;
  }

  const driverError: unknown = (error as { driverError?: unknown }).driverError;

  return Boolean(
    driverError &&
      typeof driverError === "object" &&
      (driverError as { code?: string | undefined }).code === UNIQUE_VIOLATION,
  );
};

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

    /*
     * Assigned or removed, never left as the client sent it. pinnedByUserId
     * is declared `computed` on the model, which is what lets this
     * assignment survive the create-column permission check that runs after
     * this hook; the delete is what stops an API-key caller (no
     * props.userId) attributing the pin to a colleague.
     */
    if (createBy.props.userId) {
      createBy.data.pinnedByUserId = createBy.props.userId;
    } else {
      delete createBy.data.pinnedByUserId;
    }

    return { createBy, carryForward: null };
  }

  /*
   * Pinning is idempotent, which is the whole reason this override exists.
   * Clicking Pin twice, or pinning the same recording from two incidents,
   * hits the unique index on (projectId, rumApplicationId, sessionId) and
   * would otherwise surface as a raw 500 carrying a Postgres constraint
   * name: checkForUniqueValues only understands single-column `unique`
   * metadata, not a composite @Index, so nothing else catches it.
   *
   * The pre-check handles the common case and the catch closes the race
   * between two concurrent pins of the same session.
   */
  @CaptureSpan()
  public override async create(createBy: CreateBy<Model>): Promise<Model> {
    const projectId: ObjectID | undefined = createBy.data.projectId;
    const rumApplicationId: ObjectID | undefined =
      createBy.data.rumApplicationId;
    const sessionId: string | undefined = createBy.data.sessionId;

    if (!projectId || !rumApplicationId || !sessionId) {
      /* Let onBeforeCreate produce the specific validation message. */
      return await super.create(createBy);
    }

    const existingPin: Model | null = await this.getPinForSession({
      projectId: projectId,
      rumApplicationId: rumApplicationId,
      sessionId: sessionId,
    });

    if (existingPin) {
      return existingPin;
    }

    try {
      return await super.create(createBy);
    } catch (err) {
      if (!isUniqueViolation(err)) {
        throw err;
      }

      const racedPin: Model | null = await this.getPinForSession({
        projectId: projectId,
        rumApplicationId: rumApplicationId,
        sessionId: sessionId,
      });

      if (racedPin) {
        return racedPin;
      }

      throw err;
    }
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
