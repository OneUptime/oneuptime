import { FilterOperator } from "./FilterChipDropdownTypes";
import OwnedBy, {
  MAX_OWNED_BY_IDS,
  OwnedByMatch,
  OWNED_BY_QUERY_KEY,
} from "Common/Types/BaseDatabase/OwnedBy";
import ObjectID from "Common/Types/ObjectID";

/*
 * WHAT THE OWNER CHIP PUTS IN A LIST'S QUERY.
 *
 * The chip offers people and teams in one list, each picked as a key that
 * says which it is ("user:<id>", "team:<id>"), under four operators. Its
 * query is one filter the server answers in the list's own query
 * (`owners: OwnedBy` - Common/Types/BaseDatabase/OwnedBy):
 *
 *   - is            the records one of the picked people or teams owns;
 *   - is not        the records none of them owns, unowned ones included;
 *   - is empty      the records nobody owns;
 *   - is not empty  the records someone owns.
 *
 * A person stands for themselves and a team for itself: picking a team does
 * not bring in what its members own, nor picking a person what their teams
 * own. The chip used to ask the owner tables for the ids of the records the
 * picks own and send those ids back - up to ten thousand of them, in no
 * order, so a team that owned more lost the rest - and its "is empty" and
 * "is not empty" filtered nothing at all (the one listed nothing, the other
 * everything). React-free, so the App's tests read it.
 */

// What a picked key names: a person or a team.
export type OwnerSelectionKind = "user" | "team";

export const OWNER_KEY_PREFIX: { user: "user:"; team: "team:" } = {
  user: "user:",
  team: "team:",
};

export interface OwnerKey {
  kind: OwnerSelectionKind;
  id: string;
}

// The person or team a picked key names, or null for a key of neither.
export const parseOwnerKey: (key: string) => OwnerKey | null = (
  key: string,
): OwnerKey | null => {
  if (typeof key !== "string") {
    return null;
  }

  if (key.startsWith(OWNER_KEY_PREFIX.user)) {
    return { kind: "user", id: key.slice(OWNER_KEY_PREFIX.user.length) };
  }

  if (key.startsWith(OWNER_KEY_PREFIX.team)) {
    return { kind: "team", id: key.slice(OWNER_KEY_PREFIX.team.length) };
  }

  return null;
};

// The key the chip picks a person by, and a team by.
export const getOwnerKey: (owner: OwnerKey) => string = (
  owner: OwnerKey,
): string => {
  return `${OWNER_KEY_PREFIX[owner.kind]}${owner.id}`;
};

/*
 * The people and the teams the picked keys name. A key that names neither,
 * or an id that is no id - a link edited by hand, a view saved before a
 * person was removed - names nobody, and is left out rather than refused,
 * as are picks past the most one filter names (a link, again).
 */
export const getPickedOwners: (ownerKeys: Array<string>) => {
  userIds: Array<string>;
  teamIds: Array<string>;
} = (
  ownerKeys: Array<string>,
): { userIds: Array<string>; teamIds: Array<string> } => {
  const userIds: Array<string> = [];
  const teamIds: Array<string> = [];

  for (const key of ownerKeys || []) {
    if (userIds.length + teamIds.length >= MAX_OWNED_BY_IDS) {
      break;
    }

    const owner: OwnerKey | null = parseOwnerKey(key);

    if (!owner || !ObjectID.isValidUUID(owner.id)) {
      continue;
    }

    const ids: Array<string> = owner.kind === "user" ? userIds : teamIds;

    if (!ids.includes(owner.id)) {
      ids.push(owner.id);
    }
  }

  return { userIds, teamIds };
};

/*
 * The chip's filter, or null when it filters nothing (no one picked under
 * "is" or "is not").
 */
export const buildOwnerFacetQuery: (data: {
  operator: FilterOperator;
  ownerKeys: Array<string>;
}) => OwnedBy | null = (data: {
  operator: FilterOperator;
  ownerKeys: Array<string>;
}): OwnedBy | null => {
  if (data.operator === "is_empty") {
    return new OwnedBy({ match: OwnedByMatch.NoOwner });
  }

  if (data.operator === "is_not_empty") {
    return new OwnedBy({ match: OwnedByMatch.AnyOwner });
  }

  const picked: { userIds: Array<string>; teamIds: Array<string> } =
    getPickedOwners(data.ownerKeys);

  if (picked.userIds.length === 0 && picked.teamIds.length === 0) {
    return null;
  }

  return new OwnedBy({
    match: data.operator === "is_not" ? OwnedByMatch.NoneOf : OwnedByMatch.AnyOf,
    userIds: picked.userIds,
    teamIds: picked.teamIds,
  });
};

/*
 * `query` with the chip's filter under "owners", or the query as it was
 * when the chip filters nothing. The query is not changed in place.
 */
export const mergeOwnerFacetIntoQuery: <TQuery extends object>(data: {
  query: TQuery;
  operator: FilterOperator;
  ownerKeys: Array<string>;
}) => TQuery = <TQuery extends object>(data: {
  query: TQuery;
  operator: FilterOperator;
  ownerKeys: Array<string>;
}): TQuery => {
  const ownedBy: OwnedBy | null = buildOwnerFacetQuery({
    operator: data.operator,
    ownerKeys: data.ownerKeys,
  });

  if (!ownedBy) {
    return data.query;
  }

  return {
    ...data.query,
    [OWNED_BY_QUERY_KEY]: ownedBy,
  } as TQuery;
};
