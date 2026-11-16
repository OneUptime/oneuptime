import ObjectID from "../ObjectID";

/*
 * WHERE AN ON-CALL RUN IS IN ITS POLICY'S LEVELS, AND WHICH LEVEL COMES NEXT
 * (issue #9036).
 *
 * A run records the level it is on as it starts it: the escalation rule
 * (lastExecutedEscalationRuleId) and the rule's place in the policy then
 * (lastExecutedEscalationRuleOrder). The policy's levels can change while
 * the run pages - a level added, moved or deleted, and the levels after a
 * deleted one move up a place (ContiguousOrder) - so where the run is, and
 * so which level comes next, is read from the levels as they are now:
 *
 *   - ON A LEVEL THAT IS STILL THERE: at that level's place now. The levels
 *     after it are the ones later than that place, so a level added or
 *     deleted before it neither skips a level nor pages its own again.
 *   - ON A LEVEL THAT WAS DELETED: deleting a rule keeps the run and clears
 *     its reference to the rule (ON DELETE SET NULL); the place it recorded
 *     stays. The levels after it are the ones at that place and later: the
 *     level that moved up into the deleted one's place comes next. The run
 *     waits out the wait it had started, then pages it - nobody earlier
 *     than they would have been, and the run never just stops.
 *   - ON NO LEVEL YET: every level is after it.
 *
 * A place is a level's order: 1 for the first, though a policy's levels
 * written through the API may start elsewhere or leave gaps, so "next" is
 * the first level after, never "the one numbered one more". The worker that
 * moves runs on (OnCallEscalationAdvance), the preview of a person passing
 * a page on (OnCallPagePassOn) and the run's chat message
 * (OnCallPolicyRunMessage) all read it here, so they agree.
 */

// What a run records about the level it is on.
export interface OnCallRunPlace {
  lastExecutedEscalationRuleId?: ObjectID | string | null | undefined;
  lastExecutedEscalationRuleOrder?: number | null | undefined;
}

// A level of a policy: an escalation rule, by its id and its place now.
export interface OnCallPolicyLevel {
  id?: ObjectID | null | undefined;
  order?: number | null | undefined;
}

// A place a run recorded: a level's order, a whole number.
function isPlace(order: number | null | undefined): order is number {
  return typeof order === "number" && Number.isInteger(order);
}

function idOf(id: ObjectID | string | null | undefined): string {
  return id ? id.toString().toLowerCase() : "";
}

/*
 * Whether the run has started a level: the place is recorded with the rule
 * as the level starts, and stays when the level is deleted. A run that has
 * not - it waits to page, or its start never got as far as its first rule -
 * has neither.
 */
export function hasOnCallRunStartedALevel(run: OnCallRunPlace): boolean {
  return (
    Boolean(idOf(run.lastExecutedEscalationRuleId)) ||
    isPlace(run.lastExecutedEscalationRuleOrder)
  );
}

/*
 * Whether the level the run is on was deleted: it started one - its place
 * is recorded - and the rule was cleared from it. (A run read before the
 * rule was cleared still names it; getOnCallRunCurrentLevel finds no such
 * level among the policy's levels then, and the run is placed by its
 * recorded place all the same.)
 */
export function isOnCallRunLevelDeleted(run: OnCallRunPlace): boolean {
  return (
    !idOf(run.lastExecutedEscalationRuleId) &&
    isPlace(run.lastExecutedEscalationRuleOrder)
  );
}

// A policy's levels in order, each once, leaving out any without a place.
export function sortOnCallPolicyLevels<TLevel extends OnCallPolicyLevel>(
  levels: ReadonlyArray<TLevel>,
): Array<TLevel> {
  const seen: Set<string> = new Set<string>();

  return levels
    .filter((level: TLevel): boolean => {
      const key: string = idOf(level.id);

      if (!isPlace(level.order) || (key && seen.has(key))) {
        return false;
      }

      if (key) {
        seen.add(key);
      }

      return true;
    })
    .sort((left: TLevel, right: TLevel): number => {
      return left.order! - right.order!;
    });
}

