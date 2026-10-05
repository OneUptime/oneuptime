import PageComponentProps from "../../Pages/PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  IncidentAlertAiDescriptor,
  getIncidentAlertAiDescriptor,
} from "./IncidentAlertAiDescriptors";
import {
  AI_LOGS_EMPTY_DESCRIPTIONS,
  AI_LOGS_EMPTY_TITLE,
  AI_LOGS_FILTER_OPTIONS,
  AI_LOGS_HIDDEN_KIND_NOTES,
  AI_LOGS_PAGE_SUBTITLES,
  AI_LOGS_PAGE_TITLE,
  AI_LOG_KIND_LABELS,
  ALL_KINDS_FILTER,
  AiLogDetail,
  AiLogs,
  AiLogsEntry,
  AiLogsFilterOption,
  AiLogsStatusLook,
  appendAiLogsEntries,
  describeCommandOrigin,
  describeExecutionMode,
  describeFixKind,
  describeVerdicts,
  describeVerification,
  getAiLogDetail,
  getAiLogStatusLook,
  getAiLogSubjectLabel,
  getKindsForFilter,
  parseAiLogs,
} from "./IncidentAlertAiLogs";
import {
  INCIDENT_ALERT_AI_LOGS_PATHS,
  IncidentAlertAiLogKind,
  IncidentAlertAiSubjectKind,
} from "Common/Types/AI/IncidentAlertAiLogs";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Pill from "Common/UI/Components/Pill/Pill";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * The AI Logs page of the Incidents and Alerts menus (AI → Logs): the
 * chronological record of everything OneUptime AI did for the project's
 * incidents (or alerts), newest first - every investigation with its
 * finding, every fix it proposed or applied and how it turned out, every fix
 * pull request it was asked to open, and every command it ran - each linked
 * to its incident or alert. The product-wide twin of a cluster's or a
 * resource's AI Logs, which list the same work for one cluster or resource.
 *
 * The record comes from POST /ai-activity/{incident|alert}/logs a page at a
 * time (IncidentAlertAiLogsReader decides who sees what), narrowed to one
 * kind with the filter above it.
 */

export interface ComponentProps extends PageComponentProps {
  subjectKind: IncidentAlertAiSubjectKind;
}

const KIND_ICONS: Record<IncidentAlertAiLogKind, IconProp> = {
  [IncidentAlertAiLogKind.Investigation]: IconProp.Search,
  [IncidentAlertAiLogKind.Fix]: IconProp.Wrench,
  [IncidentAlertAiLogKind.FixTask]: IconProp.Code,
  [IncidentAlertAiLogKind.Command]: IconProp.Terminal,
};

function getSubjectRoute(
  descriptor: IncidentAlertAiDescriptor,
  subjectId: string,
): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[descriptor.subjectViewPage] as Route,
    { modelId: subjectId },
  );
}

function When(props: { at: string }): ReactElement {
  const date: Date = OneUptimeDate.fromString(props.at);

  if (Number.isNaN(date.getTime())) {
    return <></>;
  }

  return (
    <time
      className="whitespace-nowrap text-xs text-gray-500"
      dateTime={props.at}
      title={OneUptimeDate.getDateAsFormattedString(date)}
    >
      {OneUptimeDate.getDateAsLocalDayMonthTimeString(date)}
    </time>
  );
}

// The small grey facts under an entry: how a fix ran, what people thought.
function getEntryFacts(entry: AiLogsEntry): Array<string> {
  switch (entry.kind) {
    case IncidentAlertAiLogKind.Investigation:
      return describeVerdicts(entry);
    case IncidentAlertAiLogKind.Fix:
      return [
        describeFixKind(entry.suggestionType),
        describeExecutionMode(entry.executionMode),
        describeVerification(entry.verificationStatus),
      ].filter((fact: string | null): fact is string => {
        return Boolean(fact);
      });
    case IncidentAlertAiLogKind.Command:
      return [describeCommandOrigin(entry.commandOrigin)].filter(
        (fact: string | null): fact is string => {
          return Boolean(fact);
        },
      );
    default:
      return [];
  }
}

