import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import CreateChannelNotificationRule from "../../../Types/Workspace/NotificationRules/CreateChannelNotificationRule";
import NotificationRuleInvites from "../../../Types/Workspace/NotificationRules/NotificationRuleInvites";
import OnCallDutyPolicyScheduleService from "../../Services/OnCallDutyPolicyScheduleService";
import QueryHelper from "../../Types/Database/QueryHelper";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * WHO IS ON CALL IN THE SCHEDULES A RULE NAMES, FOR ITS CHANNEL.
 *
 * A workspace notification rule that creates a channel for each record can
 * name on-call schedules (CreateChannelNotificationRule
 * .inviteOnCallSchedulesToNewChannel): whoever is on call in them when the
 * channel is created joins it, and nobody is paged. Slack adds them to the
 * channel; Microsoft Teams, which adds nobody to a channel, @mentions them
 * in it (ChannelMembersNotAddedNotice).
 *
 * "On call" is what the schedule's own page says - its roster
 * (currentUserIdOnRoster), which the schedule service keeps at every
 * hand-off, override and skip - so a channel gets the people an on-call
 * user group holds and `/oneuptime oncall` names.
 *
 * Only the project's own schedules are read: a rule is configuration, and
 * can name a schedule deleted since, or another project's.
 */

// A schedule, as a channel's invite reads it.
export interface ScheduleOnCall {
  name: string;
  // Whoever is on call in it now; null when nobody is.
  userId: ObjectID | null;
}

// Somebody on call in a rule's schedules, and in which of them.
export interface ScheduleOnCallPerson {
  userId: ObjectID;
  // The schedules they are on call in, by name, in the rule's order.
  scheduleNames: Array<string>;
}

export default class WorkspaceScheduleOnCall {
  /*
   * Whoever is on call in each rule's schedules, by the rule's id: the
   * schedules of every rule read in one go. A rule that creates no channel,
   * or names no schedule, has nobody.
   */
  @CaptureSpan()
  public static async getPeopleOnCallByRule(data: {
    projectId: ObjectID;
    notificationRules: Array<WorkspaceNotificationRule>;
  }): Promise<Map<string, Array<ScheduleOnCallPerson>>> {
    const scheduleIdsByRule: Map<string, Array<ObjectID>> = new Map<
      string,
      Array<ObjectID>
    >();

    const allScheduleIds: Array<ObjectID> = [];

    for (const rule of data.notificationRules) {
      const createChannelRule: CreateChannelNotificationRule | undefined =
        rule.notificationRule as CreateChannelNotificationRule | undefined;

      if (!rule.id || !createChannelRule?.shouldCreateNewChannel) {
        continue;
      }

      const scheduleIds: Array<ObjectID> =
        NotificationRuleInvites.getOnCallScheduleIds(createChannelRule);

      if (scheduleIds.length === 0) {
        continue;
      }

      scheduleIdsByRule.set(rule.id.toString(), scheduleIds);
      allScheduleIds.push(...scheduleIds);
    }

    const peopleByRule: Map<string, Array<ScheduleOnCallPerson>> = new Map<
      string,
      Array<ScheduleOnCallPerson>
    >();

    if (allScheduleIds.length === 0) {
      return peopleByRule;
    }

    const schedules: Map<string, ScheduleOnCall> =
      await WorkspaceScheduleOnCall.getSchedules({
        projectId: data.projectId,
        scheduleIds: allScheduleIds,
      });

    for (const [ruleId, scheduleIds] of scheduleIdsByRule) {
      peopleByRule.set(
        ruleId,
        WorkspaceScheduleOnCall.getPeopleOnCall({
          scheduleIds: scheduleIds,
          schedules: schedules,
        }),
      );
    }

    return peopleByRule;
  }

  /*
   * The project's schedules among these, by id (lower case): their names
   * and who is on call in each.
   */
  @CaptureSpan()
  public static async getSchedules(data: {
    projectId: ObjectID;
    scheduleIds: Array<ObjectID>;
  }): Promise<Map<string, ScheduleOnCall>> {
    const schedules: Map<string, ScheduleOnCall> = new Map<
      string,
      ScheduleOnCall
    >();

    if (data.scheduleIds.length === 0) {
      return schedules;
    }

    const found: Array<OnCallDutyPolicySchedule> =
      await OnCallDutyPolicyScheduleService.findBy({
        query: {
          _id: QueryHelper.any(data.scheduleIds),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          name: true,
          currentUserIdOnRoster: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    for (const schedule of found) {
      const id: string = schedule.id?.toString().toLowerCase() || "";

      if (!id) {
        continue;
      }

      schedules.set(id, {
        name: schedule.name?.toString() || "",
        userId: schedule.currentUserIdOnRoster || null,
      });
    }

    return schedules;
  }

  /*
   * Whoever is on call in these schedules, each person once, in the order
   * of the first schedule they are on call in. A schedule nobody is on call
   * in, or that is not the project's, adds nobody.
   */
  public static getPeopleOnCall(data: {
    scheduleIds: Array<ObjectID>;
    schedules: Map<string, ScheduleOnCall>;
  }): Array<ScheduleOnCallPerson> {
    const people: Array<ScheduleOnCallPerson> = [];

    for (const scheduleId of data.scheduleIds) {
      const schedule: ScheduleOnCall | undefined = data.schedules.get(
        scheduleId.toString().toLowerCase(),
      );

      if (!schedule || !schedule.userId) {
        continue;
      }

      const userId: ObjectID = schedule.userId;

      const person: ScheduleOnCallPerson | undefined = people.find(
        (candidate: ScheduleOnCallPerson): boolean => {
          return (
            candidate.userId.toString().toLowerCase() ===
            userId.toString().toLowerCase()
          );
        },
      );

      if (person) {
        if (schedule.name && !person.scheduleNames.includes(schedule.name)) {
          person.scheduleNames.push(schedule.name);
        }

        continue;
      }

      people.push({
        userId: userId,
        scheduleNames: schedule.name ? [schedule.name] : [],
      });
    }

    return people;
  }
}
