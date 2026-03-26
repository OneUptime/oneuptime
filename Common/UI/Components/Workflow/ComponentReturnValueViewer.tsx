import { ReturnValue } from "../../../Types/Workflow/Component";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  returnValues: Array<ReturnValue>;
  name: string;
  description: string;
}

const ComponentReturnValueViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="mt-3 mb-3">
      <h2 className="text-sm font-semibold text-gray-600">{props.name}</h2>
      <p className="text-xs text-gray-400 mb-2">{props.description}</p>
      {props.returnValues && props.returnValues.length === 0 && (
        <p className="text-xs text-gray-400 italic">
          This component does not return any values.
        </p>
      )}
      <div>
        {props.returnValues &&
          props.returnValues.length > 0 &&
          props.returnValues.map((returnValue: ReturnValue, i: number) => {
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.625rem",
                  padding: "0.5rem 0.75rem",
                  borderRadius: "8px",
                  backgroundColor: "#f8fafc",
                  border: "1px solid #f1f5f9",
                  marginBottom: "0.375rem",
                }}
              >
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
                    {returnValue.name}
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
                      {returnValue.id}
                    </span>
                  </p>
                  {returnValue.description && (
                    <p
                      style={{
                        fontSize: "0.75rem",
                        color: "#94a3b8",
                        margin: 0,
                        lineHeight: "1rem",
                      }}
                    >
                      {returnValue.description}
                    </p>
                  )}
                </div>
                <span
                  style={{
                    fontSize: "0.6875rem",
                    fontWeight: 500,
                    color: "#6366f1",
                    backgroundColor: "#eef2ff",
                    padding: "0.125rem 0.5rem",
                    borderRadius: "100px",
                    whiteSpace: "nowrap",
                    border: "1px solid #e0e7ff",
                  }}
                >
                  {returnValue.type}
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
};

export default ComponentReturnValueViewer;
