import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { SettingsAction, getSettingsAction } from "../InvestigationNotStarted";
import {
  AI_INSIGHTS_FIXES_HIDDEN_NOTE,
  AiInsightsFixSegment,
  AiInsightsLook,
  describeAttentionDetail,
  describeAttentionItem,
  describeCoverage,
  describeFixVerification,
  describeHotspot,
  describeNotInvestigatedReason,
  describeObject,
  describePreventiveInsight,
  describeProblemCount,
  describeProblemFixes,
  describeProblemVerdicts,
  describeResourceHotspot,
  describeTrendDay,
  describeTrendWeeks,
  getAttentionLook,
  getFixSegments,
  getFixTaskSegments,
  getPreventiveSeverityColor,
  getProblemTitle,
} from "./AiActivityInsightsData";
import {
  AiActivityAttentionItem,
  AiActivityAttentionKind,
  AiActivityCoverage,
  AiActivityHotspot,
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
import { Yellow500 } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import { PermissionHelper } from "Common/Types/Permission";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Pill from "Common/UI/Components/Pill/Pill";
import StackedProgressBar from "Common/UI/Components/StackedProgressBar/StackedProgressBar";
import PermissionUtil from "Common/UI/Utils/Permission";
import {
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * An AI Insights page's body (AiActivityInsightsPage loads it): what
 * OneUptime AI learned on one scope in the window, and what deserves
 * attention — the attention list, the window at a glance with its trend,
 * the problems AI investigated grouped by what raised them, the hotspots,
 * how fixes turned out and the open preventive insights. Every sentence
 * comes from AiActivityInsightsData; server text is rendered as text.
 *
 * Scope-agnostic: a cluster's, a resource's and the incidents' and alerts'
 * Insights pages all render this, told only their noun and where their
 * Logs, AI agent and AI settings pages are. The sections only the incidents'
 * and alerts' insights have are drawn when the insights have them: how many
 * of the window's incidents AI looked at (in the summary, and why it skipped
 * the rest), the monitors and services that keep failing (in place of a
 * scope's part hotspots), the fix pull requests, and a note instead of fix
 * numbers for a reader who may not see them.
 */

export interface ComponentProps {
  insights: AiActivityInsights;
  // The scope in sentences: "cluster", "Docker host".
  noun: string;
  // The scope's AI Logs page: everything AI did, newest first.
  logsRoute: Route;
  /*
   * The scope's AI agent page: where AI's access is set up. A project's
   * incidents and alerts have none: their commands ran on many agents.
   */
  agentRoute?: Route | undefined;
  /*
   * Where what AI does on its own here is set: the incidents' or alerts'
   * AI → Settings.
   */
  settingsRoute?: Route | undefined;
}

// What each card of the page needs, and nothing more.
interface InsightsProps {
  insights: AiActivityInsights;
}

interface NounProps extends InsightsProps {
  noun: string;
}

interface AttentionProps extends InsightsProps {
  logsRoute: Route;
  agentRoute?: Route | undefined;
}

// Where an attention item may send the reader.
export interface AttentionRoutes {
  logsRoute: Route;
  agentRoute?: Route | undefined;
  // The incidents' or alerts' own page: whose AI settings a skip points at.
  subjectKind?: "incident" | "alert" | undefined;
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
  item: AiActivityAttentionItem,
  subjectKind: "incident" | "alert" | undefined,
): { action: SettingsAction; canAct: boolean } | null {
  if (item.kind !== AiActivityAttentionKind.InvestigationsNotStarted) {
    return null;
  }

  const action: SettingsAction | null = getSettingsAction(
    (item.reason || "no_run_recorded") as InvestigationNotStartedCode,
    subjectKind === "alert" ? "alert" : "incident",
  );

  if (!action) {
    return null;
  }

  return {
    action,
    canAct: PermissionHelper.doesPermissionsIntersect(
      action.permissions,
      PermissionUtil.getAllPermissions(),
    ),
  };
}

const LINK_CLASS_NAME: string =
  "whitespace-nowrap text-sm font-medium text-indigo-600 hover:text-indigo-800";

/*
 * Where an attention item sends the reader, and what the link says: the
 * incident or alert to act on, the insight, the monitor, the settings that
 * stopped AI investigating (for a reader who may change them), the AI agent
 * page for commands the agent never ran, else the logs. A hotspot has
 * nowhere to go.
 */
export function getAttentionTarget(
  item: AiActivityAttentionItem,
  routes: AttentionRoutes,
): { route: Route; label: string } | null {
  if (item.kind === AiActivityAttentionKind.PreventiveInsight) {
    return item.insightId
      ? {
          route: getPreventiveInsightRoute(item.insightId),
          label: translationKey("Open insight"),
        }
      : null;
  }

  if (item.subject) {
    return {
      route: getSubjectRoute(item.subject),
      label:
        item.subject.kind === "incident"
          ? translationKey("Open incident")
          : translationKey("Open alert"),
    };
  }

  if (item.kind === AiActivityAttentionKind.InvestigationsNotStarted) {
    const skip: { action: SettingsAction; canAct: boolean } | null =
      getSkipAction(item, routes.subjectKind);

    return skip && skip.canAct
      ? {
          route: RouteUtil.populateRouteParams(
            RouteMap[skip.action.page] as Route,
          ),
          label: skip.action.label,
        }
      : null;
  }

  if (item.kind === AiActivityAttentionKind.MonitorHotspot) {
    return item.monitor
      ? {
          route: getMonitorRoute(item.monitor.id),
          label: translationKey("Open monitor"),
        }
      : null;
  }

  if (
    item.kind === AiActivityAttentionKind.CommandsTimedOut &&
    routes.agentRoute
  ) {
    return {
      route: routes.agentRoute,
      label: translationKey("Open the AI agent page"),
    };
  }

  if (item.kind === AiActivityAttentionKind.Hotspot) {
    return null;
  }

  return { route: routes.logsRoute, label: translationKey("Open AI Logs") };
}

/*
 * Who can act, in place of a link the reader may not follow: a skip whose
 * settings only an owner or an admin may change.
 */
export function getAttentionNote(
  item: AiActivityAttentionItem,
  routes: Pick<AttentionRoutes, "subjectKind">,
): string | null {
  const skip: { action: SettingsAction; canAct: boolean } | null =
    getSkipAction(item, routes.subjectKind);

  return skip && !skip.canAct ? skip.action.whoCanAct : null;
}

function AttentionCard(props: AttentionProps): ReactElement {
  const translator: Translator = useTranslator();
  const items: Array<AiActivityAttentionItem> = props.insights.attention;
  const routes: AttentionRoutes = {
    logsRoute: props.logsRoute,
    agentRoute: props.agentRoute,
    subjectKind: props.insights.subjectKind,
  };

  return (
    <Card
      title="Needs attention"
      description="What OneUptime AI's work here says deserves a look, most important first."
    >
      {items.length > 0 ? (
        <ul
          className="divide-y divide-gray-100"
          data-testid="ai-insights-attention"
        >
          {items.map((item: AiActivityAttentionItem, index: number) => {
            const look: AiInsightsLook = getAttentionLook(item.severity);
            const target: { route: Route; label: string } | null =
              getAttentionTarget(item, routes);
            const note: string | null = target
              ? null
              : getAttentionNote(item, routes);
            const detail: string | null = describeAttentionDetail(item, {
              subjectKind: props.insights.subjectKind,
            });

            return (
              <li
                key={`${item.kind}-${index}`}
                className="flex flex-wrap items-start justify-between gap-3 py-3"
                data-testid="ai-insights-attention-item"
                data-kind={item.kind}
                data-severity={item.severity}
              >
                <div className="flex min-w-0 items-start gap-2">
                  <Icon
                    icon={look.icon}
                    color={look.color}
                    className="mt-0.5 h-4 w-4 flex-shrink-0"
                    ariaLabel={translator.translateText(look.label)}
                  />
                  <div className="min-w-0">
                    <p className="break-words text-sm text-gray-800">
                      {describeAttentionItem(item, {
                        windowInDays: props.insights.windowInDays,
                        subjectKind: props.insights.subjectKind,
                      })}
                    </p>
                    {detail ? (
                      <p
                        className="mt-0.5 break-words text-sm text-gray-500"
                        data-testid="ai-insights-attention-detail"
                      >
                        {detail}
                      </p>
                    ) : (
                      <></>
                    )}
                  </div>
                </div>
                {target ? (
                  <Link to={target.route} className={LINK_CLASS_NAME}>
                    {translator.translateText(target.label)}
                  </Link>
                ) : note ? (
                  <p
                    className="max-w-xs text-xs text-gray-500"
                    data-testid="ai-insights-attention-who-can-act"
                  >
                    {translator.translateText(note)}
                  </p>
                ) : (
                  <></>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div
          className="flex items-center gap-2 text-sm text-gray-600"
          data-testid="ai-insights-nothing-needs-attention"
        >
          <Icon
            icon={IconProp.CheckCircle}
            className="h-4 w-4 flex-shrink-0 text-green-600"
          />
          <p>
            {translator.translateText(
              "Nothing here needs your attention right now.",
            )}
          </p>
        </div>
      )}
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
    <div
      className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3"
      data-testid={props.testId}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {translator.translateText(props.label)}
      </p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">
        {typeof props.value === "number"
          ? translator.formatNumber(props.value)
          : props.value}
      </p>
      {props.detail ? (
        <p className="mt-0.5 text-xs text-gray-500">{props.detail}</p>
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
    <div className="mt-5" data-testid="ai-insights-trend">
      <p className="text-sm font-medium text-gray-700">
        {translator.translateText("Investigations per day")}
      </p>
      <div
        className="mt-2 flex h-16 items-end gap-0.5"
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
        className="mt-2 text-sm text-gray-600"
        data-testid="ai-insights-trend-weeks"
      >
        {describeTrendWeeks(props.trend)}
      </p>
    </div>
  );
}

function SummaryCard(props: InsightsProps): ReactElement {
  const translator: Translator = useTranslator();
  const totals: AiActivityInsights["totals"] = props.insights.totals;
  const coverage: AiActivityCoverage | undefined = props.insights.coverage;
  const subjectKind: "incident" | "alert" | undefined =
    props.insights.subjectKind;

  return (
    <Card
      title="Last 30 days"
      description="How much OneUptime AI did here, and how it went."
    >
      <div data-testid="ai-insights-summary">
        <div
          className={`grid grid-cols-2 gap-3 ${
            coverage && subjectKind ? "lg:grid-cols-5" : "lg:grid-cols-4"
          }`}
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
          <Stat
            label="Problems"
            value={totals.problems}
            detail={
              totals.recurringProblems > 0
                ? translator.translateTemplate("{{count}} recurring", {
                    count: totals.recurringProblems,
                  })
                : undefined
            }
            testId="ai-insights-stat-problems"
          />
          {props.insights.fixesHidden ? (
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
                props.insights.fixOutcomes.verified > 0
                  ? translator.translateTemplate("{{count}} verified", {
                      count: props.insights.fixOutcomes.verified,
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
        </div>
        <Trend
          trend={props.insights.trend}
          fixesHidden={props.insights.fixesHidden}
        />
      </div>
    </Card>
  );
}

function ProblemRow(props: {
  problem: AiActivityProblem;
  subjectKind?: "incident" | "alert" | undefined;
}): ReactElement {
  const translator: Translator = useTranslator();
  const problem: AiActivityProblem = props.problem;
  const fixes: string | null = describeProblemFixes(problem);
  const verdicts: string | null = describeProblemVerdicts(problem);
  const monitors: Array<AiActivityNamedResource> = problem.monitors || [];

  return (
    <li
      className="py-4"
      data-testid="ai-insights-problem"
      data-problem-key={problem.key}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            to={getSubjectRoute(problem.latestSubject)}
            className="break-words text-sm font-semibold text-gray-900 hover:text-indigo-700 hover:underline"
          >
            {getProblemTitle(problem)}
          </Link>
          <p className="mt-0.5 text-xs text-gray-500">
            {describeProblemCount(problem, props.subjectKind)}
          </p>
        </div>
        {problem.isRecurring ? (
          <span data-testid="ai-insights-recurring">
            <Pill text="Recurring" color={Yellow500} />
          </span>
        ) : (
          <></>
        )}
      </div>

      {monitors.length > 0 ? (
        <div
          className="mt-2 flex flex-wrap gap-1.5"
          data-testid="ai-insights-problem-monitors"
        >
          {monitors.map((monitor: AiActivityNamedResource): ReactElement => {
            return (
              <Link
                key={monitor.id}
                to={getMonitorRoute(monitor.id)}
                className="inline-flex items-center gap-1 rounded bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 hover:bg-indigo-100"
              >
                {monitor.name}
              </Link>
            );
          })}
        </div>
      ) : (
        <></>
      )}

      {problem.objects.length > 0 ? (
        <div
          className="mt-2 flex flex-wrap gap-1.5"
          data-testid="ai-insights-problem-objects"
        >
          {problem.objects.map(
            (object: AiActivityObject & { count: number }): ReactElement => {
              return (
                <span
                  key={`${object.name}-${object.value}`}
                  className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-700"
                >
                  {describeObject(object)}
                  {object.count > 1 ? ` ×${object.count}` : ""}
                </span>
              );
            },
          )}
        </div>
      ) : (
        <></>
      )}

      <div className="mt-2 text-sm" data-testid="ai-insights-problem-finding">
        {problem.latestFinding ? (
          <p className="break-words text-gray-700">
            <span className="font-medium text-gray-900">
              {translator.translateText("Latest finding:")}
            </span>{" "}
            {problem.latestFinding.text}
            {problem.latestFinding.source === "report" ? (
              <span className="ml-1 text-xs text-gray-400">
                {translator.translateText("(from the investigation's report)")}
              </span>
            ) : (
              <></>
            )}
          </p>
        ) : (
          <p className="text-gray-500">
            {translator.translateText(
              "No finding recorded for this problem yet.",
            )}
          </p>
        )}
      </div>

      {fixes || verdicts ? (
        <div className="mt-1 space-y-0.5 text-xs text-gray-500">
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

function ProblemsCard(props: InsightsProps): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <Card
      title="Problems OneUptime AI investigated"
      description="Grouped by what raised them, the most investigated first, with what the latest investigation found."
    >
      {props.insights.problems.length > 0 ? (
        <ul className="divide-y divide-gray-100">
          {props.insights.problems.map(
            (problem: AiActivityProblem): ReactElement => {
              return (
                <ProblemRow
                  key={problem.key}
                  problem={problem}
                  subjectKind={props.insights.subjectKind}
                />
              );
            },
          )}
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

function HotspotsCard(props: NounProps): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <Card
      title="Hotspots"
      description={translator.translateTemplate(
        "The parts of this {{noun}} that keep showing up in what OneUptime AI investigated.",
        { noun: translatableTerm(props.noun, { inSentence: true }) },
      )}
    >
      {props.insights.hotspots.length > 0 ? (
        <ul className="divide-y divide-gray-100">
          {props.insights.hotspots.map(
            (hotspot: AiActivityHotspot): ReactElement => {
              return (
                <li
                  key={`${hotspot.name}-${hotspot.value}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                  data-testid="ai-insights-hotspot"
                >
                  <span className="break-all font-mono text-sm text-gray-800">
                    {describeObject(hotspot)}
                  </span>
                  <span className="text-xs text-gray-500">
                    {describeHotspot(hotspot)}
                  </span>
                </li>
              );
            },
          )}
        </ul>
      ) : (
        <p
          className="text-sm text-gray-500"
          data-testid="ai-insights-no-hotspots"
        >
          {translator.translateText(
            "Nothing has shown up in more than one investigation yet.",
          )}
        </p>
      )}
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
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
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
            ? "The monitors behind the most incidents OneUptime AI investigated."
            : "The monitors behind the most alerts OneUptime AI investigated."
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
            ? "The services affected by the most incidents OneUptime AI investigated."
            : "The services affected by the most alerts OneUptime AI investigated."
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

function FixesCard(props: InsightsProps): ReactElement {
  const translator: Translator = useTranslator();
  const verification: string | null = describeFixVerification(
    props.insights.fixOutcomes,
  );
  const fixTaskOutcomes: AiActivityInsights["fixTaskOutcomes"] =
    props.insights.fixTaskOutcomes;

  return (
    <Card
      title="Fixes"
      description="Where the fixes OneUptime AI proposed here ended up, and whether they resolved the problem."
    >
      <div data-testid="ai-insights-fixes">
        {props.insights.fixesHidden ? (
          <p
            className="text-sm text-gray-500"
            data-testid="ai-insights-fixes-hidden"
          >
            {translator.translateText(AI_INSIGHTS_FIXES_HIDDEN_NOTE)}
          </p>
        ) : (
          <Fragment>
            <FixSegmentsBar
              segments={getFixSegments(props.insights.fixOutcomes)}
              total={props.insights.fixOutcomes.total}
            />
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
          <div className="mt-5" data-testid="ai-insights-fix-tasks">
            <p className="mb-2 text-sm font-medium text-gray-700">
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
    </Card>
  );
}

/*
 * What the incidents' and alerts' pages looked at: how many of the window's
 * incidents AI investigated, and why it skipped the others. Also the empty
 * page's card: with nothing investigated, the reasons matter most.
 */
export function CoverageCard(props: {
  coverage: AiActivityCoverage;
  subjectKind: "incident" | "alert";
  settingsRoute?: Route | undefined;
}): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <Card
      title="What OneUptime AI looked at"
      description={
        props.subjectKind === "incident"
          ? "The incidents created in the last 30 days, how many OneUptime AI investigated, and why it did not investigate the others."
          : "The alerts created in the last 30 days, how many OneUptime AI investigated, and why it did not investigate the others."
      }
    >
      <div data-testid="ai-insights-coverage">
        <p className="text-sm text-gray-700">
          {describeCoverage(props.coverage, props.subjectKind)}
        </p>
        {props.coverage.notInvestigated.length > 0 ? (
          <Fragment>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">
              {translator.translateText("Why the others were not investigated")}
            </p>
            <ul
              className="mt-2 divide-y divide-gray-100"
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
    </Card>
  );
}

function PreventiveInsightsCard(props: NounProps): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <Card
      title="Preventive insights"
      description={translator.translateTemplate(
        "Open findings OneUptime AI's detectors filed against this {{noun}}'s own telemetry, before anything paged.",
        { noun: translatableTerm(props.noun, { inSentence: true }) },
      )}
    >
      <ul className="divide-y divide-gray-100">
        {props.insights.preventiveInsights.map(
          (insight: AiActivityPreventiveInsight): ReactElement => {
            return (
              <li
                key={insight.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5"
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

const AiActivityInsightsView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const subjectKind: "incident" | "alert" | undefined =
    props.insights.subjectKind;
  // A scope that names its monitors and services shows those, not parts.
  const hasResourceHotspots: boolean = Boolean(
    subjectKind && (props.insights.monitors || props.insights.services),
  );

  return (
    <Fragment>
      <AttentionCard
        insights={props.insights}
        logsRoute={props.logsRoute}
        agentRoute={props.agentRoute}
      />
      <SummaryCard insights={props.insights} />
      <ProblemsCard insights={props.insights} />
      {hasResourceHotspots && subjectKind ? (
        <MonitorsAndServicesCards
          insights={props.insights}
          subjectKind={subjectKind}
        />
      ) : (
        <HotspotsCard insights={props.insights} noun={props.noun} />
      )}
      {props.insights.fixOutcomes.total > 0 ||
      props.insights.fixesHidden ||
      (props.insights.fixTaskOutcomes?.total || 0) > 0 ? (
        <FixesCard insights={props.insights} />
      ) : (
        <></>
      )}
      {props.insights.coverage && subjectKind ? (
        <CoverageCard
          coverage={props.insights.coverage}
          subjectKind={subjectKind}
          settingsRoute={props.settingsRoute}
        />
      ) : (
        <></>
      )}
      {props.insights.preventiveInsights.length > 0 ? (
        <PreventiveInsightsCard insights={props.insights} noun={props.noun} />
      ) : (
        <></>
      )}
      {props.insights.isPartial ? (
        <p
          className="mb-5 text-xs text-gray-500"
          data-testid="ai-insights-partial"
        >
          {translator.translateText(
            "There was more AI activity here than these insights read: they cover the newest of it.",
          )}
        </p>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default AiActivityInsightsView;
