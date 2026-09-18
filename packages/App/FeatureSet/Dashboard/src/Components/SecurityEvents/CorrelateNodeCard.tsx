import React, { CSSProperties, FunctionComponent, ReactElement } from "react";
import { Handle, NodeProps, NodeTypes, Position } from "reactflow";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import useTranslateValue from "Common/UI/Utils/Translation";
import { getSeverityColor } from "./SecurityEventSeverityPill";
import { CorrelationGraphNodeKind } from "../../Utils/CorrelationGraph";

/*
 * The React Flow node for Security Events → Correlate. One component draws
 * all three kinds: the applied filter in the middle (a filled indigo card),
 * event classes (a card tinted and edged by their worst severity, with the
 * severity spelled out so colour is never the only cue), and co-occurring
 * observables (a compact pill with a count badge).
 *
 * Every card has a fixed size. The layout packs nodes by these sizes, and
 * the graph hands the same numbers to React Flow as explicit node sizes so
 * a rebuilt node array never renders hidden while it waits to be measured.
 *
 * The cards are aria-hidden: the inspector's overview list is the keyboard
 * and screen-reader path through the same results.
 */

export const CORRELATE_NODE_TYPE: string = "correlate";

/*
 * Keep these inside the footprints the layout test packs with
 * (CorrelationGraphLayout.test.ts: 230x60, 200x60, 170x36), or cards
 * can overlap on screen even though the layout says they don't.
 */
export const CORRELATE_NODE_SIZES: Record<
  CorrelationGraphNodeKind,
  { width: number; height: number }
> = {
  center: { width: 220, height: 56 },
  class: { width: 196, height: 56 },
  observable: { width: 164, height: 32 },
};

export interface CorrelateNodeData {
  // Kept in the graph's plain-text format for tests and debugging.
  label: string;
  kind: CorrelationGraphNodeKind;
  // Small caption above the centre card's title.
  eyebrow?: string | undefined;
  title: string;
  isMonospace?: boolean | undefined;
  count?: number | undefined;
  // The search hit its row cap, so the count is a floor.
  countIsLowerBound?: boolean | undefined;
  worstSeverity?: OcsfSeverity | undefined;
  tooltip: string;
  isSelected: boolean;
  isDimmed: boolean;
}

/*
 * React Flow drops every edge that touches a custom node without handles.
 * These are invisible 1px points at the card centre, so straight edges meet
 * in the middle of each card and disappear underneath it. Position is set
 * here too, not left to React Flow's stylesheet: a static handle would
 * become a flex item and push the card's content aside.
 */
const CENTRE_HANDLE_STYLE: CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  right: "auto",
  bottom: "auto",
  transform: "translate(-50%, -50%)",
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: 0,
  background: "transparent",
  opacity: 0,
  pointerEvents: "none",
};

const SELECTED_SHADOW: string =
  "0 0 0 2px #6366f1, var(--ou-shadow-md, 0 4px 12px rgba(15, 23, 42, 0.12))";

const RESTING_SHADOW: string =
  "var(--ou-shadow-sm, 0 1px 2px rgba(15, 23, 42, 0.08))";

const NEUTRAL_ACCENT: string = "var(--ou-chart-series-neutral, #64748b)";

