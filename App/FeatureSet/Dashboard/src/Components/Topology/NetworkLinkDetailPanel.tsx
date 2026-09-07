import React, { FunctionComponent, ReactElement } from "react";
import SideOver, { SideOverSize } from "Common/UI/Components/SideOver/SideOver";
import {
  NetworkTopologyEdge,
  NetworkTopologyEdgeEndpoint,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import useTranslateValue from "Common/UI/Utils/Translation";
import {
  LINK_STATE_COLORS,
  NetworkLinkState,
  formatMbps,
  formatUtilization,
  linkStateForEdge,
} from "./NetworkTopologyMeta";
import {
  FdbEdgeEnds,
  fdbEdgeEnds,
  isFdbEdge,
  portLabelForEdgeEnd,
} from "../NetworkDevice/EndpointNodeUtil";

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
  /*
   * What to say when nothing identifies this end. The default is the
   * honest "Unknown interface"; the device end of a learned link passes
   * something better, because the switch end knows where the cable goes
   * even though this end reported nothing.
   */
  unknownLabel?: string | undefined;
}

const EndpointSection: FunctionComponent<EndpointSectionProps> = (
  props: EndpointSectionProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const endpoint: NetworkTopologyEdgeEndpoint | undefined = props.endpoint;
  const interfaceLabel: string =
    portLabelForEdgeEnd(endpoint, props.portLabel) ||
    props.unknownLabel ||
    "Unknown interface";

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
   * A learned link is one a switch's forwarding table drew: the from end
   * LEARNED the to end's MAC on one of its ports. Neither end advertised
   * the other, so the vocabulary below changes — nothing was "reported"
   * or "declared", something was learned, and the drawer has to say by
   * whom and on which port.
   */
  /*
   * "Learned" in the sense the drawer means it - placed by a switch's
   * tables and nothing else. A pair a discovery protocol also reports is a
   * discovered link that a table happens to confirm, and is described as
   * one; the fdb chip still says the table agrees.
   */
  const isLearned: boolean =
    isFdbEdge(edge) &&
    !(edge.protocols || []).some((protocol: string) => {
      return protocol === "lldp" || protocol === "cdp";
    });
  const fromPortLabel: string | undefined = portLabelForEdgeEnd(
    edge.fromInterface,
    edge.fromPort,
  );
  const toPortLabel: string | undefined = portLabelForEdgeEnd(
    edge.toInterface,
    edge.toPort,
  );

  /*
   * Which end LEARNED, for a learned link. Not "the from end": the pair may
   * have been joined the other way round before the attachment merged in,
   * and the sentence below names the learner's own port.
   */
  const learnedEnds: FdbEdgeEnds | undefined = isLearned
    ? fdbEdgeEnds(edge)
    : undefined;
  const learnerName: string = learnedEnds
    ? learnedEnds.learnerId === edge.fromNodeId
      ? fromName
      : toName
    : fromName;
  const learnedName: string = learnedEnds
    ? learnedEnds.learnedId === edge.fromNodeId
      ? fromName
      : toName
    : toName;
  const learnerPortLabel: string | undefined = learnedEnds
    ? portLabelForEdgeEnd(learnedEnds.learnerInterface, learnedEnds.learnerPort)
    : fromPortLabel;
  const learnedEndIsFrom: boolean = Boolean(
    learnedEnds && learnedEnds.learnedId === edge.fromNodeId,
  );

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
  /*
   * The parent's OWN port, for the learned-link sentence — the one it
   * learned the child's MAC on, whichever way the edge happens to be
   * stored.
   */
  const parentPortLabel: string | undefined =
    edge.parentNodeId === edge.fromNodeId ? fromPortLabel : toPortLabel;

  return (
    <SideOver
      title={`${fromName} ↔ ${toName}`}
      description={
        isLearned
          ? translateString("Learned link") || "Learned link"
          : translateString("Network link") || "Network link"
      }
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
         * Shown only when somebody declared a direction. Absent is not
         * "these are peers", it is "nobody said" — and stating the
         * inference as though it were a fact is exactly the confusion this
         * whole field exists to end. So there is no "hierarchy: inferred"
         * row; there is simply nothing here until there is something to
         * say.
         */}
        {parentName && childName ? (
          <div className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
            {isLearned && edge.parentNodeId === learnedEnds?.learnerId ? (
              /*
               * Not "declared": nobody said this. The switch learned the
               * child's MAC on an access port, which is the table's own
               * statement that the child hangs off it.
               */
              <>
                <span className="font-medium text-gray-900">{parentName}</span>
                {" learned "}
                <span className="font-medium text-gray-900">{childName}</span>
                {"'s MAC address"}
                {parentPortLabel ? ` on ${parentPortLabel}` : ""}
                {
                  " in its forwarding or ARP table, so the Parent-Child view draws "
                }
                {childName}
                {" beneath it."}
              </>
            ) : isLearned ? (
              /*
               * The table placed the cable, but somebody ELSE said which end
               * is up - a hand-drawn link or a rule on the same pair, whose
               * parent the map keeps over the one the table implied. Both
               * facts are stated, and neither is dressed up as the other.
               */
              <>
                <span className="font-medium text-gray-900">{learnerName}</span>
                {" learned "}
                <span className="font-medium text-gray-900">{learnedName}</span>
                {"'s MAC address"}
                {learnerPortLabel ? ` on ${learnerPortLabel}` : ""}
                {" in its forwarding or ARP table; "}
                <span className="font-medium text-gray-900">{parentName}</span>
                {" is the declared parent, so the Parent-Child view draws "}
                {childName}
                {" beneath it."}
              </>
            ) : (
              <>
                <span className="font-medium text-gray-900">{parentName}</span>
                {" is the parent of "}
                <span className="font-medium text-gray-900">{childName}</span>
                {" — declared, not inferred. The Parent-Child view draws "}
                {childName}
                {" beneath it."}
              </>
            )}
          </div>
        ) : isLearned ? (
          /*
           * A learned link with no parent: the learned end is a router, a
           * firewall or another switch, whose MAC a switch learns on the
           * port that leads TOWARDS it, so the table places the cable
           * without saying which box is upstream. Said here, because the
           * Parent-Child view will go on inferring for this pair and the
           * operator deserves to know that is deliberate.
           */
          <p
            className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600"
            data-testid="network-topology-learned-link-note"
          >
            <span className="font-medium text-gray-900">{learnerName}</span>
            {" learned "}
            <span className="font-medium text-gray-900">{learnedName}</span>
            {"'s MAC address"}
            {learnerPortLabel ? ` on ${learnerPortLabel}` : ""}
            {
              " in its forwarding or ARP table. That places the cable on a port without saying which end is upstream — a switch learns a router's MAC on the port that leads towards it — so the Parent-Child view keeps inferring the hierarchy for this pair."
            }
          </p>
        ) : null}

        <EndpointSection
          deviceName={fromName}
          portLabel={edge.fromPort}
          endpoint={edge.fromInterface}
          unknownLabel={
            isLearned && learnedEndIsFrom
              ? `Attached via ${learnerName}${
                  learnerPortLabel ? ` ${learnerPortLabel}` : ""
                }`
              : undefined
          }
        />

        <EndpointSection
          deviceName={toName}
          portLabel={edge.toPort}
          endpoint={edge.toInterface}
          unknownLabel={
            isLearned && !learnedEndIsFrom
              ? `Attached via ${learnerName}${
                  learnerPortLabel ? ` ${learnerPortLabel}` : ""
                }`
              : undefined
          }
        />
      </div>
    </SideOver>
  );
};

export default NetworkLinkDetailPanel;
