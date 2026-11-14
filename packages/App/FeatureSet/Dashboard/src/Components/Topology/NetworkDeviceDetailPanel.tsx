import React, { FunctionComponent, ReactElement, useMemo } from "react";
import SideOver, { SideOverSize } from "Common/UI/Components/SideOver/SideOver";
import Link from "Common/UI/Components/Link/Link";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import {
  NetworkTopologyEdge,
  NetworkTopologyEdgeEndpoint,
  NetworkTopologyMonitorNotChecked,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import MonitorNotCheckedReason from "Common/Types/Monitor/MonitorNotCheckedReason";
import { Gray500 } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import Route from "Common/Types/API/Route";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import useTranslateValue from "Common/UI/Utils/Translation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  LINK_STATE_COLORS,
  NetworkLinkState,
  describeEndpoint,
  edgeKeyForEdge,
  isolationReasonForNode,
  linkStateForEdge,
  monitorNotCheckedForNode,
} from "./NetworkTopologyMeta";
import {
  MonitorNotCheckedQualifier,
  getMonitorNotCheckedQualifier,
} from "../NetworkDevice/DeviceStatusUtil";
import { DeviceMonitorNotCheckedActions } from "../NetworkDevice/DeviceStatusHero";
import {
  isUnclassifiedNode,
  roleLabelForNode,
} from "../NetworkDevice/TopologyNodeShape";
import {
  FdbEdgeEnds,
  LearnedAttachment,
  fdbEdgeEnds,
  isFdbEdge,
  learnedAttachmentForNode,
  portLabelForEdgeEnd,
} from "../NetworkDevice/EndpointNodeUtil";
import DeviceDiagnostics from "../NetworkDevice/DeviceDiagnostics";
import DeviceLatencyTrend from "../NetworkDevice/DeviceLatencyTrend";
import { canRunDiagnosticsOnNode } from "../NetworkDevice/DeviceDiagnosticsViewModel";

/*
 * Right-hand detail drawer for a topology device node. Keeps the user on
 * the map (clicking no longer navigates away) while surfacing identity
 * (vendor/model/sysName), status, and every link on the device with its
 * operational state. Managed devices deep-link to their device page;
 * unmanaged discovery-protocol peers show whatever their neighbors
 * advertised about them.
 */

export interface ComponentProps {
  node: NetworkTopologyNode;
  edges: Array<NetworkTopologyEdge>;
  nodeById: Map<string, NetworkTopologyNode>;
  onClose: () => void;
  onSelectEdge: (edge: NetworkTopologyEdge) => void;
  /*
   * Take this node off the map for the whole project. Optional so the panel
   * still renders for a viewer who cannot create suppressions.
   */
  onHideNode?: ((node: NetworkTopologyNode) => void) | undefined;
  /*
   * Turn this unmanaged neighbour - or this discovered endpoint (issue
   * #5775) - into a monitored NetworkDevice. Optional for the same reason as
   * onHideNode — a viewer without create permission is shown the panel
   * without the action rather than an action that fails — and the caller
   * decides adoptability, so the panel does not have to know which node
   * kinds qualify.
   */
  onAddToMonitoring?: ((node: NetworkTopologyNode) => void) | undefined;
  /*
   * Whether the Ping / Traceroute buttons are offered under Connectivity.
   * Decided by the caller from the create permission on
   * NetworkDeviceDiagnostic, for the same reason as the two handlers above:
   * hidden for a viewer, never disabled with nothing honest to say. The
   * latency trend under the same heading is read-only and shows regardless.
   */
  canRunDiagnostics?: boolean | undefined;
  /*
   * Reads the map again, once the drawer's "Turn monitoring on" has turned a
   * device's bound monitor back on: the save stamps the device with the
   * monitor's status before it answers, so the next read draws it in that
   * status. Optional: without it the next scheduled refresh does.
   */
  readMapAgain?: (() => Promise<void>) | undefined;
}

/*
 * The test ids of the line under a device's status that says its bound
 * monitor is not checked (issue #7346), and of its caption.
 */
export const MONITOR_NOT_CHECKED_TEST_ID: string =
  "network-topology-monitor-not-checked";
export const MONITOR_NOT_CHECKED_CAPTION_TEST_ID: string =
  "network-topology-monitor-not-checked-caption";

