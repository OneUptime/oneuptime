import { AlertEpisodeFeedEventType } from "../../../Models/DatabaseModels/AlertEpisodeFeed";
import { AlertFeedEventType } from "../../../Models/DatabaseModels/AlertFeed";
import { IncidentEpisodeFeedEventType } from "../../../Models/DatabaseModels/IncidentEpisodeFeed";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import { Gray500 } from "../../../Types/BrandColors";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import { escapeMarkdownInline } from "../../../Utils/Markdown/MarkdownEscape";
import { StartingStage } from "../../../Utils/StartingStage";
import AlertEpisodeFeedService from "../../Services/AlertEpisodeFeedService";
import AlertFeedService from "../../Services/AlertFeedService";
import IncidentEpisodeFeedService from "../../Services/IncidentEpisodeFeedService";
import IncidentFeedService from "../../Services/IncidentFeedService";
import OnCallDutyPolicyService from "../../Services/OnCallDutyPolicyService";
import QueryHelper from "../../Types/Database/QueryHelper";

/*
 * The record whose create did not run its on-call policies, by the id its
 * own feed is kept under.
 */
export type OnCallNotRunRecord =
  | { incidentId: ObjectID }
  | { alertId: ObjectID }
  | { alertEpisodeId: ObjectID }
  | { incidentEpisodeId: ObjectID };

/*
 * What an incident, alert or episode created already acknowledged or
 * resolved says in its feed instead of paging (StartingStage): one plain
 * line, naming the on-call policies that were not run, so "why was nobody
 * paged?" has its answer on the record itself:
 *
 *   📞 **No one was paged.** This incident was created already resolved, so
 *   its on-call policy **Primary** was not run.
 *
 * A record with no on-call policy - none picked, none added by a rule - says
 * nothing: there was nobody to page.
 */
export default class OnCallNotRunOnCreate {
  /*
   * Writes the line to the record's own feed: one grey on-call entry, as
   * paging would have written one. It stays on the record and is not posted
   * to Slack or Microsoft Teams - nobody there is being called to act.
   * Nothing is written when the record lists no policy that still exists.
   */
  public static async createFeedItem(data: {
    record: OnCallNotRunRecord;
    projectId: ObjectID;
    stage: StartingStage;
    // The record's on-call policies, as it lists them: only their ids are read.
    policies: Array<OnCallDutyPolicy>;
  }): Promise<void> {
    const record: OnCallNotRunRecord = data.record;

    const feedInfoInMarkdown: string | null = await this.getFeedMarkdown({
      noun: this.getNoun(record),
      stage: data.stage,
      projectId: data.projectId,
      policies: data.policies,
    });

    if (!feedInfoInMarkdown) {
      return;
    }

    if ("incidentId" in record) {
      await IncidentFeedService.createIncidentFeedItem({
        incidentId: record.incidentId,
        projectId: data.projectId,
        incidentFeedEventType: IncidentFeedEventType.OnCallPolicy,
        displayColor: Gray500,
        feedInfoInMarkdown: feedInfoInMarkdown,
      });
      return;
    }

    if ("alertId" in record) {
      await AlertFeedService.createAlertFeedItem({
        alertId: record.alertId,
        projectId: data.projectId,
        alertFeedEventType: AlertFeedEventType.OnCallPolicy,
        displayColor: Gray500,
        feedInfoInMarkdown: feedInfoInMarkdown,
      });
      return;
    }

    if ("alertEpisodeId" in record) {
      await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
        alertEpisodeId: record.alertEpisodeId,
        projectId: data.projectId,
        alertEpisodeFeedEventType: AlertEpisodeFeedEventType.OnCallPolicy,
        displayColor: Gray500,
        feedInfoInMarkdown: feedInfoInMarkdown,
      });
      return;
    }

    await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
      incidentEpisodeId: record.incidentEpisodeId,
      projectId: data.projectId,
      incidentEpisodeFeedEventType: IncidentEpisodeFeedEventType.OnCallPolicy,
      displayColor: Gray500,
      feedInfoInMarkdown: feedInfoInMarkdown,
    });
  }

  // How the record's own feed names it: either kind of episode is an episode.
  private static getNoun(record: OnCallNotRunRecord): string {
    if ("incidentId" in record) {
      return "incident";
    }

    if ("alertId" in record) {
      return "alert";
    }

    return "episode";
  }

  /*
   * The line, for a record the feed calls `noun` ("incident", "alert",
   * "episode"). Policy names are free text: escaped, so a name cannot turn
   * into a link, an image or formatting.
   */
  public static getMarkdown(data: {
    noun: string;
    stage: StartingStage;
    policyNames: Array<string>;
  }): string {
    const names: Array<string> = data.policyNames.map(
      (name: string): string => {
        return `**${escapeMarkdownInline(name)}**`;
      },
    );

    const isOne: boolean = names.length === 1;

    const listed: string = isOne
      ? names[0]!
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

    const stateWord: string =
      data.stage === StartingStage.Resolved ? "resolved" : "acknowledged";

    return `📞 **No one was paged.** This ${data.noun} was created already ${stateWord}, so its on-call ${isOne ? "policy" : "policies"} ${listed} ${isOne ? "was" : "were"} not run.`;
  }

  /*
   * The line for the record's on-call `policies` (as the record lists them:
   * only their ids are read), in that order. Their names are read as
   * OneUptime, from the record's own project only. Null when none of them
   * exists any more, or there is none.
   */
  public static async getFeedMarkdown(data: {
    noun: string;
    stage: StartingStage;
    projectId: ObjectID;
    policies: Array<OnCallDutyPolicy>;
  }): Promise<string | null> {
    const policyIds: Array<string> = [];

    for (const policy of data.policies) {
      const id: string = (policy?._id || "").toString().toLowerCase();

      if (id && !policyIds.includes(id)) {
        policyIds.push(id);
      }
    }

    if (policyIds.length === 0) {
      return null;
    }

    const policies: Array<OnCallDutyPolicy> =
      await OnCallDutyPolicyService.findBy({
        query: {
          _id: QueryHelper.any(
            policyIds.map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
          ),
          projectId: data.projectId,
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

    const namesById: Map<string, string> = new Map<string, string>();

    for (const policy of policies) {
      const id: string | undefined = policy.id?.toString().toLowerCase();

      if (id) {
        namesById.set(id, policy.name?.toString() || "Unnamed policy");
      }
    }

    const policyNames: Array<string> = policyIds
      .filter((id: string): boolean => {
        return namesById.has(id);
      })
      .map((id: string): string => {
        return namesById.get(id)!;
      });

    if (policyNames.length === 0) {
      return null;
    }

    return this.getMarkdown({
      noun: data.noun,
      stage: data.stage,
      policyNames: policyNames,
    });
  }
}
