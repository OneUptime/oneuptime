import { HeldPermissions } from "../../Types/HeldPermissions";
import PrivateRecordParts, {
  PrivateRecordPartModel,
} from "../../Types/PrivateRecord/PrivateRecordParts";
import { PermissionGateOptions } from "./PermissionGate";
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
 */
export function getPrivateRecordGateOptions(
  scope: PrivateRecordScope | null,
  model: PrivateRecordPartModel | null | undefined,
): PermissionGateOptions | undefined {
  if (
    !scope ||
    !model ||
    !PrivateRecordParts.isPartOf(model, scope.tableName)
  ) {
    return undefined;
  }

  return {
    held: scope.held,
    privateRecordReason: scope.reason,
  };
}

/*
 * getPrivateRecordGateOptions, for the page the calling component is on -
 * the same object while the page's scope stays the same, so a component
 * that keeps what it worked out (useMemo) keeps it.
 */
export function usePrivateRecordGateOptions(
  model: PrivateRecordPartModel | null | undefined,
): PermissionGateOptions | undefined {
  const scope: PrivateRecordScope | null = React.useContext(
    PrivateRecordScopeContext,
  );
  const isPart: boolean = Boolean(
    scope && model && PrivateRecordParts.isPartOf(model, scope.tableName),
  );

  return React.useMemo((): PermissionGateOptions | undefined => {
    return isPart && scope
      ? { held: scope.held, privateRecordReason: scope.reason }
      : undefined;
  }, [scope, isPart]);
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

  return React.useCallback(
    (
      model: PrivateRecordPartModel | null | undefined,
    ): PermissionGateOptions | undefined => {
      return getPrivateRecordGateOptions(scope, model);
    },
    [scope],
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
