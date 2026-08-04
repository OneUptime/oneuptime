import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveOwnerTeam from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceLevelObjectiveOwnerUser from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import { BulkActionButtonSchema } from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
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
  modals: ReactElement;
}

export type UseSloBulkActionsFunction = () => SloBulkActionsResult;

/**
 * "Add Labels" / "Remove Labels" / "Add Owner" / "Remove Owner" for a table
 * of SLOs.
 *
 * Labels are how SLOs get grouped into a team's or a service's view, and
 * owners are who gets notified when one of them changes status — both were
 * previously reachable only one SLO at a time, through the edit form and the
 * SLO's Owners tab. Every other resource list in the product already offers
 * these in bulk.
 *
 * Lives here rather than on the SLOs page because two surfaces mount it (the
 * SLOs list and the monitor's SLOs tab) and they must not drift apart in
 * which junction tables or foreign key they write.
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

    return {
      bulkActions: [...labelBulkActions, ...ownerBulkActions],
      modals: (
        <>
          {labelBulkActionModals}
          {ownerBulkActionModals}
        </>
      ),
    };
  };

export default useSloBulkActions;
