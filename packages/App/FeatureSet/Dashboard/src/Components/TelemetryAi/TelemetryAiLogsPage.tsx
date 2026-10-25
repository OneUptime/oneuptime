import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { TelemetryAiLane } from "Common/Types/AI/TelemetryAi";
import {
  TelemetryAiLogEntryJSON,
  TelemetryAiLogKind,
  TelemetryAiLogsJSON,
} from "Common/Types/AI/TelemetryAiActivity";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  CODE_VIEW_ON_HOST,
  getCodeHostName,
  getPullRequestCopy,
} from "../Code/CodeHostCopy";
import CodeHostMark from "../Code/CodeHostMark";
import InsightTitleText from "../AIInsights/InsightTitleText";
import { fetchTelemetryAiLogs } from "./TelemetryAiApi";
import {
  TELEMETRY_AI_LANE_COPY,
  TELEMETRY_AI_LOGS_COULD_NOT_LOAD,
  TELEMETRY_AI_LOGS_SHOWING,
  TELEMETRY_AI_LOG_ASKED_BY,
  TELEMETRY_AI_LOG_KIND_ICONS,
  TELEMETRY_AI_LOG_KIND_LABELS,
  TELEMETRY_AI_LOG_OPEN_TASK,
  TELEMETRY_AI_LOG_STARTED_BY_ONEUPTIME,
  TELEMETRY_AI_LOG_STATE_CLASS_NAMES,
  TELEMETRY_AI_LOG_STATE_LABELS,
  TELEMETRY_AI_PAGES,
  TELEMETRY_AI_TEST_IDS,
  TelemetryAiLaneCopy,
  getTelemetryAiLogVerdict,
} from "./TelemetryAiCopy";

/*
 * A telemetry product's AI → Logs - the Profiler's first: everything
 * OneUptime AI did with the problems OneUptime found in the product's
 * data, newest first (Common/Server/API/TelemetryAiAPI): each investigation
 * - an insight's triage - and each pull request it opened on its own or was
 * asked to open from a finding, with how it stands, the finding it was
 * for, who started it, and the Code task and pull request it led to.
 *
 * A page at a time, with Load more. Only about findings the reader may
 * read; a repository they may not read in Code is not named. A lane that
 * words its investigations' verdicts (investigationVerdicts) says under
 * each investigation what it found.
 */

export interface ComponentProps {
  lane: TelemetryAiLane;
}

const LINK_CLASS_NAME: string =
  "rounded-sm font-medium text-indigo-600 hover:text-indigo-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

// Where a log entry's finding opens: in the lane's own AI section.
export function getTelemetryAiInsightRoute(
  lane: TelemetryAiLane,
  insightId: string,
): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[TELEMETRY_AI_PAGES[lane].insightView] as Route,
    { modelId: new ObjectID(insightId) },
  );
}

