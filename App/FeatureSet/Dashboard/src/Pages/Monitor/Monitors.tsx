import MonitorTable from "../../Components/Monitor/MonitorTable";
import { ALL_MONITORS_TABLE_ID } from "../../Components/Monitor/MonitorFacets";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import URL from "Common/Types/API/URL";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const MonitorPage: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Fragment>
      <MonitorTable
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        saveFilterProps={{
          /*
           * Also the URL namespace this table's chips are persisted under, so a
           * link built elsewhere (see MonitorListFacetRoute) can land the list
           * with a chip already set. Shared rather than spelled twice.
           */
          tableId: ALL_MONITORS_TABLE_ID,
        }}
        videoLink={URL.fromString("https://youtu.be/_fQ_F4EisBQ")}
      />
    </Fragment>
  );
};

export default MonitorPage;
