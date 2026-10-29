import {
  ConversationDiagramLayout,
  DiagramBand,
  DiagramNode,
  LABEL_GUTTER,
  BAR_WIDTH,
  layoutConversationDiagram,
} from "./TrafficConversationLayout";
import { formatTrafficBytes } from "./NetworkTrafficFormat";
import {
  TrafficAddressLabel,
  getTrafficAddressLabel,
  getTrafficAddressText,
} from "./NetworkTrafficAddressNames";
import { NetworkTrafficConversationRow } from "Common/Types/NetFlow/NetworkTraffic";
import { NetworkTrafficAddressNames } from "Common/Types/NetFlow/NetworkAddressName";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";

/*
 * Who talks to whom, drawn: the window's busiest conversations as bands from
 * the senders on the left to the receivers on the right, each as thick as its
 * bytes (TrafficConversationLayout). Pointing at a band lights it and says
 * what it carried; a click on a band narrows the page to that conversation,
 * a click on an address to everything it sent or received.
 *
 * The colours are mid tones, which read the same on the light and the dark
 * theme; the labels take the text colour of the card they are on.
 *
 * An address the project has a name for (issue #5340) is labelled by its
 * name, with the address under it in small grey mono; what a label cuts
 * short, its title (under the pointer) says whole.
 *
 * The flow reads left to right in every language, as the list's arrow
 * does: senders on the left, receivers on the right, with "Sent by" and
 * "Received by" over them - on a Persian page too, where the page itself
 * reads right to left.
 */

export interface ComponentProps {
  conversations: Array<NetworkTrafficConversationRow>;
  // What the page's addresses are called.
  addressNames?: NetworkTrafficAddressNames | undefined;
  onSelectConversation: (sourceIp: string, destinationIp: string) => void;
  onSelectSource: (address: string) => void;
  onSelectDestination: (address: string) => void;
}

// A label longer than this is cut (the title holds it all).
export const MAX_LABEL_CHARACTERS: number = 22;

export function shortenDiagramLabel(text: string): string {
  const characters: Array<string> = Array.from(text);

  return characters.length > MAX_LABEL_CHARACTERS
    ? `${characters.slice(0, MAX_LABEL_CHARACTERS - 1).join("")}…`
    : text;
}

