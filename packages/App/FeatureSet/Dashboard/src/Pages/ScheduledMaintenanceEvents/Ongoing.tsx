import ScheduledMaintenanceTable from "../../Components/ScheduledMaintenance/ScheduledMaintenanceTable";
import useInProgressScheduledMaintenanceStateIds from "../../Components/ScheduledMaintenance/useInProgressScheduledMaintenanceStateIds";
import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import React, { FunctionComponent, ReactElement } from "react";

const ScheduledMaintenancesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * In progress: in the project's ongoing state, or in a state of its own
   * placed between Ongoing and Ended, such as "Verifying"
   * (Common/Utils/ScheduledMaintenanceStart).
   */
  const { inProgressStateIds, error } =
    useInProgressScheduledMaintenanceStateIds();

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!inProgressStateIds) {
    return <PageLoader isVisible={true} />;
  }

  return (
    <ScheduledMaintenanceTable
      viewPageRoute={RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route}
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
        currentScheduledMaintenanceStateId: new Includes(
          inProgressStateIds.map((stateId: ObjectID) => {
            return stateId.toString();
          }),
        ),
      }}
      noItemsMessage="No ongoing events so far."
      emptyState={{ isAllClear: true }}
      title="Ongoing Scheduled Maintenance"
      description="Scheduled maintenance events that are in progress right now. An event leaves this list when it ends."
    />
  );
};

export default ScheduledMaintenancesPage;
