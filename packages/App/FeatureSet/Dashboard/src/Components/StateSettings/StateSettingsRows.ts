import { StateSettingsPageCopy } from "./StateSettingsCopy";
import {
  StateListBuiltIn,
  StateListDefinition,
  StateListRow,
  getStateListBuiltIn,
  getStateListReachedBuiltIn,
  toStateListRow,
} from "Common/Utils/StateOrder";

/*
 * What a row of one of the six state, severity and monitor status settings
 * pages says about itself, worked out from the rows on the page with the
 * same rules the server keeps (Common/Utils/StateOrder). No React here, so
 * the pages and their tests read the same answers.
 */

/**
 * What an incident (alert, maintenance event) in this state counts as -
 * "Acknowledged" for a state at or below the acknowledged one - or null on a
 * page that has no such column, or for a row that has no place yet.
 */
export const getStateSettingsCountsAs: (data: {
  definition: StateListDefinition;
  copy: StateSettingsPageCopy;
  rows: Array<unknown>;
  item: unknown;
}) => string | null = (data: {
  definition: StateListDefinition;
  copy: StateSettingsPageCopy;
  rows: Array<unknown>;
  item: unknown;
}): string | null => {
  if (!data.copy.countsAs) {
    return null;
  }

  const row: StateListRow = toStateListRow(data.definition, data.item);

  if (row.order === null) {
    return null;
  }

  const rows: Array<StateListRow> = data.rows.map((candidate: unknown) => {
    return toStateListRow(data.definition, candidate);
  });

  /*
   * The row as it is now wins over the copy the page last fetched, so a
   * renamed or re-flagged row never reads off stale data.
   */
  const listRows: Array<StateListRow> = rows.some((candidate: StateListRow) => {
    return candidate.id === row.id;
  })
    ? rows.map((candidate: StateListRow) => {
        return candidate.id === row.id ? row : candidate;
      })
    : [...rows, row];

  const reached: string | null = getStateListReachedBuiltIn(
    data.definition,
    listRows,
    row,
  );

  if (!reached) {
    return data.copy.countsAs.aboveAll;
  }

  return data.copy.countsAs.byBuiltIn[reached] || data.copy.countsAs.aboveAll;
};

/**
 * What OneUptime does with this row, for the Built-in tag beside its name -
 * or undefined for a row the project added itself.
 */
export const getStateSettingsBuiltInTooltip: (data: {
  definition: StateListDefinition;
  copy: StateSettingsPageCopy;
  item: unknown;
}) => string | undefined = (data: {
  definition: StateListDefinition;
  copy: StateSettingsPageCopy;
  item: unknown;
}): string | undefined => {
  const builtIn: StateListBuiltIn | null = getStateListBuiltIn(
    data.definition,
    toStateListRow(data.definition, data.item),
  );

  if (!builtIn) {
    return undefined;
  }

  return data.copy.builtInTooltips[builtIn.flag];
};

/**
 * Why this row cannot be deleted - every built-in row can be renamed but
 * never deleted - or undefined for a row that can be.
 */
export const getStateSettingsDeleteLockedReason: (data: {
  definition: StateListDefinition;
  copy: StateSettingsPageCopy;
  item: unknown;
}) => string | undefined = (data: {
  definition: StateListDefinition;
  copy: StateSettingsPageCopy;
  item: unknown;
}): string | undefined => {
  const builtIn: StateListBuiltIn | null = getStateListBuiltIn(
    data.definition,
    toStateListRow(data.definition, data.item),
  );

  return builtIn ? data.copy.deleteLockedReason : undefined;
};
