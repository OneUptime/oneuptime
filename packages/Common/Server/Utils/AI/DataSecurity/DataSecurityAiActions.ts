import {
  DATA_SECURITY_AI_PROPOSAL_KINDS,
  DataSecurityAiProposalKind,
  DataSecurityAiWork,
  isDataSecurityAiProposalKind,
} from "../../../../Types/DataSecurity/DataSecurityAi";
import ScrubTelemetryAction from "./Actions/ScrubTelemetryAction";
import { DataSecurityAiAction } from "./DataSecurityAiAction";

/*
 * EVERY KIND OF CHANGE ONEUPTIME AI PROPOSES FOR A DATA SECURITY ISSUE,
 * BY ITS KIND (#10364). One entry per DataSecurityAiProposalKind: the
 * engine plans with them, and the routes approve, dismiss and undo through
 * them (see DataSecurityAiAction for how to add one). A test pins that
 * every kind has exactly one action and that each action is its kind's.
 */
const ACTIONS: Readonly<
  Record<DataSecurityAiProposalKind, DataSecurityAiAction>
> = {
  [DataSecurityAiProposalKind.ScrubTelemetry]: ScrubTelemetryAction,
};

export default class DataSecurityAiActions {
  // The action of a kind, or null for a kind this build does not know.
  public static get(kind: unknown): DataSecurityAiAction | null {
    return isDataSecurityAiProposalKind(kind) ? ACTIONS[kind] : null;
  }

  // The actions of one kind of work, in the order their kinds are listed.
  public static forWork(work: DataSecurityAiWork): Array<DataSecurityAiAction> {
    return Object.values(DataSecurityAiProposalKind)
      .filter((kind: DataSecurityAiProposalKind): boolean => {
        return DATA_SECURITY_AI_PROPOSAL_KINDS[kind].work === work;
      })
      .map((kind: DataSecurityAiProposalKind): DataSecurityAiAction => {
        return ACTIONS[kind];
      });
  }

  public static all(): Array<DataSecurityAiAction> {
    return Object.values(DataSecurityAiProposalKind).map(
      (kind: DataSecurityAiProposalKind): DataSecurityAiAction => {
        return ACTIONS[kind];
      },
    );
  }
}
