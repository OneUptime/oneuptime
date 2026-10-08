import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";

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
   * The owners an owner rule assigned, one bullet each - "- 👤 Ada Lovelace",
   * "- 👥 Platform" - or "- (no named owners)" when none has a name.
   */
  public static ownersList(data: {
    users: Array<User>;
    teams: Array<Team>;
  }): MarkdownText {
    return FeedMarkdown.bulletList(
      [
        ...data.users.map((user: User): MarkdownText => {
          return mdText`👤 ${user.name?.toString() || user.email?.toString() || "Unknown User"}`;
        }),
        ...data.teams.map((team: Team): MarkdownText => {
          return mdText`👥 ${team.name?.toString() || "Unnamed Team"}`;
        }),
      ],
      { whenEmpty: "(no named owners)" },
    );
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
}
