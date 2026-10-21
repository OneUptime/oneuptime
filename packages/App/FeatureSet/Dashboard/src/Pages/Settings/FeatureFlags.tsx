import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import MonitorGroupsSwitchCard from "../../Components/MonitorGroup/MonitorGroupsSwitchCard";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Settings -> Feature Flags: optional features of the project, each a
 * switch that saves the moment it is flipped. Today that is Monitor Groups
 * (see MonitorGroupsSwitchCopy for why it lives here).
 */
const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Fragment>
      <MonitorGroupsSwitchCard projectId={ProjectUtil.getCurrentProjectId()!} />
    </Fragment>
  );
};

export default Settings;
