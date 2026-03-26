import Icon, { ThickProp } from "../Icon/Icon";
import Tooltip from "../Tooltip/Tooltip";
import IconProp from "../../../Types/Icon/IconProp";
import {
  ComponentType,
  NodeDataProp,
  NodeType,
  Port,
} from "../../../Types/Workflow/Component";
import React, { FunctionComponent, useState } from "react";
import { Connection, Handle, Position } from "reactflow";

export interface ComponentProps {
  data: NodeDataProp;
  selected: boolean;
}

type CategoryColorScheme = {
  bg: string;
  border: string;
  headerBg: string;
  headerText: string;
  iconColor: string;
  selectedBorder: string;
  selectedShadow: string;
  handleBg: string;
  handleBorder: string;
};

const getCategoryColors = (
  category: string,
  componentType: ComponentType,
): CategoryColorScheme => {
  if (componentType === ComponentType.Trigger) {
    return {
      bg: "#fefce8",
      border: "#fde68a",
      headerBg: "linear-gradient(135deg, #f59e0b, #d97706)",
      headerText: "#ffffff",
      iconColor: "#ffffff",
      selectedBorder: "#f59e0b",
      selectedShadow: "0 0 0 3px rgba(245, 158, 11, 0.2)",
      handleBg: "#f59e0b",
      handleBorder: "#d97706",
    };
  }

  const lowerCategory: string = category.toLowerCase();

  if (lowerCategory.includes("condition") || lowerCategory.includes("logic")) {
    return {
      bg: "#faf5ff",
      border: "#e9d5ff",
      headerBg: "linear-gradient(135deg, #a855f7, #7c3aed)",
      headerText: "#ffffff",
      iconColor: "#ffffff",
      selectedBorder: "#a855f7",
      selectedShadow: "0 0 0 3px rgba(168, 85, 247, 0.2)",
      handleBg: "#a855f7",
      handleBorder: "#7c3aed",
    };
  }

  if (lowerCategory.includes("api") || lowerCategory.includes("webhook")) {
    return {
      bg: "#eff6ff",
      border: "#bfdbfe",
      headerBg: "linear-gradient(135deg, #3b82f6, #2563eb)",
      headerText: "#ffffff",
      iconColor: "#ffffff",
      selectedBorder: "#3b82f6",
      selectedShadow: "0 0 0 3px rgba(59, 130, 246, 0.2)",
      handleBg: "#3b82f6",
      handleBorder: "#2563eb",
    };
  }

  if (
    lowerCategory.includes("slack") ||
    lowerCategory.includes("discord") ||
    lowerCategory.includes("teams") ||
    lowerCategory.includes("telegram") ||
    lowerCategory.includes("email") ||
    lowerCategory.includes("notification")
  ) {
    return {
      bg: "#ecfdf5",
      border: "#a7f3d0",
      headerBg: "linear-gradient(135deg, #10b981, #059669)",
      headerText: "#ffffff",
      iconColor: "#ffffff",
      selectedBorder: "#10b981",
      selectedShadow: "0 0 0 3px rgba(16, 185, 129, 0.2)",
      handleBg: "#10b981",
      handleBorder: "#059669",
    };
  }

  if (
    lowerCategory.includes("code") ||
    lowerCategory.includes("javascript") ||
    lowerCategory.includes("custom")
  ) {
    return {
      bg: "#fef2f2",
      border: "#fecaca",
      headerBg: "linear-gradient(135deg, #ef4444, #dc2626)",
      headerText: "#ffffff",
      iconColor: "#ffffff",
      selectedBorder: "#ef4444",
      selectedShadow: "0 0 0 3px rgba(239, 68, 68, 0.2)",
      handleBg: "#ef4444",
      handleBorder: "#dc2626",
    };
  }

  if (lowerCategory.includes("json") || lowerCategory.includes("util")) {
    return {
      bg: "#f0fdf4",
      border: "#bbf7d0",
      headerBg: "linear-gradient(135deg, #22c55e, #16a34a)",
      headerText: "#ffffff",
      iconColor: "#ffffff",
      selectedBorder: "#22c55e",
      selectedShadow: "0 0 0 3px rgba(34, 197, 94, 0.2)",
      handleBg: "#22c55e",
      handleBorder: "#16a34a",
    };
  }

  if (
    lowerCategory.includes("schedule") ||
    lowerCategory.includes("cron") ||
    lowerCategory.includes("timer")
  ) {
    return {
      bg: "#fff7ed",
      border: "#fed7aa",
      headerBg: "linear-gradient(135deg, #f97316, #ea580c)",
      headerText: "#ffffff",
      iconColor: "#ffffff",
      selectedBorder: "#f97316",
      selectedShadow: "0 0 0 3px rgba(249, 115, 22, 0.2)",
      handleBg: "#f97316",
      handleBorder: "#ea580c",
    };
  }

  // Default / database models
  return {
    bg: "#f8fafc",
    border: "#e2e8f0",
    headerBg: "linear-gradient(135deg, #6366f1, #4f46e5)",
    headerText: "#ffffff",
    iconColor: "#ffffff",
    selectedBorder: "#6366f1",
    selectedShadow: "0 0 0 3px rgba(99, 102, 241, 0.2)",
    handleBg: "#6366f1",
    handleBorder: "#4f46e5",
  };
};

