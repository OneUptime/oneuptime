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
  ResourceTopologyNode,
  ResourceTopologyText,
} from "./ResourceTopologyModel";
import {
  ResourceTopologyKindInfo,
  SECTION_KIND,
  getResourceTopologyKind,
} from "./ResourceTopologyKinds";
import {
  RESOURCE_TOPOLOGY_SIZES,
  ResourceTopologyCaption,
  ResourceTopologyPlaced,
  ResourceTopologyRelatedCaption,
  ResourceTopologySide,
} from "./ResourceTopologyLayout";
import {
  RESOURCE_TOPOLOGY_HEALTH_COLORS,
  RESOURCE_TOPOLOGY_ATTENTION_TEXT_COLOR,
  RESOURCE_TOPOLOGY_MATCH_COLOR,
  RESOURCE_TOPOLOGY_SELECTED_COLOR,
} from "./ResourceTopologyLook";
import { ResourceTopologyMoreItem } from "./ResourceTopologyView";
import { truncateTopologyNameMiddle } from "./ResourceTopologyFormat";

/*
 * The map's pieces. An open part is a box: its heading, then one group per
 * kind of part inside it. A closed part is a card that says what it holds,
 * and a part that holds nothing is a chip. Each reads the same way: an icon
 * tinted by what it is, a bar and a dot coloured by how it is doing, its
 * open incidents and alerts as red and amber counts.
 *
 * Everything clickable is a real button, so the map works from the keyboard
 * and a screen reader names every part; React Flow's own node focus is off
 * (see the canvas).
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
  callbacks: ResourceTopologyNodeCallbacks;
}

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
 * the sides that face each other (getRelationSides). A box's lines attach
 * beside its heading, not halfway down what it holds.
 */
