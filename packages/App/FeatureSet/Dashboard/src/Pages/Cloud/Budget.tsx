import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import RouteParams from "../../Utils/RouteParams";
import RankedBars, {
  RankedBarItem,
} from "../../Components/SecurityOverview/RankedBars";
import { CloudBudgetStatus } from "../../Components/Cloud/CloudBudgetStatus";
import CloudDailySpendChart from "../../Components/Cloud/CloudDailySpendChart";
import CloudStatStrip, {
  CloudStatTile,
} from "../../Components/Cloud/CloudStatStrip";
import { formatCloudMoney } from "../../Components/Cloud/CloudCostWords";
import { CloudCostBasisPill } from "../../Components/Cloud/CloudCostBasis";
import {
  CLOUD_BUDGET_FORM_STEPS,
  getCloudBudgetFormFields,
} from "../../Components/Cloud/Budgets/CloudBudgetForm";
import CloudBudgetMonths from "../../Components/Cloud/Budgets/CloudBudgetMonths";
import { fetchCloudBudgetPage } from "../../Components/Cloud/Budgets/CloudBudgetReads";
import CloudBudgetScopeCell from "../../Components/Cloud/Budgets/CloudBudgetScopeCell";
import {
  AT_PERIOD_END,
  BUDGET_TITLE,
  DAYS_DESCRIPTION,
  DAYS_TITLE,
  EDIT_BUDGET,
  LEFT_TO_SPEND,
  MONTHS_DESCRIPTION,
  MONTHS_TITLE,
  NOBODY_PAGED,
  NOBODY_TO_TELL,
  NO_THRESHOLD_PASSED,
  OF_AMOUNT,
  ON_COURSE_FOR,
  OVER_BY,
  PAGED_FROM_100,
  PLANNED_SO_FAR,
  PLAN_SAVED,
  SAVE_FORECAST_AS_PLAN,
  SAVE_PLAN_DESCRIPTION,
  THIS_MONTH,
  THIS_QUARTER,
  THIS_YEAR,
  THRESHOLDS_PASSED,
  TOLD_BELOW_100,
  TOP_SERVICES_DESCRIPTION,
  TOP_SERVICES_EMPTY,
  TOP_SERVICES_TITLE,
  WHO_HEARS_DESCRIPTION,
  WHO_HEARS_TITLE,
  formatCloudMonth,
  getCloudBudgetPeriodLine,
  getFiscalMonthNumbers,
  formatCalendarMonthName,
} from "../../Components/Cloud/Budgets/CloudBudgetWords";
import useCloudBudgetFormContext, {
  CloudBudgetFormContext,
} from "../../Components/Cloud/Budgets/UseCloudBudgetFormContext";
import { getBudgetRowStatus, CLOUD_BUDGET_TONE_COLORS } from "./Budgets";
import CloudBudget from "Common/Models/DatabaseModels/CloudBudget";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import Route from "Common/Types/API/Route";
import {
  CLOUD_BUDGET_PERIOD_LABELS,
  CloudBudgetPeriod,
  CloudBudgetPlanSplit,
  readCloudBudgetPeriod,
  sumCloudBudgetPlan,
} from "Common/Types/Cloud/CloudBudget";
import { CloudBudgetPageResult } from "Common/Types/Cloud/CloudBudgetReads";
import {
  fromCloudCostDay,
  readCloudBudgetThresholds,
} from "Common/Types/Cloud/CloudCost";
import { getCloudBudgetPlanFromForecast } from "Common/Types/Cloud/CloudCostForecast";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import Toast from "Common/UI/Utils/Toast";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A CLOUD BUDGET'S OWN PAGE (#11008): what it counts and for how long, how
 * its period is going - what it cost so far, where it is heading, and, a
 * yearly budget split by month, this month against its share and the year
 * against its plan so far - its period month by month, this month day by
 * day, what cost the most, and who hears. A yearly budget's forecast can
 * become its plan here, each month held to its forecast share.
 *
 * It reads POST /cloud-budget/:id/spend (CloudBudgetFigures), as the person
 * may read the budget and the costs.
 */

export const BUDGET_PAUSED: string = translationKey("Paused");
export const BUDGET_ENABLED: string = translationKey("Enabled");

const BUDGET_SELECT: JSONObject = {
  _id: true,
  name: true,
  description: true,
  isEnabled: true,
  scope: true,
  cloudAccountId: true,
  cloudAccount: { name: true },
  cloudCostGroupId: true,
  cloudCostGroup: { name: true, cloudCostViewId: true },
  filterRules: true,
  monthlyAmount: true,
  currency: true,
  costBasis: true,
  period: true,
  fiscalYearStartMonth: true,
  planSplit: true,
  monthlyPlan: true,
  alertThresholds: true,
  alertOnProjection: true,
  alertOnAnomaly: true,
  unusualDayThreshold: true,
  unusualDayThresholdUnit: true,
  notifyCostGroupTeam: true,
  notifyUsers: { name: true, email: true },
  notifyTeams: { name: true },
  onCallDutyPolicies: { name: true },
  alertSeverity: { name: true },
  spentThisMonth: true,
  projectedThisMonth: true,
  spentThisPeriod: true,
  projectedThisPeriod: true,
  lastCheckedAt: true,
  alertState: true,
};

