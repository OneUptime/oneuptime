import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveOwnerTeam from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceLevelObjectiveOwnerUser from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import { BulkActionButtonSchema } from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import {
  SLO_BULK_ARCHIVE_CONFIRM_MESSAGE,
  SLO_BULK_UNARCHIVE_CONFIRM_MESSAGE,
} from "./SloArchiveCopy";
import React, { ReactElement } from "react";

/**
 * The foreign key both SLO owner junction tables use to point back at the
 * SLO.
 *
 * Typed as the intersection of the two tables' keys rather than as `string`
 * so a typo is a compile error. It has to be: `resourceIdField` is a plain
 * string on the hook's config, and a wrong value there does not fail — it
 * queries a column nothing matches, finds no existing owners, and reports
 * every item as a success while changing nothing.
 */
export type SloOwnerResourceIdField = keyof ServiceLevelObjectiveOwnerUser &
  keyof ServiceLevelObjectiveOwnerTeam;

export const SLO_OWNER_RESOURCE_ID_FIELD: SloOwnerResourceIdField =
  "serviceLevelObjectiveId";

export interface SloBulkActionsResult {
  bulkActions: Array<BulkActionButtonSchema<ServiceLevelObjective>>;
  /*
   * Archive and Unarchive are handed back separately rather than folded into
   * `bulkActions`, because which one a table offers depends on which list it
   * is: the live SLO list archives, the Archived page unarchives, and the
   * monitor's SLOs tab does neither.
   */
  archiveBulkActions: Array<BulkActionButtonSchema<ServiceLevelObjective>>;
  unarchiveBulkActions: Array<BulkActionButtonSchema<ServiceLevelObjective>>;
  modals: ReactElement;
}

export type UseSloBulkActionsFunction = () => SloBulkActionsResult;

/**
 * "Add Labels" / "Remove Labels" / "Add Owner" / "Remove Owner", plus
 * "Archive" / "Unarchive", for a table of SLOs.
 *
 * Labels are how SLOs get grouped into a team's or a service's view, and
 * owners are who gets notified when one of them changes status — both were
 * previously reachable only one SLO at a time, through the edit form and the
 * SLO's Owners tab. Every other resource list in the product already offers
 * these in bulk.
 *
 * Lives here rather than on the SLOs page because several surfaces mount it
 * (the SLOs list, the Archived SLOs page and the monitor's SLOs tab) and they
 * must not drift apart in which junction tables or foreign key they write, or
 * in how they describe what archiving an SLO does.
 */
export const useSloBulkActions: UseSloBulkActionsFunction =
  (): SloBulkActionsResult => {
    const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
      useBulkLabelActions<ServiceLevelObjective>({
        modelType: ServiceLevelObjective,
      });

    const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
      useBulkOwnerActions<ServiceLevelObjective>({
        ownerUserModelType: ServiceLevelObjectiveOwnerUser,
        ownerTeamModelType: ServiceLevelObjectiveOwnerTeam,
        resourceIdField: SLO_OWNER_RESOURCE_ID_FIELD,
      });

    /*
     * Plain updates confirmed through the action bar's own dialog, so they
     * bring no modals of their own. The copy is the SLO's: the generic "will
     * keep collecting telemetry" is the opposite of what an archived SLO does.
     */
    const { archiveBulkActions, unarchiveBulkActions } =
      useBulkArchiveActions<ServiceLevelObjective>({
        modelType: ServiceLevelObjective,
        singularName: "SLO",
        pluralName: "SLOs",
        archiveConfirmMessage: SLO_BULK_ARCHIVE_CONFIRM_MESSAGE,
        unarchiveConfirmMessage: SLO_BULK_UNARCHIVE_CONFIRM_MESSAGE,
      });

    return {
      bulkActions: [...labelBulkActions, ...ownerBulkActions],
      archiveBulkActions: archiveBulkActions,
      unarchiveBulkActions: unarchiveBulkActions,
      modals: (
        <>
          {labelBulkActionModals}
          {ownerBulkActionModals}
        </>
      ),
    };
  };

export default useSloBulkActions;