const SideHandles: FunctionComponent<{ sideY?: number | undefined }> = (props: {
  sideY?: number | undefined;
}): ReactElement => {
  return (
    <>
      {SIDES.map(
        (entry: { side: ResourceTopologySide; position: Position }) => {
          const style: React.CSSProperties =
            props.sideY !== undefined &&
            (entry.side === "left" || entry.side === "right")
              ? { ...HIDDEN_HANDLE, top: props.sideY }
              : HIDDEN_HANDLE;

          return (
            <React.Fragment key={entry.side}>
              <Handle
                id={`${entry.side}-target`}
                type="target"
                position={entry.position}
                style={style}
              />
              <Handle
                id={`${entry.side}-source`}
                type="source"
                position={entry.position}
                style={style}
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
 * What needs attention inside a closed card, as the legend's coloured dots
 * with a count each: red for critical, amber for the rest. Short enough to
 * leave the card's line room for what it holds; the words are its title.
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
  node: ResourceTopologyNode;
  size?: number | undefined;
}> = (props: {
  node: ResourceTopologyNode;
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
        background: RESOURCE_TOPOLOGY_HEALTH_COLORS[props.node.effectiveHealth],
        boxShadow:
          props.node.effectiveHealth === "critical"
            ? "0 0 0 3px rgba(220, 38, 38, 0.18)"
            : undefined,
      }}
    />
  );
};

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

function shadowFor(node: ResourceTopologyNode | null): string {
  if (node?.effectiveHealth === "critical") {
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
  textAlign: "left",
  cursor: "pointer",
};

const FactRow: FunctionComponent<{
  facts: Array<ResourceTopologyFact>;
}> = (props: { facts: Array<ResourceTopologyFact> }): ReactElement | null => {
  const translator: Translator = useTranslator();

  if (props.facts.length === 0) {
    return null;
  }

  return (
    <span
      style={{
        display: "flex",
        gap: 8,
        overflow: "hidden",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {props.facts
        .slice(0, 2)
        .map((fact: ResourceTopologyFact): ReactElement => {
          return (
            <span key={fact.label} style={{ fontSize: 11 }}>
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

/*
 * What a card, a box heading and a related card all say about a part: its
 * icon, its name with its open incidents and alerts right after it, how it
 * is doing and what it is, and — on a card — its numbers on a line of their
 * own. A box heading is wide, so its numbers sit at its right instead.
 */
const PartSummary: FunctionComponent<{
  node: ResourceTopologyNode;
  iconSize: number;
  factsLine: boolean;
}> = (props: {
  node: ResourceTopologyNode;
  iconSize: number;
  factsLine: boolean;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const kind: ResourceTopologyKindInfo = getResourceTopologyKind(
    props.node.kind,
  );
  const status: string = renderTopologyText(translator, props.node.status);
  const kindLabel: string = topologyKindLabel(translator, props.node);
  const facts: Array<ResourceTopologyFact> = props.node.facts || [];

  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        minWidth: 0,
        flex: 1,
      }}
    >
      {/*
       * A section only groups parts ("Called by", "Not on a node"): a
       * heading, without the folder a namespace or a Compose project shows.
       */}
      {props.node.isSection ? null : (
        <IconTile kind={kind} size={props.iconSize} />
      )}
      <span style={{ minWidth: 0, flex: 1 }}>
        <span
          style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}
        >
          <TopologyName
            name={topologyNodeName(translator, props.node)}
            refitKey={props.node.issues.length}
            style={{
              ...LINE,
              flex: "0 1 auto",
              fontSize: 13,
              fontWeight: 600,
              lineHeight: "18px",
              color: "var(--ou-text-primary, #111827)",
            }}
          />
          <IssueBadges node={props.node} />
        </span>
        {props.node.isSection ? null : (
          <span
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
            <HealthDot node={props.node} />
            <span style={{ ...LINE, flex: "0 1 auto" }}>
              {[status, kindLabel]
                .filter((part: string): boolean => {
                  return part.length > 0;
                })
                .join(" · ")}
            </span>
          </span>
        )}
        {props.factsLine && facts.length > 0 ? (
          <span style={{ display: "block", marginTop: 2 }}>
            <FactRow facts={facts} />
          </span>
        ) : null}
      </span>
      {!props.factsLine && facts.length > 0 ? (
        <span style={{ flexShrink: 0, marginInlineStart: 8 }}>
          <FactRow facts={facts} />
        </span>
      ) : null}
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

/* A closed part: a card that says what it holds, and opens. */
export const ResourceTopologyCardNode: FunctionComponent<
  NodeProps<ResourceTopologyNodeData>
> = (props: NodeProps<ResourceTopologyNodeData>): ReactElement => {
  const translator: Translator = useTranslator();
  const data: ResourceTopologyNodeData = props.data;
  const node: ResourceTopologyNode = data.node!;
  const placed: ResourceTopologyPlaced = data.placed;
  const canOpen: boolean = Boolean(placed.card?.canOpen);
  const contents: string = canOpen
    ? describeTopologyContents(translator, node)
    : "";
  const attention: number = node.attentionBelow;

  return (
    <div
      data-testid={`resource-topology-card-${node.id}`}
      data-health={node.effectiveHealth}
      style={{
        position: "relative",
        width: placed.width,
        height: placed.height,
        display: "flex",
        flexDirection: "column",
        borderRadius: 12,
        border: "1px solid var(--ou-border-default, #e5e7eb)",
        borderInlineStart: `4px solid ${RESOURCE_TOPOLOGY_HEALTH_COLORS[node.effectiveHealth]}`,
        background: "var(--ou-surface-primary, #ffffff)",
        boxShadow: shadowFor(node),
        outline: outlineFor(data, Boolean(placed.card?.isMatch)),
        outlineOffset: 2,
        overflow: "hidden",
      }}
    >
      <SideHandles />
      <button
        type="button"
        className={FOCUS_RING_INSET}
        aria-label={describeTopologyPart(translator, node)}
        aria-pressed={data.isSelected}
        onClick={() => {
          data.callbacks.onSelect(node.id);
        }}
        style={{
          ...BUTTON_RESET,
          display: "flex",
          flex: 1,
          minHeight: 0,
          padding: "10px 12px 6px 10px",
        }}
      >
        <PartSummary node={node} iconSize={30} factsLine={true} />
      </button>
      {canOpen ? (
        <button
          type="button"
          className={FOCUS_RING_INSET}
          data-testid={`resource-topology-open-${node.id}`}
          aria-expanded={false}
          aria-label={[
            translator.translateTemplate("Open {{name}}", {
              name: topologyNodeName(translator, node),
            }),
            // What it holds, as the line says it, which a narrow card may cut.
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
            .join(", ")}
          onClick={() => {
            data.callbacks.onToggleOpen(node.id, true);
          }}
          style={{
            ...BUTTON_RESET,
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 30,
            padding: "0 12px 0 10px",
            borderTop: "1px dashed var(--ou-border-default, #e5e7eb)",
            fontSize: 11,
            color: "var(--ou-text-secondary, #4b5563)",
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          <Icon icon={IconProp.ChevronRight} className="h-3 w-3" />
          <span title={contents} style={{ ...LINE, flex: 1 }}>
            {contents}
          </span>
          {attention > 0 ? (
            <AttentionCounts
              critical={node.criticalBelow}
              warning={attention - node.criticalBelow}
            />
          ) : null}
        </button>
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

  return (
    <div
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
          padding: "0 10px",
          borderRadius: 10,
          border: "1px solid var(--ou-border-default, #e5e7eb)",
          borderInlineStart: `3px solid ${RESOURCE_TOPOLOGY_HEALTH_COLORS[node.effectiveHealth]}`,
          background: "var(--ou-surface-primary, #ffffff)",
          boxShadow: shadowFor(node),
          outline: outlineFor(data, Boolean(placed.chip?.isMatch)),
          outlineOffset: 2,
        }}
      >
        <span
          style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}
        >
          <HealthDot node={node} />
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
          style={{
            ...LINE,
            paddingInlineStart: 14,
            fontSize: 11,
            lineHeight: "14px",
            color: "var(--ou-text-muted, #6b7280)",
          }}
        >
          {status ||
            (firstFact
              ? `${tx(firstFact.label, translator)} ${firstFact.value}`
              : "")}
        </span>
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
    <button
      type="button"
      className={FOCUS_RING}
      data-testid={`resource-topology-more-${more.groupKey}`}
      disabled={!more.canShowAll}
      aria-label={translator.translateTemplate("Show {{count}} more {{kind}}", {
        count: translator.formatNumber(more.hiddenCount),
        kind: tx(kind.plural, translator),
      })}
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
        <span style={{ fontSize: 11, color: "var(--ou-text-muted, #6b7280)" }}>
          {tx(kind.plural, translator)}
        </span>
      )}
    </button>
  );
};

const CaptionBand: FunctionComponent<{
  caption: ResourceTopologyCaption;
  onToggleGroup: (groupKey: string) => void;
}> = (props: {
  caption: ResourceTopologyCaption;
  onToggleGroup: (groupKey: string) => void;
}): ReactElement | null => {
  const translator: Translator = useTranslator();
  const group: ResourceTopologyCaption["group"] = props.caption.group;
  const kind: ResourceTopologyKindInfo = getResourceTopologyKind(group.kind);
  const canFold: boolean = group.isShownInFull;
  const canShowAll: boolean = Boolean(group.more?.canShowAll);

  // Sections are titled by their own box.
  if (group.kind === SECTION_KIND) {
    return null;
  }

  return (
    <div
      data-testid={`resource-topology-group-${group.groupKey}`}
      style={{
        position: "absolute",
        left: props.caption.x,
        top: props.caption.y,
        width: props.caption.width,
        height: RESOURCE_TOPOLOGY_SIZES.captionHeight,
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 11,
        color: "var(--ou-text-muted, #6b7280)",
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          flexShrink: 0,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--ou-text-secondary, #4b5563)",
        }}
      >
        {tx(kind.plural, translator)}
      </span>
      <span style={{ flexShrink: 0 }}>
        {translator.formatNumber(group.total)}
      </span>
      {group.attention > 0 ? (
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontWeight: 600,
            color: RESOURCE_TOPOLOGY_ATTENTION_TEXT_COLOR,
          }}
        >
          {describeTopologyAttention(translator, group.attention)}
        </span>
      ) : null}
      {canFold || canShowAll ? (
        <button
          type="button"
          className={FOCUS_RING}
          data-testid={`resource-topology-group-toggle-${group.groupKey}`}
          onClick={() => {
            props.onToggleGroup(group.groupKey);
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

/* An open part: a box with its heading, holding its parts. */
export const ResourceTopologyContainerNode: FunctionComponent<
  NodeProps<ResourceTopologyNodeData>
> = (props: NodeProps<ResourceTopologyNodeData>): ReactElement => {
  const translator: Translator = useTranslator();
  const data: ResourceTopologyNodeData = props.data;
  const node: ResourceTopologyNode = data.node!;
  const placed: ResourceTopologyPlaced = data.placed;
  const isRoot: boolean = node.parentId === null;
  const healthColor: string =
    RESOURCE_TOPOLOGY_HEALTH_COLORS[node.effectiveHealth];
  const tinted: boolean =
    node.effectiveHealth === "critical" || node.effectiveHealth === "warning";

  return (
    <div
      data-testid={`resource-topology-box-${node.id}`}
      data-health={node.effectiveHealth}
      style={{
        position: "relative",
        width: placed.width,
        height: placed.height,
        borderRadius: 16,
        border: `1px solid ${tinted ? `${healthColor}66` : "var(--ou-border-default, #e5e7eb)"}`,
        background:
          placed.depth % 2 === 0
            ? "var(--ou-surface-primary, #ffffff)"
            : "var(--ou-surface-secondary, #f9fafb)",
        boxShadow: isRoot ? "var(--ou-card-shadow)" : undefined,
        outline: outlineFor(data, Boolean(placed.card?.isMatch)),
        outlineOffset: 3,
      }}
    >
      <SideHandles sideY={RESOURCE_TOPOLOGY_SIZES.headerHeight / 2} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: RESOURCE_TOPOLOGY_SIZES.headerHeight,
          padding: "0 10px 0 14px",
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          borderBottom: "1px solid var(--ou-border-subtle, #f3f4f6)",
          background: tinted ? `${healthColor}0d` : undefined,
        }}
      >
        <button
          type="button"
          className={FOCUS_RING}
          data-testid={`resource-topology-select-${node.id}`}
          aria-label={describeTopologyPart(translator, node)}
          aria-pressed={data.isSelected}
          onClick={() => {
            data.callbacks.onSelect(node.id);
          }}
          style={{
            ...BUTTON_RESET,
            display: "flex",
            flex: 1,
            minWidth: 0,
            alignItems: "center",
          }}
        >
          <PartSummary node={node} iconSize={36} factsLine={true} />
        </button>
        {!isRoot ? (
          <button
            type="button"
            className={FOCUS_RING}
            data-testid={`resource-topology-close-${node.id}`}
            aria-expanded={true}
            aria-label={translator.translateTemplate("Close {{name}}", {
              name: topologyNodeName(translator, node),
            })}
            title={tx("Close", translator)}
            onClick={() => {
              data.callbacks.onToggleOpen(node.id, false);
            }}
            style={{
              ...BUTTON_RESET,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              flexShrink: 0,
              borderRadius: 8,
              color: "var(--ou-text-muted, #6b7280)",
            }}
          >
            <Icon icon={IconProp.ChevronUp} className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {(placed.captions || []).map(
        (caption: ResourceTopologyCaption): ReactElement => {
          return (
            <CaptionBand
              key={caption.group.groupKey}
              caption={caption}
              onToggleGroup={data.callbacks.onToggleGroup}
            />
          );
        },
      )}
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

  return (
    <div
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
          padding: "0 10px",
          borderRadius: 10,
          border: "1px solid var(--ou-border-default, #e5e7eb)",
          borderInlineStart: `3px solid ${RESOURCE_TOPOLOGY_HEALTH_COLORS[node.effectiveHealth]}`,
          background: "var(--ou-surface-primary, #ffffff)",
          boxShadow: shadowFor(node),
          outline: outlineFor(data, false),
          outlineOffset: 2,
        }}
      >
        <span
          style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}
        >
          <HealthDot node={node} />
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
  resourceTopologyContainer: ResourceTopologyContainerNode,
  resourceTopologyCard: ResourceTopologyCardNode,
  resourceTopologyChip: ResourceTopologyChipNode,
  resourceTopologyMore: ResourceTopologyMoreNode,
  resourceTopologyRelated: ResourceTopologyRelatedNode,
  resourceTopologyRelatedCaption: ResourceTopologyRelatedCaptionNode,
};
