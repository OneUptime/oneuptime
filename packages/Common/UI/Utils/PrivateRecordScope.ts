import { HeldPermissions } from "../../Types/HeldPermissions";
import LabelAccess from "../../Types/LabelAccess/LabelAccess";
import RecordParts, {
  RecordOfPart,
  RecordPartModel,
} from "../../Types/LabelAccess/RecordParts";
import ObjectID from "../../Types/ObjectID";
import PrivateRecordParts, {
  PrivateRecordPartModel,
} from "../../Types/PrivateRecord/PrivateRecordParts";
import { PermissionGateOptions } from "./PermissionGate";
import {
  getRecordAccessGateOptions,
  isAnsweredAsPart,
  RecordAccessScope,
  useRecordAccessScope,
} from "./RecordAccessScope";
import React from "react";

/*
 * THE PRIVATE RECORD A PAGE IS OPEN ON, AND WHAT ITS READER HOLDS ON IT.
 *
 * A private incident, alert or episode is changed only with the permissions
 * of the teams that own it and of the people named as its owners: a member
 * of a team that owns it and may only view incidents, who may change every
 * incident through another team, views this one and changes nothing of it
 * (Types/PrivateRecord/PrivateRecordHeld, the server's PrivateRecordPermission).
 * The page of such a record says so where it offers a change: the record's
 * view layout reads who owns it and provides this scope, and every gate on
 * the page that asks about the record or a part of it - Edit, Acknowledge,
 * Resolve, a note, an owner, a role - asks with what the reader holds on the
 * record (usePrivateRecordGateOptions), locked with the record's reason
 * where their own snapshot would allow it (PermissionGate.check). A gate
 * about anything else on the page - a monitor, an on-call policy - is asked
 * as before.
 *
 * The same hooks hand each gate what the server says the reader may do on
 * the record the page is open on, private or not (RecordAccessScope,
 * #10272): its labels, its owners and its privacy weighed by the server's
 * own rule, so a gate locks what the server would refuse there, with why.
 */
export interface PrivateRecordScope {
  // The private record's kind, by its table: "Incident".
  tableName: string;
  // What the reader holds on it (PrivateRecordHeld.getHeldOnRecord).
  held: HeldPermissions;
  /*
   * Why a change the reader's own permissions allow is locked here, in their
   * language, after the gate's first sentence: "It is private, and ..."
   */
  reason: string;
}

export const PrivateRecordScopeContext: React.Context<PrivateRecordScope | null> =
  React.createContext<PrivateRecordScope | null>(null);

/*
 * The gate options a check of `model` takes on a page open on `scope`'s
 * record: what the reader holds on the record, and its reason, for the
 * record's own model and its parts; none for any other model, or a page
 * open on no private record.
 *
 * And, on a page open on a record whose answer the server gave
 * (RecordAccessScope, #10272), for the record's own model and its parts,
 * that answer: what the reader may do on that record by its labels, its
 * owners and its privacy. A gate reads it for the model it asks about, so
 * the options a page built for its record serve its parts' gates too.
 */
export function getPrivateRecordGateOptions(
  scope: PrivateRecordScope | null,
  model: PrivateRecordPartModel | null | undefined,
  recordAccessScope?: RecordAccessScope | null | undefined,
): PermissionGateOptions | undefined {
  const isAnswered: boolean = Boolean(
    getRecordAccessGateOptions(recordAccessScope || null, model),
  );

  const isPart: boolean = Boolean(
    scope && model && PrivateRecordParts.isPartOf(model, scope.tableName),
  );

  if (!isPart && !isAnswered) {
    return undefined;
  }

  return {
    ...(isPart && scope
      ? { held: scope.held, privateRecordReason: scope.reason }
      : {}),
    ...(isAnswered && recordAccessScope
      ? { recordAccess: recordAccessScope }
      : {}),
  };
}

/*
 * getPrivateRecordGateOptions, for the page the calling component is on -
 * the same object while the page's scopes stay the same, so a component
 * that keeps what it worked out (useMemo) keeps it.
 */
export function usePrivateRecordGateOptions(
  model: PrivateRecordPartModel | null | undefined,
): PermissionGateOptions | undefined {
  const scope: PrivateRecordScope | null = React.useContext(
    PrivateRecordScopeContext,
  );
  const recordAccessScope: RecordAccessScope | null = useRecordAccessScope();
  const isPart: boolean = Boolean(
    scope && model && PrivateRecordParts.isPartOf(model, scope.tableName),
  );
  const tableName: string = model?.tableName || "";

  /*
   * Asked of the model itself: a part of the record is answered from what
   * the rule reads of it (RecordAccessScope.getPartAccess, #11435).
   */
  const isAnswered: boolean = Boolean(
    getRecordAccessGateOptions(recordAccessScope, model),
  );

  return React.useMemo((): PermissionGateOptions | undefined => {
    if (!isPart && !isAnswered) {
      return undefined;
    }

    return {
      ...(isPart && scope
        ? { held: scope.held, privateRecordReason: scope.reason }
        : {}),
      ...(isAnswered && recordAccessScope
        ? { recordAccess: recordAccessScope }
        : {}),
    };
  }, [scope, isPart, recordAccessScope, tableName, isAnswered]);
}

/*
 * usePrivateRecordGateOptions, for a gate about ONE record of `model` - a
 * switch, a reset, a delete card, each naming the record it writes: the
 * page's answer for its own kind (RecordAccessScope.recordTableName) is
 * taken only when that record is the one the page is open on
 * (RecordAccessScope.recordId). A switch of another monitor on a monitor's
 * page is not locked by this monitor's labels.
 */
