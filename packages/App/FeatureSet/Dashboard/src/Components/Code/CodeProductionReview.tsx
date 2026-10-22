import {
  PRODUCTION_REVIEW_AI_NOTES,
  PRODUCTION_REVIEW_COPY,
  PRODUCTION_REVIEW_INCIDENTS_IN_ALL,
  PRODUCTION_REVIEW_MATCH_LABELS,
  PRODUCTION_REVIEW_SECTION_LABELS,
  PRODUCTION_REVIEW_SPANS_LAST_HOUR,
  PRODUCTION_REVIEW_WHERE_LABELS,
  formatReviewDuration,
  formatReviewPercent,
  getProductionReviewNothingSentence,
  getProfileKindLabel,
  splitPointText,
} from "./CodeProductionReviewCopy";
import CodeTimeAgo from "./CodeTimeAgo";
import PageMap from "../../Utils/PageMap";
import { buildProfilesRoute } from "../../Utils/ProfilesUrlState";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import {
  PRODUCTION_REVIEW_WINDOWS,
  ProductionReviewDeployJSON,
  ProductionReviewExceptionJSON,
  ProductionReviewHotFunctionJSON,
  ProductionReviewIncidentJSON,
  ProductionReviewOperationJSON,
  ProductionReviewPointJSON,
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
 * says why. Lists, not tables: a row's facts wrap on a phone rather than
 * scroll.
 *
 * Everything drawn here is aggregate - counts, durations, shares and the
 * names of code - as the review holds nothing else.
 */

export interface ComponentProps {
  report: ProductionReviewReport;
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

// The name of a piece of code, drawn as code.
const CodeName: FunctionComponent<{
  children: ReactNode;
  className?: string | undefined;
}> = (props: {
  children: ReactNode;
  className?: string | undefined;
}): ReactElement => {
  return (
    <code
      className={`rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-800 [overflow-wrap:anywhere] ${props.className || ""}`}
    >
      {props.children}
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

// A line of a finding's facts, a dot between each.
const Facts: FunctionComponent<{ items: Array<ReactNode> }> = (props: {
  items: Array<ReactNode>;
}): ReactElement => {
  const shown: Array<ReactNode> = props.items.filter((item: ReactNode) => {
    return item !== null && item !== undefined && item !== "";
  });

  return (
    <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-gray-500">
      {shown.map((item: ReactNode, index: number) => {
        return (
          <React.Fragment key={index}>
            {index > 0 ? (
              <span aria-hidden="true" className="text-gray-300">
                ·
              </span>
            ) : (
              <></>
            )}
            <span className="min-w-0 break-words">{item}</span>
          </React.Fragment>
        );
      })}
    </p>
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

  const text: (key: string) => string = (key: string): string => {
    return translator.translateText(key) || key;
  };

  const days: (count: number) => string = (count: number): string => {
    return translator.translateTemplate("Last {{days}} days", {
      days: translator.formatNumber(count),
    });
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
          <p className="mt-2 text-xs text-gray-500">
            {text(PRODUCTION_REVIEW_COPY.pointsBy)}
          </p>
        </section>
      );
    }

    if (report.aiNote) {
      return (
        <div
          data-testid="production-review-ai-note"
          data-ai-note={report.aiNote.code}
          className="flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 sm:px-5"
        >
          <Icon
            icon={IconProp.Sparkles}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
          />
          <p className="min-w-0">
            {text(PRODUCTION_REVIEW_AI_NOTES[report.aiNote.code])}
          </p>
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
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {text(PRODUCTION_REVIEW_COPY.runsIn)}
        </p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {report.services.map((service: ProductionReviewServiceJSON) => {
            const facts: Array<string> = [];

            if (service.requestCount !== undefined) {
              facts.push(
                translator.translatePlural(
                  PRODUCTION_REVIEW_SPANS_LAST_HOUR,
                  service.requestCount,
                ),
              );
            }

            if (service.p99Ms !== undefined) {
              facts.push(
                translator.translateTemplate(PRODUCTION_REVIEW_COPY.p99, {
                  duration: formatReviewDuration(service.p99Ms, translator),
                }),
              );
            }

            return (
              <li
                key={service.id}
                data-testid="production-review-service"
                className="max-w-full"
              >
                <RowName route={recordRoute(PageMap.SERVICE_VIEW, service.id)}>
                  <span className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-600">
                    <span className="font-medium text-gray-900">
                      {service.name}
                    </span>
                    {facts.map((fact: string) => {
                      return (
                        <React.Fragment key={fact}>
                          <span aria-hidden="true" className="text-gray-300">
                            ·
                          </span>
                          <span>{fact}</span>
                        </React.Fragment>
                      );
                    })}
                  </span>
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
                  className="flex-shrink-0 text-sm font-semibold tabular-nums text-gray-900"
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
                items={[
                  <CodeName key="where">
                    {exception.line
                      ? `${exception.path}:${exception.line}`
                      : exception.path}
                  </CodeName>,
                  exception.functionName ? (
                    <CodeName key="function">{exception.functionName}</CodeName>
                  ) : null,
                  text(PRODUCTION_REVIEW_WHERE_LABELS[exception.where]),
                  exception.serviceName,
                  exception.lastSeenAt ? (
                    <span key="last-seen">
                      <TranslatedSentence
                        template={PRODUCTION_REVIEW_COPY.lastSeen}
                        slots={{
                          time: <CodeTimeAgo date={exception.lastSeenAt} />,
                        }}
                      />
                    </span>
                  ) : null,
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
                items={[
                  operation.serviceName,
                  translator.translatePlural(
                    { one: "{{count}} span", other: "{{count}} spans" },
                    operation.requestCount,
                  ),
                  operation.errorCount > 0
                    ? `${translator.translatePlural(
                        { one: "{{count}} error", other: "{{count}} errors" },
                        operation.errorCount,
                      )} (${errorRate})`
                    : null,
                  text(PRODUCTION_REVIEW_MATCH_LABELS[operation.matchedBy]),
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
                <span className="flex-shrink-0 text-sm font-semibold tabular-nums text-gray-900">
                  {formatReviewPercent(hot.totalPercent, translator)}
                </span>
              </div>
              <Facts
                items={[
                  <CodeName key="path">{hot.path}</CodeName>,
                  hot.serviceName,
                  translator.translateTemplate(
                    PRODUCTION_REVIEW_COPY.hotFunctionShare,
                    {
                      total: formatReviewPercent(hot.totalPercent, translator),
                      self: formatReviewPercent(hot.selfPercent, translator),
                    },
                  ),
                  getProfileKindLabel(hot.profileKind, translator),
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
                items={[
                  <span key="declared">
                    <TranslatedSentence
                      template={PRODUCTION_REVIEW_COPY.declared}
                      slots={{
                        time: <CodeTimeAgo date={incident.declaredAt} />,
                      }}
                    />
                  </span>,
                  incident.mentions ? (
                    <span
                      key="mentions"
                      data-testid="production-review-incident-mentions"
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
                <div className="flex flex-wrap items-center gap-2">
                  <RowName
                    route={recordRoute(PageMap.SERVICE_VIEW, deploy.serviceId)}
                  >
                    <span className="text-sm font-medium text-gray-900">
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
              {getProductionReviewNothingSentence(report, translator)}
            </p>
          </div>
        </div>
      )}

      {renderUnread()}

      <div
        data-testid="production-review-aggregates"
        className="flex items-start gap-2 text-xs leading-5 text-gray-500"
      >
        <Icon
          icon={IconProp.Lock}
          className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400"
        />
        <p className="min-w-0">{text(PRODUCTION_REVIEW_COPY.aggregatesOnly)}</p>
      </div>
    </div>
  );
};

export default CodeProductionReview;
