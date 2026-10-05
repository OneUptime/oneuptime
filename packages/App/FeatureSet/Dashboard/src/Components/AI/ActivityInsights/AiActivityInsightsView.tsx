import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  AiInsightsFixSegment,
  AiInsightsLook,
  describeAttentionItem,
  describeFixVerification,
  describeHotspot,
  describeObject,
  describePreventiveInsight,
  describeProblemCount,
  describeProblemFixes,
  describeProblemVerdicts,
  describeTrendDay,
  describeTrendWeeks,
  getAttentionLook,
  getFixSegments,
  getPreventiveSeverityColor,
  getProblemTitle,
} from "./AiActivityInsightsData";
import {
  AiActivityAttentionItem,
  AiActivityAttentionKind,
  AiActivityHotspot,
  AiActivityInsights,
  AiActivityObject,
  AiActivityPreventiveInsight,
  AiActivityProblem,
  AiActivitySubject,
  AiActivityTrendDay,
} from "Common/Types/AI/AiActivityInsights";
import Route from "Common/Types/API/Route";
import { Yellow500 } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Pill from "Common/UI/Components/Pill/Pill";
import StackedProgressBar from "Common/UI/Components/StackedProgressBar/StackedProgressBar";
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
 * Scope-agnostic: a cluster's, a resource's and (later) the incidents' or
 * alerts' Insights pages all render this, told only their noun and where
 * their Logs and AI agent pages are.
 */

export interface ComponentProps {
  insights: AiActivityInsights;
  // The scope in sentences: "cluster", "Docker host".
  noun: string;
  // The scope's AI Logs page: everything AI did, newest first.
  logsRoute: Route;
  // The scope's AI agent page: where AI's access is set up.
  agentRoute: Route;
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
  agentRoute: Route;
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

const LINK_CLASS_NAME: string =
  "whitespace-nowrap text-sm font-medium text-indigo-600 hover:text-indigo-800";

/*
 * Where an attention item sends the reader, and what the link says: the
 * incident or alert to act on, the insight, the AI agent page for commands
 * the agent never ran, else the logs. A hotspot has nowhere to go.
 */
export function getAttentionTarget(
  item: AiActivityAttentionItem,
  routes: { logsRoute: Route; agentRoute: Route },
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

  if (item.kind === AiActivityAttentionKind.CommandsTimedOut) {
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

function AttentionCard(props: AttentionProps): ReactElement {
  const translator: Translator = useTranslator();
  const items: Array<AiActivityAttentionItem> = props.insights.attention;
  const routes: { logsRoute: Route; agentRoute: Route } = {
    logsRoute: props.logsRoute,
    agentRoute: props.agentRoute,
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
                  <p className="break-words text-sm text-gray-800">
                    {describeAttentionItem(item, {
                      windowInDays: props.insights.windowInDays,
                    })}
                  </p>
                </div>
                {target ? (
                  <Link to={target.route} className={LINK_CLASS_NAME}>
                    {translator.translateText(target.label)}
                  </Link>
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
  value: number;
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
        {translator.formatNumber(props.value)}
      </p>
      {props.detail ? (
        <p className="mt-0.5 text-xs text-gray-500">{props.detail}</p>
      ) : (
        <></>
      )}
    </div>
  );
}

function Trend(props: { trend: Array<AiActivityTrendDay> }): ReactElement {
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
              title={describeTrendDay(day)}
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

  return (
    <Card
      title="Last 30 days"
      description="How much OneUptime AI did here, and how it went."
    >
      <div data-testid="ai-insights-summary">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
        <Trend trend={props.insights.trend} />
      </div>
    </Card>
  );
}

function ProblemRow(props: { problem: AiActivityProblem }): ReactElement {
  const translator: Translator = useTranslator();
  const problem: AiActivityProblem = props.problem;
  const fixes: string | null = describeProblemFixes(problem);
  const verdicts: string | null = describeProblemVerdicts(problem);

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
            {describeProblemCount(problem)}
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
              return <ProblemRow key={problem.key} problem={problem} />;
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

function FixesCard(props: InsightsProps): ReactElement {
  const translator: Translator = useTranslator();
  const segments: Array<AiInsightsFixSegment> = getFixSegments(
    props.insights.fixOutcomes,
  );
  const verification: string | null = describeFixVerification(
    props.insights.fixOutcomes,
  );

  return (
    <Card
      title="Fixes"
      description="Where the fixes OneUptime AI proposed here ended up, and whether they resolved the problem."
    >
      <div data-testid="ai-insights-fixes">
        <StackedProgressBar
          segments={segments.map((segment: AiInsightsFixSegment) => {
            return {
              value: segment.value,
              color: segment.color,
              label: translator.translateText(segment.label) || segment.label,
            };
          })}
          totalValue={props.insights.fixOutcomes.total}
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

  return (
    <Fragment>
      <AttentionCard
        insights={props.insights}
        logsRoute={props.logsRoute}
        agentRoute={props.agentRoute}
      />
      <SummaryCard insights={props.insights} />
      <ProblemsCard insights={props.insights} />
      <HotspotsCard insights={props.insights} noun={props.noun} />
      {props.insights.fixOutcomes.total > 0 ? (
        <FixesCard insights={props.insights} />
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
