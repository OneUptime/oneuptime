import {
  PRODUCTION_REVIEW_AI_NOTES,
  PRODUCTION_REVIEW_COPY,
  PRODUCTION_REVIEW_INCIDENTS_IN_ALL,
  PRODUCTION_REVIEW_MATCH_LABELS,
  PRODUCTION_REVIEW_SECTION_LABELS,
  PRODUCTION_REVIEW_SPANS_LAST_HOUR,
  PRODUCTION_REVIEW_WHERE_LABELS,
  ProductionReviewProviderLine,
  formatReviewDuration,
  formatReviewPercent,
  getProductionReviewNothingSentence,
  getProductionReviewProviderLine,
  getProfileKindLabel,
  inReviewHostWords,
  splitCodeNameAtBreaks,
  splitPointText,
} from "./CodeProductionReviewCopy";
import CodeMetaList from "./CodeMetaList";
import CodeTimeAgo from "./CodeTimeAgo";
import PageMap from "../../Utils/PageMap";
import { buildProfilesRoute } from "../../Utils/ProfilesUrlState";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { CodeHost } from "Common/Types/CodeRepository/CodeHost";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import {
  PRODUCTION_REVIEW_WINDOWS,
  ProductionReviewDeployJSON,
  ProductionReviewExceptionJSON,
  ProductionReviewHotFunctionJSON,
  ProductionReviewIncidentJSON,
  ProductionReviewOperationJSON,
  ProductionReviewPointJSON,
  ProductionReviewPosting,
  ProductionReviewReport,
  ProductionReviewSection,
  ProductionReviewServiceJSON,
  ProductionReviewUtil,
} from "Common/Types/CodeRepository/ProductionReview";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { toTracesExplorerQueryParams } from "Common/Utils/Telemetry/CrossSignalScope";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * A pull request's production review, as its page in Code draws it: what
 * OneUptime AI says to watch (when it read the review), the services the
 * changed code runs in, and what production shows of that code - the
 * exceptions thrown in it, the operations that run it, the functions of it
 * that take a share of a profile, the incidents and deploys around it -
 * each linked to where it lives in OneUptime. A review that found nothing
 * says why, and the parts that could not be read are named before the
 * findings. Lists, not tables: a row's facts wrap on a phone rather than
 * scroll, between facts (Code's meta line) and inside the names of code
 * only between their parts.
 *
 * Everything drawn here is aggregate - counts, durations, shares and the
 * names of code - as the review holds nothing else.
 */

export interface ComponentProps {
  report: ProductionReviewReport;
  /*
   * Where the repository is hosted: GitLab's words say merge request, and
   * what a posted review holds names the host. Unset reads as GitHub.
   */
  provider?: string | undefined;
  // The host's name as Code says it: "GitLab", "Forgejo", "Gitea".
  hostName?: string | undefined;
  /*
   * Where the repository's LLM provider for production reviews is picked
   * (its Settings, at Production Review LLM Provider), for those who may
   * change it: a pick that could not be used links there.
   */
  llmProviderSettingsRoute?: Route | undefined;
}

const SECTION_CLASS_NAME: string =
  "overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm";

// The page an id opens, or none for one that is not an id.
function recordRoute(pageMap: PageMap, id: string): Route | null {
  if (!ObjectID.isValidUUID(id)) {
    return null;
  }

  return RouteUtil.populateRouteParams(RouteMap[pageMap] as Route, {
    modelId: new ObjectID(id),
  });
}

/*
 * The window the review read, ending when it was read: the traces and
 * profiles behind a row open on it.
 */
function getReadWindow(
  report: ProductionReviewReport,
  hours: number,
): { startTime: Date; endTime: Date } {
  const reviewedAt: Date = new Date(report.reviewedAt);
  const endTime: Date = Number.isNaN(reviewedAt.getTime())
    ? new Date()
    : reviewedAt;

  return {
    startTime: new Date(endTime.getTime() - hours * 60 * 60 * 1000),
    endTime,
  };
}

// The traces of an operation's service, in the hour the review read.
export function getOperationTracesRoute(
  operation: ProductionReviewOperationJSON,
  report: ProductionReviewReport,
): Route {
  const window: { startTime: Date; endTime: Date } = getReadWindow(
    report,
    PRODUCTION_REVIEW_WINDOWS.tracesHours,
  );
  const params: Record<string, string> = toTracesExplorerQueryParams({
    serviceIds: [operation.serviceId],
    startTime: window.startTime,
    endTime: window.endTime,
  }).params;
  const search: URLSearchParams = new URLSearchParams();

  for (const key of Object.keys(params)) {
    search.set(key, params[key] as string);
  }

  const base: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.TRACES] as Route,
  );
  const query: string = search.toString();

  return query ? new Route(`${base.toString()}?${query}`) : base;
}

