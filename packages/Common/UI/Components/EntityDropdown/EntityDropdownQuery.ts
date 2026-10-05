import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesAnyOfGroups from "../../../Types/BaseDatabase/IncludesAnyOfGroups";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import Search from "../../../Types/BaseDatabase/Search";

/*
 * The queries an entity dropdown sends for its options: the caller's own
 * query (EntityDropdown's `query` prop, a form field's dropdownModal.query)
 * narrowed by what the reader asked for. A condition of the caller's is
 * never replaced - the reader's search and label pick are added to it.
 *
 * A query holds one condition per column, so the obvious way to add the
 * reader's search, `query[labelField] = new Search(text)`, replaced any
 * condition the caller had put on that same column: a dropdown meant to
 * offer only some rows offered every row that matched the search as soon as
 * the reader typed.
 */

// The key the search is sent under when the caller's query has labelField.
export const ENTITY_DROPDOWN_SEARCH_KEY: string = "_entityDropdownSearch";

/*
 * The caller's query, narrowed to the rows whose labelField contains the
 * search text. When the caller's query has a condition on labelField
 * itself, the search is sent as a MultiSearch over that one column under a
 * key of its own: the server ANDs it with the rest of the query
 * (QueryUtil.serializeQuery), with the same case-insensitive "contains"
 * match a Search makes.
 */
export const withSearch: (
  query: Record<string, unknown>,
  labelField: string,
  searchText: string,
) => Record<string, unknown> = (
  query: Record<string, unknown>,
  labelField: string,
  searchText: string,
): Record<string, unknown> => {
  const trimmed: string = searchText.trim();

  if (trimmed.length === 0) {
    return { ...query };
  }

  if (query[labelField] === undefined) {
    return { ...query, [labelField]: new Search(trimmed) };
  }

  let key: string = ENTITY_DROPDOWN_SEARCH_KEY;

  while (query[key] !== undefined) {
    key = `_${key}`;
  }

  return {
    ...query,
    [key]: new MultiSearch({ fields: [labelField], value: trimmed }),
  };
};

/*
 * Whether rows can be picked by label within the caller's query: always,
 * unless the caller's query has a condition on labels that a label pick
 * cannot be added to.
 */
export const canPickByLabel: (query: Record<string, unknown>) => boolean = (
  query: Record<string, unknown>,
): boolean => {
  const existing: unknown = query["labels"];

  return (
    existing === undefined ||
    existing === null ||
    existing instanceof Includes ||
    existing instanceof IncludesAnyOfGroups
  );
};

/*
 * The caller's query, narrowed to the rows that have at least one of these
 * labels. A caller's own condition on labels is kept: one more group of
 * IncludesAnyOfGroups, which matches rows with a label from every group.
 * Null when the caller's query has a condition on labels that cannot take
 * one more (see canPickByLabel).
 */
export const withLabels: (
  query: Record<string, unknown>,
  labelIds: Array<string>,
) => Record<string, unknown> | null = (
  query: Record<string, unknown>,
  labelIds: Array<string>,
): Record<string, unknown> | null => {
  const existing: unknown = query["labels"];

  if (existing === undefined || existing === null) {
    return { ...query, labels: new Includes(labelIds) };
  }

  if (existing instanceof Includes) {
    return {
      ...query,
      labels: new IncludesAnyOfGroups([
        existing.values.map((value: unknown) => {
          return String(value);
        }),
        labelIds,
      ]),
    };
  }

  if (existing instanceof IncludesAnyOfGroups) {
    return {
      ...query,
      labels: new IncludesAnyOfGroups([...existing.groups, labelIds]),
    };
  }

  return null;
};
