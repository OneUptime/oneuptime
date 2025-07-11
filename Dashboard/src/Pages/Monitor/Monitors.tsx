import MonitorTable from "../../Components/Monitor/MonitorTable";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import URL from "Common/Types/API/URL";
import Banner from "Common/UI/Components/Banner/Banner";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const MonitorPage: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Fragment>
      <Banner
        openInNewTab={true}
        title="Monitoring Demo"
        description="Watch this video which will help monitor any resource you have with OneUptime"
        link={URL.fromString("https://youtu.be/_fQ_F4EisBQ")}
        hideOnMobile={true}
      />
      <MonitorTable
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        saveFilterProps={{
          tableId: "all-monitors-table",
        }}
      />
    </Fragment>
  );
};

export default MonitorPage;
