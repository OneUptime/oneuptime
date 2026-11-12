import DashboardViewConfig from "../../Types/Dashboard/DashboardViewConfig";
import { JSONValue } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import stableStringify from "../StableStringify";

/*
 * A dashboard's board as Save Changes writes it, in one string: the words
 * the request carries (JSONFunctions.serializeValue, then JSON), with every
 * object's keys sorted and a key left undefined left out.
 *
 * The same board gives the same string however its objects were built - a
 * widget handed back by its settings unchanged, a key spread into a copy in
 * another order, an id as a class or as the JSON it is sent as. Any change
 * Save would write gives another: a widget added, moved, resized, removed
 * or set up differently, a variable, the default time range or
 * auto-refresh, the board's height.
 *
 * No variables at all and an empty list of them are one board: the
 * Variables dialog's Save writes the list, empty for a board that has none,
 * and a board that never had one has no list.
 *
 * The dashboard compares the board with the one editing started from, so a
 * board opened for editing and left as it was holds nothing unsaved.
 */
export const getDashboardViewConfigSignature: (
  config: DashboardViewConfig,
) => string = (config: DashboardViewConfig): string => {
  const asSent: string | undefined = JSON.stringify(
    JSONFunctions.serializeValue(config as unknown as JSONValue),
  );
  const board: unknown = asSent === undefined ? null : JSON.parse(asSent);

  if (
    board &&
    typeof board === "object" &&
    !Array.isArray(board) &&
    Array.isArray((board as { variables?: unknown }).variables) &&
    (board as { variables: Array<unknown> }).variables.length === 0
  ) {
    delete (board as { variables?: unknown }).variables;
  }

  return stableStringify(board);
};

export const isSameDashboardViewConfig: (
  first: DashboardViewConfig,
  second: DashboardViewConfig,
) => boolean = (
  first: DashboardViewConfig,
  second: DashboardViewConfig,
): boolean => {
  return (
    getDashboardViewConfigSignature(first) ===
    getDashboardViewConfigSignature(second)
  );
};
