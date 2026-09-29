import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import UserOverrideTable from "../../Components/OnCallPolicy/UserOverrides/UserOverrideTable";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return <UserOverrideTable />;
};

export default Settings;
