import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { ListOrderSettings } from "../../Types/Database/ListOrderColumn";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import { JSONObject } from "../../Types/JSON";
import {
  StateListBuiltIn,
  StateListDefinition,
  getStateListOfTable,
} from "../StateOrder";

/*
 * WHAT A DRAG-ORDERED LIST'S NUMBER MEANS, FOR THOSE WHO WRITE IT FROM
 * OUTSIDE (issue #9609).
 *
 * Every model marked @ListOrderColumn is a list kept in order by a number
 * column: severities, states, monitor statuses, custom fields, a status
 * page's links, pipelines, filters, rules. A write of the number places
 * that row and moves no other, so a Terraform configuration that numbers a
 * whole list is applied exactly as written; moving a row past others is a
 * request of its own (POST <path>/:id/move), which numbers the list again.
 *
 * The OpenAPI spec carries these facts on each such model's tag
 * (x-oneuptime-list-order), and the Terraform provider's generator writes
 * the Order section of the resource's page from them: which attribute is
 * the number, which end is the top, what one row and many are called, what
 * holds the list, where a row created without a number goes, and which
 * built-in rows keep their order.
 */
export interface ListOrderFacts {
  // The number column, as the API names it: order, sortOrder or priority.
  column: string;
  // Whether the top of the list is its highest number.
  descending: boolean;
  // One row and many, in a sentence: "incident severity", "incident severities".
  singular: string;
  plural: string;
  // What holds the list, in a sentence: "project", "status page", "log pipeline".
  parent: string;
  // A column that splits the parent's rows into lists of their own: "event type".
  sameAs?: string | undefined;
  // The built-in row a row created without a number goes just above: "resolved state".
  insertsAbove?: string | undefined;
  // The built-in rows that keep their order, top first: "created state", ...
  keepsInOrder?: Array<string> | undefined;
}

// What a model is to these facts: its names, its columns and its list.
export interface ListOrderModel {
  tableName?: string | null | undefined;
  singularName?: string | null | undefined;
  pluralName?: string | null | undefined;
  getListOrder: () => ListOrderSettings | null;
  getTenantColumn: () => string | null;
  getTableColumns: () => { columns: Array<string> };
  getTableColumnMetadata: (column: string) => TableColumnMetadata | undefined;
}

/*
 * A name as a sentence writes it: lower case, but for a word written in
 * capitals (SLA, AI), which stays as it is. "Incident SLA Rule" is
 * "incident SLA rule".
 */
export const toListOrderProse: (name: string) => string = (
  name: string,
): string => {
  return name
    .trim()
    .split(/\s+/)
    .map((word: string): string => {
      return word.length > 1 && word === word.toUpperCase()
        ? word
        : word.toLowerCase();
    })
    .join(" ");
};

// What a column that names a list is called: its relation's title, or its own.
const titleOfListColumn: (model: ListOrderModel, column: string) => string = (
  model: ListOrderModel,
  column: string,
): string => {
  for (const candidate of model.getTableColumns().columns) {
    const metadata: TableColumnMetadata | undefined =
      model.getTableColumnMetadata(candidate);

    if (metadata?.manyToOneRelationColumn === column && metadata.title) {
      return metadata.title;
    }
  }

  const own: string = model.getTableColumnMetadata(column)?.title || column;

  return own.replace(/\s+ID$/i, "");
};

/*
 * The facts of a drag-ordered list, or null for a model that is not one.
 */
export const getListOrderFacts: (
  model: ListOrderModel,
) => ListOrderFacts | null = (model: ListOrderModel): ListOrderFacts | null => {
  const settings: ListOrderSettings | null = model.getListOrder();

  if (!settings || !settings.column) {
    return null;
  }

  const tenantColumn: string | null = model.getTenantColumn();
  const listColumns: Array<string> = settings.scopeColumns.filter(
    (column: string): boolean => {
      return column !== tenantColumn;
    },
  );

  const isIdColumn: (column: string) => boolean = (column: string): boolean => {
    return (
      model.getTableColumnMetadata(column)?.type === TableColumnType.ObjectID
    );
  };

  const parentColumn: string | undefined = listColumns.find(isIdColumn);
  const sameAsColumn: string | undefined = listColumns.find(
    (column: string): boolean => {
      return !isIdColumn(column);
    },
  );

  const facts: ListOrderFacts = {
    column: settings.column,
    descending: settings.sortOrder === SortOrder.Descending,
    singular: toListOrderProse(model.singularName || model.tableName || ""),
    plural: toListOrderProse(model.pluralName || model.tableName || ""),
    parent: parentColumn
      ? toListOrderProse(titleOfListColumn(model, parentColumn))
      : "project",
  };

  if (sameAsColumn) {
    facts.sameAs = toListOrderProse(titleOfListColumn(model, sameAsColumn));
  }

  const stateList: StateListDefinition | null = getStateListOfTable(
    model.tableName,
  );

  if (stateList?.insertAboveFlag) {
    const anchor: StateListBuiltIn | undefined = stateList.builtIns.find(
      (builtIn: StateListBuiltIn): boolean => {
        return builtIn.flag === stateList.insertAboveFlag;
      },
    );

    if (anchor) {
      facts.insertsAbove = anchor.role;
    }
  }

  if (stateList?.keepsBuiltInOrder && stateList.builtIns.length > 1) {
    facts.keepsInOrder = stateList.builtIns.map(
      (builtIn: StateListBuiltIn): string => {
        return builtIn.role;
      },
    );
  }

  return facts;
};

// The facts as the OpenAPI spec writes them on a tag (x-oneuptime-list-order).
export const listOrderFactsToJSON: (facts: ListOrderFacts) => JSONObject = (
  facts: ListOrderFacts,
): JSONObject => {
  const json: JSONObject = {
    column: facts.column,
    descending: facts.descending,
    singular: facts.singular,
    plural: facts.plural,
    parent: facts.parent,
  };

  if (facts.sameAs) {
    json["sameAs"] = facts.sameAs;
  }

  if (facts.insertsAbove) {
    json["insertsAbove"] = facts.insertsAbove;
  }

  if (facts.keepsInOrder) {
    json["keepsInOrder"] = facts.keepsInOrder;
  }

  return json;
};
