import ProbeAuthorization from "../../Middleware/ProbeAuthorization";
import { ProbeExpressRequest } from "../../Types/Request";
import PacketCaptureService from "Common/Server/Services/PacketCaptureService";
import Express, {
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import PcapFile from "Common/Server/Utils/PacketCapture/PcapFile";
import Response from "Common/Server/Utils/Response";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PacketCaptureCapabilityUtil, {
  PacketCaptureCapability,
} from "Common/Types/PacketCapture/PacketCaptureCapability";
import PacketCaptureEndReason, {
  PacketCaptureEndReasonUtil,
} from "Common/Types/PacketCapture/PacketCaptureEndReason";
import PacketCaptureFilterUtil from "Common/Types/PacketCapture/PacketCaptureFilter";
import {
  MAX_RUNNING_PACKET_CAPTURE_IDS_PER_REQUEST,
  PACKET_CAPTURE_PROBE_CONCURRENCY,
  PacketCaptureJob,
} from "Common/Types/PacketCapture/PacketCaptureJob";
import { PACKET_CAPTURE_MAX_UPLOAD_BASE64_LENGTH } from "Common/Types/PacketCapture/PacketCaptureLimits";
import PacketCaptureStatus from "Common/Types/PacketCapture/PacketCaptureStatus";

/*
 * The probe's side of packet capture (see Types/PacketCapture/
 * PacketCaptureJob for the conversation):
 *
 *   POST /probe/packet-capture/capability       what the probe can capture on
 *   POST /probe/packet-capture/list             new captures to run, and which
 *                                               running ones to stop
 *   POST /probe/packet-capture/response/ingest  a finished capture's file, or
 *                                               why it failed
 *
 * Every route takes the probe from the AUTHENTICATED request, never from
 * the body, and every write the service makes is keyed on it: a probe only
 * ever claims, hears about and settles its own captures.
 */

const router: ExpressRouter = Express.getRouter();

// Said to a global probe that reports: it never captures, whatever it says.
export const GLOBAL_PROBE_REPORT_MESSAGE: string =
  "Packet capture runs only on a project's own probes. This is a global probe, so its captures stay off.";

function readBody(req: ProbeExpressRequest): JSONObject {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? (req.body as JSONObject)
    : {};
}

/*
 * How many captures one list request may hand out: the slots the probe says
 * it has free, never more than a probe runs at once. A missing or nonsensical
 * value means none - a probe that cannot say it has room is not handed work.
 */
export function resolveClaimLimit(requested: unknown): number {
  if (typeof requested !== "number" || !Number.isFinite(requested)) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(Math.floor(requested), PACKET_CAPTURE_PROBE_CONCURRENCY),
  );
}

// The running captures a probe named: strings only, a bounded number.
export function readRunningIds(value: unknown): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((id: unknown): id is string => {
      return typeof id === "string" && id.trim().length > 0;
    })
    .slice(0, MAX_RUNNING_PACKET_CAPTURE_IDS_PER_REQUEST);
}

/*
 * A claimed capture the probe could never run - an interface name the
 * capture tool could take as an option, a filter that is not one - is failed
 * here rather than handed out. Only a row written past the create checks
 * gets here; it is failed with the reason so it does not wait for the sweep.
 */
function findUnrunnableReason(job: PacketCaptureJob): string | null {
  if (!PacketCaptureCapabilityUtil.isInterfaceName(job.interfaceName)) {
    return "This capture names an interface the probe cannot capture on.";
  }

  const filterError: string | null = PacketCaptureFilterUtil.validate(
    job.bpfFilter,
  );

  if (filterError) {
    return filterError;
  }

  return null;
}

function getProbeId(req: ProbeExpressRequest): ObjectID | null {
  return req.probe?.id || null;
}

