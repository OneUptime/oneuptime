import ProbeAuthorization from "../../Middleware/ProbeAuthorization";
import { ProbeExpressRequest } from "../../Types/Request";
import TelemetryQueueService from "../../Services/Queue/TelemetryQueueService";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceOidTemplate from "Common/Models/DatabaseModels/NetworkDeviceOidTemplate";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import NetworkDeviceOidTemplateService from "Common/Server/Services/NetworkDeviceOidTemplateService";
import NetworkDeviceHydrationUtil from "Common/Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import SnmpOid from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import SnmpOidListUtil from "Common/Types/Monitor/SnmpMonitor/SnmpOidListUtil";
import Express, {
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import NumberUtil from "Common/Utils/Number";
import logger from "Common/Server/Utils/Logger";

const router: ExpressRouter = Express.getRouter();

/*
 * How many devices one fetch hands to a probe, and therefore the CEILING on
 * how fast a probe's fleet can be polled: the probe fetches once a minute,
 * so a probe can never poll faster than this many devices per minute
 * however short the devices' configured intervals are.
 *
 * That ceiling used to be 50, silently. A probe with 980 devices could
 * therefore only get all the way round its fleet every ~20 minutes — long
 * enough that a large share of a perfectly healthy fleet was always outside
 * the freshness window the UI called "up", which is how devices answering
 * SNMP fine came to be listed as Down (issue #3220). Reachability no longer
 * depends on poll recency, so a bound here can no longer manufacture an
 * outage, but it still throttles how current the data is — so the default
 * is sized for a real fleet and operators can raise it.
 *
 * Raise it together with PROBE_NETWORK_DEVICE_POLL_CONCURRENCY on the probe:
 * claiming advances nextPollAt whether or not the walk actually happens, so
 * handing a probe more devices than it can walk inside a cycle does not
 * poll them sooner, it skips them.
 */
const DEVICE_POLL_FETCH_LIMIT: number = NumberUtil.parseNumberWithDefault({
  value: process.env["NETWORK_DEVICE_POLL_FETCH_LIMIT"],
  defaultValue: 250,
  min: 1,
});

/*
 * Hands the requesting probe the polling-enabled devices assigned to it
 * that are due for an SNMP walk, with each device's stored credentials
 * hydrated into a concrete, probe-executable SNMP config. Claiming is
 * atomic (FOR UPDATE SKIP LOCKED) and advances nextPollAt by the device's
 * own polling interval.
 *
 * This is how devices get polled — monitors play no part in it. Network
 * Device monitors are evaluated server-side when the walk results come
 * back (see NetworkDeviceWalkUtil).
 */
router.post(
  "/probe/network-device/list",
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

      const claimedDeviceIds: Array<ObjectID> =
        await NetworkDeviceService.claimDevicesForPolling({
          probeId: probeId,
          limit: DEVICE_POLL_FETCH_LIMIT,
        });

      if (claimedDeviceIds.length === 0) {
        return Response.sendJsonObjectResponse(req, res, { devices: [] });
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
          projectId: true,
          walkInterfaces: true,
          collectEndpoints: true,
          snmpOids: true,
          oidTemplateId: true,
        },
        limit: DEVICE_POLL_FETCH_LIMIT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      /*
       * This is where an OID Collection Template becomes real. Nothing is
       * ever copied onto a device: the template's OIDs are read here, fresh,
       * and merged with the device's own, so editing a template changes what
       * every linked device collects from its very next poll — with zero
       * writes to NetworkDevice and no fan-out job. A push instead of a join
       * would be 80,000 row updates behind a 10,000-row cap.
       *
       * Cost is one extra query per batch, and only when the batch actually
       * contains a linked device. A fleet has a handful of device types, so
       * 250 devices realistically resolve to a single-digit number of
       * templates.
       */
      const templateIdsInBatch: Array<string> = Array.from(
        new Set(
          devices
            .map((device: NetworkDevice) => {
              return device.oidTemplateId?.toString();
            })
            .filter((templateId: string | undefined): templateId is string => {
              return Boolean(templateId);
            }),
        ),
      );

      const oidTemplatesById: Map<string, NetworkDeviceOidTemplate> = new Map();

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
          logger.error(
            `Could not load OID Collection Templates for probe ${probeId.toString()}'s poll batch; falling back to device-specific OIDs for this cycle.`,
          );
          logger.error(err);
        }
      }

      const devicePollConfigs: Array<JSONObject> = [];

      for (const device of devices) {
        if (!device.id || !device.hostname) {
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

        if (linkedTemplate) {
          if (
            linkedTemplate.projectId?.toString() ===
            device.projectId?.toString()
          ) {
            templateOids = linkedTemplate.oids || [];
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

        devicePollConfigs.push({
          networkDeviceId: device.id.toString(),
          projectId: device.projectId?.toString(),
          collectEndpoints: device.collectEndpoints === true,
          snmpMonitor: NetworkDeviceHydrationUtil.buildSnmpMonitorConfig({
            device: device,
            oids: oids,
            monitorInterfaces: monitorInterfaces,
          }) as unknown as JSONObject,
        });
      }

      logger.debug(
        `Probe ${probeId.toString()} claimed ${devicePollConfigs.length} network device(s) for polling.`,
      );

      /*
       * A full batch means the cap, not the devices' own intervals, is
       * deciding how often this fleet gets polled — the condition that used
       * to be invisible while it quietly stretched a 5-minute interval into
       * a 20-minute one. Say so, and name the knob.
       */
      if (claimedDeviceIds.length >= DEVICE_POLL_FETCH_LIMIT) {
        logger.warn(
          `Probe ${probeId.toString()} claimed a full batch of ${DEVICE_POLL_FETCH_LIMIT} network device(s): more devices are due than one fetch can hand out, so this fleet is polling slower than its configured intervals. Raise NETWORK_DEVICE_POLL_FETCH_LIMIT (and the probe's PROBE_NETWORK_DEVICE_POLL_CONCURRENCY to match), or spread the devices across more probes.`,
        );
      }

      return Response.sendJsonObjectResponse(req, res, {
        devices: devicePollConfigs,
      });
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * Receives one device's walk result and queues it for processing —
 * inventory sync, device metrics, and evaluation of the monitors alerting
 * on the device. The device⇄probe pairing is re-verified inside the
 * processor (NetworkDeviceWalkUtil), scoped by the authenticated probe id
 * stamped here.
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

      if (!snmpResponse) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("snmpResponse not found"),
        );
      }

      /*
       * probeId comes from the authenticated request — never from the
       * body — so a probe can only ever report walks as itself.
       */
      await TelemetryQueueService.addNetworkDeviceWalkJob({
        walkRequestBody: {
          probeId: probeId.toString(),
          networkDeviceId: networkDeviceId,
          snmpResponse: snmpResponse,
          monitoredAt: (req.body["monitoredAt"] as string) || undefined,
        },
      });

      return Response.sendJsonObjectResponse(req, res, { result: "ok" });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
