import ProbeAuthorization from "../../Middleware/ProbeAuthorization";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import NetworkFlowService from "Common/Server/Services/NetworkFlowService";
import NetworkFlowDeviceMatcher, {
  FlowProbe,
} from "Common/Server/Utils/NetworkFlow/NetworkFlowDeviceMatcher";
import NetworkFlowIngest, {
  FlowIngestResult,
} from "Common/Server/Utils/NetworkFlow/NetworkFlowIngest";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import logger from "Common/Server/Utils/Logger";

const router: ExpressRouter = Express.getRouter();

// One POST never carries more than this; a probe sends at most 1,500.
const MAX_RECORDS_PER_REQUEST: number = 10000;

router.post(
  "/probe/network-flow",
  TelemetryIngestionDisabled.middleware,
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const rawRecords: unknown = req.body["flowRecords"];

      if (!Array.isArray(rawRecords) || rawRecords.length === 0) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("flowRecords not found in request body"),
        );
      }

      if (rawRecords.length > MAX_RECORDS_PER_REQUEST) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            `A request carries at most ${MAX_RECORDS_PER_REQUEST} flow records`,
          ),
        );
      }

      const probeIdAsString: string | undefined = req.body["probeId"] as
        | string
        | undefined;

      if (!probeIdAsString) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe ID not found on network flow request"),
        );
      }

      // Return response immediately - matching and inserts happen after.
      Response.sendJsonObjectResponse(req, res, {
        result: "processing",
      });

      try {
        await processFlowRecords(
          new ObjectID(probeIdAsString),
          rawRecords as Array<unknown>,
        );
      } catch (err) {
        // The response is already sent - log instead of next(err).
        logger.error("Probe network flow ingest: error processing batch:");
        logger.error(err);
      }

      return;
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * Matches each flow's exporter to the devices it is
 * (NetworkFlowDeviceMatcher: this probe's devices by hostname, Other
 * Addresses or DNS; then, on a project's own probe, the project's devices)
 * and writes the flows into the ClickHouse NetworkFlow table. A flow whose
 * exporter is nobody's yet is kept for the project of the probe that
 * received it - unless that is a global probe, which has no project.
 */
async function processFlowRecords(
  probeId: ObjectID,
  rawRecords: Array<unknown>,
): Promise<void> {
  const probe: FlowProbe | null =
    await NetworkFlowDeviceMatcher.getProbe(probeId);

  if (!probe) {
    logger.debug(
      `Probe network flow ingest: probe ${probeId.toString()} not found; ${rawRecords.length} flow(s) dropped.`,
    );
    return;
  }

  const result: FlowIngestResult = await NetworkFlowIngest.buildRows({
    probe: probe,
    rawRecords: rawRecords,
    ingestedAt: OneUptimeDate.getCurrentDate(),
  });

  if (result.rows.length > 0) {
    await NetworkFlowService.insertJsonRows(result.rows);
  }

  logger.debug(
    `Probe network flow ingest: wrote ${result.rows.length} flow row(s) for probe ${probeId.toString()} (${result.unmatchedKept} from exporters that are no device yet, ${result.droppedUnmatched} dropped from unmatched exporters, ${result.malformed} malformed).`,
  );
}

export default router;
