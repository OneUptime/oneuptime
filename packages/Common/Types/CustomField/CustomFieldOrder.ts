/*
 * The order a record's custom fields are shown in, wherever they are shown:
 * the Custom Fields card, the Details step of declaring an incident, the
 * incident custom fields that go out in status page subscriber messages, and
 * the ones a chat message shows.
 *
 * Pure, with no database or React imports, so the dashboard and the server
 * put fields in the same order.
 */

export type SortCustomFieldDefinitionsFunction = <
  T extends { sortOrder?: number | null | undefined; _id?: unknown },
>(
  definitions: Array<T>,
) => Array<T>;

// A definition's id as text, lower-cased as Postgres renders a uuid; "" for none.
const idOf: (definition: { _id?: unknown }) => string = (definition: {
  _id?: unknown;
}): string => {
  const id: unknown = definition._id;

  if (id === null || id === undefined) {
    return "";
  }

  const text: string = String(id);

  return text === "[object Object]" ? "" : text.trim().toLowerCase();
};

/**
 * Fields with an order first, lowest first; fields without one after them.
 * Fields that share an order come in the order of their ids - the order the
 * settings page lists them in (a write of a field's order moves no other
 * field, so two may share one: issue #9609) - whatever order they were read
 * in; fields with no id come after them, in the order they came in. Returns
 * a new list.
 */
export const sortCustomFieldDefinitions: SortCustomFieldDefinitionsFunction = <
  T extends { sortOrder?: number | null | undefined; _id?: unknown },
>(
  definitions: Array<T>,
): Array<T> => {
  const orderOf: (definition: T) => number = (definition: T): number => {
    return typeof definition.sortOrder === "number" &&
      Number.isFinite(definition.sortOrder)
      ? definition.sortOrder
      : Number.POSITIVE_INFINITY;
  };

  return definitions
    .map((definition: T, index: number) => {
      return { definition, index };
    })
    .sort(
      (
        a: { definition: T; index: number },
        b: { definition: T; index: number },
      ) => {
        const difference: number =
          orderOf(a.definition) - orderOf(b.definition);

        if (difference !== 0 && !Number.isNaN(difference)) {
          return difference;
        }

        // Twins with an id by id, then the ones without in the order they came.
        const aId: string = idOf(a.definition);
        const bId: string = idOf(b.definition);

        if (Boolean(aId) !== Boolean(bId)) {
          return aId ? -1 : 1;
        }

        if (aId !== bId) {
          return aId < bId ? -1 : 1;
        }

        return a.index - b.index;
      },
    )
    .map((entry: { definition: T; index: number }) => {
      return entry.definition;
    });
};
