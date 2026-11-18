import type DatabaseService from "../../Services/DatabaseService";
import CreateBy from "../../Types/Database/CreateBy";
import DeleteBy from "../../Types/Database/DeleteBy";
import Query from "../../Types/Database/Query";
import Select from "../../Types/Database/Select";
import Sort from "../../Types/Database/Sort";
import UpdateBy from "../../Types/Database/UpdateBy";
import ContiguousOrder from "./ContiguousOrder";
import ListOrderMaintainer from "./ListOrderMaintainer";
import logger from "../Logger";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { ListOrderSettings } from "../../../Types/Database/ListOrderColumn";
import { ListPlace } from "../../../Types/Database/MoveInList";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  StateListBuiltIn,
  StateListDefinition,
  StateListDeleteRefusal,
  StateListOrderViolation,
  StateListRow,
  getStateListDeleteRefusal,
  getStateListDeleteRefusalMessage,
  getStateListInsertAnchor,
  getStateListOrderViolationIntroduced,
  getStateListOrderViolationMessage,
  getStateListRowsAfterCreate,
  getStateListRowsAfterWrite,
  toStateListRow,
} from "../../../Utils/StateOrder";

/*
 * The server half of Common/Utils/StateOrder: what the incident, alert and
 * scheduled maintenance state services, the monitor status service and the
 * two severity services do around a create, an update, a move and a delete,
 * so that a project's lists keep meaning what OneUptime reads them as.
 *
 * Their order itself is kept by DatabaseService (@ListOrderColumn), for every
 * caller: a write of a row's number places that row and moves no other, and
 * a move (POST <list>/:id/move) numbers the list 1..n. On top of that:
 *
 *   - a row created without a place goes where the list wants a new one
 *     (just above the resolved state, just above the offline status), not
 *     after it: created at the end, then moved to that row's place
 *     (beforeCreate says where, afterCreate moves it);
 *   - a signed-in create, update or move that would put the built-in states
 *     of a path out of order is refused, with why;
 *   - a signed-in delete that would take away the last row of a built-in
 *     kind is refused, with why.
 *
 * Internal (root) writes - project seeding, data migrations - are trusted
 * and only get the placement.
 */

type ServiceOf<TBaseModel extends BaseModel> = DatabaseService<TBaseModel>;

/*
 * Where a row created without a place goes, once it is saved at the end of
 * its list: just above this row. What beforeCreate hands the service's
 * onBeforeCreate to carry forward to afterCreate.
 */
export interface StateListCreatePlacement {
  placeAboveId: string;
}

