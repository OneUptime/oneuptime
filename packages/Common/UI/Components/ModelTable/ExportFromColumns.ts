import Column from "./Column";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

/*
 * Derives the fields a ModelTable column contributes to a CSV export from its
 * column definition, and mirrors getSelectFromColumns: a column may declare
 * MORE THAN ONE field when its cell is composed from several of them, and all
 * of them are fetched. The Table column's `key` only ever holds the first, so
 * an exporter reading `key` alone drops the rest - the alert "Affected
 * Resources" cell spans hosts / kubernetesClusters / dockerHosts /
 * podmanHosts / services, and only the hosts made it into the file.
 */

export function getExportKeysFromColumn<
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(data: {
  column: Column<TBaseModel>;
  /*
   * The key the Table column renders and sorts by. It is the first declared
   * field, with `selectedProperty` appended when the column picks a single
   * property off a relation ("label.name"), so the export reads the same path
   * the cell does.
   */
  columnKey: string | null;
  /*
   * Secondary fields are gated on this exactly as they are in the select: a
   * field the caller cannot read was never fetched, so exporting it would
   * only ever produce an empty cell.
   */
  hasPermissionToReadField?: ((field: string) => boolean) | undefined;
}): Array<string> {
  const exportKeys: Array<string> = [];

  if (data.columnKey) {
    exportKeys.push(data.columnKey);
  }

  if (!data.column.field) {
    return exportKeys;
  }

  const declaredKeys: Array<string> = Object.keys(data.column.field);

  // The primary field is already covered by columnKey.
  for (const key of declaredKeys.slice(1)) {
    if (data.hasPermissionToReadField && !data.hasPermissionToReadField(key)) {
      continue;
    }

    if (!exportKeys.includes(key)) {
      exportKeys.push(key);
    }
  }

  return exportKeys;
}
