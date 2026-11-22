import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import ObjectID from "../../../Types/ObjectID";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../TeamMember/PendingInviteeProfiles";
import FeedPersonNameRule from "../Feed/FeedPersonNameRule";
import type { OwnerNotAdded } from "./OwnerRuleAssignment";

/*
 * The words a rule engine writes into a feed when its rules did something.
 *
 * Every engine names the rules that matched, and the rules' names are typed
 * by whoever wrote the rules, so they are text: written here once, through
 * FeedMarkdown, rather than escaped by hand in each engine.
 *
 *   - The engines of incidents, alerts, both kinds of episode, monitors and
 *     scheduled maintenance events head their item with the rules that ran:
 *     "🏷️ **Incident Label Rules executed:** **Prod**, **EU**" (executedLine).
 *   - The label and owner engines of hosts, clusters, servers, services and
 *     the other resources add a line under the item listing them as code:
 *     "**Label rules that matched**: `Prod`, `EU`" (matchedRulesLine).
 *
 * What they did - the labels added, the owners assigned, the policies
 * attached - is a FeedMarkdown.bulletList of names in the engine itself.
 */
// How many rules a "not checked in full" line names before "and N more".
const MAX_NOT_CHECKED_RULES_NAMED: number = 5;

export default class RuleFeedMarkdown {
  /**
   * "🏷️ **Incident Label Rule executed:** **Prod**", or "Rules" and every
   * rule's name, in bold, one after another.
   */
  public static executedLine(data: {
    emoji: string;
    // The rule's kind, singular: "Incident Label Rule".
    ruleKind: string;
    ruleNames: Array<string>;
  }): MarkdownText {
    const rules: MarkdownText = FeedMarkdown.join(
      data.ruleNames.map((name: string): MarkdownText => {
        return mdText`**${name}**`;
      }),
    );

    return mdText`${data.emoji} **${data.ruleKind}${data.ruleNames.length > 1 ? "s" : ""} executed:** ${rules}`;
  }

  /**
   * "🔒 **Incident Privacy Rule not checked in full:** **Prod**", or "Rules"
   * and the first rules' names and how many more: rules whose patterns
   * needed more work than one evaluation may take
   * (Utils/LinearRegExp/PatternWork.ts), and so counted as matching, with
   * why.
   */
  public static notCheckedInFullLine(data: {
    emoji: string;
    // The rule's kind, singular: "Incident Privacy Rule".
    ruleKind: string;
    ruleNames: Array<string>;
  }): MarkdownText {
    const shown: Array<string> = data.ruleNames.slice(
      0,
      MAX_NOT_CHECKED_RULES_NAMED,
    );
    const more: number = data.ruleNames.length - shown.length;
    const rules: MarkdownText = FeedMarkdown.join(
      shown.map((name: string): MarkdownText => {
        return mdText`**${name}**`;
      }),
    );
    const plural: boolean = data.ruleNames.length > 1;

    return mdText`${data.emoji} **${data.ruleKind}${plural ? "s" : ""} not checked in full:** ${rules}${more > 0 ? ` and ${more} more` : ""}. ${plural ? "Their" : "Its"} patterns needed more work than one check may take, so ${plural ? "they" : "it"} counted as matching.`;
  }

  /**
   * The owners an owner rule assigned, one bullet each - "- 👤 Ada Lovelace",
   * "- 👥 Platform" - or "- (no named owners)" when none has a name.
   * `withheld` is who of the users is only invited to the project
   * (readOwnersList). Each is named as every feed entry names them
   * (FeedPersonName): never by an address (#10668, #10669).
   */
  public static ownersList(data: {
    users: Array<User>;
    teams: Array<Team>;
    withheld?: Map<string, WithheldProfile> | undefined;
  }): MarkdownText {
    const withheld: Map<string, WithheldProfile> =
      data.withheld || new Map<string, WithheldProfile>();

    return FeedMarkdown.bulletList(
      [
        ...data.users.map((user: User): MarkdownText => {
          return mdText`👤 ${
            FeedPersonNameRule.getName({
              userId: user.id,
              name: user.name,
              email: user.email,
              withheld: withheld,
            }) || "Unknown User"
          }`;
        }),
        ...data.teams.map((team: Team): MarkdownText => {
          return mdText`👥 ${team.name?.toString() || "Unnamed Team"}`;
        }),
      ],
      { whenEmpty: "(no named owners)" },
    );
  }

