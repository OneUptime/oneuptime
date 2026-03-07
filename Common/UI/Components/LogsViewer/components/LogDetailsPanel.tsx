import React, { FunctionComponent, ReactElement, useMemo } from "react";
import Log from "../../../../Models/AnalyticsModels/Log";
import Service from "../../../../Models/DatabaseModels/Service";
import Dictionary from "../../../../Types/Dictionary";
import Route from "../../../../Types/API/Route";
import URL from "../../../../Types/API/URL";
import CopyTextButton from "../../CopyTextButton/CopyTextButton";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import Link from "../../Link/Link";
import OneUptimeDate from "../../../../Types/Date";
import JSONFunctions from "../../../../Types/JSONFunctions";
import SeverityBadge from "./SeverityBadge";

export interface LogDetailsPanelProps {
  log: Log;
  serviceMap: Dictionary<Service>;
  onClose?: () => void;
  getTraceRoute?:
    | ((traceId: string, log: Log) => Route | URL | undefined)
    | undefined;
  getSpanRoute?:
    | ((spanId: string, log: Log) => Route | URL | undefined)
    | undefined;
  variant?: "floating" | "embedded";
}

interface PreparedBody {
  isJson: boolean;
  pretty: string;
  compact: string;
  raw: string;
}

const prepareBody: (body: string | undefined) => PreparedBody = (
  body: string | undefined,
): PreparedBody => {
  if (!body) {
    return {
      isJson: false,
      pretty: "",
      compact: "",
      raw: "",
    };
  }

  try {
    const parsed: any = JSON.parse(body);
    const pretty: string = JSON.stringify(parsed, null, 2);
    const compact: string = JSON.stringify(parsed);
    return {
      isJson: true,
      pretty,
      compact,
      raw: body,
    };
  } catch {
    return {
      isJson: false,
      pretty: body,
      compact: body,
      raw: body,
    };
  }
};

