import PageComponentProps from "../PageComponentProps";
import EventStatBar from "../../Components/EventView/EventStatBar";
import EventStatTile from "../../Components/EventView/EventStatTile";
import SecurityCaseApi, {
  EntityFindingSummary,
  SecurityOverview,
} from "../../Components/SecurityCase/SecurityCaseApi";
import { SecurityOverviewValue } from "../../Components/SecurityCase/SecurityCaseApiTypes";
import { getCorrelateRouteForEntity } from "../../Components/SecurityCase/SecurityEntityChips";
import RankedBars, {
  RankedBarItem,
} from "../../Components/SecurityOverview/RankedBars";
import SecurityGettingStarted, {
  forgetSecurityGetStartedDismissed,
  isSecurityGetStartedDismissed,
} from "../../Components/SecurityOverview/SecurityGettingStarted";
import SecurityOverviewStatus, {
  SecurityOverviewFailed,
  SecurityOverviewLoading,
} from "../../Components/SecurityOverview/SecurityOverviewStatus";
import {
  NONE_URGENT,
  SecurityHeadlineKind,
  SecurityOverviewQueue,
  URGENT_OPEN_CASES,
  formatSecurityOverviewValues,
  getSecurityHeadline,
} from "../../Components/SecurityOverview/SecurityOverviewStatusModel";
import {
  SecuritySetupStatus,
  describeSetupCallFailure,
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
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { describeMitreId } from "Common/Types/SecurityEvent/MitreAttack";
import { ocsfSeverityFromId } from "Common/Types/SecurityEvent/OcsfSeverity";
import SecurityCasePriorities from "Common/Utils/SecurityCase/SecurityCasePriorities";
import SecurityCaseStatuses from "Common/Utils/SecurityCase/SecurityCaseStatuses";
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
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
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

/*
 * Security at a glance, in the order a person reads it.
 *
 * At the top, one card (SecurityOverviewStatus), drawn as Home draws the top
 * of a project: a band that says what needs someone now - the cases that
 * are yours, those nobody has picked up, the playbook steps waiting for an
 * approval, each a link - or that every open case is picked up, that
 * nothing is watched yet, or "All quiet"; and under it how Security works
 * here: sources, detections, cases, playbooks, each with its figure and how
 * it is doing. Until Security is set up, "Get started" takes the card's
 * place: it turns it on in one click and sends a test attack to show a case
 * open. The figures and charts below (how fast cases are acknowledged,
 * contained and closed, the trend of cases and detections, the rules,
 * tactics and entities behind them) show once there is something to chart.
 */
const SecurityOverviewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [status, setStatus] = useState<SecuritySetupStatus | null>(null);
  const [entities, setEntities] = useState<Array<EntityFindingSummary>>([]);
  // Why the overview could not be read at all (describeSetupCallFailure).
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  // A read is in flight: the first, a quiet read again, or Try again.
  const [isReading, setIsReading] = useState<boolean>(true);
  // The set-up figures could not be read: the pipeline's place says so.
  const [hasStatusFailed, setHasStatusFailed] = useState<boolean>(false);
  /*
   * Whether the overview was ever read. Until it was, every read counts as
   * the first - Try again after a failed first read included - so Get
   * started can still show.
   */
  const hasLoaded: React.MutableRefObject<boolean> = useRef<boolean>(false);
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
    const isFirstRead: boolean = !hasLoaded.current;

    const load: () => Promise<void> = async (): Promise<void> => {
      setIsReading(true);

      /*
       * The setup figures are read beside the overview, not after it; a
       * server that cannot answer them leaves Get started out and the
       * pipeline's place says so, with Try again - never the page.
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
        /*
         * A read again that fails keeps what the page already shows. A first
         * read says why in the product's words - a role's or a plan's
         * sentence as the server writes it, never a gateway's.
         */
        if (isFirstRead) {
          setError(describeSetupCallFailure(overviewResult));
        }
      } else {
        hasLoaded.current = true;
        setError("");
        setOverview(overviewResult);
      }

      if (statusResult) {
        setStatus(statusResult);
        setHasStatusFailed(false);

        if (
          isFirstRead &&
          !(overviewResult instanceof Error) &&
          !isSecuritySetUp(statusResult) &&
          !isSecurityGetStartedDismissed()
        ) {
          setShowGetStarted(true);
        }
      } else {
        // Drawn only while no figures were ever read; a stale read stays.
        setHasStatusFailed(true);
      }

      setIsLoading(false);
      setIsReading(false);

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
    return (
      <SecurityOverviewFailed
        message={error}
        isReading={isReading}
        onTryAgain={readAgain}
      />
    );
  }

  if (isLoading || !overview || !overview.metrics) {
    return <SecurityOverviewLoading />;
  }

  const metrics: SecurityOverview["metrics"] = overview.metrics;
  // Nothing to chart yet: no case open, opened or detected in the windows.
  const isEmpty: boolean =
    metrics.openCases === 0 &&
    metrics.casesOpenedInWindow === 0 &&
    metrics.detectionsInWindow === 0;
  /*
   * The queue as the card's band and its cases cell read it. Critical and
   * high are counted by the project's priorities: at or above its critical
   * one, and at or above its high one below that (SecurityCasePriorities),
   * whatever the project calls them.
   */
  const queue: SecurityOverviewQueue = {
    openCases: metrics.openCases,
    criticalOpenCases: metrics.criticalOpenCases || 0,
    highOpenCases: metrics.highOpenCases || 0,
    myOpenCases: overview.myOpenCases,
    unassignedOpenCases: metrics.unassignedOpenCases,
    runsWaitingForApproval: overview.runsWaitingForApproval,
  };
  // What "Last event 3 days ago" counts from.
  const now: Date = OneUptimeDate.getCurrentDate();
  const headlineKind: SecurityHeadlineKind = getSecurityHeadline({
    queue,
    status,
    now,
  }).kind;
  /*
   * The pipeline and Get started tell the same story - sources, rules,
   * cases, playbooks - so a project being set up sees the card alone, its
   * one next step first, and the status card takes its place once it is
   * put away. While Get started is on the page, what needs someone still
   * shows under it (the case a test attack opened), as the band alone.
   */
  const showStatusCard: boolean =
    !showGetStarted ||
    headlineKind === SecurityHeadlineKind.NeedsAttention ||
    headlineKind === SecurityHeadlineKind.InHand;
  // The pipeline counts the open cases; without it, the figures below do.
  const isPipelineShown: boolean = Boolean(status) && !showGetStarted;
  // "0 critical · 0 high" says nothing: the pipeline's words for none urgent.
  const openCasesDetail: string =
    queue.criticalOpenCases + queue.highOpenCases > 0
      ? translator.translateTemplate(
          URGENT_OPEN_CASES,
          formatSecurityOverviewValues(translator, {
            critical: queue.criticalOpenCases,
            high: queue.highOpenCases,
          }),
        )
      : translator.translateText(NONE_URGENT) || NONE_URGENT;
  // The windows' days in the reader's digits, as every count on the page.
  const caseWindowInDays: string = translator.formatNumber(
    overview.caseWindowInDays,
  );

  // The project's priorities, most urgent at the top of each bar.
  const priorities: Array<SecurityOverviewValue> = SecurityCasePriorities.sort(
    overview.priorities,
  );
  const prioritySeries: Array<StackedSeries> = [...priorities]
    .reverse()
    .map((priority: SecurityOverviewValue): StackedSeries => {
      return {
        key: priority._id,
        label: priority.name,
        color: priority.color || Gray500.toString(),
      };
    });

  const sourceSeries: Array<StackedSeries> = SECURITY_DETECTION_SOURCES.map(
    (source: SecurityDetectionSource): StackedSeries => {
      return { key: source, color: DETECTION_SOURCE_COLORS[source] };
    },
  );

  /*
   * The open cases by the project's priorities and by the statuses a case is
   * open in, in the project's order. An archived one is drawn only while a
   * case still has it.
   */
  const openByPriority: Array<RankedBarItem> = priorities
    .filter((priority: SecurityOverviewValue): boolean => {
      return (
        !priority.isArchived || (metrics.openByPriority[priority._id] || 0) > 0
      );
    })
    .map((priority: SecurityOverviewValue): RankedBarItem => {
      return {
        key: priority._id,
        label: translator.translateText(priority.name) || priority.name,
        count: metrics.openByPriority[priority._id] || 0,
        color: priority.color || Gray500.toString(),
      };
    });

  const openByStatus: Array<RankedBarItem> = SecurityCaseStatuses.getOpenStatuses(
    overview.statuses,
  )
    .filter((status: SecurityOverviewValue): boolean => {
      return !status.isArchived || (metrics.openByStatus[status._id] || 0) > 0;
    })
    .map((status: SecurityOverviewValue): RankedBarItem => {
      return {
        key: status._id,
        label: translator.translateText(status.name) || status.name,
        count: metrics.openByStatus[status._id] || 0,
        color: status.color || Gray500.toString(),
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

  const statusCard: ReactElement = (
    <SecurityOverviewStatus
      queue={queue}
      status={status}
      showPipeline={!showGetStarted}
      hasStatusFailed={hasStatusFailed}
      isReading={isReading}
      now={now}
      onChanged={readAgain}
      onTryAgain={readAgain}
      onSetUp={() => {
        forgetSecurityGetStartedDismissed();
        setShowGetStarted(true);
      }}
    />
  );

  return (
    <div className="space-y-6">
      {showStatusCard && !showGetStarted ? statusCard : <></>}

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

      {showStatusCard && showGetStarted ? statusCard : <></>}

      {isEmpty ? (
        <></>
      ) : (
        <>
          {/*
           * How fast cases move. The open cases are the pipeline's cases
           * stage, so the bar counts them only when there is no pipeline.
           */}
          <EventStatBar
            columns={isPipelineShown ? 3 : 4}
            ariaLabel={translator.translateText("Security operations figures")}
          >
            {[
              ...(isPipelineShown
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
                    days: caseWindowInDays,
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
                    days: caseWindowInDays,
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
                  { days: caseWindowInDays },
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
