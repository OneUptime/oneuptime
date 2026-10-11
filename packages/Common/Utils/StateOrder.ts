import SortOrder from "../Types/BaseDatabase/SortOrder";
import {
  ListOrderChange,
  ListOrderItem,
  getListOrderAppendValue,
  getListOrderCollisionChanges,
  sortListOrderItems,
  toListOrderNumber,
} from "./ListOrder";

/*
 * What the order of a project's states, severities and monitor statuses
 * means, and what it has to keep. No database and no React in it, so the
 * server that guards these lists and the settings pages that show them read
 * the same rules.
 *
 * All six are drag-ordered lists (@ListOrderColumn, Common/Utils/ListOrder):
 * 1 is the top. On top of that:
 *
 *   - Incident, alert and scheduled maintenance states are a path. An
 *     incident, an alert, an episode or a maintenance event only ever moves
 *     down its list (every state timeline refuses a move back up, by the one
 *     rule in Common/Utils/StateMove), and the built-in states mark the
 *     points that mean something: a state at or below the acknowledged one
 *     counts as acknowledged (on-call stops escalating), at or below the
 *     resolved one as resolved. So the built-in states have to stay in their
 *     order - Resolved above Acknowledged would page nobody and resolve
 *     nothing - and a new state goes just above the state that closes the
 *     list, never after it, where it would quietly count as resolved.
 *   - Monitor statuses run from the healthiest to the worst: where monitors
 *     are shown together (a status page, a monitor group) the lowest one in
 *     the list wins. A new status goes just above the offline one, so that
 *     an outage still shows as an outage.
 *   - Severities are ranked, most severe first. Any order goes, and a new
 *     one goes to the end.
 *   - Every built-in row (the created, acknowledged and resolved states, the
 *     operational and offline statuses...) is something OneUptime itself
 *     moves things into, so a list keeps at least one of each kind.
 */

export enum StateListType {
  IncidentState = "IncidentState",
  AlertState = "AlertState",
  ScheduledMaintenanceState = "ScheduledMaintenanceState",
  MonitorStatus = "MonitorStatus",
  IncidentSeverity = "IncidentSeverity",
  AlertSeverity = "AlertSeverity",
}

export interface StateListBuiltIn {
  // The boolean column that marks a row as this built-in.
  flag: string;
  // What the row is to OneUptime, for messages: "resolved state".
  role: string;
}

export interface StateListDefinition {
  type: StateListType;
  // The number column that holds each row's place: 1 is the top.
  orderColumn: string;
  // What moves through the list, for messages.
  subject: {
    singular: string;
    plural: string;
  };
  /*
   * The built-in rows, by the flag that marks them - in the order the list
   * has to keep them in when keepsBuiltInOrder is set.
   */
  builtIns: Array<StateListBuiltIn>;
  /*
   * Whether the built-in rows have to stay in the order builtIns lists them
   * in: the lists an incident, alert or maintenance event walks down.
   */
  keepsBuiltInOrder: boolean;
  /*
   * Where a row that is created without a place goes: just above the first
   * row carrying this flag. Unset, it goes to the end of the list.
   */
  insertAboveFlag?: string | undefined;
}

const INCIDENT_AND_ALERT_STATE_BUILT_INS: Array<StateListBuiltIn> = [
  { flag: "isCreatedState", role: "created state" },
  { flag: "isAcknowledgedState", role: "acknowledged state" },
  { flag: "isResolvedState", role: "resolved state" },
];

