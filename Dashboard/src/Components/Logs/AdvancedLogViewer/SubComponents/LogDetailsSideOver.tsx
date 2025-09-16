import React, { FunctionComponent, ReactElement } from "react";
import SideOver, { SideOverSize } from "Common/UI/Components/SideOver/SideOver";
import Log from "Common/Models/AnalyticsModels/Log";
import JSONFunctions from "Common/Types/JSONFunctions";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import OneUptimeDate from "Common/Types/Date";

export interface LogDetailsSideOverProps {
  selectedLog: Log | null;
  onClose: () => void;
  addAttributeFilter: (k: string, v: string) => void;
  wrapLines: boolean;
  onToggleWrap: () => void;
}

const LogDetailsSideOver: FunctionComponent<LogDetailsSideOverProps> = (
  props: LogDetailsSideOverProps,
): ReactElement | null => {
  const { selectedLog } = props;
  if (!selectedLog) {
    return null;
  }
  return (
    <SideOver
      title={selectedLog.body?.toString().slice(0, 80) || "Log Details"}
      description={`Time: ${selectedLog.time ? OneUptimeDate.getDateAsUserFriendlyFormattedString(selectedLog.time) : ""}`}
      onClose={() => {
        return props.onClose();
      }}
      size={SideOverSize.Medium}
    >
      <div className="space-y-4">
        <div>
          <h3 className="text-xs font-semibold text-gray-500">Raw Body</h3>
          <pre className="mt-1 bg-slate-900 text-slate-100 p-3 rounded-md overflow-auto max-h-72">
            {selectedLog.body?.toString()}
          </pre>
        </div>
        <div>
          <h3 className="text-xs font-semibold text-gray-500">Parsed JSON</h3>
          <pre className="mt-1 bg-slate-900 text-slate-100 p-3 rounded-md overflow-auto max-h-72">
            {(() => {
              try {
                return JSON.stringify(
                  JSON.parse(selectedLog.body?.toString() || ""),
                  null,
                  2,
                );
              } catch {
                return "Not valid JSON";
              }
            })()}
          </pre>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {selectedLog.traceId && (
            <div className="text-xs break-all">
              <span className="font-semibold">Trace:</span>{" "}
              {selectedLog.traceId}{" "}
              <CopyTextButton textToBeCopied={selectedLog.traceId.toString()} />
            </div>
          )}
          {selectedLog.spanId && (
            <div className="text-xs break-all">
              <span className="font-semibold">Span:</span> {selectedLog.spanId}{" "}
              <CopyTextButton textToBeCopied={selectedLog.spanId.toString()} />
            </div>
          )}
          {selectedLog.severityText && (
            <div className="text-xs">
              <span className="font-semibold">Severity:</span>{" "}
              {selectedLog.severityText}
            </div>
          )}
        </div>
        {selectedLog.attributes && (
          <div>
            <h3 className="text-xs font-semibold text-gray-500">Attributes</h3>
            <pre className="mt-1 bg-slate-900 text-slate-100 p-3 rounded-md overflow-auto max-h-72">
              {JSON.stringify(
                JSONFunctions.unflattenObject(selectedLog.attributes),
                null,
                2,
              )}
            </pre>
            <div className="flex flex-wrap gap-1 mt-2">
              {Object.keys(
                JSONFunctions.unflattenObject(selectedLog.attributes || {}),
              ).map((k) => {
                return (
                  <button
                    key={k}
                    className="text-[10px] px-2 py-0.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                    onClick={() => {
                      return props.addAttributeFilter(
                        k,
                        (
                          JSONFunctions.unflattenObject(
                            selectedLog.attributes || {},
                          ) as any
                        )[k],
                      );
                    }}
                  >
                    Filter {k}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            title={props.wrapLines ? "Unwrap" : "Wrap"}
            buttonStyle={ButtonStyleType.OUTLINE}
            buttonSize={ButtonSize.Small}
            onClick={() => {
              return props.onToggleWrap();
            }}
          />
          <Button
            title="Copy JSON"
            icon={IconProp.Copy}
            buttonStyle={ButtonStyleType.OUTLINE}
            buttonSize={ButtonSize.Small}
            onClick={() => {
              try {
                navigator.clipboard.writeText(
                  JSON.stringify(
                    JSON.parse(selectedLog.body?.toString() || ""),
                    null,
                    2,
                  ),
                );
              } catch {
                navigator.clipboard.writeText(
                  selectedLog.body?.toString() || "",
                );
              }
            }}
          />
          <Button
            title="Close"
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            onClick={() => {
              return props.onClose();
            }}
          />
        </div>
      </div>
    </SideOver>
  );
};

export default LogDetailsSideOver;
