import React, {
  FunctionComponent,
  ReactElement,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Handle, NodeProps, Position } from "reactflow";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceTopologyFact,
  ResourceTopologyHealth,
  ResourceTopologyNode,
  ResourceTopologyText,
} from "./ResourceTopologyModel";
import {
  ResourceTopologyKindInfo,
  getResourceTopologyKind,
} from "./ResourceTopologyKinds";
import {
  ResourceTopologyDirection,
  ResourceTopologyPlaced,
  ResourceTopologyRelatedCaption,
  ResourceTopologySide,
} from "./ResourceTopologyLayout";
import {
  RESOURCE_TOPOLOGY_ATTENTION_TEXT_COLOR,
  RESOURCE_TOPOLOGY_HEALTH_COLORS,
  RESOURCE_TOPOLOGY_HEALTH_LABELS,
  RESOURCE_TOPOLOGY_MATCH_COLOR,
  RESOURCE_TOPOLOGY_SELECTED_COLOR,
  ResourceTopologyHealthShare,
  ResourceTopologyTone,
  getHealthShares,
  getResourceTopologyTone,
} from "./ResourceTopologyLook";
import {
  ResourceTopologyGroupItem,
  ResourceTopologyMoreItem,
} from "./ResourceTopologyView";
import { truncateTopologyNameMiddle } from "./ResourceTopologyFormat";

/*
 * The map's pieces. Every part is a card of its own, side by side with the
 * parts beside it and joined by a line to the part that holds it - never
 * drawn inside it. A card reads the same way everywhere: an icon tinted by
 * what the part is, its name with its open incidents and alerts right after
 * it, a dot and a word for how it is doing, and, on a part that holds
 * others, what it holds and a bar of how those are doing. A healthy card is
 * plain; one that needs attention is tinted amber, a critical one red. A
 * part that holds others has a round button on the edge its line leaves
 * by, which opens it - its parts appear after it - and closes it again.
 *
 * Parts that hold nothing, many of them, are chips; a group's heading says
 * what kind of parts are under it and how many need attention.
 *
 * Everything clickable is a real button, so the map works from the keyboard
 * and a screen reader names every part; React Flow's own node focus is off
 * (see the canvas). Each part's main button carries data-topology-item, the
 * id the canvas moves the keyboard by.
 */

export interface ResourceTopologyNodeCallbacks {
  onSelect: (nodeId: string) => void;
  onToggleOpen: (nodeId: string, open: boolean) => void;
  onToggleGroup: (groupKey: string) => void;
}

export interface ResourceTopologyNodeData {
  placed: ResourceTopologyPlaced;
  node: ResourceTopologyNode | null;
  isSelected: boolean;
  /* On the way from the resource to the part someone picked. */
  isOnPath?: boolean | undefined;
  /* Which way the page reads; the drawing is mirrored for right to left. */
  direction?: ResourceTopologyDirection | undefined;
  callbacks: ResourceTopologyNodeCallbacks;
}

/* The attribute the canvas finds a part's main button by. */
export const TOPOLOGY_ITEM_ATTRIBUTE: string = "data-topology-item";

const HIDDEN_HANDLE: React.CSSProperties = {
  opacity: 0,
  pointerEvents: "none",
  width: 6,
  height: 6,
  border: "none",
  background: "transparent",
};

const SIDES: Array<{ side: ResourceTopologySide; position: Position }> = [
  { side: "top", position: Position.Top },
  { side: "right", position: Position.Right },
  { side: "bottom", position: Position.Bottom },
  { side: "left", position: Position.Left },
];

/*
 * Where lines attach: every side can start or end one, and the canvas picks
 * the sides that face each other (getRelationSides).
 */
const SideHandles: FunctionComponent = (): ReactElement => {
  return (
    <>
      {SIDES.map(
        (entry: { side: ResourceTopologySide; position: Position }) => {
          return (
            <React.Fragment key={entry.side}>
              <Handle
                id={`${entry.side}-target`}
                type="target"
                position={entry.position}
                style={HIDDEN_HANDLE}
              />
              <Handle
                id={`${entry.side}-source`}
                type="source"
                position={entry.position}
                style={HIDDEN_HANDLE}
              />
            </React.Fragment>
          );
        },
      )}
    </>
  );
};

/*
 * A fixed string in the reader's language. The text comes first, so the
 * i18n extractor reads a literal one as a key (it reads the first argument
 * of tx()).
 */
export function tx(text: string, translator: Translator): string {
  return translator.translateText(text) || text;
}

let measuringContext: CanvasRenderingContext2D | null | undefined;

/* The drawn width of a string in a font, or 0 where nothing can measure it. */
function measureTextWidth(text: string, font: string): number {
  if (measuringContext === undefined) {
    try {
      measuringContext =
        typeof document === "undefined"
          ? null
          : document.createElement("canvas").getContext("2d");
    } catch {
      measuringContext = null;
    }
  }

  if (!measuringContext) {
    return 0;
  }

  measuringContext.font = font;

  return measuringContext.measureText(text).width;
}

