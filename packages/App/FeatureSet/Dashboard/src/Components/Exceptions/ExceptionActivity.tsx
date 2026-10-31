import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import TelemetryExceptionActivity from "Common/Models/DatabaseModels/TelemetryExceptionActivity";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Icon from "Common/UI/Components/Icon/Icon";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useState,
} from "react";
import {
  ANOTHER_EXCEPTION,
  API_KEY_ACTOR_TEMPLATE,
  EXCEPTION_ACTIVITY_FOLDED_COUNT,
  EXCEPTION_ACTIVITY_LIMIT,
  EXCEPTION_ACTIVITY_SELECT,
  EXCEPTION_ACTIVITY_TONE_CLASS_NAMES,
  ExceptionActivityLine,
  FIRST_SEEN_IN_RELEASE_TEMPLATE,
  FIRST_SEEN_TEMPLATE,
  ONEUPTIME_ACTOR,
  SOMEONE,
  getExceptionActivityLines,
} from "../../Utils/ExceptionActivityPresentation";
import { formatRelativeTime } from "../../Utils/ExceptionDetailPresentation";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";

/*
 * AN EXCEPTION'S ACTIVITY, ON ITS OVERVIEW.
 *
 * Who resolved, reopened, archived, assigned, merged or unmerged it and
 * when, and when it came back after it was resolved - newest first, one
 * sentence each - ending with when it was first seen. The newest few show;
 * the rest unfold. Read again whenever `refreshKey` changes: the page
 * passes a new one after each change it makes, so what someone just did
 * shows at once.
 */

export interface ComponentProps {
  exception: TelemetryException;
  telemetryExceptionId: ObjectID;
  refreshKey?: string | number | undefined;
}

function exceptionRoute(id: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.EXCEPTIONS_VIEW] as Route,
    { modelId: id },
  );
}

