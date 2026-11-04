import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "Common/Server/Utils/Express";
import {
  CLOUD_STREAM_LOGS_PATH,
  CLOUD_STREAM_METRICS_PATH,
} from "Common/Types/CloudConnection/CloudStream";
import AwsFirehoseIngestService from "../Services/AwsFirehoseIngestService";

/*
 * The Amazon Data Firehose endpoint an AWS connection's streams deliver to:
 * POST /aws-firehose/v1/metrics and /aws-firehose/v1/logs, under /telemetry
 * and /. See AwsFirehoseIngestService for who may send to it and what
 * becomes of what they send.
 *
 * It answers in Firehose's own contract, refusals too, so it takes no
 * ingestion key middleware: the sender is the connection whose stream key
 * Firehose sends. The body is read raw - StartServer leaves these paths to
 * it (isCloudStreamPath), as it does the OTLP routes - so its byte limit is
 * the one that holds, before anything is parsed.
 */

const router: ExpressRouter = Express.getRouter();

for (const path of [CLOUD_STREAM_METRICS_PATH, CLOUD_STREAM_LOGS_PATH]) {
  router.post(
    path,
    async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
      return AwsFirehoseIngestService.ingest(req, res);
    },
  );
}

export default router;
