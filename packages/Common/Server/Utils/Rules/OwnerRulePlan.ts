import ObjectID from "../../../Types/ObjectID";

/*
 * WHAT AN EVENT'S OWNER RULES WILL ADD, WORKED OUT BEFORE ANYTHING IS
 * WRITTEN.
 *
 * The owner rule engines of incidents, alerts and their episodes evaluate
 * the project's rules in two halves: a plan - which rules match, and who
 * each of them brings - and the writes that carry the plan out (the owner
 * rows, the notifications, the feed item). The plan is all the create form's
 * review needs to say, before an incident is declared, which owner rules
 * will run and who they will add (POST /<event>/owner-rule-preview): the
 * preview is the same plan, made by the same code, of the event as the form
 * holds it, and nothing is ever guessed in the browser.
 *
 * Who a matched rule brings:
 *
 *   - the people and teams it names (ownerUsers, ownerTeams);
 *   - the creator's team: of the teams it lists (creatorTeams), each one the
 *     person who created the event is a member of - an event a monitor, a
 *     workflow or an API key creates has no creator, and brings none;
 *   - what it inherits: every owner of the event's monitors, hosts,
 *     Kubernetes clusters, Docker and Podman hosts and services, one switch
 *     each, read once for every rule that inherits from them.
 *
 * Whether they are told is each rule's Notify Owners, and the run's own say
 * (a "Run now" adds silently unless asked otherwise): the people and teams
 * a rule names, and its creator's team, follow its own switch; inherited
 * owners are notified when any matched rule that inherits notifies. An
 * owner two rules disagree about is added once, and notified.
 */

// Where an incident or alert rule can inherit owners from, one switch each.
export type OwnerRuleInheritSource =
  | "monitors"
  | "hosts"
  | "kubernetesClusters"
  | "dockerHosts"
  | "podmanHosts"
  | "services";

/*
 * The six sources in the order the rule form shows their switches
 * (INHERITED_OWNER_COLUMNS), with the column of each.
 */
export const OWNER_RULE_INHERIT_SOURCES: ReadonlyArray<{
  source: OwnerRuleInheritSource;
  column: string;
}> = [
  { source: "monitors", column: "inheritOwnersFromMonitors" },
  { source: "hosts", column: "inheritOwnersFromHosts" },
  {
    source: "kubernetesClusters",
    column: "inheritOwnersFromKubernetesClusters",
  },
  { source: "dockerHosts", column: "inheritOwnersFromDockerHosts" },
  { source: "podmanHosts", column: "inheritOwnersFromPodmanHosts" },
  { source: "services", column: "inheritOwnersFromServices" },
];

// People and teams by id.
export interface OwnerIdSets {
  userIds: Set<string>;
  teamIds: Set<string>;
}

// What one rule that matched asks for.
export interface OwnerRuleMatch<TRule> {
  rule: TRule;
  // The rule's Notify Owners: anything but false is on, as the column starts.
  notifyOwners: boolean | null | undefined;
  // The people and teams it names.
  userIds: Array<string>;
  teamIds: Array<string>;
  /*
   * Whether it lists teams for the creator's team at all, and the ones of
   * them the creator is in.
   */
  listsCreatorTeams: boolean;
  creatorTeamIds: Array<string>;
  // The sources it inherits owners from.
  inheritsFrom: Array<OwnerRuleInheritSource>;
}

// One matched rule and everyone it brings: what the preview lists.
export interface OwnerRulePlanEntry<TRule> {
  rule: TRule;
  // Whether the people and teams it names, and its creator's team, are told.
  notify: boolean;
  // Everyone it brings, each once: named, the creator's team, inherited.
  userIds: Array<string>;
  teamIds: Array<string>;
  // Of those teams, the ones it adds as the creator's team.
  creatorTeamIds: Array<string>;
}

export interface OwnerRulePlan<TRule> {
  // At least one rule matched, whether or not it adds anyone.
  anyRuleMatched: boolean;
  /*
   * The rules that matched and add something - by name, as the creator's
   * team or by inheriting - in the order they were evaluated: what the feed
   * item names.
   */
  matchedRules: Array<TRule>;
  // Each of those rules and who it brings.
  entries: Array<OwnerRulePlanEntry<TRule>>;
  // Who the plan adds, by whether they are notified.
  usersByNotify: Map<boolean, Set<string>>;
  teamsByNotify: Map<boolean, Set<string>>;
  allUserIds: Set<string>;
  allTeamIds: Set<string>;
  // The owners inherited from each source, for the feed item's note.
  inherited: Map<OwnerRuleInheritSource, OwnerIdSets>;
  // The teams added as the creator's team, for the feed item's note.
  creatorTeamIds: Set<string>;
}

interface MatchedRule<TRule> extends OwnerRuleMatch<TRule> {
  notify: boolean;
}

const emptyIdSets: () => OwnerIdSets = (): OwnerIdSets => {
  return { userIds: new Set<string>(), teamIds: new Set<string>() };
};

export default class OwnerRulePlanBuilder<TRule> {
  private readonly allowOwnerNotification: boolean;
  private anyRuleMatched: boolean = false;
  private readonly matches: Array<MatchedRule<TRule>> = [];
  // Null until a matched rule inherits: then whether any of them notifies.
  private inheritNotify: boolean | null = null;

  /*
   * allowOwnerNotification: false adds every owner silently, whatever the
   * rules say - a "Run now" over many events that did not opt in.
   */
  public constructor(allowOwnerNotification: boolean) {
    this.allowOwnerNotification = allowOwnerNotification;
  }

