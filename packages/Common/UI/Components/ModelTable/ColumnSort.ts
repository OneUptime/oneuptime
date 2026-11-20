import FieldType from "../Types/FieldType";
import ModelTableColumn from "./Column";
import {
  DISPLAY_NAME_COLUMNS,
  getDisplayNameColumn,
} from "../../Utils/ModelDisplayName";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Select from "../../../Types/BaseDatabase/Select";
import Sort from "../../../Types/BaseDatabase/Sort";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Dictionary from "../../../Types/Dictionary";
import { ListOrderSettings } from "../../../Types/Database/ListOrderColumn";
import RelationReadersUtil from "../../../Types/Database/RelationReadersUtil";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { JSONObject } from "../../../Types/JSON";
import {
  StateListDefinition,
  StateListEnd,
  getStateListOfTable,
} from "../../../Utils/StateOrder";

/*
 * Whether a column draws something of its own from a record's id - its
 * owners, a link, a status it reads elsewhere - rather than a field of the
 * record. Such a column is keyed by the id only because it needs one: sorted,
 * it ordered the list by the id - a random order under its name. The Owners
 * column of some sixty lists sorted so from its header, and a list drawn as
 * cards offered "Sort by Owners" (Table's TableCardsHeader). A column that
 * shows the id itself (an ObjectID column, "Incident ID") still sorts by it.
 */
export const isDrawnFromRecordId: <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(
  column: ModelTableColumn<TBaseModel>,
  key: keyof TBaseModel | null,
) => boolean = <TBaseModel extends BaseModel | AnalyticsBaseModel>(
  column: ModelTableColumn<TBaseModel>,
  key: keyof TBaseModel | null,
): boolean => {
  return key === "_id" && column.type === FieldType.Element;
};

/*
 * HOW A LIST IS SORTED BY A COLUMN THAT SHOWS A RELATED RECORD (#8134).
 *
 * An incident's severity and state, a monitor's status, an alert's monitor,
 * the user who created a record: each is a record of another table, and
 * the list's header did not sort by any of them - the shared table turned
 * sorting off for every relation, so "Severity" and "Monitor Status" could
 * not be clicked. The server orders a whole list through a relation, by one
 * field of the related record ({ incidentSeverity: { order: "ASC" } }: the
 * dashboard's list widgets read their lists so). This says which field, and
 * which way:
 *
 *  - A project's own ordered list (@ListOrderColumn) - a severity, a state,
 *    a monitor status, a postmortem or security case status, a case
 *    priority, a device role - sorts by its place in that list, which is
 *    what it means: by name, High would come before Low and Critical after
 *    both. A severity, a state or a status (Utils/StateOrder) is read the
 *    way the dashboard's list widgets read it: its value is how bad it is,
 *    so descending is worst first - the most severe incident, the offline
 *    monitor, the incident nobody has acknowledged yet on top - and the
 *    header's first click goes that way (firstSortOrder). Any other ordered
 *    list runs as its settings page lists it when ascending.
 *  - Anything else sorts by the name the column shows: the related record's
 *    name column (ModelDisplayName) among the fields the column selects, or
 *    the one field it names (selectedProperty). A to Z ascending.
 *
 * Only a field the server lets a read take through the relation
 * (canReadOnRelationQuery), and never a hashed or encrypted one, whose
 * stored value orders nothing a person reads.
 *
 * A column of many related records (labels, monitors, owners) gets none:
 * a row has no one value to be ordered by. Nor does a relation column that
 * selects no name: what it draws is not something the list can be ordered
 * by.
 */
export interface RelationColumnSort {
  // The relation the column shows: "incidentSeverity".
  relation: string;
  // The related record's field the list is ordered by: "order", "name".
  field: string;
  // The order of that field when the column is sorted ascending.
  ascendingOrder: SortOrder;
  /*
   * Where the header's first click takes the column: descending, worst
   * first, for a severity, a state or a status. Unset, the first click
   * turns the list's current direction round, as on any other column.
   */
  firstSortOrder?: SortOrder | undefined;
}

/*
 * The column types a name is held in: words a person reads and compares
 * as words. Not a description, a JSON document or a hashed value.
 */
