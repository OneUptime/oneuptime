import {
  ConversationDiagramLayout,
  DiagramBand,
  DiagramNode,
  LABEL_GUTTER,
  BAR_WIDTH,
  layoutConversationDiagram,
} from "./TrafficConversationLayout";
import { formatTrafficBytes } from "./NetworkTrafficFormat";
import { NetworkTrafficConversationRow } from "Common/Types/NetFlow/NetworkTraffic";
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
 */

export interface ComponentProps {
  conversations: Array<NetworkTrafficConversationRow>;
  onSelectConversation: (sourceIp: string, destinationIp: string) => void;
  onSelectSource: (address: string) => void;
  onSelectDestination: (address: string) => void;
}

// An address longer than this is cut in the label (the title holds it all).
const MAX_LABEL_CHARACTERS: number = 22;

function shorten(address: string): string {
  return address.length > MAX_LABEL_CHARACTERS
    ? `${address.substring(0, MAX_LABEL_CHARACTERS - 1)}…`
    : address;
}

const TrafficConversationDiagram: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [hovered, setHovered] = useState<string | null>(null);

  const layout: ConversationDiagramLayout = useMemo(() => {
    return layoutConversationDiagram(props.conversations);
  }, [props.conversations]);

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
                      source: band.sourceIp,
                      destination: band.destinationIp,
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
                    address: node.address,
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
              <text
                x={labelX}
                y={node.labelY}
                textAnchor={isSource ? "end" : "start"}
                dominantBaseline="middle"
                fill="currentColor"
                className="font-mono"
                fontSize={12}
              >
                {shorten(node.address)}
                <tspan
                  className="text-gray-500"
                  fill="currentColor"
                  fontSize={11}
                  dx={6}
                >
                  {formatTrafficBytes(node.octets)}
                </tspan>
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
};

export default TrafficConversationDiagram;
