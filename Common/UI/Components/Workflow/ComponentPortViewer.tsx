import { Port } from "../../../Types/Workflow/Component";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  ports: Array<Port>;
  name: string;
  description: string;
}

const ComponentPortViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="mt-3 mb-3">
      <h2 className="text-sm font-semibold text-gray-600">{props.name}</h2>
      <p className="text-xs text-gray-400 mb-2">{props.description}</p>
      {props.ports && props.ports.length === 0 && (
        <p className="text-xs text-gray-400 italic">No ports configured.</p>
      )}
      <div>
        {props.ports &&
          props.ports.length > 0 &&
          props.ports.map((port: Port, i: number) => {
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.625rem",
                  padding: "0.5rem 0.75rem",
                  borderRadius: "8px",
                  backgroundColor: "#f8fafc",
                  border: "1px solid #f1f5f9",
                  marginBottom: "0.375rem",
                }}
              >
                <div
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    backgroundColor: "#94a3b8",
                    flexShrink: 0,
                  }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p
                    style={{
                      fontSize: "0.8125rem",
                      fontWeight: 500,
                      color: "#334155",
                      margin: 0,
                      lineHeight: "1.25rem",
                    }}
                  >
                    {port.title}
                    <span
                      style={{
                        color: "#94a3b8",
                        fontWeight: 400,
                        fontSize: "0.6875rem",
                        marginLeft: "0.375rem",
                        fontFamily:
                          'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
                      }}
                    >
                      {port.id}
                    </span>
                  </p>
                  {port.description && (
                    <p
                      style={{
                        fontSize: "0.75rem",
                        color: "#94a3b8",
                        margin: 0,
                        lineHeight: "1rem",
                      }}
                    >
                      {port.description}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
};

export default ComponentPortViewer;