const NAME_COLUMN_TYPES: ReadonlyArray<TableColumnType> = [
  TableColumnType.Name,
  TableColumnType.ShortText,
  TableColumnType.LongText,
  TableColumnType.Email,
  TableColumnType.Phone,
  TableColumnType.Domain,
  TableColumnType.ShortURL,
  TableColumnType.LongURL,
  TableColumnType.Slug,
];

const flipSortOrder: (order: SortOrder) => SortOrder = (
  order: SortOrder,
): SortOrder => {
  return order === SortOrder.Ascending
    ? SortOrder.Descending
    : SortOrder.Ascending;
};

/*
 * Whether a read of a list may order it through a relation by this field
 * of the related record, and select it there: the server takes only the
 * fields a relation read may (canReadOnRelationQuery) - for every reader of
 * the list only a label every reader of the relation reads, never one it
 * reads for some of them alone (RelationReaders.ColumnReaders, #10281) - and
 * a hashed or encrypted value is stored as nothing a person could read.
 */
const isOrderableThroughRelation: (
  relatedModel: BaseModel,
  field: string,
) => boolean = (relatedModel: BaseModel, field: string): boolean => {
  if (!relatedModel.hasColumn(field)) {
    return false;
  }

  const metadata: TableColumnMetadata =
    relatedModel.getTableColumnMetadata(field);

  return Boolean(
    metadata &&
      RelationReadersUtil.isReadByEveryReaderOfTheRelation(metadata) &&
      !metadata.hashed &&
      !metadata.encrypted,
  );
};

/*
 * The related record's place in its project's list, when its records are
 * one (@ListOrderColumn): the order that list means.
 */
const getListOrderSort: (
  relation: string,
  relatedModel: BaseModel,
) => RelationColumnSort | null = (
  relation: string,
  relatedModel: BaseModel,
): RelationColumnSort | null => {
  const listOrder: ListOrderSettings | null = relatedModel.getListOrder();

  if (
    !listOrder ||
    !isOrderableThroughRelation(relatedModel, listOrder.column)
  ) {
    return null;
  }

  // The order of the number that lists the top of the list first.
  const topFirst: SortOrder = listOrder.sortOrder;

  const stateList: StateListDefinition | null = getStateListOfTable(
    relatedModel.tableName,
  );

  if (!stateList) {
    return {
      relation: relation,
      field: listOrder.column,
      ascendingOrder: topFirst,
    };
  }

  // Descending is worst first: the end of the list that needs someone.
  const worstFirst: SortOrder =
    stateList.worstAt === StateListEnd.Top ? topFirst : flipSortOrder(topFirst);

  return {
    relation: relation,
    field: listOrder.column,
    ascendingOrder: flipSortOrder(worstFirst),
    firstSortOrder: SortOrder.Descending,
  };
};

/*
 * The name the column shows of the related record: the one field it names
 * (selectedProperty), or the record's name column among the fields it
 * selects, in the order ModelDisplayName picks a name in.
 */
const getShownNameField: <TBaseModel extends BaseModel | AnalyticsBaseModel>(
  relation: string,
  relatedModel: BaseModel,
  column: ModelTableColumn<TBaseModel>,
) => string | null = <TBaseModel extends BaseModel | AnalyticsBaseModel>(
  relation: string,
  relatedModel: BaseModel,
  column: ModelTableColumn<TBaseModel>,
): string | null => {
  const isName: (field: string) => boolean = (field: string): boolean => {
    return (
      isOrderableThroughRelation(relatedModel, field) &&
      NAME_COLUMN_TYPES.includes(
        relatedModel.getTableColumnMetadata(field).type,
      )
    );
  };

  if (column.selectedProperty) {
    return isName(column.selectedProperty) ? column.selectedProperty : null;
  }

  const relationSelect: unknown = (column.field as Dictionary<unknown>)[
    relation
  ];

  if (!relationSelect || typeof relationSelect !== "object") {
    return null;
  }

  const selected: Array<string> = Object.keys(relationSelect).filter(
    (field: string): boolean => {
      return (relationSelect as Dictionary<unknown>)[field] === true;
    },
  );

  const candidates: Array<string> = [];
  const declaredNameColumn: string | null = getDisplayNameColumn(relatedModel);

  if (declaredNameColumn) {
    candidates.push(declaredNameColumn);
  }

  candidates.push(...DISPLAY_NAME_COLUMNS);

  for (const candidate of candidates) {
    if (selected.includes(candidate) && isName(candidate)) {
      return candidate;
    }
  }

  return null;
};

