/**
 * LogItem UI
 * - Collapsed row: compact line with timestamp, service, severity badge, message preview, quick copy.
 * - Expanded panel: left severity-colored border, header with service, severity, timestamp; sections for Message, JSON body, Trace/Span IDs, and Attributes, each with copy buttons.
 * - Accessibility: entire item is keyboard-activatable (Enter/Space) and exposes aria-expanded.
 * - Styling hooks: severityBadgeClasses and leftBorderColor derive from props.log.severityText for consistent theming.
 * - Non-breaking: props and behavior remain backward compatible.
 */
import CopyTextButton from "../CopyTextButton/CopyTextButton";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import JSONFunctions from "../../../Types/JSONFunctions";
import Log from "../../../Models/AnalyticsModels/Log";
import LogSeverity from "../../../Types/Log/LogSeverity";
import TelemetryService from "../../../Models/DatabaseModels/TelemetryService";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import { Logger } from "../../Utils/Logger";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import Link from "../Link/Link";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";

export interface ComponentProps {
  log: Log;
  serviceMap: Dictionary<TelemetryService>;
  getTraceRoute?: (traceId: string, log: Log) => Route | URL | undefined;
  getSpanRoute?: (spanId: string, log: Log) => Route | URL | undefined;
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
  let leftBorderColor: string = "border-l-slate-700";
  let severityDotClass: string = "bg-slate-400";

  type GetCopyButtonFunction = (textToBeCopied: string) => ReactElement;

  const getCopyButton: GetCopyButtonFunction = (textToBeCopied: string) => {
    return (
      <CopyTextButton
        textToBeCopied={textToBeCopied}
        size="xs"
        variant="ghost"
        iconOnly={true}
        title="Copy"
        className="flex-none"
      />
    );
  };

  type RenderTraceIdFunction = () => ReactElement;

  const renderTraceId: RenderTraceIdFunction = (): ReactElement => {
    const traceId: string = props.log.traceId?.toString() || "";

    const traceRoute: Route | URL | undefined =
      traceId && props.getTraceRoute
        ? props.getTraceRoute(traceId, props.log)
        : undefined;

    const baseContainerClassName: string = `${bodyColor} font-mono text-sm bg-slate-950 px-2.5 py-1.5 rounded border border-slate-800 flex-1 transition-colors`;

    if (traceRoute) {
      const linkContainerClassName: string = `${baseContainerClassName} flex items-center gap-1 min-w-0 hover:border-blue-500/60 hover:text-blue-200`;

      return (
        <div
          className="flex-1"
          onClick={(event: React.MouseEvent<HTMLDivElement>) => {
            event.stopPropagation();
          }}
          onAuxClick={(event: React.MouseEvent<HTMLDivElement>) => {
            event.stopPropagation();
          }}
        >
          <Link
            to={traceRoute}
            className="group flex-1 min-w-0 block hover:no-underline"
          >
            <div
              className={linkContainerClassName}
              title={`View trace ${traceId}`}
            >
              <span className="truncate underline underline-offset-2 decoration-slate-500 group-hover:decoration-blue-300">
                {traceId}
              </span>
              <Icon
                icon={IconProp.ExternalLink}
                className="w-3.5 h-3.5 flex-none text-slate-500 group-hover:text-blue-300"
              />
            </div>
          </Link>
        </div>
      );
    }

    return (
      <div className={`${baseContainerClassName} truncate`} title={traceId}>
        {traceId}
      </div>
    );
  };

  type RenderSpanIdFunction = () => ReactElement;

