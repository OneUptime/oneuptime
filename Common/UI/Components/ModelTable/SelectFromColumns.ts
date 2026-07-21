import Columns from "./Columns";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Select from "../../../Types/BaseDatabase/Select";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import { Logger } from "../../Utils/Logger";

/*
 * Builds the API `select` for a ModelTable from its column definitions.
 *
 * A column may declare MORE THAN ONE field when its cell renders a value
 * composed from several columns — e.g. a "Nodes" cell that renders
 * `{onlineNodeCount}/{nodeCount} online` declares
 * `field: { nodeCount: true, onlineNodeCount: true }`.
 *
 * These used to select only the FIRST key, which left every other declared
 * field `undefined` on the fetched row, so such cells silently rendered
 * their zero/empty fallback — a fully online Proxmox cluster displayed
 * "0/3 online" (OneUptime/oneuptime#2756). ModelDetail has always selected
 * every declared key; these helpers keep ModelTable in sync with it.
 */

export function getSelectFromColumns<
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(data: {
  columns: Columns<TBaseModel>;
  model: TBaseModel;
  /*
   * Secondary fields are gated on this. The API rejects the WHOLE request
   * with NotAuthorizedException when the select names a column the caller
   * cannot read (Common/Server/Types/Database/Permissions/SelectPermission
   * .checkSelectPermission), so a secondary field the user has no read
   * permission on must be dropped rather than blank the table for them.
   * Primary fields are left exactly as they always were.
   */
  hasPermissionToReadField?: ((field: string) => boolean) | undefined;
}): Select<TBaseModel> {
  const selectFields: Select<TBaseModel> = {
    _id: true,
  };

  for (const column of data.columns) {
    if (!column.field) {
      continue;
    }

    const keys: Array<string> = Object.keys(column.field);

    for (const key of keys) {
      const isPrimaryField: boolean = key === keys[0];

      if (!data.model.hasColumn(key)) {
        if (isPrimaryField) {
          /*
           * Only the primary field is a hard error — it is also the key
           * used for sorting and for the default cell renderer, so a bad
           * one is a genuine mistake.
           */
          throw new BadDataException(
            `${key} column not found on ${data.model.singularName}`,
          );
        }

        /*
         * A stray secondary key degrades to "not selected" rather than
         * throwing, because throwing here blanks the entire page. Log it:
         * silently dropping it is what produced #2756 in the first place.
         */
        Logger.error(
          `ModelTable column "${column.title}" on ${data.model.singularName} declares field "${key}", which is not a column on the model. It will not be fetched, so the cell will render its empty value.`,
        );
        continue;
      }

      if (
        !isPrimaryField &&
        data.hasPermissionToReadField &&
        !data.hasPermissionToReadField(key)
      ) {
        continue;
      }

      (selectFields as Dictionary<boolean>)[key] = true;
    }
  }

  return selectFields;
}

export function getRelationSelectFromColumns<
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(data: {
  columns: Columns<TBaseModel>;
  model: TBaseModel;
}): Select<TBaseModel> {
  const relationSelect: Select<TBaseModel> = {};

  for (const column of data.columns) {
    if (!column.field) {
      continue;
    }

    /*
     * Same multi-field contract as getSelectFromColumns: one cell can
     * render several relations (e.g. an alert "Resource" cell spanning
     * hosts / kubernetesClusters / dockerHosts / podmanHosts / services).
     */
    for (const key of Object.keys(column.field)) {
      if (data.model.isFileColumn(key)) {
        (relationSelect as JSONObject)[key] = {
          file: true,
          _id: true,
          fileType: true,
          name: true,
        };
      } else if (data.model.isEntityColumn(key)) {
        (relationSelect as JSONObject)[key] = {
          ...(((relationSelect as JSONObject)[key] as JSONObject) || {}),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...((column.field as any)[key] as JSONObject),
        };
      }
    }
  }

  return relationSelect;
}
