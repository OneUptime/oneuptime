/*
 * What a new escalation rule of an on-call policy starts with, and what it is
 * called when nobody names it.
 *
 * Adding a rule asks two things: who to notify, and how long to wait for an
 * acknowledgement before the next level is paged. Everything else has a
 * default. A rule is a rung of a ladder, so a rule nobody names is called
 * after its rung: "Level 1", "Level 2". The server gives a rule created
 * without a name that name (OnCallDutyPolicyEscalationRuleService), and the
 * dashboard shows the same name as the form's placeholder, so what the form
 * shows is what is saved.
 *
 * React-free and server-safe: the API, the dashboard and their tests all
 * read it.
 */

/*
 * How long a level waits for somebody to acknowledge before the next level
 * is paged. The dashboard prefills it; the API leaves the column as sent.
 */
export const DEFAULT_ESCALATE_AFTER_IN_MINUTES: number = 30;

const DEFAULT_NAME_PREFIX: string = "Level";

/*
 * The name a rule gets from its level: "Level 1" for the first rule of a
 * policy, "Level 2" for the second. Levels count from one; anything else is
 * read as the first level.
 */
export const getDefaultEscalationRuleName: (level: number) => string = (
  level: number,
): string => {
  const safeLevel: number =
    Number.isFinite(level) && level >= 1 ? Math.floor(level) : 1;

  return `${DEFAULT_NAME_PREFIX} ${safeLevel}`;
};

const normalizeName: (name: string) => string = (name: string): string => {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
};

/*
 * Whether a name is the one its level gives it: "Level 2" on the second rule
 * (spacing and case aside). Such a name says where the rule is, not what it
 * is, so it follows the rule when the rule moves.
 */
export const isDefaultEscalationRuleName: (
  name: string | undefined | null,
  level: number,
) => boolean = (name: string | undefined | null, level: number): boolean => {
  if (typeof name !== "string" || !name.trim()) {
    return false;
  }

  return (
    normalizeName(name) === normalizeName(getDefaultEscalationRuleName(level))
  );
};

// The name to show for a rule: its own, or its level's when it has none.
export const getEscalationRuleDisplayName: (
  name: string | undefined | null,
  level: number,
) => string = (name: string | undefined | null, level: number): string => {
  if (typeof name === "string" && name.trim()) {
    return name;
  }

  return getDefaultEscalationRuleName(level);
};

// A rule's id and its name, in the order of the levels.
export interface EscalationRuleNameEntry {
  id: string;
  name: string;
}

/*
 * The renames that keep levels named after their place once rules have moved
 * or one has been deleted.
 *
 * `before` is the rules in level order before the change, with their names;
 * `after` is the ids in level order after it. A rule whose name was its old
 * level's ("Level 3" on the third rule) and whose level changed is renamed to
 * its new level's name. A name somebody chose is kept - "Managers", or
 * "Level 1" on the third rule - and so is every rule that did not move.
 */
export const getEscalationRuleRenames: (data: {
  before: Array<EscalationRuleNameEntry>;
  after: Array<string>;
}) => Array<EscalationRuleNameEntry> = (data: {
  before: Array<EscalationRuleNameEntry>;
  after: Array<string>;
}): Array<EscalationRuleNameEntry> => {
  const renames: Array<EscalationRuleNameEntry> = [];

  data.before.forEach((rule: EscalationRuleNameEntry, index: number): void => {
    const oldLevel: number = index + 1;

    if (!isDefaultEscalationRuleName(rule.name, oldLevel)) {
      return;
    }

    const newIndex: number = data.after.indexOf(rule.id);

    // Deleted, or not moved.
    if (newIndex < 0 || newIndex + 1 === oldLevel) {
      return;
    }

    renames.push({
      id: rule.id,
      name: getDefaultEscalationRuleName(newIndex + 1),
    });
  });

  return renames;
};

// The level order after the rule at `index` swaps places with a neighbour.
export const getEscalationRuleOrderAfterSwap: (data: {
  ids: Array<string>;
  index: number;
  neighbourIndex: number;
}) => Array<string> = (data: {
  ids: Array<string>;
  index: number;
  neighbourIndex: number;
}): Array<string> => {
  const ids: Array<string> = [...data.ids];

  if (
    data.index < 0 ||
    data.neighbourIndex < 0 ||
    data.index >= ids.length ||
    data.neighbourIndex >= ids.length
  ) {
    return ids;
  }

  const moving: string = ids[data.index] as string;
  ids[data.index] = ids[data.neighbourIndex] as string;
  ids[data.neighbourIndex] = moving;

  return ids;
};
