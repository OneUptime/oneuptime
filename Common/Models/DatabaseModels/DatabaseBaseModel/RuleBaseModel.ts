import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import ColumnType from "../../../Types/Database/ColumnType";
import TableColumn from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Dictionary from "../../../Types/Dictionary";
import RuleCriteria from "../../../Types/Rules/RuleCriteria";
import { Column } from "typeorm";
import DatabaseBaseModel from "./DatabaseBaseModel";

/**
 * Shared persistence contract for resources configured through a rule form.
 *
 * The criteria column dynamically inherits the concrete model's table ACL.
 * This avoids either widening access to a rule or accidentally requiring a
 * permission that the table itself does not accept.
 */
export default class RuleBaseModel extends DatabaseBaseModel {
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Match Criteria",
    description:
      "Versioned conditions that determine whether this rule matches a resource.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public criteria?: RuleCriteria | null = undefined;

  public override getColumnAccessControlForAllColumns(): Dictionary<ColumnAccessControl> {
    const dictionary: Dictionary<ColumnAccessControl> = {
      ...super.getColumnAccessControlForAllColumns(),
    };

    dictionary["criteria"] = {
      create: this.createRecordPermissions,
      read: this.readRecordPermissions,
      update: this.updateRecordPermissions,
    };

    return dictionary;
  }
}