export const STATE_LISTS: Record<StateListType, StateListDefinition> = {
  [StateListType.IncidentState]: {
    type: StateListType.IncidentState,
    orderColumn: "order",
    subject: { singular: "incident", plural: "incidents" },
    builtIns: INCIDENT_AND_ALERT_STATE_BUILT_INS,
    keepsBuiltInOrder: true,
    insertAboveFlag: "isResolvedState",
  },
  [StateListType.AlertState]: {
    type: StateListType.AlertState,
    orderColumn: "order",
    subject: { singular: "alert", plural: "alerts" },
    builtIns: INCIDENT_AND_ALERT_STATE_BUILT_INS,
    keepsBuiltInOrder: true,
    insertAboveFlag: "isResolvedState",
  },
  [StateListType.ScheduledMaintenanceState]: {
    type: StateListType.ScheduledMaintenanceState,
    orderColumn: "order",
    subject: {
      singular: "scheduled maintenance event",
      plural: "scheduled maintenance events",
    },
    builtIns: [
      { flag: "isScheduledState", role: "scheduled state" },
      { flag: "isOngoingState", role: "ongoing state" },
      { flag: "isEndedState", role: "ended state" },
      { flag: "isResolvedState", role: "completed state" },
    ],
    keepsBuiltInOrder: true,
    insertAboveFlag: "isResolvedState",
  },
  [StateListType.MonitorStatus]: {
    type: StateListType.MonitorStatus,
    orderColumn: "priority",
    subject: { singular: "monitor", plural: "monitors" },
    builtIns: [
      { flag: "isOperationalState", role: "operational status" },
      { flag: "isOfflineState", role: "offline status" },
    ],
    keepsBuiltInOrder: false,
    insertAboveFlag: "isOfflineState",
  },
  [StateListType.IncidentSeverity]: {
    type: StateListType.IncidentSeverity,
    orderColumn: "order",
    subject: { singular: "incident", plural: "incidents" },
    builtIns: [],
    keepsBuiltInOrder: false,
  },
  [StateListType.AlertSeverity]: {
    type: StateListType.AlertSeverity,
    orderColumn: "order",
    subject: { singular: "alert", plural: "alerts" },
    builtIns: [],
    keepsBuiltInOrder: false,
  },
};

// One row of such a list, as the rules read it.
export interface StateListRow {
  id: string;
  name: string;
  // The row's place: 1 is the top. Null when it has none.
  order: number | null;
  createdAt?: Date | string | null | undefined;
  // The built-in flags set on the row, in the definition's order.
  flags: Array<string>;
}

const toIdString: (value: unknown) => string = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    const record: Record<string, unknown> = value as Record<string, unknown>;

    // An ObjectID, or a relation object carrying its own id.
    if (typeof record["id"] === "string") {
      return record["id"] as string;
    }

    if (record["_id"] !== undefined) {
      return toIdString(record["_id"]);
    }
  }

  return String(value);
};

/**
 * A model row (or the JSON of one) as the rules read it: its id, name,
 * place and the built-in flags it carries.
 */
export const toStateListRow: (
  definition: StateListDefinition,
  record: unknown,
) => StateListRow = (
  definition: StateListDefinition,
  record: unknown,
): StateListRow => {
  const values: Record<string, unknown> =
    record && typeof record === "object"
      ? (record as Record<string, unknown>)
      : {};

  const createdAt: unknown = values["createdAt"];

  return {
    id: toIdString(values["_id"] ?? values["id"]),
    name: typeof values["name"] === "string" ? (values["name"] as string) : "",
    order: toListOrderNumber(values[definition.orderColumn]),
    createdAt:
      createdAt instanceof Date || typeof createdAt === "string"
        ? createdAt
        : null,
    flags: definition.builtIns
      .filter((builtIn: StateListBuiltIn) => {
        return values[builtIn.flag] === true;
      })
      .map((builtIn: StateListBuiltIn) => {
        return builtIn.flag;
      }),
  };
};

const toListOrderItem: (row: StateListRow) => ListOrderItem = (
  row: StateListRow,
): ListOrderItem => {
  return {
    id: row.id,
    value: row.order,
    createdAt: row.createdAt,
  };
};

/** The rows, top of the list first - the order the server keeps them in. */
export const sortStateListRows: (
  rows: Array<StateListRow>,
) => Array<StateListRow> = (rows: Array<StateListRow>): Array<StateListRow> => {
  const byId: Map<string, StateListRow> = new Map();

  for (const row of rows) {
    byId.set(row.id, row);
  }

  return sortListOrderItems(rows.map(toListOrderItem), SortOrder.Ascending).map(
    (item: ListOrderItem) => {
      return byId.get(item.id)!;
    },
  );
};

