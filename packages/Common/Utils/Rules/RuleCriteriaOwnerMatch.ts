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
  const picked: Array<string> = (
    Array.isArray(data.filter.value) ? data.filter.value : [data.filter.value]
  )
    .map((value: unknown): string => {
      return String(value ?? "")
        .trim()
        .toLowerCase();
    })
    .filter((value: string): boolean => {
      return value.length > 0;
    });

  if (picked.length === 0) {
    return false;
  }

  const owners: Set<string> = new Set(
    data.ownerIds.map((id: string): string => {
      return id.trim().toLowerCase();
    }),
  );

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

export default matchesRuleCriteriaOwnerFilter;
