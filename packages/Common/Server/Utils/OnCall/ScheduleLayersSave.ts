import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import ConflictException from "../../../Types/Exception/ConflictException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ScheduleLayersSaveUtil, {
  ScheduleLayerOrderWrite,
  ScheduleLayerUserCreate,
  ScheduleLayerUserOrderWrite,
  ScheduleLayersSavePlan,
  ScheduleLayersSaveRequest,
  ScheduleLayersSaveResult,
  ScheduleLayersState,
  ScheduleLayersStateLayer,
  ScheduleLayersStateLayerUser,
} from "../../../Types/OnCallDutyPolicy/ScheduleLayersSave";
import AuditLogService from "../../Services/AuditLogService";
import DatabaseService from "../../Services/DatabaseService";
import OnCallDutyPolicyScheduleLayerService from "../../Services/OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleLayerUserService from "../../Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyScheduleService from "../../Services/OnCallDutyPolicyScheduleService";
import ModelPermission from "../../Types/Database/Permissions/Index";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import ProjectReferenceCheck from "../Database/ProjectReferenceCheck";
import logger from "../Logger";
import { OnCallShiftChangeReason } from "./OnCallShiftChangeListeners";
import { EntityManager } from "typeorm";

/*
 * SAVING A SCHEDULE'S LAYERS AND THE PEOPLE IN THEM, ALL AT ONCE.
 *
 * What the Layers page's Save sends (Types/OnCallDutyPolicy/ScheduleLayersSave):
 * every layer the schedule keeps, in priority order, each with its people in
 * turn order, and the layers it deletes. Written as one change, so the
 * people it reaches hear about it once:
 *
 *   1. The schedule, as the caller reads it: one they may not read, or one
 *      of another project, is answered as missing.
 *   2. The layers and the people in them as they are saved, and the version
 *      they are at: a save made to another version is refused (409) -
 *      someone changed them after the page read them.
 *   3. What the save writes (ScheduleLayersSaveUtil.plan), refused in plain
 *      words when it is no save of these layers.
 *   4. The permission each change takes, as the change made on its own is
 *      checked: deleting a layer, taking someone out of one, adding someone
 *      (a member of the project, to a layer of this schedule, by someone
 *      who may create the row), and moving a layer or a person - an edit of
 *      their order. The orders a deletion or an addition moves along are the
 *      save's own bookkeeping, as they are when each is made on its own
 *      (ContiguousOrder).
 *   5. One transaction: the schedule's row is locked, so another save of its
 *      layers waits, and so does anything added to it - a layer or a person
 *      names the schedule, and its foreign key reads the row. The layers and
 *      their people are read again under that lock, the version checked
 *      again, and everything written: the people taken out, the layers
 *      deleted (their people go with them), the new orders, the people
 *      added. Nothing is written unless all of it is.
 *   6. Once it commits: who is on call is worked out once
 *      (refreshCurrentUserIdAndHandoffTimeInSchedule), which sends the one
 *      round of messages for the change from what was on call to what is -
 *      to the people it reaches, and to the schedule's Slack and Microsoft
 *      Teams channels; the schedule's calendar feeds and reminders hear of
 *      it once (propagateShiftConfigChange); and the audit log records each
 *      row written, by the person who saved.
 *
 * Made one change at a time, each of those writes used to refresh the roster
 * and send its messages on its own, so a drag of someone to the top of a
 * layer told the people it passed that they were on call, and then that
 * they were not.
 */

// What the audit log's entries for one save write at once.
const AUDIT_LOG_ENTRIES_AT_ONCE: number = 10;

// The rows of a schedule's layers and their people, as read before the save.
interface ScheduleLayersRows {
  layers: Array<OnCallDutyPolicyScheduleLayer>;
  layerUsers: Array<OnCallDutyPolicyScheduleLayerUser>;
}

// A row a raw statement read.
type RawRow = Record<string, unknown>;

// The rows a statement read or returned, however the driver handed them over.
const getReturnedRows: (result: unknown) => Array<RawRow> = (
  result: unknown,
): Array<RawRow> => {
  if (!Array.isArray(result)) {
    return [];
  }

  /*
   * TypeORM hands an UPDATE or a DELETE back as [rows, count], and every
   * other statement as its rows.
   */
  if (
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === "number"
  ) {
    return result[0] as Array<RawRow>;
  }

  return result as Array<RawRow>;
};