/** The built-in a row is, if any: the first of its flags. */
export const getStateListBuiltIn: (
  definition: StateListDefinition,
  row: StateListRow,
) => StateListBuiltIn | null = (
  definition: StateListDefinition,
  row: StateListRow,
): StateListBuiltIn | null => {
  return (
    definition.builtIns.find((builtIn: StateListBuiltIn) => {
      return row.flags.includes(builtIn.flag);
    }) || null
  );
};

/**
 * The row that stands for each built-in, by flag: the first one from the top
 * that carries it - the same row the services look up ("the" resolved state
 * of a project is the first one in its order).
 */
export const getStateListBuiltInRows: (
  definition: StateListDefinition,
  rows: Array<StateListRow>,
) => Record<string, StateListRow> = (
  definition: StateListDefinition,
  rows: Array<StateListRow>,
): Record<string, StateListRow> => {
  const builtInRows: Record<string, StateListRow> = {};

  for (const row of sortStateListRows(rows)) {
    for (const builtIn of definition.builtIns) {
      if (row.flags.includes(builtIn.flag) && !builtInRows[builtIn.flag]) {
        builtInRows[builtIn.flag] = row;
      }
    }
  }

  return builtInRows;
};

/**
 * How far down the path a row sits: the flag of the last built-in row it is
 * at or below, by the comparison the server makes - an incident counts as
 * acknowledged when its state's number is at least the acknowledged state's,
 * and as resolved when it is at least the resolved state's. Null when the row
 * sits above every built-in row, or has no place.
 */
export const getStateListReachedBuiltIn: (
  definition: StateListDefinition,
  rows: Array<StateListRow>,
  row: StateListRow,
) => string | null = (
  definition: StateListDefinition,
  rows: Array<StateListRow>,
  row: StateListRow,
): string | null => {
  if (row.order === null) {
    return null;
  }

  const builtInRows: Record<string, StateListRow> = getStateListBuiltInRows(
    definition,
    rows,
  );

  for (
    let index: number = definition.builtIns.length - 1;
    index >= 0;
    index--
  ) {
    const builtIn: StateListBuiltIn = definition.builtIns[index]!;
    const builtInRow: StateListRow | undefined = builtInRows[builtIn.flag];

    if (
      builtInRow &&
      builtInRow.order !== null &&
      row.order >= builtInRow.order
    ) {
      return builtIn.flag;
    }
  }

  return null;
};

/**
 * Whether `row` sits below `other` in the list - after it, on the path a
 * record walks down - by the comparison the server makes of their places.
 * Null when either has no place to compare: nothing about their order is
 * known. Two rows at the same place are not after each other.
 */
export const isStateListRowAfter: (
  row: StateListRow,
  other: StateListRow,
) => boolean | null = (
  row: StateListRow,
  other: StateListRow,
): boolean | null => {
  if (row.order === null || other.order === null) {
    return null;
  }

  return row.order > other.order;
};

export interface StateListOrderViolation {
  // The built-in row that has to come first, and what it is.
  earlier: StateListRow;
  earlierBuiltIn: StateListBuiltIn;
  // The built-in row that sits at or above it, and what it is.
  later: StateListRow;
  laterBuiltIn: StateListBuiltIn;
}

/**
 * Two built-in rows of a path out of order - the resolved state above the
 * acknowledged one, say - or null when the list keeps its built-in order (or
 * has none to keep).
 */
