import PageComponentProps from "../PageComponentProps";
import CloudStatStrip, {
  CloudStatTile,
} from "../../Components/Cloud/CloudStatStrip";
import CloudCostBasisSwitch, {
  CloudCostBasisChoice,
  useCloudCostBasis,
} from "../../Components/Cloud/CloudCostBasis";
import { formatCloudMoney } from "../../Components/Cloud/CloudCostWords";
import {
  CloudCostForecastAsk,
  fetchCloudCostForecast,
} from "../../Components/Cloud/Budgets/CloudBudgetReads";
import CloudForecastChart from "../../Components/Cloud/Budgets/CloudForecastChart";
import {
  CloudForecastHowMade,
  CloudForecastMonths,
} from "../../Components/Cloud/Budgets/CloudForecastDetails";
import CloudForecastSavePlan from "../../Components/Cloud/Budgets/CloudForecastSavePlan";
import {
  BY_MONTH_DESCRIPTION,
  BY_MONTH_TITLE,
  FORECAST_A_COST_GROUP,
  FORECAST_AN_ACCOUNT,
  FORECAST_A_SERVICE,
  FORECAST_DESCRIPTION,
  FORECAST_EVERYTHING,
  FORECAST_FOR,
  FORECAST_NOTHING_YET,
  FORECAST_PICK_FIRST,
  FORECAST_TITLE,
  HOW_MADE_TITLE,
  LIKELY_RANGE,
  NEXT_12_MONTHS,
  NEXT_MONTH,
  NO_RANGE,
  PICK_ACCOUNT,
  PICK_COST_GROUP,
  PICK_SERVICE,
  RANGE_OF,
  SAVE_AS_BUDGET_PLAN,
  SPENT_SO_FAR,
  THIS_MONTH,
  TREND_PER_MONTH,
  TREND_TILE,
  WHAT_IF_APPLIED,
  WHAT_IF_CLEAR,
  WHAT_IF_MONTH,
  WHAT_IF_PERCENT,
  WHAT_IF_SENTENCE,
  WHAT_IF_TITLE,
  formatCloudMonth,
} from "../../Components/Cloud/Budgets/CloudBudgetWords";
import { getCloudBudgetCostGroupOptions } from "../../Components/Cloud/Budgets/CloudBudgetScopeTarget";
import useCloudBudgetFormContext, {
  CloudBudgetFormContext,
} from "../../Components/Cloud/Budgets/UseCloudBudgetFormContext";
import { CloudBudgetScope } from "Common/Types/Cloud/CloudBudget";
import { CloudCostForecastResult } from "Common/Types/Cloud/CloudBudgetReads";
import {
  CloudCostForecast,
  CloudCostForecastGrowth,
  CloudCostForecastMethod,
  CloudCostForecastMonth,
  CloudCostForecastMonthKind,
  applyCloudCostGrowth,
  getCloudCostForecastAhead,
  readCloudCostForecastGrowth,
} from "Common/Types/Cloud/CloudCostForecast";
import {
  CloudCostRuleField,
  CloudCostRuleOperator,
} from "Common/Types/Cloud/CloudCostRules";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FilterButtons from "Common/UI/Components/FilterButtons/FilterButtons";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * Cloud > Spend > Forecast (#11008): what the spend is on course to cost in
 * the months ahead - for everything, an account, a cost group or a service
 * - and how that is worked out. The months it was made from as they cost,
 * this month on course, the next twelve as forecast with their likely
 * range, the method in plain words, a growth what-if ("payments grows 20%
 * from January"), and Save as Budget Plan, which makes the next twelve
 * months a yearly budget's plan.
 *
 * It reads POST /cloud-budget/forecast as the person may read the costs,
 * on the cost basis picked. The what-if is applied here, as it is typed
 * (applyCloudCostGrowth), the same way the API applies one asked of it.
 */


type ForecastScope = "all" | "account" | "group" | "service";

// What the page asks the API for, from what is picked; null until picked.
export function toCloudCostForecastAsk(data: {
  scope: ForecastScope;
  accountId: string | null;
  groupId: string | null;
  service: string | null;
}): Omit<CloudCostForecastAsk, "currency" | "basis"> | null {
  if (data.scope === "account") {
    return data.accountId
      ? {
          scope: CloudBudgetScope.Account,
          cloudAccountId: new ObjectID(data.accountId),
        }
      : null;
  }

  if (data.scope === "group") {
    return data.groupId
      ? {
          scope: CloudBudgetScope.CostGroup,
          cloudCostGroupId: new ObjectID(data.groupId),
        }
      : null;
  }

  if (data.scope === "service") {
    return data.service
      ? {
          scope: CloudBudgetScope.Filter,
          filterRules: [
            {
              conditions: [
                {
                  field: CloudCostRuleField.Service,
                  operator: CloudCostRuleOperator.Is,
                  values: [data.service],
                },
              ],
            },
          ],
        }
      : null;
  }

  return { scope: CloudBudgetScope.AllAccounts };
}

// The months ahead a what-if can start from: the forecast's own.
export function getWhatIfMonthOptions(
  forecast: CloudCostForecast,
  translator: Translator,
): Array<DropdownOption> {
  return getCloudCostForecastAhead(forecast).map(
    (month: CloudCostForecastMonth): DropdownOption => {
      return {
        label: formatCloudMonth(month.month, translator),
        value: month.month,
      };
    },
  );
}

const CloudForecastPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const context: CloudBudgetFormContext = useCloudBudgetFormContext();
  const basisChoice: CloudCostBasisChoice = useCloudCostBasis();
  const [scope, setScope] = useState<ForecastScope>("all");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [service, setService] = useState<string | null>(null);
  const [result, setResult] = useState<CloudCostForecastResult | null>(null);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [attempt, setAttempt] = useState<number>(0);
  const [growthPercent, setGrowthPercent] = useState<string>("");
  const [growthFrom, setGrowthFrom] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const baseAsk: Omit<CloudCostForecastAsk, "currency" | "basis"> | null =
    useMemo(() => {
      return toCloudCostForecastAsk({ scope, accountId, groupId, service });
    }, [scope, accountId, groupId, service]);

  useEffect(() => {
    let ignore: boolean = false;

    setError("");

    if (!baseAsk) {
      setResult(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    fetchCloudCostForecast({
      ...baseAsk,
      currency: context.currency,
      basis: basisChoice.basis,
    })
      .then((found: CloudCostForecastResult): void => {
        if (!ignore) {
          setResult(found);
        }
      })
      .catch((err: Error): void => {
        if (!ignore) {
          setError(API.getFriendlyMessage(err));
        }
      })
      .finally((): void => {
        if (!ignore) {
          setIsLoading(false);
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [baseAsk, context.currency, basisChoice.basis, attempt]);

  const growth: CloudCostForecastGrowth | null = readCloudCostForecastGrowth({
    percent: growthPercent,
    fromMonth: growthFrom,
  });
  const forecast: CloudCostForecast | null = result
    ? applyCloudCostGrowth(result.forecast, growth)
    : null;
  const currency: string = result?.currency || context.currency;
  const money: (amount: number) => string = (amount: number): string => {
    return formatCloudMoney({ amount, currency, translator, whole: true });
  };

  const scopePicker: ReactElement = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <FilterButtons
        ariaLabel={FORECAST_FOR}
        dataTestId="cloud-forecast-scope"
        className="flex-wrap"
        selectedValue={scope}
        options={[
          { label: FORECAST_EVERYTHING, value: "all" },
          { label: FORECAST_AN_ACCOUNT, value: "account" },
          { label: FORECAST_A_COST_GROUP, value: "group" },
          { label: FORECAST_A_SERVICE, value: "service" },
        ]}
        onSelect={(value: string) => {
          setScope(value as ForecastScope);
        }}
      />
      {scope === "account" ? (
        <div className="w-full sm:w-72">
          <Dropdown
            ariaLabel={FORECAST_AN_ACCOUNT}
            placeholder={PICK_ACCOUNT}
            isClearable={false}
            options={context.accounts.map(
              (account: { id: string; name: string }): DropdownOption => {
                return { label: account.name, value: account.id };
              },
            )}
            value={context.accounts
              .filter((account: { id: string }): boolean => {
                return account.id === accountId;
              })
              .map((account: { id: string; name: string }) => {
                return { label: account.name, value: account.id };
              })
              .shift()}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              setAccountId(value ? String(value) : null);
            }}
          />
        </div>
      ) : scope === "group" ? (
        <div className="w-full sm:w-72">
          <Dropdown
            ariaLabel={FORECAST_A_COST_GROUP}
            placeholder={PICK_COST_GROUP}
            isClearable={false}
            options={getCloudBudgetCostGroupOptions(context.costGroups)}
            value={context.costGroups
              .filter((group: { id: string }): boolean => {
                return group.id === groupId;
              })
              .map((group: { id: string; name: string }) => {
                return { label: group.name, value: group.id };
              })
              .shift()}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              setGroupId(value ? String(value) : null);
            }}
          />
        </div>
      ) : scope === "service" ? (
        <div className="w-full sm:w-72">
          <Dropdown
            ariaLabel={FORECAST_A_SERVICE}
            placeholder={PICK_SERVICE}
            isClearable={false}
            options={context.ruleContext.options.services.map(
              (name: string): DropdownOption => {
                return { label: name, value: name };
              },
            )}
            value={service ? { label: service, value: service } : undefined}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              setService(value ? String(value) : null);
            }}
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );

  let body: ReactElement;

  if (!baseAsk) {
    body = (
      <p className="text-sm text-gray-600" data-testid="cloud-forecast-pick">
        {translator.translateText(FORECAST_PICK_FIRST)}
      </p>
    );
  } else if (error) {
    body = (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          setAttempt(attempt + 1);
        }}
      />
    );
  } else if (isLoading || !forecast) {
    body = <PageSkeleton shape="chart" />;
  } else if (
    forecast.monthsOfHistory === 0 &&
    forecast.months.every((month: CloudCostForecastMonth): boolean => {
      return month.amount === 0;
    })
  ) {
    body = (
      <p className="text-sm text-gray-600" data-testid="cloud-forecast-empty">
        {translator.translateText(FORECAST_NOTHING_YET)}
      </p>
    );
  } else {
    const ahead: Array<CloudCostForecastMonth> =
      getCloudCostForecastAhead(forecast);
    const current: CloudCostForecastMonth | undefined = forecast.months.find(
      (month: CloudCostForecastMonth): boolean => {
        return month.kind === CloudCostForecastMonthKind.Current;
      },
    );
    const next: CloudCostForecastMonth | undefined = ahead[0];
    const sum: (key: "amount" | "low" | "high") => number = (
      key: "amount" | "low" | "high",
    ): number => {
      return ahead.reduce(
        (total: number, month: CloudCostForecastMonth): number => {
          return total + (month[key] || 0);
        },
        0,
      );
    };
    const hasRange: boolean = forecast.method !== CloudCostForecastMethod.Pace;
    const range: (low: number, high: number) => string = (
      low: number,
      high: number,
    ): string => {
      return translator.translateTemplate(RANGE_OF, {
        low: money(low),
        high: money(high),
      });
    };
    const tiles: Array<CloudStatTile> = [
      {
        key: "next-12",
        title: NEXT_12_MONTHS,
        value: money(sum("amount")),
        sublabel: hasRange
          ? range(sum("low"), sum("high"))
          : translator.translateText(NO_RANGE) || NO_RANGE,
        sublabelIsTranslated: true,
        icon: IconProp.ChartBar,
        color: "violet",
      },
      {
        key: "next-month",
        title: NEXT_MONTH,
        value: next ? money(next.amount) : undefined,
        sublabel:
          next && next.low !== undefined && next.high !== undefined
            ? range(next.low, next.high)
            : "",
        sublabelIsTranslated: true,
        icon: IconProp.Calendar,
        color: "indigo",
      },
      {
        key: "this-month",
        title: THIS_MONTH,
        value: current ? money(current.amount) : undefined,
        sublabel: current
          ? translator.translateTemplate(SPENT_SO_FAR, {
              amount: money(current.spent || 0),
            })
          : "",
        sublabelIsTranslated: true,
        icon: IconProp.Billing,
        color: "sky",
      },
      {
        key: "trend",
        title: TREND_TILE,
        value:
          forecast.trendPerMonth !== undefined
            ? translator.translateTemplate(TREND_PER_MONTH, {
                amount: `${forecast.trendPerMonth >= 0 ? "+" : "−"}${money(
                  Math.abs(forecast.trendPerMonth),
                )}`,
              })
            : undefined,
        icon: IconProp.ArrowTrendingUp,
        color: "emerald",
      },
    ];

    body = (
      <Fragment>
        <CloudStatStrip testId="cloud-forecast-strip" tiles={tiles} />
        <Card
          title={BY_MONTH_TITLE}
          description={BY_MONTH_DESCRIPTION}
          buttons={[
            {
              title: SAVE_AS_BUDGET_PLAN,
              icon: IconProp.Wallet,
              onClick: () => {
                setIsSaving(true);
              },
            },
          ]}
        >
          <CloudForecastChart months={forecast.months} currency={currency} />
          <div
            className="mt-4 space-y-3 border-t border-gray-100 pt-4"
            data-testid="cloud-forecast-what-if"
          >
            <div className="text-sm font-medium text-gray-700">
              {translator.translateText(WHAT_IF_TITLE)}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
              <TranslatedSentence
                template={WHAT_IF_SENTENCE}
                renderText={(text: string): ReactElement => {
                  return <span>{text}</span>;
                }}
                slots={{
                  month: (
                    <span className="inline-block w-48 sm:w-56">
                      <Dropdown
                        ariaLabel={WHAT_IF_MONTH}
                        isClearable={false}
                        options={getWhatIfMonthOptions(forecast, translator)}
                        value={getWhatIfMonthOptions(forecast, translator).find(
                          (option: DropdownOption): boolean => {
                            return option.value === growthFrom;
                          },
                        )}
                        onChange={(
                          value: DropdownValue | Array<DropdownValue> | null,
                        ) => {
                          setGrowthFrom(value ? String(value) : "");
                        }}
                      />
                    </span>
                  ),
                  percent: (
                    <span className="inline-block w-24">
                      <Input
                        type={InputType.NUMBER}
                        value={growthPercent}
                        placeholder="20"
                        ariaLabel={WHAT_IF_PERCENT}
                        dataTestId="cloud-forecast-growth-percent"
                        onChange={(text: string) => {
                          setGrowthPercent(text);
                        }}
                      />
                    </span>
                  ),
                }}
              />
            </div>
            {growth ? (
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="text-sm text-gray-600"
                  data-testid="cloud-forecast-growth-applied"
                >
                  {translator.translateTemplate(WHAT_IF_APPLIED, {
                    percent: `${growth.percent > 0 ? "+" : "−"}${translator.formatNumber(
                      Math.abs(growth.percent),
                    )}%`,
                    month: formatCloudMonth(growth.fromMonth, translator),
                  })}
                </span>
                <Button
                  title={WHAT_IF_CLEAR}
                  buttonStyle={ButtonStyleType.LINK}
                  onClick={() => {
                    setGrowthPercent("");
                    setGrowthFrom("");
                  }}
                />
              </div>
            ) : (
              <></>
            )}
          </div>
        </Card>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card title={HOW_MADE_TITLE} fillHeight={true}>
            <CloudForecastHowMade forecast={forecast} />
          </Card>
          <div className="lg:col-span-2">
            <Card title={LIKELY_RANGE}>
              <CloudForecastMonths forecast={forecast} currency={currency} />
            </Card>
          </div>
        </div>
        {isSaving ? (
          <CloudForecastSavePlan
            forecast={forecast}
            ask={{
              ...baseAsk,
              currency,
              basis: result?.basis,
            }}
            currency={currency}
            suggestedName={translator.translateText(FORECAST_TITLE) || ""}
            onClose={() => {
              setIsSaving(false);
            }}
          />
        ) : (
          <></>
        )}
      </Fragment>
    );
  }

  return (
    <Fragment>
      <Card title={FORECAST_TITLE} description={FORECAST_DESCRIPTION}>
        <div className="space-y-4">
          {scopePicker}
          <CloudCostBasisSwitch
            basis={basisChoice.basis}
            onChange={basisChoice.setBasis}
            accounts={context.accountsRead.accounts}
          />
        </div>
      </Card>
      {body}
    </Fragment>
  );
};

export default CloudForecastPage;
