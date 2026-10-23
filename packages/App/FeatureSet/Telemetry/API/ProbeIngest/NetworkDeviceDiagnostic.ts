import ProbeAuthorization from "../../Middleware/ProbeAuthorization";
import { ProbeExpressRequest } from "../../Types/Request";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiagnostic from "Common/Models/DatabaseModels/NetworkDeviceDiagnostic";
import NetworkDeviceDiagnosticService from "Common/Server/Services/NetworkDeviceDiagnosticService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import NetworkDeviceHydrationUtil, {
  ResolvedDeviceSnmpCredentials,
  ResolvedSnmpCredentialsForBatch,
} from "Common/Server/Utils/Monitor/NetworkDeviceHydrationUtil";
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
import {
  NetworkDeviceDiagnosticSnmpWalkResult,
  NetworkDeviceSnmpWalkRequest,
  SNMP_WALK_CREDENTIALS_UNREADABLE_MESSAGE,
  SNMP_WALK_MAX_OIDS,
  SNMP_WALK_MAX_REPETITIONS,
  SNMP_WALK_NO_CREDENTIALS_MESSAGE,
  SNMP_WALK_PAUSE_BETWEEN_REQUESTS_IN_MS,
  SNMP_WALK_PROBE_UPGRADE_MESSAGE,
  SNMP_WALK_REQUEST_TIMEOUT_IN_MS,
  SNMP_WALK_TIME_BUDGET_IN_MS,
} from "Common/Types/NetworkDevice/NetworkDeviceSnmpWalk";
import ObjectID from "Common/Types/ObjectID";
import ProbeCapability, {
  ProbeCapabilityUtil,
} from "Common/Types/Probe/ProbeCapability";
import SnmpWalkResultUtil, {
  SnmpWalkStart,
} from "Common/Utils/NetworkDevice/SnmpWalkResultUtil";

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
 * them without a probe release. A walk's credentials and bounds are added
 * by buildSnmpWalkJob.
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
        : data.diagnosticType === NetworkDeviceDiagnosticType.SnmpWalk
          ? SNMP_WALK_TIME_BUDGET_IN_MS
          : NETWORK_DEVICE_DIAGNOSTIC_PING_TIMEOUT_IN_MS,
  };

  if (data.diagnosticType === NetworkDeviceDiagnosticType.Traceroute) {
    job.maxHops = NETWORK_DEVICE_DIAGNOSTIC_TRACEROUTE_MAX_HOPS;
  } else if (data.diagnosticType === NetworkDeviceDiagnosticType.Ping) {
    job.packetCount = NETWORK_DEVICE_DIAGNOSTIC_PING_PACKET_COUNT;
  }

  return job;
}

/*
 * A claimed diagnostic that passed the checks every type gets, waiting for
 * its job to be built. Walks wait for their devices' credentials, which are
 * read for the whole batch at once.
 */
interface ClaimedDiagnostic {
  row: NetworkDeviceDiagnostic;
  id: ObjectID;
  projectId: ObjectID;
  networkDeviceId: ObjectID;
  diagnosticType: NetworkDeviceDiagnosticType;
  hostname: string;
}

/*
 * The SNMP credentials of the devices a batch's walks are for, resolved
 * the way a poll of each device resolves them (its own, its credential
 * profile's, its site's). Null when the devices could not be read: every
 * walk of the batch is then settled with a reason, and the rest of the
 * batch still reaches the probe.
 */
async function resolveWalkCredentials(
  walks: Array<ClaimedDiagnostic>,
): Promise<{
  devicesById: Map<string, NetworkDevice>;
  credentials: ResolvedSnmpCredentialsForBatch;
} | null> {
  const deviceIds: Array<string> = Array.from(
    new Set(
      walks.map((walk: ClaimedDiagnostic): string => {
        return walk.networkDeviceId.toString();
      }),
    ),
  );

  try {
    const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
      query: {
        _id: QueryHelper.any(deviceIds),
      },
      select: NetworkDeviceHydrationUtil.snmpConfigSelect,
      limit: deviceIds.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const devicesById: Map<string, NetworkDevice> = new Map();

    for (const device of devices) {
      if (device.id) {
        devicesById.set(device.id.toString(), device);
      }
    }

    return {
      devicesById: devicesById,
      credentials:
        await NetworkDeviceHydrationUtil.resolveSnmpCredentials(devices),
    };
  } catch (err) {
    logger.error(
      `Could not read the SNMP credentials of ${deviceIds.length} device(s) for their SNMP walks.`,
    );
    logger.error(err);
    return null;
  }
}

/*
 * A walk's job: the common fields, the device's credentials hydrated into
 * the config a poll of it is walked with, and where to walk with the
 * bounds to keep. Answers the reason instead when the walk cannot be run.
 */
