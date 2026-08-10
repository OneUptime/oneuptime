import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";

export default class AppQueueService {
  /*
   * Combined queue BACKLOG (waiting + delayed) across the queues this
   * deployment drains. Feeds the /metrics/queue-size KEDA endpoint, so it
   * must not count active jobs — see Queue.getQueueBacklogSize for why
   * counting active work makes the autoscaler treat ack-parked telemetry
   * jobs as demand and overscale the fleet.
   */
  public static async getQueueBacklogSize(): Promise<number> {
    const [workerSize, workflowSize, telemetrySize, runbookSize]: [
      number,
      number,
      number,
      number,
    ] = await Promise.all([
      Queue.getQueueBacklogSize(QueueName.Worker),
      Queue.getQueueBacklogSize(QueueName.Workflow),
      Queue.getQueueBacklogSize(QueueName.Telemetry),
      Queue.getQueueBacklogSize(QueueName.Runbook),
    ]);
    return workerSize + workflowSize + telemetrySize + runbookSize;
  }
}