const LogDetailsPanel: FunctionComponent<LogDetailsPanelProps> = (
  props: LogDetailsPanelProps,
): ReactElement => {
  const variant: "floating" | "embedded" = props.variant || "floating";
  const serviceId: string = props.log.serviceId?.toString() || "";
  const service: Service | undefined = props.serviceMap[serviceId];
  const serviceName: string = service?.name || serviceId || "Unknown service";
  const serviceColor: string =
    (service?.serviceColor && service?.serviceColor.toString()) || "#64748b";

  const bodyDetails: PreparedBody = useMemo(() => {
    return prepareBody(props.log.body?.toString());
  }, [props.log.body]);

  const prettyAttributes: string | null = useMemo(() => {
    if (!props.log.attributes) {
      return null;
    }

    try {
      const normalized: Record<string, unknown> = JSONFunctions.unflattenObject(
        props.log.attributes || {},
      );
      return JSON.stringify(normalized, null, 2);
    } catch {
      return null;
    }
  }, [props.log.attributes]);

  const traceId: string = props.log.traceId?.toString() || "";
  const spanId: string = props.log.spanId?.toString() || "";

  const traceRoute: Route | URL | undefined = useMemo(() => {
    if (!traceId || !props.getTraceRoute) {
      return undefined;
    }

    return props.getTraceRoute(traceId, props.log);
  }, [traceId, props]);

  const spanRoute: Route | URL | undefined = useMemo(() => {
    if (!spanId) {
      return undefined;
    }

    if (props.getSpanRoute) {
      return props.getSpanRoute(spanId, props.log);
    }

    if (props.getTraceRoute && traceId) {
      const baseRoute: Route | URL | undefined = props.getTraceRoute(
        traceId,
        props.log,
      );

      if (!baseRoute) {
        return undefined;
      }

      if (baseRoute instanceof Route) {
        const nextRoute: Route = new Route(baseRoute.toString());
        nextRoute.addQueryParams({ spanId });
        return nextRoute;
      }

      const nextUrl: URL = URL.fromURL(baseRoute);
      nextUrl.addQueryParam("spanId", spanId);
      return nextUrl;
    }

    return undefined;
  }, [spanId, props, traceId]);

  const containerClassName: string =
    variant === "embedded"
      ? "rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
      : "rounded-lg border border-gray-200 bg-white p-5 shadow-md";

  const headerBorderClass: string = "border-gray-200";

  const surfaceCardClass: string = "border-gray-200 bg-gray-50";

  const smallBadgeClass: string =
    "inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-mono uppercase tracking-wide text-gray-600";

  return (
    <div className={containerClassName}>
      <div
        className={`flex flex-col gap-4 border-b ${headerBorderClass} pb-4 lg:flex-row lg:items-start lg:justify-between`}
      >
        <div className="flex flex-1 items-start gap-3">
          <span
            className="mt-1 h-3 w-3 flex-none rounded-full border border-gray-200"
            style={{ backgroundColor: serviceColor }}
            aria-hidden="true"
          />
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-lg font-semibold text-gray-900">
                {serviceName}
              </h3>
              <SeverityBadge severity={props.log.severityText} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {props.log.time && (
                <span className={smallBadgeClass}>
                  <Icon icon={IconProp.Clock} className="h-3 w-3" />
                  {OneUptimeDate.getDateAsUserFriendlyFormattedString(
                    props.log.time,
                  )}
                </span>
              )}
              {traceId && (
                <span className={smallBadgeClass}>
                  <Icon icon={IconProp.Logs} className="h-3 w-3" />
                  Trace
                </span>
              )}
              {spanId && (
                <span className={smallBadgeClass}>
                  <Icon icon={IconProp.Terminal} className="h-3 w-3" />
                  Span
                </span>
              )}
            </div>
          </div>
        </div>

        {props.onClose && (
          <button
            type="button"
            onClick={props.onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-gray-50 text-gray-400 transition-colors hover:border-gray-300 hover:text-gray-600"
            title="Close details"
          >
            <Icon icon={IconProp.Close} className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mt-4 space-y-5 text-sm text-gray-700">
        <section className="space-y-3">
          <header className="flex items-center justify-between text-[11px] uppercase tracking-wide text-gray-400">
            <span>Log Body</span>
            <CopyTextButton
              textToBeCopied={bodyDetails.raw}
              size="xs"
              variant="ghost"
              iconOnly={false}
              title="Copy log body"
            />
          </header>

          <div className={`rounded-lg border ${surfaceCardClass} p-4`}>
            {bodyDetails.isJson ? (
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[13px] leading-6 text-gray-800">
                {bodyDetails.pretty}
              </pre>
            ) : (
              <p className="whitespace-pre-wrap break-words font-mono text-[13px] leading-6 text-gray-800">
                {bodyDetails.pretty || "-"}
              </p>
            )}
          </div>
        </section>

        {(traceId || spanId) && (
          <section className="grid gap-4 md:grid-cols-2">
            {traceId && (
              <div className={`rounded-lg border ${surfaceCardClass} p-4`}>
                <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-gray-400">
                  <span>Trace ID</span>
                  <CopyTextButton
                    textToBeCopied={traceId}
                    size="xs"
                    variant="ghost"
                    iconOnly={true}
                    title="Copy trace id"
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  {traceRoute ? (
                    <Link
                      to={traceRoute}
                      className="max-w-full truncate font-mono text-xs text-indigo-600 hover:text-indigo-500"
                      title={`View trace ${traceId}`}
                    >
                      {traceId}
                    </Link>
                  ) : (
                    <span
                      className="max-w-full truncate font-mono text-xs text-gray-700"
                      title={traceId}
                    >
                      {traceId}
                    </span>
                  )}
                  {traceRoute && (
                    <Icon
                      icon={IconProp.ExternalLink}
                      className="h-4 w-4 flex-none text-indigo-400"
                    />
                  )}
                </div>
              </div>
            )}

            {spanId && (
              <div className={`rounded-lg border ${surfaceCardClass} p-4`}>
                <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-gray-400">
                  <span>Span ID</span>
                  <CopyTextButton
                    textToBeCopied={spanId}
                    size="xs"
                    variant="ghost"
                    iconOnly={true}
                    title="Copy span id"
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  {spanRoute ? (
                    <Link
                      to={spanRoute}
                      className="max-w-full truncate font-mono text-xs text-indigo-600 hover:text-indigo-500"
                      title={`View span ${spanId}`}
                    >
                      {spanId}
                    </Link>
                  ) : (
                    <span
                      className="max-w-full truncate font-mono text-xs text-gray-700"
                      title={spanId}
                    >
                      {spanId}
                    </span>
                  )}
                  {spanRoute && (
                    <Icon
                      icon={IconProp.ExternalLink}
                      className="h-4 w-4 flex-none text-indigo-400"
                    />
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {prettyAttributes && (
          <section className="space-y-3">
            <header className="flex items-center justify-between text-[11px] uppercase tracking-wide text-gray-400">
              <span>Attributes</span>
              <CopyTextButton
                textToBeCopied={prettyAttributes}
                size="xs"
                variant="ghost"
                iconOnly={false}
                title="Copy attributes"
              />
            </header>
            <div className={`rounded-lg border ${surfaceCardClass} p-4`}>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[13px] leading-6 text-gray-800">
                {prettyAttributes}
              </pre>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default LogDetailsPanel;