/*
 * A part's name on one line, cut in its middle when it is longer than the
 * room it has (truncateTopologyNameMiddle), so the pods of one workload or
 * the nodes of one cluster stay told apart. Its full name is its title.
 * The room is read once the name is drawn in full - the line shrinks to it,
 * its overflow hidden - and read again when the name, `refitKey` (what else
 * shares the line) or the font changes.
 */
export const TopologyName: FunctionComponent<{
  name: string;
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
  refitKey?: string | number | undefined;
}> = (props: {
  name: string;
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
  refitKey?: string | number | undefined;
}): ReactElement => {
  const ref: React.RefObject<HTMLSpanElement> = useRef<HTMLSpanElement>(null);
  const [fontsLoaded, setFontsLoaded] = useState<number>(0);
  const fitKey: string = JSON.stringify([
    props.name,
    props.refitKey ?? null,
    fontsLoaded,
  ]);
  const [fitted, setFitted] = useState<{ key: string; text: string } | null>(
    null,
  );
  const text: string =
    fitted && fitted.key === fitKey ? fitted.text : props.name;

  useLayoutEffect(() => {
    const element: HTMLSpanElement | null = ref.current;

    if (!element || (fitted && fitted.key === fitKey)) {
      return;
    }

    // Measured with the whole name on the line (see `text` above).
    if (element.scrollWidth <= element.clientWidth + 1) {
      setFitted({ key: fitKey, text: props.name });
      return;
    }

    const style: CSSStyleDeclaration = window.getComputedStyle(element);
    const font: string = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

    setFitted({
      key: fitKey,
      text: truncateTopologyNameMiddle(
        props.name,
        element.clientWidth,
        (value: string): number => {
          return measureTextWidth(value, font);
        },
      ),
    });
  }, [fitKey, fitted]);

  // The page's font may arrive after the first measure: measure again.
  useLayoutEffect(() => {
    const fonts: FontFaceSet | undefined =
      typeof document !== "undefined" ? document.fonts : undefined;

    if (!fonts || fonts.status === "loaded") {
      return undefined;
    }

    let current: boolean = true;

    fonts.ready
      .then(() => {
        if (current) {
          setFontsLoaded((value: number) => {
            return value + 1;
          });
        }
      })
      .catch(() => {
        // The fallback font's measure stands.
      });

    return () => {
      current = false;
    };
  }, []);

  return (
    <span
      ref={ref}
      title={props.name}
      className={props.className}
      style={props.style}
    >
      {text}
    </span>
  );
};

export function renderTopologyText(
  translator: Translator,
  value: ResourceTopologyText | undefined,
): string {
  if (!value) {
    return "";
  }

  return value.values
    ? translator.translateTemplate(value.text, value.values)
    : tx(value.text, translator);
}

export function topologyNodeName(
  translator: Translator,
  node: ResourceTopologyNode,
): string {
  return node.isSection ? tx(node.name, translator) : node.name;
}

/* "ESXi Host", or what a section stands for. */
export function topologyKindLabel(
  translator: Translator,
  node: ResourceTopologyNode,
): string {
  if (node.isSection) {
    return "";
  }

  return tx(getResourceTopologyKind(node.kind).label, translator);
}

/* "14 Virtual Machines · 2 Resource Pools": the two largest kinds inside. */
export function describeTopologyContents(
  translator: Translator,
  node: ResourceTopologyNode,
  limit: number = 2,
): string {
  const entries: Array<[string, number]> = Array.from(
    node.descendantCountsByKind.entries(),
  )
    .filter((entry: [string, number]): boolean => {
      return entry[1] > 0;
    })
    .sort((a: [string, number], b: [string, number]): number => {
      const byOrder: number =
        getResourceTopologyKind(a[0]).order -
        getResourceTopologyKind(b[0]).order;

      return byOrder !== 0 ? byOrder : b[1] - a[1];
    })
    .slice(0, limit);

  return entries
    .map((entry: [string, number]): string => {
      const kind: ResourceTopologyKindInfo = getResourceTopologyKind(entry[0]);

      return `${translator.formatNumber(entry[1])} ${tx(entry[1] === 1 ? kind.label : kind.plural, translator)}`;
    })
    .join(" · ");
}

export function describeTopologyAttention(
  translator: Translator,
  count: number,
): string {
  return translator.translatePlural(
    {
      one: "{{count}} needs attention",
      other: "{{count}} need attention",
    },
    count,
  );
}

/* "2 are critical · 1 needs attention": what a card's coloured counts say. */
export function describeTopologyAttentionSplit(
  translator: Translator,
  critical: number,
  warning: number,
): string {
  const parts: Array<string> = [];

  if (critical > 0) {
    parts.push(
      translator.translatePlural(
        { one: "{{count}} is critical", other: "{{count}} are critical" },
        critical,
      ),
    );
  }

  if (warning > 0) {
    parts.push(describeTopologyAttention(translator, warning));
  }

  return parts.join(" · ");
}

/*
 * What needs attention inside a part, as the legend's coloured dots with a
 * count each: red for critical, amber for the rest. Short enough to leave
 * the card's line room for what it holds; the words are its title.
 */
