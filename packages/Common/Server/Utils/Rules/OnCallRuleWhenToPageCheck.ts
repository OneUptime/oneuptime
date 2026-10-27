import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import {
  AI_HOLD_TIME_MAX_IN_MINUTES,
  AI_HOLD_TIME_MIN_IN_MINUTES,
} from "../../../Types/OnCallDutyPolicy/OnCallPolicyAiHold";
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
 *
 * After OneUptime AI (OnCallPolicyAiHold) is for alert and incident rules:
 * OneUptime AI investigates alerts and incidents, not episodes, so an
 * episode rule's write that names it is refused. A hold time a write names
 * is whole minutes within its bounds.
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

// What the rule's kind lets it say: After OneUptime AI, for alerts and incidents.
export interface OnCallRuleWhenToPageOptions {
  allowsOneUptimeAI: boolean;
}

export const ONEUPTIME_AI_NOT_FOR_EPISODES_MESSAGE: string =
  "After OneUptime AI is for alert and incident on-call rules: OneUptime AI investigates alerts and incidents, not episodes.";

export const AI_HOLD_TIME_OUT_OF_BOUNDS_MESSAGE: string = `OneUptime AI Hold Time In Minutes is a whole number from ${AI_HOLD_TIME_MIN_IN_MINUTES} to ${AI_HOLD_TIME_MAX_IN_MINUTES}.`;

export default class OnCallRuleWhenToPageCheck {
  // A new rule, as its create writes it.
  public static checkCreate<TModel extends BaseModel>(
    createBy: CreateBy<TModel>,
    options?: OnCallRuleWhenToPageOptions | undefined,
  ): void {
    this.checkAiHoldTime(createBy.data);
    this.check(this.read(createBy.data), options);
  }

  /*
   * An update, as each rule it writes will be. The rules are read only when
   * what it writes does not say enough on its own: it writes when to page,
   * or the hours, without the rest.
   */
  public static async checkUpdate<TModel extends BaseModel>(data: {
    service: DatabaseService<TModel>;
    updateBy: UpdateBy<TModel>;
    options?: OnCallRuleWhenToPageOptions | undefined;
  }): Promise<void> {
    this.checkAiHoldTime(data.updateBy.data);

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
      this.check(written, data.options);
      return;
    }

    if (writes.length === WHEN_TO_PAGE_COLUMNS.length) {
      this.check(written, data.options);
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

      this.check(
        {
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
        },
        data.options,
      );
    }
  }

  /*
   * A hold time a write names: whole minutes within the bounds, or empty for
   * the default (getAiHoldTimeInMinutes reads any stored value within them).
   */
  private static checkAiHoldTime(model: unknown): void {
    const value: unknown =
      model && typeof model === "object"
        ? (model as Record<string, unknown>)["aiHoldTimeInMinutes"]
        : undefined;

    if (
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "")
    ) {
      return;
    }

    // A form's number field may send its digits as text: "10" is 10.
    const minutes: unknown =
      typeof value === "string" ? Number(value.trim()) : value;

    if (
      typeof minutes !== "number" ||
      !Number.isInteger(minutes) ||
      minutes < AI_HOLD_TIME_MIN_IN_MINUTES ||
      minutes > AI_HOLD_TIME_MAX_IN_MINUTES
    ) {
      throw new BadDataException(AI_HOLD_TIME_OUT_OF_BOUNDS_MESSAGE);
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

  private static check(
    rule: WhenToPageValues,
    options?: OnCallRuleWhenToPageOptions | undefined,
  ): void {
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

    if (
      whenToPage === OnCallRuleWhenToPage.AfterOneUptimeAI &&
      !options?.allowsOneUptimeAI
    ) {
      throw new BadDataException(ONEUPTIME_AI_NOT_FOR_EPISODES_MESSAGE);
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