const readText: (row: RawRow, column: string) => string = (
  row: RawRow,
  column: string,
): string => {
  const value: unknown = row[column];
  return value === null || value === undefined ? "" : String(value);
};

const readNumber: (row: RawRow, column: string) => number = (
  row: RawRow,
  column: string,
): number => {
  return Number(row[column]);
};

// Every column of a model, as a delete's audit snapshot reads it.
const getEveryColumn: <TModel extends BaseModel>(
  model: TModel,
) => Select<TModel> = <TModel extends BaseModel>(
  model: TModel,
): Select<TModel> => {
  const select: Record<string, boolean> = {};

  for (const column of model.getTableColumns().columns) {
    select[column] = true;
  }

  return select as Select<TModel>;
};

export default class ScheduleLayersSave {
  public static readonly CONFLICT_MESSAGE: string =
    "Someone else changed the layers of this schedule after you opened it, so your changes were not saved. Reload to see their changes, then make yours again.";

  public static async save(data: {
    scheduleId: ObjectID;
    request: ScheduleLayersSaveRequest;
    props: DatabaseCommonInteractionProps;
  }): Promise<ScheduleLayersSaveResult> {
    const projectId: ObjectID | undefined = data.props.tenantId;

    if (!projectId) {
      throw new BadDataException("Project ID is required.");
    }

    // 1. The schedule, as the caller reads it.
    const schedule: OnCallDutyPolicySchedule | null =
      await OnCallDutyPolicyScheduleService.findOneBy({
        query: {
          _id: data.scheduleId,
          projectId: projectId,
        },
        select: {
          _id: true,
        },
        props: data.props,
      });

    if (!schedule) {
      throw new NotFoundException(
        `${new OnCallDutyPolicySchedule().singularName || "Record"} not found.`,
      );
    }

    // 2. The layers and their people as they are saved, at the version the save was made to.
    const rows: ScheduleLayersRows = await ScheduleLayersSave.readRows({
      scheduleId: data.scheduleId,
      projectId: projectId,
    });

    const state: ScheduleLayersState = ScheduleLayersSave.getState(rows);

    ScheduleLayersSave.assertVersion(state, data.request.basedOnVersion);

    // 3. What the save writes.
    const plan: ScheduleLayersSavePlan = ScheduleLayersSaveUtil.plan({
      state: state,
      request: data.request,
    });

    if (ScheduleLayersSaveUtil.isEmpty(plan)) {
      return ScheduleLayersSave.getResult({
        version: ScheduleLayersSaveUtil.getVersion(state),
        plan: plan,
      });
    }

    // 4. The permission each change takes.
    await ScheduleLayersSave.checkPermissions({
      plan: plan,
      scheduleId: data.scheduleId,
      projectId: projectId,
      props: data.props,
    });

    // 5. One transaction, held to the version.
    const written: {
      version: string;
      createdLayerUsers: Array<OnCallDutyPolicyScheduleLayerUser>;
    } = await OnCallDutyPolicyScheduleService.executeTransaction(
      async (
        manager: EntityManager,
      ): Promise<{
        version: string;
        createdLayerUsers: Array<OnCallDutyPolicyScheduleLayerUser>;
      }> => {
        return await ScheduleLayersSave.write({
          manager: manager,
          plan: plan,
          scheduleId: data.scheduleId,
          projectId: projectId,
          basedOnVersion: data.request.basedOnVersion,
          props: data.props,
        });
      },
    );

    // 6. Who is on call, once; the feeds and reminders; the audit log.
    await ScheduleLayersSave.refreshRoster(data.scheduleId);

    await OnCallDutyPolicyScheduleService.propagateShiftConfigChange({
      scheduleIds: [data.scheduleId],
      projectId: projectId,
      userIds: ScheduleLayersSave.getUserIdsNamed(plan),
      reason:
        plan.layerDeletes.length > 0 || plan.layerOrderUpdates.length > 0
          ? OnCallShiftChangeReason.LayerChanged
          : OnCallShiftChangeReason.LayerUserChanged,
    });

    await ScheduleLayersSave.recordInAuditLog({
      rows: rows,
      plan: plan,
      createdLayerUsers: written.createdLayerUsers,
      props: data.props,
    });

    return ScheduleLayersSave.getResult({
      version: written.version,
      plan: plan,
    });
  }