export const AttentionCounts: FunctionComponent<{
  critical: number;
  warning: number;
}> = (props: { critical: number; warning: number }): ReactElement => {
  const translator: Translator = useTranslator();
  const label: string = describeTopologyAttentionSplit(
    translator,
    props.critical,
    props.warning,
  );
  const count: (value: number, color: string) => ReactElement = (
    value: number,
    color: string,
  ): ReactElement => {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          color: color,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: color,
          }}
        />
        {translator.formatNumber(value)}
      </span>
    );
  };

  return (
    <span
      data-testid="resource-topology-attention-counts"
      title={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        flexShrink: 0,
        fontWeight: 700,
      }}
    >
      {props.critical > 0
        ? count(props.critical, RESOURCE_TOPOLOGY_HEALTH_COLORS.critical)
        : null}
      {props.warning > 0
        ? count(props.warning, RESOURCE_TOPOLOGY_ATTENTION_TEXT_COLOR)
        : null}
    </span>
  );
};

export function describeTopologyIssues(
  translator: Translator,
  incidents: number,
  alerts: number,
): string {
  const parts: Array<string> = [];

  if (incidents > 0) {
    parts.push(
      translator.translatePlural(
        {
          one: "{{count}} open incident",
          other: "{{count}} open incidents",
        },
        incidents,
      ),
    );
  }

  if (alerts > 0) {
    parts.push(
      translator.translatePlural(
        { one: "{{count}} open alert", other: "{{count}} open alerts" },
        alerts,
      ),
    );
  }

  return parts.join(" · ");
}

function countIssues(node: ResourceTopologyNode): {
  incidents: number;
  alerts: number;
} {
  let incidents: number = 0;
  let alerts: number = 0;

  for (const issue of node.issues) {
    if (issue.type === "incident") {
      incidents++;
    } else {
      alerts++;
    }
  }

  return { incidents: incidents, alerts: alerts };
}

export const IssueBadges: FunctionComponent<{
  node: ResourceTopologyNode;
  compact?: boolean | undefined;
}> = (props: {
  node: ResourceTopologyNode;
  compact?: boolean | undefined;
}): ReactElement | null => {
  const translator: Translator = useTranslator();
  const counts: { incidents: number; alerts: number } = countIssues(props.node);

  if (counts.incidents === 0 && counts.alerts === 0) {
    return null;
  }

  const pill: (count: number, color: string, icon: IconProp) => ReactElement = (
    count: number,
    color: string,
    icon: IconProp,
  ): ReactElement => {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 3,
          padding: props.compact ? "0 5px" : "1px 6px",
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 700,
          lineHeight: "16px",
          color: "#ffffff",
          background: color,
          flexShrink: 0,
        }}
      >
        <Icon icon={icon} className="h-3 w-3" />
        {translator.formatNumber(count)}
      </span>
    );
  };

  return (
    <span
      data-testid="resource-topology-issue-badges"
      title={describeTopologyIssues(
        translator,
        counts.incidents,
        counts.alerts,
      )}
      aria-label={describeTopologyIssues(
        translator,
        counts.incidents,
        counts.alerts,
      )}
      role="img"
      style={{ display: "inline-flex", gap: 3, flexShrink: 0 }}
    >
      {counts.incidents > 0
        ? pill(
            counts.incidents,
            RESOURCE_TOPOLOGY_HEALTH_COLORS.critical,
            IconProp.Alert,
          )
        : null}
      {counts.alerts > 0
        ? pill(
            counts.alerts,
            RESOURCE_TOPOLOGY_ATTENTION_TEXT_COLOR,
            IconProp.Bell,
          )
        : null}
    </span>
  );
};

const HealthDot: FunctionComponent<{
  health: ResourceTopologyHealth;
  size?: number | undefined;
}> = (props: {
  health: ResourceTopologyHealth;
  size?: number | undefined;
}): ReactElement => {
  const size: number = props.size || 8;

  return (
    <span
      aria-hidden={true}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flexShrink: 0,
        background: RESOURCE_TOPOLOGY_HEALTH_COLORS[props.health],
        boxShadow:
          props.health === "critical"
            ? "0 0 0 3px rgba(220, 38, 38, 0.18)"
            : undefined,
      }}
    />
  );
};

/*
 * How what a part holds is doing, as one bar split by health, worst first:
 * a cluster of 40 hosts with one down reads as a sliver of red on green.
 * Its words are its title; the numbers next to it say the same for a
 * screen reader (the button's name).
 */