// The Profiler on a hot function, in the hour the review read.
export function getHotFunctionRoute(
  hot: ProductionReviewHotFunctionJSON,
  report: ProductionReviewReport,
): Route {
  const window: { startTime: Date; endTime: Date } = getReadWindow(
    report,
    PRODUCTION_REVIEW_WINDOWS.profilesHours,
  );

  return buildProfilesRoute({
    serviceId: hot.serviceId,
    functionName: hot.functionName,
    fileName: hot.path,
    startTime: window.startTime,
    endTime: window.endTime,
  });
}

// The name of a piece of code, drawn as code: it wraps between its parts.
const CodeName: FunctionComponent<{
  children: string;
  className?: string | undefined;
}> = (props: {
  children: string;
  className?: string | undefined;
}): ReactElement => {
  const pieces: Array<string> = splitCodeNameAtBreaks(props.children);

  return (
    <code
      className={`rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-800 [overflow-wrap:anywhere] ${props.className || ""}`}
    >
      {pieces.map((piece: string, index: number) => {
        return (
          <React.Fragment key={index}>
            {piece}
            {index < pieces.length - 1 ? <wbr /> : <></>}
          </React.Fragment>
        );
      })}
    </code>
  );
};

// A small label beside a finding: "New", "Unhandled".
const Badge: FunctionComponent<{
  text: string;
  tone: "red" | "amber" | "gray";
  dataTestId?: string | undefined;
}> = (props: {
  text: string;
  tone: "red" | "amber" | "gray";
  dataTestId?: string | undefined;
}): ReactElement => {
  const toneClassName: string =
    props.tone === "red"
      ? "bg-red-50 text-red-700 ring-red-600/20"
      : props.tone === "amber"
        ? "bg-amber-50 text-amber-800 ring-amber-600/20"
        : "bg-gray-100 text-gray-600 ring-gray-500/20";

  return (
    <span
      data-testid={props.dataTestId}
      className={`inline-flex flex-shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${toneClassName}`}
    >
      {props.text}
    </span>
  );
};

/*
 * One fact of a row: kept whole on its line, and wrapped only when it is
 * longer than a whole line (a deep path, a long name).
 */
function fact(key: string, content: ReactNode): ReactElement {
  return (
    <span
      key={key}
      className="min-w-0 whitespace-normal [overflow-wrap:anywhere]"
    >
      {content}
    </span>
  );
}

/*
 * A row's facts on a line of their own, a dot between each - Code's meta
 * line, so no line a narrow screen wraps starts or ends with a dot.
 */
const Facts: FunctionComponent<{
  items: Array<ReactElement | null>;
  dataTestId?: string | undefined;
}> = (props: {
  items: Array<ReactElement | null>;
  dataTestId?: string | undefined;
}): ReactElement => {
  return (
    <CodeMetaList
      dataTestId={props.dataTestId}
      className="mt-1 text-xs text-gray-500"
      items={
        props.items.filter((item: ReactElement | null): boolean => {
          return item !== null;
        }) as Array<ReactElement>
      }
    />
  );
};

// One part of the review: its title, the window it read, and its rows.
const ReviewSection: FunctionComponent<{
  title: string;
  window?: string | undefined;
  dataTestId: string;
  children: ReactNode;
}> = (props: {
  title: string;
  window?: string | undefined;
  dataTestId: string;
  children: ReactNode;
}): ReactElement => {
  const headingId: string = `${props.dataTestId}-heading`;

  return (
    <section
      data-testid={props.dataTestId}
      aria-labelledby={headingId}
      className={SECTION_CLASS_NAME}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-gray-100 px-4 py-3 sm:px-5">
        <h2 id={headingId} className="text-sm font-semibold text-gray-900">
          {props.title}
        </h2>
        {props.window ? (
          <span className="text-xs text-gray-500">{props.window}</span>
        ) : (
          <></>
        )}
      </div>
      <ul className="divide-y divide-gray-100">{props.children}</ul>
    </section>
  );
};

