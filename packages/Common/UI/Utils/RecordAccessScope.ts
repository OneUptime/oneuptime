import React from "react";

/*
 * WHAT THE SERVER SAYS THE READER MAY DO ON THE RECORD A PAGE IS OPEN ON
 * (#10272, Types/RecordAccess/RecordAccess).
 *
 * The reader's own permissions say what they may do somewhere in the
 * project; the server's rule also weighs the record: the labels a grant is
 * limited to, a grant limited to owned records, a team's block on some
 * labels, a private record's owners. A record's view layout asks the server
 * once, as its page opens, what the reader may do on the record and its
 * parts (RecordAccessScopeProvider), and hands every gate on its pages the
 * answer for the model it asks about (getRecordAccessGateOptions, through
 * usePrivateRecordGateOptions and usePrivateRecordGate): a change the server
 * would refuse here is locked, with why, after the lock's first sentence
 * (PermissionGate.check). No button asks on its own.
 */

// The operations a record's answer locks: its writes.
export type RecordGateOperation = "create" | "update" | "delete";

// What the answer says of one model's rows on this record, for its gates.
export interface RecordGateAccess {
  /*
   * Nothing is offered or locked yet: the answer is being read, for a
   * reader whose permissions reach some records and not others - so no
   * gate offers what the answer may be about to lock. A reader whose
   * permissions reach every record waits for nothing.
   */
  isHeldBack: boolean;
  /*
   * Why each operation is refused on this record, in the reader's language,
   * said after the lock's first sentence ("You do not have permission to
   * change this incident's roles."). An operation left out is not refused
   * here: the reader's own permissions decide it, as everywhere.
   */
  refusals: Partial<Record<RecordGateOperation, string>>;
}

export interface RecordAccessScope {
  /*
   * By table ("IncidentMember"): the record's own and each part's. A table
   * left out is not answered for here.
   */
  tables: Record<string, RecordGateAccess>;
  /*
   * While the answer is read for a reader it may narrow: every table of the
   * record held back, whatever it holds yet.
   */
  isHeldBack: boolean;
  // The record's own table, answered for while it is read: "Incident".
  tableNames: ReadonlyArray<string>;
}

export const RecordAccessScopeContext: React.Context<RecordAccessScope | null> =
  React.createContext<RecordAccessScope | null>(null);

// What a gate reads of a model: its table.
export interface RecordGateModel {
  tableName?: string | null | undefined;
}

const NOTHING_REFUSED: RecordGateAccess = {
  isHeldBack: false,
  refusals: {},
};

/*
 * The answer for `model` on the page open on `scope`'s record: its table's,
 * held back while the answer is read for a reader it may narrow. None for a
 * model the answer is not about, or a page open on no record.
 */
export function getRecordAccessGateOptions(
  scope: RecordAccessScope | null,
  model: RecordGateModel | null | undefined,
): RecordGateAccess | undefined {
  const tableName: string | null | undefined = model?.tableName;

  if (!scope || !tableName || !scope.tableNames.includes(tableName)) {
    return undefined;
  }

  const access: RecordGateAccess = scope.tables[tableName] || NOTHING_REFUSED;

  if (scope.isHeldBack) {
    return { ...access, isHeldBack: true };
  }

  return access;
}

// The page's scope, for the hooks that hand it to each gate.
export function useRecordAccessScope(): RecordAccessScope | null {
  return React.useContext(RecordAccessScopeContext);
}