function buildSnmpWalkJob(data: {
  walk: ClaimedDiagnostic;
  device: NetworkDevice | undefined;
  credentials: ResolvedSnmpCredentialsForBatch;
}): NetworkDeviceDiagnosticJob | { reason: string } {
  const deviceId: string = data.walk.networkDeviceId.toString();

  /*
   * The device is read as root, so its project is checked against the
   * row's rather than trusted: another project's credentials must never be
   * put on this probe's wire.
   */
  if (
    !data.device ||
    data.device.projectId?.toString() !== data.walk.projectId.toString()
  ) {
    return { reason: "This device no longer exists." };
  }

  if (data.credentials.unresolvedDeviceIds.has(deviceId)) {
    return { reason: SNMP_WALK_CREDENTIALS_UNREADABLE_MESSAGE };
  }

  const resolved: ResolvedDeviceSnmpCredentials | undefined =
    data.credentials.byDeviceId.get(deviceId);

  if (!resolved || resolved.pollMode !== "snmp") {
    return { reason: SNMP_WALK_NO_CREDENTIALS_MESSAGE };
  }

  let start: SnmpWalkStart;

  try {
    start = SnmpWalkResultUtil.resolveStart({
      rootOid: data.walk.row.snmpWalkRootOid,
      afterOid: data.walk.row.snmpWalkAfterOid,
    });
  } catch (err) {
    return { reason: (err as Error).message };
  }

  const snmpWalk: NetworkDeviceSnmpWalkRequest = {
    rootOid: start.rootOid,
    maxOids: SNMP_WALK_MAX_OIDS,
    timeBudgetInMs: SNMP_WALK_TIME_BUDGET_IN_MS,
    requestTimeoutInMs: SNMP_WALK_REQUEST_TIMEOUT_IN_MS,
    maxRepetitions: SNMP_WALK_MAX_REPETITIONS,
    pauseBetweenRequestsInMs: SNMP_WALK_PAUSE_BETWEEN_REQUESTS_IN_MS,
  };

  if (start.afterOid) {
    snmpWalk.afterOid = start.afterOid;
  }

  const job: NetworkDeviceDiagnosticJob = buildDiagnosticJob(data.walk);

  job.snmpMonitor = {
    ...NetworkDeviceHydrationUtil.buildSnmpMonitorConfig({
      // The address the walk was asked against, as for a ping.
      hostname: data.walk.hostname,
      credentials: resolved.carrier,
      oids: [],
      monitorInterfaces: false,
    }),
    timeout: SNMP_WALK_REQUEST_TIMEOUT_IN_MS,
  };
  job.snmpWalk = snmpWalk;

  return job;
}

/*
 * Hands the requesting probe its Pending on-demand diagnostics (ping /
 * traceroute requests made from the topology map or the device page, and
 * SNMP walks from the device's SNMP Walk page) as
 * `{ diagnostics: Array<NetworkDeviceDiagnosticJob> }`.
 *
 * Claiming is atomic (FOR UPDATE SKIP LOCKED, see
 * NetworkDeviceDiagnosticService.claimPendingForProbe) so replicas of the
 * same probe never run the same diagnostic twice, and marks the rows
 * In Progress. A claimed row the probe could not run — no hostname, or a
 * type this server does not know — is settled as Failed here rather than
 * handed out, because the probe would only fail it anyway and the operator
 * is waiting on the answer now.
 *
 * Capability gate: a walk goes, with the device's credentials, only to a
 * probe that declares `snmpWalk`. An older probe would fail it as a type it
 * does not know - after having been handed the credentials - so its walks
 * are settled here instead, saying to update the probe.
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
            snmpWalkRootOid: true,
            snmpWalkAfterOid: true,
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

      const probeCanWalk: boolean = ProbeCapabilityUtil.has(
        ProbeCapabilityUtil.parse(req.body["probeCapabilities"]),
        ProbeCapability.SnmpWalk,
      );

      const claimed: Array<ClaimedDiagnostic> = [];

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

        if (
          diagnosticType === NetworkDeviceDiagnosticType.SnmpWalk &&
          !probeCanWalk
        ) {
          await failClaimedDiagnostic({
            probeId: probeId,
            diagnosticId: row.id,
            reason: SNMP_WALK_PROBE_UPGRADE_MESSAGE,
          });
          continue;
        }

        claimed.push({
          row: row,
          id: row.id,
          projectId: row.projectId,
          networkDeviceId: row.networkDeviceId,
          diagnosticType: diagnosticType,
          hostname: hostname,
        });
      }

      const walks: Array<ClaimedDiagnostic> = claimed.filter(
        (entry: ClaimedDiagnostic): boolean => {
          return entry.diagnosticType === NetworkDeviceDiagnosticType.SnmpWalk;
        },
      );

      const walkCredentials: {
        devicesById: Map<string, NetworkDevice>;
        credentials: ResolvedSnmpCredentialsForBatch;
      } | null = walks.length > 0 ? await resolveWalkCredentials(walks) : null;

      const jobs: Array<NetworkDeviceDiagnosticJob> = [];

      // In claim order, oldest first, walks included.
      for (const entry of claimed) {
        if (entry.diagnosticType !== NetworkDeviceDiagnosticType.SnmpWalk) {
          jobs.push(buildDiagnosticJob(entry));
          continue;
        }

        const walkJob: NetworkDeviceDiagnosticJob | { reason: string } =
          walkCredentials
            ? buildSnmpWalkJob({
                walk: entry,
                device: walkCredentials.devicesById.get(
                  entry.networkDeviceId.toString(),
                ),
                credentials: walkCredentials.credentials,
              })
            : { reason: SNMP_WALK_CREDENTIALS_UNREADABLE_MESSAGE };

        if ("reason" in walkJob) {
          await failClaimedDiagnostic({
            probeId: probeId,
            diagnosticId: entry.id,
            reason: walkJob.reason,
          });
          continue;
        }

        jobs.push(walkJob);
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

      /*
       * A walk's result is checked and trimmed rather than stored as sent:
       * it is the one result a probe fills with what a device said, up to a
       * thousand OIDs of it (SnmpWalkResultUtil.sanitize).
       */
      const rawSnmpWalkResult: unknown = body["snmpWalkResult"];

      if (
        rawSnmpWalkResult !== undefined &&
        rawSnmpWalkResult !== null &&
        !isJsonObject(rawSnmpWalkResult)
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("snmpWalkResult must be an object"),
        );
      }

      const snmpWalkResult: NetworkDeviceDiagnosticSnmpWalkResult | null =
        SnmpWalkResultUtil.sanitize(rawSnmpWalkResult);

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
        snmpWalkResult: snmpWalkResult || undefined,
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