type GetPortPositionFunction = (
  portCount: number,
  totalPorts: number,
  isLabel: boolean,
) => React.CSSProperties;

const getPortPosition: GetPortPositionFunction = (
  portCount: number,
  totalPorts: number,
  isLabel: boolean,
): React.CSSProperties => {
  if (portCount === 1 && totalPorts === 1) {
    return isLabel ? { left: 120 } : {};
  }

  if (portCount === 1 && totalPorts === 2) {
    return { left: isLabel ? 70 : 80 };
  }

  if (portCount === 2 && totalPorts === 2) {
    return { left: isLabel ? 170 : 180 };
  }

  if (portCount === 1 && totalPorts === 3) {
    return { left: isLabel ? 40 : 50 };
  }

  if (portCount === 2 && totalPorts === 3) {
    return isLabel ? { left: 120 } : {};
  }

  if (portCount === 3 && totalPorts === 3) {
    return { left: isLabel ? 200 : 210 };
  }

  return {};
};

const Node: FunctionComponent<ComponentProps> = (props: ComponentProps) => {
  const [isHovering, setIsHovering] = useState<boolean>(false);

  const colors: CategoryColorScheme = getCategoryColors(
    props.data.metadata.category || "",
    props.data.metadata.componentType,
  );

  // Placeholder node
  if (props.data.nodeType === NodeType.PlaceholderNode) {
    return (
      <div
        className="cursor-pointer"
        onMouseOver={() => {
          setIsHovering(true);
        }}
        onMouseOut={() => {
          setIsHovering(false);
        }}
        style={{
          width: "16rem",
          borderRadius: "12px",
          border: `2px dashed ${isHovering ? "#94a3b8" : "#cbd5e1"}`,
          backgroundColor: isHovering ? "#f8fafc" : "#ffffff",
          padding: "1.5rem",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.75rem",
          transition: "all 0.2s ease",
          minHeight: "7rem",
        }}
        onClick={() => {
          if (props.data.onClick) {
            props.data.onClick(props.data);
          }
        }}
      >
        <div
          style={{
            width: "2.5rem",
            height: "2.5rem",
            borderRadius: "50%",
            backgroundColor: isHovering ? "#e2e8f0" : "#f1f5f9",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.2s ease",
          }}
        >
          <Icon
            icon={IconProp.Add}
            style={{
              color: isHovering ? "#64748b" : "#94a3b8",
              width: "1.25rem",
              height: "1.25rem",
              transition: "all 0.2s ease",
            }}
          />
        </div>
        <p
          style={{
            color: isHovering ? "#64748b" : "#94a3b8",
            fontSize: "0.8125rem",
            fontWeight: 500,
            textAlign: "center",
            margin: 0,
            transition: "all 0.2s ease",
          }}
        >
          {props.data.metadata.description || "Click to add trigger"}
        </p>
      </div>
    );
  }

  // Regular node
  const hasError: boolean = Boolean(props.data.error);

  return (
    <div
      className="cursor-pointer"
      onMouseOver={() => {
        setIsHovering(true);
      }}
      onMouseOut={() => {
        setIsHovering(false);
      }}
      style={{
        width: "16rem",
        borderRadius: "12px",
        border: `2px solid ${
          hasError
            ? "#fca5a5"
            : props.selected
              ? colors.selectedBorder
              : isHovering
                ? colors.selectedBorder
                : colors.border
        }`,
        backgroundColor: "#ffffff",
        overflow: "visible",
        boxShadow: props.selected
          ? colors.selectedShadow
          : isHovering
            ? `0 8px 25px -5px rgba(0, 0, 0, 0.1), 0 4px 10px -6px rgba(0, 0, 0, 0.05)`
            : `0 1px 3px 0 rgba(0, 0, 0, 0.07), 0 1px 2px -1px rgba(0, 0, 0, 0.05)`,
        transition: "all 0.2s ease",
        transform: isHovering ? "translateY(-1px)" : "none",
        position: "relative",
      }}
      onClick={() => {
        if (props.data.onClick) {
          props.data.onClick(props.data);
        }
      }}
    >
      {/* In Ports (top handles) */}
      {!props.data.isPreview &&
        props.data.metadata.componentType !== ComponentType.Trigger && (
          <div>
            {props.data.metadata.inPorts &&
              props.data.metadata.inPorts.length > 0 &&
              props.data.metadata.inPorts.map((port: Port, i: number) => {
                return (
                  <Handle
                    key={i}
                    type="target"
                    id={port.id}
                    onConnect={(_params: Connection) => {}}
                    isConnectable={true}
                    position={Position.Top}
                    style={{
                      background: colors.handleBg,
                      height: "10px",
                      width: "10px",
                      border: `2px solid ${colors.handleBorder}`,
                      top: "-5px",
                      transition: "all 0.15s ease",
                      ...getPortPosition(
                        i + 1,
                        props.data.metadata.inPorts.length,
                        false,
                      ),
                    }}
                  />
                );
              })}
          </div>
        )}

      {/* Error indicator */}
      {!props.data.isPreview && hasError && (
        <div
          style={{
            position: "absolute",
            top: "8px",
            right: "8px",
            zIndex: 10,
            width: "22px",
            height: "22px",
            borderRadius: "50%",
            backgroundColor: "#fef2f2",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid #fecaca",
          }}
        >
          <Icon
            icon={IconProp.Alert}
            style={{
              color: "#ef4444",
              width: "0.75rem",
              height: "0.75rem",
            }}
            thick={ThickProp.Thick}
          />
        </div>
      )}

      {/* Header bar with gradient */}
      <div
        style={{
          background: colors.headerBg,
          padding: "0.625rem 0.875rem",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          borderRadius: "10px 10px 0 0",
        }}
      >
        {props.data.metadata.iconProp && (
          <div
            style={{
              width: "1.75rem",
              height: "1.75rem",
              borderRadius: "6px",
              backgroundColor: "rgba(255, 255, 255, 0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon
              icon={props.data.metadata.iconProp}
              style={{
                color: colors.iconColor,
                width: "0.875rem",
                height: "0.875rem",
              }}
            />
          </div>
        )}
        <span
          style={{
            color: colors.headerText,
            fontSize: "0.8125rem",
            fontWeight: 600,
            letterSpacing: "0.01em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {props.data.metadata.title}
        </span>
      </div>

      {/* Body */}
      <div
        style={{
          padding: "0.75rem 0.875rem",
          backgroundColor: colors.bg,
          minHeight: "3rem",
          borderRadius:
            !props.data.metadata.outPorts ||
            props.data.metadata.outPorts.length === 0
              ? "0 0 10px 10px"
              : undefined,
        }}
      >
        {/* Component ID badge */}
        {!props.data.isPreview && props.data.id && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              backgroundColor: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "6px",
              padding: "0.125rem 0.5rem",
              marginBottom: "0.5rem",
            }}
          >
            <span
              style={{
                color: "#64748b",
                fontSize: "0.6875rem",
                fontWeight: 500,
                fontFamily:
                  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
              }}
            >
              {props.data.id.trim()}
            </span>
          </div>
        )}

        {/* Description */}
        <p
          style={{
            color: "#64748b",
            fontSize: "0.75rem",
            lineHeight: "1.125rem",
            margin: 0,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {props.data.metadata.description}
        </p>
      </div>

      {/* Out ports section */}
      {!props.data.isPreview &&
        props.data.metadata.outPorts &&
        props.data.metadata.outPorts.length > 0 && (
          <>
            {/* Port labels */}
            <div
              style={{
                borderTop: `1px solid ${colors.border}`,
                padding: "0.375rem 0.875rem",
                display: "flex",
                justifyContent:
                  props.data.metadata.outPorts.length === 1
                    ? "center"
                    : "space-between",
                backgroundColor: "#ffffff",
                borderRadius: "0 0 10px 10px",
              }}
            >
              {props.data.metadata.outPorts.map((port: Port, i: number) => {
                return (
                  <Tooltip key={i} text={port.description || ""}>
                    <span
                      style={{
                        color: "#94a3b8",
                        fontSize: "0.6875rem",
                        fontWeight: 500,
                      }}
                    >
                      {port.title}
                    </span>
                  </Tooltip>
                );
              })}
            </div>

            {/* Bottom handles */}
            <div>
              {props.data.metadata.outPorts.map((port: Port, i: number) => {
                return (
                  <Handle
                    key={i}
                    type="source"
                    id={port.id}
                    onConnect={(_params: Connection) => {}}
                    isConnectable={true}
                    position={Position.Bottom}
                    style={{
                      background: colors.handleBg,
                      height: "10px",
                      width: "10px",
                      border: `2px solid ${colors.handleBorder}`,
                      bottom: "-5px",
                      transition: "all 0.15s ease",
                      ...getPortPosition(
                        i + 1,
                        props.data.metadata.outPorts.length,
                        false,
                      ),
                    }}
                  />
                );
              })}
            </div>
          </>
        )}
    </div>
  );
};

export default Node;
