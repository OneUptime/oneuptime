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
 *
 * Read when asked, not when this file loads: an action reaches the issue's
 * service, which settles proposals through this file, so at load time an
 * action's module may not have finished - and a table built then would
 * hold nothing for it.
 */
function actions(): Readonly<
  Record<DataSecurityAiProposalKind, DataSecurityAiAction>
> {
  return {
    [DataSecurityAiProposalKind.ScrubTelemetry]: ScrubTelemetryAction,
  };
}

export default class DataSecurityAiActions {
  // The action of a kind, or null for a kind this build does not know.
  public static get(kind: unknown): DataSecurityAiAction | null {
    return isDataSecurityAiProposalKind(kind) ? actions()[kind] : null;
  }

  // The actions of one kind of work, in the order their kinds are listed.
  public static forWork(work: DataSecurityAiWork): Array<DataSecurityAiAction> {
    const table: Readonly<
      Record<DataSecurityAiProposalKind, DataSecurityAiAction>
    > = actions();

    return Object.values(DataSecurityAiProposalKind)
      .filter((kind: DataSecurityAiProposalKind): boolean => {
        return DATA_SECURITY_AI_PROPOSAL_KINDS[kind].work === work;
      })
      .map((kind: DataSecurityAiProposalKind): DataSecurityAiAction => {
        return table[kind];
      });
  }

  public static all(): Array<DataSecurityAiAction> {
    const table: Readonly<
      Record<DataSecurityAiProposalKind, DataSecurityAiAction>
    > = actions();

    return Object.values(DataSecurityAiProposalKind).map(
      (kind: DataSecurityAiProposalKind): DataSecurityAiAction => {
        return table[kind];
      },
    );
  }
}