function EntryRow(props: {
  entry: AiLogsEntry;
  descriptor: IncidentAlertAiDescriptor;
}): ReactElement {
  const translator: Translator = useTranslator();
  const { entry } = props;
  const look: AiLogsStatusLook | null = getAiLogStatusLook(entry);
  const detail: AiLogDetail | null = getAiLogDetail(entry);
  const facts: Array<string> = getEntryFacts(entry);
  const subjectLabel: string = getAiLogSubjectLabel(entry.subject);

  return (
    <li className="py-3" data-testid="ai-log-entry" data-kind={entry.kind}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon
            icon={KIND_ICONS[entry.kind]}
            className="h-4 w-4 flex-shrink-0 text-gray-400"
          />
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {translator.translateText(AI_LOG_KIND_LABELS[entry.kind])}
          </span>
          <Link
            to={getSubjectRoute(props.descriptor, entry.subject.id)}
            className="min-w-0 truncate text-sm font-medium text-gray-900 hover:text-indigo-700 hover:underline"
          >
            {subjectLabel ||
              translator.translateText(
                entry.subject.kind === "incident"
                  ? "Open incident"
                  : "Open alert",
              )}
          </Link>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {look ? <Pill text={look.label} color={look.color} /> : <></>}
          <When at={entry.at} />
        </div>
      </div>

      {detail ? (
        detail.isCommand ? (
          <p
            className="mt-1 break-all font-mono text-xs text-gray-800"
            data-testid="ai-log-entry-detail"
          >
            {detail.text}
          </p>
        ) : (
          <p
            className="mt-1 break-words text-sm text-gray-600"
            data-testid="ai-log-entry-detail"
          >
            {detail.isOwnWords
              ? translator.translateText(detail.text)
              : detail.text}
          </p>
        )
      ) : (
        <></>
      )}

      {entry.kind === IncidentAlertAiLogKind.Fix &&
      (entry.runbookName || entry.ruleName) ? (
        <p
          className="mt-1 text-xs text-gray-500"
          data-testid="ai-log-entry-fix-source"
        >
          {entry.runbookName
            ? translator.translateTemplate("Runbook: {{name}}", {
                name: entry.runbookName,
              })
            : ""}
          {entry.runbookName && entry.ruleName ? " · " : ""}
          {entry.ruleName
            ? translator.translateTemplate("Rule: {{name}}", {
                name: entry.ruleName,
              })
            : ""}
        </p>
      ) : (
        <></>
      )}

      {facts.length > 0 ||
      (entry.kind === IncidentAlertAiLogKind.FixTask &&
        entry.taskNumber !== null) ||
      (entry.kind === IncidentAlertAiLogKind.Command &&
        entry.exitCode !== null) ? (
        <p
          className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-gray-500"
          data-testid="ai-log-entry-facts"
        >
          {facts.map((fact: string): ReactElement => {
            return <span key={fact}>{translator.translateText(fact)}</span>;
          })}
          {entry.kind === IncidentAlertAiLogKind.Command &&
          entry.exitCode !== null ? (
            <span>
              {translator.translateTemplate("Exit code {{exitCode}}", {
                exitCode: entry.exitCode,
              })}
            </span>
          ) : (
            <></>
          )}
          {entry.kind === IncidentAlertAiLogKind.FixTask &&
          entry.taskNumber !== null ? (
            <Link
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.AI_AGENT_TASK_VIEW] as Route,
                { modelId: entry.id },
              )}
              className="font-medium text-indigo-600 hover:text-indigo-800"
            >
              {translator.translateTemplate("Task #{{taskNumber}}", {
                taskNumber: entry.taskNumber,
              })}
            </Link>
          ) : (
            <></>
          )}
        </p>
      ) : (
        <></>
      )}

      {entry.kind === IncidentAlertAiLogKind.Command && entry.errorMessage ? (
        <p className="mt-1 max-w-2xl break-words text-xs text-rose-600">
          {entry.errorMessage}
        </p>
      ) : (
        <></>
      )}
    </li>
  );
}

const IncidentAlertAiLogsPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const descriptor: IncidentAlertAiDescriptor = getIncidentAlertAiDescriptor(
    props.subjectKind,
  );

  const [filter, setFilter] = useState<string>(ALL_KINDS_FILTER);
  const [logs, setLogs] = useState<AiLogs | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  /*
   * A failed Load More keeps the entries already shown and says so under
   * them, instead of replacing the page with an error.
   */
  const [loadMoreError, setLoadMoreError] = useState<string>("");
  const [refresher, setRefresher] = useState<boolean>(false);
  /*
   * The latest request. Changing the filter (or retrying) starts a new one;
   * an answer to an older one - a first page or a Load More - is dropped
   * instead of painting the wrong record.
   */
  const requestRef: MutableRefObject<number> = useRef<number>(0);

  const fetchLogs: (before: string | null) => Promise<AiLogs> = useCallback(
    async (before: string | null): Promise<AiLogs> => {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            INCIDENT_ALERT_AI_LOGS_PATHS[props.subjectKind],
          ),
          data: {
            ...(before ? { before } : {}),
            ...(getKindsForFilter(filter)
              ? { kinds: getKindsForFilter(filter)! }
              : {}),
          },
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const parsed: AiLogs | null = parseAiLogs(
        response.data,
        props.subjectKind,
      );

      if (!parsed) {
        throw new Error(
          translator.translateText(
            "The server returned AI logs this page cannot read.",
          ),
        );
      }

      return parsed;
    },
    [props.subjectKind, filter],
  );

  useEffect(() => {
    const request: number = ++requestRef.current;

    setIsLoading(true);
    setError("");
    setLoadMoreError("");
    setIsLoadingMore(false);

    fetchLogs(null)
      .then((parsed: AiLogs) => {
        if (request === requestRef.current) {
          setLogs(parsed);
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (request === requestRef.current) {
          setLogs(null);
          setError(API.getFriendlyMessage(err));
          setIsLoading(false);
        }
      });
  }, [fetchLogs, refresher]);

  const loadMore: () => void = (): void => {
    if (!logs || !logs.nextBefore || isLoadingMore) {
      return;
    }

    const request: number = requestRef.current;
    setIsLoadingMore(true);
    setLoadMoreError("");

    fetchLogs(logs.nextBefore)
      .then((more: AiLogs) => {
        if (request !== requestRef.current) {
          return;
        }

        setLogs({
          entries: appendAiLogsEntries(logs.entries, more.entries),
          nextBefore: more.nextBefore,
          hiddenKinds: more.hiddenKinds,
        });
        setIsLoadingMore(false);
      })
      .catch((err: unknown) => {
        if (request !== requestRef.current) {
          return;
        }

        setLoadMoreError(API.getFriendlyMessage(err));
        setIsLoadingMore(false);
      });
  };

  const settingsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[descriptor.settingsPage] as Route,
  );

  // Why a kind the caller may not read is missing, once each.
  const hiddenKindNotes: Array<string> = (logs?.hiddenKinds || [])
    .map((kind: IncidentAlertAiLogKind): string | undefined => {
      return AI_LOGS_HIDDEN_KIND_NOTES[kind];
    })
    .filter((note: string | undefined): note is string => {
      return Boolean(note);
    });

  let body: ReactElement;

  if (isLoading) {
    body = (
      <div data-testid="ai-logs-loading">
        <PageLoader isVisible={true} />
      </div>
    );
  } else if (!logs) {
    body = (
      <div data-testid="ai-logs-error">
        <ErrorMessage
          message={error || "Could not load the AI logs."}
          onRefreshClick={() => {
            setRefresher(!refresher);
          }}
        />
      </div>
    );
  } else if (logs.entries.length === 0) {
    body = (
      <div data-testid="ai-logs-empty">
        <EmptyState
          id={`${descriptor.testIdPrefix}-logs-empty`}
          icon={IconProp.QueueList}
          title={
            filter === ALL_KINDS_FILTER
              ? AI_LOGS_EMPTY_TITLE
              : "Nothing of this kind yet"
          }
          description={AI_LOGS_EMPTY_DESCRIPTIONS[props.subjectKind]}
          showSolidBackground={true}
          paddingClassName="py-12"
          footer={
            <p className="text-sm text-gray-600">
              <Link
                to={settingsRoute}
                className="font-medium text-indigo-600 underline hover:text-indigo-800"
              >
                {translator.translateText(
                  "Choose what OneUptime AI does on its own in AI → Settings",
                )}
              </Link>
            </p>
          }
        />
      </div>
    );
  } else {
    body = (
      <Card
        title="Activity"
        description={
          props.subjectKind === "incident"
            ? "Newest first. Open an entry's incident to see the whole investigation, fix or command output."
            : "Newest first. Open an entry's alert to see the whole investigation, fix or command output."
        }
      >
        <ul className="divide-y divide-gray-100" data-testid="ai-logs-entries">
          {logs.entries.map((entry: AiLogsEntry): ReactElement => {
            return (
              <EntryRow
                key={`${entry.kind}:${entry.id}`}
                entry={entry}
                descriptor={descriptor}
              />
            );
          })}
        </ul>

        <div className="mt-4 flex flex-col items-center gap-2">
          {loadMoreError ? (
            <p
              className="text-sm text-rose-600"
              data-testid="ai-logs-load-more-error"
            >
              {loadMoreError}
            </p>
          ) : (
            <></>
          )}
          {logs.nextBefore ? (
            <Button
              title="Load older entries"
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              isLoading={isLoadingMore}
              disabled={isLoadingMore}
              onClick={loadMore}
              dataTestId="ai-logs-load-more"
            />
          ) : (
            <p className="text-xs text-gray-500" data-testid="ai-logs-end">
              {translator.translateText(
                "That is everything OneUptime AI has done here.",
              )}
            </p>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Fragment>
      <div className="mb-5" data-testid="ai-logs-page-heading">
        <h2 className="text-lg font-semibold text-gray-900">
          {translator.translateText(AI_LOGS_PAGE_TITLE)}
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          {translator.translateText(AI_LOGS_PAGE_SUBTITLES[props.subjectKind])}
        </p>
      </div>

      <div
        className="mb-5 flex flex-wrap gap-2"
        role="group"
        aria-label={translator.translateText("Show")}
        data-testid="ai-logs-filter"
      >
        {AI_LOGS_FILTER_OPTIONS.map(
          (option: AiLogsFilterOption): ReactElement => {
            const isSelected: boolean = filter === option.value;

            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={isSelected}
                data-testid={`ai-logs-filter-${option.value}`}
                onClick={() => {
                  setFilter(option.value);
                }}
                className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  isSelected
                    ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                    : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                {translator.translateText(option.label)}
              </button>
            );
          },
        )}
      </div>

      {hiddenKindNotes.length > 0 ? (
        <div
          className="mb-5 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
          data-testid="ai-logs-hidden-kinds"
        >
          <Icon
            icon={IconProp.Info}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
          />
          <div className="space-y-1 text-sm text-amber-900">
            {hiddenKindNotes.map((note: string): ReactElement => {
              return <p key={note}>{translator.translateText(note)}</p>;
            })}
          </div>
        </div>
      ) : (
        <></>
      )}

      {body}
    </Fragment>
  );
};

export default IncidentAlertAiLogsPage;