/*
 * The level the run is on, among the policy's levels now: null when it was
 * deleted, or the run has started none.
 */
export function getOnCallRunCurrentLevel<
  TLevel extends OnCallPolicyLevel,
>(data: { run: OnCallRunPlace; levels: ReadonlyArray<TLevel> }): TLevel | null {
  const currentId: string = idOf(data.run.lastExecutedEscalationRuleId);

  if (!currentId) {
    return null;
  }

  return (
    sortOnCallPolicyLevels(data.levels).find((level: TLevel): boolean => {
      return idOf(level.id) === currentId;
    }) || null
  );
}

/*
 * The levels after the one the run is on, first to last: the ones later
 * than its level's place now - or, its level deleted, at its recorded place
 * and later - or all of them, when it has started none.
 */
export function getOnCallRunLaterLevels<
  TLevel extends OnCallPolicyLevel,
>(data: { run: OnCallRunPlace; levels: ReadonlyArray<TLevel> }): Array<TLevel> {
  const levels: Array<TLevel> = sortOnCallPolicyLevels(data.levels);
  const current: TLevel | null = getOnCallRunCurrentLevel({
    run: data.run,
    levels: levels,
  });

  if (current) {
    return levels.filter((level: TLevel): boolean => {
      return level.order! > current.order!;
    });
  }

  const recorded: number | null | undefined =
    data.run.lastExecutedEscalationRuleOrder;

  if (isPlace(recorded)) {
    return levels.filter((level: TLevel): boolean => {
      return level.order! >= recorded;
    });
  }

  return levels;
}

// The level that comes next for the run, or null when none is left.
export function getOnCallRunNextLevel<TLevel extends OnCallPolicyLevel>(data: {
  run: OnCallRunPlace;
  levels: ReadonlyArray<TLevel>;
}): TLevel | null {
  return getOnCallRunLaterLevels(data)[0] || null;
}

/*
 * The level a pass of the policy starts with: its first now - the lowest
 * place, which need not be 1.
 */
export function getOnCallPolicyFirstLevel<TLevel extends OnCallPolicyLevel>(
  levels: ReadonlyArray<TLevel>,
): TLevel | null {
  return sortOnCallPolicyLevels(levels)[0] || null;
}

/*
 * What a level whose escalation rule was deleted is called, from what was
 * recorded when it paged: "Level 2: Database (deleted)", "Level 2
 * (deleted)" - or "Deleted escalation rule" with nothing recorded.
 */
export const ON_CALL_DELETED_LEVEL_WITH_NAME_TEMPLATE: string =
  "Level {{order}}: {{name}} (deleted)";
export const ON_CALL_DELETED_LEVEL_TEMPLATE: string =
  "Level {{order}} (deleted)";
export const ON_CALL_DELETED_LEVEL_LABEL: string = "Deleted escalation rule";

export interface OnCallDeletedLevel {
  order?: number | null | undefined;
  name?: string | null | undefined;
}

/*
 * Which of those three names a deleted level, and its values: the template
 * and what fills it, so a reader's language can word it.
 */
export function getOnCallDeletedLevelWords(level: OnCallDeletedLevel): {
  template: string;
  values: { order?: number; name?: string };
} {
  const name: string = (level.name || "").trim();

  if (!isPlace(level.order)) {
    return { template: ON_CALL_DELETED_LEVEL_LABEL, values: {} };
  }

  if (name) {
    return {
      template: ON_CALL_DELETED_LEVEL_WITH_NAME_TEMPLATE,
      values: { order: level.order, name: name },
    };
  }

  return {
    template: ON_CALL_DELETED_LEVEL_TEMPLATE,
    values: { order: level.order },
  };
}

// The same, in English: for a chat message, a feed entry or a log line.
export function getOnCallDeletedLevelLabel(level: OnCallDeletedLevel): string {
  const words: {
    template: string;
    values: { order?: number; name?: string };
  } = getOnCallDeletedLevelWords(level);

  return words.template
    .replace("{{order}}", String(words.values.order ?? ""))
    .replace("{{name}}", words.values.name ?? "");
}
