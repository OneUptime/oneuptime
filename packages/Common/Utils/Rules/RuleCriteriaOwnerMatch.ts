import {
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../Types/Rules/RuleCriteria";

/*
 * WHETHER A RECORD'S OWNERS MEET AN OWNER CONDITION (#9353).
 *
 * "Alert Owner has any of Platform, Jane" holds when one of the people and
 * teams picked is among the record's owners, "has none of" when none is.
 * The owners are the ids on the record's lists of owner users and owner
 * teams, as they are recorded: a member of an owning team is not an owner
 * by being in it, so picking Jane matches what Jane owns herself, and
 * picking Platform matches what the team owns. A workspace rule's owner
 * condition matches the same way (#7583).
 *
 * Ids are compared as the database writes them, whatever case the rule or
 * the owner rows used. A record with no owners has none of the picks.
 */
export function matchesRuleCriteriaOwnerFilter(data: {
  filter: RuleCriteriaFilter;
  ownerIds: ReadonlyArray<string>;
}): boolean {
  const picked: Array<string> = getPickedOwnerIds(data.filter);

  if (picked.length === 0) {
    return false;
  }

  const owners: Set<string> = toOwnerSet(data.ownerIds);

  const isOwner: (id: string) => boolean = (id: string): boolean => {
    return owners.has(id);
  };

  switch (data.filter.operator) {
    case RuleCriteriaOperator.HasAnyOf:
      return picked.some(isOwner);
    case RuleCriteriaOperator.HasNoneOf:
      return !picked.some(isOwner);
    case RuleCriteriaOperator.HasAllOf:
      return picked.every(isOwner);
    default:
      // No other operator compares owners: such a condition never holds.
      return false;
  }
}

/*
 * THE OWNERS THAT MEET AN OWNER CONDITION (#9407): of the people and teams
 * "has any of" (or "has all of") picks, the ones among the record's owners -
 * in the order the condition picks them, as the condition wrote them. What
 * "When this goes down" names as having made an on-call rule match. "Has
 * none of" holds because no pick is an owner, so it names nobody, and so
 * does a condition the owners do not meet.
 */
export function getOwnersMeetingRuleCriteriaOwnerFilter(data: {
  filter: RuleCriteriaFilter;
  ownerIds: ReadonlyArray<string>;
}): Array<string> {
  if (
    data.filter.operator !== RuleCriteriaOperator.HasAnyOf &&
    data.filter.operator !== RuleCriteriaOperator.HasAllOf
  ) {
    return [];
  }

  if (!matchesRuleCriteriaOwnerFilter(data)) {
    return [];
  }

  const owners: Set<string> = toOwnerSet(data.ownerIds);
  const met: Array<string> = [];

  for (const id of getPickedOwnerIds(data.filter)) {
    if (owners.has(id) && !met.includes(id)) {
      met.push(id);
    }
  }

  return met;
}

// The ids a condition picks, as the database writes them; empty ones left out.
function getPickedOwnerIds(filter: RuleCriteriaFilter): Array<string> {
  return (Array.isArray(filter.value) ? filter.value : [filter.value])
    .map((value: unknown): string => {
      return String(value ?? "")
        .trim()
        .toLowerCase();
    })
    .filter((value: string): boolean => {
      return value.length > 0;
    });
}

function toOwnerSet(ownerIds: ReadonlyArray<string>): Set<string> {
  return new Set(
    ownerIds.map((id: string): string => {
      return id.trim().toLowerCase();
    }),
  );
}

export default matchesRuleCriteriaOwnerFilter;
