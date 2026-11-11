import Pill from "Common/UI/Components/Pill/Pill";
import ActivationMilestone, {
  ActivationSetupSummary,
  getActivationSetupSummary,
} from "Common/Types/Analytics/ActivationMilestone";
import { Green, Yellow } from "Common/Types/BrandColors";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Where a project is in its first hour, in the Projects list (issue #6830):
 * the first setup step it has not reached - "No monitor yet", "No check
 * result yet", "Nobody reachable yet" - or "Set up". Read from this
 * server's own ProjectMilestone rows; nothing is sent anywhere.
 */
export interface ComponentProps {
  // The project's milestones; null while they are read, or when they could not be.
  reached: Array<ActivationMilestone> | null;
}

export const PROJECT_SETUP_STATUS_TEST_ID: string = "project-setup-status";

const ProjectSetupStatus: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.reached) {
    return <span className="text-gray-400">-</span>;
  }

  const summary: ActivationSetupSummary = getActivationSetupSummary(
    props.reached,
  );

  return (
    <span
      data-testid={PROJECT_SETUP_STATUS_TEST_ID}
      data-stuck-at={summary.stuckAt || ""}
    >
      <Pill text={summary.text} color={summary.isSetUp ? Green : Yellow} />
    </span>
  );
};

export default ProjectSetupStatus;
