import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "Common/Server/Utils/Express";
import { CLOUD_STREAM_PUBSUB_LOGS_PATH } from "Common/Types/CloudConnection/CloudStream";
import GcpPubSubIngestService from "../Services/GcpPubSubIngestService";

/*
 * The Pub/Sub push endpoint a Google Cloud connection's log sinks deliver
 * to: POST /gcp-pubsub/v1/logs, under /telemetry and /. See
 * GcpPubSubIngestService for who may send to it and what becomes of what
 * they send.
 *
 * It answers as Pub/Sub reads an answer, refusals too, so it takes no
 * ingestion key middleware: the sender is the connection whose stream key
 * the push's OIDC token names. The body is read raw - StartServer leaves
 * this path to it (isCloudStreamPath) - so its byte limit is the one that
 * holds, before anything is parsed.
 */

const router: ExpressRouter = Express.getRouter();

router.post(
  CLOUD_STREAM_PUBSUB_LOGS_PATH,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    return GcpPubSubIngestService.ingest(req, res);
  },
);

export default router;
