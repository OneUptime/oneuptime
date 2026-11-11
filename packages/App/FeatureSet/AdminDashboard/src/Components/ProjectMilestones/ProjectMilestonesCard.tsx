import { fetchProjectMilestones } from "./ProjectMilestones";
import ProjectMilestone from "Common/Models/DatabaseModels/ProjectMilestone";
import ActivationMilestone, {
  ACTIVATION_MILESTONE_DETAILS,
  ActivationMilestoneDetail,
  ActivationSetupSummary,
  getActivationSetupSummary,
  isActivationMilestone,
} from "Common/Types/Analytics/ActivationMilestone";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import API from "Common/UI/Utils/API/API";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A project's activation milestones on its Admin Dashboard page (issue
 * #6830): every milestone, with when the project reached it or "Not yet",
 * and the first setup step it is stuck at. Read from this server's own
 * ProjectMilestone rows - nothing is sent anywhere - so a self-hosted admin
 * can tell which of their teams are stuck.
 */
export interface ComponentProps {
  projectId: ObjectID;
  title: string;
  description: string;
}

export const PROJECT_MILESTONES_CARD_TEST_ID: string = "project-milestones";

const ProjectMilestonesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [milestones, setMilestones] = useState<Array<ProjectMilestone> | null>(
    null,
  );
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let isCancelled: boolean = false;

    fetchProjectMilestones(props.projectId)
      .then((rows: Array<ProjectMilestone>): void => {
        if (!isCancelled) {
          setMilestones(rows);
        }
      })
      .catch((err: unknown): void => {
        if (!isCancelled) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [props.projectId.toString()]);

  const renderBody: () => ReactElement = (): ReactElement => {
    if (error) {
      return <ErrorMessage message={error} />;
    }

    if (!milestones) {
      return <ComponentLoader />;
    }

    const reachedByMilestone: Map<ActivationMilestone, ProjectMilestone> =
      new Map<ActivationMilestone, ProjectMilestone>();

    for (const row of milestones) {
      if (isActivationMilestone(row.milestone)) {
        reachedByMilestone.set(row.milestone, row);
      }
    }

    const summary: ActivationSetupSummary = getActivationSetupSummary(
      Array.from(reachedByMilestone.keys()),
    );

    return (
      <div data-testid={PROJECT_MILESTONES_CARD_TEST_ID}>
        <p
          className={`mb-4 text-sm font-medium ${summary.isSetUp ? "text-green-700" : "text-yellow-700"}`}
          data-testid="project-milestones-summary"
        >
          {summary.isSetUp
            ? "Set up: its monitors run and OneUptime has reached a person."
            : `Stuck at: ${summary.text}.`}
        </p>
        <ul className="divide-y divide-gray-100">
          {ACTIVATION_MILESTONE_DETAILS.map(
            (detail: ActivationMilestoneDetail): ReactElement => {
              const row: ProjectMilestone | undefined = reachedByMilestone.get(
                detail.milestone,
              );

              return (
                <li
                  key={detail.milestone}
                  className="flex items-center justify-between gap-4 py-2 text-sm"
                  data-testid={`project-milestone-${detail.milestone}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon
                      icon={row ? IconProp.CheckCircle : IconProp.Circle}
                      className={`h-4 w-4 flex-shrink-0 ${row ? "text-green-600" : "text-gray-300"}`}
                    />
                    <span className={row ? "text-gray-900" : "text-gray-500"}>
                      {detail.title}
                    </span>
                  </span>
                  <span className="flex-shrink-0 text-gray-500">
                    {row && row.reachedAt
                      ? `${OneUptimeDate.getDateAsLocalFormattedString(row.reachedAt)}${row.wasBackfilled ? " (from earlier data)" : ""}`
                      : "Not yet"}
                  </span>
                </li>
              );
            },
          )}
        </ul>
      </div>
    );
  };

  return (
    <Card title={props.title} description={props.description}>
      {renderBody()}
    </Card>
  );
};

export default ProjectMilestonesCard;
