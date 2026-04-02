import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";

export default class WorkerQueueService {
  public static async getQueueSize(): Promise<number> {
    const [workerSize, workflowSize]: [number, number] = await Promise.all([
      Queue.getQueueSize(QueueName.Worker),
      Queue.getQueueSize(QueueName.Workflow),
    ]);
    return workerSize + workflowSize;
  }
}
