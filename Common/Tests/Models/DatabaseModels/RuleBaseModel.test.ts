import NetworkDeviceAutoImportRule from "../../../Models/DatabaseModels/NetworkDeviceAutoImportRule";
import StatusPageMonitorRule from "../../../Models/DatabaseModels/StatusPageMonitorRule";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Dictionary from "../../../Types/Dictionary";
import { describe, expect, it } from "@jest/globals";

describe("RuleBaseModel criteria column", () => {
  it("publishes nullable JSON match criteria metadata", () => {
    const rule: StatusPageMonitorRule = new StatusPageMonitorRule();
    const metadata: TableColumnMetadata =
      rule.getTableColumnMetadata("criteria");

    expect(metadata.type).toBe(TableColumnType.JSON);
    expect(metadata.required).toBe(false);
    expect(metadata.title).toBe("Match Criteria");
    expect(rule.criteria).toBeUndefined();
  });

  it("inherits each concrete rule table's own permissions", () => {
    const statusPageRule: StatusPageMonitorRule = new StatusPageMonitorRule();
    const autoImportRule: NetworkDeviceAutoImportRule =
      new NetworkDeviceAutoImportRule();

    expect(statusPageRule.createRecordPermissions).not.toEqual(
      autoImportRule.createRecordPermissions,
    );
    expect(statusPageRule.readRecordPermissions).not.toEqual(
      autoImportRule.readRecordPermissions,
    );
    expect(statusPageRule.updateRecordPermissions).not.toEqual(
      autoImportRule.updateRecordPermissions,
    );

    expect(statusPageRule.getColumnAccessControlFor("criteria")).toEqual({
      create: statusPageRule.createRecordPermissions,
      read: statusPageRule.readRecordPermissions,
      update: statusPageRule.updateRecordPermissions,
    });
    expect(autoImportRule.getColumnAccessControlFor("criteria")).toEqual({
      create: autoImportRule.createRecordPermissions,
      read: autoImportRule.readRecordPermissions,
      update: autoImportRule.updateRecordPermissions,
    });
  });

  it("returns a fresh access-control dictionary on every read", () => {
    const rule: StatusPageMonitorRule = new StatusPageMonitorRule();
    const first: Dictionary<ColumnAccessControl> =
      rule.getColumnAccessControlForAllColumns();
    const second: Dictionary<ColumnAccessControl> =
      rule.getColumnAccessControlForAllColumns();

    expect(first).not.toBe(second);
    expect(first["criteria"]).not.toBeUndefined();

    first["criteria"] = { create: [], read: [], update: [] };

    expect(second["criteria"]).toEqual({
      create: rule.createRecordPermissions,
      read: rule.readRecordPermissions,
      update: rule.updateRecordPermissions,
    });
    expect(rule.getColumnAccessControlFor("criteria")).toEqual(
      second["criteria"],
    );
  });
});
