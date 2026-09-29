import ProbeAuthorization from "../../Middleware/ProbeAuthorization";
import { ProbeExpressRequest } from "../../Types/Request";
import NetworkDeviceDiagnostic from "Common/Models/DatabaseModels/NetworkDeviceDiagnostic";
import NetworkDeviceDiagnosticService from "Common/Server/Services/NetworkDeviceDiagnosticService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Express, {
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import NetworkPathTrace from "Common/Types/Monitor/NetworkMonitor/NetworkPathTrace";
import {
  NETWORK_DEVICE_DIAGNOSTIC_CLAIM_LIMIT,
  NETWORK_DEVICE_DIAGNOSTIC_PING_PACKET_COUNT,
  NETWORK_DEVICE_DIAGNOSTIC_PING_TIMEOUT_IN_MS,
  NETWORK_DEVICE_DIAGNOSTIC_TRACEROUTE_MAX_HOPS,
  NETWORK_DEVICE_DIAGNOSTIC_TRACEROUTE_TIMEOUT_IN_MS,
  NetworkDeviceDiagnosticJob,
  NetworkDeviceDiagnosticPingResult,
  NetworkDeviceDiagnosticReport,
} from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticResult";
import {
  NetworkDeviceDiagnosticStatus,
  isNetworkDeviceDiagnosticSettled,
} from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticStatus";
import NetworkDeviceDiagnosticType, {
  NetworkDeviceDiagnosticTypeUtil,
} from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticType";
import ObjectID from "Common/Types/ObjectID";

const router: ExpressRouter = Express.getRouter();

/*
 * How many diagnostics one list request may hand out. The probe asks for
 * NETWORK_DEVICE_DIAGNOSTIC_CLAIM_LIMIT; a larger request is capped rather
 * than refused, because the cap exists to bound a burst, not to police the
 * probe — a probe asking for more should still get its work. A missing or
 * nonsensical limit gets the default for the same reason.
 */
function resolveClaimLimit(requested: unknown): number {
  if (
    typeof requested !== "number" ||
    !Number.isFinite(requested) ||
    requested < 1
  ) {
    return NETWORK_DEVICE_DIAGNOSTIC_CLAIM_LIMIT;
  }

  return Math.min(Math.floor(requested), NETWORK_DEVICE_DIAGNOSTIC_CLAIM_LIMIT);
}

/*
 * A result the probe posts must be a JSON object: it is stored as jsonb and
 * read back by the dashboard as a NetworkDeviceDiagnosticPingResult or a
 * NetworkPathTrace. An array or a scalar would store fine and then break
 * the renderer, so it is refused here where the probe gets a 400 it can log.
 */
function isJsonObject(value: unknown): value is JSONObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/*
 * Settle a claimed row the probe can never run. Claiming already moved it
 * to In Progress, so leaving it there would show the operator a spinner
 * until the dashboard's two-minute timeout; a Failed row with a reason
 * renders at the next poll.
 *
 * A failure to record is logged, never thrown: the rest of the batch was
 * claimed in the same transaction and must still reach the probe, or every
 * diagnostic in it would sit In Progress until retention removes it.
 */
async function failClaimedDiagnostic(data: {
  probeId: ObjectID;
  diagnosticId: ObjectID;
  reason: string;
}): Promise<void> {
  logger.warn(
    `Network device diagnostic ${data.diagnosticId.toString()} claimed by probe ${data.probeId.toString()} was not handed out: ${data.reason}`,
  );

  try {
    await NetworkDeviceDiagnosticService.recordReport({
      probeId: data.probeId,
      report: {
        networkDeviceDiagnosticId: data.diagnosticId.toString(),
        status: NetworkDeviceDiagnosticStatus.Failed,
        statusMessage: data.reason,
      },
    });
  } catch (err) {
    logger.error(
      `Could not mark network device diagnostic ${data.diagnosticId.toString()} as Failed (${data.reason}); it stays In Progress until retention removes it.`,
    );
    logger.error(err);
  }
}

