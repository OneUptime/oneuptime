import DataMigrationBase from "./DataMigrationBase";
import RuleEmptiedLimits from "Common/Server/Utils/Rules/RuleEmptiedLimits";
import logger from "Common/Server/Utils/Logger";

/*
 * RULES ALREADY WIDENED BY A DELETE, ON AN EXISTING INSTALL (#9066).
 *
 * From this release on, deleting the last record a rule's list was limited
 * to switches the rule off and says why (RuleEmptiedLimits). A rule left
 * with an empty list by a delete before it cannot be told from a rule saved
 * with that list empty on purpose - "every monitor" - because the delete
 * left no trace on the rule: the database took its join rows away. So no
 * such rule is changed: switching off a rule set up to match everything
 * would page nobody where it paged everyone, which is no fix either.
 *
 * The one trace there is: a list that still holds records, every one of
 * them soft deleted (deletedAt set - by a migration that set rows aside, or
 * by a write from outside the app). Every read leaves a soft-deleted record
 * out, so the rule reads that list as empty and matches every record, and
 * the join rows say what it was limited to. Each such rule - a match list
 * of a rule with no conditions of its own, or an AI rule's runbooks,
 * repositories and MCP servers - is switched off and noted as a delete
 * would have done it, with the records' names and when they were deleted.
 * A rule that keeps a record that is not deleted keeps its limit, and a
 * list already in a rule's note is left as it is, so this runs any number
 * of times. Postgres only, one read a list.
 */
export default class SwitchOffRulesLimitedOnlyToDeletedRecords extends DataMigrationBase {
  public constructor() {
    super("SwitchOffRulesLimitedOnlyToDeletedRecords");
  }

  public override async migrate(): Promise<void> {
    const switchedOff: number =
      await RuleEmptiedLimits.switchOffRulesLimitedOnlyToDeletedRecords();

    logger.info(
      `SwitchOffRulesLimitedOnlyToDeletedRecords: ${switchedOff} rules whose lists held only deleted records were switched off.`,
    );
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to undo: a rule switched off says why on its page, and is
     * switched on there once its lists say what it applies to.
     */
    return;
  }
}