export const getStateListOrderViolation: (
  definition: StateListDefinition,
  rows: Array<StateListRow>,
) => StateListOrderViolation | null = (
  definition: StateListDefinition,
  rows: Array<StateListRow>,
): StateListOrderViolation | null => {
  if (!definition.keepsBuiltInOrder) {
    return null;
  }

  const builtInRows: Record<string, StateListRow> = getStateListBuiltInRows(
    definition,
    rows,
  );

  for (let i: number = 0; i < definition.builtIns.length; i++) {
    const earlierBuiltIn: StateListBuiltIn = definition.builtIns[i]!;
    const earlier: StateListRow | undefined = builtInRows[earlierBuiltIn.flag];

    if (!earlier || earlier.order === null) {
      continue;
    }

    for (let j: number = i + 1; j < definition.builtIns.length; j++) {
      const laterBuiltIn: StateListBuiltIn = definition.builtIns[j]!;
      const later: StateListRow | undefined = builtInRows[laterBuiltIn.flag];

      if (!later || later.order === null) {
        continue;
      }

      /*
       * One row carrying both flags is the same point on the path twice -
       * nothing a move could put out of order.
       */
      if (later.id === earlier.id) {
        continue;
      }

      if (later.order <= earlier.order) {
        return { earlier, earlierBuiltIn, later, laterBuiltIn };
      }
    }
  }

  return null;
};

/**
 * Whether going from `rowsBefore` to `rowsAfter` breaks the built-in order:
 * the violation the change introduces, or null. A list that was already out
 * of order (saved before this rule existed) is not held to it, so that it can
 * still be put right one move at a time.
 */
export const getStateListOrderViolationIntroduced: (data: {
  definition: StateListDefinition;
  rowsBefore: Array<StateListRow>;
  rowsAfter: Array<StateListRow>;
}) => StateListOrderViolation | null = (data: {
  definition: StateListDefinition;
  rowsBefore: Array<StateListRow>;
  rowsAfter: Array<StateListRow>;
}): StateListOrderViolation | null => {
  if (getStateListOrderViolation(data.definition, data.rowsBefore)) {
    return null;
  }

  return getStateListOrderViolation(data.definition, data.rowsAfter);
};

const applyChanges: (
  rows: Array<StateListRow>,
  changes: Array<ListOrderChange>,
) => Array<StateListRow> = (
  rows: Array<StateListRow>,
  changes: Array<ListOrderChange>,
): Array<StateListRow> => {
  const valueById: Map<string, number> = new Map();

  for (const change of changes) {
    valueById.set(change.id, change.value);
  }

  return rows.map((row: StateListRow) => {
    return valueById.has(row.id)
      ? { ...row, order: valueById.get(row.id)! }
      : row;
  });
};

/**
 * The list as it will be once row `id` is given `requestedValue`, moved the
 * way the server moves it (Common/Utils/ListOrder): the rows in the way step
 * aside, and a cleared number sends the row to the end.
 */
export const getStateListRowsAfterMove: (data: {
  rows: Array<StateListRow>;
  id: string;
  requestedValue: unknown;
}) => Array<StateListRow> = (data: {
  rows: Array<StateListRow>;
  id: string;
  requestedValue: unknown;
}): Array<StateListRow> => {
  const row: StateListRow | undefined = data.rows.find(
    (candidate: StateListRow) => {
      return candidate.id === data.id;
    },
  );

  if (!row) {
    return data.rows;
  }

  const requested: number | null = toListOrderNumber(data.requestedValue);

  if (requested === null) {
    const appendValue: number = getListOrderAppendValue({
      siblings: data.rows
        .filter((candidate: StateListRow) => {
          return candidate.id !== data.id;
        })
        .map(toListOrderItem),
      sortOrder: SortOrder.Ascending,
    });

    return applyChanges(data.rows, [{ id: data.id, value: appendValue }]);
  }

  const changes: Array<ListOrderChange> = getListOrderCollisionChanges({
    siblings: data.rows.map(toListOrderItem),
    itemId: data.id,
    previousValue: row.order,
    requestedValue: requested,
    sortOrder: SortOrder.Ascending,
  });

  return applyChanges(data.rows, [
    ...changes,
    { id: data.id, value: requested },
  ]);
};

/**
 * The list as it will be once `newRow` is created in it: at the number it
 * carries (the rows in the way stepping aside), or at the end without one.
 */
