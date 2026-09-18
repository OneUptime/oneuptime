import EnterpriseArea from "../Types/EnterpriseArea";

/*
 * Enterprise cron jobs that are not part of licensing: the Postgres and Valkey
 * instance-health evaluations. Each job module registers itself with RunCron
 * when it is loaded, so registerWorkerJobs only has to load them. Core calls
 * it from the Workers feature set before the queue consumers start, and then
 * gives any enterprise job name still unregistered a no-op handler.
 *
 * The job names ("InstanceHealth:EvaluatePostgresHealth" and
 * "InstanceHealth:EvaluateRedisHealth") are what earlier releases scheduled
 * from core, and what App/Utils/EnterpriseLoader.ts lists as enterprise-owned:
 * they must never change, or repeatable definitions already in Redis would run
 * the no-op placeholder forever.
 *
 * Each job checks the license itself on every run (instance health), so an
 * install whose license lapses keeps its schedule and simply skips.
 */
const WorkersArea: EnterpriseArea = {
  name: "Workers",
  registerWorkerJobs: async (): Promise<void> => {
    await import("./InstanceHealth/EvaluatePostgresHealth");
    await import("./InstanceHealth/EvaluateRedisHealth");
  },
};

export default WorkersArea;