const CorrelateNodeCard: FunctionComponent<NodeProps<CorrelateNodeData>> = (
  props: NodeProps<CorrelateNodeData>,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const t: (value: string) => string = (value: string): string => {
    return translateString(value) || value;
  };

  const data: CorrelateNodeData = props.data;
  const size: { width: number; height: number } =
    CORRELATE_NODE_SIZES[data.kind];
  const countSuffix: string = data.countIsLowerBound ? "+" : "";

  const rootStyle: CSSProperties = {
    position: "relative",
    width: size.width,
    height: size.height,
    boxSizing: "border-box",
    overflow: "hidden",
    opacity: data.isDimmed ? 0.3 : 1,
    transition: "opacity 120ms ease",
    cursor: data.kind === "center" ? "default" : "pointer",
  };

  const handles: ReactElement = (
    <>
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        style={CENTRE_HANDLE_STYLE}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        style={CENTRE_HANDLE_STYLE}
      />
    </>
  );

  if (data.kind === "center") {
    return (
      <div
        title={data.tooltip}
        data-testid={`correlate-node-${props.id}`}
        aria-hidden={true}
        style={{
          ...rootStyle,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "#4f46e5",
          color: "#ffffff",
          borderRadius: 12,
          padding: "8px 12px",
          boxShadow: "0 4px 14px rgba(79, 70, 229, 0.28)",
        }}
      >
        {handles}
        {data.eyebrow && (
          <span
            className="block truncate text-[10px] font-semibold uppercase leading-4 tracking-wide"
            style={{ opacity: 0.8 }}
          >
            {data.eyebrow}
          </span>
        )}
        <span
          className={`block truncate text-[13px] font-semibold leading-[18px]${
            data.isMonospace ? " font-mono" : ""
          }`}
        >
          {data.title}
        </span>
      </div>
    );
  }

  if (data.kind === "class") {
    const accent: string = data.worstSeverity
      ? getSeverityColor(data.worstSeverity).toString()
      : NEUTRAL_ACCENT;
    const count: number = data.count ?? 0;

    return (
      <div
        title={data.tooltip}
        data-testid={`correlate-node-${props.id}`}
        aria-hidden={true}
        style={{
          ...rootStyle,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: `color-mix(in srgb, ${accent} 9%, var(--ou-surface-primary, #ffffff))`,
          color: "var(--ou-text-primary, #111827)",
          border: "1px solid var(--ou-border-default, #e5e7eb)",
          borderRadius: 10,
          padding: "6px 10px 6px 14px",
          boxShadow: data.isSelected ? SELECTED_SHADOW : RESTING_SHADOW,
        }}
      >
        {handles}
        <span
          aria-hidden={true}
          data-testid={`correlate-node-${props.id}-accent`}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: 4,
            background: accent,
          }}
        />
        <span className="block truncate text-[13px] font-semibold leading-[18px]">
          {data.title}
        </span>
        <span
          className="mt-1 flex items-center justify-between gap-2 text-[11px] leading-4"
          style={{ color: "var(--ou-text-secondary, #4b5563)" }}
        >
          <span className="inline-flex min-w-0 items-center gap-1">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: accent }}
            />
            <span className="truncate">
              {data.worstSeverity ?? t("No severity")}
            </span>
          </span>
          <span className="shrink-0 tabular-nums">
            {`${count}${countSuffix} ${t(count === 1 ? "event" : "events")}`}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div
      title={data.tooltip}
      data-testid={`correlate-node-${props.id}`}
      aria-hidden={true}
      style={{
        ...rootStyle,
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "var(--ou-surface-primary, #ffffff)",
        color: "var(--ou-text-primary, #111827)",
        border: "1px solid var(--ou-border-strong, #d1d5db)",
        borderRadius: 999,
        padding: "0 4px 0 10px",
        boxShadow: data.isSelected ? SELECTED_SHADOW : RESTING_SHADOW,
      }}
    >
      {handles}
      <span className="min-w-0 flex-1 truncate font-mono text-xs">
        {data.title}
      </span>
      {typeof data.count === "number" && (
        <span
          className="shrink-0 rounded-full px-1.5 text-[10px] font-medium tabular-nums"
          style={{
            background: "var(--ou-surface-tertiary, #f3f4f6)",
            color: "var(--ou-text-secondary, #4b5563)",
          }}
        >
          {`${data.count}${countSuffix}`}
        </span>
      )}
    </div>
  );
};

/*
 * Module scope on purpose: React Flow re-mounts every node when it receives
 * a new nodeTypes object.
 */
export const CORRELATE_NODE_TYPES: NodeTypes = {
  [CORRELATE_NODE_TYPE]: CorrelateNodeCard,
};

export default CorrelateNodeCard;