/*
 * Everything the probe needs to run one diagnostic, in one payload. The
 * timeouts and counts travel with the job rather than living on the probe
 * so a probe never has to guess a default, and so the server can change
 * them without a probe release.
 */
function buildDiagnosticJob(data: {
  diagnosticType: NetworkDeviceDiagnosticType;
  hostname: string;
  id: ObjectID;
  projectId: ObjectID;
  networkDeviceId: ObjectID;
}): NetworkDeviceDiagnosticJob {
  const job: NetworkDeviceDiagnosticJob = {
    id: data.id.toString(),
    projectId: data.projectId.toString(),
    networkDeviceId: data.networkDeviceId.toString(),
    diagnosticType: data.diagnosticType,
    hostname: data.hostname,
    timeoutInMs:
      data.diagnosticType === NetworkDeviceDiagnosticType.Traceroute
        ? NETWORK_DEVICE_DIAGNOSTIC_TRACEROUTE_TIMEOUT_IN_MS
        : NETWORK_DEVICE_DIAGNOSTIC_PING_TIMEOUT_IN_MS,
  };

  if (data.diagnosticType === NetworkDeviceDiagnosticType.Traceroute) {
    job.maxHops = NETWORK_DEVICE_DIAGNOSTIC_TRACEROUTE_MAX_HOPS;
  } else {
    job.packetCount = NETWORK_DEVICE_DIAGNOSTIC_PING_PACKET_COUNT;
  }

  return job;
}

/*
 * Hands the requesting probe its Pending on-demand diagnostics (ping /
 * traceroute requests made from the topology map or the device page) as
 * `{ diagnostics: Array<NetworkDeviceDiagnosticJob> }`.
 *
 * Claiming is atomic (FOR UPDATE SKIP LOCKED, see
 * NetworkDeviceDiagnosticService.claimPendingForProbe) so replicas of the
 * same probe never run the same diagnostic twice, and marks the rows
 * In Progress. A claimed row the probe could not run — no hostname, or a
 * type this server does not know — is settled as Failed here rather than
 * handed out, because the probe would only fail it anyway and the operator
 * is waiting on the answer now.
 */
