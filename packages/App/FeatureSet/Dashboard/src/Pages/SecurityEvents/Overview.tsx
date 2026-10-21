import PageComponentProps from "../PageComponentProps";
import AppLink from "../../Components/AppLink/AppLink";
import EventStatBar from "../../Components/EventView/EventStatBar";
import EventStatTile from "../../Components/EventView/EventStatTile";
import SecurityCaseApi, {
  EntityFindingSummary,
  SecurityOverview,
} from "../../Components/SecurityCase/SecurityCaseApi";
import { getCorrelateRouteForEntity } from "../../Components/SecurityCase/SecurityEntityChips";
import RankedBars, {
  RankedBarItem,
} from "../../Components/SecurityOverview/RankedBars";
import SecurityAllQuiet from "../../Components/SecurityOverview/SecurityAllQuiet";
import SecurityGettingStarted, {
  isSecurityGetStartedDismissed,
} from "../../Components/SecurityOverview/SecurityGettingStarted";
import SecurityPipeline from "../../Components/SecurityOverview/SecurityPipeline";
import {
  SecuritySetupStatus,
  isSecuritySetUp,
} from "../../Components/SecurityOverview/SecuritySetupModel";
import StackedDayBars, {
  StackedSeries,
} from "../../Components/SecurityOverview/StackedDayBars";
import { formatCompactDurationInMinutes } from "../../Utils/CompactDuration";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { Cyan, Gray500, Indigo500, Red } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import { describeMitreId } from "Common/Types/SecurityEvent/MitreAttack";
import { ocsfSeverityFromId } from "Common/Types/SecurityEvent/OcsfSeverity";
import SecurityCasePriority, {
  SECURITY_CASE_PRIORITIES,
  getSecurityCasePriorityColor,
} from "Common/Types/SecurityCase/SecurityCasePriority";
import SecurityCaseStatus, {
  getSecurityCaseStatusColor,
} from "Common/Types/SecurityCase/SecurityCaseStatus";
import SecurityCaseVerdict, {
  getSecurityCaseVerdictColor,
} from "Common/Types/SecurityCase/SecurityCaseVerdict";
import SecurityDetectionSource, {
  SECURITY_DETECTION_SOURCES,
} from "Common/Types/SecurityCase/SecurityDetectionSource";
import {
  RuleCount,
  TacticCount,
} from "Common/Utils/SecurityCase/SecurityOverviewMetrics";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import { PluralTemplate, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

// Each detection source's color on the detections chart.
export const DETECTION_SOURCE_COLORS: Record<SecurityDetectionSource, string> =
  {
    [SecurityDetectionSource.DetectionRule]: Indigo500.toString(),
    [SecurityDetectionSource.ThreatIntel]: Red.toString(),
    [SecurityDetectionSource.ConnectedProduct]: Cyan.toString(),
    [SecurityDetectionSource.Manual]: Gray500.toString(),
  };

const ATTENTION_TONES: Record<string, string> = {
  red: "border-red-200 bg-red-50 text-red-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  indigo: "border-indigo-200 bg-indigo-50 text-indigo-800",
  gray: "border-gray-200 bg-white text-gray-700",
};

/*
 * A count and what it counts, the words agreeing with the number ("1 open
 * case", "2 open cases"): the label is a plural template without the count,
 * which the tile draws on its own, larger.
 */
const AttentionTile: FunctionComponent<{
  icon: IconProp;
  count: number;
  label: PluralTemplate;
  tone: string;
  to: Route;
}> = (props: {
  icon: IconProp;
  count: number;
  label: PluralTemplate;
  tone: string;
  to: Route;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const tone: string =
    props.count > 0
      ? ATTENTION_TONES[props.tone] || ATTENTION_TONES["gray"]!
      : ATTENTION_TONES["gray"]!;

  return (
    <AppLink
      to={props.to}
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 shadow-sm transition-colors hover:brightness-95 ${tone}`}
    >
      <>
        <Icon icon={props.icon} className="h-5 w-5 flex-shrink-0 opacity-70" />
        <span className="text-2xl font-semibold tabular-nums">
          {translator.formatNumber(props.count)}
        </span>
        <span className="text-sm font-medium">
          {translator.translatePlural(props.label, props.count)}
        </span>
      </>
    </AppLink>
  );
};

/*
 * Security at a glance, in the order a person reads it.
 *
 * Across the top, how Security works in this project: sources, detections,
 * cases, playbooks, each with its figure and a link to its page. Until all
 * of it is set up, "Get started" turns it on in one click and sends a test
 * attack to show a case open. Then what needs someone now - the cases that
 * are yours, those nobody has picked up, the playbook steps waiting for an
 * approval - or, when nothing does, "All quiet". The figures and charts
 * below (how fast cases are acknowledged, contained and closed, the trend
 * of cases and detections, the rules, tactics and entities behind them)
 * show once there is something to chart.
 */
const SecurityOverviewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [status, setStatus] = useState<SecuritySetupStatus | null>(null);
  const [entities, setEntities] = useState<Array<EntityFindingSummary>>([]);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  /*
   * Get started stays for the visit once it showed, so the reader watches
   * each step tick and the test's case appear; Done hides it.
   */
  const [showGetStarted, setShowGetStarted] = useState<boolean>(false);
  // Bumped after a change on the page: the figures are read again, quietly.
  const [readCount, setReadCount] = useState<number>(0);

  const readAgain: () => void = (): void => {
    setReadCount((count: number): number => {
      return count + 1;
    });
  };

  useEffect(() => {
    let isCurrent: boolean = true;
    const isFirstRead: boolean = readCount === 0;

    const load: () => Promise<void> = async (): Promise<void> => {
      /*
       * The setup figures are read beside the overview, not after it; a
       * server that cannot answer them leaves the pipeline and Get started
       * out, never the page.
       */
      const [overviewResult, statusResult] = await Promise.all([
        SecurityCaseApi.getOverview().then(
          (result: SecurityOverview): SecurityOverview | Error => {
            return result;
          },
          (err: unknown): Error => {
            return err instanceof Error ? err : new Error(String(err));
          },
        ),
        SecurityCaseApi.getSetupStatus().then(
          (result: SecuritySetupStatus): SecuritySetupStatus | null => {
            return result;
          },
          (): null => {
            return null;
          },
        ),
      ]);

      if (!isCurrent) {
        return;
      }

      if (overviewResult instanceof Error) {
        // A read again that fails keeps what the page already shows.
        if (isFirstRead) {
          setError(overviewResult.message);
        }
      } else {
        setOverview(overviewResult);
      }

      if (statusResult) {
        setStatus(statusResult);

        if (
          isFirstRead &&
          !isSecuritySetUp(statusResult) &&
          !isSecurityGetStartedDismissed()
        ) {
          setShowGetStarted(true);
        }
      }

      setIsLoading(false);

      // Entities come from the events store; a role without events still sees the rest.
      try {
        const top: Array<EntityFindingSummary> =
          await SecurityCaseApi.getTopEntities({ days: 7, limit: 8 });

        if (isCurrent) {
          setEntities(top);
        }
      } catch {
        // Left empty: the card says there is nothing to show.
      }
    };

    void load();

    return () => {
      isCurrent = false;
    };
  }, [readCount]);

  const route: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route);
  };

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (isLoading || !overview || !overview.metrics) {
    return (
      <div className="space-y-6" aria-busy="true">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="h-16 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-16 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-16 animate-pulse rounded-xl bg-gray-100" />
        </div>
        <div className="h-24 animate-pulse rounded-xl bg-gray-100" />
        <div className="h-64 animate-pulse rounded-xl bg-gray-100" />
      </div>
    );
  }

  const metrics: SecurityOverview["metrics"] = overview.metrics;
  // Nothing to chart yet: no case open, opened or detected in the windows.
  const isEmpty: boolean =
    metrics.openCases === 0 &&
    metrics.casesOpenedInWindow === 0 &&
    metrics.detectionsInWindow === 0;
  const needsSomeone: boolean =
    metrics.openCases > 0 || overview.runsWaitingForApproval > 0;
  /*
   * The pipeline and Get started tell the same story - sources, rules,
   * cases, playbooks - so a project being set up sees the card alone, its
   * one next step first, and the pipeline takes its place once the card is
   * put away.
   */
  const showPipeline: boolean = Boolean(status) && !showGetStarted;
  // What the open cases are: how many of them are critical, and high.
  const urgentOpenCases: number =
    (metrics.openByPriority[SecurityCasePriority.Critical] || 0) +
    (metrics.openByPriority[SecurityCasePriority.High] || 0);
  const openCasesDetail: string = translator.translateTemplate(
    "{{critical}} critical · {{high}} high",
    {
      critical: metrics.openByPriority[SecurityCasePriority.Critical] || 0,
      high: metrics.openByPriority[SecurityCasePriority.High] || 0,
    },
  );

  const prioritySeries: Array<StackedSeries> = [...SECURITY_CASE_PRIORITIES]
    .reverse()
    .map((priority: SecurityCasePriority): StackedSeries => {
      return {
        key: priority,
        color: getSecurityCasePriorityColor(priority).toString(),
      };
    });

  const sourceSeries: Array<StackedSeries> = SECURITY_DETECTION_SOURCES.map(
    (source: SecurityDetectionSource): StackedSeries => {
      return { key: source, color: DETECTION_SOURCE_COLORS[source] };
    },
  );

  const openByPriority: Array<RankedBarItem> = SECURITY_CASE_PRIORITIES.map(
    (priority: SecurityCasePriority): RankedBarItem => {
      return {
        key: priority,
        label: translator.translateText(priority) || priority,
        count: metrics.openByPriority[priority] || 0,
        color: getSecurityCasePriorityColor(priority).toString(),
      };
    },
  );

  const openByStatus: Array<RankedBarItem> = [
    SecurityCaseStatus.New,
    SecurityCaseStatus.Investigating,
    SecurityCaseStatus.Contained,
  ].map((status: SecurityCaseStatus): RankedBarItem => {
    return {
      key: status,
      label: translator.translateText(status) || status,
      count: metrics.openByStatus[status] || 0,
      color: getSecurityCaseStatusColor(status).toString(),
    };
  });

  const verdicts: Array<RankedBarItem> = Object.values(SecurityCaseVerdict).map(
    (verdict: SecurityCaseVerdict): RankedBarItem => {
      return {
        key: verdict,
        label: translator.translateText(verdict) || verdict,
        count: metrics.verdictsInWindow[verdict] || 0,
        color: getSecurityCaseVerdictColor(verdict).toString(),
      };
    },
  );

  const topRules: Array<RankedBarItem> = metrics.topRules.map(
    (rule: RuleCount): RankedBarItem => {
      return {
        key: rule.detectionRuleId || rule.ruleName,
        label: rule.ruleName,
        count: rule.count,
        to: rule.detectionRuleId
          ? route(PageMap.SECURITY_EVENTS_DETECTION_RULES)
          : undefined,
      };
    },
  );

  const topTactics: Array<RankedBarItem> = metrics.topTactics.map(
    (tactic: TacticCount): RankedBarItem => {
      return {
        key: tactic.tacticId,
        label: describeMitreId(tactic.tacticId),
        count: tactic.count,
        color: "#e11d48",
        to: route(PageMap.SECURITY_EVENTS_ATTACK_COVERAGE),
      };
    },
  );

  const topEntities: Array<RankedBarItem> = entities.map(
    (entity: EntityFindingSummary): RankedBarItem => {
      return {
        key: entity.value,
        label: <span className="font-mono">{entity.value}</span>,
        count: entity.findingCount,
        hint: translator.translatePlural(
          {
            one: "{{count}} rule · worst {{severity}}",
            other: "{{count}} rules · worst {{severity}}",
          },
          entity.ruleCount,
          {
            severity:
              translator.translateText(
                ocsfSeverityFromId(entity.maxSeverityId),
              ) || ocsfSeverityFromId(entity.maxSeverityId),
          },
        ),
        to: getCorrelateRouteForEntity(entity.value),
      };
    },
  );

  return (
    <div className="space-y-6">
      {showPipeline && status ? (
        <SecurityPipeline
          status={status}
          openCasesDetail={
            /*
             * "0 critical · 0 high" says nothing: with nothing urgent open,
             * the stage says the cases wait for a person.
             */
            urgentOpenCases > 0 ? openCasesDetail : undefined
          }
        />
      ) : (
        <></>
      )}

      {status && showGetStarted ? (
        <SecurityGettingStarted
          status={status}
          onChanged={readAgain}
          onDone={() => {
            setShowGetStarted(false);
          }}
          onDismiss={() => {
            setShowGetStarted(false);
          }}
        />
      ) : (
        <></>
      )}

      {!needsSomeone && !(status && showGetStarted) ? (
        <SecurityAllQuiet onChanged={readAgain} />
      ) : (
        <></>
      )}

      {needsSomeone ? (
        /*
         * Each count opens the page that lists exactly what it counts:
         * Assigned to Me, Unassigned and Waiting for Approval.
         */
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <AttentionTile
            icon={IconProp.User}
            count={overview.myOpenCases}
            label={{
              one: "open case assigned to you",
              other: "open cases assigned to you",
            }}
            tone="indigo"
            to={route(PageMap.SECURITY_CASES_ASSIGNED_TO_ME)}
          />
          <AttentionTile
            icon={IconProp.Inbox}
            count={metrics.unassignedOpenCases}
            label={{
              one: "open case nobody has picked up",
              other: "open cases nobody has picked up",
            }}
            tone="red"
            to={route(PageMap.SECURITY_CASES_UNASSIGNED)}
          />
          <AttentionTile
            icon={IconProp.PauseCircle}
            count={overview.runsWaitingForApproval}
            label={{
              one: "playbook step waiting for approval",
              other: "playbook steps waiting for approval",
            }}
            tone="amber"
            to={route(PageMap.SECURITY_PLAYBOOK_RUNS_WAITING_FOR_APPROVAL)}
          />
        </div>
      ) : (
        <></>
      )}

      {isEmpty ? (
        <></>
      ) : (
        <>
          {/*
           * How fast cases move. The open cases are the pipeline's cases
           * stage, so the bar counts them only when there is no pipeline.
           */}
          <EventStatBar
            columns={showPipeline ? 3 : 4}
            ariaLabel={translator.translateText("Security operations figures")}
          >
            {[
              ...(showPipeline
                ? []
                : [
                    <EventStatTile
                      key="open-cases"
                      variant="segment"
                      icon={IconProp.ShieldExclamation}
                      label={
                        translator.translateText("Open Cases") || "Open Cases"
                      }
                      value={translator.formatNumber(metrics.openCases)}
                      description={openCasesDetail}
                    />,
                  ]),
              <EventStatTile
                key="acknowledge"
                variant="segment"
                icon={IconProp.User}
                label={
                  translator.translateText("Mean Time to Acknowledge") ||
                  "Mean Time to Acknowledge"
                }
                value={formatCompactDurationInMinutes(
                  metrics.meanTimeToAcknowledgeInMinutes,
                  translator.language,
                )}
                description={translator.translateTemplate(
                  "Last {{days}} days",
                  {
                    days: overview.caseWindowInDays,
                  },
                )}
              />,
              <EventStatTile
                key="contain"
                variant="segment"
                icon={IconProp.ShieldCheck}
                label={
                  translator.translateText("Mean Time to Contain") ||
                  "Mean Time to Contain"
                }
                value={formatCompactDurationInMinutes(
                  metrics.meanTimeToContainInMinutes,
                  translator.language,
                )}
                description={translator.translateTemplate(
                  "Last {{days}} days",
                  {
                    days: overview.caseWindowInDays,
                  },
                )}
              />,
              <EventStatTile
                key="close"
                variant="segment"
                icon={IconProp.CheckCircle}
                label={
                  translator.translateText("Mean Time to Close") ||
                  "Mean Time to Close"
                }
                value={formatCompactDurationInMinutes(
                  metrics.meanTimeToCloseInMinutes,
                  translator.language,
                )}
                description={translator.translatePlural(
                  {
                    one: "{{count}} case closed in {{days}} days",
                    other: "{{count}} cases closed in {{days}} days",
                  },
                  metrics.casesClosedInWindow,
                  { days: overview.caseWindowInDays },
                )}
              />,
            ]}
          </EventStatBar>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card
              title="Cases Opened"
              description="New cases each day over the last 30 days, by priority."
            >
              <StackedDayBars
                days={metrics.casesOpenedPerDay}
                series={prioritySeries}
                ariaLabel="Cases opened per day, by priority"
              />
            </Card>
            <Card
              title="Detections"
              description="New detections each day over the last 14 days, by what raised them."
            >
              <StackedDayBars
                days={metrics.detectionsPerDay}
                series={sourceSeries}
                ariaLabel="Detections per day, by source"
              />
            </Card>
          </div>

          {/*
           * Three across only from xl: beside the side menu a third of the page
           * is too narrow for a tactic's name. Below that the tactics take the
           * second row's whole width.
           */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            <Card
              title="Open Cases"
              description="The queue right now, by priority and by where each case stands."
            >
              <div className="space-y-5">
                <RankedBars
                  items={openByPriority}
                  total={Math.max(1, metrics.openCases)}
                  emptyText="No open cases."
                />
                <div className="border-t border-gray-100 pt-4">
                  <RankedBars
                    items={openByStatus}
                    total={Math.max(1, metrics.openCases)}
                    emptyText="No open cases."
                  />
                </div>
              </div>
            </Card>
            <Card
              title="Verdicts"
              description="What the cases closed in the last 30 days turned out to be. Many false positives point at a rule to tune."
            >
              <RankedBars
                items={verdicts}
                total={Math.max(1, metrics.casesClosedInWindow)}
                emptyText="No case was closed in the last 30 days."
              />
            </Card>
            <div className="md:col-span-2 xl:col-span-1">
              <Card
                title="MITRE ATT&CK Tactics"
                description="The attacker goals behind the cases of the last 30 days."
              >
                <RankedBars
                  items={topTactics}
                  emptyText="No case in the last 30 days is mapped to an ATT&CK tactic."
                />
              </Card>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card
              title="Top Detections"
              description="The rules and sources that raised the most detections in the last 14 days."
            >
              <RankedBars
                items={topRules}
                emptyText="Nothing was detected in the last 14 days."
              />
            </Card>
            <Card
              title="Riskiest Entities"
              description="The users, hosts and addresses named by the most findings in the last 7 days. Open one to see everything it touched."
            >
              <RankedBars
                items={topEntities}
                emptyText="No findings named an entity in the last 7 days."
              />
            </Card>
          </div>

          {overview.isTruncated ? (
            <p className="text-xs text-gray-500">
              {translator.translateText(
                "This project has more cases and detections than the overview reads at once; its figures are for the most recent of them.",
              )}
            </p>
          ) : (
            <></>
          )}
        </>
      )}
    </div>
  );
};

export default SecurityOverviewPage;
