import React, { FunctionComponent, ReactElement } from "react";
import SideOver, { SideOverSize } from "Common/UI/Components/SideOver/SideOver";
import {
  NetworkTopologyEdge,
  NetworkTopologyEdgeEndpoint,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import { getNetworkControllerProviderShortTitle } from "Common/Types/NetworkController/NetworkControllerProvider";
import useTranslateValue from "Common/UI/Utils/Translation";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  LINK_STATE_COLORS,
  NetworkLinkState,
  formatMbps,
  formatUtilization,
  linkStateForEdge,
  linkSourceLabelsForEdge,
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

// Looked up in the reader's language where the panel draws them.
const STATE_LABELS: Record<NetworkLinkState, string> = {
  down: translationKey("Link down"),
  saturated: translationKey("High utilization"),
  healthy: translationKey("Healthy"),
  unknown: translationKey("No operational data"),
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
    translateString("Unknown interface") ||
    "";

  const rows: Array<{
    label: string;
    value: string;
    color?: string | undefined;
  }> = [];
  if (endpoint?.isOperationallyUp !== undefined) {
    rows.push({
      label: translateString("Operational status") || "",
      value: (endpoint.isOperationallyUp
        ? translateString("Up")
        : translateString("Down")) as string,
      color: endpoint.isOperationallyUp ? "#16a34a" : "#dc2626",
    });
  }
  if (endpoint?.isAdministrativelyUp !== undefined) {
    rows.push({
      label: translateString("Admin status") || "",
      value: (endpoint.isAdministrativelyUp
        ? translateString("Up")
        : translateString("Down")) as string,
    });
  }
  if (endpoint?.utilizationPercent !== undefined) {
    rows.push({
      label: translateString("Utilization") || "",
      value: formatUtilization(endpoint.utilizationPercent),
      color: endpoint.utilizationPercent >= 80 ? "#f59e0b" : undefined,
    });
  }
  if (endpoint?.inRateMbps !== undefined) {
    rows.push({
      label: translateString("In rate") || "",
      value: formatMbps(endpoint.inRateMbps),
    });
  }
  if (endpoint?.outRateMbps !== undefined) {
    rows.push({
      label: translateString("Out rate") || "",
      value: formatMbps(endpoint.outRateMbps),
    });
  }
  if (endpoint?.errorsPerSecond !== undefined) {
    rows.push({
      label: translateString("Errors") || "",
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
          {translateString("No interface metrics for this end.")}
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
                    {/* "120 Mbps" and "0/s" keep their order on an Arabic page. */}
                    <bdi>{row.value}</bdi>
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
  const translator: Translator = useTranslator();
  const { edge } = props;
  const state: NetworkLinkState = linkStateForEdge(edge);
  const fromName: string =
    props.fromNode?.name || translateString("Unknown device") || "";
  const toName: string =
    props.toNode?.name || translateString("Unknown device") || "";

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
   * How the learned end was placed, the opening of every sentence below. A
   * controller's client list says where a client is; nobody learned anything
   * from a table of theirs, and the drawer must not say so.
   */
  const reporter: string | undefined = getNetworkControllerProviderShortTitle(
    edge.reportedBy,
  );
  const learnedSlots: Record<string, ReactElement> = {
    learned: <span className="font-medium text-gray-900">{learnedName}</span>,
    learner: <span className="font-medium text-gray-900">{learnerName}</span>,
  };
  const learnedAttachmentWords: ReactElement = reporter ? (
    <TranslatedSentence
      template={
        learnerPortLabel
          ? "{{reporter}} lists {{learned}} as a client of {{learner}} on {{port}}"
          : "{{reporter}} lists {{learned}} as a client of {{learner}}"
      }
      values={{ reporter: reporter, port: learnerPortLabel || "" }}
      slots={learnedSlots}
    />
  ) : (
    <TranslatedSentence
      template={
        learnerPortLabel
          ? "{{learner}} learned {{learned}}'s MAC address on {{port}} in its forwarding or ARP table"
          : "{{learner}} learned {{learned}}'s MAC address in its forwarding or ARP table"
      }
      values={{ port: learnerPortLabel || "" }}
      slots={learnedSlots}
    />
  );

  // The end a learned link's silent device hangs off, by its switch port.
  const attachedViaLabel: string = learnerPortLabel
    ? translator.translateTemplate("Attached via {{device}} {{port}}", {
        device: learnerName,
        port: learnerPortLabel,
      })
    : translator.translateTemplate("Attached via {{device}}", {
        device: learnerName,
      });

  return (
    <SideOver
      title={`${fromName} ↔ ${toName}`}
      description={
        (isLearned
          ? translateString("Learned link")
          : translateString("Network link")) || ""
      }
      onClose={props.onClose}
      size={SideOverSize.Small}
    >
      {/*
       * Its own top spacing from sm up, as the device drawer beside it on
       * the map: the side-over leaves it to its content there.
       */}
      <div className="space-y-6 sm:pt-6">
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
          {linkSourceLabelsForEdge(edge).map((label: string): ReactElement => {
            return (
              <span
                key={label}
                className="inline-flex items-center rounded-full border border-gray-300 px-2.5 py-0.5 text-xs font-medium text-gray-600"
              >
                {label}
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
              <TranslatedSentence
                template="{{attachment}}, so the Parent-Child view draws {{child}} beneath it."
                values={{ child: childName }}
                slots={{ attachment: learnedAttachmentWords }}
              />
            ) : isLearned ? (
              /*
               * The table placed the cable, but somebody ELSE said which end
               * is up - a hand-drawn link or a rule on the same pair, whose
               * parent the map keeps over the one the table implied. Both
               * facts are stated, and neither is dressed up as the other.
               */
              <TranslatedSentence
                template="{{attachment}}; {{parent}} is the declared parent, so the Parent-Child view draws {{child}} beneath it."
                values={{ child: childName }}
                slots={{
                  attachment: learnedAttachmentWords,
                  parent: (
                    <span className="font-medium text-gray-900">
                      {parentName}
                    </span>
                  ),
                }}
              />
            ) : (
              <TranslatedSentence
                template="{{parent}} is the parent of {{child}} — declared, not inferred. The Parent-Child view draws {{childName}} beneath it."
                values={{ childName: childName }}
                slots={{
                  parent: (
                    <span className="font-medium text-gray-900">
                      {parentName}
                    </span>
                  ),
                  child: (
                    <span className="font-medium text-gray-900">
                      {childName}
                    </span>
                  ),
                }}
              />
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
            <TranslatedSentence
              template="{{attachment}}. That places the cable on a port without saying which end is upstream — a switch learns a router's MAC on the port that leads towards it — so the Parent-Child view keeps inferring the hierarchy for this pair."
              slots={{ attachment: learnedAttachmentWords }}
            />
          </p>
        ) : null}

        <EndpointSection
          deviceName={fromName}
          portLabel={edge.fromPort}
          endpoint={edge.fromInterface}
          unknownLabel={
            isLearned && learnedEndIsFrom ? attachedViaLabel : undefined
          }
        />

        <EndpointSection
          deviceName={toName}
          portLabel={edge.toPort}
          endpoint={edge.toInterface}
          unknownLabel={
            isLearned && !learnedEndIsFrom ? attachedViaLabel : undefined
          }
        />
      </div>
    </SideOver>
  );
};

export default NetworkLinkDetailPanel;
