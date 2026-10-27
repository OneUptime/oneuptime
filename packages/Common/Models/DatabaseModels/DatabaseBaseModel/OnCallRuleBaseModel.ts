import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import ColumnLength from "../../../Types/Database/ColumnLength";
import ColumnType from "../../../Types/Database/ColumnType";
import TableColumn from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Dictionary from "../../../Types/Dictionary";
import OnCallRuleWhenToPage from "../../../Types/OnCallDutyPolicy/OnCallRuleWhenToPage";
import RestrictionTimes from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Timezone from "../../../Types/Timezone";
import { Column } from "typeorm";
import RuleBaseModel from "./RuleBaseModel";

/*
 * What every on-call rule - an alert's, an incident's, an alert episode's
 * and an incident episode's - says about WHEN its policies page
 * (OnCallRuleWhenToPage): right away, as rules always have, or only during
 * working hours, read on the clock of a time zone of the rule's own
 * (WorkingHours). A record that matches the rule outside its hours gets a
 * run that waits, and pages when they begin (OnCallDutyPolicyRunWait).
 *
 * An alert or incident rule can instead let OneUptime AI respond first, for
 * at most its hold time (OnCallPolicyAiHold).
 *
 * The columns are the same on the four rules, so they are declared once,
 * here. Like the criteria column, they take the concrete rule's table
 * permissions: whoever may write the rule may say when it pages.
 */
export default class OnCallRuleBaseModel extends RuleBaseModel {
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "When to Page",
    description:
      "When the on-call policies of this rule page: Right Away, as soon as a record matches it; Working Hours, only during the working hours of this rule - a record that matches it outside them is paged about when they begin; or After OneUptime AI, for alert and incident rules - when OneUptime AI may fix what the record is about, it responds first, and the policies page only if it has not resolved the record within the hold time.",
    defaultValue: OnCallRuleWhenToPage.RightAway,
    isDefaultValueColumn: true,
    example: OnCallRuleWhenToPage.RightAway,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: OnCallRuleWhenToPage.RightAway,
  })
  public whenToPage?: OnCallRuleWhenToPage = undefined;

  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Working Hours",
    description:
      "When this rule may page, when When to Page is Working Hours: the same daily or weekly windows as an on-call schedule layer's restriction times, read in the time zone of this rule.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
    transformer: RestrictionTimes.getDatabaseTransformer(),
  })
  public workingHours?: RestrictionTimes = undefined;

  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Working Hours Time Zone",
    description:
      "The IANA time zone the working hours of this rule are in: Europe/London.",
    example: "Europe/London",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public workingHoursTimezone?: Timezone = undefined;

  /*
   * How long OneUptime AI may hold a page, when When to Page is After
   * OneUptime AI (OnCallPolicyAiHold). Empty is the default, 10 minutes;
   * any value is read within 1 to 30 (getAiHoldTimeInMinutes).
   */
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "OneUptime AI Hold Time In Minutes",
    description:
      "When When to Page is After OneUptime AI: how many minutes OneUptime AI may hold the page while it investigates and fixes (1 to 30). Empty: 10. If OneUptime AI has not resolved the record by then, the policies page as usual.",
    example: 10,
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public aiHoldTimeInMinutes?: number = undefined;

  public override getColumnAccessControlForAllColumns(): Dictionary<ColumnAccessControl> {
    const dictionary: Dictionary<ColumnAccessControl> = {
      ...super.getColumnAccessControlForAllColumns(),
    };

    for (const column of [
      "whenToPage",
      "workingHours",
      "workingHoursTimezone",
      "aiHoldTimeInMinutes",
    ]) {
      dictionary[column] = {
        create: this.createRecordPermissions,
        read: this.readRecordPermissions,
        update: this.updateRecordPermissions,
      };
    }

    return dictionary;
  }
}
