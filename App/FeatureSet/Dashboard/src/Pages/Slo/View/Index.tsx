import PageComponentProps from "../../PageComponentProps";
import SloNoticeBanner from "../../../Components/Slo/SloNoticeBanner";
import SloStatusPill from "../../../Components/Slo/SloStatusPill";
import { getSloFormFields } from "../Slos";
import MonitorsElement from "../../../Components/Monitor/Monitors";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import Label from "Common/Models/DatabaseModels/Label";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import { getSloStatusText } from "Common/Utils/Slo/SloStatusColor";
import { getSloBudgetTier, SloBudgetTier } from "Common/Utils/Slo/SloHealth";
import { SLO_CURRENT_BURN_RATE_WINDOW_MINUTES } from "Common/Utils/Slo/SloEvaluation";
import {
  formatErrorBudgetRemainingOfTotal,
  formatDurationCompact,
} from "Common/Utils/Slo/SloDuration";
import {
  formatSloBurnRate,
  formatSloPercent,
  SLO_NOT_EVALUATED_TEXT,
} from "Common/Utils/Slo/SloWidgetFormat";
import Card from "Common/UI/Components/Card/Card";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import LabelsElement from "Common/UI/Components/Label/Labels";
import { PillSize } from "Common/UI/Components/Pill/Pill";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/** The hero is only useful if it keeps up with the worker's 5-minute cadence. */
const HERO_AUTO_REFRESH_MS: number = 60 * 1000;

const EM_DASH: string = "—";

type FormatPercentOrDashFunction = (value: number | undefined | null) => string;

const formatPercentOrDash: FormatPercentOrDashFunction = (
  value: number | undefined | null,
): string => {
  return formatSloPercent(value) ?? EM_DASH;
};

/*
 * Tailwind classes per budget tier. The tier comes from the shared,
 * unit-tested helper so the colour always agrees with the SLO's own
 * at-risk threshold rather than a hardcoded 20.
 */
const BUDGET_TIER_TEXT_CLASS: Record<SloBudgetTier, string> = {
  [SloBudgetTier.Healthy]: "text-emerald-700",
  [SloBudgetTier.AtRisk]: "text-amber-700",
  [SloBudgetTier.Exhausted]: "text-red-700",
  [SloBudgetTier.Unknown]: "text-gray-400",
};

const BUDGET_TIER_BAR_CLASS: Record<SloBudgetTier, string> = {
  [SloBudgetTier.Healthy]: "bg-emerald-500",
  [SloBudgetTier.AtRisk]: "bg-amber-500",
  [SloBudgetTier.Exhausted]: "bg-red-500",
  [SloBudgetTier.Unknown]: "bg-gray-300",
};

/*
 * SLO Overview — the "are we within budget?" page. A notice banner
 * explaining any state that stops measurement, then the error-budget hero
 * (SLI vs target, budget remaining, burn rate, status), then the editable
 * configuration. History charts live on the Charts sub-page.
 */