export function useRecordGateOptions(
  model: PrivateRecordPartModel | null | undefined,
  recordId: ObjectID | string | null | undefined,
): PermissionGateOptions | undefined {
  const options: PermissionGateOptions | undefined =
    usePrivateRecordGateOptions(model);
  const recordAccessScope: RecordAccessScope | null = useRecordAccessScope();
  const tableName: string = model?.tableName || "";
  const id: string = recordId ? recordId.toString().toLowerCase() : "";

  return React.useMemo((): PermissionGateOptions | undefined => {
    return withoutAnswerForOtherRecords({
      options: options,
      scope: recordAccessScope,
      tableName: tableName,
      isAboutPageRecord: (scope: RecordAccessScope): boolean => {
        return !scope.recordId || !id || scope.recordId === id;
      },
    });
  }, [options, recordAccessScope, tableName, id]);
}

// The options without the page's answer, where it is about another record.
function withoutAnswerForOtherRecords(data: {
  options: PermissionGateOptions | undefined;
  scope: RecordAccessScope | null;
  tableName: string;
  isAboutPageRecord: (scope: RecordAccessScope) => boolean;
}): PermissionGateOptions | undefined {
  if (
    !data.options?.recordAccess ||
    !data.scope ||
    !data.tableName ||
    data.scope.recordTableName !== data.tableName ||
    data.isAboutPageRecord(data.scope)
  ) {
    return data.options;
  }

  const rest: PermissionGateOptions = { ...data.options };
  delete rest.recordAccess;

  return Object.keys(rest).length > 0 ? rest : undefined;
}

/*
 * usePrivateRecordGateOptions, for a list of `model`'s records: a list of
 * the very kind the page is open on (RecordAccessScope.recordTableName) -
 * other monitors on a monitor's page - lists other records, which what the
 * server or the labels say of the page's record is not about, so its rows
 * are weighed by their own labels (ModelTable) and not by the page's
 * answer. A list of the record's parts keeps the answer - where the page
 * answers the part by the record's labels and owners (#11435,
 * RecordAccessScope.getPartAccess), only while the list is kept to the
 * record's rows: its `query` names the record by the part's key
 * (`monitorId: <this monitor>`). Rows of other records carry their labels.
 */
export function useListGateOptions(
  model: PrivateRecordPartModel | null | undefined,
  query?: unknown,
): PermissionGateOptions | undefined {
  const options: PermissionGateOptions | undefined =
    usePrivateRecordGateOptions(model);
  const recordAccessScope: RecordAccessScope | null = useRecordAccessScope();
  const tableName: string = model?.tableName || "";

  const isOtherRecordsPart: boolean =
    isAnsweredAsPart(recordAccessScope, model) &&
    !isListOfRecordRows({
      model: model,
      query: query,
      scope: recordAccessScope,
    });

  return React.useMemo((): PermissionGateOptions | undefined => {
    const kept: PermissionGateOptions | undefined =
      withoutAnswerForOtherRecords({
        options: options,
        scope: recordAccessScope,
        tableName: tableName,
        // A list of the page's own kind is of other records.
        isAboutPageRecord: (): boolean => {
          return false;
        },
      });

    if (!isOtherRecordsPart || !kept?.recordAccess) {
      return kept;
    }

    const rest: PermissionGateOptions = { ...kept };
    delete rest.recordAccess;

    return Object.keys(rest).length > 0 ? rest : undefined;
  }, [options, recordAccessScope, tableName, isOtherRecordsPart]);
}

/*
 * Whether a list of a part of the page's record is kept to the record's
 * rows: its query names the record, by the part's key.
 */
function isListOfRecordRows(data: {
  model: PrivateRecordPartModel | null | undefined;
  query: unknown;
  scope: RecordAccessScope | null;
}): boolean {
  const record: RecordOfPart | null = RecordParts.getRecordOf(
    data.model as RecordPartModel | null | undefined,
  );

  if (
    !record ||
    !record.key ||
    !data.scope?.recordId ||
    !data.query ||
    typeof data.query !== "object"
  ) {
    return false;
  }

  return (
    LabelAccess.readId((data.query as Record<string, unknown>)[record.key]) ===
    data.scope.recordId
  );
}

/*
 * getPrivateRecordGateOptions as a function of the model, for a page whose
 * gates ask about several: `privateRecordGate(new IncidentAlert())` hands a
 * gate of the record's part what the reader holds on the record, and a gate
 * of anything else nothing.
 */
export function usePrivateRecordGate(): (
  model: PrivateRecordPartModel | null | undefined,
) => PermissionGateOptions | undefined {
  const scope: PrivateRecordScope | null = React.useContext(
    PrivateRecordScopeContext,
  );
  const recordAccessScope: RecordAccessScope | null = useRecordAccessScope();

  return React.useCallback(
    (
      model: PrivateRecordPartModel | null | undefined,
    ): PermissionGateOptions | undefined => {
      return getPrivateRecordGateOptions(scope, model, recordAccessScope);
    },
    [scope, recordAccessScope],
  );
}

/*
 * `options` with the private record's, for a gate that has options of its
 * own (a sentence, a verb): the record's held permissions and reason added.
 */
export function withPrivateRecordGateOptions(
  options: PermissionGateOptions | undefined,
  privateRecordOptions: PermissionGateOptions | undefined,
): PermissionGateOptions | undefined {
  if (!privateRecordOptions) {
    return options;
  }

  return {
    ...(options || {}),
    ...privateRecordOptions,
  };
}
