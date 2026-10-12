import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { SettingsAction, getSettingsAction } from "../InvestigationNotStarted";
import {
  AI_INSIGHTS_FINDING_LABEL,
  AI_INSIGHTS_FIXES_HIDDEN_NOTE,
  AI_INSIGHTS_FROM_REPORT_NOTE,
  AI_INSIGHTS_NEXT_STEP_LABEL,
  AiActivityHealthKind,
  AiActivityHealthNote,
  AiInsightBadge,
  AiInsightLook,
  AiInsightWordingContext,
  AiInsightsFixSegment,
  describeCoverage,
  describeFindingsTrust,
  describeFixVerification,
  describeHotspot,
  describeInsightFacts,
  describeInsightHeadline,
  describeNotInvestigatedReason,
  describeObject,
  describePreventiveInsight,
  describeProblemCount,
  describeProblemFixes,
  describeProblemVerdicts,
  describeResourceHotspot,
  describeSubjectShort,
  describeTimeOfDay,
  describeTrendDay,
  describeTrendWeeks,
  getActivityHealthNotes,
  getFixSegments,
  getFixTaskSegments,
  getInsightBadge,
  getInsightLook,
  getPreventiveSeverityColor,
  getProblemTitle,
  getRecurringBadge,
} from "./AiActivityInsightsData";
import {
  AiActivityCoverage,
  AiActivityFinding,
  AiActivityHotspot,
  AiActivityInsight,
  AiActivityInsightKind,
  AiActivityInsightTone,
  AiActivityInsights,
  AiActivityNamedResource,
  AiActivityObject,
  AiActivityPreventiveInsight,
  AiActivityProblem,
  AiActivityResourceHotspot,
  AiActivitySubject,
  AiActivityTrendDay,
} from "Common/Types/AI/AiActivityInsights";
import { InvestigationNotStartedCode } from "Common/Types/AI/InvestigationNotStartedReason";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Pill from "Common/UI/Components/Pill/Pill";
import StackedProgressBar from "Common/UI/Components/StackedProgressBar/StackedProgressBar";
import {
  TemplateValues,
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import PermissionGate from "Common/UI/Utils/PermissionGate";

/*
 * An AI Insights page's body (AiActivityInsightsPage loads it): what is
 * worth knowing about one scope, and — as a footnote — what OneUptime AI
 * did there in the window.
 *
 *   1. What OneUptime AI found: the insights, most important first. Each is
 *      one specific thing about the reader's system — the problem that keeps
 *      coming back with why and what to do, the part behind most of the
 *      trouble, a problem that stopped, what AI fixed on its own or would fix
 *      if allowed, the risks it spotted before anything paged — with the
 *      incidents and alerts behind it and one next step.
 *   2. Problems: everything that came up and was looked into, the most
 *      frequent first, each with what OneUptime AI found and suggests.
 *   3. Where problems happen (a cluster's or a resource's parts; the
 *      incidents' and alerts' monitors and services).
 *   4. Spotted before anything paged: the open preventive findings.
 *   5. What OneUptime AI did here: the numbers, the trend, how its fixes
 *      went, what it looked at, and what went wrong with its own work.
 *
 * Every sentence comes from AiActivityInsightsData; server text — titles,
 * names, an investigation's own words — is rendered as text. Nothing inside
 * a card is a box: sections are hairlines, the investigation's words a
 * quiet rule at their left.
 *
 * Scope-agnostic: a cluster's, a resource's and the incidents' and alerts'
 * Insights pages all render this, told only their noun and where their
 * Logs, AI agent and AI settings pages are, and — for a cluster — how to
 * link one of its parts to its own page.
 */

export interface ComponentProps {
  insights: AiActivityInsights;
  // The scope in sentences: "cluster", "Docker host".
  noun: string;
  // The scope's AI Logs page: everything AI did, newest first.
  logsRoute: Route;
  /*
   * The scope's AI agent page: where AI's access, and what it may fix, is
   * set up. A project's incidents and alerts have none: their commands ran
   * on many agents.
   */
  agentRoute?: Route | undefined;
  /*
   * Where what AI does on its own here is set: the incidents' or alerts'
   * AI → Settings.
   */
  settingsRoute?: Route | undefined;
  // A part of the scope's own page, when it has one (a cluster's node).
  getObjectRoute?: ((object: AiActivityObject) => Route | null) | undefined;
}

// Where an insight may send the reader.
export interface AiInsightsRoutes {
  logsRoute: Route;
  agentRoute?: Route | undefined;
  settingsRoute?: Route | undefined;
  // The incidents' or alerts' own page: whose AI settings a skip points at.
  subjectKind?: "incident" | "alert" | undefined;
  getObjectRoute?: ((object: AiActivityObject) => Route | null) | undefined;
}

export function getSubjectRoute(subject: AiActivitySubject): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[
      subject.kind === "incident" ? PageMap.INCIDENT_VIEW : PageMap.ALERT_VIEW
    ] as Route,
    { modelId: subject.id },
  );
}

export function getPreventiveInsightRoute(insightId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.AI_INSIGHT_VIEW] as Route,
    { modelId: insightId },
  );
}

export function getMonitorRoute(monitorId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.MONITOR_VIEW] as Route,
    { modelId: monitorId },
  );
}

export function getServiceRoute(serviceId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.SERVICE_VIEW] as Route,
    { modelId: serviceId },
  );
}

/*
 * The settings that decide why incidents (or alerts) were not investigated,
 * and whether the reader may change them - the same rule as the AI
 * Investigation card's "What you can do". Null for a reason no setting
 * fixes (a check that failed on its own).
 */
function getSkipAction(
  insight: AiActivityInsight,
  subjectKind: "incident" | "alert" | undefined,
): { action: SettingsAction; canAct: boolean } | null {
  if (insight.kind !== AiActivityInsightKind.NotInvestigated) {
    return null;
  }

  const action: SettingsAction | null = getSettingsAction(
    (insight.reason || "no_run_recorded") as InvestigationNotStartedCode,
    subjectKind === "alert" ? "alert" : "incident",
  );

  if (!action) {
    return null;
  }

  return {
    action,
    canAct: PermissionGate.holdsAnyOf(action.permissions),
  };
}

