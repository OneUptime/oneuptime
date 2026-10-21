/*
 * The order a record's custom fields are shown in, wherever they are shown:
 * the Custom Fields card, the Details step of declaring an incident, and the
 * incident custom fields that go out in status page subscriber messages.
 *
 * Pure, with no database or React imports, so the dashboard and the server
 * put fields in the same order.
 */

export type SortCustomFieldDefinitionsFunction = <
  T extends { sortOrder?: number | null | undefined },
>(
  definitions: Array<T>,
) => Array<T>;

/**
 * Fields with an order first, lowest first; fields without one after them.
 * Stable, so fields with the same order (or none) keep the order they came
 * in. Returns a new list.
 */
export const sortCustomFieldDefinitions: SortCustomFieldDefinitionsFunction = <
  T extends { sortOrder?: number | null | undefined },
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

        return a.index - b.index;
      },
    )
    .map((entry: { definition: T; index: number }) => {
      return entry.definition;
    });
};
