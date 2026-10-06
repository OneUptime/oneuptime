import { PlanCutoffCounts } from "./PlanCutoff";
import ApiKey from "Common/Models/DatabaseModels/ApiKey";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import StatusPageSCIM from "Common/Models/DatabaseModels/StatusPageSCIM";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { useEffect, useState } from "react";

/*
 * How many API keys and SCIM connections the current project has, for the
 * Billing page to say how many a plan stops (Components/Billing/PlanCutoff).
 * API keys that have expired are not counted: they stopped already.
 *
 * Read once, while `enabled` - OneUptime Cloud, with the project's plan
 * known. Each count is read on its own, and one the reader may not read
 * (API keys and SCIM connections have read permissions of their own, which
 * someone who may change the plan need not hold) is not known - null -
 * rather than none, and does not hide the other: the plan picker then says
 * that they stop without saying how many. Null until read, or when not
 * enabled: the page then says nothing about them.
 */
const usePlanCutoffCounts: (data: {
  enabled: boolean;
}) => PlanCutoffCounts | null = (data: {
  enabled: boolean;
}): PlanCutoffCounts | null => {
  const [counts, setCounts] = useState<PlanCutoffCounts | null>(null);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!data.enabled || !projectId) {
      setCounts(null);
      return;
    }

    let isCurrent: boolean = true;

    const countOrUnknown: (
      count: Promise<number>,
    ) => Promise<number | null> = async (
      count: Promise<number>,
    ): Promise<number | null> => {
      try {
        return await count;
      } catch {
        return null;
      }
    };

    void Promise.all([
      countOrUnknown(
        ModelAPI.count<ApiKey>({
          modelType: ApiKey,
          query: {
            projectId: projectId,
            expiresAt: new GreaterThan(OneUptimeDate.getCurrentDate()),
          },
        }),
      ),
      countOrUnknown(
        ModelAPI.count<ProjectSCIM>({
          modelType: ProjectSCIM,
          query: { projectId: projectId },
        }),
      ),
      countOrUnknown(
        ModelAPI.count<StatusPageSCIM>({
          modelType: StatusPageSCIM,
          query: { projectId: projectId },
        }),
      ),
    ]).then(
      ([apiKeys, projectScim, statusPageScim]: Array<number | null>): void => {
        if (!isCurrent) {
          return;
        }

        setCounts({
          apiKeys: apiKeys === null ? null : apiKeys || 0,
          // Not known unless both are: the total is the two together.
          scimConnections:
            projectScim === null || statusPageScim === null
              ? null
              : (projectScim || 0) + (statusPageScim || 0),
        });
      },
    );

    return () => {
      isCurrent = false;
    };
  }, [data.enabled]);

  return counts;
};

export default usePlanCutoffCounts;