/*
 * Where a link sends the reader, and what it says: an English key, or a
 * template filled with `values` ("Open {{name}}").
 */
export interface AiInsightTarget {
  route: Route;
  label: string;
  values?: TemplateValues | undefined;
}

// The link to an incident or alert behind an insight.
function getOpenSubject(
  subject: AiActivitySubject | undefined,
): AiInsightTarget | null {
  return subject
    ? {
        route: getSubjectRoute(subject),
        label:
          subject.kind === "incident"
            ? translationKey("Open incident")
            : translationKey("Open alert"),
      }
    : null;
}

/*
 * An insight's one next step, and what its link says: the incident or alert
 * whose investigation found it, the part or service or monitor behind the
 * trouble, the fix waiting for a decision, the page that decides what AI may
 * fix on its own, the settings that stopped AI looking (for a reader who may
 * change them), the preventive finding, else the logs.
 */
export function getInsightTarget(
  insight: AiActivityInsight,
  routes: AiInsightsRoutes,
): AiInsightTarget | null {
  switch (insight.kind) {
    case AiActivityInsightKind.RecurringProblem:
    case AiActivityInsightKind.ProblemStopped:
    case AiActivityInsightKind.FixesDidNotHelp:
      return getOpenSubject(insight.subject);

    case AiActivityInsightKind.FixesAwaitingApproval:
      return insight.subject
        ? {
            route: getSubjectRoute(insight.subject),
            label: translationKey("Review the fix"),
          }
        : { route: routes.logsRoute, label: translationKey("Open AI Logs") };

    case AiActivityInsightKind.Hotspot: {
      if (insight.object && routes.getObjectRoute) {
        const route: Route | null = routes.getObjectRoute(insight.object);

        if (route) {
          return {
            route,
            label: translationKey("Open {{name}}"),
            values: {
              name: translatableTerm(insight.object.name, { inSentence: true }),
            },
          };
        }
      }

      if (insight.service) {
        return {
          route: getServiceRoute(insight.service.id),
          label: translationKey("Open service"),
        };
      }

      if (insight.monitor) {
        return {
          route: getMonitorRoute(insight.monitor.id),
          label: translationKey("Open monitor"),
        };
      }

      return getOpenSubject(insight.subject);
    }

    case AiActivityInsightKind.FixedAutomatically:
      return { route: routes.logsRoute, label: translationKey("Open AI Logs") };

    case AiActivityInsightKind.ReadyForAutomaticFixes:
      if (routes.agentRoute) {
        return {
          route: routes.agentRoute,
          label: translationKey("Choose what AI may fix on its own"),
        };
      }

      return routes.settingsRoute
        ? {
            route: routes.settingsRoute,
            label: translationKey("Choose what AI may fix on its own"),
          }
        : null;

    case AiActivityInsightKind.NotInvestigated: {
      const skip: { action: SettingsAction; canAct: boolean } | null =
        getSkipAction(insight, routes.subjectKind);

      return skip && skip.canAct
        ? {
            route: RouteUtil.populateRouteParams(
              RouteMap[skip.action.page] as Route,
            ),
            label: skip.action.label,
          }
        : null;
    }

    case AiActivityInsightKind.RiskSpotted:
      return insight.insightId
        ? {
            route: getPreventiveInsightRoute(insight.insightId),
            label: translationKey("Open insight"),
          }
        : null;

    default:
      return null;
  }
}

/*
 * Who can act, in place of a link the reader may not follow: a skip whose
 * settings only an owner or an admin may change.
 */
export function getInsightNote(
  insight: AiActivityInsight,
  routes: Pick<AiInsightsRoutes, "subjectKind">,
): string | null {
  const skip: { action: SettingsAction; canAct: boolean } | null =
    getSkipAction(insight, routes.subjectKind);

  return skip && !skip.canAct ? skip.action.whoCanAct : null;
}

const NEXT_STEP_CLASS_NAME: string =
  "inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-800";

const CHIP_CLASS_NAME: string =
  "inline-flex max-w-full items-center rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-700";

const LINKED_CHIP_CLASS_NAME: string =
  "inline-flex max-w-full items-center rounded bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 hover:bg-indigo-100";

const BADGE_CLASS_NAMES: Record<AiActivityInsightTone, string> = {
  [AiActivityInsightTone.Critical]: "bg-red-50 text-red-700",
  [AiActivityInsightTone.Warning]: "bg-amber-50 text-amber-700",
  [AiActivityInsightTone.Pattern]: "bg-indigo-50 text-indigo-700",
  [AiActivityInsightTone.Positive]: "bg-green-50 text-green-700",
};

