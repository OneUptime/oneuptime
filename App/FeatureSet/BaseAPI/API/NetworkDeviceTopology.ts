import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import CommonAPI from "Common/Server/API/CommonAPI";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import Query from "Common/Server/Types/Database/Query";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkInterfaceService from "Common/Server/Services/NetworkInterfaceService";
import NetworkInterface from "Common/Models/DatabaseModels/NetworkInterface";
import NetworkEndpointService from "Common/Server/Services/NetworkEndpointService";
import NetworkEndpoint from "Common/Models/DatabaseModels/NetworkEndpoint";
import MonitorStatusService from "Common/Server/Services/MonitorStatusService";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import NetworkTopologyUtil, {
  TopologyBuildResult,
  TopologyDeviceInput,
  TopologyEndpointInput,
  TopologyInterfaceInput,
  TopologyManualLinkInput,
} from "Common/Utils/Monitor/NetworkTopologyUtil";
import NetworkDeviceLinkService from "Common/Server/Services/NetworkDeviceLinkService";
import NetworkDeviceLink from "Common/Models/DatabaseModels/NetworkDeviceLink";
import NetworkDeviceLinkRuleService from "Common/Server/Services/NetworkDeviceLinkRuleService";
import NetworkDeviceLinkRule from "Common/Models/DatabaseModels/NetworkDeviceLinkRule";
import Label from "Common/Models/DatabaseModels/Label";
import NetworkDeviceLinkRuleUtil, {
  LinkRuleDeviceInput,
  LinkRuleOutcome,
} from "Common/Utils/Monitor/NetworkDeviceLinkRuleUtil";
import NetworkTopologySuppressionService from "Common/Server/Services/NetworkTopologySuppressionService";

/*
 * Computes the LLDP+CDP-derived network topology graph for the requesting
 * user's project. Read-only and permission-scoped through the standard
 * props helper, so a user only sees devices they can read. Edges carry the
 * operational state of the interface at each end (up/down, utilization,
 * rates) resolved from NetworkInterface rows — fetched in one query and
 * matched in memory, never per-device. Discovered endpoints (ARP/FDB
 * attachments) ride along the same way: one batch query for the selected
 * devices, attached in the builder.
 */

// Hard cap on endpoint rows fed to the builder — beyond this the map is noise.
const MAX_TOPOLOGY_ENDPOINTS: number = 2000;

export default class NetworkDeviceTopologyAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    router.post(
      "/network-device/topology",
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          if (!props.tenantId) {
            throw new BadDataException("Project not found in request");
          }

          const body: JSONObject = (req.body || {}) as JSONObject;
          const siteIdRaw: unknown = body["siteId"];
          if (
            siteIdRaw !== undefined &&
            siteIdRaw !== null &&
            typeof siteIdRaw !== "string"
          ) {
            throw new BadDataException("siteId must be a string");
          }
          const siteId: string | null =
            typeof siteIdRaw === "string" && siteIdRaw ? siteIdRaw : null;

          /*
           * Archived devices never belong on the map — they are hidden
           * from lists but keep collecting telemetry, so without this
           * filter they would linger as ghost nodes.
           */
          const deviceQuery: Query<NetworkDevice> = {
            projectId: props.tenantId,
            isArchived: false,
          };
          if (siteId) {
            /*
             * Exact-match site scoping only for now — scoping to the
             * site's whole descendant subtree is a follow-up.
             */
            deviceQuery.siteId = new ObjectID(siteId);
          }

          const devices: Array<NetworkDevice> =
            await NetworkDeviceService.findBy({
              query: deviceQuery,
              select: {
                _id: true,
                name: true,
                hostname: true,
                sysName: true,
                /*
                 * Reachability: the OUTCOME of the last poll (isReachable),
                 * not the age of the last success. lastPolledAt and the
                 * interval only size the "polling has stopped entirely"
                 * backstop. Dropping isReachable here would put the map back
                 * to drawing a fleet the probe cannot poll inside 15 minutes
                 * as an all-red network.
                 */
                isReachable: true,
                lastPolledAt: true,
                lastSeenAt: true,
                pollingIntervalInMinutes: true,
                /*
                 * Health for devices nothing polls. A monitor-backed device
                 * (monitoringMethod "Monitor") has no SNMP walk at all, so
                 * the poll columns alone would draw every one of them as
                 * permanently unknown.
                 */
                currentMonitorStatusId: true,
                interfacesUp: true,
                interfacesDown: true,
                vendor: true,
                deviceModel: true,
                /*
                 * Not rendered — read only by the role classifier, which
                 * is what lets a switch draw as a switch rather than as
                 * another anonymous circle.
                 */
                sysDescr: true,
                sysObjectId: true,
                /*
                 * The operator's own answer, which beats the classifier
                 * above. Load-bearing for devices nothing walks: with no
                 * sysDescr and no sysObjectId to read, this is the only
                 * evidence there is about what the box actually does.
                 */
                deviceRole: true,
                /*
                 * Not rendered either — read only by the neighbor matcher.
                 * An LLDP chassis id is a serial as often as it is a name,
                 * and without this the device it names is drawn as an
                 * unmanaged stranger.
                 */
                serialNumber: true,
                /*
                 * Not rendered — read only by the uplink rules, which match
                 * devices by the labels they carry.
                 */
                labels: {
                  _id: true,
                },
                /*
                 * The LLDP and CDP walks ride along with the interface walk,
                 * so this is what lets an edgeless device say "neighbour
                 * discovery never ran" instead of leaving the operator to
                 * guess why it is floating.
                 */
                walkInterfaces: true,
                lldpNeighbors: true,
                cdpNeighbors: true,
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: props,
            });

          const deviceIds: Set<string> = new Set<string>(
            devices.map((device: NetworkDevice) => {
              return device.id!.toString();
            }),
          );

          /*
           * Interface rows for the devices in THIS graph in ONE query; the
           * builder matches them to edge endpoints in memory. Scoping to
           * deviceIds matters: a project-wide query would spend its row cap
           * on devices that are not on the map, so a site-scoped request
           * could come back with none of its own interfaces and lose every
           * edge's up/down state, port name and utilization.
           */
          let interfaceRows: Array<NetworkInterface> = [];
          if (deviceIds.size > 0) {
            interfaceRows = await NetworkInterfaceService.findBy({
              query: {
                projectId: props.tenantId,
                networkDeviceId: QueryHelper.any(Array.from(deviceIds)),
              },
              select: {
                _id: true,
                networkDeviceId: true,
                interfaceIndex: true,
                name: true,
                /*
                 * Not for display: it is what lets an LLDP chassis id of
                 * subtype 4 (a MAC) be recognised as a device we already
                 * manage. Free — these rows are fetched either way.
                 */
                macAddress: true,
                isOperationallyUp: true,
                isAdministrativelyUp: true,
                utilizationPercent: true,
                inRateMbps: true,
                outRateMbps: true,
                errorsPerSecond: true,
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: props,
            });
          }

          /*
           * Interface MACs per device, collected on the same pass. These
           * are match keys, not display data: LLDP chassis-id subtype 4 is
           * a MAC, so a peer that advertises no sysName can still be
           * recognised as a device already on the map.
           */
          const macAddressesByDeviceId: Map<string, Array<string>> = new Map<
            string,
            Array<string>
          >();

          const interfaceInput: Array<TopologyInterfaceInput> = [];
          for (const row of interfaceRows) {
            const deviceId: string | undefined =
              row.networkDeviceId?.toString();
            if (
              !deviceId ||
              row.interfaceIndex === undefined ||
              !deviceIds.has(deviceId)
            ) {
              continue;
            }
            if (row.macAddress) {
              const macs: Array<string> | undefined =
                macAddressesByDeviceId.get(deviceId);
              if (macs) {
                macs.push(row.macAddress);
              } else {
                macAddressesByDeviceId.set(deviceId, [row.macAddress]);
              }
            }
            interfaceInput.push({
              networkDeviceId: deviceId,
              interfaceIndex: row.interfaceIndex,
              name: row.name,
              isOperationallyUp: row.isOperationallyUp,
              isAdministrativelyUp: row.isAdministrativelyUp,
              utilizationPercent: row.utilizationPercent,
              inRateMbps: row.inRateMbps,
              outRateMbps: row.outRateMbps,
              errorsPerSecond: row.errorsPerSecond,
            });
          }

          /*
           * Discovered endpoints (from ARP/FDB) attached to the selected
           * devices, in one batch query. Capped hard: beyond a couple
           * thousand leaf nodes the graph is unreadable anyway, and the
           * cap is surfaced to the UI below.
           */
          let endpointRows: Array<NetworkEndpoint> = [];
          if (deviceIds.size > 0) {
            endpointRows = await NetworkEndpointService.findBy({
              query: {
                projectId: props.tenantId,
                attachedNetworkDeviceId: QueryHelper.any(Array.from(deviceIds)),
              },
              select: {
                _id: true,
                macAddress: true,
                ipAddress: true,
                vendor: true,
                classification: true,
                vlanId: true,
                attachedNetworkDeviceId: true,
                attachedInterfaceIndex: true,
                attachedPortName: true,
                lastSeenAt: true,
              },
              sort: {
                macAddress: SortOrder.Ascending,
              },
              limit: MAX_TOPOLOGY_ENDPOINTS,
              skip: 0,
              props: props,
            });
          }

          const endpointInput: Array<TopologyEndpointInput> = [];
          for (const endpoint of endpointRows) {
            if (!endpoint._id || !endpoint.macAddress) {
              continue;
            }
            endpointInput.push({
              id: endpoint._id.toString(),
              macAddress: endpoint.macAddress,
              ipAddress: endpoint.ipAddress,
              vendor: endpoint.vendor,
              classification: endpoint.classification,
              vlanId: endpoint.vlanId,
              attachedNetworkDeviceId:
                endpoint.attachedNetworkDeviceId?.toString(),
              attachedInterfaceIndex: endpoint.attachedInterfaceIndex,
              attachedPortName: endpoint.attachedPortName,
              lastSeenAt: endpoint.lastSeenAt,
            });
          }

          /*
           * Operator-declared links between devices in this project. Not
           * scoped to deviceIds in the query: the builder already skips a
           * link whose ends are not both on this map, and the row count here
           * is tiny compared with the filter's cost in query complexity.
           */
          const manualLinkRows: Array<NetworkDeviceLink> =
            await NetworkDeviceLinkService.findBy({
              query: {
                projectId: props.tenantId,
              },
              select: {
                _id: true,
                name: true,
                fromDeviceId: true,
                toDeviceId: true,
                parentDeviceId: true,
                fromPortName: true,
                toPortName: true,
                monitor: {
                  currentMonitorStatusId: true,
                },
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: props,
            });

          /*
           * Monitor statuses are per-project lookup rows, so one query
           * resolves every stamped status the map needs — for devices and
           * for the monitors that colour manual links. Skipped entirely when
           * nothing on this map carries one.
           */
          const statusIdsInUse: Set<string> = new Set<string>();
          for (const device of devices) {
            if (device.currentMonitorStatusId) {
              statusIdsInUse.add(device.currentMonitorStatusId.toString());
            }
          }
          for (const link of manualLinkRows) {
            if (link.monitor?.currentMonitorStatusId) {
              statusIdsInUse.add(
                link.monitor.currentMonitorStatusId.toString(),
              );
            }
          }

          /*
           * Narrower than NetworkTopologyNodeStatus on purpose: a stamped
           * status always resolves to up or down, never "unknown" — that
           * state means "nothing has reported", which by definition cannot
           * be what a report says.
           */
          const nodeStatusByMonitorStatusId: Map<string, "up" | "down"> =
            new Map<string, "up" | "down">();

          if (statusIdsInUse.size > 0) {
            const monitorStatuses: Array<MonitorStatus> =
              await MonitorStatusService.findBy({
                query: {
                  projectId: props.tenantId,
                  _id: QueryHelper.any(Array.from(statusIdsInUse)),
                },
                select: {
                  _id: true,
                  isOperationalState: true,
                  isOfflineState: true,
                },
                limit: LIMIT_PER_PROJECT,
                skip: 0,
                props: props,
              });

            for (const status of monitorStatuses) {
              if (!status._id) {
                continue;
              }
              /*
               * The map has three states and MonitorStatus has a ladder, so
               * everything that is not an OFFLINE state reads as up. A
               * degraded device is reachable — drawing it red would say the
               * link is dead, which is a different and much louder claim
               * than the one the status is making.
               */
              nodeStatusByMonitorStatusId.set(
                status._id.toString(),
                status.isOfflineState ? "down" : "up",
              );
            }
          }

          const topologyInput: Array<TopologyDeviceInput> = devices.map(
            (device: NetworkDevice) => {
              return {
                id: device.id!.toString(),
                name: device.name || device.hostname || "Unnamed device",
                hostname: device.hostname,
                sysName: device.sysName,
                isReachable: device.isReachable,
                lastPolledAt: device.lastPolledAt,
                lastSeenAt: device.lastSeenAt,
                pollingIntervalInMinutes: device.pollingIntervalInMinutes,
                monitorStatus: device.currentMonitorStatusId
                  ? nodeStatusByMonitorStatusId.get(
                      device.currentMonitorStatusId.toString(),
                    )
                  : undefined,
                interfacesUp: device.interfacesUp,
                interfacesDown: device.interfacesDown,
                vendor: device.vendor,
                deviceModel: device.deviceModel,
                sysDescr: device.sysDescr,
                sysObjectId: device.sysObjectId,
                deviceRole: device.deviceRole,
                serialNumber: device.serialNumber,
                isNeighborDiscoveryEnabled: device.walkInterfaces,
                macAddresses: macAddressesByDeviceId.get(device.id!.toString()),
                lldpNeighbors: device.lldpNeighbors,
                cdpNeighbors: device.cdpNeighbors,
              };
            },
          );

          /*
           * Label-driven uplinks. Resolved here rather than stored, so
           * relabelling a device shows up on the next refresh and a deleted
           * rule leaves nothing behind to clean up. Rules that draw nothing
           * report why, and that reasoning rides back on the payload so the
           * rule list can show it instead of an unexplained empty map.
           */
          const linkRuleRows: Array<NetworkDeviceLinkRule> =
            await NetworkDeviceLinkRuleService.findBy({
              query: {
                projectId: props.tenantId,
                isEnabled: true,
              },
              select: {
                _id: true,
                name: true,
                isEnabled: true,
                childDeviceLabels: {
                  _id: true,
                },
                parentDeviceLabels: {
                  _id: true,
                },
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: props,
            });

          const labelIdsOf: (
            labels: Array<Label> | undefined,
          ) => Array<string> = (
            labels: Array<Label> | undefined,
          ): Array<string> => {
            return (labels || [])
              .map((label: Label) => {
                return label._id ? label._id.toString() : "";
              })
              .filter((id: string) => {
                return id.length > 0;
              });
          };

          const ruleDeviceInput: Array<LinkRuleDeviceInput> = devices.map(
            (device: NetworkDevice) => {
              return {
                id: device.id!.toString(),
                labelIds: labelIdsOf(device.labels),
              };
            },
          );

          const ruleOutcomes: Array<LinkRuleOutcome> =
            NetworkDeviceLinkRuleUtil.resolveRules(
              linkRuleRows.map((rule: NetworkDeviceLinkRule) => {
                return {
                  id: rule._id!.toString(),
                  name: rule.name,
                  isEnabled: rule.isEnabled,
                  childLabelIds: labelIdsOf(rule.childDeviceLabels),
                  parentLabelIds: labelIdsOf(rule.parentDeviceLabels),
                };
              }),
              ruleDeviceInput,
            );

          const manualLinkInput: Array<TopologyManualLinkInput> = [];

          /*
           * Explicit links first, rule-derived links second. The builder
           * keeps the first report's fields when it merges a pair, so a link
           * somebody drew by hand — with its ports and its own name — wins
           * over a rule that happens to cover the same pair. The specific
           * statement should beat the general one.
           */
          for (const link of manualLinkRows) {
            if (!link.fromDeviceId || !link.toDeviceId) {
              continue;
            }
            const linkStatusId: string | undefined =
              link.monitor?.currentMonitorStatusId?.toString();
            manualLinkInput.push({
              fromDeviceId: link.fromDeviceId.toString(),
              toDeviceId: link.toDeviceId.toString(),
              name: link.name,
              fromPortName: link.fromPortName,
              toPortName: link.toPortName,
              monitorStatus: linkStatusId
                ? nodeStatusByMonitorStatusId.get(linkStatusId)
                : undefined,
              parentDeviceId: link.parentDeviceId?.toString(),
            });
          }

          for (const outcome of ruleOutcomes) {
            for (const link of outcome.links) {
              manualLinkInput.push({
                fromDeviceId: link.fromDeviceId,
                toDeviceId: link.toDeviceId,
                name: outcome.ruleName,
                /*
                 * A link rule is stated as child labels and parent labels,
                 * so unlike a hand-drawn link it knows which end is up
                 * without anybody having to say — and resolveRules puts
                 * the child in `from` and the parent in `to`. Passing it
                 * through means "these APs uplink to that switch" draws as
                 * an actual hierarchy rather than as a bag of peer cables.
                 */
                parentDeviceId: link.toDeviceId,
              });
            }
          }

          /*
           * Nodes the project has taken off the map. Read with root props
           * inside the service: suppression is a display preference shared by
           * the whole project, and a viewer who cannot read the suppression
           * rows would otherwise see a different map from everyone else.
           */
          const suppressedNodeKeys: Set<string> =
            await NetworkTopologySuppressionService.getSuppressedNodeKeys({
              projectId: props.tenantId,
            });

          const topology: TopologyBuildResult =
            NetworkTopologyUtil.buildTopology(
              topologyInput,
              OneUptimeDate.getCurrentDate(),
              interfaceInput,
              endpointInput,
              manualLinkInput,
              suppressedNodeKeys,
            );

          /*
           * Surface truncation so the UI can warn that the map is partial.
           * isTruncated means "devices are missing from the graph" — that is
           * what the UI's "only part of it is shown, use search to narrow it
           * down" banner tells the user, and narrowing genuinely helps. The
           * interface cap is a different kind of loss (every node and edge is
           * present, only their state is missing) and search cannot fix it,
           * so it gets its own flag rather than lying in this one.
           */
          topology.isTruncated = devices.length >= LIMIT_PER_PROJECT;

          /*
           * The builder reports endpoints it dropped internally; OR in
           * the query-level cap so either source of loss is visible.
           */
          if (endpointRows.length >= MAX_TOPOLOGY_ENDPOINTS) {
            topology.endpointsTruncated = true;
          }

          /*
           * Not part of TopologyBuildResult — it describes the query, not
           * the graph — so it is attached to the response payload directly.
           */
          const responseBody: JSONObject = {
            ...(topology as unknown as JSONObject),
            interfacesTruncated: interfaceRows.length >= LIMIT_PER_PROJECT,
            /*
             * Only the rules that drew nothing. A rule doing its job needs no
             * explanation, but one that silently produces no edges is
             * indistinguishable from one that is working — which is the
             * failure mode this whole feature is supposed to remove, not add.
             */
            linkRuleWarnings: ruleOutcomes
              .filter((outcome: LinkRuleOutcome) => {
                return outcome.links.length === 0;
              })
              .map((outcome: LinkRuleOutcome) => {
                return {
                  ruleId: outcome.ruleId,
                  ruleName: outcome.ruleName,
                  reason: outcome.skipReason,
                  message: NetworkDeviceLinkRuleUtil.describeOutcome(outcome),
                };
              }) as unknown as JSONObject[],
          };

          return Response.sendJsonObjectResponse(req, res, responseBody);
        } catch (err) {
          return next(err);
        }
      },
    );

    return router;
  }
}