// A pull request's address, when it is a web address.
export function getPullRequestUrl(url: string | undefined): URL | null {
  if (!url) {
    return null;
  }

  try {
    const parsed: URL = URL.fromString(url);

    return parsed.protocol === Protocol.HTTPS ||
      parsed.protocol === Protocol.HTTP
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export interface TelemetryAiLogRowProps {
  lane: TelemetryAiLane;
  entry: TelemetryAiLogEntryJSON;
}

export const TelemetryAiLogRow: FunctionComponent<TelemetryAiLogRowProps> = (
  props: TelemetryAiLogRowProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const entry: TelemetryAiLogEntryJSON = props.entry;
  const at: Date = new Date(entry.at);
  const hasDate: boolean = !Number.isNaN(at.getTime());
  const pullRequestUrl: URL | null = getPullRequestUrl(entry.pullRequest?.url);
  // What an investigation found, when its lane says (Exceptions does).
  const verdict: string | null = getTelemetryAiLogVerdict(props.lane, entry);

  const meta: Array<ReactElement> = [];

  if (entry.insight.serviceName) {
    meta.push(
      <span
        key="service"
        className="inline-flex min-w-0 items-center gap-1"
        title={entry.insight.serviceName}
      >
        <Icon icon={IconProp.Cube} className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="truncate">{entry.insight.serviceName}</span>
      </span>,
    );
  }

  if (entry.repositoryName) {
    meta.push(
      <span
        key="repository"
        className="inline-flex min-w-0 items-center gap-1"
        title={entry.repositoryName}
      >
        <Icon icon={IconProp.Code} className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="truncate">{entry.repositoryName}</span>
      </span>,
    );
  }

  meta.push(
    <span key="who">
      {entry.requestedBy
        ? translator.translateTemplate(TELEMETRY_AI_LOG_ASKED_BY, {
            name: entry.requestedBy,
          })
        : translator.translateText(TELEMETRY_AI_LOG_STARTED_BY_ONEUPTIME)}
    </span>,
  );

  if (hasDate) {
    meta.push(
      <span key="at" title={OneUptimeDate.getDateAsLocalFormattedString(at)}>
        {OneUptimeDate.fromNow(at)}
      </span>,
    );
  }

  return (
    <li
      className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start"
      data-testid={TELEMETRY_AI_TEST_IDS.logEntry}
      data-kind={entry.kind}
      data-state={entry.state}
    >
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 max-sm:hidden">
        <Icon
          icon={TELEMETRY_AI_LOG_KIND_ICONS[entry.kind]}
          className="h-5 w-5"
        />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-900 [overflow-wrap:anywhere]">
          {/*
           * The kind is read as one: beside a title that is one long word (a
           * metric's name) a phone split "Pull request" across two lines.
           */}
          <span
            className="whitespace-nowrap font-medium text-gray-500"
            data-testid={TELEMETRY_AI_TEST_IDS.logKind}
          >
            {translator.translateText(TELEMETRY_AI_LOG_KIND_LABELS[entry.kind])}
          </span>
          <span aria-hidden="true" className="px-1.5 text-gray-300">
            &middot;
          </span>
          <Link
            to={getTelemetryAiInsightRoute(props.lane, entry.insight.id)}
            className={LINK_CLASS_NAME}
          >
            {entry.insight.title ? (
              <InsightTitleText text={entry.insight.title} />
            ) : (
              translator.translateText(TELEMETRY_AI_LOG_KIND_LABELS[entry.kind])
            )}
          </Link>
        </p>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
          {meta.map((element: ReactElement, index: number): ReactElement => {
            return (
              <React.Fragment key={index}>
                {index > 0 ? (
                  <span aria-hidden="true" className="text-gray-300">
                    &bull;
                  </span>
                ) : (
                  <></>
                )}
                {element}
              </React.Fragment>
            );
          })}
        </div>

        {verdict ? (
          <p
            className="mt-1.5 text-sm text-gray-700 [overflow-wrap:anywhere]"
            data-testid={TELEMETRY_AI_TEST_IDS.logVerdict}
          >
            {translator.translateText(verdict)}
          </p>
        ) : (
          <></>
        )}

        {entry.kind === TelemetryAiLogKind.PullRequest &&
        (entry.taskId || pullRequestUrl) ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {pullRequestUrl ? (
              <Link
                to={pullRequestUrl}
                openInNewTab={true}
                className={`inline-flex items-center gap-1 ${LINK_CLASS_NAME}`}
              >
                {/* As Code draws it: a merge request, "!12", on GitLab. */}
                <CodeHostMark
                  provider={entry.repositoryHostedAt}
                  className="h-4 w-4"
                />
                <span>
                  {entry.pullRequest?.number
                    ? translator.translateTemplate(
                        getPullRequestCopy(entry.repositoryHostedAt).title,
                        { number: entry.pullRequest.number },
                      )
                    : translator.translateTemplate(CODE_VIEW_ON_HOST, {
                        host: getCodeHostName({
                          provider: entry.repositoryHostedAt,
                        }),
                      })}
                </span>
              </Link>
            ) : (
              <></>
            )}
            {entry.taskId ? (
              <Link
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.CODE_TASK_VIEW] as Route,
                  { modelId: new ObjectID(entry.taskId) },
                )}
                className={`inline-flex items-center gap-1 ${LINK_CLASS_NAME}`}
              >
                <span>
                  {translator.translateText(TELEMETRY_AI_LOG_OPEN_TASK)}
                </span>
                <Icon icon={IconProp.ArrowRight} className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}
      </div>

      <span
        className={`inline-flex flex-shrink-0 items-center self-start rounded-full px-2.5 py-0.5 text-xs font-medium ${TELEMETRY_AI_LOG_STATE_CLASS_NAMES[entry.state]}`}
      >
        {translator.translateText(TELEMETRY_AI_LOG_STATE_LABELS[entry.state])}
      </span>
    </li>
  );
};

const TelemetryAiLogsPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const copy: TelemetryAiLaneCopy = TELEMETRY_AI_LANE_COPY[props.lane];

  const [entries, setEntries] = useState<Array<TelemetryAiLogEntryJSON>>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  // Only the newest read writes the list: a late answer is dropped.
  const readNumberRef: React.MutableRefObject<number> = useRef<number>(0);

  const read: (options: { skip: number; append: boolean }) => Promise<void> =
    useCallback(
      async (options: { skip: number; append: boolean }): Promise<void> => {
        const readNumber: number = ++readNumberRef.current;

        if (options.append) {
          setIsLoadingMore(true);
        } else {
          setIsLoading(true);
        }

        try {
          const logs: TelemetryAiLogsJSON = await fetchTelemetryAiLogs({
            lane: props.lane,
            skip: options.skip,
          });

          if (readNumber !== readNumberRef.current) {
            return;
          }

          setTotalCount(logs.totalCount);
          setEntries((current: Array<TelemetryAiLogEntryJSON>) => {
            if (!options.append) {
              return logs.entries;
            }

            // A row already on screen is not drawn twice.
            const seen: Set<string> = new Set<string>(
              current.map((entry: TelemetryAiLogEntryJSON): string => {
                return entry.runId;
              }),
            );

            return [
              ...current,
              ...logs.entries.filter(
                (entry: TelemetryAiLogEntryJSON): boolean => {
                  return !seen.has(entry.runId);
                },
              ),
            ];
          });
          setError(null);
          setLoadMoreError(null);
        } catch (err) {
          if (readNumber === readNumberRef.current) {
            if (options.append) {
              setLoadMoreError(API.getFriendlyMessage(err as Error));
            } else {
              setError(API.getFriendlyMessage(err as Error));
            }
          }
        } finally {
          if (readNumber === readNumberRef.current) {
            setIsLoading(false);
            setIsLoadingMore(false);
          }
        }
      },
      [props.lane],
    );

  useEffect(() => {
    void read({ skip: 0, append: false });
  }, [read]);

  const getContent: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (error && entries.length === 0) {
      return (
        <ErrorMessage
          message={translator.translateTemplate(
            TELEMETRY_AI_LOGS_COULD_NOT_LOAD,
            { error },
          )}
          onRefreshClick={() => {
            void read({ skip: 0, append: false });
          }}
        />
      );
    }

    if (entries.length === 0) {
      return (
        <div data-testid={TELEMETRY_AI_TEST_IDS.logsEmpty}>
          <EmptyState
            id="telemetry-ai-logs-empty-state"
            icon={IconProp.QueueList}
            showSolidBackground={true}
            paddingClassName="py-16 md:py-24"
            title={copy.logsEmptyTitle}
            description={copy.logsEmptyDescription}
            footer={
              /*
               * The way on, as the section's Insights page offers it: what
               * OneUptime AI does on its own is chosen in AI Settings. The
               * wrapper takes off the dialog-footer margin Button carries
               * from md, which set it off centre.
               */
              <div className="[&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0">
                <Button
                  title="Go to AI Settings"
                  icon={IconProp.Settings}
                  buttonStyle={ButtonStyleType.NORMAL}
                  dataTestId={TELEMETRY_AI_TEST_IDS.logsSettings}
                  onClick={() => {
                    Navigation.navigate(
                      RouteUtil.populateRouteParams(
                        RouteMap[
                          TELEMETRY_AI_PAGES[props.lane].settings
                        ] as Route,
                      ),
                    );
                  }}
                />
              </div>
            }
          />
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <ul className="divide-y divide-gray-100">
            {entries.map((entry: TelemetryAiLogEntryJSON): ReactElement => {
              return (
                <TelemetryAiLogRow
                  key={entry.runId}
                  lane={props.lane}
                  entry={entry}
                />
              );
            })}
          </ul>

          <div className="flex flex-col items-center justify-between gap-3 border-t border-gray-100 bg-gray-50 px-4 py-3 sm:flex-row">
            <p className="text-xs text-gray-500">
              <TranslatedSentence
                template={TELEMETRY_AI_LOGS_SHOWING}
                count={totalCount}
                slots={{
                  shown: (
                    <span className="font-medium text-gray-700">
                      {translator.formatNumber(entries.length)}
                    </span>
                  ),
                  total: (
                    <span className="font-medium text-gray-700">
                      {translator.formatNumber(totalCount)}
                    </span>
                  ),
                }}
              />
            </p>

            {entries.length < totalCount ? (
              <Button
                title="Load More"
                icon={IconProp.ChevronDown}
                buttonStyle={ButtonStyleType.OUTLINE}
                buttonSize={ButtonSize.Small}
                isLoading={isLoadingMore}
                dataTestId={TELEMETRY_AI_TEST_IDS.logsLoadMore}
                onClick={() => {
                  void read({ skip: entries.length, append: true });
                }}
              />
            ) : (
              <></>
            )}
          </div>
        </div>

        {loadMoreError ? (
          <p className="text-center text-sm text-red-500" role="alert">
            {translator.translateTemplate(TELEMETRY_AI_LOGS_COULD_NOT_LOAD, {
              error: loadMoreError,
            })}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5" data-testid={TELEMETRY_AI_TEST_IDS.logs}>
      <p className="max-w-3xl text-sm leading-6 text-gray-500">
        {translator.translateText(copy.logsIntro)}
      </p>
      {getContent()}
    </div>
  );
};

export default TelemetryAiLogsPage;
