import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import OnCallDutyPolicyScheduleService from "../../Services/OnCallDutyPolicyScheduleService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import { OnCallShiftChangeReason } from "./OnCallShiftChangeListeners";

/*
 * A CHANGE TO A SCHEDULE'S LAYERS MADE THROUGH THE API IS TOLD ONCE (#7813).
 *
 * Every write of a layer or of a person in one works out who is on call
 * (OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule)
 * and tells the people that reaches, the schedule's Slack and Microsoft
 * Teams channels, its calendar feeds and its reminders
 * (propagateShiftConfigChange). The Dashboard's Layers page saves a whole
 * change in one request and tells it once (ScheduleLayersSave). A change
 * made through the API is one row at a time: a Terraform apply that puts
 * four people in a new turn order writes four rows, and someone could be
 * told they are on call, then that they are not, then that they are again,
 * in the same minute.
 *
 * So a write made through the API - with an API key (Terraform, the CLI, a
 * script), by an AI client connected over MCP, or by a workflow - tells
 * nothing at once. It holds the schedule's change instead: the schedule's
 * rosterRefreshDueAt is set to QUIET_PERIOD_IN_SECONDS from now, and every
 * further write pushes it on. Once no write has come for that long, the
 * Workers (OnCallDutySchedule:TellLayerChanges, every minute) tell the
 * whole change once: who is on call is worked out, and the feeds and
 * reminders hear of it. The rows themselves are saved at once, as before:
 * a page goes to whoever the layers put on call the moment they are
 * written; only the messages wait.
 *
 * The hold is written on the schedule, in Postgres, so that a process that
 * stops never loses a change: whichever worker runs next tells it. It is
 * let go only once the change is told, and only if no write came while it
 * was being told; a change told twice tells nobody twice, as working out
 * who is on call again finds nothing new. A write whose hold cannot be
 * written is told at once, as before.
 *
 * A change made in the Dashboard - by a person signed in - is told at
 * once, as it always was, and so is OneUptime's own (root) write.
 */
export default class ScheduleLayerChanges {
  // How long a schedule's layers stay unwritten before their change is told.
  public static readonly QUIET_PERIOD_IN_SECONDS: number = 30;

  // At most how many waiting changes one run of the Workers tells.
  public static readonly MAX_CHANGES_PER_RUN: number = 100;

  /*
   * Whether a write made with these props is told once its change is
   * quiet: one made through the API, not by a person in the Dashboard, nor
   * by OneUptime itself.
   */
  public static isToldOnceQuiet(
    props: DatabaseCommonInteractionProps | null | undefined,
  ): boolean {
    if (!props || props.isRoot) {
      return false;
    }

    return (
      props.userType === UserType.API ||
      props.userType === UserType.Workflow ||
      Boolean(props.apiKeyId) ||
      Boolean(props.mcpOAuthGrantId)
    );
  }

  /*
   * After a row of the schedule's layers is written: told now (tellNow, the
   * hook's own roster refresh and propagation), or held for the change it
   * is part of. Never throws more than tellNow does.
   */
  public static async afterLayersWritten(data: {
    scheduleId: ObjectID;
    props: DatabaseCommonInteractionProps | null | undefined;
    tellNow: () => Promise<void>;
  }): Promise<void> {
    if (!this.isToldOnceQuiet(data.props)) {
      await data.tellNow();
      return;
    }

    try {
      await this.hold(data.scheduleId);
    } catch (err) {
      // Told at once, as before, rather than not at all.
      logger.error(
        `The change to the layers of on-call schedule ${data.scheduleId.toString()} could not be held until it is quiet; it is told now.`,
      );
      logger.error(err);
      await data.tellNow();
    }
  }

  /*
   * Holds the schedule's change: it is told QUIET_PERIOD_IN_SECONDS from
   * now, unless another write holds it longer first.
   */
  public static async hold(scheduleId: ObjectID): Promise<void> {
    await OnCallDutyPolicyScheduleService.updateColumnsByIdWithoutHooks({
      id: scheduleId,
      data: {
        rosterRefreshDueAt: OneUptimeDate.addRemoveSeconds(
          OneUptimeDate.getCurrentDate(),
          this.QUIET_PERIOD_IN_SECONDS,
        ),
      },
      skipUpdateDateColumn: true,
    });
  }

  /*
   * Tells every change whose quiet period is over, oldest first: who is
   * on call in its schedule is worked out once, and its feeds and
   * reminders hear of it once. Then its hold is let go - unless a write
   * came meanwhile, which holds it again, to be told once that is quiet
   * too. Returns how many changes it told. One schedule's failure is
   * logged, and the others are told.
   */
  public static async tellDueChanges(
    now: Date = OneUptimeDate.getCurrentDate(),
  ): Promise<number> {
    const due: Array<OnCallDutyPolicySchedule> =
      await OnCallDutyPolicyScheduleService.findBy({
        query: {
          rosterRefreshDueAt: QueryHelper.lessThanEqualTo(now),
        },
        select: {
          _id: true,
          projectId: true,
          rosterRefreshDueAt: true,
        },
        sort: {
          rosterRefreshDueAt: SortOrder.Ascending,
        },
        limit: this.MAX_CHANGES_PER_RUN,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    let told: number = 0;

    for (const schedule of due) {
      if (!schedule.id || !schedule.rosterRefreshDueAt) {
        continue;
      }

      try {
        await this.tell({
          scheduleId: schedule.id,
          projectId: schedule.projectId || null,
          dueAt: schedule.rosterRefreshDueAt,
        });
        told++;
      } catch (err) {
        logger.error(
          `The change to the layers of on-call schedule ${schedule.id.toString()} could not be told; the next run tells it.`,
        );
        logger.error(err);
      }
    }

    return told;
  }

  // One schedule's change: told, then let go if nothing was written meanwhile.
  private static async tell(data: {
    scheduleId: ObjectID;
    projectId: ObjectID | null;
    // The hold's moment as read: a write since has moved it.
    dueAt: Date;
  }): Promise<void> {
    const scheduleId: ObjectID = data.scheduleId;

    /*
     * Best-effort, as the hooks' own refresh is: the rows are saved, and
     * the feeds and reminders must hear of them even when working out who
     * is on call fails (a schedule deleted meanwhile, a passing failure).
     */
    try {
      await OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule(
        scheduleId,
      );
    } catch (err) {
      logger.error(
        `Error refreshing the roster of on-call schedule ${scheduleId.toString()} after a change to its layers (best-effort).`,
      );
      logger.error(err);
    }

    await OnCallDutyPolicyScheduleService.propagateShiftConfigChange({
      scheduleIds: [scheduleId],
      projectId: data.projectId,
      reason: OnCallShiftChangeReason.LayerChanged,
    });

    await OnCallDutyPolicyScheduleService.compareAndSetColumnsByIdWithoutHooks({
      id: scheduleId,
      data: {
        rosterRefreshDueAt: null,
      },
      expectedData: {
        rosterRefreshDueAt: data.dueAt,
      },
      skipUpdateDateColumn: true,
    });
  }
}
