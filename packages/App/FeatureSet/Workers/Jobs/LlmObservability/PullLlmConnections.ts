import RunCron from "../../Utils/Cron";
import JobDictionary from "../../Utils/JobDictionary";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";
import LlmConnectionPullRunner, {
  LlmConnectionPullOutcome,
} from "Common/Server/Utils/LlmObservability/LlmConnectionPullRunner";
import LlmConnectionScheduler, {
  LLM_CONNECTION_PULL_JOB,
  LLM_CONNECTION_PULL_JOB_TIMEOUT_MS,
} from "Common/Server/Utils/LlmObservability/LlmConnectionScheduler";
import OtelTracesIngestService from "../../../Telemetry/Services/OtelTracesIngestService";
import { ExpressRequest } from "Common/Server/Utils/Express";

/*
 * AI / LLM connections: every minute, queue a read of each connection that
 * is due; each read runs as a job of its own (LlmConnectionPullRunner).
 *
 * A company AI tool's chats are kept through the same trace ingest as an
 * app's spans: the read hands the OTLP/JSON it built to
 * OtelTracesIngestService, so drop filters, scrub rules, trace pipelines,
 * answer checks and retention apply to them exactly as to any AI call.
 */

export async function importLlmChatSpans(data: {
  projectId: ObjectID;
  payload: JSONObject;
}): Promise<void> {
  /*
   * The ingest reads the body and the project off a request; nothing else
   * of it. The processing awaits every write before it returns.
   */
  const request: { body: JSONObject; projectId: ObjectID } = {
    body: data.payload,
    projectId: data.projectId,
  };

  await OtelTracesIngestService.processTracesFromQueue(
    request as unknown as ExpressRequest,
  );
}

export async function runLlmConnectionPull(job?: QueueJob): Promise<void> {
  const connectionId: unknown = job?.data?.["connectionId"];

  if (typeof connectionId !== "string" || !ObjectID.isValidUUID(connectionId)) {
    throw new BadDataException("A valid AI connection ID is required.");
  }

  const outcome: LlmConnectionPullOutcome = await LlmConnectionPullRunner.run(
    new ObjectID(connectionId),
    { importSpans: importLlmChatSpans },
  );

  // The outcome is on the connection; the log line names no provider data.
  logger.debug(
    `LlmObservability:PullConnection ${connectionId}: ${outcome.status}`,
  );
}

JobDictionary.setJobFunction(LLM_CONNECTION_PULL_JOB, runLlmConnectionPull);
JobDictionary.setTimeoutInMs(
  LLM_CONNECTION_PULL_JOB,
  LLM_CONNECTION_PULL_JOB_TIMEOUT_MS,
);

RunCron(
  "LlmObservability:PullDueConnections",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 2 * 60 * 1000,
  },
  async () => {
    await LlmConnectionScheduler.enqueueDueConnections(new Date());
  },
);
