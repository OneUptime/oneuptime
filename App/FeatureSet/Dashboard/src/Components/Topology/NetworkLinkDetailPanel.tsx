import React, { FunctionComponent, ReactElement } from "react";
import SideOver, { SideOverSize } from "Common/UI/Components/SideOver/SideOver";
import {
  NetworkTopologyEdge,
  NetworkTopologyEdgeEndpoint,
  NetworkTopologyEdgeInference,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import OneUptimeDate from "Common/Types/Date";
import useTranslateValue from "Common/UI/Utils/Translation";
import {
  LINK_STATE_COLORS,
  NetworkLinkState,
  formatMbps,
  formatUtilization,
  linkStateForEdge,
} from "./NetworkTopologyMeta";

/*
 * Drill-down for one network link: state, discovery protocols, and the
 * operational detail of the interface at each end (name, oper/admin
 * status, utilization, in/out rates, errors). Data is whatever the
 * topology endpoint could resolve — ends without a matched interface row
 * show just the advertised port id.
 */

export interface ComponentProps {
  edge: NetworkTopologyEdge;
  fromNode: NetworkTopologyNode | undefined;
  toNode: NetworkTopologyNode | undefined;
  onClose: () => void;
}

const STATE_LABELS: Record<NetworkLinkState, string> = {
  down: "Link down",
  saturated: "High utilization",
  healthy: "Healthy",
  unknown: "No operational data",
};

interface EndpointSectionProps {
  deviceName: string;
  portLabel: string | undefined;
  endpoint: NetworkTopologyEdgeEndpoint | undefined;
}

const EndpointSection: FunctionComponent<EndpointSectionProps> = (
  props: EndpointSectionProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const endpoint: NetworkTopologyEdgeEndpoint | undefined = props.endpoint;
  const interfaceLabel: string =
    endpoint?.interfaceName ||
    props.portLabel ||
    (endpoint?.interfaceIndex !== undefined
      ? `if${endpoint.interfaceIndex}`
      : "Unknown interface");

  const rows: Array<{
    label: string;
    value: string;
    color?: string | undefined;
  }> = [];
  if (endpoint?.isOperationallyUp !== undefined) {
    rows.push({
      label: translateString("Operational status") || "Operational status",
      value: endpoint.isOperationallyUp ? "Up" : "Down",
      color: endpoint.isOperationallyUp ? "#16a34a" : "#dc2626",
    });
  }
  if (endpoint?.isAdministrativelyUp !== undefined) {
    rows.push({
      label: translateString("Admin status") || "Admin status",
      value: endpoint.isAdministrativelyUp ? "Up" : "Down",
    });
  }
  if (endpoint?.utilizationPercent !== undefined) {
    rows.push({
      label: translateString("Utilization") || "Utilization",
      value: formatUtilization(endpoint.utilizationPercent),
      color: endpoint.utilizationPercent >= 80 ? "#f59e0b" : undefined,
    });
  }
  if (endpoint?.inRateMbps !== undefined) {
    rows.push({
      label: translateString("In rate") || "In rate",
      value: formatMbps(endpoint.inRateMbps),
    });
  }
  if (endpoint?.outRateMbps !== undefined) {
    rows.push({
      label: translateString("Out rate") || "Out rate",
      value: formatMbps(endpoint.outRateMbps),
    });
  }
  if (endpoint?.errorsPerSecond !== undefined) {
    rows.push({
      label: translateString("Errors") || "Errors",
      value: `${endpoint.errorsPerSecond}/s`,
    });
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900">
        {props.deviceName}
      </h3>
      <p className="mt-0.5 text-xs text-gray-500">{interfaceLabel}</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">
          {translateString("No interface metrics for this end.") ||
            "No interface metrics for this end."}
        </p>
      ) : (
        <dl className="mt-2 space-y-1 text-sm text-gray-600">
          {rows.map(
            (
              row: {
                label: string;
                value: string;
                color?: string | undefined;
              },
              index: number,
            ): ReactElement => {
              return (
                <div key={index} className="flex justify-between gap-4">
                  <dt>{row.label}</dt>
                  <dd
                    className="font-medium"
                    style={row.color ? { color: row.color } : undefined}
                  >
                    {row.value}
                  </dd>
                </div>
              );
            },
          )}
        </dl>
      )}
    </div>
  );
};

const NetworkLinkDetailPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const { edge } = props;
  const state: NetworkLinkState = linkStateForEdge(edge);
  const fromName: string = props.fromNode?.name || "Unknown device";
  const toName: string = props.toNode?.name || "Unknown device";

  /*
   * `parentNodeId` names an END, not a side, so which of the two labels it
   * refers to has to be resolved rather than assumed — a link stored
   * switch-to-AP and one stored AP-to-switch can declare the same
   * hierarchy.
   */
  const parentName: string | null =
    edge.parentNodeId === edge.fromNodeId
      ? fromName
      : edge.parentNodeId === edge.toNodeId
        ? toName
        : null;
  const childName: string | null =
    parentName === null ? null : parentName === fromName ? toName : fromName;

  const inference: NetworkTopologyEdgeInference | undefined = edge.inferredFrom;

  const inferenceRows: Array<{ label: string; value: string }> = [];
  if (inference) {
    inferenceRows.push({ label: "MAC address", value: inference.macAddress });
    if (inference.ipAddress) {
      inferenceRows.push({ label: "IP address", value: inference.ipAddress });
    }
    if (typeof inference.vlanId === "number") {
      inferenceRows.push({ label: "VLAN", value: String(inference.vlanId) });
    }
    if (inference.lastSeenAt) {
      inferenceRows.push({
        label: "Last seen on this port",
        value: OneUptimeDate.getDateAsLocalFormattedString(
          OneUptimeDate.fromString(inference.lastSeenAt),
        ),
      });
    }
  }

  return (
    <SideOver
      title={`${fromName} ↔ ${toName}`}
      description={translateString("Network link") || "Network link"}
      onClose={props.onClose}
      size={SideOverSize.Small}
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-white"
            style={{
              backgroundColor:
                state === "down" || state === "saturated"
                  ? LINK_STATE_COLORS[state]
                  : "#64748b",
            }}
          >
            {translateString(STATE_LABELS[state]) || STATE_LABELS[state]}
          </span>
          {(edge.protocols || []).map((protocol: string): ReactElement => {
            return (
              <span
                key={protocol}
                className="inline-flex items-center rounded-full border border-gray-300 px-2.5 py-0.5 text-xs font-medium text-gray-600"
              >
                {protocol.toUpperCase()}
              </span>
            );
          })}
        </div>

        {/*
         * Shown only when the direction is known. Absent is not "these are
         * peers", it is "nobody said" — and stating a guess as though it
         * were a fact is exactly the confusion this field exists to end.
         *
         * There are now two ways to know, and they are not the same
         * strength of claim, so they are not worded the same. A declared
         * parent is somebody's statement. An inferred one is read off a
         * switch's forwarding database, which is evidence rather than
         * testimony — good evidence, but the operator is entitled to know
         * which of the two they are being shown before they act on it.
         */}
        {parentName && childName ? (
          <div className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
            <span className="font-medium text-gray-900">{parentName}</span>
            {" is the parent of "}
            <span className="font-medium text-gray-900">{childName}</span>
            {inference
              ? " — worked out from the forwarding database, not declared. The Parent-Child view draws "
              : " — declared, not inferred. The Parent-Child view draws "}
            {childName}
            {" beneath it."}
          </div>
        ) : null}

        {/*
         * The receipt for an inferred cable.
         *
         * Nothing reported this link: it exists because a MAC in the
         * switch's table was recognised as a device we already manage. An
         * operator asked to trust that — and to stop drawing links by hand
         * because of it — should be able to see the evidence and go and
         * check it, rather than being told a cable is there.
         */}
        {inference ? (
          <div className="rounded-md border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-600">
            <div className="font-medium text-gray-900">
              {translateString("Discovered from the MAC address table") ||
                "Discovered from the MAC address table"}
            </div>
            <div className="mt-1">
              {inference.matchedOn === "mac"
                ? "Matched on MAC address"
                : "Matched on IP address, joined through the router's ARP table"}
            </div>
            <dl className="mt-2 space-y-1">
              {inferenceRows.map(
                (row: { label: string; value: string }): ReactElement => {
                  return (
                    <div className="flex justify-between gap-4" key={row.label}>
                      <dt className="text-gray-500">
                        {translateString(row.label) || row.label}
                      </dt>
                      <dd className="font-medium text-gray-900">{row.value}</dd>
                    </div>
                  );
                },
              )}
            </dl>
          </div>
        ) : null}

        <EndpointSection
          deviceName={fromName}
          portLabel={edge.fromPort}
          endpoint={edge.fromInterface}
        />

        <EndpointSection
          deviceName={toName}
          portLabel={edge.toPort}
          endpoint={edge.toInterface}
        />
      </div>
    </SideOver>
  );
};

export default NetworkLinkDetailPanel;