export const InsideHealthBar: FunctionComponent<{
  node: ResourceTopologyNode;
}> = (props: { node: ResourceTopologyNode }): ReactElement | null => {
  const translator: Translator = useTranslator();
  const shares: Array<ResourceTopologyHealthShare> = getHealthShares(
    props.node.healthBelow,
  );

  if (shares.length === 0) {
    return null;
  }

  const title: string = shares
    .map((share: ResourceTopologyHealthShare): string => {
      return `${tx(RESOURCE_TOPOLOGY_HEALTH_LABELS[share.health], translator)} ${translator.formatNumber(share.count)}`;
    })
    .join(" · ");

  return (
    <span
      data-testid="resource-topology-inside-bar"
      aria-hidden={true}
      title={title}
      style={{
        display: "flex",
        width: "100%",
        height: 4,
        gap: 2,
        overflow: "hidden",
        borderRadius: 999,
      }}
    >
      {shares.map((share: ResourceTopologyHealthShare): ReactElement => {
        return (
          <span
            key={share.health}
            data-health={share.health}
            style={{
              flexGrow: share.share,
              flexBasis: 0,
              // A single critical part in a thousand still shows.
              minWidth: 4,
              borderRadius: 999,
              background: RESOURCE_TOPOLOGY_HEALTH_COLORS[share.health],
            }}
          />
        );
      })}
    </span>
  );
};

/*
 * The outline of a picked part, a part a search found, and of a part on
 * the way to the picked one.
 */
function outlineFor(
  data: ResourceTopologyNodeData,
  isMatch: boolean,
): string | undefined {
  if (data.isSelected) {
    return `2px solid ${RESOURCE_TOPOLOGY_SELECTED_COLOR}`;
  }

  if (isMatch) {
    return `2px dashed ${RESOURCE_TOPOLOGY_MATCH_COLOR}`;
  }

  return undefined;
}

function shadowFor(health: ResourceTopologyHealth | null): string {
  if (health === "critical") {
    return "0 0 0 3px rgba(220, 38, 38, 0.12), var(--ou-shadow-sm, 0 1px 3px rgb(15 23 42 / 8%))";
  }

  return "var(--ou-shadow-sm, 0 1px 3px rgb(15 23 42 / 8%))";
}

const IconTile: FunctionComponent<{
  kind: ResourceTopologyKindInfo;
  size: number;
}> = (props: {
  kind: ResourceTopologyKindInfo;
  size: number;
}): ReactElement => {
  return (
    <span
      aria-hidden={true}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: props.size,
        height: props.size,
        flexShrink: 0,
        borderRadius: 8,
        color: props.kind.color,
        background: `${props.kind.color}1f`,
      }}
    >
      <Icon
        icon={props.kind.icon}
        className={props.size >= 32 ? "h-5 w-5" : "h-4 w-4"}
      />
    </span>
  );
};

/*
 * Keyboard focus, drawn the way the product's other maps draw it. React
 * Flow's own node focus is off, so this ring is the only one a part shows.
 */
const FOCUS_RING: string =
  "nodrag focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500";
// Inside a card that clips what overflows it: drawn just inside its edge.
const FOCUS_RING_INSET: string =
  "nodrag focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-500";

/*
 * What only a closer look needs: the canvas hides it when the map is zoomed
 * far out, where a card is read by its name and its colour (see the
 * canvas's level of detail).
 */
export const TOPOLOGY_DETAIL_CLASS: string = "rt-detail";