const ROW_CLASS_NAME: string = "px-4 py-3 sm:px-5";

// A row's name, linked to where it lives in OneUptime when it can be.
const RowName: FunctionComponent<{
  route: Route | null;
  children: ReactElement;
}> = (props: { route: Route | null; children: ReactElement }): ReactElement => {
  if (!props.route) {
    return props.children;
  }

  return (
    <Link
      to={props.route}
      className="min-w-0 hover:text-indigo-600 hover:underline"
    >
      {props.children}
    </Link>
  );
};

const CodeProductionReview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const report: ProductionReviewReport = props.report;
  const hasSignal: boolean = ProductionReviewUtil.hasSignal(report);
  const notableIncidents: Array<ProductionReviewIncidentJSON> =
    ProductionReviewUtil.getNotableIncidents(report.incidents);

  // A sentence in the host's words: GitLab's merge request.
  const text: (key: string) => string = (key: string): string => {
    const sentence: string = inReviewHostWords(key, props.provider);

    return translator.translateText(sentence) || sentence;
  };

  const days: (count: number) => string = (count: number): string => {
    return translator.translateTemplate("Last {{days}} days", {
      days: translator.formatNumber(count),
    });
  };

  const providerLine: ProductionReviewProviderLine | null =
    getProductionReviewProviderLine(report.llmProvider);

  /*
   * The LLM provider that read the review, when the repository picks one:
   * named where What to watch says OneUptime AI read the facts - or, when
   * the pick could not be used, a warning that says which provider read it
   * instead and why, wherever the review says what AI did: marked as one
   * (not by its colour alone), with Change in Settings for those who may
   * pick another.
   */
  const renderProviderLine: (
    line: ProductionReviewProviderLine,
    place: "after-list" | "after-line" | "alone",
  ) => ReactElement = (
    line: ProductionReviewProviderLine,
    place: "after-list" | "after-line" | "alone",
  ): ReactElement => {
    const placeClassName: string =
      place === "after-list"
        ? "mt-2 text-xs"
        : place === "after-line"
          ? "mt-1.5 text-xs"
          : "text-sm";
    const sentence: string = translator.translateTemplate(line.template, {
      provider: line.providerName,
    });

    if (!line.isWarning) {
      return (
        <p
          data-testid="production-review-llm-provider"
          data-llm-provider="picked"
          className={`${placeClassName} [overflow-wrap:anywhere] text-gray-500`}
        >
          {sentence}
        </p>
      );
    }

    return (
      <div
        data-testid="production-review-llm-provider"
        data-llm-provider="fell-back"
        className={`${placeClassName} flex items-start gap-1.5 text-amber-700`}
      >
        <Icon
          icon={IconProp.Alert}
          className={`${
            place === "alone" ? "mt-0.5 h-4 w-4" : "mt-px h-3.5 w-3.5"
          } flex-shrink-0 text-amber-500`}
        />
        <p className="min-w-0 [overflow-wrap:anywhere]">
          {sentence}
          {props.llmProviderSettingsRoute ? (
            <>
              {" "}
              <Link
                to={props.llmProviderSettingsRoute}
                dataTestId="production-review-llm-provider-settings"
                className="font-medium text-amber-900 underline hover:text-amber-700"
              >
                <>{text(PRODUCTION_REVIEW_COPY.openSettings)}</>
              </Link>
            </>
          ) : (
            <></>
          )}
        </p>
      </div>
    );
  };

  const renderPoints: () => ReactElement = (): ReactElement => {
    if (report.points.length > 0) {
      return (
        <section
          data-testid="production-review-points"
          aria-labelledby="production-review-points-heading"
          className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 sm:px-5"
        >
          <h2
            id="production-review-points-heading"
            className="flex items-center gap-2 text-sm font-semibold text-gray-900"
          >
            <Icon
              icon={IconProp.Sparkles}
              className="h-4 w-4 flex-shrink-0 text-indigo-600"
            />
            {text(PRODUCTION_REVIEW_COPY.pointsTitle)}
          </h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-6 text-gray-800">
            {report.points.map(
              (point: ProductionReviewPointJSON, index: number) => {
                return (
                  <li key={index} data-testid="production-review-point">
                    {splitPointText(point.text).map(
                      (
                        part: { text: string; isCode: boolean },
                        partIndex: number,
                      ) => {
                        return part.isCode ? (
                          <CodeName key={partIndex}>{part.text}</CodeName>
                        ) : (
                          <React.Fragment key={partIndex}>
                            {part.text}
                          </React.Fragment>
                        );
                      },
                    )}
                  </li>
                );
              },
            )}
          </ul>
          {providerLine && !providerLine.isWarning ? (
            renderProviderLine(providerLine, "after-list")
          ) : (
            <p className="mt-2 text-xs text-gray-500">
              {text(PRODUCTION_REVIEW_COPY.pointsBy)}
            </p>
          )}
          {providerLine?.isWarning ? (
            renderProviderLine(providerLine, "after-line")
          ) : (
            <></>
          )}
        </section>
      );
    }

    /*
     * No points: why, when the review says - and a pick that could not be
     * used, even when the read had nothing to say.
     */
    const fellBack: ProductionReviewProviderLine | null =
      providerLine?.isWarning ? providerLine : null;

    if (report.aiNote || fellBack) {
      return (
        <div
          data-testid="production-review-ai-note"
          {...(report.aiNote ? { "data-ai-note": report.aiNote.code } : {})}
          className="flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 sm:px-5"
        >
          <Icon
            icon={IconProp.Sparkles}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
          />
          <div className="min-w-0">
            {report.aiNote ? (
              <p>{text(PRODUCTION_REVIEW_AI_NOTES[report.aiNote.code])}</p>
            ) : (
              <></>
            )}
            {fellBack ? (
              renderProviderLine(
                fellBack,
                report.aiNote ? "after-line" : "alone",
              )
            ) : (
              <></>
            )}
          </div>
        </div>
      );
    }

    return <></>;
  };

  const renderServices: () => ReactElement = (): ReactElement => {
    if (report.services.length === 0) {
      return <></>;
    }

    return (
      <div data-testid="production-review-services">
        <p className="text-xs font-medium text-gray-500">
          {text(PRODUCTION_REVIEW_COPY.runsIn)}
        </p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {report.services.map((service: ProductionReviewServiceJSON) => {
            const facts: Array<ReactElement> = [
              <span
                key="name"
                className="min-w-0 whitespace-normal font-medium text-gray-900 [overflow-wrap:anywhere]"
              >
                {service.name}
              </span>,
            ];

            if (service.requestCount !== undefined) {
              facts.push(
                fact(
                  "requests",
                  translator.translatePlural(
                    PRODUCTION_REVIEW_SPANS_LAST_HOUR,
                    service.requestCount,
                  ),
                ),
              );
            }

            if (service.p99Ms !== undefined) {
              facts.push(
                fact(
                  "p99",
                  translator.translateTemplate(PRODUCTION_REVIEW_COPY.p99, {
                    duration: formatReviewDuration(service.p99Ms, translator),
                  }),
                ),
              );
            }

            return (
              <li
                key={service.id}
                data-testid="production-review-service"
                className="min-w-0 max-w-full"
              >
                <RowName route={recordRoute(PageMap.SERVICE_VIEW, service.id)}>
                  <div className="inline-flex max-w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5">
                    <CodeMetaList
                      className="text-xs text-gray-600"
                      items={facts}
                    />
                  </div>
                </RowName>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  const renderExceptions: () => ReactElement = (): ReactElement => {
    if (report.exceptions.length === 0) {
      return <></>;
    }

    return (
      <ReviewSection
        title={text(PRODUCTION_REVIEW_COPY.exceptionsTitle)}
        window={days(PRODUCTION_REVIEW_WINDOWS.exceptionsDays)}
        dataTestId="production-review-exceptions"
      >
        {report.exceptions.map((exception: ProductionReviewExceptionJSON) => {
          return (
            <li
              key={exception.exceptionId}
              data-testid="production-review-exception"
              className={ROW_CLASS_NAME}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <RowName
                    route={recordRoute(
                      PageMap.EXCEPTIONS_VIEW,
                      exception.exceptionId,
                    )}
                  >
                    <span className="text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">
                      {exception.type}
                    </span>
                  </RowName>
                  {exception.isNew ? (
                    <Badge
                      text={text(PRODUCTION_REVIEW_COPY.newBadge)}
                      tone="amber"
                      dataTestId="production-review-exception-new"
                    />
                  ) : (
                    <></>
                  )}
                  {exception.isUnhandled ? (
                    <Badge
                      text={text(PRODUCTION_REVIEW_COPY.unhandledBadge)}
                      tone="red"
                      dataTestId="production-review-exception-unhandled"
                    />
                  ) : (
                    <></>
                  )}
                </div>
                <span
                  data-testid="production-review-exception-count"
                  className="flex-shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums text-gray-900"
                >
                  {exception.isWindowCount
                    ? translator.formatNumber(exception.occurrences)
                    : translator.translateTemplate(
                        PRODUCTION_REVIEW_COPY.allTimeCount,
                        {
                          count: translator.formatNumber(exception.occurrences),
                        },
                      )}
                </span>
              </div>
              <Facts
                dataTestId="production-review-exception-facts"
                items={[
                  fact(
                    "where",
                    <CodeName>
                      {exception.line
                        ? `${exception.path}:${exception.line}`
                        : exception.path}
                    </CodeName>,
                  ),
                  exception.functionName
                    ? fact(
                        "function",
                        <CodeName>{exception.functionName}</CodeName>,
                      )
                    : null,
                  fact(
                    "closeness",
                    text(PRODUCTION_REVIEW_WHERE_LABELS[exception.where]),
                  ),
                  fact("service", exception.serviceName),
                  exception.lastSeenAt
                    ? fact(
                        "last-seen",
                        <TranslatedSentence
                          template={PRODUCTION_REVIEW_COPY.lastThrown}
                          slots={{
                            time: <CodeTimeAgo date={exception.lastSeenAt} />,
                          }}
                        />,
                      )
                    : null,
                ]}
              />
            </li>
          );
        })}
      </ReviewSection>
    );
  };

  const renderOperations: () => ReactElement = (): ReactElement => {
    if (report.operations.length === 0) {
      return <></>;
    }

    return (
      <ReviewSection
        title={text(PRODUCTION_REVIEW_COPY.operationsTitle)}
        window={text(PRODUCTION_REVIEW_COPY.operationsWindow)}
        dataTestId="production-review-operations"
      >
        {report.operations.map((operation: ProductionReviewOperationJSON) => {
          const errorRate: string =
            operation.requestCount > 0
              ? formatReviewPercent(
                  (operation.errorCount / operation.requestCount) * 100,
                  translator,
                )
              : "";

          return (
            <li
              key={`${operation.serviceId}-${operation.name}`}
              data-testid="production-review-operation"
              className={ROW_CLASS_NAME}
            >
              <div className="flex items-start justify-between gap-3">
                <RowName route={getOperationTracesRoute(operation, report)}>
                  <CodeName className="text-sm">{operation.name}</CodeName>
                </RowName>
                <span className="flex-shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums text-gray-900">
                  {translator.translateTemplate(PRODUCTION_REVIEW_COPY.p95, {
                    duration: formatReviewDuration(operation.p95Ms, translator),
                  })}
                </span>
              </div>
              <Facts
                dataTestId="production-review-operation-facts"
                items={[
                  fact("service", operation.serviceName),
                  fact(
                    "requests",
                    translator.translatePlural(
                      { one: "{{count}} span", other: "{{count}} spans" },
                      operation.requestCount,
                    ),
                  ),
                  operation.errorCount > 0
                    ? fact(
                        "errors",
                        `${translator.translatePlural(
                          { one: "{{count}} error", other: "{{count}} errors" },
                          operation.errorCount,
                        )} (${errorRate})`,
                      )
                    : null,
                  fact(
                    "match",
                    text(PRODUCTION_REVIEW_MATCH_LABELS[operation.matchedBy]),
                  ),
                ]}
              />
            </li>
          );
        })}
      </ReviewSection>
    );
  };

  const renderHotCode: () => ReactElement = (): ReactElement => {
    if (report.hotFunctions.length === 0) {
      return <></>;
    }

    return (
      <ReviewSection
        title={text(PRODUCTION_REVIEW_COPY.hotCodeTitle)}
        window={text(PRODUCTION_REVIEW_COPY.hotCodeWindow)}
        dataTestId="production-review-hot-code"
      >
        {report.hotFunctions.map((hot: ProductionReviewHotFunctionJSON) => {
          return (
            <li
              key={`${hot.serviceId}-${hot.path}-${hot.functionName}`}
              data-testid="production-review-hot-function"
              className={ROW_CLASS_NAME}
            >
              <div className="flex items-start justify-between gap-3">
                <RowName route={getHotFunctionRoute(hot, report)}>
                  <CodeName className="text-sm">{hot.functionName}</CodeName>
                </RowName>
                {/* Its share with what it calls, as the Profiler's Total. */}
                <span
                  data-testid="production-review-hot-function-share"
                  className="flex-shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums text-gray-900"
                >
                  {formatReviewPercent(hot.totalPercent, translator)}
                </span>
              </div>
              <Facts
                dataTestId="production-review-hot-function-facts"
                items={[
                  fact("path", <CodeName>{hot.path}</CodeName>),
                  fact("service", hot.serviceName),
                  fact(
                    "kind",
                    getProfileKindLabel(hot.profileKind, translator),
                  ),
                  fact(
                    "self",
                    translator.translateTemplate(
                      PRODUCTION_REVIEW_COPY.hotFunctionSelf,
                      {
                        self: formatReviewPercent(hot.selfPercent, translator),
                      },
                    ),
                  ),
                ]}
              />
            </li>
          );
        })}
      </ReviewSection>
    );
  };

  const renderIncidents: () => ReactElement = (): ReactElement => {
    if (notableIncidents.length === 0) {
      return <></>;
    }

    return (
      <ReviewSection
        title={text(PRODUCTION_REVIEW_COPY.incidentsTitle)}
        window={days(PRODUCTION_REVIEW_WINDOWS.incidentsDays)}
        dataTestId="production-review-incidents"
      >
        {notableIncidents.map((incident: ProductionReviewIncidentJSON) => {
          return (
            <li
              key={incident.incidentId}
              data-testid="production-review-incident"
              className={ROW_CLASS_NAME}
            >
              <div className="flex flex-wrap items-center gap-2">
                <RowName
                  route={recordRoute(
                    PageMap.INCIDENT_VIEW,
                    incident.incidentId,
                  )}
                >
                  <span className="text-sm font-medium text-gray-900">
                    {incident.label}
                  </span>
                </RowName>
                {incident.severity ? (
                  <Badge
                    text={incident.severity}
                    tone={incident.isOpen ? "red" : "gray"}
                  />
                ) : (
                  <></>
                )}
                {incident.state ? (
                  <span className="text-xs text-gray-600">
                    {incident.state}
                  </span>
                ) : (
                  <></>
                )}
              </div>
              <Facts
                dataTestId="production-review-incident-facts"
                items={[
                  fact(
                    "declared",
                    <TranslatedSentence
                      template={PRODUCTION_REVIEW_COPY.declared}
                      slots={{
                        time: <CodeTimeAgo date={incident.declaredAt} />,
                      }}
                    />,
                  ),
                  incident.mentions ? (
                    <span
                      key="mentions"
                      data-testid="production-review-incident-mentions"
                      className="min-w-0 whitespace-normal [overflow-wrap:anywhere]"
                    >
                      <TranslatedSentence
                        template={PRODUCTION_REVIEW_COPY.incidentNames}
                        slots={{
                          subject: <CodeName>{incident.mentions}</CodeName>,
                        }}
                      />
                    </span>
                  ) : null,
                ]}
              />
            </li>
          );
        })}
        {report.incidents.total > notableIncidents.length ? (
          <li
            data-testid="production-review-incidents-total"
            className={`${ROW_CLASS_NAME} text-xs text-gray-500`}
          >
            {translator.translatePlural(
              PRODUCTION_REVIEW_INCIDENTS_IN_ALL,
              report.incidents.total,
            )}
          </li>
        ) : (
          <></>
        )}
      </ReviewSection>
    );
  };

  const renderDeploys: () => ReactElement = (): ReactElement => {
    if (report.suspectDeploys.length === 0) {
      return <></>;
    }

    return (
      <ReviewSection
        title={text(PRODUCTION_REVIEW_COPY.deploysTitle)}
        window={days(PRODUCTION_REVIEW_WINDOWS.deploysDays)}
        dataTestId="production-review-deploys"
      >
        {report.suspectDeploys.map(
          (deploy: ProductionReviewDeployJSON, index: number) => {
            return (
              <li
                key={`${deploy.serviceId}-${deploy.at}-${index}`}
                data-testid="production-review-deploy"
                className={ROW_CLASS_NAME}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <RowName
                    route={recordRoute(PageMap.SERVICE_VIEW, deploy.serviceId)}
                  >
                    <span className="text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">
                      {deploy.serviceName}
                    </span>
                  </RowName>
                  {deploy.version ? (
                    <CodeName>{deploy.version}</CodeName>
                  ) : (
                    <></>
                  )}
                  <span className="text-xs text-gray-500">
                    <TranslatedSentence
                      template={PRODUCTION_REVIEW_COPY.deployAfter}
                      slots={{ time: <CodeTimeAgo date={deploy.at} /> }}
                    />
                  </span>
                </div>
                <p className="mt-1 break-words text-sm text-gray-700">
                  {deploy.impact}
                </p>
              </li>
            );
          },
        )}
      </ReviewSection>
    );
  };

  /*
   * Above the findings, so no one reads "nothing found" without knowing
   * what was not read.
   */
  const renderUnread: () => ReactElement = (): ReactElement => {
    if (report.unreadSections.length === 0) {
      return <></>;
    }

    return (
      <div
        data-testid="production-review-unread"
        className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm sm:px-5"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Icon
            icon={IconProp.ExclaimationCircle}
            className="h-4 w-4 flex-shrink-0 text-amber-600"
          />
          <span className="font-medium text-amber-800">
            {text(PRODUCTION_REVIEW_COPY.unreadTitle)}
          </span>
          {report.unreadSections.map((section: ProductionReviewSection) => {
            return (
              <span
                key={section}
                data-testid="production-review-unread-section"
                className="rounded-md bg-white px-1.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200"
              >
                {text(PRODUCTION_REVIEW_SECTION_LABELS[section])}
              </span>
            );
          })}
        </div>
        <p className="mt-1 text-amber-800">
          {text(PRODUCTION_REVIEW_COPY.unreadDescription)}
        </p>
      </div>
    );
  };

  return (
    <div data-testid="production-review" className="space-y-4">
      {renderPoints()}
      {renderServices()}
      {renderUnread()}

      {hasSignal ? (
        <>
          {renderExceptions()}
          {renderOperations()}
          {renderHotCode()}
          {renderIncidents()}
          {renderDeploys()}
        </>
      ) : (
        <div
          data-testid="production-review-nothing-found"
          className={`${SECTION_CLASS_NAME} flex items-start gap-3 px-4 py-4 sm:px-5`}
        >
          <Icon
            icon={IconProp.CheckCircle}
            className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-500"
          />
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900">
              {text(PRODUCTION_REVIEW_COPY.nothingFoundTitle)}
            </p>
            <p className="mt-1 text-sm leading-6 text-gray-600">
              {getProductionReviewNothingSentence(
                report,
                translator,
                props.provider,
              )}
            </p>
          </div>
        </div>
      )}

      {/*
       * What the pull request was shown of production - said only where it
       * was shown something: a link or nothing posts none of it.
       */}
      {report.posting === ProductionReviewPosting.Review ? (
        <div
          data-testid="production-review-aggregates"
          className="flex items-start gap-2 text-xs leading-5 text-gray-500"
        >
          <Icon
            icon={IconProp.Lock}
            className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400"
          />
          <p className="min-w-0">
            {CodeHost.readType(props.provider) === CodeRepositoryType.GitHub
              ? text(PRODUCTION_REVIEW_COPY.aggregatesOnly)
              : translator.translateTemplate(
                  PRODUCTION_REVIEW_COPY.aggregatesOnlyHost,
                  {
                    host:
                      props.hostName || CodeHost.getFacts(props.provider).name,
                  },
                )}
          </p>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default CodeProductionReview;
