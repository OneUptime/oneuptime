import MonitorTable from "../../Components/Monitor/MonitorTable";
import { MONITOR_ARCHIVE_COPY } from "../../Components/Archive/ResourceArchiveCopy";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Monitors that have been archived: not checked, opening no incidents or
 * alerts, and left out of every other monitor list and of status pages until
 * they are unarchived. The table is the same one every monitor list uses, in
 * its archived view (see MonitorTable's isArchivedView).
 */
const ArchivedMonitors: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <MonitorTable
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      isArchivedView={true}
      disableCreate={true}
      saveFilterProps={{
        tableId: "archived-monitors-table",
      }}
      noItemsMessage={MONITOR_ARCHIVE_COPY.noArchivedItemsMessage}
      title={MONITOR_ARCHIVE_COPY.archivedPageTitle}
      description={MONITOR_ARCHIVE_COPY.archivedPageDescription}
    />
  );
};

export default ArchivedMonitors;
