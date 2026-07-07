import IncidentTriage from "../../Components/Incident/IncidentTriage";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

const IncidentTriagePage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <IncidentTriage />;
};

export default IncidentTriagePage;