/*
 * What the drawer's subtitle says: the kind of node, and its IP address
 * beside it when its name is something else (issue #5775) - the map names a
 * device by what it is called, and the address is what an operator types
 * into a terminal. The address is isolated (FSI ... PDI) so a right-to-left
 * sentence keeps it whole.
 */
export function getNodeSubtitle(data: {
  kindText: string;
  name: string;
  ipAddress?: string | undefined;
}): string {
  const ipAddress: string = (data.ipAddress || "").trim();

  if (!ipAddress || ipAddress === data.name.trim()) {
    return data.kindText;
  }

  return `${data.kindText} · \u2068${ipAddress}\u2069`;
}

const STATUS_COLORS: Record<string, string> = {
  up: "#16a34a",
  down: "#dc2626",
  unknown: "#9ca3af",
};

// The status beside the dot, in the reader's language.
const STATUS_LABELS: Record<string, string> = {
  up: translationKey("Up"),
  down: translationKey("Down"),
  unknown: translationKey("Unknown"),
};

const NetworkDeviceDetailPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const translator: Translator = useTranslator();
  const { node } = props;

  const attachedEdges: Array<NetworkTopologyEdge> = useMemo(() => {
    return props.edges.filter((edge: NetworkTopologyEdge) => {
      return edge.fromNodeId === node.id || edge.toNodeId === node.id;
    });
  }, [props.edges, node.id]);

  const isolationReason: string | undefined = useMemo(() => {
    return isolationReasonForNode(node, attachedEdges.length > 0);
  }, [node, attachedEdges.length]);

  /*
   * Read from the edges already narrowed to this node: the attachment is
   * one of them, and a device with a hundred links should not scan the
   * whole graph again to find it.
   */
  const learnedAttachment: LearnedAttachment | undefined = useMemo(() => {
    return learnedAttachmentForNode(node, attachedEdges, props.nodeById);
  }, [node, attachedEdges, props.nodeById]);

  const isEndpoint: boolean = node.kind === "endpoint";

  /*
   * A monitor-backed device drawn "unknown" because nothing checks its bound
   * monitor (issue #7346): the device pages' gray "Monitoring off" or
   * "Monitor archived" pill beside the status, with its tooltip, and under
   * it what that means for the status and the ways out - "Turn monitoring
   * on" and "Open monitor", as the device's own hero offers them.
   */
  const monitorNotChecked: NetworkTopologyMonitorNotChecked | undefined =
    monitorNotCheckedForNode(node);
  const notCheckedQualifier: MonitorNotCheckedQualifier | null =
    monitorNotChecked
      ? getMonitorNotCheckedQualifier(monitorNotChecked.reason)
      : null;
  const isBoundMonitorArchived: boolean =
    monitorNotChecked?.reason === MonitorNotCheckedReason.MonitorArchived;

  const detailRows: Array<{ label: string; value: string }> = [];
  /*
   * First row, because it is what the shape on the map claimed and this
   * drawer is where somebody comes to check that claim. Omitted when the
   * evidence named no role — "Unknown type" is not worth a row.
   */
  if (!isUnclassifiedNode(node)) {
    detailRows.push({
      label: translateString("Type") || "",
      value: roleLabelForNode(node),
    });
  }
  if (node.macAddress) {
    detailRows.push({
      label: translateString("MAC address") || "",
      value: node.macAddress,
    });
  }
  if (node.ipAddress) {
    detailRows.push({
      label: translateString("IP address") || "",
      value: node.ipAddress,
    });
  }
  if (node.hostname && node.hostname !== node.name) {
    detailRows.push({
      label: translateString("Hostname") || "",
      value: node.hostname,
    });
  }
  if (node.classification) {
    detailRows.push({
      label: translateString("Classification") || "",
      value: node.classification,
    });
  }
  if (typeof node.vlanId === "number") {
    detailRows.push({
      label: translateString("VLAN") || "",
      value: `VLAN ${node.vlanId}`,
    });
  }
  if (node.sysName) {
    detailRows.push({
      label: translateString("System name") || "",
      value: node.sysName,
    });
  }
  if (node.vendor) {
    detailRows.push({
      label: translateString("Vendor") || "",
      value: node.vendor,
    });
  }
  if (node.deviceModel) {
    detailRows.push({
      label:
        (node.isManaged
          ? translateString("Model")
          : translateString("Platform")) || "",
      value: node.deviceModel,
    });
  }
  if (node.interfacesUp !== undefined || node.interfacesDown !== undefined) {
    detailRows.push({
      label: translateString("Interfaces") || "",
      value: [
        translator.translatePlural(
          { one: "{{count}} up", other: "{{count}} up" },
          node.interfacesUp ?? 0,
        ),
        translator.translatePlural(
          { one: "{{count}} down", other: "{{count}} down" },
          node.interfacesDown ?? 0,
        ),
      ].join(" / "),
    });
  }

  const kindText: string =
    (isEndpoint
      ? translateString("Discovered endpoint")
      : node.isManaged
        ? translateString("Network device")
        : translateString("Unmanaged neighbor")) || "";

  return (
    <SideOver
      title={node.name}
      description={getNodeSubtitle({
        kindText: kindText,
        name: node.name,
        ipAddress: node.ipAddress,
      })}
      onClose={props.onClose}
      size={SideOverSize.Small}
    >
      {/*
       * The drawer brings its own top spacing from sm up, where the
       * side-over leaves it to its content: without it the status row - and
       * a "Monitoring off" pill beside it - sat on the header's edge.
       */}
      <div className="space-y-6 sm:pt-6">
        <div>
          {/*
           * Wraps on a narrow drawer: a qualifier in a long language (German
           * "Überwachung aus") beside "Hide from map" is wider than a phone.
           */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{
                backgroundColor:
                  STATUS_COLORS[node.status] || STATUS_COLORS["unknown"],
              }}
            />
            <span
              className="text-sm font-medium text-gray-900"
              data-testid="network-topology-device-status"
            >
              {translateString(
                STATUS_LABELS[node.status] || STATUS_LABELS["unknown"],
              )}
            </span>
            {notCheckedQualifier ? (
              <Pill
                text={notCheckedQualifier.text}
                color={Gray500}
                size={PillSize.Normal}
                tooltip={notCheckedQualifier.tooltip}
              />
            ) : (
              <></>
            )}
            {isEndpoint ? (
              <span className="inline-flex items-center rounded-full border border-violet-300 bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700">
                {translateString("Endpoint")}
              </span>
            ) : !node.isManaged ? (
              <span className="inline-flex items-center rounded-full border border-gray-300 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                {translateString("Unmanaged")}
              </span>
            ) : (
              <></>
            )}
            {/*
             * Taking a node off the map. Deliberately here at the top rather
             * than buried: the operator arrives at this drawer having clicked
             * a node they did not want to see, and this is the answer to that.
             */}
            {props.onHideNode ? (
              <button
                type="button"
                className="ms-auto text-xs font-medium text-gray-500 underline hover:text-gray-700"
                data-testid="network-topology-hide-node"
                onClick={() => {
                  props.onHideNode?.(node);
                }}
              >
                {translateString("Hide from map")}
              </button>
            ) : (
              <></>
            )}
          </div>

          {monitorNotChecked && notCheckedQualifier ? (
            <div className="mt-1.5" data-testid={MONITOR_NOT_CHECKED_TEST_ID}>
              {/*
               * What it means for the status - it stays as it is until then -
               * in the hero's words for the same device.
               */}
              <p
                className="text-xs text-gray-500"
                data-testid={MONITOR_NOT_CHECKED_CAPTION_TEST_ID}
              >
                {translateString(
                  isBoundMonitorArchived
                    ? "Not checked until its monitor is unarchived"
                    : "Not checked until monitoring is back on",
                )}
              </p>
              {/*
               * Keyed per node and monitor: the drawer is re-rendered, not
               * remounted, for the next node, and a press in flight belongs
               * to the device it was made for.
               */}
              <DeviceMonitorNotCheckedActions
                key={`${node.id}:${monitorNotChecked.monitorId}`}
                monitorId={new ObjectID(monitorNotChecked.monitorId)}
                isArchived={isBoundMonitorArchived}
                monitorRoute={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.MONITOR_VIEW] as Route,
                  { modelId: new ObjectID(monitorNotChecked.monitorId) },
                )}
                readDeviceAgain={(): Promise<void> => {
                  return props.readMapAgain
                    ? props.readMapAgain()
                    : Promise.resolve();
                }}
                className="mt-1"
              />
            </div>
          ) : (
            <></>
          )}
        </div>

        {detailRows.length > 0 ? (
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              {translateString("Details")}
            </h3>
            <dl className="mt-2 space-y-1 text-sm text-gray-600">
              {detailRows.map(
                (
                  row: { label: string; value: string },
                  index: number,
                ): ReactElement => {
                  return (
                    <div key={index} className="flex justify-between gap-4">
                      <dt>{row.label}</dt>
                      <dd className="font-medium text-end">
                        {/* A MAC, a port or "120 Mbps" keeps its own order on an Arabic page. */}
                        <bdi>{row.value}</bdi>
                      </dd>
                    </div>
                  );
                },
              )}
            </dl>
          </div>
        ) : (
          <></>
        )}

        {/*
         * Where the network says this device is plugged in, when nobody
         * drew it. A register or a handset that only answers ping has no
         * LLDP to report, so its cable used to be a line somebody typed
         * under Device Links; now it is the port the switch learned the
         * device's MAC on. This is where the operator finds that out —
         * and finds out that the line moves with the device when it is
         * re-cabled, which a typed one never did.
         */}
        {learnedAttachment ? (
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              {translateString("Connected to")}
            </h3>
            <p
              className="mt-2 text-sm font-medium text-gray-900"
              data-testid="network-topology-learned-attachment"
            >
              {[
                learnedAttachment.switchName,
                learnedAttachment.port,
                typeof learnedAttachment.vlanId === "number"
                  ? `VLAN ${learnedAttachment.vlanId}`
                  : undefined,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {learnedAttachment.reportedBy
                ? translateString(
                    "Reported by Meraki, not drawn by hand — it follows this device to whichever port it is re-cabled to.",
                  )
                : translateString(
                    "Learned from the switch's forwarding or ARP table, not drawn by hand — it follows this device to whichever port it is re-cabled to.",
                  )}
            </p>
            {learnedAttachment.isSwitchPortDown ? (
              <p className="mt-1 text-xs font-medium text-red-600">
                {translateString("The switch reports that port down.")}
              </p>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}

        {/*
         * Issue #3745: "is it reachable, and how has it been?" answered from
         * the drawer, without leaving the map. Managed device nodes only —
         * an unmanaged neighbour has no row and no probe, and an endpoint
         * has no device page to be pinged from.
         */}
        {canRunDiagnosticsOnNode(node) ? (
          /*
           * Keyed per node: the drawer is re-rendered, not remounted, for
           * the next node the operator clicks, and the trend and the
           * diagnostics below hold per-device state (a fetch in flight, a
           * run being polled) that must not carry over to another device.
           */
          <div key={node.id} data-testid="network-topology-connectivity">
            <h3 className="text-sm font-semibold text-gray-900">
              {translateString("Connectivity")}
            </h3>
            <div className="mt-2">
              <DeviceLatencyTrend networkDeviceId={new ObjectID(node.id)} />
            </div>
            {props.canRunDiagnostics ? (
              <div className="mt-3">
                <DeviceDiagnostics networkDeviceId={new ObjectID(node.id)} />
              </div>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}

        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            {translateString("Links")} ({attachedEdges.length})
          </h3>
          {attachedEdges.length === 0 ? (
            <div className="mt-2">
              <p className="text-sm text-gray-500">
                {translateString("No discovered links on this device.")}
              </p>
              {/*
               * The follow-up question every isolated node provokes. Without
               * it the map states a fact and leaves the operator to guess at
               * a cause — which is exactly the complaint that "the router is
               * not linked to any of the devices" was.
               */}
              {isolationReason ? (
                <p
                  className="mt-2 rounded-md bg-gray-50 p-2 text-sm text-gray-600"
                  data-testid="network-topology-isolation-reason"
                >
                  {isolationReason}
                </p>
              ) : (
                <></>
              )}
            </div>
          ) : (
            <ul className="mt-1 divide-y divide-gray-100">
              {attachedEdges.map((edge: NetworkTopologyEdge): ReactElement => {
                const isFromEnd: boolean = edge.fromNodeId === node.id;
                const otherId: string = isFromEnd
                  ? edge.toNodeId
                  : edge.fromNodeId;
                const other: NetworkTopologyNode | undefined =
                  props.nodeById.get(otherId);
                const state: NetworkLinkState = linkStateForEdge(edge);
                const localEnd: NetworkTopologyEdgeEndpoint | undefined =
                  isFromEnd ? edge.fromInterface : edge.toInterface;
                const localPort: string | undefined = isFromEnd
                  ? edge.fromPort
                  : edge.toPort;
                /*
                 * A forwarding-table edge names the SWITCH end only: the
                 * device it learned answers ping and nothing else, so its
                 * own end has nothing to say and this line used to print
                 * "?". Show the port the switch learned it on instead —
                 * the one fact the table established — unless this end is
                 * known after all, which happens when LLDP also reported
                 * the pair and the merged edge carries both.
                 */
                const learnedEnds: FdbEdgeEnds | undefined = isFdbEdge(edge)
                  ? fdbEdgeEnds(edge)
                  : undefined;
                const describesSwitchEnd: boolean =
                  learnedEnds !== undefined &&
                  learnedEnds.learnedId === node.id &&
                  portLabelForEdgeEnd(localEnd, localPort) === undefined;
                const localSummary: string =
                  describesSwitchEnd && learnedEnds
                    ? describeEndpoint(
                        learnedEnds.learnerInterface,
                        learnedEnds.learnerPort,
                      )
                    : describeEndpoint(localEnd, localPort);
                return (
                  <li key={edgeKeyForEdge(edge)} className="py-2">
                    <button
                      type="button"
                      className="w-full text-start"
                      onClick={() => {
                        props.onSelectEdge(edge);
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                          style={{
                            backgroundColor:
                              state === "down" || state === "saturated"
                                ? LINK_STATE_COLORS[state]
                                : "#94a3b8",
                          }}
                        />
                        <span className="text-sm font-medium text-indigo-600 hover:text-indigo-800">
                          {other?.name || otherId}
                        </span>
                      </span>
                      <span className="mt-0.5 block ps-4 text-xs text-gray-500">
                        <bdi>{localSummary}</bdi>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {node.isManaged ? (
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              {translateString("Open")}
            </h3>
            <ul className="mt-2 space-y-2 text-sm">
              <li>
                <Link
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.NETWORK_DEVICE_VIEW] as Route,
                    { modelId: new ObjectID(node.id) },
                  )}
                  className="font-medium text-indigo-600 hover:text-indigo-800"
                >
                  {translateString("Device details")}
                </Link>
              </li>
            </ul>
          </div>
        ) : props.onAddToMonitoring ? (
          /*
           * The unmanaged counterpart of "Device details", and the answer to
           * the dead end this drawer used to be: everything above is what
           * the network reported about a device nobody is watching, and
           * until now the only thing an operator could do about it was hide
           * it from the map (issue #3435).
           */
          <div data-testid="network-topology-not-monitored">
            <h3 className="text-sm font-semibold text-gray-900">
              {translateString("Not monitored")}
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {isEndpoint
                ? translateString(
                    "OneUptime does not monitor this device yet. Add it to check it on a schedule, and pick who hears when it stops answering.",
                  )
                : translateString(
                    "This device was discovered by its neighbours. Add it to bring it into monitoring, pre-filled with what the map already knows.",
                  )}
            </p>
            {/*
             * Under the sentence, at its start: a button keeps a dialog
             * footer's left margin (md:ml-3) unless told otherwise. A
             * discovered device's opens the Discovered Devices list's own
             * dialog, and is named as that dialog is.
             */}
            <div className="mt-3 [&>button]:ml-0 [&>button]:md:ml-0">
              <Button
                title={
                  isEndpoint
                    ? translateString("Add to monitoring")
                    : translateString("Add to Monitoring")
                }
                icon={IconProp.Add}
                buttonSize={ButtonSize.Small}
                buttonStyle={ButtonStyleType.PRIMARY}
                dataTestId="network-topology-add-to-monitoring"
                onClick={() => {
                  props.onAddToMonitoring?.(node);
                }}
              />
            </div>
          </div>
        ) : (
          <></>
        )}
      </div>
    </SideOver>
  );
};

export default NetworkDeviceDetailPanel;
