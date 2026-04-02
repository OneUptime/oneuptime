import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";

export default class AppQueueService {
  public static async getQueueSize(): Promise<number> {
    const [workerSize, workflowSize, telemetrySize]: [
      number,
      number,
      number,
    ] = await Promise.all([
      Queue.getQueueSize(QueueName.Worker),
      Queue.getQueueSize(QueueName.Workflow),
      Queue.getQueueSize(QueueName.Telemetry),
    ]);
    return workerSize + workflowSize + telemetrySize;
  }
}
