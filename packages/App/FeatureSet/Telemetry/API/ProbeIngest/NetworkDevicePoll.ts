import ProbeAuthorization from "../../Middleware/ProbeAuthorization";
import ProbeSchedulingMiddleware from "../../Middleware/ProbeScheduling";
import { ProbeExpressRequest } from "../../Types/Request";
import TelemetryQueueService from "../../Services/Queue/TelemetryQueueService";
import BadDataException from "Common/Types/Exception/BadDataException";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceOidTemplate from "Common/Models/DatabaseModels/NetworkDeviceOidTemplate";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import NetworkDeviceOidTemplateService from "Common/Server/Services/NetworkDeviceOidTemplateService";
import NetworkDeviceHydrationUtil, {
  NetworkDevicePollMode,
  ResolvedDeviceSnmpCredentials,
  ResolvedSnmpCredentialsForBatch,
} from "Common/Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import SnmpOid from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import { SnmpTableDefinition } from "Common/Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil, {
  EffectiveTableResolution,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import SnmpOidListUtil from "Common/Types/Monitor/SnmpMonitor/SnmpOidListUtil";
import ProbeCapability, {
  ProbeCapabilityUtil,
} from "Common/Types/Probe/ProbeCapability";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import NumberUtil from "Common/Utils/Number";
import logger from "Common/Server/Utils/Logger";

const router: ExpressRouter = Express.getRouter();

/*
 * The most devices one fetch hands to a probe.
 *
 * A probe of this release asks for as many as it has room to poll - up to
 * its PROBE_NETWORK_DEVICE_POLL_CONCURRENCY - and asks again while the
 * batch it is handed is full (Probe's Jobs/NetworkDevice/FetchList, issue
 * #9499), so for it this bounds only the work of one request.
 *
 * A probe from before #9499 sends no limit and fetches once a minute, so
 * for it this is still the CEILING on how fast its fleet can be polled: it
 * can never poll faster than this many devices a minute, however short the
 * devices' intervals are. That ceiling used to be 50, silently. A probe
 * with 980 devices could therefore only get all the way round its fleet
 * every ~20 minutes — long enough that a large share of a perfectly healthy
 * fleet was always outside the freshness window the UI called "up", which
 * is how devices answering SNMP fine came to be listed as Down (issue
 * #3220). Reachability no longer depends on poll recency, so a bound here
 * can no longer manufacture an outage, but it still throttles how current
 * an older probe's data is — so the default is sized for a real fleet and
 * operators can raise it.
 */
const DEVICE_POLL_FETCH_LIMIT: number = NumberUtil.parseNumberWithDefault({
  value: process.env["NETWORK_DEVICE_POLL_FETCH_LIMIT"],
  defaultValue: 250,
  min: 1,
});

/*
 * How many devices this request may be handed: what the probe asked for
 * (the room it has to poll them), never more than DEVICE_POLL_FETCH_LIMIT.
 * A probe from before #9499 asks for nothing, and is handed up to
 * DEVICE_POLL_FETCH_LIMIT, as it always was; so is one whose limit is not a
 * whole number of at least one.
 */
export const getDevicePollRequestLimit: (requested: unknown) => number = (
  requested: unknown,
): number => {
  if (
    typeof requested !== "number" ||
    !Number.isFinite(requested) ||
    requested < 1
  ) {
    return DEVICE_POLL_FETCH_LIMIT;
  }

  return Math.min(Math.floor(requested), DEVICE_POLL_FETCH_LIMIT);
};

/*
 * The capability a probe advertises (in `probeCapabilities` on its list
 * request) when it can ping a device and report the result without an SNMP
 * walk. A probe that does not advertise it predates ping-first polling.
 */
const NETWORK_DEVICE_PING_CAPABILITY: string =
  ProbeCapability.NetworkDevicePing;

/*
 * Hands the requesting probe the polling-enabled devices assigned to it
 * that are due for a poll. Every device is handed out as
 * `{ networkDeviceId, projectId, hostname, pollMode, collectEndpoints,
 * collectTransceivers?, snmpMonitor? }` (collectTransceivers only in snmp
 * mode):
 *
 *   pollMode "snmp" - usable SNMP credentials resolved for the device
 *                     (NetworkDeviceHydrationUtil.resolveSnmpCredentials:
 *                     its own columns, the credential profile it points at,
 *                     or its site's), and `snmpMonitor` carries them
 *                     hydrated into a concrete, probe-executable SNMP
 *                     config. The probe pings AND walks it.
 *   pollMode "ping" - no usable credentials anywhere: `snmpMonitor` is
 *                     omitted and the probe only pings `hostname`.
 *
 * A device whose credential profile could not be READ this cycle is handed
 * out in neither mode. It is configured to be walked, and pretending it is
 * a ping-only device would silently drop its interfaces, inventory and walk
 * health for as long as the lookup keeps failing.
 *
 * Capability gate: only a probe advertising `networkDevicePing` is handed
 * ping-mode devices. An older probe would poll a credential-less device
 * over SNMP with its default "public" community and report it Down, so for
 * such a probe those devices are dropped from the batch (with one warning
 * per batch) and stay Pending until the probe is upgraded.
 *
 * Claiming is one self-committing statement (FOR NO KEY UPDATE SKIP
 * LOCKED, see NetworkDeviceService.claimDevicesForPolling) that advances
 * nextPollAt by the device's own polling interval, so no device stays
 * locked past it and the writes of its last poll's results never wait.
 *
 * How many: the `limit` in the body - the room the probe has to poll them -
 * up to DEVICE_POLL_FETCH_LIMIT (getDevicePollRequestLimit). The answer
 * says `isFullBatch` when the claim filled that limit, so more devices may
 * be due and the probe asks again (issue #9499): judged on what was
 * claimed, not on what is handed out, since a claimed device can be kept
 * back below. A probe from before #9499 sends no limit and reads no
 * isFullBatch; it is handed up to DEVICE_POLL_FETCH_LIMIT once a minute.
 *
 * This is how devices get polled — monitors play no part in it. Network
 * Device monitors are evaluated server-side when the poll results come
 * back (see NetworkDeviceWalkUtil).
 */
router.post(
  "/probe/network-device/list",
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  /*
   * Under the probe scheduling limit; a refused request claims nothing and
   * is answered busy (ProbeSchedulingMiddleware): devices stay due.
   */
  ProbeSchedulingMiddleware.limit(
    (req: ExpressRequest, res: ExpressResponse): void => {
      return Response.sendJsonObjectResponse(req, res, { devices: [] });
    },
  ),
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

      /*
       * Whether this probe asks again while devices are due (#9499): it
       * says how many it has room for. One that does not is from before.
       */
      const asksAgainWhileDue: boolean = typeof req.body["limit"] === "number";
      const limit: number = getDevicePollRequestLimit(req.body["limit"]);

      const claimedDeviceIds: Array<ObjectID> =
        await NetworkDeviceService.claimDevicesForPolling({
          probeId: probeId,
          limit: limit,
        });

      // More may be due: the claim filled the batch.
      const isFullBatch: boolean = claimedDeviceIds.length >= limit;

      if (claimedDeviceIds.length === 0) {
        return Response.sendJsonObjectResponse(req, res, {
          devices: [],
          isFullBatch: false,
        });
      }

      const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
        query: {
          _id: QueryHelper.any(
            claimedDeviceIds.map((deviceId: ObjectID) => {
              return deviceId.toString();
            }),
          ),
        },
        select: {
          ...NetworkDeviceHydrationUtil.snmpConfigSelect,
          walkInterfaces: true,
          collectEndpoints: true,
          snmpOids: true,
          snmpTables: true,
          oidTemplateId: true,
        },
        limit: DEVICE_POLL_FETCH_LIMIT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      /*
       * WHICH credentials each device is walked with: its own columns, the
       * credential profile it points at, or its site's - resolved once, for
       * the whole batch, by the same function that hydrates Network Device
       * monitors. Cross-project profile references are dropped inside the
       * resolver, so a device pointed at another project's profile arrives
       * here as a ping-mode device rather than carrying that project's
       * community string onto this probe's wire.
       */
      const resolvedCredentials: ResolvedSnmpCredentialsForBatch =
        await NetworkDeviceHydrationUtil.resolveSnmpCredentials(devices);

      /*
       * Whether this probe can be handed a device to ping without a walk.
       * Read from the body, where the probe's default request body puts it;
       * an older probe sends no capabilities at all.
       */
      const probeCapabilities: unknown = req.body["probeCapabilities"];
      const probeSupportsPing: boolean =
        Array.isArray(probeCapabilities) &&
        probeCapabilities.includes(NETWORK_DEVICE_PING_CAPABILITY);

      /*
       * This is where an OID Collection Template becomes real. Nothing is
       * ever copied onto a device: the template's OIDs are read here, fresh,
       * and merged with the device's own, so editing a template changes what
       * every linked device collects from its very next poll — with zero
       * writes to NetworkDevice and no fan-out job. A push instead of a join
       * would be 80,000 row updates behind a 10,000-row cap.
       *
       * Cost is one extra query per batch, and only when the batch actually
       * contains a linked device that will be WALKED. A ping-only device
       * polls no OIDs, so its template link is irrelevant to this cycle. A
       * fleet has a handful of device types, so 250 devices realistically
       * resolve to a single-digit number of templates.
       */
      const templateIdsInBatch: Array<string> = Array.from(
        new Set(
          devices
            .filter((device: NetworkDevice) => {
              return (
                resolvedCredentials.byDeviceId.get(device.id?.toString() || "")
                  ?.pollMode === "snmp"
              );
            })
            .map((device: NetworkDevice) => {
              return device.oidTemplateId?.toString();
            })
            .filter((templateId: string | undefined): templateId is string => {
              return Boolean(templateId);
            }),
        ),
      );

      const oidTemplatesById: Map<string, NetworkDeviceOidTemplate> = new Map();
      let oidTemplateLookupFailed: boolean = false;

      if (templateIdsInBatch.length > 0) {
        /*
         * Degrade rather than drop. Claiming already advanced nextPollAt for
         * all 250 devices, so an exception anywhere in this handler does not
         * retry - it silently skips the whole batch for a full interval. A
         * template lookup that fails is worth one cycle of device-local OIDs;
         * it is not worth 250 devices going unpolled.
         */
        try {
          const oidTemplates: Array<NetworkDeviceOidTemplate> =
            await NetworkDeviceOidTemplateService.findBy({
              query: {
                _id: QueryHelper.any(templateIdsInBatch),
              },
              select: {
                _id: true,
                projectId: true,
                name: true,
                oids: true,
                tables: true,
              },
              limit: templateIdsInBatch.length,
              skip: 0,
              props: {
                isRoot: true,
              },
            });

          for (const oidTemplate of oidTemplates) {
            if (oidTemplate.id) {
              oidTemplatesById.set(oidTemplate.id.toString(), oidTemplate);
            }
          }
        } catch (err) {
          /*
           * Skip the linked devices this cycle rather than polling them with
           * half a configuration.
           *
           * Handing the probe only a linked device's device-specific OIDs
           * would be worse than not polling it: every template OID would come
           * back absent, and an "SNMP OID Exists / is False" criterion reads
           * absent as BREACHING - so a transient database blip would raise a
           * real incident on every linked device at once. Unlinked devices in
           * the same batch are unaffected and still poll.
           *
           * The cost is one skipped cycle for those devices, which claiming
           * has already paid for by advancing nextPollAt.
           */
          oidTemplateLookupFailed = true;
          logger.error(
            `Could not load OID Collection Templates for probe ${probeId.toString()}'s poll batch; skipping its template-linked devices for this cycle rather than polling them with an incomplete OID list.`,
          );
          logger.error(err);
        }
      }

      const devicePollConfigs: Array<JSONObject> = [];
      let pingModeDevicesWithheld: number = 0;
      let credentialLookupDevicesSkipped: number = 0;

      for (const device of devices) {
        if (!device.id || !device.hostname) {
          continue;
        }

        const resolved: ResolvedDeviceSnmpCredentials | undefined =
          resolvedCredentials.byDeviceId.get(device.id.toString());

        /*
         * Only absent when this cycle could not read the profile the device
         * (or its site) points at. Skip it: handing it over as a ping-mode
         * device would stop reporting interfaces, inventory and walk health
         * for a device that is configured to be walked, and the operator
         * would see a healthy device quietly lose half its data. Claiming
         * already advanced nextPollAt, so it comes round again next
         * interval.
         */
        if (!resolved) {
          credentialLookupDevicesSkipped++;
          continue;
        }

        const pollMode: NetworkDevicePollMode = resolved.pollMode;

        if (pollMode === "ping") {
          /*
           * Never hand an old probe a credential-less device: it would walk
           * it with SnmpMonitor's default "public" community, fail, and
           * report the device Down. Withheld devices are counted and named
           * once below; claiming has already advanced their nextPollAt, so
           * they come round again next interval and stay Pending until the
           * probe is upgraded.
           */
          if (!probeSupportsPing) {
            pingModeDevicesWithheld++;
            continue;
          }

          devicePollConfigs.push({
            networkDeviceId: device.id.toString(),
            projectId: device.projectId?.toString(),
            hostname: device.hostname,
            pollMode: pollMode,
            collectEndpoints: device.collectEndpoints === true,
          });
          continue;
        }

        // See the catch above: an incomplete OID list is worse than no poll.
        if (oidTemplateLookupFailed && device.oidTemplateId) {
          continue;
        }

        const monitorInterfaces: boolean = device.walkInterfaces !== false;

        const linkedTemplate: NetworkDeviceOidTemplate | undefined =
          device.oidTemplateId
            ? oidTemplatesById.get(device.oidTemplateId.toString())
            : undefined;

        /*
         * The template query runs isRoot, which bypasses the tenant column,
         * so check the projects match rather than trusting the FK. A
         * mismatch can only mean corrupted data, and shipping another
         * project's OIDs to this probe would be an information leak, so drop
         * the template and say so loudly.
         */
        let templateOids: Array<SnmpOid> = [];
        let templateTables: Array<SnmpTableDefinition> = [];

        if (linkedTemplate) {
          if (
            linkedTemplate.projectId?.toString() ===
            device.projectId?.toString()
          ) {
            templateOids = linkedTemplate.oids || [];
            templateTables = linkedTemplate.tables || [];
          } else {
            logger.error(
              `Network device ${device.id?.toString()} references OID Collection Template ${linkedTemplate.id?.toString()} from a different project. Ignoring the template for this poll.`,
            );
          }
        }

        const effectiveOids: {
          oids: Array<SnmpOid>;
          truncatedCount: number;
        } = SnmpOidListUtil.resolveEffectiveOids({
          templateOids: templateOids,
          deviceOids: device.snmpOids,
        });

        /*
         * Both write paths reject an over-cap list with an error on screen,
         * so this should be unreachable. It survives for the one case they
         * cannot catch: a template that grew after devices linked to it.
         */
        if (effectiveOids.truncatedCount > 0) {
          logger.warn(
            `Network device ${device.id?.toString()}: ${effectiveOids.truncatedCount} health OID(s) beyond the per-device limit were not polled${
              linkedTemplate
                ? ` (OID Collection Template "${linkedTemplate.name}")`
                : ""
            }.`,
          );
        }

        /*
         * `description` is documentation for the operator and is never read
         * by the probe (it uses `oid` and `name` only). Dropping it here
         * matters at scale rather than cosmetically: this list is serialized
         * once PER DEVICE, so a shared template's prose would be repeated 250
         * times in a single poll response.
         */
        let oids: Array<SnmpOid> = effectiveOids.oids.map((entry: SnmpOid) => {
          return entry.name === undefined
            ? { oid: entry.oid }
            : { oid: entry.oid, name: entry.name };
        });

        /*
         * A device with interface walking off and no health OIDs still
         * needs SOMETHING to poll or the probe would report "No OIDs
         * configured" instead of reachability. sysDescr is the universal
         * fallback — every SNMP agent answers it.
         */
        if (!monitorInterfaces && oids.length === 0) {
          oids = [{ oid: "1.3.6.1.2.1.1.1.0", name: "sysDescr" }];
        }

        /*
         * Tables resolve the same way OIDs do: the template's, then the
         * device's own, merged by key fresh on every poll. Only the column
         * OIDs and row limits travel to the probe.
         */
        const effectiveTables: EffectiveTableResolution =
          SnmpTableListUtil.resolveEffectiveTables({
            templateTables: templateTables,
            deviceTables: device.snmpTables,
          });

        if (effectiveTables.truncatedCount > 0) {
          logger.warn(
            `Network device ${device.id?.toString()}: ${effectiveTables.truncatedCount} SNMP table(s) beyond the per-device limit were not walked.`,
          );
        }

        devicePollConfigs.push({
          networkDeviceId: device.id.toString(),
          projectId: device.projectId?.toString(),
          hostname: device.hostname,
          pollMode: pollMode,
          collectEndpoints: device.collectEndpoints === true,
          /*
           * Transceiver (SFP/SFP+/QSFP) health rides the interface walk:
           * optics are matched to the ports it finds. A device answers one
           * request per transceiver MIB it lacks, and the probe reads the
           * static part of the ones it has (thresholds, identity) once an
           * hour, so this is on wherever interfaces are walked.
           */
          collectTransceivers: monitorInterfaces,
          snmpMonitor: NetworkDeviceHydrationUtil.buildSnmpMonitorConfig({
            hostname: device.hostname,
            // Where to connect is the device's; what to connect with is resolved.
            credentials: resolved.carrier,
            oids: oids,
            monitorInterfaces: monitorInterfaces,
            tables: SnmpTableListUtil.toWalkRequests(effectiveTables.tables),
          }) as unknown as JSONObject,
        });
      }

      if (credentialLookupDevicesSkipped > 0) {
        logger.warn(
          `Probe ${probeId.toString()}: ${credentialLookupDevicesSkipped} network device(s) in this batch use an SNMP Credential Profile that could not be read this cycle, so they were not handed out. Polling them without their credentials would report them as failing their walk. They are polled again next interval.`,
        );
      }

      if (pingModeDevicesWithheld > 0) {
        logger.warn(
          `Probe ${probeId.toString()} does not advertise the "${NETWORK_DEVICE_PING_CAPABILITY}" capability (it predates ping-first polling), so ${pingModeDevicesWithheld} network device(s) without SNMP credentials in this batch were not handed to it: an older probe would walk them with a default community and report them Down. They stay Pending until the probe is upgraded.`,
        );
      }

      logger.debug(
        `Probe ${probeId.toString()} claimed ${devicePollConfigs.length} network device(s) for polling.`,
      );

      /*
       * A full batch to a probe from before #9499, which asks once a
       * minute, means the cap, not the devices' own intervals, is deciding
       * how often its fleet gets polled — the condition that used to be
       * invisible while it quietly stretched a 5-minute interval into a
       * 20-minute one. Say so, and name the way out. A probe that asks
       * again is handed full batches as a matter of course while it
       * catches up: nothing to say.
       */
      if (!asksAgainWhileDue && isFullBatch) {
        logger.warn(
          `Probe ${probeId.toString()} claimed a full batch of ${limit} network device(s) and asks for devices only once a minute: more devices are due than one fetch can hand out, so this fleet is polling slower than its configured intervals. Update the probe: one of this release asks again while devices are due, polling up to its PROBE_NETWORK_DEVICE_POLL_CONCURRENCY at once. Or raise NETWORK_DEVICE_POLL_FETCH_LIMIT, or spread the devices across more probes.`,
        );
      }

      return Response.sendJsonObjectResponse(req, res, {
        devices: devicePollConfigs,
        isFullBatch: isFullBatch,
      });
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * Receives one device's poll result and queues it for processing —
 * inventory sync, device metrics, and evaluation of the monitors alerting
 * on the device. The device⇄probe pairing is re-verified inside the
 * processor (NetworkDeviceWalkUtil), scoped by the authenticated probe id
 * stamped here.
 *
 * Two probe generations post here. A ping-first probe sends
 * `{ networkDeviceId, isOnline, pollMode, pingResponse, snmpResponse?,
 * monitoredAt }` - `snmpResponse` only when a walk actually ran. An older
 * probe sends `{ networkDeviceId, snmpResponse, monitoredAt }`. A body is
 * rejected only when it carries NEITHER a walk nor a boolean `isOnline`;
 * the processor derives whatever else is missing.
 *
 * Every probe body also carries the probe's `probeCapabilities` (its
 * default request body), forwarded so the processor can tell a walk that
 * was handed no SNMP tables from one by a probe that cannot walk them.
 */
router.post(
  "/probe/network-device/response/ingest",
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ProbeExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      /*
       * The moment OneUptime received this poll, before any queueing: a page
       * its evaluation starts is timed from it (OnCallPageTiming).
       */
      const receivedAt: Date = OneUptimeDate.getCurrentDate();

      const probeId: ObjectID | undefined =
        (req as ProbeExpressRequest).probe?.id || undefined;

      if (!probeId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      const networkDeviceId: string | undefined = req.body[
        "networkDeviceId"
      ] as string | undefined;

      if (!networkDeviceId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("networkDeviceId not found"),
        );
      }

      const snmpResponse: JSONObject | undefined = req.body["snmpResponse"] as
        | JSONObject
        | undefined;
      const isOnline: unknown = req.body["isOnline"];

      if (!snmpResponse && typeof isOnline !== "boolean") {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Neither snmpResponse nor isOnline found"),
        );
      }

      const pollMode: unknown = req.body["pollMode"];
      const pingResponse: JSONObject | undefined = req.body["pingResponse"] as
        | JSONObject
        | undefined;

      /*
       * probeId comes from the authenticated request — never from the
       * body — so a probe can only ever report walks as itself. The rest
       * is forwarded as received (absent fields stay absent) and the
       * processor fills in the defaults, so a job queued by either probe
       * generation is processed the same way.
       */
      await TelemetryQueueService.addNetworkDeviceWalkJob({
        walkRequestBody: {
          probeId: probeId.toString(),
          networkDeviceId: networkDeviceId,
          isOnline: typeof isOnline === "boolean" ? isOnline : undefined,
          pollMode: typeof pollMode === "string" ? pollMode : undefined,
          pingResponse: pingResponse || undefined,
          snmpResponse: snmpResponse || undefined,
          probeCapabilities: ProbeCapabilityUtil.parse(
            req.body["probeCapabilities"],
          ),
          monitoredAt: (req.body["monitoredAt"] as string) || undefined,
        },
        receivedAt: receivedAt,
      });

      return Response.sendJsonObjectResponse(req, res, { result: "ok" });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
