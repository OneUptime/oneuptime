import EnterpriseArea from "../Types/EnterpriseArea";

/*
 * Enterprise cron jobs that are not part of licensing: the Postgres and Redis
 * instance-health evaluations. Each job module registers itself with RunCron
 * when it is required, so registerWorkerJobs only has to require them.
 *
 * Skeleton: no jobs yet. InstanceHealth/{EvaluatePostgresHealth,
 * EvaluateRedisHealth} move here from packages/App/FeatureSet/Workers/Jobs.
 */
const WorkersArea: EnterpriseArea = {
  name: "Workers",
  registerWorkerJobs: async (): Promise<void> => {
    return undefined;
  },
};

export default WorkersArea;
