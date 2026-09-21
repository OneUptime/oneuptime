import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/RumSessionPin";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import Exception from "../../Types/Exception/Exception";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import CreatePermission from "../Types/Database/Permissions/CreatePermission";
import ReadPermission from "../Types/Database/Permissions/ReadPermission";
import TablePermission from "../Types/Database/Permissions/TablePermission";
import QueryHelper from "../Types/Database/QueryHelper";
import PostgresErrorTranslator from "../Utils/Database/PostgresErrorTranslator";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

type IsUniqueViolationFunction = (error: unknown) => boolean;

/*
 * Detection lives in PostgresErrorTranslator because DatabaseService.create
 * runs every failure through it before rethrowing, so what lands in the catch
 * below is a BadDataException carrying the SQLSTATE — not the raw
 * QueryFailedError. A local `code === "23505"` check would silently stop
 * matching and take the race recovery with it.
 */
const isUniqueViolation: IsUniqueViolationFunction = (
  error: unknown,
): boolean => {
  return PostgresErrorTranslator.isUniqueViolation(error);
};

/* What the unique index keys a pin on. */
interface PinKey {
  projectId: ObjectID;
  rumApplicationId: ObjectID;
  sessionId: string;
}

type IsSameIdFunction = (a: ObjectID, b: ObjectID) => boolean;

/*
 * ObjectID.equals compares the strings as given, but a UUID is the same
 * project in any case - and the tenant an API key resolves to comes back
 * from Postgres in lower case whatever the client typed.
 */
const isSameId: IsSameIdFunction = (a: ObjectID, b: ObjectID): boolean => {
  return a.toString().toLowerCase() === b.toString().toLowerCase();
};

type ToPlainIdFunction = (
  value: unknown,
  field: string,
) => ObjectID | undefined;

/*
 * An id from the request body as a plain ObjectID. The body is deserialized
 * generically, so a field typed as an id can arrive as some other object.
 */
const toPlainId: ToPlainIdFunction = (
  value: unknown,
  field: string,
): ObjectID | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (value instanceof ObjectID || typeof value === "string") {
    const id: string = value.toString();

    if (ObjectID.isValidUUID(id)) {
      return new ObjectID(id);
    }
  }

  throw new BadDataException(`${field} must be an ID.`);
};

type IsInternalCallerFunction = (
  props: DatabaseCommonInteractionProps,
) => boolean;