export default class StateOrderGuard {
  /*
   * Every row of one project's list, with what the rules read: its name,
   * place and flags, in the list's order (rows that share a place by id).
   * Read as root, and only ever for the project the write is in.
   */
  public static async loadRows<TBaseModel extends BaseModel>(data: {
    service: ServiceOf<TBaseModel>;
    definition: StateListDefinition;
    projectId: ObjectID;
  }): Promise<Array<StateListRow>> {
    const select: Record<string, boolean> = {
      _id: true,
      name: true,
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
   * Before a create: a signed-in create of a built-in row that would put
   * the path out of order is refused. A row with no place, in a list that
   * wants a new one above a row of its own (the resolved state), is saved at
   * the end like any other: what is handed back says which row to move it
   * above once it is saved (afterCreate), or null.
   */
  public static async beforeCreate<TBaseModel extends BaseModel>(data: {
    service: ServiceOf<TBaseModel>;
    definition: StateListDefinition;
    createBy: CreateBy<TBaseModel>;
  }): Promise<StateListCreatePlacement | null> {
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
      return null;
    }

    const rows: Array<StateListRow> = await StateOrderGuard.loadRows({
      service: data.service,
      definition: definition,
      projectId: projectId,
    });

    if (needsOrderCheck) {
      const violation: StateListOrderViolation | null =
        getStateListOrderViolationIntroduced({
          definition: definition,
          rowsBefore: rows,
          rowsAfter: getStateListRowsAfterCreate({
            definition: definition,
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

    if (!needsPlace) {
      return null;
    }

    const anchor: StateListRow | null = getStateListInsertAnchor(
      definition,
      rows,
    );

    return anchor ? { placeAboveId: anchor.id } : null;
  }

  /*
   * After a create beforeCreate placed: the new row, saved at the end of its
   * list, is moved to the place of the row it goes above - that row and the
   * rows after it step down one, and the list is numbered 1..n, in one
   * transaction holding the list (ContiguousOrder.moveRowOfList) - and the
   * row handed back carries the number it ends at. Never fails the create
   * that already happened: a row left at the end of its list is still in
   * it, and can be dragged.
   */
  public static async afterCreate<TBaseModel extends BaseModel>(data: {
    service: ServiceOf<TBaseModel>;
    placement: StateListCreatePlacement | null | undefined;
    createdItem: TBaseModel;
  }): Promise<void> {
    if (!data.placement || !data.createdItem.id) {
      return;
    }

    const model: TBaseModel = data.service.getModel();
    const settings: ListOrderSettings | null =
      ListOrderMaintainer.getSettings(model);

    if (!settings) {
      return;
    }

    try {
      const moved: { changedRows: Array<{ id: string; order: number }> } =
        await ContiguousOrder.moveRowOfList({
          service: data.service,
          list: ContiguousOrder.getListColumnValues({
            model: model,
            row: data.createdItem,
            listColumns: ListOrderMaintainer.getScopeColumns({
              model: model,
              settings: settings,
            }),
          }),
          rowId: data.createdItem.id,
          placeOfId: new ObjectID(data.placement.placeAboveId),
          orderColumn: settings.column,
          sortOrder: settings.sortOrder,
        });

      const createdId: string = data.createdItem.id.toString().toLowerCase();

      for (const changed of moved.changedRows) {
        if (changed.id.toLowerCase() === createdId) {
          data.createdItem.setColumnValue(settings.column, changed.order);
        }
      }
    } catch (err) {
      logger.error(
        `Could not place a new row of the ${model.tableName || "list"} list above the row it goes above: ${(err as Error)?.message || err}`,
      );
    }
  }

  /*
   * Before a signed-in update that writes a row's place or changes which
   * built-in it is: refused when it would put the built-in rows out of
   * order. The row takes the number it is given and no other moves, so the
   * list is read as it will be with that number. Every other update costs
   * nothing extra.
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

    const writesPlace: boolean = Object.prototype.hasOwnProperty.call(
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

    if (!writesPlace && changedFlags.length === 0) {
      return;
    }

    // The rows the update writes, and the update held to them.
    const targets: Array<TBaseModel> =
      await data.service.findRowsAndHoldUpdateToThem(data.updateBy, {
        _id: true,
        projectId: true,
      } as Select<TBaseModel>);

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

        if (writesPlace) {
          rowsAfter = getStateListRowsAfterWrite({
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

      StateOrderGuard.assertKeepsOrder({
        definition: definition,
        rowsBefore: rowsBefore,
        rowsAfter: rowsAfter,
      });
    }
  }

  /*
   * Before a signed-in move in the list (DatabaseService.moveInList) writes,
   * with the list's rows held: refused when it would put the built-in rows
   * out of order. `rows` are the list's rows as the lock handed them over,
   * `changedRows` the numbers the move gives; each row's name and flags are
   * read beside them.
   */
  public static async beforeMove<TBaseModel extends BaseModel>(data: {
    service: ServiceOf<TBaseModel>;
    definition: StateListDefinition;
    projectId: ObjectID | undefined;
    rows: Array<ListPlace>;
    changedRows: Array<{ id: string; order: number }>;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const definition: StateListDefinition = data.definition;

    if (
      !definition.keepsBuiltInOrder ||
      data.props.isRoot ||
      !data.projectId ||
      data.changedRows.length === 0
    ) {
      return;
    }

    const placeById: Map<string, number | null> = new Map();

    for (const place of data.rows) {
      const order: number | null =
        typeof place.order === "number" ? place.order : null;
      placeById.set(place.id.toLowerCase(), order);
    }

    const changedById: Map<string, number> = new Map();

    for (const changed of data.changedRows) {
      changedById.set(changed.id.toLowerCase(), changed.order);
    }

    // The list's names and flags, at the places the lock handed over.
    const rowsBefore: Array<StateListRow> = (
      await StateOrderGuard.loadRows({
        service: data.service,
        definition: definition,
        projectId: data.projectId,
      })
    )
      .filter((row: StateListRow) => {
        return placeById.has(row.id.toLowerCase());
      })
      .map((row: StateListRow): StateListRow => {
        return { ...row, order: placeById.get(row.id.toLowerCase()) ?? null };
      });

    const rowsAfter: Array<StateListRow> = rowsBefore.map(
      (row: StateListRow): StateListRow => {
        const order: number | undefined = changedById.get(row.id.toLowerCase());
        return order === undefined ? row : { ...row, order: order };
      },
    );

    StateOrderGuard.assertKeepsOrder({
      definition: definition,
      rowsBefore: rowsBefore,
      rowsAfter: rowsAfter,
    });
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

    // The rows the delete removes, and the delete held to them.
    const targets: Array<TBaseModel> =
      await data.service.findRowsAndHoldDeleteToThem(data.deleteBy, {
        _id: true,
        projectId: true,
      } as Select<TBaseModel>);

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

  // Refused, with why, when going from one to the other breaks the built-in order.
  private static assertKeepsOrder(data: {
    definition: StateListDefinition;
    rowsBefore: Array<StateListRow>;
    rowsAfter: Array<StateListRow>;
  }): void {
    const violation: StateListOrderViolation | null =
      getStateListOrderViolationIntroduced(data);

    if (violation) {
      throw new BadDataException(
        getStateListOrderViolationMessage(data.definition, violation),
      );
    }
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