const SloView: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [slo, setSlo] = useState<ServiceLevelObjective | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  /*
   * Bumped on every successful fetch and on every save, so the notice
   * banner re-reads the SLO instead of showing a reason the user has
   * already fixed.
   */
  const [refreshToggle, setRefreshToggle] = useState<string>("");

  const fetchSlo: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const item: ServiceLevelObjective | null =
        await ModelAPI.getItem<ServiceLevelObjective>({
          modelType: ServiceLevelObjective,
          id: modelId,
          select: {
            targetPercentage: true,
            windowType: true,
            windowDays: true,
            timezone: true,
            atRiskThresholdPercentage: true,
            currentSliPercentage: true,
            errorBudgetRemainingPercentage: true,
            errorBudgetRemainingSeconds: true,
            errorBudgetTotalSeconds: true,
            currentBurnRate: true,
            sloStatus: true,
            lastEvaluatedAt: true,
            isEnabled: true,
          },
        });

      setSlo(item);
      setError("");
      setRefreshToggle(OneUptimeDate.getCurrentDate().toISOString());
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchSlo().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    });

    /*
     * The worker re-evaluates every 5 minutes, and this page is what
     * someone keeps open during an incident — without this the numbers
     * silently freeze at whatever they were when the tab was opened.
     */
    const intervalId: ReturnType<typeof setInterval> = setInterval(() => {
      fetchSlo().catch(() => {
        // A failed background refresh keeps the last good numbers on screen.
      });
    }, HERO_AUTO_REFRESH_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, []);

  type GetHeroFunction = () => ReactElement;

  const getHero: GetHeroFunction = (): ReactElement => {
    if (isLoading) {
      return (
        <div className="mb-5 rounded-lg bg-white p-6 shadow">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 xl:grid-cols-5">
            {[0, 1, 2, 3, 4].map((index: number) => {
              return (
                <div key={index} className="space-y-2">
                  <div className="h-4 w-20 animate-pulse rounded bg-gray-100"></div>
                  <div className="h-6 w-24 animate-pulse rounded bg-gray-100"></div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    if (error || !slo) {
      // The hero is supplementary — the details card below still renders.
      return <></>;
    }

    const budgetRemainingPercentRaw: number | undefined | null =
      slo.errorBudgetRemainingPercentage;

    const budgetRemainingPercent: number | null =
      budgetRemainingPercentRaw === undefined ||
      budgetRemainingPercentRaw === null
        ? null
        : budgetRemainingPercentRaw;

    /* Bar is clamped to 0..100 visually; the signed value is shown as text. */
    const budgetBarPercent: number =
      budgetRemainingPercent === null
        ? 0
        : Math.max(0, Math.min(100, budgetRemainingPercent));

    const budgetTier: SloBudgetTier = getSloBudgetTier({
      errorBudgetRemainingPercentage: budgetRemainingPercent,
      atRiskThresholdPercentage: slo.atRiskThresholdPercentage,
    });

    const currentSli: number | undefined | null = slo.currentSliPercentage;
    const target: number | undefined | null = slo.targetPercentage;

    const meetsTarget: boolean =
      currentSli === undefined ||
      currentSli === null ||
      target === undefined ||
      target === null ||
      currentSli >= target;

    const lastEvaluatedAt: Date | null = slo.lastEvaluatedAt
      ? OneUptimeDate.fromString(slo.lastEvaluatedAt)
      : null;

    const windowText: string =
      slo.windowType === SloWindowType.CalendarMonth
        ? `calendar month (${slo.timezone || "UTC"})`
        : `rolling ${slo.windowDays || 30} days`;

    const budgetText: string =
      formatErrorBudgetRemainingOfTotal({
        remainingSeconds: slo.errorBudgetRemainingSeconds,
        totalSeconds: slo.errorBudgetTotalSeconds,
      }) ?? SLO_NOT_EVALUATED_TEXT;

    return (
      <div data-testid="slo-error-budget-hero">
        <Card
          title="Error Budget"
          description={`Measured over the ${windowText}.`}
          buttons={[
            {
              title: "Refresh",
              icon: IconProp.Refresh,
              onClick: () => {
                fetchSlo().catch((err: Error) => {
                  setError(API.getFriendlyMessage(err));
                });
              },
            },
          ]}
        >
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 xl:grid-cols-5">
            <div>
              <div className="text-sm font-medium text-gray-500">
                Current SLI
              </div>
              <div
                className={`mt-1.5 text-2xl font-semibold ${
                  meetsTarget ? "text-gray-900" : "text-red-700"
                }`}
              >
                {formatPercentOrDash(slo.currentSliPercentage)}
              </div>
              <div className="mt-1.5 text-xs text-gray-500">
                Target {formatPercentOrDash(slo.targetPercentage)}
              </div>
            </div>

            <div>
              <div className="text-sm font-medium text-gray-500">
                Error Budget Remaining
              </div>
              <div
                className={`mt-1.5 text-2xl font-semibold ${BUDGET_TIER_TEXT_CLASS[budgetTier]}`}
              >
                {budgetRemainingPercent === null
                  ? EM_DASH
                  : formatPercentOrDash(budgetRemainingPercent)}
              </div>
              <div className="mt-1.5 text-xs text-gray-500">{budgetText}</div>
              {budgetRemainingPercent !== null && (
                <div
                  className="mt-2 flex h-1.5 w-full max-w-[10rem] overflow-hidden rounded-full bg-gray-100"
                  role="progressbar"
                  aria-valuenow={Math.round(budgetBarPercent)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Error budget remaining: ${formatPercentOrDash(
                    budgetRemainingPercent,
                  )}`}
                >
                  <div
                    className={`h-full ${BUDGET_TIER_BAR_CLASS[budgetTier]}`}
                    style={{ width: `${budgetBarPercent}%` }}
                  ></div>
                </div>
              )}
            </div>

            <div>
              <div className="text-sm font-medium text-gray-500">Burn Rate</div>
              <div className="mt-1.5 text-2xl font-semibold text-gray-900">
                {formatSloBurnRate(slo.currentBurnRate) ?? EM_DASH}
              </div>
              <div className="mt-1.5 text-xs text-gray-500">
                Over the last{" "}
                {formatDurationCompact(
                  SLO_CURRENT_BURN_RATE_WINDOW_MINUTES * 60,
                )}
                . 1× spends the budget exactly over the compliance window.
              </div>
            </div>

            <div>
              <div className="text-sm font-medium text-gray-500">Status</div>
              <div className="mt-1.5">
                <SloStatusPill status={slo.sloStatus} size={PillSize.Normal} />
              </div>
              {/*
               * The pill's colour is the RAG signal; this repeats the state
               * as a word so the budget bar above is not colour-only.
               */}
              <div className="mt-1.5 text-xs text-gray-500">
                Error budget is {getSloStatusText(slo.sloStatus).toLowerCase()}
              </div>
            </div>

            <div>
              <div className="text-sm font-medium text-gray-500">
                Last Evaluated
              </div>
              <div className="mt-1.5 text-sm text-gray-900">
                {lastEvaluatedAt ? (
                  <span
                    title={OneUptimeDate.getDateAsLocalFormattedString(
                      lastEvaluatedAt,
                    )}
                  >
                    {OneUptimeDate.fromNow(lastEvaluatedAt)}
                  </span>
                ) : (
                  <span className="text-gray-400">
                    Not evaluated yet — evaluation runs every few minutes.
                  </span>
                )}
              </div>
            </div>
          </div>
        </Card>
      </div>
    );
  };

  return (
    <Fragment>
      <SloNoticeBanner sloId={modelId} refreshToggle={refreshToggle} />
      {getHero()}
      <CardModelDetail<ServiceLevelObjective>
        name="SLO Details"
        cardProps={{
          title: "SLO Details",
          description:
            "Target, compliance window, and the monitors this SLO measures.",
        }}
        documentationLink={new Route("/docs/slo/error-budget")}
        isEditable={true}
        onSaveSuccess={() => {
          fetchSlo().catch((err: Error) => {
            setError(API.getFriendlyMessage(err));
          });
        }}
        /*
         * Shared with the create modal on the SLOs list so the two can
         * never drift: the list used to offer a strict subset, which meant
         * every SLO needing a calendar month, a custom at-risk threshold
         * or non-default downtime statuses had to be created and then
         * immediately edited.
         */
        formFields={getSloFormFields({ includeIsEnabled: true })}
        modelDetailProps={{
          modelType: ServiceLevelObjective,
          id: "slo-details",
          modelId: modelId,
          /*
           * ModelDetail builds its select from the KEYS of each field's
           * `field` object, so a getElement that reads a sibling column
           * gets undefined. The Window row renders windowDays and timezone
           * but is keyed on windowType, which silently made every SLO read
           * "30 days rolling".
           */
          selectMoreFields: {
            windowDays: true,
            timezone: true,
          },
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FieldType.Text,
              showIf: (item: ServiceLevelObjective): boolean => {
                return Boolean(item.description);
              },
            },
            {
              field: {
                targetPercentage: true,
              },
              title: "Target",
              fieldType: FieldType.Element,
              getElement: (item: ServiceLevelObjective): ReactElement => {
                return (
                  <span>{formatPercentOrDash(item.targetPercentage)}</span>
                );
              },
            },
            {
              field: {
                windowType: true,
              },
              title: "Window",
              fieldType: FieldType.Element,
              getElement: (item: ServiceLevelObjective): ReactElement => {
                if (item.windowType === SloWindowType.CalendarMonth) {
                  return <span>Calendar month ({item.timezone || "UTC"})</span>;
                }
                return <span>{item.windowDays || 30} days rolling</span>;
              },
            },
            {
              field: {
                atRiskThresholdPercentage: true,
              },
              title: "At-Risk Threshold",
              fieldType: FieldType.Element,
              getElement: (item: ServiceLevelObjective): ReactElement => {
                return (
                  <span>
                    {formatPercentOrDash(item.atRiskThresholdPercentage)} of
                    budget remaining
                  </span>
                );
              },
            },
            {
              field: {
                multiMonitorMode: true,
              },
              title: "Multi Monitor Mode",
              fieldType: FieldType.Text,
            },
            {
              field: {
                monitors: {
                  name: true,
                  _id: true,
                },
              },
              title: "Monitors",
              fieldType: FieldType.Element,
              getElement: (item: ServiceLevelObjective): ReactElement => {
                const monitors: Array<Monitor> =
                  (item.monitors as Array<Monitor>) || [];

                /*
                 * Naming the consequence rather than showing an empty cell:
                 * zero monitors is the single most common reason an SLO
                 * reads Misconfigured, and the banner above says the same
                 * thing in the same words.
                 */
                if (monitors.length === 0) {
                  return (
                    <span className="text-gray-400">
                      No monitors attached — this SLO cannot be evaluated.
                    </span>
                  );
                }

                return <MonitorsElement monitors={monitors} />;
              },
            },
            {
              field: {
                monitorLabels: {
                  name: true,
                  color: true,
                },
              },
              title: "Auto-Add Monitors With Labels",
              fieldType: FieldType.Element,
              getElement: (item: ServiceLevelObjective): ReactElement => {
                const monitorLabels: Array<Label> =
                  (item.monitorLabels as Array<Label>) || [];

                /*
                 * Spelled out rather than left blank: an empty cell here and
                 * a rule that matches nothing look identical, and the
                 * difference decides whether the Monitors list above is
                 * maintained for you or entirely yours to curate.
                 */
                if (monitorLabels.length === 0) {
                  return (
                    <span className="text-gray-400">
                      No label rule — monitors are attached by hand.
                    </span>
                  );
                }

                return <LabelsElement labels={monitorLabels} />;
              },
            },
            {
              field: {
                downtimeMonitorStatuses: {
                  name: true,
                },
              },
              title: "Downtime Monitor Statuses",
              fieldType: FieldType.Element,
              getElement: (item: ServiceLevelObjective): ReactElement => {
                const statuses: Array<MonitorStatus> =
                  (item.downtimeMonitorStatuses as Array<MonitorStatus>) || [];
                if (statuses.length === 0) {
                  return (
                    <span className="text-gray-400">
                      Defaults to non-operational statuses
                    </span>
                  );
                }
                return (
                  <span>
                    {statuses
                      .map((status: MonitorStatus) => {
                        return status.name || "";
                      })
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                );
              },
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: (item: ServiceLevelObjective): ReactElement => {
                return (
                  <LabelsElement labels={(item.labels as Array<Label>) || []} />
                );
              },
              showIf: (item: ServiceLevelObjective): boolean => {
                const labels: Array<Label> | undefined =
                  (item.labels as Array<Label> | undefined) ?? undefined;
                return Array.isArray(labels) && labels.length > 0;
              },
            },
            {
              field: {
                isEnabled: true,
              },
              title: "Enabled",
              fieldType: FieldType.Boolean,
            },
          ],
        }}
      />
    </Fragment>
  );
};

export default SloView;
