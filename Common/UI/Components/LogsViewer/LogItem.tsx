import CopyTextButton from "../CopyTextButton/CopyTextButton";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import JSONFunctions from "../../../Types/JSONFunctions";
import Log from "../../../Models/AnalyticsModels/Log";
import LogSeverity from "../../../Types/Log/LogSeverity";
import TelemetryService from "../../../Models/DatabaseModels/TelemetryService";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import { Logger } from "../../Utils/Logger";

export interface ComponentProps {
  log: Log;
  serviceMap: Dictionary<TelemetryService>;
}

const LogItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const serviceId: string = props.log.serviceId?.toString() || "";
  const serviceName: string = props.serviceMap[serviceId]?.name || serviceId;
  const serviceColor: string =
    props.serviceMap[serviceId]?.serviceColor?.toString() || "text-slate-200";

  const [isCollapsed, setIsCollapsed] = React.useState<boolean>(true);

  useEffect(() => {
    setIsCollapsed(true);
  }, []);

  let bodyColor: string = "text-slate-200";

  type GetCopyButtonFunction = (textToBeCopied: string) => ReactElement;

  const getCopyButton: GetCopyButtonFunction = (textToBeCopied: string) => {
    return (
      <CopyTextButton
        textToBeCopied={textToBeCopied}
        className="flex-none px-2 py-1 text-xs bg-slate-700 text-slate-300 rounded-md hover:bg-slate-600 border border-slate-600 transition-colors duration-200"
      />
    );
  };

  if (props.log.severityText === LogSeverity.Warning) {
    bodyColor = "text-amber-400";
  } else if (props.log.severityText === LogSeverity.Error) {
    bodyColor = "text-rose-400";
  } else if (
    props.log.severityText === LogSeverity.Trace ||
    props.log.severityText === LogSeverity.Debug
  ) {
    bodyColor = "text-slate-400";
  }

  let logBody: string = props.log.body?.toString() || "";

  let isBodyInJSON: boolean = false;

  try {
    logBody = JSON.stringify(JSON.parse(logBody), null, 2);
    isBodyInJSON = true;
  } catch (e) {
    Logger.error(e as Error);
    isBodyInJSON = false;
  }

  if (isCollapsed) {
    return (
      <div
        className="group relative text-slate-200 flex cursor-pointer hover:bg-slate-700/30 px-4 py-3 border-transparent border border-l-4 rounded-r-md hover:border-l-indigo-500/50 transition-all duration-200 ease-in-out mb-1 bg-slate-800/50"
        onClick={() => {
          setIsCollapsed(false);
        }}
      >
        {/* Timestamp and Service Name */}
        {props.log.time && (
          <div className="flex items-center space-x-3 flex-none w-64">
            <div className="text-xs text-slate-400 courier-prime font-medium">
              {OneUptimeDate.getDateAsUserFriendlyFormattedString(props.log.time).split(' ').slice(1).join(' ')}
            </div>
            <div
              className="text-sm courier-prime font-semibold truncate"
              style={{ color: serviceColor }}
              title={serviceName}
            >
              {serviceName}
            </div>
          </div>
        )}

        {/* Severity Badge */}
        <div className="flex-none mr-4">
          {props.log.severityText === LogSeverity.Information && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
              INFO
            </span>
          )}
          {props.log.severityText === LogSeverity.Warning && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
              WARN
            </span>
          )}
          {props.log.severityText === LogSeverity.Trace && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
              TRACE
            </span>
          )}
          {props.log.severityText === LogSeverity.Debug && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800 border border-purple-200">
              DEBUG
            </span>
          )}
          {props.log.severityText === LogSeverity.Error && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200">
              ERROR
            </span>
          )}
          {props.log.severityText === LogSeverity.Fatal && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-900 border border-red-300">
              FATAL
            </span>
          )}
          {(props.log.severityText === LogSeverity.Unspecified || !props.log.severityText) && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
              UNKNOWN
            </span>
          )}
        </div>

        {/* Log Message */}
        <div className={`${bodyColor} courier-prime text-sm leading-relaxed flex-1 min-w-0`}>
          {isBodyInJSON ? (
            <pre className="whitespace-pre-wrap truncate">{logBody.split('\n')[0]}...</pre>
          ) : (
            <div className="truncate" title={props.log.body?.toString()}>
              {props.log.body?.toString()}
            </div>
          )}
        </div>

        {/* Expand Indicator */}
        <div className="flex-none ml-3 text-slate-400 group-hover:text-slate-300 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group relative text-slate-200 cursor-pointer bg-slate-800 border border-slate-700 rounded-lg p-6 mb-3 hover:border-slate-600 transition-all duration-200 ease-in-out shadow-lg"
      onClick={() => {
        setIsCollapsed(true);
      }}
    >
      {/* Header with Service Name and Close Indicator */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-700">
        {serviceName && (
          <div
            className="text-lg courier-prime font-bold"
            style={{ color: serviceColor }}
          >
            {serviceName}
          </div>
        )}
        <div className="flex-none text-slate-400 group-hover:text-slate-300 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </div>
      </div>

      {/* Metadata Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {props.log.time && (
          <div className="flex flex-col space-y-1">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
              Timestamp
            </div>
            <div className="text-sm text-slate-300 courier-prime font-medium">
              {OneUptimeDate.getDateAsUserFriendlyFormattedString(props.log.time)}
            </div>
          </div>
        )}

        <div className="flex flex-col space-y-1">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
            Severity
          </div>
          <div>
            {props.log.severityText === LogSeverity.Information && (
              <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-blue-100 text-blue-800 border border-blue-200">
                INFO
              </span>
            )}
            {props.log.severityText === LogSeverity.Unspecified && (
              <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-gray-100 text-gray-600 border border-gray-200">
                UNKNOWN
              </span>
            )}
            {props.log.severityText === LogSeverity.Warning && (
              <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-amber-100 text-amber-800 border border-amber-200">
                WARN
              </span>
            )}
            {props.log.severityText === LogSeverity.Trace && (
              <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-slate-100 text-slate-600 border border-slate-200">
                TRACE
              </span>
            )}
            {props.log.severityText === LogSeverity.Debug && (
              <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-purple-100 text-purple-800 border border-purple-200">
                DEBUG
              </span>
            )}
            {props.log.severityText === LogSeverity.Error && (
              <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-red-100 text-red-800 border border-red-200">
                ERROR
              </span>
            )}
            {props.log.severityText === LogSeverity.Fatal && (
              <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-red-100 text-red-900 border border-red-300">
                FATAL
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Log Message */}
      <div className="mb-4">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
          Message
        </div>
        <div className="bg-slate-900 rounded-lg p-4 border border-slate-700">
          {!isBodyInJSON && (
            <div className={`${bodyColor} courier-prime text-sm leading-relaxed`}>
              {props.log.body?.toString()}
            </div>
          )}
          {isBodyInJSON && (
            <pre className={`${bodyColor} courier-prime text-sm leading-relaxed whitespace-pre-wrap overflow-x-auto`}>
              {logBody}
            </pre>
          )}
        </div>
      </div>

      {/* Trace and Span Information */}
      {(props.log.traceId || props.log.spanId) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {props.log.traceId && (
            <div className="flex flex-col space-y-2">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                Trace ID
              </div>
              <div className="flex items-center space-x-2">
                <div className={`${bodyColor} courier-prime text-sm bg-slate-900 px-3 py-2 rounded border border-slate-700 flex-1 truncate`}>
                  {props.log.traceId?.toString()}
                </div>
                {getCopyButton(props.log.traceId?.toString() || "")}
              </div>
            </div>
          )}

          {props.log.spanId && (
            <div className="flex flex-col space-y-2">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                Span ID
              </div>
              <div className="flex items-center space-x-2">
                <div className={`${bodyColor} courier-prime text-sm bg-slate-900 px-3 py-2 rounded border border-slate-700 flex-1 truncate`}>
                  {props.log.spanId?.toString()}
                </div>
                {getCopyButton(props.log.spanId?.toString() || "")}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Attributes */}
      {props.log.attributes && (
        <div>
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
            Attributes
          </div>
          <div className="bg-slate-900 rounded-lg p-4 border border-slate-700">
            <pre className={`${bodyColor} courier-prime text-sm leading-relaxed whitespace-pre-wrap overflow-x-auto`}>
              {JSON.stringify(
                JSONFunctions.unflattenObject(props.log.attributes || {}),
                null,
                2,
              )}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};

export default LogItem;
