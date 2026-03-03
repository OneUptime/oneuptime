import ScheduledMaintenanceTable from "../../Components/ScheduledMaintenance/ScheduledMaintenanceTable";
import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import SideMenu from "./SideMenu";
import Route from "Common/Types/API/Route";
import Page from "Common/UI/Components/Page/Page";
import React, { FunctionComponent, ReactElement } from "react";

const ScheduledMaintenancesPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <Page
      title={"Home"}
      sideMenu={<SideMenu project={props.currentProject || undefined} />}
      breadcrumbLinks={[
        {
          title: "Project",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "Home",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "Ongoing Scheduled Maintenance",
          to: RouteMap[
            PageMap.HOME_ONGOING_SCHEDULED_MAINTENANCE_EVENTS
          ] as Route,
        },
      ]}
    >
      <ScheduledMaintenanceTable
        viewPageRoute={RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          currentScheduledMaintenanceState: {
            isOngoingState: true,
          },
        }}
        noItemsMessage="No ongoing events so far."
        title="Ongoing Scheduled Maintenances"
        description="Here is a list of all the ongoing events for this project."
      />
    </Page>
  );
};

export default ScheduledMaintenancesPage;
