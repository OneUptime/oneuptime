import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { formatRelativeTime } from "../../Utils/ExceptionDetailPresentation";
import AppLink from "../AppLink/AppLink";
import ExceptionDetailList, {
  ExceptionDetailListItem,
} from "./ExceptionDetailList";

export interface ComponentProps {
  instance: ExceptionInstance | undefined;
  isLoading: boolean;
  // Links under the card, e.g. to the Occurrences and Stack Trace pages.
  links?: Array<{ title: string; to: Route; icon: IconProp }> | undefined;
  description?: string | undefined;
}

const NOT_RECORDED: ReactElement = (
  <span className="text-gray-400">Not recorded</span>
);

function toDate(value: unknown): Date | undefined {
  if (!value) {
    return undefined;
  }

  const date: Date = value instanceof Date ? value : new Date(value as string);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

/*
 * The most recent occurrence at a glance: when, in which release and
 * environment, and the trace to open. On the Overview it is the jump-off
 * point into the investigation; on Context it anchors the replay, the
 * breadcrumbs and the logs below it.
 */
const ExceptionLatestOccurrence: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const occurredAt: Date | undefined = toDate(props.instance?.time);
  const traceId: string = props.instance?.traceId?.toString().trim() || "";
  const sessionId: string = props.instance?.sessionId?.toString().trim() || "";

  const renderBody: () => ReactElement = (): ReactElement => {
    if (props.isLoading && !props.instance) {
      return (
        <div className="flex h-24 items-center justify-center">
          <ComponentLoader />
        </div>
      );
    }

    if (!props.instance) {
      return (
        <div
          className="flex items-center gap-3 rounded-lg border border-dashed border-gray-200 px-4 py-5"
          data-testid="exception-latest-occurrence-empty"
        >
          <Icon icon={IconProp.Clock} className="h-5 w-5 text-gray-400" />
          <p className="text-sm text-gray-600">
            No individual occurrence is stored for this exception yet. New
            occurrences appear here as telemetry arrives.
          </p>
        </div>
      );
    }

    const items: Array<ExceptionDetailListItem> = [
      {
        label: "Occurred",
        value: occurredAt ? (
          <span>
            {OneUptimeDate.getDateAsLocalShortDateTimeString(occurredAt)}
            <span className="ml-1.5 text-gray-500">
              ({formatRelativeTime(occurredAt)})
            </span>
          </span>
        ) : (
          NOT_RECORDED
        ),
        testId: "exception-latest-occurrence-time",
      },
      {
        label: "Handling",
        value:
          props.instance.escaped === undefined ? (
            NOT_RECORDED
          ) : props.instance.escaped ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              Unhandled
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              Handled
            </span>
          ),
        testId: "exception-latest-occurrence-handling",
      },
      {
        label: "Release",
        value: props.instance.release ? (
          <span className="font-mono text-[13px]">
            {props.instance.release}
          </span>
        ) : (
          NOT_RECORDED
        ),
        testId: "exception-latest-occurrence-release",
      },
      {
        label: "Environment",
        value: props.instance.environment || NOT_RECORDED,
        testId: "exception-latest-occurrence-environment",
      },
      {
        label: "Span",
        value: props.instance.spanName ? (
          <span className="font-mono text-[13px]">
            {props.instance.spanName}
          </span>
        ) : (
          NOT_RECORDED
        ),
        testId: "exception-latest-occurrence-span",
      },
      {
        label: "Trace",
        value: traceId ? (
          <AppLink
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.TRACE_VIEW] as Route,
              { modelId: traceId },
            )}
            className="inline-flex max-w-full items-center gap-1 font-mono text-[13px] text-indigo-600 hover:text-indigo-500 hover:underline"
          >
            <span className="truncate">{traceId}</span>
            <Icon
              icon={IconProp.ExternalLink}
              className="h-3.5 w-3.5 flex-shrink-0"
            />
          </AppLink>
        ) : (
          <span className="text-gray-400">No trace was attached</span>
        ),
        testId: "exception-latest-occurrence-trace",
      },
    ];

    if (sessionId) {
      items.push({
        label: "User session",
        value: <span className="font-mono text-[13px]">{sessionId}</span>,
        isWide: true,
        testId: "exception-latest-occurrence-session",
      });
    }

    return (
      <div>
        <ExceptionDetailList items={items} label="Latest occurrence" />
        {props.links && props.links.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-gray-100 pt-4">
            {props.links.map(
              (link: { title: string; to: Route; icon: IconProp }) => {
                return (
                  <AppLink
                    key={link.title}
                    to={link.to}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-500"
                  >
                    <Icon icon={link.icon} className="h-4 w-4" />
                    <span>{link.title}</span>
                  </AppLink>
                );
              },
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <Card
      title="Latest Occurrence"
      description={
        props.description ||
        (occurredAt
          ? `Captured ${formatRelativeTime(occurredAt)}.`
          : "The most recent time this exception was recorded.")
      }
    >
      {renderBody()}
    </Card>
  );
};

export default ExceptionLatestOccurrence;
