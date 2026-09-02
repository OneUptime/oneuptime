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
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import useTranslateValue from "Common/UI/Utils/Translation";
import {
  LINK_STATE_COLORS,
  NetworkLinkState,
  describeEndpoint,
  edgeKeyForEdge,
  isolationReasonForNode,
  linkStateForEdge,
} from "./NetworkTopologyMeta";
import {
  isUnclassifiedNode,
  roleLabelForNode,
} from "../NetworkDevice/TopologyNodeShape";

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
   * Turn this unmanaged neighbour into a monitored NetworkDevice. Optional
   * for the same reason as onHideNode — a viewer without create permission
   * is shown the panel without the action rather than an action that fails
   * — and the caller decides adoptability, so the panel does not have to
   * know which node kinds qualify.
   */
  onAddToMonitoring?: ((node: NetworkTopologyNode) => void) | undefined;
}

const STATUS_COLORS: Record<string, string> = {
  up: "#16a34a",
  down: "#dc2626",
  unknown: "#9ca3af",
};

const NetworkDeviceDetailPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const { node } = props;

  const attachedEdges: Array<NetworkTopologyEdge> = useMemo(() => {
    return props.edges.filter((edge: NetworkTopologyEdge) => {
      return edge.fromNodeId === node.id || edge.toNodeId === node.id;
    });
  }, [props.edges, node.id]);

  const isolationReason: string | undefined = useMemo(() => {
    return isolationReasonForNode(node, attachedEdges.length > 0);
  }, [node, attachedEdges.length]);

  const isEndpoint: boolean = node.kind === "endpoint";

  const detailRows: Array<{ label: string; value: string }> = [];
  /*
   * First row, because it is what the shape on the map claimed and this
   * drawer is where somebody comes to check that claim. Omitted when the
   * evidence named no role — "Unknown type" is not worth a row.
   */
  if (!isUnclassifiedNode(node)) {
    detailRows.push({
      label: translateString("Type") || "Type",
      value: roleLabelForNode(node),
    });
  }
  if (node.macAddress) {
    detailRows.push({
      label: translateString("MAC address") || "MAC address",
      value: node.macAddress,
    });
  }
  if (node.ipAddress) {
    detailRows.push({
      label: translateString("IP address") || "IP address",
      value: node.ipAddress,
    });
  }
  if (node.classification) {
    detailRows.push({
      label: translateString("Classification") || "Classification",
      value: node.classification,
    });
  }
  if (typeof node.vlanId === "number") {
    detailRows.push({
      label: translateString("VLAN") || "VLAN",
      value: `VLAN ${node.vlanId}`,
    });
  }
  if (node.sysName) {
    detailRows.push({
      label: translateString("System name") || "System name",
      value: node.sysName,
    });
  }
  if (node.vendor) {
    detailRows.push({
      label: translateString("Vendor") || "Vendor",
      value: node.vendor,
    });
  }
  if (node.deviceModel) {
    detailRows.push({
      label: node.isManaged
        ? translateString("Model") || "Model"
        : translateString("Platform") || "Platform",
      value: node.deviceModel,
    });
  }
  if (node.interfacesUp !== undefined || node.interfacesDown !== undefined) {
    detailRows.push({
      label: translateString("Interfaces") || "Interfaces",
      value: `${node.interfacesUp ?? 0} up / ${node.interfacesDown ?? 0} down`,
    });
  }

  return (
    <SideOver
      title={node.name}
      description={
        isEndpoint
          ? translateString("Discovered endpoint") || "Discovered endpoint"
          : node.isManaged
            ? translateString("Network device") || "Network device"
            : translateString("Unmanaged neighbor") || "Unmanaged neighbor"
      }
      onClose={props.onClose}
      size={SideOverSize.Small}
    >
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{
              backgroundColor:
                STATUS_COLORS[node.status] || STATUS_COLORS["unknown"],
            }}
          />
          <span className="text-sm font-medium text-gray-900 capitalize">
            {node.status}
          </span>
          {isEndpoint ? (
            <span className="inline-flex items-center rounded-full border border-violet-300 bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700">
              {translateString("Endpoint") || "Endpoint"}
            </span>
          ) : !node.isManaged ? (
            <span className="inline-flex items-center rounded-full border border-gray-300 px-2.5 py-0.5 text-xs font-medium text-gray-600">
              {translateString("Unmanaged") || "Unmanaged"}
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
              className="ml-auto text-xs font-medium text-gray-500 underline hover:text-gray-700"
              data-testid="network-topology-hide-node"
              onClick={() => {
                props.onHideNode?.(node);
              }}
            >
              {translateString("Hide from map") || "Hide from map"}
            </button>
          ) : (
            <></>
          )}
        </div>

        {detailRows.length > 0 ? (
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              {translateString("Details") || "Details"}
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
                      <dd className="font-medium text-right">{row.value}</dd>
                    </div>
                  );
                },
              )}
            </dl>
          </div>
        ) : (
          <></>
        )}

        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            {translateString("Links") || "Links"} ({attachedEdges.length})
          </h3>
          {attachedEdges.length === 0 ? (
            <div className="mt-2">
              <p className="text-sm text-gray-500">
                {translateString("No discovered links on this device.") ||
                  "No discovered links on this device."}
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
                const localSummary: string = describeEndpoint(
                  isFromEnd ? edge.fromInterface : edge.toInterface,
                  isFromEnd ? edge.fromPort : edge.toPort,
                );
                return (
                  <li key={edgeKeyForEdge(edge)} className="py-2">
                    <button
                      type="button"
                      className="w-full text-left"
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
                      <span className="mt-0.5 block pl-4 text-xs text-gray-500">
                        {localSummary}
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
              {translateString("Open") || "Open"}
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
                  {translateString("Device details") || "Device details"}
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
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              {translateString("Not monitored") || "Not monitored"}
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {translateString(
                "This device was discovered by its neighbours. Add it to bring it into monitoring, pre-filled with what the map already knows.",
              ) ||
                "This device was discovered by its neighbours. Add it to bring it into monitoring, pre-filled with what the map already knows."}
            </p>
            <Button
              title={
                translateString("Add to Monitoring") || "Add to Monitoring"
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
        ) : (
          <></>
        )}
      </div>
    </SideOver>
  );
};

export default NetworkDeviceDetailPanel;
