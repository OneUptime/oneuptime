import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ReflectionMetadataType } from "../../Reflection";
import "reflect-metadata";

/*
 * WHY THIS DECORATOR EXISTS, AND WHY @ColumnAccessControl COULD NOT DO THE JOB.
 *
 * @ColumnAccessControl lists the PERMISSIONS that may read a column, and the
 * permission layer satisfies it by intersecting that list with the permissions
 * the caller holds. That works for "only a billing admin may read this", and it
 * is useless for "only the person this row belongs to may read this", for one
 * blunt reason: Permission.CurrentUser is auto-granted to every authenticated
 * caller (DatabaseCommonInteractionPropsUtil.getUserPermissions pushes it onto
 * the global permission list whenever props.userId is set). A column list of
 * [CurrentUser] therefore admits EVERY logged-in user in the project, including
 * an administrator reading somebody else's row. Row scoping has only ever come
 * from the TABLE list, never from a column list, and no arrangement of column
 * lists can restrict which VALUES a caller sees.
 *
 * So the marking here carries no permissions at all. It says one thing:
 *
 *   this column may be read only by a query that is pinned to the row's owner.
 *
 * What "pinned" means, and every route by which a marked column can be reached
 * (a top-level select, a select nested through a relation, a sort key injected
 * into the select after the permission check, and a WHERE predicate used to
 * probe values), is enforced by OwnerOnlyColumnPermission on the server. This
 * file is only the mark.
 *
 * Mark credentials, secrets, verification codes and directly-addressable
 * delivery targets - a phone number, an email address, a webhook URL, a device
 * token. Do NOT mark the labels an administrator legitimately needs in order to
 * see that a row exists and what kind of thing it is: a webhook's name, a
 * device's name and type, a verification flag, the owning user id. An admin
 * surface that cannot name the rows it is administering is not a feature.
 */

const ownerOnlyColumnSymbol: symbol = Symbol("OwnerOnlyColumn");

export default (): ReflectionMetadataType => {
  return Reflect.metadata(ownerOnlyColumnSymbol, true);
};

type IsOwnerOnlyColumnFunction = <T extends BaseModel>(
  target: T,
  propertyKey: string,
) => boolean;

/**
 * True when the named column of this model is marked owner-only. Reads through
 * the prototype chain, so a model that extends another inherits its marks.
 */
export const isOwnerOnlyColumn: IsOwnerOnlyColumnFunction = <
  T extends BaseModel,
>(
  target: T,
  propertyKey: string,
): boolean => {
  return (
    Reflect.getMetadata(ownerOnlyColumnSymbol, target, propertyKey) === true
  );
};

type GetOwnerOnlyColumnsFunction = <T extends BaseModel>(
  target: T,
) => Array<string>;

/**
 * Every owner-only column on this model. Enumerating requires the property to
 * exist on the instance, which it does for every declared column because model
 * columns are initialised to `undefined` in the class body - the same
 * assumption getTableColumns() already makes.
 */
export const getOwnerOnlyColumns: GetOwnerOnlyColumnsFunction = <
  T extends BaseModel,
>(
  target: T,
): Array<string> => {
  const columns: Array<string> = [];

  for (const key of Object.keys(target)) {
    if (Reflect.getMetadata(ownerOnlyColumnSymbol, target, key) === true) {
      columns.push(key);
    }
  }

  return columns;
};