  const renderSpanId: RenderSpanIdFunction = (): ReactElement => {
    const spanId: string = props.log.spanId?.toString() || "";

    if (!spanId) {
      return (
        <div className="text-slate-500 italic text-sm" title="No span id">
          No span
        </div>
      );
    }

    const resolveSpanRoute: () => Route | URL | undefined = () => {
      if (props.getSpanRoute) {
        return props.getSpanRoute(spanId, props.log);
      }

      if (props.getTraceRoute && props.log.traceId) {
        const baseRoute: Route | URL | undefined = props.getTraceRoute(
          props.log.traceId.toString(),
          props.log,
        );

        if (!baseRoute) {
          return undefined;
        }

        if (baseRoute instanceof Route) {
          const clonedRoute: Route = new Route(baseRoute.toString());
          clonedRoute.addQueryParams({ spanId });
          return clonedRoute;
        }

        if (baseRoute instanceof URL) {
          const clonedURL: URL = URL.fromURL(baseRoute);
          clonedURL.addQueryParam("spanId", spanId);
          return clonedURL;
        }
      }

      return undefined;
    };

    const spanRoute: Route | URL | undefined = resolveSpanRoute();

    const baseContainerClassName: string = `${bodyColor} font-mono text-sm bg-slate-950 px-2.5 py-1.5 rounded border border-slate-800 flex-1 transition-colors`;

    if (spanRoute) {
      const linkContainerClassName: string = `${baseContainerClassName} flex items-center gap-1 min-w-0 hover:border-blue-500/60 hover:text-blue-200`;

      return (
        <div
          className="flex-1"
          onClick={(event: React.MouseEvent<HTMLDivElement>) => {
            event.stopPropagation();
          }}
          onAuxClick={(event: React.MouseEvent<HTMLDivElement>) => {
            event.stopPropagation();
          }}
        >
          <Link
            to={spanRoute}
            className="group flex-1 min-w-0 block hover:no-underline"
          >
            <div
              className={linkContainerClassName}
              title={`View span ${spanId}`}
            >
              <span className={`truncate underline underline-offset-2`}>
                {spanId}
              </span>
              <Icon
                icon={IconProp.ExternalLink}
                className={`w-3.5 h-3.5 flex-none`}
              />
            </div>
          </Link>
        </div>
      );
    }

    return (
      <div className={`${baseContainerClassName} truncate`} title={spanId}>
        {spanId}
      </div>
    );
  };

  if (props.log.severityText === LogSeverity.Warning) {
    bodyColor = "text-amber-400";
    leftBorderColor = "border-l-amber-500/60";
    severityDotClass = "bg-amber-500";
  } else if (props.log.severityText === LogSeverity.Error) {
    bodyColor = "text-rose-400";
    leftBorderColor = "border-l-rose-500/60";
    severityDotClass = "bg-rose-500";
  } else if (
    props.log.severityText === LogSeverity.Trace ||
    props.log.severityText === LogSeverity.Debug
  ) {
    bodyColor = "text-slate-400";
    leftBorderColor =
      props.log.severityText === LogSeverity.Debug
        ? "border-l-purple-500/60"
        : "border-l-slate-500/60";
    severityDotClass =
      props.log.severityText === LogSeverity.Debug
        ? "bg-purple-500"
        : "bg-slate-500";
  } else if (props.log.severityText === LogSeverity.Information) {
    leftBorderColor = "border-l-blue-500/60";
    severityDotClass = "bg-blue-500";
  } else if (props.log.severityText === LogSeverity.Fatal) {
    leftBorderColor = "border-l-rose-700/70";
    severityDotClass = "bg-rose-700";
  }

  let logBody: string = props.log.body?.toString() || "";
  let logBodyMinified: string = "";

  let isBodyInJSON: boolean = false;

  try {
    const parsed: any = JSON.parse(logBody);
    logBody = JSON.stringify(parsed, null, 2);
    logBodyMinified = JSON.stringify(parsed);
    isBodyInJSON = true;
  } catch (e) {
    Logger.error(e as Error);
    isBodyInJSON = false;
  }

  const toggleCollapsed: () => void = (): void => {
    setIsCollapsed((v: boolean) => {
      return !v;
    });
  };

