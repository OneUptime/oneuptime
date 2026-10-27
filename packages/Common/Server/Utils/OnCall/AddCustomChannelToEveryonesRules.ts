import CustomNotificationChannelService from "../../Services/CustomNotificationChannelService";
import TeamMemberService from "../../Services/TeamMemberService";
import UserNotificationRuleService from "../../Services/UserNotificationRuleService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import CustomNotificationChannel from "../../../Models/DatabaseModels/CustomNotificationChannel";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";

/*
 * ADDING A CUSTOM CHANNEL TO EVERYBODY'S ON-CALL RULES.
 *
 * A channel that pages everyone (CustomNotificationChannel
 * .pageEveryoneByDefault) is in everybody's default rules, in every project:
 * the same rules a verified method gets, for every severity
 * (addDefaultNotificationRulesForVerifiedMethod). People who join a project
 * later get it as they join (addCustomChannelsPagingEveryoneForUser); this
 * adds it for everybody who was a member when it started paging everyone.
 *
 * The worker job AddCustomChannelToEveryonesRules runs it, enqueued by
 * CustomNotificationChannelService the moment a channel starts paging
 * everyone, and every few minutes besides. Its work is every channel that is
 * on, pages everyone and has not been added yet (addedToEveryonesRulesAt
 * null), so a run stopped part way is taken up by the next, and a channel
 * done is never swept again: somebody who removed it from their rules
 * afterwards keeps it removed.
 *
 * Every write is guarded by what already exists - a rule for that person,
 * channel, type and severity is never written twice - so running over the
 * same people again costs reads and nothing else.
 */
export default class AddCustomChannelToEveryonesRules {
  // Members read at a time.
  public static readonly PAGE_SIZE: number = LIMIT_PER_PROJECT;

  /*
   * Adds every channel still to do to everybody's rules, and marks each one
   * done. Returns how many channels it finished. One channel that fails is
   * logged and left to the next run; the others carry on.
   */
  @CaptureSpan()
  public static async run(): Promise<number> {
    const channels: Array<CustomNotificationChannel> =
      await CustomNotificationChannelService.findBy({
        query: {
          isEnabled: true,
          pageEveryoneByDefault: true,
          addedToEveryonesRulesAt: QueryHelper.isNull(),
        },
        select: {
          _id: true,
          name: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    let finished: number = 0;

    for (const channel of channels) {
      try {
        await this.addToEveryonesRules(channel.id!);

        await CustomNotificationChannelService.updateOneById({
          id: channel.id!,
          data: {
            addedToEveryonesRulesAt: OneUptimeDate.getCurrentDate(),
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });

        finished++;
      } catch (err) {
        logger.error(
          `Could not add the custom channel ${channel.id?.toString()} (${channel.name || ""}) to everyone's on-call rules. The next run tries again.`,
        );
        logger.error(err);
      }
    }

    return finished;
  }

  /*
   * Adds one channel to the default rules of every accepted member of every
   * project. A person on several teams of one project is one member of it,
   * so each (project, person) pair is done once. Returns how many pairs it
   * went through.
   */
  @CaptureSpan()
  public static async addToEveryonesRules(
    channelId: ObjectID,
  ): Promise<number> {
    const done: Set<string> = new Set<string>();
    let skip: number = 0;

    for (;;) {
      const members: Array<TeamMember> = await TeamMemberService.findBy({
        query: {
          hasAcceptedInvitation: true,
        },
        select: {
          _id: true,
          projectId: true,
          userId: true,
        },
        sort: {
          _id: SortOrder.Ascending,
        },
        limit: this.PAGE_SIZE,
        skip: skip,
        props: {
          isRoot: true,
        },
      });

      for (const member of members) {
        if (!member.projectId || !member.userId) {
          continue;
        }

        // Ids compared without regard to case, as Postgres and ObjectID may differ in it.
        const key: string =
          `${member.projectId.toString()}:${member.userId.toString()}`.toLowerCase();

        if (done.has(key)) {
          continue;
        }

        done.add(key);

        await UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod(
          {
            projectId: member.projectId,
            userId: member.userId,
            notificationMethod: {
              customNotificationChannelId: channelId,
            },
          },
        );
      }

      if (members.length < this.PAGE_SIZE) {
        break;
      }

      skip += this.PAGE_SIZE;
    }

    return done.size;
  }
}