const LINE: React.CSSProperties = {
  display: "block",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const BUTTON_RESET: React.CSSProperties = {
  background: "transparent",
  border: "none",
  padding: 0,
  margin: 0,
  font: "inherit",
  color: "inherit",
  textAlign: "start",
  cursor: "pointer",
};

/* "CPU 22% · Memory 41%": a part's first two numbers, after its status. */
const FactsText: FunctionComponent<{
  facts: Array<ResourceTopologyFact>;
}> = (props: { facts: Array<ResourceTopologyFact> }): ReactElement | null => {
  const translator: Translator = useTranslator();

  if (props.facts.length === 0) {
    return null;
  }

  return (
    <span style={{ display: "inline-flex", gap: 8, flexShrink: 0 }}>
      {props.facts
        .slice(0, 2)
        .map((fact: ResourceTopologyFact): ReactElement => {
          return (
            <span key={fact.label}>
              <span
                style={{
                  color: "var(--ou-text-muted, #6b7280)",
                  marginInlineEnd: 3,
                }}
              >
                {tx(fact.label, translator)}
              </span>
              <span
                style={{
                  fontWeight: 600,
                  color:
                    fact.tone === "critical"
                      ? RESOURCE_TOPOLOGY_HEALTH_COLORS.critical
                      : fact.tone === "warning"
                        ? RESOURCE_TOPOLOGY_ATTENTION_TEXT_COLOR
                        : "var(--ou-text-primary, #111827)",
                }}
              >
                {fact.value}
              </span>
            </span>
          );
        })}
    </span>
  );
};

/* The accessible name of a part: its name, what it is, how it is doing. */
export function describeTopologyPart(
  translator: Translator,
  node: ResourceTopologyNode,
): string {
  const parts: Array<string> = [topologyNodeName(translator, node)];
  const kind: string = topologyKindLabel(translator, node);

  if (kind) {
    parts.push(kind);
  }

  const status: string = renderTopologyText(translator, node.status);

  if (status) {
    parts.push(status);
  }

  const counts: { incidents: number; alerts: number } = countIssues(node);
  const issues: string = describeTopologyIssues(
    translator,
    counts.incidents,
    counts.alerts,
  );

  if (issues) {
    parts.push(issues);
  }

  return parts.join(", ");
}

/*
 * What the open button of a closed part says: its name, what it holds (as
 * the card's line says it, which a narrow card may cut) and how many of
 * those need attention.
 */
export function describeTopologyOpen(
  translator: Translator,
  node: ResourceTopologyNode,
): string {
  const contents: string = describeTopologyContents(translator, node);
  const attention: number = node.attentionBelow;

  return [
    translator.translateTemplate("Open {{name}}", {
      name: topologyNodeName(translator, node),
    }),
    contents,
    attention > 0
      ? describeTopologyAttentionSplit(
          translator,
          node.criticalBelow,
          attention - node.criticalBelow,
        )
      : "",
  ]
    .filter((part: string): boolean => {
      return part.length > 0;
    })
    .join(", ");
}

/*
 * The round button on the edge a part's line leaves by: it opens the part,
 * and its parts appear after it; open, it closes it again. The chevron
 * points the way the parts appear, and turns round on a page read from
 * right to left (Icon does that).
 */
const PartToggle: FunctionComponent<{
  node: ResourceTopologyNode;
  isOpen: boolean;
  height: number;
  onToggle: (open: boolean) => void;
}> = (props: {
  node: ResourceTopologyNode;
  isOpen: boolean;
  height: number;
  onToggle: (open: boolean) => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const size: number = 24;

  return (
    <button
      type="button"
      className={FOCUS_RING}
      data-testid={`resource-topology-${props.isOpen ? "close" : "open"}-${props.node.id}`}
      aria-expanded={props.isOpen}
      aria-label={
        props.isOpen
          ? translator.translateTemplate("Close {{name}}", {
              name: topologyNodeName(translator, props.node),
            })
          : describeTopologyOpen(translator, props.node)
      }
      title={props.isOpen ? tx("Close", translator) : tx("Open", translator)}
      onClick={() => {
        props.onToggle(!props.isOpen);
      }}
      style={{
        ...BUTTON_RESET,
        position: "absolute",
        top: (props.height - size) / 2,
        insetInlineEnd: -size / 2,
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        border: `1px solid ${props.isOpen ? RESOURCE_TOPOLOGY_SELECTED_COLOR : "var(--ou-border-strong, #d1d5db)"}`,
        background: props.isOpen
          ? RESOURCE_TOPOLOGY_SELECTED_COLOR
          : "var(--ou-surface-primary, #ffffff)",
        color: props.isOpen ? "#ffffff" : "var(--ou-text-secondary, #4b5563)",
        boxShadow: "var(--ou-shadow-sm, 0 1px 3px rgb(15 23 42 / 8%))",
        zIndex: 2,
      }}
    >
      <Icon
        icon={props.isOpen ? IconProp.ChevronLeft : IconProp.ChevronRight}
        className="h-3.5 w-3.5"
      />
    </button>
  );
};

/*
 * A part: the resource itself, a section, or any part inside it, open or
 * closed. Its line to what it holds leaves by its toggle.
 */
export const ResourceTopologyCardNode: FunctionComponent<
  NodeProps<ResourceTopologyNodeData>
> = (props: NodeProps<ResourceTopologyNodeData>): ReactElement => {
  const translator: Translator = useTranslator();
  const data: ResourceTopologyNodeData = props.data;
  const node: ResourceTopologyNode = data.node!;
  const placed: ResourceTopologyPlaced = data.placed;
  const card: NonNullable<ResourceTopologyPlaced["card"]> = placed.card!;
  const isRoot: boolean = node.parentId === null;
  const isSection: boolean = Boolean(node.isSection);
  const isOpen: boolean = card.isOpen;
  const kind: ResourceTopologyKindInfo = getResourceTopologyKind(node.kind);
  const tone: ResourceTopologyTone = getResourceTopologyTone(
    isSection ? "healthy" : node.effectiveHealth,
  );
  const status: string = renderTopologyText(translator, node.status);
  /*
   * Under a group's heading a card need not say what it is; the resource
   * itself, and a part in a lane (lanes mix kinds), do.
   */
  const kindLabel: string =
    isRoot || placed.lane ? topologyKindLabel(translator, node) : "";
  const contents: string = card.canOpen
    ? describeTopologyContents(translator, node)
    : "";
  const attention: number = node.attentionBelow;
  const facts: Array<ResourceTopologyFact> = node.facts || [];
  const statusLine: string = [status, kindLabel]
    .filter((part: string): boolean => {
      return part.length > 0;
    })
    .join(" · ");

  return (
    <div
      dir={data.direction || "ltr"}
      data-testid={`resource-topology-card-${node.id}`}
      data-health={node.effectiveHealth}
      data-open={isOpen ? "true" : "false"}
      style={{
        position: "relative",
        width: placed.width,
        height: placed.height,
      }}
    >
      <SideHandles />
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          borderRadius: 12,
          border: `1px solid ${data.isOnPath && !data.isSelected ? RESOURCE_TOPOLOGY_MATCH_COLOR : tone.border}`,
          borderInlineStart: `4px solid ${tone.edge === "transparent" ? tone.border : tone.edge}`,
          background: isSection
            ? "var(--ou-surface-secondary, #f9fafb)"
            : tone.background,
          boxShadow: shadowFor(isSection ? null : node.effectiveHealth),
          outline: outlineFor(data, card.isMatch),
          outlineOffset: 2,
          overflow: "hidden",
        }}
      >
        <button
          type="button"
          className={FOCUS_RING_INSET}
          data-testid={`resource-topology-select-${node.id}`}
          data-topology-item={card.id}
          aria-label={describeTopologyPart(translator, node)}
          aria-pressed={data.isSelected}
          onClick={() => {
            data.callbacks.onSelect(node.id);
          }}
          style={{
            ...BUTTON_RESET,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 3,
            flex: 1,
            minWidth: 0,
            paddingTop: 8,
            paddingBottom: 8,
            paddingInlineStart: 10,
            // Room for the toggle that sits on the edge.
            paddingInlineEnd: card.canOpen && !isRoot ? 22 : 12,
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              minWidth: 0,
            }}
          >
            {isSection ? null : (
              <IconTile kind={kind} size={isRoot ? 36 : 30} />
            )}
            <span style={{ minWidth: 0, flex: 1 }}>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  minWidth: 0,
                }}
              >
                <TopologyName
                  name={topologyNodeName(translator, node)}
                  refitKey={node.issues.length}
                  style={{
                    ...LINE,
                    flex: "0 1 auto",
                    fontSize: isRoot ? 15 : 13,
                    fontWeight: 600,
                    lineHeight: isRoot ? "20px" : "18px",
                    color: "var(--ou-text-primary, #111827)",
                  }}
                />
                <IssueBadges node={node} />
              </span>
              {isSection ? null : (
                <span
                  className={TOPOLOGY_DETAIL_CLASS}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    minWidth: 0,
                    fontSize: 11,
                    lineHeight: "16px",
                    color: "var(--ou-text-secondary, #4b5563)",
                  }}
                >
                  <HealthDot health={node.effectiveHealth} />
                  {statusLine ? (
                    <span style={{ ...LINE, flex: "0 1 auto" }}>
                      {statusLine}
                    </span>
                  ) : null}
                  {facts.length > 0 ? <FactsText facts={facts} /> : null}
                </span>
              )}
            </span>
          </span>
          {card.canOpen ? (
            <span
              className={TOPOLOGY_DETAIL_CLASS}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 0,
                  fontSize: 11,
                  lineHeight: "14px",
                  color: "var(--ou-text-muted, #6b7280)",
                }}
              >
                <span title={contents} style={{ ...LINE, flex: 1 }}>
                  {contents}
                </span>
                {attention > 0 ? (
                  <AttentionCounts
                    critical={node.criticalBelow}
                    warning={attention - node.criticalBelow}
                  />
                ) : null}
              </span>
              <InsideHealthBar node={node} />
            </span>
          ) : null}
        </button>
      </div>
      {card.canOpen && !isRoot ? (
        <PartToggle
          node={node}
          isOpen={isOpen}
          height={placed.height}
          onToggle={(open: boolean) => {
            data.callbacks.onToggleOpen(node.id, open);
          }}
        />
      ) : null}
    </div>
  );
};

