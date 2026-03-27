import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";

const ProfileViewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const profileId: string = Navigation.getLastParamAsString(0);

  return (
    <InfoCard
      title={`Profile: ${profileId}`}
      value="Profile flamegraph visualization will be available here. This view will show CPU, memory, and allocation hotspots as an interactive flamegraph with function-level detail."
    />
  );
};

export default ProfileViewPage;
