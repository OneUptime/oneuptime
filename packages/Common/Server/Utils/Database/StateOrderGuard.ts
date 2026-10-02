import type DatabaseService from "../../Services/DatabaseService";
import CreateBy from "../../Types/Database/CreateBy";
import DeleteBy from "../../Types/Database/DeleteBy";
import Query from "../../Types/Database/Query";
import Select from "../../Types/Database/Select";
import Sort from "../../Types/Database/Sort";
import UpdateBy from "../../Types/Database/UpdateBy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  StateListBuiltIn,
  StateListDefinition,
  StateListDeleteRefusal,
  StateListOrderViolation,
  StateListRow,
  getStateListDeleteRefusal,
  getStateListDeleteRefusalMessage,
  getStateListInsertValue,
  getStateListOrderViolationIntroduced,
  getStateListOrderViolationMessage,
  getStateListRowsAfterCreate,
  getStateListRowsAfterMove,
  toStateListRow,
} from "../../../Utils/StateOrder";

/*
 * The server half of Common/Utils/StateOrder: what the incident, alert and
 * scheduled maintenance state services, the monitor status service and the
 * two severity services do around a create, an update and a delete, so that
 * a project's lists keep meaning what OneUptime reads them as.
 *
 * Their order itself is kept by DatabaseService (@ListOrderColumn), for every
 * caller. On top of that:
 *
 *   - a row created without a place goes where the list wants a new one
 *     (just above the resolved state, just above the offline status), not
 *     after it;
 *   - a signed-in create or update that would put the built-in states of a
 *     path out of order is refused, with why;
 *   - a signed-in delete that would take away the last row of a built-in
 *     kind is refused, with why.
 *
 * Internal (root) writes - project seeding, data migrations - are trusted
 * and only get the placement.
 */

type ServiceOf<TBaseModel extends BaseModel> = DatabaseService<TBaseModel>;

