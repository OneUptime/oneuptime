import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";
import Select from "Common/Types/BaseDatabase/Select";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { useOutletContext } from "react-router-dom";

/*
 * What an issue's layout hands the page below it, in its <Outlet>.
 *
 * The layout reads the issue once, with everything its pages show - the
 * check that failed and its evidence, the store it is on, where it stands,
 * who has it, its risk score and every part of it - and reads it again
 * after a change, so every page works the issue the trail names.
 */
export default interface DataSecurityIssueViewContext {
  issueId: ObjectID;
  issue: DataSecurityIssue;
  /*
   * Bumped whenever the issue changes, so each page reads what it shows
   * again: the timeline.
   */
  refreshToggle: string;
  // A change to the issue is being saved.
  isWorking: boolean;
  // Read the issue again, and every page's lists with it.
  refresh: () => void;
  /*
   * Save a change to the issue, then read it again. Throws the server's
   * reason when it could not be saved, for the dialog that asked to say.
   */
  updateIssue: (data: JSONObject) => Promise<void>;
}

/*
 * What the layout reads: the issue, its store, and who has it.
 *
 * Through a relation, only what the related model lets a relation read
 * (canReadOnRelationQuery): the server refuses the whole read for one
 * column it does not, and the page said "Column dataTypeIds on Data Store
 * does not support read on relation query." in place of every issue from
 * 14.0.99 (#10238). The kinds of data the store holds are read from the
 * store itself, when the issue has none of its own (StoreDataTypes.ts).
 */
export const DATA_SECURITY_ISSUE_VIEW_SELECT: Select<DataSecurityIssue> = {
  _id: true,
  title: true,
  checkId: true,
  checkGroup: true,
  evidence: true,
  severity: true,
  status: true,
  riskScore: true,
  riskFactors: true,
  dataTypeIds: true,
  frameworks: true,
  acceptedReason: true,
  acceptedUntil: true,
  acceptedByUser: { name: true, email: true },
  assignedToUserId: true,
  assignedToUser: { name: true, email: true, profilePictureId: true },
  assignedToTeamId: true,
  assignedToTeam: { name: true },
  securityCaseId: true,
  alertId: true,
  incidentId: true,
  firstDetectedAt: true,
  lastDetectedAt: true,
  resolvedAt: true,
  reopenCount: true,
  recheckRequestedAt: true,
  dataStoreId: true,
  dataStore: {
    _id: true,
    name: true,
    kind: true,
    region: true,
    environment: true,
    sensitivity: true,
    exposure: true,
    // A telemetry store's service, or its RUM application by its key.
    serviceId: true,
    storeKey: true,
  },
};

export function useDataSecurityIssueView(): DataSecurityIssueViewContext {
  return useOutletContext<DataSecurityIssueViewContext>();
}