router.post(
  "/probe/packet-capture/capability",
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ProbeExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const probeId: ObjectID | null = getProbeId(req);

      if (!probeId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      const capability: PacketCaptureCapability | null =
        PacketCaptureCapabilityUtil.sanitize(
          readBody(req)["packetCaptureCapability"],
        );

      if (!capability) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "packetCaptureCapability must be an object with isEnabled true or false",
          ),
        );
      }

      const isKept: boolean = await PacketCaptureService.recordProbeCapability({
        probeId: probeId,
        capability: capability,
      });

      if (!isKept) {
        return Response.sendJsonObjectResponse(req, res, {
          isPacketCaptureAvailable: false,
          message: GLOBAL_PROBE_REPORT_MESSAGE,
        });
      }

      return Response.sendJsonObjectResponse(req, res, {
        isPacketCaptureAvailable:
          PacketCaptureCapabilityUtil.canCapture(capability),
      });
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/probe/packet-capture/list",
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ProbeExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const probeId: ObjectID | null = getProbeId(req);

      if (!probeId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      const body: JSONObject = readBody(req);
      const runningIds: Array<string> = readRunningIds(
        body["runningPacketCaptureIds"],
      );

      /*
       * Stops first, then claims: a slot freed by a stop is the probe's to
       * report on its next request, not this one.
       */
      const stopIds: Array<string> =
        runningIds.length > 0
          ? await PacketCaptureService.findCapturesToStop({
              probeId: probeId,
              runningPacketCaptureIds: runningIds,
            })
          : [];

      const limit: number = resolveClaimLimit(body["limit"]);

      const claimed: Array<PacketCaptureJob> =
        limit > 0
          ? await PacketCaptureService.claimPendingForProbe({
              probeId: probeId,
              limit: limit,
            })
          : [];

      const jobs: Array<PacketCaptureJob> = [];

      for (const job of claimed) {
        const reason: string | null = findUnrunnableReason(job);

        if (!reason) {
          jobs.push(job);
          continue;
        }

        logger.warn(
          `Packet capture ${job.id} claimed by probe ${probeId.toString()} was not handed out: ${reason}`,
        );

        try {
          await PacketCaptureService.recordFailure({
            probeId: probeId,
            packetCaptureId: new ObjectID(job.id),
            statusMessage: reason,
          });
        } catch (err) {
          logger.error(
            `Could not fail packet capture ${job.id}; the stale-capture sweep will.`,
          );
          logger.error(err);
        }
      }

      return Response.sendJsonObjectResponse(req, res, {
        packetCaptures: jobs as unknown as JSONArray,
        stopPacketCaptureIds: stopIds,
      });
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/probe/packet-capture/response/ingest",
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ProbeExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const probeId: ObjectID | null = getProbeId(req);

      if (!probeId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      const body: JSONObject = readBody(req);
      const packetCaptureId: unknown = body["packetCaptureId"];

      if (
        typeof packetCaptureId !== "string" ||
        !ObjectID.isValidUUID(packetCaptureId.trim())
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("packetCaptureId is not a valid id"),
        );
      }

      const statusMessage: unknown = body["statusMessage"];

      if (
        statusMessage !== undefined &&
        statusMessage !== null &&
        typeof statusMessage !== "string"
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("statusMessage must be a string"),
        );
      }

      const status: unknown = body["status"];
      const captureId: ObjectID = new ObjectID(packetCaptureId.trim());
      let isRecorded: boolean = false;

      if (status === PacketCaptureStatus.Failed) {
        isRecorded = await PacketCaptureService.recordFailure({
          probeId: probeId,
          packetCaptureId: captureId,
          statusMessage: typeof statusMessage === "string" ? statusMessage : "",
        });
      } else if (status === PacketCaptureStatus.Completed) {
        const pcapBase64: unknown = body["pcapBase64"];
        let pcap: Buffer | null = null;

        if (pcapBase64 !== undefined && pcapBase64 !== null) {
          if (
            typeof pcapBase64 !== "string" ||
            pcapBase64.length > PACKET_CAPTURE_MAX_UPLOAD_BASE64_LENGTH
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "pcapBase64 must be the capture file as base64, within the capture's size limit",
              ),
            );
          }

          if (pcapBase64.length > 0) {
            pcap = PcapFile.decodeBase64(pcapBase64);

            if (!pcap) {
              return Response.sendErrorResponse(
                req,
                res,
                new BadDataException("pcapBase64 is not base64"),
              );
            }
          }
        }

        const endReason: PacketCaptureEndReason | undefined =
          PacketCaptureEndReasonUtil.parse(body["endReason"]);

        isRecorded = await PacketCaptureService.recordCompletion({
          probeId: probeId,
          packetCaptureId: captureId,
          pcap: pcap,
          endReason: endReason,
          statusMessage:
            typeof statusMessage === "string" ? statusMessage : undefined,
        });
      } else {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            `status must be "${PacketCaptureStatus.Completed}" or "${PacketCaptureStatus.Failed}"`,
          ),
        );
      }

      if (!isRecorded) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "No running packet capture with this id for this probe. It may have been stopped, deleted or timed out.",
          ),
        );
      }

      return Response.sendJsonObjectResponse(req, res, { result: "ok" });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