  const handleKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void = (
    e: React.KeyboardEvent<HTMLDivElement>,
  ): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleCollapsed();
    }
  };

  if (isCollapsed) {
    return (
      <div
        className={`group relative text-slate-200 flex items-center gap-2 cursor-pointer hover:bg-slate-800/40 px-2 py-0.5 border border-transparent border-l ${leftBorderColor} rounded-sm transition-colors duration-100 font-mono`}
        onClick={toggleCollapsed}
        role="button"
        aria-expanded={!isCollapsed}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {/* Timestamp and Service Name */}
        {props.log.time && (
          <div className="flex items-center space-x-2 flex-none w-52">
            <div className="text-[10px] text-slate-400 font-mono tabular-nums">
              {OneUptimeDate.getDateAsUserFriendlyFormattedString(
                props.log.time,
              )
                .split(" ")
                .slice(1)
                .join(" ")}
            </div>
            <div
              className="text-[11px] font-medium truncate"
              style={{ color: serviceColor }}
              title={serviceName}
            >
              {serviceName}
            </div>
          </div>
        )}

        {/* Severity Badge */}
        <div className="flex-none mr-1">
          <span className="inline-flex items-center gap-2">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${severityDotClass}`}
              aria-hidden="true"
            />
            <span className="text-[9px] uppercase tracking-wide text-slate-400">
              {(props.log.severityText || "").toString() || "UNKNOWN"}
            </span>
          </span>
        </div>

        {/* Log Message */}
        <div
          className={`${bodyColor} font-mono text-[13px] md:text-sm leading-5 tracking-tight subpixel-antialiased flex-1 min-w-0`}
        >
          {isBodyInJSON ? (
            <div className="truncate font-mono" title={logBodyMinified}>
              {logBodyMinified}
            </div>
          ) : (
            <div
              className="truncate font-mono"
              title={props.log.body?.toString()}
            >
              {props.log.body?.toString()}
            </div>
          )}
        </div>

        {/* Quick copy button (message) */}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity ml-1">
          {getCopyButton(props.log.body?.toString() || "")}
        </div>

        {/* Expand Indicator */}
        <div className="flex-none ml-1 text-slate-500 group-hover:text-slate-300 transition-transform duration-200">
          <Icon icon={IconProp.ChevronDown} className="w-3 h-3" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group relative text-slate-200 bg-slate-950/70 border ${leftBorderColor} border-l border-slate-900 rounded-sm p-2 hover:border-slate-700 transition-colors`}
    >
      {/* Header with Service Name and Close Indicator */}
      <div className="flex items-center justify-between mb-1 pb-1 border-b border-slate-800/80">
        {serviceName && (
          <div
            className="text-[13px] font-semibold"
            style={{ color: serviceColor }}
          >
            {serviceName}
          </div>
        )}
        <div
          className="flex items-center gap-2"
          onClick={() => {
            toggleCollapsed();
          }}
        >
          <span className="inline-flex items-center gap-2">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${severityDotClass}`}
              aria-hidden="true"
            />
            <span className="text-[9px] uppercase tracking-wide text-slate-400">
              {(props.log.severityText || "").toString() || "UNKNOWN"}
            </span>
          </span>
          {props.log.time && (
            <div className="text-[11px] text-slate-400 font-mono tabular-nums">
              {OneUptimeDate.getDateAsUserFriendlyFormattedString(
                props.log.time,
              )}
            </div>
          )}
          <button
            type="button"
            title="Collapse"
            aria-label="Collapse"
            onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
              e.stopPropagation();
              toggleCollapsed();
            }}
            className="flex-none text-slate-500 hover:text-slate-300 transition-colors"
          >
            <Icon icon={IconProp.ChevronUp} className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Meta row (compact) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 mb-1.5 text-[11px] text-slate-400">
        {props.log.time && (
          <div className="flex items-center gap-2">
            <span className="uppercase tracking-wide">Timestamp</span>
            <span className="text-slate-300 font-mono tabular-nums">
              {OneUptimeDate.getDateAsUserFriendlyFormattedString(
                props.log.time,
              )}
            </span>
          </div>
        )}
        {props.log.severityText && (
          <div className="flex items-center gap-2">
            <span className="uppercase tracking-wide">Severity</span>
            <span className="inline-flex items-center gap-2 text-slate-300">
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${severityDotClass}`}
              />
              <span className="text-[10px] uppercase">
                {(props.log.severityText || "").toString()}
              </span>
            </span>
          </div>
        )}
      </div>

      {/* Message */}
      <div className="mb-1.5">
        <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
          Message
          <div className="flex items-center gap-2 normal-case">
            {getCopyButton(
              isBodyInJSON ? logBody : props.log.body?.toString() || "",
            )}
          </div>
        </div>
        <div className="bg-slate-950 rounded p-1.5 border border-slate-800">
          {!isBodyInJSON && (
            <div className={`${bodyColor} font-mono text-sm leading-snug`}>
              {props.log.body?.toString()}
            </div>
          )}
          {isBodyInJSON && (
            <pre
              className={`${bodyColor} font-mono text-sm leading-snug whitespace-pre overflow-auto max-h-40 w-full block`}
            >
              {logBody}
            </pre>
          )}
        </div>
      </div>

      {/* Trace and Span Information */}
      {(props.log.traceId || props.log.spanId) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 mb-1.5">
          {props.log.traceId && (
            <div className="flex flex-col space-y-2">
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                Trace ID
              </div>
              <div className="flex items-center space-x-2">
                {renderTraceId()}
                {getCopyButton(props.log.traceId?.toString() || "")}
              </div>
            </div>
          )}

          {props.log.spanId && (
            <div className="flex flex-col space-y-2">
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                Span ID
              </div>
              <div className="flex items-center space-x-2">
                {renderSpanId()}
                {getCopyButton(props.log.spanId?.toString() || "")}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Attributes */}
      {props.log.attributes && (
        <div>
          <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
            Attributes
            {getCopyButton(
              JSON.stringify(
                JSONFunctions.unflattenObject(props.log.attributes || {}),
                null,
                2,
              ) || "",
            )}
          </div>
          <div className="bg-slate-950 rounded p-1.5 border border-slate-800">
            <pre
              className={`${bodyColor} font-mono text-sm leading-snug whitespace-pre overflow-auto max-h-40 w-full block`}
            >
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
