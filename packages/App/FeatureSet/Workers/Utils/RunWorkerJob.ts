import JobDictionary, { WorkerJobFunction } from "./JobDictionary";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";

export default async function runWorkerJob(job: QueueJob): Promise<void> {
  const handler: WorkerJobFunction = JobDictionary.getJobFunction(job.name);
  await QueueWorker.runJobWithTimeout(
    JobDictionary.getTimeoutInMs(job.name),
    async (): Promise<void> => {
      await handler(job);
    },
  );
}
