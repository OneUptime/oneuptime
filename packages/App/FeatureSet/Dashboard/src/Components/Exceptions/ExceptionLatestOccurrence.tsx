import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  exceptionTimeValue,
  formatRelativeTime,
} from "../../Utils/ExceptionDetailPresentation";
import AppLink from "../AppLink/AppLink";
import ExceptionDetailList, {
  ExceptionDetailListItem,
} from "./ExceptionDetailList";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

export interface ComponentProps {
  instance: ExceptionInstance | undefined;
  isLoading: boolean;
  // Links under the card, e.g. to the Occurrences and Stack Trace pages.
  links?: Array<{ title: string; to: Route; icon: IconProp }> | undefined;
  description?: string | undefined;
  // 3 when the card is as wide as the page (the Overview); 2 by default.
  columns?: 2 | 3 | undefined;
}

const NotRecorded: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span className="text-gray-400">
      {translator.translateText("Not recorded")}
    </span>
  );
};

const NOT_RECORDED: ReactElement = <NotRecorded />;

// While the occurrence is read: the loader in the middle of the card's room.
export const EXCEPTION_LATEST_OCCURRENCE_LOADING_CLASS_NAME: string =
  "flex min-h-24 flex-1 items-center justify-center";

/*
 * No occurrence stored: a dashed box that takes the card's room under its
 * header, its clock and words in the middle of it.
 */
export const EXCEPTION_LATEST_OCCURRENCE_EMPTY_CLASS_NAME: string =
  "flex flex-1 items-center gap-3 rounded-lg border border-dashed border-gray-200 px-4 py-5";

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
  const translator: Translator = useTranslator();
  const occurredAt: Date | undefined = toDate(props.instance?.time);
  const traceId: string = props.instance?.traceId?.toString().trim() || "";
  const sessionId: string = props.instance?.sessionId?.toString().trim() || "";
  const fingerprint: string =
    props.instance?.fingerprint?.toString().trim() || "";

  /*
   * The loader and the empty box take the room the card has under its
   * header, so neither sits at its top over blank card.
   */
  const renderBody: () => ReactElement = (): ReactElement => {
    if (props.isLoading && !props.instance) {
      return (
        <div
          className={EXCEPTION_LATEST_OCCURRENCE_LOADING_CLASS_NAME}
          data-testid="exception-latest-occurrence-loading"
        >
          <ComponentLoader />
        </div>
      );
    }

    if (!props.instance) {
      return (
        <div
          className={EXCEPTION_LATEST_OCCURRENCE_EMPTY_CLASS_NAME}
          data-testid="exception-latest-occurrence-empty"
        >
          <Icon icon={IconProp.Clock} className="h-5 w-5 text-gray-400" />
          <p className="text-sm text-gray-600">
            {translator.translateText(
              "No individual occurrence is stored for this exception yet. New occurrences appear here as telemetry arrives.",
            )}
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
              ({formatRelativeTime(occurredAt, new Date(), translator.language)}
              )
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
              {translator.translateText("Unhandled")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              {translator.translateText("Handled")}
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
          <span className="text-gray-400">
            {translator.translateText("No trace was attached")}
          </span>
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

    /*
     * How the occurrence was grouped: every occurrence with this
     * fingerprint is this exception's (a merged exception's keep theirs).
     */
    if (fingerprint) {
      items.push({
        label: "Fingerprint",
        isWide: true,
        value: (
          <span className="flex min-w-0 items-center gap-2">
            <code
              title={translator.translateText(
                "Occurrences with this fingerprint are grouped into this exception.",
              )}
              className="min-w-0 truncate rounded bg-gray-50 px-1.5 py-0.5 font-mono text-xs text-gray-700 ring-1 ring-inset ring-gray-200"
            >
              {fingerprint}
            </code>
            <CopyTextButton
              textToBeCopied={fingerprint}
              iconOnly={true}
              size="xs"
              title="Copy fingerprint"
            />
          </span>
        ),
        testId: "exception-latest-occurrence-fingerprint",
      });
    }

    return (
      <div>
        <ExceptionDetailList
          items={items}
          label="Latest occurrence"
          columns={props.columns || 2}
        />
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
                    <span>{translator.translateText(link.title)}</span>
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
          ? translator.translateTemplate("Captured {{time}}.", {
              time: exceptionTimeValue(occurredAt) || "",
            })
          : "The most recent time this exception was recorded.")
      }
    >
      {renderBody()}
    </Card>
  );
};

export default ExceptionLatestOccurrence;
