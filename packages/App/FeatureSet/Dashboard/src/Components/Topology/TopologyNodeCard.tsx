import React, { FunctionComponent, ReactElement } from "react";
import { Handle, Position } from "reactflow";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

/*
 * One card for both topology maps, so a service, a database and a group of
 * pods read as the same kind of object: an icon tinted by what it is, a name
 * that never truncates silently (full name on hover), one status line, a few
 * numbers, and a footer for context.
 *
 * Edges attach through invisible handles on the left (incoming) and right
 * (outgoing) — both maps flow left to right. React Flow drops every edge that
 * touches a custom node without handles, so they are always rendered.
 */

export const TOPOLOGY_NODE_WIDTH: number = 256;
/* The tallest card: title, status, a row of stats and a footer. */
export const TOPOLOGY_NODE_HEIGHT: number = 128;

export interface TopologyNodeStat {
  label: string;
  value: string;
  color?: string | undefined;
}

export interface ComponentProps {
  title: string;
  subtitle: string;
  icon: IconProp;
  /** Type color: tints the icon tile. */
  color: string;
  /** Status color: the left accent bar and the status dot. */
  statusColor: string;
  statusLabel: string;
  stats?: Array<TopologyNodeStat> | undefined;
  footer?: string | undefined;
  dimmed?: boolean | undefined;
  selected?: boolean | undefined;
  /** Stacked look for a node that stands for many resources. */
  stacked?: boolean | undefined;
  testId?: string | undefined;
}

const TopologyNodeCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const stats: Array<TopologyNodeStat> = props.stats || [];
  return (
    <div
      data-testid={props.testId}
      title={props.title}
      style={{
        position: "relative",
        width: TOPOLOGY_NODE_WIDTH,
        minHeight: 88,
        borderRadius: 12,
        border: `1px solid ${props.selected ? "#6366f1" : "var(--ou-border-primary, #e2e8f0)"}`,
        borderLeft: `4px solid ${props.statusColor}`,
        background: "var(--ou-surface-primary, #ffffff)",
        color: "var(--ou-text-primary, #111827)",
        boxShadow: props.stacked
          ? "4px 4px 0 -1px var(--ou-surface-primary, #ffffff), 4px 4px 0 0 var(--ou-border-primary, #e2e8f0), 0 2px 8px rgba(15, 23, 42, 0.08)"
          : props.selected
            ? "0 0 0 3px rgba(99, 102, 241, 0.2), 0 4px 12px rgba(15, 23, 42, 0.1)"
            : "0 1px 3px rgba(15, 23, 42, 0.08)",
        opacity: props.dimmed ? 0.45 : 1,
        padding: "10px 12px",
        cursor: "pointer",
        transition: "opacity 120ms ease",
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        style={{ opacity: 0, pointerEvents: "none" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        style={{ opacity: 0, pointerEvents: "none" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          aria-hidden={true}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            flexShrink: 0,
            borderRadius: 8,
            color: props.color,
            background: `${props.color}1a`,
          }}
        >
          <Icon icon={props.icon} className="h-4 w-4" />
        </span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 600,
              lineHeight: "18px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {props.title}
          </span>
          <span
            style={{
              display: "block",
              fontSize: 11,
              lineHeight: "16px",
              color: "#64748b",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {props.subtitle}
          </span>
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginTop: 8,
          fontSize: 11,
          color: "#475569",
        }}
      >
        <span
          aria-hidden={true}
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: props.statusColor,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {props.statusLabel}
        </span>
      </div>
      {stats.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "nowrap",
            alignItems: "baseline",
            gap: 10,
            marginTop: 6,
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          {stats.map((stat: TopologyNodeStat): ReactElement => {
            return (
              <span key={stat.label} style={{ minWidth: 0, fontSize: 12 }}>
                <span
                  style={{
                    fontWeight: 600,
                    color: stat.color || "var(--ou-text-primary, #111827)",
                  }}
                >
                  {stat.value}
                </span>{" "}
                <span style={{ fontSize: 10, color: "#94a3b8" }}>
                  {stat.label}
                </span>
              </span>
            );
          })}
        </div>
      )}
      {props.footer && (
        <div
          style={{
            marginTop: 6,
            paddingTop: 5,
            borderTop: "1px dashed var(--ou-border-primary, #e2e8f0)",
            fontSize: 11,
            color: "#64748b",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {props.footer}
        </div>
      )}
    </div>
  );
};

export default TopologyNodeCard;