// The noun a budget's window tile is titled with.
function windowTitle(page: CloudBudgetPageResult): string {
  if (page.window.isPlanMonth) {
    return THIS_YEAR;
  }

  if (page.period.period === CloudBudgetPeriod.Quarter) {
    return THIS_QUARTER;
  }

  return page.period.period === CloudBudgetPeriod.Year ? THIS_YEAR : THIS_MONTH;
}

const CloudBudgetPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const route: Route = RouteMap[PageMap.CLOUD_BUDGET_VIEW] as Route;
  const budgetId: ObjectID = new ObjectID(
    Navigation.getParamByName(RouteParams.ModelID, route) || "",
  );
  const context: CloudBudgetFormContext = useCloudBudgetFormContext();
  const [budget, setBudget] = useState<CloudBudget | null>(null);
  const [budgetError, setBudgetError] = useState<string>("");
  const [page, setPage] = useState<CloudBudgetPageResult | null>(null);
  const [pageError, setPageError] = useState<string>("");
  const [attempt, setAttempt] = useState<number>(0);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [planToSave, setPlanToSave] = useState<Array<number> | null>(null);
  const [isSavingPlan, setIsSavingPlan] = useState<boolean>(false);
  const [planError, setPlanError] = useState<string>("");

  useEffect(() => {
    let ignore: boolean = false;

    ModelAPI.getItem<CloudBudget>({
      modelType: CloudBudget,
      id: budgetId,
      select: BUDGET_SELECT as never,
    })
      .then((found: CloudBudget | null): void => {
        if (!ignore) {
          setBudget(found);
        }
      })
      .catch((err: Error): void => {
        if (!ignore) {
          setBudgetError(API.getFriendlyMessage(err));
        }
      });

    setPage(null);
    setPageError("");

    fetchCloudBudgetPage(budgetId)
      .then((found: CloudBudgetPageResult): void => {
        if (!ignore) {
          setPage(found);
        }
      })
      .catch((err: Error): void => {
        if (!ignore) {
          setPageError(API.getFriendlyMessage(err));
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [budgetId.toString(), attempt]);

  if (budgetError) {
    return <ErrorMessage message={budgetError} />;
  }

  if (!budget) {
    return <PageSkeleton />;
  }

  const currency: string = page?.currency || budget.currency || "USD";
  const money: (amount: number) => string = (amount: number): string => {
    return formatCloudMoney({
      amount,
      currency,
      translator,
      wholeWhenRound: true,
    });
  };
  const status: CloudBudgetStatus = getBudgetRowStatus(budget, {
    amount: page ? page.window.amount : Number(budget.monthlyAmount) || 0,
    spent: page
      ? page.window.isPlanMonth
        ? page.spentThisMonth
        : page.spentThisPeriod
      : 0,
    projected: page
      ? page.window.isPlanMonth
        ? page.projectedThisMonth
        : page.projectedThisPeriod
      : 0,
    isPlanMonth: Boolean(page?.window.isPlanMonth),
    period: readCloudBudgetPeriod(budget.period),
    periodAmount: Number(budget.monthlyAmount) || 0,
    periodSpent: page?.spentThisPeriod || 0,
    periodProjected: page?.projectedThisPeriod || 0,
  });
  const isYearly: boolean =
    readCloudBudgetPeriod(budget.period) === CloudBudgetPeriod.Year;

  const tiles: Array<CloudStatTile> = [];

  if (page) {
    const left: number = page.amount - page.spentThisPeriod;
    const lastDay: string = formatCloudMonth(
      page.period.lastDay.slice(0, 7),
      translator,
    );

    tiles.push({
      key: "period",
      title: windowTitle(page),
      value: money(page.spentThisPeriod),
      sublabel:
        page.plannedToDate !== null
          ? translator.translateTemplate(PLANNED_SO_FAR, {
              amount: money(page.plannedToDate),
            })
          : translator.translateTemplate(OF_AMOUNT, {
              amount: money(page.amount),
            }),
      sublabelIsTranslated: true,
      icon: IconProp.Billing,
      color: "indigo",
    });

    if (page.window.isPlanMonth) {
      tiles.push({
        key: "month",
        title: THIS_MONTH,
        value: money(page.spentThisMonth),
        sublabel: translator.translateTemplate(OF_AMOUNT, {
          amount: money(page.window.amount),
        }),
        sublabelIsTranslated: true,
        icon: IconProp.Calendar,
        color: "sky",
      });
    }

    tiles.push({
      key: "projected",
      title: ON_COURSE_FOR,
      value: money(page.projectedThisPeriod),
      sublabel: translator.translateTemplate(AT_PERIOD_END, { day: lastDay }),
      sublabelIsTranslated: true,
      icon: IconProp.ArrowTrendingUp,
      color: page.projectedThisPeriod > page.amount ? "amber" : "emerald",
    });
    tiles.push({
      key: "left",
      title: left >= 0 ? LEFT_TO_SPEND : OVER_BY,
      value: money(Math.abs(left)),
      icon: IconProp.Wallet,
      color: left >= 0 ? "emerald" : "rose",
    });
  }

  const topServiceItems: Array<RankedBarItem> = (page?.topServices || []).map(
    (entry: { service: string; amount: number }): RankedBarItem => {
      return {
        key: entry.service,
        label: <bdi>{entry.service}</bdi>,
        title: entry.service,
        count: entry.amount,
        countText: money(entry.amount),
      };
    },
  );

  const people: Array<string> = [
    ...(budget.notifyUsers || []).map((user: User): string => {
      return String(user.name || user.email || "");
    }),
    ...(budget.notifyTeams || []).map((team: Team): string => {
      return team.name || "";
    }),
  ].filter(Boolean);
  const policies: Array<string> = (budget.onCallDutyPolicies || [])
    .map((policy: OnCallDutyPolicy): string => {
      return policy.name || "";
    })
    .filter(Boolean);
  const passed: Array<number> = Array.isArray(
    (budget.alertState as { thresholds?: unknown } | undefined)?.thresholds,
  )
    ? (budget.alertState as { thresholds: Array<number> }).thresholds || []
    : [];

  const openSavePlan: () => void = (): void => {
    if (!page) {
      return;
    }

    setPlanError("");
    setPlanToSave(
      getCloudBudgetPlanFromForecast({
        forecast: page.forecast,
        fiscalYearStartMonth: budget.fiscalYearStartMonth,
      }),
    );
  };

  const savePlan: () => Promise<void> = async (): Promise<void> => {
    if (!planToSave) {
      return;
    }

    setIsSavingPlan(true);
    setPlanError("");

    try {
      await ModelAPI.updateById<CloudBudget>({
        modelType: CloudBudget,
        id: budgetId,
        data: {
          planSplit: CloudBudgetPlanSplit.ByMonth,
          monthlyPlan: planToSave,
          monthlyAmount: sumCloudBudgetPlan(planToSave),
        } as unknown as JSONObject,
      });
      Toast.success(translator.translateText(PLAN_SAVED) || PLAN_SAVED);
      setPlanToSave(null);
      setAttempt(attempt + 1);
    } catch (err) {
      setPlanError(API.getFriendlyMessage(err));
    } finally {
      setIsSavingPlan(false);
    }
  };

  return (
    <Fragment>
      <Card
        title={BUDGET_TITLE}
        description={budget.description || undefined}
        buttons={[
          {
            title: EDIT_BUDGET,
            icon: IconProp.Edit,
            onClick: () => {
              setIsEditing(true);
            },
          },
        ]}
      >
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-2"
          data-testid="cloud-budget-header"
        >
          <h2 className="text-lg font-semibold text-gray-900">
            <bdi>{budget.name}</bdi>
          </h2>
          <Pill
            text={
              budget.isEnabled === false
                ? translator.translateText(BUDGET_PAUSED) || BUDGET_PAUSED
                : translator.translateText(status.label) || status.label
            }
            isUserContent={true}
            tone={budget.isEnabled === false ? PillTone.Paused : undefined}
            color={
              budget.isEnabled === false
                ? undefined
                : CLOUD_BUDGET_TONE_COLORS[status.tone]
            }
          />
          {page ? <CloudCostBasisPill basis={page.basis} /> : <></>}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div data-testid="cloud-budget-applies-to">
            <CloudBudgetScopeCell
              budget={budget}
              ruleNames={context.ruleContext.names}
            />
          </div>
          <div className="text-gray-700" data-testid="cloud-budget-period-line">
            {getCloudBudgetPeriodLine({
              period: budget.period,
              fiscalYearStartMonth: budget.fiscalYearStartMonth,
              planSplit: budget.planSplit,
              translator,
              labels: CLOUD_BUDGET_PERIOD_LABELS,
            })}
            {" · "}
            {money(Number(budget.monthlyAmount) || 0)}
          </div>
        </div>
      </Card>
      {pageError ? (
        <ErrorMessage
          message={pageError}
          onRefreshClick={() => {
            setAttempt(attempt + 1);
          }}
        />
      ) : page === null ? (
        <PageSkeleton shape="chart" />
      ) : (
        <Fragment>
          <CloudStatStrip testId="cloud-budget-strip" tiles={tiles} />
          <Card
            title={MONTHS_TITLE}
            description={MONTHS_DESCRIPTION}
            buttons={
              isYearly
                ? [
                    {
                      title: SAVE_FORECAST_AS_PLAN,
                      icon: IconProp.ChartBar,
                      onClick: openSavePlan,
                    },
                  ]
                : []
            }
          >
            <CloudBudgetMonths
              months={page.months}
              currency={currency}
              amount={page.amount}
              spentThisPeriod={page.spentThisPeriod}
            />
          </Card>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Card title={DAYS_TITLE} description={DAYS_DESCRIPTION}>
                <CloudDailySpendChart
                  points={page.days.map(
                    (day: { day: string; amount: number }) => {
                      return { x: fromCloudCostDay(day.day), y: day.amount };
                    },
                  )}
                  currency={currency}
                />
              </Card>
            </div>
            <Card
              title={TOP_SERVICES_TITLE}
              description={TOP_SERVICES_DESCRIPTION}
              fillHeight={true}
            >
              <RankedBars
                emptyText={TOP_SERVICES_EMPTY}
                items={topServiceItems}
              />
            </Card>
          </div>
        </Fragment>
      )}
      <Card title={WHO_HEARS_TITLE} description={WHO_HEARS_DESCRIPTION}>
        <dl
          className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3"
          data-testid="cloud-budget-who-hears"
        >
          <div>
            <dt className="font-medium text-gray-700">
              {translator.translateText(TOLD_BELOW_100)}
            </dt>
            <dd className="mt-1 text-gray-600">
              {people.length > 0 ? (
                <bdi>{people.join(", ")}</bdi>
              ) : (
                translator.translateText(NOBODY_TO_TELL)
              )}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-gray-700">
              {translator.translateText(PAGED_FROM_100)}
            </dt>
            <dd className="mt-1 text-gray-600">
              {policies.length > 0 ? (
                <bdi>{policies.join(", ")}</bdi>
              ) : (
                translator.translateText(NOBODY_PAGED)
              )}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-gray-700">
              {translator.translateText("Alert At")}
            </dt>
            <dd className="mt-1 text-gray-600">
              {readCloudBudgetThresholds(budget.alertThresholds)
                .map((threshold: number): string => {
                  return `${translator.formatNumber(threshold)}%`;
                })
                .join(", ")}
              <div className="mt-1 text-xs text-gray-500">
                {passed.length > 0
                  ? translator.translateTemplate(THRESHOLDS_PASSED, {
                      thresholds: passed
                        .map((threshold: number): string => {
                          return `${translator.formatNumber(threshold)}%`;
                        })
                        .join(", "),
                    })
                  : translator.translateText(NO_THRESHOLD_PASSED)}
              </div>
            </dd>
          </div>
        </dl>
      </Card>
      {isEditing ? (
        <ModelFormModal<CloudBudget>
          modelType={CloudBudget}
          name="cloud-budget-edit"
          title={EDIT_BUDGET}
          submitButtonText="Save Changes"
          modelIdToEdit={budgetId}
          onClose={() => {
            setIsEditing(false);
          }}
          onSuccess={() => {
            setIsEditing(false);
            setAttempt(attempt + 1);
          }}
          formProps={{
            name: "cloud-budget-edit-form",
            modelType: CloudBudget,
            id: "cloud-budget-edit-form",
            formType: FormType.Update,
            steps: CLOUD_BUDGET_FORM_STEPS,
            fields: getCloudBudgetFormFields({ context, translator }),
          }}
        />
      ) : (
        <></>
      )}
      {planToSave ? (
        <ConfirmModal
          title={SAVE_FORECAST_AS_PLAN}
          description={
            <div data-testid="cloud-budget-plan-preview">
              <p className="text-sm text-gray-600">
                {translator.translateText(SAVE_PLAN_DESCRIPTION)}
              </p>
              <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                {getFiscalMonthNumbers(budget.fiscalYearStartMonth).map(
                  (monthNumber: number, index: number): ReactElement => {
                    return (
                      <li
                        key={monthNumber}
                        className="flex justify-between gap-2"
                      >
                        <span className="text-gray-600">
                          {formatCalendarMonthName(monthNumber, translator)}
                        </span>
                        <span className="text-gray-900">
                          {money(planToSave[index] || 0)}
                        </span>
                      </li>
                    );
                  },
                )}
              </ul>
            </div>
          }
          submitButtonText={SAVE_FORECAST_AS_PLAN}
          onClose={() => {
            setPlanToSave(null);
          }}
          onSubmit={() => {
            void savePlan();
          }}
          isLoading={isSavingPlan}
          error={planError}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default CloudBudgetPage;
