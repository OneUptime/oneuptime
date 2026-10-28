import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import NetworkAddressName from "../../../Models/DatabaseModels/NetworkAddressName";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import TableColumnType from "../../../Types/Database/TableColumnType";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../../Types/Database/TableColumn";
import { getUniqueColumnBy } from "../../../Types/Database/UniqueColumnBy";
import Dictionary from "../../../Types/Dictionary";
import IconProp from "../../../Types/Icon/IconProp";
import Permission from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";

/*
 * An Address Name (issue #5340): a name someone gave an IP address or a
 * subnet, which the Traffic pages show the address by. Naming addresses is
 * part of keeping the network: whoever may add, change or remove the
 * project's network devices may name its addresses - no new permissions to
 * learn or grant - and whoever reads the devices reads the names. These
 * tests pin what it is and who may do what with it.
 */

const model: NetworkAddressName = new NetworkAddressName();
const access: Dictionary<ColumnAccessControl> =
  model.getColumnAccessControlForAllColumns();
const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);

const READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadNetworkDevice,
];

const CREATORS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.CreateNetworkDevice,
];

const EDITORS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.EditNetworkDevice,
];

const DELETERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.DeleteNetworkDevice,
];

function accessOf(column: string): ColumnAccessControl {
  const control: ColumnAccessControl | undefined = access[column];

  expect({ column, defined: control !== undefined }).toEqual({
    column,
    defined: true,
  });

  return control!;
}

function columnOf(column: string): TableColumnMetadata {
  const metadata: TableColumnMetadata | undefined = columns[column];

  expect({ column, defined: metadata !== undefined }).toEqual({
    column,
    defined: true,
  });

  return metadata!;
}

function databaseColumnOf(propertyName: string): ColumnMetadataArgs {
  const found: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
    .columns.filter((args: ColumnMetadataArgs): boolean => {
      return (
        args.target === NetworkAddressName && args.propertyName === propertyName
      );
    })
    .pop();

  expect({ propertyName, found: Boolean(found) }).toEqual({
    propertyName,
    found: true,
  });

  return found!;
}

describe("NetworkAddressName: what it is", () => {
  test("its table, its names and its icon", () => {
    expect(model.tableName).toBe("NetworkAddressName");
    expect(model.singularName).toBe("Address Name");
    expect(model.pluralName).toBe("Address Names");
    expect(model.icon).toBe(IconProp.Label);
    expect(model.tableDescription).toBeTruthy();
  });

  test("its API lives at /network-address-name and is documented", () => {
    expect(model.getCrudApiPath()?.toString()).toBe("/network-address-name");
    expect(model.enableDocumentation).toBe(true);
  });

  test("it is one of the database's models, and a project's", () => {
    expect(
      (AllModelTypes as Array<{ new (): BaseModel }>).includes(
        NetworkAddressName,
      ),
    ).toBe(true);
    expect(model.getTenantColumn()).toBe("projectId");
  });

  test("it is on every plan", () => {
    expect(model.getCreateBillingPlan()).toBeFalsy();
    expect(model.getReadBillingPlan()).toBeFalsy();
    expect(model.getUpdateBillingPlan()).toBeFalsy();
    expect(model.getDeleteBillingPlan()).toBeFalsy();
  });

  test("its description fits a field's hint (150 characters)", () => {
    for (const column of ["name", "address"]) {
      expect((columnOf(column).description || "").length).toBeLessThanOrEqual(
        150,
      );
    }
  });
});

describe("NetworkAddressName: who reads and writes one", () => {
  test("the network devices' own permissions, and the settings roles", () => {
    expect(model.getReadPermissions()).toEqual(READERS);
    expect(model.getCreatePermissions()).toEqual(CREATORS);
    expect(model.getUpdatePermissions()).toEqual(EDITORS);
    expect(model.getDeletePermissions()).toEqual(DELETERS);
  });

  test("whoever may add a network device may name an address, and whoever reads devices reads the names", () => {
    const device: NetworkDevice = new NetworkDevice();

    expect(device.getCreatePermissions()).toContain(
      Permission.CreateNetworkDevice,
    );
    expect(device.getReadPermissions()).toContain(Permission.ReadNetworkDevice);
    expect(device.getUpdatePermissions()).toContain(
      Permission.EditNetworkDevice,
    );
    expect(device.getDeletePermissions()).toContain(
      Permission.DeleteNetworkDevice,
    );
  });

  test("the name and the address are written by who names, changed by who edits, read by every reader", () => {
    for (const column of ["name", "address"]) {
      const control: ColumnAccessControl = accessOf(column);

      expect({ column, create: control.create }).toEqual({
        column,
        create: CREATORS,
      });
      expect({ column, update: control.update }).toEqual({
        column,
        update: EDITORS,
      });
      expect({ column, read: control.read }).toEqual({
        column,
        read: READERS,
      });
    }
  });

  test("the project is set once, and who created or deleted it is OneUptime's to write", () => {
    expect(accessOf("projectId").update).toEqual([]);
    expect(accessOf("project").update).toEqual([]);
    expect(accessOf("createdByUserId").update).toEqual([]);
    expect(accessOf("deletedByUserId").create).toEqual([]);
    expect(accessOf("deletedByUser").create).toEqual([]);
  });
});

describe("NetworkAddressName: its columns", () => {
  test("a name: required, short text, readable through a relation", () => {
    const name: TableColumnMetadata = columnOf("name");

    expect(name.required).toBe(true);
    expect(name.type).toBe(TableColumnType.ShortText);
    expect(name.canReadOnRelationQuery).toBe(true);
    expect(databaseColumnOf("name").options.nullable).toBe(false);
  });

  test("an address or a subnet: required, short text, named once in its project", () => {
    const address: TableColumnMetadata = columnOf("address");

    expect(address.required).toBe(true);
    expect(address.type).toBe(TableColumnType.ShortText);
    expect(address.title).toBe("Address or Subnet");
    expect(getUniqueColumnBy(model, "address")).toBe("projectId");
    expect(databaseColumnOf("address").options.nullable).toBe(false);
  });

  test("a page's names are read by project and address together", () => {
    const indexed: Array<Array<string>> = getMetadataArgsStorage()
      .indices.filter((index: IndexMetadataArgs): boolean => {
        return index.target === NetworkAddressName;
      })
      .map((index: IndexMetadataArgs): Array<string> => {
        return Array.isArray(index.columns)
          ? (index.columns as Array<string>)
          : [];
      });

    expect(indexed).toContainEqual(["projectId", "address"]);
  });
});