  /*
   * The owners a rule named that were not added (#9933), one bullet each,
   * with why:
   *
   *   - 👤 Ada Lovelace, who is not a member of this project
   *   - 👤 Ada from Payments, who has not accepted the invitation to this project yet
   *   - 👤 Someone who has not accepted the invitation to this project yet
   *   - 👥 A team that is not one of this project's teams (`<id>`)
   *
   * `users` are the skipped people, read as OneUptime; `withheld` who of
   * them is only invited to the project (readWithheldProfilesInProject). A
   * person is named as ownersList names an owner (FeedPersonName): someone
   * only invited by the name typed for them - with none, the bullet says
   * "Someone" - never by their account's own name or any address (#10668).
   * Someone who left the project keeps the name the project knew. The rule
   * itself says who it names, for whoever keeps it.
   * A team that is not the project's is never named - its name is another
   * project's - but its id is: the rule holds it, and it says which of the
   * rule's teams to take out.
   */
  public static ownersNotAddedList(data: {
    notAdded: Array<OwnerNotAdded>;
    users: Array<User>;
    withheld?: Map<string, WithheldProfile> | undefined;
  }): MarkdownText {
    const withheld: Map<string, WithheldProfile> =
      data.withheld || new Map<string, WithheldProfile>();

    const usersById: Map<string, User> = new Map<string, User>();

    for (const user of data.users) {
      const userId: string = user.id?.toString().toLowerCase() || "";

      if (userId) {
        usersById.set(userId, user);
      }
    }

    // People first, then teams, as ownersList lists the owners added.
    const ordered: Array<OwnerNotAdded> = [
      ...data.notAdded.filter((owner: OwnerNotAdded): boolean => {
        return owner.ownerColumn === "userId";
      }),
      ...data.notAdded.filter((owner: OwnerNotAdded): boolean => {
        return owner.ownerColumn === "teamId";
      }),
    ];

    return FeedMarkdown.bulletList(
      ordered.map((owner: OwnerNotAdded): MarkdownText => {
        if (owner.ownerColumn === "teamId") {
          return mdText`👥 A team that is not one of this project's teams (${FeedMarkdown.code(
            owner.id.toString(),
          )})`;
        }

        const user: User | undefined = usersById.get(
          owner.id.toString().toLowerCase(),
        );

        const invited: WithheldProfile | undefined =
          PendingInviteeProfiles.getWithheldProfile({
            userId: owner.id,
            withheld: withheld,
          });

        if (invited) {
          const typedName: string = FeedPersonNameRule.getDisplayName(
            invited.inviteeName,
          );

          return typedName
            ? mdText`👤 ${typedName}, who has not accepted the invitation to this project yet`
            : mdText`👤 Someone who has not accepted the invitation to this project yet`;
        }

        const name: string =
          FeedPersonNameRule.getName({
            userId: owner.id,
            name: user?.name,
            email: user?.email,
            withheld: withheld,
          }) || "Unknown User";

        return mdText`👤 ${name}, who is not a member of this project`;
      }),
    );
  }

  /*
   * ownersList, for owners an engine read as OneUptime in `projectId`:
   * someone only invited to the project is listed by the name typed for
   * them, never by their account's own name, which it does not see until
   * they join (#9823), or an address (FeedPersonName). One read for them
   * all.
   */
  public static async readOwnersList(data: {
    users: Array<User>;
    teams: Array<Team>;
    projectId: ObjectID;
  }): Promise<MarkdownText> {
    const withheld: Map<string, WithheldProfile> =
      await PendingInviteeProfiles.readWithheldProfilesInProject({
        userIds: data.users
          .map((user: User): string => {
            return user.id?.toString() || "";
          })
          .filter((userId: string): boolean => {
            return Boolean(userId);
          }),
        projectId: data.projectId,
      });

    return RuleFeedMarkdown.ownersList({
      users: data.users,
      teams: data.teams,
      withheld: withheld,
    });
  }

  /**
   * "**Label rules that matched**: `Prod`, `EU`" - each rule's name as code,
   * or in bold (the SLO engines' "**Prod**, **EU**").
   */
  public static matchedRulesLine(data: {
    // "Label" or "Owner".
    ruleKind: string;
    ruleNames: Array<string>;
    namesInBold?: boolean | undefined;
  }): MarkdownText {
    return mdText`**${data.ruleKind} rules that matched**: ${FeedMarkdown.join(
      data.ruleNames.map((name: string): MarkdownText => {
        return data.namesInBold ? mdText`**${name}**` : FeedMarkdown.code(name);
      }),
    )}`;
  }

  /*
   * What an on-call rule engine did with the policies its rules matched,
   * under the line naming the rules (OnCallRulePageAs):
   *
   *   Attached the following on-call policy to the incident:
   *   - Platform on-call
   *
   *   Paging the following on-call policy as observers - kept informed,
   *   while the people responding stay on the incident:
   *   - Oversight on-call
   *
   * Either part is left out when it names nothing. `recordNoun` is "incident",
   * "alert" or "episode".
   */
  public static onCallRulePolicies(data: {
    recordNoun: string;
    attachedPolicyNames: Array<string>;
    observerPolicyNames: Array<string>;
  }): MarkdownText {
    const parts: Array<MarkdownText> = [];

    if (data.attachedPolicyNames.length > 0) {
      parts.push(
        mdText`Attached the following on-call ${
          data.attachedPolicyNames.length === 1 ? "policy" : "policies"
        } to the ${data.recordNoun}:\n${FeedMarkdown.bulletList(
          data.attachedPolicyNames,
        )}`,
      );
    }

    if (data.observerPolicyNames.length > 0) {
      parts.push(
        mdText`Paging the following on-call ${
          data.observerPolicyNames.length === 1 ? "policy" : "policies"
        } as observers - kept informed, while the people responding stay on the ${
          data.recordNoun
        }:\n${FeedMarkdown.bulletList(data.observerPolicyNames)}`,
      );
    }

    if (parts.length === 0) {
      return mdText`Attached the following on-call policies to the ${
        data.recordNoun
      }:\n${FeedMarkdown.bulletList([], { whenEmpty: "(no named policies)" })}`;
    }

    return FeedMarkdown.join(parts, "\n\n");
  }
}