/* A part that holds nothing, one of many: small. */
export const ResourceTopologyChipNode: FunctionComponent<
  NodeProps<ResourceTopologyNodeData>
> = (props: NodeProps<ResourceTopologyNodeData>): ReactElement => {
  const translator: Translator = useTranslator();
  const data: ResourceTopologyNodeData = props.data;
  const node: ResourceTopologyNode = data.node!;
  const placed: ResourceTopologyPlaced = data.placed;
  const status: string = renderTopologyText(translator, node.status);
  const firstFact: ResourceTopologyFact | undefined = node.facts?.[0];
  const tone: ResourceTopologyTone = getResourceTopologyTone(
    node.effectiveHealth,
  );
  const kindLabel: string = placed.lane
    ? topologyKindLabel(translator, node)
    : "";
  const second: string =
    [status, kindLabel]
      .filter((part: string): boolean => {
        return part.length > 0;
      })
      .join(" · ") ||
    (firstFact ? `${tx(firstFact.label, translator)} ${firstFact.value}` : "");

  return (
    <div
      dir={data.direction || "ltr"}
      style={{
        position: "relative",
        width: placed.width,
        height: placed.height,
      }}
    >
      <SideHandles />
      <button
        type="button"
        className={FOCUS_RING}
        data-testid={`resource-topology-chip-${node.id}`}
        data-health={node.effectiveHealth}
        data-topology-item={placed.chip?.id || node.id}
        aria-label={describeTopologyPart(translator, node)}
        aria-pressed={data.isSelected}
        title={topologyNodeName(translator, node)}
        onClick={() => {
          data.callbacks.onSelect(node.id);
        }}
        style={{
          ...BUTTON_RESET,
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 2,
          paddingInlineStart: 10,
          paddingInlineEnd: 10,
          borderRadius: 10,
          border: `1px solid ${tone.border}`,
          borderInlineStart: `3px solid ${tone.edge === "transparent" ? tone.border : tone.edge}`,
          background: tone.background,
          boxShadow: shadowFor(node.effectiveHealth),
          outline: outlineFor(data, Boolean(placed.chip?.isMatch)),
          outlineOffset: 2,
        }}
      >
        <span
          style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}
        >
          <HealthDot health={node.effectiveHealth} />
          <TopologyName
            name={topologyNodeName(translator, node)}
            refitKey={node.issues.length}
            style={{
              ...LINE,
              flex: 1,
              fontSize: 12,
              fontWeight: 600,
              lineHeight: "16px",
              color: "var(--ou-text-primary, #111827)",
            }}
          />
          <IssueBadges node={node} compact={true} />
        </span>
        {second ? (
          <span
            className={TOPOLOGY_DETAIL_CLASS}
            style={{
              ...LINE,
              paddingInlineStart: 14,
              fontSize: 11,
              lineHeight: "14px",
              color: "var(--ou-text-muted, #6b7280)",
            }}
          >
            {second}
          </span>
        ) : null}
      </button>
    </div>
  );
};