export default class StateOrderGuard {
  /*
   * Every row of one project's list, with what the rules read: its name,
   * place and flags. Read as root, and only ever for the project the write
   * is in.
   */
  public static async loadRows<TBaseModel extends BaseModel>(data: {
    service: ServiceOf<TBaseModel>;
    definition: StateListDefinition;
    projectId: ObjectID;
  }): Promise<Array<StateListRow>> {
    const select: Record<string, boolean> = {
      _id: true,
      name: true,
      createdAt: true,
      [data.definition.orderColumn]: true,
    };

    for (const builtIn of data.definition.builtIns) {
      select[builtIn.flag] = true;
    }

    const rows: Array<TBaseModel> = await data.service.findAllBy({
      query: {
        projectId: data.projectId,
      } as unknown as Query<TBaseModel>,
      select: select as Select<TBaseModel>,
      sort: {
        [data.definition.orderColumn]: SortOrder.Ascending,
        createdAt: SortOrder.Ascending,
      } as Sort<TBaseModel>,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    return rows.map((row: TBaseModel) => {
      return toStateListRow(data.definition, row);
    });
  }

  /*
   * Before a create: a row with no place is given the place the list wants
   * for a new one, and a signed-in create of a built-in row that would put
   * the path out of order is refused.
   */
  public static async beforeCreate<TBaseModel extends BaseModel>(data: {
    service: ServiceOf<TBaseModel>;
    definition: StateListDefinition;
    createBy: CreateBy<TBaseModel>;
  }): Promise<void> {
    const definition: StateListDefinition = data.definition;
    const row: TBaseModel = data.createBy.data;
    const projectId: ObjectID | undefined = StateOrderGuard.toObjectId(
      (row as unknown as Record<string, unknown>)["projectId"],
    );

    if (!projectId) {
      throw new BadDataException(
        `${data.service.getModel().singularName || "Item"} projectId is required`,
      );
    }

    const newRow: StateListRow = toStateListRow(definition, row);

    const needsPlace: boolean =
      newRow.order === null && Boolean(definition.insertAboveFlag);

    const needsOrderCheck: boolean =
      definition.keepsBuiltInOrder &&
      !data.createBy.props.isRoot &&
      newRow.flags.length > 0;

    if (!needsPlace && !needsOrderCheck) {
      return;
    }

    const rows: Array<StateListRow> = await StateOrderGuard.loadRows({
      service: data.service,
      definition: definition,
      projectId: projectId,
    });

    if (needsPlace) {
      const insertValue: number | null = getStateListInsertValue(
        definition,
        rows,
      );

      if (insertValue !== null) {
        row.setColumnValue(definition.orderColumn, insertValue);
        newRow.order = insertValue;
      }
    }

    if (needsOrderCheck) {
      const violation: StateListOrderViolation | null =
        getStateListOrderViolationIntroduced({
          definition: definition,
          rowsBefore: rows,
          rowsAfter: getStateListRowsAfterCreate({
            rows: rows,
            newRow: { ...newRow, id: newRow.id || "__new-state-row__" },
          }),
        });

      if (violation) {
        throw new BadDataException(
          getStateListOrderViolationMessage(definition, violation),
        );
      }
    }
  }

  /*
   * Before a signed-in update that moves a row of a path or changes which
   * built-in it is: refused when it would put the built-in rows out of
   * order. Every other update costs nothing extra.
   */
  public static async beforeUpdate<TBaseModel extends BaseModel>(data: {
    service: ServiceOf<TBaseModel>;
    definition: StateListDefinition;
    updateBy: UpdateBy<TBaseModel>;
  }): Promise<void> {
    const definition: StateListDefinition = data.definition;

    if (!definition.keepsBuiltInOrder || data.updateBy.props.isRoot) {
      return;
    }

    const changes: Record<string, unknown> = data.updateBy.data as Record<
      string,
      unknown
    >;

    const movesRow: boolean = Object.prototype.hasOwnProperty.call(
      changes,
      definition.orderColumn,
    );

    const changedFlags: Array<StateListBuiltIn> = definition.builtIns.filter(
      (builtIn: StateListBuiltIn) => {
        return (
          Object.prototype.hasOwnProperty.call(changes, builtIn.flag) &&
          changes[builtIn.flag] !== undefined
        );
      },
    );

    if (!movesRow && changedFlags.length === 0) {
      return;
    }

    const targets: Array<TBaseModel> = await StateOrderGuard.findTargets({
      service: data.service,
      query: data.updateBy.query,
      tenantId: data.updateBy.props.tenantId,
      limit: data.updateBy.limit,
      skip: data.updateBy.skip,
    });

    for (const [projectKey, projectTargets] of StateOrderGuard.byProject(
      targets,
    )) {
      const rowsBefore: Array<StateListRow> = await StateOrderGuard.loadRows({
        service: data.service,
        definition: definition,
        projectId: new ObjectID(projectKey),
      });

      let rowsAfter: Array<StateListRow> = rowsBefore;

      for (const target of projectTargets) {
        const id: string = target._id?.toString() || "";

        if (movesRow) {
          rowsAfter = getStateListRowsAfterMove({
            rows: rowsAfter,
            id: id,
            requestedValue: changes[definition.orderColumn],
          });
        }

        if (changedFlags.length > 0) {
          rowsAfter = rowsAfter.map((row: StateListRow) => {
            if (row.id !== id) {
              return row;
            }

            return {
              ...row,
              flags: definition.builtIns
                .filter((builtIn: StateListBuiltIn) => {
                  return changedFlags.includes(builtIn)
                    ? changes[builtIn.flag] === true
                    : row.flags.includes(builtIn.flag);
                })
                .map((builtIn: StateListBuiltIn) => {
                  return builtIn.flag;
                }),
            };
          });
        }
      }

      const violation: StateListOrderViolation | null =
        getStateListOrderViolationIntroduced({
          definition: definition,
          rowsBefore: rowsBefore,
          rowsAfter: rowsAfter,
        });

      if (violation) {
        throw new BadDataException(
          getStateListOrderViolationMessage(definition, violation),
        );
      }
    }
  }

  /*
   * Before a signed-in delete: refused when it would take away the last row
   * of a built-in kind - a project always has somewhere for a new incident
   * to start, and somewhere for a resolved one to go.
   */
  public static async beforeDelete<TBaseModel extends BaseModel>(data: {
    service: ServiceOf<TBaseModel>;
    definition: StateListDefinition;
    deleteBy: DeleteBy<TBaseModel>;
  }): Promise<void> {
    const definition: StateListDefinition = data.definition;

    if (definition.builtIns.length === 0 || data.deleteBy.props.isRoot) {
      return;
    }

    const targets: Array<TBaseModel> = await StateOrderGuard.findTargets({
      service: data.service,
      query: data.deleteBy.query,
      tenantId: data.deleteBy.props.tenantId,
      limit: data.deleteBy.limit,
      skip: data.deleteBy.skip,
    });

    for (const [projectKey, projectTargets] of StateOrderGuard.byProject(
      targets,
    )) {
      const rows: Array<StateListRow> = await StateOrderGuard.loadRows({
        service: data.service,
        definition: definition,
        projectId: new ObjectID(projectKey),
      });

      const refusal: StateListDeleteRefusal | null = getStateListDeleteRefusal({
        definition: definition,
        rows: rows,
        idsToDelete: projectTargets.map((target: TBaseModel) => {
          return target._id?.toString() || "";
        }),
      });

      if (refusal) {
        throw new BadDataException(
          getStateListDeleteRefusalMessage(definition, refusal),
        );
      }
    }
  }

  /*
   * The rows a write is about to touch, read the way the write will find
   * them - and never outside the caller's project, so a refusal can only
   * ever name rows the caller could see.
   */
  private static async findTargets<TBaseModel extends BaseModel>(data: {
    service: ServiceOf<TBaseModel>;
    query: Query<TBaseModel>;
    tenantId?: ObjectID | undefined;
    limit?: PositiveNumber | number | undefined;
    skip?: PositiveNumber | number | undefined;
  }): Promise<Array<TBaseModel>> {
    const query: Record<string, unknown> = {
      ...(data.query as Record<string, unknown>),
    };

    if (data.tenantId) {
      query["projectId"] = data.tenantId;
    }

    return await data.service.findBy({
      query: query as Query<TBaseModel>,
      select: {
        _id: true,
        projectId: true,
      } as Select<TBaseModel>,
      limit: data.limit ?? 1,
      skip: data.skip ?? 0,
      props: {
        isRoot: true,
      },
    });
  }

  private static byProject<TBaseModel extends BaseModel>(
    rows: Array<TBaseModel>,
  ): Map<string, Array<TBaseModel>> {
    const byProject: Map<string, Array<TBaseModel>> = new Map();

    for (const row of rows) {
      const projectId: ObjectID | undefined = StateOrderGuard.toObjectId(
        (row as unknown as Record<string, unknown>)["projectId"],
      );

      if (!projectId || !row._id) {
        continue;
      }

      const key: string = projectId.toString();
      const projectRows: Array<TBaseModel> = byProject.get(key) || [];
      projectRows.push(row);
      byProject.set(key, projectRows);
    }

    return byProject;
  }

  private static toObjectId(value: unknown): ObjectID | undefined {
    if (value instanceof ObjectID) {
      return value;
    }

    if (typeof value === "string" && value.length > 0) {
      return new ObjectID(value);
    }

    return undefined;
  }
}
