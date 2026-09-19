import { createFixtureModule } from "../../FixtureModuleFactory";

/*
 * registerWorkerJobs rejects (a cron module failed to import): the Workers
 * feature set must still start, with placeholders for every ee-owned name.
 */
export default createFixtureModule("WorkerJobsThrow", {
  registerWorkerJobs: "throw",
});