router.post(
  "/probe/network-device-diagnostic/list",
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ProbeExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const probeId: ObjectID | undefined =
        (req as ProbeExpressRequest).probe?.id || undefined;

      if (!probeId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      const limit: number = resolveClaimLimit(req.body["limit"]);

      const claimedIds: Array<ObjectID> =
        await NetworkDeviceDiagnosticService.claimPendingForProbe({
          probeId: probeId,
          limit: limit,
        });

      if (claimedIds.length === 0) {
        return Response.sendJsonObjectResponse(req, res, { diagnostics: [] });
      }

      const rows: Array<NetworkDeviceDiagnostic> =
        await NetworkDeviceDiagnosticService.findBy({
          query: {
            _id: QueryHelper.any(
              claimedIds.map((id: ObjectID) => {
                return id.toString();
              }),
            ),
          },
          select: {
            _id: true,
            projectId: true,
            networkDeviceId: true,
            diagnosticType: true,
            hostname: true,
          },
          props: {
            isRoot: true,
          },
          limit: limit,
          skip: 0,
          sort: {
            createdAt: SortOrder.Ascending,
          },
        });

      const jobs: Array<NetworkDeviceDiagnosticJob> = [];

      for (const row of rows) {
        // `_id` is selected, so this only guards the type.
        if (!row.id) {
          continue;
        }

        /*
         * Both are NOT NULL columns, so this is unreachable with a healthy
         * database; it exists so a corrupt row fails visibly instead of
         * being handed to the probe with an empty project or device.
         */
        if (!row.projectId || !row.networkDeviceId) {
          await failClaimedDiagnostic({
            probeId: probeId,
            diagnosticId: row.id,
            reason:
              "This diagnostic is missing its project or device and cannot be run.",
          });
          continue;
        }

        const hostname: string = (row.hostname || "").trim();

        if (!hostname) {
          await failClaimedDiagnostic({
            probeId: probeId,
            diagnosticId: row.id,
            reason: "This device has no hostname or IP address to reach.",
          });
          continue;
        }

        const diagnosticType: NetworkDeviceDiagnosticType | undefined =
          NetworkDeviceDiagnosticTypeUtil.parse(row.diagnosticType);

        if (!diagnosticType) {
          await failClaimedDiagnostic({
            probeId: probeId,
            diagnosticId: row.id,
            reason: `Unsupported diagnostic type "${String(row.diagnosticType)}". Expected one of: ${NetworkDeviceDiagnosticTypeUtil.getAllTypes().join(", ")}.`,
          });
          continue;
        }

        jobs.push(
          buildDiagnosticJob({
            diagnosticType: diagnosticType,
            hostname: hostname,
            id: row.id,
            projectId: row.projectId,
            networkDeviceId: row.networkDeviceId,
          }),
        );
      }

      logger.debug(
        `Probe ${probeId.toString()} claimed ${jobs.length} network device diagnostic(s).`,
      );

      return Response.sendJsonObjectResponse(req, res, {
        diagnostics: jobs as unknown as JSONArray,
      });
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * Receives the probe's result for one diagnostic and stores it on the row.
 *
 * The probe id is stamped from the AUTHENTICATED request and never read
 * from the body, and the service's UPDATE is keyed on it, so a probe can
 * only ever settle diagnostics that were handed to it. A report the
 * service does not apply — unknown id, another probe's row, or a row that
 * is already Completed — is answered with a 400 rather than a silent 200,
 * so a misdirected probe sees it in its own logs.
 */
router.post(
  "/probe/network-device-diagnostic/response/ingest",
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ProbeExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const probeId: ObjectID | undefined =
        (req as ProbeExpressRequest).probe?.id || undefined;

      if (!probeId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      const body: JSONObject = req.body;

      const networkDeviceDiagnosticId: unknown =
        body["networkDeviceDiagnosticId"];

      if (
        typeof networkDeviceDiagnosticId !== "string" ||
        !networkDeviceDiagnosticId.trim()
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("networkDeviceDiagnosticId not found"),
        );
      }

      /*
       * The id reaches Postgres as a uuid parameter; anything else would
       * surface as a driver error and a 500 instead of telling the probe
       * what it sent.
       */
      if (!ObjectID.isValidUUID(networkDeviceDiagnosticId)) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("networkDeviceDiagnosticId is not a valid id"),
        );
      }

      const status: unknown = body["status"];

      if (
        !isNetworkDeviceDiagnosticSettled(
          typeof status === "string" ? status : undefined,
        )
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            `status must be "${NetworkDeviceDiagnosticStatus.Completed}" or "${NetworkDeviceDiagnosticStatus.Failed}"`,
          ),
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

      /*
       * `null` reads as absent, like undefined: JSON has no undefined, and
       * a probe that serializes an empty result slot as null means "no
       * result", which is exactly what the service stores for a missing one.
       */
      const pingResult: unknown = body["pingResult"];

      if (
        pingResult !== undefined &&
        pingResult !== null &&
        !isJsonObject(pingResult)
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("pingResult must be an object"),
        );
      }

      const traceRouteResult: unknown = body["traceRouteResult"];

      if (
        traceRouteResult !== undefined &&
        traceRouteResult !== null &&
        !isJsonObject(traceRouteResult)
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("traceRouteResult must be an object"),
        );
      }

      const report: NetworkDeviceDiagnosticReport = {
        networkDeviceDiagnosticId: networkDeviceDiagnosticId,
        status: status as string,
        statusMessage:
          typeof statusMessage === "string" ? statusMessage : undefined,
        pingResult: isJsonObject(pingResult)
          ? (pingResult as unknown as NetworkDeviceDiagnosticPingResult)
          : undefined,
        traceRouteResult: isJsonObject(traceRouteResult)
          ? (traceRouteResult as unknown as NetworkPathTrace)
          : undefined,
      };

      const recorded: boolean =
        await NetworkDeviceDiagnosticService.recordReport({
          probeId: probeId,
          report: report,
        });

      if (!recorded) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Diagnostic not found for this probe"),
        );
      }

      return Response.sendJsonObjectResponse(req, res, { result: "ok" });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
