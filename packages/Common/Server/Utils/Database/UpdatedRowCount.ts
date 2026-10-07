/*
 * How many rows a raw UPDATE wrote, as the Postgres driver answers a
 * `manager.query` of one: [rows, affected count]. Any other answer wrote
 * nothing this can count, so it counts as none - a caller that acts on rows
 * written never acts on a guess.
 */
const getUpdatedRowCount: (result: unknown) => number = (
  result: unknown,
): number => {
  return Array.isArray(result) && typeof result[1] === "number" ? result[1] : 0;
};

export default getUpdatedRowCount;
