import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import ObjectID from "Common/Types/ObjectID";

export default class QueueRunbook {
  public static async addExecutionToQueue(data: {
    runbookExecutionId: ObjectID;
  }): Promise<void> {
    await Queue.getQueue(QueueName.Runbook).add(
      "RunbookExecution",
      {
        runbookExecutionId: data.runbookExecutionId.toString(),
      },
      {
        removeOnComplete: { age: 60 * 60 * 24 },
        removeOnFail: { age: 60 * 60 * 24 * 7 },
        attempts: 1,
      },
    );
  }
}
