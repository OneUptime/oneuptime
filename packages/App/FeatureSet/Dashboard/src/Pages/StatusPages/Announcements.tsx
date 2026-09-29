import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import AnnouncementTable from "../../Components/Announcement/AnnouncementsTable";

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <AnnouncementTable />
    </Fragment>
  );
};

export default StatusPageDelete;
