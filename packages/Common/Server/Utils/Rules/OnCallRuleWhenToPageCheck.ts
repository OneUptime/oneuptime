import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import OnCallRuleWhenToPage from "../../../Types/OnCallDutyPolicy/OnCallRuleWhenToPage";
import RestrictionTimes from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import WorkingHours from "../../../Types/OnCallDutyPolicy/WorkingHours";
import DatabaseService from "../../Services/DatabaseService";
import CreateBy from "../../Types/Database/CreateBy";
import UpdateBy from "../../Types/Database/UpdateBy";

/*
 * WHAT AN ON-CALL RULE MAY SAY ABOUT WHEN IT PAGES (OnCallRuleWhenToPage).
 *
 * A rule that pages only during working hours needs hours that open - a
 * daily window that does not end where it starts, or at least one weekly
 * window - in a time zone OneUptime knows. Hours that never open would hold
 * a page for a moment that never comes; the rule engines page right away
 * rather than lose it (OnCallRulePagingHold), but a rule should never be
 * saved that way: an alert, incident or episode rule's create and update
 * are refused, in the words the form shows (WorkingHours.getProblem).
 *
 * An update is judged as the rules it writes will be: what it writes over
 * each rule as stored, so switching a rule with hours to Working Hours, or
 * changing only its time zone, is judged with the hours it has.
 */

// What a rule says about when it pages, as a write may carry it.
interface WhenToPageValues {
  whenToPage?: OnCallRuleWhenToPage | string | null | undefined;
  workingHours?: RestrictionTimes | JSONObject | null | undefined;
  workingHoursTimezone?: string | null | undefined;
}

const WHEN_TO_PAGE_COLUMNS: Array<keyof WhenToPageValues> = [
  "whenToPage",
  "workingHours",
  "workingHoursTimezone",
];

export default class OnCallRuleWhenToPageCheck {
  // A new rule, as its create writes it.
  public static checkCreate<TModel extends BaseModel>(
    createBy: CreateBy<TModel>,
  ): void {
    this.check(this.read(createBy.data));
  }

  /*
   * An update, as each rule it writes will be. The rules are read only when
   * what it writes does not say enough on its own: it writes when to page,
   * or the hours, without the rest.
   */
  public static async checkUpdate<TModel extends BaseModel>(data: {
    service: DatabaseService<TModel>;
    updateBy: UpdateBy<TModel>;
  }): Promise<void> {
    const written: WhenToPageValues = this.read(data.updateBy.data);

    const writes: Array<keyof WhenToPageValues> = WHEN_TO_PAGE_COLUMNS.filter(
      (column: keyof WhenToPageValues): boolean => {
        return written[column] !== undefined;
      },
    );

    if (writes.length === 0) {
      return;
    }

    // Right away, or a value it cannot be: nothing else to read.
    if (
      written.whenToPage !== undefined &&
      written.whenToPage !== null &&
      written.whenToPage !== OnCallRuleWhenToPage.WorkingHours
    ) {
      this.check(written);
      return;
    }

    if (writes.length === WHEN_TO_PAGE_COLUMNS.length) {
      this.check(written);
      return;
    }

    /*
     * The rules as stored, read the way every hook reads the rows of an
     * update it judges: the rows the update writes, and the update held to
     * them (DatabaseService.findRowsAndHoldUpdateToThem), so the rules judged
     * are the rules written.
     */
    const stored: Array<TModel> =
      await data.service.findRowsAndHoldUpdateToThem(data.updateBy, {
        whenToPage: true,
        workingHours: true,
        workingHoursTimezone: true,
      } as never);

    for (const rule of stored) {
      const current: WhenToPageValues = this.read(rule);

      this.check({
        whenToPage:
          written.whenToPage !== undefined
            ? written.whenToPage
            : current.whenToPage,
        workingHours:
          written.workingHours !== undefined
            ? written.workingHours
            : current.workingHours,
        workingHoursTimezone:
          written.workingHoursTimezone !== undefined
            ? written.workingHoursTimezone
            : current.workingHoursTimezone,
      });
    }
  }

  private static read(model: unknown): WhenToPageValues {
    const values: Record<string, unknown> =
      model && typeof model === "object"
        ? (model as Record<string, unknown>)
        : {};

    return {
      whenToPage: values["whenToPage"] as WhenToPageValues["whenToPage"],
      workingHours: values["workingHours"] as WhenToPageValues["workingHours"],
      workingHoursTimezone: values[
        "workingHoursTimezone"
      ] as WhenToPageValues["workingHoursTimezone"],
    };
  }

  private static check(rule: WhenToPageValues): void {
    const whenToPage: string =
      rule.whenToPage || OnCallRuleWhenToPage.RightAway;

    if (
      !(Object.values(OnCallRuleWhenToPage) as Array<string>).includes(
        whenToPage,
      )
    ) {
      throw new BadDataException(
        `When to Page is ${Object.values(OnCallRuleWhenToPage)
          .map((value: string): string => {
            return `"${value}"`;
          })
          .join(" or ")}.`,
      );
    }

    if (whenToPage !== OnCallRuleWhenToPage.WorkingHours) {
      return;
    }

    const problem: string | null = WorkingHours.getProblem({
      hours: rule.workingHours,
      timezone: rule.workingHoursTimezone,
    });

    if (problem) {
      throw new BadDataException(problem);
    }
  }
}
