import Icon, { ThickProp } from "../Icon/Icon";
import Pill from "../Pill/Pill";
import Tooltip from "../Tooltip/Tooltip";
import { Yellow } from "../../../Types/BrandColors";
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

const Node: FunctionComponent<ComponentProps> = (props: ComponentProps) => {
  const [isHovering, setIsHovering] = useState<boolean>(false);

  const isTrigger: boolean =
    props.data.metadata.componentType === ComponentType.Trigger;
  const isPlaceholder: boolean =
    props.data.nodeType === NodeType.PlaceholderNode;
  const hasError: boolean = Boolean(
    props.data.error && !props.data.isPreview && !isPlaceholder,
  );

  // Colors based on state
  const getBorderColor = (): string => {
    if (props.selected) {
      return "#6366f1"; // indigo-500
    }
    if (hasError) {
      return "#ef4444"; // red-500
    }
    if (isHovering) {
      if (isPlaceholder) {
        return "#a5b4fc"; // indigo-300
      }
      return "#818cf8"; // indigo-400
    }
    if (isPlaceholder) {
      return "#cbd5e1"; // slate-300
    }
    if (isTrigger) {
      return "#fbbf24"; // amber-400
    }
    return "#e2e8f0"; // slate-200
  };

  const getBackgroundGradient = (): string => {
    if (isPlaceholder) {
      return "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)";
    }
    if (isTrigger) {
      return "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)";
    }
    return "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)";
  };

  const getIconBackgroundColor = (): string => {
    if (isPlaceholder) {
      return isHovering ? "#e0e7ff" : "#f1f5f9";
    }
    if (isTrigger) {
      return "#fef3c7";
    }
    if (props.selected) {
      return "#e0e7ff";
    }
    return isHovering ? "#e0e7ff" : "#f1f5f9";
  };

  const getIconColor = (): string => {
    if (isPlaceholder) {
      return isHovering ? "#6366f1" : "#94a3b8";
    }
    if (isTrigger) {
      return "#d97706";
    }
    if (props.selected || isHovering) {
      return "#6366f1";
    }
    return "#64748b";
  };

  const getTitleColor = (): string => {
    if (isPlaceholder) {
      return isHovering ? "#475569" : "#94a3b8";
    }
    return isHovering || props.selected ? "#1e293b" : "#334155";
  };

  const getDescriptionColor = (): string => {
    if (isPlaceholder) {
      return isHovering ? "#64748b" : "#cbd5e1";
    }
    return "#64748b";
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
      return isLabel ? { left: 112 } : {};
    }

    if (portCount === 1 && totalPorts === 2) {
      return { left: isLabel ? 70 : 80 };
    }

    if (portCount === 2 && totalPorts === 2) {
      return { left: isLabel ? 150 : 160 };
    }

    if (portCount === 1 && totalPorts === 3) {
      return { left: isLabel ? 50 : 60 };
    }

    if (portCount === 2 && totalPorts === 3) {
      return isLabel ? { left: 112 } : {};
    }

    if (portCount === 3 && totalPorts === 3) {
      return { left: isLabel ? 170 : 180 };
    }

    return {};
  };

  const handleStyle: React.CSSProperties = {
    background: isPlaceholder ? "#cbd5e1" : "#6366f1",
    height: "12px",
    width: "12px",
    border: "2px solid white",
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.2)",
    transition: "transform 0.15s ease",
  };

  const handleHoverStyle: React.CSSProperties = {
    ...handleStyle,
    transform: "scale(1.2)",
  };

  return (
    <div
      className="cursor-pointer transition-all duration-200"
      onMouseOver={() => {
        setIsHovering(true);
      }}
      onMouseOut={() => {
        setIsHovering(false);
      }}
      style={{
        width: "240px",
        minHeight: isPlaceholder ? "120px" : props.data.id ? "160px" : "140px",
        padding: "16px",
        borderRadius: "12px",
        borderWidth: isPlaceholder ? "2px" : "1px",
        borderStyle: isPlaceholder ? "dashed" : "solid",
        borderColor: getBorderColor(),
        background: getBackgroundGradient(),
        boxShadow: props.selected
          ? "0 0 0 3px rgba(99, 102, 241, 0.2), 0 10px 25px -5px rgba(0, 0, 0, 0.1)"
          : isHovering
            ? "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)"
            : "0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)",
        transform: isHovering && !isPlaceholder ? "translateY(-2px)" : "none",
      }}
      onClick={() => {
        if (props.data.onClick) {
          props.data.onClick(props.data);
        }
      }}
    >
      {/* Badge area */}
      <div className="flex justify-between items-start mb-2">
        <div>
          {isTrigger && !isPlaceholder && !props.data.isPreview && (
            <Pill text="Trigger" color={Yellow} />
          )}
        </div>
        {/* Error indicator */}
        {hasError && (
          <Tooltip text={props.data.error || "Error in component"}>
            <div
              className="flex items-center justify-center w-6 h-6 rounded-full bg-red-100"
              style={{ cursor: "help" }}
            >
              <Icon
                icon={IconProp.Alert}
                style={{
                  color: "#ef4444",
                  width: "14px",
                  height: "14px",
                }}
                thick={ThickProp.Thick}
              />
            </div>
          </Tooltip>
        )}
      </div>

      {/* Input ports (top) */}
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
                      ...(isHovering ? handleHoverStyle : handleStyle),
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

      {/* Icon and content */}
      <div className="flex flex-col items-center text-center">
        {/* Icon container */}
        {props.data.metadata.iconProp && (
          <div
            className="flex items-center justify-center rounded-xl mb-3 transition-colors duration-200"
            style={{
              width: "48px",
              height: "48px",
              backgroundColor: getIconBackgroundColor(),
            }}
          >
            <Icon
              icon={props.data.metadata.iconProp}
              style={{
                color: getIconColor(),
                width: "24px",
                height: "24px",
              }}
            />
          </div>
        )}

        {/* Title */}
        <p
          className="font-semibold text-sm leading-tight mb-1 transition-colors duration-200"
          style={{ color: getTitleColor() }}
        >
          {props.data.metadata.title}
        </p>

        {/* Component ID */}
        {!props.data.isPreview && props.data.id && (
          <p
            className="text-xs mb-1 font-mono"
            style={{ color: "#94a3b8" }}
          >
            {props.data.id}
          </p>
        )}

        {/* Description */}
        <p
          className="text-xs leading-tight transition-colors duration-200"
          style={{
            color: getDescriptionColor(),
            maxWidth: "200px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {props.data.metadata.description}
        </p>
      </div>

      {/* Output ports (bottom) */}
      {!props.data.isPreview && !isPlaceholder && (
        <>
          <div>
            {props.data.metadata.outPorts &&
              props.data.metadata.outPorts.length > 0 &&
              props.data.metadata.outPorts.map((port: Port, i: number) => {
                return (
                  <Handle
                    key={i}
                    type="source"
                    id={port.id}
                    onConnect={(_params: Connection) => {}}
                    isConnectable={true}
                    position={Position.Bottom}
                    style={{
                      ...(isHovering ? handleHoverStyle : handleStyle),
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
          {/* Port labels */}
          <div>
            {props.data.metadata.outPorts &&
              props.data.metadata.outPorts.length > 1 &&
              props.data.metadata.outPorts.map((port: Port, i: number) => {
                return (
                  <Tooltip key={i} text={port.description || ""}>
                    <div
                      className="absolute text-xs font-medium"
                      style={{
                        bottom: "8px",
                        color: "#94a3b8",
                        ...getPortPosition(
                          i + 1,
                          props.data.metadata.outPorts.length,
                          true,
                        ),
                      }}
                    >
                      {port.title}
                    </div>
                  </Tooltip>
                );
              })}
          </div>
        </>
      )}
    </div>
  );
};

export default Node;
