import Permission from "Common/Types/Permission";
import ProductKey from "Common/Types/Product/ProductKey";
import {
  getProductLevelOfPermission,
  ROLE_FOLLOWED_BY_LEVEL,
} from "Common/Types/Product/ProductLevels";
import { expect } from "@jest/globals";

/*
 * A PRODUCT'S LEVELS IN A LIST OF WHO MAY DO SOMETHING, AS THE DOCS NAME
 * THEM (#10289).
 *
 * A product's levels follow the project-wide roles on the product's own
 * records - its Viewer as Viewer, its Member as Project Member, its Admin
 * as Project Admin - and the docs describe them once, for every product, on
 * the permissions page (permissions/index.md, "Product levels"), not on
 * each page that names who may read or change a record: the Dashboards and
 * Forms tables leave them to it too.
 *
 * withoutProductLevels hands a page's facts the permissions it names, and
 * holds every level it leaves out to the record's product and to a role the
 * list itself names, so a level of another product, or one that follows a
 * role the page does not name, still fails the page's check.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */
export function withoutProductLevels(data: {
  permissions: ReadonlyArray<Permission>;
  product: ProductKey;
}): Array<Permission> {
  const named: Array<Permission> = [];

  for (const permission of data.permissions) {
    const level: ReturnType<typeof getProductLevelOfPermission> =
      getProductLevelOfPermission(permission);

    if (!level) {
      named.push(permission);
      continue;
    }

    expect({
      permission,
      product: level.product,
      followsARoleTheListNames: data.permissions.includes(
        ROLE_FOLLOWED_BY_LEVEL[level.level],
      ),
    }).toEqual({
      permission,
      product: data.product,
      followsARoleTheListNames: true,
    });
  }

  return named;
}
