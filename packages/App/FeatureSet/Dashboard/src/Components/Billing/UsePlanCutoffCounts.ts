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
 * (SCIM connections are for project owners) counts as none rather than
 * hiding the other. Null until read, or when not enabled: the page then
 * says nothing about them.
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

    const countOrNone: (count: Promise<number>) => Promise<number> = async (
      count: Promise<number>,
    ): Promise<number> => {
      try {
        return await count;
      } catch {
        return 0;
      }
    };

    void Promise.all([
      countOrNone(
        ModelAPI.count<ApiKey>({
          modelType: ApiKey,
          query: {
            projectId: projectId,
            expiresAt: new GreaterThan(OneUptimeDate.getCurrentDate()),
          },
        }),
      ),
      countOrNone(
        ModelAPI.count<ProjectSCIM>({
          modelType: ProjectSCIM,
          query: { projectId: projectId },
        }),
      ),
      countOrNone(
        ModelAPI.count<StatusPageSCIM>({
          modelType: StatusPageSCIM,
          query: { projectId: projectId },
        }),
      ),
    ]).then(([apiKeys, projectScim, statusPageScim]: Array<number>): void => {
      if (isCurrent) {
        setCounts({
          apiKeys: apiKeys || 0,
          scimConnections: (projectScim || 0) + (statusPageScim || 0),
        });
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [data.enabled]);

  return counts;
};

export default usePlanCutoffCounts;
