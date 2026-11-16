import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import ColumnType from "../../../Types/Database/ColumnType";
import TableColumn from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Dictionary from "../../../Types/Dictionary";
import RuleCriteria from "../../../Types/Rules/RuleCriteria";
import { RuleEmptiedLimit } from "../../../Types/Rules/RuleEmptiedLimit";
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

  /*
   * Why OneUptime switched the rule off: the lists it was limited to whose
   * every record was deleted since (#9066, Types/Rules/RuleEmptiedLimit).
   * An emptied list would otherwise put no limit at all - the rule would
   * match every monitor, label or severity instead of the deleted ones - so
   * the delete switches the rule off and writes this note, and switching it
   * on again clears it. OneUptime's alone: nobody may write it, and everyone
   * who may read the rule may read it.
   */
  @TableColumn({
    required: false,
    computed: true,
    type: TableColumnType.JSON,
    title: "Emptied Limits",
    description:
      "The lists this rule was limited to whose every record was deleted since: each list, the deleted records' names, how many and when. Deleting the last record a list held would make the rule match every record instead, so OneUptime switched the rule off and wrote this. It is cleared when the rule is switched on again; until a list named here holds a record again, switching the rule on must say what the list holds in the same update. Written by OneUptime; any value sent for it is refused.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public emptiedLimits?: Array<RuleEmptiedLimit> | null = undefined;

  public override getColumnAccessControlForAllColumns(): Dictionary<ColumnAccessControl> {
    const dictionary: Dictionary<ColumnAccessControl> = {
      ...super.getColumnAccessControlForAllColumns(),
    };

    dictionary["criteria"] = {
      create: this.createRecordPermissions,
      read: this.readRecordPermissions,
      update: this.updateRecordPermissions,
    };

    // Read with the rule; written by OneUptime alone.
    dictionary["emptiedLimits"] = {
      create: [],
      read: this.readRecordPermissions,
      update: [],
    };

    return dictionary;
  }
}
