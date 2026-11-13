import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../PageComponentProps";
import AiResultsPage from "../../Components/AI/Results/AiResultsPage";

const SettingsAIResults: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <AiResultsPage />;
};

export default SettingsAIResults;