  // The ids of a rule's related rows, as text, each once, in their order.
  public static idsOf(
    rows: Array<{ id?: ObjectID | null | undefined }> | null | undefined,
  ): Array<string> {
    const ids: Array<string> = [];

    for (const row of rows || []) {
      const id: string | undefined = row?.id?.toString();

      if (id && !ids.includes(id)) {
        ids.push(id);
      }
    }

    return ids;
  }

  // The sources a rule's switches inherit from, in the form's order.
  public static getInheritSources(
    rule: unknown,
  ): Array<OwnerRuleInheritSource> {
    const values: Record<string, unknown> =
      rule && typeof rule === "object" ? (rule as Record<string, unknown>) : {};

    return OWNER_RULE_INHERIT_SOURCES.filter(
      (entry: { source: OwnerRuleInheritSource; column: string }): boolean => {
        return values[entry.column] === true;
      },
    ).map(
      (entry: {
        source: OwnerRuleInheritSource;
        column: string;
      }): OwnerRuleInheritSource => {
        return entry.source;
      },
    );
  }

  /*
   * A rule that matched. One that adds nothing at all - no one named, no
   * creator's teams listed, nothing inherited - still counts as a match, as
   * it always did: the run reports it matched and did nothing.
   */
  public addMatch(match: OwnerRuleMatch<TRule>): void {
    this.anyRuleMatched = true;

    const notify: boolean =
      match.notifyOwners !== false && this.allowOwnerNotification;

    if (match.inheritsFrom.length > 0) {
      this.inheritNotify = this.inheritNotify === true ? true : notify;
    }

    this.matches.push({ ...match, notify: notify });
  }

  // The sources some matched rule inherits from: the ones to read.
  public getSourcesToInherit(): Set<OwnerRuleInheritSource> {
    const sources: Set<OwnerRuleInheritSource> =
      new Set<OwnerRuleInheritSource>();

    for (const match of this.matches) {
      for (const source of match.inheritsFrom) {
        sources.add(source);
      }
    }

    return sources;
  }

  /*
   * The plan, given who each source's owners are (a source missing from the
   * map has none: the event has no such resource, or nobody owns it).
   */
  public build(
    inherited: Map<OwnerRuleInheritSource, OwnerIdSets>,
  ): OwnerRulePlan<TRule> {
    const usersByNotify: Map<boolean, Set<string>> = new Map([
      [true, new Set<string>()],
      [false, new Set<string>()],
    ]);
    const teamsByNotify: Map<boolean, Set<string>> = new Map([
      [true, new Set<string>()],
      [false, new Set<string>()],
    ]);
    const allUserIds: Set<string> = new Set<string>();
    const allTeamIds: Set<string> = new Set<string>();
    const creatorTeamIds: Set<string> = new Set<string>();
    const matchedRules: Array<TRule> = [];
    const entries: Array<OwnerRulePlanEntry<TRule>> = [];

    for (const match of this.matches) {
      const addsSomething: boolean =
        match.userIds.length > 0 ||
        match.teamIds.length > 0 ||
        match.listsCreatorTeams ||
        match.inheritsFrom.length > 0;

      if (!addsSomething) {
        continue;
      }

      matchedRules.push(match.rule);

      for (const userId of match.userIds) {
        usersByNotify.get(match.notify)!.add(userId);
        allUserIds.add(userId);
      }

      for (const teamId of [...match.teamIds, ...match.creatorTeamIds]) {
        teamsByNotify.get(match.notify)!.add(teamId);
        allTeamIds.add(teamId);
      }

      for (const teamId of match.creatorTeamIds) {
        creatorTeamIds.add(teamId);
      }

      const entryUserIds: Set<string> = new Set<string>(match.userIds);
      const entryTeamIds: Set<string> = new Set<string>([
        ...match.teamIds,
        ...match.creatorTeamIds,
      ]);

      for (const source of match.inheritsFrom) {
        const owners: OwnerIdSets = inherited.get(source) || emptyIdSets();

        for (const userId of owners.userIds) {
          entryUserIds.add(userId);
        }

        for (const teamId of owners.teamIds) {
          entryTeamIds.add(teamId);
        }
      }

      entries.push({
        rule: match.rule,
        notify: match.notify,
        userIds: Array.from(entryUserIds),
        teamIds: Array.from(entryTeamIds),
        creatorTeamIds: [...match.creatorTeamIds],
      });
    }

    /*
     * Inherited owners are added once for every rule that inherits, so they
     * are told when any of those rules tells its owners - and never on a run
     * that did not opt in.
     */
    const inheritNotify: boolean =
      this.inheritNotify === true && this.allowOwnerNotification;

    const sourcesToInherit: Set<OwnerRuleInheritSource> =
      this.getSourcesToInherit();

    // In the switches' order, whichever rule turned each one on.
    for (const entry of OWNER_RULE_INHERIT_SOURCES) {
      const owners: OwnerIdSets | undefined = inherited.get(entry.source);

      if (!owners || !sourcesToInherit.has(entry.source)) {
        continue;
      }

      for (const userId of owners.userIds) {
        usersByNotify.get(inheritNotify)!.add(userId);
        allUserIds.add(userId);
      }

      for (const teamId of owners.teamIds) {
        teamsByNotify.get(inheritNotify)!.add(teamId);
        allTeamIds.add(teamId);
      }
    }

    return {
      anyRuleMatched: this.anyRuleMatched,
      matchedRules: matchedRules,
      entries: entries,
      usersByNotify: usersByNotify,
      teamsByNotify: teamsByNotify,
      allUserIds: allUserIds,
      allTeamIds: allTeamIds,
      inherited: inherited,
      creatorTeamIds: creatorTeamIds,
    };
  }
}
