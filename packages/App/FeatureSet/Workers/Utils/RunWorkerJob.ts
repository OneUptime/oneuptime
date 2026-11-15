import JobDictionary, { WorkerJobFunction } from "./JobDictionary";
import UnknownWorkerJob from "./UnknownWorkerJob";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";
import JobDeadline from "Common/Server/Utils/JobDeadline";

export default async function runWorkerJob(
  job: QueueJob,
  token?: string,
): Promise<void> {
  // Queued or scheduled by a server running another release (#5546).
  if (!JobDictionary.has(job.name)) {
    await UnknownWorkerJob.handle(job, token);
    return;
  }

  const handler: WorkerJobFunction = JobDictionary.getJobFunction(job.name);
  await QueueWorker.runJobWithTimeout(
    JobDictionary.getTimeoutInMs(job.name),
    // The job hears its time limit run out, and stops (JobDeadline).
    async (deadline: JobDeadline): Promise<void> => {
      await handler(job, deadline);
    },
  );
}