const ExceptionActivity: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [entries, setEntries] = useState<Array<TelemetryExceptionActivity>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  useEffect(() => {
    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      setError(undefined);

      try {
        const result: ListResult<TelemetryExceptionActivity> =
          await ModelAPI.getList<TelemetryExceptionActivity>({
            modelType: TelemetryExceptionActivity,
            query: { telemetryExceptionId: props.telemetryExceptionId },
            select: EXCEPTION_ACTIVITY_SELECT,
            limit: EXCEPTION_ACTIVITY_LIMIT,
            skip: 0,
            sort: { createdAt: SortOrder.Descending },
          });

        if (isCurrent) {
          setEntries(result.data);
        }
      } catch (err) {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      }

      if (isCurrent) {
        setIsLoading(false);
      }
    };

    void load();

    return () => {
      isCurrent = false;
    };
  }, [props.telemetryExceptionId.toString(), props.refreshKey]);

  const lines: Array<ExceptionActivityLine> =
    getExceptionActivityLines(entries);
  const shownLines: Array<ExceptionActivityLine> = isExpanded
    ? lines
    : lines.slice(0, EXCEPTION_ACTIVITY_FOLDED_COUNT);
  const foldedCount: number = lines.length - shownLines.length;

  const name: (text: string) => ReactElement = (text: string): ReactElement => {
    return <span className="font-medium text-gray-900">{text}</span>;
  };

  const renderTime: (at: Date | null) => ReactElement = (
    at: Date | null,
  ): ReactElement => {
    if (!at) {
      return <></>;
    }

    return (
      <time
        dateTime={at.toISOString()}
        title={OneUptimeDate.getDateAsLocalFormattedString(at)}
        className="flex-shrink-0 whitespace-nowrap text-xs tabular-nums text-gray-500"
      >
        {formatRelativeTime(at, new Date(), translator.language) || ""}
      </time>
    );
  };

  const renderLine: (line: ExceptionActivityLine) => ReactElement = (
    line: ExceptionActivityLine,
  ): ReactElement => {
    const actor: string = line.actor.name
      ? line.actor.isApiKey
        ? translator.translateTemplate(API_KEY_ACTOR_TEMPLATE, {
            name: line.actor.name,
          })
        : line.actor.name
      : ONEUPTIME_ACTOR;

    const slots: Record<string, ReactNode> = {
      actor: name(actor),
      assignee: name(
        line.assigneeName || translator.translateText(SOMEONE) || SOMEONE,
      ),
      release: (
        <span className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-700">
          {line.release || ""}
        </span>
      ),
      exception: line.relatedException ? (
        <AppLink
          className="font-medium text-gray-900 underline decoration-gray-300 underline-offset-2 hover:decoration-gray-500"
          to={exceptionRoute(line.relatedException.id)}
          dataTestId="exception-activity-related"
        >
          {line.relatedException.name ||
            translator.translateText(ANOTHER_EXCEPTION) ||
            ANOTHER_EXCEPTION}
        </AppLink>
      ) : (
        name(translator.translateText(ANOTHER_EXCEPTION) || ANOTHER_EXCEPTION)
      ),
    };

    // Only the slots its sentence names: an unnamed one would read as missing.
    const usedSlots: Record<string, ReactNode> = {};

    for (const slot of Object.keys(slots)) {
      if (line.template.includes(`{{${slot}}}`)) {
        usedSlots[slot] = slots[slot];
      }
    }

    return (
      <li
        key={line.key}
        className="flex items-start gap-3 py-2"
        data-testid="exception-activity-entry"
        data-activity-type={line.activityType}
      >
        <span
          className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${EXCEPTION_ACTIVITY_TONE_CLASS_NAMES[line.tone]}`}
          aria-hidden="true"
        >
          <Icon icon={line.icon} className="h-3.5 w-3.5" />
        </span>
        <p className="min-w-0 flex-1 break-words text-sm leading-6 text-gray-700">
          <TranslatedSentence template={line.template} slots={usedSlots} />
        </p>
        {renderTime(line.at)}
      </li>
    );
  };

  const firstSeenAt: Date | null = props.exception.firstSeenAt
    ? new Date(props.exception.firstSeenAt)
    : null;
  const firstSeenRelease: string = (
    props.exception.firstSeenInRelease || ""
  ).trim();

  const renderBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return (
        <div className="flex h-20 items-center justify-center">
          <ComponentLoader />
        </div>
      );
    }

    if (error) {
      return (
        <p
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          role="alert"
          data-testid="exception-activity-error"
        >
          {error}
        </p>
      );
    }

    return (
      <>
        <ol
          className="-my-2 divide-y divide-gray-100"
          data-testid="exception-activity-list"
        >
          {shownLines.map(renderLine)}
          {foldedCount === 0 && firstSeenAt ? (
            <li
              className="flex items-start gap-3 py-2"
              data-testid="exception-activity-first-seen"
            >
              <span
                className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${EXCEPTION_ACTIVITY_TONE_CLASS_NAMES.gray}`}
                aria-hidden="true"
              >
                <Icon icon={IconProp.Bolt} className="h-3.5 w-3.5" />
              </span>
              <p className="min-w-0 flex-1 text-sm leading-6 text-gray-700">
                {firstSeenRelease ? (
                  <TranslatedSentence
                    template={FIRST_SEEN_IN_RELEASE_TEMPLATE}
                    slots={{
                      release: (
                        <span className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-700">
                          {firstSeenRelease}
                        </span>
                      ),
                    }}
                  />
                ) : (
                  translator.translateText(FIRST_SEEN_TEMPLATE)
                )}
              </p>
              {renderTime(firstSeenAt)}
            </li>
          ) : (
            <></>
          )}
        </ol>
        {lines.length > EXCEPTION_ACTIVITY_FOLDED_COUNT ? (
          <button
            type="button"
            className="mt-3 text-sm font-medium text-indigo-600 hover:text-indigo-800"
            aria-expanded={isExpanded}
            data-testid="exception-activity-toggle"
            onClick={() => {
              setIsExpanded(!isExpanded);
            }}
          >
            {isExpanded
              ? translator.translateText("Show less")
              : translator.translatePlural(
                  {
                    one: "Show {{count}} older entry",
                    other: "Show {{count}} older entries",
                  },
                  foldedCount,
                )}
          </button>
        ) : (
          <></>
        )}
      </>
    );
  };

  return (
    <Card
      title="Activity"
      description="Who changed this exception and when, newest first."
    >
      <div data-testid="exception-activity">{renderBody()}</div>
    </Card>
  );
};

export default ExceptionActivity;
