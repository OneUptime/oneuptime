import type DatabaseService from "../../Services/DatabaseService";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import PartialEntity from "../../../Types/Database/PartialEntity";
import ObjectID from "../../../Types/ObjectID";

/*
 * A project uses exactly one of some kinds of row by default: its LLM
 * provider, its AI agent, its saved log, trace and metric view, its Twilio
 * config. Making one row the default takes the default from the project's
 * other rows of that kind.
 *
 * That is done here, from a service's onCreateSuccess or onUpdateSuccess:
 * once the row has been saved as the default, so after the caller has passed
 * every permission check and nothing else can refuse the write - a create or
 * update that is refused, or that fails for any other reason, leaves the
 * project's default where it was. Only the saved rows' own projects are
 * touched, and the rows that were just made the default keep it.
 *
 * The other rows are changed as root, because the caller may not be able to
 * see them all, and through the normal update path, so their own hooks and
 * workflows run as for any other change of the column.
 *
 * Some kinds have a default per group of a project's rows rather than one for
 * the whole project: a saved log view is the default of the page it was
 * saved on (its `scope`, issue #5549), so making one the default of a
 * cluster's Logs tab leaves the Logs page's default where it was. Such a kind
 * names the columns that make the group (`groupByColumns`); rows whose column
 * is empty are one group, as they always were.
 */

/*
 * The columns that split a project's rows into groups with a default each,
 * and a row's values in them.
 */
type RowGroup = Record<string, string | null>;

export default class ProjectDefaultRow {
  /*
   * For onCreateSuccess: when the row was created as its project's default,
   * no other row of that project - of its group, for a kind with groups -
   * stays the default.
   */
  public static async afterCreate<TBaseModel extends BaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    defaultColumn: string;
    createdItem: TBaseModel;
    groupByColumns?: Array<string> | undefined;
  }): Promise<void> {
    if (data.createdItem.getColumnValue(data.defaultColumn) !== true) {
      return;
    }

    const id: ObjectID | null = data.createdItem.id;
    const projectId: unknown = data.createdItem.getColumnValue("projectId");

    if (!id || !projectId) {
      return;
    }

    await ProjectDefaultRow.takeDefaultFromOtherRows({
      service: data.service,
      defaultColumn: data.defaultColumn,
      projectId: new ObjectID(projectId.toString()),
      group: ProjectDefaultRow.getRowGroup(
        data.createdItem,
        data.groupByColumns,
      ),
      keepIds: [id],
    });
  }

  /*
   * For onUpdateSuccess: when the update made rows the default, no other row
   * of their projects (of their groups) stays the default. Only the rows the
   * update actually wrote count, which DatabaseService hands onUpdateSuccess.
   */
  public static async afterUpdate<TBaseModel extends BaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    defaultColumn: string;
    updatedData: PartialEntity<TBaseModel>;
    updatedItemIds: Array<ObjectID>;
    groupByColumns?: Array<string> | undefined;
  }): Promise<void> {
    if (
      (data.updatedData as Record<string, unknown>)[data.defaultColumn] !==
        true ||
      data.updatedItemIds.length === 0
    ) {
      return;
    }

    const updatedRows: Array<TBaseModel> = await data.service.findBy({
      query: {
        _id: QueryHelper.any(data.updatedItemIds),
      } as Query<TBaseModel>,
      select: {
        _id: true,
        projectId: true,
        ...Object.fromEntries(
          (data.groupByColumns || []).map(
            (column: string): [string, boolean] => {
              return [column, true];
            },
          ),
        ),
      } as Select<TBaseModel>,
      limit: data.updatedItemIds.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    // Each project's rows, and within it each group's, have a default.
    const rowsByGroup: Map<
      string,
      { projectId: string; group: RowGroup; keepIds: Array<ObjectID> }
    > = new Map();

    for (const row of updatedRows) {
      const projectId: unknown = row.getColumnValue("projectId");

      if (!row.id || !projectId) {
        continue;
      }

      const group: RowGroup = ProjectDefaultRow.getRowGroup(
        row,
        data.groupByColumns,
      );
      const groupKey: string = JSON.stringify([projectId.toString(), group]);
      const rows: {
        projectId: string;
        group: RowGroup;
        keepIds: Array<ObjectID>;
      } = rowsByGroup.get(groupKey) || {
        projectId: projectId.toString(),
        group: group,
        keepIds: [],
      };
      rows.keepIds.push(row.id);
      rowsByGroup.set(groupKey, rows);
    }

    for (const rows of rowsByGroup.values()) {
      await ProjectDefaultRow.takeDefaultFromOtherRows({
        service: data.service,
        defaultColumn: data.defaultColumn,
        projectId: new ObjectID(rows.projectId),
        group: rows.group,
        keepIds: rows.keepIds,
      });
    }
  }

  // A row's values in the columns that make its group: an empty one is null.
  private static getRowGroup<TBaseModel extends BaseModel>(
    row: TBaseModel,
    groupByColumns: Array<string> | undefined,
  ): RowGroup {
    const group: RowGroup = {};

    for (const column of groupByColumns || []) {
      const value: unknown = row.getColumnValue(column);

      group[column] =
        value === null || value === undefined || value.toString() === ""
          ? null
          : value.toString();
    }

    return group;
  }

  private static async takeDefaultFromOtherRows<
    TBaseModel extends BaseModel,
  >(data: {
    service: DatabaseService<TBaseModel>;
    defaultColumn: string;
    projectId: ObjectID;
    group: RowGroup;
    keepIds: Array<ObjectID>;
  }): Promise<void> {
    const groupQuery: Record<string, unknown> = {};

    for (const [column, value] of Object.entries(data.group)) {
      groupQuery[column] = value === null ? QueryHelper.isNull() : value;
    }

    await data.service.updateBy({
      query: {
        ...groupQuery,
        projectId: data.projectId,
        [data.defaultColumn]: true,
        _id: QueryHelper.notInOrNull(data.keepIds),
      } as Query<TBaseModel>,
      data: {
        [data.defaultColumn]: false,
      } as unknown as PartialEntity<TBaseModel>,
      props: {
        isRoot: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
    });
  }
}
