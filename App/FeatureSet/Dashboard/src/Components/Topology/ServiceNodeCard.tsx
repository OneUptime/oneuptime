import React, { FunctionComponent, ReactElement } from "react";
import { Handle, Position } from "reactflow";
import { HEALTH_COLORS, TrafficHealth } from "./TopologyMeta";

/*
 * Shared node body for service graphs: used by the project-wide Service
 * Map and the per-trace service map so both speak one visual language —
 * health-colored border, name line (with an optional service color dot),
 * and small stat lines underneath.
 *
 * React Flow resolves edge endpoints from <Handle> bounds; a custom node
 * without handles silently drops every edge that touches it ("Couldn't
 * create edge" error008). The layouts flow top → bottom, so callers
 * attach at the top and callees leave from the bottom; the handles are
 * invisible and non-interactive.
 */

export interface ComponentProps {
  label: string;
  health: TrafficHealth;
  /** Telemetry service accent color, rendered as a small dot. */
  colorDot?: string | undefined;
  /** Small gray stat lines under the name (already formatted). */
  statLines?: Array<ReactElement> | undefined;
  dimmed?: boolean | undefined;
}

const ServiceNodeCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div
      style={{
        border: `2px solid ${HEALTH_COLORS[props.health]}`,
        borderRadius: 8,
        padding: "8px 12px",
        background: "var(--ou-surface-primary, #ffffff)",
        color: "var(--ou-text-primary, #111827)",
        width: 200,
        opacity: props.dimmed ? 0.25 : 1,
        cursor: "pointer",
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        style={{ opacity: 0, pointerEvents: "none" }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        style={{ opacity: 0, pointerEvents: "none" }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {props.colorDot ? (
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              backgroundColor: props.colorDot,
              flexShrink: 0,
              boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.1)",
            }}
          />
        ) : (
          <></>
        )}
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {props.label}
        </span>
      </div>
      {(props.statLines || []).map(
        (line: ReactElement, index: number): ReactElement => {
          return (
            <div
              key={index}
              style={{ marginTop: 4, fontSize: 11, color: "#6b7280" }}
            >
              {line}
            </div>
          );
        },
      )}
    </div>
  );
};

export default ServiceNodeCard;
