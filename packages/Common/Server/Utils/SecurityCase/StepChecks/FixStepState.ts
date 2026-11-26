import SecurityCaseStepCheck from "../../../../Models/DatabaseModels/SecurityCaseStepCheck";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityCaseStepCheckEvidence,
  readStepCheckDataTime,
  readStepCheckEvidence,
} from "../../../../Types/SecurityCase/SecurityCaseStepCheckEvidence";
import SecurityCaseStepCheckState, {
  isSecurityCaseStepCheckState,
} from "../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import {
  RESPONSE_STEP_KINDS,
  getResponseStepKey,
} from "../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanKeys";
import SecurityCaseStepCheckService from "../../../Services/SecurityCaseStepCheckService";

/*
 * WHAT ONEUPTIME FOUND OF A CASE'S FIX STEP, FOR WHAT ACTS ON IT (#10347):
 * read from the step's own check (SecurityCaseStepCheck, written by
 * FixRouteStepCheck), the one the Response Plan's card shows, so whatever
 * acts on a fix acts on what the person sees:
 *
 *   - a virtual patch on the route (#10351) is lifted once the fix is
 *     Verified - never on a fix that only looks done: while a patch turns
 *     the attack away at the edge, no attack reaches the app to prove the
 *     fix, and the check says so;
 *   - OneUptime AI working a case end to end (#10352) closes it once its
 *     fixes hold, and asks a person while they only look done.
 */

export interface RouteFixState {
  // Null while OneUptime has not checked the step.
  state: SecurityCaseStepCheckState | null;
  isVerified: boolean;
  // The route, and what shipped, as the check named them.
  route: string;
  change: string;
  shippedAt: Date | null;
  // Since when it has been in its state, and when OneUptime last checked.
  stateSince: Date | null;
  checkedAt: Date | null;
  evidence: SecurityCaseStepCheckEvidence | null;
}

export const ROUTE_FIX_STEP_KEY: string = getResponseStepKey(
  RESPONSE_STEP_KINDS.fixPublicApp,
);

export const NOT_CHECKED_ROUTE_FIX: RouteFixState = {
  state: null,
  isVerified: false,
  route: "",
  change: "",
  shippedAt: null,
  stateSince: null,
  checkedAt: null,
  evidence: null,
};

// A stored check of the step, as what acts on the fix reads it.
export function readRouteFixState(
  row: SecurityCaseStepCheck | null,
): RouteFixState {
  if (!row || !isSecurityCaseStepCheckState(row.state)) {
    return { ...NOT_CHECKED_ROUTE_FIX };
  }

  const evidence: SecurityCaseStepCheckEvidence | null = readStepCheckEvidence(
    row.evidence,
  );
  const route: string | number | boolean | null | undefined =
    evidence?.data["route"];
  const change: string | number | boolean | null | undefined =
    evidence?.data["change"];

  return {
    state: row.state,
    isVerified: row.state === SecurityCaseStepCheckState.Verified,
    route: typeof route === "string" ? route : "",
    change: typeof change === "string" ? change : "",
    shippedAt: readStepCheckDataTime(evidence?.data, "shippedAt"),
    stateSince: row.stateSince ? new Date(row.stateSince) : null,
    checkedAt: row.checkedAt ? new Date(row.checkedAt) : null,
    evidence,
  };
}

export default class FixStepState {
  // The case's route fix as OneUptime last found it; not checked when it never was.
  public static async readRouteFix(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<RouteFixState> {
    const row: SecurityCaseStepCheck | null =
      await SecurityCaseStepCheckService.findOneBy({
        query: {
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
          stepKey: ROUTE_FIX_STEP_KEY,
        },
        select: {
          _id: true,
          state: true,
          evidence: true,
          stateSince: true,
          checkedAt: true,
        },
        props: { isRoot: true },
      });

    return readRouteFixState(row);
  }
}