const isInternalCaller: IsInternalCallerFunction = (
  props: DatabaseCommonInteractionProps,
): boolean => {
  return Boolean(props.isRoot || props.isMasterAdmin);
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
   *
   * Both lookups read as root, so neither may run until the caller has
   * passed the create check that super.create would otherwise have been the
   * first to apply, and what they find is handed back only as far as the
   * caller could have read it.
   */
  @CaptureSpan()
  public override async create(createBy: CreateBy<Model>): Promise<Model> {
    this.assertCallerMayCreatePins(createBy.props);

    if (!isInternalCaller(createBy.props)) {
      /*
       * The database keeps these for itself; a request does not set them.
       *
       * Cleared rather than deleted: `createBy.data` is a live model instance,
       * and the column-metadata lookups downstream used to enumerate the own
       * keys of whichever instance reached them first and cache that as the
       * CLASS's column list - so deleting `_id` off this instance taught the
       * whole process that RumSessionPin has no id, and every later response
       * for it lost one. TableColumn.ts no longer reads the caller's instance
       * (see CanonicalModelInstance.ts), so this is defence in depth. An
       * unset column holds `undefined` anyway, which TypeORM and the write
       * path treat exactly as an absent key - the save is still an INSERT.
       */
      const databaseManagedColumns: Array<string> = [
        "_id",
        "createdAt",
        "updatedAt",
        "deletedAt",
        "version",
      ];

      for (const columnName of databaseManagedColumns) {
        (createBy.data as unknown as Record<string, unknown>)[columnName] =
          undefined;
      }
    }

    const pinKey: PinKey | null = this.resolvePinKey(createBy);

    if (!pinKey) {
      /* Let onBeforeCreate produce the specific validation message. */
      return await super.create(createBy);
    }

    const existingPin: Model | null = await this.getPinForSession(pinKey);

    if (existingPin) {
      return await this.presentExistingPin(existingPin, pinKey, createBy.props);
    }

    try {
      return await super.create(createBy);
    } catch (err) {
      if (!isUniqueViolation(err)) {
        throw err;
      }

      const racedPin: Model | null = await this.getPinForSession(pinKey);

      if (racedPin) {
        return await this.presentExistingPin(racedPin, pinKey, createBy.props);
      }

      throw err;
    }
  }

  /*
   * The table half of ModelPermission.checkCreatePermissions: signed in or
   * holding an API key, and granted something on the model's create list in
   * the tenant. The column half stays with super.create, which runs it after
   * onBeforeCreate has stripped the fields it rewrites; the idempotent path
   * writes no columns for it to judge.
   */
  private assertCallerMayCreatePins(
    props: DatabaseCommonInteractionProps,
  ): void {
    if (isInternalCaller(props)) {
      return;
    }

    CreatePermission.checkCreateBlockPermissions(Model, props);

    TablePermission.checkTableLevelPermissions(
      Model,
      props,
      DatabaseRequestType.Create,
    );
  }

  /*
   * The (projectId, rumApplicationId, sessionId) this request would insert,
   * which is therefore what both lookups must search - or null when a part
   * is missing, so that onBeforeCreate can say which. The lookups are
   * queries, so every part has to be a plain id or string.
   *
   * projectId is the one super.create will write: the caller's tenant when
   * there is one, otherwise the projectId an internal caller passed. A
   * request naming any other project is refused, because the caller's
   * grants were checked in the tenant and nowhere else; internal callers
   * keep DatabaseService's rule that the tenant replaces it.
   *
   * The project and the application can also be named through the `project`
   * and `rumApplication` relations. Each shares its scalar's column and wins
   * over it when TypeORM saves, so a relation that disagrees is refused and
   * both are dropped, leaving the scalars as the only thing saved.
   */
  private resolvePinKey(createBy: CreateBy<Model>): PinKey | null {
    const props: DatabaseCommonInteractionProps = createBy.props;
    const isInternal: boolean = isInternalCaller(props);

    const claimedProjectId: ObjectID | undefined = toPlainId(
      createBy.data.projectId,
      "projectId",
    );
    const rumApplicationId: ObjectID | undefined = toPlainId(
      createBy.data.rumApplicationId,
      "rumApplicationId",
    );

    const rawSessionId: unknown = createBy.data.sessionId;

    if (
      rawSessionId !== undefined &&
      rawSessionId !== null &&
      typeof rawSessionId !== "string"
    ) {
      throw new BadDataException("sessionId must be a string.");
    }

    const sessionId: string | undefined =
      typeof rawSessionId === "string" ? rawSessionId : undefined;

    const projectRelationId: ObjectID | undefined = toPlainId(
      createBy.data.project?._id,
      "project",
    );
    const applicationRelationId: ObjectID | undefined = toPlainId(
      createBy.data.rumApplication?._id,
      "rumApplication",
    );

    delete createBy.data.project;
    delete createBy.data.rumApplication;

    const projectId: ObjectID | undefined = isInternal
      ? props.tenantId || claimedProjectId
      : props.tenantId;

    const projectClaims: Array<ObjectID> = [];

    if (projectRelationId) {
      projectClaims.push(projectRelationId);
    }

    if (claimedProjectId && !isInternal) {
      projectClaims.push(claimedProjectId);
    }

    for (const projectClaim of projectClaims) {
      if (!projectId || !isSameId(projectClaim, projectId)) {
        throw isInternal
          ? new BadDataException("project does not match projectId.")
          : new NotAuthorizedException(
              "You are not authorized to pin recordings in this project.",
            );
      }
    }

    if (
      applicationRelationId &&
      !(rumApplicationId && isSameId(applicationRelationId, rumApplicationId))
    ) {
      throw new BadDataException(
        "rumApplication does not match rumApplicationId.",
      );
    }

    if (!claimedProjectId || !projectId || !rumApplicationId || !sessionId) {
      return null;
    }

    createBy.data.projectId = projectId;
    createBy.data.rumApplicationId = rumApplicationId;

    return {
      projectId: projectId,
      rumApplicationId: rumApplicationId,
      sessionId: sessionId,
    };
  }

  /*
   * An existing pin was read as root, and passing the create check says
   * nothing about reading it: CreateRumSessionReplay, the ingest grant, is
   * on the create list but not the read list, and a team can block reads
   * alone. Such a caller learns that the recording is pinned, which is all
   * pinning it again needs, and nothing that somebody else wrote on the pin.
   */
  private async presentExistingPin(
    pin: Model,
    pinKey: PinKey,
    props: DatabaseCommonInteractionProps,
  ): Promise<Model> {
    if (await this.callerMayReadPins(props)) {
      return pin;
    }

    /*
     * Not even the pin's id: it is what the update and delete endpoints
     * take, and this caller could not have listed it.
     */
    const acknowledgement: Model = new Model();
    acknowledgement.projectId = pinKey.projectId;
    acknowledgement.rumApplicationId = pinKey.rumApplicationId;
    acknowledgement.sessionId = pinKey.sessionId;

    return acknowledgement;
  }

  /*
   * The gates a read of this table applies, answered instead of thrown: the
   * read block list (label-scoped blocks included, which this model cannot
   * narrow to rows and so refuses outright) and the read list itself. Any
   * refusal, whatever its type, means the caller does not get the pin.
   */
  private async callerMayReadPins(
    props: DatabaseCommonInteractionProps,
  ): Promise<boolean> {
    if (isInternalCaller(props)) {
      return true;
    }

    try {
      await ReadPermission.checkReadBlockPermission(Model, {}, props);

      TablePermission.checkTableLevelPermissions(
        Model,
        props,
        DatabaseRequestType.Read,
      );
    } catch (err) {
      if (err instanceof Exception) {
        return false;
      }

      throw err;
    }

    return true;
  }

  /* Null when the recording is not pinned. */
  @CaptureSpan()
  public async getPinForSession(data: PinKey): Promise<Model | null> {
    return await this.findOneBy({
      query: {
        projectId: data.projectId,
        rumApplicationId: data.rumApplicationId,
        sessionId: data.sessionId,
      },
      select: {
        _id: true,
        projectId: true,
        rumApplicationId: true,
        sessionId: true,
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
