import { TableAccessControl } from "../../BaseDatabase/AccessControl";
import GenericFunction from "../../GenericFunction";
import Permission from "../../Permission";
import {
  ProductLevelOperation,
  withProductLevels,
} from "../../Product/ProductLevels";

// The property of a model that holds each operation's list.
const LIST_PROPERTY: Readonly<Record<ProductLevelOperation, string>> = {
  create: "createRecordPermissions",
  read: "readRecordPermissions",
  update: "updateRecordPermissions",
  delete: "deleteRecordPermissions",
};

const OPERATIONS: ReadonlyArray<ProductLevelOperation> = [
  "create",
  "read",
  "update",
  "delete",
];

/*
 * Who may create, read, change and delete a model's records: the lists it
 * declares, read with the levels of the product whose records they are
 * (Types/Product/ProductLevels: Cloud Admin wherever a Cloud table lets in
 * Project Admin, and so on). Read as the list is asked for, by the model's
 * own table name, so it holds whichever decorator ran first; every reader -
 * the server's checks, a custom route's, the Dashboard's - gets the same
 * list, and a table of no product gets exactly what it declares.
 */
export default (accessControl: TableAccessControl) => {
  return (ctr: GenericFunction) => {
    for (const operation of OPERATIONS) {
      const declared: Array<Permission> | undefined = accessControl[operation];

      if (!declared) {
        continue;
      }

      Object.defineProperty(ctr.prototype, LIST_PROPERTY[operation], {
        configurable: true,
        enumerable: true,
        get: function (this: { tableName?: string }): Array<Permission> {
          return withProductLevels({
            tableName: this.tableName,
            operation: operation,
            permissions: declared,
          });
        },
      });
    }
  };
};
