import AutoRemediationAction from "./AutoRemediationAction";
import AutoRemediationExecutionMode from "./AutoRemediationExecutionMode";
import ObjectID from "../ObjectID";

/*
 * HOW AN AUTO REMEDIATION RULE FIXES WHAT IT MATCHES - the one reading.
 *
 * The maintainer, on the rule's Fix step: "Why should I pick between
 * OneUptime AI and Runbook? Can OneUptime AI do things by default, and I can
 * whitelist some Runbook for AI to pick and run? If I do not whitelist any
 * Runbook, it can basically run any Runbook by default." So a rule no longer
 * asks who fixes. OneUptime AI does, and everything else is a narrowing
 * most people never set:
 *
 *   - OneUptime AI fixes through the AI agent on the affected Kubernetes
 *     cluster or host (the cluster and resource rounds), the way each one's
 *     AI agent page allows;
 *   - it may pick one of the project's runbooks and run it: any runbook
 *     when the rule names none, only the rule's runbooks when it names some
 *     (AutoRemediationRule.runbooks is the allow-list);
 *   - it runs commands of its own (Bash, SSH) on a Runner only when the
 *     rule picks one (AutoRemediationRule.runnerId). With none, it uses the
 *     AI agents above: the global Runners never run OneUptime AI's commands
 *     - they run JavaScript steps in a sandbox shared by every project, and
 *     could not reach a project's systems anyway. The rule's form shows a
 *     rule that picks none on the Global Runner, where the project uses
 *     one, and says no Bash command runs there: that is still none.
 *
 * One older shape stays a choice, folded away: a rule that starts every
 * runbook it names, every time, without OneUptime AI deciding
 * (remediationAction Runbooks - "Run them every time"). Every rule saved
 * with Fix With set to Runbooks is one, and keeps doing exactly that: no AI
 * judgement, no LLM provider needed, the same runbooks for every match.
 *
 * And two shapes from before rules were simplified keep doing what they did
 * and nothing more: a rule that has AI compose commands on Runners, and one
 * that has AI pick a runbook (always asking first). Neither turns the
 * cluster and host fixes on.
 *
 * Pure, so the rule engine, the AI runs it starts, the rule service and the
 * dashboard read a rule the same way.
 */

export enum AutoRemediationFixKind {
  /*
   * OneUptime AI fixes: through the AI agents, with the rule's runbooks (any
   * runbook when it names none), and with commands on the rule's Runner when
   * it picks one. What every new rule is.
   */
  OneUptimeAi = "OneUptimeAi",
  /*
   * The rule starts every runbook it names for every match, the same way
   * every time, without OneUptime AI deciding ("Run them every time").
   */
  RunbooksEveryTime = "RunbooksEveryTime",
  /*
   * Saved before rules were simplified: OneUptime AI composes commands on
   * the rule's Runners, and does nothing else for it.
   */
  CommandsOnRunners = "CommandsOnRunners",
  /*
   * Saved before rules were simplified: OneUptime AI picks one of the rule's
   * runbooks (any runbook when it names none) and proposes it, and does
   * nothing else for it.
   */
  AiPicksRunbook = "AiPicksRunbook",
}

// What a rule says about how it fixes, as stored or as a write sends it.
export interface AutoRemediationFixFacts {
  remediationAction?: AutoRemediationAction | string | null | undefined;
  aiComposesCommands?: boolean | null | undefined;
  aiSelectsRunbook?: boolean | null | undefined;
}

/*
 * How a rule fixes. A rule saved without the column (an older API client)
 * reads as OneUptime AI, the column's default. A rule saved with both of the
 * old AI flags composes commands: the two never ran together.
 */
export function getAutoRemediationFixKind(
  rule: AutoRemediationFixFacts,
): AutoRemediationFixKind {
  if (rule.remediationAction === AutoRemediationAction.Runbooks) {
    return AutoRemediationFixKind.RunbooksEveryTime;
  }

  if (rule.aiComposesCommands === true) {
    return AutoRemediationFixKind.CommandsOnRunners;
  }

  if (rule.aiSelectsRunbook === true) {
    return AutoRemediationFixKind.AiPicksRunbook;
  }

  return AutoRemediationFixKind.OneUptimeAi;
}

/*
 * Whether OneUptime AI fixes what the rule matches the way every new rule
 * does: through the AI agents, with runbooks, and on the rule's Runner.
 */
export function isOneUptimeAiFixRule(rule: AutoRemediationFixFacts): boolean {
  return getAutoRemediationFixKind(rule) === AutoRemediationFixKind.OneUptimeAi;
}

// An id from a stored value, a relation row ({ _id } or { id }) or a string.
function readId(value: unknown): string {
  if (value instanceof ObjectID) {
    return value.toString().trim().toLowerCase();
  }

  if (typeof value === "string") {
    return value.trim().toLowerCase();
  }

  if (value && typeof value === "object") {
    const row: { _id?: unknown; id?: unknown } = value as {
      _id?: unknown;
      id?: unknown;
    };

    return readId(row._id ?? row.id);
  }

  return "";
}