/* "+ 28 more": the rest of a group, shown when clicked. */
export const ResourceTopologyMoreNode: FunctionComponent<
  NodeProps<ResourceTopologyNodeData>
> = (props: NodeProps<ResourceTopologyNodeData>): ReactElement => {
  const translator: Translator = useTranslator();
  const data: ResourceTopologyNodeData = props.data;
  const more: ResourceTopologyMoreItem = data.placed.more!;
  const kind: ResourceTopologyKindInfo = getResourceTopologyKind(more.kind);

  return (
    <div dir={data.direction || "ltr"}>
      <SideHandles />
      <button
        type="button"
        className={FOCUS_RING}
        data-testid={`resource-topology-more-${more.groupKey}`}
        data-topology-item={more.id}
        disabled={!more.canShowAll}
        aria-label={translator.translateTemplate(
          "Show {{count}} more {{kind}}",
          {
            count: translator.formatNumber(more.hiddenCount),
            kind: tx(kind.plural, translator),
          },
        )}
        onClick={() => {
          data.callbacks.onToggleGroup(more.groupKey);
        }}
        style={{
          ...BUTTON_RESET,
          width: data.placed.width,
          height: data.placed.height,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 2,
          borderRadius: more.asChip ? 10 : 12,
          border: "1px dashed var(--ou-border-strong, #d1d5db)",
          background: "var(--ou-surface-secondary, #f9fafb)",
          cursor: more.canShowAll ? "pointer" : "default",
          textAlign: "center",
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--ou-text-primary, #111827)",
          }}
        >
          {translator.translateTemplate("+ {{count}} more", {
            count: translator.formatNumber(more.hiddenCount),
          })}
        </span>
        {more.hiddenAttention > 0 ? (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: RESOURCE_TOPOLOGY_ATTENTION_TEXT_COLOR,
            }}
          >
            {describeTopologyAttention(translator, more.hiddenAttention)}
          </span>
        ) : more.asChip ? null : (
          <span
            style={{ fontSize: 11, color: "var(--ou-text-muted, #6b7280)" }}
          >
            {tx(kind.plural, translator)}
          </span>
        )}
      </button>
    </div>
  );
};

/*
 * Over a group's parts: what they are, how many, how many need attention,
 * and a way to show them all or fold them back. Over a lane: the name of
 * what the lane holds ("Called by") and how many.
 */
export const ResourceTopologyHeadingNode: FunctionComponent<
  NodeProps<ResourceTopologyNodeData>
> = (props: NodeProps<ResourceTopologyNodeData>): ReactElement | null => {
  const translator: Translator = useTranslator();
  const data: ResourceTopologyNodeData = props.data;
  const placed: ResourceTopologyPlaced = data.placed;
  const group: ResourceTopologyGroupItem | undefined = placed.heading?.group;
  const title: string = group
    ? tx(getResourceTopologyKind(group.kind).plural, translator)
    : data.node
      ? topologyNodeName(translator, data.node)
      : "";
  const total: number = group ? group.total : placed.heading?.laneCount || 0;
  const attention: number = group
    ? group.attention
    : data.node
      ? data.node.attentionBelow
      : 0;
  const canFold: boolean = Boolean(group?.isShownInFull);
  const canShowAll: boolean = Boolean(group?.more?.canShowAll);

  return (
    <div
      dir={data.direction || "ltr"}
      data-testid={
        group
          ? `resource-topology-group-${group.groupKey}`
          : `resource-topology-lane-${placed.heading?.laneSectionId || ""}`
      }
      style={{
        position: "relative",
        width: placed.width,
        height: placed.height,
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 11,
        color: "var(--ou-text-muted, #6b7280)",
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      <SideHandles />
      <span
        style={{
          flexShrink: 0,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--ou-text-secondary, #4b5563)",
        }}
      >
        {title}
      </span>
      <span style={{ flexShrink: 0 }}>{translator.formatNumber(total)}</span>
      {attention > 0 ? (
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontWeight: 600,
            color: RESOURCE_TOPOLOGY_ATTENTION_TEXT_COLOR,
          }}
        >
          {describeTopologyAttention(translator, attention)}
        </span>
      ) : null}
      {group && (canFold || canShowAll) ? (
        <button
          type="button"
          className={FOCUS_RING}
          data-testid={`resource-topology-group-toggle-${group.groupKey}`}
          // Shown in full is open: the button then folds the group.
          aria-expanded={canFold}
          onClick={() => {
            data.callbacks.onToggleGroup(group.groupKey);
          }}
          style={{
            ...BUTTON_RESET,
            marginInlineStart: "auto",
            flexShrink: 0,
            fontSize: 11,
            fontWeight: 600,
            color: "var(--ou-link, #4f46e5)",
          }}
        >
          {canFold
            ? tx("Show fewer", translator)
            : translator.translateTemplate("Show all {{count}}", {
                count: translator.formatNumber(group.total),
              })}
        </button>
      ) : null}
    </div>
  );
};

