import { Green500, Purple500, Red500 } from "Common/Types/BrandColors";
import PullRequestState from "Common/Types/CodeRepository/PullRequestState";
import Pill from "Common/UI/Components/Pill/Pill";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  pullRequestStatus: PullRequestState;
}

const PullRequestStatusElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.pullRequestStatus === PullRequestState.Open) {
    return <Pill color={Green500} text={"Open"} />;
  }

  if (props.pullRequestStatus === PullRequestState.Merged) {
    return <Pill color={Purple500} text={"Merged"} />;
  }

  if (props.pullRequestStatus === PullRequestState.Closed) {
    return <Pill color={Red500} text={"Closed"} />;
  }

  return <></>;
};

export default PullRequestStatusElement;
