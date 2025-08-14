import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";

export default class WorkerQueueService {
  public static async getQueueSize(): Promise<number> {
    return Queue.getQueueSize(QueueName.Worker);
  }
}
