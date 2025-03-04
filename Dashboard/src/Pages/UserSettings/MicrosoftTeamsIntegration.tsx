import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import ComingSoon from "Common/UI/Components/ComingSoon/ComingSoon";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <ComingSoon
      title="Microsoft Teams Integration is coming soon, but you can still integrate Teams with Workflows!"
      description="We are working hard to bring you the Microsoft Teams integration. In the meantime, you can still integrate with Workflows to receive alerts in Microsoft Teams. Please click on Workflows in the top navigation to get started."
    />
  );
};

export default Settings;
