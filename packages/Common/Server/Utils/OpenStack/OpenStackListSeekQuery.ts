import { FindOperator, Raw } from "typeorm";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { OpenStackListSeekValue } from "../../../Types/OpenStack/OpenStackListSeek";

/*
 * Where a list's next page starts, as what to look for. A row with no value in the column sorts past
 * every row that has one, ascending, and before them descending, so a seek can take two reads, each
 * of them on the index: what follows in the column, then the ones with nothing there, by `_id`.
 *
 * Written as `>=` with the tie apart, and not as a row comparison or an OR of the two, because that
 * is what Postgres can start an index scan from. An OR makes it walk from the start of the kind.
 */

export interface OpenStackListSeekRead {
  // What this read looks for in the sorted column.
  columnQuery: FindOperator<unknown>;
  // Only `_id` when the column has nothing in it to go by.
  isByIdOnly: boolean;
}

function idColumnOf(alias: string): string {
  // The column as the query builder spells it, on the same table.
  return alias.replace(/"[^"]*"$/, '"_id"');
}

function hasNoValueAfter(id: string): FindOperator<unknown> {
  return Raw(
    (alias: string): string => {
      return `(${alias} IS NULL AND ${idColumnOf(alias)} > :openStackSeekId)`;
    },
    { openStackSeekId: id },
  );
}

function hasNoValue(): FindOperator<unknown> {
  return Raw((alias: string): string => {
    return `${alias} IS NULL`;
  });
}

function hasValue(): FindOperator<unknown> {
  return Raw((alias: string): string => {
    return `${alias} IS NOT NULL`;
  });
}

function followsInColumn(data: {
  value: string | number;
  id: string;
  order: SortOrder;
}): FindOperator<unknown> {
  const isAscending: boolean = data.order === SortOrder.Ascending;

  return Raw(
    (alias: string): string => {
      return `(${alias} ${isAscending ? ">=" : "<="} :openStackSeekValue
        AND (${alias} ${isAscending ? ">" : "<"} :openStackSeekValue
          OR ${idColumnOf(alias)} > :openStackSeekId))`;
    },
    { openStackSeekValue: data.value, openStackSeekId: data.id },
  );
}

export function getOpenStackListSeekReads(data: {
  value: OpenStackListSeekValue;
  id: string;
  order: SortOrder;
}): Array<OpenStackListSeekRead> {
  const isAscending: boolean = data.order === SortOrder.Ascending;

  if (data.value === null) {
    return isAscending
      ? [{ columnQuery: hasNoValueAfter(data.id), isByIdOnly: true }]
      : [
          { columnQuery: hasNoValueAfter(data.id), isByIdOnly: true },
          { columnQuery: hasValue(), isByIdOnly: false },
        ];
  }

  const following: OpenStackListSeekRead = {
    columnQuery: followsInColumn({
      value: data.value,
      id: data.id,
      order: data.order,
    }),
    isByIdOnly: false,
  };

  return isAscending
    ? [following, { columnQuery: hasNoValue(), isByIdOnly: true }]
    : [following];
}
