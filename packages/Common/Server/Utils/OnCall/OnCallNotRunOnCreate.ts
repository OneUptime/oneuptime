import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import { escapeMarkdownInline } from "../../../Utils/Markdown/MarkdownEscape";
import { StartingStage } from "../../../Utils/StartingStage";
import OnCallDutyPolicyService from "../../Services/OnCallDutyPolicyService";
import QueryHelper from "../../Types/Database/QueryHelper";

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
   * The line for the policies `policyIds` names, in that order, read as
   * OneUptime. Null when none of them exists any more, or none was named.
   */
  public static async getFeedMarkdown(data: {
    noun: string;
    stage: StartingStage;
    policyIds: Array<ObjectID | string>;
  }): Promise<string | null> {
    const policyIds: Array<string> = [];

    for (const policyId of data.policyIds) {
      const id: string = policyId.toString().toLowerCase();

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
