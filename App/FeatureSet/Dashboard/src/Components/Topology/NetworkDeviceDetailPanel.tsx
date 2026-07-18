import React, { FunctionComponent, ReactElement, useMemo } from "react";
import SideOver, { SideOverSize } from "Common/UI/Components/SideOver/SideOver";
import Link from "Common/UI/Components/Link/Link";
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
  linkStateForEdge,
} from "./NetworkTopologyMeta";

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

  const detailRows: Array<{ label: string; value: string }> = [];
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
        node.isManaged
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
          {!node.isManaged ? (
            <span className="inline-flex items-center rounded-full border border-gray-300 px-2.5 py-0.5 text-xs font-medium text-gray-600">
              {translateString("Unmanaged") || "Unmanaged"}
            </span>
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
            <p className="mt-2 text-sm text-gray-500">
              {translateString("No discovered links on this device.") ||
                "No discovered links on this device."}
            </p>
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
        ) : (
          <></>
        )}
      </div>
    </SideOver>
  );
};

export default NetworkDeviceDetailPanel;