/*
 * A part the focused one is related to, beside the drawing: as small as a
 * chip, its kind under its name (the column mixes kinds), under a heading
 * that says how it is related.
 */
export const ResourceTopologyRelatedNode: FunctionComponent<
  NodeProps<ResourceTopologyNodeData>
> = (props: NodeProps<ResourceTopologyNodeData>): ReactElement => {
  const translator: Translator = useTranslator();
  const data: ResourceTopologyNodeData = props.data;
  const node: ResourceTopologyNode = data.node!;
  const placed: ResourceTopologyPlaced = data.placed;
  const status: string = renderTopologyText(translator, node.status);
  const tone: ResourceTopologyTone = getResourceTopologyTone(
    node.effectiveHealth,
  );

  return (
    <div
      dir={data.direction || "ltr"}
      style={{
        position: "relative",
        width: placed.width,
        height: placed.height,
      }}
    >
      <SideHandles />
      <button
        type="button"
        className={FOCUS_RING}
        data-testid={`resource-topology-related-${node.id}`}
        data-health={node.effectiveHealth}
        aria-label={`${tx(placed.related?.label || "", translator)}: ${describeTopologyPart(translator, node)}`}
        aria-pressed={data.isSelected}
        onClick={() => {
          data.callbacks.onSelect(node.id);
        }}
        style={{
          ...BUTTON_RESET,
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 2,
          paddingInlineStart: 10,
          paddingInlineEnd: 10,
          borderRadius: 10,
          border: `1px solid ${tone.border}`,
          borderInlineStart: `3px solid ${tone.edge === "transparent" ? tone.border : tone.edge}`,
          background: tone.background,
          boxShadow: shadowFor(node.effectiveHealth),
          outline: outlineFor(data, false),
          outlineOffset: 2,
        }}
      >
        <span
          style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}
        >
          <HealthDot health={node.effectiveHealth} />
          <TopologyName
            name={topologyNodeName(translator, node)}
            refitKey={node.issues.length}
            style={{
              ...LINE,
              flex: 1,
              fontSize: 12,
              fontWeight: 600,
              lineHeight: "16px",
              color: "var(--ou-text-primary, #111827)",
            }}
          />
          <IssueBadges node={node} compact={true} />
        </span>
        <span
          className={TOPOLOGY_DETAIL_CLASS}
          style={{
            ...LINE,
            paddingInlineStart: 14,
            fontSize: 11,
            lineHeight: "14px",
            color: "var(--ou-text-muted, #6b7280)",
          }}
        >
          {[status, topologyKindLabel(translator, node)]
            .filter((part: string): boolean => {
              return part.length > 0;
            })
            .join(" · ")}
        </span>
      </button>
    </div>
  );
};

/* "Runs here · 12": the heading over a focused part's related parts. */
export const ResourceTopologyRelatedCaptionNode: FunctionComponent<
  NodeProps<ResourceTopologyNodeData>
> = (props: NodeProps<ResourceTopologyNodeData>): ReactElement => {
  const translator: Translator = useTranslator();
  const caption: ResourceTopologyRelatedCaption =
    props.data.placed.relatedCaption!;

  return (
    <div
      dir={props.data.direction || "ltr"}
      data-testid={`resource-topology-related-caption-${caption.label}`}
      style={{
        width: props.data.placed.width,
        height: props.data.placed.height,
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 11,
        whiteSpace: "nowrap",
        overflow: "hidden",
        color: "var(--ou-text-muted, #6b7280)",
      }}
    >
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--ou-link, #4f46e5)",
        }}
      >
        {tx(caption.label, translator)}
      </span>
      <span style={{ flexShrink: 0 }}>
        {translator.formatNumber(caption.count)}
      </span>
    </div>
  );
};

export const RESOURCE_TOPOLOGY_NODE_TYPES: Record<
  string,
  FunctionComponent<NodeProps<ResourceTopologyNodeData>>
> = {
  resourceTopologyCard: ResourceTopologyCardNode,
  resourceTopologyChip: ResourceTopologyChipNode,
  resourceTopologyMore: ResourceTopologyMoreNode,
  resourceTopologyHeading: ResourceTopologyHeadingNode,
  resourceTopologyRelated: ResourceTopologyRelatedNode,
  resourceTopologyRelatedCaption: ResourceTopologyRelatedCaptionNode,
};