  public static getState(rows: ScheduleLayersRows): ScheduleLayersState {
    return {
      layers: rows.layers.map(
        (layer: OnCallDutyPolicyScheduleLayer): ScheduleLayersStateLayer => {
          return {
            id: layer.id!.toString(),
            order: layer.order || 0,
          };
        },
      ),
      layerUsers: rows.layerUsers.map(
        (
          layerUser: OnCallDutyPolicyScheduleLayerUser,
        ): ScheduleLayersStateLayerUser => {
          return {
            id: layerUser.id!.toString(),
            layerId:
              layerUser.onCallDutyPolicyScheduleLayerId?.toString() || "",
            userId: layerUser.userId?.toString() || "",
            order: layerUser.order || 0,
          };
        },
      ),
    };
  }

  /*
   * A save made to the layers as they no longer are: someone changed them
   * after the page read them. 409, so the page offers to read them again.
   */
  public static assertVersion(
    state: ScheduleLayersState,
    basedOnVersion: string,
  ): void {
    if (ScheduleLayersSaveUtil.getVersion(state) !== basedOnVersion) {
      throw new ConflictException(ScheduleLayersSave.CONFLICT_MESSAGE);
    }
  }

  /*
   * The layers and the people in them, as root: every column, for the
   * audit log's record of what a save deletes and changes.
   */
  private static async readRows(data: {
    scheduleId: ObjectID;
    projectId: ObjectID;
  }): Promise<ScheduleLayersRows> {
    const layers: Array<OnCallDutyPolicyScheduleLayer> =
      await OnCallDutyPolicyScheduleLayerService.findBy({
        query: {
          onCallDutyPolicyScheduleId: data.scheduleId,
          projectId: data.projectId,
        },
        select: getEveryColumn(new OnCallDutyPolicyScheduleLayer()),
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const layerUsers: Array<OnCallDutyPolicyScheduleLayerUser> =
      await OnCallDutyPolicyScheduleLayerUserService.findBy({
        query: {
          onCallDutyPolicyScheduleId: data.scheduleId,
          projectId: data.projectId,
        },
        select: getEveryColumn(new OnCallDutyPolicyScheduleLayerUser()),
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    return { layers: layers, layerUsers: layerUsers };
  }

  /*
   * Each change, checked as it is when made on its own. A caller refused
   * any of them saves none of them.
   */
  private static async checkPermissions(data: {
    plan: ScheduleLayersSavePlan;
    scheduleId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const plan: ScheduleLayersSavePlan = data.plan;

    // Layers deleted: as a delete of each.
    if (plan.layerDeletes.length > 0) {
      await ScheduleLayersSave.assertCallerReaches({
        service: OnCallDutyPolicyScheduleLayerService,
        ids: plan.layerDeletes.map((layer: ScheduleLayersStateLayer) => {
          return layer.id;
        }),
        scheduleId: data.scheduleId,
        projectId: data.projectId,
        narrow: async (
          query: Query<OnCallDutyPolicyScheduleLayer>,
        ): Promise<Query<OnCallDutyPolicyScheduleLayer>> => {
          return await ModelPermission.checkDeleteQueryPermission(
            OnCallDutyPolicyScheduleLayer,
            query,
            data.props,
          );
        },
        refusal:
          "You do not have permission to delete the layers of this schedule.",
      });
    }

    // Layers moved up or down: as an edit of each one's order.
    if (plan.layerOrderUpdatesAreMoves && plan.layerOrderUpdates.length > 0) {
      await ScheduleLayersSave.assertCallerReaches({
        service: OnCallDutyPolicyScheduleLayerService,
        ids: plan.layerOrderUpdates.map((write: ScheduleLayerOrderWrite) => {
          return write.layer.id;
        }),
        scheduleId: data.scheduleId,
        projectId: data.projectId,
        narrow: async (
          query: Query<OnCallDutyPolicyScheduleLayer>,
        ): Promise<Query<OnCallDutyPolicyScheduleLayer>> => {
          return await ModelPermission.checkUpdateQueryPermissions(
            OnCallDutyPolicyScheduleLayer,
            query,
            { order: 1 },
            data.props,
          );
        },
        refusal:
          "You do not have permission to change the priority of this schedule's layers.",
      });
    }

    // People taken out of a layer: as a removal of each.
    if (plan.layerUserDeletes.length > 0) {
      await ScheduleLayersSave.assertCallerReaches({
        service: OnCallDutyPolicyScheduleLayerUserService,
        ids: plan.layerUserDeletes.map(
          (layerUser: ScheduleLayersStateLayerUser) => {
            return layerUser.id;
          },
        ),
        scheduleId: data.scheduleId,
        projectId: data.projectId,
        narrow: async (
          query: Query<OnCallDutyPolicyScheduleLayerUser>,
        ): Promise<Query<OnCallDutyPolicyScheduleLayerUser>> => {
          return await ModelPermission.checkDeleteQueryPermission(
            OnCallDutyPolicyScheduleLayerUser,
            query,
            data.props,
          );
        },
        refusal:
          "You do not have permission to take people out of this schedule's layers.",
      });
    }

    // People put in another turn order: as an edit of each one's order.
    if (plan.layerUserMoves.length > 0) {
      await ScheduleLayersSave.assertCallerReaches({
        service: OnCallDutyPolicyScheduleLayerUserService,
        ids: plan.layerUserMoves.map((write: ScheduleLayerUserOrderWrite) => {
          return write.layerUser.id;
        }),
        scheduleId: data.scheduleId,
        projectId: data.projectId,
        narrow: async (
          query: Query<OnCallDutyPolicyScheduleLayerUser>,
        ): Promise<Query<OnCallDutyPolicyScheduleLayerUser>> => {
          return await ModelPermission.checkUpdateQueryPermissions(
            OnCallDutyPolicyScheduleLayerUser,
            query,
            { order: 1 },
            data.props,
          );
        },
        refusal:
          "You do not have permission to change the turn order of this schedule's layers.",
      });
    }

    /*
     * People added: as an addition of each - the caller may create the row,
     * under a schedule and a layer they may read, and the person is a member
     * of the project (ProjectReferenceCheck, as the create's own hook asks).
     * Someone added twice to one layer is asked about once.
     */
    const asked: Set<string> = new Set<string>();

    for (const create of plan.layerUserCreates) {
      const key: string = `${create.layerId}:${create.userId}`;

      if (asked.has(key)) {
        continue;
      }

      asked.add(key);

      await OnCallDutyPolicyScheduleLayerUserService.checkCallerMayCreate({
        data: ScheduleLayersSave.buildLayerUser({
          create: create,
          scheduleId: data.scheduleId,
          projectId: data.projectId,
        }),
        props: data.props,
      });

      await ProjectReferenceCheck.validateCreate({
        service: OnCallDutyPolicyScheduleLayerUserService,
        createBy: {
          data: ScheduleLayersSave.buildLayerUser({
            create: create,
            scheduleId: data.scheduleId,
            projectId: data.projectId,
          }),
          props: data.props,
        },
      });
    }
  }

  /*
   * Whether the caller's permission reaches every one of `ids`: the query
   * for them, narrowed as the write's own permission check narrows it, and
   * read as root. One it does not reach refuses the save.
   */
  private static async assertCallerReaches<TModel extends BaseModel>(data: {
    service: DatabaseService<TModel>;
    ids: Array<string>;
    scheduleId: ObjectID;
    projectId: ObjectID;
    narrow: (query: Query<TModel>) => Promise<Query<TModel>>;
    refusal: string;
  }): Promise<void> {
    const ids: Array<string> = Array.from(new Set<string>(data.ids));

    const query: Query<TModel> = {
      _id: QueryHelper.any(
        ids.map((id: string): ObjectID => {
          return new ObjectID(id);
        }),
      ),
      onCallDutyPolicyScheduleId: data.scheduleId,
      projectId: data.projectId,
    } as unknown as Query<TModel>;

    const narrowed: Query<TModel> = await data.narrow(query);

    const reached: Array<TModel> = await data.service.findBy({
      query: narrowed,
      select: {
        _id: true,
      } as Select<TModel>,
      limit: ids.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const reachedIds: Set<string> = new Set<string>(
      reached.map((row: TModel): string => {
        return row.id?.toString().toLowerCase() || "";
      }),
    );

    for (const id of ids) {
      if (!reachedIds.has(id.toLowerCase())) {
        throw new NotAuthorizedException(data.refusal);
      }
    }
  }

  // A person added, as their row is created.
  private static buildLayerUser(data: {
    create: ScheduleLayerUserCreate;
    scheduleId: ObjectID;
    projectId: ObjectID;
  }): OnCallDutyPolicyScheduleLayerUser {
    const layerUser: OnCallDutyPolicyScheduleLayerUser =
      new OnCallDutyPolicyScheduleLayerUser();
    layerUser.projectId = data.projectId;
    layerUser.onCallDutyPolicyScheduleId = data.scheduleId;
    layerUser.onCallDutyPolicyScheduleLayerId = new ObjectID(
      data.create.layerId,
    );
    layerUser.userId = new ObjectID(data.create.userId);
    layerUser.order = data.create.order;
    return layerUser;
  }

  /*
   * The writes, in the transaction: the schedule locked, the layers and
   * their people read again under the lock and held to the version, then
   * written. Returns the version they are at once written, and the people
   * added, as their rows were created.
   */
  private static async write(data: {
    manager: EntityManager;
    plan: ScheduleLayersSavePlan;
    scheduleId: ObjectID;
    projectId: ObjectID;
    basedOnVersion: string;
    props: DatabaseCommonInteractionProps;
  }): Promise<{
    version: string;
    createdLayerUsers: Array<OnCallDutyPolicyScheduleLayerUser>;
  }> {
    const manager: EntityManager = data.manager;
    const plan: ScheduleLayersSavePlan = data.plan;
    const scheduleId: string = data.scheduleId.toString();
    const projectId: string = data.projectId.toString();

    /*
     * Another save of these layers waits here, and so does a layer or a
     * person added to the schedule: their foreign key reads this row.
     */
    const locked: Array<RawRow> = getReturnedRows(
      await manager.query(
        `SELECT "_id" FROM "OnCallDutyPolicySchedule" WHERE "_id" = $1 AND "projectId" = $2 AND "deletedAt" IS NULL FOR UPDATE`,
        [scheduleId, projectId],
      ),
    );

    if (locked.length === 0) {
      throw new NotFoundException(
        `${new OnCallDutyPolicySchedule().singularName || "Record"} not found.`,
      );
    }

    ScheduleLayersSave.assertVersion(
      await ScheduleLayersSave.readLockedState({
        manager: manager,
        scheduleId: scheduleId,
        projectId: projectId,
      }),
      data.basedOnVersion,
    );

    // The people taken out of the layers kept.
    if (plan.layerUserDeletes.length > 0) {
      await manager.query(
        `DELETE FROM "OnCallDutyPolicyScheduleLayerUser" WHERE "_id" = ANY($1::uuid[]) AND "onCallDutyPolicyScheduleId" = $2 AND "projectId" = $3`,
        [
          plan.layerUserDeletes.map(
            (layerUser: ScheduleLayersStateLayerUser): string => {
              return layerUser.id;
            },
          ),
          scheduleId,
          projectId,
        ],
      );
    }

    // The layers deleted, and with them (their foreign key cascades) their people.
    if (plan.layerDeletes.length > 0) {
      await manager.query(
        `DELETE FROM "OnCallDutyPolicyScheduleLayer" WHERE "_id" = ANY($1::uuid[]) AND "onCallDutyPolicyScheduleId" = $2 AND "projectId" = $3`,
        [
          plan.layerDeletes.map((layer: ScheduleLayersStateLayer): string => {
            return layer.id;
          }),
          scheduleId,
          projectId,
        ],
      );
    }

    // The layers kept, in their new priority order.
    await ScheduleLayersSave.writeOrders({
      manager: manager,
      tableName: "OnCallDutyPolicyScheduleLayer",
      writes: plan.layerOrderUpdates.map((write: ScheduleLayerOrderWrite) => {
        return { id: write.layer.id, order: write.order };
      }),
      scheduleId: scheduleId,
      projectId: projectId,
    });

    // The people kept, in their new turn order.
    await ScheduleLayersSave.writeOrders({
      manager: manager,
      tableName: "OnCallDutyPolicyScheduleLayerUser",
      writes: plan.layerUserOrderUpdates.map(
        (write: ScheduleLayerUserOrderWrite) => {
          return { id: write.layerUser.id, order: write.order };
        },
      ),
      scheduleId: scheduleId,
      projectId: projectId,
    });

    // The people added, at their places.
    const createdLayerUsers: Array<OnCallDutyPolicyScheduleLayerUser> =
      await ScheduleLayersSave.insertLayerUsers({
        manager: manager,
        creates: plan.layerUserCreates,
        scheduleId: data.scheduleId,
        projectId: data.projectId,
        props: data.props,
      });

    return {
      version: ScheduleLayersSaveUtil.getVersion(
        await ScheduleLayersSave.readLockedState({
          manager: manager,
          scheduleId: scheduleId,
          projectId: projectId,
        }),
      ),
      createdLayerUsers: createdLayerUsers,
    };
  }

  // The layers and their people, read in the transaction and locked.
  private static async readLockedState(data: {
    manager: EntityManager;
    scheduleId: string;
    projectId: string;
  }): Promise<ScheduleLayersState> {
    const layers: Array<RawRow> = getReturnedRows(
      await data.manager.query(
        `SELECT "_id", "order" FROM "OnCallDutyPolicyScheduleLayer" WHERE "onCallDutyPolicyScheduleId" = $1 AND "projectId" = $2 AND "deletedAt" IS NULL ORDER BY "_id" FOR UPDATE`,
        [data.scheduleId, data.projectId],
      ),
    );

    const layerUsers: Array<RawRow> = getReturnedRows(
      await data.manager.query(
        `SELECT "_id", "onCallDutyPolicyScheduleLayerId", "userId", "order" FROM "OnCallDutyPolicyScheduleLayerUser" WHERE "onCallDutyPolicyScheduleId" = $1 AND "projectId" = $2 AND "deletedAt" IS NULL ORDER BY "_id" FOR UPDATE`,
        [data.scheduleId, data.projectId],
      ),
    );

    return {
      layers: layers.map((row: RawRow): ScheduleLayersStateLayer => {
        return {
          id: readText(row, "_id"),
          order: readNumber(row, "order"),
        };
      }),
      layerUsers: layerUsers.map(
        (row: RawRow): ScheduleLayersStateLayerUser => {
          return {
            id: readText(row, "_id"),
            layerId: readText(row, "onCallDutyPolicyScheduleLayerId"),
            userId: readText(row, "userId"),
            order: readNumber(row, "order"),
          };
        },
      ),
    };
  }

  // New orders for rows of one table, in one statement.
  private static async writeOrders(data: {
    manager: EntityManager;
    tableName:
      | "OnCallDutyPolicyScheduleLayer"
      | "OnCallDutyPolicyScheduleLayerUser";
    writes: Array<{ id: string; order: number }>;
    scheduleId: string;
    projectId: string;
  }): Promise<void> {
    if (data.writes.length === 0) {
      return;
    }

    const parameters: Array<unknown> = [data.scheduleId, data.projectId];
    const values: Array<string> = [];

    for (const write of data.writes) {
      parameters.push(write.id, write.order);
      values.push(
        `($${parameters.length - 1}::uuid, $${parameters.length}::integer)`,
      );
    }

    await data.manager.query(
      `UPDATE "${data.tableName}" AS "row" SET "order" = "moved"."order", "updatedAt" = now(), "version" = "row"."version" + 1 FROM (VALUES ${values.join(", ")}) AS "moved"("_id", "order") WHERE "row"."_id" = "moved"."_id" AND "row"."onCallDutyPolicyScheduleId" = $1 AND "row"."projectId" = $2`,
      parameters,
    );
  }

  // The people added, as rows: created by the person who saved.
  private static async insertLayerUsers(data: {
    manager: EntityManager;
    creates: Array<ScheduleLayerUserCreate>;
    scheduleId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<OnCallDutyPolicyScheduleLayerUser>> {
    if (data.creates.length === 0) {
      return [];
    }

    const createdByUserId: string | null =
      data.props.userId?.toString() || null;

    const parameters: Array<unknown> = [
      data.projectId.toString(),
      data.scheduleId.toString(),
      createdByUserId,
    ];
    const values: Array<string> = [];

    for (const create of data.creates) {
      parameters.push(create.layerId, create.userId, create.order);
      const at: number = parameters.length;
      values.push(
        `($1::uuid, $2::uuid, $${at - 2}::uuid, $${at - 1}::uuid, $${at}::integer, $3::uuid, 1)`,
      );
    }

    const inserted: Array<RawRow> = getReturnedRows(
      await data.manager.query(
        `INSERT INTO "OnCallDutyPolicyScheduleLayerUser" ("projectId", "onCallDutyPolicyScheduleId", "onCallDutyPolicyScheduleLayerId", "userId", "order", "createdByUserId", "version") VALUES ${values.join(", ")} RETURNING "_id", "onCallDutyPolicyScheduleLayerId", "userId", "order"`,
        parameters,
      ),
    );

    return inserted.map((row: RawRow): OnCallDutyPolicyScheduleLayerUser => {
      const layerUser: OnCallDutyPolicyScheduleLayerUser =
        new OnCallDutyPolicyScheduleLayerUser(
          new ObjectID(readText(row, "_id")),
        );
      layerUser.projectId = data.projectId;
      layerUser.onCallDutyPolicyScheduleId = data.scheduleId;
      layerUser.onCallDutyPolicyScheduleLayerId = new ObjectID(
        readText(row, "onCallDutyPolicyScheduleLayerId"),
      );
      layerUser.userId = new ObjectID(readText(row, "userId"));
      layerUser.order = readNumber(row, "order");

      if (createdByUserId) {
        layerUser.createdByUserId = new ObjectID(createdByUserId);
      }

      return layerUser;
    });
  }

  /*
   * Who is on call, worked out once for the whole save. Best-effort, as the
   * hooks of a change made on its own are: the save has committed, and a
   * refresh that fails - a schedule deleted meanwhile, a message that could
   * not be sent - must not report it as unsaved. The every-minute refresh
   * (RefreshHandoffTime) catches up.
   */
  private static async refreshRoster(scheduleId: ObjectID): Promise<void> {
    try {
      await OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule(
        scheduleId,
      );
    } catch (err) {
      logger.error(
        "Error refreshing the schedule roster after saving its layers (best-effort).",
      );
      logger.error(err);
    }
  }

  /*
   * The people a save names directly - added, taken out, moved, or in a
   * layer it deletes - whose own calendar feeds and reminders are looked at
   * again even when they are in the schedule no more.
   */
  private static getUserIdsNamed(
    plan: ScheduleLayersSavePlan,
  ): Array<ObjectID> {
    const userIds: Set<string> = new Set<string>();

    for (const layerUser of [
      ...plan.layerUserDeletes,
      ...plan.layerUsersOfDeletedLayers,
    ]) {
      userIds.add(layerUser.userId.toLowerCase());
    }

    for (const write of plan.layerUserOrderUpdates) {
      userIds.add(write.layerUser.userId.toLowerCase());
    }

    for (const create of plan.layerUserCreates) {
      userIds.add(create.userId.toLowerCase());
    }

    return Array.from(userIds)
      .filter(Boolean)
      .map((userId: string): ObjectID => {
        return new ObjectID(userId);
      });
  }

  /*
   * The audit log's record of the save: each row it wrote, by the person who
   * saved, as each change made on its own records it - a delete with what
   * was deleted, an edit of an order with the order before and after, a
   * creation with the row created. The people of a deleted layer go with it
   * by its foreign key, unrecorded, as they do when a layer is deleted on
   * its own. Like every audit write, it never fails the save
   * (AuditLogService).
   */
  private static async recordInAuditLog(data: {
    rows: ScheduleLayersRows;
    plan: ScheduleLayersSavePlan;
    createdLayerUsers: Array<OnCallDutyPolicyScheduleLayerUser>;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const layerModel: OnCallDutyPolicyScheduleLayer =
      new OnCallDutyPolicyScheduleLayer();
    const layerUserModel: OnCallDutyPolicyScheduleLayerUser =
      new OnCallDutyPolicyScheduleLayerUser();

    const layerById: Map<string, OnCallDutyPolicyScheduleLayer> = new Map<
      string,
      OnCallDutyPolicyScheduleLayer
    >();

    for (const layer of data.rows.layers) {
      layerById.set(layer.id!.toString().toLowerCase(), layer);
    }

    const layerUserById: Map<string, OnCallDutyPolicyScheduleLayerUser> =
      new Map<string, OnCallDutyPolicyScheduleLayerUser>();

    for (const layerUser of data.rows.layerUsers) {
      layerUserById.set(layerUser.id!.toString().toLowerCase(), layerUser);
    }

    const entries: Array<() => Promise<void>> = [];

    if (layerUserModel.enableAuditLogOn?.delete) {
      for (const removed of data.plan.layerUserDeletes) {
        const row: OnCallDutyPolicyScheduleLayerUser | undefined =
          layerUserById.get(removed.id.toLowerCase());

        if (row?.id) {
          entries.push(async (): Promise<void> => {
            await AuditLogService.recordDelete({
              model: layerUserModel,
              deletedItem: row,
              itemId: row.id!,
              props: data.props,
            });
          });
        }
      }
    }

    if (layerModel.enableAuditLogOn?.delete) {
      for (const deleted of data.plan.layerDeletes) {
        const row: OnCallDutyPolicyScheduleLayer | undefined = layerById.get(
          deleted.id.toLowerCase(),
        );

        if (row?.id) {
          entries.push(async (): Promise<void> => {
            await AuditLogService.recordDelete({
              model: layerModel,
              deletedItem: row,
              itemId: row.id!,
              props: data.props,
            });
          });
        }
      }
    }

    if (layerModel.enableAuditLogOn?.update) {
      for (const write of data.plan.layerOrderUpdates) {
        const row: OnCallDutyPolicyScheduleLayer | undefined = layerById.get(
          write.layer.id.toLowerCase(),
        );

        if (row?.id) {
          entries.push(async (): Promise<void> => {
            await AuditLogService.recordUpdate({
              model: layerModel,
              before: row,
              updatedFields: { order: write.order } as JSONObject,
              itemId: row.id!,
              props: data.props,
            });
          });
        }
      }
    }

    if (layerUserModel.enableAuditLogOn?.update) {
      for (const write of data.plan.layerUserOrderUpdates) {
        const row: OnCallDutyPolicyScheduleLayerUser | undefined =
          layerUserById.get(write.layerUser.id.toLowerCase());

        if (row?.id) {
          entries.push(async (): Promise<void> => {
            await AuditLogService.recordUpdate({
              model: layerUserModel,
              before: row,
              updatedFields: { order: write.order } as JSONObject,
              itemId: row.id!,
              props: data.props,
            });
          });
        }
      }
    }

    if (layerUserModel.enableAuditLogOn?.create) {
      for (const created of data.createdLayerUsers) {
        entries.push(async (): Promise<void> => {
          await AuditLogService.recordCreate({
            model: layerUserModel,
            createdItem: created,
            props: data.props,
          });
        });
      }
    }

    for (
      let start: number = 0;
      start < entries.length;
      start += AUDIT_LOG_ENTRIES_AT_ONCE
    ) {
      await Promise.all(
        entries
          .slice(start, start + AUDIT_LOG_ENTRIES_AT_ONCE)
          .map(async (entry: () => Promise<void>): Promise<void> => {
            await entry();
          }),
      );
    }
  }

  private static getResult(data: {
    version: string;
    plan: ScheduleLayersSavePlan;
  }): ScheduleLayersSaveResult {
    return {
      version: data.version,
      deletedLayers: data.plan.layerDeletes.length,
      movedLayers: data.plan.layerOrderUpdatesAreMoves
        ? data.plan.layerOrderUpdates.length
        : 0,
      addedLayerUsers: data.plan.layerUserCreates.length,
      removedLayerUsers: data.plan.layerUserDeletes.length,
      movedLayerUsers: data.plan.layerUserMoves.length,
    };
  }
}