const TrafficConversationDiagram: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [hovered, setHovered] = useState<string | null>(null);

  const labelOf: (address: string) => TrafficAddressLabel = (
    address: string,
  ): TrafficAddressLabel => {
    return getTrafficAddressLabel(address, props.addressNames);
  };

  // Two lines a label when any address shown has a name.
  const hasTwoLineLabels: boolean = props.conversations.some(
    (conversation: NetworkTrafficConversationRow): boolean => {
      return Boolean(
        labelOf(conversation.sourceIp).name ||
          labelOf(conversation.destinationIp).name,
      );
    },
  );

  const layout: ConversationDiagramLayout = useMemo(() => {
    return layoutConversationDiagram(props.conversations, {
      hasTwoLineLabels: hasTwoLineLabels,
    });
  }, [props.conversations, hasTwoLineLabels]);

  if (layout.nodes.length === 0) {
    return <></>;
  }

  const bandKey: (band: DiagramBand) => string = (
    band: DiagramBand,
  ): string => {
    return `${band.sourceIp}>${band.destinationIp}`;
  };

  return (
    <figure
      dir="ltr"
      className="text-gray-700"
      aria-label={translator.translateText(
        "The busiest conversations, from the address that sent to the address that received, each band as thick as its bytes",
      )}
      data-testid="traffic-conversation-diagram"
    >
      <div className="mb-2 flex justify-between text-xs font-medium text-gray-500">
        <span>{translator.translateText("Sent by")}</span>
        <span>{translator.translateText("Received by")}</span>
      </div>
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="h-auto w-full"
        role="img"
      >
        <g className="text-indigo-500">
          {layout.bands.map((band: DiagramBand): ReactElement => {
            const key: string = bandKey(band);
            const isLit: boolean = hovered === key;
            const isDimmed: boolean = hovered !== null && !isLit;

            return (
              <path
                key={key}
                d={band.path}
                fill="currentColor"
                fillOpacity={isLit ? 0.6 : isDimmed ? 0.12 : 0.32}
                className="cursor-pointer transition-[fill-opacity] duration-150"
                onMouseEnter={() => {
                  setHovered(key);
                }}
                onMouseLeave={() => {
                  setHovered(null);
                }}
                onClick={() => {
                  props.onSelectConversation(band.sourceIp, band.destinationIp);
                }}
                data-testid="traffic-conversation-band"
              >
                <title>
                  {translator.translateTemplate(
                    "{{source}} to {{destination}}: {{bytes}}",
                    {
                      source: getTrafficAddressText(labelOf(band.sourceIp)),
                      destination: getTrafficAddressText(
                        labelOf(band.destinationIp),
                      ),
                      bytes: formatTrafficBytes(band.octets),
                    },
                  )}
                </title>
              </path>
            );
          })}
        </g>
        {layout.nodes.map((node: DiagramNode): ReactElement => {
          const isSource: boolean = node.side === "source";
          const labelX: number = isSource
            ? LABEL_GUTTER - 8
            : layout.width - LABEL_GUTTER + 8;
          const label: TrafficAddressLabel = labelOf(node.address);

          return (
            <g
              key={`${node.side}-${node.address}`}
              className="cursor-pointer"
              onClick={() => {
                if (isSource) {
                  props.onSelectSource(node.address);
                } else {
                  props.onSelectDestination(node.address);
                }
              }}
              data-testid={`traffic-conversation-${node.side}`}
            >
              <title>
                {translator.translateTemplate(
                  isSource
                    ? "{{address}} sent {{bytes}}"
                    : "{{address}} received {{bytes}}",
                  {
                    address: getTrafficAddressText(label),
                    bytes: formatTrafficBytes(node.octets),
                  },
                )}
              </title>
              <rect
                x={node.x}
                y={node.y}
                width={BAR_WIDTH}
                height={node.height}
                rx={2}
                className={isSource ? "text-indigo-600" : "text-emerald-600"}
                fill="currentColor"
              />
              {label.name ? (
                /*
                 * A name on the first line, alone - it is the longest thing
                 * a label holds - and the address with the bytes under it.
                 */
                <>
                  <text
                    x={labelX}
                    y={node.labelY - 7}
                    textAnchor={isSource ? "end" : "start"}
                    dominantBaseline="middle"
                    fill="currentColor"
                    fontSize={12}
                    data-testid="traffic-conversation-label"
                  >
                    {shortenDiagramLabel(label.name)}
                  </text>
                  <text
                    x={labelX}
                    y={node.labelY + 8}
                    textAnchor={isSource ? "end" : "start"}
                    dominantBaseline="middle"
                    fill="currentColor"
                    className="text-gray-500"
                    fontSize={11}
                    direction="ltr"
                    data-testid="traffic-conversation-label-address"
                  >
                    <tspan className="font-mono">
                      {shortenDiagramLabel(node.address)}
                    </tspan>
                    <tspan dx={6}>{formatTrafficBytes(node.octets)}</tspan>
                  </text>
                </>
              ) : (
                <text
                  x={labelX}
                  y={node.labelY}
                  textAnchor={isSource ? "end" : "start"}
                  dominantBaseline="middle"
                  fill="currentColor"
                  className="font-mono"
                  fontSize={12}
                  data-testid="traffic-conversation-label"
                >
                  {shortenDiagramLabel(node.address)}
                  <tspan
                    className="text-gray-500"
                    fill="currentColor"
                    fontSize={11}
                    dx={6}
                  >
                    {formatTrafficBytes(node.octets)}
                  </tspan>
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
};

export default TrafficConversationDiagram;
