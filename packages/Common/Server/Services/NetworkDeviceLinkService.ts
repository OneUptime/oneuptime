import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/NetworkDeviceLink";
import NetworkDeviceService from "./NetworkDeviceService";
import NetworkDevice from "../../Models/DatabaseModels/NetworkDevice";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import Query from "../Types/Database/Query";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";

// Both spellings of each end, for the same reason RelationIdUtil exists.
const FROM_DEVICE_KEYS: Array<string> = ["fromDeviceId", "fromDevice"];
const TO_DEVICE_KEYS: Array<string> = ["toDeviceId", "toDevice"];
const PARENT_DEVICE_KEYS: Array<string> = ["parentDeviceId", "parentDevice"];

/*
 * A device id, compared the way Postgres compares it.
 *
 * These columns are `uuid`. Postgres normalises and matches them without
 * regard to case, and ObjectID.isValidUUID accepts either case, so an API
 * client may legitimately send `AAAAAAAA-...` for a row stored as
 * `aaaaaaaa-...`. A raw JS !== between the two says "different device" and
 * refuses a parent that is in fact an end of the link. Note that the
 * device-existence check below cannot disagree: it runs in Postgres.
 */
const sameDeviceId: (a: ObjectID, b: ObjectID) => boolean = (
  a: ObjectID,
  b: ObjectID,
): boolean => {
  return a.toString().toLowerCase() === b.toString().toLowerCase();
};

/*
 * A declared parent has to be one of the two devices the link connects.
 * Anything else is not a statement about this link at all, and the map
 * would silently ignore it — the operator would have declared a hierarchy
 * and watched nothing change.
 */
const assertParentIsAnEnd: (
  parentDeviceId: ObjectID | null,
  fromDeviceId: ObjectID,
  toDeviceId: ObjectID,
) => void = (
  parentDeviceId: ObjectID | null,
  fromDeviceId: ObjectID,
  toDeviceId: ObjectID,
): void => {
  if (!parentDeviceId) {
    return;
  }
  if (
    !sameDeviceId(parentDeviceId, fromDeviceId) &&
    !sameDeviceId(parentDeviceId, toDeviceId)
  ) {
    throw new BadDataException(
      "The parent device must be one of the two devices this link connects.",
    );
  }
};

/*
 * Which of `keys` the payload actually WRITES.
 *
 * Not the same question as which keys are present. TypeORM drops
 * undefined-valued keys before it builds the SET list — "it doesn't make
 * sense to update undefined properties" — so a key holding undefined
 * changes nothing in the database. Treating it as a write makes this hook
 * validate a row that is never going to exist: model the parent as
 * cleared, accept the write, and leave the stored parent stranded on a
 * link whose end just moved. Null and "" are different and really do
 * clear the column, which is why the test is against undefined alone.
 */
const writtenKeys: (
  data: Record<string, unknown>,
  keys: Array<string>,
) => Array<string> = (
  data: Record<string, unknown>,
  keys: Array<string>,
): Array<string> => {
  return keys.filter((key: string) => {
    return key in data && data[key] !== undefined;
  });
};

/*
 * An update payload is a QueryDeepPartialEntity, so a column may hold a
 * raw SQL-expression function instead of a value. RelationIdUtil reads one
 * as null — indistinguishable from "cleared" — and the whole invariant is
 * then checked against a row that bears no relation to what will be
 * written. Nothing in the tree writes this model that way today; refusing
 * is what keeps that true, and a caller who needs it can resolve the id
 * before calling rather than have it silently mis-validated.
 */