// The ids a list holds (relation rows, ids, or a single one), each once.
export function readAutoRemediationIds(value: unknown): Array<string> {
  const values: Array<unknown> = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];

  const ids: Array<string> = [];

  for (const item of values) {
    const id: string = readId(item);

    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
}

/*
 * The runbooks a rule names: for a OneUptime AI rule, the only ones
 * OneUptime AI may pick (none named: any runbook of the project); for a
 * "Run them every time" rule, the ones it starts.
 */
export function getRuleRunbookIds(rule: { runbooks?: unknown }): Array<string> {
  return readAutoRemediationIds(rule.runbooks);
}

// The Runner a rule picks for OneUptime AI's commands, or "" for none.
export function getRuleRunnerId(rule: { runnerId?: unknown }): string {
  return readId(rule.runnerId);
}

/*
 * The Runners OneUptime AI may run a rule's commands on: the Runner it
 * picks and, for a rule saved before rules were simplified that composes
 * commands, the Command Runners it named too. Any other rule's Command
 * Runners are left out: they never decided anything for it. None means no
 * Runner at all - never "any Runner": a Runner runs OneUptime AI's commands
 * for a rule only when the rule names it.
 */
export function getRuleCommandRunnerIds(
  rule: AutoRemediationFixFacts & {
    runnerId?: unknown;
    commandRunners?: unknown;
  },
): Array<string> {
  const ids: Array<string> = [];
  const runnerId: string = getRuleRunnerId(rule);

  if (runnerId) {
    ids.push(runnerId);
  }

  if (
    getAutoRemediationFixKind(rule) === AutoRemediationFixKind.CommandsOnRunners
  ) {
    for (const id of readAutoRemediationIds(rule.commandRunners)) {
      if (!ids.includes(id)) {
        ids.push(id);
      }
    }
  }

  return ids;
}

/*
 * Whether OneUptime AI composes commands of its own on Runners for a rule:
 * a OneUptime AI rule that picks a Runner, or a rule saved before rules were
 * simplified that composes commands.
 */
export function doesRuleRunCommandsOnRunners(
  rule: AutoRemediationFixFacts & { runnerId?: unknown },
): boolean {
  const kind: AutoRemediationFixKind = getAutoRemediationFixKind(rule);

  if (kind === AutoRemediationFixKind.CommandsOnRunners) {
    return true;
  }

  return (
    kind === AutoRemediationFixKind.OneUptimeAi &&
    Boolean(getRuleRunnerId(rule))
  );
}

/*
 * What a runbook pick made for no rule - the project's default, when no
 * rule is set up - carries as its rule name, where a rule's pick carries
 * the rule's. The feed names OneUptime AI, and the Remediation card names
 * it as it is, not as a rule (isProjectRunbookPick).
 */
export const DEFAULT_RUNBOOK_PICK_NAME: string = "OneUptime AI";

/*
 * Whether a suggestion is the project's own runbook pick, for a reader that
 * names it: no rule, no cluster and no resource, and the name the project's
 * pick carries - a pick whose rule was deleted since keeps its rule's name.
 */
export function isProjectRunbookPick(suggestion: {
  autoRemediationRuleId?: unknown;
  kubernetesClusterId?: unknown;
  resourceId?: unknown;
  ruleNameSnapshot?: unknown;
}): boolean {
  return (
    !suggestion.autoRemediationRuleId &&
    !suggestion.kubernetesClusterId &&
    !suggestion.resourceId &&
    suggestion.ruleNameSnapshot === DEFAULT_RUNBOOK_PICK_NAME
  );
}

/*
 * Whether a runbook OneUptime AI picks for a OneUptime AI rule starts right
 * away, or is proposed for one-click approval. It starts only when all of
 * these hold:
 *
 *   - the rule fixes without asking (Full Auto), and no other matching
 *     OneUptime AI rule asks before fixing - of several, the one that asks
 *     wins, as it does for the AI agents' fixes;
 *   - the rule names its runbooks, so the pick is one a person chose for
 *     this: with no runbooks named OneUptime AI may pick any of the
 *     project's runbooks, and a pick made from signal text an attacker can
 *     write is never started without a person's approval;
 *   - the AI agent is not already fixing the signal on a cluster or host:
 *     two fixes running on their own for one signal verify and roll back on
 *     top of each other.
 *
 * The hourly breaker of the rule is read again when the pick is made.
 */
export function mayAiPickedRunbookStartWithoutAsking(data: {
  executionMode?: AutoRemediationExecutionMode | string | null | undefined;
  namesRunbooks: boolean;
  anotherRuleAsksFirst: boolean;
  agentRoundStarted: boolean;
}): boolean {
  return (
    data.executionMode === AutoRemediationExecutionMode.FullAuto &&
    data.namesRunbooks &&
    !data.anotherRuleAsksFirst &&
    !data.agentRoundStarted
  );
}