export const getStateListRowsAfterCreate: (data: {
  rows: Array<StateListRow>;
  newRow: StateListRow;
}) => Array<StateListRow> = (data: {
  rows: Array<StateListRow>;
  newRow: StateListRow;
}): Array<StateListRow> => {
  if (data.newRow.order === null) {
    return [
      ...data.rows,
      {
        ...data.newRow,
        order: getListOrderAppendValue({
          siblings: data.rows.map(toListOrderItem),
          sortOrder: SortOrder.Ascending,
        }),
      },
    ];
  }

  const changes: Array<ListOrderChange> = getListOrderCollisionChanges({
    siblings: data.rows.map(toListOrderItem),
    itemId: data.newRow.id,
    previousValue: null,
    requestedValue: data.newRow.order,
    sortOrder: SortOrder.Ascending,
  });

  return [...applyChanges(data.rows, changes), data.newRow];
};

/**
 * The number a row created without a place is given: the number of the
 * first row carrying the definition's insertAboveFlag, so the new row takes
 * its place and it steps down one. Null means the end of the list - the
 * definition has no such flag, or no row carries it.
 */
export const getStateListInsertValue: (
  definition: StateListDefinition,
  rows: Array<StateListRow>,
) => number | null = (
  definition: StateListDefinition,
  rows: Array<StateListRow>,
): number | null => {
  if (!definition.insertAboveFlag) {
    return null;
  }

  const anchor: StateListRow | undefined = getStateListBuiltInRows(
    definition,
    rows,
  )[definition.insertAboveFlag];

  return anchor ? anchor.order : null;
};

export interface StateListDeleteRefusal {
  row: StateListRow;
  builtIn: StateListBuiltIn;
}

/**
 * Deleting `idsToDelete` would leave the list without any row of a built-in
 * kind - its only resolved state, its only operational status: the first such
 * row and what it is, or null when the delete leaves every kind covered.
 */
export const getStateListDeleteRefusal: (data: {
  definition: StateListDefinition;
  rows: Array<StateListRow>;
  idsToDelete: Array<string>;
}) => StateListDeleteRefusal | null = (data: {
  definition: StateListDefinition;
  rows: Array<StateListRow>;
  idsToDelete: Array<string>;
}): StateListDeleteRefusal | null => {
  const deleting: Set<string> = new Set(data.idsToDelete);

  for (const row of sortStateListRows(data.rows)) {
    if (!deleting.has(row.id)) {
      continue;
    }

    for (const builtIn of data.definition.builtIns) {
      if (!row.flags.includes(builtIn.flag)) {
        continue;
      }

      const anotherRemains: boolean = data.rows.some(
        (candidate: StateListRow) => {
          return (
            !deleting.has(candidate.id) &&
            candidate.flags.includes(builtIn.flag)
          );
        },
      );

      if (!anotherRemains) {
        return { row, builtIn };
      }
    }
  }

  return null;
};

const capitalize: (text: string) => string = (text: string): string => {
  return text.length > 0 ? text[0]!.toUpperCase() + text.slice(1) : text;
};

const quoted: (row: StateListRow) => string = (row: StateListRow): string => {
  return row.name ? `"${row.name}"` : "it";
};

/** Why a change that breaks the built-in order is refused. */
export const getStateListOrderViolationMessage: (
  definition: StateListDefinition,
  violation: StateListOrderViolation,
) => string = (
  definition: StateListDefinition,
  violation: StateListOrderViolation,
): string => {
  return `${capitalize(definition.subject.plural)} only ever move down this list, so the ${violation.laterBuiltIn.role} (${quoted(violation.later)}) has to stay below the ${violation.earlierBuiltIn.role} (${quoted(violation.earlier)}).`;
};

/** Why deleting the last row of a built-in kind is refused. */
export const getStateListDeleteRefusalMessage: (
  definition: StateListDefinition,
  refusal: StateListDeleteRefusal,
) => string = (
  definition: StateListDefinition,
  refusal: StateListDeleteRefusal,
): string => {
  const name: string = refusal.row.name
    ? `"${refusal.row.name}"`
    : `This ${refusal.builtIn.role.split(" ").pop()}`;

  return `${name} is the ${refusal.builtIn.role} of this project, and ${definition.subject.plural} need one. It can be renamed, but not deleted.`;
};
