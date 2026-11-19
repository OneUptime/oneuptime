import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import TeamService from "../../Services/TeamService";
import UserService from "../../Services/UserService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Logger";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../TeamMember/PendingInviteeProfiles";
import { OwnerNotAdded, OwnersAdded } from "./OwnerRuleAssignment";
import RuleFeedMarkdown from "./RuleFeedMarkdown";
import {
  RuleApplicationResult,
  RuleApplicationResultUtil,
} from "./RuleRun/RuleApplication";

/*
 * WHAT AN OWNER RULE DID TO A RECORD, AS ITS FEED ITEM SAYS IT (#9933).
 *
 * Under the line naming the rules that ran (RuleFeedMarkdown.executedLine),
 * the owner rules of incidents, alerts, both kinds of episode, monitors,
 * scheduled maintenance events and an OpenStack cloud's projects say what
 * they did:
 *
 *   Assigned the following owners to the incident:
 *   - 👤 Ada Lovelace
 *   - 👥 Platform
 *
 *   _Some owners were inherited from the incident's monitors._
 *
 *   Did not assign the following owners to the incident:
 *   - 👤 Bob Smith, who is not a member of this project
 *   - 👥 A team that is not one of this project's teams (`<id>`)
 *
 * They used to name every owner their rules asked for as assigned, though
 * OwnerRuleAssignment.createOwner skips a user who is not a member of the
 * project and a team that is not one of its teams: the engines counted
 * every id they handed to addOwners as added. They name the owners addOwners
 * actually added now (OwnersAdded), and list the ones it skipped apart, so
 * whoever keeps the rule sees whom to take out of it, or invite back. With
 * nothing added, only the second list is said.
 *
 * Each engine words its own notes on the owners it added - inherited from
 * the record's monitors, the creator's team - and hands them here, to follow
 * the owners they are about.
 */
export default class OwnerRuleFeed {
  /*
   * The words for what was added and what was skipped, under the executed
   * line: one read of the people (added and skipped), one of the teams
   * added (a skipped team is not the project's, and is not read), and one
   * of who of the people is only invited to the project. Empty when the
   * rules added and skipped nobody.
   */
  public static async readOutcome(data: {
    projectId: ObjectID;
    // What the owners were added to: "incident", "alert", "episode"...
    recordNoun: string;
    outcome: OwnersAdded;
    // Said right after the owners assigned: why some of them were added.
    notesOnAdded?: MarkdownText | undefined;
  }): Promise<MarkdownText> {
    const { outcome } = data;

    const skippedUserIds: Array<ObjectID> = outcome.notAdded
      .filter((owner: OwnerNotAdded): boolean => {
        return owner.ownerColumn === "userId";
      })
      .map((owner: OwnerNotAdded): ObjectID => {
        return owner.id;
      });

    const userIds: Array<ObjectID> = [...outcome.userIds, ...skippedUserIds];

    const [users, teams]: [Array<User>, Array<Team>] = await Promise.all([
      userIds.length > 0
        ? UserService.findBy({
            query: { _id: QueryHelper.any(userIds) },
            select: { name: true, email: true },
            props: { isRoot: true },
            limit: LIMIT_MAX,
            skip: 0,
          })
        : Promise.resolve([] as Array<User>),
      outcome.teamIds.length > 0
        ? TeamService.findBy({
            query: { _id: QueryHelper.any(outcome.teamIds) },
            select: { name: true },
            props: { isRoot: true },
            limit: LIMIT_MAX,
            skip: 0,
          })
        : Promise.resolve([] as Array<Team>),
    ]);

    const withheld: Map<string, WithheldProfile> =
      await PendingInviteeProfiles.readWithheldProfilesInProject({
        userIds: userIds.map((userId: ObjectID): string => {
          return userId.toString();
        }),
        projectId: data.projectId,
      });

    const isAdded: (ids: Array<ObjectID>, id: ObjectID | null) => boolean = (
      ids: Array<ObjectID>,
      id: ObjectID | null,
    ): boolean => {
      return ids.some((addedId: ObjectID): boolean => {
        return (
          addedId.toString().toLowerCase() ===
          (id?.toString() || "").toLowerCase()
        );
      });
    };

    const addedUsers: Array<User> = users.filter((user: User): boolean => {
      return isAdded(outcome.userIds, user.id);
    });
    const skippedUsers: Array<User> = users.filter((user: User): boolean => {
      return isAdded(skippedUserIds, user.id);
    });

    return OwnerRuleFeed.getOutcome({
      recordNoun: data.recordNoun,
      outcome: outcome,
      addedUsers: addedUsers,
      addedTeams: teams,
      skippedUsers: skippedUsers,
      withheld: withheld,
      notesOnAdded: data.notesOnAdded,
    });
  }

