import { Green500, Purple500, Red500 } from "Common/Types/BrandColors";
import CopilotPullRequestStatus from "Common/Types/Copilot/CopilotPullRequestStatus";
import Pill from "CommonUI/src/Components/Pill/Pill";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  pullRequestStatus: CopilotPullRequestStatus;
}

const PullRequestStatusElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.pullRequestStatus === CopilotPullRequestStatus.Created) {
    return <Pill color={Green500} text={"Open"} />;
  }

  if (props.pullRequestStatus === CopilotPullRequestStatus.Merged) {
    return <Pill color={Purple500} text={"Merged"} />;
  }

  if (props.pullRequestStatus === CopilotPullRequestStatus.Closed) {
    return <Pill color={Red500} text={"Closed"} />;
  }

  return <></>;
};

export default PullRequestStatusElement;