function Badge(props: { badge: AiInsightBadge }): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        BADGE_CLASS_NAMES[props.badge.tone]
      }`}
      data-testid="ai-insights-badge"
    >
      {translator.translateText(props.badge.label)}
    </span>
  );
}

/*
 * What the investigation itself said: what it found, and the step it
 * suggests — its own words, under a quiet rule.
 */
function InvestigationWords(props: {
  finding?: AiActivityFinding | undefined;
  nextStep?: string | undefined;
}): ReactElement {
  const translator: Translator = useTranslator();

  if (!props.finding && !props.nextStep) {
    return <></>;
  }

  return (
    <dl
      className="mt-3 space-y-2 border-l-2 border-gray-200 pl-3"
      data-testid="ai-insights-investigation-words"
    >
      {props.finding ? (
        <div data-testid="ai-insights-finding">
          <dt className="text-xs font-medium text-gray-500">
            {translator.translateText(AI_INSIGHTS_FINDING_LABEL)}
          </dt>
          <dd className="mt-0.5 break-words text-sm text-gray-800">
            {props.finding.text}
            {props.finding.source === "report" ? (
              <span className="ml-1 text-xs text-gray-400">
                {translator.translateText(AI_INSIGHTS_FROM_REPORT_NOTE)}
              </span>
            ) : (
              <></>
            )}
          </dd>
        </div>
      ) : (
        <></>
      )}
      {props.nextStep ? (
        <div data-testid="ai-insights-next-step">
          <dt className="text-xs font-medium text-gray-500">
            {translator.translateText(AI_INSIGHTS_NEXT_STEP_LABEL)}
          </dt>
          <dd className="mt-0.5 break-words text-sm text-gray-800">
            {props.nextStep}
          </dd>
        </div>
      ) : (
        <></>
      )}
    </dl>
  );
}

// A part of the scope, linked to its own page when it has one.
function ObjectChip(props: {
  object: AiActivityObject;
  count?: number | undefined;
  getObjectRoute?: ((object: AiActivityObject) => Route | null) | undefined;
}): ReactElement {
  const route: Route | null = props.getObjectRoute
    ? props.getObjectRoute(props.object)
    : null;
  const text: string = `${describeObject(props.object)}${
    props.count && props.count > 1 ? ` ×${props.count}` : ""
  }`;

  return route ? (
    <Link to={route} className={`${LINKED_CHIP_CLASS_NAME} font-mono`}>
      <span className="truncate">{text}</span>
    </Link>
  ) : (
    <span className={CHIP_CLASS_NAME}>
      <span className="truncate">{text}</span>
    </span>
  );
}

// The monitors that raised a problem, each linked to its page.
function MonitorChips(props: {
  monitors: Array<AiActivityNamedResource>;
  testId: string;
}): ReactElement {
  if (props.monitors.length === 0) {
    return <></>;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1.5" data-testid={props.testId}>
      {props.monitors.map((monitor: AiActivityNamedResource): ReactElement => {
        return (
          <Link
            key={monitor.id}
            to={getMonitorRoute(monitor.id)}
            className={LINKED_CHIP_CLASS_NAME}
          >
            <span className="truncate">{monitor.name}</span>
          </Link>
        );
      })}
    </div>
  );
}

/*
 * The incidents and alerts behind an insight: the newest few, each linked,
 * and how many more there are.
 */
function Evidence(props: {
  evidence: Array<AiActivitySubject>;
  count: number;
}): ReactElement {
  const translator: Translator = useTranslator();

  if (props.evidence.length === 0) {
    return <></>;
  }

  const more: number = Math.max(props.count - props.evidence.length, 0);

  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500"
      data-testid="ai-insights-evidence"
    >
      <span>{translator.translateText("Behind it:")}</span>
      {props.evidence.map(
        (subject: AiActivitySubject, index: number): ReactElement => {
          return (
            <Fragment key={subject.id}>
              {index > 0 ? (
                <span aria-hidden="true" className="text-gray-300">
                  &middot;
                </span>
              ) : (
                <></>
              )}
              <Link
                to={getSubjectRoute(subject)}
                className="font-medium text-gray-700 hover:text-indigo-700 hover:underline"
              >
                {describeSubjectShort(subject)}
              </Link>
            </Fragment>
          );
        },
      )}
      {more > 0 ? (
        <span data-testid="ai-insights-evidence-more">
          {translator.translatePlural(
            { one: "and {{count}} more", other: "and {{count}} more" },
            more,
          )}
        </span>
      ) : (
        <></>
      )}
    </div>
  );
}

function InsightItem(props: {
  insight: AiActivityInsight;
  // The problem it is about, when it is about one.
  problem?: AiActivityProblem | undefined;
  context: AiInsightWordingContext;
  routes: AiInsightsRoutes;
}): ReactElement {
  const translator: Translator = useTranslator();
  const insight: AiActivityInsight = props.insight;
  const look: AiInsightLook = getInsightLook(insight);
  const badge: AiInsightBadge | null = getInsightBadge(insight, props.context);
  const target: AiInsightTarget | null = getInsightTarget(
    insight,
    props.routes,
  );
  const note: string | null = target
    ? null
    : getInsightNote(insight, props.routes);
  const objects: Array<AiActivityObject> = insight.objects || [];
  // What its fixes and its findings' readers said: a problem's own lines.
  const fixes: string | null =
    props.problem && insight.kind === AiActivityInsightKind.RecurringProblem
      ? describeProblemFixes(props.problem)
      : null;
  const verdicts: string | null =
    props.problem && insight.kind === AiActivityInsightKind.RecurringProblem
      ? describeProblemVerdicts(props.problem)
      : null;

  return (
    <li
      className="flex gap-4 py-5 first:pt-0 last:pb-0"
      data-testid="ai-insights-insight"
      data-kind={insight.kind}
      data-tone={insight.tone}
    >
      <div
        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${look.badgeClassName}`}
        role="img"
        aria-label={translator.translateText(look.label)}
        data-testid="ai-insights-insight-icon"
      >
        <Icon icon={look.icon} className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3
            className="break-words text-base font-semibold text-gray-900"
            data-testid="ai-insights-insight-headline"
          >
            {describeInsightHeadline(insight, props.context)}
          </h3>
          {badge ? <Badge badge={badge} /> : <></>}
        </div>

        <p
          className="mt-1 break-words text-sm text-gray-600"
          data-testid="ai-insights-insight-facts"
        >
          {describeInsightFacts(insight, props.context).join(" ")}
        </p>

        {insight.timeOfDay ? (
          <div
            className="mt-2 flex items-start gap-1.5 text-sm text-gray-600"
            data-testid="ai-insights-time-of-day"
          >
            <Icon
              icon={IconProp.Clock}
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
            />
            <span>
              {describeTimeOfDay(insight.timeOfDay, props.context.generatedAt)}
            </span>
          </div>
        ) : (
          <></>
        )}

        <InvestigationWords
          finding={insight.finding}
          nextStep={insight.nextStep}
        />

        {objects.length > 0 ? (
          <div
            className="mt-3 flex flex-wrap gap-1.5"
            data-testid="ai-insights-insight-objects"
          >
            {objects.map((object: AiActivityObject): ReactElement => {
              return (
                <ObjectChip
                  key={`${object.name}-${object.value}`}
                  object={object}
                  getObjectRoute={props.routes.getObjectRoute}
                />
              );
            })}
          </div>
        ) : (
          <></>
        )}

        <MonitorChips
          monitors={insight.monitors || []}
          testId="ai-insights-insight-monitors"
        />

        <Evidence
          evidence={insight.evidence || []}
          count={insight.evidenceCount || 0}
        />

        {fixes || verdicts ? (
          <div className="mt-1 space-y-0.5 text-xs text-gray-500">
            {fixes ? (
              <p data-testid="ai-insights-insight-fixes">{fixes}</p>
            ) : (
              <></>
            )}
            {verdicts ? (
              <p data-testid="ai-insights-insight-verdicts">{verdicts}</p>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}

        {target ? (
          <div className="mt-3" data-testid="ai-insights-next-step-link">
            <Link to={target.route} className={NEXT_STEP_CLASS_NAME}>
              <span>
                {target.values
                  ? translator.translateTemplate(target.label, target.values)
                  : translator.translateText(target.label)}
              </span>
              <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
            </Link>
          </div>
        ) : note ? (
          <p
            className="mt-3 text-xs text-gray-500"
            data-testid="ai-insights-who-can-act"
          >
            {translator.translateText(note)}
          </p>
        ) : (
          <></>
        )}
      </div>
    </li>
  );
}

function InsightsCard(props: {
  insights: AiActivityInsights;
  context: AiInsightWordingContext;
  routes: AiInsightsRoutes;
}): ReactElement {
  const translator: Translator = useTranslator();
  const items: Array<AiActivityInsight> = props.insights.insights;

  return (
    <Card
      title="What OneUptime AI found"
      description="The most important first, each with what is behind it and what to do next."
    >
      {items.length > 0 ? (
        <ul
          className="divide-y divide-gray-100"
          data-testid="ai-insights-insights"
        >
          {items.map(
            (insight: AiActivityInsight, index: number): ReactElement => {
              return (
                <InsightItem
                  key={`${insight.kind}-${insight.problemKey || ""}-${index}`}
                  insight={insight}
                  problem={props.insights.problems.find(
                    (problem: AiActivityProblem): boolean => {
                      return Boolean(
                        insight.problemKey &&
                          problem.key === insight.problemKey,
                      );
                    },
                  )}
                  context={props.context}
                  routes={props.routes}
                />
              );
            },
          )}
        </ul>
      ) : (
        <div
          className="flex items-start gap-3"
          data-testid="ai-insights-nothing-stands-out"
        >
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-green-50 text-green-600">
            <Icon icon={IconProp.CheckCircle} className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-base font-semibold text-gray-900">
              {translator.translateText("Nothing stands out right now")}
            </p>
            <p className="mt-1 text-sm text-gray-600">
              {translator.translateText(
                "No problem came back three times or more, no fix needs you, and no risk is waiting. What OneUptime AI looked into is below.",
              )}
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

function ProblemRow(props: {
  problem: AiActivityProblem;
  context: AiInsightWordingContext;
  getObjectRoute?: ((object: AiActivityObject) => Route | null) | undefined;
}): ReactElement {
  const problem: AiActivityProblem = props.problem;
  const fixes: string | null = describeProblemFixes(problem);
  const verdicts: string | null = describeProblemVerdicts(problem);
  const translator: Translator = useTranslator();
  /*
   * Only a problem that came back wears a badge: new this week, getting
   * worse, else recurring. One that came up once is just listed - a list of
   * them each saying "New" would say nothing.
   */
  const badge: AiInsightBadge | null = problem.isRecurring
    ? getRecurringBadge({
        firstSeenAt: problem.firstSeenAt,
        recentCount: problem.recentOccurrenceCount,
        previousCount: problem.previousOccurrenceCount,
        generatedAt: props.context.generatedAt,
      }) || {
        label: translationKey("Recurring"),
        tone: AiActivityInsightTone.Warning,
      }
    : null;

  return (
    <li
      className="py-4 first:pt-0 last:pb-0"
      data-testid="ai-insights-problem"
      data-problem-key={problem.key}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link
          to={getSubjectRoute(problem.latestSubject)}
          className="min-w-0 break-words text-sm font-semibold text-gray-900 hover:text-indigo-700 hover:underline"
        >
          {getProblemTitle(problem)}
        </Link>
        {badge ? <Badge badge={badge} /> : <></>}
      </div>
      <p
        className="mt-0.5 text-xs text-gray-500"
        data-testid="ai-insights-problem-count"
      >
        {describeProblemCount(problem)}
      </p>

      {problem.objects.length > 0 ? (
        <div
          className="mt-2 flex flex-wrap gap-1.5"
          data-testid="ai-insights-problem-objects"
        >
          {problem.objects.map(
            (object: AiActivityObject & { count: number }): ReactElement => {
              return (
                <ObjectChip
                  key={`${object.name}-${object.value}`}
                  object={object}
                  count={object.count}
                  getObjectRoute={props.getObjectRoute}
                />
              );
            },
          )}
        </div>
      ) : (
        <></>
      )}

      <MonitorChips
        monitors={problem.monitors || []}
        testId="ai-insights-problem-monitors"
      />

      {problem.timeOfDay ? (
        <p
          className="mt-2 text-xs text-gray-500"
          data-testid="ai-insights-problem-time-of-day"
        >
          {describeTimeOfDay(problem.timeOfDay, props.context.generatedAt)}
        </p>
      ) : (
        <></>
      )}

      {problem.latestFinding || problem.latestNextStep ? (
        <InvestigationWords
          finding={problem.latestFinding}
          nextStep={problem.latestNextStep}
        />
      ) : (
        <p
          className="mt-2 text-sm text-gray-500"
          data-testid="ai-insights-problem-no-finding"
        >
          {translator.translateText(
            "No finding recorded for this problem yet.",
          )}
        </p>
      )}

      {fixes || verdicts ? (
        <div className="mt-2 space-y-0.5 text-xs text-gray-500">
          {fixes ? (
            <p data-testid="ai-insights-problem-fixes">{fixes}</p>
          ) : (
            <></>
          )}
          {verdicts ? (
            <p data-testid="ai-insights-problem-verdicts">{verdicts}</p>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
    </li>
  );
}

/*
 * The problems the insights above do not already tell in full: every one,
 * when none is an insight of its own; the others, when some are; nothing,
 * when every problem is.
 */
export function getOtherProblems(
  insights: AiActivityInsights,
): Array<AiActivityProblem> {
  const told: Set<string> = new Set<string>(
    insights.insights
      .map((insight: AiActivityInsight): string => {
        return insight.problemKey || "";
      })
      .filter((key: string): boolean => {
        return Boolean(key);
      }),
  );

  return insights.problems.filter((problem: AiActivityProblem): boolean => {
    return !told.has(problem.key);
  });
}

function ProblemsCard(props: {
  insights: AiActivityInsights;
  problems: Array<AiActivityProblem>;
  context: AiInsightWordingContext;
  getObjectRoute?: ((object: AiActivityObject) => Route | null) | undefined;
}): ReactElement {
  const translator: Translator = useTranslator();
  const isTheRest: boolean =
    props.problems.length < props.insights.problems.length;

  return (
    <Card
      title={isTheRest ? "Other problems" : "Problems"}
      description={
        isTheRest
          ? "The rest of what OneUptime AI looked into here, the most frequent first, with what it found and suggests."
          : "Grouped by what raised them, the most frequent first, with what OneUptime AI found and suggests."
      }
    >
      {props.problems.length > 0 ? (
        <ul
          className="divide-y divide-gray-100"
          data-testid="ai-insights-problems"
        >
          {props.problems.map((problem: AiActivityProblem): ReactElement => {
            return (
              <ProblemRow
                key={problem.key}
                problem={problem}
                context={props.context}
                getObjectRoute={props.getObjectRoute}
              />
            );
          })}
        </ul>
      ) : (
        <p
          className="text-sm text-gray-500"
          data-testid="ai-insights-no-problems"
        >
          {translator.translateText(
            "No incident or alert here was investigated in the last 30 days.",
          )}
        </p>
      )}
    </Card>
  );
}

function HotspotsCard(props: {
  insights: AiActivityInsights;
  noun: string;
  getObjectRoute?: ((object: AiActivityObject) => Route | null) | undefined;
}): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <Card
      title="Where problems happen"
      description={translator.translateTemplate(
        "The parts of this {{noun}} that came up the most, and in how many different problems.",
        { noun: translatableTerm(props.noun, { inSentence: true }) },
      )}
    >
      <ul
        className="divide-y divide-gray-100"
        data-testid="ai-insights-hotspots"
      >
        {props.insights.hotspots.map(
          (hotspot: AiActivityHotspot): ReactElement => {
            return (
              <li
                key={`${hotspot.name}-${hotspot.value}`}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                data-testid="ai-insights-hotspot"
              >
                <ObjectChip
                  object={hotspot}
                  getObjectRoute={props.getObjectRoute}
                />
                <span className="text-xs text-gray-500">
                  {describeHotspot(hotspot)}
                </span>
              </li>
            );
          },
        )}
      </ul>
    </Card>
  );
}

/*
 * The monitors, or the services, that keep failing: the incidents' and
 * alerts' pages' hotspots, each linked to its own page.
 */
function ResourceHotspotsCard(props: {
  title: string;
  description: string;
  hotspots: Array<AiActivityResourceHotspot>;
  getRoute: (id: string) => Route;
  subjectKind: "incident" | "alert";
  testId: string;
  emptyMessage: string;
}): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <Card title={props.title} description={props.description}>
      {props.hotspots.length > 0 ? (
        <ul className="divide-y divide-gray-100" data-testid={props.testId}>
          {props.hotspots.map(
            (hotspot: AiActivityResourceHotspot): ReactElement => {
              return (
                <li
                  key={hotspot.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                  data-testid={`${props.testId}-item`}
                >
                  <Link
                    to={props.getRoute(hotspot.id)}
                    className="min-w-0 break-words text-sm font-medium text-gray-900 hover:text-indigo-700 hover:underline"
                  >
                    {hotspot.name}
                  </Link>
                  <span className="text-xs text-gray-500">
                    {describeResourceHotspot(hotspot, props.subjectKind)}
                  </span>
                </li>
              );
            },
          )}
        </ul>
      ) : (
        <p
          className="text-sm text-gray-500"
          data-testid={`${props.testId}-empty`}
        >
          {translator.translateText(props.emptyMessage)}
        </p>
      )}
    </Card>
  );
}

function MonitorsAndServicesCards(props: {
  insights: AiActivityInsights;
  subjectKind: "incident" | "alert";
}): ReactElement {
  const isIncident: boolean = props.subjectKind === "incident";

  return (
    <div className="grid gap-x-5 lg:grid-cols-2">
      <ResourceHotspotsCard
        title="Monitors that keep failing"
        description={
          isIncident
            ? "The monitors behind the most incidents in the last 30 days."
            : "The monitors behind the most alerts in the last 30 days."
        }
        hotspots={props.insights.monitors || []}
        getRoute={getMonitorRoute}
        subjectKind={props.subjectKind}
        testId="ai-insights-monitors"
        emptyMessage="No monitor came up more than once."
      />
      <ResourceHotspotsCard
        title="Services that keep failing"
        description={
          isIncident
            ? "The services affected by the most incidents in the last 30 days."
            : "The services affected by the most alerts in the last 30 days."
        }
        hotspots={props.insights.services || []}
        getRoute={getServiceRoute}
        subjectKind={props.subjectKind}
        testId="ai-insights-services"
        emptyMessage="No service came up more than once."
      />
    </div>
  );
}

/*
 * The open preventive findings the insights above do not already name:
 * every one, when none is an insight of its own; the others, when some are.
 */
export function getOtherPreventiveInsights(
  insights: AiActivityInsights,
): Array<AiActivityPreventiveInsight> {
  const told: Set<string> = new Set<string>(
    insights.insights
      .map((insight: AiActivityInsight): string => {
        return insight.insightId || "";
      })
      .filter((id: string): boolean => {
        return Boolean(id);
      }),
  );

  return insights.preventiveInsights.filter(
    (insight: AiActivityPreventiveInsight): boolean => {
      return !told.has(insight.id);
    },
  );
}

function PreventiveInsightsCard(props: {
  insights: AiActivityInsights;
  preventiveInsights: Array<AiActivityPreventiveInsight>;
  noun: string;
}): ReactElement {
  const translator: Translator = useTranslator();
  const isTheRest: boolean =
    props.preventiveInsights.length < props.insights.preventiveInsights.length;

  return (
    <Card
      title={
        isTheRest
          ? "Also spotted before anything paged"
          : "Spotted before anything paged"
      }
      description={translator.translateTemplate(
        "Open findings from OneUptime AI's watch on this {{noun}}'s own telemetry: spikes, slowdowns and drift, before they became an incident.",
        { noun: translatableTerm(props.noun, { inSentence: true }) },
      )}
    >
      <ul
        className="divide-y divide-gray-100"
        data-testid="ai-insights-preventive-list"
      >
        {props.preventiveInsights.map(
          (insight: AiActivityPreventiveInsight): ReactElement => {
            return (
              <li
                key={insight.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                data-testid="ai-insights-preventive"
              >
                <div className="flex min-w-0 items-center gap-2">
                  {insight.severity ? (
                    <Pill
                      text={insight.severity}
                      color={getPreventiveSeverityColor(insight.severity)}
                    />
                  ) : (
                    <></>
                  )}
                  <Link
                    to={getPreventiveInsightRoute(insight.id)}
                    className="break-words text-sm text-gray-900 hover:text-indigo-700 hover:underline"
                  >
                    {insight.title}
                  </Link>
                </div>
                <span className="text-xs text-gray-500">
                  {describePreventiveInsight(insight)}
                </span>
              </li>
            );
          },
        )}
      </ul>
    </Card>
  );
}

function Stat(props: {
  label: string;
  // A count, or text that stands in for one ("12 of 40", "—").
  value: number | string;
  detail?: string | undefined;
  testId: string;
}): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <div className="min-w-0" data-testid={props.testId}>
      <dt className="text-xs text-gray-500">
        {translator.translateText(props.label)}
      </dt>
      <dd className="mt-0.5 text-lg font-semibold text-gray-900">
        {typeof props.value === "number"
          ? translator.formatNumber(props.value)
          : props.value}
      </dd>
      {props.detail ? (
        <dd className="text-xs text-gray-500">{props.detail}</dd>
      ) : (
        <></>
      )}
    </div>
  );
}

function Trend(props: {
  trend: Array<AiActivityTrendDay>;
  fixesHidden?: boolean | undefined;
}): ReactElement {
  const translator: Translator = useTranslator();
  const peak: number = Math.max(
    1,
    ...props.trend.map((day: AiActivityTrendDay): number => {
      return day.investigations;
    }),
  );

  if (props.trend.length === 0) {
    return <></>;
  }

  return (
    <div data-testid="ai-insights-trend">
      <p className="text-xs text-gray-500">
        {translator.translateText("Investigations per day")}
      </p>
      <div
        className="mt-2 flex h-10 items-end gap-0.5"
        role="img"
        aria-label={describeTrendWeeks(props.trend)}
      >
        {props.trend.map((day: AiActivityTrendDay): ReactElement => {
          const height: number = (day.investigations / peak) * 100;
          const failedShare: number =
            day.investigations > 0
              ? (day.failedInvestigations / day.investigations) * 100
              : 0;

          return (
            <div
              key={day.date}
              className="flex h-full flex-1 flex-col justify-end"
              title={describeTrendDay(day, { fixesHidden: props.fixesHidden })}
              data-testid="ai-insights-trend-day"
              data-date={day.date}
              data-investigations={day.investigations}
            >
              {day.investigations > 0 ? (
                <div
                  className="flex w-full flex-col overflow-hidden rounded-sm bg-indigo-400"
                  style={{ height: `${Math.max(height, 6)}%` }}
                >
                  <div
                    className="w-full bg-red-400"
                    style={{ height: `${failedShare}%` }}
                  />
                </div>
              ) : (
                <div className="h-px w-full bg-gray-200" />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-xs text-gray-400">
        <span>{props.trend[0]!.date}</span>
        <span>{props.trend[props.trend.length - 1]!.date}</span>
      </div>
      <p
        className="mt-1 text-xs text-gray-500"
        data-testid="ai-insights-trend-weeks"
      >
        {describeTrendWeeks(props.trend)}
      </p>
    </div>
  );
}

function FixSegmentsBar(props: {
  segments: Array<AiInsightsFixSegment>;
  total: number;
}): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <StackedProgressBar
      segments={props.segments.map((segment: AiInsightsFixSegment) => {
        return {
          value: segment.value,
          color: segment.color,
          label: translator.translateText(segment.label) || segment.label,
        };
      })}
      totalValue={props.total}
    />
  );
}

// Where a note on AI's own work sends the reader.
function getHealthTarget(
  note: AiActivityHealthNote,
  routes: AiInsightsRoutes,
): AiInsightTarget {
  if (
    note.kind === AiActivityHealthKind.CommandsTimedOut &&
    routes.agentRoute
  ) {
    return {
      route: routes.agentRoute,
      label: translationKey("Open the AI agent page"),
    };
  }

  return { route: routes.logsRoute, label: translationKey("Open AI Logs") };
}

function SectionLabel(props: { text: string }): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
      {translator.translateText(props.text)}
    </p>
  );
}

/*
 * What the incidents' and alerts' pages looked at: how many of the window's
 * incidents AI investigated, and why it skipped the others. Also the empty
 * page's own card: with nothing investigated, the reasons matter most.
 */
export function CoverageSection(props: {
  coverage: AiActivityCoverage;
  subjectKind: "incident" | "alert";
  settingsRoute?: Route | undefined;
}): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <div data-testid="ai-insights-coverage">
      <p className="text-sm text-gray-700">
        {describeCoverage(props.coverage, props.subjectKind)}
      </p>
      {props.coverage.notInvestigated.length > 0 ? (
        <Fragment>
          <p className="mt-3 text-xs font-medium text-gray-500">
            {translator.translateText("Why the others were not investigated")}
          </p>
          <ul
            className="mt-1 divide-y divide-gray-100"
            data-testid="ai-insights-not-investigated"
          >
            {props.coverage.notInvestigated.map(
              (reason: {
                code: InvestigationNotStartedCode;
                count: number;
              }): ReactElement => {
                return (
                  <li
                    key={reason.code}
                    className="flex items-center justify-between gap-3 py-1.5 text-sm"
                    data-code={reason.code}
                  >
                    <span className="text-gray-600">
                      {describeNotInvestigatedReason(
                        props.subjectKind,
                        reason.code,
                      )}
                    </span>
                    <span className="font-medium text-gray-900">
                      {translator.formatNumber(reason.count)}
                    </span>
                  </li>
                );
              },
            )}
          </ul>
        </Fragment>
      ) : (
        <></>
      )}
      {props.settingsRoute ? (
        <p className="mt-3 text-sm">
          <Link
            to={props.settingsRoute}
            className="font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
          >
            {translator.translateText(
              "Choose what OneUptime AI does on its own in AI → Settings",
            )}
          </Link>
        </p>
      ) : (
        <></>
      )}
    </div>
  );
}

// The empty incidents' or alerts' page's card: what AI looked at, and why not more.
export function CoverageCard(props: {
  coverage: AiActivityCoverage;
  subjectKind: "incident" | "alert";
  settingsRoute?: Route | undefined;
}): ReactElement {
  return (
    <Card
      title="What OneUptime AI looked at"
      description={
        props.subjectKind === "incident"
          ? "The incidents created in the last 30 days, how many OneUptime AI investigated, and why it did not investigate the others."
          : "The alerts created in the last 30 days, how many OneUptime AI investigated, and why it did not investigate the others."
      }
    >
      <CoverageSection {...props} />
    </Card>
  );
}

/*
 * The page's footnote: what OneUptime AI did here in the window, how its
 * fixes went, what it looked at, and what went wrong with its own work.
 * Everything it did, one by one, is the AI Logs page.
 */
function ActivityCard(props: {
  insights: AiActivityInsights;
  routes: AiInsightsRoutes;
}): ReactElement {
  const translator: Translator = useTranslator();
  const insights: AiActivityInsights = props.insights;
  const totals: AiActivityInsights["totals"] = insights.totals;
  const coverage: AiActivityCoverage | undefined = insights.coverage;
  const subjectKind: "incident" | "alert" | undefined = insights.subjectKind;
  const notes: Array<AiActivityHealthNote> = getActivityHealthNotes(totals, {
    windowInDays: insights.windowInDays,
  });
  const trust: string | null = describeFindingsTrust(totals);
  const verification: string | null = describeFixVerification(
    insights.fixOutcomes,
  );
  const fixTaskOutcomes: AiActivityInsights["fixTaskOutcomes"] =
    insights.fixTaskOutcomes;
  const hasFixes: boolean =
    insights.fixOutcomes.total > 0 ||
    Boolean(insights.fixesHidden) ||
    (fixTaskOutcomes?.total || 0) > 0;

  return (
    <Card
      title="What OneUptime AI did here"
      description="The last 30 days at a glance. Everything it did, one step at a time, is in AI Logs."
    >
      <div
        className="divide-y divide-gray-100"
        data-testid="ai-insights-activity"
      >
        <div className="pb-4">
          <dl
            className="grid grid-cols-2 gap-x-8 gap-y-3 sm:flex sm:flex-wrap"
            data-testid="ai-insights-summary"
          >
            <Stat
              label="Investigations"
              value={totals.investigations}
              detail={
                totals.failedInvestigations > 0
                  ? translator.translateTemplate(
                      "{{count}} failed or timed out",
                      { count: totals.failedInvestigations },
                    )
                  : undefined
              }
              testId="ai-insights-stat-investigations"
            />
            {coverage && subjectKind ? (
              <Stat
                label={
                  subjectKind === "incident"
                    ? "Incidents investigated"
                    : "Alerts investigated"
                }
                value={translator.translateTemplate("{{count}} of {{total}}", {
                  count: coverage.investigatedSubjects,
                  total: coverage.subjects,
                })}
                detail={translator.translateText("Created in the last 30 days")}
                testId="ai-insights-stat-coverage"
              />
            ) : (
              <></>
            )}
            {insights.fixesHidden ? (
              <Stat
                label="Fixes"
                value="—"
                detail={translator.translateText("Not shown to your role")}
                testId="ai-insights-stat-fixes"
              />
            ) : (
              <Stat
                label="Fixes"
                value={totals.fixes}
                detail={
                  insights.fixOutcomes.verified > 0
                    ? translator.translateTemplate("{{count}} verified", {
                        count: insights.fixOutcomes.verified,
                      })
                    : undefined
                }
                testId="ai-insights-stat-fixes"
              />
            )}
            <Stat
              label="Commands"
              value={totals.commands}
              detail={
                totals.failedCommands + totals.timedOutCommands > 0
                  ? translator.translateTemplate(
                      "{{failed}} failed, {{timedOut}} never ran",
                      {
                        failed: totals.failedCommands,
                        timedOut: totals.timedOutCommands,
                      },
                    )
                  : undefined
              }
              testId="ai-insights-stat-commands"
            />
          </dl>
        </div>

        {notes.length > 0 || trust ? (
          <div className="py-4" data-testid="ai-insights-health">
            <ul className="space-y-2">
              {notes.map((note: AiActivityHealthNote): ReactElement => {
                const target: AiInsightTarget = getHealthTarget(
                  note,
                  props.routes,
                );

                return (
                  <li
                    key={note.kind}
                    className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 text-sm"
                    data-testid="ai-insights-health-note"
                    data-kind={note.kind}
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      <Icon
                        icon={IconProp.Alert}
                        className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
                      />
                      <span className="break-words text-gray-700">
                        {note.sentence}
                      </span>
                    </div>
                    <Link
                      to={target.route}
                      className="whitespace-nowrap text-sm font-medium text-indigo-600 hover:text-indigo-800"
                    >
                      {translator.translateText(target.label)}
                    </Link>
                  </li>
                );
              })}
              {trust ? (
                <li
                  className="flex min-w-0 items-start gap-2 text-sm"
                  data-testid="ai-insights-trust"
                >
                  <Icon
                    icon={IconProp.CheckCircle}
                    className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600"
                  />
                  <span className="break-words text-gray-700">{trust}</span>
                </li>
              ) : (
                <></>
              )}
            </ul>
          </div>
        ) : (
          <></>
        )}

        <div className="py-4">
          <Trend trend={insights.trend} fixesHidden={insights.fixesHidden} />
        </div>

        {hasFixes ? (
          <div className="py-4" data-testid="ai-insights-fixes">
            <SectionLabel text={translationKey("Fixes")} />
            {insights.fixesHidden ? (
              <p
                className="text-sm text-gray-500"
                data-testid="ai-insights-fixes-hidden"
              >
                {translator.translateText(AI_INSIGHTS_FIXES_HIDDEN_NOTE)}
              </p>
            ) : (
              <Fragment>
                {insights.fixOutcomes.total > 0 ? (
                  <FixSegmentsBar
                    segments={getFixSegments(insights.fixOutcomes)}
                    total={insights.fixOutcomes.total}
                  />
                ) : (
                  <></>
                )}
                {verification ? (
                  <p
                    className="mt-3 text-sm text-gray-600"
                    data-testid="ai-insights-fix-verification"
                  >
                    {verification}
                  </p>
                ) : (
                  <></>
                )}
              </Fragment>
            )}
            {fixTaskOutcomes && fixTaskOutcomes.total > 0 ? (
              <div className="mt-4" data-testid="ai-insights-fix-tasks">
                <p className="mb-2 text-xs font-medium text-gray-500">
                  {translator.translateText("Fix pull requests")}
                </p>
                <FixSegmentsBar
                  segments={getFixTaskSegments(fixTaskOutcomes)}
                  total={fixTaskOutcomes.total}
                />
              </div>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}

        {coverage && subjectKind ? (
          <div className="py-4">
            <SectionLabel text={translationKey("What it looked at")} />
            <CoverageSection
              coverage={coverage}
              subjectKind={subjectKind}
              settingsRoute={props.routes.settingsRoute}
            />
          </div>
        ) : (
          <></>
        )}

        {insights.isPartial ? (
          <p
            className="pt-4 text-xs text-gray-500"
            data-testid="ai-insights-partial"
          >
            {translator.translateText(
              "There was more here than these insights read: they cover the newest of it.",
            )}
          </p>
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
}

const AiActivityInsightsView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const subjectKind: "incident" | "alert" | undefined =
    props.insights.subjectKind;
  // A scope that names its monitors and services shows those, not parts.
  const hasResourceHotspots: boolean = Boolean(
    subjectKind && (props.insights.monitors || props.insights.services),
  );

  const context: AiInsightWordingContext = {
    windowInDays: props.insights.windowInDays,
    subjectKind,
    noun: props.noun,
    generatedAt: props.insights.generatedAt || undefined,
  };

  const routes: AiInsightsRoutes = {
    logsRoute: props.logsRoute,
    agentRoute: props.agentRoute,
    settingsRoute: props.settingsRoute,
    subjectKind,
    getObjectRoute: props.getObjectRoute,
  };

  const otherProblems: Array<AiActivityProblem> = getOtherProblems(
    props.insights,
  );
  const otherPreventiveInsights: Array<AiActivityPreventiveInsight> =
    getOtherPreventiveInsights(props.insights);

  return (
    <Fragment>
      <InsightsCard
        insights={props.insights}
        context={context}
        routes={routes}
      />
      {otherProblems.length > 0 || props.insights.problems.length === 0 ? (
        <ProblemsCard
          insights={props.insights}
          problems={otherProblems}
          context={context}
          getObjectRoute={props.getObjectRoute}
        />
      ) : (
        <></>
      )}
      {hasResourceHotspots && subjectKind ? (
        <MonitorsAndServicesCards
          insights={props.insights}
          subjectKind={subjectKind}
        />
      ) : props.insights.hotspots.length > 0 ? (
        <HotspotsCard
          insights={props.insights}
          noun={props.noun}
          getObjectRoute={props.getObjectRoute}
        />
      ) : (
        <></>
      )}
      {otherPreventiveInsights.length > 0 ? (
        <PreventiveInsightsCard
          insights={props.insights}
          preventiveInsights={otherPreventiveInsights}
          noun={props.noun}
        />
      ) : (
        <></>
      )}
      <ActivityCard insights={props.insights} routes={routes} />
    </Fragment>
  );
};

export default AiActivityInsightsView;