  /*
   * readOutcome's words, from the people and teams it read: "Assigned the
   * following owners to the <record>" with the owners added - those found,
   * or "(no named owners)" - and the notes about them, then "Did not assign
   * the following owners to the <record>" with each owner skipped and why.
   * A part with no owner in it is left out.
   */
  public static getOutcome(data: {
    recordNoun: string;
    outcome: OwnersAdded;
    addedUsers: Array<User>;
    addedTeams: Array<Team>;
    skippedUsers: Array<User>;
    withheld?: Map<string, WithheldProfile> | undefined;
    notesOnAdded?: MarkdownText | undefined;
  }): MarkdownText {
    const parts: Array<MarkdownText> = [];
    const addedCount: number =
      data.outcome.userIds.length + data.outcome.teamIds.length;

    if (addedCount > 0) {
      const namedCount: number =
        data.addedUsers.length + data.addedTeams.length;

      parts.push(
        mdText`Assigned the following owner${namedCount === 1 ? "" : "s"} to the ${data.recordNoun}:\n${RuleFeedMarkdown.ownersList(
          {
            users: data.addedUsers,
            teams: data.addedTeams,
            withheld: data.withheld,
          },
        )}${data.notesOnAdded || FeedMarkdown.empty()}`,
      );
    }

    if (data.outcome.notAdded.length > 0) {
      parts.push(
        mdText`Did not assign the following owner${
          data.outcome.notAdded.length === 1 ? "" : "s"
        } to the ${data.recordNoun}:\n${RuleFeedMarkdown.ownersNotAddedList({
          notAdded: data.outcome.notAdded,
          users: data.skippedUsers,
          withheld: data.withheld,
        })}`,
      );
    }

    return FeedMarkdown.join(parts, "\n\n");
  }

  /*
   * The owners skipped, for a log line: "user <id> (NotProjectMember), team
   * <id> (NotProjectRecord)". Ids only: a log names nobody.
   */
  public static describeNotAdded(notAdded: Array<OwnerNotAdded>): string {
    return notAdded
      .map((owner: OwnerNotAdded): string => {
        return `${owner.ownerColumn === "userId" ? "user" : "team"} ${owner.id.toString()} (${owner.reason})`;
      })
      .join(", ");
  }

  // Ids as the strings the engines compare them by.
  public static idsOf(ids: Array<ObjectID>): Array<string> {
    return ids.map((id: ObjectID): string => {
      return id.toString();
    });
  }

  // Whether the rules added nobody and skipped nobody.
  public static isEmpty(outcome: OwnersAdded): boolean {
    return (
      outcome.userIds.length === 0 &&
      outcome.teamIds.length === 0 &&
      outcome.notAdded.length === 0
    );
  }

  /*
   * The log lines of what an engine's rules did to a record: how many owners
   * they added, and which they skipped and why - a warning, since whoever
   * keeps the rule can act on it, and what a run that could not update the
   * record points to ("Check the server logs"). Ids only.
   */
  public static log(data: {
    // "IncidentOwnerRuleEngine"
    engine: string;
    // "incident <id>"
    record: string;
    outcome: OwnersAdded;
    logAttributes: LogAttributes;
  }): void {
    const added: number =
      data.outcome.userIds.length + data.outcome.teamIds.length;

    if (added > 0) {
      logger.debug(
        `${data.engine} added ${added} ${added === 1 ? "owner" : "owners"} to ${data.record}`,
        data.logAttributes,
      );
    }

    if (data.outcome.notAdded.length > 0) {
      logger.warn(
        `${data.engine} did not add ${data.outcome.notAdded.length} of the owners its rules name to ${data.record}: ${OwnerRuleFeed.describeNotAdded(data.outcome.notAdded)}`,
        data.logAttributes,
      );
    }
  }

  /*
   * What a run reports for a record its rules matched and named owners for:
   * updated, by the owners added; failed when every owner it had to add was
   * skipped - "already applied" would say the record has owners it does
   * not, so it is one the run could not update, as an SLO's owner rule
   * reports it, and its feed and the log say why; already applied when it
   * had them all.
   */
  public static getResult(outcome: OwnersAdded): RuleApplicationResult {
    const added: number = outcome.userIds.length + outcome.teamIds.length;

    if (added > 0) {
      return RuleApplicationResultUtil.updated(added);
    }

    if (outcome.notAdded.length > 0) {
      return RuleApplicationResultUtil.failed();
    }

    return RuleApplicationResultUtil.alreadyApplied();
  }
}