const assertNoSqlExpression: (
  data: Record<string, unknown>,
  keys: Array<string>,
) => void = (data: Record<string, unknown>, keys: Array<string>): void => {
  for (const key of keys) {
    if (typeof data[key] === "function") {
      throw new BadDataException(
        `${key} cannot be set to a raw SQL expression on a network device link — the link's ends and its declared parent have to be checked against each other, which needs actual ids.`,
      );
    }
  }
};

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * onBeforeUpdate runs before DatabaseService permission-checks the query,
   * so reading the raw client query as root would hand the hook rows from
   * other projects. Re-apply the caller's tenant here. (Same helper as
   * NetworkDeviceService and NetworkSiteService — private per service,
   * which is the shape the codebase already settled on.)
   */
  private scopeQueryToCallerTenant(
    query: Query<Model>,
    props: DatabaseCommonInteractionProps,
  ): Query<Model> {
    if (props.isRoot || !props.tenantId) {
      return query;
    }

    return {
      ...query,
      projectId: props.tenantId,
    };
  }

  /*
   * Two guards, both about links that would be nonsense on the map:
   *
   *   - a device may not link to itself. The topology builder drops
   *     self-edges anyway (the same rule LLDP self-reports hit), so such a
   *     row would be invisible and permanently confusing.
   *   - both ends must belong to the creating project. The FKs only require
   *     the rows to exist, so without this a tenant could draw a line to
   *     another project's device and read its name off the map.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const data: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;

    assertNoSqlExpression(data, [
      ...FROM_DEVICE_KEYS,
      ...TO_DEVICE_KEYS,
      ...PARENT_DEVICE_KEYS,
    ]);

    const fromDeviceId: ObjectID | null = RelationIdUtil.read(
      data,
      FROM_DEVICE_KEYS,
    );
    const toDeviceId: ObjectID | null = RelationIdUtil.read(
      data,
      TO_DEVICE_KEYS,
    );

    if (!fromDeviceId || !toDeviceId) {
      throw new BadDataException("A link needs a device at each end.");
    }

    if (sameDeviceId(fromDeviceId, toDeviceId)) {
      throw new BadDataException("A device cannot be linked to itself.");
    }

    if (!createBy.data.projectId) {
      throw new BadDataException("Project ID is required.");
    }

    const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
      query: {
        _id: QueryHelper.any([fromDeviceId.toString(), toDeviceId.toString()]),
        projectId: createBy.data.projectId,
      },
      select: { _id: true },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    if (devices.length !== 2) {
      throw new BadDataException(
        "Both devices must exist and belong to this project.",
      );
    }

    assertParentIsAnEnd(
      RelationIdUtil.read(data, PARENT_DEVICE_KEYS),
      fromDeviceId,
      toDeviceId,
    );

    return { createBy, carryForward: null };
  }

  /*
   * The same invariant, on the other write path.
   *
   * An update can break it two ways, and only one of them is obvious. The
   * obvious one is setting a parent that is not on the link. The other is
   * moving an END: re-point `toDevice` at a different switch and a parent
   * that was valid a moment ago now names a device the link no longer
   * touches. So the post-update state is what gets checked, assembled from
   * the payload where it says something and from the stored row where it
   * does not.
   *
   * An update matches a QUERY, not one row, and each matched row may have
   * different ends — so every one of them is validated, and one bad row
   * rejects the whole write. That is the conservative direction: a partial
   * update that fixed some rows and left others contradicting themselves
   * would be far harder to notice than a refusal.
   *
   * It also re-runs onBeforeCreate's TENANCY check on any end that moves.
   * That check used to exist only on create, which left the update path
   * able to re-point an end at another project's device — the exact threat
   * onBeforeCreate's own comment describes, since the FK is global and the
   * column is member-writable.
   *
   * Only costs a read when the payload touches an end or the parent at all;
   * an update of ports or the bound monitor takes the early return.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const data: Record<string, unknown> = (updateBy.data ||
      {}) as unknown as Record<string, unknown>;

    const hierarchyKeys: Array<string> = [
      ...FROM_DEVICE_KEYS,
      ...TO_DEVICE_KEYS,
      ...PARENT_DEVICE_KEYS,
    ];

    if (writtenKeys(data, hierarchyKeys).length === 0) {
      return { updateBy, carryForward: null };
    }

    assertNoSqlExpression(data, hierarchyKeys);

    const writtenFromDeviceId: ObjectID | null = RelationIdUtil.read(
      data,
      FROM_DEVICE_KEYS,
    );
    const writtenToDeviceId: ObjectID | null = RelationIdUtil.read(
      data,
      TO_DEVICE_KEYS,
    );
    const writtenParentDeviceId: ObjectID | null = RelationIdUtil.read(
      data,
      PARENT_DEVICE_KEYS,
    );

    /*
     * Writing the parent key with an empty value is how a hierarchy is
     * cleared back to a peer link. RelationIdUtil reads that as null, which
     * is indistinguishable from "not written" — so the presence of the key
     * (with a value that will actually be written; see writtenKeys), not
     * the truthiness of its value, is what decides whether the stored
     * parent still applies.
     */
    const isParentWritten: boolean =
      writtenKeys(data, PARENT_DEVICE_KEYS).length > 0;

    const existingLinks: Array<Model> = await this.findBy({
      query: this.scopeQueryToCallerTenant(updateBy.query, updateBy.props),
      select: {
        _id: true,
        projectId: true,
        fromDeviceId: true,
        toDeviceId: true,
        parentDeviceId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    /*
     * An end that MOVED has to be re-checked for tenancy, exactly as
     * onBeforeCreate checks it. The FK only requires the device row to
     * exist — it is global — so without this a project member could
     * re-point an end of their own link at another project's device and
     * read its name straight off the map, which is the threat
     * onBeforeCreate's own comment describes. The declared parent inherits
     * the check for free: it has to be one of the two ends.
     *
     * Grouped by project because an update may in principle match links in
     * more than one, and a device is only legitimate within its own.
     */
    /*
     * Deduped: writing the same id to both ends is a self-link, and that
     * has its own error below — it must not surface as "device not found".
     */
    const movedEndIds: Array<string> = [
      ...new Set<string>(
        [writtenFromDeviceId, writtenToDeviceId]
          .filter((id: ObjectID | null): id is ObjectID => {
            return Boolean(id);
          })
          .map((id: ObjectID) => {
            return id.toString();
          }),
      ),
    ];

    if (movedEndIds.length > 0 && existingLinks.length > 0) {
      /*
       * Every project this write touches: the caller's own tenant, plus
       * the project of each row the query matched (a root caller has no
       * tenant, and only root can match rows across more than one). The
       * new end has to be legitimate in all of them.
       *
       * Guarded on there being matched rows at all: a query that matched
       * nothing writes nothing, and there is no link for a foreign device
       * to end up attached to.
       */
      const projectIds: Set<string> = new Set<string>();
      if (updateBy.props.tenantId) {
        projectIds.add(updateBy.props.tenantId.toString());
      }
      for (const link of existingLinks) {
        if (link.projectId) {
          projectIds.add(link.projectId.toString());
        }
      }

      /*
       * Fail closed. No project to check against and an end on the move
       * is not a safe update to wave through — it is the one shape where
       * a device from anywhere could be attached to this link.
       */
      if (projectIds.size === 0) {
        throw new BadDataException(
          "Both devices must exist and belong to this project.",
        );
      }

      for (const projectId of projectIds) {
        const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy(
          {
            query: {
              _id: QueryHelper.any(movedEndIds),
              projectId: new ObjectID(projectId),
            },
            select: { _id: true },
            limit: LIMIT_MAX,
            skip: 0,
            props: { isRoot: true },
          },
        );

        /*
         * Compared as a SET of ids rather than as a count. A count says
         * "as many rows came back as I asked about", which a duplicate row
         * satisfies just as well as the right rows do — and this is the
         * check standing between one project's map and another project's
         * device names, so it should be answering the actual question.
         */
        const foundIds: Set<string> = new Set<string>(
          devices.map((device: NetworkDevice) => {
            return (device.id || device._id || "").toString().toLowerCase();
          }),
        );

        const isMissingAnEnd: boolean = movedEndIds.some((id: string) => {
          return !foundIds.has(id.toLowerCase());
        });

        if (isMissingAnEnd) {
          throw new BadDataException(
            "Both devices must exist and belong to this project.",
          );
        }
      }
    }

    for (const link of existingLinks) {
      const fromDeviceId: ObjectID | undefined =
        writtenFromDeviceId || link.fromDeviceId;
      const toDeviceId: ObjectID | undefined =
        writtenToDeviceId || link.toDeviceId;
      const parentDeviceId: ObjectID | null = isParentWritten
        ? writtenParentDeviceId
        : link.parentDeviceId || null;

      // A row mid-migration with a missing end has no invariant to check.
      if (!fromDeviceId || !toDeviceId) {
        continue;
      }

      if (sameDeviceId(fromDeviceId, toDeviceId)) {
        throw new BadDataException("A device cannot be linked to itself.");
      }

      assertParentIsAnEnd(parentDeviceId, fromDeviceId, toDeviceId);
    }

    return { updateBy, carryForward: null };
  }
}

export default new Service();