/*
 * How the list is sorted by this column, when the column shows one related
 * record the list can be ordered by; null for every other column.
 */
export const getRelationColumnSort: <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(
  model: TBaseModel,
  column: ModelTableColumn<TBaseModel>,
) => RelationColumnSort | null = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(
  model: TBaseModel,
  column: ModelTableColumn<TBaseModel>,
): RelationColumnSort | null => {
  if (!(model instanceof BaseModel) || !column.field) {
    return null;
  }

  const relation: string | undefined = Object.keys(column.field)[0];

  if (!relation || !model.hasColumn(relation)) {
    return null;
  }

  const metadata: TableColumnMetadata = model.getTableColumnMetadata(relation);

  // One related record: a list of them gives a row no one value.
  if (metadata.type !== TableColumnType.Entity || !metadata.modelType) {
    return null;
  }

  const relatedModel: BaseModel = new metadata.modelType();

  const listOrderSort: RelationColumnSort | null = getListOrderSort(
    relation,
    relatedModel,
  );

  if (listOrderSort) {
    return listOrderSort;
  }

  const nameField: string | null = getShownNameField(
    relation,
    relatedModel,
    column,
  );

  if (!nameField) {
    return null;
  }

  return {
    relation: relation,
    field: nameField,
    ascendingOrder: SortOrder.Ascending,
  };
};

/*
 * The key a column's header sorts on - what a table's sortBy holds, on the
 * URL and in a saved view: the column's first field, or the property of it
 * the column shows (selectedProperty: "project.name"). Null for a column
 * with no field.
 */
export const getColumnSortKey: <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(
  column: ModelTableColumn<TBaseModel>,
) => string | null = <TBaseModel extends BaseModel | AnalyticsBaseModel>(
  column: ModelTableColumn<TBaseModel>,
): string | null => {
  const key: string | undefined = column.field
    ? Object.keys(column.field)[0]
    : undefined;

  if (!key) {
    return null;
  }

  return column.selectedProperty ? `${key}.${column.selectedProperty}` : key;
};

/*
 * How the list is sorted by each of these columns that shows a related
 * record, by the key its header sorts on (getColumnSortKey). The first
 * column with a key decides it, as the header the key highlights is the
 * first.
 */
export const getRelationColumnSorts: <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(
  model: TBaseModel,
  columns: Array<ModelTableColumn<TBaseModel>>,
) => Map<string, RelationColumnSort> = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(
  model: TBaseModel,
  columns: Array<ModelTableColumn<TBaseModel>>,
): Map<string, RelationColumnSort> => {
  const sorts: Map<string, RelationColumnSort> = new Map();
  const seen: Set<string> = new Set();

  for (const column of columns) {
    const sortKey: string | null = getColumnSortKey<TBaseModel>(column);

    if (!sortKey || seen.has(sortKey)) {
      continue;
    }

    seen.add(sortKey);

    const relationSort: RelationColumnSort | null =
      getRelationColumnSort<TBaseModel>(model, column);

    if (relationSort) {
      sorts.set(sortKey, relationSort);
    }
  }

  return sorts;
};

/*
 * The order the server reads a list sorted by a relation column in: the
 * related record's field under the relation, which way the column runs.
 * Rows with no related record stay at the bottom both ways - Postgres puts
 * them last on an ascending order already, so only a descending one says
 * so.
 */
export const getRelationColumnSortValue: (
  relationSort: RelationColumnSort,
  sortOrder: SortOrder,
) => JSONObject = (
  relationSort: RelationColumnSort,
  sortOrder: SortOrder,
): JSONObject => {
  const order: SortOrder =
    sortOrder === SortOrder.Descending
      ? flipSortOrder(relationSort.ascendingOrder)
      : relationSort.ascendingOrder;

  return {
    [relationSort.relation]: {
      [relationSort.field]:
        order === SortOrder.Ascending
          ? order
          : { direction: order, nulls: "LAST" },
    },
  };
};

/*
 * Whether a sort key names a relation of a database model, or a field of
 * one ("project.name"), rather than one of its own columns.
 */
const isRelationSortKey: (
  model: BaseModel | AnalyticsBaseModel,
  sortBy: string,
) => boolean = (
  model: BaseModel | AnalyticsBaseModel,
  sortBy: string,
): boolean => {
  if (!(model instanceof BaseModel)) {
    return false;
  }

  if (sortBy.includes(".")) {
    return true;
  }

  return model.hasColumn(sortBy) && model.isEntityColumn(sortBy);
};

/*
 * The order a table asks the server for when sorted by the column with
 * this key: the related record's field for a relation column
 * (relationSorts, by the key the header sorts on), the column itself for
 * any other, and none when nothing is sorted.
 *
 * None either for a relation the list cannot be ordered by, or for a key
 * the model has no column for: a link or a saved view made before a column
 * changed can still name one, and the server refuses an order by it
 * ({ labels: "ASC" }, { oldColumn: "ASC" }) - the whole list would fail to
 * load. It is read in its own order instead.
 */
export const getColumnSortForRead: <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(data: {
  model: TBaseModel;
  sortBy: string | null | undefined;
  sortOrder: SortOrder;
  relationSorts: Map<string, RelationColumnSort>;
}) => Sort<TBaseModel> = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(data: {
  model: TBaseModel;
  sortBy: string | null | undefined;
  sortOrder: SortOrder;
  relationSorts: Map<string, RelationColumnSort>;
}): Sort<TBaseModel> => {
  if (!data.sortBy) {
    return {} as Sort<TBaseModel>;
  }

  const relationSort: RelationColumnSort | undefined = data.relationSorts.get(
    data.sortBy,
  );

  if (relationSort) {
    return getRelationColumnSortValue(
      relationSort,
      data.sortOrder,
    ) as unknown as Sort<TBaseModel>;
  }

  if (isRelationSortKey(data.model, data.sortBy)) {
    return {} as Sort<TBaseModel>;
  }

  /*
   * None either for a key its model has no column for: a link or a saved
   * view sorted by a column renamed or removed since, or an address someone
   * edited (?sortBy=). The server refuses a sort by it (#8141), so the whole
   * list would fail to load; it is read in its own order instead, and no
   * header is highlighted (#8841). A telemetry list's attribute
   * ("attributes.region") is no column either: it cannot order a list yet
   * (#8140).
   */
  if (!data.model.hasColumn(data.sortBy)) {
    return {} as Sort<TBaseModel>;
  }

  return { [data.sortBy]: data.sortOrder } as Sort<TBaseModel>;
};

/*
 * The select with the related field the list is ordered by added to its
 * relation's, when the list is sorted by a relation column. The database
 * orders by a field it does not hand back - but not on TypeORM's own read
 * of a page that joins to many (PagedFind stands aside on any other
 * TypeORM), which orders by what it selected, so the field is selected as
 * the dashboard's list widgets select theirs. A new object; the select
 * handed in is not changed.
 */
export const withRelationColumnSortSelect: <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(data: {
  select: Select<TBaseModel>;
  sortBy: string | null | undefined;
  relationSorts: Map<string, RelationColumnSort>;
}) => Select<TBaseModel> = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(data: {
  select: Select<TBaseModel>;
  sortBy: string | null | undefined;
  relationSorts: Map<string, RelationColumnSort>;
}): Select<TBaseModel> => {
  const relationSort: RelationColumnSort | undefined = data.sortBy
    ? data.relationSorts.get(data.sortBy)
    : undefined;

  if (!relationSort) {
    return data.select;
  }

  const existing: unknown = (data.select as Dictionary<unknown>)[
    relationSort.relation
  ];

  return {
    ...data.select,
    [relationSort.relation]: {
      ...(existing && typeof existing === "object"
        ? (existing as JSONObject)
        : {}),
      [relationSort.field]: true,
    },
  } as Select<TBaseModel>;
};
